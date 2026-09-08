import { z } from 'zod';

const text = z.string().trim().max(500);
const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
export const purchaseIntakeFactSchema = z.object({
  field: z.enum(['description','quantity','unitText','unitCost','supplierName','invoiceNumber','date','currency','documentTotal','paymentMethod','dueDate','batchNumber','expiryDate']),
  value: text.min(1), suppliedText: text.min(1),
}).strict();
export type PurchaseIntakeFact = z.infer<typeof purchaseIntakeFactSchema>;

const itemSchema = z.object({
  description: text, quantity: amount.optional(), unitText: text.optional(), unitCost: amount.optional(),
  productId: text.optional(), productName: text.optional(), baseUnit: text.optional(),
  packUnit: text.optional(), packSize: z.number().positive().optional(), requiresBatchTracking: z.boolean().optional(),
  purchaseUnit: z.enum(['BASE','PACK']).optional(), batchNumber: text.optional(), expiryDate: text.optional(),
}).strict();
export const purchaseIntakeSchema = z.object({
  id: z.string().uuid(), phase: z.enum(['CHOOSE_INPUT','COLLECTING','REVIEW']), mode: z.enum(['UNDECIDED','MANUAL','ATTACHMENT']),
  facts: z.object({
    items: z.array(itemSchema).min(1).max(200), supplierName: text.optional(), supplierId: text.optional(),
    invoiceNumber: text.optional(), date: text.optional(), currency: text.optional(), documentTotal: amount.optional(),
    paymentMethod: z.enum(['CASH','CREDIT']).optional(), dueDate: text.optional(), receivedConfirmed: z.boolean().optional(),
    paymentConfirmed: z.boolean().optional(), warehouseId: text.optional(), warehouseName: text.optional(),
  }).strict(),
  pendingQuestion: z.object({ id: z.string().uuid(), field: z.string().max(64), lineIndex: z.number().int().min(0).optional(),
    candidates: z.array(z.object({ id: text, label: text })).max(6).optional(),
  }).strict().optional(),
  proposalId: text.optional(), proposalVersion: z.number().int().positive().optional(),
  evidence: z.array(z.object({requestId:z.string().uuid(),field:z.string().max(64),suppliedText:text})).max(150),
}).strict();
export type PurchaseIntake = z.infer<typeof purchaseIntakeSchema>;
export type IntakeFacts = PurchaseIntake['facts'];
export type IntakeItem = IntakeFacts['items'][number];

export function readPurchaseIntake(metadata: unknown): PurchaseIntake | null {
  if (!metadata || typeof metadata !== 'object' || !('purchaseIntake' in metadata)) return null;
  const parsed = purchaseIntakeSchema.safeParse(metadata.purchaseIntake);
  return parsed.success ? parsed.data : null;
}
