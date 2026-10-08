# Plan de ejecución en bucle: WhatsApp → catálogo → cotización

Fecha: 2026-09-29. Programa: WhatsApp comercial, continuación C08–C14.
Solicitante y responsable de producto: Noel Pineda. Integrador: Codex.
Estado: aprobado por Noel; C08–C10 implementados y verificados localmente. C11 verificado localmente sobre base de release; CI remota pendiente; C12–C14 pendientes de sus puertas externas. Contrato: [C08–C11](CONTRATO_BUCLE_C08_C11_2026-09-29.md).

## Resultado que buscamos

Un comprador escribe al emisor autorizado, encuentra un producto publicado del
negocio, indica una cantidad y recibe una cotización calculada por Nortex. La
administración puede revisarla y atender excepciones. Cada evento, propuesta y
resultado de transporte conserva evidencia recuperable después de reinicios.

Primera versión: ferretería, búsqueda guiada, precio detalle y unidad base,
cotización supervisada. No reserva existencias, cobra ni registra ventas.
La autonomía para emitir se habilita después mediante una política aprobada.
Mayoreo, empaques, promociones, listas libres, audio/fotos, farmacia y campañas
requieren sus propios contratos y pruebas posteriores.

## Punto de partida comprobado

- Meta: app «Nortex Atención» y espacio «Nortex» creados; emisor de prueba
  +1 555 181 3093. Destinatario de Nortex terminado en 4030 verificado.
- Meta confirmó un envío `hello_world`; Noel confirmó que recibió la bienvenida.
  [Evidencia](../../reports/whatsapp-real-connection-20260929/preparacion.json).
  No se obtuvo ID del mensaje ni recibo técnico de entrega.
- Ese envío ocurrió en Meta. No pasó por webhook, worker ni cotizador de Nortex.
  El número 4030 es destinatario; no está autorizado migrarlo o registrarlo como
  emisor por haber recibido el saludo.
- C01–C07 tienen implementación y QA local documentadas en
  [entrega](ENTREGA_Y_QA_2026-09-29.md) y
  [entrada asistida](ENTRADA_ASISTIDA_Y_OPERACION_2026-09-29.md).
  Sus resultados históricos no certifican un candidato nuevo.
- Checkout actual: `codex/caja-nica-retention`, con cambios de WhatsApp, RRHH y MCP.
  Preservar rama, índice y archivos ajenos. Congelar hashes antes de editar.
- `backend/services/whatsapp/webhook.ts` selecciona el handler por flag global.
  Corregir este diseño antes de habilitar comercio: el corte puede dejar canales
  existentes sin atención. La lectura estática identifica el riesgo; C08 debe
  reproducirlo mediante una prueba del producto.

## Cómo se ejecuta el bucle

Para cada fase: **inspeccionar → reproducir → implementar → probar → corregir →
revisar → guardar evidencia → avanzar**.

1. Registrar candidato/base, hashes, alcance y prueba de salida antes de editar.
   Trabajar en copia aislada; no cambiar ramas o worktrees sin autorización.
2. Escribir primero una prueba que detecte el fallo o la capacidad pendiente.
3. Implementar únicamente el lote asignado. Un archivo compartido tiene un editor.
4. Ejecutar la prueba del escenario y las regresiones afectadas. Si falla,
   corregir la causa conservando el mismo criterio de aceptación.
5. Tras tres intentos sin avance sobre el mismo fallo, cambiar el diagnóstico y
   registrar evidencia; no repetir comandos idénticos ni debilitar las pruebas.
6. Si hay bloqueo externo, guardar un checkpoint, continuar los lotes
   independientes y solicitar sólo la decisión o acción humana necesaria.
7. Una fase termina con resultado verificable y manifiesto. Si no pasa su
   condición, permanece pendiente; las etapas dependientes no avanzan.

Este bucle de ingeniería no crea un monitor permanente ni un proceso de IA sin
límite. Los runs del producto mantienen cuatro iteraciones/60 segundos como
máximo; esperas no consumen IA. No se habilitan llamadas pagadas en este plan.
Las pruebas locales usan datos ficticios y proveedores simulados.

## Fases y puertas de salida

| Fase | Trabajo | Prueba obligatoria de salida |
|---|---|---|
| C08 — recepción por canal | Verificar firma una vez, resolver canal e identidad y seleccionar comercio/legacy sin caída silenciosa. Pausar comercio no lo deriva automáticamente al motor anterior. Definir ACK/reintento para callbacks mixtos. | Dos canales y dos tenants; comercio activo/pausado y legacy; callback mixto; fallo DB; reentrega; ninguna pérdida o doble procesamiento comercial. Registrar los límites de la cola legacy en memoria. |
| C09 — catálogo y proforma | Reconstruir búsqueda → elección → cantidad → LISTO → revisión → emisión desde los servicios existentes. Validar precio/unidad/impuesto y vigencia al emitir. | HTTP + MySQL reales; productos ajenos/ocultos, cantidades inválidas, cambio de precio, versiones concurrentes. Una sola proforma; dinero y stock sin movimientos. |
| C10 — operación durable | Supervisión del worker, heartbeat, cola atrasada y excepciones. Evidencia de intento/recibo, pausa y recuperación. Vista para tramitar solicitudes asistidas con autoridad restringida. | Reinicio API/worker; lease vencido; caída antes/después de enviar; UNKNOWN no se reenvía; BAJA cancela pendientes; operador asignado antes de responder. Estado persistido y recuperable. |
| C11 — candidato de release | Reconciliar cambios de WhatsApp con la base de release vigente conservando avances de otros módulos y controles más fuertes. Preparar migración y restauración. | Diff y SHA exactos; Prisma, TypeScript, Vitest, diseño, build; integración requerida sin skips; mutación si cambia lógica monetaria; upgrade y restore MySQL 8. CI identifica ese mismo SHA cuando push/CI estén autorizados. |
| C12 — conexión a Nortex en staging | Preparar integración del canal con credenciales administradas, endpoint HTTPS, firma, suscripción, API y worker. Comprobar requisitos actuales de publicación/permisos de Meta antes de cambiar la app. | Evento entrante real persistido antes del ACK; respuesta sale desde outbox; ID Meta ligado al intento y proforma. Staging sirve el mismo SHA revisado. Requiere autorización separada para despliegue, webhook y envíos del ensayo. |
| C13 — ensayo completo | Un tenant de piloto identificado desde sesión, catálogo elegible revisado y destinatario consentido. Comprador consulta; administrador revisa; cotización se envía y recibe. | Cadena mensaje entrante → inbox → borrador/proforma → outbox → ID Meta → entrega técnica o confirmación humana identificada. ASESOR, BAJA y recuperación también comprobados; registrar cada límite de evidencia. |
| C14 — primer piloto comercial | Mostrar al dueño muestra de catálogo/respuesta, precio del servicio y consumo separado. Acordar persona/horario, retención, canal y volumen. Activar un negocio primero con modo supervisado. | Aceptación del negocio, autorización productiva del SHA exacto, backup restaurable, health y smoke; responsable de excepciones y prueba de pausa. Piloto cerrado con resultados y pendientes, sin extrapolar a todos los clientes. |

Dependencias: C08 → C09 → C11 → C12 → C13 → C14. C10 puede avanzar en
paralelo con C09, pero ambos deben estar comprobados antes de C12.

## Contrato, permisos y responsabilidad de edición

La fuente de tenant/actor/rol es JWT vigente para administración; el canal
verificado determina el negocio receptor. Un teléfono de comprador no concede
permisos administrativos. Separo canal privado del equipo y atención comercial.
Precios, cantidades, impuesto y totales salen de servicios deterministas;
RAG sólo sirve ayuda aprobada y no indexa este plan.

| Responsable funcional | Archivos permitidos al iniciar su lote | Entrega |
|---|---|---|
| Integrador Codex | `backend/services/whatsapp/webhook.ts`, `legacyWebhook.ts`, `commerce/inbox.ts`, `tests/whatsappCommerceWebhook.test.ts` | C08 y contrato de recepción; ningún otro editor modifica estos archivos. |
| Catálogo/cotización, por asignar antes de delegar | `commerce/quotes.ts`, `commerce/conversation.ts`, pruebas `whatsappCommerceQuotes*` y `whatsappCommerceFlow.integration.test.ts` | C09 y evidencia determinista. |
| Operación/UX, por asignar antes de delegar | `commerce/worker.ts`, `commerce/outbox.ts`, `backend/workers/whatsappCommerce.ts`, `components/whatsapp/CommerceInbox.tsx`, pruebas `whatsappCommerceRecovery.mysql.test.ts` y `whatsappCommerceExperience.test.tsx` | C10; lista adicional exacta antes de crear módulos nuevos. |
| Revisor independiente, por asignar | Lectura del diff, contratos y evidencia; sin edición | Hallazgos reproducibles, criticidad y escenarios faltantes. |

Los prefijos `commerce/` de la tabla se resuelven bajo
`backend/services/whatsapp/commerce/`. Schema, migraciones, server, rutas,
dependencias y CI son del integrador único; cualquier ampliación se registra
antes de editar. Nunca modificar los archivos RRHH/MCP por pertenecer al mismo
checkout. No se necesitan agentes para sostener esperas del proveedor.

Si se delega, cada agente recibe objetivo, archivos exactos, contrato, criterio,
límites y la instrucción de preservar los cambios de otros. Integrar por hashes,
no reemplazar una guía o módulo completo con una copia antigua.

## Reintento, recuperación y evidencia

- Inbox: identidad del proveedor + canal; payload canónico y hash. Commit antes
  de ACK. Repetición exacta conserva resultado; conflicto no crea otra propuesta.
- Proforma: propuesta/versionado/idempotencia persistentes. Cambiar precio,
  política o contenido invalida revisión previa. El modelo nunca confirma.
- Outbox: intento durable; envío fuera de transacción. Una respuesta ambigua
  queda UNKNOWN; no recrear el intento ni resolverlo por número/hora aproximada.
- Pausa: bloquear nuevos envíos comerciales, conservar eventos y propuestas,
  atender excepciones; no arrancar dos motores sobre el mismo tráfico.
- Borrado/retención: presentar un plazo concreto para aprobación; comprobar
  redacción y recuperación antes de automatizar purga. Conservar dedupe, BAJA,
  auditoría/proformas y pendientes/UNKNOWN hasta resolución válida.
- Cada fase guarda base/SHA o hashes de candidato, diff, escenarios, resultados,
  omisiones y siguiente paso en `reports/whatsapp-loop-20260929/`.
- Los estados son pendiente, en ejecución, defecto reproducido, verificado local,
  verificado staging, recibido real, aceptado por negocio y desplegado. Nunca
  sustituir uno con otro. El reporte conserva actor, canal, política y correlación;
  excluye secretos y razonamiento interno.

## Decisiones externas, sólo al llegar a su puerta

El trabajo local continúa con la autorización de implementación ya otorgada.
`AGENTS.md` exige autorización explícita y separada para push/merge/despliegue,
webhook y nuevos mensajes externos. El saludo ya autorizado no cubre una campaña
ni los mensajes del ensayo de cotización. Preparar el candidato y el resumen
concreto antes de pedir esas aprobaciones.

Credenciales en almacén administrado; no copiar tokens del navegador a archivos,
fixtures, logs o chat. El token usado en la prueba no se presume apto para operar
producción. Meta puede exigir publicación/verificación/otros permisos; verificar
el flujo vigente y presentar exactamente cualquier aceptación adicional.

Pendientes de negocio: tenant comercial, catálogo/SKU permitidos, tarifa, canal
emisor, responsable/horario, plazo de retención y volumen del piloto. Nortex los
obtiene durante asistencia con una pantalla de revisión; no pedir al dueño IDs
Meta, secretos o una lista técnica. Noel es responsable de Nortex; no inferir que
atiende todos los negocios.

## Métricas y cierre de misión

Cero fugas entre tenants, cotizaciones duplicadas, movimientos de caja/stock
por cotizar y reenvíos de UNKNOWN. Todo escenario obligatorio pasa sin omisiones.
El comprador recibe una cotización cuya propuesta, versión, precio y evidencia
de envío/recepción pueden reconstruirse desde Nortex.

Antes del piloto, acordar umbrales de latencia, costo, volumen y corrección humana.
Medir mensajes aceptados/entregados, errores, antigüedad de cola, UNKNOWN,
transferencias a persona, borradores corregidos y gasto atribuido. Comparar tiempo
de cotización manual y asistida; medir conversión cuando haya muestra suficiente.
No declarar ahorro, autonomía o rentabilidad sin resultados medidos.

La misión comercial termina cuando C14 tiene evidencia y aceptación del negocio.
Una bienvenida, pruebas verdes o una pantalla lista no cierran esa misión.

**Próximo paso: autorización separada para publicar el candidato exacto, abrir PR borrador y ejecutar CI. Después, C12 requiere su autorización de despliegue y conexión.**
