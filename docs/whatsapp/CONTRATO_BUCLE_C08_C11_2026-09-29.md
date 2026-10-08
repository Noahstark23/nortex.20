# Contrato de implementación C08–C11

Noel Pineda aprobó el plan el 2026-09-29. Resultado: recepción por canal, cotizaciones versionadas, atención operativa durable y candidato reconciliado para revisión. La aprobación habilita implementación y QA locales; push, merge, deploy, webhook y nuevos mensajes conservan autorización separada.

## Autoridad y procedencia

Administración: JWT vigente y usuario activo del tenant; soporte: SUPER_ADMIN verificado en DB. Comprador: canal firmado, sin autoridad administrativa. Cálculos deterministas, sin LLM ni cambios de stock/caja. No se indexa este contrato en RAG.

Fuente de trabajo: HEAD `096e25118f8a90855632ab12616c52e33263ce2f`, copia `/private/tmp/nortex-whatsapp-loop-20260929`. Release live verificado `bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4`, copia `/private/tmp/nortex-whatsapp-release-20260929`. Ambas carecen de commit nuevo; sus hashes identifican archivos, no CI remota. Checkout conserva cambios RRHH/MCP ajenos.

## Edición y entrega

- Integrador: webhook/legacy/inbox/conversation, schema y migraciones aditivas, rutas, composiciones, gates y documentación. `reports/whatsapp-loop-20260929/integration-manifest.json` contiene archivos propios integrados por hashes. Schema se actualiza sólo en modelos WaCommerce, conservando cambios concurrentes.
- Agente catálogo: quotes y pruebas Quotes; después nuevo quotationCreate y su prueba exclusivamente en release. Middleware de permisos sigue compuesto por integrador.
- Agente operación: worker/Recovery/CommerceInbox/Experience; después operations, entrypoint del worker y su prueba. QA de migraciones sólo en archivos temporales y DB descartables.
- Agente revisión: lectura independiente; después activationSupport/CommerceSupport/pruebas propias y UI release en QuotationManager/SuperAdmin. Sin edición de schema/server/gates compartidos.
- Integrador de outbox: intentos y nueva prueba; ningún otro agente edita esas rutas al mismo tiempo. Nuevos lotes usan ownership explícito y preservan ediciones ajenas.

Presupuesto externo de esta ejecución: cero llamadas pagadas o mensajes al proveedor. Bases exclusivamente MySQL8 loopback, con credenciales ficticias y reconocimiento disposable-database. No se leen .env, credenciales reales ni datos productivos.

## Recuperación y límites

Inbox antes de ACK; pause conserva propiedad comercial. Cola legacy sigue en memoria y debe drenarse antes de adoptar política. Outbox registra intento antes de red; lease vencido o envío ambiguo mantiene UNKNOWN sin reenvío. Si DB permanece caída tras aceptación, un ID recibido en memoria puede perderse; no se inventa entrega.

Pausa de servicios y conservación de tablas son recuperación operativa; no desviar tráfico comercial a código legacy. Upgrade/restore se prueban con respaldos de fixtures sintéticos; no equivalen a un respaldo productivo restaurado.

Evidencias y estado: `reports/whatsapp-loop-20260929/`. Las pruebas locales no declaran terminado C12–C14. Aún faltan CI del commit exacto, staging, mensaje entrante real y cotización recibida desde Nortex, y aceptación del negocio con tarifa/horario/retención aprobados.
