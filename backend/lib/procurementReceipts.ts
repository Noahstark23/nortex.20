import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { parseQuantity, QuantityValidationError } from '../../utils/quantity.js';

const MAX_IDENTIFIER_LENGTH = 191;
const MAX_RECEIPT_LINES = 500;
const MAX_REJECTION_NOTES_LENGTH = 2_000;

export const PROCUREMENT_REJECTION_REASON_CODES = [
    'DAMAGE',
    'EXPIRED',
    'SHORTAGE',
    'QUALITY',
    'DOC_MISMATCH',
    'OTHER',
] as const;

export type ProcurementRejectionReasonCode = typeof PROCUREMENT_REJECTION_REASON_CODES[number];
export type ProcurementReceiptInspectionOutcome = 'FULL_ACCEPT' | 'PARTIAL_REJECT' | 'FULL_REJECT';

const receiptQuantitySchema = z.union([
    z.string().trim().min(1).max(64),
    z.number().finite(),
]);

const receiptLineSchema = z.object({
    itemId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
    quantityReceived: receiptQuantitySchema,
    quantityRejected: receiptQuantitySchema.optional(),
    rejectionReasonCode: z.enum(PROCUREMENT_REJECTION_REASON_CODES).nullable().optional(),
    rejectionNotes: z.string().trim().max(MAX_REJECTION_NOTES_LENGTH).nullable().optional(),
    supplierFault: z.boolean().optional(),
    batchNumber: z.string().max(100).nullable().optional(),
    expiryDate: z.string().max(64).nullable().optional(),
}).strict();

/** Contrato HTTP de una recepción formal. El tenant nunca forma parte del body. */
export const procurementReceiptRequestSchema = z.object({
    clientEventId: z.uuid(),
    warehouseId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    supplierDeliveryRef: z.string().max(MAX_IDENTIFIER_LENGTH).nullable().optional(),
    items: z.array(receiptLineSchema).min(1).max(MAX_RECEIPT_LINES),
}).strict();

export type ProcurementReceiptRequest = z.infer<typeof procurementReceiptRequestSchema>;

export interface CanonicalProcurementReceiptLine {
    itemId: string;
    /** Cantidad aceptada. Conserva el nombre/semántica de la huella v1. */
    quantity: string;
    batchNumber: string | null;
    expiryDate: string | null;
    /** Solo existen en huellas v2; su ausencia completa identifica payloads legacy. */
    deliveredQuantity?: string;
    rejectedQuantity?: string;
    rejectionReasonCode?: ProcurementRejectionReasonCode | null;
    rejectionNotes?: string | null;
    supplierFault?: boolean | null;
}

export interface ProcurementReceiptExecutionLine extends CanonicalProcurementReceiptLine {
    productId: string;
}

export class ProcurementReceiptError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'ProcurementReceiptError';
    }
}

const normalizeExpiryDate = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized === '') return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(normalized);
    const dateTimeWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
        .test(normalized);
    if (!dateOnly && !dateTimeWithOffset) {
        throw new ProcurementReceiptError(
            'INVALID_EXPIRY_DATE',
            400,
            'La fecha de vencimiento debe ser una fecha civil o incluir zona horaria',
        );
    }

    const calendarDay = normalized.slice(0, 10);
    const parsed = new Date(`${calendarDay}T12:00:00.000Z`);
    const invalidTimestamp = dateTimeWithOffset && Number.isNaN(Date.parse(normalized));
    if (
        calendarDay < '1000-01-01'
        || Number.isNaN(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== calendarDay
        || invalidTimestamp
    ) {
        throw new ProcurementReceiptError(
            'INVALID_EXPIRY_DATE',
            400,
            'La fecha de vencimiento no es válida',
        );
    }
    return calendarDay;
};

const normalizeBatchNumber = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};

const normalizeRejectionNotes = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};

const parseNonNegativeReceiptQuantity = (value: string | number): Decimal => {
    try {
        return parseQuantity(value);
    } catch (error) {
        // Una inspección puede aceptar cero cuando documenta una cantidad
        // rechazada positiva. El resto de reglas de Decimal(18,4) sigue usando
        // el parser canónico del dominio.
        if (error instanceof QuantityValidationError && error.code === 'NON_POSITIVE_QUANTITY') {
            try {
                const candidate = new Decimal(typeof value === 'string' ? value.trim() : value.toString());
                if (candidate.isZero()) return candidate;
            } catch {
                // Se conserva abajo el error canónico del parser.
            }
        }
        if (error instanceof QuantityValidationError) {
            throw new ProcurementReceiptError(error.code, 400, error.message);
        }
        throw error;
    }
};

const inspectionFieldsArePresent = (
    line: ProcurementReceiptRequest['items'][number],
): boolean => Object.prototype.hasOwnProperty.call(line, 'quantityRejected')
    || Object.prototype.hasOwnProperty.call(line, 'rejectionReasonCode')
    || Object.prototype.hasOwnProperty.call(line, 'rejectionNotes')
    || Object.prototype.hasOwnProperty.call(line, 'supplierFault');

const compareCanonicalLines = (
    left: CanonicalProcurementReceiptLine,
    right: CanonicalProcurementReceiptLine,
): number => left.itemId.localeCompare(right.itemId)
    || (left.batchNumber ?? '').localeCompare(right.batchNumber ?? '')
    || (left.expiryDate ?? '').localeCompare(right.expiryDate ?? '');

/**
 * Normaliza la intención antes de tocar la BD. Cantidades equivalentes y un
 * orden distinto de líneas producen la misma huella, sin redondear valores.
 */
export const normalizeProcurementReceiptLines = (
    rawLines: ProcurementReceiptRequest['items'],
): CanonicalProcurementReceiptLine[] => {
    const seen = new Set<string>();
    const normalized = rawLines.map((line) => {
        const itemId = line.itemId.trim();
        if (seen.has(itemId)) {
            throw new ProcurementReceiptError(
                'DUPLICATE_ITEM',
                400,
                'Una línea de la OC solo puede aparecer una vez por comprobante; registrá cada lote en una recepción separada',
            );
        }
        seen.add(itemId);

        const acceptedQuantity = parseNonNegativeReceiptQuantity(line.quantityReceived);
        const isInspectionPayload = inspectionFieldsArePresent(line);
        const rejectedQuantity = line.quantityRejected === undefined
            ? new Decimal(0)
            : parseNonNegativeReceiptQuantity(line.quantityRejected);
        const deliveredQuantity = acceptedQuantity.plus(rejectedQuantity);
        if (!deliveredQuantity.greaterThan(0)) {
            throw new ProcurementReceiptError(
                'NON_POSITIVE_DELIVERED_QUANTITY',
                400,
                'La cantidad entregada debe ser mayor que cero',
            );
        }

        const rejectionReasonCode = line.rejectionReasonCode ?? null;
        const rejectionNotes = normalizeRejectionNotes(line.rejectionNotes);
        const supplierFault = line.supplierFault ?? null;
        if (rejectedQuantity.greaterThan(0)) {
            if (!rejectionReasonCode) {
                throw new ProcurementReceiptError(
                    'REJECTION_REASON_REQUIRED',
                    400,
                    'Seleccioná el motivo de rechazo de la mercadería',
                );
            }
            if (typeof line.supplierFault !== 'boolean') {
                throw new ProcurementReceiptError(
                    'SUPPLIER_FAULT_REQUIRED',
                    400,
                    'Indicá si el rechazo es responsabilidad del proveedor',
                );
            }
        } else if (rejectionReasonCode || rejectionNotes || typeof line.supplierFault === 'boolean') {
            throw new ProcurementReceiptError(
                'REJECTION_DETAILS_WITHOUT_QUANTITY',
                400,
                'No agregués motivo, nota ni responsabilidad si no hay cantidad rechazada',
            );
        }

        const baseLine: CanonicalProcurementReceiptLine = {
            itemId,
            quantity: acceptedQuantity.toString(),
            batchNumber: normalizeBatchNumber(line.batchNumber),
            expiryDate: normalizeExpiryDate(line.expiryDate),
        };
        if (!isInspectionPayload) return baseLine;
        return {
            ...baseLine,
            deliveredQuantity: deliveredQuantity.toString(),
            rejectedQuantity: rejectedQuantity.toString(),
            rejectionReasonCode,
            rejectionNotes,
            supplierFault,
        };
    });
    return normalized.sort(compareCanonicalLines);
};

export const procurementReceiptPayloadVersion = (
    lines: CanonicalProcurementReceiptLine[],
): 1 | 2 => lines.some(line => Object.prototype.hasOwnProperty.call(line, 'rejectedQuantity')) ? 2 : 1;

export const summarizeProcurementReceiptInspection = (
    lines: CanonicalProcurementReceiptLine[],
): {
    payloadVersion: 1 | 2;
    inspectionOutcome: ProcurementReceiptInspectionOutcome;
    inspectedLineCount: number;
    rejectedLineCount: number;
    hasSupplierFault: boolean;
} => {
    const payloadVersion = procurementReceiptPayloadVersion(lines);
    const rejectedLineCount = lines.filter(line => new Decimal(line.rejectedQuantity ?? 0).greaterThan(0)).length;
    const acceptedTotal = lines.reduce((sum, line) => sum.plus(line.quantity), new Decimal(0));
    return {
        payloadVersion,
        inspectionOutcome: rejectedLineCount === 0
            ? 'FULL_ACCEPT'
            : acceptedTotal.isZero()
                ? 'FULL_REJECT'
                : 'PARTIAL_REJECT',
        inspectedLineCount: lines.length,
        rejectedLineCount,
        hasSupplierFault: lines.some(line => line.supplierFault === true),
    };
};

/** Orden global estable de locks/escrituras para reducir deadlocks entre OCs. */
export const sortProcurementReceiptExecutionLines = <T extends ProcurementReceiptExecutionLine>(
    lines: T[],
): T[] => [...lines].sort((left, right) =>
    left.productId.localeCompare(right.productId)
    || (left.batchNumber ?? '').localeCompare(right.batchNumber ?? '')
    || left.itemId.localeCompare(right.itemId));

/**
 * Huella v1 de la intención tenant-scoped. tenantId se recibe exclusivamente
 * del contexto autenticado del caller, nunca del JSON enviado por el cliente.
 */
export const buildProcurementReceiptPayloadHash = (input: {
    tenantId: string;
    purchaseOrderId: string;
    warehouseId: string;
    supplierDeliveryRef?: string | null;
    lines: CanonicalProcurementReceiptLine[];
}): string => {
    const sortedLines = [...input.lines].sort(compareCanonicalLines);
    const version = procurementReceiptPayloadVersion(sortedLines);
    const canonicalPayload = JSON.stringify({
        version,
        tenantId: input.tenantId.trim(),
        purchaseOrderId: input.purchaseOrderId.trim(),
        warehouseId: input.warehouseId.trim(),
        supplierDeliveryRef: input.supplierDeliveryRef?.trim() || null,
        // La forma v1 queda byte por byte intacta. V2 evita campos `undefined`
        // y congela accepted/rejected/delivered como strings Decimal canónicos.
        lines: version === 1
            ? sortedLines
            : sortedLines.map(line => ({
                itemId: line.itemId,
                quantity: line.quantity,
                deliveredQuantity: line.deliveredQuantity,
                rejectedQuantity: line.rejectedQuantity,
                rejectionReasonCode: line.rejectionReasonCode ?? null,
                rejectionNotes: line.rejectionNotes ?? null,
                supplierFault: line.supplierFault ?? null,
                batchNumber: line.batchNumber,
                expiryDate: line.expiryDate,
            })),
    });
    return createHash('sha256').update(canonicalPayload).digest('hex');
};

export const assertMatchingProcurementReceiptReplay = (
    existing: { payloadHash?: string | null },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new ProcurementReceiptError(
        'RECEIPT_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con una recepción distinta',
    );
};
