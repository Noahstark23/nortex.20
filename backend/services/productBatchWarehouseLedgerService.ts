import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertBatchWarehouseReplay,
    BatchWarehouseLedgerError,
    buildBatchWarehousePayloadHash,
    canonicalBatchWarehouseBalance,
    type BatchWarehouseDeltaIntent,
    type BatchWarehouseLedgerMode,
    normalizeBatchWarehouseDeltaIntent,
    normalizeBatchWarehouseLedgerMode,
} from '../lib/batchWarehouseLedger.js';
import prisma from '../lib/prisma.js';

type PrismaTx = Prisma.TransactionClient;

interface LockedProductBatchRow {
    id: string;
    productId: string;
}

interface LockedBatchWarehouseStockRow {
    id: string;
    productId: string;
    stock: Decimal.Value;
}

interface ExistingBatchWarehouseLedgerEntry {
    id: string;
    status: string;
    payloadHash: string;
    quantityDelta: Decimal.Value;
    stockBefore: Decimal.Value;
    stockAfter: Decimal.Value;
}

export type BatchWarehouseDeltaStatus = 'OFF' | 'APPLIED' | 'SHADOW_GAP';

export interface BatchWarehouseDeltaResult {
    /** Configuración observada ahora; `status` siempre proviene del evento inmutable. */
    mode: BatchWarehouseLedgerMode;
    status: BatchWarehouseDeltaStatus;
    applied: boolean;
    replay: boolean;
    ledgerEntryId: string | null;
    stockBefore: string | null;
    stockAfter: string | null;
    /** Faltante físico no aplicado. Solo existe para SHADOW_GAP. */
    gap: string | null;
}

export interface ApplyBatchWarehouseDeltaInput extends BatchWarehouseDeltaIntent {
    tx: PrismaTx;
    /** Modo ya resuelto una vez por documento; nunca debe venir del cliente HTTP. */
    mode?: BatchWarehouseLedgerMode;
}

export interface ExecuteBatchWarehouseDeltaInput extends BatchWarehouseDeltaIntent {
    /** Usa el singleton compartido; inyectable solo para pruebas. */
    db?: PrismaClient;
}

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const serializeStoredDecimal = (value: Decimal.Value): string =>
    canonicalBatchWarehouseBalance({ toString: () => value.toString() });

const offResult = (): BatchWarehouseDeltaResult => ({
    mode: 'OFF',
    status: 'OFF',
    applied: false,
    replay: false,
    ledgerEntryId: null,
    stockBefore: null,
    stockAfter: null,
    gap: null,
});

const replayResult = (
    mode: BatchWarehouseLedgerMode,
    existing: ExistingBatchWarehouseLedgerEntry,
    payloadHash: string,
): BatchWarehouseDeltaResult => {
    assertBatchWarehouseReplay(existing, payloadHash);
    const stockBeforeDecimal = new Decimal(existing.stockBefore.toString());
    const stockAfterDecimal = new Decimal(existing.stockAfter.toString());
    const quantityDelta = new Decimal(existing.quantityDelta.toString());
    if (existing.status === 'SHADOW_GAP') {
        const requestedAfter = stockBeforeDecimal.plus(quantityDelta);
        if (
            !quantityDelta.isNegative()
            || !requestedAfter.isNegative()
            || !stockAfterDecimal.equals(stockBeforeDecimal)
        ) {
            throw new BatchWarehouseLedgerError(
                'BATCH_WAREHOUSE_LEDGER_CORRUPT',
                500,
                'El evento SHADOW_GAP no conserva sus invariantes de saldo',
            );
        }
        return {
            mode,
            status: 'SHADOW_GAP',
            applied: false,
            replay: true,
            ledgerEntryId: existing.id,
            stockBefore: serializeStoredDecimal(existing.stockBefore),
            stockAfter: serializeStoredDecimal(existing.stockAfter),
            gap: requestedAfter.abs().toFixed(4),
        };
    }
    if (existing.status !== 'APPLIED') {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_LEDGER_CORRUPT',
            500,
            'El evento lote-bodega existente tiene un estado inválido',
        );
    }
    if (quantityDelta.isZero() || !stockBeforeDecimal.plus(quantityDelta).equals(stockAfterDecimal)) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_LEDGER_CORRUPT',
            500,
            'El evento aplicado no conserva su transición de saldo',
        );
    }
    return {
        mode,
        status: 'APPLIED',
        applied: true,
        replay: true,
        ledgerEntryId: existing.id,
        stockBefore: serializeStoredDecimal(existing.stockBefore),
        stockAfter: serializeStoredDecimal(existing.stockAfter),
        gap: null,
    };
};

const findLedgerEntry = async (
    database: Pick<PrismaTx, 'productBatchLedgerEntry'> | Pick<PrismaClient, 'productBatchLedgerEntry'>,
    tenantId: string,
    sourceKey: string,
): Promise<ExistingBatchWarehouseLedgerEntry | null> => database.productBatchLedgerEntry.findFirst({
    where: { tenantId, sourceKey },
    select: {
        id: true,
        status: true,
        payloadHash: true,
        quantityDelta: true,
        stockBefore: true,
        stockAfter: true,
    },
}) as Promise<ExistingBatchWarehouseLedgerEntry | null>;

export const resolveBatchWarehouseLedgerMode = async (
    database: Pick<PrismaTx, 'tenant'> | Pick<PrismaClient, 'tenant'>,
    tenantId: string,
): Promise<BatchWarehouseLedgerMode> => {
    const scopedTenantId = tenantId.trim();
    if (scopedTenantId.length === 0 || scopedTenantId.length > 191) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'tenantId no es válido',
        );
    }
    const tenant = await database.tenant.findFirst({
        where: { id: scopedTenantId },
        select: { batchWarehouseLedgerMode: true },
    });
    if (!tenant) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_TENANT_NOT_FOUND',
            404,
            'El negocio no existe para registrar el movimiento lote-bodega',
        );
    }
    return normalizeBatchWarehouseLedgerMode(tenant.batchWarehouseLedgerMode);
};

const lockLedgerEntry = async (
    tx: PrismaTx,
    tenantId: string,
    sourceKey: string,
): Promise<ExistingBatchWarehouseLedgerEntry | null> => {
    const rows = await tx.$queryRaw<ExistingBatchWarehouseLedgerEntry[]>(Prisma.sql`
        SELECT id, status, payloadHash, quantityDelta, stockBefore, stockAfter
        FROM \`ProductBatchLedgerEntry\`
        WHERE tenantId = ${tenantId} AND sourceKey = ${sourceKey}
        FOR UPDATE
    `);
    return rows[0] ?? null;
};

const auditDetails = (input: {
    productId: string;
    batchId: string;
    warehouseId: string;
    movementType: string;
    sourceKey: string;
    referenceId: string | null;
    referenceType: string | null;
    stockBefore: string;
    stockAfter: string;
    requestedAfter?: string;
    gap?: string;
}): string => JSON.stringify({
    productId: input.productId,
    batchId: input.batchId,
    warehouseId: input.warehouseId,
    movementType: input.movementType,
    sourceKey: input.sourceKey,
    reference: input.referenceId === null
        ? null
        : { type: input.referenceType, id: input.referenceId },
    before: { stock: input.stockBefore },
    after: { stock: input.stockAfter },
    ...(input.requestedAfter === undefined ? {} : { requestedAfter: { stock: input.requestedAfter } }),
    ...(input.gap === undefined ? {} : { gap: input.gap }),
});

/**
 * Sidecar exacto lote+bodega. El caller conserva su lock agregado de negocio;
 * este helper solo añade Product -> ProductBatch -> balance lote+bodega.
 */
export async function applyBatchWarehouseDelta({
    tx,
    mode: suppliedMode,
    ...rawIntent
}: ApplyBatchWarehouseDeltaInput): Promise<BatchWarehouseDeltaResult> {
    const intent = normalizeBatchWarehouseDeltaIntent(rawIntent);
    const payloadHash = buildBatchWarehousePayloadHash(intent);
    const mode = suppliedMode === undefined
        ? await resolveBatchWarehouseLedgerMode(tx, intent.tenantId)
        : normalizeBatchWarehouseLedgerMode(suppliedMode);
    if (mode === 'OFF') return offResult();

    const fastReplay = await findLedgerEntry(tx, intent.tenantId, intent.sourceKey);
    if (fastReplay) return replayResult(mode, fastReplay, payloadHash);

    // Lecturas de coherencia sin lock. Los locks mutables empiezan después y
    // mantienen el orden global documentado por esta fase.
    const warehouse = await tx.warehouse.findFirst({
        where: { id: intent.warehouseId, tenantId: intent.tenantId, isActive: true },
        select: { id: true },
    });
    if (!warehouse) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_WAREHOUSE_NOT_FOUND',
            404,
            'La bodega no existe, está inactiva o pertenece a otro negocio',
        );
    }
    const user = await tx.user.findFirst({
        where: { id: intent.userId, tenantId: intent.tenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!user) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_USER_NOT_FOUND',
            404,
            'El usuario no está activo en este negocio para registrar el movimiento lote-bodega',
        );
    }

    const products = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM \`Product\`
        WHERE id = ${intent.productId} AND tenantId = ${intent.tenantId}
        FOR UPDATE
    `);
    if (!products[0]) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_PRODUCT_NOT_FOUND',
            404,
            'El producto no existe en este negocio',
        );
    }

    const batches = await tx.$queryRaw<LockedProductBatchRow[]>(Prisma.sql`
        SELECT id, productId
        FROM \`ProductBatch\`
        WHERE id = ${intent.batchId} AND tenantId = ${intent.tenantId}
        FOR UPDATE
    `);
    const batch = batches[0];
    if (!batch) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_BATCH_NOT_FOUND',
            404,
            'El lote no existe en este negocio',
        );
    }
    if (batch.productId !== intent.productId) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH',
            409,
            'El lote no pertenece al producto indicado',
        );
    }

    // Nunca inferimos esta bodega desde ProductBatch.stock: el agregado legado
    // puede estar repartido. INSERT IGNORE materializa cero de forma segura y
    // el readiness/backfill exacto ocurre antes de activar ENFORCED.
    // INSERT IGNORE evita que el perdedor de una carrera P2002 quede atrapado
    // en un snapshot viejo. El SELECT bloqueante siguiente es una lectura
    // actual de InnoDB y toma la fila ganadora.
    await tx.productBatchWarehouseStock.createMany({
        data: [{
            tenantId: intent.tenantId,
            productId: intent.productId,
            batchId: intent.batchId,
            warehouseId: intent.warehouseId,
            stock: new Decimal(0),
        }],
        skipDuplicates: true,
    });
    const balances = await tx.$queryRaw<LockedBatchWarehouseStockRow[]>(Prisma.sql`
        SELECT id, productId, stock
        FROM \`ProductBatchWarehouseStock\`
        WHERE tenantId = ${intent.tenantId}
          AND batchId = ${intent.batchId}
          AND warehouseId = ${intent.warehouseId}
        FOR UPDATE
    `);
    const balance = balances[0];
    if (!balance) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_CONCURRENT_WRITE',
            409,
            'No se pudo materializar el saldo lote-bodega',
        );
    }
    if (balance.productId !== intent.productId) {
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH',
            409,
            'El saldo lote-bodega no pertenece al producto indicado',
        );
    }

    // Segunda lectura bloqueante: cierra la carrera de dos reintentos iguales
    // después de respetar el orden balance -> ledger.
    const lockedReplay = await lockLedgerEntry(tx, intent.tenantId, intent.sourceKey);
    if (lockedReplay) return replayResult(mode, lockedReplay, payloadHash);

    const stockBeforeDecimal = new Decimal(balance.stock.toString());
    const deltaDecimal = new Decimal(intent.delta);
    const requestedAfterDecimal = stockBeforeDecimal.plus(deltaDecimal);
    let requestedAfter: string;
    try {
        requestedAfter = canonicalBatchWarehouseBalance(requestedAfterDecimal);
    } catch (error) {
        if (!(error instanceof BatchWarehouseLedgerError)) throw error;
        throw new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_BALANCE_OVERFLOW',
            409,
            'El saldo lote-bodega excedería el rango exacto permitido',
        );
    }
    const stockBefore = canonicalBatchWarehouseBalance(stockBeforeDecimal);

    if (requestedAfterDecimal.isNegative() && !intent.allowNegative) {
        if (mode === 'ENFORCED') {
            throw new BatchWarehouseLedgerError(
                'BATCH_WAREHOUSE_INSUFFICIENT_STOCK',
                409,
                'No hay existencias suficientes de este lote en la bodega seleccionada',
            );
        }

        const gap = requestedAfterDecimal.abs().toFixed(4);
        const gapEntry = await tx.productBatchLedgerEntry.create({
            data: {
                tenantId: intent.tenantId,
                productId: intent.productId,
                batchId: intent.batchId,
                warehouseId: intent.warehouseId,
                quantityDelta: deltaDecimal,
                stockBefore: stockBeforeDecimal,
                stockAfter: stockBeforeDecimal,
                movementType: intent.movementType,
                referenceId: intent.referenceId,
                referenceType: intent.referenceType,
                sourceKey: intent.sourceKey,
                payloadHash,
                status: 'SHADOW_GAP',
                reason: intent.reason,
                userId: intent.userId,
            },
            select: { id: true },
        });
        await tx.auditLog.create({
            data: {
                tenantId: intent.tenantId,
                userId: intent.userId,
                action: 'BATCH_WAREHOUSE_SHADOW_GAP',
                details: auditDetails({
                    productId: intent.productId,
                    batchId: intent.batchId,
                    warehouseId: intent.warehouseId,
                    movementType: intent.movementType,
                    sourceKey: intent.sourceKey,
                    referenceId: intent.referenceId,
                    referenceType: intent.referenceType,
                    stockBefore,
                    stockAfter: stockBefore,
                    requestedAfter,
                    gap,
                }),
            },
        });
        return {
            mode,
            status: 'SHADOW_GAP',
            applied: false,
            replay: false,
            ledgerEntryId: gapEntry.id,
            stockBefore,
            stockAfter: stockBefore,
            gap,
        };
    }

    const updated = await tx.productBatchWarehouseStock.updateMany({
        where: {
            id: balance.id,
            tenantId: intent.tenantId,
            ...(deltaDecimal.isNegative() && !intent.allowNegative
                ? { stock: { gte: deltaDecimal.abs() } }
                : {}),
        },
        data: { stock: { increment: deltaDecimal } },
    });
    if (updated.count !== 1) {
        throw new BatchWarehouseLedgerError(
            deltaDecimal.isNegative() && !intent.allowNegative
                ? 'BATCH_WAREHOUSE_INSUFFICIENT_STOCK'
                : 'BATCH_WAREHOUSE_CONCURRENT_WRITE',
            409,
            'El saldo lote-bodega cambió concurrentemente; intentá nuevamente',
        );
    }

    const ledgerEntry = await tx.productBatchLedgerEntry.create({
        data: {
            tenantId: intent.tenantId,
            productId: intent.productId,
            batchId: intent.batchId,
            warehouseId: intent.warehouseId,
            quantityDelta: deltaDecimal,
            stockBefore: stockBeforeDecimal,
            stockAfter: requestedAfterDecimal,
            movementType: intent.movementType,
            referenceId: intent.referenceId,
            referenceType: intent.referenceType,
            sourceKey: intent.sourceKey,
            payloadHash,
            status: 'APPLIED',
            reason: intent.reason,
            userId: intent.userId,
        },
        select: { id: true },
    });

    return {
        mode,
        status: 'APPLIED',
        applied: true,
        replay: false,
        ledgerEntryId: ledgerEntry.id,
        stockBefore,
        stockAfter: requestedAfter,
        gap: null,
    };
}

/**
 * Frontera para handlers: un P2002 de sourceKey aborta la tx y se clasifica
 * con una relectura fuera del snapshot perdedor. Nunca crea otro PrismaClient.
 */
export async function executeBatchWarehouseDelta({
    db = prisma,
    ...intent
}: ExecuteBatchWarehouseDeltaInput): Promise<BatchWarehouseDeltaResult> {
    const normalized = normalizeBatchWarehouseDeltaIntent(intent);
    const payloadHash = buildBatchWarehousePayloadHash(normalized);
    try {
        return await db.$transaction(
            tx => applyBatchWarehouseDelta({ tx, ...normalized }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const existing = await findLedgerEntry(db, normalized.tenantId, normalized.sourceKey);
        if (!existing) throw error;
        const tenant = await db.tenant.findFirst({
            where: { id: normalized.tenantId },
            select: { batchWarehouseLedgerMode: true },
        });
        if (!tenant) throw error;
        return replayResult(
            normalizeBatchWarehouseLedgerMode(tenant.batchWarehouseLedgerMode),
            existing,
            payloadHash,
        );
    }
}

export { BatchWarehouseLedgerError };
