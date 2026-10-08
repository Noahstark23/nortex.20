import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    assertBatchReconciliationReplay,
    assertFinalAllocationTotal,
    BatchWarehouseReadinessError,
    calculateBatchBalanceReadiness,
    canonicalReadinessQuantity,
    evaluateBatchWarehouseReadiness,
    normalizeBatchReconciliationCommand,
    parseBatchReconciliationClaim,
    parseBatchReconciliationResult,
    type BatchWarehouseReadinessErrorCode,
} from '../backend/lib/batchWarehouseReadiness';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const captureReadinessError = (action: () => unknown): BatchWarehouseReadinessError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(BatchWarehouseReadinessError);
        expect((error as BatchWarehouseReadinessError).name).toBe('BatchWarehouseReadinessError');
        return error as BatchWarehouseReadinessError;
    }
    throw new Error('Se esperaba BatchWarehouseReadinessError');
};

const expectReadinessError = (
    action: () => unknown,
    code: BatchWarehouseReadinessErrorCode,
    httpStatus: number,
    message: string,
): BatchWarehouseReadinessError => {
    const error = captureReadinessError(action);
    expect(error).toMatchObject({ code, httpStatus, message });
    return error;
};

const validDecisionInput = (overrides: Record<string, unknown> = {}) => ({
    mode: 'SHADOW',
    activatedAt: new Date('2026-08-27T00:00:00.000Z'),
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
    ...overrides,
});

const validCommandInput = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    clientEventId: EVENT_ID,
    batchId: 'batch-1',
    reason: 'Conteo firmado',
    allocations: [{ warehouseId: 'warehouse-a', quantity: '3' }],
    ...overrides,
});

const validClaim = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    commandType: 'BATCH_WAREHOUSE_RECONCILIATION',
    payloadHash: HASH_A,
    resultAuditId: HASH_B,
    batchId: 'batch-1',
    ...overrides,
});

const validStoredAllocation = (overrides: Record<string, unknown> = {}) => ({
    warehouseId: 'warehouse-a',
    before: '1.0000',
    after: '3.0000',
    delta: '2.0000',
    ledgerStatus: 'APPLIED',
    ...overrides,
});

const validStored = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    commandId: HASH_A,
    payloadHash: HASH_B,
    response: {
        commandId: HASH_A,
        batchId: 'batch-1',
        productId: 'product-1',
        modeObserved: 'OFF',
        aggregateStock: '3.0000',
        allocationTotal: '3.0000',
        allocations: [validStoredAllocation()],
    },
    ...overrides,
});

const expectedStored = { commandId: HASH_A, payloadHash: HASH_B, batchId: 'batch-1' };

describe('mutación readiness: cantidades y balance exactos', () => {
    it.each([
        ['Number', 1, 'La cantidad debe enviarse como texto decimal exacto'],
        ['vacío', '   ', 'La cantidad es requerida'],
        ['sintaxis inválida', '.', 'La cantidad decimal no es válida'],
        ['NaN', 'NaN', 'La cantidad decimal debe ser finita'],
        ['Infinity', 'Infinity', 'La cantidad decimal debe ser finita'],
        ['cinco decimales', '0.00001', 'La cantidad admite como máximo cuatro decimales'],
        ['fuera de Decimal(18,4)', '100000000000000.0000', 'La cantidad excede Decimal(18,4)'],
        ['negativa', '-0.0001', 'La cantidad final no puede ser negativa'],
    ])('rechaza %s con diagnóstico estable', (_title, value, message) => {
        expectReadinessError(
            () => canonicalReadinessQuantity(value),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            message,
        );
    });

    it('acepta los bordes exactos y solo permite negativos cuando se solicita', () => {
        expect(canonicalReadinessQuantity(' 0.1 ')).toBe('0.1000');
        expect(canonicalReadinessQuantity('99999999999999.9999')).toBe('99999999999999.9999');
        expect(canonicalReadinessQuantity('-99999999999999.9999', { allowNegative: true }))
            .toBe('-99999999999999.9999');
        expect(canonicalReadinessQuantity('-0.0001', { allowNegative: true })).toBe('-0.0001');
        expect(() => canonicalReadinessQuantity('-100000000000000', { allowNegative: true }))
            .toThrowError(expect.objectContaining({ message: 'La cantidad excede Decimal(18,4)' }));
    });

    it('revalúa el máximo estático al cargar una instancia fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/batchWarehouseReadiness');
        expect(fresh.canonicalReadinessQuantity('99999999999999.9999'))
            .toBe('99999999999999.9999');
        expect(() => fresh.canonicalReadinessQuantity('100000000000000.0000'))
            .toThrowError(expect.objectContaining({
                code: 'BATCH_READINESS_INVALID_INPUT',
                message: 'La cantidad excede Decimal(18,4)',
            }));
    });

    it('calcula dirección, negativos y reconciliación sin perder cuatro decimales', () => {
        expect(calculateBatchBalanceReadiness({
            aggregateStock: '-1',
            localStock: '-2.2500',
        })).toEqual({
            aggregateStock: '-1.0000',
            localStock: '-2.2500',
            difference: '1.2500',
            reconciled: false,
        });
        expect(calculateBatchBalanceReadiness({
            aggregateStock: '-2.25',
            localStock: '-1',
        })).toEqual({
            aggregateStock: '-2.2500',
            localStock: '-1.0000',
            difference: '-1.2500',
            reconciled: false,
        });
        expect(calculateBatchBalanceReadiness({ aggregateStock: '0', localStock: '0.0000' }))
            .toEqual({
                aggregateStock: '0.0000',
                localStock: '0.0000',
                difference: '0.0000',
                reconciled: true,
            });
    });
});

describe('mutación readiness: decisión OFF/SHADOW fail-closed', () => {
    it('conserva literalmente la decisión limpia de OFF, SHADOW y ENFORCED', () => {
        expect(evaluateBatchWarehouseReadiness(validDecisionInput({ mode: 'OFF' }) as never)).toEqual({
            mode: 'OFF',
            canEnterShadow: true,
            canEnforce: false,
            shadowBlockers: [],
            enforcementBlockers: [{
                scope: 'ENFORCED',
                code: 'MODE_MUST_BE_SHADOW',
                message: 'ENFORCED solo puede evaluarse desde SHADOW',
            }],
            blockers: [{
                scope: 'ENFORCED',
                code: 'MODE_MUST_BE_SHADOW',
                message: 'ENFORCED solo puede evaluarse desde SHADOW',
            }],
        });
        expect(evaluateBatchWarehouseReadiness(validDecisionInput() as never)).toEqual({
            mode: 'SHADOW',
            canEnterShadow: false,
            canEnforce: true,
            shadowBlockers: [{
                scope: 'SHADOW',
                code: 'MODE_MUST_BE_OFF',
                message: 'El tenant debe estar en OFF antes de entrar a SHADOW',
            }],
            enforcementBlockers: [],
            blockers: [{
                scope: 'SHADOW',
                code: 'MODE_MUST_BE_OFF',
                message: 'El tenant debe estar en OFF antes de entrar a SHADOW',
            }],
        });
        const enforced = evaluateBatchWarehouseReadiness(validDecisionInput({ mode: 'ENFORCED' }) as never);
        expect(enforced).toMatchObject({
            mode: 'ENFORCED',
            canEnterShadow: false,
            canEnforce: false,
        });
        expect(enforced.blockers.map(blocker => blocker.code))
            .toEqual(['MODE_MUST_BE_OFF', 'MODE_MUST_BE_SHADOW']);
    });

    it.each([
        ['mismatchedBatchCount', NaN],
        ['mismatchedBatchCount', 0.5],
        ['mismatchedBatchCount', -1],
        ['mismatchedProductWarehouseCount', -1],
        ['legacyAllocationCount', Number.MAX_SAFE_INTEGER + 1],
        ['incompleteTrackedSaleItemCount', -1],
        ['incompletePedidoBatchReservationCount', -1],
        ['unresolvedShadowGapCount', -1],
    ])('rechaza contador inválido %s=%s', (field, value) => {
        expectReadinessError(
            () => evaluateBatchWarehouseReadiness(validDecisionInput({ [field]: value }) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            `${field} no es válido`,
        );
    });

    it('distingue por separado timestamp, conteo desbalanceado y delta desbalanceado', () => {
        const activated = evaluateBatchWarehouseReadiness(validDecisionInput({ activatedAt: null }) as never);
        expect(activated.enforcementBlockers).toEqual([{
            scope: 'ENFORCED',
            code: 'ACTIVATION_TIMESTAMP_MISSING',
            message: 'SHADOW no tiene una fecha de activación verificable',
        }]);

        const byCount = evaluateBatchWarehouseReadiness(validDecisionInput({
            mismatchedBatchCount: 1,
        }) as never);
        expect(byCount.enforcementBlockers).toEqual([{
            scope: 'ENFORCED',
            code: 'BATCH_BALANCE_MISMATCH',
            message: 'El total por bodega no coincide con ProductBatch.stock',
            count: 1,
            deltaRequired: '0.0000',
        }]);

        const byDelta = evaluateBatchWarehouseReadiness(validDecisionInput({
            totalDifference: '-0.0001',
        }) as never);
        expect(byDelta.enforcementBlockers).toEqual([{
            scope: 'ENFORCED',
            code: 'BATCH_BALANCE_MISMATCH',
            message: 'El total por bodega no coincide con ProductBatch.stock',
            count: 0,
            deltaRequired: '-0.0001',
        }]);
    });

    it('distingue conteo y delta ProductStock por producto+bodega, incluidos negativos', () => {
        const byCount = evaluateBatchWarehouseReadiness(validDecisionInput({
            mismatchedProductWarehouseCount: 2,
        }) as never);
        expect(byCount.enforcementBlockers).toEqual([{
            scope: 'ENFORCED',
            code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
            message: 'La suma de lotes por producto y bodega no coincide con ProductStock',
            count: 2,
            deltaRequired: '0.0000',
        }]);

        const byDelta = evaluateBatchWarehouseReadiness(validDecisionInput({
            mismatchedProductWarehouseDelta: '-0.3750',
        }) as never);
        expect(byDelta.enforcementBlockers).toEqual([{
            scope: 'ENFORCED',
            code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
            message: 'La suma de lotes por producto y bodega no coincide con ProductStock',
            count: 0,
            deltaRequired: '-0.3750',
        }]);
    });

    it.each([
        {
            field: 'legacyAllocationCount',
            overrides: { legacyAllocationCount: 2 },
            blocker: {
                scope: 'ENFORCED',
                code: 'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE',
                message: 'Existen ventas históricas sin evidencia de bodega',
                count: 2,
            },
        },
        {
            field: 'incompleteTrackedSaleItemCount',
            overrides: {
                incompleteTrackedSaleItemCount: 3,
                incompleteTrackedSaleAllocationDelta: '1.2500',
            },
            blocker: {
                scope: 'ENFORCED',
                code: 'INCOMPLETE_TRACKED_SALE_ALLOCATIONS',
                message: 'Existen líneas vendidas con lotes asignados por una cantidad distinta a la vendida',
                count: 3,
                deltaRequired: '1.2500',
            },
        },
        {
            field: 'incompletePedidoBatchReservationCount',
            overrides: { incompletePedidoBatchReservationCount: 4 },
            blocker: {
                scope: 'ENFORCED',
                code: 'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS',
                message: 'Existen reservas históricas de pedidos sin evidencia completa de lote y bodega',
                count: 4,
            },
        },
        {
            field: 'unresolvedShadowGapCount',
            overrides: { unresolvedShadowGapCount: 5, unresolvedShadowGapDelta: '0.7500' },
            blocker: {
                scope: 'ENFORCED',
                code: 'UNRESOLVED_SHADOW_GAPS',
                message: 'El modelo actual no puede demostrar que los SHADOW_GAP fueron resueltos',
                count: 5,
                deltaRequired: '0.7500',
            },
        },
    ])('expone solo el blocker $field con todos sus datos', ({ overrides, blocker }) => {
        const result = evaluateBatchWarehouseReadiness(validDecisionInput(overrides) as never);
        expect(result.canEnforce).toBe(false);
        expect(result.enforcementBlockers).toEqual([blocker]);
        expect(result.blockers).toEqual([...result.shadowBlockers, blocker]);
    });

    it('valida deltas aunque el conteo asociado sea cero', () => {
        expectReadinessError(
            () => evaluateBatchWarehouseReadiness(validDecisionInput({
                incompleteTrackedSaleAllocationDelta: '-0.0001',
            }) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'La cantidad final no puede ser negativa',
        );
        expectReadinessError(
            () => evaluateBatchWarehouseReadiness(validDecisionInput({
                unresolvedShadowGapDelta: '-0.0001',
            }) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'La cantidad final no puede ser negativa',
        );
    });
});

describe('mutación readiness: comando canónico', () => {
    it('normaliza todos los campos, ordena y fija versión literal', () => {
        expect(normalizeBatchReconciliationCommand(validCommandInput({
            tenantId: ' tenant-1 ',
            userId: ' user-1 ',
            clientEventId: ` ${EVENT_ID.toUpperCase()} `,
            batchId: ' batch-1 ',
            reason: ' Conteo firmado ',
            allocations: [
                { warehouseId: ' warehouse-z ', quantity: ' 2 ' },
                { warehouseId: 'warehouse-a', quantity: '1' },
            ],
        }) as never)).toEqual({
            version: 1,
            tenantId: 'tenant-1',
            userId: 'user-1',
            clientEventId: EVENT_ID,
            batchId: 'batch-1',
            reason: 'Conteo firmado',
            allocations: [
                { warehouseId: 'warehouse-a', quantity: '1.0000' },
                { warehouseId: 'warehouse-z', quantity: '2.0000' },
            ],
        });
    });

    it.each([
        ['clientEventId no textual', { clientEventId: 7 }, 'clientEventId debe ser texto'],
        ['clientEventId vacío', { clientEventId: '   ' }, 'clientEventId no es válido'],
        ['tenantId no textual', { tenantId: 7 }, 'tenantId debe ser texto'],
        ['tenantId vacío', { tenantId: '   ' }, 'tenantId no es válido'],
        ['userId largo', { userId: 'u'.repeat(192) }, 'userId no es válido'],
        ['batchId control', { batchId: 'batch\nsecret' }, 'batchId no es válido'],
        ['warehouseId no textual', { allocations: [{ warehouseId: null, quantity: '1' }] }, 'warehouseId debe ser texto'],
        ['warehouseId vacío', { allocations: [{ warehouseId: ' ', quantity: '1' }] }, 'warehouseId no es válido'],
        ['warehouseId largo', { allocations: [{ warehouseId: 'w'.repeat(192), quantity: '1' }] }, 'warehouseId no es válido'],
    ])('rechaza identificador: %s', (_title, overrides, message) => {
        expectReadinessError(
            () => normalizeBatchReconciliationCommand(validCommandInput(overrides) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            message,
        );
    });

    it('acepta exactamente 191 caracteres e identifica controles', () => {
        expect(normalizeBatchReconciliationCommand(validCommandInput({
            tenantId: 't'.repeat(191),
            userId: 'u'.repeat(191),
            batchId: 'b'.repeat(191),
            allocations: [{ warehouseId: 'w'.repeat(191), quantity: '1' }],
        }) as never)).toMatchObject({
            tenantId: 't'.repeat(191),
            userId: 'u'.repeat(191),
            batchId: 'b'.repeat(191),
            allocations: [{ warehouseId: 'w'.repeat(191), quantity: '1.0000' }],
        });
        for (const control of ['\u0000', '\u001f', '\u007f']) {
            expect(() => normalizeBatchReconciliationCommand(validCommandInput({
                tenantId: `tenant${control}`,
            }) as never)).toThrowError(expect.objectContaining({ message: 'tenantId no es válido' }));
        }
    });

    it.each([
        'retry-1',
        `x${EVENT_ID}`,
        `${EVENT_ID}x`,
        'aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa',
    ])('rechaza UUID fuera del contrato: %s', (clientEventId) => {
        expectReadinessError(
            () => normalizeBatchReconciliationCommand(validCommandInput({ clientEventId }) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'clientEventId debe ser UUID',
        );
    });

    it('revalúa regex y builders concisos en una carga fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/batchWarehouseReadiness');
        const command = fresh.normalizeBatchReconciliationCommand(validCommandInput({
            allocations: [
                { warehouseId: 'warehouse-b', quantity: '2' },
                { warehouseId: 'warehouse-a', quantity: '1' },
            ],
        }) as never);
        const commandId = fresh.buildBatchReconciliationCommandId(command);
        expect(fresh.RECONCILIATION_COMMAND).toBe('BATCH_WAREHOUSE_RECONCILIATION');
        expect(commandId).toBe('8fcbbcfcdd1e4ce081d8c14d44e5283a3986cc668a429c7ac773ed460ec1e4af');
        expect(fresh.buildBatchReconciliationResultId(commandId))
            .toBe('151da2809f186511172be016f7e45c0da9ef58f81c9f0563e4623a30d23967ee');
        expect(fresh.buildBatchReconciliationSourceKey(commandId, 'warehouse-a'))
            .toBe('batch-reconciliation:e3f040d8a26326fcd912c390fd2788b649d75105557d1ffeaa46093d0a2d72df');
        expect(fresh.buildBatchReconciliationPayloadHash(command))
            .toBe('8a6b67bae34e0b9b845051e57ae4d21d7e8f2f0d43fbed2ae7f4cd42d0383f45');
        expect(() => fresh.normalizeBatchReconciliationCommand(validCommandInput({
            clientEventId: `x${EVENT_ID}`,
        }) as never)).toThrowError(expect.objectContaining({ message: 'clientEventId debe ser UUID' }));
        expect(() => fresh.parseBatchReconciliationClaim(JSON.stringify(validClaim({
            payloadHash: [HASH_A],
        })))).toThrowError(expect.objectContaining({ code: 'BATCH_READINESS_COMMAND_CORRUPT' }));
        expect(fresh.parseBatchReconciliationClaim(JSON.stringify(validClaim())))
            .toEqual(validClaim());
        expect(fresh.parseBatchReconciliationResult(JSON.stringify(validStored()), expectedStored))
            .toEqual(validStored());
    });

    it.each([
        ['reason no textual', { reason: null }, 'reason debe ser texto'],
        ['reason corta', { reason: 'ab' }, 'reason debe tener entre 3 y 1000 caracteres'],
        ['reason larga', { reason: 'r'.repeat(1001) }, 'reason debe tener entre 3 y 1000 caracteres'],
        ['reason con NUL', { reason: 'abc\u0000' }, 'reason debe tener entre 3 y 1000 caracteres'],
        ['allocations no array', { allocations: null }, 'allocations debe contener entre 1 y 100 bodegas'],
        ['allocations vacía', { allocations: [] }, 'allocations debe contener entre 1 y 100 bodegas'],
        ['allocation null', { allocations: [null] }, 'Cada allocation debe ser un objeto'],
        ['allocation array', { allocations: [[]] }, 'Cada allocation debe ser un objeto'],
        ['allocation texto', { allocations: ['warehouse-a'] }, 'Cada allocation debe ser un objeto'],
    ])('rechaza forma: %s', (_title, overrides, message) => {
        expectReadinessError(
            () => normalizeBatchReconciliationCommand(validCommandInput(overrides) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            message,
        );
    });

    it('protege los bordes 3/1000 de reason y 100 allocations', () => {
        for (const reason of ['abc', 'r'.repeat(1000)]) {
            expect(normalizeBatchReconciliationCommand(validCommandInput({ reason }) as never).reason)
                .toBe(reason);
        }
        const allocations = Array.from({ length: 100 }, (_, index) => ({
            warehouseId: `warehouse-${String(index).padStart(3, '0')}`,
            quantity: '0',
        }));
        expect(normalizeBatchReconciliationCommand(validCommandInput({ allocations }) as never).allocations)
            .toHaveLength(100);
        expect(() => normalizeBatchReconciliationCommand(validCommandInput({
            allocations: [...allocations, { warehouseId: 'warehouse-overflow', quantity: '0' }],
        }) as never)).toThrowError(expect.objectContaining({
            message: 'allocations debe contener entre 1 y 100 bodegas',
        }));
    });

    it('rechaza duplicados aun con espacios y conserva el mensaje', () => {
        expectReadinessError(
            () => normalizeBatchReconciliationCommand(validCommandInput({
                allocations: [
                    { warehouseId: 'warehouse-a', quantity: '1' },
                    { warehouseId: ' warehouse-a ', quantity: '2' },
                ],
            }) as never),
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'No se puede repetir una bodega',
        );
    });
});

describe('mutación readiness: total, claim y replay', () => {
    it('suma cada línea, acepta cero vacío y expone diferencia exacta', () => {
        expect(assertFinalAllocationTotal([
            { warehouseId: 'a', quantity: '0.1000' },
            { warehouseId: 'b', quantity: '0.2000' },
        ], '0.3000')).toEqual({ aggregateStock: '0.3000', allocationTotal: '0.3000' });
        expect(assertFinalAllocationTotal([], '0')).toEqual({
            aggregateStock: '0.0000',
            allocationTotal: '0.0000',
        });
        expectReadinessError(
            () => assertFinalAllocationTotal([], '-1'),
            'BATCH_READINESS_TOTAL_MISMATCH',
            409,
            'La suma final por bodega debe coincidir exactamente con ProductBatch.stock',
        );
        const error = expectReadinessError(
            () => assertFinalAllocationTotal([{ warehouseId: 'a', quantity: '1.2500' }], '2.0000'),
            'BATCH_READINESS_TOTAL_MISMATCH',
            409,
            'La suma final por bodega debe coincidir exactamente con ProductBatch.stock',
        );
        expect(error.details).toEqual({
            aggregateStock: '2.0000',
            allocationTotal: '1.2500',
            difference: '0.7500',
        });
    });

    it.each([
        ['null', null],
        ['JSON roto', '{bad'],
        ['null JSON', 'null'],
        ['array', '[]'],
        ['texto', '"claim"'],
        ['versión', JSON.stringify(validClaim({ version: 2 }))],
        ['tipo', JSON.stringify(validClaim({ commandType: 'OTHER' }))],
        ['payload corto', JSON.stringify(validClaim({ payloadHash: 'a'.repeat(63) }))],
        ['payload largo', JSON.stringify(validClaim({ payloadHash: 'a'.repeat(65) }))],
        ['payload prefijo', JSON.stringify(validClaim({ payloadHash: `x${HASH_A}` }))],
        ['payload sufijo', JSON.stringify(validClaim({ payloadHash: `${HASH_A}x` }))],
        ['payload mayúscula', JSON.stringify(validClaim({ payloadHash: 'A'.repeat(64) }))],
        ['payload array', JSON.stringify(validClaim({ payloadHash: [HASH_A] }))],
        ['resultado inválido', JSON.stringify(validClaim({ resultAuditId: HASH_C.slice(1) }))],
        ['batch no textual', JSON.stringify(validClaim({ batchId: 7 }))],
        ['batch vacío', JSON.stringify(validClaim({ batchId: '' }))],
    ])('rechaza claim corrupto: %s', (_title, details) => {
        expectReadinessError(
            () => parseBatchReconciliationClaim(details),
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            'El comando idempotente de reconciliación está corrupto',
        );
    });

    it('acepta claim exacto y rechaza payload o batch independientemente', () => {
        expect(parseBatchReconciliationClaim(JSON.stringify(validClaim()))).toEqual(validClaim());
        expect(() => assertBatchReconciliationReplay(validClaim() as never, {
            payloadHash: HASH_A,
            batchId: 'batch-1',
        })).not.toThrow();
        for (const expected of [
            { payloadHash: HASH_B, batchId: 'batch-1' },
            { payloadHash: HASH_A, batchId: 'batch-2' },
        ]) {
            expectReadinessError(
                () => assertBatchReconciliationReplay(validClaim() as never, expected),
                'BATCH_READINESS_IDEMPOTENCY_CONFLICT',
                409,
                'clientEventId ya fue usado con otra reconciliación de lotes',
            );
        }
    });
});

describe('mutación readiness: replay persistido fail-closed', () => {
    it('acepta APPLIED, UNCHANGED, delta negativo, dos modos y orden canónico', () => {
        const response = {
            commandId: HASH_A,
            batchId: 'batch-1',
            productId: 'product-1',
            modeObserved: 'SHADOW',
            aggregateStock: '3.0000',
            allocationTotal: '3.0000',
            allocations: [
                {
                    warehouseId: 'warehouse-a',
                    before: '1.0000',
                    after: '1.0000',
                    delta: '0.0000',
                    ledgerStatus: 'UNCHANGED',
                },
                {
                    warehouseId: 'warehouse-b',
                    before: '3.0000',
                    after: '2.0000',
                    delta: '-1.0000',
                    ledgerStatus: 'APPLIED',
                },
            ],
        };
        const parsed = parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored);
        expect(parsed).toEqual({
            version: 1,
            commandId: HASH_A,
            payloadHash: HASH_B,
            response,
        });
        expect(parseBatchReconciliationResult(JSON.stringify(validStored()), expectedStored)
            .response.modeObserved).toBe('OFF');
    });

    it.each([
        ['null', null],
        ['JSON roto', '{bad'],
        ['null JSON', 'null'],
        ['array', '[]'],
        ['texto', '"result"'],
        ['versión', JSON.stringify(validStored({ version: 2 }))],
        ['command id', JSON.stringify(validStored({ commandId: HASH_C }))],
        ['payload hash', JSON.stringify(validStored({ payloadHash: HASH_C }))],
        ['response null', JSON.stringify(validStored({ response: null }))],
        ['response array', JSON.stringify(validStored({ response: [] }))],
    ])('rechaza envoltura incompleta: %s', (_title, details) => {
        expectReadinessError(
            () => parseBatchReconciliationResult(details, expectedStored),
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'El resultado idempotente de reconciliación está incompleto',
        );
    });

    const invalidResponseCases: Array<[string, Record<string, unknown>]> = [
        ['commandId distinto', { commandId: HASH_C }],
        ['batchId distinto', { batchId: 'batch-2' }],
        ['modo inválido', { modeObserved: 'ENFORCED' }],
        ['allocations no array', { allocations: null }],
        ['allocations vacías', { allocations: [] }],
        ['productId no textual', { productId: 7 }],
        ['productId no canónico', { productId: ' product-1 ' }],
        ['aggregate no canónico', { aggregateStock: '3' }],
        ['allocationTotal no canónico', { allocationTotal: '3' }],
    ];

    it.each(invalidResponseCases)('rechaza respuesta: %s', (_title, responseOverrides) => {
        const base = validStored().response as Record<string, unknown>;
        expectReadinessError(
            () => parseBatchReconciliationResult(JSON.stringify(validStored({
                response: { ...base, ...responseOverrides },
            })), expectedStored),
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'El resultado idempotente de reconciliación está incompleto',
        );
    });

    it('no acepta una lista vacía aunque los totales declarados también sean cero', () => {
        const response = {
            ...(validStored().response as Record<string, unknown>),
            aggregateStock: '0.0000',
            allocationTotal: '0.0000',
            allocations: [],
        };
        expectReadinessError(
            () => parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored),
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'El resultado idempotente de reconciliación está incompleto',
        );
    });

    it('protege el borde de 100 allocations almacenadas', () => {
        const allocations = Array.from({ length: 100 }, (_, index) => ({
            warehouseId: `warehouse-${String(index).padStart(3, '0')}`,
            before: '0.0000',
            after: index === 99 ? '1.0000' : '0.0000',
            delta: index === 99 ? '1.0000' : '0.0000',
            ledgerStatus: index === 99 ? 'APPLIED' : 'UNCHANGED',
        }));
        const response = {
            ...(validStored().response as Record<string, unknown>),
            aggregateStock: '1.0000',
            allocationTotal: '1.0000',
            allocations,
        };
        expect(parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored)
            .response.allocations).toHaveLength(100);
        expect(() => parseBatchReconciliationResult(JSON.stringify(validStored({
            response: {
                ...response,
                allocations: [...allocations, {
                    warehouseId: 'warehouse-overflow',
                    before: '0.0000', after: '0.0000', delta: '0.0000', ledgerStatus: 'UNCHANGED',
                }],
            },
        })), expectedStored)).toThrowError(expect.objectContaining({
            code: 'BATCH_READINESS_COMMAND_INCOMPLETE',
        }));
    });

    it('acepta 191 caracteres canónicos y rechaza vacío, 192 o controles persistidos', () => {
        const longProductId = 'p'.repeat(191);
        const longWarehouseId = 'w'.repeat(191);
        const response = {
            ...(validStored().response as Record<string, unknown>),
            productId: longProductId,
            allocations: [validStoredAllocation({ warehouseId: longWarehouseId })],
        };
        expect(parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored)
            .response).toMatchObject({
                productId: longProductId,
                allocations: [{ warehouseId: longWarehouseId }],
            });

        for (const [field, value] of [
            ['productId', ''],
            ['productId', 'p'.repeat(192)],
            ['productId', 'product\u0000hidden'],
        ] as const) {
            expect(() => parseBatchReconciliationResult(JSON.stringify(validStored({
                response: {
                    ...(validStored().response as Record<string, unknown>),
                    [field]: value,
                },
            })), expectedStored)).toThrowError(expect.objectContaining({
                code: 'BATCH_READINESS_COMMAND_INCOMPLETE',
            }));
        }
        for (const warehouseId of ['', 'w'.repeat(192), 'warehouse\u007fhidden']) {
            expect(() => parseBatchReconciliationResult(JSON.stringify(validStored({
                response: {
                    ...(validStored().response as Record<string, unknown>),
                    allocations: [validStoredAllocation({ warehouseId })],
                },
            })), expectedStored)).toThrowError(expect.objectContaining({
                code: 'BATCH_READINESS_COMMAND_INCOMPLETE',
            }));
        }
    });

    it.each([
        ['allocation null', null],
        ['allocation texto', 'allocation'],
        ['allocation array', []],
        ['status inválido', validStoredAllocation({ ledgerStatus: 'BROKEN' })],
        ['warehouse no textual', validStoredAllocation({ warehouseId: 7 })],
        ['warehouse no canónico', validStoredAllocation({ warehouseId: ' warehouse-a ' })],
        ['before no canónico', validStoredAllocation({ before: '1' })],
        ['after no canónico', validStoredAllocation({ after: '3' })],
        ['delta no canónico', validStoredAllocation({ delta: '2' })],
        ['aritmética distinta', validStoredAllocation({ delta: '1.0000' })],
        ['UNCHANGED con delta', validStoredAllocation({ ledgerStatus: 'UNCHANGED' })],
        ['APPLIED sin delta', validStoredAllocation({
            before: '3.0000', after: '3.0000', delta: '0.0000', ledgerStatus: 'APPLIED',
        })],
    ])('rechaza allocation persistida: %s', (_title, allocation) => {
        const response = {
            ...(validStored().response as Record<string, unknown>),
            allocations: [allocation],
        };
        expectReadinessError(
            () => parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored),
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'El resultado idempotente de reconciliación está incompleto',
        );
    });

    it('rechaza bodegas duplicadas o fuera de orden', () => {
        const warehouseA = validStoredAllocation({
            warehouseId: 'warehouse-a', before: '0.0000', after: '1.0000', delta: '1.0000',
        });
        const warehouseB = validStoredAllocation({
            warehouseId: 'warehouse-b', before: '0.0000', after: '2.0000', delta: '2.0000',
        });
        for (const [allocations, total] of [
            [[warehouseA, warehouseA], '2.0000'],
            [[warehouseB, warehouseA], '3.0000'],
        ] as const) {
            const response = {
                ...(validStored().response as Record<string, unknown>),
                aggregateStock: total,
                allocationTotal: total,
                allocations,
            };
            expect(() => parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored))
                .toThrowError(expect.objectContaining({ code: 'BATCH_READINESS_COMMAND_INCOMPLETE' }));
        }
    });

    it('distingue la suma de líneas del total declarado y del agregado', () => {
        for (const responseOverrides of [
            { aggregateStock: '3.0000', allocationTotal: '3.0000' },
            { aggregateStock: '3.0000', allocationTotal: '2.0000' },
        ]) {
            const response = {
                ...(validStored().response as Record<string, unknown>),
                ...responseOverrides,
                allocations: [validStoredAllocation({
                    before: '0.0000', after: '1.0000', delta: '1.0000',
                })],
            };
            expect(() => parseBatchReconciliationResult(JSON.stringify(validStored({ response })), expectedStored))
                .toThrowError(expect.objectContaining({ code: 'BATCH_READINESS_COMMAND_INCOMPLETE' }));
        }
    });

    it('convierte fallos inesperados o de otro código al error incompleto canónico', () => {
        const sentinelDomain = new BatchWarehouseReadinessError(
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'sentinel-domain',
        );
        const toFixed = vi.spyOn(Decimal.prototype, 'toFixed').mockImplementationOnce(() => {
            throw sentinelDomain;
        });
        try {
            expectReadinessError(
                () => parseBatchReconciliationResult(JSON.stringify(validStored()), expectedStored),
                'BATCH_READINESS_COMMAND_INCOMPLETE',
                500,
                'El resultado idempotente de reconciliación está incompleto',
            );
        } finally {
            toFixed.mockRestore();
        }

        const sentinelPlain = Object.assign(new Error('sentinel-plain'), {
            code: 'BATCH_READINESS_COMMAND_INCOMPLETE',
        });
        const isFinite = vi.spyOn(Decimal.prototype, 'isFinite').mockImplementationOnce(() => {
            throw sentinelPlain;
        });
        try {
            expectReadinessError(
                () => parseBatchReconciliationResult(JSON.stringify(validStored()), expectedStored),
                'BATCH_READINESS_COMMAND_INCOMPLETE',
                500,
                'El resultado idempotente de reconciliación está incompleto',
            );
        } finally {
            isFinite.mockRestore();
        }
    });
});
