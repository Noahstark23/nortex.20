/**
 * NORTEX — Regla de precios por cantidad (venta al detalle / mayoreo / empaque).
 *
 * Extraída del POS para ser testeable (tests/pricing.test.ts) e importable por
 * cualquier canal (POS, catálogo público, WhatsApp). Es LÓGICA PURA: sin React,
 * sin Prisma, sin IO.
 *
 * Niveles de precio: detalle (base) → mayoreo (desde wholesaleMinQty; cliente
 * mayorista lo lleva desde la unidad 1). El precio de empaque NO nace por
 * alcanzar un umbral: requiere una presentación PACK explícita, igual que el
 * contrato autoritativo del servidor.
 */

export interface PriceTierInput {
    basePrice: number;
    wholesalePrice?: number | null;
    wholesaleMinQty?: number | null;
    packSize?: number | null;
    packPrice?: number | null;
}

export type TierKind = 'DETALLE' | 'MAYOREO' | 'EMPAQUE';
export type PricePresentation = 'BASE' | 'PACK';

export const effectiveTier = (
    p: PriceTierInput,
    qty: number,
    wholesaleCustomer: boolean,
    presentation?: PricePresentation,
): { unitPrice: number; kind: TierKind } => {
    let unitPrice = p.basePrice;
    let kind: TierKind = 'DETALLE';

    const wp = p.wholesalePrice;
    if (wp > 0) {
        const t = wholesaleCustomer ? 0 : (p.wholesaleMinQty > 0 ? p.wholesaleMinQty : null);
        if (t != null && qty >= t) {
            unitPrice = wp; kind = 'MAYOREO';
        }
    }
    if (presentation === 'PACK' && p.packPrice > 0 && p.packSize > 0) {
        unitPrice = p.packPrice / p.packSize; kind = 'EMPAQUE';
    }
    return { unitPrice, kind };
};

export const effectiveUnitPrice = (
    p: PriceTierInput,
    qty: number,
    wholesaleCustomer: boolean,
    presentation?: PricePresentation,
): number => effectiveTier(p, qty, wholesaleCustomer, presentation).unitPrice;
