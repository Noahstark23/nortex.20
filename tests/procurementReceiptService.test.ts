import { describe, expect, it, beforeEach, vi } from 'vitest';
import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import {
    buildProcurementReceiptPayloadHash,
    normalizeProcurementReceiptLines,
    procurementReceiptRequestSchema,
} from '../backend/lib/procurementReceipts';

const stockMocks = vi.hoisted(() => ({
    applyStockDelta: vi.fn(),
    resolveOperationalWarehouse: vi.fn(),
}));

const ledgerMocks = vi.hoisted(() => ({
    applyBatchWarehouseDelta: vi.fn(),
    resolveBatchWarehouseLedgerMode: vi.fn(),
}));

vi.mock('../backend/services/stockService', async () => {
    const actual = await vi.importActual<typeof import('../backend/services/stockService')>(
        '../backend/services/stockService',
    );
    return {
        ...actual,
        applyStockDelta: stockMocks.applyStockDelta,
        resolveOperationalWarehouse: stockMocks.resolveOperationalWarehouse,
    };
});

vi.mock('../backend/services/productBatchWarehouseLedgerService', () => ({
    applyBatchWarehouseDelta: ledgerMocks.applyBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode: ledgerMocks.resolveBatchWarehouseLedgerMode,
}));

import {
    executeProcurementReceiptTransaction,
} from '../backend/services/procurementReceiptService';

type FailurePoint = 'kardex' | 'audit' | null;

interface FakePoItem {
    id: string;
    purchaseOrderId: string;
    productId: string;
    productName: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityOrderedExact: string;
    quantityReceivedExact: string;
    quantityRejectedExact: string;
    quantityClosedShortExact: string;
    unitAtOrder: string;
    saleModeAtOrder: string;
    quantityStepAtOrder: string;
    unitCost: string;
    unitCostExact: string | null;
}

interface FakeState {
    tenantId: string;
    userId: string;
    warehouseId: string;
    po: {
        id: string;
        tenantId: string;
        supplierId: string;
        orderNumber: string;
        status: string;
        notes: string | null;
        expectedDate: Date | null;
        createdBy: string;
        approvedBy: string | null;
        approvedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        items: FakePoItem[];
    };
    product: {
        id: string;
        name: string;
        unit: string;
        saleMode: string;
        quantityStep: string;
        requiresBatchTracking: boolean;
        stock: number;
        cost: number;
    };
    receipt: null | {
        id: string;
        tenantId: string;
        purchaseOrderId: string;
        warehouseId: string;
        receiptNumber: string;
        status: string;
        supplierDeliveryRef: string | null;
        clientEventId: string;
        payloadHash: string;
        payloadVersion: number;
        inspectionOutcome: string;
        inspectedLineCount: number;
        rejectedLineCount: number;
        hasSupplierFault: boolean;
        receivedBy: string;
        receivedAt: Date;
        createdAt: Date;
    };
    receiptItems: Array<Record<string, unknown>>;
    kardex: Array<Record<string, unknown>>;
    audits: Array<Record<string, unknown>>;
    batches: Array<{
        id: string;
        tenantId: string;
        productId: string;
        batchNumber: string;
        expiryDate: Date;
        stock: number;
    }>;
}

const EVENT_ID = '9b36c7e4-dc7e-41f3-a956-0d189d0ebc82';
const NOW = new Date('2026-08-27T18:00:00.000Z');

const makeState = (twoLinesSameSku = false): FakeState => {
    const common = {
        purchaseOrderId: 'po-1',
        productId: 'product-1',
        productName: 'Carne molida',
        quantityReceived: 0,
        quantityReceivedExact: '0',
        quantityRejectedExact: '0',
        quantityClosedShortExact: '0',
        unitAtOrder: 'kg',
        saleModeAtOrder: 'MEASURED',
        quantityStepAtOrder: '0.01',
        unitCost: '12.35',
        unitCostExact: '12.345678',
    };
    const items: FakePoItem[] = twoLinesSameSku
        ? [
            { ...common, id: 'item-b', quantityOrdered: 2, quantityOrderedExact: '2' },
            { ...common, id: 'item-a', quantityOrdered: 1, quantityOrderedExact: '1' },
        ]
        : [{ ...common, id: 'item-a', quantityOrdered: 3, quantityOrderedExact: '3' }];

    return {
        tenantId: 'tenant-a',
        userId: 'user-a',
        warehouseId: 'warehouse-a',
        po: {
            id: 'po-1',
            tenantId: 'tenant-a',
            supplierId: 'supplier-a',
            orderNumber: 'OC-0001',
            status: 'APPROVED',
            notes: null,
            expectedDate: null,
            createdBy: 'user-a',
            approvedBy: 'user-a',
            approvedAt: new Date('2026-08-27T17:00:00.000Z'),
            createdAt: new Date('2026-08-27T16:00:00.000Z'),
            updatedAt: new Date('2026-08-27T17:00:00.000Z'),
            items,
        },
        product: {
            id: 'product-1',
            name: 'Carne molida',
            unit: 'kg',
            saleMode: 'MEASURED',
            quantityStep: '0.01',
            requiresBatchTracking: true,
            stock: 0,
            cost: 4,
        },
        receipt: null,
        receiptItems: [],
        kardex: [],
        audits: [],
        batches: [],
    };
};

const cloneState = (state: FakeState): FakeState => structuredClone(state);

const purchaseOrderSnapshot = (state: FakeState) => ({
    ...state.po,
    items: state.po.items.map(item => ({ ...item })),
});

const receiptSnapshot = (state: FakeState) => {
    if (!state.receipt) return null;
    return {
        ...state.receipt,
        warehouse: { id: state.warehouseId, name: 'Bodega Central' },
        receiver: { id: state.userId, name: 'Usuario QA' },
        items: state.receiptItems.map(item => ({ ...item })),
        purchaseOrder: purchaseOrderSnapshot(state),
    };
};

const makeTx = (state: FakeState, failAt: FailurePoint) => {
    let rawCall = 0;
    const tx = {
        __receiptState: state,
        $queryRaw: vi.fn(async (query: { values?: unknown[] }) => {
            rawCall += 1;
            if (rawCall === 1) {
                const values = query.values ?? [];
                return values.includes(state.po.id) && values.includes(state.tenantId)
                    ? [{ id: state.po.id }]
                    : [];
            }
            return [{ cost: state.product.cost.toString() }];
        }),
        tenant: {
            findFirst: vi.fn(async ({ where }: any) => (
                where.id === state.tenantId
                    ? { batchWarehouseLedgerMode: 'OFF' }
                    : null
            )),
        },
        user: {
            findFirst: vi.fn(async ({ where }: any) => (
                where.id === state.userId
                && where.tenantId === state.tenantId
                && where.status === 'ACTIVE'
                    ? { id: state.userId }
                    : null
            )),
        },
        purchaseOrder: {
            findFirst: vi.fn(async ({ where }: any) =>
                where.id === state.po.id && where.tenantId === state.tenantId
                    ? purchaseOrderSnapshot(state)
                    : null),
            findFirstOrThrow: vi.fn(async () => purchaseOrderSnapshot(state)),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.id !== state.po.id || where.tenantId !== state.tenantId) return { count: 0 };
                state.po.status = data.status;
                state.po.updatedAt = NOW;
                return { count: 1 };
            }),
        },
        purchaseOrderItem: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                const item = state.po.items.find(candidate =>
                    candidate.id === where.id && candidate.purchaseOrderId === where.purchaseOrderId);
                if (!item) return { count: 0 };
                item.quantityReceived += Number(data.quantityReceived.increment);
                item.quantityOrderedExact = String(data.quantityOrderedExact);
                item.quantityReceivedExact = String(data.quantityReceivedExact);
                item.quantityRejectedExact = String(data.quantityRejectedExact);
                item.quantityClosedShortExact = String(data.quantityClosedShortExact);
                return { count: 1 };
            }),
        },
        product: {
            findMany: vi.fn(async ({ where }: any) =>
                where.tenantId === state.tenantId && where.id.in.includes(state.product.id)
                    ? [{ ...state.product }]
                    : []),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.id !== state.product.id || where.tenantId !== state.tenantId) return { count: 0 };
                state.product.cost = Number(data.cost);
                return { count: 1 };
            }),
        },
        goodsReceipt: {
            findFirst: vi.fn(async ({ where }: any) =>
                state.receipt
                && where.tenantId === state.receipt.tenantId
                && where.clientEventId === state.receipt.clientEventId
                    ? receiptSnapshot(state)
                    : null),
            create: vi.fn(async ({ data }: any) => {
                state.receipt = {
                    id: 'receipt-1',
                    ...data,
                    createdAt: NOW,
                };
                return { id: 'receipt-1' };
            }),
            findFirstOrThrow: vi.fn(async () => receiptSnapshot(state)),
        },
        goodsReceiptItem: {
            create: vi.fn(async ({ data }: any) => {
                const row = {
                    id: `receipt-item-${state.receiptItems.length + 1}`,
                    ...data,
                    createdAt: NOW,
                };
                state.receiptItems.push(row);
                return row;
            }),
        },
        productBatch: {
            findFirst: vi.fn(async ({ where }: any) => state.batches.find(batch =>
                batch.tenantId === where.tenantId
                && batch.productId === where.productId
                && batch.batchNumber === where.batchNumber) ?? null),
            create: vi.fn(async ({ data }: any) => {
                const batch = { id: `batch-${state.batches.length + 1}`, ...data };
                state.batches.push(batch);
                return { id: batch.id };
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const batch = state.batches.find(candidate => candidate.id === where.id);
                if (!batch) return { count: 0 };
                batch.stock += Number(data.stock.increment);
                return { count: 1 };
            }),
        },
        kardexMovement: {
            create: vi.fn(async ({ data }: any) => {
                if (failAt === 'kardex') throw new Error('QA_KARDEX_FAILURE');
                state.kardex.push(data);
                return data;
            }),
        },
        auditLog: {
            create: vi.fn(async ({ data }: any) => {
                if (failAt === 'audit') throw new Error('QA_AUDIT_FAILURE');
                state.audits.push(data);
                return data;
            }),
        },
    };
    return tx;
};

const makeDb = (initial: FakeState, failAt: FailurePoint = null) => {
    let committed = cloneState(initial);
    let queue: Promise<unknown> = Promise.resolve();
    const db = {
        $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => {
            const run = queue.then(async () => {
                const working = cloneState(committed);
                const result = await callback(makeTx(working, failAt));
                committed = working;
                return result;
            });
            queue = run.catch(() => undefined);
            return run;
        }),
        goodsReceipt: {
            findFirst: vi.fn(async ({ where }: any) =>
                committed.receipt
                && where.tenantId === committed.receipt.tenantId
                && where.clientEventId === committed.receipt.clientEventId
                    ? receiptSnapshot(committed)
                    : null),
        },
        state: () => committed,
    };
    return db;
};

const requestFor = (items: Array<Record<string, unknown>>, eventId = EVENT_ID) =>
    procurementReceiptRequestSchema.parse({
        clientEventId: eventId,
        warehouseId: 'warehouse-a',
        supplierDeliveryRef: 'REM-908',
        items,
    });

beforeEach(() => {
    ledgerMocks.resolveBatchWarehouseLedgerMode.mockReset().mockResolvedValue('OFF');
    ledgerMocks.applyBatchWarehouseDelta.mockReset().mockResolvedValue({
        mode: 'OFF',
        status: 'OFF',
        applied: false,
        replay: false,
        ledgerEntryId: null,
        stockBefore: null,
        stockAfter: null,
        gap: null,
    });
    stockMocks.applyStockDelta.mockReset().mockImplementation(async (tx: any, input: any) => {
        const state = tx.__receiptState as FakeState;
        const stockBefore = state.product.stock;
        state.product.stock += Number(input.delta);
        return {
            stockBefore,
            stockAfter: state.product.stock,
            warehouseId: input.warehouseId,
        };
    });
    stockMocks.resolveOperationalWarehouse.mockReset().mockImplementation(async (
        tx: any,
        tenantId: string,
        warehouseId: string,
    ) => {
        const state = tx.__receiptState as FakeState;
        if (tenantId !== state.tenantId || warehouseId !== state.warehouseId) {
            throw new Error('WAREHOUSE_NOT_FOUND');
        }
        return { id: state.warehouseId, name: 'Bodega Central', isDefault: false };
    });
});

describe('servicio transaccional de recepciones de compras', () => {
    it('reintenta exactamente sin duplicar stock y rechaza UUID reutilizado con otro payload', async () => {
        const db = makeDb(makeState());
        const request = requestFor([{
            itemId: 'item-a',
            quantityReceived: '3.0000',
            batchNumber: ' L-001 ',
            expiryDate: '2027-08-12',
        }]);
        const input = {
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request,
            now: NOW,
        };

        const first = await executeProcurementReceiptTransaction(input);
        const replay = await executeProcurementReceiptTransaction({
            ...input,
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 3,
                batchNumber: 'L-001',
                expiryDate: '2027-08-12T00:00:00-06:00',
            }]),
        });

        expect(first.replay).toBe(false);
        expect(replay.replay).toBe(true);
        expect(replay.receipt.id).toBe(first.receipt.id);
        expect(db.state().product.stock).toBe(3);
        expect(db.state().kardex).toHaveLength(1);
        expect(db.state().receiptItems).toHaveLength(1);

        await expect(executeProcurementReceiptTransaction({
            ...input,
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 2,
                batchNumber: 'L-001',
                expiryDate: '2027-08-12',
            }]),
        })).rejects.toMatchObject({ code: 'RECEIPT_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
        expect(db.state().product.stock).toBe(3);
        expect(db.state().kardex).toHaveLength(1);
    });

    it('serializa dos requests concurrentes con el mismo UUID en un solo comprobante', async () => {
        const db = makeDb(makeState());
        const request = requestFor([{
            itemId: 'item-a',
            quantityReceived: 3,
            batchNumber: 'L-001',
            expiryDate: '2027-08-12',
        }]);
        const input = {
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request,
            now: NOW,
        };

        const results = await Promise.all([
            executeProcurementReceiptTransaction(input),
            executeProcurementReceiptTransaction(input),
        ]);

        expect(results.map(result => result.replay).sort()).toEqual([false, true]);
        expect(new Set(results.map(result => result.receipt.id)).size).toBe(1);
        expect(db.state().product.stock).toBe(3);
        expect(db.state().kardex).toHaveLength(1);
    });

    it('rechaza una OC ajena en el lock tenant-scoped antes de cualquier efecto', async () => {
        const db = makeDb(makeState());
        const request = requestFor([{
            itemId: 'item-a',
            quantityReceived: 3,
            batchNumber: 'L-001',
            expiryDate: '2027-08-12',
        }]);

        await expect(executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-ajeno',
            userId: 'user-ajeno',
            purchaseOrderId: 'po-1',
            request,
            now: NOW,
        })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_FOUND', httpStatus: 404 });
        expect(db.state().receipt).toBeNull();
        expect(db.state().product.stock).toBe(0);
        expect(db.state().kardex).toHaveLength(0);
    });

    it('rechaza receiver inactivo o ajeno después del lock y antes del comprobante', async () => {
        const db = makeDb(makeState());
        await expect(executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-inactivo',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 3,
                batchNumber: 'L-001',
                expiryDate: '2027-08-12',
            }]),
            now: NOW,
        })).rejects.toMatchObject({ code: 'RECEIPT_ACTOR_FORBIDDEN', httpStatus: 403 });
        expect(db.state().receipt).toBeNull();
        expect(db.state().product.stock).toBe(0);
        expect(db.state().kardex).toHaveLength(0);
        expect(db.state().audits).toHaveLength(0);
    });

    it('procesa dos líneas legacy del mismo SKU con locks deterministas, lote y bodega', async () => {
        const db = makeDb(makeState(true));
        const request = requestFor([
            {
                itemId: 'item-b',
                quantityReceived: 2,
                batchNumber: 'L-002',
                expiryDate: '2027-09-01',
            },
            {
                itemId: 'item-a',
                quantityReceived: 1,
                batchNumber: 'L-001',
                expiryDate: '2027-08-12',
            },
        ]);

        const result = await executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request,
            now: NOW,
        });

        expect(result.receipt.items.map(item => item.purchaseOrderItemId)).toEqual(['item-a', 'item-b']);
        expect(result.receipt.items.map(item => item.unitCostExact)).toEqual(['12.345678', '12.345678']);
        expect(result.receipt.warehouseId).toBe('warehouse-a');
        expect(db.state().product.stock).toBe(3);
        expect(db.state().kardex).toHaveLength(2);
        expect(db.state().kardex.every(row => row.referenceType === 'GOODS_RECEIPT')).toBe(true);
        expect(db.state().batches.map(batch => batch.batchNumber)).toEqual(['L-001', 'L-002']);
        expect(db.state().audits).toHaveLength(1);
    });

    it.each(['kardex', 'audit'] as const)(
        'revierte header, líneas, stock, lote y proyección si falla %s',
        async (failurePoint) => {
            const db = makeDb(makeState(), failurePoint);
            const request = requestFor([{
                itemId: 'item-a',
                quantityReceived: 3,
                batchNumber: 'L-001',
                expiryDate: '2027-08-12',
            }]);

            await expect(executeProcurementReceiptTransaction({
                db: db as unknown as PrismaClient,
                tenantId: 'tenant-a',
                userId: 'user-a',
                purchaseOrderId: 'po-1',
                request,
                now: NOW,
            })).rejects.toThrow(failurePoint === 'kardex' ? 'QA_KARDEX_FAILURE' : 'QA_AUDIT_FAILURE');

            expect(db.state().receipt).toBeNull();
            expect(db.state().receiptItems).toHaveLength(0);
            expect(db.state().product.stock).toBe(0);
            expect(db.state().product.cost).toBe(4);
            expect(db.state().batches).toHaveLength(0);
            expect(db.state().kardex).toHaveLength(0);
            expect(db.state().audits).toHaveLength(0);
            expect(db.state().po.status).toBe('APPROVED');
            expect(db.state().po.items[0].quantityReceivedExact).toBe('0');
        },
    );

    it('documenta reject-only sin mover stock, costo, lote, Kardex ni ledger de lote-bodega', async () => {
        const db = makeDb(makeState());
        const result = await executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 0,
                quantityRejected: 3,
                rejectionReasonCode: 'QUALITY',
                rejectionNotes: 'Temperatura fuera de rango',
                supplierFault: true,
            }]),
            now: NOW,
        });

        expect(result.purchaseOrder.status).toBe('APPROVED');
        expect(result.purchaseOrder.items[0]).toMatchObject({
            quantityReceivedExact: '0',
            quantityRejectedExact: '3',
            quantityClosedShortExact: '0',
        });
        expect(result.receipt).toMatchObject({
            payloadVersion: 2,
            inspectionOutcome: 'FULL_REJECT',
            inspectedLineCount: 1,
            rejectedLineCount: 1,
            hasSupplierFault: true,
        });
        expect(result.receipt.items[0]).toMatchObject({
            quantityExact: '0',
            deliveredQuantityExact: '3',
            rejectedQuantityExact: '3',
            rejectionReasonCode: 'QUALITY',
            rejectionNotes: 'Temperatura fuera de rango',
            supplierFault: true,
            batchId: null,
        });
        expect(db.state().product).toMatchObject({ stock: 0, cost: 4 });
        expect(db.state().batches).toHaveLength(0);
        expect(db.state().kardex).toHaveLength(0);
        expect(db.state().audits).toHaveLength(1);
        expect(stockMocks.applyStockDelta).not.toHaveBeenCalled();
        expect(ledgerMocks.resolveBatchWarehouseLedgerMode).not.toHaveBeenCalled();
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });

    it('separa accepted/rejected en recepción mixta y solo ingresa accepted al inventario', async () => {
        const db = makeDb(makeState());
        const result = await executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 2,
                quantityRejected: 1,
                rejectionReasonCode: 'DAMAGE',
                supplierFault: true,
                batchNumber: 'L-MIXTO',
                expiryDate: '2027-12-31',
            }]),
            now: NOW,
        });

        expect(result.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
        expect(result.purchaseOrder.items[0]).toMatchObject({
            quantityReceivedExact: '2',
            quantityRejectedExact: '1',
        });
        expect(result.receipt).toMatchObject({
            payloadVersion: 2,
            inspectionOutcome: 'PARTIAL_REJECT',
            rejectedLineCount: 1,
        });
        expect(db.state().product.stock).toBe(2);
        expect(db.state().batches).toHaveLength(1);
        expect(db.state().batches[0]).toMatchObject({ batchNumber: 'L-MIXTO', stock: 2 });
        expect(db.state().kardex).toHaveLength(1);
        expect(db.state().kardex[0]).toMatchObject({ quantity: 2, referenceType: 'GOODS_RECEIPT' });
        expect(ledgerMocks.resolveBatchWarehouseLedgerMode).toHaveBeenCalledWith(
            expect.anything(),
            'tenant-a',
        );
        expect(ledgerMocks.applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'OFF',
            tenantId: 'tenant-a',
            productId: 'product-1',
            batchId: 'batch-1',
            warehouseId: 'warehouse-a',
            delta: '2',
            movementType: 'GOODS_RECEIPT',
            referenceId: 'receipt-1',
            referenceType: 'GOODS_RECEIPT',
            sourceKey: 'goods-receipt:receipt-1:po-item:item-a',
            allowNegative: false,
        }));
    });

    it('exige lote solo cuando accepted es positivo y limita delivered al saldo abierto', async () => {
        const acceptedWithoutBatch = makeDb(makeState());
        await expect(executeProcurementReceiptTransaction({
            db: acceptedWithoutBatch as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 1,
                quantityRejected: 1,
                rejectionReasonCode: 'DAMAGE',
                supplierFault: true,
            }]),
            now: NOW,
        })).rejects.toMatchObject({ code: 'BATCH_REQUIRED', httpStatus: 400 });
        expect(acceptedWithoutBatch.state().receipt).toBeNull();

        const overDelivery = makeDb(makeState());
        await expect(executeProcurementReceiptTransaction({
            db: overDelivery as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 2,
                quantityRejected: 2,
                rejectionReasonCode: 'DAMAGE',
                supplierFault: false,
                batchNumber: 'L-OVER',
                expiryDate: '2027-12-31',
            }]),
            now: NOW,
        })).rejects.toMatchObject({ code: 'OVER_DELIVERY', httpStatus: 409 });
        expect(overDelivery.state().receipt).toBeNull();
        expect(overDelivery.state().product.stock).toBe(0);
    });

    it('repite una inspección v2 equivalente y rechaza cambios de responsabilidad', async () => {
        const db = makeDb(makeState());
        const input = {
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-1',
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 0,
                quantityRejected: '3.0000',
                rejectionReasonCode: 'QUALITY',
                supplierFault: true,
            }]),
            now: NOW,
        };
        const first = await executeProcurementReceiptTransaction(input);
        const replay = await executeProcurementReceiptTransaction({
            ...input,
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: '0.0000',
                quantityRejected: 3,
                rejectionReasonCode: 'QUALITY',
                supplierFault: true,
            }]),
        });
        expect(first.replay).toBe(false);
        expect(replay.replay).toBe(true);
        expect(db.state().po.items[0].quantityRejectedExact).toBe('3');
        expect(db.state().receiptItems).toHaveLength(1);

        await expect(executeProcurementReceiptTransaction({
            ...input,
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: 0,
                quantityRejected: 3,
                rejectionReasonCode: 'QUALITY',
                supplierFault: false,
            }]),
        })).rejects.toMatchObject({ code: 'RECEIPT_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
    });

    it('conserva precisión .0001 en accepted y rejected', async () => {
        const state = makeState();
        state.po.items[0].quantityOrdered = 0.0002;
        state.po.items[0].quantityOrderedExact = '0.0002';
        state.po.items[0].quantityStepAtOrder = '0.0001';
        state.product.quantityStep = '0.0001';
        state.product.requiresBatchTracking = false;
        const db = makeDb(state);
        const result = await executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: state.tenantId,
            userId: state.userId,
            purchaseOrderId: state.po.id,
            request: requestFor([{
                itemId: 'item-a',
                quantityReceived: '0.0001',
                quantityRejected: '0.0001',
                rejectionReasonCode: 'DOC_MISMATCH',
                supplierFault: false,
            }]),
            now: NOW,
        });

        expect(result.purchaseOrder.items[0]).toMatchObject({
            quantityReceivedExact: '0.0001',
            quantityRejectedExact: '0.0001',
        });
        expect(result.receipt.items[0]).toMatchObject({
            quantityExact: '0.0001',
            deliveredQuantityExact: '0.0002',
            rejectedQuantityExact: '0.0001',
        });
        expect(db.state().product.stock).toBe(0.0001);
    });

    it('la huella persistida incluye tenant, OC, bodega, referencia y líneas canónicas', async () => {
        const state = makeState();
        const db = makeDb(state);
        const request = requestFor([{
            itemId: 'item-a',
            quantityReceived: '3.0000',
            batchNumber: 'L-001',
            expiryDate: '2027-08-12',
        }]);
        await executeProcurementReceiptTransaction({
            db: db as unknown as PrismaClient,
            tenantId: state.tenantId,
            userId: state.userId,
            purchaseOrderId: state.po.id,
            request,
            now: NOW,
        });

        expect(db.state().receipt?.payloadHash).toBe(buildProcurementReceiptPayloadHash({
            tenantId: state.tenantId,
            purchaseOrderId: state.po.id,
            warehouseId: state.warehouseId,
            supplierDeliveryRef: 'REM-908',
            lines: normalizeProcurementReceiptLines(request.items),
        }));
    });
});
