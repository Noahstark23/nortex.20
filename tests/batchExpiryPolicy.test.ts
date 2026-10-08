import Decimal from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applyBatchWarehouseDelta = vi.hoisted(() => vi.fn());
vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError: class extends Error {},
}));

import { allocateSaleItemBatchesFefo } from '../backend/services/saleBatchAllocationService';
import { operationalExpiryWindow } from '../backend/services/operationalAlertsService';
import { batchExpiryPresentation, batchExpiryWindow } from '../utils/batchExpiry';

interface Batch {
    id: string;
    tenantId: string;
    productId: string;
    warehouseId: string;
    expiryDate: Date;
    stock: number;
    heldStock?: number;
}

const context = {
    tenantId: 'tenant-a', productId: 'product-a', saleItemId: 'sale-item-a',
    warehouseId: 'warehouse-a', userId: 'user-a', saleId: 'sale-a',
};

// El fake aplica el predicado SQL recibido, sin calcular el día civil por su
// cuenta. Así una fecha de corte incorrecta elimina el lote y falla el recorrido.
function database(day: string, yesterday: string, tomorrow: string) {
    const rows: Batch[] = [
        { ...context, id: 'yesterday-midnight', expiryDate: new Date(`${yesterday}T00:00:00Z`), stock: 1 },
        { ...context, id: 'yesterday-noon', expiryDate: new Date(`${yesterday}T12:00:00Z`), stock: 1 },
        { ...context, id: 'today-midnight', expiryDate: new Date(`${day}T00:00:00Z`), stock: 1 },
        { ...context, id: 'today-noon', expiryDate: new Date(`${day}T12:00:00Z`), stock: 1 },
        { ...context, id: 'tomorrow-midnight', expiryDate: new Date(`${tomorrow}T00:00:00Z`), stock: 1 },
        { ...context, id: 'tomorrow-noon', expiryDate: new Date(`${tomorrow}T12:00:00Z`), stock: 1 },
        { ...context, id: 'other-tenant', tenantId: 'tenant-b', expiryDate: new Date(`${day}T00:00:00Z`), stock: 9 },
        { ...context, id: 'other-product', productId: 'product-b', expiryDate: new Date(`${day}T00:00:00Z`), stock: 9 },
    ];
    const candidates = (where: any) => rows.filter(row => row.tenantId === where.tenantId
        && row.productId === where.productId && row.stock > where.stock.gt
        && row.expiryDate >= where.expiryDate.gte)
        .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || a.id.localeCompare(b.id));
    const tx = {
        productBatch: {
            findMany: vi.fn(async ({ where }: any) => candidates(where).map(row => ({
                id: row.id, batchNumber: row.id, stock: row.stock,
            }))),
            findFirst: vi.fn(async ({ where }: any) => {
                const row = candidates(where).find(candidate => candidate.id === where.id);
                return row ? { stock: row.stock } : null;
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const row = rows.find(row => row.id === where.id && row.tenantId === where.tenantId
                    && row.productId === where.productId && row.stock >= where.stock.gte);
                if (!row) return { count: 0 };
                row.stock -= Number(data.stock.decrement);
                return { count: 1 };
            }),
        },
        productBatchWarehouseStock: {
            findMany: vi.fn(async ({ where }: any) => candidates({ ...where.batch, stock: where.stock })
                .filter(row => row.tenantId === where.tenantId && row.productId === where.productId
                    && row.warehouseId === where.warehouseId)
                .map(row => ({ batchId: row.id, stock: row.stock, heldStock: row.heldStock ?? 0, batch: { id: row.id, batchNumber: row.id } }))),
        },
        saleItemBatchAllocation: { createMany: vi.fn(async ({ data }: any) => ({ count: data.length })) },
    };
    return { rows, tx: tx as unknown as Parameters<typeof allocateSaleItemBatchesFefo>[0], calls: tx };
}

beforeEach(() => {
    applyBatchWarehouseDelta.mockReset().mockResolvedValue({ status: 'APPLIED', applied: true });
});
afterEach(() => vi.useRealTimers());

describe.each(['OFF', 'SHADOW', 'ENFORCED'] as const)('vigencia civil FEFO en modo %s', mode => {
    it.each([
        ['2026-09-04T05:59:59.999Z', '2026-09-03', '2026-09-02', '2026-09-04'],
        ['2026-09-04T06:00:00.000Z', '2026-09-04', '2026-09-03', '2026-09-05'],
        ['2026-09-04T18:00:00.000Z', '2026-09-04', '2026-09-03', '2026-09-05'],
        ['2026-09-05T05:59:59.999Z', '2026-09-04', '2026-09-03', '2026-09-05'],
        ['2026-09-05T06:00:00.000Z', '2026-09-05', '2026-09-04', '2026-09-06'],
    ])('%s mantiene hoy %s desde medianoche y mediodía, excluye ayer y respeta FEFO', async (instant, day, yesterday, tomorrow) => {
        const { tx, rows, calls } = database(day, yesterday, tomorrow);
        const capturedAt = new Date(instant);
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '3', enforceComplete: true, capturedAt,
            batchWarehouseLedgerMode: mode,
        });

        expect(result.allocations.map(row => row.batchId)).toEqual(['today-midnight', 'today-noon', 'tomorrow-midnight']);
        expect(result.allocations.map(row => row.quantity.toFixed(4))).toEqual(['1.0000', '1.0000', '1.0000']);
        expect(result.unallocatedQuantity.toString()).toBe('0');
        expect(rows.filter(row => row.id.startsWith('yesterday')).map(row => row.stock)).toEqual([1, 1]);
        expect(rows.filter(row => row.id.startsWith('other-')).map(row => row.stock)).toEqual([9, 9]);
        expect(rows.find(row => row.id === 'tomorrow-noon')?.stock).toBe(1);
        expect(rows.find(row => row.id === 'today-midnight')?.expiryDate.toISOString()).toBe(`${day}T00:00:00.000Z`);
        expect(rows.find(row => row.id === 'today-noon')?.expiryDate.toISOString()).toBe(`${day}T12:00:00.000Z`);
        expect(calls.saleItemBatchAllocation.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
            expect.objectContaining({ tenantId: context.tenantId, saleItemId: context.saleItemId,
                warehouseId: context.warehouseId, batchId: 'today-midnight', quantity: '1.0000' }),
        ]) });
        const expiryQuery = mode === 'ENFORCED'
            ? calls.productBatchWarehouseStock.findMany.mock.calls[0][0].where.batch.expiryDate
            : calls.productBatch.findMany.mock.calls[0][0].where.expiryDate;
        expect(expiryQuery.gte).toEqual(operationalExpiryWindow(capturedAt).today);
        expect(capturedAt.toISOString()).toBe(instant);
    });

    it('el replay usa el día de captura, aunque el lote ya venció cuando vuelve internet', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-10T18:00:00Z'));
        const { tx } = database('2026-09-04', '2026-09-03', '2026-09-05');
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '2', enforceComplete: false,
            capturedAt: new Date('2026-09-05T05:59:59.999Z'), batchWarehouseLedgerMode: mode,
        });
        expect(result.allocations.map(row => row.batchId)).toEqual(['today-midnight', 'today-noon']);
        expect(result.unallocatedQuantity.toString()).toBe('0');
    });

    it('una venta capturada después de medianoche Managua no usa los lotes del día anterior', async () => {
        const { tx, rows } = database('2026-09-04', '2026-09-03', '2026-09-05');
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '2', enforceComplete: false,
            capturedAt: new Date('2026-09-05T06:00:00.000Z'), batchWarehouseLedgerMode: mode,
        });
        expect(result.allocations.map(row => row.batchId)).toEqual(['tomorrow-midnight', 'tomorrow-noon']);
        expect(rows.filter(row => row.id.startsWith('today')).map(row => row.stock)).toEqual([1, 1]);
    });

    it('sin captura explícita usa el día actual de Managua', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-05T05:59:59.999Z'));
        const { tx } = database('2026-09-04', '2026-09-03', '2026-09-05');
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '2', enforceComplete: true, batchWarehouseLedgerMode: mode,
        });
        expect(result.allocations.map(row => row.batchId)).toEqual(['today-midnight', 'today-noon']);
    });

    it('una captura inválida falla antes de leer o modificar existencias', async () => {
        const { tx, calls } = database('2026-09-04', '2026-09-03', '2026-09-05');
        await expect(allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '1', enforceComplete: true, capturedAt: new Date('invalid'),
            batchWarehouseLedgerMode: mode,
        })).rejects.toBeInstanceOf(RangeError);
        expect(calls.productBatch.findMany).not.toHaveBeenCalled();
        expect(calls.productBatchWarehouseStock.findMany).not.toHaveBeenCalled();
        expect(calls.productBatch.updateMany).not.toHaveBeenCalled();
        expect(calls.saleItemBatchAllocation.createMany).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });
});

describe('vigencia y controles conservados', () => {
    it('ENFORCED descuenta la retención aun cuando el lote sigue vigente y físicamente disponible', async () => {
        const { tx, rows } = database('2026-09-04', '2026-09-03', '2026-09-05');
        rows.find(row => row.id === 'today-midnight')!.heldStock = 1;
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '1', enforceComplete: true,
            capturedAt: new Date('2026-09-04T18:00:00Z'), batchWarehouseLedgerMode: 'ENFORCED',
        });
        expect(result.allocations.map(row => row.batchId)).toEqual(['today-noon']);
        expect(rows.find(row => row.id === 'today-midnight')?.stock).toBe(1);
    });

    it.each([
        ['2026-12-03T00:00:00Z', 'expiring'],
        ['2026-12-03T12:00:00Z', 'expiring'],
        ['2026-12-04T00:00:00Z', 'current'],
    ] as const)('la ventana de 90 días clasifica %s como %s sin cortar el último día', (expiry, status) => {
        const asOf = new Date('2026-09-04T06:00:00Z');
        expect(batchExpiryWindow(asOf, 90)).toEqual({
            today: new Date('2026-09-04T00:00:00Z'), afterLastDay: new Date('2026-12-04T00:00:00Z'),
        });
        expect(batchExpiryPresentation(expiry, asOf, 90).status).toBe(status);
    });

    it('rechaza una ventana negativa y conserva el día bisiesto en una ventana corta', () => {
        expect(() => batchExpiryWindow(new Date('2026-09-04T18:00:00Z'), -1)).toThrow(RangeError);
        expect(batchExpiryWindow(new Date('2028-02-28T18:00:00Z'), 1)).toEqual({
            today: new Date('2028-02-28T00:00:00Z'), afterLastDay: new Date('2028-03-01T00:00:00Z'),
        });
    });

    it('la relectura de un lote disputado conserva el mismo corte civil', async () => {
        const { tx, calls } = database('2026-09-04', '2026-09-03', '2026-09-05');
        calls.productBatch.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '1', enforceComplete: true,
            capturedAt: new Date('2026-09-04T18:00:00Z'),
        });
        expect(result.allocations[0].batchId).toBe('today-midnight');
        expect(calls.productBatch.findFirst).toHaveBeenCalledWith({
            where: { id: 'today-midnight', tenantId: context.tenantId, productId: context.productId,
                expiryDate: { gte: new Date('2026-09-04T00:00:00Z') }, stock: { gt: 0 } },
            select: { stock: true },
        });
    });

    it('ENFORCED no toma existencias de otra bodega para completar la venta', async () => {
        const { tx, calls } = database('2026-09-04', '2026-09-03', '2026-09-05');
        await expect(allocateSaleItemBatchesFefo(tx, {
            ...context, warehouseId: 'warehouse-b', quantity: '1', enforceComplete: false,
            capturedAt: new Date('2026-09-04T18:00:00Z'), batchWarehouseLedgerMode: 'ENFORCED',
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_ACTIVE_BATCH_STOCK' });
        expect(applyBatchWarehouseDelta).not.toHaveBeenCalled();
        expect(calls.productBatch.updateMany).not.toHaveBeenCalled();
        expect(calls.saleItemBatchAllocation.createMany).not.toHaveBeenCalled();
    });

    it('offline global mantiene el faltante explícito sin revivir lotes vencidos', async () => {
        const { tx, rows } = database('2026-09-04', '2026-09-03', '2026-09-05');
        const result = await allocateSaleItemBatchesFefo(tx, {
            ...context, quantity: '3', enforceComplete: false,
            capturedAt: new Date('2026-09-05T06:00:00Z'),
        });
        expect(result.unallocatedQuantity).toEqual(new Decimal(1));
        expect(result.allocations.map(row => row.batchId)).toEqual(['tomorrow-midnight', 'tomorrow-noon']);
        expect(rows.filter(row => row.id.startsWith('today')).map(row => row.stock)).toEqual([1, 1]);
    });
});
