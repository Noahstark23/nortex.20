# NortexGPT · hoja de revisión del primer corte web

**Borrador sin aprobación ni publicación.** Revisar el texto completo y los roles de cada versión.
Hash del manifiesto exacto: `debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`.
Cada artículo permite sólo `WEB_INTERNAL`; promociones y canal privado están excluidos de consultas nuevas. Las citas históricas siguen sujetas a su propio contrato de acceso.
Si se corrige un texto, generar otra versión y otro hash antes de aprobar.

## asistente · Ayuda de Nortex

- Versión: `2026-09-23.web2`
- Hash del artículo: `d19f5d5e04bcbd7aca9ec95a3038c207acd13d1a0b80c4815b72c82c33e57b9d`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, CASHIER, DRIVER, EMPLOYEE, LENDER, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR, VIEWER
- Canal: WEB_INTERNAL
- Atención: Comprobar que la compra se confirma sólo en la vista autorizada, nunca en el chat.

Podés consultar información permitida para tu rol y pedir ayuda para usar Nortex. Las consultas muestran su período y procedencia. Una propuesta de compra no cambia inventario ni dinero. Para registrarla, una persona con permiso debe revisar los datos en la vista correspondiente de Nortex y confirmarla allí; el chat no confirma la compra.

## ventas · Ayuda de Nortex

- Versión: `2026-09-23.web1`
- Hash del artículo: `69621f8c8845c9b52de5adb6de84b3f0028bf16ff288d3c98e3f3fe7740a4b38`
- Roles: ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canal: WEB_INTERNAL
- Atención: Comprobar texto, permisos y recorrido real en Nortex.

En Punto de venta, agregá los productos al carrito y revisá cantidades y total. Elegí el medio de pago y comprobá el recibido y el vuelto antes de registrar. Conservá el comprobante; cerrar una ventana no demuestra que la venta quedó registrada.

## offline · Ayuda de Nortex

- Versión: `2026-09-23.web1`
- Hash del artículo: `2a48b08976af8dae2a8c3d4dbbb3edc70613220e8aa49551ffd31c123c0e5631`
- Roles: ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canal: WEB_INTERNAL
- Atención: Comprobar texto, permisos y recorrido real en Nortex.

Una venta guardada en el dispositivo sigue pendiente hasta que Nortex confirme su registro. Consultá Avisos y usá el reintento disponible. Conservá la venta original: no la cobrés de nuevo ni la recreés para resolver una duda de sincronización.

## compras · Ayuda de Nortex

- Versión: `2026-09-23.web1`
- Hash del artículo: `577981bead300186c1427cf1f38a1170bd0e4bb4d0edf4e0b894f34bfee4d2e2`
- Roles: ACCOUNTANT, ADMIN, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canal: WEB_INTERNAL
- Atención: Comprobar texto, permisos y recorrido real en Nortex.

Revisá proveedor, número de factura, fecha, productos, cantidades, unidades, costos e impuestos. Confirmá por separado si recibiste la mercadería y si pagaste. Si la factura corresponde a una recepción de orden de compra, vinculá esa recepción para evitar ingresar existencias otra vez. Registrar requiere un rol autorizado de compras.

## lotes · Ayuda de Nortex

- Versión: `2026-09-23.web2`
- Hash del artículo: `dae01f007502ca3732e29bbc18dba71035082d7d8c7a224028b02cb270d2561e`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canal: WEB_INTERNAL
- Atención: Comprobar el día civil de Managua y la separación de stock físico y vendible.

Para productos con seguimiento por lote, comprobá el número de lote y la fecha de vencimiento antes de recibir. El vencimiento se evalúa por día civil, tomando como referencia la fecha vigente en Managua. El stock físico puede incluir unidades retenidas o vencidas: no lo confundás con disponibilidad para vender.

## contabilidad · Ayuda de Nortex

- Versión: `2026-09-23.web1`
- Hash del artículo: `ccbb8274c9aa0454fec9423aa61d64a65671812f4a942c181ffbef24dfd06c67`
- Roles: ACCOUNTANT, ADMIN, OWNER, SUPER_ADMIN
- Canal: WEB_INTERNAL
- Atención: Comprobar texto, permisos y recorrido real en Nortex.

Las ventas registradas no equivalen a utilidad ni a dinero recibido. Revisá por separado devoluciones, gastos y saldos por cobrar y pagar. Una cifra sin respaldo suficiente debe aparecer como no disponible; compará el período y la fecha de consulta antes de tomar decisiones.

## reposicion · Ayuda de Nortex

- Versión: `2026-09-23.web3`
- Hash del artículo: `ffdec72beef292a69ca8da89887e5841b15b634ac062c361bbe707773cdd71ee`
- Roles: ACCOUNTANT, ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN, VIEWER
- Canal: WEB_INTERNAL
- Atención: Comprobar permisos de Compras Inteligentes y cobertura deshabilitada.

Para planificar una reposición, consultá las existencias según los permisos de tu rol y revisá unidades, mínimos y recepciones pendientes. Comprobá aparte los lotes vencidos o retenidos antes de tratar esas unidades como disponibles para vender. La pantalla Compras Inteligentes requiere permisos de administración. Una orden preparada queda en borrador hasta su aprobación; el envío al proveedor se gestiona por separado. Prepararla no aumenta existencias ni deuda. La consulta de cobertura desde NortexGPT sigue deshabilitada en este piloto.

## salida-proveedor · Ayuda de Nortex

- Versión: `2026-09-23.web2`
- Hash del artículo: `e51b475431d14f5560b9939e9083ee5c66403177642cce7d7f5ab9804f05de3a`
- Roles: ADMIN, BODEGUERO, MANAGER, OWNER, SUPER_ADMIN
- Canal: WEB_INTERNAL
- Atención: Comprobar la entrega física antes de confirmar; la nota de crédito es separada.

Seleccioná el proveedor y la línea de compra o recepción original; revisá producto, lote, bodega y cantidad. Cuando la mercadería ya haya sido entregada físicamente al proveedor, confirmá ese hecho en el formulario autorizado de Nortex. El chat inicial no registra la salida. El comprobante de devolución no reduce por sí solo la cuenta por pagar; una nota de crédito del proveedor se concilia por separado.

## merma · Ayuda de Nortex

- Versión: `2026-09-23.web2`
- Hash del artículo: `f34186b9053339787c1e01de0bc9c94a0a17bb1e84174d0c48a3323bc1e94d7e`
- Roles: ADMIN, OWNER, SUPER_ADMIN
- Canal: WEB_INTERNAL
- Atención: Comprobar la condición de valor positivo del asiento y la confirmación fuera del chat.

Una fecha vencida no demuestra que las unidades fueron retiradas físicamente. Revisá lote, bodega, cantidad y motivo; la vista de confirmación muestra la salida y su valor. Al confirmar la baja en el flujo autorizado, Nortex registra la salida de inventario, el movimiento de Kardex y la auditoría; si la pérdida tiene valor positivo, también genera el asiento. El chat no ejecuta la baja. Si cambian los datos después de revisar, actualizá la propuesta y volvé a revisarla.

## comparacion · Ayuda de Nortex

- Versión: `2026-09-23.web2`
- Hash del artículo: `c5d6ee12e70175307d9b6e7ef68b9403aa17713620907f33bb11561cefc02d5f`
- Roles: ACCOUNTANT, ADMIN, CASHIER, EMPLOYEE, MANAGER, OWNER, SUPER_ADMIN, VENDEDOR
- Canal: WEB_INTERNAL
- Atención: Verificar que el piloto muestre cifras del período sin prometer comparación automática.

En este piloto NortexGPT puede mostrar cifras del período autorizado, pero no realiza la comparación automática con una ventana anterior. Para comparar manualmente, usá períodos equivalentes y considerá el corte de Managua. Una variación no demuestra su causa.
