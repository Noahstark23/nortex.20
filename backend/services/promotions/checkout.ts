import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type PromotionCheckout } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { normalizeSaleItems, type NormalizedSaleItem, type SaleItemInputLike } from '../saleItemMeasurementService.js';
import type { PromotionCheckoutQuote, PromotionCheckoutResponse } from '../../../shared/promotions.js';
import { calculateSaleTotals, saleLineNet } from './totals.js';
import { authorizePromotion, json, promotionFiscal, promotionHash, promotionsEnabled, promotionsFlag, PromotionError, type PromotionDb, type PromotionPrincipal, type PromotionFiscal } from './authority.js';

type CheckoutInput = { offlineId?: string; promotionQuote?: { id: string; version: number }; [key: string]: any };
export const checkoutRequestHash = (input: CheckoutInput, shiftId: string | null) => {
    const { promotionQuote: _quote, ...content } = input;
    return promotionHash({ shiftId, content });
};
export const promotionReplayHash = (baseHash: string | null, input: CheckoutInput): string | null => input.promotionQuote
    ? promotionHash({ baseHash, promotionQuote: input.promotionQuote, storeCreditAmount: input.storeCreditAmount, storeCreditSourceReturnId: input.storeCreditSourceReturnId }) : baseHash;

export function checkoutPriceHash(items: NormalizedSaleItem[], fiscal: PromotionFiscal, totals: ReturnType<typeof calculateSaleTotals>) {
    return promotionHash({ fiscal, total: totals.finalTotal.toFixed(2), exemptTotal: totals.exemptTotal.toFixed(2), vatAmount: totals.fiscalAmounts.vatAmount.toFixed(4),
        items: items.map(item => ({ productId: item.productId, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toFixed(4), discount: item.discountPct.toString(),
            ivaExento: item.ivaExento, unit: item.unitAtSale, mode: item.saleModeAtSale, step: item.quantityStepAtSale, presentation: item.presentationAtSale,
            presentationQuantity: item.presentationQuantityAtSale.toString(), pricingConfigHash: item.pricingConfigHash, promotion: item.promotionSnapshot ?? null })) });
}

/** Se consulta aun con el interruptor apagado para recuperar un resultado confirmado. */
export async function lockCheckoutForSale(tx: Prisma.TransactionClient, principal: PromotionPrincipal, input: CheckoutInput, shiftId: string | null) {
    if (!input.promotionQuote && !promotionsFlag()) return { enabled: false, checkout: null, fiscal: null };
    const user = await authorizePromotion(tx, principal, false, true);
    let checkout: PromotionCheckout | null = null;
    if (input.promotionQuote) {
        const [row] = await tx.$queryRaw<PromotionCheckout[]>`SELECT * FROM \`PromotionCheckout\` WHERE id = ${input.promotionQuote.id} AND tenantId = ${principal.tenantId} AND userId = ${principal.userId} FOR UPDATE`;
        if (!row || row.version !== input.promotionQuote.version || row.roleAtCreation !== user.role || row.offlineId !== input.offlineId
            || row.requestHash !== checkoutRequestHash(input, shiftId)) throw new PromotionError('PROMOTION_QUOTE_CHANGED', 409, 'La revisión no corresponde a este carrito o sesión. Revisá el cobro otra vez.');
        checkout = row;
        if (checkout.saleId) return { enabled: false, checkout, fiscal: null };
    }
    const enabled = await promotionsEnabled(tx, principal.tenantId, true);
    if (input.promotionQuote && !enabled) throw new PromotionError('PROMOTION_QUOTE_CHANGED', 409, 'Las promociones cambiaron. Revisá nuevamente el cobro.');
    return { enabled, checkout, fiscal: enabled ? await promotionFiscal(tx, principal.tenantId, true) : null };
}

export function assertCheckoutMatches(checkout: PromotionCheckout | null, items: NormalizedSaleItem[], fiscal: PromotionFiscal, totals: ReturnType<typeof calculateSaleTotals>, now = new Date()) {
    const promoted = items.filter(item => item.promotionSnapshot);
    if (!checkout && promoted.length) throw new PromotionError('PROMOTION_QUOTE_REQUIRED', 409, 'Revisá y aceptá el total promocional antes de cobrar.');
    if (!checkout) return;
    if (checkout.expiresAt <= now || checkout.priceHash !== checkoutPriceHash(items, fiscal, totals)
        || promoted.some(item => new Date(item.promotionSnapshot!.startsAt) > now || new Date(item.promotionSnapshot!.endsAt) <= now)) {
        throw new PromotionError('PROMOTION_QUOTE_CHANGED', 409, 'Cambió el precio, la vigencia o el carrito. Conservamos tus productos; revisá el nuevo total.');
    }
}
export async function completeCheckout(tx: Prisma.TransactionClient, checkout: PromotionCheckout | null, saleId: string) {
    if (!checkout) return;
    const completed = await tx.promotionCheckout.updateMany({ where: { id: checkout.id, tenantId: checkout.tenantId, userId: checkout.userId, version: checkout.version, saleId: null }, data: { saleId } });
    if (completed.count !== 1) throw new PromotionError('PROMOTION_QUOTE_CHANGED', 409, 'La revisión ya fue utilizada. Recuperá el comprobante de la operación.');
}

export async function createCheckoutQuote(principal: PromotionPrincipal, raw: { shiftId?: string; sale?: unknown }, db: PrismaClient = prisma): Promise<PromotionCheckoutResponse> {
    await authorizePromotion(db, principal);
    if (!await promotionsEnabled(db, principal.tenantId)) return { enabled: false, quote: null };
    const { CreateSaleSchema, lockSaleProductsInOrder } = await import('../salesService.js');
    const parsed = CreateSaleSchema.safeParse(raw.sale);
    if (!parsed.success || !parsed.data.offlineId || parsed.data.promotionQuote) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'La revisión requiere el carrito y su identificador de cobro.');
    return db.$transaction(async tx => {
        const user = await authorizePromotion(tx, principal, false, true);
        if (!await promotionsEnabled(tx, principal.tenantId, true)) throw new PromotionError('PROMOTION_DISABLED', 403, 'Las promociones ya no están habilitadas.');
        await lockSaleProductsInOrder(tx, principal.tenantId, parsed.data.items.map(item => item.id));
        const [shift] = await tx.$queryRaw<Array<{ id: string; employeeId: string | null }>>`SELECT id, employeeId FROM \`Shift\` WHERE tenantId = ${principal.tenantId} AND userId = ${principal.userId} AND status = 'OPEN' AND id = ${raw.shiftId ?? ''} FOR SHARE`;
        if (!shift) throw new PromotionError('PROMOTION_SHIFT_CHANGED', 409, 'La caja no está abierta en esta sesión.');
        const input = { ...parsed.data, source: 'POS', employeeId: shift.employeeId };
        const fiscal = await promotionFiscal(tx, principal.tenantId, true);
        let customer: { id: string; isWholesale: boolean | number } | undefined;
        if (input.customerId) {
            [customer] = await tx.$queryRaw<Array<{ id: string; isWholesale: boolean | number }>>`SELECT id, isWholesale FROM \`Customer\` WHERE id = ${input.customerId} AND tenantId = ${principal.tenantId} FOR SHARE`;
            if (!customer) throw new PromotionError('PROMOTION_CUSTOMER_CHANGED', 404, 'Cliente no encontrado en tu negocio.');
        }
        const at = new Date();
        const items = await normalizeSaleItems(tx, { tenantId: principal.tenantId, userId: principal.userId,
            items: input.items as unknown as SaleItemInputLike[], wholesaleCustomer: Boolean(customer?.isWholesale), allowRevokedScaleVersionForReplay: false, quotedAt: at,
            promotionContext: { ...fiscal, at, globalDiscount: input.globalDiscount } });
        const totals = calculateSaleTotals(items, input.globalDiscount, fiscal.fiscalRegime);
        const expiresAt = new Date(Math.min(Date.now() + 120_000, ...items.filter(item => item.promotionSnapshot).map(item => new Date(item.promotionSnapshot!.endsAt).getTime())));
        const quote: PromotionCheckoutQuote = { id: randomUUID(), version: 1, offlineId: input.offlineId!, expiresAt: expiresAt.toISOString(),
            total: totals.finalTotal.toFixed(2), vatAmount: totals.fiscalAmounts.vatAmount.toFixed(4), exemptTotal: totals.exemptTotal.toFixed(2), hasPromotions: items.some(item => Boolean(item.promotionSnapshot)), ...fiscal,
            warnings: [...new Set(items.filter(item => item.promotionUnavailable).map(item => `${item.promotionUnavailable!.name} requiere revisión administrativa. Se muestra el precio normal de ${item.productNameAtSale}.`))],
            lines: items.map(item => ({ productId: item.productId, name: item.productNameAtSale, quantity: item.quantity.toString(), presentation: item.presentationAtSale,
                presentationQuantity: item.presentationQuantityAtSale.toString(), unit: item.unitAtSale, unitPrice: item.unitPrice.toFixed(4), lineTotal: saleLineNet(item).toFixed(2), promotion: item.promotionSnapshot ?? null })) };
        await tx.promotionCheckout.create({ data: { id: quote.id, tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: user.role, offlineId: quote.offlineId,
            version: 1, requestHash: checkoutRequestHash(input, shift.id), priceHash: checkoutPriceHash(items, fiscal, totals), quoteJson: json(quote), expiresAt } });
        return { enabled: true, quote };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export { getCheckoutOperation } from './receipt.js';
