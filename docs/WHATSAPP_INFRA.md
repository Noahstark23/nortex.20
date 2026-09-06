# Nortex: infraestructura WhatsApp y RAG

Actualizado: 2026-09-04. **Estado: MVP implementado localmente; activación y operación productivas no verificadas.** Ver [auditoría general](AUDITORIA_GENERAL_2026-09-04.md), [plan maestro](PLAN_TRANSFORMACION_TOTAL_2026.md) y [migración](PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md).

## Implementación comprobada

| Pieza | Fuente | Estado y límite |
|---|---|---|
| Webhook y HMAC sobre cuerpo crudo | backend/services/whatsapp/webhook.ts | Responde 200 antes de persistir; pendiente inbox |
| Routing | identity.ts | phone_number_id resuelve tenant en servidor; no autentica al remitente como dueño |
| Vinculación cliente | identity.ts | contains últimos 8 dígitos; insuficiente para datos privados |
| Cola | queue.ts | InMemoryQueue, concurrencia 2; no sobrevive reinicio ni tiene DLQ durable |
| Dedupe y procesamiento | inbound.ts | waMessageId único, pero falta claim/lease concurrente |
| Sender | client.ts / inbound.ts | Envía a Meta antes de commit local; falta outbox/UNKNOWN/conciliación |
| Catálogo | rag.ts | FULLTEXT MySQL parametrizado y filtrado tenant/publicación; fallback acotado con ranking posterior |
| Tools | tools.ts | buscar_producto, consultar_deuda, ventas_hoy; B2B/BOTH filtra por canal, no por identidad personal |
| Cerebros | agent.ts / brain.claude.ts | Menú determinista y Claude opcional; no evals automatizadas del pipeline encontradas |
| Historial | WhatsAppConversation/Message | Clave tenant+waId, sin separación de propósito/canal; revisión de privacidad y retención pendiente |
| Handoff | inbound.ts | Marca HUMAN y calla; falta bandeja, asignación, aviso y atención verificada |
| Canal admin | POST /api/admin/whatsapp/channels | SUPER_ADMIN y token cifrado; falta endurecer validación/reasignación/auditoría |

Archivos abreviados pertenecen a backend/services/whatsapp. La cola/dedupe actuales tienen brechas también con una sola instancia; no esperar a escala horizontal para corregirlas.

## Fronteras que deben mantenerse

El tenant se obtiene del canal; en web, del JWT autenticado. Eso reduce superficie de manipulación del modelo, pero **no garantiza identidad de persona, autorización completa ni inmunidad a prompt injection**. El principal y rol vigentes deben validarse por tool; esa validación privada está pendiente. Una coincidencia parcial de teléfono no autoriza deuda.

Separar: soporte corporativo Nortex a dueños; comercio a compradores; dueño/equipo a sus datos privados. Conversaciones/historial y corpus deben respetar canal, propósito y principal. WhatsApp corporativo no usa automáticamente Customer de un comercio.

Catálogo de productos no es RAG documental. KnowledgeRetriever deberá devolver fuente, versión, vigencia y ACL. Precio, stock vendible, saldo y ventas actuales se consultan mediante el core. El catálogo actual usa Product.stock; al ampliarlo, alinear con el read model de disponibilidad y fechas Managua. No ingerir todos los MD ni tratar una instrucción recuperada como permiso.

## Configuración: nombres, no secretos

El código contempla WHATSAPP_ENABLED, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_API_VERSION, NORTEX_DATA_KEYS y, para LLM, WHATSAPP_LLM, ANTHROPIC_API_KEY y WHATSAPP_LLM_MODEL. Ver config.ts y brain.claude.ts para defaults. No se inspeccionaron valores de entorno ni se certificó la vigencia de una versión de API/modelo. Elegir versiones soportadas y presupuestos al preparar el piloto; nunca copiar secretos a docs o frontend.

## Secuencia de habilitación

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

Antes de cada piloto comprobar [Messaging Policy](https://whatsappbusiness.com/policy/), [Solution Terms](https://www.whatsapp.com/legal/business-solution-terms) y [precios](https://whatsappbusiness.com/products/platform-pricing/). La política de productos regulados exige clasificación particular para farmacias; no activar automáticamente su catálogo. Nicaragua tiene una excepción condicionada de mensajería OTC, no autorización general de comercio regulado. Soporte SaaS a una farmacia es un caso distinto. La tarifa Nicaragua y elegibilidad concreta no se verificaron en esta auditoría.

## Hecho frente a pendiente

Esta actualización es documental. No se envió ningún WhatsApp, no se provisionó Redis/pgvector, no se creó una bandeja ni se corrigió código. El [plan de migración](PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md) mantiene el diseño de inbox/outbox y pgvector condicionado por evaluación; el [plan maestro](PLAN_TRANSFORMACION_TOTAL_2026.md) ordena la ejecución.
