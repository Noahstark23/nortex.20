import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledgerMocks = vi.hoisted(() => ({
    applyBatchWarehouseDelta: vi.fn(),
}));

vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));
vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    applyBatchWarehouseDelta: ledgerMocks.applyBatchWarehouseDelta,
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
    BatchWarehouseReadinessError,
    createBatchWarehouseReadinessService,
} from '../backend/services/batchWarehouseReadinessService';
import {
    buildBatchReconciliationCommandId,
    buildBatchReconciliationPayloadHash,
    normalizeBatchReconciliationCommand,
} from '../backend/lib/batchWarehouseReadiness';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const queryText = (query: unknown): string => {
    const sql = query as { strings?: readonly string[]; sql?: string };
    return sql.strings?.join('?') ?? sql.sql ?? String(query);
};

const queryValues = (query: unknown): readonly unknown[] => {
    const sql = query as { values?: readonly unknown[] };
    return sql.values ?? [];
};

const expectReadinessError = async (
    promise: Promise<unknown>,
    code: string,
    httpStatus: number,
): Promise<BatchWarehouseReadinessError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(BatchWarehouseReadinessError);
        expect(error).toMatchObject({ code, httpStatus });
        return error as BatchWarehouseReadinessError;
    }
    throw new Error('Se esperaba BatchWarehouseReadinessError');
};

describe('BatchWarehouseReadinessService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ledgerMocks.applyBatchWarehouseDelta.mockResolvedValue({
            mode: 'SHADOW',
            status: 'APPLIED',
            applied: true,
        });
    });

    it('genera un reporte bounded, tenant-scoped y fail-closed para ENFORCED', async () => {
        const rawQueries: Array<{ text: string; values: readonly unknown[] }> = [];
        const tx = {
            tenant: {
                findFirst: vi.fn(async ({ where }: any) => (
                    where.id === 'tenant-a'
                        ? {
                            id: 'tenant-a',
                            batchWarehouseLedgerMode: 'SHADOW',
                            batchWarehouseLedgerActivatedAt: new Date('2026-08-26T00:00:00.000Z'),
                            createdAt: new Date('2026-08-01T00:00:00.000Z'),
                        }
                        : null
                )),
            },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                const values = queryValues(query);
                rawQueries.push({ text, values });
                if (text.includes('COUNT(*) AS totalBatchCount')) {
                    return [{
                        totalBatchCount: '3',
                        activeBatchCount: '2',
                        mismatchedBatchCount: '1',
                        aggregateStock: '8.0000',
                        localStock: '7.5000',
                    }];
                }
                if (text.includes('pb.id AS batchId')) {
                    return [
                        {
                            batchId: 'batch-a',
                            productId: 'product-a',
                            batchNumber: 'L-01',
                            expiryDate: new Date('2027-01-01T00:00:00.000Z'),
                            aggregateStock: '5.0000',
                            localStock: '4.5000',
                        },
                        {
                            batchId: 'batch-b',
                            productId: 'product-b',
                            batchNumber: 'L-02',
                            expiryDate: new Date('2027-02-01T00:00:00.000Z'),
                            aggregateStock: '3.0000',
                            localStock: '3.0000',
                        },
                    ];
                }
                if (text.includes('COUNT(*) AS gapCount')) {
                    return [{
                        gapCount: '1',
                        quantityDelta: '-1.0000',
                        requiredDelta: '0.2500',
                    }];
                }
                if (text.includes('COUNT(*) AS mismatchCount')) {
                    return [{
                        mismatchCount: '1',
                        requiredDelta: '0.3750',
                    }];
                }
                if (text.includes('mismatch.productId')) {
                    return [{
                        productId: 'product-history',
                        warehouseId: 'warehouse-a',
                        productStock: '2.5000',
                        lotStock: '2.1250',
                        difference: '0.3750',
                    }];
                }
                if (text.includes('COUNT(*) AS itemCount')) {
                    return [{
                        itemCount: '1',
                        requiredDelta: '0.1250',
                    }];
                }
                if (text.includes('incomplete.saleItemId')) {
                    return [{
                        saleItemId: 'sale-item-incomplete',
                        saleId: 'sale-active',
                        productId: 'product-history',
                        soldQuantity: '1.2500',
                        allocatedQuantity: '1.1250',
                        difference: '0.1250',
                    }];
                }
                if (text.includes('COUNT(*) AS reservationCount')) {
                    return [{ reservationCount: '1' }];
                }
                if (text.includes('incompleteReservation.id')) {
                    return [{
                        id: 'reservation-batch-null',
                        referenceId: 'pedido-a',
                        productId: 'product-history',
                        batchId: null,
                        warehouseId: 'warehouse-a',
                        quantity: '-1.2500',
                        date: new Date('2026-08-27T00:00:00.000Z'),
                    }];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
            saleItemBatchAllocation: {
                count: vi.fn(async ({ where }: any) => (
                    where.tenantId === 'tenant-a' && where.warehouseId === null ? 2 : 0
                )),
                findMany: vi.fn(async () => [
                    {
                        id: 'alloc-1',
                        saleItemId: 'sale-item-1',
                        batchId: 'batch-a',
                        quantity: '1.2500',
                        createdAt: new Date('2026-08-27T00:00:00.000Z'),
                    },
                ]),
            },
            productBatchLedgerEntry: {
                findMany: vi.fn(async () => [{
                    id: 'gap-1',
                    batchId: 'batch-a',
                    warehouseId: 'warehouse-a',
                    quantityDelta: '-1.0000',
                    stockBefore: '0.7500',
                    stockAfter: '0.7500',
                    sourceKey: 'sale:sale-1:batch:batch-a',
                    createdAt: new Date('2026-08-27T00:00:00.000Z'),
                }]),
            },
        };
        const database = {
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown, options?: unknown) => {
                expect(options).toEqual({
                    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
                });
                return callback(tx);
            }),
        } as unknown as PrismaClient;

        const service = createBatchWarehouseReadinessService(database);
        const report = await service.readiness(' tenant-a ', { limit: 1 });

        expect(report.pageInfo).toEqual({ limit: 1, nextCursor: 'batch-a' });
        expect(report.data).toMatchObject({
            mode: 'SHADOW',
            canEnterShadow: false,
            canEnforce: false,
            summary: {
                totalBatchCount: 3,
                activeBatchCount: 2,
                mismatchedBatchCount: 1,
                aggregateStock: '8.0000',
                localStock: '7.5000',
                difference: '0.5000',
                mismatchedProductWarehouseCount: 1,
                mismatchedProductWarehouseDelta: '0.3750',
                legacyAllocationCount: 2,
                incompleteTrackedSaleItemCount: 1,
                incompleteTrackedSaleAllocationDelta: '0.1250',
                incompletePedidoBatchReservationCount: 1,
                unresolvedShadowGapCount: 1,
                unresolvedShadowGapQuantityDelta: '-1.0000',
                unresolvedShadowGapDeltaRequired: '0.2500',
            },
            enforcementBlockers: [
                expect.objectContaining({
                    code: 'BATCH_BALANCE_MISMATCH',
                    deltaRequired: '0.5000',
                }),
                expect.objectContaining({
                    code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
                    count: 1,
                    deltaRequired: '0.3750',
                }),
                expect.objectContaining({ code: 'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE', count: 2 }),
                expect.objectContaining({
                    code: 'INCOMPLETE_TRACKED_SALE_ALLOCATIONS',
                    deltaRequired: '0.1250',
                }),
                expect.objectContaining({
                    code: 'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS',
                    count: 1,
                }),
                expect.objectContaining({ code: 'UNRESOLVED_SHADOW_GAPS', deltaRequired: '0.2500' }),
            ],
        });
        expect(report.data.batches).toEqual([{
            batchId: 'batch-a',
            productId: 'product-a',
            batchNumber: 'L-01',
            expiryDate: new Date('2027-01-01T00:00:00.000Z'),
            aggregateStock: '5.0000',
            localStock: '4.5000',
            difference: '0.5000',
            reconciled: false,
        }]);
        expect(report.data.incompleteTrackedSaleExamples).toEqual([{
            saleItemId: 'sale-item-incomplete',
            saleId: 'sale-active',
            productId: 'product-history',
            soldQuantity: '1.2500',
            allocatedQuantity: '1.1250',
            difference: '0.1250',
        }]);
        expect(report.data.productWarehouseMismatchExamples).toEqual([{
            productId: 'product-history',
            warehouseId: 'warehouse-a',
            productStock: '2.5000',
            lotStock: '2.1250',
            difference: '0.3750',
        }]);
        expect(report.data.incompletePedidoBatchReservationExamples).toEqual([expect.objectContaining({
            id: 'reservation-batch-null',
            referenceId: 'pedido-a',
            batchId: null,
            warehouseId: 'warehouse-a',
            quantity: '-1.2500',
        })]);
        expect(rawQueries).toHaveLength(9);
        for (const call of rawQueries) {
            expect(call.values).toContain('tenant-a');
        }
        expect(rawQueries[1]?.values.at(-1)).toBe(2);
        const trackedSql = rawQueries.find(call => call.text.includes('si.id AS saleItemId'));
        expect(trackedSql?.text).toContain("s.status <> 'VOIDED'");
        expect(trackedSql?.text).toContain('s.cancelledAt IS NULL');
        expect(trackedSql?.text).toContain('p.requiresBatchTracking = TRUE');
        expect(trackedSql?.text).toContain('FROM ProductBatch historicalBatch');
        const productWarehouseSql = rawQueries.find(call => call.text.includes('COUNT(*) AS mismatchCount'));
        expect(productWarehouseSql?.text).toContain('p.requiresBatchTracking = TRUE');
        expect(productWarehouseSql?.text).toContain('FROM ProductBatch historicalBatch');
        const reservationSql = rawQueries.find(call => call.text.includes('reservationCount'));
        expect(reservationSql?.text).toContain("km.referenceType = 'PEDIDO_RESERVA'");
        expect(reservationSql?.text).toContain('(km.batchId IS NULL OR km.warehouseId IS NULL)');
        expect(reservationSql?.text).toContain('p.requiresBatchTracking = TRUE');
        expect(reservationSql?.text).toContain('FROM ProductBatch historicalBatch');
        const reservationExamplesSql = rawQueries.find(call => call.text.includes('incompleteReservation.id'));
        expect(reservationExamplesSql?.values.at(-1)).toBe(10);
    });

    it('reconcilia bajo locks, exige estado final completo y hace replay exacto', async () => {
        const command = normalizeBatchReconciliationCommand({
            tenantId: 'tenant-a',
            userId: 'user-a',
            clientEventId: EVENT_ID,
            batchId: 'batch-a',
            reason: 'Conteo de cierre',
            allocations: [
                { warehouseId: 'warehouse-b', quantity: '1.9999' },
                { warehouseId: 'warehouse-a', quantity: '1.0001' },
            ],
        });
        const commandId = buildBatchReconciliationCommandId(command);
        const payloadHash = buildBatchReconciliationPayloadHash(command);
        const auditStore = new Map<string, { tenantId: string; action: string; details: string }>();
        const rawQueries: Array<{ text: string; values: readonly unknown[] }> = [];

        const tx = {
            productBatch: {
                findFirst: vi.fn(async ({ where }: any) => (
                    where.id === 'batch-a' && where.tenantId === 'tenant-a'
                        ? { id: 'batch-a', productId: 'product-a' }
                        : null
                )),
            },
            tenant: {
                findFirst: vi.fn(async ({ where }: any) => (
                    where.id === 'tenant-a' ? { batchWarehouseLedgerMode: 'OFF' } : null
                )),
            },
            user: {
                findFirst: vi.fn(async ({ where }: any) => (
                    where.id === 'user-a' && where.tenantId === 'tenant-a' && where.status === 'ACTIVE'
                        ? { id: 'user-a' }
                        : null
                )),
            },
            auditLog: {
                create: vi.fn(async ({ data }: any) => {
                    if (auditStore.has(data.id)) {
                        const error = new Error('unique');
                        (error as Error & { code: string }).code = 'P2002';
                        throw error;
                    }
                    auditStore.set(data.id, {
                        tenantId: data.tenantId,
                        action: data.action,
                        details: data.details,
                    });
                    return { id: data.id };
                }),
                findFirst: vi.fn(),
            },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                rawQueries.push({ text, values: queryValues(query) });
                if (text.includes('FROM Warehouse\n')) {
                    return [{ id: 'warehouse-a' }, { id: 'warehouse-b' }];
                }
                if (text.includes('FROM Product\n')) return [{ id: 'product-a', requiresBatchTracking: true }];
                if (text.includes('FROM ProductBatch\n')) {
                    return [{ id: 'batch-a', productId: 'product-a', aggregateStock: '3.0000' }];
                }
                if (text.includes('FROM ProductBatchWarehouseStock\n')) {
                    if (text.includes('lotStockExcludingBatch')) {
                        return [
                            { warehouseId: 'warehouse-a', productStock: '1.0001', lotStockExcludingBatch: '0.0000' },
                            { warehouseId: 'warehouse-b', productStock: '1.9999', lotStockExcludingBatch: '0.0000' },
                        ];
                    }
                    return [
                        { warehouseId: 'warehouse-a', productId: 'product-a', stock: '1.0000' },
                        { warehouseId: 'warehouse-b', productId: 'product-a', stock: '2.0000' },
                    ];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
        };
        let outerActorActive = true;
        const database = {
            user: {
                findFirst: vi.fn(async ({ where }: any) => (
                    outerActorActive
                    && where.id === 'user-a'
                    && where.tenantId === 'tenant-a'
                    && where.status === 'ACTIVE'
                        ? { id: 'user-a' }
                        : null
                )),
            },
            auditLog: {
                findFirst: vi.fn(async ({ where }: any) => {
                    const stored = auditStore.get(where.id);
                    if (!stored || stored.tenantId !== where.tenantId) return null;
                    return { action: stored.action, details: stored.details };
                }),
            },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown, options?: unknown) => {
                expect(options).toEqual({
                    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
                });
                return callback(tx);
            }),
        } as unknown as PrismaClient;

        const service = createBatchWarehouseReadinessService(database);
        const first = await service.reconcile('tenant-a', 'user-a', {
            clientEventId: EVENT_ID,
            batchId: 'batch-a',
            reason: 'Conteo de cierre',
            allocations: [
                { warehouseId: 'warehouse-b', quantity: '1.9999' },
                { warehouseId: 'warehouse-a', quantity: '1.0001' },
            ],
        });

        expect(first.replay).toBe(false);
        expect(first.data).toMatchObject({
            commandId,
            batchId: 'batch-a',
            productId: 'product-a',
            modeObserved: 'OFF',
            aggregateStock: '3.0000',
            allocationTotal: '3.0000',
            allocations: [
                {
                    warehouseId: 'warehouse-a',
                    before: '1.0000',
                    after: '1.0001',
                    delta: '0.0001',
                    ledgerStatus: 'APPLIED',
                },
                {
                    warehouseId: 'warehouse-b',
                    before: '2.0000',
                    after: '1.9999',
                    delta: '-0.0001',
                    ledgerStatus: 'APPLIED',
                },
            ],
        });
        expect(ledgerMocks.applyBatchWarehouseDelta).toHaveBeenCalledTimes(2);
        expect(ledgerMocks.applyBatchWarehouseDelta).toHaveBeenNthCalledWith(1, expect.objectContaining({
            tx,
            mode: 'SHADOW',
            tenantId: 'tenant-a',
            productId: 'product-a',
            batchId: 'batch-a',
            warehouseId: 'warehouse-a',
            delta: '0.0001',
            movementType: 'RECONCILIATION',
            referenceId: commandId,
            referenceType: 'BATCH_RECONCILIATION',
            userId: 'user-a',
            reason: 'Conteo de cierre',
            allowNegative: false,
        }));
        expect(ledgerMocks.applyBatchWarehouseDelta).toHaveBeenNthCalledWith(2, expect.objectContaining({
            warehouseId: 'warehouse-b',
            delta: '-0.0001',
        }));
        expect(rawQueries).toHaveLength(5);
        expect(rawQueries.map(call => call.text)).toEqual([
            expect.stringContaining('FROM Warehouse'),
            expect.stringContaining('FROM Product'),
            expect.stringContaining('FROM ProductBatch'),
            expect.stringContaining('FROM ProductBatchWarehouseStock'),
            expect.stringContaining('lotStockExcludingBatch'),
        ]);
        expect(auditStore.has(commandId)).toBe(true);
        expect([...auditStore.values()].map(row => row.action)).toEqual([
            'BATCH_WAREHOUSE_RECONCILIATION_COMMAND',
            'BATCH_WAREHOUSE_RECONCILED',
        ]);
        expect('update' in tx.tenant).toBe(false);

        ledgerMocks.applyBatchWarehouseDelta.mockClear();
        const replay = await service.reconcile('tenant-a', 'user-a', {
            clientEventId: EVENT_ID,
            batchId: 'batch-a',
            reason: 'Conteo de cierre',
            allocations: [
                { warehouseId: 'warehouse-a', quantity: '1.0001' },
                { warehouseId: 'warehouse-b', quantity: '1.9999' },
            ],
        });
        expect(replay.replay).toBe(true);
        expect(replay.data.commandId).toBe(commandId);
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();

        outerActorActive = false;
        await expectReadinessError(
            service.reconcile('tenant-a', 'user-a', {
                clientEventId: EVENT_ID,
                batchId: 'batch-a',
                reason: 'Conteo de cierre',
                allocations: [
                    { warehouseId: 'warehouse-a', quantity: '1.0001' },
                    { warehouseId: 'warehouse-b', quantity: '1.9999' },
                ],
            }),
            'BATCH_READINESS_USER_NOT_ACTIVE',
            403,
        );
        outerActorActive = true;

        await expectReadinessError(
            service.reconcile('tenant-a', 'user-a', {
                clientEventId: EVENT_ID,
                batchId: 'batch-a',
                reason: 'Otro motivo',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '3.0000' }],
            }),
            'BATCH_READINESS_IDEMPOTENCY_CONFLICT',
            409,
        );
    });

    it('rechaza una reconciliación que omite una bodega con saldo no cero', async () => {
        const tx = {
            productBatch: { findFirst: vi.fn(async () => ({ id: 'batch-a', productId: 'product-a' })) },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { create: vi.fn() },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                if (text.includes('FROM Warehouse\n')) return [{ id: 'warehouse-a' }];
                if (text.includes('FROM Product\n')) return [{ id: 'product-a' }];
                if (text.includes('FROM ProductBatch\n')) {
                    return [{ id: 'batch-a', productId: 'product-a', aggregateStock: '3.0000' }];
                }
                if (text.includes('FROM ProductBatchWarehouseStock\n')) {
                    return [
                        { warehouseId: 'warehouse-a', productId: 'product-a', stock: '1.0000' },
                        { warehouseId: 'warehouse-z', productId: 'product-a', stock: '2.0000' },
                    ];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
        };
        const database = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
        } as unknown as PrismaClient;

        const service = createBatchWarehouseReadinessService(database);
        const error = await expectReadinessError(
            service.reconcile('tenant-a', 'user-a', {
                clientEventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                batchId: 'batch-a',
                reason: 'Conteo parcial',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '3.0000' }],
            }),
            'BATCH_READINESS_FINAL_STATE_INCOMPLETE',
            409,
        );
        expect(error.details).toEqual({ omittedWarehouseIds: ['warehouse-z'] });
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });

    it('rechaza una reconciliación tracked que excede ProductStock al sumar otros lotes', async () => {
        const tx = {
            productBatch: { findFirst: vi.fn(async () => ({ id: 'batch-a', productId: 'product-a' })) },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { create: vi.fn() },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                if (text.includes('FROM Warehouse\n')) return [{ id: 'warehouse-a' }];
                if (text.includes('FROM Product\n')) return [{ id: 'product-a', requiresBatchTracking: true }];
                if (text.includes('FROM ProductBatch\n')) {
                    return [{ id: 'batch-a', productId: 'product-a', aggregateStock: '3.0000' }];
                }
                if (text.includes('FROM ProductBatchWarehouseStock\n')) {
                    if (text.includes('lotStockExcludingBatch')) {
                        return [{
                            warehouseId: 'warehouse-a',
                            productStock: '2.5000',
                            lotStockExcludingBatch: '0.7500',
                        }];
                    }
                    return [{ warehouseId: 'warehouse-a', productId: 'product-a', stock: '1.0000' }];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
        };
        const database = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
        } as unknown as PrismaClient;

        const error = await expectReadinessError(
            createBatchWarehouseReadinessService(database).reconcile('tenant-a', 'user-a', {
                clientEventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                batchId: 'batch-a',
                reason: 'Conteo que sobreasigna',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '3.0000' }],
            }),
            'BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH',
            409,
        );
        expect(error.details).toEqual({
            productId: 'product-a',
            mismatches: [{
                warehouseId: 'warehouse-a',
                productStock: '2.5000',
                projectedLotStock: '3.7500',
                overflow: '1.2500',
            }],
        });
        expect(tx.auditLog.create).not.toHaveBeenCalled();
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });

    it('aplica la defensa histórica aunque requiresBatchTracking siga apagado', async () => {
        const tx = {
            productBatch: { findFirst: vi.fn(async () => ({ id: 'batch-a', productId: 'product-a' })) },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { create: vi.fn() },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                if (text.includes('FROM Warehouse\n')) return [{ id: 'warehouse-a' }];
                if (text.includes('FROM Product\n')) return [{ id: 'product-a', requiresBatchTracking: false }];
                if (text.includes('FROM ProductBatch\n')) {
                    return [{ id: 'batch-a', productId: 'product-a', aggregateStock: '1.0000' }];
                }
                if (text.includes('FROM ProductBatchWarehouseStock\n')) {
                    if (text.includes('lotStockExcludingBatch')) {
                        return [{
                            warehouseId: 'warehouse-a',
                            productStock: '0.5000',
                            lotStockExcludingBatch: '0.2500',
                        }];
                    }
                    // El batch histórico aún no tiene sidecar. Su propia fila
                    // ProductBatch debe bastar para activar la defensa.
                    return [];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
        };
        const database = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
        } as unknown as PrismaClient;

        const error = await expectReadinessError(
            createBatchWarehouseReadinessService(database).reconcile('tenant-a', 'user-a', {
                clientEventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                batchId: 'batch-a',
                reason: 'Histórico sin flag',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '1.0000' }],
            }),
            'BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH',
            409,
        );
        expect(error.details).toEqual({
            productId: 'product-a',
            mismatches: [{
                warehouseId: 'warehouse-a',
                productStock: '0.5000',
                projectedLotStock: '1.2500',
                overflow: '0.7500',
            }],
        });
    });

    it('trata ProductStock ausente como cero y falla cerrado', async () => {
        const tx = {
            productBatch: { findFirst: vi.fn(async () => ({ id: 'batch-a', productId: 'product-a' })) },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { create: vi.fn() },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                if (text.includes('FROM Warehouse\n')) return [{ id: 'warehouse-a' }];
                if (text.includes('FROM Product\n')) return [{ id: 'product-a', requiresBatchTracking: true }];
                if (text.includes('FROM ProductBatch\n')) {
                    return [{ id: 'batch-a', productId: 'product-a', aggregateStock: '1.0000' }];
                }
                if (text.includes('FROM ProductBatchWarehouseStock\n')) {
                    if (text.includes('lotStockExcludingBatch')) {
                        return [];
                    }
                    return [];
                }
                throw new Error(`SQL inesperado: ${text}`);
            }),
        };
        const database = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
        } as unknown as PrismaClient;

        const error = await expectReadinessError(
            createBatchWarehouseReadinessService(database).reconcile('tenant-a', 'user-a', {
                clientEventId: '11111111-1111-4111-8111-111111111111',
                batchId: 'batch-a',
                reason: 'Sin ProductStock',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '1.0000' }],
            }),
            'BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH',
            409,
        );
        expect(error.details).toEqual({
            productId: 'product-a',
            mismatches: [{
                warehouseId: 'warehouse-a',
                productStock: '0.0000',
                projectedLotStock: '1.0000',
                overflow: '1.0000',
            }],
        });
    });

    it('bloquea y revalida toda bodega activa, incluso una allocation sin delta', async () => {
        const warehouseQueries: unknown[] = [];
        const tx = {
            productBatch: { findFirst: vi.fn(async () => ({ id: 'batch-a', productId: 'product-a' })) },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
            user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
            auditLog: { create: vi.fn() },
            $queryRaw: vi.fn(async (query: unknown) => {
                const text = queryText(query);
                if (text.includes('FROM Warehouse\n')) {
                    warehouseQueries.push(query);
                    return [];
                }
                throw new Error(`No debía continuar después de bloquear bodegas: ${text}`);
            }),
        };
        const database = {
            user: {
                findFirst: vi.fn(async ({ where }: any) => (
                    where.id === 'user-a'
                    && where.tenantId === 'tenant-a'
                    && where.status === 'ACTIVE'
                        ? { id: 'user-a' }
                        : null
                )),
            },
            auditLog: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
        } as unknown as PrismaClient;

        await expectReadinessError(
            createBatchWarehouseReadinessService(database).reconcile('tenant-a', 'user-a', {
                clientEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                batchId: 'batch-a',
                reason: 'Confirmación sin cambio',
                allocations: [{ warehouseId: 'warehouse-a', quantity: '1.0000' }],
            }),
            'BATCH_READINESS_WAREHOUSE_NOT_ACTIVE',
            404,
        );
        expect(warehouseQueries).toHaveLength(1);
        expect(queryText(warehouseQueries[0])).toContain('ORDER BY id ASC');
        expect(queryText(warehouseQueries[0])).toContain('FOR UPDATE');
        expect(queryValues(warehouseQueries[0])).toEqual(expect.arrayContaining([
            'tenant-a', 'warehouse-a',
        ]));
        expect(tx.auditLog.create).not.toHaveBeenCalled();
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });

    it('falla cerrado para ENFORCED y para un lote de otro tenant', async () => {
        const makeDatabase = (options: { batchExists: boolean; mode: string }) => {
            const tx = {
                productBatch: {
                    findFirst: vi.fn(async ({ where }: any) => (
                        options.batchExists
                        && where.id === 'batch-a'
                        && where.tenantId === 'tenant-a'
                            ? { id: 'batch-a', productId: 'product-a' }
                            : null
                    )),
                },
                tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: options.mode })) },
                user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
                auditLog: { create: vi.fn() },
                $queryRaw: vi.fn(async (query: unknown) => {
                    const text = queryText(query);
                    if (text.includes('FROM Product\n')) {
                        return [{ id: 'product-a', requiresBatchTracking: true }];
                    }
                    return [];
                }),
            };
            const database = {
                user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) },
                auditLog: { findFirst: vi.fn(async () => null) },
                $transaction: vi.fn(async (callback: (ctx: typeof tx) => unknown) => callback(tx)),
            } as unknown as PrismaClient;
            return { database, tx };
        };
        const request = {
            clientEventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            batchId: 'batch-a',
            reason: 'Conteo de control',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '1.0000' }],
        };

        const foreign = makeDatabase({ batchExists: false, mode: 'SHADOW' });
        await expectReadinessError(
            createBatchWarehouseReadinessService(foreign.database).reconcile(
                'tenant-a', 'user-a', request,
            ),
            'BATCH_READINESS_BATCH_NOT_FOUND',
            404,
        );
        expect(foreign.tx.tenant.findFirst).not.toHaveBeenCalled();

        const enforced = makeDatabase({ batchExists: true, mode: 'ENFORCED' });
        await expectReadinessError(
            createBatchWarehouseReadinessService(enforced.database).reconcile(
                'tenant-a', 'user-a', request,
            ),
            'BATCH_READINESS_MODE_NOT_RECONCILABLE',
            409,
        );
        expect(enforced.tx.$queryRaw).not.toHaveBeenCalled();
        expect(ledgerMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });
});
