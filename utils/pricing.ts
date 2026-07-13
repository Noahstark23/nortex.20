/**
 * NORTEX — Regla de precios por cantidad (venta al detalle / mayoreo / empaque).
 *
 * Extraída del POS para ser testeable (tests/pricing.test.ts) e importable por
 * cualquier canal (POS, catálogo público, WhatsApp). Es LÓGICA PURA: sin React,
 * sin Prisma, sin IO.
 *
 * Niveles de precio: detalle (base) → mayoreo (desde wholesaleMinQty; cliente
 * mayorista lo lleva desde la unidad 1) → empaque (desde packSize, a
 * packPrice/packSize por unidad). Gana el nivel de MAYOR umbral alcanzado; a
 * igual umbral, el empaque (precio explícito de caja) manda sobre el mayoreo.
 */

export interface PriceTierInput {
    basePrice: number;
    wholesalePrice?: number | null;
    wholesaleMinQty?: number | null;
    packSize?: number | null;
    packPrice?: number | null;
}

export type TierKind = 'DETALLE' | 'MAYOREO' | 'EMPAQUE';

export const effectiveTier = (p: PriceTierInput, qty: number, wholesaleCustomer: boolean): { unitPrice: number; kind: TierKind } => {
    let unitPrice = p.basePrice;
    let kind: TierKind = 'DETALLE';
    let threshold = 0;

    const wp = p.wholesalePrice;
    if (wp != null && wp > 0) {
        const t = wholesaleCustomer ? 0 : (p.wholesaleMinQty != null && p.wholesaleMinQty > 0 ? p.wholesaleMinQty : null);
        if (t != null && qty >= t && t >= threshold) {
            unitPrice = wp; kind = 'MAYOREO'; threshold = t;
        }
    }
    if (p.packPrice != null && p.packPrice > 0 && p.packSize != null && p.packSize > 0 && qty >= p.packSize && p.packSize >= threshold) {
        unitPrice = p.packPrice / p.packSize; kind = 'EMPAQUE';
    }
    return { unitPrice, kind };
};

export const effectiveUnitPrice = (p: PriceTierInput, qty: number, wholesaleCustomer: boolean): number =>
    effectiveTier(p, qty, wholesaleCustomer).unitPrice;
