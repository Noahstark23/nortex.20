import type { Prisma, PrismaClient } from '@prisma/client';
import {ManualBatchMovementError, parseManualBatchCommandClaim, assertManualBatchReplay, buildManualBatchRelatedId, type ManualBatchCommandType} from '../lib/manualBatchMovements.js';
type Database = Prisma.TransactionClient | PrismaClient;
type ManualBatchCommandResponse = Record<string, unknown>;

const manualBatchResultDetails = (raw: string | null, expected: {
    commandId: string;
    commandType: ManualBatchCommandType;
    payloadHash: string;
}): ManualBatchCommandResponse => {
    let parsed: unknown;
    try {
        parsed = raw === null ? null : JSON.parse(raw);
    } catch {
        parsed = null;
    }
    if (
        typeof parsed !== 'object'
        || parsed === null
        || Array.isArray(parsed)
        || (parsed as any).version !== 1
        || (parsed as any).commandId !== expected.commandId
        || (parsed as any).commandType !== expected.commandType
        || (parsed as any).payloadHash !== expected.payloadHash
        || typeof (parsed as any).response !== 'object'
        || (parsed as any).response === null
        || Array.isArray((parsed as any).response)
    ) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El resultado idempotente del movimiento manual está incompleto o corrupto.',
        );
    }
    return (parsed as any).response as ManualBatchCommandResponse;
};

/**
 * Relee fuera de la transacción perdedora. Un claim sin resultado nunca se
 * reejecuta: eso indicaría corrupción manual, porque ambos se confirman juntos.
 */
export const loadBatchWriteoffReplay = async (db: Database, input: {
    tenantId: string;
    commandId: string;
    commandType: ManualBatchCommandType;
    payloadHash: string;
}): Promise<ManualBatchCommandResponse | null> => {
    const command = await db.auditLog.findFirst({
        where: { id: input.commandId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!command) return null;
    if (command.action !== 'MANUAL_BATCH_COMMAND') {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El identificador idempotente colisionó con una auditoría incompatible.',
        );
    }
    const claim = parseManualBatchCommandClaim(command.details);
    assertManualBatchReplay(claim, input);
    if (
        claim.resultAuditId !== buildManualBatchRelatedId(input.commandId, 'RESULT')
        || claim.movementId !== buildManualBatchRelatedId(input.commandId, 'MOVEMENT')
    ) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'Los identificadores derivados del comando manual no coinciden.',
        );
    }
    const result = await db.auditLog.findFirst({
        where: { id: claim.resultAuditId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!result) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_INCOMPLETE',
            500,
            'El movimiento ya fue reclamado, pero su resultado inmutable no existe.',
        );
    }
    const expectedResultAction = input.commandType === 'MANUAL_BATCH_CREATE'
        ? 'PRODUCT_BATCH_ADDED'
        : 'BATCH_WRITEOFF';
    if (result.action !== expectedResultAction) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'La auditoría de resultado del movimiento manual es incompatible.',
        );
    }
    return manualBatchResultDetails(result.details, input);
};

