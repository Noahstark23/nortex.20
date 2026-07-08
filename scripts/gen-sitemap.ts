// scripts/gen-sitemap.ts
// Genera public/sitemap.xml de forma DINÁMICA a partir de la data del blog
// (data/blog-posts.ts) y la taxonomía (data/blog-taxonomy.ts), más las rutas de
// marketing/institucionales. Antes el sitemap era estático y había que editarlo
// a mano por cada artículo; con cientos de posts eso no escala.
//
// Se ejecuta ANTES de `vite build` en el script "build:seo": escribe el sitemap
// en public/ y Vite lo copia a dist/. También se puede correr suelto para
// refrescar el archivo versionado.
import fs from 'fs';
import path from 'path';
import { blogPosts } from '../data/blog-posts';
import { SITE_ORIGIN, clustersWithPosts, postsByCluster } from '../data/blog-taxonomy';

// Fechas estables para rutas que no derivan de la data del blog (evita churn en
// cada build). Actualizar a mano si cambia el contenido de esas páginas.
const MARKETING_LASTMOD = '2026-06-30';
const LEGAL_LASTMOD = '2026-02-12';

interface UrlEntry {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: string;
}

const entries: UrlEntry[] = [];
const add = (pathname: string, lastmod: string, changefreq: string, priority: string) =>
  entries.push({ loc: `${SITE_ORIGIN}${pathname}`, lastmod, changefreq, priority });

// ── Rutas de marketing e institucionales ──
add('/', MARKETING_LASTMOD, 'weekly', '1.0');
add('/ferreterias', MARKETING_LASTMOD, 'monthly', '0.9');
add('/farmacias', MARKETING_LASTMOD, 'monthly', '0.9');
add('/nicaragua', MARKETING_LASTMOD, 'monthly', '0.8');
add('/register', MARKETING_LASTMOD, 'monthly', '0.8');
add('/blog', MARKETING_LASTMOD, 'weekly', '0.7');
add('/terms', LEGAL_LASTMOD, 'yearly', '0.3');
add('/privacy', LEGAL_LASTMOD, 'yearly', '0.3');

// ── Hubs de categoría (solo clústeres con artículos) ──
for (const cluster of clustersWithPosts()) {
  const posts = postsByCluster(cluster.slug);
  // lastmod del hub = fecha más reciente de sus artículos.
  const lastmod = posts
    .map(p => p.updated ?? p.date)
    .sort()
    .reverse()[0] ?? MARKETING_LASTMOD;
  add(`/blog/categoria/${cluster.slug}`, lastmod, 'weekly', '0.6');
}

// ── Artículos del blog ──
for (const post of blogPosts) {
  add(`/blog/${post.slug}`, post.updated ?? post.date, 'monthly', '0.7');
}

const body = entries
  .map(
    e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
  )
  .join('\n\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${body}

</urlset>
`;

const outPath = path.join(process.cwd(), 'public', 'sitemap.xml');
fs.writeFileSync(outPath, xml, 'utf-8');
console.log(`✅ Sitemap: ${entries.length} URLs → public/sitemap.xml`);
