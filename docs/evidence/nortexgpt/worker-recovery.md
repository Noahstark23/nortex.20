# Recuperación durable del worker de NortexGPT

**Resultado demostrado:** un proceso nuevo recupera el mismo trabajo después de interrumpir abruptamente al proceso que lo había reclamado. Se crea una propuesta y ninguna compra.

## Candidato y ejecución

- Fecha: 2026-09-05, 21:00 UTC.
- Candidato local: `/tmp/nortexgpt-implementation-20260905`; no acredita despliegue ni un SHA publicado.
- Base: MySQL **8.0.46** local descartable, comprobado mediante `SELECT VERSION()`.
- Prueba: `tests/assistantWorkerRecovery.integration.test.ts`.
- Resultado: **1 prueba aprobada, 0 omitidas**, 797 ms de ejecución; 1.16 s incluyendo preparación de Vitest.
- Se usó el runtime fijado mediante `mise exec` y el cliente Prisma compartido.

```sh
/tmp/nortexgpt-qa-run env NORTEX_QA_ASSISTANT_WORKER_RECOVERY=true \
  mise exec -- npx --no-install vitest run tests/assistantWorkerRecovery.integration.test.ts
```

El ejecutor local inyecta la conexión descartable sin mostrar credenciales. La fixture verifica protocolo MySQL, host local y nombre permitido de base antes de escribir. Una corrida unitaria sin entorno de integración omite esta suite y **no cuenta** como esta evidencia.

## Escenario y efectos persistidos

1. Se crean negocio y usuario sintéticos, con permisos de compras y extracción. `saveAssistantAttachment` guarda realmente un PDF del corpus sintético, con huella y archivo privado; `enqueueInvoiceExtraction` persiste el trabajo.
2. El proceso A ejecuta `runAssistantWorkerOnce`. La lectura y validación reales del archivo llegan hasta el proveedor inyectado, que queda detenido. MySQL conserva `PROCESSING`, un intento y una concesión de procesamiento vigente; existen cero propuestas y cero compras.
3. La prueba envía **SIGKILL** y espera la terminación del proceso A. Consulta MySQL nuevamente y comprueba que el trabajo continúa reclamado, con la misma identidad de procesamiento. No hay recuperación desde memoria del proceso muerto.
4. La prueba establece explícitamente el vencimiento de esa concesión en la base. Esto evita esperar los 180 segundos configurados: **no se presenta como una espera real ni como una prueba del reloj**.
5. Un proceso B, con PID diferente, ejecuta el mismo worker y lee el mismo archivo persistido. Completa el trabajo original y cierra la propuesta dentro de la transacción del producto.

| Evidencia final en MySQL | Resultado |
|---|---|
| Trabajo original | `SUCCEEDED`, 2 intentos |
| Identidad de propuesta | Igual al ID del trabajo original |
| Concesión activa y error | Nulos |
| Propuestas del negocio sintético | Exactamente 1, estado `DRAFT` |
| Recepción y pago de la propuesta | Ambos `false`, aunque la respuesta sintética afirmaba ambos |
| Compras | 0 |
| Comandos de registro de compra | 0 |
| Consumos del proveedor | 0 |

La prueba no sustituye el worker, el cliente MySQL, la lectura de archivos, la validación PDF ni la creación transaccional de propuestas. Inyecta exclusivamente un proveedor determinista, sin llamada pagada. Limpia los procesos y el directorio privado temporal al terminar; las filas sintéticas quedan en la base descartable para su eliminación por el entorno de QA.

## Alcance y límites

Demuestra persistencia después de la muerte abrupta de un proceso y recuperación desde un proceso diferente con la misma base y almacenamiento. No acredita calidad OCR/LLM, exactitud de una factura real, recuperación de toda la máquina, respaldo/restauración, interrupción de MySQL ni producción. Tampoco transforma la respuesta del proveedor en una recepción física o un pago confirmado.

Huellas SHA-256 de los archivos comprobados:

| Archivo | SHA-256 |
|---|---|
| `backend/services/assistant/worker.ts` | `708b7501b2512b9c67c462dcff2f41314193ac4ebe994a583a5bfed3796e197f` |
| `backend/services/assistant/attachments.ts` | `5cf404df49e819a402cb662a586d0b20fe4f215fad3f7c83999db74fef5cdf99` |
| `tests/assistantWorkerRecovery.integration.test.ts` | `bf8ca4df79e3505c7d256541e1320bd9db599f15ef499700fabdde581d6f8124` |
