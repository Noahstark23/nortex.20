import { describe, expect, it } from 'vitest';
import {
    assertBatchReconciliationReplay,
    assertFinalAllocationTotal,
    buildBatchReconciliationCommandId,
    buildBatchReconciliationPayloadHash,
    buildBatchReconciliationResultId,
    buildBatchReconciliationSourceKey,
    calculateBatchBalanceReadiness,
    canonicalReadinessQuantity,
    evaluateBatchWarehouseReadiness,
    normalizeBatchReconciliationCommand,
    parseBatchReconciliationClaim,
    parseBatchReconciliationResult,
} from '../backend/lib/batchWarehouseReadiness';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('batch warehouse readiness engine', () => {
    it('exige cantidades exactas en texto y calcula diferencias con ancho fijo', () => {
        expect(canonicalReadinessQuantity(' 0.1 ')).toBe('0.1000');
        expect(calculateBatchBalanceReadiness({
            aggregateStock: '0.3000',
            localStock: '0.1000',
        })).toEqual({
            aggregateStock: '0.3000',
            localStock: '0.1000',
            difference: '0.2000',
            reconciled: false,
        });
        expect(calculateBatchBalanceReadiness({
            aggregateStock: '1.2500',
            localStock: '1.2500',
        }).reconciled).toBe(true);
        expect(() => canonicalReadinessQuantity(1.25)).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_INVALID_INPUT' }),
        );
        expect(() => canonicalReadinessQuantity('-0.0001')).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_INVALID_INPUT' }),
        );
        expect(() => canonicalReadinessQuantity('0.00001')).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_INVALID_INPUT' }),
        );
    });

    it('evalúa OFF y SHADOW con bloqueos fail-closed para ENFORCED', () => {
        expect(evaluateBatchWarehouseReadiness({
            mode: 'OFF',
            activatedAt: null,
            mismatchedBatchCount: 0,
            totalDifference: '0',
            mismatchedProductWarehouseCount: 0,
            mismatchedProductWarehouseDelta: '0',
            legacyAllocationCount: 0,
            incompleteTrackedSaleItemCount: 0,
            incompleteTrackedSaleAllocationDelta: '0',
            incompletePedidoBatchReservationCount: 0,
            unresolvedShadowGapCount: 0,
            unresolvedShadowGapDelta: '0',
        })).toMatchObject({
            mode: 'OFF',
            canEnterShadow: true,
            canEnforce: false,
            enforcementBlockers: [{ code: 'MODE_MUST_BE_SHADOW' }],
        });

        expect(evaluateBatchWarehouseReadiness({
            mode: 'SHADOW',
            activatedAt: new Date('2026-08-27T00:00:00.000Z'),
            mismatchedBatchCount: 0,
            totalDifference: '0.0000',
            mismatchedProductWarehouseCount: 0,
            mismatchedProductWarehouseDelta: '0.0000',
            legacyAllocationCount: 0,
            incompleteTrackedSaleItemCount: 0,
            incompleteTrackedSaleAllocationDelta: '0.0000',
            incompletePedidoBatchReservationCount: 0,
            unresolvedShadowGapCount: 0,
            unresolvedShadowGapDelta: '0.0000',
        })).toMatchObject({
            mode: 'SHADOW',
            canEnterShadow: false,
            canEnforce: true,
            shadowBlockers: [{ code: 'MODE_MUST_BE_OFF' }],
        });

        const blocked = evaluateBatchWarehouseReadiness({
            mode: 'SHADOW',
            activatedAt: null,
            mismatchedBatchCount: 2,
            totalDifference: '-1.2500',
            mismatchedProductWarehouseCount: 1,
            mismatchedProductWarehouseDelta: '0.3750',
            legacyAllocationCount: 3,
            incompleteTrackedSaleItemCount: 2,
            incompleteTrackedSaleAllocationDelta: '0.5000',
            incompletePedidoBatchReservationCount: 1,
            unresolvedShadowGapCount: 1,
            unresolvedShadowGapDelta: '0.7500',
        });
        expect(blocked.canEnforce).toBe(false);
        expect(blocked.enforcementBlockers).toEqual([
            expect.objectContaining({ code: 'ACTIVATION_TIMESTAMP_MISSING' }),
            expect.objectContaining({
                code: 'BATCH_BALANCE_MISMATCH',
                count: 2,
                deltaRequired: '-1.2500',
            }),
            expect.objectContaining({
                code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
                count: 1,
                deltaRequired: '0.3750',
            }),
            expect.objectContaining({ code: 'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE', count: 3 }),
            expect.objectContaining({
                code: 'INCOMPLETE_TRACKED_SALE_ALLOCATIONS',
                count: 2,
                deltaRequired: '0.5000',
            }),
            expect.objectContaining({
                code: 'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS',
                count: 1,
            }),
            expect.objectContaining({
                code: 'UNRESOLVED_SHADOW_GAPS',
                count: 1,
                deltaRequired: '0.7500',
            }),
        ]);

        const historicallyAmbiguous = evaluateBatchWarehouseReadiness({
            mode: 'SHADOW',
            activatedAt: new Date('2026-08-27T00:00:00.000Z'),
            mismatchedBatchCount: 0,
            totalDifference: '0.0000',
            mismatchedProductWarehouseCount: 0,
            mismatchedProductWarehouseDelta: '0.0000',
            legacyAllocationCount: 0,
            incompleteTrackedSaleItemCount: 0,
            incompleteTrackedSaleAllocationDelta: '0.0000',
            incompletePedidoBatchReservationCount: 0,
            unresolvedShadowGapCount: 1,
            unresolvedShadowGapDelta: '0.0000',
        });
        expect(historicallyAmbiguous.canEnforce).toBe(false);
        expect(historicallyAmbiguous.enforcementBlockers).toEqual([
            expect.objectContaining({ code: 'UNRESOLVED_SHADOW_GAPS', count: 1 }),
        ]);
    });

    it('normaliza el comando final, ordena bodegas y exige la suma exacta', () => {
        const command = normalizeBatchReconciliationCommand({
            tenantId: ' tenant-1 ',
            userId: ' user-1 ',
            clientEventId: EVENT_ID.toUpperCase(),
            batchId: ' batch-1 ',
            reason: ' Ajuste físico con conteo firmado ',
            allocations: [
                { warehouseId: 'warehouse-b', quantity: '1.5000' },
                { warehouseId: 'warehouse-a', quantity: '1.0000' },
            ],
        });
        expect(command).toEqual({
            version: 1,
            tenantId: 'tenant-1',
            userId: 'user-1',
            clientEventId: EVENT_ID,
            batchId: 'batch-1',
            reason: 'Ajuste físico con conteo firmado',
            allocations: [
                { warehouseId: 'warehouse-a', quantity: '1.0000' },
                { warehouseId: 'warehouse-b', quantity: '1.5000' },
            ],
        });
        expect(assertFinalAllocationTotal(command.allocations, '2.5000')).toEqual({
            aggregateStock: '2.5000',
            allocationTotal: '2.5000',
        });
        expect(() => normalizeBatchReconciliationCommand({
            tenantId: 'tenant-1',
            userId: 'user-1',
            clientEventId: EVENT_ID,
            batchId: 'batch-1',
            reason: 'Conteo',
            allocations: [
                { warehouseId: 'warehouse-a', quantity: '1.0000' },
                { warehouseId: 'warehouse-a', quantity: '1.5000' },
            ],
        })).toThrowError(expect.objectContaining({ code: 'BATCH_READINESS_INVALID_INPUT' }));
        expect(() => assertFinalAllocationTotal(command.allocations, '2.0000')).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_TOTAL_MISMATCH', httpStatus: 409 }),
        );
    });

    it('reclama idempotencia determinística y falla cerrado si el replay está corrupto', () => {
        const command = normalizeBatchReconciliationCommand({
            tenantId: 'tenant-1',
            userId: 'user-1',
            clientEventId: EVENT_ID,
            batchId: 'batch-1',
            reason: 'Conciliación manual',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '2.0000' }],
        });
        const commandId = buildBatchReconciliationCommandId(command);
        const payloadHash = buildBatchReconciliationPayloadHash(command);
        expect(commandId).toMatch(/^[a-f0-9]{64}$/u);
        expect(buildBatchReconciliationResultId(commandId)).toMatch(/^[a-f0-9]{64}$/u);
        expect(buildBatchReconciliationSourceKey(commandId, 'warehouse-a')).toMatch(
            /^batch-reconciliation:[a-f0-9]{64}$/u,
        );

        const claim = parseBatchReconciliationClaim(JSON.stringify({
            version: 1,
            commandType: 'BATCH_WAREHOUSE_RECONCILIATION',
            payloadHash,
            resultAuditId: buildBatchReconciliationResultId(commandId),
            batchId: 'batch-1',
        }));
        expect(() => assertBatchReconciliationReplay(claim, {
            payloadHash,
            batchId: 'batch-1',
        })).not.toThrow();
        expect(() => assertBatchReconciliationReplay(claim, {
            payloadHash: buildBatchReconciliationPayloadHash({
                ...command,
                reason: 'Otro motivo',
            }),
            batchId: 'batch-1',
        })).toThrowError(expect.objectContaining({
            code: 'BATCH_READINESS_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
        }));

        const stored = parseBatchReconciliationResult(JSON.stringify({
            version: 1,
            commandId,
            payloadHash,
            response: {
                commandId,
                batchId: 'batch-1',
                productId: 'product-1',
                modeObserved: 'OFF',
                aggregateStock: '2.0000',
                allocationTotal: '2.0000',
                allocations: [{
                    warehouseId: 'warehouse-a',
                    before: '1.0000',
                    after: '2.0000',
                    delta: '1.0000',
                    ledgerStatus: 'APPLIED',
                }],
            },
        }), { commandId, payloadHash, batchId: 'batch-1' });
        expect(stored.response.allocations[0]).toEqual({
            warehouseId: 'warehouse-a',
            before: '1.0000',
            after: '2.0000',
            delta: '1.0000',
            ledgerStatus: 'APPLIED',
        });

        expect(() => parseBatchReconciliationResult(JSON.stringify({
            version: 1,
            commandId,
            payloadHash,
            response: {
                commandId,
                batchId: 'batch-atacante',
                productId: 'product-1',
                modeObserved: 'OFF',
                aggregateStock: '2.0000',
                allocationTotal: '2.0000',
                allocations: [{
                    warehouseId: 'warehouse-a',
                    before: '1.0000',
                    after: '2.0000',
                    delta: '1.0000',
                    ledgerStatus: 'APPLIED',
                }],
            },
        }), { commandId, payloadHash, batchId: 'batch-1' })).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_COMMAND_INCOMPLETE', httpStatus: 500 }),
        );

        expect(() => parseBatchReconciliationResult(JSON.stringify({
            version: 1,
            commandId,
            payloadHash,
            response: {
                commandId,
                batchId: 'batch-1',
                productId: 'product-1',
                modeObserved: 'OFF',
                aggregateStock: '2.0000',
                allocationTotal: '2.0000',
                allocations: [{
                    warehouseId: 'warehouse-a',
                    before: '1.0000',
                    after: '2.0000',
                    delta: '1.0000',
                    ledgerStatus: 'BROKEN',
                }],
            },
        }), { commandId, payloadHash, batchId: 'batch-1' })).toThrowError(
            expect.objectContaining({ code: 'BATCH_READINESS_COMMAND_INCOMPLETE', httpStatus: 500 }),
        );
    });
});
