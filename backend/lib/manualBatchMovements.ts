import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { BatchWarehouseLedgerMode } from './batchWarehouseLedger.js';

export type ManualBatchCommandType = 'MANUAL_BATCH_CREATE' | 'MANUAL_BATCH_WRITEOFF';

export class ManualBatchMovementError extends Error {
    constructor(
        readonly code:
            | 'BATCH_SELECTION_REQUIRED'
            | 'BATCH_TRACKING_DISABLE_FORBIDDEN'
            | 'MANUAL_BATCH_IDEMPOTENCY_CONFLICT'
            | 'MANUAL_BATCH_COMMAND_INCOMPLETE'
            | 'MANUAL_BATCH_COMMAND_CORRUPT',
        readonly httpStatus: 409 | 500,
        message: string,
    ) {
        super(message);
        this.name = 'ManualBatchMovementError';
    }
}

/**
 * Cambiar la política también es una mutación de inventario: activar sobre
 * stock agregado crea una distribución imposible; desactivar con historial
 * deja lotes/allocations/sidecar huérfanos para ventas futuras.
 */
export function assertBatchTrackingTransitionAllowed(input: {
    mode: BatchWarehouseLedgerMode;
    currentRequiresBatchTracking: boolean;
    nextRequiresBatchTracking: boolean;
    currentStock: Decimal.Value;
    hasBatchHistory: boolean;
}): void {
    if (
        input.mode === 'OFF'
        || input.currentRequiresBatchTracking === input.nextRequiresBatchTracking
    ) return;

    const currentStock = new Decimal(input.currentStock);
    if (input.nextRequiresBatchTracking && currentStock.greaterThan(0)) {
        throw new ManualBatchMovementError(
            'BATCH_SELECTION_REQUIRED',
            409,
            'No se puede activar control de lotes con stock agregado existente. Reconciliá primero lote y bodega.',
        );
    }
    if (
        !input.nextRequiresBatchTracking
        && (currentStock.greaterThan(0) || input.hasBatchHistory)
    ) {
        throw new ManualBatchMovementError(
            'BATCH_TRACKING_DISABLE_FORBIDDEN',
            409,
            'No se puede desactivar control de lotes mientras exista stock o historial de lotes.',
        );
    }
}

/**
 * Las mutaciones agregadas no pueden inventar una distribución lote+bodega.
 * OFF conserva el comportamiento histórico; SHADOW/ENFORCED exigen que el
 * caller use un flujo que tenga un lote explícito.
 */
export function assertAggregateBatchMutationAllowed(input: {
    mode: BatchWarehouseLedgerMode;
    requiresBatchTracking: boolean;
    delta: Decimal.Value;
    hasExplicitBatch?: boolean;
}): void {
    const delta = new Decimal(input.delta);
    if (
        input.mode !== 'OFF'
        && input.requiresBatchTracking
        && !input.hasExplicitBatch
        && !delta.isZero()
    ) {
        throw new ManualBatchMovementError(
            'BATCH_SELECTION_REQUIRED',
            409,
            'Este producto controla lotes. Seleccioná un lote y una bodega para mover existencias.',
        );
    }
}

const sha256 = (parts: readonly (string | number | boolean | null)[]): string =>
    createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Clave única determinística del comando, independiente del payload. */
export const buildManualBatchCommandId = (input: {
    tenantId: string;
    clientEventId: string;
    commandType: ManualBatchCommandType;
}): string => sha256([input.tenantId, input.clientEventId, input.commandType]);

/** Hash canónico: los handlers solo pasan primitivas en un orden congelado. */
export const buildManualBatchPayloadHash = (
    commandType: ManualBatchCommandType,
    orderedPayload: readonly (string | number | boolean | null)[],
): string => sha256([1, commandType, ...orderedPayload]);

/** IDs reproducibles que permiten reconstruir la respuesta exacta del replay. */
export const buildManualBatchRelatedId = (commandId: string, kind: 'RESULT' | 'MOVEMENT' | 'BATCH'): string =>
    sha256([commandId, kind]);

export interface ManualBatchCommandClaim {
    version: 1;
    commandType: ManualBatchCommandType;
    payloadHash: string;
    resultAuditId: string;
    movementId: string;
    resourceId: string;
}

const isSha256 = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function parseManualBatchCommandClaim(details: string | null): ManualBatchCommandClaim {
    let parsed: unknown = null;
    try {
        // El cast es solo para TypeScript: JSON.parse(null) produce JSON null,
        // que la validación fail-closed de abajo rechaza como claim corrupto.
        parsed = JSON.parse(details as string);
    } catch {
        // Un JSON inválido conserva el sentinel fail-closed.
    }
    const claim = parsed as Partial<ManualBatchCommandClaim>;
    if (
        parsed === null
        || claim.version !== 1
        || (claim.commandType !== 'MANUAL_BATCH_CREATE' && claim.commandType !== 'MANUAL_BATCH_WRITEOFF')
        || !isSha256(claim.payloadHash)
        || !isSha256(claim.resultAuditId)
        || !isSha256(claim.movementId)
        || typeof claim.resourceId !== 'string'
        || claim.resourceId.length === 0
    ) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El registro idempotente del movimiento manual está incompleto o corrupto.',
        );
    }
    return claim as ManualBatchCommandClaim;
}

export function assertManualBatchReplay(
    claim: ManualBatchCommandClaim,
    expected: { commandType: ManualBatchCommandType; payloadHash: string },
): void {
    if (claim.commandType !== expected.commandType || claim.payloadHash !== expected.payloadHash) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_IDEMPOTENCY_CONFLICT',
            409,
            'clientEventId ya fue utilizado con un movimiento de lote diferente.',
        );
    }
}
