import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import type { PromotionOperationCancellation, PromotionOperationResponse } from '../../../shared/promotions.js';
import { authorizePromotion, json, PromotionError, type PromotionDb, type PromotionPrincipal } from './authority.js';

const validId = (value: string) => {
    if (!value || value.length > 191) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Identificador de cobro no válido.');
};
async function receipt(db: PromotionDb, principal: PromotionPrincipal, saleId: string): Promise<PromotionOperationResponse> {
    const sale = await db.sale.findFirst({ where: { id: saleId, tenantId: principal.tenantId, soldById: principal.userId }, select: {
        id: true, total: true, paymentMethod: true, invoiceNumber: true, invoiceSeries: true, createdAt: true, vatAmountAtSale: true, fiscalRegimeAtSale: true, fiscalRegimeVersionAtSale: true,
        items: { select: { productId: true, quantity: true, productNameAtSale: true, priceAtSale: true, unitPriceExactAtSale: true, discount: true, ivaExento: true, unitAtSale: true, presentationAtSale: true, presentationQuantityAtSale: true, promotionSnapshot: true }, take: 500 },
    } });
    if (!sale) throw new PromotionError('PROMOTION_RECEIPT_UNAVAILABLE', 409, 'El cobro requiere revisar su comprobante. Conservá su identificador.');
    return { status: 'COMMITTED', sale: json(sale) };
}
export async function getCheckoutOperation(principal: PromotionPrincipal, offlineId: string, db: PromotionDb = prisma): Promise<PromotionOperationResponse> {
    await authorizePromotion(db, principal); validId(offlineId);
    const quote = await db.promotionCheckout.findFirst({ where: { tenantId: principal.tenantId, userId: principal.userId, offlineId, saleId: { not: null } }, orderBy: { createdAt: 'desc' } });
    return quote ? receipt(db, principal, quote.saleId!) : { status: 'NOT_FOUND' };
}
/** User es el primer lock en cobro y cancelación; una respuesta negativa de GET nunca cancela. */
export async function cancelCheckoutOperation(principal: PromotionPrincipal, offlineId: string, db: PrismaClient = prisma): Promise<PromotionOperationCancellation> {
    validId(offlineId);
    // Comparte la identidad persistida de Sales (event:hash), conservando IDs legacy.
    const { storedOfflineId } = await import('../salesService.js');
    const persistedId = storedOfflineId(principal.tenantId, offlineId);
    return db.$transaction(async tx => {
        await authorizePromotion(tx, principal, false, true);
        const [sale] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`Sale\` WHERE tenantId = ${principal.tenantId} AND soldById = ${principal.userId} AND offlineId IN (${persistedId}, ${offlineId}) FOR UPDATE`;
        if (sale) return receipt(tx, principal, sale.id);
        // Epoch es el marcador persistente: reintentar la cancelación no incrementa otra vez.
        const cancelled = await tx.promotionCheckout.updateMany({ where: { tenantId: principal.tenantId, userId: principal.userId, offlineId, saleId: null, expiresAt: { not: new Date(0) } },
            data: { version: { increment: 1 }, expiresAt: new Date(0) } });
        if (cancelled.count) await tx.auditLog.create({ data: { tenantId: principal.tenantId, userId: principal.userId, action: 'PROMOTION_CHECKOUT_CANCELLED',
            details: JSON.stringify({ offlineId, invalidatedReviews: cancelled.count }) } });
        return { status: 'CANCELLED' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
