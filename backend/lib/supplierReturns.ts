import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { validateQuantity, type QuantityValidationError } from '../../utils/quantity.js';
import {
    SUPPLIER_RETURN_REASON_CODES,
    SUPPLIER_RETURN_SOURCE_TYPES,
} from '../validation/supplierReturnSchemas.js';

export { SUPPLIER_RETURN_REASON_CODES, SUPPLIER_RETURN_SOURCE_TYPES };

export const SUPPLIER_RETURN_COMMAND_TYPE = 'SUPPLIER_RETURN_POST' as const;
export const SUPPLIER_RETURN_PAYLOAD_VERSION = 1 as const;
export const SUPPLIER_RETURN_STATUS = 'POSTED' as const;

export type SupplierReturnSourceType = typeof SUPPLIER_RETURN_SOURCE_TYPES[number];
export type SupplierReturnReasonCode = typeof SUPPLIER_RETURN_REASON_CODES[number];
export type SupplierReturnCreditEligibility = 'NOTEABLE' | 'PENDING_INVOICE_LINK';

export type SupplierReturnErrorCode =
    | 'SUPPLIER_RETURN_INVALID_INPUT'
    | 'SUPPLIER_RETURN_SOURCE_NOT_FOUND'
    | 'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH'
    | 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED'
    | 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED'
    | 'SUPPLIER_RETURN_SERIAL_UNSUPPORTED'
    | 'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE'
    | 'SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT'
    | 'SUPPLIER_RETURN_RESULT_INCOMPLETE';

export class SupplierReturnError extends Error {
    constructor(
        readonly code: SupplierReturnErrorCode,
        readonly httpStatus: 400 | 404 | 409 | 500,
        message: string,
    ) {
        super(message);
        this.name = 'SupplierReturnError';
    }
}

const invalidInput = (message: string): never => {
    throw new SupplierReturnError('SUPPLIER_RETURN_INVALID_INPUT', 400, message);
};

const identifier = (value: unknown, field: string): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe ser texto`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${field} no es válido`);
    }
    return normalized;
};

const optionalText = (value: unknown, field: string, maxLength: number): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return invalidInput(`${field} debe ser texto`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${field} no es válido`);
    }
    return normalized;
};

const uuid = (value: unknown): string => {
    const normalized = identifier(value, 'clientEventId').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
        return invalidInput('clientEventId debe ser UUID');
    }
    return normalized;
};

const sha256 = (value: unknown): string => createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');

const exactQuantity = (value: unknown, field = 'quantity'): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe enviarse como texto decimal exacto`);
    const source = value.trim();
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(source)) {
        return invalidInput(`${field} debe caber en Decimal(18,4)`);
    }
    const quantity = new Decimal(source);
    if (!quantity.greaterThan(0)) return invalidInput(`${field} debe ser mayor que cero`);
    return quantity.toFixed(4);
};

const exactEvidenceDecimal = (
    value: unknown,
    decimalPlaces: 4 | 6,
    field: string,
): string => {
    if (typeof value === 'number' || typeof value === 'bigint') {
        throw new SupplierReturnError(
            'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
            409,
            'La evidencia exacta de la fuente está incompleta',
        );
    }
    let parsed: Decimal;
    try {
        parsed = new Decimal(typeof value === 'string' ? value.trim() : String(value));
    } catch {
        throw new SupplierReturnError(
            'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
            409,
            'La evidencia exacta de la fuente está incompleta',
        );
    }
    const max = decimalPlaces === 4 ? '99999999999999.9999' : '999999999999.999999';
    if (!parsed.isFinite() || parsed.isNegative() || parsed.decimalPlaces() > decimalPlaces || parsed.greaterThan(max)) {
        throw new SupplierReturnError(
            'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
            409,
            `La evidencia ${field} no es conciliable`,
        );
    }
    return parsed.toFixed(decimalPlaces);
};

const record = (value: unknown): value is Record<string, unknown> =>
    Object(value) === value && !Array.isArray(value);

export interface SupplierReturnCommandInput {
    tenantId: unknown;
    userId: unknown;
    supplierId: unknown;
    clientEventId: unknown;
    reasonCode: unknown;
    reason: unknown;
    supplierReference?: unknown;
    lines: unknown;
}

export interface CanonicalSupplierReturnLine {
    sourceType: SupplierReturnSourceType;
    sourceId: string;
    sourceHash: string;
    quantity: string;
}

export interface CanonicalSupplierReturnCommand {
    version: 1;
    tenantId: string;
    userId: string;
    supplierId: string;
    clientEventId: string;
    reasonCode: SupplierReturnReasonCode;
    reason: string;
    supplierReference: string | null;
    lines: CanonicalSupplierReturnLine[];
}

const sourceTypeSet: ReadonlySet<unknown> = new Set(SUPPLIER_RETURN_SOURCE_TYPES);
const reasonCodeSet: ReadonlySet<unknown> = new Set(SUPPLIER_RETURN_REASON_CODES);

const sourceId = (line: Record<string, unknown>, sourceType: SupplierReturnSourceType): string => {
    const expectedField = sourceType === 'DIRECT_PURCHASE_ITEM'
        ? 'purchaseItemId'
        : sourceType === 'GOODS_RECEIPT_UNMATCHED'
            ? 'goodsReceiptItemId'
            : 'purchaseMatchAllocationId';
    for (const field of ['purchaseItemId', 'goodsReceiptItemId', 'purchaseMatchAllocationId']) {
        if (field !== expectedField && line[field] !== undefined) {
            return invalidInput('Cada línea debe identificar una sola fuente');
        }
    }
    return identifier(line[expectedField], expectedField);
};

export const buildSupplierReturnSourceHash = (input: {
    tenantId: string;
    sourceType: SupplierReturnSourceType;
    sourceId: string;
}): string => sha256([
    SUPPLIER_RETURN_PAYLOAD_VERSION,
    'SUPPLIER_RETURN_SOURCE',
    input.tenantId,
    input.sourceType,
    input.sourceId,
]);

export function normalizeSupplierReturnCommand(
    input: SupplierReturnCommandInput,
): CanonicalSupplierReturnCommand {
    const tenantId = identifier(input.tenantId, 'tenantId');
    const reasonCode = reasonCodeSet.has(input.reasonCode)
        ? input.reasonCode as SupplierReturnReasonCode
        : invalidInput('reasonCode no es válido');
    if (typeof input.reason !== 'string') return invalidInput('reason debe ser texto');
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1_000 || /[\u0000-\u001f\u007f]/u.test(reason)) {
        return invalidInput('reason debe tener entre 3 y 1000 caracteres');
    }
    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
        return invalidInput('lines debe contener entre 1 y 100 líneas');
    }
    const lines = input.lines.map((raw): CanonicalSupplierReturnLine => {
        if (!record(raw)) return invalidInput('Cada línea debe ser un objeto');
        const sourceType = sourceTypeSet.has(raw.sourceType)
            ? raw.sourceType as SupplierReturnSourceType
            : invalidInput('sourceType no es válido');
        const id = sourceId(raw, sourceType);
        return {
            sourceType,
            sourceId: id,
            sourceHash: buildSupplierReturnSourceHash({ tenantId, sourceType, sourceId: id }),
            quantity: exactQuantity(raw.quantity),
        };
    }).sort((left, right) => left.sourceType.localeCompare(right.sourceType)
        || left.sourceId.localeCompare(right.sourceId));
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index - 1].sourceHash === lines[index].sourceHash) {
            return invalidInput('No se puede repetir una fuente en la misma devolución');
        }
    }
    return {
        version: SUPPLIER_RETURN_PAYLOAD_VERSION,
        tenantId,
        userId: identifier(input.userId, 'userId'),
        supplierId: identifier(input.supplierId, 'supplierId'),
        clientEventId: uuid(input.clientEventId),
        reasonCode,
        reason,
        supplierReference: optionalText(input.supplierReference, 'supplierReference', 191),
        lines,
    };
}

export const buildSupplierReturnCommandId = (
    command: Pick<CanonicalSupplierReturnCommand, 'tenantId' | 'clientEventId'>,
): string => sha256([
    SUPPLIER_RETURN_PAYLOAD_VERSION,
    SUPPLIER_RETURN_COMMAND_TYPE,
    command.tenantId,
    command.clientEventId,
]);

/** La huella incluye tenant/proveedor e intención, pero no UUID ni actor del replay. */
export const buildSupplierReturnPayloadHash = (command: CanonicalSupplierReturnCommand): string => sha256({
    version: command.version,
    tenantId: command.tenantId,
    supplierId: command.supplierId,
    reasonCode: command.reasonCode,
    reason: command.reason,
    supplierReference: command.supplierReference,
    lines: command.lines,
});

export interface SupplierReturnSourceEvidence {
    tenantId: unknown;
    supplierId: unknown;
    sourceType: unknown;
    sourceId: unknown;
    sourceStatus: unknown;
    productId: unknown;
    warehouseId: unknown;
    batchId: unknown;
    availableToReturnExact: unknown;
    bookUnitCostExact: unknown;
    descriptionAtReturn: unknown;
    unitAtReturn: unknown;
    saleModeAtReturn?: unknown;
    quantityStepAtReturn?: unknown;
    batchNumberAtReturn?: unknown;
    expiryDateAtReturn?: unknown;
    requiresBatchTracking: unknown;
    hasSerialTracking: unknown;
    hasShadowGap: unknown;
    purchaseId?: unknown;
    sourcePurchaseItemId?: unknown;
    purchaseMatchAllocationId?: unknown;
    inventoryWarehouseId?: unknown;
    inventoryBatchId?: unknown;
    inventoryUnitCostExact?: unknown;
    physicalReceiptItemId?: unknown;
    physicalAcceptedQuantityExact?: unknown;
    physicalPreviouslyReturnedExact?: unknown;
}

export interface SupplierReturnPostingLine {
    sourceType: SupplierReturnSourceType;
    sourceId: string;
    sourceHash: string;
    productId: string;
    warehouseId: string;
    batchId: string | null;
    quantityExact: string;
    bookUnitCostExact: string;
    bookValueExact: string;
    productNameAtReturn: string;
    unitAtReturn: string;
    saleModeAtReturn: string;
    quantityStepAtReturn: string;
    batchNumberAtReturn: string | null;
    expiryDateAtReturn: string | null;
    sourcePurchaseId: string | null;
    sourcePurchaseItemId: string | null;
    purchaseMatchAllocationId: string | null;
    creditEligibility: SupplierReturnCreditEligibility;
    batchLedgerStatus: 'NOT_APPLICABLE' | 'APPLIED';
    kardexMovementType: 'PURCHASE_RETURN';
    kardexReferenceType: 'SUPPLIER_RETURN';
    batchMovement: null | {
        movementType: 'PURCHASE_RETURN';
        referenceType: 'SUPPLIER_RETURN_ITEM';
        delta: string;
        allowNegative: false;
    };
    /** Identidad física interna para impedir reset de cupo unmatched→matched. */
    physicalReceiptItemId: string | null;
}

const scopeMismatch = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH',
        409,
        'La fuente no pertenece al proveedor autenticado',
    );
};

const reconciliationRequired = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
        409,
        'La fuente no tiene evidencia física exacta para devolverla',
    );
};

const optionalEvidenceIdentifier = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return reconciliationRequired();
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return reconciliationRequired();
    }
    return normalized;
};

const evidenceText = (value: unknown, maxLength: number): string => {
    if (typeof value !== 'string') return reconciliationRequired();
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return reconciliationRequired();
    }
    return normalized;
};

export function planSupplierReturnPosting(input: {
    command: CanonicalSupplierReturnCommand;
    batchLedgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
    sources: readonly SupplierReturnSourceEvidence[];
}): SupplierReturnPostingLine[] {
    if (input.sources.length !== input.command.lines.length) {
        throw new SupplierReturnError(
            'SUPPLIER_RETURN_SOURCE_NOT_FOUND',
            404,
            'No se encontró una de las fuentes de la devolución',
        );
    }
    const sourcesByHash = new Map<string, SupplierReturnSourceEvidence>();
    for (const source of input.sources) {
        if (!sourceTypeSet.has(source.sourceType)) return reconciliationRequired();
        const sourceType = source.sourceType as SupplierReturnSourceType;
        const sourceIdValue = evidenceText(source.sourceId, 191);
        const sourceTenantId = evidenceText(source.tenantId, 191);
        if (sourceTenantId !== input.command.tenantId) return scopeMismatch();
        const hash = buildSupplierReturnSourceHash({
            tenantId: input.command.tenantId,
            sourceType,
            sourceId: sourceIdValue,
        });
        if (sourcesByHash.has(hash)) return reconciliationRequired();
        sourcesByHash.set(hash, source);
    }

    const receiptCaps = new Map<string, {
        accepted: string;
        previouslyReturned: string;
        requested: Decimal;
    }>();
    const planned = input.command.lines.map((line): SupplierReturnPostingLine => {
        const source = sourcesByHash.get(line.sourceHash);
        if (!source) {
            throw new SupplierReturnError(
                'SUPPLIER_RETURN_SOURCE_NOT_FOUND',
                404,
                'No se encontró una de las fuentes de la devolución',
            );
        }
        if (
            evidenceText(source.supplierId, 191) !== input.command.supplierId
        ) return scopeMismatch();
        if (source.sourceStatus !== 'POSTED') return reconciliationRequired();
        if (
            typeof source.requiresBatchTracking !== 'boolean'
            || typeof source.hasSerialTracking !== 'boolean'
            || typeof source.hasShadowGap !== 'boolean'
        ) return reconciliationRequired();
        if (source.hasSerialTracking === true) {
            throw new SupplierReturnError(
                'SUPPLIER_RETURN_SERIAL_UNSUPPORTED',
                409,
                'Las devoluciones de productos serializados no están habilitadas en v1',
            );
        }
        if (source.hasShadowGap === true) return reconciliationRequired();

        const productId = evidenceText(source.productId, 191);
        const warehouseId = optionalEvidenceIdentifier(source.warehouseId) ?? reconciliationRequired();
        const batchId = optionalEvidenceIdentifier(source.batchId);
        if (source.requiresBatchTracking === true && batchId === null) return reconciliationRequired();
        const available = exactEvidenceDecimal(source.availableToReturnExact, 4, 'availableToReturnExact');
        if (new Decimal(line.quantity).greaterThan(available)) {
            throw new SupplierReturnError(
                'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
                409,
                'La cantidad devuelta excede el neto disponible de la fuente',
            );
        }
        const bookUnitCostExact = exactEvidenceDecimal(source.bookUnitCostExact, 6, 'bookUnitCostExact');
        const sourcePurchaseId = optionalEvidenceIdentifier(source.purchaseId);
        const sourcePurchaseItemId = optionalEvidenceIdentifier(source.sourcePurchaseItemId);
        const matchAllocationId = optionalEvidenceIdentifier(source.purchaseMatchAllocationId);
        let creditEligibility: SupplierReturnCreditEligibility = 'NOTEABLE';
        let physicalReceiptItemId: string | null = null;

        if (line.sourceType === 'DIRECT_PURCHASE_ITEM') {
            const directWarehouse = optionalEvidenceIdentifier(source.inventoryWarehouseId);
            const directBatch = optionalEvidenceIdentifier(source.inventoryBatchId);
            const directUnitCost = source.inventoryUnitCostExact == null
                ? null
                : exactEvidenceDecimal(source.inventoryUnitCostExact, 6, 'inventoryUnitCostExact');
            if (
                sourcePurchaseId === null
                || sourcePurchaseItemId !== line.sourceId
                || directWarehouse !== warehouseId
                || directBatch !== batchId
                || directUnitCost === null
            ) {
                throw new SupplierReturnError(
                    'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED',
                    409,
                    'La compra directa no conserva evidencia exacta de bodega, lote y costo',
                );
            }
        } else if (line.sourceType === 'GOODS_RECEIPT_UNMATCHED') {
            if (sourcePurchaseId !== null || sourcePurchaseItemId !== null || matchAllocationId !== null) {
                return reconciliationRequired();
            }
            creditEligibility = 'PENDING_INVOICE_LINK';
            physicalReceiptItemId = optionalEvidenceIdentifier(source.physicalReceiptItemId);
            if (physicalReceiptItemId !== line.sourceId) return reconciliationRequired();
        } else if (
            sourcePurchaseId === null
            || sourcePurchaseItemId === null
            || matchAllocationId !== line.sourceId
        ) {
            return reconciliationRequired();
        } else {
            physicalReceiptItemId = optionalEvidenceIdentifier(source.physicalReceiptItemId);
            if (physicalReceiptItemId === null) return reconciliationRequired();
        }

        if (physicalReceiptItemId !== null) {
            const accepted = exactEvidenceDecimal(
                source.physicalAcceptedQuantityExact,
                4,
                'physicalAcceptedQuantityExact',
            );
            const previouslyReturned = exactEvidenceDecimal(
                source.physicalPreviouslyReturnedExact,
                4,
                'physicalPreviouslyReturnedExact',
            );
            const existing = receiptCaps.get(physicalReceiptItemId);
            if (existing && (existing.accepted !== accepted || existing.previouslyReturned !== previouslyReturned)) {
                return reconciliationRequired();
            }
            const cap = existing ?? { accepted, previouslyReturned, requested: new Decimal(0) };
            cap.requested = cap.requested.plus(line.quantity);
            receiptCaps.set(physicalReceiptItemId, cap);
        }

        const saleModeAtReturn = evidenceText(source.saleModeAtReturn, 32);
        const quantityStepAtReturn = exactEvidenceDecimal(
            source.quantityStepAtReturn,
            4,
            'quantityStepAtReturn',
        );
        try {
            validateQuantity(line.quantity, {
                saleMode: saleModeAtReturn as 'COUNTED' | 'MEASURED',
                quantityStep: quantityStepAtReturn,
            });
        } catch (error) {
            return invalidInput((error as QuantityValidationError).message);
        }
        if (batchId !== null && input.batchLedgerMode === 'OFF') return reconciliationRequired();
        const batchLedgerApplied = batchId !== null;
        const bookValue = new Decimal(bookUnitCostExact)
            .mul(line.quantity)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        if (bookValue.abs().greaterThan('99999999999999.9999')) return reconciliationRequired();
        return {
            sourceType: line.sourceType,
            sourceId: line.sourceId,
            sourceHash: line.sourceHash,
            productId,
            warehouseId,
            batchId,
            quantityExact: line.quantity,
            bookUnitCostExact,
            bookValueExact: bookValue.toFixed(4),
            productNameAtReturn: evidenceText(source.descriptionAtReturn, 191),
            unitAtReturn: evidenceText(source.unitAtReturn, 32),
            saleModeAtReturn,
            quantityStepAtReturn,
            batchNumberAtReturn: source.batchNumberAtReturn == null
                ? null
                : evidenceText(source.batchNumberAtReturn, 191),
            expiryDateAtReturn: source.expiryDateAtReturn == null
                ? null
                : evidenceText(source.expiryDateAtReturn, 64),
            sourcePurchaseId,
            sourcePurchaseItemId,
            purchaseMatchAllocationId: matchAllocationId,
            creditEligibility,
            batchLedgerStatus: batchLedgerApplied ? 'APPLIED' : 'NOT_APPLICABLE',
            kardexMovementType: 'PURCHASE_RETURN',
            kardexReferenceType: 'SUPPLIER_RETURN',
            batchMovement: batchLedgerApplied ? {
                movementType: 'PURCHASE_RETURN',
                referenceType: 'SUPPLIER_RETURN_ITEM',
                delta: new Decimal(line.quantity).negated().toFixed(4),
                allowNegative: false,
            } : null,
            physicalReceiptItemId,
        };
    });
    for (const cap of receiptCaps.values()) {
        if (new Decimal(cap.previouslyReturned).plus(cap.requested).greaterThan(cap.accepted)) {
            throw new SupplierReturnError(
                'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
                409,
                'La devolución excede el total físico aceptado de la recepción',
            );
        }
    }
    return planned.sort((left, right) => left.productId.localeCompare(right.productId)
        || left.warehouseId.localeCompare(right.warehouseId)
        || (left.batchId ?? '').localeCompare(right.batchId ?? '')
        || left.sourceHash.localeCompare(right.sourceHash));
}

/** SHADOW_GAP nunca se persiste parcialmente: todo movimiento loteado debe confirmar APPLIED. */
export function assertSupplierReturnBatchLedgerResults(input: {
    planned: readonly SupplierReturnPostingLine[];
    results: readonly { sourceHash: string; ledgerStatus: unknown }[];
}): void {
    const expected = input.planned.filter((line) => line.batchMovement !== null);
    const statuses = new Map(input.results.map((result) => [result.sourceHash, result.ledgerStatus]));
    if (statuses.size !== expected.length) return reconciliationRequired();
    for (const line of expected) {
        if (statuses.get(line.sourceHash) !== 'APPLIED') return reconciliationRequired();
    }
}

export interface SupplierReturnStoredResult {
    version: 1;
    commandType: typeof SUPPLIER_RETURN_COMMAND_TYPE;
    commandId: string;
    payloadHash: string;
    response: {
        supplierReturnId: string;
        returnNumber: string;
        supplierId: string;
        status: typeof SUPPLIER_RETURN_STATUS;
        lines: Array<{
            supplierReturnItemId: string;
            sourceHash: string;
            quantityExact: string;
        }>;
    };
}

const sha256Value = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

const incompleteStoredResult = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_RESULT_INCOMPLETE',
        500,
        'El resultado idempotente de la devolución está incompleto o corrupto',
    );
};

export const serializeSupplierReturnStoredResult = (result: SupplierReturnStoredResult): string =>
    JSON.stringify(result);

export function parseSupplierReturnStoredResult(
    details: string | null,
    expected: {
        commandId: string;
        payloadHash: string;
        supplierId: string;
        lines: readonly Pick<CanonicalSupplierReturnLine, 'sourceHash' | 'quantity'>[];
    },
): SupplierReturnStoredResult {
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(details as string);
    } catch {
        // El sentinel null cae en la misma respuesta fail-closed.
    }
    if (!record(parsed)
        || parsed.version !== SUPPLIER_RETURN_PAYLOAD_VERSION
        || parsed.commandType !== SUPPLIER_RETURN_COMMAND_TYPE
        || parsed.commandId !== expected.commandId
        || parsed.payloadHash !== expected.payloadHash
        || !sha256Value(parsed.commandId)
        || !sha256Value(parsed.payloadHash)
        || !record(parsed.response)) {
        return incompleteStoredResult();
    }
    const response = parsed.response;
    if (
        typeof response.supplierReturnId !== 'string'
        || !response.supplierReturnId
        || typeof response.returnNumber !== 'string'
        || !response.returnNumber
        || response.supplierId !== expected.supplierId
        || response.status !== SUPPLIER_RETURN_STATUS
        || !Array.isArray(response.lines)
        || response.lines.length !== expected.lines.length
    ) return incompleteStoredResult();

    const lines = response.lines.map((raw, index) => {
        if (!record(raw)
            || typeof raw.supplierReturnItemId !== 'string'
            || !raw.supplierReturnItemId
            || raw.sourceHash !== expected.lines[index].sourceHash
            || raw.quantityExact !== expected.lines[index].quantity
            || !sha256Value(raw.sourceHash)) {
            return incompleteStoredResult();
        }
        return {
            supplierReturnItemId: raw.supplierReturnItemId,
            sourceHash: raw.sourceHash,
            quantityExact: raw.quantityExact,
        };
    });
    return {
        version: SUPPLIER_RETURN_PAYLOAD_VERSION,
        commandType: SUPPLIER_RETURN_COMMAND_TYPE,
        commandId: expected.commandId,
        payloadHash: expected.payloadHash,
        response: {
            supplierReturnId: response.supplierReturnId,
            returnNumber: response.returnNumber,
            supplierId: expected.supplierId,
            status: SUPPLIER_RETURN_STATUS,
            lines,
        },
    };
}

export function assertSupplierReturnReplay(
    existing: { payloadVersion: number | null; payloadHash: string | null },
    expectedPayloadHash: string,
): void {
    if (existing.payloadVersion === SUPPLIER_RETURN_PAYLOAD_VERSION && existing.payloadHash === expectedPayloadHash) {
        return;
    }
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con otra devolución a proveedor',
    );
}
