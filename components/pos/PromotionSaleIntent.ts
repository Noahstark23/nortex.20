import type { CartItem } from '../../types';
import { formatQuantityValue } from '../../utils/quantity';
export interface PromotionSaleIntentOptions {
    cart: Array<CartItem & { discount?: number }>; shiftId: string; paymentMethod: string; customerId?: string | null; customerName: string;
    employeeId?: string | null; globalDiscount: number; fiscalRegimeVersion: number; storeCreditAmount: string; storeCreditSourceReturnId?: string | null; total: number;
}
/** Foto del contrato existente de ventas; la identidad se calcula antes de cotizar. */
export function buildPromotionSaleIntent(options: PromotionSaleIntentOptions) {
    const items = options.cart.map(c => {
        const quotation = typeof c.quotationItemId === 'string' && !!c.quotationItemId.trim();
        return { id: c.id, name: c.name, ...(quotation ? { quotationItemId: c.quotationItemId } : {}), quantity: quotation && c.quantityExact ? c.quantityExact : formatQuantityValue(c.quantity), price: c.price, costPrice: c.costPrice, discount: quotation ? 0 : c.discount || 0,
            presentation: c.presentation ?? { quantity: formatQuantityValue(c.quantity), unit: c.unit || 'unidad' }, ...(c.measurement ? { measurement: c.measurement } : {}) };
    });
    const signature = JSON.stringify({ shiftId: options.shiftId, paymentMethod: options.paymentMethod, customerId: options.customerId ?? null, employeeId: options.employeeId ?? null, globalDiscount: String(options.globalDiscount), fiscalRegimeVersion: options.fiscalRegimeVersion, storeCreditAmount: options.storeCreditAmount, storeCreditSourceReturnId: options.storeCreditSourceReturnId, items: items.map(({ name: _name, ...item }) => item) });
    const transport = { paymentMethod: options.paymentMethod, customerName: options.customerName, customerId: options.customerId ?? null, total: options.total, globalDiscount: options.globalDiscount, employeeId: options.employeeId ?? null, fiscalRegimeVersion: options.fiscalRegimeVersion, storeCreditAmount: options.storeCreditAmount, ...(options.storeCreditSourceReturnId ? { storeCreditSourceReturnId: options.storeCreditSourceReturnId } : {}) };
    return { items, signature, transport };
}
