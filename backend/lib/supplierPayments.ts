import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';

export const SUPPLIER_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'CARD', 'QR'] as const;
export type SupplierPaymentMethod = typeof SUPPLIER_PAYMENT_METHODS[number];

/** Estados que representan una factura válida en libros fiscales de compras. */
export const PURCHASE_FISCAL_STATUSES = [
    'COMPLETED',
    'PENDING_PAYMENT',
    'PARTIALLY_PAID',
] as const;

/** Estados con deuda operativa; el saldo efectivo sigue siendo la autoridad. */
export const PURCHASE_PAYABLE_STATUSES = ['PENDING_PAYMENT', 'PARTIALLY_PAID'] as const;

export interface SupplierPaymentRequest {
    amount?: Decimal.Value | null;
    method?: SupplierPaymentMethod | string | null;
    clientEventId?: string | null;
    reference?: string | null;
    notes?: string | null;
}

export interface SupplierPaymentBalanceSnapshot {
    total: Decimal.Value;
    balanceDue?: Decimal.Value | null;
    status: string;
}

export interface SupplierPaymentPlan {
    previousBalance: Decimal;
    amount: Decimal;
    remainingBalance: Decimal;
    nextStatus: 'PARTIALLY_PAID' | 'COMPLETED';
    paidInFull: boolean;
}

export interface CanonicalSupplierPaymentRequest {
    amount: Decimal | null;
    method: SupplierPaymentMethod;
    clientEventId: string | null;
    reference: string | null;
    notes: string | null;
}

export class SupplierPaymentError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'SupplierPaymentError';
    }
}

// Cubre el rango completo de Purchase.total Decimal(12,2). SupplierPayment se
// conserva en Decimal(18,4) para una migración futura, pero el contrato actual
// queda en 2dp porque JournalLine y Account todavía persisten Decimal(14,2).
function supplierPaymentMaxAmount(): Decimal {
    return new Decimal('9999999999.99');
}
const MAX_DECIMAL_PLACES = 2;
const MAX_BALANCE_DECIMAL_PLACES = 4;
const SUPPLIER_PAYMENT_METHOD_SET = new Set<string>(SUPPLIER_PAYMENT_METHODS);

const parseDecimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_AMOUNT',
            400,
            `${field} no es un monto decimal válido`,
        );
    }
    if (!parsed.isFinite()) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_AMOUNT',
            400,
            `${field} debe ser un monto finito`,
        );
    }
    return parsed;
};

/** Valida un importe monetario sin redondearlo ni convertirlo primero a Number. */
export const normalizeSupplierPaymentAmount = (value: Decimal.Value): Decimal => {
    const amount = parseDecimal(value, 'amount');
    if (!amount.greaterThan(0)) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_AMOUNT',
            400,
            'amount debe ser mayor que cero',
        );
    }
    if (amount.decimalPlaces() > MAX_DECIMAL_PLACES) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_AMOUNT',
            400,
            'amount admite como máximo 2 decimales',
        );
    }
    if (amount.greaterThan(supplierPaymentMaxAmount())) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_AMOUNT',
            400,
            'amount excede el máximo permitido',
        );
    }
    return amount;
};

export const normalizeSupplierPaymentMethod = (
    value: SupplierPaymentRequest['method'],
): SupplierPaymentMethod => {
    const method = value == null ? 'CASH' : String(value).trim().toUpperCase();
    if (!SUPPLIER_PAYMENT_METHOD_SET.has(method)) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_METHOD',
            400,
            'method debe ser CASH, TRANSFER, CARD o QR',
        );
    }
    return method as SupplierPaymentMethod;
};

export const normalizeSupplierPaymentClientEventId = (
    value: string | null | undefined,
): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128) {
        throw new SupplierPaymentError(
            'INVALID_CLIENT_EVENT_ID',
            400,
            'clientEventId debe contener entre 8 y 128 caracteres',
        );
    }
    return normalized;
};

const normalizeOptionalText = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};

export function normalizeSupplierPaymentRequest(
    request: SupplierPaymentRequest = {},
): CanonicalSupplierPaymentRequest {
    return {
        amount: request.amount == null ? null : normalizeSupplierPaymentAmount(request.amount),
        method: normalizeSupplierPaymentMethod(request.method),
        clientEventId: normalizeSupplierPaymentClientEventId(request.clientEventId),
        reference: normalizeOptionalText(request.reference),
        notes: normalizeOptionalText(request.notes),
    };
}

/**
 * Saldo autoritativo para el rollout aditivo:
 * - una fila nueva usa siempre balanceDue;
 * - una compra legacy pendiente hereda total;
 * - una compra legacy completada ya no tiene deuda.
 * Cualquier otra combinación sin balance explícito exige conciliación.
 */
export const resolveEffectiveSupplierBalance = (
    purchase: SupplierPaymentBalanceSnapshot,
): Decimal => {
    if (purchase.status === 'COMPLETED') return new Decimal(0);
    if (!(PURCHASE_PAYABLE_STATUSES as readonly string[]).includes(purchase.status)) {
        throw new SupplierPaymentError(
            'PURCHASE_NOT_PAYABLE',
            409,
            `La compra en estado ${purchase.status || 'desconocido'} no admite pagos`,
        );
    }

    const source = purchase.balanceDue != null
        ? parseDecimal(purchase.balanceDue, 'balanceDue')
        : purchase.status === 'PENDING_PAYMENT'
            ? parseDecimal(purchase.total, 'total')
            : null;

    if (source === null) {
        throw new SupplierPaymentError(
            'PURCHASE_BALANCE_RECONCILIATION_REQUIRED',
            409,
            'El saldo de la compra requiere conciliación antes de registrar pagos',
        );
    }
    if (source.isNegative() || source.decimalPlaces() > MAX_BALANCE_DECIMAL_PLACES) {
        throw new SupplierPaymentError(
            'PURCHASE_BALANCE_RECONCILIATION_REQUIRED',
            409,
            'El saldo de la compra requiere conciliación antes de registrar pagos',
        );
    }
    return source;
};

/** Resuelve importe y estado final sin tocar base de datos. */
export const resolveSupplierPaymentPlan = (
    purchase: SupplierPaymentBalanceSnapshot,
    requestedAmount: Decimal.Value | null | undefined,
    hasClientEventId: boolean,
): SupplierPaymentPlan => {
    const previousBalance = resolveEffectiveSupplierBalance(purchase);
    if (previousBalance.isZero()) {
        throw new SupplierPaymentError(
            'PURCHASE_ALREADY_PAID',
            409,
            'La compra ya está pagada',
        );
    }

    const amount = requestedAmount == null
        ? normalizeSupplierPaymentAmount(previousBalance)
        : normalizeSupplierPaymentAmount(requestedAmount);
    if (amount.greaterThan(previousBalance)) {
        throw new SupplierPaymentError(
            'PAYMENT_EXCEEDS_BALANCE',
            409,
            'El pago excede el saldo pendiente de la compra',
        );
    }
    if (!hasClientEventId && amount.lessThan(previousBalance)) {
        throw new SupplierPaymentError(
            'PARTIAL_PAYMENT_REQUIRES_CLIENT_EVENT_ID',
            400,
            'Los abonos parciales requieren clientEventId para evitar duplicados',
        );
    }

    const remainingBalance = previousBalance.minus(amount);
    const paidInFull = remainingBalance.isZero();
    return {
        previousBalance,
        amount,
        remainingBalance,
        nextStatus: paidInFull ? 'COMPLETED' : 'PARTIALLY_PAID',
        paidInFull,
    };
};

/**
 * Huella canónica de la intención. No incluye tenant, usuario, clientEventId ni
 * texto sin normalizar, y nunca incorpora credenciales o secretos operativos.
 */
export const buildSupplierPaymentPayloadHash = (
    purchaseId: string,
    request: SupplierPaymentRequest = {},
): string => {
    const normalized = normalizeSupplierPaymentRequest(request);
    const canonicalPayload = JSON.stringify({
        version: 1,
        purchaseId: purchaseId.trim(),
        amount: normalized.amount?.toString() ?? null,
        method: normalized.method,
        reference: normalized.reference,
        notes: normalized.notes,
    });
    return createHash('sha256').update(canonicalPayload).digest('hex');
};

export const assertMatchingSupplierPaymentReplay = (
    existing: { payloadHash?: string | null },
    expectedPayloadHash: string,
): void => {
    if (existing.payloadHash === expectedPayloadHash) return;
    throw new SupplierPaymentError(
        'PAYMENT_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con una intención de pago distinta',
    );
};

/** Llave interna para el request legacy bodyless; no se expone como garantía de replay. */
export function createLegacySupplierPaymentEventId(): string {
    return `legacy:${randomUUID()}`;
}
