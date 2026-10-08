import type { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    normalizeProcurementResolution,
    ProcurementMatchError,
} from '../backend/lib/procurementMatch';
import {
    executeProcurementMatch,
    executeProcurementMatchResolution,
    getProcurementMatchDetail,
    listProcurementMatches,
} from '../backend/services/procurementMatchService';

const EVENT_ID = '018f6d75-0d8c-7a7a-8b4b-e2b25a80eb12';
const NOW = new Date('2026-08-27T18:00:00.000Z');

const purchaseRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'purchase-1',
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    purchaseOrderId: 'po-1',
    paymentMethod: 'CREDIT',
    documentStatus: 'POSTED',
    matchStatus: 'NOT_REQUIRED',
    paymentHold: 0,
    matchResolvedBy: null,
    matchResolvedAt: null,
    matchResolutionNote: null,
    matchResolutionClientEventId: null,
    matchResolutionPayloadHash: null,
    ...overrides,
});

const orderLine = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-line-1',
    productId: 'product-1',
    quantityOrdered: 10,
    quantityOrderedExact: new Decimal('10'),
    quantityReceived: 5,
    quantityReceivedExact: new Decimal('5'),
    unitCost: new Decimal('10'),
    unitCostExact: new Decimal('10.000000'),
    ...overrides,
});

const invoiceLine = (overrides: Record<string, unknown> = {}) => ({
    id: 'invoice-line-1',
    productId: 'product-1',
    quantity: 2,
    quantityExact: new Decimal('2'),
    unitCost: new Decimal('10'),
    unitCostExact: new Decimal('10.000000'),
    purchaseOrderItemId: 'po-line-1',
    ...overrides,
});

const receiptLine = (overrides: Record<string, unknown> = {}) => ({
    id: 'receipt-line-1',
    purchaseOrderItemId: 'po-line-1',
    quantityExact: new Decimal('5'),
    receivedAt: new Date('2026-08-27T10:00:00.000Z'),
    ...overrides,
});

const matchingTx = (queryResults?: unknown[][]) => {
    const events: string[] = [];
    const results = [...(queryResults ?? [
        [purchaseRow()],
        [{ id: 'po-1', supplierId: 'supplier-1' }],
        [invoiceLine()],
        [orderLine()],
        [receiptLine()],
        [],
        [{ priceTolerancePct: new Decimal('2.5') }],
    ])];
    const queryRaw = vi.fn(async () => {
        events.push(`query-${queryRaw.mock.calls.length}`);
        return results.shift() ?? [];
    });
    const executeRaw = vi.fn(async () => {
        events.push('item-update');
        return 1;
    });
    const allocationCreateMany = vi.fn(async () => {
        events.push('allocations');
        return { count: 1 };
    });
    const exceptionCreateMany = vi.fn(async () => {
        events.push('exceptions');
        return { count: 1 };
    });
    const purchaseUpdate = vi.fn(async () => {
        events.push('purchase-update');
        return { count: 1 };
    });
    const auditCreate = vi.fn(async () => {
        events.push('audit');
        return { id: 'audit-1' };
    });
    const tx = {
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        purchaseMatchAllocation: { createMany: allocationCreateMany },
        purchaseMatchException: { createMany: exceptionCreateMany },
        purchase: { updateMany: purchaseUpdate },
        auditLog: { create: auditCreate },
    } as unknown as Prisma.TransactionClient;
    return {
        tx,
        events,
        mocks: {
            queryRaw,
            executeRaw,
            allocationCreateMany,
            exceptionCreateMany,
            purchaseUpdate,
            auditCreate,
        },
    };
};

const expectMatchError = async (
    promise: Promise<unknown>,
    code: string,
): Promise<ProcurementMatchError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(ProcurementMatchError);
        expect((error as ProcurementMatchError).code).toBe(code);
        return error as ProcurementMatchError;
    }
    throw new Error('Se esperaba ProcurementMatchError');
};

describe('executeProcurementMatch', () => {
    it('bloquea Purchase y OC, persiste snapshots exactos, FIFO y auditoría atómica', async () => {
        const { tx, events, mocks } = matchingTx();
        const result = await executeProcurementMatch({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
        });

        expect(result).toMatchObject({
            purchaseId: 'purchase-1',
            matchStatus: 'MATCHED',
            paymentHold: false,
            priceTolerancePct: '2.500000',
            allocationCount: 1,
            exceptionCount: 0,
        });
        const purchaseLockCall = mocks.queryRaw.mock.calls.at(0);
        const orderLockCall = mocks.queryRaw.mock.calls.at(1);
        expect(purchaseLockCall).toBeDefined();
        expect(orderLockCall).toBeDefined();
        const purchaseLock = purchaseLockCall?.at(0) as { strings: string[]; values: unknown[] };
        const orderLock = orderLockCall?.at(0) as { strings: string[]; values: unknown[] };
        expect(purchaseLock.strings.join(' ')).toContain('FROM `Purchase`');
        expect(purchaseLock.strings.join(' ')).toContain('AND p.`tenantId` =');
        expect(purchaseLock.values).toEqual(['purchase-1', 'tenant-1']);
        expect(orderLock.strings.join(' ')).toContain('FROM `PurchaseOrder`');
        expect(orderLock.values).toEqual(['po-1', 'tenant-1']);
        expect(events.indexOf('query-2')).toBeGreaterThan(events.indexOf('query-1'));
        expect(events.indexOf('allocations')).toBeGreaterThan(events.indexOf('query-6'));
        expect(events.at(-1)).toBe('audit');
        expect(mocks.allocationCreateMany).toHaveBeenCalledWith({
            data: [{
                tenantId: 'tenant-1',
                purchaseItemId: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                goodsReceiptItemId: 'receipt-line-1',
                source: 'FORMAL_RECEIPT',
                quantityExact: '2.0000',
                expectedUnitCostExact: '10.000000',
                actualUnitCostExact: '10.000000',
                priceVarianceExact: '0.0000',
            }],
        });
        expect(mocks.exceptionCreateMany).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).toHaveBeenCalledWith({
            where: { id: 'purchase-1', tenantId: 'tenant-1', matchStatus: 'NOT_REQUIRED' },
            data: { matchStatus: 'MATCHED', paymentHold: false },
        });
    });

    it('mantiene costos exactos 18,6 y crea hold/excepción de precio en CREDIT', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ unitCostExact: new Decimal('10.250001') })],
            [orderLine()],
            [receiptLine()],
            [],
            [{ priceTolerancePct: new Decimal('2.5') }],
        ]);

        const result = await executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        });

        expect(result.matchStatus).toBe('EXCEPTION');
        expect(result.paymentHold).toBe(true);
        expect(mocks.exceptionCreateMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                type: 'PRICE_VARIANCE',
                expectedValueExact: '10.000000',
                actualValueExact: '10.250001',
                varianceExact: '0.250001',
                toleranceExact: '0.250000',
            })],
        });
        expect(mocks.purchaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: { matchStatus: 'EXCEPTION', paymentHold: true },
        }));
    });

    it('rechaza CASH fuera de tolerancia antes de allocations, dinero o audit', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow({ paymentMethod: 'CASH' })],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ unitCostExact: new Decimal('10.250001') })],
            [orderLine()],
            [receiptLine()],
            [],
            [{ priceTolerancePct: new Decimal('2.5') }],
        ]);

        await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        }), 'CASH_PRICE_VARIANCE_REQUIRES_RESOLUTION');
        expect(mocks.executeRaw).not.toHaveBeenCalled();
        expect(mocks.allocationCreateMany).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('no permite que una asignación concurrente consuma de nuevo lo recibido', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ quantityExact: new Decimal('2') })],
            [orderLine()],
            [receiptLine()],
            [{
                goodsReceiptItemId: 'receipt-line-1',
                purchaseOrderItemId: 'po-line-1',
                source: 'FORMAL_RECEIPT',
                quantityExact: new Decimal('4'),
            }],
            [{ priceTolerancePct: new Decimal('2.5') }],
        ]);

        const error = await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        }), 'INVOICE_EXCEEDS_ACCEPTED_QUANTITY');
        expect(error.details).toMatchObject({ alreadyAllocatedQuantity: '4.0000' });
        expect(mocks.executeRaw).not.toHaveBeenCalled();
        expect(mocks.allocationCreateMany).not.toHaveBeenCalled();
    });

    it('falla cerrado si dos líneas de la OC comparten SKU y falta identidad explícita', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ purchaseOrderItemId: null })],
            [
                orderLine({ id: 'po-line-a' }),
                orderLine({ id: 'po-line-b' }),
            ],
        ]);

        await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        }), 'AMBIGUOUS_PURCHASE_ORDER_LINE');
        expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
        expect(mocks.executeRaw).not.toHaveBeenCalled();
    });

    it('materializa fallback inequívoco solo para recepción formal', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ purchaseOrderItemId: null })],
            [orderLine()],
            [receiptLine()],
            [],
            [{ priceTolerancePct: new Decimal('0') }],
        ]);

        const result = await executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        });
        expect(result.matchStatus).toBe('MATCHED');
        expect(mocks.executeRaw).toHaveBeenCalledOnce();
        expect(result.plan.lines[0].purchaseOrderItemId).toBe('po-line-1');
    });

    it('retiene CREDIT histórico con allocation LEGACY_PROJECTION y excepción durable', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine()],
            [orderLine()],
            [],
            [],
            [{ priceTolerancePct: new Decimal('0') }],
        ]);

        const result = await executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        });
        expect(result.matchStatus).toBe('EXCEPTION');
        expect(result.exceptionCount).toBe(1);
        expect(mocks.allocationCreateMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                goodsReceiptItemId: null,
                source: 'LEGACY_PROJECTION',
            })],
        });
        expect(mocks.exceptionCreateMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                type: 'LEGACY_RECEIPT_TRACE',
                status: 'OPEN',
            })],
        });
    });

    it('exige PO line explícita para proyectar una recepción histórica', async () => {
        const { tx, mocks } = matchingTx([
            [purchaseRow()],
            [{ id: 'po-1', supplierId: 'supplier-1' }],
            [invoiceLine({ purchaseOrderItemId: null })],
            [orderLine()],
            [],
            [],
        ]);

        await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        }), 'LEGACY_RECEIPT_REQUIRES_ORDER_LINE_ID');
        expect(mocks.executeRaw).not.toHaveBeenCalled();
    });

    it('compra directa permanece NOT_REQUIRED y solo toma el lock tenant-scoped', async () => {
        const { tx, mocks } = matchingTx([[purchaseRow({ purchaseOrderId: null })]]);
        const result = await executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        });
        expect(result.matchStatus).toBe('NOT_REQUIRED');
        expect(mocks.queryRaw).toHaveBeenCalledOnce();
        expect(mocks.executeRaw).not.toHaveBeenCalled();
    });

    it('una compra ajena se comporta como inexistente', async () => {
        const { tx, mocks } = matchingTx([[]]);
        const error = await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-2', userId: 'user-2', purchaseId: 'purchase-1',
        }), 'PURCHASE_NOT_FOUND');
        expect(error.httpStatus).toBe(404);
        const sqlCall = mocks.queryRaw.mock.calls.at(0);
        expect(sqlCall).toBeDefined();
        const sql = sqlCall?.at(0) as { values: unknown[] };
        expect(sql.values).toEqual(['purchase-1', 'tenant-2']);
    });

    it('rechaza un documento no posteado antes de tocar la OC o persistir efectos', async () => {
        const { tx, mocks } = matchingTx([[purchaseRow({ documentStatus: 'DRAFT' })]]);
        await expectMatchError(executeProcurementMatch({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1',
        }), 'PURCHASE_DOCUMENT_NOT_POSTED');
        expect(mocks.queryRaw).toHaveBeenCalledOnce();
        expect(mocks.executeRaw).not.toHaveBeenCalled();
        expect(mocks.allocationCreateMany).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });
});

describe('consultas de conciliación', () => {
    it('lista solo documentos POSTED del tenant autenticado', async () => {
        const findMany = vi.fn().mockResolvedValue([{
            id: 'purchase-1',
            invoiceNumber: 'FAC-1',
            date: NOW,
            postingDate: NOW,
            documentStatus: 'POSTED',
            matchStatus: 'EXCEPTION',
            paymentHold: true,
            total: new Decimal('11.50'),
            balanceDue: new Decimal('11.50'),
            supplier: { id: 'supplier-1', name: 'Proveedor' },
            purchaseOrder: { id: 'po-1', orderNumber: 'OC-1' },
            items: [{
                quantity: 1,
                quantityExact: new Decimal('1'),
                unitCost: new Decimal('10.13'),
                unitCostExact: new Decimal('10.125000'),
                expectedUnitCostExact: new Decimal('10.000000'),
            }],
            _count: { matchExceptions: 1 },
        }]);
        const db = { purchase: { findMany } } as unknown as Parameters<typeof listProcurementMatches>[0];

        const result = await listProcurementMatches(db, 'tenant-auth', {
            status: 'EXCEPTION', paymentHold: true, limit: 25,
        });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                tenantId: 'tenant-auth',
                documentStatus: 'POSTED',
                matchStatus: 'EXCEPTION',
                paymentHold: true,
            },
            take: 26,
        }));
        expect(result.data[0]).toMatchObject({
            id: 'purchase-1',
            documentStatus: 'POSTED',
            varianceAmount: '0.13',
            openExceptionCount: 1,
        });
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({
                items: {
                    select: {
                        quantity: true,
                        quantityExact: true,
                        unitCost: true,
                        unitCostExact: true,
                        expectedUnitCostExact: true,
                    },
                },
            }),
        }));
    });

    it('detalle trata como inexistente cualquier documento no POSTED o de otro tenant', async () => {
        const findFirst = vi.fn().mockResolvedValue(null);
        const db = { purchase: { findFirst } } as unknown as Parameters<typeof getProcurementMatchDetail>[0];

        await expectMatchError(
            getProcurementMatchDetail(db, 'tenant-auth', 'purchase-1'),
            'PURCHASE_NOT_FOUND',
        );
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 'purchase-1',
                tenantId: 'tenant-auth',
                documentStatus: 'POSTED',
            },
        }));
    });

    it('calcula totales del detalle por línea y no por cada allocation', async () => {
        const findFirst = vi.fn().mockResolvedValue({
            id: 'purchase-1',
            invoiceNumber: 'FAC-SPLIT',
            date: NOW,
            postingDate: NOW,
            documentStatus: 'POSTED',
            matchStatus: 'MATCHED',
            paymentHold: false,
            total: new Decimal('2.31'),
            balanceDue: new Decimal('2.31'),
            matchResolvedBy: null,
            matchResolvedAt: null,
            matchResolutionNote: null,
            supplier: { id: 'supplier-1', name: 'Proveedor' },
            purchaseOrder: { id: 'po-1', orderNumber: 'OC-1' },
            items: [{
                id: 'invoice-line-1',
                productId: 'product-1',
                productName: 'Producto',
                purchaseOrderItemId: 'po-line-1',
                quantity: 2,
                quantityExact: new Decimal('2'),
                unitCost: new Decimal('1.01'),
                unitCostExact: new Decimal('1.005000'),
                expectedUnitCostExact: new Decimal('1.005000'),
                priceVarianceExact: new Decimal('0.0000'),
            }],
        });
        const allocationFindMany = vi.fn().mockResolvedValue([
            {
                id: 'allocation-1', purchaseItemId: 'invoice-line-1',
                goodsReceiptItemId: 'receipt-1', source: 'FORMAL_RECEIPT',
                purchaseOrderItemId: 'po-line-1', quantityExact: new Decimal('1'),
                expectedUnitCostExact: new Decimal('1.005000'),
                actualUnitCostExact: new Decimal('1.005000'),
                priceVarianceExact: new Decimal('0.0000'), createdAt: NOW,
            },
            {
                id: 'allocation-2', purchaseItemId: 'invoice-line-1',
                goodsReceiptItemId: 'receipt-2', source: 'FORMAL_RECEIPT',
                purchaseOrderItemId: 'po-line-1', quantityExact: new Decimal('1'),
                expectedUnitCostExact: new Decimal('1.005000'),
                actualUnitCostExact: new Decimal('1.005000'),
                priceVarianceExact: new Decimal('0.0000'), createdAt: NOW,
            },
        ]);
        const exceptionFindMany = vi.fn().mockResolvedValue([]);
        const db = {
            purchase: { findFirst },
            purchaseMatchAllocation: { findMany: allocationFindMany },
            purchaseMatchException: { findMany: exceptionFindMany },
        } as unknown as Parameters<typeof getProcurementMatchDetail>[0];

        const result = await getProcurementMatchDetail(db, 'tenant-auth', 'purchase-1');

        expect(result.lines[0].allocations).toHaveLength(2);
        expect(result.totals).toEqual({
            expectedAmount: '2.01',
            invoiceAmount: '2.01',
            varianceAmount: '0.00',
        });
    });
});

const resolutionTx = (lockedPurchase: Record<string, unknown>, options: {
    usedEvent?: unknown;
    openExceptions?: Array<{ id: string }>;
    exceptionUpdateCount?: number;
    purchaseUpdateCount?: number;
} = {}) => {
    const events: string[] = [];
    const queryRaw = vi.fn(async () => {
        events.push('purchase-lock');
        return [lockedPurchase];
    });
    const usedEventFind = vi.fn(async () => options.usedEvent ?? null);
    const openFind = vi.fn(async () => options.openExceptions ?? [{ id: 'exception-1' }]);
    const exceptionUpdate = vi.fn(async () => {
        events.push('exceptions');
        return { count: options.exceptionUpdateCount ?? 1 };
    });
    const purchaseUpdate = vi.fn(async () => {
        events.push('purchase');
        return { count: options.purchaseUpdateCount ?? 1 };
    });
    const auditCreate = vi.fn(async () => {
        events.push('audit');
        return { id: 'audit-1' };
    });
    const tx = {
        $queryRaw: queryRaw,
        purchase: { findFirst: usedEventFind, updateMany: purchaseUpdate },
        purchaseMatchException: { findMany: openFind, updateMany: exceptionUpdate },
        auditLog: { create: auditCreate },
    } as unknown as Prisma.TransactionClient;
    return {
        tx,
        events,
        mocks: { queryRaw, usedEventFind, openFind, exceptionUpdate, purchaseUpdate, auditCreate },
    };
};

describe('executeProcurementMatchResolution', () => {
    const request = { clientEventId: EVENT_ID, reason: 'Costo confirmado con el proveedor' };

    it('resuelve todas las excepciones y libera el pago con audit en la misma tx', async () => {
        const { tx, events, mocks } = resolutionTx(purchaseRow({
            matchStatus: 'EXCEPTION', paymentHold: 1,
        }));

        const result = await executeProcurementMatchResolution({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
            request,
            now: NOW,
        });

        expect(result).toEqual({
            data: {
                purchaseId: 'purchase-1',
                matchStatus: 'RESOLVED',
                paymentHold: false,
                matchResolvedBy: 'user-1',
                matchResolvedAt: NOW.toISOString(),
                matchResolutionNote: request.reason,
            },
            replay: false,
        });
        expect(events).toEqual(['purchase-lock', 'exceptions', 'purchase', 'audit']);
        expect(mocks.exceptionUpdate).toHaveBeenCalledWith({
            where: { tenantId: 'tenant-1', purchaseId: 'purchase-1', status: 'OPEN' },
            data: {
                status: 'RESOLVED',
                resolutionNote: request.reason,
                resolvedBy: 'user-1',
                resolvedAt: NOW,
            },
        });
        expect(mocks.purchaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: 'tenant-1', paymentHold: true }),
            data: expect.objectContaining({
                matchStatus: 'RESOLVED',
                paymentHold: false,
                matchResolutionClientEventId: EVENT_ID,
            }),
        }));
        expect(mocks.auditCreate).toHaveBeenCalledOnce();
    });

    it('devuelve replay exacto inmediatamente después del primer lock', async () => {
        const normalized = normalizeProcurementResolution('purchase-1', request);
        const { tx, mocks } = resolutionTx(purchaseRow({
            matchStatus: 'RESOLVED',
            paymentHold: 0,
            matchResolvedBy: 'user-1',
            matchResolvedAt: NOW,
            matchResolutionNote: request.reason,
            matchResolutionClientEventId: EVENT_ID,
            matchResolutionPayloadHash: normalized.payloadHash,
        }));

        const result = await executeProcurementMatchResolution({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1', request,
        });
        expect(result.replay).toBe(true);
        expect(mocks.usedEventFind).not.toHaveBeenCalled();
        expect(mocks.exceptionUpdate).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('rechaza el mismo UUID con payload distinto sin mutar excepciones', async () => {
        const normalized = normalizeProcurementResolution('purchase-1', request);
        const { tx, mocks } = resolutionTx(purchaseRow({
            matchStatus: 'RESOLVED',
            matchResolvedBy: 'user-1',
            matchResolvedAt: NOW,
            matchResolutionNote: request.reason,
            matchResolutionClientEventId: EVENT_ID,
            matchResolutionPayloadHash: normalized.payloadHash,
        }));

        const error = await expectMatchError(executeProcurementMatchResolution({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
            request: { ...request, reason: 'Otro motivo' },
        }), 'MATCH_RESOLUTION_IDEMPOTENCY_CONFLICT');
        expect(error.httpStatus).toBe(409);
        expect(mocks.exceptionUpdate).not.toHaveBeenCalled();
    });

    it('falla cerrado si el estado dice EXCEPTION pero no hay hallazgos abiertos', async () => {
        const { tx, mocks } = resolutionTx(purchaseRow({
            matchStatus: 'EXCEPTION', paymentHold: true,
        }), { openExceptions: [] });

        await expectMatchError(executeProcurementMatchResolution({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1', request,
        }), 'MATCH_EXCEPTION_NOT_FOUND');
        expect(mocks.exceptionUpdate).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
    });

    it('no libera el hold de una factura que dejó de estar POSTED', async () => {
        const { tx, mocks } = resolutionTx(purchaseRow({
            documentStatus: 'VOID', matchStatus: 'EXCEPTION', paymentHold: true,
        }));

        await expectMatchError(executeProcurementMatchResolution({
            tx, tenantId: 'tenant-1', userId: 'user-1', purchaseId: 'purchase-1', request,
        }), 'PURCHASE_DOCUMENT_NOT_POSTED');
        expect(mocks.usedEventFind).not.toHaveBeenCalled();
        expect(mocks.openFind).not.toHaveBeenCalled();
        expect(mocks.exceptionUpdate).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });
});
