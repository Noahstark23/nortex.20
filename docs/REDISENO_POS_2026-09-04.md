# Rediseño visible del POS — 2026-09-04

Estado: implementación y QA local; pendiente de evaluación con comerciantes. Esta entrega corrige el alcance sobreestimado de la entrega anterior: aquella simplificó funciones y añadió avisos, pero mantuvo casi toda la composición visual. No debía presentarse como una transformación total.

## Qué cambia en el mostrador sencillo

- Catálogo claro con filas compactas, nombre, precio, unidad y existencia. Se eliminan los bloques grandes de iniciales cuando no hay foto; las fotos reales conservan una miniatura discreta.
- En el escenario local de seis productos a 1280 × 720, caben los seis completos. La versión anterior mostraba cuatro completos y exigía desplazar para los restantes. Es una observación de ese escenario, no una medición de productividad general.
- Buscar/escaneo es la acción principal; borrar búsqueda y crear un producto quedan visibles. La cantidad en el catálogo refleja el carrito real, incluso si el clic abrió una captura de cantidad que todavía no fue confirmada.
- Ticket separado, vacío con una instrucción útil y sin un cobro deshabilitado ocupando su pie. Al agregar productos aparecen total y cobro.
- En móvil, «Cobrar» abre directamente el cobro en efectivo; «Ver venta» permite corregir el ticket. Se elimina la apertura intermedia del ticket para quien ya está listo para cobrar. Registrar sigue requiriendo confirmación explícita.
- Avisos mantiene las causas operativas existentes. El catálogo ahora recibe `minStock` desde la API, también después de crear un producto; ya no pierde el mínimo configurado en los mapeos.

## Implementación y revisión

`POS.tsx` compone `PosMobileCheckoutBar`, el catálogo y los shells existentes. La nueva presentación vive en `posWorkspace.css` y `compactCatalog.css`. No se cambia el motor financiero ni el contrato de registro de ventas.

Los estilos del mostrador se restringen a `.nx-app-shell.nx-pos-workspace`: `Layout` ya usa `nx-pos-workspace` en ambos modos y ese selector solo invadía el modo completo. Se verificó el modo completo cargado, conservando cabecera, catálogo y ticket. El menú Más tiene fondo y contraste coherentes con la cabecera clara.

El mínimo de existencias queda en `Product` y se conserva en los tres mapeos. Una regresión de integración verifica que stock 20 con mínimo 25 se muestra como existencia baja, aunque sea mayor que cinco.

`POS.tsx`: 7081 → 7050 líneas, sin nuevos estados React. `CajaNicaCatalog.tsx`: 285 → 211 líneas. El presupuesto del monolito baja en el mismo cambio. Los módulos y estilos nuevos también cuentan como código mantenible; esta entrega no resuelve por sí sola toda la deuda del monolito.

## Evidencia local

Entorno aislado: frontend 4174, backend 4199 y MySQL 8 en 3318, con comercio y productos sintéticos. La instancia anterior 4188 se conserva para comparar. Sin cambios de despliegue ni datos de producción.

- Prisma generate/validate, TypeScript, sistema de diseño y build: pasan.
- Vitest: 3613 pruebas pasan, 64 omitidas; 280 archivos pasan y 11 omitidos. `tests/serverStartup.test.ts` se excluye de esta ejecución aislada. No presentar las omisiones como pruebas aprobadas.
- Barra móvil aislada a 320 × 600: 12 líneas y C$1,000,000.00 caben sin desbordamiento horizontal; ancho de documento y contenido, 320 px. Es una prueba de presentación, sin venta ni API.
- Navegador: escritorio 1280 × 720, catálogo móvil 390 × 844 y cobro 320 × 600. Se revisaron aviso, menú Más, carrito, foco del efectivo y cancelación de cobro.
- Flujo móvil real: un tornillo de C$10, recibido C$20, cambio C$10. Una confirmación creó una sola venta. MySQL confirmó stock 40 → 39, caja 500 → 510, Kardex −1, auditoría `SALE_CREATED` y asiento de venta balanceado.
- Regresiones: abrir cobro no envía una venta; confirmar envía una; volver conserva el carrito. El indicador del catálogo espera el cambio real de cantidad, no solo el clic.

Las capturas y el JSON de verificación se entregan con la revisión local bajo `outputs/nortex-pos-redisenado`. El JSON y el estado local demuestran ese caso de efectivo; no certifican toda la matriz fiscal, de concurrencia, hardware o farmacia.

## Qué falta para afirmar que mejora la retención

Observar a los tres usuarios habituales de ferretería/farmacia vendiendo sin guía, medir primera venta y regreso a una segunda sesión, y recoger dónde se detienen. Los 45 registros y 3 usuarios habituales son datos aportados por el fundador, no una cohorte instrumentada. La apariencia y las pruebas de software no prueban retención ni viabilidad comercial.

Queda una fricción previa: el selector de menú cambia la navegación al instante, pero el POS toma el modo al montar; necesita volver a entrar o recargar para cambiar su composición. No se debe confundir la nueva vista sencilla con el modo completo heredado. La revisión local queda abierta ya en el modo sencillo.
