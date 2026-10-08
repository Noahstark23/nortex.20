# Revisión independiente acotada — asistente operativo

Candidato: `/tmp/nortexgpt-operativo-20260905`. Revisión de sólo lectura del producto, 2026-09-05. Las únicas escrituras del revisor fueron reproducciones e informes en `reports/`, y filas sintéticas identificadas y eliminadas en MySQL descartable. Sin proveedor real, credenciales de producción, migraciones o envíos.

**Estado final: ambos defectos corregidos y revalidados independientemente.** Se conserva abajo la evidencia roja previa. La evidencia verde actual está separada en archivos `*-fixed.json`; no se sobrescribieron los resultados del defecto original. La revalidación no acredita piloto, modelo real o producción.

## Hallazgos reproducidos antes de la reparación

### P1 — revocación durante la reserva todavía permite enviar historial al proveedor

`backend/services/assistant/operations/orchestrator.ts:71–79` espera `reserve()` después de `assertActive()`, pero no vuelve a verificar antes de `create()`. Si la reserva espera y en ese intervalo se revoca la sesión o cancela el run, el proveedor recibe los mensajes/historial. El control posterior de línea 92 impide usar su resultado, pero llega después del envío.

Prueba real de la función con callbacks deterministas: `review-reserve-revoke.mjs` marca la identidad revocada al resolver la reserva. Evidencia `review-reserve-revoke.json`: `providerCalls: 1`, `providerSawPriorData: true`, termina con `SESSION_REVOKED`. Cero llamadas pagadas. No afirma que un dato real haya salido del entorno.

Reparación necesaria: revalidar después de reservar y antes de invocar. Si todavía no se invocó, tratar ese consumo como conocido cero; no iniciar un nuevo intento ni liberar consumo incierto de una llamada ya iniciada.

### P2 — cancelar pierde la referencia a borradores ya guardados

`backend/services/assistant/operations/tools.ts:35–38` registra el borrador antes de la validación posterior del run. `orchestrator.ts` agrega el identificador al checkpoint después de retornar la herramienta. Cancelar mientras la transacción de preparación termina puede guardar un DRAFT y abortar antes de asociarlo al resultado.

La variante MySQL `review-cancel-draft.mjs` intercepta sólo la devolución de `AssistantActionProposal.create` dentro de la transacción real, cancela el run y deja terminar esa transacción. Evidencia `review-cancel-draft.json`: run `CANCELLED`, borrador DRAFT existente, `checkpointProposalIds: []`, `recoveredResult: null`; paso preparatorio todavía `RUNNING`. Dos respuestas simuladas, ninguna llamada pagada.

Existe además pérdida de acceso desde la interfaz aunque el borrador haya terminado antes de cancelar: `runService.ts:21–24` devuelve referencias solamente a través de `row.result`, no las ya persistidas en el checkpoint. Variante `--after-checkpoint`: `review-cancel-after-checkpoint.json` contiene una referencia real en el checkpoint y paso preparatorio `SUCCEEDED`, pero el DTO recuperado sigue sin resultado/referencia después de cancelar durante la llamada siguiente. Tres respuestas simuladas, ninguna llamada pagada.

No se movió dinero ni stock en estas reproducciones. Sí queda trabajo privado sin acceso normal desde el run; no hay un endpoint de listado de propuestas que lo compense. Debe conservarse asociación durable y recuperable bajo el mismo tenant/usuario/rol. Cancelación y timeout deben impedir nuevas preparaciones sin perder las ya guardadas.

## Otros límites revisados sin hallazgo adicional concreto

- Confirmación admite identidad y versión de propuesta, nunca contenido financiero nuevo; revalida actor y flags bajo transacción y conserva resultado de idempotencia privado.
- Recuperación de run no vuelve a ejecutar herramientas cuando un RUNNING quedó abandonado. Identificadores de otro negocio/usuario/rol quedan fuera del alcance de lectura.
- Fallback sólo selecciona herramientas READ conocidas, conserva indisponibilidad y no prepara acciones cuando falta proveedor o presupuesto.
- Retención acotada vuelve a comprobar estado/expiración al borrar y excluye propuestas COMMITTED o con operación, así como leases vivos.
- Liquidación desconocida conserva la reserva; un gasto conocido superior al reservado se contabiliza y bloquea nuevos consumos.

No es una auditoría exhaustiva ni una certificación de producción. Los dos hallazgos se comunicaron al integrador, quien reparó el producto; el revisor volvió a ejecutar las reproducciones contra esa reparación, sin editar sus fuentes.

## Reparación comprobada: rojo previo → verde actual

| Escenario independiente | Evidencia anterior | Resultado actual |
|---|---|---|
| Revocar al terminar de reservar | Proveedor recibió historial; luego SESSION_REVOKED | `review-reserve-revoke-fixed.json`: proveedor 0, historial no enviado, una liquidación de tokens 0/0, SESSION_REVOKED |
| Cancelar mientras se guarda el borrador | DRAFT guardado sin referencia en checkpoint ni DTO | `review-cancel-draft-fixed.json`: cancelar espera el lock del run; DRAFT vinculado por runId y recuperable en GET/list aunque checkpoint no haya recibido su ID |
| Cancelar después del checkpoint | ID persistido pero DTO sin resultado | `review-cancel-after-checkpoint-fixed.json`: CANCELLED conserva la referencia del DRAFT en GET/list |
| Cancelar antes del guard transaccional | Borde complementario de la misma carrera | `review-cancel-before-guard-fixed.json`: CANCELLED, cero borradores |
| Recuperar lease/deadline vencidos tras preparar | Borde complementario de pérdida de referencia | `review-timeout-draft-fixed.json`: FAILED, DRAFT conservado y recuperable; no se repite el proveedor |

Los cinco comandos terminaron con exit 0. Los cuatro escenarios MySQL también comprobaron que deshabilitar acciones oculta las referencias en GET/list, y que cambiar OWNER a CASHIER bloquea la sesión anterior y no permite al rol nuevo recuperar el run/conversación antiguos. Se comprobó que la propuesta persistida contiene el runId correcto. Esos permisos siguen filtrando las referencias **antes de devolverlas**.

Orden de bloqueo revisado y ejercido: preparar toma User → configuración → Run en la transacción; cancelar no retiene un lock de User mientras actualiza Run. Si cancelar se completa antes de tomar el lock de Run, el guard rechaza la preparación. Si la transacción preparatoria tiene ese lock, cancelar espera su commit y el vínculo persistente permite recuperar el borrador aunque se corte la publicación del resultado. Ambas intercalaciones terminaron sin deadlock en las reproducciones.

La primera repetición MySQL encontró la base descartable apagada por OOM; el integrador recuperó su contenedor y actualizó el wrapper efímero. Esa interrupción de infraestructura no se contabilizó como regresión ni como aprobación. Todas las evidencias verdes anteriores se ejecutaron después de recuperar la base.

Alcance de esta revalidación: funciones reales de orquestación/servicios, transacciones y lecturas MySQL reales, callbacks del proveedor simulados; cero llamadas pagadas y cero movimientos de dinero/inventario. No se encontró otro defecto material concreto dentro del alcance acotado.

## Comandos de reproducción

```sh
mise exec -- node --import tsx reports/review-reserve-revoke.mjs
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs --after-checkpoint
```

Las reproducciones inicialmente esperan observar el defecto. Su aserción debe invertirse al verificar la reparación, conservando la evidencia anterior; no interpretar el fallo de la aserción antigua como un nuevo fallo del producto.

Revalidación independiente actual (aserciones invertidas mediante `--fixed`, evidencia nueva):

```sh
mise exec -- node --import tsx reports/review-reserve-revoke.mjs --fixed
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs --fixed
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs --fixed --after-checkpoint
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs --fixed --before-guard
mise exec -- node reports/with-qa.mjs node --import tsx reports/review-cancel-draft.mjs --fixed --after-checkpoint --timeout
```
