import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
    normalizeBatchWarehouseLedgerMode,
    type BatchWarehouseLedgerMode,
} from './batchWarehouseLedger.js';

const RECONCILIATION_COMMAND = 'BATCH_WAREHOUSE_RECONCILIATION' as const;

export type BatchWarehouseReadinessErrorCode =
    | 'BATCH_READINESS_INVALID_INPUT'
    | 'BATCH_READINESS_TENANT_NOT_FOUND'
    | 'BATCH_READINESS_BATCH_NOT_FOUND'
    | 'BATCH_READINESS_USER_NOT_ACTIVE'
    | 'BATCH_READINESS_MODE_NOT_RECONCILABLE'
    | 'BATCH_READINESS_WAREHOUSE_NOT_ACTIVE'
    | 'BATCH_READINESS_FINAL_STATE_INCOMPLETE'
    | 'BATCH_READINESS_TOTAL_MISMATCH'
    | 'BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH'
    | 'BATCH_READINESS_IDEMPOTENCY_CONFLICT'
    | 'BATCH_READINESS_COMMAND_CORRUPT'
    | 'BATCH_READINESS_COMMAND_INCOMPLETE'
    | 'BATCH_READINESS_CONCURRENT_WRITE';

export class BatchWarehouseReadinessError extends Error {
    constructor(
        readonly code: BatchWarehouseReadinessErrorCode,
        readonly httpStatus: 400 | 403 | 404 | 409 | 500,
        message: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'BatchWarehouseReadinessError';
    }
}

const invalidInput = (message: string): never => {
    throw new BatchWarehouseReadinessError('BATCH_READINESS_INVALID_INPUT', 400, message);
};

const normalizedIdentifier = (value: unknown, field: string): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe ser texto`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${field} no es válido`);
    }
    return normalized;
};

/** Frontera Decimal(18,4) exacta; cantidades HTTP nunca entran como Number. */
export function canonicalReadinessQuantity(
    value: unknown,
    options: { allowNegative?: boolean } = {},
): string {
    if (typeof value !== 'string') return invalidInput('La cantidad debe enviarse como texto decimal exacto');
    const source = value.trim();
    if (!source) return invalidInput('La cantidad es requerida');
    let parsed: Decimal;
    try {
        parsed = new Decimal(source);
    } catch {
        return invalidInput('La cantidad decimal no es válida');
    }
    if (!parsed.isFinite()) return invalidInput('La cantidad decimal debe ser finita');
    if (parsed.decimalPlaces() > 4) return invalidInput('La cantidad admite como máximo cuatro decimales');
    if (parsed.abs().greaterThan(new Decimal('99999999999999.9999'))) {
        return invalidInput('La cantidad excede Decimal(18,4)');
    }
    if (options.allowNegative !== true && parsed.isNegative()) {
        return invalidInput('La cantidad final no puede ser negativa');
    }
    return parsed.toFixed(4);
}

export interface BatchBalanceReadiness {
    aggregateStock: string;
    localStock: string;
    /** Positivo = falta atribuir a bodegas; negativo = bodegas sobreasignadas. */
    difference: string;
    reconciled: boolean;
}

export function calculateBatchBalanceReadiness(input: {
    aggregateStock: string;
    localStock: string;
}): BatchBalanceReadiness {
    const aggregateStock = canonicalReadinessQuantity(input.aggregateStock, { allowNegative: true });
    const localStock = canonicalReadinessQuantity(input.localStock, { allowNegative: true });
    const difference = new Decimal(aggregateStock).minus(localStock).toFixed(4);
    return {
        aggregateStock,
        localStock,
        difference,
        reconciled: new Decimal(difference).isZero(),
    };
}

export interface BatchWarehouseReadinessBlocker {
    scope: 'SHADOW' | 'ENFORCED';
    code:
        | 'MODE_MUST_BE_OFF'
        | 'MODE_MUST_BE_SHADOW'
        | 'ACTIVATION_TIMESTAMP_MISSING'
        | 'BATCH_BALANCE_MISMATCH'
        | 'PRODUCT_WAREHOUSE_STOCK_MISMATCH'
        | 'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE'
        | 'INCOMPLETE_TRACKED_SALE_ALLOCATIONS'
        | 'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS'
        | 'UNRESOLVED_SHADOW_GAPS';
    message: string;
    count?: number;
    deltaRequired?: string;
}

export interface BatchWarehouseReadinessDecision {
    mode: BatchWarehouseLedgerMode;
    canEnterShadow: boolean;
    canEnforce: boolean;
    shadowBlockers: BatchWarehouseReadinessBlocker[];
    enforcementBlockers: BatchWarehouseReadinessBlocker[];
    blockers: BatchWarehouseReadinessBlocker[];
}

const nonNegativeCount = (value: number, field: string): number => {
    if (!Number.isSafeInteger(value) || value < 0) return invalidInput(`${field} no es válido`);
    return value;
};

/**
 * Decisión fail-closed. Un SHADOW_GAP es inmutable y el schema actual no lo
 * enlaza a una reconciliación posterior, por eso siempre bloquea ENFORCED.
 */
export function evaluateBatchWarehouseReadiness(input: {
    mode: unknown;
    activatedAt: Date | null;
    mismatchedBatchCount: number;
    totalDifference: string;
    mismatchedProductWarehouseCount: number;
    mismatchedProductWarehouseDelta: string;
    legacyAllocationCount: number;
    incompleteTrackedSaleItemCount: number;
    incompleteTrackedSaleAllocationDelta: string;
    incompletePedidoBatchReservationCount: number;
    unresolvedShadowGapCount: number;
    unresolvedShadowGapDelta: string;
}): BatchWarehouseReadinessDecision {
    const mode = normalizeBatchWarehouseLedgerMode(input.mode);
    const mismatchedBatchCount = nonNegativeCount(input.mismatchedBatchCount, 'mismatchedBatchCount');
    const mismatchedProductWarehouseCount = nonNegativeCount(
        input.mismatchedProductWarehouseCount,
        'mismatchedProductWarehouseCount',
    );
    const legacyAllocationCount = nonNegativeCount(input.legacyAllocationCount, 'legacyAllocationCount');
    const incompleteTrackedSaleItemCount = nonNegativeCount(
        input.incompleteTrackedSaleItemCount,
        'incompleteTrackedSaleItemCount',
    );
    const incompletePedidoBatchReservationCount = nonNegativeCount(
        input.incompletePedidoBatchReservationCount,
        'incompletePedidoBatchReservationCount',
    );
    const unresolvedShadowGapCount = nonNegativeCount(
        input.unresolvedShadowGapCount,
        'unresolvedShadowGapCount',
    );
    const totalDifference = canonicalReadinessQuantity(input.totalDifference, { allowNegative: true });
    const mismatchedProductWarehouseDelta = canonicalReadinessQuantity(
        input.mismatchedProductWarehouseDelta,
        { allowNegative: true },
    );
    const incompleteTrackedSaleAllocationDelta = canonicalReadinessQuantity(
        input.incompleteTrackedSaleAllocationDelta,
    );
    const unresolvedShadowGapDelta = canonicalReadinessQuantity(input.unresolvedShadowGapDelta);

    const shadowBlockers: BatchWarehouseReadinessBlocker[] = [];
    if (mode !== 'OFF') {
        shadowBlockers.push({
            scope: 'SHADOW',
            code: 'MODE_MUST_BE_OFF',
            message: 'El tenant debe estar en OFF antes de entrar a SHADOW',
        });
    }

    const enforcementBlockers: BatchWarehouseReadinessBlocker[] = [];
    if (mode !== 'SHADOW') {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'MODE_MUST_BE_SHADOW',
            message: 'ENFORCED solo puede evaluarse desde SHADOW',
        });
    }
    if (mode === 'SHADOW' && input.activatedAt === null) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'ACTIVATION_TIMESTAMP_MISSING',
            message: 'SHADOW no tiene una fecha de activación verificable',
        });
    }
    if (mismatchedBatchCount > 0 || !new Decimal(totalDifference).isZero()) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'BATCH_BALANCE_MISMATCH',
            message: 'El total por bodega no coincide con ProductBatch.stock',
            count: mismatchedBatchCount,
            deltaRequired: totalDifference,
        });
    }
    if (
        mismatchedProductWarehouseCount > 0
        || !new Decimal(mismatchedProductWarehouseDelta).isZero()
    ) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
            message: 'La suma de lotes por producto y bodega no coincide con ProductStock',
            count: mismatchedProductWarehouseCount,
            deltaRequired: mismatchedProductWarehouseDelta,
        });
    }
    if (legacyAllocationCount > 0) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE',
            message: 'Existen ventas históricas sin evidencia de bodega',
            count: legacyAllocationCount,
        });
    }
    if (incompleteTrackedSaleItemCount > 0) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'INCOMPLETE_TRACKED_SALE_ALLOCATIONS',
            message: 'Existen líneas vendidas con lotes asignados por una cantidad distinta a la vendida',
            count: incompleteTrackedSaleItemCount,
            deltaRequired: incompleteTrackedSaleAllocationDelta,
        });
    }
    if (incompletePedidoBatchReservationCount > 0) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS',
            message: 'Existen reservas históricas de pedidos sin evidencia completa de lote y bodega',
            count: incompletePedidoBatchReservationCount,
        });
    }
    if (unresolvedShadowGapCount > 0) {
        enforcementBlockers.push({
            scope: 'ENFORCED',
            code: 'UNRESOLVED_SHADOW_GAPS',
            message: 'El modelo actual no puede demostrar que los SHADOW_GAP fueron resueltos',
            count: unresolvedShadowGapCount,
            deltaRequired: unresolvedShadowGapDelta,
        });
    }

    return {
        mode,
        canEnterShadow: shadowBlockers.length === 0,
        canEnforce: enforcementBlockers.length === 0,
        shadowBlockers,
        enforcementBlockers,
        blockers: [...shadowBlockers, ...enforcementBlockers],
    };
}

export interface FinalWarehouseAllocation {
    warehouseId: string;
    quantity: string;
}

export interface CanonicalBatchReconciliationCommand {
    version: 1;
    tenantId: string;
    userId: string;
    clientEventId: string;
    batchId: string;
    reason: string;
    allocations: FinalWarehouseAllocation[];
}

export function normalizeBatchReconciliationCommand(input: {
    tenantId: unknown;
    userId: unknown;
    clientEventId: unknown;
    batchId: unknown;
    reason: unknown;
    allocations: unknown;
}): CanonicalBatchReconciliationCommand {
    const clientEventId = normalizedIdentifier(input.clientEventId, 'clientEventId').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(clientEventId)) {
        return invalidInput('clientEventId debe ser UUID');
    }
    if (typeof input.reason !== 'string') return invalidInput('reason debe ser texto');
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1000 || /\u0000/u.test(reason)) {
        return invalidInput('reason debe tener entre 3 y 1000 caracteres');
    }
    if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 100) {
        return invalidInput('allocations debe contener entre 1 y 100 bodegas');
    }
    const seen = new Set<string>();
    const allocations = input.allocations.map((raw) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return invalidInput('Cada allocation debe ser un objeto');
        }
        const allocation = raw as Record<string, unknown>;
        const warehouseId = normalizedIdentifier(allocation.warehouseId, 'warehouseId');
        if (seen.has(warehouseId)) return invalidInput('No se puede repetir una bodega');
        seen.add(warehouseId);
        return {
            warehouseId,
            quantity: canonicalReadinessQuantity(allocation.quantity),
        };
    }).sort((left, right) => left.warehouseId.localeCompare(right.warehouseId));

    return {
        version: 1,
        tenantId: normalizedIdentifier(input.tenantId, 'tenantId'),
        userId: normalizedIdentifier(input.userId, 'userId'),
        clientEventId,
        batchId: normalizedIdentifier(input.batchId, 'batchId'),
        reason,
        allocations,
    };
}

export function assertFinalAllocationTotal(
    allocations: readonly FinalWarehouseAllocation[],
    aggregateStockInput: string,
): { aggregateStock: string; allocationTotal: string } {
    const aggregateStock = canonicalReadinessQuantity(aggregateStockInput, { allowNegative: true });
    const allocationTotal = allocations.reduce(
        (sum, allocation) => sum.plus(canonicalReadinessQuantity(allocation.quantity)),
        new Decimal(0),
    ).toFixed(4);
    if (!new Decimal(allocationTotal).equals(aggregateStock)) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_TOTAL_MISMATCH',
            409,
            'La suma final por bodega debe coincidir exactamente con ProductBatch.stock',
            { aggregateStock, allocationTotal, difference: new Decimal(aggregateStock).minus(allocationTotal).toFixed(4) },
        );
    }
    return { aggregateStock, allocationTotal };
}

const sha256 = (value: unknown): string =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const buildBatchReconciliationCommandId = (command: Pick<
    CanonicalBatchReconciliationCommand,
    'tenantId' | 'clientEventId'
>): string => sha256([1, RECONCILIATION_COMMAND, command.tenantId, command.clientEventId]);

export const buildBatchReconciliationResultId = (commandId: string): string =>
    sha256([1, RECONCILIATION_COMMAND, commandId, 'RESULT']);

export const buildBatchReconciliationSourceKey = (
    commandId: string,
    warehouseId: string,
): string => `batch-reconciliation:${sha256([1, commandId, warehouseId])}`;

export const buildBatchReconciliationPayloadHash = (
    command: CanonicalBatchReconciliationCommand,
): string => sha256(command);

export interface BatchReconciliationClaim {
    version: 1;
    commandType: typeof RECONCILIATION_COMMAND;
    payloadHash: string;
    resultAuditId: string;
    batchId: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
    Object(value) === value && !Array.isArray(value);

const sha256Value = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function parseBatchReconciliationClaim(details: string | null): BatchReconciliationClaim {
    let parsed: unknown = null;
    try {
        // El cast es solo para TypeScript: JSON.parse(null) produce JSON null,
        // que la validación fail-closed rechaza como claim corrupto.
        parsed = JSON.parse(details as string);
    } catch {
        // Un JSON inválido conserva el sentinel fail-closed.
    }
    if (
        !record(parsed)
        || parsed.version !== 1
        || parsed.commandType !== RECONCILIATION_COMMAND
        || !sha256Value(parsed.payloadHash)
        || !sha256Value(parsed.resultAuditId)
        || typeof parsed.batchId !== 'string'
        || !parsed.batchId
    ) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            'El comando idempotente de reconciliación está corrupto',
        );
    }
    return parsed as unknown as BatchReconciliationClaim;
}

export function assertBatchReconciliationReplay(
    claim: BatchReconciliationClaim,
    expected: { payloadHash: string; batchId: string },
): void {
    if (claim.payloadHash !== expected.payloadHash || claim.batchId !== expected.batchId) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_IDEMPOTENCY_CONFLICT',
            409,
            'clientEventId ya fue usado con otra reconciliación de lotes',
        );
    }
}

export interface BatchReconciliationStoredResult {
    version: 1;
    commandId: string;
    payloadHash: string;
    response: {
        commandId: string;
        batchId: string;
        productId: string;
        modeObserved: 'OFF' | 'SHADOW';
        aggregateStock: string;
        allocationTotal: string;
        allocations: Array<{
            warehouseId: string;
            before: string;
            after: string;
            delta: string;
            ledgerStatus: 'APPLIED' | 'UNCHANGED';
        }>;
    };
}

const incompleteStoredResult = (): never => {
    throw new BatchWarehouseReadinessError(
        'BATCH_READINESS_COMMAND_INCOMPLETE',
        500,
        'El resultado idempotente de reconciliación está incompleto',
    );
};

const parseStoredIdentifier = (value: unknown): string => {
    const normalized = (value as string).trim();
    if (
        normalized.length === 0
        || normalized.length > 191
        || /[\u0000-\u001f\u007f]/u.test(normalized)
        || value !== normalized
    ) {
        return incompleteStoredResult();
    }
    return normalized;
};

const parseStoredAllocation = (
    value: unknown,
): BatchReconciliationStoredResult['response']['allocations'][number] => {
    const stored = Object(value) as Record<string, unknown>;
    const ledgerStatus = stored.ledgerStatus;
    if (ledgerStatus !== 'APPLIED' && ledgerStatus !== 'UNCHANGED') {
        return incompleteStoredResult();
    }
    const warehouseId = parseStoredIdentifier(stored.warehouseId);
    const before = canonicalReadinessQuantity(stored.before);
    const after = canonicalReadinessQuantity(stored.after);
    const delta = canonicalReadinessQuantity(stored.delta, { allowNegative: true });
    if (
        stored.before !== before
        || stored.after !== after
        || stored.delta !== delta
        || !new Decimal(after).minus(before).equals(delta)
        || (ledgerStatus === 'UNCHANGED' && !new Decimal(delta).isZero())
        || (ledgerStatus === 'APPLIED' && new Decimal(delta).isZero())
    ) {
        return incompleteStoredResult();
    }
    return {
        warehouseId,
        before,
        after,
        delta,
        ledgerStatus,
    };
};

const parseStoredResponse = (
    value: unknown,
    expected: { commandId: string; batchId: string },
): BatchReconciliationStoredResult['response'] => {
    if (
        !record(value)
        || value.commandId !== expected.commandId
        || value.batchId !== expected.batchId
    ) {
        return incompleteStoredResult();
    }
    const modeObserved = value.modeObserved;
    if (modeObserved !== 'OFF' && modeObserved !== 'SHADOW') {
        return incompleteStoredResult();
    }
    if (!Array.isArray(value.allocations) || value.allocations.length < 1 || value.allocations.length > 100) {
        return incompleteStoredResult();
    }
    try {
        const productId = parseStoredIdentifier(value.productId);
        const aggregateStock = canonicalReadinessQuantity(value.aggregateStock);
        const allocationTotal = canonicalReadinessQuantity(value.allocationTotal);
        const allocations = value.allocations.map(parseStoredAllocation);
        if (
            value.aggregateStock !== aggregateStock
            || value.allocationTotal !== allocationTotal
        ) {
            return incompleteStoredResult();
        }
        let previousWarehouseId: string | null = null;
        let finalTotal = new Decimal(0);
        for (const allocation of allocations) {
            if (previousWarehouseId !== null
                && previousWarehouseId.localeCompare(allocation.warehouseId) >= 0) {
                return incompleteStoredResult();
            }
            previousWarehouseId = allocation.warehouseId;
            finalTotal = finalTotal.plus(allocation.after);
        }
        if (!finalTotal.equals(allocationTotal) || !new Decimal(allocationTotal).equals(aggregateStock)) {
            return incompleteStoredResult();
        }
        return {
            commandId: expected.commandId,
            batchId: expected.batchId,
            productId,
            modeObserved,
            aggregateStock,
            allocationTotal,
            allocations,
        };
    } catch {
        return incompleteStoredResult();
    }
};

export function parseBatchReconciliationResult(
    details: string | null,
    expected: { commandId: string; payloadHash: string; batchId: string },
): BatchReconciliationStoredResult {
    let parsed: unknown = null;
    try {
        // El cast es solo para TypeScript: JSON.parse(null) produce JSON null,
        // que la validación fail-closed rechaza como resultado incompleto.
        parsed = JSON.parse(details as string);
    } catch {
        // Un JSON inválido conserva el sentinel fail-closed.
    }
    if (
        !record(parsed)
        || parsed.version !== 1
        || parsed.commandId !== expected.commandId
        || parsed.payloadHash !== expected.payloadHash
        || !record(parsed.response)
    ) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'El resultado idempotente de reconciliación está incompleto',
        );
    }
    return {
        version: 1,
        commandId: expected.commandId,
        payloadHash: expected.payloadHash,
        response: parseStoredResponse(parsed.response, expected),
    };
}

export { RECONCILIATION_COMMAND };
