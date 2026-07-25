/**
 * NORTEX — generadores de JSON-LD (schema.org) para el blog.
 *
 * Fuente única para los datos estructurados que consumen tanto el componente
 * React (inyecta <script type="application/ld+json"> al montar) como el
 * prerender estático (scripts/prerender.ts). Devuelven objetos planos; el
 * consumidor los serializa con JSON.stringify.
 *
 * NO incluir datos de negocio ni del tenant aquí: es solo metadata pública de
 * marketing/contenido.
 */

export const SITE_ORIGIN = 'https://somosnortex.com';
export const SITE_NAME = 'Nortex';
export const SITE_LOGO = `${SITE_ORIGIN}/og-image.svg`;

export interface ArticleSEOInput {
    slug: string;
    title: string;
    description: string;
    date: string;          // ISO YYYY-MM-DD (datePublished)
    updated?: string;      // ISO YYYY-MM-DD (dateModified); por defecto = date
    category?: string;
    image?: string;
}

export interface BreadcrumbItem {
    name: string;
    url: string;           // ruta absoluta o relativa (se normaliza a absoluta)
}

export interface FAQItem {
    q: string;
    a: string;
}

const abs = (pathOrUrl: string): string =>
    pathOrUrl.startsWith('http') ? pathOrUrl : `${SITE_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

/** schema.org/Article para un post del blog. */
export function buildArticleJsonLd(input: ArticleSEOInput): Record<string, unknown> {
    const url = `${SITE_ORIGIN}/blog/${input.slug}`;
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: input.title,
        description: input.description,
        inLanguage: 'es-NI',
        datePublished: input.date,
        dateModified: input.updated ?? input.date,
        image: input.image ?? `${SITE_ORIGIN}/og-image.svg`,
        articleSection: input.category,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
        publisher: {
            '@type': 'Organization',
            name: `${SITE_NAME} Inc.`,
            url: SITE_ORIGIN,
            logo: { '@type': 'ImageObject', url: SITE_LOGO },
        },
    };
}

/** schema.org/BreadcrumbList. */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            name: it.name,
            item: abs(it.url),
        })),
    };
}

/** schema.org/FAQPage. Devuelve null si no hay preguntas (no emitir vacío). */
export function buildFaqJsonLd(faq: FAQItem[]): Record<string, unknown> | null {
    if (!faq || faq.length === 0) return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map(item => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
    };
}

export interface HowToStep { name: string; text: string; }

/**
 * schema.org/HowTo — para las guías de "cómo calcular X" (aguinaldo, INSS, etc.).
 * Devuelve null si no hay pasos (no emitir vacío), igual que buildFaqJsonLd.
 */
export function buildHowToJsonLd(
    name: string,
    steps: HowToStep[],
    description?: string,
): Record<string, unknown> | null {
    if (!steps || steps.length === 0) return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name,
        ...(description ? { description } : {}),
        step: steps.map((s, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: s.name,
            text: s.text,
        })),
    };
}

/** Serializa uno o varios bloques JSON-LD a tags <script> (para prerender). */
export function jsonLdScriptTags(...blocks: Array<Record<string, unknown> | null>): string {
    return blocks
        .filter((b): b is Record<string, unknown> => b !== null)
        .map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
        .join('\n');
}
