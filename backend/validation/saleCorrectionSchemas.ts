import { z } from 'zod';
import { exactPositiveQuantity } from './schemas';

export const correctionKindSchema = z.enum(['RETURN', 'VOID']);
export const correctionResolutionSchema = z.enum(['REFUND', 'EXCHANGE', 'STORE_CREDIT']);
export const returnDispositionSchema = z.enum(['RESTOCK', 'QUARANTINE', 'LOSS']);
export const correctionRefundMethodSchema = z.enum(['CASH', 'CARD', 'QR', 'TRANSFER']);

export const CreateSaleCorrectionSchema = z.object({
    clientEventId: z.string().uuid('clientEventId debe ser UUID'),
    saleId: z.string().trim().min(1).max(191),
    kind: correctionKindSchema,
    reason: z.string().trim().min(10, 'Explicá el motivo con al menos 10 caracteres').max(500),
    resolution: correctionResolutionSchema.optional(),
    refundMethod: correctionRefundMethodSchema.optional(),
    lines: z.array(z.object({
        saleItemId: z.string().trim().min(1).max(191),
        quantity: exactPositiveQuantity,
        disposition: returnDispositionSchema.default('RESTOCK'),
    }).strict()).max(100).optional(),
}).strict().superRefine((value, ctx) => {
    if (value.kind === 'RETURN') {
        if (!value.lines || value.lines.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Seleccioná al menos un producto' });
        }
        if (!value.resolution) {
            ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'Elegí reembolso, cambio o saldo a favor' });
        }
        if (value.resolution === 'REFUND' && !value.refundMethod) {
            ctx.addIssue({ code: 'custom', path: ['refundMethod'], message: 'Elegí cómo se devolverá el dinero' });
        }
    } else if (value.lines?.length || value.resolution || value.refundMethod) {
        ctx.addIssue({ code: 'custom', message: 'Una anulación completa no admite líneas ni resolución de devolución' });
    }
});

export const ApprovalGrantSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(6).max(200),
}).strict();

export const ApproveSaleCorrectionSchema = z.object({
    grantToken: z.string().min(32).max(256),
}).strict();

export const RejectSaleCorrectionSchema = z.object({
    reason: z.string().trim().min(10).max(500),
}).strict();

export const CompleteReturnRefundSchema = z.object({
    externalReference: z.string().trim().min(4).max(191),
    evidenceNote: z.string().trim().min(4).max(1000),
}).strict();

export const ResolveReturnInspectionSchema = z.object({
    resolution: z.enum(['RESTOCK', 'DISCARD']),
    reason: z.string().trim().min(10).max(500),
}).strict();

export const UpdateReturnSettingsSchema = z.object({
    returnWindowDays: z.number().int().min(0).max(365),
}).strict();
