import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import type { NormalizedSaleItem } from '../saleItemMeasurementService.js';
import { promotionConfig, promotionHash, PromotionError, type PromotionDb, type PromotionFiscal, type PromotionProduct } from './authority.js';

export interface PromotionPricingContext extends PromotionFiscal { at: Date; globalDiscount: string }
/** El porcentaje se aplica al precio autoritativo del nivel ya resuelto, a 4 decimales. */
export const discountedPromotionPrice = (price: Decimal.Value, percent: Decimal.Value) =>
    new Decimal(price).mul(new Decimal(1).minus(new Decimal(percent).div(100))).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export async function applyPromotionsToItems(db: PromotionDb, tenantId: string, items: NormalizedSaleItem[], products: PromotionProduct[], context: PromotionPricingContext) {
    const applicable = await db.$queryRaw<Array<{ productId: string; configHash: string; id: string; version: number; name: string; percent: Prisma.Decimal; startsAt: Date; endsAt: Date }>>(Prisma.sql`SELECT i.productId, i.configHash, p.id, p.version, p.name, p.percent, p.startsAt, p.endsAt FROM \`PromotionItem\` i INNER JOIN \`Promotion\` p ON p.id = i.promotionId AND p.tenantId = i.tenantId WHERE i.tenantId = ${tenantId} AND i.productId IN (${Prisma.join(products.map(product => product.id))}) AND p.status = 'PUBLISHED' AND p.startsAt <= ${context.at} AND p.endsAt > ${context.at} LIMIT 501 FOR SHARE`);
    if (applicable.length > 500) throw new PromotionError('PROMOTION_CONFLICT', 409, 'Las promociones requieren revisión administrativa.');
    const byProduct = new Map(products.map(product => [product.id, product]));
    return items.map(item => {
        const configHash = promotionHash(promotionConfig(byProduct.get(item.productId)!, context));
        const base = { ...item, pricingConfigHash: configHash };
        if (item.quotationId) return base;
        const matches = applicable.filter(row => row.productId === item.productId);
        if (matches.length > 1) throw new PromotionError('PROMOTION_CONFLICT', 409, 'Hay promociones superpuestas para este producto. Pedí revisión administrativa.');
        const match = matches[0];
        // Una configuración modificada suspende la aplicación; nunca reasigna
        // el porcentaje a precios o empaques que nadie revisó.
        if (!match) return base;
        if (match.configHash !== configHash) return { ...base, promotionUnavailable: { id: match.id, name: match.name, reason: 'CONFIG_CHANGED' as const } };
        if (!item.discountPct.isZero() || !new Decimal(context.globalDiscount).isZero() || item.acceptedLabelPriceOverride) {
            throw new PromotionError('PROMOTION_DISCOUNT_CONFLICT', 409, 'La promoción no admite otro descuento en la misma línea ni descuento global.');
        }
        const promo = match;
        const unitPrice = discountedPromotionPrice(item.unitPrice, promo.percent.toString());
        if (!unitPrice.gt(0)) throw new PromotionError('PROMOTION_CONFLICT', 409, 'El precio promocional requiere revisión.');
        return { ...base, unitPrice, promotionSnapshot: { id: promo.id, version: promo.version, name: promo.name,
            percent: promo.percent.toString(), configHash, normalUnitPrice: item.unitPrice.toFixed(4), unitPrice: unitPrice.toFixed(4),
            startsAt: promo.startsAt.toISOString(), endsAt: promo.endsAt.toISOString() } };
    });
}
