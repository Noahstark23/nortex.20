# Proformas: experiencia de mostrador — candidato local 2026-09-19

## Cambio y alcance

Crear una proforma comparte ahora el catálogo compacto del POS: búsqueda normalizada por nombre, SKU, marca y categoría, categorías, cantidades seleccionadas, límite visible de 24 productos y acción para mostrar más. Enter agrega únicamente una coincidencia, sin elegir arbitrariamente entre resultados.

El recorrido es productos → cantidades → cliente → guardar. El resumen tiene controles de al menos 44px, cliente etiquetado, RUC opcional, total y una acción principal. En móvil el catálogo y el resumen se apilan. Se retiró el botón Imprimir sin handler y la promesa de un enlace público que el flujo no entregaba. Guardadas usa moneda de Nortex y estados en español.

El guardado muestra progreso, bloquea un segundo envío durante la petición y conserva datos ante errores. Cambiar entre Nueva y Guardadas conserva el borrador en memoria. No se ofrece persistencia tras recargar. El bloqueo en UI no sustituye idempotencia de servidor ni resuelve una respuesta de red incierta.

No se cambiaron precios, fórmulas fiscales, reglas de cantidad, autoridad del servidor, schema, endpoints ni traspaso al POS. Cotizar no mueve caja ni stock. No se implementó impresión/PDF ni compartir.

## Evidencia demostrada

- Antes de editar: 2 pruebas conductuales sobre el componente original caracterizaron creación y conservación ante fallo.
- Candidato final: 39 pruebas enfocadas en 5 archivos, sin omisiones: catálogo de proformas, recorrido de creación, contrato de traspaso al POS, resolución de líneas y catálogo compartido.
- Suite general durante la implementación: 377 archivos aprobados, 43 omitidos; 5.151 pruebas aprobadas y 368 omitidas. Las omitidas NO son evidencia aprobada. Los últimos ajustes se comprobaron con la suite enfocada.
- Prisma generate 6.4.1, TypeScript, sistema de diseño y build Vite/PWA aprobados. La primera comprobación TypeScript encontró cliente Prisma desactualizado; regenerarlo resolvió los errores.
- Navegador con componente real y API sintética: agregar cemento, cambiar cantidad, ingresar cliente, guardar y ver confirmación en Guardadas; escritorio 1280 × 800 y móvil 390 × 844. Verificación visual bajo los ancestros claros y oscuros de Layout. No se utilizó sesión ni base real.

Comparación del mismo producto y viewport, tema claro:

![Antes](evidence/proformas-2026-09-19/antes.png)
![Después](evidence/proformas-2026-09-19/despues.png)
![Resumen móvil](evidence/proformas-2026-09-19/movil.png)

## Defectos reproducidos y reparación

- Precios blancos sobre superficie clara: visibles con contraste en el catálogo compartido.
- Detalle fijo de 384px en móvil: resumen apilado que cabe a 390px.
- Imprimir sin acción: retirado del recorrido.
- Error de cantidad de una línea eliminada podía bloquear guardar: se limpia al quitar esa línea, con prueba ejecutable.

## Límites

No se ejecutó HTTP + MySQL ni integración transaccional: esta entrega cambia presentación y control del formulario, sin modificar lógica de dinero/stock. La API sintética comprueba interacción, no persistencia real. No se probó lector físico, sesión autenticada completa, impresión ni retención con usuarios. CI remoto, staging y producción no forman parte de esta entrega.

## Aislamiento y tamaño

Copia de trabajo en `/tmp/nortex-proformas-ux`, sin archivos de entorno. Se verificaron SHA-256 de los dos archivos existentes antes de reintegrar; no se modificó rama ni índice ni trabajo previo.

- `QuotationManager.tsx`: 865 → 840 líneas (−25).
- `CajaNicaCatalog.tsx`: 211 → 212 (+1); etiqueta opcional, el POS mantiene su valor predeterminado.
- `QuotationCatalog.tsx`: +48 líneas.
- CSS del módulo: +63 líneas.
- Total de esos archivos: 1.076 → 1.163 (+87). Es ampliación de UX, no reducción global de deuda; POS.tsx y sus presupuestos permanecen intactos.

## Corrección posterior: legibilidad de textbox

Reproducido en navegador: el buscador heredaba texto blanco sobre blanco en tema oscuro; cliente y RUC heredaban placeholder gris oscuro y cursor casi negro dentro del ticket. Se definen fondo, texto, cursor, placeholder y autocompletado por superficie, con letra de 16px. Verificado escribiendo en los campos bajo ambos temas: contraste del texto mayor que 15:1 y del placeholder mayor que 7:1 en los campos inspeccionados. Autocompletado tiene reglas explícitas, pero no se probó con un perfil que contenga datos guardados. Cambio local limitado a proformas, no certifica todos los textbox de Nortex.

![Campos corregidos](evidence/proformas-2026-09-19/textbox-corregidos.png)
