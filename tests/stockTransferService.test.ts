import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    materializeWarehouseRow: vi.fn(),
    consumeProductBatchesByWarehouseFefo: vi.fn(),
    consumeProductBatchesFefo: vi.fn(),
    applyBatchWarehouseDelta: vi.fn(),
    resolveBatchWarehouseLedgerMode: vi.fn(),
}));

vi.mock('../backend/services/stockService.js', () => ({
    materializeWarehouseRow: mocks.materializeWarehouseRow,
}));
vi.mock('../backend/services/saleBatchAllocationService.js', () => ({
    consumeProductBatchesByWarehouseFefo: mocks.consumeProductBatchesByWarehouseFefo,
    consumeProductBatchesFefo: mocks.consumeProductBatchesFefo,
}));
vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    applyBatchWarehouseDelta: mocks.applyBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode: mocks.resolveBatchWarehouseLedgerMode,
}));

import {
    executeStockTransfer,
    executeStockTransferTransaction,
    type StockTransferRecord,
} from '../backend/services/stockTransferService';
import {
    buildStockTransferPayloadHash,
    normalizeStockTransferCommand,
} from '../backend/lib/stockTransferCommand';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date('2026-08-27T12:00:00.000Z');
const request = {
    clientEventId: eventId,
    fromWarehouseId: 'warehouse-z',
    toWarehouseId: 'warehouse-a',
    notes: 'Traslado semanal',
    items: [{ productId: 'product-a', quantity: '1.2500' }],
};

interface FakeOptions {
    existing?: StockTransferRecord | null;
    actorActive?: boolean;
    tracked?: boolean;
    sourceStock?: string;
    destinationStock?: string;
}

const existingTransfer = (overrides: Partial<StockTransferRecord> = {}): StockTransferRecord => {
    const canonical = normalizeStockTransferCommand(request);
    return {
        id: 'transfer-existing',
        tenantId: 'tenant-a',
        fromWarehouseId: request.fromWarehouseId,
        toWarehouseId: request.toWarehouseId,
        clientEventId: eventId,
        payloadHash: buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: canonical }),
        payloadVersion: 1,
        batchLedgerMode: 'OFF',
        batchTransferStatus: 'OFF',
        batchSnapshot: null,
        notes: request.notes,
        items: [{ productId: 'product-a', name: 'Carne', quantity: '1.2500' }],
        createdBy: 'user-a',
        createdAt: now,
        ...overrides,
    };
};

const fakeTx = (options: FakeOptions = {}) => {
    const events: string[] = [];
    const queries: string[] = [];
    const stocks = new Map([
        ['product-a:warehouse-z', new Decimal(options.sourceStock ?? '5')],
        ['product-a:warehouse-a', new Decimal(options.destinationStock ?? '2')],
    ]);
    const state: { transfer: StockTransferRecord | null } = {
        transfer: options.existing === undefined ? null : options.existing,
    };

    const tx = {
        user: {
            findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                events.push(`actor:${String(where.tenantId)}:${String(where.status)}`);
                return options.actorActive === false ? null : { id: 'user-a' };
            }),
        },
        stockTransfer: {
            findFirst: vi.fn(async ({ where }: { where: { id?: string; clientEventId?: string } }) => {
                events.push(where.clientEventId ? 'replay-read' : 'final-read');
                return state.transfer;
            }),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                events.push('header-create');
                state.transfer = existingTransfer({
                    id: 'transfer-new',
                    clientEventId: String(data.clientEventId),
                    payloadHash: String(data.payloadHash),
                    batchLedgerMode: String(data.batchLedgerMode),
                    batchTransferStatus: String(data.batchTransferStatus),
                    notes: data.notes as string | null,
                    items: data.items as Prisma.JsonValue,
                    createdAt: data.createdAt as Date,
                });
                return { id: 'transfer-new' };
            }),
            updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                events.push('header-finalize');
                if (!state.transfer) return { count: 0 };
                state.transfer = {
                    ...state.transfer,
                    items: data.items as Prisma.JsonValue,
                    batchTransferStatus: String(data.batchTransferStatus),
                    batchSnapshot: (data.batchSnapshot ?? null) as Prisma.JsonValue | null,
                };
                return { count: 1 };
            }),
        },
        warehouse: {
            findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                events.push(`warehouses:${String(where.tenantId)}`);
                return [
                    { id: 'warehouse-z', name: 'Origen', isDefault: true },
                    { id: 'warehouse-a', name: 'Destino', isDefault: false },
                ];
            }),
        },
        product: {
            findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                events.push(`product-preview:${String(where.tenantId)}`);
                return [{ id: 'product-a', name: 'Carne' }];
            }),
        },
        productStock: {
            updateMany: vi.fn(async ({ where, data }: {
                where: { productId: string; warehouseId: string; tenantId: string; stock?: { gte: number } };
                data: { stock: { decrement?: number; increment?: number } };
            }) => {
                events.push(`stock:${where.productId}:${where.warehouseId}:${where.tenantId}`);
                const key = `${where.productId}:${where.warehouseId}`;
                const current = stocks.get(key);
                if (!current) return { count: 0 };
                const decrement = new Decimal(data.stock.decrement ?? 0);
                if (where.stock && current.lessThan(where.stock.gte)) return { count: 0 };
                stocks.set(key, current.minus(decrement).plus(data.stock.increment ?? 0));
                return { count: 1 };
            }),
            findMany: vi.fn(async ({ where }: {
                where: { productId: { in: string[] }; warehouseId: { in: string[] }; tenantId: string };
            }) => where.productId.in.flatMap(productId => where.warehouseId.in.map(warehouseId => ({
                productId,
                warehouseId,
                stock: stocks.get(`${productId}:${warehouseId}`)?.toString() ?? '0',
            })))),
        },
        kardexMovement: {
            createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                events.push('kardex');
                return { count: data.length };
            }),
        },
        auditLog: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                events.push(`audit:${String(data.tenantId)}`);
                return { id: 'audit-a' };
            }),
        },
        productBatch: {
            updateMany: vi.fn(async ({ where, data }: {
                where: Record<string, unknown>;
                data: { stock: { increment: number } };
            }) => {
                events.push(`batch-compensate:${String(where.tenantId)}:${data.stock.increment}`);
                return { count: 1 };
            }),
        },
        $queryRaw: vi.fn(async (query: { strings: readonly string[] }) => {
            const sql = query.strings.join('?');
            queries.push(sql);
            if (sql.includes('FROM `Warehouse`')) {
                events.push('lock-warehouses');
                return [
                    { id: 'warehouse-a', name: 'Destino', isDefault: 0 },
                    { id: 'warehouse-z', name: 'Origen', isDefault: 1 },
                ];
            }
            if (sql.includes('FROM `ProductStock`')) {
                events.push('lock-product-stocks');
                return [...stocks.entries()].map(([key, stock], index) => {
                    const separator = key.lastIndexOf(':');
                    return {
                        id: `stock-${index}`,
                        productId: key.slice(0, separator),
                        warehouseId: key.slice(separator + 1),
                        stock: stock.toString(),
                    };
                });
            }
            events.push('lock-products');
            return [{
                id: 'product-a',
                name: 'Carne',
                saleMode: 'MEASURED',
                quantityStep: '0.0001',
                requiresBatchTracking: options.tracked ?? false,
            }];
        }),
    };
    return {
        tx: tx as unknown as Prisma.TransactionClient,
        raw: tx,
        events,
        queries,
        stocks,
        state,
    };
};

describe('StockTransferService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveBatchWarehouseLedgerMode.mockResolvedValue('OFF');
        mocks.materializeWarehouseRow.mockImplementation(async () => undefined);
        mocks.consumeProductBatchesByWarehouseFefo.mockResolvedValue({
            allocations: [], unallocatedQuantity: new Decimal(0),
        });
        mocks.consumeProductBatchesFefo.mockResolvedValue({
            allocations: [], unallocatedQuantity: new Decimal(0),
        });
        mocks.applyBatchWarehouseDelta.mockResolvedValue({
            mode: 'SHADOW', status: 'APPLIED', applied: true,
            replay: false, ledgerEntryId: 'ledger-a', stockBefore: '1.2500', stockAfter: '0.0000', gap: null,
        });
    });

    it('OFF reclama header antes de efectos, ordena locks y mueve solo ProductStock', async () => {
        const fake = fakeTx();
        const result = await executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
            now,
        });

        expect(result.replay).toBe(false);
        expect(result.transfer.items).toEqual([{ productId: 'product-a', name: 'Carne', quantity: '1.2500' }]);
        expect(fake.stocks.get('product-a:warehouse-z')?.toFixed(4)).toBe('3.7500');
        expect(fake.stocks.get('product-a:warehouse-a')?.toFixed(4)).toBe('3.2500');
        expect('updateMany' in fake.raw.product).toBe(false);
        expect(mocks.resolveBatchWarehouseLedgerMode).toHaveBeenCalledTimes(1);
        expect(mocks.consumeProductBatchesFefo).not.toHaveBeenCalled();
        expect(mocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
        expect(fake.events.indexOf('lock-warehouses')).toBeLessThan(fake.events.indexOf('header-create'));
        expect(fake.events.indexOf('header-create')).toBeLessThan(fake.events.indexOf('lock-products'));
        expect(fake.events.indexOf('header-create')).toBeLessThan(fake.events.indexOf('lock-product-stocks'));
        expect(fake.events.indexOf('lock-product-stocks')).toBeLessThan(fake.events.indexOf('stock:product-a:warehouse-z:tenant-a'));
        expect(fake.queries[0]).toContain('ORDER BY `id` ASC');
        expect(fake.queries[1]).toContain('ORDER BY `id` ASC');
        expect(fake.queries[2]).toContain('ORDER BY `productId` ASC, `warehouseId` ASC');
        expect(fake.raw.kardexMovement.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({ type: 'TRANSFER_OUT', referenceId: 'transfer-new', tenantId: 'tenant-a' }),
                expect.objectContaining({ type: 'TRANSFER_IN', referenceId: 'transfer-new', tenantId: 'tenant-a' }),
            ]),
        });
        expect(fake.raw.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('replay exacto valida actor y retorna antes de modo, locks y efectos', async () => {
        const fake = fakeTx({ existing: existingTransfer() });
        const result = await executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        });
        expect(result).toMatchObject({ replay: true, transfer: { id: 'transfer-existing' } });
        expect(fake.events).toEqual(['actor:tenant-a:ACTIVE', 'replay-read']);
        expect(mocks.resolveBatchWarehouseLedgerMode).not.toHaveBeenCalled();
        expect(fake.raw.stockTransfer.create).not.toHaveBeenCalled();
    });

    it('falla cerrado si el actor no está ACTIVE en el tenant', async () => {
        const fake = fakeTx({ actorActive: false });
        await expect(executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        })).rejects.toMatchObject({ code: 'STOCK_TRANSFER_ACTOR_FORBIDDEN', httpStatus: 403 });
        expect(fake.events).toEqual(['actor:tenant-a:ACTIVE']);
        expect(fake.raw.stockTransfer.findFirst).not.toHaveBeenCalled();
        expect(fake.raw.stockTransfer.create).not.toHaveBeenCalled();
    });

    it('reutilización conflictiva del UUID falla 409 antes de mover inventario', async () => {
        const fake = fakeTx({ existing: existingTransfer({ payloadHash: 'otro-hash' }) });
        await expect(executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        })).rejects.toMatchObject({ code: 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
        expect(fake.raw.productStock.updateMany).not.toHaveBeenCalled();
    });

    it('SHADOW registra gap y nunca acredita un lote fantasma en destino', async () => {
        mocks.resolveBatchWarehouseLedgerMode.mockResolvedValue('SHADOW');
        mocks.consumeProductBatchesFefo.mockResolvedValue({
            allocations: [{ batchId: 'batch-a', batchNumber: 'L-01', quantity: new Decimal('1.2500') }],
            unallocatedQuantity: new Decimal(0),
        });
        mocks.applyBatchWarehouseDelta.mockResolvedValueOnce({
            mode: 'SHADOW', status: 'SHADOW_GAP', applied: false,
            replay: false, ledgerEntryId: 'gap-a', stockBefore: '0.0000', stockAfter: '0.0000', gap: '1.2500',
        });
        const fake = fakeTx({ tracked: true });
        const result = await executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        });

        expect(result.transfer.batchTransferStatus).toBe('SHADOW_GAP');
        expect(result.transfer.batchSnapshot).toMatchObject({
            version: 1,
            mode: 'SHADOW',
            status: 'SHADOW_GAP',
            lines: [{
                productId: 'product-a',
                status: 'SHADOW_GAP',
                allocations: [{ out: { status: 'SHADOW_GAP', gap: '1.2500' }, in: null }],
            }],
        });
        expect(mocks.applyBatchWarehouseDelta).toHaveBeenCalledTimes(1);
        expect(mocks.applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'SHADOW',
            movementType: 'TRANSFER_OUT',
            warehouseId: 'warehouse-z',
            delta: '-1.2500',
            sourceKey: 'stock-transfer:transfer-new:line:product-a:out:batch:batch-a',
        }));
        expect(fake.raw.productBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'batch-a', tenantId: 'tenant-a', productId: 'product-a' },
            data: { stock: { increment: 1.25 } },
        }));
    });

    it('ENFORCED usa FEFO local y compensa el agregado antes del TRANSFER_IN', async () => {
        mocks.resolveBatchWarehouseLedgerMode.mockResolvedValue('ENFORCED');
        mocks.consumeProductBatchesByWarehouseFefo.mockResolvedValue({
            allocations: [{ batchId: 'batch-a', batchNumber: 'L-01', quantity: new Decimal('1.2500') }],
            unallocatedQuantity: new Decimal(0),
        });
        mocks.applyBatchWarehouseDelta.mockResolvedValueOnce({
            mode: 'ENFORCED', status: 'APPLIED', applied: true,
            replay: false, ledgerEntryId: 'in-a', stockBefore: '0.0000', stockAfter: '1.2500', gap: null,
        });
        const fake = fakeTx({ tracked: true });
        const result = await executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        });

        expect(result.transfer.batchTransferStatus).toBe('APPLIED');
        expect(mocks.consumeProductBatchesByWarehouseFefo).toHaveBeenCalledWith(fake.tx, expect.objectContaining({
            tenantId: 'tenant-a',
            productId: 'product-a',
            quantity: '1.2500',
            context: expect.objectContaining({
                mode: 'ENFORCED',
                movementType: 'TRANSFER_OUT',
                warehouseId: 'warehouse-z',
                sourceKeyPrefix: 'stock-transfer:transfer-new:line:product-a:out',
            }),
        }));
        expect(mocks.applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'ENFORCED',
            movementType: 'TRANSFER_IN',
            warehouseId: 'warehouse-a',
            delta: '1.2500',
            sourceKey: 'stock-transfer:transfer-new:line:product-a:in:batch:batch-a',
        }));
        expect(fake.events.indexOf('batch-compensate:tenant-a:1.25')).toBeGreaterThan(-1);
    });

    it('falla suficiencia por bodega con cantidad exacta y deja el destino intacto', async () => {
        const fake = fakeTx({ sourceStock: '1.2499', destinationStock: '2' });
        await expect(executeStockTransfer({
            tx: fake.tx,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_WAREHOUSE_STOCK', httpStatus: 422 });
        expect(fake.stocks.get('product-a:warehouse-a')?.toString()).toBe('2');
        expect(fake.raw.kardexMovement.createMany).not.toHaveBeenCalled();
    });

    it('tras P2002 relee fuera de la tx y devuelve replay exacto', async () => {
        const replay = existingTransfer();
        const db = {
            $transaction: vi.fn(async () => { throw { code: 'P2002' }; }),
            stockTransfer: { findFirst: vi.fn(async () => replay) },
        };
        const result = await executeStockTransferTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        });
        expect(result).toMatchObject({ replay: true, transfer: { id: 'transfer-existing' } });
        expect(db.stockTransfer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-a', clientEventId: eventId },
        }));
    });

    it('tras P2002 rechaza una huella distinta en vez de repetirla', async () => {
        const db = {
            $transaction: vi.fn(async () => { throw { code: 'P2002' }; }),
            stockTransfer: {
                findFirst: vi.fn(async () => existingTransfer({ payloadHash: 'huella-distinta' })),
            },
        };
        await expect(executeStockTransferTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            request,
        })).rejects.toMatchObject({ code: 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
    });
});
