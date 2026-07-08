// data/blog-taxonomy.ts
// ─────────────────────────────────────────────────────────────────────────────
// Taxonomía del blog (modelo pillar/cluster) + helpers de navegación y SEO.
//
// Cada CLÚSTER agrupa un artículo PILAR (guía amplia que apunta a la keyword
// cabeza) y varios artículos de cola larga que enlazan de vuelta al pilar. El
// hub /blog/categoria/:slug renderiza cada clúster. Esto concentra autoridad
// temática y mejora el ranking de todo el grupo.
//
// Distribución objetivo del plan (Nortex_Plan_SEO_Contenido.xlsx, 329 artículos).
// Aquí solo vive la ESTRUCTURA; el contenido vive en data/blog-posts.ts y se va
// agregando por olas. Un clúster sin posts aún simplemente no aparece en /blog
// ni en el sitemap (clustersWithPosts()).

import { blogPosts, type BlogPost } from './blog-posts';

export const SITE_ORIGIN = 'https://somosnortex.com';

export interface BlogCluster {
  slug: string;        // segmento de URL del hub: /blog/categoria/<slug>
  name: string;        // nombre visible
  description: string; // intro del hub + meta description base
  /** slug del artículo pilar del clúster (puede no existir todavía). */
  pillarSlug?: string;
}

// Los 15 clústeres del plan maestro. El `slug` es la URL del hub; el `pillarSlug`
// apunta al artículo pilar (cuando exista) para destacarlo en el hub.
export const clusters: BlogCluster[] = [
  {
    slug: 'inventarios',
    name: 'Inventarios',
    description: 'Control de inventario, Kardex, costeo, conteos y rotación de stock para negocios en Nicaragua.',
    pillarSlug: 'control-de-inventario',
  },
  {
    slug: 'guias-por-industria',
    name: 'Guías por industria',
    description: 'Cómo administrar y digitalizar tu negocio según el rubro: ferretería, farmacia, pulpería y más.',
  },
  {
    slug: 'facturacion',
    name: 'Facturación',
    description: 'Facturación electrónica y cumplimiento con la DGI: series, formatos, notas de crédito y más.',
    pillarSlug: 'como-facturar-en-nicaragua',
  },
  {
    slug: 'impuestos',
    name: 'Impuestos Nicaragua',
    description: 'Impuestos para PyMES en Nicaragua: IVA, IR, retenciones, cuota fija y obligaciones DGI.',
    pillarSlug: 'impuestos-en-nicaragua',
  },
  {
    slug: 'administracion-erp',
    name: 'Administración y ERP',
    description: 'Qué es un ERP y cómo ordenar la administración de una PyME nicaragüense.',
    pillarSlug: 'que-es-un-erp',
  },
  {
    slug: 'nomina-rrhh',
    name: 'Recursos Humanos y Nómina',
    description: 'Cómo calcular la nómina en Nicaragua según la Ley 185: INSS, INATEC, IR, vacaciones y aguinaldo.',
    pillarSlug: 'como-calcular-nomina-nicaragua-2026',
  },
  {
    slug: 'contabilidad',
    name: 'Contabilidad',
    description: 'Contabilidad práctica para PyMES: estados financieros, costos, flujo de caja y NIIF para PyMES.',
    pillarSlug: 'contabilidad-para-pymes',
  },
  {
    slug: 'pos',
    name: 'Punto de Venta (POS)',
    description: 'Qué es un POS y cómo elegir un punto de venta para tu negocio en Nicaragua.',
    pillarSlug: 'que-es-un-pos',
  },
  {
    slug: 'ventas',
    name: 'Ventas',
    description: 'Cómo aumentar las ventas de tu negocio: estrategias, promociones y fidelización.',
    pillarSlug: 'como-aumentar-las-ventas',
  },
  {
    slug: 'tecnologia',
    name: 'Tecnología',
    description: 'Tecnología accesible para PyMES: software, pagos digitales, internet y herramientas.',
    pillarSlug: 'tecnologia-para-pymes',
  },
  {
    slug: 'ia',
    name: 'Inteligencia Artificial',
    description: 'IA aplicada a negocios pequeños: casos prácticos, ahorro de tiempo y decisiones con datos.',
    pillarSlug: 'ia-para-negocios',
  },
  {
    slug: 'compras',
    name: 'Compras',
    description: 'Cómo comprar para un negocio: proveedores, órdenes de compra y control de costos.',
    pillarSlug: 'como-comprar-para-un-negocio',
  },
  {
    slug: 'comparativas',
    name: 'Comparativas',
    description: 'Comparativas de software y métodos para que elijas la mejor herramienta para tu negocio.',
  },
  {
    slug: 'emprendimiento',
    name: 'Emprendimiento',
    description: 'Cómo abrir y hacer crecer un negocio en Nicaragua: pasos legales, costos y consejos.',
    pillarSlug: 'como-abrir-un-negocio',
  },
  {
    slug: 'casos',
    name: 'Casos reales',
    description: 'Historias de negocios nicaragüenses que ordenaron sus números con Nortex.',
  },
];

// ── Helpers de navegación ──────────────────────────────────────────────────

export function getCluster(slug?: string): BlogCluster | undefined {
  return clusters.find(c => c.slug === slug);
}

/** Nombre visible del clúster de un post (cae al campo `category` si no mapea). */
export function clusterName(post: BlogPost): string {
  return getCluster(post.cluster)?.name ?? post.category;
}

export function sortByDateDesc(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Todos los posts publicados, del más reciente al más antiguo. */
export function allPostsSorted(): BlogPost[] {
  return sortByDateDesc(blogPosts);
}

export function postsByCluster(slug: string): BlogPost[] {
  return sortByDateDesc(blogPosts.filter(p => p.cluster === slug));
}

/** Solo los clústeres que ya tienen al menos un artículo (para menús y sitemap). */
export function clustersWithPosts(): BlogCluster[] {
  return clusters.filter(c => blogPosts.some(p => p.cluster === c.slug));
}

/** Artículo pilar de un clúster: el declarado en la taxonomía o el marcado `pillar`. */
export function getPillar(clusterSlug: string): BlogPost | undefined {
  const c = getCluster(clusterSlug);
  if (c?.pillarSlug) {
    const bySlug = blogPosts.find(p => p.slug === c.pillarSlug);
    if (bySlug) return bySlug;
  }
  return blogPosts.find(p => p.cluster === clusterSlug && p.pillar);
}

/**
 * Artículos relacionados para enlazado interno: primero los `relatedSlugs`
 * explícitos, luego se completa con hermanos del mismo clúster. Sin huérfanos.
 */
export function getRelated(post: BlogPost, limit = 3): BlogPost[] {
  const explicit = (post.relatedSlugs ?? [])
    .map(s => blogPosts.find(p => p.slug === s))
    .filter((p): p is BlogPost => !!p && p.slug !== post.slug);

  if (explicit.length >= limit) return explicit.slice(0, limit);

  const siblings = sortByDateDesc(
    blogPosts.filter(p => p.cluster === post.cluster && p.slug !== post.slug),
  ).filter(p => !explicit.some(e => e.slug === p.slug));

  return [...explicit, ...siblings].slice(0, limit);
}

// ── JSON-LD (datos estructurados) ───────────────────────────────────────────
// Builders puros usados tanto por el componente cliente como por el prerender,
// para que el markup estructurado sea idéntico en ambos.

export function articleJsonLd(post: BlogPost): Record<string, unknown> {
  const url = `${SITE_ORIGIN}/blog/${post.slug}`;
  const image = post.image
    ? (post.image.startsWith('http') ? post.image : `${SITE_ORIGIN}${post.image}`)
    : `${SITE_ORIGIN}/og-image.svg`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    inLanguage: 'es-NI',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image,
    articleSection: clusterName(post),
    author: { '@type': 'Organization', name: 'Nortex', url: SITE_ORIGIN },
    publisher: {
      '@type': 'Organization',
      name: 'Nortex',
      url: SITE_ORIGIN,
      logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/og-image.svg` },
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: `${SITE_ORIGIN}${it.path}`,
    })),
  };
}

export function faqJsonLd(faqs?: { q: string; a: string }[]): Record<string, unknown> | null {
  if (!faqs || faqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
