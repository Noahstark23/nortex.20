// utils/seo.ts
// Builders de datos estructurados (JSON-LD) para el blog. Devuelven objetos
// planos; el prerender los serializa dentro de <script type="application/ld+json">
// y el componente BlogPost los inyecta en runtime. Schema.org → rich results
// (Article, FAQPage, BreadcrumbList) y mejor elegibilidad para snippets.

import type { BlogPost, BlogFaq } from '../data/blog-posts';

export const ORIGIN = 'https://somosnortex.com';

const PUBLISHER = {
  '@type': 'Organization',
  name: 'Nortex',
  url: ORIGIN,
  logo: {
    '@type': 'ImageObject',
    url: `${ORIGIN}/icon-192.svg`,
  },
};

export interface Breadcrumb {
  name: string;
  path: string;
}

/** Schema.org Article para un post del blog. */
export function articleJsonLd(post: BlogPost, origin: string = ORIGIN) {
  const url = `${origin}/blog/${post.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: 'es-NI',
    articleSection: post.category,
    author: { '@type': 'Organization', name: 'Nortex' },
    publisher: PUBLISHER,
    image: `${origin}/og-image.svg`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
  };
}

/** Schema.org FAQPage a partir de las preguntas frecuentes del post. */
export function faqJsonLd(faqs: BlogFaq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** Schema.org BreadcrumbList para la navegación jerárquica. */
export function breadcrumbJsonLd(items: Breadcrumb[], origin: string = ORIGIN) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${origin}${item.path}`,
    })),
  };
}

/**
 * Devuelve los bloques JSON-LD de un post (Article + Breadcrumb + FAQPage si
 * tiene FAQs), listos para serializar.
 */
export function postJsonLdBlocks(
  post: BlogPost,
  clusterName: string,
  clusterSlug: string,
  origin: string = ORIGIN,
): object[] {
  const blocks: object[] = [
    articleJsonLd(post, origin),
    breadcrumbJsonLd(
      [
        { name: 'Blog', path: '/blog' },
        { name: clusterName, path: `/blog/categoria/${clusterSlug}` },
        { name: post.title, path: `/blog/${post.slug}` },
      ],
      origin,
    ),
  ];
  if (post.faqs && post.faqs.length > 0) {
    blocks.push(faqJsonLd(post.faqs));
  }
  return blocks;
}
