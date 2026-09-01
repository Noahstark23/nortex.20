import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { parseQuantity } from '../../utils/quantity.js';
import {
    buildBoundedBatchWarehouseSourceKey,
    normalizeBatchWarehouseLedgerMode,
    type BatchWarehouseLedgerMode,
    type BatchWarehouseMovementType,
} from '../lib/batchWarehouseLedger.js';
import {
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError,
} from './productBatchWarehouseLedgerService.js';
import { managuaCalendarDateFloor } from '../lib/managuaBusinessDate.js';

type PrismaTx = Prisma.TransactionClient;

export interface FefoAllocation {
    batchId: string;
    batchNumber: string;
    quantity: Decimal;
}

export interface FefoAllocationResult {
    allocations: FefoAllocation[];
    unallocatedQuantity: Decimal;
}

export class BatchAllocationError extends Error {
    constructor(
        public readonly code:
            | 'INSUFFICIENT_ACTIVE_BATCH_STOCK'
            | 'BATCH_WAREHOUSE_CONTEXT_REQUIRED'
            | 'BATCH_WAREHOUSE_CONFLICT',
        message: string,
        public readonly httpStatus: number = 422,
    ) {
        super(message);
        this.name = 'BatchAllocationError';
    }
}

export type BatchRestorationErrorCode =
    | 'SALE_ITEM_NOT_FOUND'
    | 'INVALID_RETURN_QUANTITY'
    | 'BATCH_RETURN_HISTORY_INVALID'
    | 'BATCH_RETURN_HISTORY_AMBIGUOUS'
    | 'BATCH_RETURN_EXCEEDED'
    | 'BATCH_RETURN_TARGET_NOT_FOUND';

export class BatchRestorationError extends Error {
    constructor(
        public readonly code: BatchRestorationErrorCode,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'BatchRestorationError';
    }
}

export interface PreviousBatchReturnRecord {
    items: unknown;
}

export interface RestoredBatchQuantity {
    batchId: string;
    batchNumber: string;
    quantity: Decimal;
}

export interface BatchRestorationResult {
    mode: 'BATCH_RESTORED' | 'PARTIAL_BATCH_RESTORED' | 'LEGACY_AGGREGATE_ONLY';
    batchRestorations: RestoredBatchQuantity[];
    aggregateOnlyQuantity: Decimal;
}

/**
 * Contrato reusable para egresos FEFO por bodega (venta, transferencia, pedido).
 * `sourceKeyPrefix` debe identificar el evento de negocio; el helper agrega el
 * batchId y garantiza un sourceKey distinto y repetible por lote.
 */
export interface BatchWarehouseConsumptionContext {
    mode: Exclude<BatchWarehouseLedgerMode, 'OFF'>;
    warehouseId: string;
    userId: string;
    movementType: BatchWarehouseMovementType;
    referenceId: string;
    referenceType: string;
    sourceKeyPrefix: string;
    reason?: string | null;
}

interface WarehouseBatchCandidate {
    batchId: string;
    stock: Decimal.Value;
    heldStock: Decimal.Value;
    batch: {
        id: string;
        batchNumber: string;
    };
}

type JsonRecord = Record<string, unknown>;

const jsonRecord = (value: unknown): JsonRecord | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
);

const historicalQuantity = (value: unknown, field: string): Decimal => {
    try {
        return parseQuantity(value as Decimal.Value);
    } catch {
        throw new BatchRestorationError(
            'BATCH_RETURN_HISTORY_INVALID',
            409,
            `${field} contiene una cantidad inválida`,
        );
    }
};

/**
 * Restaura a los lotes originalmente consumidos por una SaleItem.
 *
 * El llamador debe pasar `previousReturns` leído DESPUÉS de bloquear la Sale y
 * ANTES de crear la devolución actual. El resultado se persiste en el JSON de
 * la línea como `batchRestorations`; `aggregateOnlyQuantity` documenta ventas
 * legacy o cantidades originalmente vendidas sin lote.
 *
 * Esta función solo incrementa ProductBatch. El stock agregado (`applyStockDelta`)
 * y Kardex se escriben por el llamador en la misma transacción.
 */
export async function restoreSaleItemBatchesForReturn(
    tx: PrismaTx,
    params: {
        tenantId: string;
        saleItemId: string;
        productId: string;
        quantity: Decimal.Value;
        previousReturns: readonly PreviousBatchReturnRecord[];
    },
): Promise<BatchRestorationResult> {
    let requested: Decimal;
    try {
        requested = parseQuantity(params.quantity);
    } catch {
        throw new BatchRestorationError(
            'INVALID_RETURN_QUANTITY',
            400,
            'La cantidad a restaurar debe ser positiva y tener hasta 4 decimales',
        );
    }

    const saleItem = await tx.saleItem.findFirst({
        where: {
            id: params.saleItemId,
            productId: params.productId,
            sale: { tenantId: params.tenantId },
        },
        select: { id: true, saleId: true, productId: true, quantity: true },
    });
    if (!saleItem) {
        throw new BatchRestorationError(
            'SALE_ITEM_NOT_FOUND',
            404,
            'La línea de venta no pertenece a este negocio',
        );
    }

    const sameProductLineCount = await tx.saleItem.count({
        where: { saleId: saleItem.saleId, productId: params.productId },
    });
    const originalAllocations = await tx.saleItemBatchAllocation.findMany({
        where: {
            tenantId: params.tenantId,
            saleItemId: params.saleItemId,
            batch: { tenantId: params.tenantId, productId: params.productId },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
            batchId: true,
            quantity: true,
            batch: { select: { batchNumber: true } },
        },
    });

    const allocationByBatch = new Map(originalAllocations.map((allocation) => [
        allocation.batchId,
        {
            batchId: allocation.batchId,
            batchNumber: allocation.batch.batchNumber,
            quantity: new Decimal(allocation.quantity.toString()),
        },
    ]));
    const consumedByBatch = new Map<string, Decimal>();
    let priorReturned = new Decimal(0);
    let priorWithoutBreakdown = new Decimal(0);

    for (const previousReturn of params.previousReturns) {
        if (!Array.isArray(previousReturn.items)) {
            throw new BatchRestorationError(
                'BATCH_RETURN_HISTORY_INVALID',
                409,
                'El historial de devoluciones requiere conciliación',
            );
        }
        for (const rawItem of previousReturn.items) {
            const item = jsonRecord(rawItem);
            if (!item) {
                throw new BatchRestorationError(
                    'BATCH_RETURN_HISTORY_INVALID',
                    409,
                    'El historial de devoluciones contiene una línea inválida',
                );
            }
            const historicalSaleItemId = typeof item.saleItemId === 'string' ? item.saleItemId : '';
            const historicalProductId = typeof item.productId === 'string' ? item.productId : '';
            const isExactLine = historicalSaleItemId === params.saleItemId;
            const isLegacyProductLine = !historicalSaleItemId && historicalProductId === params.productId;
            if (!isExactLine && !isLegacyProductLine) continue;
            if (isExactLine && historicalProductId && historicalProductId !== params.productId) {
                throw new BatchRestorationError(
                    'BATCH_RETURN_HISTORY_INVALID',
                    409,
                    'El historial relaciona la línea con otro producto',
                );
            }
            if (isLegacyProductLine && sameProductLineCount !== 1) {
                throw new BatchRestorationError(
                    'BATCH_RETURN_HISTORY_AMBIGUOUS',
                    409,
                    'Una devolución histórica no identifica la línea exacta de venta',
                );
            }

            const returned = historicalQuantity(item.quantity, 'ProductReturn.items.quantity');
            priorReturned = priorReturned.plus(returned);
            if (!Array.isArray(item.batchRestorations)) {
                // Historial anterior a la evidencia por lote: reserva capacidad
                // de los lotes en el mismo orden, pero no vuelve a incrementar.
                priorWithoutBreakdown = priorWithoutBreakdown.plus(returned);
                continue;
            }

            let detailed = new Decimal(0);
            for (const rawRestoration of item.batchRestorations) {
                const restoration = jsonRecord(rawRestoration);
                const batchId = typeof restoration?.batchId === 'string' ? restoration.batchId : '';
                if (!batchId || !allocationByBatch.has(batchId)) {
                    throw new BatchRestorationError(
                        'BATCH_RETURN_HISTORY_INVALID',
                        409,
                        'El historial referencia un lote no consumido por la venta',
                    );
                }
                const quantity = historicalQuantity(
                    restoration?.quantity,
                    'ProductReturn.items.batchRestorations.quantity',
                );
                consumedByBatch.set(
                    batchId,
                    (consumedByBatch.get(batchId) ?? new Decimal(0)).plus(quantity),
                );
                detailed = detailed.plus(quantity);
            }
            if (detailed.greaterThan(returned)) {
                throw new BatchRestorationError(
                    'BATCH_RETURN_HISTORY_INVALID',
                    409,
                    'El desglose por lote supera la cantidad devuelta',
                );
            }
        }
    }

    const soldQuantity = new Decimal(saleItem.quantity);
    if (priorReturned.plus(requested).greaterThan(soldQuantity)) {
        throw new BatchRestorationError(
            'BATCH_RETURN_EXCEEDED',
            409,
            'La devolución acumulada supera la cantidad vendida de la línea',
        );
    }

    for (const allocation of allocationByBatch.values()) {
        const consumed = consumedByBatch.get(allocation.batchId) ?? new Decimal(0);
        if (consumed.greaterThan(allocation.quantity)) {
            throw new BatchRestorationError(
                'BATCH_RETURN_HISTORY_INVALID',
                409,
                'El historial ya restaura más de lo originalmente consumido en un lote',
            );
        }
    }

    // Un retorno legacy sin desglose se imputa determinísticamente a las
    // asignaciones originales para no acreditarlas de nuevo en retornos futuros.
    for (const allocation of allocationByBatch.values()) {
        if (!priorWithoutBreakdown.greaterThan(0)) break;
        const consumed = consumedByBatch.get(allocation.batchId) ?? new Decimal(0);
        const available = Decimal.max(allocation.quantity.minus(consumed), 0);
        const logicallyConsumed = Decimal.min(available, priorWithoutBreakdown);
        consumedByBatch.set(allocation.batchId, consumed.plus(logicallyConsumed));
        priorWithoutBreakdown = priorWithoutBreakdown.minus(logicallyConsumed);
    }

    let remaining = requested;
    const batchRestorations: RestoredBatchQuantity[] = [];
    for (const allocation of allocationByBatch.values()) {
        if (!remaining.greaterThan(0)) break;
        const consumed = consumedByBatch.get(allocation.batchId) ?? new Decimal(0);
        const available = Decimal.max(allocation.quantity.minus(consumed), 0);
        const quantity = Decimal.min(available, remaining).toDecimalPlaces(4);
        if (!quantity.greaterThan(0)) continue;
        const updated = await tx.productBatch.updateMany({
            where: {
                id: allocation.batchId,
                tenantId: params.tenantId,
                productId: params.productId,
            },
            data: { stock: { increment: quantity.toNumber() } },
        });
        if (updated.count !== 1) {
            throw new BatchRestorationError(
                'BATCH_RETURN_TARGET_NOT_FOUND',
                409,
                'Un lote original ya no está disponible para restaurar',
            );
        }
        batchRestorations.push({
            batchId: allocation.batchId,
            batchNumber: allocation.batchNumber,
            quantity,
        });
        remaining = remaining.minus(quantity);
    }

    return {
        mode: originalAllocations.length === 0
            ? 'LEGACY_AGGREGATE_ONLY'
            : remaining.greaterThan(0)
                ? 'PARTIAL_BATCH_RESTORED'
                : 'BATCH_RESTORED',
        batchRestorations,
        aggregateOnlyQuantity: remaining,
    };
}

/**
 * Consume lotes vigentes por FEFO dentro de la misma transaccion de la venta.
 *
 * El stock agregado ya lo muta `applyStockDelta`; esta funcion solo mantiene el
 * desglose por lote y la evidencia exacta en SaleItemBatchAllocation. Cada
 * decremento es condicional (`stock >= cantidad`) para que dos cajas no puedan
 * drenar el mismo lote. Si una caja pierde la carrera, relee el remanente una
 * vez antes de avanzar al lote siguiente.
 */
export async function consumeProductBatchesFefo(
    tx: PrismaTx,
    params: {
        tenantId: string;
        productId: string;
        quantity: Decimal.Value;
        /** Online exige cobertura completa; backorder deja visible el faltante. */
        enforceComplete: boolean;
        capturedAt?: Date;
    },
): Promise<FefoAllocationResult> {
    const requested = parseQuantity(params.quantity);
    let remaining = requested;
    const allocations: FefoAllocation[] = [];
    const cutoff = managuaCalendarDateFloor(params.capturedAt ?? new Date());

    const batches = await tx.productBatch.findMany({
        where: {
            tenantId: params.tenantId,
            productId: params.productId,
            stock: { gt: 0 },
            expiryDate: { gte: cutoff },
        },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, batchNumber: true, stock: true },
    });

    for (const batch of batches) {
        if (!remaining.greaterThan(0)) break;

        let available = new Decimal(batch.stock.toString());
        // Dos intentos: snapshot inicial y una relectura si otra tx gano el lock.
        for (let attempt = 0; attempt < 2 && available.greaterThan(0); attempt += 1) {
            const deduct = Decimal.min(available, remaining).toDecimalPlaces(4);
            if (!deduct.greaterThan(0)) break;

            const updated = await tx.productBatch.updateMany({
                where: {
                    id: batch.id,
                    tenantId: params.tenantId,
                    productId: params.productId,
                    stock: { gte: deduct.toNumber() },
                },
                data: { stock: { decrement: deduct.toNumber() } },
            });

            if (updated.count === 1) {
                allocations.push({
                    batchId: batch.id,
                    batchNumber: batch.batchNumber,
                    quantity: deduct,
                });
                remaining = remaining.minus(deduct);
                break;
            }

            const fresh = await tx.productBatch.findFirst({
                where: {
                    id: batch.id,
                    tenantId: params.tenantId,
                    productId: params.productId,
                    expiryDate: { gte: cutoff },
                    stock: { gt: 0 },
                },
                select: { stock: true },
            });
            available = fresh ? new Decimal(fresh.stock.toString()) : new Decimal(0);
        }
    }

    if (params.enforceComplete && remaining.greaterThan(0)) {
        throw new BatchAllocationError(
            'INSUFFICIENT_ACTIVE_BATCH_STOCK',
            `Lotes vigentes insuficientes: faltan ${remaining.toString()} de ${requested.toString()}`,
        );
    }

    return { allocations, unallocatedQuantity: remaining };
}

const requireBatchWarehouseEgressContext = (params: {
    batchWarehouseLedgerMode?: BatchWarehouseLedgerMode;
    warehouseId?: string;
    userId?: string;
    saleId?: string;
    saleItemId: string;
}): BatchWarehouseConsumptionContext | null => {
    const mode = normalizeBatchWarehouseLedgerMode(params.batchWarehouseLedgerMode ?? 'OFF');
    if (mode === 'OFF') return null;
    if (!params.warehouseId || !params.userId || !params.saleId) {
        throw new BatchAllocationError(
            'BATCH_WAREHOUSE_CONTEXT_REQUIRED',
            'La venta no tiene contexto autoritativo de bodega para consumir lotes',
            409,
        );
    }
    return {
        mode,
        warehouseId: params.warehouseId,
        userId: params.userId,
        movementType: 'SALE',
        referenceId: params.saleItemId,
        referenceType: 'SALE_ITEM',
        sourceKeyPrefix: `sale:${params.saleItemId}`,
        reason: `Venta ${params.saleId}`,
    };
};

const applyBatchWarehouseAllocationDelta = async (
    tx: PrismaTx,
    params: {
        tenantId: string;
        productId: string;
        allocation: FefoAllocation;
        context: BatchWarehouseConsumptionContext;
    },
): Promise<Awaited<ReturnType<typeof applyBatchWarehouseDelta>>> => {
    try {
        return await applyBatchWarehouseDelta({
            tx,
            mode: params.context.mode,
            tenantId: params.tenantId,
            productId: params.productId,
            batchId: params.allocation.batchId,
            warehouseId: params.context.warehouseId,
            delta: params.allocation.quantity.negated().toFixed(4),
            movementType: params.context.movementType,
            referenceId: params.context.referenceId,
            referenceType: params.context.referenceType,
            userId: params.context.userId,
            reason: params.context.reason ?? null,
            sourceKey: buildBoundedBatchWarehouseSourceKey(
                params.context.sourceKeyPrefix,
                params.allocation.batchId,
            ),
            allowNegative: false,
        });
    } catch (error) {
        if (!(error instanceof BatchWarehouseLedgerError)) throw error;
        const isStockConflict = error.code === 'BATCH_WAREHOUSE_INSUFFICIENT_STOCK'
            || error.code === 'BATCH_WAREHOUSE_CONCURRENT_WRITE';
        throw new BatchAllocationError(
            isStockConflict ? 'INSUFFICIENT_ACTIVE_BATCH_STOCK' : 'BATCH_WAREHOUSE_CONFLICT',
            error.message,
            isStockConflict ? 409 : error.httpStatus,
        );
    }
};

/**
 * FEFO estricto sobre la bodega operativa. La consulta trae todos los candidatos
 * en una sola ronda; cada delta exacto usa el core auditado y el agregado legacy
 * ProductBatch se decrementa condicionalmente en la misma transacción.
 */
export const consumeProductBatchesByWarehouseFefo = async (
    tx: PrismaTx,
    params: {
        tenantId: string;
        productId: string;
        quantity: Decimal.Value;
        capturedAt?: Date;
        context: BatchWarehouseConsumptionContext;
    },
): Promise<FefoAllocationResult> => {
    const requested = parseQuantity(params.quantity);
    const cutoff = managuaCalendarDateFloor(params.capturedAt ?? new Date());
    const candidates = await tx.productBatchWarehouseStock.findMany({
        where: {
            tenantId: params.tenantId,
            productId: params.productId,
            warehouseId: params.context.warehouseId,
            stock: { gt: 0 },
            batch: {
                tenantId: params.tenantId,
                productId: params.productId,
                expiryDate: { gte: cutoff },
            },
        },
        orderBy: [
            { batch: { expiryDate: 'asc' } },
            { batch: { id: 'asc' } },
        ],
        select: {
            batchId: true,
            stock: true,
            heldStock: true,
            batch: { select: { id: true, batchNumber: true } },
        },
    }) as WarehouseBatchCandidate[];

    const available = candidates.reduce(
        (sum, candidate) => sum.plus(Decimal.max(
            new Decimal(candidate.stock.toString()).minus(candidate.heldStock.toString()),
            0,
        )),
        new Decimal(0),
    );
    if (available.lessThan(requested)) {
        throw new BatchAllocationError(
            'INSUFFICIENT_ACTIVE_BATCH_STOCK',
            `Lotes vigentes insuficientes en la bodega: faltan ${requested.minus(available).toString()} de ${requested.toString()}`,
            409,
        );
    }

    let remaining = requested;
    const allocations: FefoAllocation[] = [];
    for (const candidate of candidates) {
        if (!remaining.greaterThan(0)) break;
        const sellableStock = Decimal.max(
            new Decimal(candidate.stock.toString()).minus(candidate.heldStock.toString()),
            0,
        );
        const quantity = Decimal.min(sellableStock, remaining).toDecimalPlaces(4);
        if (!quantity.greaterThan(0)) continue;
        const allocation: FefoAllocation = {
            batchId: candidate.batchId,
            batchNumber: candidate.batch.batchNumber,
            quantity,
        };

        // El core serializa y guarda el saldo local antes del agregado de lote.
        // Si ProductBatch perdió una carrera, el throw revierte ambos cambios.
        const localDelta = await applyBatchWarehouseAllocationDelta(tx, {
            tenantId: params.tenantId,
            productId: params.productId,
            allocation,
            context: params.context,
        });
        // Un traslado/pedido nunca puede crear stock destino desde un origen
        // ausente. En SHADOW una carrera se registra como GAP en el core, pero
        // este throw revierte ese evento junto con todo el documento.
        if (localDelta.status === 'SHADOW_GAP') {
            throw new BatchAllocationError(
                'INSUFFICIENT_ACTIVE_BATCH_STOCK',
                'El stock lote-bodega cambió; intentá nuevamente',
                409,
            );
        }
        const globalBatch = await tx.productBatch.updateMany({
            where: {
                id: candidate.batchId,
                tenantId: params.tenantId,
                productId: params.productId,
                stock: { gte: quantity.toNumber() },
            },
            data: { stock: { decrement: quantity.toNumber() } },
        });
        if (globalBatch.count !== 1) {
            throw new BatchAllocationError(
                'INSUFFICIENT_ACTIVE_BATCH_STOCK',
                'El stock global del lote cambió; intentá nuevamente',
                409,
            );
        }
        allocations.push(allocation);
        remaining = remaining.minus(quantity);
    }

    if (remaining.greaterThan(0)) {
        throw new BatchAllocationError(
            'INSUFFICIENT_ACTIVE_BATCH_STOCK',
            'El stock lote-bodega cambió; intentá nuevamente',
            409,
        );
    }
    return { allocations, unallocatedQuantity: new Decimal(0) };
};

/**
 * Consume FEFO y enlaza evidencia de lote+bodega con una línea de venta.
 * Los callers legacy que no pasan modo conservan OFF; SHADOW/ENFORCED fallan
 * cerrado si falta el contexto de bodega resuelto por el servidor.
 */
export async function allocateSaleItemBatchesFefo(
    tx: PrismaTx,
    params: {
        tenantId: string;
        productId: string;
        saleItemId: string;
        quantity: Decimal.Value;
        /** Online exige cobertura completa; offline deja visible el faltante. */
        enforceComplete: boolean;
        capturedAt?: Date;
        batchWarehouseLedgerMode?: BatchWarehouseLedgerMode;
        warehouseId?: string;
        userId?: string;
        saleId?: string;
    },
): Promise<FefoAllocationResult> {
    const context = requireBatchWarehouseEgressContext(params);
    const result = context?.mode === 'ENFORCED'
        ? await consumeProductBatchesByWarehouseFefo(tx, {
            tenantId: params.tenantId,
            productId: params.productId,
            quantity: params.quantity,
            capturedAt: params.capturedAt,
            context,
        })
        : await consumeProductBatchesFefo(tx, params);

    if (context?.mode === 'SHADOW') {
        for (const allocation of result.allocations) {
            await applyBatchWarehouseAllocationDelta(tx, {
                tenantId: params.tenantId,
                productId: params.productId,
                allocation,
                context,
            });
        }
    }

    if (result.allocations.length > 0) {
        await tx.saleItemBatchAllocation.createMany({
            data: result.allocations.map(allocation => ({
                tenantId: params.tenantId,
                saleItemId: params.saleItemId,
                batchId: allocation.batchId,
                warehouseId: params.warehouseId ?? null,
                quantity: allocation.quantity.toFixed(4),
            })),
        });
    }
    return result;
}
