import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PromotionError } from './authority.js';

// Stock/costo/publicación pública no cambian el acuerdo comercial promocional.
export const PROMOTION_PRICE_FIELDS = ['name', 'price', 'wholesalePrice', 'wholesaleMinQty', 'packUnit', 'packSize', 'packPrice',
    'unit', 'saleMode', 'quantityStep', 'ivaExento', 'requiresBatchTracking'] as const;
const decimals = new Set<string>(['price', 'wholesalePrice', 'wholesaleMinQty', 'packSize', 'packPrice', 'quantityStep']);
const booleans = new Set<string>(['ivaExento', 'requiresBatchTracking']);
function sameValue(field: string, before: unknown, after: unknown): boolean {
    if (before === null || after === null) return before === after;
    if (decimals.has(field)) {
        try { return new Decimal(String(before)).equals(new Decimal(String(after))); }
        catch { throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'La configuración de precio no es válida.'); }
    }
    return booleans.has(field) ? Boolean(before) === Boolean(after) : before === after;
}
/** El llamador aplica el patch en esta MISMA transacción, manteniendo el lock. */
export async function withPromotionPriceVersion<T extends Record<string, any>>(tx: Prisma.TransactionClient, tenantId: string, id: string, updates: T): Promise<T & { promotionPriceVersion?: { increment: number } }> {
    const touched = PROMOTION_PRICE_FIELDS.filter(field => updates[field] !== undefined);
    if (!touched.length) return updates;
    const [current] = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT ${Prisma.join(PROMOTION_PRICE_FIELDS.map(field => Prisma.raw(`\`${field}\``)))} FROM \`Product\` WHERE id = ${id} AND tenantId = ${tenantId} FOR UPDATE`);
    if (!current) throw new PromotionError('PROMOTION_PRODUCT_NOT_FOUND', 404, 'Producto no encontrado en tu negocio.');
    return touched.some(field => !sameValue(field, current[field], updates[field]))
        ? { ...updates, promotionPriceVersion: { increment: 1 } } : updates;
}
