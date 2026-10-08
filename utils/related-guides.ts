/**
 * NORTEX — Selección de guías relacionadas (enlazado interno, Palanca B del plan SEO).
 *
 * Antes cada post mostraba SOLO sus `relatedSlugs` escritos a mano (0-3 enlaces, y
 * varios posts quedaban casi huérfanos). Esto refuerza el enlazado interno del
 * clúster sin trabajo manual: respeta los relacionados explícitos y, si faltan,
 * completa con hermanos del mismo clúster priorizando el pilar y las guías con
 * calculadora (las que mejor convierten).
 *
 * Función PURA para poder testearla sin React.
 */

export interface RelatedCandidate {
    slug: string;
    title: string;
    category: string;
    cluster: string;
    calculator?: string;
}

export function pickRelatedGuides<T extends RelatedCandidate>(
    post: T,
    allPosts: T[],
    opts: { limit?: number; pillarSlug?: string; relatedSlugs?: string[] } = {},
): T[] {
    const limit = opts.limit ?? 4;
    const bySlug = new Map(allPosts.map(p => [p.slug, p]));
    const out: T[] = [];
    const seen = new Set<string>([post.slug]);

    const push = (p: T | undefined) => {
        if (!p || seen.has(p.slug) || out.length >= limit) return;
        seen.add(p.slug);
        out.push(p);
    };

    // 1) Relacionados explícitos, en su orden (curados a mano — mandan).
    for (const slug of opts.relatedSlugs ?? []) push(bySlug.get(slug));

    if (out.length >= limit) return out;

    // 2) Relleno con hermanos del mismo clúster: primero el pilar del clúster,
    //    después las guías con calculadora, luego el resto (orden estable).
    const siblings = allPosts.filter(p => p.cluster === post.cluster && !seen.has(p.slug));
    const pillar = opts.pillarSlug ? siblings.find(p => p.slug === opts.pillarSlug) : undefined;
    push(pillar);
    for (const p of siblings.filter(p => p.calculator)) push(p);
    for (const p of siblings) push(p);

    return out;
}
