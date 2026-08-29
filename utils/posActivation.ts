import Decimal from 'decimal.js';
import { validateNonNegativeQuantity } from './quantity';

export interface QuickProductDraft {
    name: string;
    sku: string;
    price: string;
    cost: string;
    stock: string;
}

export interface PosQuantityProduct {
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: number | null;
    unit?: string | null;
}

/**
 * Compatibilidad del catálogo legacy:
 * antes de `saleMode`, el alta común del POS/inventario sembraba productos por
 * pieza con `unit = "unidad"` y sin reglas físicas. Si el POS los interpreta
 * como medidos, el `+` vuelve a sumar 0.0001 y bloquea la venta.
 */
function prefersLegacyCounted(product: PosQuantityProduct): boolean {
    return typeof product.unit === 'string'
        && product.unit.trim().toLowerCase() === 'unidad'
        && product.saleMode == null
        && product.quantityStep == null;
}

/** Mantiene fracciones legacy medidas, pero un producto contado usa enteros. */
export function effectivePosSaleMode(product: PosQuantityProduct): 'COUNTED' | 'MEASURED' {
    if (product.saleMode === 'COUNTED') return 'COUNTED';
    if (prefersLegacyCounted(product)) return 'COUNTED';
    return 'MEASURED';
}

export function effectivePosQuantityStep(product: PosQuantityProduct): number {
    if (Number.isFinite(product.quantityStep) && Number(product.quantityStep) > 0) {
        return Number(product.quantityStep);
    }
    if (prefersLegacyCounted(product)) return 1;
    return product.saleMode === 'COUNTED' ? 1 : 0.0001;
}

/**
 * Cantidad que agrega cada toque sobre una tarjeta del catálogo, incluido el
 * primero cuando el producto todavía no está en el ticket.
 *
 * Los productos contados pueden venderse en paquetes fijos (por ejemplo, de
 * 6). Iniciar en 1 o usar +1 en repeticiones, mientras el botón del ticket usa
 * +6, deja una cantidad imposible de cobrar. Los medidos conservan el gesto +1.
 */
export function repeatedCatalogAddIncrement(product: PosQuantityProduct): number {
    return effectivePosSaleMode(product) === 'COUNTED'
        ? effectivePosQuantityStep(product)
        : 1;
}

export function customerCreditUsagePct(
    creditLimit: number,
    currentDebt: number,
): number {
    if (!Number.isFinite(creditLimit) || creditLimit <= 0) return 0;
    if (!Number.isFinite(currentDebt)) return 0;
    return Math.min(Math.max((currentDebt / creditLimit) * 100, 0), 100);
}

export interface QuickProductPayload {
    name: string;
    sku: string;
    price: string;
    cost: string;
    stock: string;
    minStock: string;
    category: 'General';
    unit: 'unidad';
    saleMode: 'COUNTED';
    quantityStep: '1';
    productFamily: 'GENERAL';
}

export type QuickProductField = 'name' | 'sku' | 'price' | 'cost' | 'stock';
export type QuickProductErrors = Partial<Record<QuickProductField, string>>;

export type QuickProductValidation =
    | { ok: true; payload: QuickProductPayload }
    | { ok: false; errors: QuickProductErrors };

const decimalFromDraft = (value: string): Decimal | null => {
    try {
        const decimal = new Decimal(value.trim());
        return decimal.isFinite() ? decimal : null;
    } catch { /* Decimal rechaza formatos inválidos; se normalizan abajo. */ }
    return null;
};

/**
 * Contrato del alta rápida del POS.
 *
 * Un artículo creado con nombre + precio es una unidad contable. Los productos
 * por peso/volumen se configuran explícitamente en Inventario; no se degradan a
 * `saleMode: null`, porque ese legado hace que el botón + sume 0.0001.
 *
 * El costo vacío se guarda como cero. Nortex no conoce el costo y no debe
 * inventarlo a partir del precio de venta.
 */
export function validateQuickProductDraft(
    draft: QuickProductDraft,
    fallbackSku: string,
): QuickProductValidation {
    const errors: QuickProductErrors = {};
    const name = draft.name.trim();
    const sku = draft.sku.trim().toUpperCase() || fallbackSku;

    if (!name) errors.name = 'Escribí el nombre del producto.';
    if (sku.length > 100) errors.sku = 'El código no puede superar 100 caracteres.';

    const price = decimalFromDraft(draft.price);
    if (!price || !price.greaterThan(0)) {
        errors.price = 'Ingresá un precio mayor que cero.';
    }

    const cost = draft.cost.trim() === '' ? new Decimal(0) : decimalFromDraft(draft.cost);
    if (!cost || cost.isNegative()) {
        errors.cost = 'El costo no puede ser negativo.';
    }

    let stock: Decimal | null = null;
    try {
        stock = validateNonNegativeQuantity(draft.stock.trim() === '' ? '0' : draft.stock, {
            saleMode: 'COUNTED',
            quantityStep: '1',
        });
    } catch (error) {
        errors.stock = error instanceof Error ? error.message : 'La existencia no es válida.';
    }

    if (Object.keys(errors).length > 0 || !price || !cost || !stock) {
        return { ok: false, errors };
    }

    return {
        ok: true,
        payload: {
            name,
            sku,
            price: price.toString(),
            cost: cost.toString(),
            stock: stock.toString(),
            minStock: '5',
            category: 'General',
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: '1',
            productFamily: 'GENERAL',
        },
    };
}

export interface ApiFailurePayload {
    error?: unknown;
    code?: unknown;
    details?: unknown;
}

export type RequestErrorCategory = 'validation' | 'conflict' | 'authorization' | 'server' | 'network' | 'unknown';

export interface NormalizedApiFailure {
    message: string;
    fields: Record<string, string>;
    category: RequestErrorCategory;
    code?: string;
}

export function normalizeFieldErrors(details: unknown): Record<string, string> {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};

    const fields: Record<string, string> = {};
    for (const [field, raw] of Object.entries(details)) {
        const message = Array.isArray(raw)
            ? raw.find((value): value is string => typeof value === 'string' && value.trim() !== '')
            : typeof raw === 'string' ? raw : undefined;
        if (message) fields[field] = message;
    }
    return fields;
}

export function requestErrorCategory(status?: number): RequestErrorCategory {
    if (status === undefined) return 'network';
    if (status === 400 || status === 422) return 'validation';
    if (status === 409) return 'conflict';
    if (status === 401 || status === 403) return 'authorization';
    if (status >= 500) return 'server';
    return 'unknown';
}

export function normalizeApiFailure(
    status: number | undefined,
    payload: ApiFailurePayload | null | undefined,
    fallback: string,
): NormalizedApiFailure {
    const message = typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : fallback;
    return {
        message,
        fields: normalizeFieldErrors(payload?.details),
        category: requestErrorCategory(status),
        ...(typeof payload?.code === 'string' ? { code: payload.code } : {}),
    };
}

export interface CheckoutAttempt {
    signature: string;
    offlineId: string;
    startedAt: number;
}

/** Conserva la misma llave mientras la intención material del cobro no cambie. */
export function checkoutAttemptFor(
    previous: CheckoutAttempt | null,
    signature: string,
    createOfflineId: () => string,
    now: () => number = Date.now,
): CheckoutAttempt {
    if (previous?.signature === signature) return previous;
    return { signature, offlineId: createOfflineId(), startedAt: now() };
}
