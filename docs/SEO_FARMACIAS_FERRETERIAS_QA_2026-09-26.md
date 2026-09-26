# SEO de farmacias y ferreterías: candidato para revisión

Fecha: 2026-09-26. Rama: `codex/seo-farmacias-ferreterias-20260926`, creada desde `origin/main` `a7bcca71e83b25d6254e7a095d7b52f44db7a179`. El checkout principal y el candidato anterior en `096e251` permanecen intactos. Este cambio afecta solo web pública, texto y atribución; no modifica cálculos, stock, caja, fiscalidad ni schema.

## Alcance

- `components/public/IndustryLanding.tsx`, `PublicChrome.tsx`, `LandingFarmacia.tsx`, `LandingFerreteria.tsx` y `data/sectorLandingContent.ts`: recorridos por rubro dentro del diseño público vigente, con CTA que conserva `type` y `source`, ejemplos sintéticos, límites, guías y demo ferretera.
- `scripts/prerender.ts`: metadatos, H1/H2, recorrido, guías y CTA visibles en el HTML inicial de ambas rutas. React y prerender toman el contenido sectorial de la misma fuente.
- `components/BlogPost.tsx` y `data/blog-posts.ts`: las tres guías pertinentes llevan a la página comercial correspondiente; el CTA del artículo apunta al rubro antes del registro.
- `public/landing.html` y `landing.css`: mantiene la home y el diseño vigentes en `main`; ajusta afirmaciones sin respaldo y añade enlaces visibles en sus tarjetas.
- `public/analytics.js`: `sector_cta_click` usa únicamente `vertical`, `page_kind` y `cta_location`; evita contar el mismo clic como `register_cta_click`.
- `tests/sectorAcquisition.test.tsx` y `sectorRegistration.test.tsx`: navegación, atribución y `sign_up` solo después de alta exitosa.

## Evidencia en esta rama

| Comprobación | Resultado |
| --- | --- |
| Prisma generate 6.4.1 | Aprobado. |
| `mise exec -- npx --no-install tsc --noEmit` | Aprobado. |
| `mise exec -- npm run build:seo` | Aprobado: 71 rutas y sitemap de 72 URLs. |
| HTML `dist/farmacias/index.html` y `dist/ferreterias/index.html` | Cada uno tiene un title, una description, canonical propio, H1, cuatro H2, enlace a guía y CTA con rubro/fuente. |
| HTML inicial de las tres guías | Enlace rastreable a `/farmacias` o `/ferreterias`, según corresponda. |
| Vitest dirigido a SEO, activación y experiencia pública | 8 archivos, 75 casos aprobados. |
| `mise exec -- npm run check:design` y `git diff --check` | 131 archivos revisados sin hallazgos; diff sin errores. |
| Navegador local | `/landing.html` conserva el diseño de `main`; ambas páginas sectoriales se renderizan con el mismo lenguaje visual público. A 390 px, `scrollWidth=390` en ambas. Los tres CTA de cada rubro apuntan al registro con `type` y `source` correctos; la ferretería enlaza a la demo. |

La vista local se sirvió desde `dist` en `http://127.0.0.1:8766`; ese puerto es una previsualización temporal, no publicación. El CSS de la home debe cargarse por HTTP, no abriendo `public/landing.html` mediante `file://`.

## Evidencia anterior y límites

En el candidato anterior `096e251` se ejecutó `npm run test:integration:required` con MySQL 8 descartable: 44 suites y 382 casos. También se probó con datos sintéticos un producto farmacéutico con dos lotes, aviso de vencimiento y venta que consumió el lote A por FEFO; el resumen está en el informe del candidato anterior. Esa prueba **no se repitió sobre esta rama** y no cuenta como validación transaccional de este SHA. La demo ferretera sigue siendo una práctica sin persistencia; no prueba crédito, stock o Kardex real. En el candidato anterior apareció una vez `P2034` en una lectura contable; no se atribuye ni corrige en este cambio de web pública.

No se han medido rankings, registros, activaciones o pagos posteriores a publicación. El precio/plazo de la home y el texto de 30 días deben verificarse con la oferta comercial antes de publicar. La revisión legal de afirmaciones DGI, planilla y competencia de la home completa queda fuera de este cambio sectorial.

## Medición después de publicar

| Fuente | Medida | Criterio |
| --- | --- | --- |
| Search Console | Impresiones, clics, CTR y posición media de `/farmacias` y `/ferreterias` | Comparar ventanas equivalentes tras indexación; los filtros de consulta pueden mostrar totales parciales. |
| Analítica pública | Visita, `sector_cta_click`, `sign_up` por rubro/fuente | Un clic no es alta; `sign_up` requiere respuesta exitosa. `begin_trial` no es pago. |
| Datos internos reconciliados | Primera venta/activación y pago por rubro | No inferir ingresos ni activación desde GA4. |

La línea base del encargo, no medida de nuevo aquí, para consultas con `farmaci` fue 334 impresiones, 0 clics y posición media 8,6; para `ferreter`, 7 impresiones, 1 clic y posición media 6,9 (25/06–24/09/2026). No representa el rendimiento exclusivo de las páginas comerciales.

Push de esta rama es entrega de código para revisión. CI, merge, staging, producción e indexación requieren evidencias y autorizaciones separadas.
