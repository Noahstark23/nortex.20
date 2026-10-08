import Decimal from 'decimal.js';
import { z } from 'zod';

export const SUPPLIER_RETURN_SOURCE_TYPES = [
    'DIRECT_PURCHASE_ITEM',
    'GOODS_RECEIPT_UNMATCHED',
    'PURCHASE_MATCH_ALLOCATION',
] as const;

export const SUPPLIER_RETURN_REASON_CODES = [
    'DAMAGE',
    'EXPIRED',
    'QUALITY',
    'WRONG_ITEM',
    'OVER_DELIVERY',
    'OTHER',
] as const;

const identifier = z.string().trim().min(1).max(191)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Identificador inválido');

const exactQuantity = z.string().trim().min(1).max(64).superRefine((value, context) => {
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(value)) {
        context.addIssue({ code: 'custom', message: 'La cantidad debe ser Decimal(18,4) positivo' });
        return;
    }
    if (!new Decimal(value).greaterThan(0)) {
        context.addIssue({ code: 'custom', message: 'La cantidad debe ser mayor que cero' });
    }
});

const exactMoney = (positive: boolean) => z.string().trim().min(1).max(64).superRefine((value, context) => {
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(value)) {
        context.addIssue({ code: 'custom', message: 'El importe debe tener como máximo dos decimales' });
        return;
    }
    if (positive && !new Decimal(value).greaterThan(0)) {
        context.addIssue({ code: 'custom', message: 'El importe debe ser mayor que cero' });
    }
});

const directPurchaseItemLine = z.object({
    sourceType: z.literal('DIRECT_PURCHASE_ITEM'),
    purchaseItemId: identifier,
    quantity: exactQuantity,
}).strict();

const unmatchedGoodsReceiptLine = z.object({
    sourceType: z.literal('GOODS_RECEIPT_UNMATCHED'),
    goodsReceiptItemId: identifier,
    quantity: exactQuantity,
}).strict();

const purchaseMatchAllocationLine = z.object({
    sourceType: z.literal('PURCHASE_MATCH_ALLOCATION'),
    purchaseMatchAllocationId: identifier,
    quantity: exactQuantity,
}).strict();

/** Body HTTP de la salida física. tenantId/supplierId/userId solo vienen del servidor. */
export const CreateSupplierReturnSchema = z.object({
    clientEventId: z.uuid(),
    reasonCode: z.enum(SUPPLIER_RETURN_REASON_CODES),
    reason: z.string().trim().min(3).max(1_000),
    supplierReference: z.string().trim().min(1).max(191).nullable().optional(),
    lines: z.array(z.discriminatedUnion('sourceType', [
        directPurchaseItemLine,
        unmatchedGoodsReceiptLine,
        purchaseMatchAllocationLine,
    ])).min(1).max(100),
}).strict();

const supplierCreditNoteLine = z.object({
    supplierReturnItemId: identifier,
    quantity: exactQuantity,
    subtotal: exactMoney(false),
    tax: exactMoney(false),
    creditableTax: exactMoney(false),
    total: exactMoney(false),
}).strict();

const supplierCreditApplication = z.object({
    purchaseId: identifier,
    amount: exactMoney(true),
}).strict();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'La fecha debe usar YYYY-MM-DD');

/** Body HTTP de la nota fiscal. Los snapshots físicos y el tenant se resuelven server-side. */
export const CreateSupplierCreditNoteSchema = z.object({
    clientEventId: z.uuid(),
    creditNoteNumber: identifier,
    invoiceDate: dateOnly,
    creditNoteDate: dateOnly,
    devolutionDate: dateOnly,
    postingDate: dateOnly,
    reason: z.string().trim().min(3).max(1_000),
    supplierReference: z.string().trim().min(1).max(191).nullable().optional(),
    subtotal: exactMoney(false),
    tax: exactMoney(false),
    creditableTax: exactMoney(false),
    total: exactMoney(true),
    lines: z.array(supplierCreditNoteLine).min(1).max(100),
    applications: z.array(supplierCreditApplication).min(1).max(100),
}).strict();

export type CreateSupplierReturnInput = z.infer<typeof CreateSupplierReturnSchema>;
export type CreateSupplierCreditNoteInput = z.infer<typeof CreateSupplierCreditNoteSchema>;
