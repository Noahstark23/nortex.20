# Auditoría y reparación de bodega y productos

Fecha: 12 de septiembre de 2026. Alcance: catálogo, alta, edición, importación, cantidades, bodegas, traslados, conteos, reposición, órdenes de compra y recepción/facturación. Se auditó el código local existente y se probó una copia aislada con MySQL 8 descartable. No se inspeccionaron datos de comerciantes ni producción.

## Diagnóstico

La dificultad tiene causas concretas en el producto. Nortex obligaba a conocer sus módulos internos para resolver tareas sencillas; presentaba dos altas divergentes y demasiadas opciones juntas; confundía la ficha del producto con los movimientos físicos; perdía borradores o confirmaciones; y algunas operaciones aparentemente sencillas podían alterar existencias o dinero incorrectamente. Esto exige corregir comportamiento y organización, además de etiquetas.

El diseño recomendado para un comercio es: crear la ficha una vez; recibir cada entrada en su bodega; trasladar con origen, destino y comprobante; registrar pérdidas o sobrantes con motivo; contar por bodega/categoría y revisar diferencias. Las compras pendientes sirven para decidir qué pedir, pero no son mercadería disponible. La recepción física y la factura deben conservar su vínculo para que facturar no sume stock nuevamente.

## Prácticas investigadas y aplicación a Nortex

| Práctica | Aplicación concreta |
|---|---|
| Separar catálogo y operaciones | Nombre, código, unidad y precio pertenecen a la ficha. Recepción, traslado, venta, devolución y ajuste producen movimientos identificados. Importar una lista de precios no debe cambiar existencias. |
| Una unidad base clara y conversiones explícitas | Definir si se venden enteros o medidas; registrar cuántas unidades contiene el empaque. Una caja no implica automáticamente venta fraccionaria. Odoo documenta unidades y empaques como configuraciones explícitas. [Fuente](https://www.odoo.com/documentation/19.0/es/applications/inventory_and_mrp/inventory/product_management/configure/uom.html). |
| Diferenciar físico, disponible y pendiente | Lo pedido todavía no recibido no está disponible. La documentación de Shopify distingue existencias físicas, disponibles, comprometidas, no disponibles y entrantes. Nortex descuenta ahora OC pendientes de su sugerencia de compra; una taxonomía completa por bodega sigue siendo una ampliación pendiente. [Fuente](https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states). |
| Contar y aplicar la diferencia con evidencia vigente | Odoo separa cantidad del sistema, cantidad contada y aplicación del ajuste. Nortex registra el saldo al capturar; si cambia antes del cierre, exige reconteo. Un producto no contado no equivale a cero. [Fuente](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html). |
| Controles según el producto | Para productos con vencimiento, identificar lote y fecha real y priorizar la salida de los que vencen antes. FEFO usa vencimiento, no solamente fecha de entrada. Nortex conserva los controles específicos de lotes y series; un ajuste genérico no puede evitarlos. [Fuente](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html). |

Estas referencias sustentan decisiones de diseño; no acreditan cumplimiento regulatorio ni prueban que copiar todas las funciones de otro ERP sea apropiado. Para Nortex, la propuesta es una operación sencilla con trazabilidad proporcional al producto.

Como rutina física, conviene rotular las ubicaciones reales, separar recepción pendiente de verificar de mercadería disponible, revisar cantidades/lotes antes de ingresar y contar por grupos manejables. La frecuencia se debe acordar con cada comercio según rotación y diferencias observadas; no se impuso una frecuencia universal ni se creó una bodega ficticia por categoría.

## Recorrido corregido

| Necesidad de la persona | Acción y resultado |
|---|---|
| “Quiero agregar lo que vendo” | **Nuevo Producto** abre cinco campos visibles: nombre, código, precio, forma y unidad. Opciones especiales desplegables y Guardar siempre accesible. La ficha completa continúa disponible. |
| “Llegó mercadería” | **Recibir mercadería** lleva al flujo permitido por el rol. Elegir proveedor/bodega, cantidades y lotes; una recepción de OC conserva su identidad. Facturar lo recibido precarga el documento y no suma de nuevo. |
| “Pasé producto a otra bodega” | **Trasladar** aparece con texto. Se solicita destino y cantidad; el historial muestra el comprobante de movimiento inmediato. No se presenta como tránsito pendiente. |
| “Lo que tengo no coincide” | **Contar existencias** permite una bodega y una categoría. Guarda capturas, conserva fallos pendientes y bloquea el cierre hasta confirmar los guardados. Una pérdida/sobrante aislado requiere motivo y su propio movimiento. |
| “¿Qué debo comprar?” | Reposición considera existencias más OC aprobadas pendientes de recibir, con cantidades y costos exactos, mínimo configurado y páginas explícitas. Conserva cambios humanos y actualiza sugerencias automáticas. |

## Reparaciones y evidencia por dominio

Los IDs son de los inventarios originales; algunos describen el mismo defecto desde UI y backend, por lo que no deben sumarse como defectos distintos. Cada informe enlazado conserva archivo/línea de la base, escenario, gravedad, reparación y pruebas. Una localización de la base puede haber cambiado tras la extracción.

| Dominio | Reparaciones principales | Inventario detallado |
|---|---|---|
| Catálogo e importación C01–C18 | Opcionales y ceros explícitos preservados; columnas de plantilla/export reconocidas; coma física correcta; stock inicial sólo en altas con bodega seleccionada; transacción por fila; rechazados corregibles y resultados inciertos visibles; alta/edición sin reenvíos; resumen parcial no desaparece; historial protegido contra DELETE. | [Catálogo](audit-bodega/catalog-findings.md), [importación backend](audit-bodega/import-backend-findings.md), [borrado](audit-bodega/deletion-findings.md). |
| Recorrido UX01–UX10 | Alta directa, enlaces a tareas, lotes/Kardex sin datos anteriores ante error, campos comerciales editables, respuestas viejas descartadas, errores distintos de cero, total heterogéneo eliminado, lector bloqueado por paneles. | [Inventario y navegación](audit-bodega/inventory-findings.md). |
| Cantidades | `unidad`, `unidades`, `caja` y `cajas` sin configuración se tratan como enteros. Configuración medida explícita y snapshots de documentos anteriores se conservan. Misma regla para venta nueva, compra, catálogo público y traslado. | `utils/productQuantityRules.ts`; pruebas de cantidades, compra, pedidos y replay históricos. |
| Bodegas y conteos W01–W15 | Capturas serializadas, borrador recuperable, reconteo del mismo número, captura del saldo físico a cuatro decimales, cierre con snapshot vigente, cambio de principal sin mover stock legado, desactivación segura y locks consistentes con ventas. Conteos abiertos no desaparecen tras 100 históricos. | [Bodegas](audit-bodega/warehouse-findings.md), `tests/bodegaStockCountHistory.integration.test.ts`. |
| Compras RC01–RC22 | Facturación CLOSED_SHORT de lo realmente recibido, costo de seis decimales, IVA por línea, OC/reintentos estables, borradores, dos lotes en compra directa, facturación precargada, errores precisos, carreras de consulta/bodega corregidas y edición bloqueada durante envío y coma decimal sin multiplicar cantidades/costos/abonos. | [Compras y recepción](audit-bodega/receiving-findings.md). |
| Ajustes y reposición | Ajuste con UUID durable y efectos atómicos sobre stock, Kardex, asiento y auditoría; período cerrado respetado; compras/devoluciones/lotes/series requieren su flujo. Reposición neta con OC entrantes y paginación SQL. | [Ajustes y reposición](audit-bodega/adjustment-reorder-findings.md). |

### Escenarios transaccionales que importan

- Reimportar SKU/nombre/precio mantiene costo, unidad, mínimo y existencias omitidos. Un fallo de auditoría inducido revierte toda la fila.
- Escribir `0,125` envía `0.125`, costo `1,234567` conserva seis decimales y abono `1,25` envía `1.25`. Antes la coma se borraba y multiplicaba esos valores; formatos ambiguos ahora bloquean el envío.
- Solicitar 10, recibir 6 y cerrar las 4 restantes permite facturar 6; no genera una segunda entrada de stock.
- Dos líneas gravadas de C$0.10 muestran y registran el mismo total de C$0.24.
- Repetir un ajuste con el mismo UUID devuelve el mismo movimiento, incluso después de reiniciar Node. Cambiar el payload del mismo UUID se rechaza.
- Cambiar de bodega principal preserva el stock legado y su suma. Competir una configuración administrativa con un consumidor de stock no invierte los locks.
- Saldo Float `0.1 + 0.2` y captura `0.3` cierran sin ajuste artificial; un movimiento real de `0.0001` exige reconteo.
- El borrado físico que cascaba producto, lotes, conteos y Kardex fue reproducido. Ahora devuelve 409 y conserva los registros. **Bloqueo de borrado no significa archivado global implementado.**

### Autoridad del pago de compras y corte de caja

Se reprodujo que una compra de contado sin turno propio descontaba C$23 de la última gaveta ajena. El registro y el preview ahora exigen turno propio OPEN y lo bloquean durante el pago. Confirmar un replay de una compra anterior sigue siendo posible después de cerrar el turno.

La prueba concurrente expuso otro fallo: el traspaso calculaba C$100 antes de esperar esa compra y guardaba un corte equivocado. El servicio extraído calcula y audita bajo el mismo lock; ahora registra C$77. Se preservan separación NIO/USD, ventas anuladas, crédito aplicado, permisos y rollback ante fallo de auditoría. [Escenarios y pruebas](audit-bodega/receiving-cash-authority.md).

El intento de ajuste fallido también tiene estado explícito: un rechazo de negocio durable identifica el payload exacto y evita que ese UUID se aplique después. Sólo ese comprobante permite corregir con un UUID nuevo; un error de conexión o conflicto sin evidencia mantiene la recuperación.

## Evidencia visual e interacción

Datos sintéticos: Ferretería El Roble QA, dos bodegas y seis productos iniciales. Capturas de escritorio a 1280×720; alta móvil a 390×844. El “antes” usa la copia del frontend original; no representa una captura de producción. El backend de QA evolucionó durante el trabajo, por lo que la evidencia anterior se limita al frontend observado. Las pruebas rojas específicas caracterizan los defectos de backend.

| Escenario | Antes | Después |
|---|---|---|
| Catálogo | [Vista inicial](evidence/bodega-20260912/01-catalogo-antes.png) | [Vista corregida con los mismos seis productos](evidence/bodega-20260912/11-catalogo-despues.png). |
| Alta común | [Formulario completo](evidence/bodega-20260912/02-alta-completa-antes.png), [alta rápida anterior](evidence/bodega-20260912/03-alta-rapida-antes.png) | [Cinco campos y opciones desplegables](evidence/bodega-20260912/13-alta-rapida-despues.png), [móvil](evidence/bodega-20260912/18-alta-movil-despues.png). |
| Bodegas | [Acciones con iconos](evidence/bodega-20260912/04-bodega-antes.png) | [Trasladar e historial](evidence/bodega-20260912/14-bodega-despues.png). |
| Recepción | [Formulario anterior](evidence/bodega-20260912/06-compras-antes.png) | [Formulario con alcance de cifras explícito](evidence/bodega-20260912/16-compras-despues.png). |
| Conteo | [Entrada anterior](evidence/bodega-20260912/05-conteo-antes.png) | [Navegación operativa](evidence/bodega-20260912/15-conteo-despues.png), [conteo cerrado](evidence/bodega-20260912/17-conteo-cerrado-qa.png). |

Recorrido ejecutado desde navegador: trasladar **0,25 m** de cable de Tienda principal a Bodega de reserva; la primera quedó en **18,5 m** y apareció el comprobante en el historial. Después se creó un conteo de la categoría Electricidad, se capturó **18,5** con coma decimal y se cerró **1/1, diferencia cero**. Las cantidades distintas en la captura posterior de bodega corresponden a ese traslado documentado. También se creó la ficha Brocha de prueba 2 pulgadas (QA-BROCHA-2) con precio C$75 y stock cero y se recibió una compra a crédito de 5 unidades a costo C$50 en Bodega de reserva: subtotal C$250, IVA C$37.50 y total C$287.50, confirmados por la pantalla. Esta operación de QA es posterior a las capturas comparativas de seis productos. [Compra confirmada](evidence/bodega-20260912/19-recepcion-registrada-qa.png) y [existencias en destino](evidence/bodega-20260912/20-existencias-destino-qa.png). La verificación posterior en la base comprobó que los siete agregados coinciden con la suma por bodega y que el producto con lotes conserva su suma física.

La inspección visual encontró y corrigió etiquetas del alta con contraste insuficiente en modo día, pese a pasar los tests. El botón Guardar cabe en la vista móvil probada. También se inspeccionó el alta en modo noche: [captura](evidence/bodega-20260912/21-alta-noche-qa.png). Los conteos de tests no sustituyen esta observación. No se midieron tiempos ni tasas de éxito con comerciantes: la mejora de comprensión y la retención siguen pendientes de evaluación humana.

## Validación del candidato

| Comprobación local | Resultado y alcance |
|---|---|
| Prisma 6.4.1 | Cliente generado desde el schema del candidato con Node 22.23.2. |
| TypeScript | `tsc --noEmit`, salida 0. |
| Vitest general | **364 archivos y 5,046 casos aprobados**; 41 archivos y **353 casos omitidos** por las condiciones de esa corrida. Los omitidos no cuentan como aprobados. |
| Integración requerida | **42 suites, 367 casos, cero omitidos**, con MySQL 8.0.43 descartable. Cada reporte se comprobó con `assertExecutedSuite`; no basta el total. [Resumen por suite](evidence/bodega-20260912/integration-summary.json). |
| Mutación completa configurada | **99.88408%**, piso **99.85%** sin reducir: 5,196 instrumentados en 55 módulos, 5,166 killed, 4 timeout, 6 survived y 20 ignored preexistentes. Cero NoCoverage. El guard de alcance pasó. Los cinco módulos de cantidades/captura modificados eliminaron **357/357**. [Desglose](evidence/bodega-20260912/mutation-summary.json). |
| Sistema de diseño | 98 archivos, cero hallazgos del comprobador. |
| Build | Producción compilada; PWA generada. Conserva avisos de tamaños de chunks y Browserslist desactualizado. No son una prueba de rendimiento. |
| Navegador y saldos | Alta, compra a crédito, traslado, conteo y modos día/noche observados. Siete productos conciliados contra sus bodegas; producto con lotes conciliado. [Escenarios](evidence/bodega-20260912/ui-verification.json). |

Las cifras de corridas dirigidas y generales se solapan; no se suman como cobertura independiente. Las transacciones completas se probaron con MySQL; la mutación cubre el alcance puro configurado y no todo el backend. Una corrida general simultánea agotó los 15 segundos de un caso de POS; la repetición final sin otras baterías corriendo pasó en 22.52 segundos totales, manteniendo el timeout original. Los intentos fallidos de preparar la compuerta de integración y su resolución están registrados en el informe de ajustes/reposición; no se presentan como corridas aprobadas.

[Resumen de verificación](evidence/bodega-20260912/verification.json) y [manifiesto de entrega y huellas del candidato](evidence/bodega-20260912/delivery-manifest.json).

El backend central pasó de **14,266 a 13,518 líneas** y el POS de **6,892 a 6,882**. El conjunto de producto afectado crece **591 líneas netas** por las reparaciones y recuperación añadidas; no se presenta como reducción global. [Deltas completos de origen, destinos y total](audit-bodega/modularity.md).

## Límites y siguiente trabajo que no se declara resuelto

| Pendiente | Efecto y criterio para cerrarlo |
|---|---|
| Archivado global y fusiones de duplicados | Se bloqueó la pérdida de historia por DELETE. Falta un ciclo de vida que retire la ficha de nuevas operaciones sin alterar documentos; requiere contrato de venta, búsqueda, importación y reactivación. |
| Varios lotes en una recepción de OC | Compra directa admite líneas por lote. La OC todavía exige recepciones separadas; ampliar el contrato de comprobante y las claves por línea, con prueba de idempotencia y recepción parcial. |
| Historial completo de compras/OC | Las cifras cargadas se etiquetan como parciales. Falta paginar los historiales y agregar totales globales; no se afirma haber recuperado toda la historia por UI. |
| Canales de pago y devoluciones de proveedor | Otros medios de pago necesitan selección explícita y conciliación. La devolución física y la nota de crédito requieren acciones normales separadas; la existencia de una API/asistente no sustituye esa interfaz. |
| Escala de catálogos masivos | El listado de existencias y el cierre de conteo conservan trabajo proporcional al catálogo. Falta paginación/captura por bloques y medir volumen alto. La creación histórica de principal mediante GET sigue siendo deuda de separación lectura/escritura. |
| Planificación avanzada y disponibilidad | Reposición trabaja agregada por producto. Falta plazo por proveedor, objetivo por bodega, reservas y tránsito como estados operativos completos. |
| Persistencia entre dispositivos y cierre de pestaña | Borradores viven por pestaña/cuenta. Los borradores de compras vencen a 24 horas; el intento de ajuste incierto no tiene TTL. Cerrar/borrar la pestaña puede perder evidencia local; no es una bandeja durable del servidor. Clientes antiguos sin UUID no deduplican ajustes. |
| Dispositivos y usuarios reales | Faltan lector físico, Android/teléfono real, red móvil y sesiones de observación con comerciantes. La emulación de tamaño no equivale a validar esos dispositivos. |

Propuesta de validación con personas: entregar una lista breve de productos a un comerciante, pedir alta, recepción parcial, traslado, conteo y corrección de una fila Excel. Medir si completa cada tarea sin ayuda, errores de cantidad/bodega, reintentos y recuperación después de una interrupción. Guardar resultados por escenario; cualquier diferencia de stock/dinero bloquea la aprobación de ese flujo.

## Entrega y estado operativo

Se trabajó en una copia aislada y se incorporaron los archivos verificados al checkout original. Antes de cada escritura se comparó la huella del archivo contra la base inicial; se guardó una copia de respaldo y se verificó igualdad con el candidato. Se conservaron la rama, el índice Git y los cambios previos del usuario. No se hizo commit, push ni deploy. El cambio de schema es aditivo: `StockCountItem.bookStockAtCapture Decimal(18,4)` nullable. Conteos anteriores sin captura vigente requieren recaptura; no se inventa un saldo histórico.

QA local, integración del código, CI, staging, migración y producción son estados separados. Este informe no autoriza ni acredita publicación o despliegue. El schema resultante se aplicó mediante `prisma db push` exclusivamente en la base descartable. La migración SQL aditiva está incluida, pero no se ejecutó sobre una base existente de desarrollo, staging o producción. Antes de arrancar este código contra otra base hay que aplicar la migración correspondiente y regenerar Prisma.
