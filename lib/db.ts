import Dexie, { Table } from 'dexie';
import { validateScaleLabelProfiles, type ScaleLabelProfile } from '../utils/scaleLabels';
import { parseQuantity } from '../utils/quantity';
import type { MeasurementPricePolicy, MeasurementSource } from '../types';

export interface OfflineMeasurement {
    source: MeasurementSource;
    clientEventId: string;
    capturedAt: string;
    /** Indispensable para que el servidor vuelva a parsear una etiqueta. */
    rawCode?: string;
    profileVersionId?: string;
    previewBaseQuantity?: string;
    sourceValue?: string;
    sourceUnit?: string;
    encodedPrice?: string;
    pricingPolicy?: MeasurementPricePolicy;
    managerOverride?: boolean;
    deviceId?: string;
    stable?: boolean;
}

export interface OfflineCartItem {
    id: string;
    name: string;
    /** Pin a la línea de cotización; el sync debe conservarlo sin reinterpretar. */
    quotationItemId?: string;
    /** v1/v2 guardaban number; v3 escribe el decimal canónico como string. */
    quantity: string | number;
    price: number;
    costPrice: number;
    discount?: number;
    cartLineId?: string;
    presentation?: { quantity: string; unit: string };
    measurement?: OfflineMeasurement;
    // Compatibilidad con ventas que se encolaron durante la primera
    // exploración del feature. No se escriben en filas nuevas.
    displayQuantity?: number;
    displayUnit?: string;
    measurementSource?: 'MANUAL' | 'SCALE_LABEL' | 'LIVE_SCALE';
    measurementCode?: string;
    scaleProfileVersionId?: string;
    scalePlu?: string;
    measuredValue?: number;
    measuredUnit?: string;
    measurementPricePolicy?: 'RECALCULATE' | 'REQUIRE_MATCH' | 'ACCEPT_LABEL_TOTAL';
}

export interface OfflineScaleProfile extends ScaleLabelProfile {
    /** `id` también es la versión; este alias hace explícito el pin offline. */
    profileVersionId: string;
    profileVersion?: number;
    pricingPolicy: MeasurementPricePolicy;
    roundingTolerance?: string;
}

export interface OfflineScaleMapping {
    profileVersionId: string;
    plu: string;
    productId: string;
    sourceUnit: string;
    product?: {
        id: string;
        name: string;
        unit: string;
        price: string | number;
        saleMode?: 'COUNTED' | 'MEASURED' | null;
        quantityStep?: string | number | null;
    };
}

/** Caché mínima para clasificar offline, siempre aislada por tenant. */
export interface OfflineScaleContext {
    tenantId: string;
    fetchedAt: string;
    hash?: string;
    profiles: OfflineScaleProfile[];
    mappings: OfflineScaleMapping[];
    revokedProfileVersionIds: string[];
}

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null;

/** Convierte el contrato HTTP v1 a la forma mínima y estable de IndexedDB. */
export function normalizeActiveScaleContext(raw: unknown, tenantId: string): OfflineScaleContext {
    const root = asRecord(raw);
    const data = asRecord(root?.data);
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.profiles)) {
        throw new Error('El contexto de etiquetas recibido no tiene un esquema compatible');
    }

    const profiles: OfflineScaleProfile[] = [];
    const mappings: OfflineScaleMapping[] = [];

    for (const candidate of data.profiles) {
        const profile = asRecord(candidate);
        if (!profile || typeof profile.profileVersionId !== 'string' || !profile.profileVersionId) continue;
        const pricePolicy = profile.pricePolicy;
        if (
            pricePolicy !== 'RECALCULATE'
            && pricePolicy !== 'REQUIRE_MATCH'
            && pricePolicy !== 'ACCEPT_LABEL_TOTAL'
        ) continue;

        const normalized: OfflineScaleProfile = {
            id: profile.profileVersionId,
            profileVersionId: profile.profileVersionId,
            profileVersion: typeof profile.version === 'number' ? profile.version : undefined,
            name: typeof profile.name === 'string' ? profile.name : undefined,
            symbology: profile.symbology as OfflineScaleProfile['symbology'],
            totalLength: profile.totalLength as number,
            prefixes: Array.isArray(profile.prefixes) ? profile.prefixes.filter((v): v is string => typeof v === 'string') : [],
            itemStart: profile.itemStart as number,
            itemLength: profile.itemLength as number,
            valueStart: profile.valueStart as number,
            valueLength: profile.valueLength as number,
            valueKind: profile.valueKind as OfflineScaleProfile['valueKind'],
            impliedDecimals: profile.impliedDecimals as number,
            sourceUnit: profile.sourceUnit as string,
            checksumMode: profile.checksumMode as OfflineScaleProfile['checksumMode'],
            minValue: String(profile.minValue ?? ''),
            maxValue: String(profile.maxValue ?? ''),
            pricingPolicy: pricePolicy,
            roundingTolerance: profile.roundingTolerance == null ? undefined : String(profile.roundingTolerance),
        };
        profiles.push(normalized);

        if (!Array.isArray(profile.mappings)) continue;
        for (const mappingCandidate of profile.mappings) {
            const mapping = asRecord(mappingCandidate);
            if (!mapping || typeof mapping.plu !== 'string' || typeof mapping.productId !== 'string') continue;
            const productRecord = asRecord(mapping.product);
            const product: OfflineScaleMapping['product'] = productRecord
                && typeof productRecord.id === 'string'
                && typeof productRecord.name === 'string'
                && typeof productRecord.unit === 'string'
                ? {
                    id: productRecord.id,
                    name: productRecord.name,
                    unit: productRecord.unit,
                    price: productRecord.price as string | number,
                    saleMode: productRecord.saleMode === 'COUNTED' || productRecord.saleMode === 'MEASURED'
                        ? productRecord.saleMode
                        : null,
                    quantityStep: productRecord.quantityStep == null
                        ? null
                        : productRecord.quantityStep as string | number,
                }
                : undefined;
            mappings.push({
                profileVersionId: profile.profileVersionId,
                plu: mapping.plu,
                productId: mapping.productId,
                sourceUnit: typeof mapping.sourceUnit === 'string' ? mapping.sourceUnit : normalized.sourceUnit,
                product,
            });
        }
    }

    validateScaleLabelProfiles(profiles);

    return {
        tenantId,
        fetchedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
        hash: typeof data.cacheVersion === 'string' ? data.cacheVersion : undefined,
        profiles,
        mappings,
        revokedProfileVersionIds: [],
    };
}

export interface OfflineSale {
    offlineId: string;          // UUID v4 — clave de idempotencia
    tenantId: string;
    userId: string;
    shiftId: string | null;
    employeeId: string | null;
    customerName: string;
    customerId: string | null;
    paymentMethod: string;
    total: number;
    globalDiscount: number;
    /**
     * Versión fiscal observada al cobrar. El régimen NO viaja como autoridad:
     * durante el sync el backend compara esta versión con la vigente y manda a
     * conciliación si cambió, en vez de reinterpretar una factura entregada.
     */
    fiscalRegimeVersion: number;
    items: OfflineCartItem[];
    createdAt: string;          // ISO string
    // 0 = pendiente, 1 = sincronizada. NÚMERO, no booleano: IndexedDB no
    // acepta booleanos como clave de índice, así que un `synced: false`
    // quedaba FUERA del índice y `.where('synced').equals(0)` devolvía
    // siempre [] → toda venta offline se perdía en silencio (el POS decía
    // "Venta registrada", el badge marcaba 0 y nada se sincronizaba jamás).
    synced: 0 | 1;
    /** Estado durable de la última tentativa; nunca contiene el barcode crudo. */
    syncState?: 'PENDING' | 'FAILED' | 'RECONCILIATION_REQUIRED';
    syncCode?: string;
    syncError?: string;
    lastSyncAt?: string;
}

class NortexDB extends Dexie {
    offline_sales!: Table<OfflineSale, string>;
    scale_context!: Table<OfflineScaleContext, string>;

    constructor() {
        super('nortex_offline_v1');
        this.version(1).stores({
            offline_sales: 'offlineId, synced, createdAt',
        });
        // v2 — rescate de ventas atrapadas: convierte los `synced` booleanos
        // de v1 a 0/1 para que entren al índice y se sincronicen por fin.
        this.version(2).stores({
            offline_sales: 'offlineId, synced, createdAt',
        }).upgrade(tx =>
            tx.table('offline_sales').toCollection().modify((sale: any) => {
                sale.synced = sale.synced === true || sale.synced === 1 ? 1 : 0;
            })
        );
        // v3 — contexto de perfiles publicado y fijado por versión. La cola
        // conserva el rawCode únicamente mientras la venta esté pendiente.
        this.version(3).stores({
            offline_sales: 'offlineId, synced, createdAt',
            scale_context: 'tenantId, fetchedAt',
        }).upgrade(tx =>
            // Las filas `synced=1` ya están confirmadas en el servidor. Se
            // eliminan al migrar para no retener payloads/etiquetas históricos.
            tx.table('offline_sales').where('synced').equals(1).delete()
        );
    }
}

export const db = new NortexDB();

// Genera un UUID v4 compatible con todos los browsers modernos
export function generateOfflineId(): string {
    return crypto.randomUUID();
}

export async function saveSaleOffline(sale: Omit<OfflineSale, 'synced'>): Promise<void> {
    if (!Number.isSafeInteger(sale.fiscalRegimeVersion) || sale.fiscalRegimeVersion < 1) {
        throw new Error('La venta offline necesita una versión fiscal válida');
    }
    for (const item of sale.items) {
        parseQuantity(item.quantity);
        if (item.measurement?.source === 'SCALE_LABEL') {
            if (
                !item.measurement.rawCode
                || !item.measurement.profileVersionId
                || !item.measurement.clientEventId
            ) {
                throw new Error('La etiqueta offline necesita código, versión y evento para poder revalidarse');
            }
        }
    }
    await db.offline_sales.put({ ...sale, synced: 0, syncState: 'PENDING' });
}

export interface OfflineSaleScope {
    tenantId: string;
    userId?: string;
}

export const offlineSaleBelongsToScope = (
    sale: Pick<OfflineSale, 'tenantId' | 'userId'>,
    scope: OfflineSaleScope,
): boolean => sale.tenantId === scope.tenantId
    && (scope.userId === undefined || sale.userId === scope.userId);

export async function getPendingSales(scope?: OfflineSaleScope): Promise<OfflineSale[]> {
    const pending = await db.offline_sales.where('synced').equals(0).toArray();
    return scope ? pending.filter((sale) => offlineSaleBelongsToScope(sale, scope)) : pending;
}

/** Leer una referencia nunca concede acceso por conocer su ID. */
export async function getPendingSale(offlineId: string, scope: Required<OfflineSaleScope>): Promise<OfflineSale | null> {
    if (!scope.tenantId || !scope.userId || !offlineId) return null;
    const sale = await db.offline_sales.get(offlineId);
    return sale?.synced === 0 && offlineSaleBelongsToScope(sale, scope) ? sale : null;
}

export async function markSalesSynced(offlineIds: string[], scope?: OfflineSaleScope): Promise<void> {
    if (offlineIds.length === 0) return;
    // Borrar es deliberado: una venta confirmada ya vive en el servidor. Dejar
    // la fila `synced=1` retendría para siempre el código crudo de la etiqueta.
    await db.offline_sales.where('offlineId').anyOf(offlineIds)
        .filter(sale => !scope || offlineSaleBelongsToScope(sale, scope)).delete();
}

export interface OfflineSyncResult {
    offlineId: string;
    status: 'created' | 'skipped' | 'failed' | 'reconciliation_required';
    code?: string;
    error?: string;
}

/** Conserva fallos/conciliaciones en la fila pendiente sin almacenar payloads nuevos. */
export async function recordOfflineSyncResults(results: readonly OfflineSyncResult[], scope?: OfflineSaleScope): Promise<void> {
    const pendingResults = results.filter((result) => (
        result.status === 'failed' || result.status === 'reconciliation_required'
    ));
    if (pendingResults.length === 0) return;
    const lastSyncAt = new Date().toISOString();
    await db.transaction('rw', db.offline_sales, async () => {
        for (const result of pendingResults) {
            if (scope) {
                const sale = await db.offline_sales.get(result.offlineId);
                if (!sale || !offlineSaleBelongsToScope(sale, scope)) continue;
            }
            await db.offline_sales.update(result.offlineId, {
                syncState: result.status === 'reconciliation_required'
                    ? 'RECONCILIATION_REQUIRED'
                    : 'FAILED',
                syncCode: result.code?.slice(0, 128),
                syncError: result.error?.slice(0, 500),
                lastSyncAt,
            });
        }
    });
}

export async function saveScaleContext(context: OfflineScaleContext): Promise<void> {
    if (!context.tenantId) throw new Error('No se puede cachear un perfil sin tenant');
    await db.scale_context.put(context);
}

export async function getScaleContext(tenantId: string): Promise<OfflineScaleContext | null> {
    if (!tenantId) return null;
    return (await db.scale_context.get(tenantId)) ?? null;
}

export async function clearScaleContext(tenantId: string): Promise<void> {
    if (!tenantId) return;
    await db.scale_context.delete(tenantId);
}
