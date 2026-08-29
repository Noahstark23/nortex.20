import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saleFindFirst = vi.hoisted(() => vi.fn());
const shiftFindFirst = vi.hoisted(() => vi.fn());
const invoiceSeriesCreateMany = vi.hoisted(() => vi.fn());
const accountFindMany = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const ensureDefaultWarehouse = vi.hoisted(() => vi.fn());
const applyStockDelta = vi.hoisted(() => vi.fn());
const normalizeSaleItems = vi.hoisted(() => vi.fn());
const recordSale = vi.hoisted(() => vi.fn());
const allocateSaleItemBatchesFefo = vi.hoisted(() => vi.fn());
const resolveBatchWarehouseLedgerMode = vi.hoisted(() => vi.fn());

vi.mock('../backend/lib/prisma.js', () => {
    const mockedPrisma = {
        sale: { findFirst: saleFindFirst },
        shift: { findFirst: shiftFindFirst },
        invoiceSeries: { createMany: invoiceSeriesCreateMany },
        account: { findMany: accountFindMany },
        $transaction: transaction,
    };
    return { default: mockedPrisma, prisma: mockedPrisma };
});

vi.mock('../backend/services/accounting.js', () => ({
    PeriodLockedError: class PeriodLockedError extends Error {},
    recordSale,
    seedChartOfAccounts: vi.fn(),
}));

vi.mock('../backend/services/stockService.js', () => ({
    StockError: class StockError extends Error {},
    applyStockDelta,
    asegurarBodegaPorDefecto: ensureDefaultWarehouse,
}));

vi.mock('../backend/services/saleItemMeasurementService.js', () => ({
    SaleItemNormalizationError: class SaleItemNormalizationError extends Error {},
    normalizeSaleItems,
}));

vi.mock('../backend/services/saleBatchAllocationService.js', () => ({
    BatchAllocationError: class BatchAllocationError extends Error {},
    allocateSaleItemBatchesFefo,
}));

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    resolveBatchWarehouseLedgerMode,
}));

import { executeSaleWithResult } from '../backend/services/salesService';

const rawSale = (employeeId: string | null = null) => ({
    offlineId: 'offline-new-sale',
    paymentMethod: 'CASH',
    customerName: 'Cliente General',
    employeeId,
    globalDiscount: '0',
    fiscalRegimeVersion: 1,
    source: 'OFFLINE_SYNC',
    items: [{ id: 'product-1', quantity: '1', price: '10' }],
});

const normalizedItem = () => ({
    productId: 'product-1',
    quantity: new Decimal(1),
    unitPrice: new Decimal(10),
    cost: new Decimal(5),
    discountPct: new Decimal(0),
    ivaExento: false,
    productNameAtSale: 'Producto uno',
    unitAtSale: 'unidad',
    saleModeAtSale: 'COUNTED',
    quantityStepAtSale: '1',
    presentationAtSale: 'BASE',
    presentationQuantityAtSale: new Decimal(1),
    requiresBatchTracking: false,
    measurement: null,
    acceptedLabelPriceOverride: null,
    quotationId: null,
    quotationItemId: null,
});

const makeTransaction = (lockedEmployeeId: string | null) => {
    const saleCreate = vi.fn(async ({ data }) => ({ id: 'sale-created', ...data }));
    const queryRaw = vi.fn().mockResolvedValue([{
        id: 'shift-a',
        employeeId: lockedEmployeeId,
    }]);
    const tx = {
        $queryRaw: queryRaw,
        tenant: {
            findUnique: vi.fn().mockResolvedValue({
                allowNegativeStock: false,
                fiscalRegime: 'GENERAL',
                fiscalRegimeVersion: 1,
            }),
        },
        customer: { findFirst: vi.fn() },
        employee: {
            findFirst: vi.fn().mockResolvedValue(
                lockedEmployeeId ? { id: lockedEmployeeId } : null,
            ),
        },
        quotation: { findFirst: vi.fn(), updateMany: vi.fn() },
        invoiceSeries: {
            upsert: vi.fn().mockResolvedValue({ lastNumber: 1, rangeEnd: 10_000 }),
        },
        sale: { create: saleCreate },
        warehouse: { findFirst: vi.fn().mockResolvedValue(null) },
        saleItem: { create: vi.fn().mockResolvedValue({ id: 'sale-item-1' }) },
        saleMeasurement: { create: vi.fn() },
        kardexMovement: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return { tx, queryRaw, saleCreate };
};

describe('identidad autoritativa al persistir replay offline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        saleFindFirst.mockResolvedValue(null);
        shiftFindFirst.mockResolvedValue({
            id: 'shift-a',
            employeeId: 'employee-authoritative',
        });
        invoiceSeriesCreateMany.mockResolvedValue({ count: 0 });
        accountFindMany.mockResolvedValue([
            { code: '1.1.1' },
            { code: '1.1.3' },
            { code: '1.1.4' },
            { code: '2.1.2' },
            { code: '4.1.1' },
            { code: '5.1.1' },
        ]);
        ensureDefaultWarehouse.mockResolvedValue({ id: 'warehouse-default' });
        normalizeSaleItems.mockResolvedValue([normalizedItem()]);
        applyStockDelta.mockResolvedValue({
            stockBefore: 2,
            stockAfter: 1,
            warehouseId: 'warehouse-default',
        });
        resolveBatchWarehouseLedgerMode.mockResolvedValue('OFF');
        allocateSaleItemBatchesFefo.mockResolvedValue({
            allocations: [],
            unallocatedQuantity: new Decimal(1),
        });
        recordSale.mockResolvedValue(undefined);
    });

    it('persiste employeeId del Shift aunque la fila legacy lo omita', async () => {
        const { tx, queryRaw, saleCreate } = makeTransaction('employee-authoritative');
        transaction.mockImplementation((callback) => callback(tx));

        const result = await executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale(null),
            { offlineSync: true, createdAt: '2026-08-22T12:00:00.000Z' },
        );

        expect(result.idempotentReplay).toBe(false);
        expect(saleCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: 'tenant-a',
                shiftId: 'shift-a',
                soldById: 'user-a',
                employeeId: 'employee-authoritative',
            }),
        }));
        const lockQuery = queryRaw.mock.calls[0]?.[0];
        expect(lockQuery.values).toEqual(['shift-a', 'tenant-a', 'user-a']);
        expect(lockQuery.sql).toContain('FOR UPDATE');
    });

    it('persiste null cuando el turno legítimamente no tiene Employee', async () => {
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: null });
        const { tx, saleCreate } = makeTransaction(null);
        transaction.mockImplementation((callback) => callback(tx));

        await executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale(null),
            { offlineSync: true },
        );

        expect(saleCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ employeeId: null }),
        }));
        expect(tx.employee.findFirst).not.toHaveBeenCalled();
    });

    it('resuelve el modo una vez y pasa la bodega autoritativa al FEFO de cada línea', async () => {
        normalizeSaleItems.mockResolvedValue([{ ...normalizedItem(), requiresBatchTracking: true }]);
        resolveBatchWarehouseLedgerMode.mockResolvedValue('SHADOW');
        allocateSaleItemBatchesFefo.mockResolvedValue({
            allocations: [{ batchId: 'batch-a', batchNumber: 'L-01', quantity: new Decimal(1) }],
            unallocatedQuantity: new Decimal(0),
        });
        const { tx } = makeTransaction('employee-authoritative');
        transaction.mockImplementation((callback) => callback(tx));

        await executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale(null),
            { offlineSync: true },
        );

        expect(resolveBatchWarehouseLedgerMode).toHaveBeenCalledTimes(1);
        expect(resolveBatchWarehouseLedgerMode).toHaveBeenCalledWith(tx, 'tenant-a');
        expect(allocateSaleItemBatchesFefo).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-a',
            productId: 'product-1',
            saleItemId: 'sale-item-1',
            batchWarehouseLedgerMode: 'SHADOW',
            warehouseId: 'warehouse-default',
            userId: 'user-a',
            saleId: 'sale-created',
        }));
    });

    it('aborta si el turno cambia de cajero entre el guard y el lock', async () => {
        const { tx, saleCreate } = makeTransaction('employee-after-handover');
        transaction.mockImplementation((callback) => callback(tx));

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale(null),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
        expect(saleCreate).not.toHaveBeenCalled();
        expect(recordSale).not.toHaveBeenCalled();
    });
});
