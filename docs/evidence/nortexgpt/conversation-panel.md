# QA visual: captura por texto del 2026-09-05

Candidato local: `/tmp/nortexgpt-conversation-20260905`. Navegación real mediante CUA contra frontend `http://127.0.0.1:60100` y backend local con MySQL descartable; negocio y datos sintéticos de ferretería. Sin proveedor pagado ni registro de compra desde el navegador.

## Recorrido observado

1. POS con un cemento en el carrito, total C$20. Abrir NortexGPT: el fondo queda inerte; F9/F4 no abren cobro por detrás ni alteran el carrito.
2. Escribir «Nortex, compré 50 bolsas de cemento»: respuesta conserva 50 y cemento y ofrece adjuntar factura o completar por texto.
3. Continuar por texto: elegir Cemento Holcim del catálogo, unidad, costo C$5, proveedor, factura, fecha, total C$287.50, crédito, vencimiento, recepción y bodega.
4. Abrir la propuesta manual y calcular efectos. La revisión muestra 50 unidades, subtotal C$250, IVA C$37.50, total y cuenta por pagar C$287.50, salida de caja C$0.
5. Estado READY versión 3; el botón de registrar sigue deshabilitado hasta revisar los efectos exactos. **No se pulsó confirmación.**
6. Cerrar el panel conserva la ruta del POS y el carrito original: un producto, C$20. Reabrir/recuperar conserva la conversación.

## Defectos reproducidos y reparación

- La tarjeta inicial mostraba claves internas como `items.0.productId`. Ahora presenta etiquetas comprensibles y la elección foto/texto, sin claves internas.
- Un control de crédito escribía `paymentConfirmed=true`. El servidor rechazó esa revisión; no movió dinero ni stock. La UI ahora muestra que quedará pendiente y ofrece corregir una marca incompatible a pendiente. El recorrido reparado alcanzó READY con caja cero. El caso rojo→verde también ejecuta las reglas reales `invoiceDraftSchema` y `draftIssues` sobre el payload del componente.
- Calcular un DRAFT recién preparado exigía una edición. El botón ahora está disponible para el DRAFT sin cambios; la prueba verifica que se envía el contenido original.

## Tamaños y límites

- Móvil emulado: 320×740; escritorio: 1280×720. Sin desbordamiento horizontal en los escenarios observados; viewport restablecido al terminar.
- Hubo dos recargas del servidor de desarrollo durante los cambios previos. La captura se recuperó y el carrito permaneció intacto; el recorrido final se realizó después de estabilizar el código.
- 65/65 pruebas de panel/revisión aprobadas; son evidencia complementaria a esta navegación.
- No acredita Android/iOS físico, cámara, lector físico, lector de pantalla, evaluación OCR, mejora de tiempos frente al registro manual ni piloto con clientes.
- La comprobación persistida de esta propuesta y la salud del backend se registran por separado en la evidencia de QA. No se presentan los efectos propuestos como movimientos realizados.
