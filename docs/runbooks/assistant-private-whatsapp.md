# Canal privado WhatsApp de NortexGPT

Estado: implementación local del candidato `nortexgpt-operativo-20260905`. Separado del agente que atiende clientes. No hay activación, envío real, piloto ni despliegue acreditados.

## Contrato de operación

1. Con la sesión propia de Nortex, emitir código mediante `POST /api/assistant/private-whatsapp/challenge {}`. El servidor revalida usuario activo, rol y habilitación por negocio. Máximo cinco códigos en diez minutos; emitir otro vence el anterior. No guardar el código en logs, analítica o almacenamiento del navegador.
2. Enviar `VINCULAR <código>` desde el WhatsApp personal al número privado configurado. La combinación de sesión autenticada y webhook firmado vincula el remitente; el código dura diez minutos y sólo se almacena su hash. El número ocupado por otro usuario requiere revisión administrativa, incluso si está revocado; no se transfiere historial.
3. `GET /binding` devuelve estado, últimos cuatro dígitos y fecha. `DELETE /binding {}` revoca el vínculo y los códigos pendientes y cancela salidas aún no invocadas. Desvincular sigue disponible con el canal pausado. Cambiar rol o deshabilitar al usuario impide procesar entradas, recuperar datos y enviar salidas con el alcance anterior.
4. Cada texto entra a la misma conversación privada del núcleo mediante requestId estable. Si crea un run operativo, el inbox espera su resultado persistido antes de producir una sola respuesta. Conserva texto, fuentes, período y enlace; un fallo, cancelación o respuesta incompleta se comunica como tal. El modelo nunca recibe una herramienta de confirmación del canal. Los enlaces `assistantConversation` y `assistantExtraction` exigen la sesión de Nortex; el identificador no concede acceso.
5. Un archivo por mensaje: JPEG/PNG o PDF. El descargador resuelve un ID de Meta, restringe destino y tamaño y no sigue redirecciones. El worker documental conserva 10 MB, 10 páginas/imágenes y 200 renglones. La descarga no acredita la calidad de extracción. Registrar sigue requiriendo revisar proveedor, productos, recepción, pago, unidades e importes.

## Configuración, sin valores secretos

- `NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED`: interruptor global, apagado por defecto. También requiere `AssistantTenantConfig.privateWhatsappEnabled` y el asistente del negocio habilitado.
- `NORTEX_PRIVATE_WA_SENDING_ENABLED`: permite invocar Meta, apagado por defecto. Los tests usan un sender inyectado.
- `NORTEX_PRIVATE_WA_PHONE_NUMBER_ID`, `NORTEX_PRIVATE_WA_APP_SECRET`, `NORTEX_PRIVATE_WA_VERIFY_TOKEN`, `NORTEX_PRIVATE_WA_ACCESS_TOKEN`: configuración independiente del comercial. No mostrarlos en endpoints ni logs.
- `NORTEX_PRIVATE_WA_API_VERSION`: versión explícita del Graph API. Verificar soporte antes de un piloto; el adaptador no decide ni actualiza versiones automáticamente.
- `NORTEX_PRIVATE_WA_DISPLAY_PHONE`: número público opcional en E.164 con `+`, para mostrar dónde enviar el código; no es el ID interno de Meta.
- `NORTEX_PRIVATE_WA_APP_ORIGIN`: origen HTTPS del panel, sin credenciales, ruta, query ni fragmento. Nunca se obtiene del encabezado Host o de texto recibido.
- El directorio privado de adjuntos y el presupuesto de IA son los del asistente interno. No se crea otro proveedor o bolsa de presupuesto. Los cargos de mensajería Meta y su elegibilidad necesitan evaluación separada antes del piloto.

Componer `buildAssistantPrivateWhatsappWebhookRouter` bajo `/api/assistant-private-whatsapp` antes del parser JSON: `GET/POST /webhook`. El POST valida HMAC sobre el cuerpo crudo, persiste primero y sólo entonces responde 200. Cuerpo máximo 256 KB y 100 eventos. Componer `buildAssistantPrivateWhatsappRouter` bajo `/api/assistant/private-whatsapp` con JWT. Worker: `backend/workers/assistantPrivateWhatsapp.ts`, mismo repositorio y cliente Prisma compartido.

## Reintentos y resultados inciertos

- Inbox: ID de proveedor único y contenido inmutable; claims con lease de cinco minutos, máximo tres intentos y backoff acotado. La secuencia de inserción en MySQL conserva orden aun con timestamps iguales. El primer mensaje pendiente vigente del remitente debe terminar antes de procesar el siguiente; una cabeza expirada no bloquea la conversación. La búsqueda selecciona cabezas elegibles para no dejar otros remitentes detrás de seguidores bloqueados.
- El core recibe el UUID persistido del inbox. Si la respuesta quedó guardada antes de un reinicio, su replay no duplica mensajes. La extracción también usa ese UUID para no crear otro job tras un reinicio.
- Un run PENDING se entrega al procesador del núcleo, que lo reclama una sola vez. RUNNING vivo deja el inbox PENDING con espera de dos segundos y sin consumir un intento de fallo; conserva el orden del remitente. Un run abandonado se recupera como interrumpido, nunca reiniciando herramientas. El identificador del run vive en el mensaje idempotente, sin otra cola de modelos. La autorización se comprueba antes de resolver y antes de publicar la salida. Si vence la conversación durante la espera o un reintento, no se repite la consulta en una conversación nueva.
- Outbox: PENDING → SENDING antes de invocar red. Un resultado comprobable pasa a SENT. Si la respuesta es incierta, pasa a UNKNOWN; un SENDING cuyo lease venció también pasa a UNKNOWN. Nunca volverlo a PENDING manualmente como recuperación ordinaria.
- `GET /deliveries` devuelve las últimas veinte referencias y estados propios, sin contenido. UNKNOWN significa que no está comprobado si llegó. Consultar el destinatario y la evidencia de Meta antes de cualquier intervención. La aplicación no tiene una acción de reenvío de salidas inciertas.
- La ventana de respuesta se calcula con el timestamp del evento, no con el procesamiento tardío. El límite local es de 23 horas y el transporte sólo manda texto libre dentro de esa ventana; no envía plantillas ni inicia seguimientos.
- Detener envíos no deshace uno que Meta ya aceptó. Una revocación no puede retirar mensajes del dispositivo del destinatario. El control se comprueba antes de cada invocación y al acceder al núcleo.

## Retención y revisión

La limpieza recorre como máximo cien filas por categoría y pasada. Conserva entradas hasta retirar sus salidas; no borra un lease vivo. Los cuerpos del transporte se retienen treinta días. Los códigos expirados se limpian después de un día. Vínculos revocados se conservan para impedir transferir un teléfono por suposición. No se reutilizan las tablas privadas antiguas del schema ni el historial comercial.

El respaldo/restauración debe incluir las tablas AssistantWa y el almacenamiento privado de adjuntos; un respaldo sólo de MySQL no recupera los originales. Restaurar con el canal y los envíos apagados, recuperar SENDING como UNKNOWN y verificar aislamiento antes de abrir workers. Un restore nunca debe ejecutar o reenviar automáticamente operaciones.

## Evidencia y límites

Ejecución local inicial del 2026-09-05: **50/50 casos aprobados, cero omitidos**, en [reporte dirigido](../../reports/private-wa-tests.json): 19 pruebas privadas deterministas, 14 de MySQL/HTTP y 17 de regresión del worker documental. Se reprodujeron antes de reparar tres fallos de orden: cabeza vencida, seguidores que ocultaban otro remitente y empate de timestamp con UUID en orden inverso. La ampliación de espera operativa se verifica en [reporte de canal y corpus](../../reports/private-wa-operational-tests.json), con 20 pruebas privadas deterministas, 18 MySQL/HTTP y 124 del corpus: **162/162, cero omitidos**. Ninguno de esos resultados acredita entrega real de Meta ni despliegue.

- `tests/assistantPrivateWhatsapp.test.ts`: funciones reales de HMAC/inbox, ACK posterior al commit, rechazo del canal ajeno, hash sin código crudo, orden, rutas de medios/SSRF, tamaño, sender apagado, recuperación UNKNOWN y retención acotada. MySQL/proveedor simulados donde corresponde.
- `tests/assistantPrivateWhatsapp.integration.test.ts`: MySQL 8 descartable y HTTP local con JWT/HMAC; código de un uso, vencimiento, rol revocado, teléfono ocupado por otro negocio, diez entregas concurrentes, leases/reinicio, salida incierta, replay del core y extracción con ID estable. Ninguna llamada pagada ni envío Meta; un espía rechaza red externa.
- Espera operativa: run real persistido, proveedor/orquestador inyectado, reinicio de la instancia del worker mientras está RUNNING, una sola invocación simulada, un run y una salida; no adelanta el siguiente mensaje ni gasta intentos por esperar. Revocar antes o después de resolver impide publicar datos. Vencer la conversación no crea otra ejecución.
- La compuerta exige activar la suite de integración. Un `skip` no cuenta como aprobado. Configuración, reintentos, borrados y respuestas se verifican únicamente contra datos sintéticos.
- La suite acepta el interruptor canónico `NORTEX_MYSQL_INTEGRATION=1` y conserva compatibilidad con `true` para los runners locales anteriores.
- Pendiente antes de piloto: proveedor real, conexión del número aprobado, políticas/precios vigentes, recepción de fotos reales, límites de ventana efectivos, proceso administrativo para cambio de teléfono, observación y prueba de restauración de todo el candidato.

Referencia del adaptador de medios: [colección oficial de Meta, Retrieve Media URL](https://www.postman.com/meta/whatsapp-business-platform/request/ptjyi84/retrieve-media-url) y [Download Media](https://www.postman.com/meta/whatsapp-business-platform/request/zsq66eh/download-media). La aplicación sólo admite la ruta HTTPS de adjuntos de `lookaside.fbsbx.com`; otro host requiere revisión explícita del adaptador y sus pruebas, no una descarga genérica.
