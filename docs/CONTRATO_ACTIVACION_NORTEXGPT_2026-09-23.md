# NortexGPT · contrato de activación inicial

Fecha: 2026-09-23. Candidato aislado desde `dadc81975811850226a6bd7b560a3522068b995a`.
El checkout `codex/caja-nica-retention` y su archivo no rastreado quedan fuera de este lote.

## Resultado y autoridad

- Resultado inicial: ayuda con fuentes aprobadas, consultas deterministas y conversación con Haiku para un negocio piloto identificado, con rol vigente y límite de US$2 por mes. El asistente conserva el trabajo ante fallos y no confirma dinero ni inventario.
- Cierre observable: mismo SHA en CI, staging y producción; worker supervisado con estado verificable; presupuesto, rol y contenido aprobados; recorrido autenticado de datos sintéticos y del piloto con respuesta real, fuente y consumo atribuidos; parada y recuperación probadas.
- Fuera del primer corte: extracción foto/PDF, confirmación de acciones, promociones y WhatsApp privado. Su activación exige almacenamiento privado con backup/restore conjunto, pruebas y aprobación propios.
- Responsable de producto, negocio y cuenta piloto: pendiente de identificación por el dueño. La aprobación H01 A/B/C no aprueba artículos completos ni expected del modelo.
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
| Observación de release existente | 31 muestras durante 30 minutos, SHA y base exactos | Nueva corrida iniciada; pendiente de completar |
| Worker e infraestructura | Misma versión que API, un consumidor, permisos y heartbeat; pausa/reinicio sin duplicar | Pendiente |
| Contenido y expected | Versiones completas y casos revisados por persona | Pendiente |
| Modelo y presupuesto | Llamada sintética real, reserva/settlement y tope comprobados | Pendiente |
| Piloto web | Rol real, fuentes, cifras, carrito, revocación y recuperación | Pendiente de negocio/cuenta |
| CI, staging y producción | SHA idéntico y smoke por ambiente | Pendiente para este candidato |

La evidencia de cada compuerta conserva escenario, SHA, resultado y límites. Un total de tests no sustituye la prueba operativa ni la aceptación humana.
