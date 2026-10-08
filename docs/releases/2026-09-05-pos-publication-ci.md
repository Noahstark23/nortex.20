# POS: publicación y revisión de integración del 5 de septiembre

La publicación de la rama y el PR #204 fue autorizada. El PR permanece en borrador;
esta autorización no incluye merge a main, staging ni producción. La identidad
final y las ejecuciones quedan registradas en el PR y el paquete de entrega.

## Base y alcance

Durante CI, main avanzó de `2834497f6090c2d55bcc48d5edb86887f6993ae3` a
`d9cdd7cefb1724ab2fab65458f6aadaf531c339a` mediante los PR #203 y #202. Se integra
esa base conservando la eliminación de Capital de la interfaz, el score del panel
admin y el pago a proveedores desde la caja. La lectura de score por otras rutas
existentes no queda deshabilitada por ocultar esa interfaz.

No cambia el schema ni hay nuevas migraciones. Stock S1 continúa en otra rama.
La imagen previamente comprobada de `5c5d307` es evidencia de aquel candidato;
no acredita esta integración ni sustituye staging del SHA final.

## Fallo de las pruebas POS

El primer CI agotó cinco segundos al construir un ticket de 20 líneas. La escritura
pendiente continuaba sobre el foco del caso siguiente y mezclaba sus SKU. Se espera
el catálogo visible y se prepara cada SKU completo con paste + Enter; los otros
recorridos mantienen mecanografía por carácter. Se conservan todas las aserciones.

El segundo CI aprobó los otros 19 casos del archivo y sólo agotó el recorrido de
20 líneas. Ese `it.each` tiene ahora un margen local de 15 segundos; no se modifica
la configuración global. Es una comprobación funcional, no un benchmark del POS.
El tercer CI pasó las pruebas generales; los runs anteriores siguen registrados
como fallidos y no se convierten retrospectivamente en aprobación.

## Cruces financieros encontrados y reparados

1. La ruta de abono rechazaba CASH sin caja abierta antes de consultar el intento
   ya confirmado. Pago → cierre de la última caja → mismo evento devolvía 409.
   Ahora el servicio comprueba el replay antes de exigir caja para un pago nuevo.
   El mismo evento y datos devuelven el resultado sin efectos; otro importe o un
   pago nuevo sin caja se rechazan.
2. El abono conservaba correctamente su salida firmada y asiento CxP/Caja, pero su
   registro `Expense` de categoría `PAGO_PROVEEDOR` también aparecía como gasto en
   Dashboard, reporte de gastos y serie diaria de ventas. Un abono de C$25 bajaba
   la utilidad en C$25 mientras el estado de resultados permanecía igual. Los tres
   consumidores excluyen esa categoría usando la constante del productor.
   Dashboard agrega en SQL y el reporte agrupa por categoría en SQL.

Se preservan Expense, movimiento firmado, asiento, auditoría e históricos. Los
gastos operativos reales y sus compensaciones negativas siguen participando en
los reportes. Esta corrección clasifica el pago a proveedores; no certifica todas
las categorías históricas del sistema como conciliadas.

## Evidencia y límites

- Reproducción HTTP + MySQL: 10 casos aprobados y 2 fallidos antes del arreglo.
- Después: 12/12 compras, cero omitidos, incluyendo replay tras cierre, rechazo de
  datos distintos, caja/CxP, ledger, asiento/auditoría únicos y reporte cerrado
  inmutable. Un gasto de C$7,50 sí cuenta; su reverso de -C$7,50 restaura la base.
- Suite general tras el arreglo: 4.562 aprobadas; 138 omitidas por requerir entorno.
- TypeScript y build SEO de los componentes integrados aprobados localmente.
- Compuerta MySQL obligatoria: 19 suites, 152 casos aprobados, cero omitidos.
  CI del commit publicado se reporta por separado en el PR. Los tests de
  proveedores con mocks no sustituyen la prueba HTTP.
- Mutación protege el alcance configurado; no cubre completos los servicios de
  proveedores, scoring ni las consultas de reportes reparadas aquí.
- QA visual de la integración, staging exacto, configuración de Coolify y promoción
  conservan sus verificaciones y autorizaciones propias. No se desplegó desde
  esta publicación.
