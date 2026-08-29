import { describe, expect, it, vi } from 'vitest';
import {
    assertAggregateBatchMutationAllowed,
    assertBatchTrackingTransitionAllowed,
    assertManualBatchReplay,
    ManualBatchMovementError,
    parseManualBatchCommandClaim,
    type ManualBatchCommandClaim,
    type ManualBatchCommandType,
} from '../backend/lib/manualBatchMovements';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const validClaim = (
    commandType: ManualBatchCommandType = 'MANUAL_BATCH_CREATE',
    overrides: Partial<ManualBatchCommandClaim> = {},
): ManualBatchCommandClaim => ({
    version: 1,
    commandType,
    payloadHash: HASH_A,
    resultAuditId: HASH_B,
    movementId: 'c'.repeat(64),
    resourceId: 'batch-1',
    ...overrides,
});

const captureMovementError = (action: () => unknown): ManualBatchMovementError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(ManualBatchMovementError);
        expect((error as ManualBatchMovementError).name).toBe('ManualBatchMovementError');
        return error as ManualBatchMovementError;
    }
    throw new Error('Se esperaba ManualBatchMovementError');
};

const expectMovementError = (
    action: () => unknown,
    code: ManualBatchMovementError['code'],
    httpStatus: ManualBatchMovementError['httpStatus'],
    message: string,
): void => {
    expect(captureMovementError(action)).toMatchObject({ code, httpStatus, message });
};

describe('mutación: política manual de tracking lote+bodega', () => {
    it('conserva OFF y las dos transiciones que no cambian la política', () => {
        for (const input of [
            {
                mode: 'OFF' as const,
                currentRequiresBatchTracking: false,
                nextRequiresBatchTracking: true,
                currentStock: '9',
                hasBatchHistory: true,
            },
            {
                mode: 'SHADOW' as const,
                currentRequiresBatchTracking: false,
                nextRequiresBatchTracking: false,
                currentStock: 'not-a-decimal',
                hasBatchHistory: true,
            },
            {
                mode: 'ENFORCED' as const,
                currentRequiresBatchTracking: true,
                nextRequiresBatchTracking: true,
                currentStock: 'not-a-decimal',
                hasBatchHistory: true,
            },
        ]) {
            expect(() => assertBatchTrackingTransitionAllowed(input)).not.toThrow();
        }
    });

    it('solo bloquea la activación cuando hay stock agregado positivo', () => {
        expectMovementError(
            () => assertBatchTrackingTransitionAllowed({
                mode: 'SHADOW',
                currentRequiresBatchTracking: false,
                nextRequiresBatchTracking: true,
                currentStock: '0.0001',
                hasBatchHistory: false,
            }),
            'BATCH_SELECTION_REQUIRED',
            409,
            'No se puede activar control de lotes con stock agregado existente. Reconciliá primero lote y bodega.',
        );
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'SHADOW',
            currentRequiresBatchTracking: false,
            nextRequiresBatchTracking: true,
            currentStock: '0',
            hasBatchHistory: true,
        })).not.toThrow();
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'SHADOW',
            currentRequiresBatchTracking: true,
            nextRequiresBatchTracking: true,
            currentStock: '1',
            hasBatchHistory: false,
        })).not.toThrow();
    });

    it('bloquea la desactivación por stock o por historial, y permite el caso limpio', () => {
        for (const input of [
            { currentStock: '0.0001', hasBatchHistory: false },
            { currentStock: '0', hasBatchHistory: true },
        ]) {
            expectMovementError(
                () => assertBatchTrackingTransitionAllowed({
                    mode: 'ENFORCED',
                    currentRequiresBatchTracking: true,
                    nextRequiresBatchTracking: false,
                    ...input,
                }),
                'BATCH_TRACKING_DISABLE_FORBIDDEN',
                409,
                'No se puede desactivar control de lotes mientras exista stock o historial de lotes.',
            );
        }
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'ENFORCED',
            currentRequiresBatchTracking: true,
            nextRequiresBatchTracking: false,
            currentStock: '0',
            hasBatchHistory: false,
        })).not.toThrow();
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'ENFORCED',
            currentRequiresBatchTracking: false,
            nextRequiresBatchTracking: false,
            currentStock: '3',
            hasBatchHistory: true,
        })).not.toThrow();
    });

    it('protege exactamente el único cruce agregado que requiere lote explícito', () => {
        expectMovementError(
            () => assertAggregateBatchMutationAllowed({
                mode: 'SHADOW',
                requiresBatchTracking: true,
                delta: '-0.0001',
                hasExplicitBatch: false,
            }),
            'BATCH_SELECTION_REQUIRED',
            409,
            'Este producto controla lotes. Seleccioná un lote y una bodega para mover existencias.',
        );
        for (const input of [
            { mode: 'OFF' as const, requiresBatchTracking: true, delta: '1' },
            { mode: 'SHADOW' as const, requiresBatchTracking: false, delta: '1' },
            { mode: 'SHADOW' as const, requiresBatchTracking: true, delta: '0' },
            {
                mode: 'ENFORCED' as const,
                requiresBatchTracking: true,
                delta: '1',
                hasExplicitBatch: true,
            },
        ]) {
            expect(() => assertAggregateBatchMutationAllowed(input)).not.toThrow();
        }
    });
});

describe('mutación: claim e idempotencia manual', () => {
    it('revalúa helpers concisos y regex al cargar una instancia fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/manualBatchMovements');
        const commandId = fresh.buildManualBatchCommandId({
            tenantId: 'tenant-1',
            clientEventId: 'event-1',
            commandType: 'MANUAL_BATCH_CREATE',
        });
        expect(commandId).toBe('4ed39325a4a001844af01d140fe0abc6ed42b9bb780c0e103afec61e064f6e38');
        expect(fresh.buildManualBatchPayloadHash(
            'MANUAL_BATCH_CREATE',
            ['product-1', '1.0000', true, null],
        )).toBe('3a21c48d0421153c4b4e63876dec6b8482e3be00f67dd1d14a5c5851636882ac');
        expect(fresh.buildManualBatchRelatedId(commandId, 'RESULT'))
            .toBe('b07208deb977d99b94f6dc952235706ea325766b95e6266dfe292b1ca3abc1f2');
        expect(fresh.buildManualBatchRelatedId(commandId, 'MOVEMENT'))
            .toBe('d202cd3b61a86d55a7d17dcd5c2553fdf50cec18381cb295b2b38e2a5f7414ab');
        expect(fresh.buildManualBatchRelatedId(commandId, 'BATCH'))
            .toBe('43a33a22155dce83a44fcbc8a01426abcc7dc706a25648adc54bebb433035004');

        for (const commandType of ['MANUAL_BATCH_CREATE', 'MANUAL_BATCH_WRITEOFF'] as const) {
            expect(fresh.parseManualBatchCommandClaim(JSON.stringify(validClaim(commandType))))
                .toEqual(validClaim(commandType));
        }
        for (const badHash of [
            'a'.repeat(63),
            'a'.repeat(65),
            `x${'a'.repeat(64)}`,
            `${'a'.repeat(64)}x`,
            'A'.repeat(64),
            'g'.repeat(64),
        ]) {
            expect(() => fresh.parseManualBatchCommandClaim(JSON.stringify(validClaim(
                'MANUAL_BATCH_CREATE',
                { payloadHash: badHash },
            )))).toThrowError(expect.objectContaining({ code: 'MANUAL_BATCH_COMMAND_CORRUPT' }));
        }
        expect(() => fresh.parseManualBatchCommandClaim(JSON.stringify({
            ...validClaim(),
            payloadHash: [HASH_A],
        }))).toThrowError(expect.objectContaining({ code: 'MANUAL_BATCH_COMMAND_CORRUPT' }));
    });

    it.each([
        ['null explícito', null],
        ['JSON roto', '{malformed'],
        ['null JSON', 'null'],
        ['array', '[]'],
        ['texto', '"claim"'],
        ['número', '7'],
        ['versión incorrecta', JSON.stringify(validClaim('MANUAL_BATCH_CREATE', { version: 2 as never }))],
        ['tipo vacío', JSON.stringify({ ...validClaim(), commandType: '' })],
        ['tipo inventado', JSON.stringify({ ...validClaim(), commandType: 'MANUAL_BATCH_EDIT' })],
        ['hash payload no textual', JSON.stringify({ ...validClaim(), payloadHash: 7 })],
        ['hash payload array', JSON.stringify({ ...validClaim(), payloadHash: [HASH_A] })],
        ['hash resultado inválido', JSON.stringify({ ...validClaim(), resultAuditId: 'b'.repeat(63) })],
        ['hash movimiento inválido', JSON.stringify({ ...validClaim(), movementId: 'c'.repeat(65) })],
        ['recurso no textual', JSON.stringify({ ...validClaim(), resourceId: 7 })],
        ['recurso vacío', JSON.stringify({ ...validClaim(), resourceId: '' })],
    ])('rechaza claim corrupto: %s', (_title, details) => {
        expectMovementError(
            () => parseManualBatchCommandClaim(details),
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El registro idempotente del movimiento manual está incompleto o corrupto.',
        );
    });

    it('acepta replay exacto de ambos comandos y rechaza cada dimensión distinta', () => {
        for (const commandType of ['MANUAL_BATCH_CREATE', 'MANUAL_BATCH_WRITEOFF'] as const) {
            expect(() => assertManualBatchReplay(validClaim(commandType), {
                commandType,
                payloadHash: HASH_A,
            })).not.toThrow();
        }
        for (const expected of [
            { commandType: 'MANUAL_BATCH_WRITEOFF' as const, payloadHash: HASH_A },
            { commandType: 'MANUAL_BATCH_CREATE' as const, payloadHash: HASH_B },
        ]) {
            expectMovementError(
                () => assertManualBatchReplay(validClaim(), expected),
                'MANUAL_BATCH_IDEMPOTENCY_CONFLICT',
                409,
                'clientEventId ya fue utilizado con un movimiento de lote diferente.',
            );
        }
    });
});
