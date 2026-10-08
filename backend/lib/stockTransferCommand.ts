import { createHash } from 'node:crypto';
import { parseQuantity, QuantityValidationError } from '../../utils/quantity.js';

const MAX_IDENTIFIER_LENGTH = 191;
const MAX_NOTES_LENGTH = 500;
const MAX_QUANTITY_LENGTH = 64;
const MAX_ITEMS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface StockTransferCommandItem {
    productId: string;
    /** La API nueva solo acepta texto para no recibir un Number ya redondeado. */
    quantity: string;
}

export interface StockTransferCommandRequest {
    clientEventId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    notes?: string | null;
    items: StockTransferCommandItem[];
}

export interface CanonicalStockTransferItem {
    productId: string;
    quantity: string;
}

export interface CanonicalStockTransferCommand {
    clientEventId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    notes: string | null;
    items: CanonicalStockTransferItem[];
}

export class StockTransferError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'StockTransferError';
    }
}

const invalidCommand = (code: string, message: string): never => {
    throw new StockTransferError(code, 400, message);
};

const normalizeIdentifier = (value: unknown, label: string): string => {
    if (typeof value !== 'string') return invalidCommand('INVALID_TRANSFER_CONTEXT', `${label} debe ser texto`);
    const normalized = value.trim();
    if (
        normalized.length === 0
        || normalized.length > MAX_IDENTIFIER_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        return invalidCommand('INVALID_TRANSFER_CONTEXT', `${label} no es válido`);
    }
    return normalized;
};

const normalizeNotes = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return invalidCommand('INVALID_TRANSFER_NOTES', 'notes debe ser texto');
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    if (normalized.length > MAX_NOTES_LENGTH || /\u0000/u.test(normalized)) {
        return invalidCommand('INVALID_TRANSFER_NOTES', `notes admite máximo ${MAX_NOTES_LENGTH} caracteres`);
    }
    return normalized;
};

const normalizeExactQuantity = (value: unknown): string => {
    if (typeof value !== 'string') {
        return invalidCommand(
            'INVALID_TRANSFER_QUANTITY',
            'La cantidad debe enviarse como texto decimal exacto',
        );
    }
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > MAX_QUANTITY_LENGTH) {
        return invalidCommand('INVALID_TRANSFER_QUANTITY', 'La cantidad no tiene un formato decimal válido');
    }
    try {
        return parseQuantity(normalized).toFixed(4);
    } catch (error) {
        if (error instanceof QuantityValidationError) {
            throw new StockTransferError(error.code, 400, error.message);
        }
        throw error;
    }
};

/**
 * Canonicaliza la intención antes de abrir una transacción. Ordenar por producto
 * hace que el hash, los locks y las escrituras tengan el mismo orden estable.
 */
export const normalizeStockTransferCommand = (
    request: StockTransferCommandRequest,
): CanonicalStockTransferCommand => {
    if (request == null || typeof request !== 'object') {
        return invalidCommand('INVALID_TRANSFER_COMMAND', 'La transferencia no es válida');
    }
    const clientEventId = normalizeIdentifier(request.clientEventId, 'clientEventId').toLowerCase();
    if (!UUID_PATTERN.test(clientEventId)) {
        return invalidCommand('INVALID_CLIENT_EVENT_ID', 'clientEventId debe ser un UUID válido');
    }
    const fromWarehouseId = normalizeIdentifier(request.fromWarehouseId, 'fromWarehouseId');
    const toWarehouseId = normalizeIdentifier(request.toWarehouseId, 'toWarehouseId');
    if (fromWarehouseId === toWarehouseId) {
        return invalidCommand('SAME_WAREHOUSE', 'Origen y destino no pueden ser la misma bodega');
    }
    if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > MAX_ITEMS) {
        return invalidCommand('INVALID_TRANSFER_ITEMS', `La transferencia requiere entre 1 y ${MAX_ITEMS} ítems`);
    }

    const seen = new Set<string>();
    const items = request.items.map((item) => {
        const productId = normalizeIdentifier(item?.productId, 'productId');
        if (seen.has(productId)) {
            return invalidCommand('DUPLICATE_TRANSFER_PRODUCT', 'No repitás un producto en la misma transferencia');
        }
        seen.add(productId);
        return {
            productId,
            quantity: normalizeExactQuantity(item.quantity),
        };
    }).sort((left, right) => left.productId.localeCompare(right.productId));

    return {
        clientEventId,
        fromWarehouseId,
        toWarehouseId,
        notes: normalizeNotes(request.notes),
        items,
    };
};

/** Huella v1 tenant-scoped; el tenant proviene del JWT del caller. */
export const buildStockTransferPayloadHash = (input: {
    tenantId: string;
    command: CanonicalStockTransferCommand;
}): string => createHash('sha256').update(JSON.stringify({
    version: 1,
    tenantId: normalizeIdentifier(input.tenantId, 'tenantId'),
    fromWarehouseId: input.command.fromWarehouseId,
    toWarehouseId: input.command.toWarehouseId,
    notes: input.command.notes,
    items: [...input.command.items]
        .sort((left, right) => left.productId.localeCompare(right.productId))
        .map(item => ({ productId: item.productId, quantity: item.quantity })),
})).digest('hex');

export const assertMatchingStockTransferReplay = (
    existing: { payloadHash?: string | null; payloadVersion?: number | null },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadVersion === 1 && existing.payloadHash === expectedPayloadHash) return;
    throw new StockTransferError(
        'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con una transferencia distinta',
    );
};
