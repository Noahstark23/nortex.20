import Decimal from 'decimal.js';
import type { NormalizedSaleItem } from '../saleItemMeasurementService.js';
import { desglosarVentaConExoneracion } from '../nicaTax.js';
import { resolveSaleFiscalAmounts } from '../../../utils/fiscalRegime.js';

export const saleLineNet = (item: Pick<NormalizedSaleItem, 'unitPrice' | 'quantity' | 'discountPct'>): Decimal =>
    item.unitPrice.mul(item.quantity).mul(new Decimal(1).minus(item.discountPct.dividedBy(100)));

/** Cálculo compartido por revisión y registro; conserva el redondeo fiscal del motor. */
export function calculateSaleTotals(items: NormalizedSaleItem[], globalDiscount: Decimal.Value, fiscalRegime: string) {
    const factor = new Decimal(1).minus(new Decimal(globalDiscount).dividedBy(100));
    const finalTotal = items.reduce((sum, item) => sum.plus(saleLineNet(item)), new Decimal(0)).mul(factor).toDecimalPlaces(2);
    const exemptTotal = items.reduce((sum, item) => item.ivaExento ? sum.plus(saleLineNet(item)) : sum, new Decimal(0)).mul(factor).toDecimalPlaces(2);
    const breakdown = desglosarVentaConExoneracion(finalTotal, exemptTotal);
    return { finalTotal, exemptTotal, fiscalAmounts: resolveSaleFiscalAmounts(finalTotal, breakdown.iva, fiscalRegime) };
}
