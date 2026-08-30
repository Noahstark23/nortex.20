/**
 * Motor unico de ventas online/offline.
 *
 * Invariantes:
 * - tenant, usuario y canal vienen del servidor;
 * - producto, precio, costo, unidad, modo y paso se leen dentro de la tx;
 * - cantidades y dinero se calculan con Decimal.js;
 * - una etiqueta se vuelve a parsear por su version exacta y nunca se guarda cruda;
 * - stock, FEFO, contabilidad, medicion y auditoria confirman o revierten juntos.
 */
import { z } from 'zod';
import Decimal from 'decimal.js';
import { createHash } from 'crypto';
import { Prisma, type Sale } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { parseQuantity } from '../../utils/quantity.js';
import { normalizeScaleLabelCode } from '../../utils/scaleLabels.js';
import { PeriodLockedError, recordSale, seedChartOfAccounts } from './accounting.js';
import { applyStockDelta, StockError, asegurarBodegaPorDefecto } from './stockService.js';
import {
    normalizeSaleItems,
    SaleItemNormalizationError,
    type NormalizedSaleItem,
    type SaleItemInputLike,
} from './saleItemMeasurementService.js';
import {
    allocateSaleItemBatchesFefo,
    BatchAllocationError,
} from './saleBatchAllocationService.js';
import { resolveBatchWarehouseLedgerMode } from './productBatchWarehouseLedgerService.js';
import {
    offlineReplayPayloadHash,
    type OfflineReplaySaleInput,
} from '../lib/offlineSaleReplay.js';
import { desglosarVentaConExoneracion } from './nicaTax.js';
import {
    hasFiscalRegimeVersionConflict,
    normalizeFiscalRegime,
    resolveSaleFiscalAmounts,
} from '../../utils/fiscalRegime.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

type PrismaTx = Prisma.TransactionClient;

export type SaleErrorCode =
    | 'INVALID_INPUT'
    | 'NO_SHIFT'
    | 'CUSTOMER_REQUIRED'
    | 'CUSTOMER_NOT_FOUND'
    | 'EMPLOYEE_NOT_FOUND'
    | 'CUSTOMER_BLOCKED'
    | 'CREDIT_LIMIT_EXCEEDED'
    | 'INVOICE_RANGE_EXHAUSTED'
    | 'PRODUCT_NOT_FOUND'
    | 'INSUFFICIENT_STOCK'
    | 'SCALE_LABEL_INVALID'
    | 'LABEL_PRICE_MISMATCH'
    | 'MANAGER_AUTH_REQUIRED'
    | 'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT'
    | 'FISCAL_PERIOD_LOCKED'
    | 'RECONCILIATION_REQUIRED'
    | 'DUPLICATE_MEASUREMENT_EVENT'
    | 'QUOTATION_INVALID'
    | 'OFFLINE_PAYLOAD_MISMATCH';

export class SaleError extends Error {
    constructor(
        public readonly code: SaleErrorCode,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'SaleError';
    }
}

export const assertOfflineFiscalRegimeVersion = (
    offlineSync: boolean,
    observedVersion: number | null | undefined,
    currentVersion: number,
): void => {
    if (!offlineSync || !hasFiscalRegimeVersionConflict(observedVersion, currentVersion)) return;
    throw new SaleError(
        'RECONCILIATION_REQUIRED',
        409,
        'El régimen fiscal cambió desde que se preparó la venta; requiere conciliación',
    );
};

const quantityInput = z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
        try {
            return parseQuantity(value).toString();
        } catch (error) {
            ctx.addIssue({
                code: 'custom',
                message: error instanceof Error ? error.message : 'Cantidad invalida',
            });
            return z.NEVER;
        }
    });

const finiteDecimalInput = z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
        try {
            const parsed = new Decimal(value);
            if (!parsed.isFinite()) throw new Error('Debe ser un numero finito');
            return parsed.toString();
        } catch (error) {
            ctx.addIssue({
                code: 'custom',
                message: error instanceof Error ? error.message : 'Decimal invalido',
            });
            return z.NEVER;
        }
    });

const percentageInput = finiteDecimalInput.refine(
    (value) => new Decimal(value).greaterThanOrEqualTo(0) && new Decimal(value).lessThanOrEqualTo(100),
    'El porcentaje debe estar entre 0 y 100',
);

const MeasurementSchema = z.object({
    source: z.enum(['MANUAL', 'SCALE_LABEL', 'LIVE_SCALE']),
    clientEventId: z.string().trim().min(8).max(128),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    rawCode: z.string().min(3).max(128).optional(),
    scaleLabelCode: z.string().min(3).max(128).optional(),
    profileVersionId: z.string().min(1).max(191).optional(),
    scaleProfileVersionId: z.string().min(1).max(191).optional(),
    previewBaseQuantity: quantityInput.optional(),
    value: quantityInput.optional(),
    measuredValue: quantityInput.optional(),
    unit: z.string().trim().min(1).max(32).optional(),
    measuredUnit: z.string().trim().min(1).max(32).optional(),
    deviceId: z.string().min(1).max(191).optional(),
    stable: z.boolean().optional(),
    managerOverride: z.boolean().optional(),
    // Solo diagnostico: la politica autoritativa sale de la version persistida.
    pricePolicy: z.enum(['RECALCULATE', 'REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL']).optional(),
});

export const SaleItemInputSchema = z.object({
    id: z.string().trim().min(1, 'id requerido').max(191),
    quotationItemId: z.string().trim().min(1).max(191).optional(),
    quantity: quantityInput,
    // Compatibilidad: clientes viejos lo envian. Se valida como finito y luego
    // se ignora; el precio efectivo siempre se resuelve desde Product.
    price: finiteDecimalInput.optional(),
    discount: percentageInput.optional(),
    presentation: z.object({
        quantity: quantityInput,
        unit: z.string().trim().min(1).max(32),
    }).optional(),
    // Aliases de la iteracion anterior del carrito.
    displayQuantity: quantityInput.optional(),
    displayUnit: z.string().trim().min(1).max(32).optional(),
    measurement: MeasurementSchema.optional(),
});

export const CreateSaleSchema = z.object({
    items: z.array(SaleItemInputSchema).min(1, 'Se requiere al menos 1 producto').max(500),
    paymentMethod: z.enum(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']),
    customerId: z.string().min(1).max(191).nullable().optional(),
    customerName: z.string().max(255).optional(),
    employeeId: z.string().min(1).max(191).nullable().optional(),
    globalDiscount: percentageInput.optional().default('0'),
    source: z.enum(['POS', 'WHATSAPP', 'PUBLIC_ORDER', 'OFFLINE_SYNC']).default('POS'),
    offlineId: z.string().trim().min(1).max(191).optional(),
    // Solo OFFLINE_SYNC compara esta foto con la versión autoritativa del tenant.
    // Las ventas online aceptan el campo por compatibilidad, pero nunca deciden
    // su régimen a partir del cliente.
    fiscalRegimeVersion: z.number().int().positive().optional(),
});

type CreateSaleInput = z.output<typeof CreateSaleSchema>;

export interface ExecuteSaleOptions {
    /** Solo la ruta autenticada de sync debe activarlo. */
    offlineSync?: boolean;
    createdAt?: string | Date;
}

export interface ExecuteSaleResult {
    sale: Sale;
    idempotentReplay: boolean;
}

const mapNormalizationError = (error: SaleItemNormalizationError): SaleError => {
    switch (error.code) {
        case 'PRODUCT_NOT_FOUND':
            return new SaleError('PRODUCT_NOT_FOUND', error.httpStatus, error.message);
        case 'SCALE_LABEL_INVALID':
            return new SaleError('SCALE_LABEL_INVALID', error.httpStatus, error.message);
        case 'LABEL_PRICE_MISMATCH':
            return new SaleError('LABEL_PRICE_MISMATCH', error.httpStatus, error.message);
        case 'MANAGER_AUTH_REQUIRED':
            return new SaleError('MANAGER_AUTH_REQUIRED', error.httpStatus, error.message);
        case 'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT':
            return new SaleError('SCALE_TOTAL_PRICE_REQUIRES_WEIGHT', error.httpStatus, error.message);
        case 'RECONCILIATION_REQUIRED':
            return new SaleError('RECONCILIATION_REQUIRED', error.httpStatus, error.message);
        case 'DUPLICATE_MEASUREMENT_EVENT':
            return new SaleError('DUPLICATE_MEASUREMENT_EVENT', error.httpStatus, error.message);
        case 'QUOTATION_INVALID':
            return new SaleError('QUOTATION_INVALID', error.httpStatus, error.message);
        default:
            return new SaleError('INVALID_INPUT', error.httpStatus, error.message);
    }
};

/**
 * Una conversión de cotización conserva el trato completo: no admite mezclar
 * líneas libres ni aplicar un descuento global suministrado por el cliente.
 */
export const authoritativeQuotationId = (
    items: ReadonlyArray<Pick<NormalizedSaleItem, 'quotationId'>>,
    globalDiscount: Decimal.Value,
): string | null => {
    const quotationIds = [...new Set(
        items
            .map((item) => item.quotationId)
            .filter((id): id is string => id !== null),
    )];
    if (quotationIds.length > 1) {
        throw new SaleError(
            'QUOTATION_INVALID',
            409,
            'Una venta no puede mezclar líneas de cotizaciones distintas',
        );
    }
    if (quotationIds.length === 0) return null;
    if (items.some((item) => item.quotationId === null)) {
        throw new SaleError(
            'QUOTATION_INVALID',
            409,
            'Una conversión no puede mezclar la cotización con líneas libres',
        );
    }
    if (!new Decimal(globalDiscount).isZero()) {
        throw new SaleError(
            'QUOTATION_INVALID',
            409,
            'No se puede aplicar un descuento global al convertir una cotización',
        );
    }
    return quotationIds[0];
};

const safeSaleCreatedAt = (input: string | Date | undefined): Date => {
    const now = new Date();
    if (input === undefined) return now;
    const parsed = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    if (Number.isNaN(parsed.getTime()) || parsed > now) return now;
    return parsed;
};

const storedOfflineId = (tenantId: string, offlineId: string): string => {
    // Sale.offlineId conserva un unique global legado. Hashear tenant+evento lo
    // vuelve efectivamente tenant-scoped sin exceder el VARCHAR ni cambiar una
    // restriccion existente de forma destructiva.
    const digest = createHash('sha256')
        .update(tenantId)
        .update('\0')
        .update(offlineId)
        .digest('hex');
    return `event:${digest}`;
};

const findSaleByOfflineId = async (
    tenantId: string,
    offlineId: string,
): Promise<Sale | null> => prisma.sale.findFirst({
    where: {
        tenantId,
        offlineId: {
            // Incluye el formato crudo historico para que despliegues previos
            // sigan siendo idempotentes despues de activar el scope por hash.
            in: [storedOfflineId(tenantId, offlineId), offlineId],
        },
    },
});

/**
 * Un offlineId solo puede omitir trabajo si representa exactamente el mismo
 * intento. Las filas históricas sin huella se conservan para conciliación: no
 * es seguro declararlas equivalentes por el UUID solamente.
 */
export const assertOfflineReplayMatches = (
    existing: {
        offlinePayloadHash?: string | null;
        fiscalRegimeVersionAtSale?: number | null;
    },
    expectedHash: string,
    compatibility?: {
        /** Huella de la solicitud online original, que aún no enviaba versión. */
        versionlessOnlineHash: string | null;
        observedFiscalRegimeVersion: number | undefined;
    },
): void => {
    if (!existing.offlinePayloadHash) {
        throw new SaleError(
            'OFFLINE_PAYLOAD_MISMATCH',
            409,
            'La venta existente no tiene una huella offline verificable y requiere conciliacion',
        );
    }
    if (existing.offlinePayloadHash === expectedHash) return;

    // Compatibilidad segura para respuesta online perdida: /api/sales fijaba
    // employeeId desde Shift, pero el POS todavía no enviaba fiscalRegimeVersion
    // en esa solicitud. La fila IndexedDB sí la conserva. Solo aceptamos la
    // huella online sin versión cuando la foto fiscal persistida de la venta
    // demuestra exactamente la versión observada por la cola.
    if (
        compatibility?.versionlessOnlineHash
        && existing.offlinePayloadHash === compatibility.versionlessOnlineHash
        && compatibility.observedFiscalRegimeVersion !== undefined
        && existing.fiscalRegimeVersionAtSale === compatibility.observedFiscalRegimeVersion
    ) return;

    throw new SaleError(
        'OFFLINE_PAYLOAD_MISMATCH',
        409,
        'El offlineId ya existe con un contenido diferente y requiere conciliacion',
    );
};

const measurementEventIds = (input: CreateSaleInput): string[] => [
    ...new Set(
        input.items
            .map((item) => item.measurement?.clientEventId)
            .filter((value): value is string => Boolean(value)),
    ),
];

const expectedLabelHashes = (input: CreateSaleInput): Map<string, string | null> => {
    const hashes = new Map<string, string | null>();
    for (const item of input.items) {
        const measurement = item.measurement;
        if (!measurement || measurement.source !== 'SCALE_LABEL') continue;
        const rawCode = measurement.rawCode ?? measurement.scaleLabelCode;
        if (!rawCode) {
            hashes.set(measurement.clientEventId, null);
            continue;
        }
        try {
            hashes.set(
                measurement.clientEventId,
                createHash('sha256').update(normalizeScaleLabelCode(rawCode)).digest('hex'),
            );
        } catch {
            hashes.set(measurement.clientEventId, null);
        }
    }
    return hashes;
};

export const isCompleteMeasurementReplay = (
    rows: Array<{ clientEventId: string; payloadHash: string | null; saleId: string }>,
    eventIds: string[],
    labelHashes: Map<string, string | null>,
): boolean => {
    const saleIds = new Set(rows.map((row) => row.saleId));
    const hashesMatch = rows.every((row) => {
        if (!labelHashes.has(row.clientEventId)) return true;
        const expected = labelHashes.get(row.clientEventId);
        return expected !== null && row.payloadHash === expected;
    });
    return rows.length === eventIds.length && saleIds.size === 1 && hashesMatch;
};

const findSaleByMeasurementEvents = async (
    tenantId: string,
    eventIds: string[],
    labelHashes: Map<string, string | null>,
): Promise<{ sale: Sale | null; hasConflict: boolean }> => {
    if (eventIds.length === 0) return { sale: null, hasConflict: false };
    const rows = await prisma.saleMeasurement.findMany({
        where: { tenantId, clientEventId: { in: eventIds } },
        select: {
            clientEventId: true,
            payloadHash: true,
            saleItem: { select: { sale: true } },
        },
    });
    if (rows.length === 0) return { sale: null, hasConflict: false };
    const completeReplay = isCompleteMeasurementReplay(
        rows.map((row) => ({
            clientEventId: row.clientEventId,
            payloadHash: row.payloadHash,
            saleId: row.saleItem.sale.id,
        })),
        eventIds,
        labelHashes,
    );
    return {
        sale: completeReplay ? rows[0].saleItem.sale : null,
        hasConflict: !completeReplay,
    };
};

const lineNet = (item: NormalizedSaleItem): Decimal => {
    const factor = new Decimal(1).minus(item.discountPct.dividedBy(100));
    return item.unitPrice.mul(item.quantity).mul(factor);
};

const ensureAccountingCatalog = async (tenantId: string): Promise<void> => {
    const requiredCodes = ['1.1.1', '1.1.3', '1.1.4', '2.1.2', '4.1.1', '5.1.1'];
    const rows = await prisma.account.findMany({
        where: { tenantId, code: { in: requiredCodes } },
        select: { code: true },
    });
    if (rows.length !== requiredCodes.length) await seedChartOfAccounts(tenantId);
};

/**
 * Reserva crédito con un único UPDATE condicional. La comparación y el
 * incremento ocurren en la BD, por lo que dos cajas que leyeron el mismo saldo
 * no pueden aprobar ambas si juntas exceden el límite.
 */
export const reserveCustomerCredit = async (
    tx: PrismaTx,
    params: {
        tenantId: string;
        customerId: string;
        creditLimit: Decimal.Value;
        amount: Decimal.Value;
    },
): Promise<void> => {
    const amount = new Decimal(params.amount);
    const maximumPriorDebt = new Decimal(params.creditLimit).minus(amount);
    const debtUpdated = await tx.customer.updateMany({
        where: {
            id: params.customerId,
            tenantId: params.tenantId,
            isBlocked: false,
            currentDebt: { lte: maximumPriorDebt.toNumber() },
        },
        data: { currentDebt: { increment: amount.toNumber() } },
    });
    if (debtUpdated.count !== 1) {
        throw new SaleError(
            'CREDIT_LIMIT_EXCEEDED',
            409,
            'El limite de credito cambio mientras se procesaba la venta; vuelva a validar',
        );
    }
};

const writeKardex = async (
    tx: PrismaTx,
    params: {
        tenantId: string;
        userId: string;
        saleId: string;
        source: string;
        item: NormalizedSaleItem;
        stockBefore: number;
        stockAfter: number;
        warehouseId: string;
        allocations: Awaited<ReturnType<typeof allocateSaleItemBatchesFefo>>['allocations'];
        unallocatedQuantity: Decimal;
    },
): Promise<void> => {
    let cursor = new Decimal(params.stockBefore);
    for (const allocation of params.allocations) {
        const after = cursor.minus(allocation.quantity);
        await tx.kardexMovement.create({
            data: {
                tenantId: params.tenantId,
                productId: params.item.productId,
                type: 'SALE',
                quantity: allocation.quantity.negated().toNumber(),
                stockBefore: cursor.toNumber(),
                stockAfter: after.toNumber(),
                referenceId: params.saleId,
                referenceType: 'SALE',
                reason: `Venta (${params.source}) - lote ${allocation.batchNumber}`,
                userId: params.userId,
                batchId: allocation.batchId,
                warehouseId: params.warehouseId,
            },
        });
        cursor = after;
    }

    if (params.allocations.length === 0 || params.unallocatedQuantity.greaterThan(0)) {
        const quantity = params.allocations.length === 0
            ? params.item.quantity
            : params.unallocatedQuantity;
        const after = cursor.minus(quantity);
        await tx.kardexMovement.create({
            data: {
                tenantId: params.tenantId,
                productId: params.item.productId,
                type: 'SALE',
                quantity: quantity.negated().toNumber(),
                stockBefore: cursor.toNumber(),
                stockAfter: after.toNumber(),
                referenceId: params.saleId,
                referenceType: 'SALE',
                reason: params.allocations.length === 0
                    ? `Venta (${params.source})`
                    : `Venta (${params.source}) - sin lote asignado`,
                userId: params.userId,
                warehouseId: params.warehouseId,
            },
        });
    }

    // Cinturon de integridad ante ruido Float del Kardex legado.
    const expected = new Decimal(params.stockAfter);
    if (cursor.minus(params.unallocatedQuantity).minus(expected).abs().greaterThan('0.000001')) {
        throw new SaleError('INVALID_INPUT', 500, 'El desglose FEFO no coincide con el stock de la venta');
    }
};

type OfflineShiftIdentity = {
    id: string;
    employeeId: string | null;
};

/**
 * Orden global de las mutaciones que comparten inventario y gaveta:
 * Product -> Shift. El cierre solo toma Shift; una venta que pierda esa carrera
 * falla al validar OPEN y revierte sus locks de producto sin quedar fuera del Z.
 */
const lockSaleProductsInOrder = async (
    tx: PrismaTx,
    tenantId: string,
    productIds: readonly string[],
): Promise<void> => {
    const orderedIds = [...new Set(productIds)].sort();
    for (const productId of orderedIds) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT \`id\`
              FROM \`Product\`
             WHERE \`id\` = ${productId}
               AND \`tenantId\` = ${tenantId}
             LIMIT 1
             FOR UPDATE
        `);
        if (rows.length !== 1) {
            throw new SaleError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado');
        }
    }
};

/**
 * Serializa venta POS y cierre sobre la misma fila de Shift. Si la venta toma
 * el lock primero, el cierre incluirá esa factura; si el cierre gana, la venta
 * verá el turno CLOSED y no podrá aparecer después del Reporte Z.
 */
const lockOpenOwnedPosShift = async (
    tx: PrismaTx,
    tenantId: string,
    userId: string,
    shiftId: string,
): Promise<OfflineShiftIdentity> => {
    const rows = await tx.$queryRaw<OfflineShiftIdentity[]>(Prisma.sql`
        SELECT \`id\`, \`employeeId\`
          FROM \`Shift\`
         WHERE \`id\` = ${shiftId}
           AND \`tenantId\` = ${tenantId}
           AND \`userId\` = ${userId}
           AND \`status\` = 'OPEN'
         LIMIT 1
         FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new SaleError('NO_SHIFT', 400, 'CAJA CERRADA: El turno no está abierto');
    }
    return rows[0];
};

/**
 * Un replay puede llegar después del cierre, por eso no exige status OPEN.
 * Sí exige que el turno exista hoy bajo el mismo tenant y usuario autenticado:
 * Shift.userId puede cambiar mediante el traspaso explícito de caja y no es
 * seguro reatribuir una cola vieja al dueño actual de otra sesión.
 */
const findOwnedOfflineShift = async (
    client: Pick<PrismaTx, 'shift'>,
    tenantId: string,
    userId: string,
    shiftId: string | null,
): Promise<OfflineShiftIdentity> => {
    if (!shiftId) {
        throw new SaleError(
            'RECONCILIATION_REQUIRED',
            409,
            'La venta offline no tiene un turno verificable y requiere conciliación',
        );
    }
    const shift = await client.shift.findFirst({
        where: { id: shiftId, tenantId, userId },
        select: { id: true, employeeId: true },
    });
    if (!shift) {
        throw new SaleError(
            'RECONCILIATION_REQUIRED',
            409,
            'El turno offline es ajeno, fue reasignado o no existe; requiere conciliación',
        );
    }
    return shift;
};

/**
 * La venta nueva bloquea la fila del turno hasta confirmar. Así un traspaso de
 * caja no puede cambiar Shift.userId entre la comprobación y el Sale.create.
 */
const lockOwnedOfflineShift = async (
    tx: PrismaTx,
    tenantId: string,
    userId: string,
    shiftId: string,
): Promise<OfflineShiftIdentity> => {
    const rows = await tx.$queryRaw<OfflineShiftIdentity[]>(Prisma.sql`
        SELECT \`id\`, \`employeeId\`
          FROM \`Shift\`
         WHERE \`id\` = ${shiftId}
           AND \`tenantId\` = ${tenantId}
           AND \`userId\` = ${userId}
         LIMIT 1
         FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new SaleError(
            'RECONCILIATION_REQUIRED',
            409,
            'El turno offline fue reasignado durante la sincronización y requiere conciliación',
        );
    }
    return rows[0];
};

const assertOfflineEmployeeClaim = (
    claimedEmployeeId: string | null | undefined,
    shiftEmployeeId: string | null,
): void => {
    // null/undefined son legítimos en clientes legacy: el servidor completa la
    // identidad desde Shift. Solo una afirmación explícita y divergente se
    // considera manipulación o estado obsoleto.
    if (claimedEmployeeId == null || claimedEmployeeId === shiftEmployeeId) return;
    throw new SaleError(
        'RECONCILIATION_REQUIRED',
        409,
        'La identidad de cajero no coincide con el turno y requiere conciliación',
    );
};

export async function executeSaleWithResult(
    tenantId: string,
    userId: string,
    shiftId: string | null,
    rawInput: unknown,
    options: ExecuteSaleOptions = {},
): Promise<ExecuteSaleResult> {
    const parsed = CreateSaleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const message = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(' | ');
        throw new SaleError('INVALID_INPUT', 400, message || 'Datos de entrada invalidos');
    }

    const submittedInput = parsed.data;
    const offlineSync = options.offlineSync === true;
    const source = offlineSync ? 'OFFLINE_SYNC' : submittedInput.source;
    if (!tenantId || !userId) {
        throw new SaleError('INVALID_INPUT', 401, 'Identidad de venta incompleta');
    }

    // Este guard corre ANTES de cualquier early-return idempotente. Una fila
    // legacy sin turno, de otra sesión o con employeeId forjado nunca puede
    // aparecer como `skipped` ni tocar dinero/stock.
    const offlineShift = offlineSync
        ? await findOwnedOfflineShift(prisma, tenantId, userId, shiftId)
        : null;
    if (offlineShift) {
        assertOfflineEmployeeClaim(submittedInput.employeeId, offlineShift.employeeId);
    }
    const input: CreateSaleInput = offlineShift
        ? { ...submittedInput, employeeId: offlineShift.employeeId }
        : submittedInput;

    const offlinePayloadHash = input.offlineId
        ? offlineReplayPayloadHash({
            tenantId,
            userId,
            shiftId,
            input: input as unknown as OfflineReplaySaleInput,
        })
        : null;
    const versionlessOnlineHash = input.offlineId
        && offlineSync
        && input.fiscalRegimeVersion !== undefined
        ? offlineReplayPayloadHash({
            tenantId,
            userId,
            shiftId,
            input: {
                ...input,
                fiscalRegimeVersion: undefined,
            } as unknown as OfflineReplaySaleInput,
        })
        : null;
    const assertReplayMatches = (existing: Sale): void => {
        assertOfflineReplayMatches(existing, offlinePayloadHash!, {
            versionlessOnlineHash,
            observedFiscalRegimeVersion: input.fiscalRegimeVersion,
        });
    };

    if (input.offlineId) {
        const existing = await findSaleByOfflineId(tenantId, input.offlineId);
        if (existing) {
            assertReplayMatches(existing);
            return { sale: existing, idempotentReplay: true };
        }
    }

    const eventIds = measurementEventIds(input);
    const labelHashes = expectedLabelHashes(input);
    const eventReplay = await findSaleByMeasurementEvents(tenantId, eventIds, labelHashes);
    if (eventReplay.sale) {
        if (offlinePayloadHash) assertReplayMatches(eventReplay.sale);
        return { sale: eventReplay.sale, idempotentReplay: true };
    }
    if (eventReplay.hasConflict) {
        throw new SaleError(
            'DUPLICATE_MEASUREMENT_EVENT',
            409,
            'Una captura de balanza ya pertenece a otra venta',
        );
    }

    // Filas perezosas fuera de la tx: evita carreras de primer uso en MySQL.
    await prisma.invoiceSeries.createMany({
        data: [{ tenantId, series: 'A', lastNumber: 0 }],
        skipDuplicates: true,
    });
    await asegurarBodegaPorDefecto(prisma, tenantId);
    await ensureAccountingCatalog(tenantId);

    const saleCreatedAt = safeSaleCreatedAt(options.createdAt);
    const globalDiscount = new Decimal(input.globalDiscount);
    const globalFactor = new Decimal(1).minus(globalDiscount.dividedBy(100));

    try {
        const sale = await prisma.$transaction(async (tx: PrismaTx) => {
            await lockSaleProductsInOrder(
                tx,
                tenantId,
                input.items.map((item) => item.id),
            );
            if (source === 'POS') {
                if (!shiftId) {
                    throw new SaleError('NO_SHIFT', 400, 'CAJA CERRADA: No hay turno abierto');
                }
                await lockOpenOwnedPosShift(tx, tenantId, userId, shiftId);
            } else if (offlineSync) {
                // Revalidar dentro de la transacción cierra la carrera con
                // /api/shifts/:id/tomar entre el guard previo y la escritura.
                const transactionalShift = await lockOwnedOfflineShift(
                    tx,
                    tenantId,
                    userId,
                    shiftId!,
                );
                if (transactionalShift.employeeId !== offlineShift!.employeeId) {
                    throw new SaleError(
                        'RECONCILIATION_REQUIRED',
                        409,
                        'La identidad del turno cambió durante la sincronización; requiere conciliación',
                    );
                }
            }

            // Una sola lectura autoritativa dentro de la transacción: el régimen
            // nunca viene del cliente y se congela junto con la venta.
            const tenantConfig = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    allowNegativeStock: true,
                    fiscalRegime: true,
                    fiscalRegimeVersion: true,
                },
            });
            if (!tenantConfig) {
                throw new SaleError('INVALID_INPUT', 404, 'Negocio no encontrado');
            }
            assertOfflineFiscalRegimeVersion(
                offlineSync,
                input.fiscalRegimeVersion,
                tenantConfig.fiscalRegimeVersion,
            );
            const fiscalRegime = normalizeFiscalRegime(tenantConfig.fiscalRegime);
            const enforceStock = !offlineSync && !tenantConfig.allowNegativeStock;

            let customer = null as Awaited<ReturnType<typeof tx.customer.findFirst>>;
            if (input.customerId) {
                customer = await tx.customer.findFirst({
                    where: { id: input.customerId, tenantId },
                });
                if (!customer) {
                    throw new SaleError('CUSTOMER_NOT_FOUND', 404, 'Cliente no encontrado');
                }
            }
            if (input.employeeId) {
                const employee = await tx.employee.findFirst({
                    where: { id: input.employeeId, tenantId },
                    select: { id: true },
                });
                if (!employee) {
                    throw offlineSync
                        ? new SaleError(
                            'RECONCILIATION_REQUIRED',
                            409,
                            'El cajero autoritativo del turno ya no es verificable; requiere conciliación',
                        )
                        : new SaleError('EMPLOYEE_NOT_FOUND', 404, 'Empleado no encontrado');
                }
            }

            let normalizedItems: NormalizedSaleItem[];
            try {
                normalizedItems = await normalizeSaleItems(tx, {
                    tenantId,
                    userId,
                    // Zod 4 marca transforms con `ctx.addIssue` como opcionales
                    // en su tipo de salida; el parse exitoso ya garantizo ambas
                    // cantidades requeridas en SaleItemInputSchema.
                    items: input.items as unknown as SaleItemInputLike[],
                    wholesaleCustomer: customer?.isWholesale === true,
                    allowRevokedScaleVersionForReplay: offlineSync,
                    quotedAt: saleCreatedAt,
                });
            } catch (error) {
                if (error instanceof SaleItemNormalizationError) throw mapNormalizationError(error);
                throw error;
            }
            const requiresBatchWarehouseLedger = normalizedItems.some(item => item.requiresBatchTracking);
            const batchWarehouseLedgerMode = requiresBatchWarehouseLedger
                ? await resolveBatchWarehouseLedgerMode(tx, tenantId)
                : 'OFF' as const;

            const quotationId = authoritativeQuotationId(normalizedItems, globalDiscount);
            if (quotationId) {
                const submittedQuotationItems = new Set(
                    normalizedItems
                        .filter((item) => item.quotationId === quotationId)
                        .map((item) => item.quotationItemId!),
                );
                const quotation = await tx.quotation.findFirst({
                    where: { id: quotationId, tenantId },
                    select: { _count: { select: { items: true } } },
                });
                if (!quotation || quotation._count.items !== submittedQuotationItems.size) {
                    throw new SaleError(
                        'QUOTATION_INVALID',
                        409,
                        'La venta debe incluir todas las líneas de la cotización',
                    );
                }
                const claimed = await tx.quotation.updateMany({
                    where: {
                        id: quotationId,
                        tenantId,
                        status: 'SENT',
                        expiresAt: { gte: saleCreatedAt },
                    },
                    data: { status: 'CONVERTED' },
                });
                if (claimed.count !== 1) {
                    throw new SaleError(
                        'QUOTATION_INVALID',
                        409,
                        'La cotización ya fue procesada o está vencida',
                    );
                }
            }

            const itemsSubtotal = normalizedItems.reduce(
                (sum, item) => sum.plus(lineNet(item)),
                new Decimal(0),
            );
            const finalTotal = itemsSubtotal.mul(globalFactor).toDecimalPlaces(2);
            if (finalTotal.isNegative()) {
                throw new SaleError('INVALID_INPUT', 400, 'El total no puede ser negativo');
            }
            const exemptSubtotal = normalizedItems.reduce(
                (sum, item) => item.ivaExento ? sum.plus(lineNet(item)) : sum,
                new Decimal(0),
            );
            const exemptTotal = exemptSubtotal.mul(globalFactor).toDecimalPlaces(2);
            const generalBreakdown = desglosarVentaConExoneracion(finalTotal, exemptTotal);
            const fiscalAmounts = resolveSaleFiscalAmounts(
                finalTotal,
                generalBreakdown.iva,
                fiscalRegime,
            );

            let finalStatus = 'COMPLETED';
            let creditBalance = new Decimal(0);
            let dueDate: Date | null = null;
            if (input.paymentMethod === 'CREDIT') {
                if (!input.customerId || !customer) {
                    throw new SaleError('CUSTOMER_REQUIRED', 400, 'Las ventas a credito requieren cliente');
                }
                if (customer.isBlocked) {
                    throw new SaleError('CUSTOMER_BLOCKED', 403, 'Cliente bloqueado por morosidad');
                }
                const currentDebt = new Decimal(customer.currentDebt.toString());
                const creditLimit = new Decimal(customer.creditLimit.toString());
                if (currentDebt.plus(finalTotal).greaterThan(creditLimit)) {
                    const available = Decimal.max(creditLimit.minus(currentDebt), 0).toDecimalPlaces(2);
                    throw new SaleError(
                        'CREDIT_LIMIT_EXCEEDED',
                        402,
                        `Excede limite de credito. Disponible: C$${available.toString()}`,
                    );
                }
                finalStatus = 'CREDIT_PENDING';
                creditBalance = finalTotal;
                dueDate = new Date(saleCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
            }

            const counter = await tx.invoiceSeries.upsert({
                where: { tenantId_series: { tenantId, series: 'A' } },
                update: { lastNumber: { increment: 1 } },
                create: { tenantId, series: 'A', lastNumber: 1 },
            });
            if (counter.lastNumber > counter.rangeEnd) {
                throw new SaleError(
                    'INVOICE_RANGE_EXHAUSTED',
                    422,
                    'Rango de facturacion DGI agotado',
                );
            }

            const created = await tx.sale.create({
                data: {
                    tenantId,
                    total: finalTotal.toNumber(),
                    exemptTotal: exemptTotal.toNumber(),
                    fiscalRegimeAtSale: fiscalRegime,
                    fiscalRegimeVersionAtSale: tenantConfig.fiscalRegimeVersion,
                    vatAmountAtSale: fiscalAmounts.vatAmount.toFixed(4),
                    status: finalStatus,
                    paymentMethod: input.paymentMethod,
                    customerName: input.customerName ?? '',
                    customerId: input.customerId ?? null,
                    employeeId: input.employeeId ?? null,
                    balance: creditBalance.toNumber(),
                    dueDate,
                    shiftId: shiftId ?? null,
                    soldById: userId,
                    globalDiscount: globalDiscount.toNumber(),
                    invoiceNumber: counter.lastNumber,
                    invoiceSeries: 'A',
                    offlineId: input.offlineId
                        ? storedOfflineId(tenantId, input.offlineId)
                        : null,
                    offlinePayloadHash,
                    createdAt: saleCreatedAt,
                },
            });

            const sellerWarehouse = await tx.warehouse.findFirst({
                where: { tenantId, sellerId: userId, isActive: true },
                select: { id: true },
            });
            let costTotal = new Decimal(0);

            for (const item of normalizedItems) {
                const persistedCost = item.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
                const saleItem = await tx.saleItem.create({
                    data: {
                        saleId: created.id,
                        productId: item.productId,
                        quantity: item.quantity.toNumber(),
                        priceAtSale: item.unitPrice.toFixed(2),
                        unitPriceExactAtSale: item.unitPrice.toFixed(4),
                        costAtSale: persistedCost.toFixed(2),
                        discount: item.discountPct.toNumber(),
                        ivaExento: item.ivaExento,
                        productNameAtSale: item.productNameAtSale,
                        unitAtSale: item.unitAtSale,
                        saleModeAtSale: item.saleModeAtSale,
                        quantityStepAtSale: item.quantityStepAtSale,
                        presentationAtSale: item.presentationAtSale,
                        presentationQuantityAtSale: item.presentationQuantityAtSale.toFixed(4),
                    },
                });

                if (item.measurement) {
                    await tx.saleMeasurement.create({
                        data: {
                            tenantId,
                            saleItemId: saleItem.id,
                            source: item.measurement.source,
                            profileVersionId: item.measurement.profileVersionId,
                            deviceId: item.measurement.deviceId,
                            sourceValue: item.measurement.sourceValue.toFixed(4),
                            sourceUnit: item.measurement.sourceUnit,
                            baseQuantity: item.measurement.baseQuantity.toFixed(4),
                            encodedPrice: item.measurement.encodedPrice?.toFixed(4) ?? null,
                            pricingPolicy: item.measurement.pricingPolicy,
                            stable: item.measurement.stable,
                            clientEventId: item.measurement.clientEventId,
                            payloadHash: item.measurement.payloadHash,
                            capturedAt: item.measurement.capturedAt,
                            userId,
                        },
                    });
                }

                let stock;
                try {
                    stock = await applyStockDelta(tx, {
                        tenantId,
                        productId: item.productId,
                        delta: item.quantity.negated().toNumber(),
                        enforceSufficient: enforceStock,
                        warehouseId: sellerWarehouse?.id,
                    });
                } catch (error) {
                    if (error instanceof StockError) {
                        throw error.code === 'PRODUCT_NOT_FOUND'
                            ? new SaleError('PRODUCT_NOT_FOUND', 404, error.message)
                            : new SaleError('INSUFFICIENT_STOCK', 422, error.message);
                    }
                    throw error;
                }

                let allocations: Awaited<ReturnType<typeof allocateSaleItemBatchesFefo>> = {
                    allocations: [],
                    unallocatedQuantity: item.quantity,
                };
                if (item.requiresBatchTracking) {
                    try {
                        allocations = await allocateSaleItemBatchesFefo(tx, {
                            tenantId,
                            productId: item.productId,
                            saleItemId: saleItem.id,
                            quantity: item.quantity,
                            enforceComplete: enforceStock,
                            capturedAt: saleCreatedAt,
                            batchWarehouseLedgerMode,
                            warehouseId: stock.warehouseId,
                            userId,
                            saleId: created.id,
                        });
                    } catch (error) {
                        if (error instanceof BatchAllocationError) {
                            throw new SaleError('INSUFFICIENT_STOCK', error.httpStatus, error.message);
                        }
                        throw error;
                    }
                    if (allocations.unallocatedQuantity.greaterThan(0)) {
                        await tx.auditLog.create({
                            data: {
                                tenantId,
                                userId,
                                action: 'SALE_BATCH_RECONCILIATION_REQUIRED',
                                details: JSON.stringify({
                                    saleId: created.id,
                                    saleItemId: saleItem.id,
                                    productId: item.productId,
                                    unallocatedQuantity: allocations.unallocatedQuantity.toString(),
                                    source,
                                }),
                            },
                        });
                    }
                }

                await writeKardex(tx, {
                    tenantId,
                    userId,
                    saleId: created.id,
                    source,
                    item,
                    stockBefore: stock.stockBefore,
                    stockAfter: stock.stockAfter,
                    warehouseId: stock.warehouseId,
                    allocations: allocations.allocations,
                    unallocatedQuantity: allocations.unallocatedQuantity,
                });
                costTotal = costTotal.plus(persistedCost.mul(item.quantity));

                if (item.acceptedLabelPriceOverride) {
                    await tx.auditLog.create({
                        data: {
                            tenantId,
                            userId,
                            action: 'SCALE_LABEL_TOTAL_ACCEPTED',
                            details: JSON.stringify({
                                saleId: created.id,
                                saleItemId: saleItem.id,
                                ...item.acceptedLabelPriceOverride,
                            }),
                        },
                    });
                }
            }

            if (input.paymentMethod === 'CREDIT' && input.customerId) {
                await reserveCustomerCredit(tx, {
                    tenantId,
                    customerId: input.customerId,
                    creditLimit: customer!.creditLimit.toString(),
                    amount: finalTotal,
                });
            }

            // Hard-fail: una venta no confirma sin su asiento en la misma tx.
            await recordSale(
                tx as Parameters<typeof recordSale>[0],
                tenantId,
                userId,
                created.id,
                finalTotal.toNumber(),
                costTotal.toDecimalPlaces(2).toNumber(),
                input.paymentMethod,
                exemptTotal.toNumber(),
                {
                    date: saleCreatedAt,
                    fiscalRegime,
                    vatAmount: fiscalAmounts.vatAmount,
                },
            );

            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId,
                    action: 'SALE_CREATED',
                    details: JSON.stringify({
                        saleId: created.id,
                        offlineId: input.offlineId ?? null,
                        total: finalTotal.toFixed(2),
                        fiscalRegime,
                        fiscalRegimeVersion: tenantConfig.fiscalRegimeVersion,
                        vatAmount: fiscalAmounts.vatAmount.toFixed(4),
                        source,
                        quotationId,
                        itemCount: normalizedItems.length,
                        measuredCount: normalizedItems.filter((item) => item.measurement !== null).length,
                        paymentMethod: input.paymentMethod,
                    }),
                },
            });
            return created;
        });

        return { sale, idempotentReplay: false };
    } catch (error) {
        if (error instanceof PeriodLockedError) {
            throw new SaleError(
                offlineSync ? 'RECONCILIATION_REQUIRED' : 'FISCAL_PERIOD_LOCKED',
                409,
                error.message,
            );
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            if (input.offlineId) {
                const existing = await findSaleByOfflineId(tenantId, input.offlineId);
                if (existing) {
                    assertReplayMatches(existing);
                    return { sale: existing, idempotentReplay: true };
                }
            }
            const replay = await findSaleByMeasurementEvents(tenantId, eventIds, labelHashes);
            if (replay.sale) {
                if (offlinePayloadHash) assertReplayMatches(replay.sale);
                return { sale: replay.sale, idempotentReplay: true };
            }
        }
        throw error;
    }
}

export async function executeSale(
    tenantId: string,
    userId: string,
    shiftId: string | null,
    rawInput: unknown,
): Promise<Sale> {
    const result = await executeSaleWithResult(tenantId, userId, shiftId, rawInput);
    return result.sale;
}
