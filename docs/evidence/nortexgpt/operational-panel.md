# NortexGPT operativo: verificación de interfaz local

Fecha: 2026-09-05. Candidato: `/tmp/nortexgpt-operativo-20260905`. Interfaz real en `http://127.0.0.1:49982`, backend local en `127.0.0.1:49981`, cuenta y negocio de ferretería exclusivamente sintéticos. Chrome controlado por CUA, ingreso mediante formulario real. Sin proveedor de IA configurado.

## Demostrado en navegador

- Resumen diario con tres avisos: lote vencido, reposición y variación de ventas. Conversación sembrada rotulada «Datos sintéticos de QA, sin modelo» con agregaciones reales y cuatro propuestas revisables. Esto acredita renderizado de datos/acciones, no capacidad de planificación del modelo.
- Consulta nueva escrita en la interfaz «¿Cómo va mi negocio hoy?» creó el trabajo `cmtozjr7v0031iln587fylpvk`; se observó progreso, se cerró el panel y se recuperó el resultado. El fallo de IA quedó explícito y conservó las métricas verificadas, fuentes y fecha de Managua: ventas C$2,650, un ticket, IVA C$345.65 y margen bruto C$304.35, con advertencia de que no es ganancia neta.
- Orden propuesta `568f11b3-e293-47d4-8bdd-0cebe840ff29`: cantidad base 40→41; al cerrar y reabrir se conservó 41 y la confirmación anterior quedó deshabilitada. Guardar y calcular pasó a revisión 4, subtotal C$8,200 y efectos stock/caja/deuda cero. No se creó la orden.
- Merma `98e19d18-6635-4665-8ffd-47d43bbd3250`: revisión de 2 litros del lote QA-ferreteria-2, bodega Principal, existencia 12, pérdida prevista C$120, caja/deuda cero. Confirmación deshabilitada mientras retiro físico permanece sin marcar. No se registró baja.
- Devolución `77735be7-456a-4701-ad4b-0aa36f75e0a5`: origen, producto, cantidad y bodega visibles; confirmación física sin marcar y botón de registro deshabilitado. Explica que saldría inventario y que no genera nota de crédito ni reduce deuda. No se registró devolución.
- Promoción propuesta `07cea5ea-d4aa-4956-bf32-8f047937b789`: precio normal/promocional BASE y empaque pallet×20 visibles; vigencia de editor y revisión coherentes en Managua. No se publicó esta propuesta.
- Se agregó un tornillo al carrito y se conservó al abrir/cerrar las revisiones. Se abrió una caja sintética con fondo inicial cero exclusivamente para preparar el cobro. Cotización real de promoción previamente sembrada: precio C$5→C$4.50, descuento 10%, IVA C$0.59. No se aceptó el total ni se envió la venta; Volver al carrito conservó cantidad 1 y efectivo escrito 20.
- Vista escritorio predeterminada de 1512×950 y emulación 320×740. Capturas inline de orden, merma, devolución, promoción y precioPOS. En 320px se midió document.scrollWidth=320 y revisión 282px; sin desbordamiento horizontal del documento. Tabla de precios mantiene texto legible y desplazamiento propio si necesita espacio.
- FondoPOS con atributo inert durante panel y cotización. F9 sobre la revisión promocional no abrió otro cobro ni cerró/aceptó la revisión. Viewport restaurado al terminar.

## Defectos reproducidos y reparados

- Recarga inmediata después de respuesta perdida podía preceder los 300ms de persistencia habitual del carrito. Ahora se guarda mediante el serializador existente antes de enviar una venta con cotización; prueba real de POS conserva carrito/referencia tras desmontar y montar, sin encolar ni repetir POST.
- Recibo de recuperación podía heredar presentación del carrito actual, y líneas sin promoción perdían su descuento en el helper de recibo. Se usan las cantidades/unidad base históricas al recuperar y se conserva el descuento ajeno a promoción; regresión roja y reparación documentadas en las pruebas focales.
- Títulos de herramientas y fecha UTC cruda en revisión promocional eran poco claros. La UI presenta títulos de negocio y hora de Managua; no cambia el instante enviado ni modifica las fuentes del servidor.

## Pruebas automatizadas ejecutadas

Node 22.23.2 mediante mise, npm y binarios locales. Última corrida funcional 15:58:06 local: 140/140, nueve suites, ninguna omitida en este conjunto. Copia: `operational-ui-vitest.log`.

Suites: assistantOperationalUI, promotionCheckout, presupuestoPos, cajaNicaPos, quotationPosBridge, assistantPanel, assistantInvoiceReview, posVentaCritica, posActivationFlow.

Incluyen confirmación incierta con misma clave, éxito sólo por evidencia durable, sesión/alcance, interruptor de ejecución, borradores/carro conservados, resumen diario de hasta 3 elementos, enlace autorizado, código de WhatsApp efímero, cancelación con versión, quote exacto, pérdida de respuesta/404/recarga sin cola ni segundo cobro, y cancelación de intento explícita. Sólo CANCELLED servidor permite liberar; error, ausencia o comprobante incompleto conservan bloqueo. COMMITTED al cancelar recupera el recibo y no reinicia cobro.

Los tests legacy cajaNicaPos y quotationPosBridge ahora leen o invocan los módulos extraídos reales y mantienen las garantías de efectivo antes de cola/POST, líneas de cotización, descuentos y foto fiscal. posVentaCritica y posActivationFlow sólo incorporan respuesta enabled:false de quote a sus fixtures, sin cambiar expectativas.

## Modularidad

POS 6949→6892 líneas (-57); presupuesto bajado a 6892, estados 114→114. Módulos nuevos de checkout y hook: 184 líneas. Conjunto afectado 6949→7076 (+127 por nueva funcionalidad). No se elevaron presupuestos ni se trasladó el POS completo a un hook.

## Límites de esta evidencia

QA visual de esta pasada cubre ferretería sintética y emulación móvil; no acredita teléfono físico, lector físico, impresión, calidad de IA, WhatsApp real, OCR real, piloto ni producción. La farmacia y roles adicionales requieren su propia evidencia funcional/integral del candidato. Las capturas fueron emitidas inline por la API CUA; esta API documentada no suministró una ruta de exportación PNG, por lo que no se adjuntan archivos de imagen inventados. El control de concurrencia y transacciones MySQL corresponde a las compuertas integrales de los otros dominios. Las observaciones de navegador de no ejecución deben complementarse con la verificación durable del demo realizada por el responsable del backend.

## Comprobación durable posterior

El responsable del backend ejecutó lectura real de MySQL tras este recorrido y guardó `reports/demo-post-ui-evidence.json`: OC READY revisión4, cantidad41/subtotal8200.00 sin operación; merma y devolución DRAFT revisión2 y promoción READY revisión2, todas sin operación. Stock conservado5/250/12. Tres ventas totales, iguales a la semilla (-14d, -7d y hoy); caja abierta con fondo0 y cero movimientos. TypeScript final terminó con código0 después del ajuste de tipo del formateador.

## Revisión final del 2026-09-07

Se añadieron advertencias y estado por producto/lote, mínimos, cobertura de historial y origen de la sugerencia. La prueba de render reprodujo advertencias ausentes antes del cambio y terminó con 10/10 pruebas del panel operativo, sin omitidos. TypeScript y diseño aprobados. El consumo indica salidas por venta menos reintegros RESTOCK, con exclusión explícita de cuarentena/pérdida, merma y traslados. No se repitió la inspección visual en navegador para estos nuevos campos: su evidencia es de render semántico; las capturas y recorridos anteriores conservan ese alcance.

La demo local se recuperó al mismo puerto tras reasignarse el puerto de MySQL descartable. Salud verificada con HTTP 200 y base disponible; no hubo reseed ni ventas nuevas. Las promociones de ejemplo tienen su vigencia real y pueden estar vencidas en esta fecha.
