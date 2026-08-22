import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { parseQuantity } from '../../utils/quantity.js';

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
        public readonly code: 'INSUFFICIENT_ACTIVE_BATCH_STOCK',
        message: string,
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
    const cutoff = params.capturedAt ?? new Date();

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

/** Consume FEFO y enlaza la evidencia histórica con una línea de venta. */
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
    },
): Promise<FefoAllocationResult> {
    const result = await consumeProductBatchesFefo(tx, params);
    for (const allocation of result.allocations) {
        await tx.saleItemBatchAllocation.create({
            data: {
                tenantId: params.tenantId,
                saleItemId: params.saleItemId,
                batchId: allocation.batchId,
                quantity: allocation.quantity.toFixed(4),
            },
        });
    }
    return result;
}
