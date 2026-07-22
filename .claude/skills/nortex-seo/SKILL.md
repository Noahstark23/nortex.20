---
name: nortex-seo
description: Trabajo de SEO/marketing en Nortex — landing, blog, prerender, sitemap, keywords. Usar al tocar contenido de marketing, artículos del blog, landings de nicho, o al investigar por qué algo no indexa. El sistema tiene arquitectura propia que NO es el SPA.
---

# SEO y marketing de Nortex

## Arquitectura (lo no-obvio primero)
- **La home `/` de producción es `public/landing.html`** (estática, editorial,
  voseo, con FAQ + JSON-LD FAQPage/Organization/SoftwareApplication ya incluidos).
  `components/LandingPage.tsx` solo se ve en dev. **No duplicar JSON-LD/FAQ** al
  editarla; mantener 1 solo bloque FAQPage.
- **Las demás rutas de marketing** las sirve el backend desde
  `dist/<ruta>/index.html`, generadas por `scripts/prerender.ts` en `build:seo`
  (`vite build && tsx scripts/prerender.ts`). El prerender emite: título,
  description y **canonical auto-referente** únicos por ruta + contenido VISIBLE
  + JSON-LD + `dist/sitemap.xml` dinámico. El Dockerfile corre `build:seo`.
- **Blog**: contenido en `data/blog-posts.ts` (markdown en `content`, FAQ en
  `faqs`), taxonomía en `data/blog-clusters.ts`. `post.cluster` referencia al
  clúster **por `name` EXACTO** (no slug). El pilar del clúster se define con
  `cluster.pillarSlug`. Rutas SPA: `/blog`, `/blog/:slug`,
  `/blog/categoria/:slug` (lazy con Suspense global en `App.tsx`).

## Reglas de contenido
- Español nicaragüense con **voseo** ("tenés", "llevás"); precios en C$;
  referencias locales (DGI, Serie A/B, IVA 15%, Ley 185, INSS, alcaldía).
- Keyword objetivo en un **H2 del cuerpo** (el título/meta solos no bastan) +
  intención informativa separada de la comercial.
- Contenido para crawlers SIEMPRE visible — jamás divs ocultos (`left:-9999px`
  es señal de spam; ya se eliminó una vez).
- Artículo nuevo = objeto en `blog-posts.ts` con `slug/title/description/date/
  readTime/category/cluster(name)/content` (+ `faqs`, `pillar`, `keyword`).
  El prerender y el sitemap lo recogen solos.

## Verificación (siempre tras tocar marketing)
```bash
npx tsc --noEmit                 # blog-posts.ts es TS: una coma rota tumba el build
npm run build:seo                # debe terminar "✅ Prerender: N rutas ... sitemap"
grep -c "<title>" dist/blog/<slug-nuevo>/index.html   # título único presente
```
- N rutas debe CRECER al agregar contenido; si cae, algo se desconectó.
- Tag-balance si se editó `landing.html`: `grep -o '<div' | wc -l` == `</div>`.

## Trampas reales del repo
- Ediciones paralelas del blog en dos ramas → merges manuales apilaron versiones
  y **destruyeron 46 artículos** + rompieron el build. Si un archivo de blog
  aparece con campos duplicados/arrays sin cerrar: reconstruir desde git history
  (último estado limpio = `<merge>^1`), no re-mezclar a mano.
- `App.tsx` con `Blog/BlogPost` lazy: verificar que no queden declaraciones
  duplicadas tras un merge y que el param de ruta coincida con el `useParams`
  del componente (`:slug`).
- No agregar dependencias para SEO: el precache del PWA está al límite.
