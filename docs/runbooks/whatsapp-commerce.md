# Operación de WhatsApp comercial: cotizaciones

## Alcance entregado

Piloto local para ferreterías, catálogo explícito de artículos publicados sin lotes/series, precio detalle y unidad base. Comprador: buscar → elegir número → cantidad → LISTO. Administración: Proformas → WhatsApp → conversación → revisar → emitir. La política automática aprobada permite emitir directamente al recibir una cantidad válida. Una cotización no reserva stock, cobra ni registra venta.

La bandeja distingue proforma persistida y transporte: pendiente, enviando, aceptado por Meta, entregado, leído, cancelado o incierto. `UNKNOWN` se concilia con evidencia del proveedor; no existe reenvío automático. Si necesita atención, el comprador escribe ASESOR; un operador toma la conversación y queda responsable. BAJA bloquea nuevas respuestas salvo su acuse; ALTA reabre consultas. Adjuntos quedan pendientes para una persona; esta entrega no interpreta audio/fotos.

## Instalación y corte de canal

1. Preparar candidato revisado, respaldo restaurable y migraciones aditivas. `202609290001_whatsapp_commerce` añade tablas; no borra ni cambia dinero/inventario. Generar Prisma6.4.1 con Node22.23.2. La imagen actual ejecuta preflight y `prisma db push` sin `--accept-data-loss`; comprobar DDL aditivo y respaldo real restaurable antes de autorizar su arranque. No sustituir ese mecanismo por un comando manual sin revisar el release.
2. Registrar/verificar el número comercial y token cifrado con el procedimiento administrativo existente. Vincularlo al tenant correcto; no reasignar un canal con historial a otro negocio. No usar el número personal del dueño como identidad de compradores.
3. En Proformas/WhatsApp, revisar SKU elegibles, importe máximo, líneas y vigencia. Guardar pausado. Administración aprueba una versión de la política; iniciar el piloto con cotización supervisada.
4. La recepción verifica firma una vez y enruta por canal. `commerceEnabled=true` o `commercePolicyVersion>0` conserva propiedad comercial aun durante pausa; los canales legacy activos siguen su cola en memoria. Antes de adoptar una política, drenar esa cola: los trabajos legacy ya reclamados no se trasladan al motor comercial. No existe corte global ni retorno automático a legacy al pausar. `WHATSAPP_COMMERCE_ENABLED` controla ejecución del worker, no propiedad de la recepción.
5. Recepción requiere `WHATSAPP_ENABLED=true`, secreto de firma y verify token del proveedor. Worker separado: `npm run whatsapp:commerce-worker`, con `WHATSAPP_COMMERCE_ENABLED=true` y `WHATSAPP_COMMERCE_WORKER_ENABLED=true`. Mantener `WHATSAPP_COMMERCE_SENDING_ENABLED=false` durante simulación/sombra. Son procesos distintos: levantar API no levanta worker.
6. Sólo tras consentimiento, revisión de elegibilidad/tarifa y autorización separada, habilitar envío real y probar un destinatario del piloto. Registrar ID del proveedor y comprobación de recepción; un 200 del webhook no demuestra entrega al comprador.

El canal privado del equipo conserva sus rutas, tablas y flags separados. Este comercio no recibe permisos administrativos por teléfono, no muestra saldos y no llama al LLM.

## Recuperación

- API falla antes de persistir: responde 503, el proveedor puede reentregar. ID repetido con contenido distinto se rechaza.
- Worker cae: el lease vence y se retoma la cabeza de esa conversación. Procesamiento y respuesta se guardan juntos.
- Sender cae o pierde respuesta: SENDING vencido pasa a UNKNOWN. No volver a PENDING ni reenviar la misma fila. La ausencia de recibo no demuestra rechazo. Si no hay ID exacto del proveedor, conservar UNKNOWN hasta obtener evidencia vinculable; la coincidencia de número/hora no lo resuelve.
- Política cambia/baja cliente: pendientes se cancelan o se bloquean antes de enviar. Precio/stock/unidad/régimen se revalidan para proformas.
- Canal/referencia eliminado: salida huérfana se cancela, no bloquea la cola.
- Para pausa: detener envíos y worker, conservar política, tablas y evidencia. Entradas comerciales activas permanecen PENDING; recibos se concilian incluso con el canal desactivado. No resetear commercePolicyVersion ni desviar al legacy. Revertir a una versión que carece de este enrutamiento requiere un corte revisado propio.

Los registros auxiliares aún no tienen purga automática; definir retención/borrado con el negocio antes del piloto real. Horario, turnos de atención, alertas operativas, plantillas fuera de ventana, mayoreo/empaque y campañas quedan fuera del primer recorrido. Una cola HUMAN requiere un operador responsable; no prometer disponibilidad humana 24/7.

## QA reproducible

Base MySQL8 descartable de nombre `nortex_quality_*`, host loopback y `NORTEX_QA_DATABASE_ACK=disposable-database`. Sin credenciales externas. `npm run test:integration:required` exige todas las suites sin skips; incluye transporte, recuperación, políticas, cotización y HTTP comprador→operador. `npm test`, TypeScript, `npm run check:design`, build y mutación son compuertas separadas.

Demo local: `node --import tsx scripts/qa/whatsapp-commerce-demo.mjs` siembra sólo datos ficticios y levanta API loopback3226. Vite puede usar `NORTEX_DEV_API_TARGET=http://127.0.0.1:3226`; envío permanece apagado. El script no es instalador de clientes ni evidencia de producción.


## Entrada asistida para el comercio (C07 local)

El dueño entra en Proformas → WhatsApp, escribe el número del negocio y pulsa **Que Nortex me ayude**. Nortex deriva negocio y solicitante de la sesión; no pide tenant, WABA, cuenta Meta ni claves. Solicitud guardada significa pendiente de conexión y verificación. Puede recuperarse al recargar; repetir el número devuelve la misma solicitud. Otro número no sobrescribe la anterior.

Nortex es responsable de preparar la conexión, revisar elegibilidad del número y guiar la verificación de propiedad que exija el proveedor. El panel SUPER_ADMIN tramita solicitudes con asignación, versión y auditoría: REQUESTED → IN_PROGRESS → WAITING_OWNER o PREPARED; CANCELLED termina el expediente. PREPARED no significa conectado. El signup real sigue pendiente. No pedir al comerciante que copie tokens ni que cambie el webhook. No autorizar migración o pérdida de uso del número existente por este botón.

Antes de activar, Nortex presenta al dueño los productos/precios obtenidos del catálogo y una muestra de respuesta; muestra el precio total del servicio y cualquier consumo separado. Revisión de catálogo, aceptación de condiciones y activación conservan su comprobante propio; pedir ayuda no las acepta. El consentimiento del comprador tampoco se deriva de la solicitud del dueño.

## Responsabilidades y decisiones de operación para el piloto

- Nortex: tramitar conexión/verificación, configurar canal, supervisar API/worker, alertar por fallos/UNKNOWN y conservar evidencia. Los datos comerciales son los del negocio autenticado.
- Dueño: revisar catálogo y oferta, elegir o confirmar persona que atienda los casos transferidos y el horario real. La bandeja ya permite tomar/liberar una conversación; eso no implementa turnos ni cobertura 24/7.
- Operador: tomar la conversación antes de responder, respetar BAJA y ventana. Ante UNKNOWN, revisar ID exacto y recibos del canal/destinatario correcto. No resolverlo por captura aislada ni editar estado a mano.
- Retención: hasta aprobar un plazo concreto y comprobar un mecanismo de redacción, no hay purga automática. El futuro borrado debe preservar claves de deduplicación y hashes, consentimiento/BAJA, política, auditoría y proformas. Pendientes, leases y UNKNOWN sin resolver no se purgan. Esta regla de conservación no acredita cumplimiento legal ni reemplaza la decisión de retención.

Estos son responsables por función y decisiones pendientes, no nombramientos de personas ni horarios inventados. Nortex recoge esas decisiones durante la asistencia, después de mostrar el recorrido y sus condiciones.

## Supervisión y evidencia de envío (C10)

La API y el worker son servicios independientes. El supervisor del ambiente debe ejecutar el comando del worker una sola vez por instancia, reiniciarlo ante fallo, enviar SIGTERM al detener y conservar logs redactados. La configuración del supervisor se prepara para el ambiente de release antes de desplegar; este documento no acredita que ya esté instalado.

El heartbeat durable se publica cada cinco segundos o al cambiar estado; más de treinta segundos sin señal queda STALE. Proformas → WhatsApp → Estado de atención consulta la cola del tenant y la señal del worker. RUNNING describe el proceso, no prueba entrega ni cobertura humana. La falta de DB muestra fallo, nunca cero pendientes. No hay alerta push automática ni calendario de operadores.

Cada claim crea WaCommerceOutboxAttempt en la misma transacción que SENDING. La invocación se registra antes de red; aceptación guarda el ID exacto junto con la salida. Un fallo del primer commit intenta conservar ese ID como UNKNOWN. Si la DB continúa totalmente caída, el ID puede perderse en memoria: la evidencia durable se recupera UNKNOWN y requiere investigación. ACCEPTED/SENT no equivale a DELIVERED. La bandeja muestra intento e ID sin ofrecer un reenvío.

Recuperación: consultar la fila original y sus intentos; correlacionar recibos por ID, tenant, canal y destinatario. Un lease vencido pasa a UNKNOWN de forma atómica. No editar estado a mano, recrear salidas o reenviar para comprobar. La falta de comprobante mantiene la incertidumbre.
