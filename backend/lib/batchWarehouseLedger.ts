import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

export const BATCH_WAREHOUSE_LEDGER_MODES = ['OFF', 'SHADOW', 'ENFORCED'] as const;
export type BatchWarehouseLedgerMode = typeof BATCH_WAREHOUSE_LEDGER_MODES[number];

export const BATCH_WAREHOUSE_MOVEMENT_TYPES = [
    'DIRECT_PURCHASE',
    'GOODS_RECEIPT',
    'SALE',
    'PEDIDO_RESERVE',
    'PEDIDO_DELIVERY',
    'PEDIDO_CANCEL',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'SALE_RETURN',
    'PURCHASE_RETURN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'WRITEOFF',
    'RECONCILIATION',
] as const;
export type BatchWarehouseMovementType = typeof BATCH_WAREHOUSE_MOVEMENT_TYPES[number];

const BATCH_WAREHOUSE_SOURCE_KEY_MAX_LENGTH = 191;

/**
 * Conserva las claves históricas mientras caben en MySQL. Para IDs reales
 * largos (por ejemplo UUID + lote SHA-256), compacta la identidad completa sin
 * perder determinismo ni reutilizar una clave entre eventos distintos.
 */
export function buildBoundedBatchWarehouseSourceKey(
    sourceKeyPrefix: string,
    batchId: string,
): string {
    const candidate = `${sourceKeyPrefix}:batch:${batchId}`;
    if (candidate.length <= BATCH_WAREHOUSE_SOURCE_KEY_MAX_LENGTH) return candidate;
    return `batch-event:${createHash('sha256').update(candidate).digest('hex')}`;
}

export type BatchWarehouseLedgerErrorCode =
    | 'BATCH_WAREHOUSE_INVALID_INPUT'
    | 'BATCH_WAREHOUSE_INVALID_MODE'
    | 'BATCH_WAREHOUSE_TENANT_NOT_FOUND'
    | 'BATCH_WAREHOUSE_PRODUCT_NOT_FOUND'
    | 'BATCH_WAREHOUSE_BATCH_NOT_FOUND'
    | 'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH'
    | 'BATCH_WAREHOUSE_WAREHOUSE_NOT_FOUND'
    | 'BATCH_WAREHOUSE_USER_NOT_FOUND'
    | 'BATCH_WAREHOUSE_IDEMPOTENCY_CONFLICT'
    | 'BATCH_WAREHOUSE_INSUFFICIENT_STOCK'
    | 'BATCH_WAREHOUSE_BALANCE_OVERFLOW'
    | 'BATCH_WAREHOUSE_LEDGER_CORRUPT'
    | 'BATCH_WAREHOUSE_CONCURRENT_WRITE';

export class BatchWarehouseLedgerError extends Error {
    constructor(
        readonly code: BatchWarehouseLedgerErrorCode,
        readonly httpStatus: 400 | 404 | 409 | 500,
        message: string,
    ) {
        super(message);
        this.name = 'BatchWarehouseLedgerError';
    }
}

/**
 * La frontera exacta nunca acepta `number`: aun un número que luce inocente
 * puede haber perdido precisión antes de llegar acá. Prisma.Decimal y
 * decimal.js entran por su representación textual.
 */
export type BatchWarehouseDecimalInput = string | Decimal | { toString(): string };

export interface BatchWarehouseDeltaIntent {
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    delta: BatchWarehouseDecimalInput;
    movementType: BatchWarehouseMovementType;
    referenceId?: string | null;
    referenceType?: string | null;
    userId: string;
    reason?: string | null;
    sourceKey: string;
    allowNegative?: boolean;
}

export interface CanonicalBatchWarehouseDeltaIntent {
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    delta: string;
    movementType: BatchWarehouseMovementType;
    referenceId: string | null;
    referenceType: string | null;
    userId: string;
    reason: string | null;
    sourceKey: string;
    allowNegative: boolean;
}

export interface CanonicalBatchWarehousePayload {
    version: 1;
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    delta: string;
    movementType: BatchWarehouseMovementType;
    referenceId: string | null;
    referenceType: string | null;
    userId: string;
    reason: string | null;
    sourceKey: string;
    allowNegative: boolean;
}

const MOVEMENT_TYPE_SET: ReadonlySet<unknown> = new Set(BATCH_WAREHOUSE_MOVEMENT_TYPES);
const MODE_SET: ReadonlySet<unknown> = new Set(BATCH_WAREHOUSE_LEDGER_MODES);

const invalidInput = (message: string): never => {
    throw new BatchWarehouseLedgerError('BATCH_WAREHOUSE_INVALID_INPUT', 400, message);
};

const normalizeIdentifier = (value: unknown, label: string, maxLength = 191): string => {
    if (typeof value !== 'string') return invalidInput(`${label} debe ser texto`);
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        invalidInput(`${label} no es válido`);
    }
    return normalized;
};

const normalizeOptionalText = (
    value: unknown,
    label: string,
    maxLength: number,
): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return invalidInput(`${label} debe ser texto`);
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    if (normalized.length > maxLength || /\u0000/u.test(normalized)) invalidInput(`${label} no es válido`);
    return normalized;
};

const parseExactDecimal = (value: BatchWarehouseDecimalInput): Decimal => {
    if (typeof value === 'number' || typeof value === 'bigint' || value == null) {
        invalidInput('La cantidad debe enviarse como texto decimal exacto');
    }

    let parsed: Decimal;
    try {
        parsed = new Decimal(typeof value === 'string' ? value.trim() : value.toString());
    } catch {
        invalidInput('La cantidad decimal no es válida');
    }
    if (!parsed.isFinite()) invalidInput('La cantidad decimal debe ser finita');
    if (parsed.decimalPlaces() > 4) invalidInput('La cantidad admite como máximo cuatro decimales');
    if (parsed.abs().greaterThan(new Decimal('99999999999999.9999'))) {
        invalidInput('La cantidad excede Decimal(18,4)');
    }
    return parsed;
};

/** Decimal(18,4) canónico, de ancho fijo y sin pasar por Number. */
export function canonicalBatchWarehouseBalance(value: BatchWarehouseDecimalInput): string {
    return parseExactDecimal(value).toFixed(4);
}

export const canonicalBatchWarehouseDecimal = (value: BatchWarehouseDecimalInput): string => {
    const parsed = parseExactDecimal(value);
    if (parsed.isZero()) invalidInput('El delta debe ser distinto de cero');
    return parsed.toFixed(4);
};

export const normalizeBatchWarehouseLedgerMode = (value: unknown): BatchWarehouseLedgerMode => {
    if (!MODE_SET.has(value)) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_INVALID_MODE',
            500,
            'La configuración del subledger lote-bodega no es válida',
        );
    }
    return value as BatchWarehouseLedgerMode;
};

export const normalizeBatchWarehouseDeltaIntent = (
    input: BatchWarehouseDeltaIntent,
): CanonicalBatchWarehouseDeltaIntent => {
    const movementType = MOVEMENT_TYPE_SET.has(input.movementType)
        ? input.movementType as BatchWarehouseMovementType
        : invalidInput('El tipo de movimiento lote-bodega no es válido');
    const referenceId = normalizeOptionalText(input.referenceId, 'referenceId', 191);
    const rawReferenceType = normalizeOptionalText(input.referenceType, 'referenceType', 64);
    const referenceType = rawReferenceType?.toUpperCase() ?? null;
    if ((referenceId === null) !== (referenceType === null)) {
        invalidInput('referenceId y referenceType deben enviarse juntos');
    }
    if (referenceType !== null && !/^[A-Z][A-Z0-9_]*$/u.test(referenceType)) {
        invalidInput('referenceType no es válido');
    }

    const sourceKey = normalizeIdentifier(input.sourceKey, 'sourceKey');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(sourceKey)) invalidInput('sourceKey no es válido');

    return {
        tenantId: normalizeIdentifier(input.tenantId, 'tenantId'),
        productId: normalizeIdentifier(input.productId, 'productId'),
        batchId: normalizeIdentifier(input.batchId, 'batchId'),
        warehouseId: normalizeIdentifier(input.warehouseId, 'warehouseId'),
        delta: canonicalBatchWarehouseDecimal(input.delta),
        movementType,
        referenceId,
        referenceType,
        userId: normalizeIdentifier(input.userId, 'userId'),
        reason: normalizeOptionalText(input.reason, 'reason', 2_000),
        sourceKey,
        allowNegative: input.allowNegative === true,
    };
};

export const buildCanonicalBatchWarehousePayload = (
    input: BatchWarehouseDeltaIntent | CanonicalBatchWarehouseDeltaIntent,
): CanonicalBatchWarehousePayload => {
    const normalized = normalizeBatchWarehouseDeltaIntent(input);
    return {
        version: 1,
        ...normalized,
    };
};

export function buildBatchWarehousePayloadHash(
    input: BatchWarehouseDeltaIntent | CanonicalBatchWarehouseDeltaIntent,
): string {
    return createHash('sha256')
        .update(JSON.stringify(buildCanonicalBatchWarehousePayload(input)))
        .digest('hex');
}

export const assertBatchWarehouseReplay = (
    existing: { payloadHash: string },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new BatchWarehouseLedgerError(
        'BATCH_WAREHOUSE_IDEMPOTENCY_CONFLICT',
        409,
        'sourceKey ya fue usado con un movimiento lote-bodega distinto',
    );
};
