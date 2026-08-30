// scripts/prerender.ts
// Ejecutar DESPUÉS de `vite build` (ver el script "build:seo" en package.json).
//
// PROBLEMA QUE RESUELVE: el SPA servía el MISMO index.html (mismo <title>,
// misma description y canonical apuntando a la home) para TODAS las rutas, así
// que Google las veía como duplicados de la home y no las indexaba.
//
// QUÉ HACE:
//  1. Genera un HTML estático por ruta de marketing (dist/<ruta>/index.html) con
//     título, descripción y canonical AUTO-REFERENTE únicos, Open Graph,
//     contenido VISIBLE para crawlers y JSON-LD (Article/Breadcrumb/FAQ).
//  2. Genera los hubs de clúster /blog/categoria/<slug>.
//  3. Regenera dist/sitemap.xml dinámicamente con todas las rutas.
//
// React reemplaza el contenido al montar en #root (createRoot, no hydrateRoot
// → sin mismatch).
import fs from 'fs';
import path from 'path';
import { blogPosts } from '../data/blog-posts';
import { blogClusters } from '../data/blog-clusters';
import { markdownToHtml } from '../utils/markdown';
import { CALCULADORAS } from '../utils/calculadoras';
import {
    buildArticleJsonLd,
    buildBreadcrumbJsonLd,
    buildFaqJsonLd,
    buildHowToJsonLd,
    buildCalculatorAppJsonLd,
    jsonLdScriptTags,
} from '../utils/seo';
import { pickRelatedGuides } from '../utils/related-guides';

const DIST = path.join(process.cwd(), 'dist');
const ORIGIN = 'https://somosnortex.com';
const OG_IMAGE = `${ORIGIN}/og-image.svg`;

const shell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');

interface RouteSEO {
    path: string;        // p.ej. '/ferreterias'
    title: string;
    description: string;
    h1: string;
    body: string;        // HTML visible del bloque SEO
    jsonLd?: string;     // tags <script type="application/ld+json"> ya serializados
    changefreq: string;
    priority: string;
}

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Rutas de marketing (landings de nicho + institucionales) ──
// La home ('/') NO va aquí: se sirve desde landing.html (estático aparte).
const routes: RouteSEO[] = [
    {
        path: '/ferreterias',
        title: 'Software para Ferreterías en Nicaragua | POS + Inventario | Nortex',
        description: 'Sistema de punto de venta e inventario para ferreterías en Nicaragua. Control de stock por código, facturación DGI y crédito a clientes. Prueba gratis 30 días.',
        h1: 'Software de facturación e inventario para ferreterías en Nicaragua',
        changefreq: 'monthly',
        priority: '0.9',
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
    },
    {
        path: '/farmacias',
        title: 'Software para Farmacias en Nicaragua | Control de Lotes y Caducidad | Nortex',
        description: 'Sistema POS e inventario para farmacias en Nicaragua: control de lotes, fechas de caducidad, facturación DGI y Kardex. Prueba gratis 30 días.',
        h1: 'Sistema de inventario y facturación para farmacias en Nicaragua',
        changefreq: 'monthly',
        priority: '0.9',
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
    },
    {
        path: '/nicaragua',
        title: 'Sistema de Facturación DGI para PyMES en Nicaragua | Nortex',
        description: 'Sistema de facturación, inventario y nómina para PyMES en Nicaragua. Cumple DGI 2026 y la Ley 185. Prueba gratis 30 días, soporte local.',
        h1: 'El sistema de facturación e inventario para PyMES de Nicaragua',
        changefreq: 'monthly',
        priority: '0.8',
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
    },
    {
        path: '/register',
        title: 'Crear cuenta gratis | Nortex — Facturación e Inventario Nicaragua',
        description: 'Crea tu cuenta de Nortex y prueba gratis 30 días el sistema de facturación, inventario y punto de venta para PyMES en Nicaragua.',
        h1: 'Crea tu cuenta gratis en Nortex',
        changefreq: 'monthly',
        priority: '0.8',
        body: `<p>Empieza a facturar con la DGI y a controlar tu inventario hoy mismo. 30 días gratis, sin tarjeta de crédito.</p>`,
    },
    {
        path: '/blog',
        title: 'Blog Nortex | Facturación DGI, Nómina y Gestión de PyMES en Nicaragua',
        description: 'Guías prácticas sobre facturación DGI, nómina según la Ley 185, retenciones IR e IVA y gestión de PyMES en Nicaragua.',
        h1: 'Blog de Nortex: guías para PyMES de Nicaragua',
        changefreq: 'weekly',
        priority: '0.7',
        body: `
      <p>Recursos prácticos sobre facturación, impuestos y gestión de negocios en Nicaragua.</p>
      <h2>Temas</h2>
      <ul>
        ${blogClusters.map(c => `<li><a href="/blog/categoria/${c.slug}">${esc(c.name)}</a> — ${esc(c.description)}</li>`).join('\n        ')}
      </ul>
      <h2>Artículos</h2>
      <ul>
        ${blogPosts.map(p => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a> — ${esc(p.description)}</li>`).join('\n        ')}
      </ul>`,
    },
    {
        path: '/privacy',
        title: 'Política de Privacidad | Nortex',
        description: 'Política de privacidad de Nortex: cómo recolectamos, usamos y protegemos los datos de tu negocio.',
        h1: 'Política de Privacidad',
        changefreq: 'yearly',
        priority: '0.3',
        body: `<p>Conoce cómo Nortex protege la información de tu negocio y tus clientes.</p>`,
    },
    {
        path: '/terms',
        title: 'Términos y Condiciones | Nortex',
        description: 'Términos y condiciones de uso del servicio Nortex.',
        h1: 'Términos y Condiciones',
        changefreq: 'yearly',
        priority: '0.3',
        body: `<p>Condiciones de uso del servicio Nortex.</p>`,
    },
];

// ── Hubs de clúster (/blog/categoria/<slug>) ──
for (const cluster of blogClusters) {
    const posts = blogPosts.filter(p => p.cluster === cluster.name);
    const pillar = posts.find(p => p.slug === cluster.pillarSlug);
    const supporting = posts.filter(p => p.slug !== cluster.pillarSlug);
    const listHtml = posts.length
        ? `<ul>${posts.map(p => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a> — ${esc(p.description)}</li>`).join('')}</ul>`
        : '<p>Más artículos de este tema vienen en camino.</p>';

    routes.push({
        path: `/blog/categoria/${cluster.slug}`,
        title: `${cluster.name} | Nortex Blog`,
        description: cluster.description,
        h1: cluster.name,
        changefreq: 'weekly',
        priority: '0.6',
        body: `<p>${esc(cluster.description)}</p>${pillar ? `<p><strong>Guía principal:</strong> <a href="/blog/${pillar.slug}">${esc(pillar.title)}</a></p>` : ''}${listHtml}`,
        jsonLd: jsonLdScriptTags(
            buildBreadcrumbJsonLd([
                { name: 'Blog', url: '/blog' },
                { name: cluster.name, url: `/blog/categoria/${cluster.slug}` },
            ]),
        ),
    });

    void supporting; // (el listado ya incluye a todos; variable documenta intención)
}

// ── Artículos del blog (uno por slug en data/blog-posts.ts) ──
for (const post of blogPosts) {
    const cluster = blogClusters.find(c => c.name === post.cluster);
    const breadcrumb = [
        { name: 'Blog', url: '/blog' },
        ...(cluster ? [{ name: cluster.name, url: `/blog/categoria/${cluster.slug}` }] : []),
        { name: post.title, url: `/blog/${post.slug}` },
    ];
    // Enlazado interno EN EL HTML ESTÁTICO (Palanca B): los relacionados vivían
    // solo en el render de React, así que el HTML que ve el crawler no llevaba
    // esos enlaces. Se emiten con la misma regla que la SPA (utils/related-guides).
    const relacionados = pickRelatedGuides(post, blogPosts, {
        limit: 4,
        relatedSlugs: post.relatedSlugs,
        pillarSlug: cluster?.pillarSlug,
    });
    const relatedHtml = relacionados.length
        ? `<nav aria-label="Guías relacionadas"><h2>Seguí leyendo</h2><ul>${relacionados
              .map(r => `<li><a href="/blog/${r.slug}">${esc(r.title)}</a></li>`)
              .join('')}</ul></nav>`
        : '';

    routes.push({
        path: `/blog/${post.slug}`,
        // `metaTitle` manda sobre el H1 y va SIN el sufijo "| Nortex Blog": son
        // 14 caracteres que empujaban 48 de 49 títulos por encima de los ~60 que
        // Google muestra, y el truncado se comía justo el diferenciador final.
        // Quien escribe un metaTitle se hace cargo del ancho completo.
        title: post.metaTitle ?? `${post.title} | Nortex Blog`,
        description: post.description,
        h1: post.title,
        changefreq: 'monthly',
        priority: '0.7',
        // La calculadora va ARRIBA del cuerpo, igual que en BlogPost.tsx: es lo
        // que diferencia estas guías de un artículo que el AI Overview ya resumió.
        body: (post.calculator ? calculadoraHtml(post.calculator) : '')
            + markdownToHtml(post.content) + relatedHtml,
        jsonLd: jsonLdScriptTags(
            buildArticleJsonLd(post),
            buildBreadcrumbJsonLd(breadcrumb),
            buildFaqJsonLd(post.faq),
            post.howToSteps ? buildHowToJsonLd(post.title, post.howToSteps, post.description) : null,
            // Declara la herramienta que la página realmente ofrece. Sin esto, el
            // único schema de aplicación que veía Google en esta URL era el del
            // POS, heredado del shell.
            post.calculator
                ? buildCalculatorAppJsonLd({
                      slug: post.slug,
                      name: CALCULADORAS[post.calculator].titulo,
                      description: CALCULADORAS[post.calculator].descripcion,
                  })
                : null,
        ),
    });
}

/**
 * Emite la calculadora como HTML estático y crawleable.
 *
 * El prerender no monta React, así que hasta ahora la herramienta simplemente NO
 * estaba en el HTML: Google la veía recién en el segundo pase de renderizado y
 * los crawlers de IA —que no ejecutan JS— nunca. Para ellos una guía con
 * calculadora era indistinguible de un artículo de texto, que es justo lo que un
 * AI Overview responde sin que nadie haga clic.
 *
 * Lo que se emite es la herramienta REAL (encabezado, campos, select y botón),
 * con los mismos labels que el componente porque salen del mismo registro. Es un
 * andamio no interactivo: React lo reemplaza al montar en #root, igual que hace
 * con el resto del bloque SEO. No se duplica ninguna fórmula acá — el cálculo
 * vive en utils/calc-laborales.ts y corre del lado del cliente.
 */
function calculadoraHtml(tipo: keyof typeof CALCULADORAS): string {
    const c = CALCULADORAS[tipo];
    const campos = c.fields
        .map(f => `<p><label for="calc-${esc(f.key)}">${esc(f.label)}${f.suffix ? ` (${esc(f.suffix)})` : ''}</label>`
                + `<input id="calc-${esc(f.key)}" type="number" inputmode="decimal" min="0"`
                + ` step="${esc(f.step ?? '0.01')}" placeholder="0" disabled /></p>`)
        .join('');
    const select = c.select
        ? `<p><label for="calc-${esc(c.select.key)}">${esc(c.select.label)}</label>`
          + `<select id="calc-${esc(c.select.key)}" disabled>`
          + c.select.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
          + '</select></p>'
        : '';
    return `<section data-calculadora="${esc(tipo)}">`
         + `<h2>${esc(c.titulo)}</h2>`
         + `<p>${esc(c.descripcion)}</p>`
         + `<form>${campos}${select}<p><button type="button" disabled>Calcular</button></p></form>`
         + '</section>';
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
    swap(/<meta\s+property="og:image"\s+content="[\s\S]*?"\s*\/?>/, `<meta property="og:image" content="${OG_IMAGE}" />`);

    // JSON-LD específico de la ruta, antes de </head>.
    if (route.jsonLd) {
        html = html.replace('</head>', `${route.jsonLd}\n</head>`);
    }

    // Contenido VISIBLE para crawlers; React lo reemplaza al montar en #root.
    // Las rutas editoriales usan el mismo canvas cálido que el blog hidratado,
    // evitando el fogonazo blanco entre el HTML SEO y React. Las demás rutas
    // conservan su bloque neutral actual.
    const isBlogRoute = route.path === '/blog' || route.path.startsWith('/blog/');
    const seoContainer = isBlogRoute
        ? `<main data-prerender="seo" class="nx-public-prerender"><h1>${esc(route.h1)}</h1>${route.body}</main>`
        : `<div data-prerender="seo" style="max-width:820px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;line-height:1.6"><h1>${esc(route.h1)}</h1>${route.body}</div>`;
    const seoBlock = `<div id="root">${seoContainer}</div>`;
    html = html.replace(/<div id="root">\s*<\/div>/, seoBlock);

    return html;
}

// ── Escritura de los HTML por ruta ──
let count = 0;
for (const route of routes) {
    const outDir = path.join(DIST, route.path);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), buildHtml(route), 'utf-8');
    count++;
}

// ── Sitemap dinámico (incluye home + todas las rutas de marketing) ──
const today = new Date().toISOString().slice(0, 10);
const sitemapEntries: Array<{ loc: string; changefreq: string; priority: string; lastmod: string }> = [
    { loc: `${ORIGIN}/`, changefreq: 'weekly', priority: '1.0', lastmod: today },
    ...routes.map(r => ({
        loc: `${ORIGIN}${r.path}`,
        changefreq: r.changefreq,
        priority: r.priority,
        // Para artículos usamos su fecha de actualización; el resto, hoy.
        lastmod: today,
    })),
];

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemapXml, 'utf-8');

console.log(`✅ Prerender: ${count} rutas → dist/<ruta>/index.html + sitemap.xml (${sitemapEntries.length} URLs)`);
