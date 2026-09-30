import Decimal from 'decimal.js';
import { desglosarIvaIncluido } from '../services/nicaTax';
import { FISCAL_REGIME_CUOTA_FIJA } from '../../utils/fiscalRegime';

/** Una sola regla para proformas HTTP y WhatsApp; recibe líneas ya validadas. */
export function calculateQuotationTotals(items: ReadonlyArray<{price:Decimal;quantityExact:Decimal;ivaExento:boolean}>, fiscalRegime:string) {
  let subtotal=new Decimal(0), tax=new Decimal(0), grossTotal=new Decimal(0);
  for (const item of items) {
    const lineTotal=item.price.mul(item.quantityExact).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
    grossTotal=grossTotal.plus(lineTotal);
    if (item.ivaExento) subtotal=subtotal.plus(lineTotal);
    else {
      const split=desglosarIvaIncluido(lineTotal);
      subtotal=subtotal.plus(split.neto);
      tax=tax.plus(split.iva);
    }
  }
  if (fiscalRegime===FISCAL_REGIME_CUOTA_FIJA) return {subtotal:grossTotal,tax:new Decimal(0),total:grossTotal};
  return {subtotal,tax,total:subtotal.plus(tax)};
}
