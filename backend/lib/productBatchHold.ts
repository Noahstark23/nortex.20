import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

export const CUSTOMER_RETURN_HOLD_REASON_CODE = 'CUSTOMER_RETURN_QUARANTINE' as const;

export type ProductBatchHoldErrorCode =
    | 'PRODUCT_BATCH_HOLD_INVALID_INPUT'
    | 'PRODUCT_BATCH_HOLD_TENANT_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_TENANT_NOT_PHARMACY'
    | 'PRODUCT_BATCH_HOLD_MODE_NOT_ENFORCED'
    | 'PRODUCT_BATCH_HOLD_PRODUCT_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_BATCH_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_BATCH_PRODUCT_MISMATCH'
    | 'PRODUCT_BATCH_HOLD_WAREHOUSE_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_USER_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_BALANCE_NOT_FOUND'
    | 'PRODUCT_BATCH_HOLD_BALANCE_SCOPE_MISMATCH'
    | 'PRODUCT_BATCH_HOLD_BALANCE_CORRUPT'
    | 'PRODUCT_BATCH_HOLD_BALANCE_OVERFLOW'
    | 'PRODUCT_BATCH_HOLD_INSUFFICIENT_PHYSICAL_STOCK'
    | 'PRODUCT_BATCH_HOLD_INSUFFICIENT_HELD_STOCK'
    | 'PRODUCT_BATCH_HOLD_IDEMPOTENCY_CONFLICT'
    | 'PRODUCT_BATCH_HOLD_RECORD_CORRUPT'
    | 'PRODUCT_BATCH_HOLD_CONCURRENT_WRITE';

export class ProductBatchHoldError extends Error {
    constructor(
        readonly code: ProductBatchHoldErrorCode,
        readonly httpStatus: 400 | 404 | 409 | 500,
        message: string,
    ) {
        super(message);
        this.name = 'ProductBatchHoldError';
    }
}

export type ProductBatchHoldDecimalInput = string | Decimal | { toString(): string };

export interface ProductBatchHoldDeltaIntent {
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    quantityDelta: ProductBatchHoldDecimalInput;
    holdReasonCode: string;
    referenceId: string;
    referenceType: string;
    sourceKey: string;
    userId: string;
    notes?: string | null;
}

export interface CanonicalProductBatchHoldDeltaIntent {
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    quantityDelta: string;
    holdReasonCode: string;
    referenceId: string;
    referenceType: string;
    sourceKey: string;
    userId: string;
    notes: string | null;
}

export interface CanonicalProductBatchHoldPayload
    extends CanonicalProductBatchHoldDeltaIntent {
    version: 1;
}

const invalidInput = (message: string): never => {
    throw new ProductBatchHoldError('PRODUCT_BATCH_HOLD_INVALID_INPUT', 400, message);
};

const normalizeIdentifier = (value: unknown, label: string, maxLength = 191): string => {
    if (typeof value !== 'string') return invalidInput(`${label} debe ser texto`);
    const normalized = value.trim();
    if (!normalized
        || normalized.length > maxLength
        || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${label} no es válido`);
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
    if (!normalized) return null;
    if (normalized.length > maxLength || /\u0000/u.test(normalized)) {
        return invalidInput(`${label} no es válido`);
    }
    return normalized;
};

const parseExactDecimal = (value: ProductBatchHoldDecimalInput): Decimal => {
    if (typeof value === 'number' || typeof value === 'bigint' || value == null) {
        return invalidInput('quantityDelta debe enviarse como texto decimal exacto');
    }
    let parsed: Decimal;
    try {
        parsed = new Decimal(typeof value === 'string' ? value.trim() : value.toString());
    } catch {
        return invalidInput('quantityDelta no es un decimal válido');
    }
    if (!parsed.isFinite()) return invalidInput('quantityDelta debe ser finito');
    if (parsed.decimalPlaces() > 4) {
        return invalidInput('quantityDelta admite como máximo cuatro decimales');
    }
    if (parsed.abs().greaterThan('99999999999999.9999')) {
        return invalidInput('quantityDelta excede Decimal(18,4)');
    }
    return parsed;
};

export function canonicalProductBatchHoldBalance(
    value: ProductBatchHoldDecimalInput,
): string {
    return parseExactDecimal(value).toFixed(4);
}

export const canonicalProductBatchHoldDelta = (
    value: ProductBatchHoldDecimalInput,
): string => {
    const parsed = parseExactDecimal(value);
    if (parsed.isZero()) return invalidInput('quantityDelta debe ser distinto de cero');
    return parsed.toFixed(4);
};

export const normalizeProductBatchHoldDeltaIntent = (
    input: ProductBatchHoldDeltaIntent,
): CanonicalProductBatchHoldDeltaIntent => {
    const holdReasonCode = normalizeIdentifier(input.holdReasonCode, 'holdReasonCode', 32)
        .toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(holdReasonCode)) {
        return invalidInput('holdReasonCode no es válido');
    }
    const referenceId = normalizeIdentifier(input.referenceId, 'referenceId');
    const referenceType = normalizeIdentifier(input.referenceType, 'referenceType', 64).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(referenceType)) {
        return invalidInput('referenceType no es válido');
    }
    const sourceKey = normalizeIdentifier(input.sourceKey, 'sourceKey');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(sourceKey)) {
        return invalidInput('sourceKey no es válido');
    }

    return {
        tenantId: normalizeIdentifier(input.tenantId, 'tenantId'),
        productId: normalizeIdentifier(input.productId, 'productId'),
        batchId: normalizeIdentifier(input.batchId, 'batchId'),
        warehouseId: normalizeIdentifier(input.warehouseId, 'warehouseId'),
        quantityDelta: canonicalProductBatchHoldDelta(input.quantityDelta),
        holdReasonCode,
        referenceId,
        referenceType,
        sourceKey,
        userId: normalizeIdentifier(input.userId, 'userId'),
        notes: normalizeOptionalText(input.notes, 'notes', 2_000),
    };
};

export function buildCanonicalProductBatchHoldPayload(
    input: ProductBatchHoldDeltaIntent | CanonicalProductBatchHoldDeltaIntent,
): CanonicalProductBatchHoldPayload {
    return {
        version: 1,
        ...normalizeProductBatchHoldDeltaIntent(input),
    };
}

export function buildProductBatchHoldPayloadHash(
    input: ProductBatchHoldDeltaIntent | CanonicalProductBatchHoldDeltaIntent,
): string {
    return createHash('sha256')
        .update(JSON.stringify(buildCanonicalProductBatchHoldPayload(input)))
        .digest('hex');
}

export const assertProductBatchHoldReplay = (
    existing: { payloadHash: string },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new ProductBatchHoldError(
        'PRODUCT_BATCH_HOLD_IDEMPOTENCY_CONFLICT',
        409,
        'sourceKey ya fue usado con una retención lote-bodega distinta',
    );
};
