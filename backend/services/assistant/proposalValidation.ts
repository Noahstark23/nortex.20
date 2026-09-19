import { z } from 'zod';
import Decimal from 'decimal.js';
import type { InvoiceDraft } from '../../../shared/assistant';

const text = z.string().trim().max(191);
const decimalText = z.string().trim().max(64);
export const invoiceDraftSchema = z.object({
  currency: z.string().trim().max(12), supplierId: text.optional(), supplierName: text.optional(),
  invoiceNumber: z.string().trim().max(100), date: text, postingDate: text.optional(), dueDate: text.optional(),
  warehouseId: text.optional(), purchaseOrderId: text.optional(), paymentMethod: z.enum(['CASH', 'CREDIT']).optional(),
  notes: z.string().trim().max(500).optional(), receivedConfirmed: z.boolean(), paymentConfirmed: z.boolean(),
  documentSubtotal: decimalText.optional(), documentTax: decimalText.optional(), documentTotal: decimalText,
  discount: decimalText.optional(), freight: decimalText.optional(), otherCharges: decimalText.optional(),
  items: z.array(z.object({productId: text.optional(), description: z.string().trim().max(500),
    quantity: decimalText, unitCost: decimalText, purchaseUnit: z.enum(['BASE', 'PACK']),
    batchNumber: z.string().trim().max(100).optional(), expiryDate: text.optional(), purchaseOrderItemId: text.optional(),
  }).strict()).max(200), warnings: z.array(z.string().max(500)).max(100),
}).strict();

export function draftIssues(draft: InvoiceDraft): string[] {
  const issues = [...draft.warnings];
  if (!['NIO', 'C$'].includes(draft.currency.toUpperCase())) issues.push('Confirmá que la factura está expresada en córdobas (NIO).');
  if (!draft.supplierId) issues.push('Seleccioná un proveedor existente.');
  if (!draft.invoiceNumber) issues.push('Ingresá el número de factura.');
  if (!draft.date) issues.push('Ingresá la fecha de la factura.');
  if (!draft.items.length) issues.push('La factura necesita al menos un producto.');
  if (draft.items.some(item => !item.productId)) issues.push('Relacioná cada renglón con un producto del catálogo.');
  if (!draft.paymentMethod) issues.push('Indicá si la compra es de contado o a crédito.');
  if (!draft.purchaseOrderId && !draft.receivedConfirmed) issues.push('Confirmá que recibiste la mercadería; registrar esta compra ingresará existencias.');
  if (draft.paymentMethod === 'CASH' && !draft.paymentConfirmed) issues.push('Confirmá el pago de contado: se descontará de la caja abierta.');
  if (draft.paymentMethod === 'CREDIT' && draft.paymentConfirmed) issues.push('Una compra a crédito no puede marcarse como ya pagada.');
  for (const [key, label] of [['discount', 'descuentos'], ['freight', 'flete'], ['otherCharges', 'otros cargos']] as const) {
    const value = draft[key];
    if (value && (!/^\d+(?:\.\d+)?$/.test(value) || !new Decimal(value).isZero())) issues.push(`Esta versión de Compras no representa ${label}. Revisá el documento en Compras.`);
  }
  for (const [key,label] of [['documentTotal','total'],['documentSubtotal','subtotal'],['documentTax','IVA']] as const) {
    const value = draft[key];
    if ((key === 'documentTotal' || value) && (!value || !/^\d+(?:\.\d{1,2})?$/.test(value))) issues.push(`Revisá el ${label} impreso en la factura; usá un importe exacto en centavos.`);
  }
  return [...new Set(issues)];
}

export function toPurchaseInput(draft: InvoiceDraft) {
  const optional = (value: string | undefined) => value?.trim() || undefined;
  return {
    supplierId: draft.supplierId, warehouseId: optional(draft.warehouseId), invoiceNumber: draft.invoiceNumber,
    date: draft.date, postingDate: optional(draft.postingDate), dueDate: optional(draft.dueDate),
    paymentMethod: draft.paymentMethod, purchaseOrderId: optional(draft.purchaseOrderId), notes: optional(draft.notes),
    items: draft.items.map(item => ({productId: item.productId, quantity: item.quantity, unitCost: item.unitCost,
      purchaseUnit: item.purchaseUnit, batchNumber: optional(item.batchNumber), expiryDate: optional(item.expiryDate),
      purchaseOrderItemId: optional(item.purchaseOrderItemId)})),
  };
}

export function totalIssues(draft: InvoiceDraft, totals: {subtotal: string; tax: string; total: string}): string[] {
  return ([['documentSubtotal','subtotal'],['documentTax','tax'],['documentTotal','total']] as const)
    .flatMap(([field,key]) => draft[field] && !new Decimal(draft[field]).equals(totals[key])
      ? [`El ${key === 'tax' ? 'IVA' : key} del documento (${draft[field]}) difiere del cálculo de Nortex (${totals[key]}). Revisá los datos.`] : []);
}
