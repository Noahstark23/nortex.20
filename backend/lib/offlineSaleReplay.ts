import { createHash } from 'crypto';
import Decimal from 'decimal.js';

type DecimalLike = string | number;

interface OfflineReplayMeasurement {
    source: 'MANUAL' | 'SCALE_LABEL' | 'LIVE_SCALE';
    clientEventId: string;
    capturedAt?: string;
    rawCode?: string;
    scaleLabelCode?: string;
    profileVersionId?: string;
    scaleProfileVersionId?: string;
    managerOverride?: boolean;
}

interface OfflineReplayItem {
    id: string;
    quotationItemId?: string;
    quantity: DecimalLike;
    price?: DecimalLike;
    discount?: DecimalLike;
    presentation?: {
        quantity: DecimalLike;
        unit: string;
    };
    displayQuantity?: DecimalLike;
    displayUnit?: string;
    measurement?: OfflineReplayMeasurement;
}

export interface OfflineReplaySaleInput {
    offlineId?: string;
    paymentMethod: 'CASH' | 'CARD' | 'QR' | 'CREDIT' | 'TRANSFER';
    customerId?: string | null;
    customerName?: string;
    employeeId?: string | null;
    globalDiscount: DecimalLike;
    source: 'POS' | 'WHATSAPP' | 'PUBLIC_ORDER' | 'OFFLINE_SYNC';
    items: OfflineReplayItem[];
}

export interface OfflineReplayFingerprintContext {
    tenantId: string;
    userId: string;
    shiftId: string | null;
    input: OfflineReplaySaleInput;
}

function decimal(value: DecimalLike | null | undefined): string | null {
    return value === null || value === undefined ? null : new Decimal(value).toString();
}

function canonicalTimestamp(value: string | undefined): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * La huella puede depender del código leído, pero su material canónico nunca
 * contiene el código crudo. Se retiran únicamente los terminadores de borde
 * que también admite el parser; controles inválidos internos no se borran y,
 * por tanto, producen una huella opaca distinta.
 */
function measurementCodeHash(measurement: OfflineReplayMeasurement): string | null {
    const rawCode = measurement.rawCode ?? measurement.scaleLabelCode;
    if (rawCode === undefined) return null;
    return sha256(rawCode.trim());
}

/**
 * Material canónico de la venta que un offlineId representa. Solo contiene
 * datos capaces de cambiar la venta autoritativa o la identidad de una
 * medición. El precio enviado se conserva para exigir el mismo payload aunque
 * el servidor no le delegue autoridad; nunca se incluye costo cliente, nombre
 * decorativo ni código de etiqueta crudo.
 *
 * OFFLINE_SYNC se normaliza a POS porque es el transporte diferido del mismo
 * intento de cobro: así una respuesta online perdida puede reintentarse desde
 * IndexedDB con la misma huella.
 */
export function canonicalOfflineReplayPayload(
    context: OfflineReplayFingerprintContext,
): Record<string, unknown> {
    return {
        version: 1,
        tenantId: context.tenantId,
        soldById: context.userId,
        shiftId: context.shiftId,
        offlineId: context.input.offlineId ?? null,
        source: context.input.source === 'OFFLINE_SYNC' ? 'POS' : context.input.source,
        paymentMethod: context.input.paymentMethod,
        customerId: context.input.customerId ?? null,
        customerName: context.input.customerName ?? '',
        employeeId: context.input.employeeId ?? null,
        globalDiscount: decimal(context.input.globalDiscount),
        items: context.input.items.map((item) => {
            const presentation = item.presentation ?? (
                item.displayQuantity === undefined
                    ? undefined
                    : { quantity: item.displayQuantity, unit: item.displayUnit ?? '' }
            );
            const measurement = item.measurement;
            return {
                productId: item.id,
                quotationItemId: item.quotationItemId ?? null,
                quantity: decimal(item.quantity),
                price: decimal(item.price),
                discount: decimal(item.discount) ?? '0',
                presentation: presentation
                    ? { quantity: decimal(presentation.quantity), unit: presentation.unit }
                    : null,
                measurement: measurement
                    ? {
                        source: measurement.source,
                        clientEventId: measurement.clientEventId,
                        capturedAt: canonicalTimestamp(measurement.capturedAt),
                        profileVersionId: measurement.profileVersionId
                            ?? measurement.scaleProfileVersionId
                            ?? null,
                        rawCodeHash: measurementCodeHash(measurement),
                        managerOverride: measurement.managerOverride === true,
                    }
                    : null,
            };
        }),
    };
}

export function offlineReplayPayloadHash(
    context: OfflineReplayFingerprintContext,
): string {
    return sha256(JSON.stringify(canonicalOfflineReplayPayload(context)));
}
