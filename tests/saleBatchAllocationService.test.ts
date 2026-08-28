import { describe, expect, it, vi } from 'vitest';
import {
    allocateSaleItemBatchesFefo,
    BatchAllocationError,
    BatchRestorationError,
    restoreSaleItemBatchesForReturn,
} from '../backend/services/saleBatchAllocationService';

const txWithBatches = (batches: Array<{ id: string; batchNumber: string; stock: number }>) => {
    const current = new Map(batches.map((batch) => [batch.id, batch.stock]));
    const created: any[] = [];
    const tx = {
        productBatch: {
            findMany: vi.fn(async () => batches),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const stock = current.get(where.id) ?? 0;
                const requested = Number(data.stock.decrement);
                if (where.tenantId !== 'tenant-a' || where.productId !== 'product-a' || stock < requested) {
                    return { count: 0 };
                }
                current.set(where.id, stock - requested);
                return { count: 1 };
            }),
            findFirst: vi.fn(async ({ where }: any) => {
                const stock = current.get(where.id) ?? 0;
                return stock > 0 ? { stock } : null;
            }),
        },
        saleItemBatchAllocation: {
            createMany: vi.fn(async ({ data }: any) => {
                created.push(...data);
                return { count: data.length };
            }),
        },
    } as any;
    return { tx, current, created };
};

describe('asignacion FEFO compartida', () => {
    it('consume en orden y persiste cantidades Decimal(18,4) tenant-scoped', async () => {
        const { tx, current, created } = txWithBatches([
            { id: 'batch-early', batchNumber: 'L-01', stock: 1 },
            { id: 'batch-later', batchNumber: 'L-02', stock: 3 },
        ]);
        const result = await allocateSaleItemBatchesFefo(tx, {
            tenantId: 'tenant-a',
            productId: 'product-a',
            saleItemId: 'sale-item-a',
            quantity: '2.5',
            enforceComplete: true,
            capturedAt: new Date('2026-08-22T00:00:00.000Z'),
            warehouseId: 'warehouse-a',
        });

        expect(result.allocations.map((allocation) => allocation.quantity.toString())).toEqual(['1', '1.5']);
        expect(result.unallocatedQuantity.toString()).toBe('0');
        expect(current.get('batch-early')).toBe(0);
        expect(current.get('batch-later')).toBe(1.5);
        expect(created).toEqual([
            expect.objectContaining({
                tenantId: 'tenant-a', saleItemId: 'sale-item-a', batchId: 'batch-early',
                warehouseId: 'warehouse-a', quantity: '1.0000',
            }),
            expect.objectContaining({
                tenantId: 'tenant-a', saleItemId: 'sale-item-a', batchId: 'batch-later',
                warehouseId: 'warehouse-a', quantity: '1.5000',
            }),
        ]);
        expect(tx.productBatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: 'tenant-a', productId: 'product-a' }),
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        }));
    });

    it('online revierte si los lotes vigentes no cubren la linea', async () => {
        const { tx } = txWithBatches([{ id: 'batch-early', batchNumber: 'L-01', stock: 0.5 }]);
        await expect(allocateSaleItemBatchesFefo(tx, {
            tenantId: 'tenant-a',
            productId: 'product-a',
            saleItemId: 'sale-item-a',
            quantity: '1',
            enforceComplete: true,
        })).rejects.toBeInstanceOf(BatchAllocationError);
    });

    it('offline conserva el faltante como no asignado para conciliacion de stock', async () => {
        const { tx } = txWithBatches([{ id: 'batch-early', batchNumber: 'L-01', stock: 0.25 }]);
        const result = await allocateSaleItemBatchesFefo(tx, {
            tenantId: 'tenant-a',
            productId: 'product-a',
            saleItemId: 'sale-item-a',
            quantity: '1',
            enforceComplete: false,
        });
        expect(result.allocations[0].quantity.toString()).toBe('0.25');
        expect(result.unallocatedQuantity.toString()).toBe('0.75');
    });
});

const txForRestoration = (options: {
    tenantId?: string;
    sold?: number;
    allocations?: Array<{ batchId: string; quantity: number; batchNumber: string }>;
}) => {
    const tenantId = options.tenantId ?? 'tenant-a';
    const batchStock = new Map((options.allocations ?? []).map((row) => [row.batchId, 0]));
    const tx = {
        saleItem: {
            findFirst: vi.fn(async ({ where }: any) => (
                where.sale?.tenantId === tenantId && where.id === 'sale-item-a' && where.productId === 'product-a'
                    ? { id: 'sale-item-a', saleId: 'sale-a', productId: 'product-a', quantity: options.sold ?? 3 }
                    : null
            )),
            count: vi.fn(async () => 1),
        },
        saleItemBatchAllocation: {
            findMany: vi.fn(async () => (options.allocations ?? []).map((row) => ({
                id: `allocation-${row.batchId}`,
                batchId: row.batchId,
                quantity: row.quantity,
                createdAt: new Date(),
                batch: { batchNumber: row.batchNumber },
            }))),
        },
        productBatch: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.tenantId !== tenantId || where.productId !== 'product-a' || !batchStock.has(where.id)) {
                    return { count: 0 };
                }
                batchStock.set(where.id, (batchStock.get(where.id) ?? 0) + Number(data.stock.increment));
                return { count: 1 };
            }),
        },
    } as any;
    return { tx, batchStock };
};

describe('restauracion de lotes en devoluciones', () => {
    it('restaura una devolución parcial multi-lote en el orden original', async () => {
        const { tx, batchStock } = txForRestoration({
            allocations: [
                { batchId: 'batch-1', batchNumber: 'L-01', quantity: 1 },
                { batchId: 'batch-2', batchNumber: 'L-02', quantity: 2 },
            ],
        });
        const result = await restoreSaleItemBatchesForReturn(tx, {
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            productId: 'product-a',
            quantity: '1.5',
            previousReturns: [],
        });

        expect(result.mode).toBe('BATCH_RESTORED');
        expect(result.batchRestorations.map((row) => ({
            batchId: row.batchId,
            quantity: row.quantity.toString(),
        }))).toEqual([
            { batchId: 'batch-1', quantity: '1' },
            { batchId: 'batch-2', quantity: '0.5' },
        ]);
        expect(batchStock.get('batch-1')).toBe(1);
        expect(batchStock.get('batch-2')).toBe(0.5);
    });

    it('una segunda devolución no vuelve a acreditar lo ya restaurado', async () => {
        const { tx, batchStock } = txForRestoration({
            allocations: [
                { batchId: 'batch-1', batchNumber: 'L-01', quantity: 1 },
                { batchId: 'batch-2', batchNumber: 'L-02', quantity: 2 },
            ],
        });
        const result = await restoreSaleItemBatchesForReturn(tx, {
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            productId: 'product-a',
            quantity: '1',
            previousReturns: [{
                items: [{
                    saleItemId: 'sale-item-a',
                    productId: 'product-a',
                    quantity: '1.5',
                    batchRestorations: [
                        { batchId: 'batch-1', quantity: '1' },
                        { batchId: 'batch-2', quantity: '0.5' },
                    ],
                }],
            }],
        });

        expect(result.batchRestorations).toHaveLength(1);
        expect(result.batchRestorations[0]).toMatchObject({ batchId: 'batch-2' });
        expect(result.batchRestorations[0].quantity.toString()).toBe('1');
        expect(batchStock.get('batch-1')).toBe(0);
        expect(batchStock.get('batch-2')).toBe(1);
    });

    it('rechaza exceso acumulado antes de tocar lotes', async () => {
        const { tx } = txForRestoration({
            sold: 2,
            allocations: [{ batchId: 'batch-1', batchNumber: 'L-01', quantity: 2 }],
        });
        await expect(restoreSaleItemBatchesForReturn(tx, {
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            productId: 'product-a',
            quantity: '1',
            previousReturns: [{ items: [{ saleItemId: 'sale-item-a', productId: 'product-a', quantity: '1.5' }] }],
        })).rejects.toMatchObject({ code: 'BATCH_RETURN_EXCEEDED' });
        expect(tx.productBatch.updateMany).not.toHaveBeenCalled();
    });

    it('no permite restaurar una SaleItem de otro tenant', async () => {
        const { tx } = txForRestoration({ tenantId: 'tenant-b', allocations: [] });
        await expect(restoreSaleItemBatchesForReturn(tx, {
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            productId: 'product-a',
            quantity: '0.5',
            previousReturns: [],
        })).rejects.toMatchObject({ code: 'SALE_ITEM_NOT_FOUND' });
        expect(tx.saleItemBatchAllocation.findMany).not.toHaveBeenCalled();
        expect(tx.productBatch.updateMany).not.toHaveBeenCalled();
    });

    it('documenta aggregate-only para ventas legacy sin allocations', async () => {
        const { tx } = txForRestoration({ sold: 1, allocations: [] });
        const result = await restoreSaleItemBatchesForReturn(tx, {
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            productId: 'product-a',
            quantity: '0.75',
            previousReturns: [],
        });
        expect(result.mode).toBe('LEGACY_AGGREGATE_ONLY');
        expect(result.aggregateOnlyQuantity.toString()).toBe('0.75');
        expect(result.batchRestorations).toEqual([]);
    });
});
