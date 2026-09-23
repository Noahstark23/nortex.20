# NortexGPT · contrato de activación inicial

Fecha: 2026-09-23. Candidato aislado desde `dadc81975811850226a6bd7b560a3522068b995a`.
El checkout `codex/caja-nica-retention` y su archivo no rastreado quedan fuera de este lote.

## Resultado y autoridad

- Resultado inicial: ayuda con fuentes aprobadas, consultas deterministas y conversación con Haiku para un negocio piloto identificado, con rol vigente y límite de US$2 por mes. El asistente conserva el trabajo ante fallos y no confirma dinero ni inventario.
- Cierre observable: mismo SHA en CI, staging y producción; worker supervisado con estado verificable; presupuesto, rol y contenido aprobados; recorrido autenticado de datos sintéticos y del piloto con respuesta real, fuente y consumo atribuidos; parada y recuperación probadas.
- Fuera del primer corte: extracción foto/PDF, confirmación de acciones, promociones y WhatsApp privado. Su activación exige almacenamiento privado con backup/restore conjunto, pruebas y aprobación propios.
- Responsable de producto y cuentas propuestas: el dueño designó su cuenta para el primer piloto y la cuenta de 3M Ferretería para un segundo piloto. Confirmó que el responsable de 3M aceptó el piloto y el uso de un modelo externo con límite inicial de US$2 al mes. Los correos quedaron sólo en la conversación de trabajo, no en este repositorio. Antes de cada activación, comprobar el usuario activo, su `tenantId` y rol desde una sesión autenticada o una consulta administrativa controlada; no inferir el negocio por el correo. La aprobación H01 A/B/C no aprueba artículos completos ni expected del modelo.
- Canal: web interna autenticada. Tenant, usuario y rol salen del JWT y se revalidan; el modelo no recibe autoridad de confirmación.
- Efectos: lectura, conversación, estado auxiliar y propuesta. Todo movimiento de dinero/stock sigue en los servicios de dominio con confirmación humana exacta.

## Fuentes y límites

- Las cifras provienen de herramientas de dominio con corte explícito en Managua; la ayuda proviene únicamente de versiones publicadas y vigentes. Mensajes y documentos del usuario son evidencia atribuida.
- Un dato desconocido no se reemplaza con cero. Los artículos D02 pendientes no se publican por habilitar el asistente.
- Un run conserva versión, identidad idempotente, límite de cuatro iteraciones/60 segundos y reserva de gasto antes de llamar al proveedor. Respuesta incierta conserva la reserva.
- Política: US$2 iniciales por negocio/mes, aumento aprobado hasta US$10 y techo conjunto US$20; sin incremento ni cobro automático.
- Retención y recuperación: el worker ejecuta limpieza incluso con capacidades apagadas y debe detenerse físicamente durante restore; conversación, jobs y propuestas vencidos siguen el código vigente. Los originales de compras confirmadas requieren recuperación conjunta antes de habilitar adjuntos.

## Responsabilidad de edición

| Responsable | Archivos permitidos | Contrato |
|---|---|---|
| Codex principal | `docker-compose.yml`, `backend/workers/assistant.ts`, `backend/services/assistant/operations/{workerCycle,workerHeartbeat,healthStatus}.ts`, pruebas correspondientes, `docs/runbooks/{nortexgpt-evaluacion-haiku,nortexgpt-activation-first-cut}.md` y este contrato | Arranque explícito, estado del worker, QA y procedimiento del primer corte |

No se delegó edición. `backend/server.ts`, `components/POS.tsx`, schema y flujos monetarios quedan fuera de este lote. Si otro trabajo modifica los archivos anteriores, se reconcilia antes de integrar.

## Compuertas

| Comprobación | Criterio | Estado |
|---|---|---|
| Observación de release existente | 31 muestras durante 30 minutos, SHA y base exactos | Cumplida para el release anterior `dadc819`: 31/31 entre 14:07:05 y 14:37:05 UTC, HTTP 200, `ok`, base arriba, SHA exacto y `no-store`. Evidencia local: `/private/tmp/nortexgpt-activation.fHY9Xs/observation.json` |
| Worker e infraestructura | Misma versión que API, un consumidor, permisos y heartbeat; pausa/reinicio sin duplicar | Parcial en Docker local sintético para `2e6b217`: app y base sanas, worker único arrancó y reinició, la app leyó latido del mismo SHA con permiso 0600. Estado `disabled` esperado con flags apagados. No prueba staging, producción, colas activas ni recuperación de originales |
| Contenido y expected | Versiones completas y casos revisados por persona | Pendiente |
| Modelo y presupuesto | Llamada sintética real, reserva/settlement y tope comprobados | Pendiente |
| Piloto web | Rol real, fuentes, cifras, carrito, revocación y recuperación | Pendiente de negocio/cuenta |
| CI, staging y producción | SHA idéntico y smoke por ambiente | Pendiente para este candidato |

La evidencia de cada compuerta conserva escenario, SHA, resultado y límites. Un total de tests no sustituye la prueba operativa ni la aceptación humana.

## Secuencia del piloto

1. Ejecutar primero el recorrido sintético completo: fuentes revisadas, respuesta real del modelo, costo atribuido, revocación, error y conservación del trabajo. Mantener ejecución, adjuntos y envíos apagados.
2. Verificar la identidad y el negocio de la cuenta del dueño; habilitar sólo ayuda, conversación y consultas permitidas con presupuesto inicial de US$2. Comprobar respuesta, cita, período, rol y saldo con esa cuenta; detener la capacidad ante un estado incierto.
3. Verificar la cuenta, negocio y rol de 3M Ferretería y repetir las mismas pruebas y el límite propio de US$2. No usar datos del primer negocio para validar el segundo.
4. Registrar por separado para ambos negocios el SHA, permisos, contenido publicado, configuración, consumo, comprobante de la prueba y resultado humano. Desactivar cada piloto individualmente si falla una compuerta.

## QA local del candidato `2e6b217`

- Compuerta local segura: TypeScript, sistema de diseño y build aprobados; 490 archivos/7082 tests aprobados. Otros 50 archivos/545 tests quedaron omitidos y no cuentan como aprobados. Pruebas dirigidas del worker, latido y estado: 25/25 aprobadas.
- `docker compose config` validó el perfil; sin él, `assistant-worker` no figura entre servicios activos. La imagen del worker construyó con Node 22.23.2 y dependencias de producción; auditoría de dependencias de producción: cero vulnerabilidades reportadas.
- Prueba de integración local: proyecto aislado `nortexgpt-activation-qa`, credenciales sintéticas, Anthropic vacío y asistente global apagado. Tras reiniciar el worker, latido observado desde la app a las 16:00:24 UTC con `state=disabled`, SHA exacto y modo 0600. El proyecto y ambos volúmenes sintéticos se eliminaron al terminar.
- Este QA no realizó una llamada al proveedor, no aceptó artículos de ayuda, no ejecutó una acción de dinero o stock y no habilitó a ningún negocio real.
