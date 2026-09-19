import Decimal from 'decimal.js';
import type { PromotionCheckoutQuote } from '../../shared/promotions';
import type { CartItem } from '../../types';
import { toDecimal } from '../../utils/money';
import { FISCAL_REGIME_CUOTA_FIJA, includedVatFromGross, resolveSaleFiscalAmounts } from '../../utils/fiscalRegime';

/** Cálculo existente del POS, caracterizado antes de extraerlo. La promoción se cotiza en el servidor. */
export function resolvePosCartTotals(cart: Array<CartItem & { discount?: number }>, globalDiscount: string, fiscalRegime: unknown, quote?: PromotionCheckoutQuote | null) {
    const isQuotation = (item: CartItem) => typeof item.quotationItemId === 'string' && item.quotationItemId.trim() !== '';
    const quotationLineCount = cart.filter(isQuotation).length;
    const hasQuotationLines = quotationLineCount > 0;
    const globalDiscountD = hasQuotationLines ? new Decimal(0) : Decimal.min(100, Decimal.max(0, toDecimal(globalDiscount)));
    const cartTotalsD = cart.reduce((acc, item) => {
        const lineDiscount = isQuotation(item) ? new Decimal(0) : toDecimal(item.discount ?? 0);
        const factor = new Decimal(1).minus(lineDiscount.div(100));
        const quantity = isQuotation(item) && item.quantityExact ? toDecimal(item.quantityExact) : toDecimal(item.quantity);
        const lineTotal = toDecimal(item.price).mul(quantity).mul(factor);
        return { gross: acc.gross.plus(lineTotal), taxableGross: item.ivaExento ? acc.taxableGross : acc.taxableGross.plus(lineTotal) };
    }, { gross: new Decimal(0), taxableGross: new Decimal(0) });
    const totalD = cartTotalsD.gross;
    const discountedTotalD = totalD.mul(new Decimal(1).minus(globalDiscountD.div(100)));
    // El precio de mostrador incluye IVA; el desglose no añade un recargo.
    const grandTotalD = quote ? toDecimal(quote.total) : discountedTotalD;
    const fiscalTotalD = grandTotalD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const exemptGrandTotalD = cartTotalsD.gross.minus(cartTotalsD.taxableGross)
        .mul(new Decimal(1).minus(globalDiscountD.div(100))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const generalTaxD = quote ? toDecimal(quote.vatAmount) : includedVatFromGross(fiscalTotalD.minus(exemptGrandTotalD));
    const fiscalAmounts = resolveSaleFiscalAmounts(fiscalTotalD, generalTaxD, quote?.fiscalRegime ?? fiscalRegime);
    const taxD = fiscalAmounts.vatAmount;
    return { quotationLineCount, hasQuotationLines, globalDiscountD, totalD, discountedTotalD, grandTotalD, fiscalTotalD, generalTaxD, fiscalAmounts, taxD,
        isFixedQuota: fiscalAmounts.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA,
        total: totalD.toDecimalPlaces(2).toNumber(), discountAmount: totalD.minus(grandTotalD).toDecimalPlaces(2).toNumber(),
        discountedTotal: discountedTotalD.toDecimalPlaces(2).toNumber(), tax: taxD.toDecimalPlaces(2).toNumber(),
        grandTotal: grandTotalD.toDecimalPlaces(2).toNumber(), globalDiscountNum: globalDiscountD.toNumber() };
}

export function promotionReceiptCart(cart: CartItem[], quote?: PromotionCheckoutQuote | null) {
    return cart.map((item, index) => { const line = quote?.lines[index]; if (!line || line.productId !== item.id) return item; return { ...item, price: toDecimal(line.unitPrice).toNumber(), discount: line.promotion ? 0 : (item as CartItem & { discount?: number }).discount ?? 0, promotionSnapshot: line.promotion }; });
}
