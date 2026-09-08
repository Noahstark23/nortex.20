# Nortex: infraestructura WhatsApp y RAG

Actualizado: 2026-09-05. **Hay dos canales distintos en código local. Ninguno queda acreditado como operativo en producción por este documento.** El agente comercial existente conserva su infraestructura; el nuevo canal privado del equipo vive en `backend/services/assistant/privateWhatsapp/`. Ver [runbook privado](runbooks/assistant-private-whatsapp.md), [plan maestro](PLAN_TRANSFORMACION_TOTAL_2026.md) y [migración comercial](PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md).

## Agente comercial existente: tienda ↔ clientes

| Pieza | Fuente | Estado y límite |
|---|---|---|
| Webhook y HMAC sobre cuerpo crudo | backend/services/whatsapp/webhook.ts | Responde 200 antes de persistir; pendiente inbox |
| Routing | identity.ts | phone_number_id resuelve tenant en servidor; no autentica al remitente como dueño |
| Vinculación cliente | identity.ts | Coincidencia exacta normalizada y única dentro del tenant, revalidada por mensaje; no acredita identidad de empleado |
| Cola | queue.ts | InMemoryQueue, concurrencia 2; no sobrevive reinicio ni tiene DLQ durable |
| Dedupe y procesamiento | inbound.ts | waMessageId único, pero falta claim/lease concurrente |
| Sender | client.ts / inbound.ts | Envía a Meta antes de commit local; falta outbox/UNKNOWN/conciliación |
| Catálogo | rag.ts | FULLTEXT MySQL parametrizado y filtrado tenant/publicación; fallback acotado con ranking posterior |
| Tools | tools.ts | buscar_producto y consultar_deuda; ventas_hoy retirada incluso del lookup. El catálogo siempre exige publicación, también en B2B/BOTH |
| Cerebros | agent.ts / brain.claude.ts | Menú determinista y Claude opcional; no evals automatizadas del pipeline encontradas |
| Historial | WhatsAppConversation/Message | Clave tenant+waId, sin separación de propósito/canal; revisión de privacidad y retención pendiente |
| Handoff | inbound.ts | Marca HUMAN y calla; falta bandeja, asignación, aviso y atención verificada |
| Canal admin | POST /api/admin/whatsapp/channels | SUPER_ADMIN y token cifrado; falta endurecer validación/reasignación/auditoría |

Archivos abreviados pertenecen a backend/services/whatsapp. La cola/dedupe actuales tienen brechas también con una sola instancia; no esperar a escala horizontal para corregirlas.

## Fronteras que deben mantenerse

En el agente comercial, el tenant se obtiene del canal y el remitente se vincula a Customer; en web, el principal proviene del JWT autenticado. El alcance B2B/BOTH nunca concede identidad de personal. La validación de un teléfono de cliente no autoriza herramientas financieras internas.

Separar: soporte corporativo Nortex a dueños; comercio a compradores; dueño/equipo a sus datos privados. Conversaciones/historial y corpus deben respetar canal, propósito y principal. WhatsApp corporativo no usa automáticamente Customer de un comercio.

Catálogo de productos no es RAG documental. KnowledgeRetriever deberá devolver fuente, versión, vigencia y ACL. Precio, stock vendible, saldo y ventas actuales se consultan mediante el core. El catálogo actual usa Product.stock; al ampliarlo, alinear con el read model de disponibilidad y fechas Managua. No ingerir todos los MD ni tratar una instrucción recuperada como permiso.

## Canal privado nuevo: dueño/equipo ↔ Nortex

`assistantPrivateWhatsapp.ts` compone dos routers separados: webhook firmado y rutas de vinculación con JWT. La vinculación exige código aleatorio emitido desde Nortex, hash persistido, caducidad de diez minutos, un solo uso y recepción desde el número personal por webhook firmado. No importa `User.whatsappNumber`, `WhatsappSession`, `WhatsappInboundMessage` ni historial comercial: esas declaraciones antiguas no prueban una vinculación verificada.

El inbox se confirma en MySQL antes de responder 200. Worker con lease durable y orden por remitente, instantánea de usuario/tenant/rol y versión del vínculo; revalida acceso antes de trabajar y antes de guardar la salida. Un remitente desconocido no llega al modelo. El texto usa `sendAssistantMessage`, igual que el panel, con requestId estable. La ayuda, consultas y propuestas conservan los contratos del núcleo; el canal no registra compras ni llama herramientas de confirmación.

Si el núcleo devuelve un run operativo pendiente, el worker conserva la entrada y espera dos segundos entre comprobaciones sin consumir intentos de fallo. Sólo produce una salida al terminar el mismo run, con sus fuentes/período y enlace, o un estado explícito de fallo/cancelación. Reiniciar el transporte no crea otro run ni adelanta el siguiente mensaje. Una conversación vencida o un permiso revocado impiden reutilizar el resultado; nunca se repite automáticamente en otro historial.

Fotos JPEG/PNG y PDF llegan por ID de Meta. La descarga restringe HTTPS, host y ruta de almacenamiento, no sigue redirecciones y corta por tamaño. Se reutilizan almacenamiento privado, validación documental y worker de extracción. Una entrada corresponde a un archivo de factura; no combina álbumes o mensajes distintos por suposición. El PDF puede contener varias páginas dentro de los límites existentes. El enlace devuelve al panel autenticado para completar, revisar y confirmar.

La outbox se crea junto con la finalización de la entrada. Persiste SENDING antes de invocar Meta. Timeout, respuesta perdida o reinicio dejan UNKNOWN; no hay reenvío automático de ese mensaje. Una respuesta posterior puede continuar la conversación, pero no resuelve por sí sola el envío anterior. No se promete entrega exactamente una vez. Las respuestas libres vencen a las 23 horas del evento original, como límite conservador; no se envían plantillas automáticas para ampliar esa ventana.

La retención del transporte es de 30 días. Códigos vencidos se eliminan en lotes; adjuntos no confirmados mantienen siete días y los originales de compras registradas siguen conservados por el módulo documental. La limpieza del transporte nunca elimina compras ni propuestas confirmadas.

## Configuración: nombres, no secretos

El código contempla WHATSAPP_ENABLED, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_API_VERSION, NORTEX_DATA_KEYS y, para LLM, WHATSAPP_LLM, ANTHROPIC_API_KEY y WHATSAPP_LLM_MODEL. Ver config.ts y brain.claude.ts para defaults. No se inspeccionaron valores de entorno ni se certificó la vigencia de una versión de API/modelo. Elegir versiones soportadas y presupuestos al preparar el piloto; nunca copiar secretos a docs o frontend.

## Secuencia pendiente del agente comercial

1. T01: bloquear lecturas privadas sin principal verificado; teléfono exacto, roles, revocación, contexto por canal/propósito y pruebas multi-tenant.
2. T07: persistir inbox firmado antes de ACK; duplicados y DB caída probados.
3. T08: worker con claims/leases y orden por conversación; outbox antes de red, resultado ambiguo UNKNOWN, conciliación, reintentos limitados y DLQ.
4. T09/T10: corpus documental aprobado, ACL/vigencia/citas, evaluación offline con abstención y presupuesto.
5. T11/T12: bandeja humana operable, horarios, consentimiento, opt-out, plantillas, límites de costo y elegibilidad de vertical/producto.
6. Simulación → sombra sin envío → borrador supervisado → piloto consentido → expansión condicionada a métricas.

No ejecutar un runbook de activación directa basado solo en que el webhook responde. Identidad y atención humana son requisitos del primer piloto privado, no una fase opcional posterior. La autorización de envío/despliegue se obtiene para el flujo concreto.

## Verificación mínima y operación

Probar HMAC inválida, remitente desconocido, dos tenants y dos roles, teléfono ambiguo, rol revocado, scope cambiado, mensaje concurrente, crash en cada borde de commit/send, Meta/LLM caídos, presupuesto agotado y mensaje acumulado fuera de ventana. La ventana se calcula desde el evento válido del usuario, no desde la hora de procesar backlog.

Registrar correlationId, tenant/principal/canal, versión de modelo/prompt/corpus/política, fuentes, tools/resultado redactado, costo, latencia y estados. No guardar razonamiento interno ni PII innecesaria. Definir retención y revocación de memoria. Interruptores global/tenant/tool; DLQ y runbook con dueño. No prometer entrega exactamente una vez.

Antes de cada piloto comprobar [Messaging Policy](https://whatsappbusiness.com/policy/), [Solution Terms](https://www.whatsapp.com/legal/business-solution-terms) y [precios](https://whatsappbusiness.com/products/platform-pricing/). No activar automáticamente el catálogo comercial de farmacias por habilitar su asistente interno. La tarifa Nicaragua y la elegibilidad concreta de cada flujo no se verificaron en esta entrega.

## Hecho frente a pendiente

El canal privado tiene implementación y pruebas locales propias, detalladas en su runbook. Esto no corrige el inbox/outbox comercial ni crea una bandeja humana. No se envió ningún WhatsApp real, no se evaluó entrega real de Meta, no se provisionó Redis/pgvector y no se promovió producción. Los dos interruptores privados permanecen apagados por defecto; el [plan de migración](PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md) conserva los pendientes del canal comercial.
