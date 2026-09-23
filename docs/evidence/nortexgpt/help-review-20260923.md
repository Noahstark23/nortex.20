# NortexGPT · revisión humana de ayuda existente

Fuente: `backend/services/assistant/knowledge.ts` en el candidato local del 23 de septiembre de 2026. Estos doce textos están etiquetados `LEGACY`; este documento no los aprueba ni publica. El hash identifica el contenido exacto que debe revisar una persona.

Para cada artículo: comprobar el recorrido real en Nortex, el rol, la precisión del texto y si debe estar disponible sólo en web interna. Registrar correcciones antes de crear una versión editorial y publicar mediante el flujo administrativo; no cambiar `LEGACY` por una aprobación implícita.

Para el primer corte propuesto, WhatsApp privado, promociones y confirmación de
acciones siguen apagados. En especial, los artículos `canal-privado` y
`promociones` describen capacidades fuera de ese corte; el revisor debe decidir
si se excluyen del manifiesto inicial. La etiqueta `LEGACY` aún puede aparecer
como ayuda de compatibilidad, de modo que apagar una capacidad no equivale a
haber aprobado el texto visible.

## asistente · Qué puede hacer NortexGPT

- Versión: `2026-09-05.1`
- Hash SHA-256: `6873763822f40af06d1082878f968dd15a3de3a9372a8d86e667e5cc2a2df5e6`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, CASHIER, DRIVER, EMPLOYEE, LENDER, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR, VIEWER
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Podés consultar información permitida para tu rol y pedir ayuda para usar Nortex. Las consultas muestran su período y procedencia. Una propuesta de compra no cambia inventario ni dinero: primero tenés que revisarla y confirmarla.

## ventas · Vender y cobrar

- Versión: `2026-09-05.1`
- Hash SHA-256: `fdd47f962bf3bc75c5419d048adfe39dc8f47871f60210123591854261465216`
- Roles: ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

En Punto de venta, agregá los productos al carrito y revisá cantidades y total. Elegí el medio de pago y comprobá el recibido y el vuelto antes de registrar. Conservá el comprobante; cerrar una ventana no demuestra que la venta quedó registrada.

## offline · Ventas pendientes de sincronización

- Versión: `2026-09-05.1`
- Hash SHA-256: `7c9f4c2240f54b1d73f182e303e189e3b110a1a36ed4c43c09cbdfb5360b2cc7`
- Roles: ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Una venta guardada en el dispositivo sigue pendiente hasta que Nortex confirme su registro. Consultá Avisos y usá el reintento disponible. Conservá la venta original: no la cobrés de nuevo ni la recreés para resolver una duda de sincronización.

## compras · Revisar una factura de compra

- Versión: `2026-09-05.1`
- Hash SHA-256: `cd485d3c49b0e5ff002f201c8df4236dc7f59121bcca9f9aa55ac351576093b3`
- Roles: ACCOUNTANT, ADMIN, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Revisá proveedor, número de factura, fecha, productos, cantidades, unidades, costos e impuestos. Confirmá por separado si recibiste la mercadería y si pagaste. Si la factura corresponde a una recepción de orden de compra, vinculá esa recepción para evitar ingresar existencias otra vez. Registrar requiere un rol autorizado de compras.

## lotes · Lotes y vencimientos

- Versión: `2026-09-05.1`
- Hash SHA-256: `babaac6683049b858e8041c884646a547bc3d3fcda64d030180cc567a3093736`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Para productos con seguimiento por lote, comprobá el número de lote y el vencimiento antes de recibir. Los vencimientos se interpretan como días del catálogo tomando el día vigente en Managua. El stock físico puede incluir unidades retenidas o vencidas: no lo confundás con disponibilidad para vender.

## contabilidad · Leer los resultados del negocio

- Versión: `2026-09-05.1`
- Hash SHA-256: `5a623b593676e4a0983248eec7e855b42e20c2ce7fda5a0512d2a73e9b7c48a6`
- Roles: ACCOUNTANT, ADMIN, OWNER, SUPER_ADMIN
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Las ventas registradas no equivalen a utilidad ni a dinero recibido. Revisá por separado devoluciones, gastos y saldos por cobrar y pagar. Una cifra sin respaldo suficiente debe aparecer como no disponible; compará el período y la fecha de consulta antes de tomar decisiones.

## reposicion · Preparar reposición

- Versión: `2026-09-05.2`
- Hash SHA-256: `6767f7445bb9d9b4f9cc5b26e1aea70633a8dcf59eabf1840023424fb849fa2e`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

La cobertura es una estimación basada en salidas verificadas de los últimos 30 días completos. Revisá existencias vendibles, unidades, mínimos y entradas pendientes. Con pocos datos no se puede prometer una fecha exacta de agotamiento. Una orden preparada queda en borrador: todavía requiere aprobación y envío; no agrega existencias ni deuda.

## salida-proveedor · Devolver físicamente al proveedor

- Versión: `2026-09-05.2`
- Hash SHA-256: `7fdcbd03556a3c7facd02cf54038da7e92664e0c278d2b344236386b8cb3bd39`
- Roles: ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Seleccioná el proveedor y la línea de compra o recepción original, revisá producto, lote, bodega y cantidad. Confirmá expresamente que corresponde registrar la salida física. El comprobante de devolución no reduce por sí solo la cuenta por pagar; una nota de crédito del proveedor se concilia por separado.

## merma · Registrar una baja de lote

- Versión: `2026-09-05.2`
- Hash SHA-256: `df8c1fb22f81aa3174c3e097d88e8efe96a4734f6281422a6663b7ed3a5848d7`
- Roles: ADMIN, OWNER, SUPER_ADMIN
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Una fecha vencida no demuestra que las unidades fueron retiradas físicamente. Revisá lote, bodega, cantidad y motivo; la vista de confirmación muestra la salida y su valor. Confirmar registra inventario, asiento, auditoría y comprobante juntos. Si cambian los datos después de revisar, actualizá la propuesta.

## promociones · Revisar precios promocionales al cobrar

- Versión: `2026-09-05.2`
- Hash SHA-256: `18a613b0deb772c712bb19b59fb0981c6c5af829a03bd68752e8b4f106f0de6d`
- Roles: ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Cuando el negocio habilita promociones, los precios se revisan con conexión antes del cobro. Cada promoción tiene productos y fechas explícitas en Managua; cubre todos los lotes vendibles de esos productos. No se acumula con descuento manual de su línea ni global del ticket. Si cambia el total, revisalo y aceptalo antes de cobrar. Ante una respuesta incierta, conservá la referencia y comprobá el registro.

## comparacion · Comparar períodos y explicar resultados

- Versión: `2026-09-05.2`
- Hash SHA-256: `cbb614b0b2a2e4e94f21daa139ea8469dfb2696dc2b21fbee590f253b5754845`
- Roles: ACCOUNTANT, ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Una consulta diaria compara por defecto con el mismo día de la semana anterior hasta la misma hora de Managua. Varios días se comparan con una ventana anterior equivalente. Separá hechos, estimaciones e hipótesis: una variación no demuestra su causa. Cada rol ve sólo sus cifras autorizadas.

## canal-privado · Vincular WhatsApp privado

- Versión: `2026-09-05.2`
- Hash SHA-256: `66d43f125ca6247c15ffa408a8cc940e0e2ec76b5c1592601cac220cf07e04ac`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, CASHIER, DRIVER, EMPLOYEE, LENDER, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR, VIEWER
- Canales heredados: WEB_INTERNAL, WHATSAPP_PRIVATE
- Estado editorial: pendiente de revisión humana

Si el negocio habilita el canal privado, iniciá la vinculación desde tu sesión de Nortex con un código de un solo uso. Podés consultar y preparar trabajo según tu rol. La confirmación abre la propuesta exacta en Nortex y requiere tu sesión autenticada. Desvincular revoca el acceso de ese teléfono; es un canal separado del que atiende a clientes.
