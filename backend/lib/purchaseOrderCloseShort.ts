import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import {
    orderedQuantityForItem,
    purchaseOrderRulesForReceipt,
    receivedQuantityForItem,
    type PurchaseOrderItemAuthority,
    type PurchaseOrderProductAuthority,
} from '../../utils/purchaseOrderQuantities.js';
import {
    parseQuantity,
    QuantityValidationError,
    validateQuantity,
} from '../../utils/quantity.js';
const MAX_IDENTIFIER_LENGTH = 191;
const MAX_CLOSE_SHORT_LINES = 500;
const MAX_NOTE_LENGTH = 2_000;

export const PURCHASE_ORDER_CLOSE_SHORT_REASON_CODES = [
    'SUPPLIER_SHORTAGE',
    'DISCONTINUED',
    'DELIVERY_CANCELLED',
    'QUALITY_REJECTION',
    'OTHER',
] as const;

export type PurchaseOrderCloseShortReasonCode =
    typeof PURCHASE_ORDER_CLOSE_SHORT_REASON_CODES[number];

// API nueva: solo strings decimales para no aceptar Numbers ya contaminados.
const closeShortQuantitySchema = z.string().trim().min(1).max(64);

const closeShortLineSchema = z.object({
    itemId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
    quantity: closeShortQuantitySchema,
    reasonCode: z.enum(PURCHASE_ORDER_CLOSE_SHORT_REASON_CODES),
    supplierFault: z.boolean().optional(),
    note: z.string().trim().max(MAX_NOTE_LENGTH).nullable().optional(),
}).strict();

/** Intención administrativa de cerrar saldos que el proveedor no entregará. */
export const purchaseOrderCloseShortRequestSchema = z.object({
    clientEventId: z.uuid(),
    reasonSummaryCode: z.enum(PURCHASE_ORDER_CLOSE_SHORT_REASON_CODES).nullable().optional(),
    note: z.string().trim().max(MAX_NOTE_LENGTH).nullable().optional(),
    items: z.array(closeShortLineSchema).min(1).max(MAX_CLOSE_SHORT_LINES),
}).strict();

export type PurchaseOrderCloseShortRequest = z.infer<typeof purchaseOrderCloseShortRequestSchema>;

export interface CanonicalPurchaseOrderCloseShortLine {
    itemId: string;
    quantity: string;
    reasonCode: PurchaseOrderCloseShortReasonCode;
    supplierFault: boolean | null;
    note: string | null;
}

export interface CanonicalPurchaseOrderCloseShortRequest {
    clientEventId: string;
    reasonSummaryCode: PurchaseOrderCloseShortReasonCode | null;
    note: string | null;
    lines: CanonicalPurchaseOrderCloseShortLine[];
}

export interface CloseShortPurchaseOrderItemAuthority extends PurchaseOrderItemAuthority {
    quantityRejectedExact?: Decimal.Value | { toString(): string } | null;
    quantityClosedShortExact?: Decimal.Value | { toString(): string } | null;
}

export interface NormalizedPurchaseOrderCloseShortLine<
    TItem extends CloseShortPurchaseOrderItemAuthority = CloseShortPurchaseOrderItemAuthority,
> extends CanonicalPurchaseOrderCloseShortLine {
    item: TItem;
    productId: string;
    ordered: Decimal;
    acceptedBefore: Decimal;
    rejectedBefore: Decimal;
    closedShortBefore: Decimal;
    closedShortAfter: Decimal;
    remainingBefore: Decimal;
    remainingAfter: Decimal;
    unitSnapshot: string;
    saleModeSnapshot: string;
    quantityStepSnapshot: string;
}

export type PurchaseOrderFulfillmentStatus =
    | 'APPROVED'
    | 'PARTIALLY_RECEIVED'
    | 'RECEIVED'
    | 'CLOSED_SHORT';

export class PurchaseOrderCloseShortError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'PurchaseOrderCloseShortError';
    }
}

const normalizeOptionalText = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};

const parseCloseShortQuantity = (value: string | number): Decimal => {
    try {
        return parseQuantity(value);
    } catch (error) {
        if (error instanceof QuantityValidationError) {
            throw new PurchaseOrderCloseShortError(error.code, 400, error.message);
        }
        throw error;
    }
};

const decimalState = (
    value: Decimal.Value | { toString(): string } | null | undefined,
    label: string,
): Decimal => {
    if (value == null) return new Decimal(0);
    let decimal: Decimal;
    try {
        decimal = new Decimal(value.toString());
    } catch {
        throw new PurchaseOrderCloseShortError(
            'CORRUPT_PURCHASE_ORDER_QUANTITY',
            409,
            `${label} no es válida`,
        );
    }
    if (!decimal.isFinite() || decimal.isNegative() || decimal.decimalPlaces() > 4) {
        throw new PurchaseOrderCloseShortError(
            'CORRUPT_PURCHASE_ORDER_QUANTITY',
            409,
            `${label} no es válida`,
        );
    }
    return decimal;
};

const sortCanonicalCloseShortLines = (
    left: CanonicalPurchaseOrderCloseShortLine,
    right: CanonicalPurchaseOrderCloseShortLine,
): number => left.itemId.localeCompare(right.itemId);

export const normalizePurchaseOrderCloseShortRequest = (
    request: PurchaseOrderCloseShortRequest,
): CanonicalPurchaseOrderCloseShortRequest => {
    const seen = new Set<string>();
    const lines = request.items.map((line) => {
        const itemId = line.itemId.trim();
        if (seen.has(itemId)) {
            throw new PurchaseOrderCloseShortError(
                'DUPLICATE_ITEM',
                400,
                'Hay líneas repetidas en el cierre corto',
            );
        }
        seen.add(itemId);
        return {
            itemId,
            quantity: parseCloseShortQuantity(line.quantity).toString(),
            reasonCode: line.reasonCode,
            supplierFault: line.supplierFault ?? null,
            note: normalizeOptionalText(line.note),
        };
    }).sort(sortCanonicalCloseShortLines);

    return {
        clientEventId: request.clientEventId.trim().toLowerCase(),
        reasonSummaryCode: request.reasonSummaryCode ?? null,
        note: normalizeOptionalText(request.note),
        lines,
    };
};

/** Huella tenant-scoped para replay exacto de un evento nuevo de cierre corto. */
export const buildPurchaseOrderCloseShortPayloadHash = (input: {
    tenantId: string;
    purchaseOrderId: string;
    reasonSummaryCode?: PurchaseOrderCloseShortReasonCode | null;
    note?: string | null;
    lines: CanonicalPurchaseOrderCloseShortLine[];
}): string => createHash('sha256').update(JSON.stringify({
    version: 1,
    tenantId: input.tenantId.trim(),
    purchaseOrderId: input.purchaseOrderId.trim(),
    reasonSummaryCode: input.reasonSummaryCode ?? null,
    note: normalizeOptionalText(input.note),
    lines: [...input.lines].sort(sortCanonicalCloseShortLines).map(line => ({
        itemId: line.itemId,
        quantity: new Decimal(line.quantity).toString(),
        reasonCode: line.reasonCode,
        supplierFault: line.supplierFault ?? null,
        note: normalizeOptionalText(line.note),
    })),
})).digest('hex');

export const assertMatchingPurchaseOrderCloseShortReplay = (
    existing: { payloadHash?: string | null },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new PurchaseOrderCloseShortError(
        'CLOSE_SHORT_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con un cierre corto distinto',
    );
};

export const rejectedQuantityForPurchaseOrderItem = (
    item: CloseShortPurchaseOrderItemAuthority,
): Decimal => decimalState(item.quantityRejectedExact, 'La cantidad rechazada');

export const closedShortQuantityForPurchaseOrderItem = (
    item: CloseShortPurchaseOrderItemAuthority,
): Decimal => decimalState(item.quantityClosedShortExact, 'La cantidad cerrada corta');

/** Rechazos son evidencia física, pero no cierran ni vuelven facturable el saldo. */
export const remainingOpenQuantityForPurchaseOrderItem = (
    item: CloseShortPurchaseOrderItemAuthority,
): Decimal => {
    const ordered = orderedQuantityForItem(item);
    const accepted = receivedQuantityForItem(item);
    const closedShort = closedShortQuantityForPurchaseOrderItem(item);
    const remaining = ordered.minus(accepted).minus(closedShort);
    if (!ordered.greaterThan(0) || remaining.isNegative()) {
        throw new PurchaseOrderCloseShortError(
            'CORRUPT_PURCHASE_ORDER_QUANTITY',
            409,
            `Las cantidades históricas de ${item.productName} son inconsistentes`,
        );
    }
    return remaining;
};

export const derivePurchaseOrderFulfillmentStatus = (
    items: CloseShortPurchaseOrderItemAuthority[],
): PurchaseOrderFulfillmentStatus => {
    if (items.length === 0) {
        throw new PurchaseOrderCloseShortError(
            'PURCHASE_ORDER_WITHOUT_ITEMS',
            409,
            'La orden de compra no tiene líneas',
        );
    }
    const balances = items.map(item => ({
        remaining: remainingOpenQuantityForPurchaseOrderItem(item),
        accepted: receivedQuantityForItem(item),
        closedShort: closedShortQuantityForPurchaseOrderItem(item),
    }));
    const fullyClosed = balances.every(balance => balance.remaining.isZero());
    const hasClosedShort = balances.some(balance => balance.closedShort.greaterThan(0));
    if (fullyClosed) return hasClosedShort ? 'CLOSED_SHORT' : 'RECEIVED';
    const hasProgress = balances.some(balance =>
        balance.accepted.greaterThan(0) || balance.closedShort.greaterThan(0));
    return hasProgress ? 'PARTIALLY_RECEIVED' : 'APPROVED';
};

/**
 * Valida pertenencia, snapshots y saldo abierto antes de persistir. El orden por
 * itemId también fija el orden de escrituras dentro de la OC bloqueada.
 */
export const normalizePurchaseOrderCloseShortLines = <
    TItem extends CloseShortPurchaseOrderItemAuthority,
>(
    lines: CanonicalPurchaseOrderCloseShortLine[],
    orderItems: TItem[],
    products: PurchaseOrderProductAuthority[],
): NormalizedPurchaseOrderCloseShortLine<TItem>[] => {
    const itemById = new Map(orderItems.map(item => [item.id, item]));
    const productById = new Map(products.map(product => [product.id, product]));

    return [...lines].sort(sortCanonicalCloseShortLines).map((line) => {
        const item = itemById.get(line.itemId);
        if (!item) {
            throw new PurchaseOrderCloseShortError(
                'ITEM_NOT_IN_ORDER',
                400,
                'Una línea no pertenece a esta orden de compra',
            );
        }
        const product = productById.get(item.productId);
        if (!product) {
            throw new PurchaseOrderCloseShortError(
                'PRODUCT_NOT_IN_TENANT',
                400,
                'Uno o más productos no pertenecen a tu negocio',
            );
        }

        const rules = purchaseOrderRulesForReceipt(item, product);
        const quantity = new Decimal(line.quantity);
        try {
            validateQuantity(quantity, rules);
        } catch (error) {
            if (error instanceof QuantityValidationError) {
                throw new PurchaseOrderCloseShortError(error.code, 400, error.message);
            }
            throw error;
        }

        const ordered = orderedQuantityForItem(item);
        const acceptedBefore = receivedQuantityForItem(item);
        const rejectedBefore = rejectedQuantityForPurchaseOrderItem(item);
        const closedShortBefore = closedShortQuantityForPurchaseOrderItem(item);
        const remainingBefore = remainingOpenQuantityForPurchaseOrderItem(item);
        if (quantity.greaterThan(remainingBefore)) {
            throw new PurchaseOrderCloseShortError(
                'OVER_CLOSE_SHORT',
                409,
                `No podés cerrar más de lo pendiente: a "${item.productName}" le quedan ${remainingBefore.toString()}`,
            );
        }

        return {
            ...line,
            item,
            productId: item.productId,
            ordered,
            acceptedBefore,
            rejectedBefore,
            closedShortBefore,
            closedShortAfter: closedShortBefore.plus(quantity),
            remainingBefore,
            remainingAfter: remainingBefore.minus(quantity),
            unitSnapshot: item.unitAtOrder?.trim() || product.unit.trim(),
            saleModeSnapshot: rules.saleMode,
            quantityStepSnapshot: rules.quantityStep,
        };
    });
};
