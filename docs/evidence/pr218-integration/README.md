# PR #218 — integración y sellado, 2026-10-09

Main de preparación: `89e1620dcc27f548b75420c2b3a598af62aa1931`.
Head original: `519ec69eb725cde95173ce576b3b809e3574dabc`.
Commit de fuentes integradas, anterior a este sello:
`f9638d94ef7347e442f63653711a18e5996bac7b`.
Árbol de esas fuentes: `e04dd8e72b4587f3c377bb6e641c437c9618865b`.

Se conserva el alcance original: descuento global y por línea visible en ambos
modos del POS, incluido el recorrido de primera venta. El control por línea
conserva `!isQuotationLine`. No cambia una fórmula de precio, impuesto, deuda,
stock o autorización del servidor. Las siete pruebas de selección de modo se
conservan en el archivo renombrado y se añaden seis casos de descuento visible.

La nueva base añadió un sello de fuentes después del PR original. Se reprodujo
el bloqueo: `tests/nortexDeployment.test.mjs` tuvo un fallo por
`NORTEX_PRODUCT_SOURCE_MISMATCH` y ocho casos aprobados. Se actualizan únicamente
`product-files.json.origin` y la entrada POS, calculada del archivo integrado:
`48d24322f5f395470cec08ae5cd5a4fa75ef106e852ef519b76580b1c0224250`.
Las otras siete entradas, los contratos staging/production, workflows,
compuertas, backend y esquema conservan sus bytes de main.

## Verificaciones locales nuevas

Runtime Node 22.23.2 y Prisma 6.4.1; entorno acotado sin credenciales reales.

- Prisma generate/validate y `git diff --check`: aprobados.
- Cinco suites dirigidas de POS, navegación y sello: 71 casos aprobados.
- `sh scripts/ci-local-safe.sh`: exit 0; tipos, diseño y build aprobados.
  Suite general: 518 archivos y 7.498 casos aprobados; 63 archivos/612 casos
  omitidos por su configuración. Los omitidos no se presentan como aprobados.
- `npm run test:integration:required`: exit 0; las 64 suites requeridas y sus
  626 casos HTTP/MySQL 8 pasaron, sin omisiones, contra Colima efímero sintético.
- `npm run build:seo`: exit 0; prerender de 71 rutas y sitemap de 72 URLs.
  La primera invocación falló por bloqueo sandbox del IPC local de tsx; se
  conservó el log y se repitió el mismo comando con permiso para ese IPC, sin
  modificar el producto.

## Límites y revisión

No se ejecutó Stryker: este incremento cambia visibilidad, no lógica monetaria
pura. Las pruebas negativas del sello y los presupuestos existentes siguen
activos. No hay una nueva prueba visual en navegador físico; el render y el
recorrido de venta se comprobaron en jsdom. La captura histórica del PR conserva
su fecha y no se presenta como evidencia nueva.

Este documento registra pruebas locales; el CI y la revisión independiente del
head publicado se registran por separado. CI no acredita staging ni producción.
No se despliega ni se concede acceso. El candidato sigue en borrador hasta la
revisión independiente; no se fusiona por autoaprobación.
