# Onboarding y retención de Nortex

Actualizado 2026-09-04 sobre código local; no se verificó experiencia productiva ni analítica privada. Se integra al [plan de transformación](PLAN_TRANSFORMACION_TOTAL_2026.md) y a su [auditoría](AUDITORIA_GENERAL_2026-09-04.md).

## Situación y objetivo

El fundador reporta 45 personas registradas y 3 habituales en ferreterías/farmacias. No hay denominadores por comercio/cohorte ni pagos confirmados. No conocemos por qué otros dejaron de usarlo; no atribuirlo de antemano a precio, errores o falta de capacitación.

Objetivo: que un comercio complete su primera venta real, vuelva a operar y pueda pagar una suscripción con valor claro. Investigar con los 3 habituales y 5–8 inactivos antes de rehacer flujos completos.

## Qué existe en el checkout

| Capacidad | Evidencia local | Qué todavía hay que probar |
|---|---|---|
| Trial de 30 días y precio presentado $20/mes | server.ts alta, Billing.tsx, landing | Medios de cobro reales, conciliación y renovación |
| Teléfono, bienvenida y lifecycle por correo | registro, email/lifecycle services | Entrega efectiva, consentimiento, frecuencia y recuperación |
| Checklist retail | GET /api/onboarding: tres hitos base con pasos opcionales por capacidades | Comprensión, progreso actualizado tras venta y fallos recuperables |
| Mi Negocio orientado a vender | components/MiNegocio.tsx | Retorno y continuidad entre dispositivos |
| Navegación por giro/rol | utils/navigation.ts y Layout | Menús tienen 9–11 rutas antes de rol; medir carga cognitiva |
| Ayuda y tours | HelpCenter.tsx, utils/tours.ts | Instrucciones vigentes, invitación al equipo y tarea realmente completada |
| Lista de cuentas dormidas/export/contacto | admin tenants y SuperAdmin | Identificar personas autorizadas a contactar y registrar resultado |

Estas piezas ya existen; no reabrir un trabajo terminado solo porque una auditoría vieja lo propone. Los eventos frontend no garantizan métricas durables de negocio.

## Recorrido de primera sesión a validar

1. Identificar giro y tarea inmediata; mostrar un siguiente paso concreto.
2. Cargar/importar un producto con unidad, precio y existencia comprensibles. Validar datos y explicar errores sin perder el formulario.
3. Abrir caja según rol, realizar una venta y cobrar con vuelto claro; comprobante coherente con datos reales.
4. Ver resultado y siguiente acción; volver al día siguiente con sesión, búsqueda y ayuda accesibles.
5. Validar pago de suscripción en semanas 2–4 y renovación cuando corresponda; distinguir prueba de pago de cobro real conciliado.

Ferretería: búsqueda, unidades/empaques, mayoreo y fiado según necesidad observada. Farmacia: lote, vencimiento y vendibilidad antes de dar por válida una venta. No usar un modo demo que registre inventario/dinero ficticio en libros reales. La configuración fiscal necesaria depende del caso y no se omite por simplificar onboarding.

## Instrumentación

Registro calificado, producto creado/importación completada, intento de venta, venta confirmada server-side, error clasificado, segunda sesión con venta, cierre, ayuda, trial vencido y pago confirmado. IDs internos, dedupe y exclusión de pruebas; sin PII en analítica pública.

- Activación D1/D7: primera venta real confirmada desde alta; mostrar no activados y denominador maduro.
- Tiempo a primera venta: mediana/p75 y proporción que nunca llegó; evitar sesgo de mirar solo quienes terminaron.
- Uso de valor semanal: venta en ≥3 días distintos, como definición inicial a validar con la frecuencia natural del segmento.
- Retención semana 4: volver a vender en días 22–28 desde primera venta; denominador con ≥28 días. Nuevos y reactivados separados.
- Pago: suscripción conciliada y renovación; login no equivale a retención ni trial equivale a pagador.

La lista de dormidos usa ausencia de venta/login 30d y antigüedad >7d; es una cola comercial, no tasa formal de churn.

## Soporte y WhatsApp

Primero ayuda SaaS pública con fuente y una persona disponible. Separar soporte corporativo del Customer de cada comercio. No exponer ventas/deuda por scope del canal o sufijo telefónico. Preparar corpus con 20 preguntas reales y escalar a evaluación versionada; habilitar mensajes solo después de identidad, inbox/outbox, consentimiento y bandeja.

La existencia de correos/link wa.me no demuestra seguimiento automatizado ni atención efectiva. No enviar mensajes a las cuentas inactivas desde una auditoría: el fundador define destinatarios, consentimiento y acción autorizada.

## Aceptación del ciclo

- Tres fricciones prioritarias respaldadas por observación.
- Primera venta y retorno comprobados con comercios del segmento y dispositivos reales.
- Datos del embudo y pago conciliables, sin denominadores mezclados.
- Ayuda coherente con el producto y handoff atendible.
- Sin pérdida de venta, mezcla de tenant o bloqueo que obligue a ingeniería a operar por el cliente.
- Revisar resultados comerciales a días 30/60/90 según el plan maestro; los umbrales son propuestas, no resultados actuales.
