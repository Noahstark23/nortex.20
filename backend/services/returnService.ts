import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { validateQuantity, type SaleMode } from '../../utils/quantity.js';

export class ReturnResolutionError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'ReturnResolutionError';
    }
}

export interface ReturnSaleItemSnapshot {
    id: string;
    productId: string;
    quantity: Decimal.Value;
    priceAtSale: Decimal.Value;
    unitPriceExactAtSale?: Decimal.Value | null;
    costAtSale: Decimal.Value;
    discount?: Decimal.Value | null;
    ivaExento?: boolean | null;
    productNameAtSale?: string | null;
    unitAtSale?: string | null;
    saleModeAtSale?: string | null;
    quantityStepAtSale?: Decimal.Value | null;
    presentationAtSale?: string | null;
    presentationQuantityAtSale?: Decimal.Value | null;
}

export interface ReturnProductAuthority {
    id: string;
    name?: string | null;
    unit?: string | null;
}

export interface PreviousReturnRecord {
    items: unknown;
}

export interface ReturnSaleKardexLocation {
    warehouseId?: string | null;
}

export type ReturnRefundMethod = 'CASH' | 'CARD' | 'QR' | 'TRANSFER';

export interface ReturnPaymentMethodSnapshot {
    method?: string | null;
}

export interface RequestedReturnItem {
    saleItemId?: string;
    productId?: string;
    quantity: Decimal.Value;
}

export interface ReturnIdempotencyPayload {
    saleId: string;
    items: readonly RequestedReturnItem[];
    reason: string;
    refundMethod?: ReturnRefundMethod | null;
}

export interface ExistingReturnIdempotencyRecord {
    payloadHash?: string | null;
}

export interface ReturnLineAvailability {
    saleItemId: string;
    productId: string;
    name: string;
    unit: string;
    saleMode: SaleMode;
    quantityStep: Decimal;
    soldQuantity: Decimal;
    returnedQuantity: Decimal;
    returnableQuantity: Decimal;
    priceAtSale: Decimal;
    refundUnitPrice: Decimal;
    costAtSale: Decimal;
    ivaExento: boolean;
    presentation: 'BASE' | 'PACK';
    presentationQuantity: Decimal;
}

export interface ResolvedReturnItem extends ReturnLineAvailability {
    quantity: Decimal;
    lineTotal: Decimal;
    lineCost: Decimal;
    lineExemptTotal: Decimal;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;

const decimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new ReturnResolutionError('RETURN_DATA_INVALID', 409, `${field} no es un decimal válido`);
    }
    if (!parsed.isFinite()) {
        throw new ReturnResolutionError('RETURN_DATA_INVALID', 409, `${field} debe ser finito`);
    }
    return parsed;
};

/**
 * Huella canónica de la intención de devolución.
 *
 * - excluye `clientEventId` porque ese valor es la llave de idempotencia;
 * - excluye `price`, un campo legacy que el servidor ignora;
 * - normaliza cantidades decimales y el orden de líneas para que dos reintentos
 *   semánticamente idénticos produzcan la misma huella;
 * - incluye venta, identidades de línea, motivo y canal de reembolso, de modo
 *   que reutilizar una llave para otra operación se detecte como conflicto.
 */
export const buildReturnPayloadHash = (payload: ReturnIdempotencyPayload): string => {
    const canonicalItems = payload.items
        .map((item) => ({
            saleItemId: item.saleItemId?.trim() || null,
            productId: item.productId?.trim() || null,
            quantity: decimal(item.quantity, 'items.quantity').toString(),
        }))
        .sort((left, right) => {
            const leftKey = JSON.stringify(left);
            const rightKey = JSON.stringify(right);
            return leftKey.localeCompare(rightKey);
        });

    const canonicalPayload = JSON.stringify({
        version: 1,
        saleId: payload.saleId.trim(),
        items: canonicalItems,
        reason: payload.reason.trim(),
        refundMethod: payload.refundMethod ?? null,
    });

    return createHash('sha256').update(canonicalPayload).digest('hex');
};

/**
 * Un registro sin hash es histórico y nunca se considera un replay seguro.
 * Aceptarlo permitiría que una llave reutilizada ejecutara una intención que no
 * podemos demostrar idéntica a la original.
 */
export const assertMatchingReturnReplay = (
    existing: ExistingReturnIdempotencyRecord,
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new ReturnResolutionError(
        'RETURN_IDEMPOTENCY_CONFLICT',
        409,
        'La clave de idempotencia ya fue usada con otra devolución',
    );
};

const percentage = (value: Decimal.Value | null | undefined, field: string): Decimal => {
    const parsed = value == null ? new Decimal(0) : decimal(value, field);
    if (parsed.isNegative() || parsed.greaterThan(100)) {
        throw new ReturnResolutionError('RETURN_DATA_INVALID', 409, `${field} debe estar entre 0 y 100`);
    }
    return parsed;
};

const groupSaleItemsByProduct = (saleItems: readonly ReturnSaleItemSnapshot[]) => {
    const result = new Map<string, ReturnSaleItemSnapshot[]>();
    for (const line of saleItems) {
        const bucket = result.get(line.productId) ?? [];
        bucket.push(line);
        result.set(line.productId, bucket);
    }
    return result;
};

/**
 * Una venta autoritativa descuenta una sola ubicación. Varias filas Kardex son
 * normales (lotes/líneas); varias bodegas no lo son y requieren conciliación.
 * Los movimientos históricos sin warehouse conservan el fallback default.
 */
export const resolveReturnWarehouseId = (
    movements: readonly ReturnSaleKardexLocation[],
): string | null => {
    const warehouseIds = new Set(
        movements
            .map((movement) => typeof movement.warehouseId === 'string' ? movement.warehouseId.trim() : '')
            .filter(Boolean),
    );
    if (warehouseIds.size > 1) {
        throw new ReturnResolutionError(
            'RETURN_WAREHOUSE_RECONCILIATION_REQUIRED',
            409,
            'La venta tiene movimientos en varias bodegas; requiere conciliación antes de devolver',
        );
    }
    return warehouseIds.values().next().value ?? null;
};

const REFUND_METHODS = new Set<ReturnRefundMethod>(['CASH', 'CARD', 'QR', 'TRANSFER']);
const RETURN_REFUND_METHOD_ORDER: readonly ReturnRefundMethod[] = ['CASH', 'CARD', 'QR', 'TRANSFER'];

const normalizedRefundMethod = (value: unknown): ReturnRefundMethod | null => {
    if (typeof value !== 'string') return null;
    const method = value.trim().toUpperCase() as ReturnRefundMethod;
    return REFUND_METHODS.has(method) ? method : null;
};

/**
 * Opciones no sensibles para que el POS pueda resolver un reembolso de una
 * venta a crédito. Nunca devuelve montos ni el detalle de abonos: si hay uno o
 * más canales observados, limita la elección a ellos; un historial legacy sin
 * evidencia ofrece los canales soportados y el OWNER/ADMIN elige explícitamente.
 */
export const allowedReturnRefundMethods = (params: {
    salePaymentMethod: string;
    payments: readonly ReturnPaymentMethodSnapshot[];
}): ReturnRefundMethod[] => {
    if (params.salePaymentMethod !== 'CREDIT') return [];
    const observed = new Set(
        params.payments
            .map((payment) => normalizedRefundMethod(payment.method))
            .filter((method): method is ReturnRefundMethod => method !== null),
    );
    return observed.size > 0
        ? RETURN_REFUND_METHOD_ORDER.filter((method) => observed.has(method))
        : [...RETURN_REFUND_METHOD_ORDER];
};

/**
 * Resuelve el canal al que vuelve el importe YA COBRADO. Una venta de contado
 * conserva su método original. En crédito solo se infiere cuando todos los
 * abonos observados usan el mismo método; una mezcla exige elección explícita
 * de OWNER/ADMIN (el endpoint ya está protegido por rol) o conciliación.
 */
export const resolveReturnRefundMethod = (params: {
    salePaymentMethod: string;
    payments: readonly ReturnPaymentMethodSnapshot[];
    explicitRefundMethod?: ReturnRefundMethod | null;
    settledRefund: Decimal.Value;
}): ReturnRefundMethod | null => {
    const settledRefund = decimal(params.settledRefund, 'settledRefund');
    if (settledRefund.isNegative()) {
        throw new ReturnResolutionError('RETURN_REFUND_INVALID', 409, 'El importe liquidado de la devolución no puede ser negativo');
    }
    if (settledRefund.isZero()) return null;

    const explicit = normalizedRefundMethod(params.explicitRefundMethod);
    if (params.salePaymentMethod !== 'CREDIT') {
        const original = normalizedRefundMethod(params.salePaymentMethod);
        if (!original) {
            throw new ReturnResolutionError(
                'RETURN_REFUND_METHOD_RECONCILIATION_REQUIRED',
                409,
                'El método de pago original requiere conciliación antes de devolver',
            );
        }
        if (explicit && explicit !== original) {
            throw new ReturnResolutionError(
                'RETURN_REFUND_METHOD_MISMATCH',
                409,
                'El método de reembolso no coincide con el pago original',
            );
        }
        return original;
    }

    const observed = new Set(
        params.payments
            .map((payment) => normalizedRefundMethod(payment.method))
            .filter((method): method is ReturnRefundMethod => method !== null),
    );
    if (observed.size === 1) {
        const derived = observed.values().next().value!;
        if (explicit && explicit !== derived) {
            throw new ReturnResolutionError(
                'RETURN_REFUND_METHOD_MISMATCH',
                409,
                'El método de reembolso no coincide con los abonos de la venta',
            );
        }
        return derived;
    }
    if (!explicit) {
        throw new ReturnResolutionError(
            'RETURN_REFUND_METHOD_RECONCILIATION_REQUIRED',
            409,
            observed.size > 1
                ? 'La venta recibió abonos por métodos distintos; elegí el método de reembolso'
                : 'No se puede derivar cómo fue cobrada la venta; elegí el método de reembolso',
        );
    }
    if (observed.size > 1 && !observed.has(explicit)) {
        throw new ReturnResolutionError(
            'RETURN_REFUND_METHOD_MISMATCH',
            409,
            'El método elegido no aparece entre los abonos de la venta',
        );
    }
    return explicit;
};

const resolveLineIdentity = (
    candidate: { saleItemId?: unknown; productId?: unknown },
    linesById: Map<string, ReturnSaleItemSnapshot>,
    linesByProduct: Map<string, ReturnSaleItemSnapshot[]>,
    legacyCode: string,
): ReturnSaleItemSnapshot => {
    const saleItemId = typeof candidate.saleItemId === 'string' ? candidate.saleItemId.trim() : '';
    const productId = typeof candidate.productId === 'string' ? candidate.productId.trim() : '';

    if (saleItemId) {
        const line = linesById.get(saleItemId);
        if (!line) {
            throw new ReturnResolutionError('SALE_ITEM_NOT_FOUND', 400, `La línea ${saleItemId} no pertenece a la venta`);
        }
        if (productId && productId !== line.productId) {
            throw new ReturnResolutionError('SALE_ITEM_PRODUCT_MISMATCH', 400, 'La línea y el producto enviados no coinciden');
        }
        return line;
    }

    if (!productId) {
        throw new ReturnResolutionError('SALE_ITEM_REQUIRED', 400, 'Cada devolución requiere saleItemId');
    }
    const candidates = linesByProduct.get(productId) ?? [];
    if (candidates.length === 0) {
        throw new ReturnResolutionError('PRODUCT_NOT_IN_SALE', 400, `El producto ${productId} no pertenece a la venta`);
    }
    if (candidates.length !== 1) {
        throw new ReturnResolutionError(
            legacyCode,
            409,
            `La venta contiene ${candidates.length} líneas del producto ${productId}; seleccioná la línea exacta`,
        );
    }
    return candidates[0];
};

/**
 * Lee el historial JSON legacy sin perder la identidad nueva. Un historial
 * viejo por productId se acepta únicamente cuando esa venta tenía una sola
 * línea de ese producto; si era ambiguo se bloquea para no sobredevolver.
 */
export const returnedQuantityBySaleItem = (
    saleItems: readonly ReturnSaleItemSnapshot[],
    previousReturns: readonly PreviousReturnRecord[],
): Map<string, Decimal> => {
    const linesById = new Map(saleItems.map((line) => [line.id, line]));
    const linesByProduct = groupSaleItemsByProduct(saleItems);
    const result = new Map<string, Decimal>();

    for (const record of previousReturns) {
        if (!Array.isArray(record.items)) {
            throw new ReturnResolutionError('RETURN_HISTORY_INVALID', 409, 'El historial de devoluciones requiere revisión');
        }
        for (const rawItem of record.items) {
            const item = asRecord(rawItem);
            if (!item) {
                throw new ReturnResolutionError('RETURN_HISTORY_INVALID', 409, 'El historial contiene una línea inválida');
            }
            const line = resolveLineIdentity(
                item,
                linesById,
                linesByProduct,
                'AMBIGUOUS_LEGACY_RETURN_HISTORY',
            );
            let quantity: Decimal;
            try {
                quantity = validateQuantity(item.quantity, { saleMode: 'MEASURED', quantityStep: '0.0001' });
            } catch {
                throw new ReturnResolutionError('RETURN_HISTORY_INVALID', 409, 'El historial contiene una cantidad inválida');
            }
            result.set(line.id, (result.get(line.id) ?? new Decimal(0)).plus(quantity));
        }
    }
    return result;
};

const rulesForLine = (
    line: ReturnSaleItemSnapshot,
): { saleMode: SaleMode; quantityStep: Decimal } => {
    const saleMode: SaleMode = line.saleModeAtSale === 'COUNTED' ? 'COUNTED' : 'MEASURED';
    // El paso es parte del contrato histórico de la línea. Un cambio posterior
    // en Product.quantityStep no puede volver imposible (ni más permisiva) la
    // devolución de una venta ya facturada.
    const configured = line.quantityStepAtSale;
    const quantityStep = configured == null
        ? new Decimal(saleMode === 'COUNTED' ? 1 : '0.0001')
        : decimal(configured, 'SaleItem.quantityStepAtSale');
    if (
        !quantityStep.greaterThan(0)
        || quantityStep.decimalPlaces() > 4
        || (saleMode === 'COUNTED' && !quantityStep.isInteger())
    ) {
        throw new ReturnResolutionError('RETURN_STEP_INVALID', 409, 'El paso de devolución del producto no es válido');
    }
    return { saleMode, quantityStep };
};

export const buildReturnAvailability = (params: {
    saleItems: readonly ReturnSaleItemSnapshot[];
    previousReturns: readonly PreviousReturnRecord[];
    productsById: ReadonlyMap<string, ReturnProductAuthority>;
    globalDiscount?: Decimal.Value | null;
}): ReturnLineAvailability[] => {
    const returned = returnedQuantityBySaleItem(params.saleItems, params.previousReturns);
    const globalFactor = new Decimal(1).minus(percentage(params.globalDiscount, 'globalDiscount').dividedBy(100));

    return params.saleItems.map((line) => {
        const { saleMode, quantityStep } = rulesForLine(line);
        const soldQuantity = decimal(line.quantity, 'SaleItem.quantity');
        if (!soldQuantity.greaterThan(0)) {
            throw new ReturnResolutionError('RETURN_DATA_INVALID', 409, 'La línea vendida tiene una cantidad inválida');
        }
        const returnedQuantity = returned.get(line.id) ?? new Decimal(0);
        if (returnedQuantity.greaterThan(soldQuantity)) {
            throw new ReturnResolutionError('RETURN_HISTORY_EXCEEDS_SALE', 409, 'El historial ya supera la cantidad vendida');
        }
        const priceAtSale = decimal(
            line.unitPriceExactAtSale ?? line.priceAtSale,
            line.unitPriceExactAtSale == null ? 'SaleItem.priceAtSale' : 'SaleItem.unitPriceExactAtSale',
        );
        const costAtSale = decimal(line.costAtSale, 'SaleItem.costAtSale');
        if (priceAtSale.isNegative() || costAtSale.isNegative()) {
            throw new ReturnResolutionError('RETURN_DATA_INVALID', 409, 'La línea vendida tiene precio o costo inválido');
        }
        const lineFactor = new Decimal(1).minus(percentage(line.discount, 'SaleItem.discount').dividedBy(100));
        // Igual que la venta: conservar toda la precisión del precio y los
        // descuentos, multiplicar por cantidad y redondear solo el total.
        const refundUnitPrice = priceAtSale.mul(lineFactor).mul(globalFactor);
        const product = params.productsById.get(line.productId);
        const presentation = line.presentationAtSale === 'PACK' ? 'PACK' : 'BASE';
        const presentationQuantity = line.presentationQuantityAtSale == null
            ? soldQuantity
            : decimal(line.presentationQuantityAtSale, 'SaleItem.presentationQuantityAtSale');

        return {
            saleItemId: line.id,
            productId: line.productId,
            name: line.productNameAtSale?.trim() || product?.name?.trim() || line.productId,
            unit: line.unitAtSale?.trim() || product?.unit?.trim() || 'unidad',
            saleMode,
            quantityStep,
            soldQuantity,
            returnedQuantity,
            returnableQuantity: soldQuantity.minus(returnedQuantity),
            priceAtSale,
            refundUnitPrice,
            costAtSale,
            ivaExento: line.ivaExento === true,
            presentation,
            presentationQuantity,
        };
    });
};

export const resolveRequestedReturnItems = (params: {
    saleItems: readonly ReturnSaleItemSnapshot[];
    previousReturns: readonly PreviousReturnRecord[];
    requestedItems: readonly RequestedReturnItem[];
    productsById: ReadonlyMap<string, ReturnProductAuthority>;
    globalDiscount?: Decimal.Value | null;
}): { items: ResolvedReturnItem[]; total: Decimal; costTotal: Decimal; exemptTotal: Decimal } => {
    const availability = buildReturnAvailability(params);
    const availabilityById = new Map(availability.map((line) => [line.saleItemId, line]));
    const snapshotById = new Map(params.saleItems.map((line) => [line.id, line]));
    const snapshotsByProduct = groupSaleItemsByProduct(params.saleItems);
    const requestedById = new Map<string, Decimal>();

    for (const requested of params.requestedItems) {
        const snapshot = resolveLineIdentity(
            requested,
            snapshotById,
            snapshotsByProduct,
            'AMBIGUOUS_LEGACY_RETURN_ITEM',
        );
        const available = availabilityById.get(snapshot.id)!;
        let quantity: Decimal;
        try {
            quantity = validateQuantity(requested.quantity, {
                saleMode: available.saleMode,
                quantityStep: available.quantityStep,
            });
        } catch (error) {
            throw new ReturnResolutionError(
                'INVALID_RETURN_QUANTITY',
                400,
                error instanceof Error ? `${available.name}: ${error.message}` : `${available.name}: cantidad inválida`,
            );
        }
        requestedById.set(snapshot.id, (requestedById.get(snapshot.id) ?? new Decimal(0)).plus(quantity));
    }

    const resolved: ResolvedReturnItem[] = [];
    for (const [saleItemId, quantity] of requestedById) {
        const available = availabilityById.get(saleItemId)!;
        // La suma de entradas duplicadas se vuelve a validar contra el paso.
        try {
            validateQuantity(quantity, { saleMode: available.saleMode, quantityStep: available.quantityStep });
        } catch {
            throw new ReturnResolutionError('INVALID_RETURN_QUANTITY', 400, `${available.name}: cantidad inválida`);
        }
        if (quantity.greaterThan(available.returnableQuantity)) {
            throw new ReturnResolutionError(
                'RETURN_QUANTITY_EXCEEDED',
                409,
                `${available.name}: solo quedan ${available.returnableQuantity.toString()} ${available.unit} por devolver`,
            );
        }
        resolved.push({
            ...available,
            quantity,
            lineTotal: available.refundUnitPrice.mul(quantity),
            lineCost: available.costAtSale.mul(quantity),
            lineExemptTotal: available.ivaExento
                ? available.refundUnitPrice.mul(quantity)
                : new Decimal(0),
        });
    }

    if (resolved.length === 0) {
        throw new ReturnResolutionError('RETURN_ITEMS_REQUIRED', 400, 'Seleccioná al menos una línea para devolver');
    }
    return {
        items: resolved,
        total: resolved.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0)).toDecimalPlaces(2),
        costTotal: resolved.reduce((sum, item) => sum.plus(item.lineCost), new Decimal(0)).toDecimalPlaces(2),
        exemptTotal: resolved.reduce((sum, item) => sum.plus(item.lineExemptTotal), new Decimal(0)).toDecimalPlaces(2),
    };
};
