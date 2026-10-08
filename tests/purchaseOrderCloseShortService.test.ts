import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { purchaseOrderCloseShortRequestSchema } from '../backend/lib/purchaseOrderCloseShort';
import { executePurchaseOrderCloseShortTransaction } from '../backend/services/purchaseOrderCloseShortService';

const EVENT_ID = 'd95d65da-c109-4e21-9384-08120c954b23';
const NOW = new Date('2026-08-27T20:00:00.000Z');

interface FakeItem {
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
    unitCostExact: string;
}

interface FakeState {
    tenantId: string;
    userId: string;
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
        items: FakeItem[];
    };
    closeShort: null | Record<string, any>;
    closeShortItems: Array<Record<string, any>>;
    audits: Array<Record<string, any>>;
}

const makeState = (): FakeState => ({
    tenantId: 'tenant-a',
    userId: 'user-a',
    po: {
        id: 'po-a',
        tenantId: 'tenant-a',
        supplierId: 'supplier-a',
        orderNumber: 'OC-0001',
        status: 'PARTIALLY_RECEIVED',
        notes: null,
        expectedDate: null,
        createdBy: 'user-a',
        approvedBy: 'user-a',
        approvedAt: new Date('2026-08-27T18:00:00.000Z'),
        createdAt: new Date('2026-08-27T17:00:00.000Z'),
        updatedAt: new Date('2026-08-27T19:00:00.000Z'),
        items: [{
            id: 'item-a',
            purchaseOrderId: 'po-a',
            productId: 'product-a',
            productName: 'Carne molida',
            quantityOrdered: 10,
            quantityReceived: 4,
            quantityOrderedExact: '10',
            quantityReceivedExact: '4',
            quantityRejectedExact: '99.9999',
            quantityClosedShortExact: '0',
            unitAtOrder: 'kg',
            saleModeAtOrder: 'MEASURED',
            quantityStepAtOrder: '0.0001',
            unitCost: '12.35',
            unitCostExact: '12.345678',
        }],
    },
    closeShort: null,
    closeShortItems: [],
    audits: [],
});

const clone = (state: FakeState): FakeState => structuredClone(state);

const poSnapshot = (state: FakeState) => ({
    ...state.po,
    items: state.po.items.map(item => ({ ...item })),
});

const closeShortSnapshot = (state: FakeState) => {
    if (!state.closeShort) return null;
    return {
        ...state.closeShort,
        creator: { id: state.userId, name: 'Usuario QA' },
        items: state.closeShortItems.map(item => ({ ...item })),
        purchaseOrder: poSnapshot(state),
    };
};

const makeTx = (state: FakeState, failAudit: boolean) => ({
    $queryRaw: vi.fn(async (query: { values?: unknown[] }) => {
        const values = query.values ?? [];
        return values.includes(state.po.id) && values.includes(state.tenantId)
            ? [{ id: state.po.id }]
            : [];
    }),
    user: {
        findFirst: vi.fn(async ({ where }: any) =>
            where.id === state.userId
            && where.tenantId === state.tenantId
            && where.status === 'ACTIVE'
                ? { id: state.userId }
                : null),
    },
    purchaseOrder: {
        findFirst: vi.fn(async ({ where }: any) =>
            where.id === state.po.id && where.tenantId === state.tenantId
                ? poSnapshot(state)
                : null),
        findFirstOrThrow: vi.fn(async () => poSnapshot(state)),
        updateMany: vi.fn(async ({ where, data }: any) => {
            if (where.id !== state.po.id || where.tenantId !== state.tenantId) return { count: 0 };
            state.po.status = data.status;
            state.po.updatedAt = NOW;
            return { count: 1 };
        }),
    },
    product: {
        findMany: vi.fn(async ({ where }: any) => where.tenantId === state.tenantId
            ? [{ id: 'product-a', name: 'Carne molida', unit: 'kg', saleMode: 'MEASURED', quantityStep: '0.0001' }]
            : []),
    },
    purchaseOrderCloseShort: {
        findFirst: vi.fn(async ({ where }: any) => state.closeShort
            && where.tenantId === state.closeShort.tenantId
            && where.clientEventId === state.closeShort.clientEventId
            ? closeShortSnapshot(state)
            : null),
        create: vi.fn(async ({ data }: any) => {
            state.closeShort = {
                id: 'close-a',
                ...data,
                createdAt: NOW,
            };
            return { id: 'close-a' };
        }),
        findFirstOrThrow: vi.fn(async () => closeShortSnapshot(state)),
    },
    purchaseOrderCloseShortItem: {
        create: vi.fn(async ({ data }: any) => {
            const item = { id: `close-item-${state.closeShortItems.length + 1}`, ...data, createdAt: NOW };
            state.closeShortItems.push(item);
            return item;
        }),
    },
    purchaseOrderItem: {
        updateMany: vi.fn(async ({ where, data }: any) => {
            const item = state.po.items.find(candidate =>
                candidate.id === where.id && candidate.purchaseOrderId === where.purchaseOrderId);
            if (!item) return { count: 0 };
            item.quantityClosedShortExact = String(data.quantityClosedShortExact);
            return { count: 1 };
        }),
    },
    auditLog: {
        create: vi.fn(async ({ data }: any) => {
            if (failAudit) throw new Error('QA_CLOSE_SHORT_AUDIT_FAILURE');
            state.audits.push(data);
            return data;
        }),
    },
});

const makeDb = (initial: FakeState, failAudit = false) => {
    let committed = clone(initial);
    let queue: Promise<unknown> = Promise.resolve();
    const db = {
        $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => {
            const run = queue.then(async () => {
                const working = clone(committed);
                const result = await callback(makeTx(working, failAudit));
                committed = working;
                return result;
            });
            queue = run.catch(() => undefined);
            return run;
        }),
        purchaseOrderCloseShort: {
            findFirst: vi.fn(async ({ where }: any) => committed.closeShort
                && where.tenantId === committed.closeShort.tenantId
                && where.clientEventId === committed.closeShort.clientEventId
                ? closeShortSnapshot(committed)
                : null),
        },
        state: () => committed,
    };
    return db;
};

const requestFor = (
    quantity: string | number,
    eventId = EVENT_ID,
    overrides: Record<string, unknown> = {},
) => purchaseOrderCloseShortRequestSchema.parse({
    clientEventId: eventId,
    reasonSummaryCode: 'SUPPLIER_SHORTAGE',
    note: 'Proveedor confirma faltante definitivo',
    items: [{
        itemId: 'item-a',
        quantity: typeof quantity === 'number' ? quantity.toFixed(4) : quantity,
        reasonCode: 'SUPPLIER_SHORTAGE',
        supplierFault: true,
        note: 'No se repondrá',
    }],
    ...overrides,
});

describe('servicio transaccional de cierre corto', () => {
    it('cierra el saldo exacto, congela snapshots y no tiene dependencias de inventario/dinero', async () => {
        const db = makeDb(makeState());
        const result = await executePurchaseOrderCloseShortTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request: requestFor(6),
            now: NOW,
        });

        expect(result.replay).toBe(false);
        expect(result.purchaseOrder.status).toBe('CLOSED_SHORT');
        expect(result.purchaseOrder.items[0]).toMatchObject({
            quantityReceivedExact: '4',
            quantityRejectedExact: '99.9999',
            quantityClosedShortExact: '6',
        });
        expect(result.closeShort).toMatchObject({
            id: 'close-a',
            status: 'POSTED',
            clientEventId: EVENT_ID,
            lineCount: 1,
            closedLineCount: 1,
            hasSupplierFault: true,
            reasonSummaryCode: 'SUPPLIER_SHORTAGE',
        });
        expect(result.closeShort.items[0]).toMatchObject({
            purchaseOrderItemId: 'item-a',
            quantityExact: '6',
            orderedQuantitySnapshotExact: '10',
            acceptedQuantitySnapshotExact: '4',
            rejectedQuantitySnapshotExact: '99.9999',
            remainingBeforeExact: '6',
            remainingAfterExact: '0',
            unitSnapshot: 'kg',
            saleModeSnapshot: 'MEASURED',
            quantityStepSnapshot: '0.0001',
        });
        expect(db.state().audits).toHaveLength(1);
        expect(db.state().audits[0]).toMatchObject({ action: 'PO_CLOSE_SHORT_POSTED' });
        const tx = (db.$transaction.mock.calls[0][0] as unknown);
        expect(tx).toBeTypeOf('function');
        // El fake ni siquiera expone stock/Kardex/accounting: el servicio no los requiere.
        expect('productStock' in (makeTx(makeState(), false) as object)).toBe(false);
        expect('kardexMovement' in (makeTx(makeState(), false) as object)).toBe(false);
        expect('journalEntry' in (makeTx(makeState(), false) as object)).toBe(false);
    });

    it('permite cierre parcial y conserva PARTIALLY_RECEIVED', async () => {
        const db = makeDb(makeState());
        const result = await executePurchaseOrderCloseShortTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request: requestFor('2.0000'),
            now: NOW,
        });
        expect(result.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
        expect(result.purchaseOrder.items[0].quantityClosedShortExact).toBe('2');
        expect(result.closeShort.items[0].remainingAfterExact).toBe('4');
    });

    it('repite exactamente, rechaza UUID reutilizado y serializa concurrencia en un solo evento', async () => {
        const db = makeDb(makeState());
        const input = {
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request: requestFor('2.0000'),
            now: NOW,
        };
        const results = await Promise.all([
            executePurchaseOrderCloseShortTransaction(input),
            executePurchaseOrderCloseShortTransaction({ ...input, request: requestFor(2) }),
        ]);
        expect(results.map(result => result.replay).sort()).toEqual([false, true]);
        expect(db.state().closeShortItems).toHaveLength(1);
        expect(db.state().po.items[0].quantityClosedShortExact).toBe('2');

        await expect(executePurchaseOrderCloseShortTransaction({
            ...input,
            request: requestFor(3),
        })).rejects.toMatchObject({ code: 'CLOSE_SHORT_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
        expect(db.state().po.items[0].quantityClosedShortExact).toBe('2');
    });

    it('tras P2002 relee un snapshot fresco y mantiene replay/conflicto estrictos', async () => {
        const seeded = makeDb(makeState());
        const request = requestFor('2.0000');
        await executePurchaseOrderCloseShortTransaction({
            db: seeded as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request,
            now: NOW,
        });
        const committed = seeded.state();
        const p2002Db = {
            $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
            purchaseOrderCloseShort: {
                findFirst: vi.fn(async ({ where }: any) =>
                    where.tenantId === committed.tenantId
                    && where.clientEventId === EVENT_ID
                        ? closeShortSnapshot(committed)
                        : null),
            },
        };

        const replay = await executePurchaseOrderCloseShortTransaction({
            db: p2002Db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request,
            now: NOW,
        });
        expect(replay.replay).toBe(true);
        expect(p2002Db.purchaseOrderCloseShort.findFirst).toHaveBeenCalledOnce();

        await expect(executePurchaseOrderCloseShortTransaction({
            db: p2002Db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-other',
            request,
            now: NOW,
        })).rejects.toMatchObject({ code: 'CLOSE_SHORT_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
    });

    it('falla tenant ajeno e invalid status antes de crear efectos', async () => {
        const foreignDb = makeDb(makeState());
        await expect(executePurchaseOrderCloseShortTransaction({
            db: foreignDb as unknown as PrismaClient,
            tenantId: 'tenant-ajeno',
            userId: 'user-ajeno',
            purchaseOrderId: 'po-a',
            request: requestFor(1),
            now: NOW,
        })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_FOUND', httpStatus: 404 });
        expect(foreignDb.state().closeShort).toBeNull();

        const inactiveDb = makeDb(makeState());
        await expect(executePurchaseOrderCloseShortTransaction({
            db: inactiveDb as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-inactivo',
            purchaseOrderId: 'po-a',
            request: requestFor(1),
            now: NOW,
        })).rejects.toMatchObject({ code: 'CLOSE_SHORT_ACTOR_FORBIDDEN', httpStatus: 403 });
        expect(inactiveDb.state().closeShort).toBeNull();
        expect(inactiveDb.state().po.items[0].quantityClosedShortExact).toBe('0');

        for (const status of ['DRAFT', 'RECEIVED', 'CANCELLED', 'CLOSED_SHORT']) {
            const state = makeState();
            state.po.status = status;
            const db = makeDb(state);
            await expect(executePurchaseOrderCloseShortTransaction({
                db: db as unknown as PrismaClient,
                tenantId: state.tenantId,
                userId: state.userId,
                purchaseOrderId: state.po.id,
                request: requestFor(1),
                now: NOW,
            })).rejects.toMatchObject({ code: 'INVALID_PURCHASE_ORDER_STATUS', httpStatus: 409 });
            expect(db.state().closeShort).toBeNull();
        }
    });

    it('rechaza exceso contra open=ordered-accepted-closed e ignora rejected acumulado', async () => {
        const state = makeState();
        state.po.items[0].quantityClosedShortExact = '1';
        const db = makeDb(state);
        await expect(executePurchaseOrderCloseShortTransaction({
            db: db as unknown as PrismaClient,
            tenantId: state.tenantId,
            userId: state.userId,
            purchaseOrderId: state.po.id,
            request: requestFor('5.0001'),
            now: NOW,
        })).rejects.toMatchObject({ code: 'OVER_CLOSE_SHORT', httpStatus: 409 });
        expect(db.state().closeShort).toBeNull();
        expect(db.state().po.items[0]).toMatchObject({
            quantityRejectedExact: '99.9999',
            quantityClosedShortExact: '1',
        });
    });

    it('revierte header, líneas, estado y auditoría si falla el AuditLog', async () => {
        const db = makeDb(makeState(), true);
        await expect(executePurchaseOrderCloseShortTransaction({
            db: db as unknown as PrismaClient,
            tenantId: 'tenant-a',
            userId: 'user-a',
            purchaseOrderId: 'po-a',
            request: requestFor(6),
            now: NOW,
        })).rejects.toThrow('QA_CLOSE_SHORT_AUDIT_FAILURE');
        expect(db.state().closeShort).toBeNull();
        expect(db.state().closeShortItems).toHaveLength(0);
        expect(db.state().po.status).toBe('PARTIALLY_RECEIVED');
        expect(db.state().po.items[0].quantityClosedShortExact).toBe('0');
        expect(db.state().audits).toHaveLength(0);
    });
});
