import Decimal from 'decimal.js';
import type { OfflineCartItem, OfflineMeasurement, OfflineSale } from '../lib/db';

const SALE_FIELDS = [
    'offlineId', 'tenantId', 'userId', 'shiftId', 'employeeId', 'customerName',
    'customerId', 'paymentMethod', 'total', 'globalDiscount', 'fiscalRegimeVersion', 'createdAt',
] as const satisfies readonly (keyof OfflineSale)[];
const ITEM_FIELDS = [
    'id', 'name', 'quotationItemId', 'quantity', 'price', 'costPrice', 'discount', 'cartLineId',
    'displayQuantity', 'displayUnit', 'measurementSource', 'measurementCode',
    'scaleProfileVersionId', 'scalePlu', 'measuredValue', 'measuredUnit', 'measurementPricePolicy',
] as const satisfies readonly (keyof OfflineCartItem)[];
const MEASUREMENT_FIELDS = [
    'source', 'clientEventId', 'capturedAt', 'rawCode', 'profileVersionId', 'previewBaseQuantity',
    'sourceValue', 'sourceUnit', 'encodedPrice', 'pricingPolicy', 'managerOverride', 'deviceId', 'stable',
] as const satisfies readonly (keyof OfflineMeasurement)[];

export type OfflineSyncTransportSale = Pick<OfflineSale, typeof SALE_FIELDS[number]> & {
    items: OfflineCartItem[];
};

type StoredSale = OfflineSale & {
    // POS añade estos campos por spread; filas anteriores pueden no tenerlos.
    storeCreditAmount?: unknown;
    storeCreditSourceReturnId?: unknown;
};

export class OfflineSyncTransportError extends Error {
    constructor(readonly offlineId: string,
        readonly code = 'OFFLINE_STORE_CREDIT_REVIEW_REQUIRED',
        message = 'La venta con saldo a favor requiere revisión; permanece guardada en este dispositivo.') {
        super(message);
        this.name = 'OfflineSyncTransportError';
    }
}

/** Una fila incompleta no puede reconstruirse usando la sesión o fecha actual. */
function assertCompleteSnapshot(sale: StoredSale): void {
    const validId = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 191;
    const decimal = (value: unknown, positive = false) => {
        if (typeof value !== 'number' && typeof value !== 'string' || String(value).trim() === '') return false;
        try { const amount = new Decimal(value); return amount.isFinite() && (positive ? amount.gt(0) : amount.gte(0)); } catch { return false; }
    };
    const validDate = typeof sale.createdAt === 'string'
        && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sale.createdAt) && Number.isFinite(Date.parse(sale.createdAt));
    if (![sale.offlineId, sale.tenantId, sale.userId, sale.shiftId].every(validId)
        || !validDate || !Number.isSafeInteger(sale.fiscalRegimeVersion) || sale.fiscalRegimeVersion < 1
        || !decimal(sale.total) || !decimal(sale.globalDiscount)
        || !['CASH', 'CARD', 'TRANSFER', 'QR', 'CREDIT'].includes(sale.paymentMethod)
        || !Array.isArray(sale.items) || sale.items.length < 1 || sale.items.length > 500
        || sale.items.some(item => !item || !validId(item.id) || !decimal(item.quantity, true)
            || !decimal(item.price) || item.discount !== undefined && !decimal(item.discount))) {
        throw new OfflineSyncTransportError(sale.offlineId, 'OFFLINE_SNAPSHOT_INCOMPLETE',
            'Faltan datos verificables de la venta original. Conservá esta referencia y pedí revisión; no vuelvas a registrarla.');
    }
}

function pickDefined<T, K extends keyof T>(value: T, fields: readonly K[]): Pick<T, K> {
    const picked = {} as Pick<T, K>;
    for (const key of fields) {
        if (value[key] !== undefined) picked[key] = value[key];
    }
    return picked;
}

function assertNoAppliedStoreCredit(sale: StoredSale): void {
    const amount = sale.storeCreditAmount;
    if (amount === undefined && sale.storeCreditSourceReturnId == null) return;
    // El sync actual no admite saldo a favor. Solo se omite un cero explícito:
    // blanco, null, NaN o una referencia sin importe no prueban ausencia de saldo.
    if ((typeof amount === 'string' && amount.trim() !== '') || typeof amount === 'number') {
        try {
            const decimal = new Decimal(amount);
            const literalZero = typeof amount === 'number'
                || /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(amount.trim());
            if (literalZero && decimal.isFinite() && decimal.isZero()) return;
        } catch { /* Importe ilegible: conservar la fila para revisión. */ }
    }
    throw new OfflineSyncTransportError(sale.offlineId);
}

/**
 * Proyección pura al contrato HTTP: nunca cambia la fila, crea IDs ni reenvía.
 * Los campos locales syncState/syncCode/syncError/lastSyncAt no viajan al esquema
 * estricto. Cantidades, mediciones, versión fiscal e identidad permanecen iguales.
 */
export function toOfflineSyncTransport(sale: StoredSale): OfflineSyncTransportSale {
    assertCompleteSnapshot(sale);
    assertNoAppliedStoreCredit(sale);
    return {
        ...pickDefined(sale, SALE_FIELDS),
        items: sale.items.map(item => ({
            ...pickDefined(item, ITEM_FIELDS),
            ...(item.presentation !== undefined ? {
                presentation: item.presentation && pickDefined(item.presentation, ['quantity', 'unit']),
            } : {}),
            ...(item.measurement !== undefined ? {
                measurement: item.measurement && pickDefined(item.measurement, MEASUREMENT_FIELDS),
            } : {}),
        })),
    };
}
