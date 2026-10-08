import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyBatchWarehouseDelta = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError: class BatchWarehouseLedgerError extends Error {
        constructor(
            readonly code: string,
            readonly httpStatus: number,
            message: string,
        ) {
            super(message);
            this.name = 'BatchWarehouseLedgerError';
        }
    },
}));

import {
    allocateSaleItemBatchesFefo,
    BatchAllocationError,
    consumeProductBatchesByWarehouseFefo,
} from '../backend/services/saleBatchAllocationService';
import { BatchWarehouseLedgerError } from '../backend/services/productBatchWarehouseLedgerService';
import { buildBoundedBatchWarehouseSourceKey } from '../backend/lib/batchWarehouseLedger';

interface BatchSeed {
    id: string;
    batchNumber: string;
    expiryDate: string;
    globalStock: string;
}

interface WarehouseSeed {
    batchId: string;
    warehouseId: string;
    stock: string;
    heldStock?: string;
}

const fakeTx = (options: {
    batches: BatchSeed[];
    warehouseStocks?: WarehouseSeed[];
    failGlobalBatchIds?: string[];
}) => {
    const batches = new Map(options.batches.map(batch => [batch.id, {
        ...batch,
        globalStock: new Decimal(batch.globalStock),
    }]));
    const warehouseStocks = new Map((options.warehouseStocks ?? []).map(row => [
        `${row.batchId}:${row.warehouseId}`,
        {
            stock: new Decimal(row.stock),
            heldStock: new Decimal(row.heldStock ?? 0),
        },
    ]));
    const persisted: Array<Record<string, unknown>> = [];
    const productBatchFindMany = vi.fn(async () => [...batches.values()]
        .sort((left, right) => left.expiryDate.localeCompare(right.expiryDate) || left.id.localeCompare(right.id))
        .map(batch => ({
            id: batch.id,
            batchNumber: batch.batchNumber,
            stock: batch.globalStock.toString(),
        })));
    const productBatchWarehouseStockFindMany = vi.fn(async ({ where }: {
        where: { tenantId: string; productId: string; warehouseId: string };
    }) => [...warehouseStocks.entries()]
        .filter(([key, balance]) => key.endsWith(`:${where.warehouseId}`) && balance.stock.greaterThan(0))
        .map(([key, balance]) => {
            const batchId = key.slice(0, key.lastIndexOf(':'));
            const batch = batches.get(batchId)!;
            return {
                batchId,
                stock: balance.stock.toString(),
                heldStock: balance.heldStock.toString(),
                batch: { id: batch.id, batchNumber: batch.batchNumber },
                expiryDate: batch.expiryDate,
            };
        })
        .sort((left, right) => left.expiryDate.localeCompare(right.expiryDate)
            || left.batch.id.localeCompare(right.batch.id))
        .map(({ expiryDate: _expiryDate, ...row }) => row));
    const productBatchUpdateMany = vi.fn(async ({ where, data }: {
        where: { id: string; tenantId: string; productId: string; stock: { gte: number } };
        data: { stock: { decrement: number } };
    }) => {
        const batch = batches.get(where.id);
        const decrement = new Decimal(data.stock.decrement);
        if (
            where.tenantId !== 'tenant-a'
            || where.productId !== 'product-a'
            || !batch
            || options.failGlobalBatchIds?.includes(where.id)
            || batch.globalStock.lessThan(decrement)
        ) return { count: 0 };
        batch.globalStock = batch.globalStock.minus(decrement);
        return { count: 1 };
    });
    const tx = {
        productBatch: {
            findMany: productBatchFindMany,
            updateMany: productBatchUpdateMany,
            findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
                const stock = batches.get(where.id)?.globalStock ?? new Decimal(0);
                return stock.greaterThan(0) ? { stock: stock.toString() } : null;
            }),
        },
        productBatchWarehouseStock: { findMany: productBatchWarehouseStockFindMany },
        saleItemBatchAllocation: {
            createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                persisted.push(...data);
                return { count: data.length };
            }),
        },
    };
    return {
        tx: tx as typeof tx & Parameters<typeof allocateSaleItemBatchesFefo>[0],
        batches,
        warehouseStocks,
        persisted,
    };
};

const saleContext = {
    tenantId: 'tenant-a',
    productId: 'product-a',
    saleItemId: 'sale-item-a',
    warehouseId: 'warehouse-a',
    userId: 'user-a',
    saleId: 'sale-a',
    capturedAt: new Date('2026-08-27T00:00:00.000Z'),
};

describe('egreso FEFO lote+bodega de ventas', () => {
    it('mantiene claves cortas y compacta de forma estable UUID + lote SHA-256', () => {
        expect(buildBoundedBatchWarehouseSourceKey('pedido:p:reserve:item:i', 'batch-a')).toBe(
            'pedido:p:reserve:item:i:batch:batch-a',
        );

        const pedidoId = 'p'.repeat(36);
        const itemId = 'i'.repeat(36);
        const productId = 'c'.repeat(25);
        const batchId = 'a'.repeat(64);
        const prefix = `pedido:${pedidoId}:reserve:item:${itemId}:product:${productId}`;
        const compacted = buildBoundedBatchWarehouseSourceKey(prefix, batchId);

        expect(`${prefix}:batch:${batchId}`.length).toBeGreaterThan(191);
        expect(compacted).toMatch(/^batch-event:[a-f0-9]{64}$/u);
        expect(compacted.length).toBeLessThanOrEqual(191);
        expect(buildBoundedBatchWarehouseSourceKey(prefix, batchId)).toBe(compacted);
        expect(buildBoundedBatchWarehouseSourceKey(`${prefix}-otro`, batchId)).not.toBe(compacted);
    });

    beforeEach(() => {
        applyBatchWarehouseDelta.mockReset().mockResolvedValue({
            mode: 'SHADOW', status: 'APPLIED', applied: true,
        });
    });

    it('OFF conserva FEFO global, no llama el core y persiste la bodega operativa', async () => {
        const fake = fakeTx({
            batches: [{
                id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1',
            }],
        });
        const result = await allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '0.2500',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'OFF',
        });

        expect(result.allocations[0]?.quantity.toFixed(4)).toBe('0.2500');
        expect(fake.batches.get('batch-a')?.globalStock.toFixed(4)).toBe('0.7500');
        expect(applyBatchWarehouseDelta).not.toHaveBeenCalled();
        expect(fake.persisted).toEqual([expect.objectContaining({
            tenantId: 'tenant-a',
            saleItemId: 'sale-item-a',
            batchId: 'batch-a',
            warehouseId: 'warehouse-a',
            quantity: '0.2500',
        })]);
    });

    it('SHADOW consume FEFO global y registra un SALE exacto por allocation', async () => {
        const fake = fakeTx({
            batches: [
                { id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1' },
                { id: 'batch-b', batchNumber: 'L-02', expiryDate: '2027-02-01', globalStock: '2' },
            ],
        });
        const result = await allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '1.5000',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'SHADOW',
        });

        expect(result.allocations.map(allocation => allocation.quantity.toFixed(4)))
            .toEqual(['1.0000', '0.5000']);
        expect(applyBatchWarehouseDelta).toHaveBeenCalledTimes(2);
        expect(applyBatchWarehouseDelta).toHaveBeenNthCalledWith(1, expect.objectContaining({
            mode: 'SHADOW',
            tenantId: 'tenant-a',
            productId: 'product-a',
            batchId: 'batch-a',
            warehouseId: 'warehouse-a',
            delta: '-1.0000',
            movementType: 'SALE',
            referenceId: 'sale-item-a',
            referenceType: 'SALE_ITEM',
            sourceKey: 'sale:sale-item-a:batch:batch-a',
            allowNegative: false,
        }));
    });

    it('SHADOW_GAP conserva la venta legacy y su allocation para conciliación', async () => {
        applyBatchWarehouseDelta.mockResolvedValue({
            mode: 'SHADOW', status: 'SHADOW_GAP', applied: false, gap: '1.0000',
        });
        const fake = fakeTx({
            batches: [{
                id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1',
            }],
        });

        await expect(allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '1',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'SHADOW',
        })).resolves.toMatchObject({ unallocatedQuantity: expect.any(Decimal) });
        expect(fake.batches.get('batch-a')?.globalStock.toString()).toBe('0');
        expect(fake.persisted).toHaveLength(1);
    });

    it('el helper reusable revierte un SHADOW_GAP para no crear stock en otro destino', async () => {
        applyBatchWarehouseDelta.mockResolvedValue({
            mode: 'SHADOW', status: 'SHADOW_GAP', applied: false, gap: '1.0000',
        });
        const fake = fakeTx({
            batches: [{ id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1' }],
            warehouseStocks: [{ batchId: 'batch-a', warehouseId: 'warehouse-a', stock: '1' }],
        });

        await expect(consumeProductBatchesByWarehouseFefo(fake.tx, {
            tenantId: 'tenant-a',
            productId: 'product-a',
            quantity: '1',
            context: {
                mode: 'SHADOW',
                warehouseId: 'warehouse-a',
                userId: 'user-a',
                movementType: 'TRANSFER_OUT',
                referenceId: 'transfer-a',
                referenceType: 'STOCK_TRANSFER',
                sourceKeyPrefix: 'stock-transfer:transfer-a:out',
            },
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_ACTIVE_BATCH_STOCK', httpStatus: 409 });
        expect(fake.tx.productBatch.updateMany).not.toHaveBeenCalled();
    });

    it('ENFORCED elige FEFO solo dentro de la bodega y conserva tenant en cada frontera', async () => {
        const fake = fakeTx({
            batches: [
                { id: 'batch-foreign-warehouse', batchNumber: 'L-00', expiryDate: '2027-01-01', globalStock: '9' },
                { id: 'batch-local-early', batchNumber: 'L-01', expiryDate: '2027-02-01', globalStock: '0.5000' },
                { id: 'batch-local-later', batchNumber: 'L-02', expiryDate: '2027-03-01', globalStock: '2' },
            ],
            warehouseStocks: [
                { batchId: 'batch-foreign-warehouse', warehouseId: 'warehouse-b', stock: '9' },
                { batchId: 'batch-local-early', warehouseId: 'warehouse-a', stock: '0.5000' },
                { batchId: 'batch-local-later', warehouseId: 'warehouse-a', stock: '2' },
            ],
        });
        const result = await allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '1.2500',
            enforceComplete: false,
            batchWarehouseLedgerMode: 'ENFORCED',
        });

        expect(result.allocations.map(allocation => [allocation.batchId, allocation.quantity.toFixed(4)]))
            .toEqual([
                ['batch-local-early', '0.5000'],
                ['batch-local-later', '0.7500'],
            ]);
        expect(result.unallocatedQuantity.toString()).toBe('0');
        expect(fake.batches.get('batch-foreign-warehouse')?.globalStock.toString()).toBe('9');
        expect(fake.tx.productBatch.findMany).not.toHaveBeenCalled();
        expect(fake.tx.productBatchWarehouseStock.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                productId: 'product-a',
                warehouseId: 'warehouse-a',
                batch: expect.objectContaining({
                    tenantId: 'tenant-a',
                    productId: 'product-a',
                    expiryDate: { gte: new Date('2026-08-26T00:00:00.000Z') },
                }),
            }),
            orderBy: [
                { batch: { expiryDate: 'asc' } },
                { batch: { id: 'asc' } },
            ],
        }));
        for (const call of fake.tx.productBatch.updateMany.mock.calls) {
            expect(call[0].where).toMatchObject({ tenantId: 'tenant-a', productId: 'product-a' });
        }
        expect(applyBatchWarehouseDelta.mock.calls.every(([call]) => (
            call.tenantId === 'tenant-a' && call.warehouseId === 'warehouse-a'
        ))).toBe(true);
    });

    it('ENFORCED resta heldStock y nunca asigna unidades en cuarentena', async () => {
        const fake = fakeTx({
            batches: [
                { id: 'batch-held', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '2' },
                { id: 'batch-sellable', batchNumber: 'L-02', expiryDate: '2027-02-01', globalStock: '1' },
            ],
            warehouseStocks: [
                {
                    batchId: 'batch-held', warehouseId: 'warehouse-a', stock: '2', heldStock: '2',
                },
                {
                    batchId: 'batch-sellable', warehouseId: 'warehouse-a', stock: '1', heldStock: '0',
                },
            ],
        });

        const result = await allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '1',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'ENFORCED',
        });

        expect(result.allocations.map(allocation => allocation.batchId)).toEqual(['batch-sellable']);
        expect(applyBatchWarehouseDelta).toHaveBeenCalledOnce();
        expect(applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({
            batchId: 'batch-sellable',
            delta: '-1.0000',
        }));
        expect(fake.batches.get('batch-held')?.globalStock.toString()).toBe('2');
    });

    it('ENFORCED preserva 0.0001 sin redondearla ni inventar lote negativo', async () => {
        const fake = fakeTx({
            batches: [{
                id: 'batch-micro', batchNumber: 'L-MICRO', expiryDate: '2027-01-01', globalStock: '0.0001',
            }],
            warehouseStocks: [{ batchId: 'batch-micro', warehouseId: 'warehouse-a', stock: '0.0001' }],
        });
        const result = await allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '0.0001',
            enforceComplete: false,
            batchWarehouseLedgerMode: 'ENFORCED',
        });

        expect(result.allocations[0]?.quantity.toFixed(4)).toBe('0.0001');
        expect(applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({ delta: '-0.0001' }));
        expect(fake.batches.get('batch-micro')?.globalStock.toFixed(4)).toBe('0.0000');
        expect(fake.persisted[0]?.quantity).toBe('0.0001');
    });

    it('ENFORCED falla cerrado sin contexto o si la bodega no cubre toda la línea', async () => {
        const fake = fakeTx({
            batches: [{ id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '5' }],
            warehouseStocks: [{ batchId: 'batch-a', warehouseId: 'warehouse-a', stock: '0.5' }],
        });
        await expect(allocateSaleItemBatchesFefo(fake.tx, {
            tenantId: 'tenant-a',
            productId: 'product-a',
            saleItemId: 'sale-item-a',
            quantity: '1',
            enforceComplete: false,
            batchWarehouseLedgerMode: 'ENFORCED',
        })).rejects.toMatchObject({ code: 'BATCH_WAREHOUSE_CONTEXT_REQUIRED', httpStatus: 409 });
        await expect(allocateSaleItemBatchesFefo(fake.tx, {
            ...saleContext,
            quantity: '1',
            enforceComplete: false,
            batchWarehouseLedgerMode: 'ENFORCED',
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_ACTIVE_BATCH_STOCK', httpStatus: 409 });
        expect(applyBatchWarehouseDelta).not.toHaveBeenCalled();
        expect(fake.tx.productBatch.updateMany).not.toHaveBeenCalled();
        expect(fake.persisted).toEqual([]);
    });

    it('ENFORCED propaga carreras local/global como 409 antes de persistir evidencia', async () => {
        const localRace = fakeTx({
            batches: [{ id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1' }],
            warehouseStocks: [{ batchId: 'batch-a', warehouseId: 'warehouse-a', stock: '1' }],
        });
        applyBatchWarehouseDelta.mockRejectedValueOnce(new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_INSUFFICIENT_STOCK', 409, 'saldo local cambió',
        ));
        await expect(allocateSaleItemBatchesFefo(localRace.tx, {
            ...saleContext,
            quantity: '1',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'ENFORCED',
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_ACTIVE_BATCH_STOCK', httpStatus: 409 });
        expect(localRace.tx.productBatch.updateMany).not.toHaveBeenCalled();
        expect(localRace.persisted).toEqual([]);

        const globalRace = fakeTx({
            batches: [{ id: 'batch-a', batchNumber: 'L-01', expiryDate: '2027-01-01', globalStock: '1' }],
            warehouseStocks: [{ batchId: 'batch-a', warehouseId: 'warehouse-a', stock: '1' }],
            failGlobalBatchIds: ['batch-a'],
        });
        applyBatchWarehouseDelta.mockResolvedValueOnce({ mode: 'ENFORCED', status: 'APPLIED', applied: true });
        await expect(allocateSaleItemBatchesFefo(globalRace.tx, {
            ...saleContext,
            quantity: '1',
            enforceComplete: true,
            batchWarehouseLedgerMode: 'ENFORCED',
        })).rejects.toBeInstanceOf(BatchAllocationError);
        expect(globalRace.persisted).toEqual([]);
    });
});
