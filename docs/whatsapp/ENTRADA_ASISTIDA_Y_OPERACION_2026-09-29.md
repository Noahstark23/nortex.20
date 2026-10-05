# WhatsApp Nortex — conexión asistida

## Corrección de producto

El negocio solicita ayuda para conectar su WhatsApp. Nortex toma negocio y solicitante de la sesión, prepara la configuración técnica y acompaña la verificación de propiedad del número. No trasladar al comerciante preguntas sobre tenant, WABA, credenciales o webhooks.

Recorrido comercial previsto:

1. **Número del negocio → Que Nortex me ayude.** Solicitud guardada y recuperable.
2. **Nortex prepara la conexión.** Revisar si el número actual es compatible y cómo conserva su uso; no prometer coexistencia ni forzar una migración sin comprobarlo.
3. **Comercio revisa una muestra.** Catálogo y precios salen de su Nortex. El dueño revisa productos, texto que verá el comprador y precio total del servicio antes de activar.
4. **Verificación guiada y prueba.** Ayudar con el paso del proveedor que necesite al dueño. Probar una conversación iniciada por comprador consentido y comprobar entrega real.
5. **Atención diaria.** El sistema prepara cotizaciones dentro de la capacidad aprobada; la persona asignada atiende transferencias y excepciones.

El primer botón no acepta términos, tarifa ni consentimiento de compradores. No crea ni activa un canal y no dispara mensajes externos. Un teléfono escrito no demuestra su propiedad ni que tenga WhatsApp.

## Implementado C07, alcance local

Form de un campo, solicitud persistente única por negocio, normalización del número, autoridad OWNER/ADMIN vigente y tenant derivado de JWT, auditoría atómica sin teléfono en sus detalles. Mismo número recupera identidad; otro número no sobrescribe la solicitud. Respuesta incierta consulta antes de repetir. Sin canal conectado, el estado visible es **Solicitud guardada. Falta conectar y verificar tu número.**

Falta el panel de soporte para tramitar solicitudes y la integración real con el proveedor. Este recorrido sustituye el cuestionario técnico; no acredita servicio comercial listo.

## QA del lote C07

Candidato: `/private/tmp/nortex-whatsapp-20260928-21pepma0`, fuente protegida por `ONBOARDING_SOURCE.json` y manifiesto de reintegración propio. La revisión anterior C01–C06 mantiene su evidencia por separado.

- Prueba de experiencia falló antes de introducir el botón y pasó después.
- HTTP + UI: 19 casos aprobados, 3 archivos; entrada nueva, recarga, error, respuesta perdida y regresión de proformas.
- MySQL 8 descartable: 9 casos aprobados sin omisiones; incluye dos altas concurrentes y rollback de auditoría. No contar los skips de una ejecución sin flag como aprobados.
- Prisma 6.4.1: generate/validate aprobados; SQL aditivo comparado con Prisma sin diferencia.
- Upgrade con datos sintéticos anteriores: negocio, usuario, precio/costo y stock preservados; tabla nueva vacía.
- TypeScript: cero errores. Diseño: 109 archivos, cero infracciones. Build/PWA aprobado; conserva advertencias de bundle/Browserslist existentes.
- Navegador real: form sin canal → guardar número ficticio → ver solicitud pendiente → recargar → recuperar. Capturas en `reports/whatsapp-activation-20260929`.
- Sin llamada de modelo, envío Meta, aceptación real del negocio ni activación de flags externos.

## Reconciliación con release

Base main inspeccionada: `bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4`. CI, staging y producción de **esa base** figuran verdes en GitHub; no validan el código WhatsApp local. El parche C01–C06 tiene 42 rutas y 11 se solapan con cambios upstream.

Conservar el workspace nuevo de proformas, las cantidades exactas y reglas fiscales del handler vigente, los modelos aditivos de main, el runner actual de integración, el presupuesto inferior de server (12991) y el umbral de mutación actual (100%). No pegar archivos viejos ni bajar umbrales para transportar el candidato. Integración sobre main y CI de ese candidato aún pendientes.

Bloqueo técnico previo al piloto: con el flag global de comercio, un canal sin `commerceEnabled` se ignora. Implementar transición por canal y probar callback mixto/fallo/reentrega antes de activar. Legacy conserva su cola en memoria; no declararla durable.

## Operación

Nortex tramita conexión, configuración y fallos del worker; el dueño revisa catálogo y condiciones, y confirma quién atiende y en qué horario durante la asistencia. No pedir esas decisiones técnicas antes de mostrar el servicio. El runbook registra conservación de UNKNOWN, evidencia exacta del proveedor y límites de retención. La asignación por conversación ya existe; calendario, alertas y redacción/purga todavía no están implementados.

Misión comercial pendiente: integración release, CI exacta, respaldo real restaurable, staging/API/worker, transición por canal, soporte de solicitudes, conexión proveedor, tarifa/condiciones revisadas, prueba consentida y aceptación del negocio. Producción/envío conservan autorización separada según AGENTS; ninguna prueba local cambia esa condición.
