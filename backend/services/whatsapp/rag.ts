/**
 * NORTEX — WhatsApp · recuperación de catálogo (la "R" de RAG).
 *
 * Estrategia híbrida sobre MySQL 8 (sin pgvector, cero infra nueva):
 *  1) PRIMARIO — FULLTEXT `MATCH(name, category) AGAINST(... IN BOOLEAN MODE)`:
 *     búsqueda indexada con ranking por relevancia real (no scan + re-rank en JS).
 *     Prefijo `término*` para tolerar plurales/derivados ("taladr*" → "taladro").
 *  2) FALLBACK — LIKE `contains` sobre name/category/sku: cubre lo que el índice
 *     FULLTEXT no alcanza (tokens < innodb_ft_min_token_size, stopwords, o
 *     búsqueda por código/SKU). Solo corre si el FULLTEXT no devuelve nada.
 *
 * La interfaz CatalogRetriever queda intacta: enchufar luego un vector store
 * (Qdrant/Pinecone) no toca al agente.
 *
 * Aislamiento: TODA consulta filtra por tenantId (del canal, no del usuario).
 * B2C solo ve productos publicados; B2B/BOTH ve todo el inventario.
 * Seguridad: la consulta del usuario viaja SIEMPRE parametrizada ($queryRaw con
 * Prisma.sql) — nunca se concatena en el SQL → sin inyección.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface CatalogHit {
    id: string;
    name: string;
    price: number;
    stock: number;
    unit: string;
    sku: string;
}

export interface CatalogRetriever {
    search(tenantId: string, query: string, opts: { publicOnly: boolean; limit?: number }): Promise<CatalogHit[]>;
}

interface FullTextRow {
    id: string;
    name: string;
    price: number;
    stock: number;
    unit: string;
    sku: string;
}

/** Tokeniza: minúsculas, solo letras/números, ≥2 chars, máx 6 términos. */
function tokenize(query: string): string[] {
    return query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((t) => t.length >= 2)
        .slice(0, 6);
}

export class HybridCatalogRetriever implements CatalogRetriever {
    async search(
        tenantId: string,
        query: string,
        opts: { publicOnly: boolean; limit?: number }
    ): Promise<CatalogHit[]> {
        const terms = tokenize(query);
        if (terms.length === 0) return [];
        const limit = opts.limit ?? 5;

        const ftHits = await this.fullTextSearch(tenantId, terms, opts.publicOnly, limit);
        if (ftHits.length > 0) return ftHits;

        // El índice FULLTEXT no alcanzó (tokens cortos, stopwords, o búsqueda por SKU).
        return this.lexicalFallback(tenantId, terms, opts.publicOnly, limit);
    }

    /** Primario: índice FULLTEXT con ranking por relevancia (BOOLEAN MODE, prefijo). */
    private async fullTextSearch(
        tenantId: string,
        terms: string[],
        publicOnly: boolean,
        limit: number
    ): Promise<CatalogHit[]> {
        // Términos opcionales con prefijo: más términos coincidentes → más relevancia.
        // `terms` ya viene saneado (solo letras/números), por lo que `término*` no
        // introduce operadores de BOOLEAN MODE. Aun así viaja parametrizado.
        const booleanQuery = terms.map((t) => `${t}*`).join(' ');
        const publishedClause = publicOnly ? Prisma.sql`AND isPublished = true` : Prisma.empty;

        try {
            const rows = await prisma.$queryRaw<FullTextRow[]>(Prisma.sql`
                SELECT id, name, price, stock, unit, sku,
                       MATCH(name, category) AGAINST(${booleanQuery} IN BOOLEAN MODE) AS relevance
                FROM \`Product\`
                WHERE tenantId = ${tenantId}
                  AND MATCH(name, category) AGAINST(${booleanQuery} IN BOOLEAN MODE)
                  ${publishedClause}
                ORDER BY relevance DESC, stock DESC
                LIMIT ${limit}
            `);
            return rows.map((r) => ({
                id: r.id,
                name: r.name,
                price: Number(r.price),
                stock: Number(r.stock),
                unit: r.unit,
                sku: r.sku,
            }));
        } catch (err) {
            // Si la BD aún no tiene el índice FULLTEXT (deploy en transición), no
            // rompemos al cliente: caemos al léxico.
            console.error('🟧 [wa-rag] FULLTEXT no disponible, usando fallback léxico:', err);
            return [];
        }
    }

    /** Fallback léxico: LIKE contains tenant-scoped, re-rankeado por nº de términos. */
    private async lexicalFallback(
        tenantId: string,
        terms: string[],
        publicOnly: boolean,
        limit: number
    ): Promise<CatalogHit[]> {
        const candidates = await prisma.product.findMany({
            where: {
                tenantId,
                ...(publicOnly ? { isPublished: true } : {}),
                OR: terms.flatMap((t) => [
                    { name: { contains: t } },
                    { category: { contains: t } },
                    { sku: { contains: t } },
                ]),
            },
            select: { id: true, name: true, price: true, stock: true, unit: true, sku: true, category: true },
            take: 100,
        });

        const scored = candidates.map((p) => {
            const hay = `${p.name} ${p.category ?? ''} ${p.sku}`.toLowerCase();
            // Peso por campo: un match en el nombre vale más que en categoría/sku.
            const nameHay = p.name.toLowerCase();
            const score = terms.reduce((s, t) => {
                if (nameHay.includes(t)) return s + 2;
                if (hay.includes(t)) return s + 1;
                return s;
            }, 0);
            return { p, score };
        });
        scored.sort((a, b) => b.score - a.score || Number(b.p.stock) - Number(a.p.stock));

        return scored.slice(0, limit).map(({ p }) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            stock: Number(p.stock),
            unit: p.unit,
            sku: p.sku,
        }));
    }
}

export const catalogRetriever: CatalogRetriever = new HybridCatalogRetriever();
