# WhatsApp comercial — contrato de implementación local

## Resultado y autoridad

Sublote C01–C06 del plan `docs/PLAN_WHATSAPP_COTIZACIONES_2026-09-28.md`.
Solicitud: implementación completa local y simulaciones autorizadas por el usuario el 29/09/2026.
Resultado: consultas del catálogo elegible → propuesta editable → revisión explícita o política automática aprobada → proforma persistida y salida durable → comprobante del proveedor, o estado incierto sin repetir.
El lote no confirma ventas, cobros, reservas, deuda ni movimientos de inventario. No habilita farmacias. No consulta modelos externos. Responsable de producto: usuario solicitante; aceptación humana del piloto: pendiente.

## Fuentes y contrato

- Candidato: `/private/tmp/nortex-whatsapp-20260928-21pepma0`; manifiesto `SOURCE_MANIFEST.json`; base `096e25118f8a90855632ab12616c52e33263ce2f` más cambios locales originales preservados. No equivale a main actual ni a producción.
- Precio, publicación, unidad, stock y régimen provienen de Prisma, reglas existentes de cantidades/proformas e IVA; Decimal en cantidades y totales. Stock es indicativo: no se reserva al cotizar.
- Autoridad HTTP: JWT, usuario vigente en BD, tenant derivado del JWT. OWNER/ADMIN configuran; OWNER/ADMIN/MANAGER atienden. Identidad cliente limitada al número y canal receptor; jamás habilita consultas administrativas.
- Catálogo: SKU explícitos, publicados, mismo tenant, ferretería, sin lotes ni series. Revisión humana de elegibilidad documentada al activar y versionada.
- Consentimiento de respuesta: conversación iniciada por usuario; BAJA cancela salidas, ALTA reanuda, ASESOR transfiere. No autoriza campañas. Adjunto no soportado queda durable para atención humana.
- Ediciones de precio, cantidades, política, catálogo o régimen invalidan la revisión. En el despacho se vuelven a comprobar permisos y contexto.
- Inbox con ID proveedor único y hash de contenido; outbox con clave única. Orden por conversación y lease recuperable. Persistencia antes de ACK en el modo comercial nuevo.
- UNKNOWN significa que el proveedor pudo aceptar el envío: no se reintenta automáticamente. Los recibos no degradan READ/DELIVERED. Proforma creada no prueba entrega.
- Límite: 20 líneas/política, 500 productos elegibles, importe configurado, TTL 1–168 horas; ventana conservadora de respuesta 23 horas. Intentos de procesamiento acotados; no reintento automático después de envío incierto. Costo de modelo/proveedor en QA: cero.
- Recuperación: inbox transaccional y leases; outbox SENDING abandonado pasa a UNKNOWN. La política puede deshabilitar el canal y cancela pendientes. Registros auxiliares se conservan para auditoría; calendario de retención y borrado para el piloto real pendiente de definir con el negocio. No hay purga automática en esta entrega.

## Responsabilidad de edición

| Editor | Archivos permitidos | Contrato |
|---|---|---|
| canal2 | `commerce/{inbox,outbox,worker}.ts`, `backend/workers/whatsappCommerce.ts`, tests de transporte | Recepción, orden, despacho, recuperación |
| catalogo2 | `commerce/{quotes,conversation}.ts`, tests de cotización | Cálculo determinista y conversación |
| ux_qa | `backend/routes/whatsappCommerce.ts`, `components/whatsapp/CommerceInbox.tsx`, tests de rutas/experiencia | Permisos y bandeja |
| identidad | solo revisión; luego `tests/whatsappCommercePolicy.mysql.test.ts` | Revisión adversarial y activación |
| integrador | schema/migración, policy/types, webhook, mounts, scripts/gates/documentación | Integración y prueba global |

Todos trabajan en el candidato aislado y preservan cambios ajenos. El integrador es el único editor de server.ts y QuotationManager.tsx. La pestaña WhatsApp conserva el estado del borrador del padre; no cambia lector/atajos POS.

## Activación y transición

`WHATSAPP_COMMERCE_ENABLED` está apagado por defecto: conserva el handler anterior. El nuevo handler durable se selecciona con ese flag. Antes del corte global se deben preparar todos los canales que recibirán tráfico; un canal sin commerceEnabled no atiende en el modo nuevo. No presentar la cola anterior como durable.

La recepción también depende del montaje `WHATSAPP_ENABLED`; el worker requiere activación propia; los envíos reales requieren un flag separado. Ningún flag de producción ha sido modificado. El rollback del flag de recepción exige detener el worker nuevo para evitar dos motores. Mantener políticas y datos para recuperar de forma controlada.

## Evidencia por compuerta

- Caracterización previa: webhook original respondió 200 antes de persistir; 2 pruebas fallaron. Handler nuevo pasó las mismas 2; se añade compatibilidad del modo anterior.
- TypeScript y build: ejecutados en el candidato; resultado final se registra en el informe de QA.
- Unitarias y experiencia: suite general inicial 390 archivos, 5263 aprobadas; 386 casos omitidos de integración no se consideran aprobados.
- MySQL y activación: 50 suites/409 casos aprobados sin omisiones; ver informe final.
- Navegador real: revisión/emisión de proforma 230.00 y respuesta humana pendientes de envío comprobadas con datos sintéticos.
- Modelo real: no aplica, no se invoca. Meta real, CI remota, staging y producción: no ejecutados.
- Utilidad comercial, tiempo ahorrado y piloto con negocio real: aún no medidos.

Cierre local: QA obligatoria y revisión visual aprobadas; integración protegida por hashes y reporte [ENTREGA_Y_QA_2026-09-29.md](ENTREGA_Y_QA_2026-09-29.md). Activación externa requiere revisión de canales, credenciales del negocio y autorización separada de despliegue/envío.
