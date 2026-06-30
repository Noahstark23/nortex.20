// scripts/prerender.ts
// Ejecutar DESPUÉS de `vite build` (ver el script "build:seo" en package.json).
//
// PROBLEMA QUE RESUELVE: el SPA servía el MISMO index.html (mismo <title>,
// misma description y canonical apuntando a la home) para TODAS las rutas, así
// que Google las veía como duplicados de la home y no las indexaba.
//
// QUÉ HACE:
//   1. Genera un HTML estático por ruta de marketing (dist/<ruta>/index.html)
//      con título, descripción y canonical AUTO-REFERENTE únicos, Open Graph,
//      JSON-LD y contenido VISIBLE (no oculto) para los crawlers. React
//      reemplaza ese contenido al montar en #root (createRoot, no hydrateRoot →
//      sin mismatch).
//   2. Genera dist/sitemap.xml dinámicamente desde las rutas + posts + clústeres
//      para que no haya que mantenerlo a mano al crecer el blog.
import fs from 'fs';
import path from 'path';
import { blogPosts, postsByCluster } from '../data/blog-posts';
import { blogClusters, orderedClusters, getCluster } from '../data/blog-clusters';
import { markdownToHtml, escapeHtml } from '../utils/markdown';
import { postJsonLdBlocks, breadcrumbJsonLd } from '../utils/seo';

const DIST = path.join(process.cwd(), 'dist');
const ORIGIN = 'https://somosnortex.com';

const shell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');

const esc = escapeHtml;

interface RouteSEO {
    path: string;        // p.ej. '/ferreterias'
    title: string;
    description: string;
    h1: string;
    body: string;        // HTML visible del bloque SEO
    jsonLd?: object[];    // bloques JSON-LD (Article, FAQPage, BreadcrumbList…)
    priority: number;    // prioridad para el sitemap
    changefreq: string;  // frecuencia para el sitemap
    lastmod: string;     // YYYY-MM-DD
}

const TODAY = '2026-06-30';

// ── Rutas de marketing (landings de nicho + institucionales) ──
// La home ('/') NO va aquí: se sirve desde landing.html (estático aparte).
const routes: RouteSEO[] = [
    {
        path: '/ferreterias',
        title: 'Software para Ferreterías en Nicaragua | POS + Inventario | Nortex',
        description: 'Sistema de punto de venta e inventario para ferreterías en Nicaragua. Control de stock por código, facturación DGI y crédito a clientes. Prueba gratis 30 días.',
        h1: 'Software de facturación e inventario para ferreterías en Nicaragua',
        body: `
      <p>Nortex es el sistema POS pensado para ferreterías nicaragüenses: controla miles de productos por código, factura cumpliendo la DGI y gestiona el crédito de tus clientes en un solo lugar.</p>
      <h2>Hecho para el día a día de una ferretería</h2>
      <ul>
        <li>Punto de venta rápido con búsqueda por código o nombre</li>
        <li>Inventario en tiempo real con alertas de stock mínimo y Kardex</li>
        <li>Facturación DGI con Series A y B y constancias de retención</li>
        <li>Cuentas por cobrar y crédito a clientes frecuentes</li>
        <li>Reportes de ventas, márgenes y productos más vendidos</li>
      </ul>
      <p>Empieza gratis por 30 días, sin tarjeta de crédito.</p>`,
        priority: 0.9,
        changefreq: 'monthly',
        lastmod: '2026-06-04',
    },
    {
        path: '/farmacias',
        title: 'Software para Farmacias en Nicaragua | Control de Lotes y Caducidad | Nortex',
        description: 'Sistema POS e inventario para farmacias en Nicaragua: control de lotes, fechas de caducidad, facturación DGI y Kardex. Prueba gratis 30 días.',
        h1: 'Sistema de inventario y facturación para farmacias en Nicaragua',
        body: `
      <p>Nortex ayuda a las farmacias de Nicaragua a controlar lotes y fechas de caducidad, evitar pérdidas por vencimiento y facturar cumpliendo la DGI.</p>
      <h2>Diseñado para el control que exige una farmacia</h2>
      <ul>
        <li>Control de inventario por lote y fecha de caducidad (FEFO)</li>
        <li>Alertas de productos próximos a vencer</li>
        <li>Facturación DGI con Series A y B</li>
        <li>Kardex y trazabilidad de cada movimiento</li>
        <li>Reportes de ventas y rotación de productos</li>
      </ul>
      <p>Prueba Nortex gratis por 30 días y deja de perder dinero por vencimientos.</p>`,
        priority: 0.9,
        changefreq: 'monthly',
        lastmod: '2026-06-04',
    },
    {
        path: '/nicaragua',
        title: 'Sistema de Facturación DGI para PyMES en Nicaragua | Nortex',
        description: 'Sistema de facturación, inventario y nómina para PyMES en Nicaragua. Cumple DGI 2026 y la Ley 185. Prueba gratis 30 días, soporte local.',
        h1: 'El sistema de facturación e inventario para PyMES de Nicaragua',
        body: `
      <p>Nortex es la plataforma todo-en-uno para pequeñas y medianas empresas de Nicaragua: facturación compatible con la DGI, inventario, punto de venta, nómina según la Ley 185 y contabilidad.</p>
      <h2>Todo lo que tu negocio necesita, en regla</h2>
      <ul>
        <li>Facturación DGI 2026 (Series A y B, retenciones IR/IVA)</li>
        <li>Punto de venta e inventario en tiempo real</li>
        <li>Nómina y planillas según el Código del Trabajo (Ley 185)</li>
        <li>Reportes financieros y contabilidad</li>
        <li>Soporte local en español</li>
      </ul>
      <p>Prueba gratis por 30 días. Sin papeleos, sin instalaciones.</p>`,
        priority: 0.8,
        changefreq: 'monthly',
        lastmod: '2026-06-04',
    },
    {
        path: '/register',
        title: 'Crear cuenta gratis | Nortex — Facturación e Inventario Nicaragua',
        description: 'Crea tu cuenta de Nortex y prueba gratis 30 días el sistema de facturación, inventario y punto de venta para PyMES en Nicaragua.',
        h1: 'Crea tu cuenta gratis en Nortex',
        body: `<p>Empieza a facturar con la DGI y a controlar tu inventario hoy mismo. 30 días gratis, sin tarjeta de crédito.</p>`,
        priority: 0.8,
        changefreq: 'monthly',
        lastmod: '2026-06-04',
    },
    {
        path: '/blog',
        title: 'Blog Nortex | Facturación DGI, Nómina y Gestión de PyMES en Nicaragua',
        description: 'Guías prácticas sobre facturación DGI, nómina según la Ley 185, retenciones IR e IVA y gestión de PyMES en Nicaragua.',
        h1: 'Blog de Nortex: guías para PyMES de Nicaragua',
        body: `
      <p>Recursos prácticos sobre facturación, impuestos y gestión de negocios en Nicaragua.</p>
      <h2>Explorá por tema</h2>
      <ul>
        ${orderedClusters().map(c => `<li><a href="/blog/categoria/${c.slug}">${esc(c.name)}</a> — ${esc(c.intro)}</li>`).join('\n        ')}
      </ul>
      <h2>Últimos artículos</h2>
      <ul>
        ${blogPosts.map(p => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a> — ${esc(p.description)}</li>`).join('\n        ')}
      </ul>`,
        priority: 0.7,
        changefreq: 'weekly',
        lastmod: TODAY,
    },
    {
        path: '/privacy',
        title: 'Política de Privacidad | Nortex',
        description: 'Política de privacidad de Nortex: cómo recolectamos, usamos y protegemos los datos de tu negocio.',
        h1: 'Política de Privacidad',
        body: `<p>Conoce cómo Nortex protege la información de tu negocio y tus clientes.</p>`,
        priority: 0.3,
        changefreq: 'yearly',
        lastmod: '2026-02-12',
    },
    {
        path: '/terms',
        title: 'Términos y Condiciones | Nortex',
        description: 'Términos y condiciones de uso del servicio Nortex.',
        h1: 'Términos y Condiciones',
        body: `<p>Condiciones de uso del servicio Nortex.</p>`,
        priority: 0.3,
        changefreq: 'yearly',
        lastmod: '2026-02-12',
    },
];

// ── Hubs de clúster (uno por clúster en data/blog-clusters.ts) ──
for (const cluster of blogClusters) {
    const posts = postsByCluster(cluster.slug);
    const items = posts
        .map(p => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a> — ${esc(p.description)}</li>`)
        .join('\n        ');
    routes.push({
        path: `/blog/categoria/${cluster.slug}`,
        title: cluster.metaTitle,
        description: cluster.metaDescription,
        h1: cluster.h1,
        body: `
      <p>${esc(cluster.intro)}</p>
      <ul>
        ${items || '<li>Pronto publicaremos contenido en esta categoría.</li>'}
      </ul>`,
        jsonLd: [
            breadcrumbJsonLd([
                { name: 'Blog', path: '/blog' },
                { name: cluster.name, path: `/blog/categoria/${cluster.slug}` },
            ], ORIGIN),
        ],
        priority: 0.6,
        changefreq: 'weekly',
        lastmod: TODAY,
    });
}

// ── Artículos del blog (uno por slug en data/blog-posts.ts) ──
for (const post of blogPosts) {
    const cluster = getCluster(post.cluster);
    routes.push({
        path: `/blog/${post.slug}`,
        title: `${post.title} | Nortex Blog`,
        description: post.description,
        h1: post.title,
        body: markdownToHtml(post.content),
        jsonLd: cluster
            ? postJsonLdBlocks(post, cluster.name, cluster.slug, ORIGIN)
            : [],
        priority: post.isPillar ? 0.8 : 0.7,
        changefreq: 'monthly',
        lastmod: post.date,
    });
}

function buildHtml(route: RouteSEO): string {
    const url = `${ORIGIN}${route.path}`;
    let html = shell;

    const swap = (re: RegExp, replacement: string) => {
        if (re.test(html)) html = html.replace(re, replacement);
    };

    swap(/<title>[\s\S]*?<\/title>/, `<title>${esc(route.title)}</title>`);
    swap(/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/?>/, `<meta name="description" content="${esc(route.description)}" />`);
    swap(/<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/?>/, `<link rel="canonical" href="${url}" />`);
    swap(/<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/?>/, `<meta property="og:url" content="${url}" />`);
    swap(/<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/?>/, `<meta property="og:title" content="${esc(route.title)}" />`);
    swap(/<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/?>/, `<meta property="og:description" content="${esc(route.description)}" />`);

    // JSON-LD (datos estructurados) antes de cerrar el <head>.
    if (route.jsonLd && route.jsonLd.length > 0) {
        const scripts = route.jsonLd
            .map(block => `<script type="application/ld+json">${JSON.stringify(block)}</script>`)
            .join('\n    ');
        html = html.replace('</head>', `    ${scripts}\n  </head>`);
    }

    // Contenido VISIBLE para crawlers; React lo reemplaza al montar en #root.
    const seoBlock = `<div id="root"><div data-prerender="seo" style="max-width:820px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;line-height:1.6"><h1>${esc(route.h1)}</h1>${route.body}</div></div>`;
    html = html.replace(/<div id="root">\s*<\/div>/, seoBlock);

    return html;
}

let count = 0;
for (const route of routes) {
    const outDir = path.join(DIST, route.path);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), buildHtml(route), 'utf-8');
    count++;
}

// ── Sitemap dinámico ──
// La home va siempre primero; el resto sale de las rutas prerenderizadas.
function buildSitemap(): string {
    const entries = [
        { loc: `${ORIGIN}/`, lastmod: '2026-06-04', changefreq: 'weekly', priority: '1.0' },
        ...routes.map(r => ({
            loc: `${ORIGIN}${r.path}`,
            lastmod: r.lastmod,
            changefreq: r.changefreq,
            priority: r.priority.toFixed(1),
        })),
    ];
    const urls = entries
        .map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

fs.writeFileSync(path.join(DIST, 'sitemap.xml'), buildSitemap(), 'utf-8');

console.log(`✅ Prerender: ${count} rutas → dist/<ruta>/index.html (títulos, canonical, JSON-LD y contenido únicos)`);
console.log(`✅ Sitemap: dist/sitemap.xml con ${routes.length + 1} URLs`);
