# Entrega local: catálogo y cotizaciones por WhatsApp

## Estado

**Implementación y simulación local verificadas. Piloto real y despliegue pendientes.**

Candidato: `/private/tmp/nortex-whatsapp-20260928-21pepma0`. Base del checkout: `096e25118f8a90855632ab12616c52e33263ce2f`, con cambios locales del usuario preservados; durante la tarea se incorporó al candidato la revisión concurrente de RRHH/MiEspacio antes de la suite final. La rama de origen está atrasada respecto de su upstream: este resultado no acredita integración con main actual ni habilita promoción sin reconciliar el candidato de release.

## Qué puede hacer

- Recibir eventos firmados y persistirlos antes del ACK en el nuevo modo comercial.
- Buscar artículos aprobados de una ferretería; pedir opción y cantidad sin adivinar productos.
- Crear borrador durable, revisar y emitir una proforma; o emitir automáticamente dentro de una política versionada aprobada por administración.
- Usar el mismo cálculo de totales que la proforma HTTP: cantidad/precio Decimal, IVA y cuota fija.
- Mantener una salida durable y diferenciar pendiente, aceptación de Meta, entrega, lectura, fallo e incertidumbre.
- Respetar BAJA/ALTA, solicitar ASESOR y permitir que un operador tome y responda la conversación.
- Revalidar canal, tenant, usuario, destinatario, ventana, precio, cantidad, unidad, impuesto, publicación, stock indicativo y política antes de enviar.

No cobra, registra venta ni reserva inventario. No mezcla conversaciones ni permisos del canal privado del dueño/equipo.

## Evidencia ejecutada

| Compuerta | Resultado |
|---|---|
| Prisma generate/validate | Aprobados en candidato |
| Migración SQL real | Esquema anterior creado en MySQL8 desechable; aplicada migración aditiva; `prisma migrate diff` devolvió migración vacía |
| TypeScript | `tsc --noEmit`: aprobado |
| Suite general final | **391 archivos aprobados, 5,272 pruebas aprobadas**. 49 archivos/395 casos de integración omitidos en esta corrida; no se contabilizan como aprobados aquí |
| Integración obligatoria | **50 suites, 409 casos, todos ejecutados y aprobados, sin omisiones** |
| Sistema de diseño | 108 archivos; cero violaciones |
| Build/PWA | Aprobado. Avisos existentes: datos Browserslist antiguos y chunks grandes |
| Mutación completa | **99.88%**, umbral 99.85 intacto. 5,210 instrumentados: 5,180 killed, 4 timeout, 6 survivors, 20 ignores existentes. Cálculo nuevo `quotationTotals.ts`: **10/10 killed**. Guardia de alcance: 56 módulos |
| Restauración sintética | mysqldump transaccional y restore en base aparte: 1 conversación, 1 borrador, 2 salidas y suma de proformas 764.04 coinciden origen/restauración |
| Navegador real local | Login de operador sintético; Proformas/WhatsApp; política/catálogo; revisar 2 martillos × 115 = **230.00**; emitir proforma; salida **Pendiente de envío**; tomar conversación y encolar respuesta humana |
| Revisión adversarial final | Otro agente revisó código actual y límites; no encontró bloqueantes nuevos. Esta revisión no sustituye las pruebas anteriores |

Las pruebas corrieron en bases locales `nortex_quality_whatsapp*` del contenedor `nortex-whatsapp-qa-20260929`, MySQL8, puerto loopback32861; sólo datos ficticios. Sin LLM, credenciales de proveedor ni mensajes externos. Reportes y manifiesto de integración: `reports/whatsapp-commerce-20260929/`.

### Escenarios nuevos cubiertos

- Firma ausente/cuerpo alterado y payload inválido; DB fallida produce 503; ACK espera commit.
- ID duplicado exacto versus contenido conflictivo; reintento concurrente produce un solo borrador.
- Orden por conversación, lease abandonado, rollback antes de commit y recuperación.
- SENDING abandonado y timeout tras posible aceptación pasan a UNKNOWN y no repiten envío.
- Recibo previo al guardado del ID Meta y FAILED tardío sin degradar READ.
- Dos tenants, canal reasignado, producto ajeno/no publicado/con lote o serie, vertical no elegible y cambio concurrente de política.
- Cambio de precio invalida revisión; versión obsoleta se rechaza; emisión idempotente; stock/caja no se mueven.
- Proforma automática, despacho simulado y timeout; proforma humana exige operador asignado en HUMAN.
- BAJA, acuse vinculado, cancelación; adjunto a HUMAN; mensaje vencido; respuesta demasiado larga; salida huérfana cancelada.
- **HTTP real completo:** registrar negocio → activar política → webhook firmado de búsqueda → opción → cantidad → LISTO → PENDING_REVIEW → revisar → emitir con 201 y outbox pendiente.
- UI: PENDING_REVIEW revisable, conservar selección al actualizar, proforma emitida no editable, pendiente/UNKNOWN separados de entrega.
- Paridad HTTP de proformas web antes/después de extracción: gravado+exento y cuota fija, total 267.02.

### Defectos reproducidos y reparados durante el bucle

ACK anterior a persistencia; comparación de JSON sensible al orden de claves de MySQL; lectura repetible que ocultaba al ganador concurrente; revisión PENDING_REVIEW sin botón; HUMAN sin asignación permitía emitir una salida que luego se cancelaba; vencimiento no aplicado a respuesta genérica; referencia huérfana que podía atascar candidatos; diferencias entre creación de proforma y prueba de entrega.

También se corrigieron fixtures de QA (identificador de teléfono sintético debe ser numérico; emisión devuelve 201). No se cambiaron contratos correctos para satisfacer un expected equivocado.

## Procedencia y modularidad

`backend/server.ts` pasa de 13,364 líneas del checkout actualizado a **13,345** (−19 netas con la composición nueva); el helper compartido agrega **20**, combinado **+1**. El presupuesto baja a 13,345. No se amplió POS ni se elevaron excepciones. Las nuevas capacidades viven en rutas/servicios/componentes dedicados. Archivos originales y hashes se conservaron para integrar sin sustituir cambios ajenos.

La mutación se ejecutó sobre los módulos monetarios finales (el helper no cambió después); la suite general e integración final incluyen la actualización concurrente de RRHH. Implementación, QA local y despliegue se registran por separado.

## Lo que falta para uso comercial real

1. Seleccionar negocio y número comercial; revisión humana del catálogo elegible, consentimiento, términos y tarifa aplicable.
2. Reconciliar el candidato con la rama de release, CI exacta y staging; desplegar migración/API/worker con autorización separada.
3. Preparar todos los canales antes del corte global; activar flags sólo en el ambiente autorizado. El legacy sigue siendo el default y conserva su cola en memoria.
4. Probar entrega real a destinatario consentido, registrar comprobante Meta y aceptación del negocio.
5. Definir responsables/horario de atención, retención/borrado y operación de casos UNKNOWN. La entrega no implementa purga, calendario de operadores ni campañas/plantillas fuera de ventana.

Primer recorrido limitado a precio detalle, unidad base y búsqueda guiada de un producto por consulta. No incluye mayoreo, empaques, promociones, comprensión libre de listas, adjuntos ni catálogo farmacéutico. La edición administrativa admite varias líneas dentro de la política. No se ha medido autonomía frente a revisión humana, conversión, ahorro de tiempo ni costo real de entrega. **No se declara terminada la misión comercial ni habilitada producción.**

Operación y flags: [runbook](../runbooks/whatsapp-commerce.md). Alcance/autoridad: [contrato](CONTRATO_COMERCIO_2026-09-29.md).
