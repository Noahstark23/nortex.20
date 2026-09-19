import type { CartItem } from '../../types';
import type { PromotionOperationResponse } from '../../shared/promotions';
import { normalizeFiscalRegime } from '../../utils/fiscalRegime';
import { toDecimal } from '../../utils/money';
/** La recuperación presenta exclusivamente el comprobante confirmado, sin volver a enviar la venta. */
export function promotionRecoveredSale(cart: CartItem[], sale: NonNullable<PromotionOperationResponse['sale']>) {
    const items = sale.items.map(line => ({ ...(cart.find(item => item.id === line.productId) ?? {}), id: line.productId, name: line.productNameAtSale ?? 'Producto de la venta', quantity: line.quantity, price: toDecimal(line.unitPriceExactAtSale ?? line.priceAtSale).toNumber(), discount: line.discount, unit: line.unitAtSale ?? 'unidad', presentation: { quantity: String(line.quantity), unit: line.unitAtSale ?? 'unidad' }, promotionSnapshot: line.promotionSnapshot } as CartItem));
    const subtotal = items.reduce((total, line) => total.plus(toDecimal(line.price).mul(line.quantity)), toDecimal(0));
    return { syncStatus: 'confirmed' as const, items, subtotal: subtotal.toNumber(), discount: subtotal.minus(sale.total).toNumber(), tax: toDecimal(sale.vatAmountAtSale!).toNumber(), grandTotal: toDecimal(sale.total).toNumber(), paymentMethod: sale.paymentMethod, customerName: 'Venta recuperada', saleId: sale.id, date: new Date(sale.createdAt).toLocaleString('es-NI', { timeZone: 'America/Managua' }), invoiceNumber: sale.invoiceNumber ?? undefined, invoiceSeries: sale.invoiceSeries ?? undefined, fiscalRegimeAtSale: normalizeFiscalRegime(sale.fiscalRegimeAtSale), fiscalRegimeVersionAtSale: sale.fiscalRegimeVersionAtSale ?? undefined, vatAmountAtSale: toDecimal(sale.vatAmountAtSale!).toNumber() };
}
