// utils/seo.ts
// Builders de datos estructurados JSON-LD (schema.org) para el blog.
// Compartidos por el SPA (components/BlogPost.tsx) y el prerender
// (scripts/prerender.ts) para que crawlers y la app emitan el MISMO schema.
import type { BlogPost } from '../data/blog-posts';

export type JsonLd = Record<string, unknown>;

export function articleJsonLd(post: BlogPost, origin: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    inLanguage: 'es-NI',
    author: { '@type': 'Organization', name: 'Nortex' },
    publisher: {
      '@type': 'Organization',
      name: 'Nortex',
      logo: { '@type': 'ImageObject', url: `${origin}/og-image.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${origin}/blog/${post.slug}` },
    ...(post.keyword ? { keywords: post.keyword } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[], origin: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: `${origin}${it.url}`,
    })),
  };
}

export function faqJsonLd(faq: { q: string; a: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
