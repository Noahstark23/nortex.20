/**
 * NORTEX — WhatsApp · recuperación de catálogo (la "R" de RAG).
 *
 * Realidad: Nortex corre en MySQL 8.0 → NO hay pgvector. Para catálogos de PyME
 * (cientos a pocos miles de SKUs) la búsqueda léxica tenant-scoped es suficiente
 * y CERO infraestructura nueva. La interfaz CatalogRetriever deja la costura
 * para enchufar después FULLTEXT (índice MySQL) o un vector store externo
 * (Qdrant/Pinecone) sin tocar al agente.
 *
 * Aislamiento: TODA consulta filtra por tenantId (recibido del canal, no del
 * usuario). B2C solo ve productos publicados; B2B/BOTH ve todo el inventario.
 */

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

/**
 * Implementación léxica (Prisma `contains`, tenant-scoped). Tokeniza la consulta
 * y puntúa por nº de términos coincidentes en nombre/categoría/sku.
 */
export class LexicalCatalogRetriever implements CatalogRetriever {
    async search(
        tenantId: string,
        query: string,
        opts: { publicOnly: boolean; limit?: number }
    ): Promise<CatalogHit[]> {
        const terms = query
            .toLowerCase()
            .split(/\s+/)
            .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
            .filter((t) => t.length >= 2)
            .slice(0, 6);

        if (terms.length === 0) return [];

        const candidates = await prisma.product.findMany({
            where: {
                tenantId,
                ...(opts.publicOnly ? { isPublished: true } : {}),
                OR: terms.flatMap((t) => [
                    { name: { contains: t } },
                    { category: { contains: t } },
                    { sku: { contains: t } },
                ]),
            },
            select: { id: true, name: true, price: true, stock: true, unit: true, sku: true, category: true },
            take: 50,
        });

        // Re-rank: más términos coincidentes primero, luego mayor stock.
        const scored = candidates.map((p) => {
            const hay = `${p.name} ${p.category ?? ''} ${p.sku}`.toLowerCase();
            const score = terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
            return { p, score };
        });
        scored.sort((a, b) => b.score - a.score || Number(b.p.stock) - Number(a.p.stock));

        return scored.slice(0, opts.limit ?? 5).map(({ p }) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            stock: Number(p.stock),
            unit: p.unit,
            sku: p.sku,
        }));
    }
}

export const catalogRetriever: CatalogRetriever = new LexicalCatalogRetriever();
