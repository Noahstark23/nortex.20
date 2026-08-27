import { z } from 'zod';
import { createHash } from 'crypto';

const decimalLike = z.union([z.string().trim().min(1), z.number().finite()]);

const measurementSchema = z.object({
    source: z.enum(['MANUAL', 'SCALE_LABEL', 'LIVE_SCALE']),
    clientEventId: z.string().trim().min(1).max(128).optional(),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    rawCode: z.string().trim().min(1).max(128).optional(),
    profileVersionId: z.string().trim().min(1).max(191).optional(),
    previewBaseQuantity: decimalLike.optional(),
    sourceValue: decimalLike.optional(),
    sourceUnit: z.string().trim().min(1).max(32).optional(),
    encodedPrice: decimalLike.optional(),
    pricingPolicy: z.enum(['RECALCULATE', 'REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL']).optional(),
    deviceId: z.string().trim().min(1).max(191).optional(),
    stable: z.boolean().optional(),
    managerOverride: z.boolean().optional(),
}).strict();

const presentationSchema = z.object({
    quantity: decimalLike,
    unit: z.string().trim().min(1).max(32),
}).strict();

const offlineItemSchema = z.object({
    id: z.string().trim().min(1).max(191),
    quotationItemId: z.string().trim().min(1).max(191).optional(),
    // Campos de presentacion que IndexedDB conserva para el recibo/reintento;
    // no participan en precio, costo, mapping ni cantidad autoritativos.
    name: z.string().max(255).optional(),
    cartLineId: z.string().trim().min(1).max(191).optional(),
    quantity: decimalLike,
    price: decimalLike.optional(),
    costPrice: decimalLike.optional(),
    discount: decimalLike.optional(),
    presentation: presentationSchema.optional(),
    measurement: measurementSchema.optional(),
    displayQuantity: decimalLike.optional(),
    displayUnit: z.string().trim().min(1).max(32).optional(),
    measurementSource: z.enum(['MANUAL', 'SCALE_LABEL', 'LIVE_SCALE']).optional(),
    measurementCode: z.string().trim().min(1).max(128).optional(),
    scaleProfileVersionId: z.string().trim().min(1).max(191).optional(),
    scalePlu: z.string().trim().min(1).max(64).optional(),
    measuredValue: decimalLike.optional(),
    measuredUnit: z.string().trim().min(1).max(32).optional(),
    measurementPricePolicy: z.enum(['RECALCULATE', 'REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL']).optional(),
}).strict();

export const offlineSaleSchema = z.object({
    offlineId: z.string().trim().min(1).max(191),
    // IndexedDB stores this delivery marker alongside the payload.  It is
    // transport metadata only: accept it so the strict boundary remains
    // compatible with getPendingSales(), then deliberately omit it below.
    synced: z.union([z.literal(0), z.literal(1)]).optional(),
    tenantId: z.string().trim().min(1).max(191),
    userId: z.string().trim().min(1).max(191).optional(),
    shiftId: z.string().trim().min(1).max(191).nullable().optional(),
    employeeId: z.string().trim().min(1).max(191).nullable().optional(),
    customerName: z.string().max(255).optional(),
    customerId: z.string().trim().min(1).max(191).nullable().optional(),
    paymentMethod: z.enum(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']),
    total: decimalLike.optional(),
    globalDiscount: decimalLike.optional(),
    // Versión observada al facturar sin conexión. El servidor compara este
    // snapshot con la configuración autoritativa antes de reconocer dinero.
    fiscalRegimeVersion: z.number().int().positive().optional(),
    items: z.array(offlineItemSchema).min(1).max(500),
    createdAt: z.string().datetime({ offset: true }),
}).strict();

export const syncBodySchema = z.object({
    sales: z.array(offlineSaleSchema).min(1).max(200),
}).strict();

type OfflineItem = z.infer<typeof offlineItemSchema>;
type OfflineSale = z.infer<typeof offlineSaleSchema>;

export const offlineSyncFailureStatus = (
    code: string | undefined,
): 'failed' | 'reconciliation_required' => (
    code === 'RECONCILIATION_REQUIRED' || code === 'OFFLINE_PAYLOAD_MISMATCH'
        ? 'reconciliation_required'
        : 'failed'
);

const decimalString = (value: string | number | undefined): string | undefined =>
    value === undefined ? undefined : String(value);

const synthesizedEventId = (sale: OfflineSale, item: OfflineItem, index: number): string => {
    const digest = createHash('sha256')
        .update(sale.tenantId)
        .update('\0')
        .update(sale.offlineId)
        .update('\0')
        .update(String(index))
        .update('\0')
        .update(item.id)
        .digest('hex');
    return `offline:${digest}`;
};

const normalizeMeasurement = (
    sale: OfflineSale,
    item: OfflineItem,
    index: number,
): Record<string, unknown> | undefined => {
    const eventId = item.measurement?.clientEventId?.trim()
        || synthesizedEventId(sale, item, index);

    if (item.measurement) {
        return {
            source: item.measurement.source,
            clientEventId: eventId,
            capturedAt: item.measurement.capturedAt ?? sale.createdAt,
            ...(item.measurement.rawCode ? { rawCode: item.measurement.rawCode } : {}),
            ...(item.measurement.profileVersionId ? { profileVersionId: item.measurement.profileVersionId } : {}),
            ...(decimalString(item.measurement.previewBaseQuantity) ? { previewBaseQuantity: decimalString(item.measurement.previewBaseQuantity) } : {}),
            ...(decimalString(item.measurement.sourceValue) ? { value: decimalString(item.measurement.sourceValue) } : {}),
            ...(item.measurement.sourceUnit ? { unit: item.measurement.sourceUnit } : {}),
            ...(decimalString(item.measurement.encodedPrice) ? { encodedPrice: decimalString(item.measurement.encodedPrice) } : {}),
            ...(item.measurement.pricingPolicy ? { pricePolicy: item.measurement.pricingPolicy } : {}),
            ...(item.measurement.deviceId ? { deviceId: item.measurement.deviceId } : {}),
            ...(item.measurement.stable !== undefined ? { stable: item.measurement.stable } : {}),
            ...(item.measurement.managerOverride !== undefined ? { managerOverride: item.measurement.managerOverride } : {}),
        };
    }

    if (!item.measurementSource) return undefined;

    return {
        source: item.measurementSource,
        clientEventId: eventId,
        capturedAt: sale.createdAt,
        ...(item.measurementCode ? { rawCode: item.measurementCode } : {}),
        ...(item.scaleProfileVersionId ? { profileVersionId: item.scaleProfileVersionId } : {}),
        ...(decimalString(item.measuredValue) ? { value: decimalString(item.measuredValue) } : {}),
        ...(item.measuredUnit ? { unit: item.measuredUnit } : {}),
        ...(item.measurementPricePolicy ? { pricePolicy: item.measurementPricePolicy } : {}),
    };
};

export const normalizeOfflineSalePayload = (sale: OfflineSale) => ({
    offlineId: sale.offlineId,
    paymentMethod: sale.paymentMethod,
    customerId: sale.customerId ?? null,
    customerName: sale.customerName ?? '',
    employeeId: sale.employeeId ?? null,
    globalDiscount: decimalString(sale.globalDiscount) ?? '0',
    ...(sale.fiscalRegimeVersion !== undefined
        ? { fiscalRegimeVersion: sale.fiscalRegimeVersion }
        : {}),
    source: 'OFFLINE_SYNC' as const,
    items: sale.items.map((item, index) => {
        const measurement = normalizeMeasurement(sale, item, index);
        return {
            id: item.id,
            ...(item.quotationItemId ? { quotationItemId: item.quotationItemId } : {}),
            quantity: String(item.quantity),
            ...(decimalString(item.price) ? { price: decimalString(item.price) } : {}),
            ...(decimalString(item.discount) ? { discount: decimalString(item.discount) } : {}),
            ...(item.presentation ? {
                presentation: {
                    quantity: String(item.presentation.quantity),
                    unit: item.presentation.unit,
                },
            } : {}),
            ...(decimalString(item.displayQuantity) ? { displayQuantity: decimalString(item.displayQuantity) } : {}),
            ...(item.displayUnit ? { displayUnit: item.displayUnit } : {}),
            ...(measurement ? { measurement } : {}),
        };
    }),
});
