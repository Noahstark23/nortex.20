# Alta con cámara — implementación local y evidencia

Fecha: 2026-09-19. Candidato aislado: `/Users/stark/Developer/Nortex/candidates/alta-camara-20260919`, rama `codex/alta-camara-20260919`, base `67f1832502ee68ef67ac12b0803bdbfce48a4cef`. El checkout principal con cambios previos se conservó intacto. No hay commit, push, merge ni despliegue de esta entrega.

## Comportamiento implementado

- Entrada **Agregar con cámara** desde Inventario y POS; desde Compras devuelve la ficha al borrador de recepción.
- Código → consulta exacta autenticada → existente o ficha nueva. Un fallo de red, 401, 403 o 500 no habilita alta por falsa ausencia.
- **Guardar y escanear otro** vuelve al lector, limpia nombre/marca/presentación/precio y configuraciones específicas. El código recién guardado se ignora en la captura continua; escribirlo explícitamente permite consultar su ficha existente.
- **Fotografiar empaque** muestra vista previa y propone texto mediante OCR local. Se confirman las propuestas antes de aplicarlas al formulario. No se publican las fotos ni se envían a un proveedor de IA.
- Precio, unidad, IVA y control de lotes quedan bajo decisión humana. Una presentación «500 ml» no convierte automáticamente el producto en venta medida.
- Sin etiqueta comercial: código interno UUID emitido por el servidor, sin fingir que sea un GTIN.
- Borradores locales por usuario, tenant y pestaña; recuperación explícita de borradores anteriores. **Cambiar producto** conserva el borrador antes de volver al lector.
- Una respuesta perdida conserva UUID y contenido inmutables. Al retomar, consulta el resultado durable; `NOT_OBSERVED` solo permite reenviar el mismo intento. Repetirlo devuelve el mismo producto, sin repetir la auditoría.
- Rechazo por código existente durable y separado de una confirmación propia. Cambio de contenido con el mismo UUID devuelve conflicto.
- Crear ficha por este camino siempre tiene stock cero. El alta no confirma ninguna recepción. En Compras, el costo del producto recién creado queda vacío para capturarlo expresamente.
- El formulario rápido clásico también limpia marca, lote e impuesto al pasar al producto siguiente.

## Autoridad y modularidad

Se extrajo la creación clásica a `backend/services/productCreationService.ts`; tanto la ruta existente como la nueva usan esa autoridad. Se conservaron creación a stock cero, movimiento inicial clásico mediante `applyStockDelta`, Kardex y auditoría dentro de la transacción. El nuevo endpoint añade idempotencia, sin crear otro motor de stock.

| Archivo | Antes | Después | Delta |
|---|---:|---:|---:|
| `backend/server.ts` | 13190 | 13040 | -150 |
| `backend/services/productCreationService.ts` | 0 | 152 | +152 |
| `backend/services/productEnrollmentService.ts` | 0 | 44 | +44 |
| `backend/routes/productEnrollment.ts` | 0 | 30 | +30 |
| Total de esos archivos backend | 13190 | 13266 | +76 |
| `components/POS.tsx` | 5895 | 5895 | 0 |

El presupuesto del servidor bajó a 13040. La capacidad nueva vive en componentes/hooks/rutas específicos. El incremento total de código se declara expresamente; extraer no significa reducir todo el sistema.

Tabla aditiva `ProductEnrollment`: resultado JSON, hash, usuario y clave compuesta tenant/operación. Migración MySQL incluida; no se usa `--accept-data-loss`. El chequeo de roles y la sesión persistida se aplican antes de ejecutar. La consulta de recuperación exige el mismo usuario y tenant.

## OCR y sus límites

Se eligió para esta primera entrega Tesseract.js 6.0.1 con datos de español y carga diferida. Worker/modelos se sirven desde el mismo origen; los recursos pesados se excluyen del precache inicial. `predev`, `prebuild` y `prebuild:seo` preparan los assets desde dependencias bloqueadas. Sin recursos disponibles, la captura manual sigue funcionando.

La elección está basada en obtener lectura local sin credenciales ni consumo de un proveedor. **No es una conclusión de superioridad frente a OCR remoto**: falta el piloto comparativo de precisión y latencia en equipos modestos. La marca solo se propone automáticamente cuando el texto contiene una indicación explícita; de lo contrario se puede elegir una línea reconocida o escribirla. No se presume que la primera línea sea siempre una marca.

Se aplican límites de tipo/tamaño, reducción de imagen, timeout de 45 segundos, cancelación y terminación del worker. Los textos reconocidos son datos, no instrucciones. No se extraen precios, costos, IVA, stock, lotes ni vencimientos automáticamente.

Fuentes del mecanismo: [API oficial](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) y [assets locales](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md). Se validó la API instalada, sin asumir que los ejemplos antiguos representan la última versión publicada.

## Validación ejecutada

| Comprobación | Resultado |
|---|---|
| Caracterización inicial del alta, cámara y lookup | 16 casos aprobados antes de los cambios |
| Suite general Vitest | 6305 aprobados; 406 omitidos, que no cuentan como aprobados |
| Última verificación dirigida del nuevo recorrido, OCR y reinicio clásico | 19 aprobados |
| Integración requerida HTTP + MySQL 8 descartable | **421 casos, 47 suites, cero omisiones** |
| Prisma generate | Aprobado, Prisma 6.4.1 |
| TypeScript | Sin errores |
| Sistema de diseño | Aprobado en el alcance de 116 archivos del verificador |
| Build Vite + PWA | Aprobado; mantiene advertencia de tamaño de chunks |
| `git diff --check` | Sin errores |

La primera integración detectó una prueba estructural que aún buscaba el bloque de creación dentro de `server.ts`. Se actualizó para apuntar al servicio extraído manteniendo la aserción de protección de lotes. La ejecución final incluye HTTP real para caracterizar stock inicial clásico, Kardex, proveedor inválido y creación sin recepción; la búsqueda de texto no es la única evidencia.

No se cambió una fórmula de dinero; no se ejecutó mutación. Se preservó el flujo monetario vigente y se probó su integración. La suite general se ejecutó antes de los últimos ajustes locales de recuperación/OCR; esos ajustes tienen la verificación dirigida, TypeScript y build posteriores. No sumar conteos de compuertas diferentes como si fueran casos únicos.

## Recorridos observados en navegador

Entorno exclusivo de QA: frontend `http://127.0.0.1:4192`, backend loopback y MySQL efímero independiente. Cuenta y productos sintéticos; no se consultó ni modificó información de comercios reales.

1. Código nuevo confirmado → formulario → foto sintética → sugerencias → completar precio/presentación → guardado → lector del siguiente producto. El producto quedó con stock cero y marca en el catálogo.
2. Foto sintética «LECHE ENTERA / Marca: Lacteos QA / 500 ml»: propuso nombre y marca; **no reconoció la presentación**, que se completó manualmente. No atribuir precisión universal a esta prueba.
3. Siguiente código: nombre, marca, presentación y precio vacíos; sin heredar lote o IVA.
4. POS con un martillo en carrito, total C$100: abrió alta, se pulsó F4 con el panel activo, guardó un producto nuevo y conservó la venta de un producto por C$100. La nueva ficha no se agregó sola a la venta.
5. Compras con factura `QA-RECEPCION-CONSERVADA`: alta sin código → código interno → guardar y volver a recepción. Conservó el documento y añadió la línea al borrador con costo vacío. No se confirmó compra ni se movió stock.
6. Comparación visual a 390×844 del formulario clásico y el nuevo, con el mismo código de muestra, nombre, marca y precio. Son recorridos disponibles en el candidato; no una medición histórica de usuarios.

Evidencias locales en `reports/camera-enrollment/`:

- `classic-same-product.png` / `new-same-product.png`: comparación del mismo producto.
- `mobile-new-product.png`: siguiente producto sin datos heredados.
- `pos-cart-preserved.png`: venta conservada después del alta.
- `receiving-draft-preserved.png`: retorno al documento y costo pendiente.
- `candidate-files.sha256`: identificación de archivos del candidato.
- `../quality-integration/summary.json`: compuerta transaccional final.

## Lo que no está acreditado ni terminado

- Cámara óptica en Android/iPhone físicos: el navegador de QA no tenía cámara disponible. Se ejercitó el ingreso manual del código y el lector mediante pruebas de software. Foco, reflejos, empaques curvos, permisos reales y rendimiento móvil requieren el protocolo físico del plan.
- No se ejecutó el estudio de cinco usuarios/20 productos; no se afirma una reducción del 50% del tiempo ni mejora de retención.
- La lectura local puede necesitar descarga inicial de assets. No se promete primera lectura OCR sin conexión.
- El costo de catálogo conserva el contrato legacy de cero cuando está omitido. El nuevo recorrido no lo presenta como confirmado; la recepción exige capturarlo. No se implementó un estado económico global «costo desconocido».
- No se implementaron todavía códigos alternativos sobre un SKU interno, impresión de etiquetas ni conexión a catálogos externos. No reemplazar el SKU de una ficha para simular vinculación. La fase 3 del plan queda parcialmente entregada: integración POS/Compras sí; modelo de códigos alternativos no.
- No se hizo preflight de actualización de una base histórica ni despliegue. La tabla se probó en MySQL descartable; la promoción requiere las compuertas propias del release.

Las entregas 1 y 2 tienen implementación local y evidencia de software; la validación física/de usuarios y los pendientes anteriores siguen abiertos. No declarar el plan completo ni aptitud de producción con esta evidencia solamente.
