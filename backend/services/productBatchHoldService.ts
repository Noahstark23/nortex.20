import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertProductBatchHoldReplay,
    buildProductBatchHoldPayloadHash,
    canonicalProductBatchHoldBalance,
    normalizeProductBatchHoldDeltaIntent,
    ProductBatchHoldError,
    type CanonicalProductBatchHoldDeltaIntent,
    type ProductBatchHoldDeltaIntent,
} from '../lib/productBatchHold.js';
import prisma from '../lib/prisma.js';

type PrismaTx = Prisma.TransactionClient;

interface LockedProductBatchRow {
    id: string;
    productId: string;
}

interface ProductBatchHoldTenantModeRow {
    type: string;
    pharmacyInventoryMode: string;
    batchWarehouseLedgerMode: string;
}

interface LockedBatchWarehouseStockRow {
    id: string;
    productId: string;
    stock: Decimal.Value;
    heldStock: Decimal.Value;
}

interface ExistingProductBatchHoldRow {
    id: string;
    payloadHash: string;
    quantityDelta: Decimal.Value;
    heldBefore: Decimal.Value;
    heldAfter: Decimal.Value;
    physicalStockSnapshot: Decimal.Value;
    sellableBefore: Decimal.Value;
    sellableAfter: Decimal.Value;
}

export interface ProductBatchHoldDeltaResult {
    holdId: string;
    replay: boolean;
    quantityDelta: string;
    physicalStockSnapshot: string;
    heldBefore: string;
    heldAfter: string;
    sellableBefore: string;
    sellableAfter: string;
}

export interface ApplyProductBatchHoldDeltaInput extends ProductBatchHoldDeltaIntent {
    tx: PrismaTx;
}

export interface ExecuteProductBatchHoldDeltaInput extends ProductBatchHoldDeltaIntent {
    db?: PrismaClient;
}

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const findHold = async (
    database: Pick<PrismaTx, 'productBatchHold'> | Pick<PrismaClient, 'productBatchHold'>,
    tenantId: string,
    sourceKey: string,
): Promise<ExistingProductBatchHoldRow | null> => database.productBatchHold.findFirst({
    where: { tenantId, sourceKey },
    select: {
        id: true,
        payloadHash: true,
        quantityDelta: true,
        heldBefore: true,
        heldAfter: true,
        physicalStockSnapshot: true,
        sellableBefore: true,
        sellableAfter: true,
    },
}) as Promise<ExistingProductBatchHoldRow | null>;

const lockHold = async (
    tx: PrismaTx,
    tenantId: string,
    sourceKey: string,
): Promise<ExistingProductBatchHoldRow | null> => {
    const rows = await tx.$queryRaw<ExistingProductBatchHoldRow[]>(Prisma.sql`
        SELECT id, payloadHash, quantityDelta, heldBefore, heldAfter,
               physicalStockSnapshot, sellableBefore, sellableAfter
        FROM \`ProductBatchHold\`
        WHERE tenantId = ${tenantId} AND sourceKey = ${sourceKey}
        FOR UPDATE
    `);
    return rows[0] ?? null;
};

const assertTenantMode = (
    tenant: ProductBatchHoldTenantModeRow | null,
): void => {
    if (!tenant) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_TENANT_NOT_FOUND',
            404,
            'El negocio no existe para registrar la retención lote-bodega',
        );
    }
    if (tenant.type !== 'FARMACIA') {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_TENANT_NOT_PHARMACY',
            409,
            'Las retenciones farmacéuticas solo están disponibles para negocios tipo FARMACIA',
        );
    }
    if (tenant.pharmacyInventoryMode !== 'ENFORCED'
        || tenant.batchWarehouseLedgerMode !== 'ENFORCED') {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_MODE_NOT_ENFORCED',
            409,
            'La cuarentena exige inventario farmacéutico y ledger lote-bodega en modo ENFORCED',
        );
    }
};

const lockAndAssertModeEnforced = async (
    tx: PrismaTx,
    tenantId: string,
): Promise<void> => {
    const rows = await tx.$queryRaw<ProductBatchHoldTenantModeRow[]>(Prisma.sql`
        SELECT type, pharmacyInventoryMode, batchWarehouseLedgerMode
        FROM \`Tenant\`
        WHERE id = ${tenantId}
        FOR UPDATE
    `);
    assertTenantMode(rows[0] ?? null);
};

const parseStoredDecimal = (value: Decimal.Value): Decimal => {
    try {
        const parsed = new Decimal(value.toString());
        if (!parsed.isFinite() || parsed.decimalPlaces() > 4) throw new Error('invalid decimal');
        return parsed;
    } catch {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_RECORD_CORRUPT',
            500,
            'La retención lote-bodega persistida contiene saldos inválidos',
        );
    }
};

const resultFromExisting = (
    existing: ExistingProductBatchHoldRow,
    expectedPayloadHash: string,
): ProductBatchHoldDeltaResult => {
    assertProductBatchHoldReplay(existing, expectedPayloadHash);
    const quantityDelta = parseStoredDecimal(existing.quantityDelta);
    const heldBefore = parseStoredDecimal(existing.heldBefore);
    const heldAfter = parseStoredDecimal(existing.heldAfter);
    const physical = parseStoredDecimal(existing.physicalStockSnapshot);
    const sellableBefore = parseStoredDecimal(existing.sellableBefore);
    const sellableAfter = parseStoredDecimal(existing.sellableAfter);
    if (quantityDelta.isZero()
        || physical.isNegative()
        || heldBefore.isNegative()
        || heldAfter.isNegative()
        || heldBefore.greaterThan(physical)
        || heldAfter.greaterThan(physical)
        || !heldBefore.plus(quantityDelta).equals(heldAfter)
        || !physical.minus(heldBefore).equals(sellableBefore)
        || !physical.minus(heldAfter).equals(sellableAfter)) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_RECORD_CORRUPT',
            500,
            'La retención lote-bodega persistida no conserva sus invariantes',
        );
    }
    return {
        holdId: existing.id,
        replay: true,
        quantityDelta: canonicalProductBatchHoldBalance(quantityDelta),
        physicalStockSnapshot: canonicalProductBatchHoldBalance(physical),
        heldBefore: canonicalProductBatchHoldBalance(heldBefore),
        heldAfter: canonicalProductBatchHoldBalance(heldAfter),
        sellableBefore: canonicalProductBatchHoldBalance(sellableBefore),
        sellableAfter: canonicalProductBatchHoldBalance(sellableAfter),
    };
};

const auditDetails = (input: {
    intent: CanonicalProductBatchHoldDeltaIntent;
    physicalStockSnapshot: string;
    heldBefore: string;
    heldAfter: string;
    sellableBefore: string;
    sellableAfter: string;
}): string => JSON.stringify({
    productId: input.intent.productId,
    batchId: input.intent.batchId,
    warehouseId: input.intent.warehouseId,
    holdReasonCode: input.intent.holdReasonCode,
    sourceKey: input.intent.sourceKey,
    reference: {
        type: input.intent.referenceType,
        id: input.intent.referenceId,
    },
    quantityDelta: input.intent.quantityDelta,
    physicalStockSnapshot: input.physicalStockSnapshot,
    before: {
        heldStock: input.heldBefore,
        sellableStock: input.sellableBefore,
    },
    after: {
        heldStock: input.heldAfter,
        sellableStock: input.sellableAfter,
    },
});

/**
 * Aplica una retención/liberación exacta sin alterar stock físico. El caller
 * conserva su transacción de negocio; este helper toma locks en orden global:
 * Tenant -> Product -> ProductBatch -> ProductBatchWarehouseStock -> source replay.
 */
export async function applyProductBatchHoldDelta({
    tx,
    ...rawIntent
}: ApplyProductBatchHoldDeltaInput): Promise<ProductBatchHoldDeltaResult> {
    const intent = normalizeProductBatchHoldDeltaIntent(rawIntent);
    const payloadHash = buildProductBatchHoldPayloadHash(intent);

    await lockAndAssertModeEnforced(tx, intent.tenantId);
    const fastReplay = await findHold(tx, intent.tenantId, intent.sourceKey);
    if (fastReplay) return resultFromExisting(fastReplay, payloadHash);

    const warehouse = await tx.warehouse.findFirst({
        where: { id: intent.warehouseId, tenantId: intent.tenantId, isActive: true },
        select: { id: true },
    });
    if (!warehouse) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_WAREHOUSE_NOT_FOUND',
            404,
            'La bodega no existe, está inactiva o pertenece a otro negocio',
        );
    }
    const user = await tx.user.findFirst({
        where: { id: intent.userId, tenantId: intent.tenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!user) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_USER_NOT_FOUND',
            404,
            'El usuario no está activo en este negocio para registrar la retención',
        );
    }

    const products = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM \`Product\`
        WHERE id = ${intent.productId} AND tenantId = ${intent.tenantId}
        FOR UPDATE
    `);
    if (!products[0]) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_PRODUCT_NOT_FOUND',
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
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BATCH_NOT_FOUND',
            404,
            'El lote no existe en este negocio',
        );
    }
    if (batch.productId !== intent.productId) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BATCH_PRODUCT_MISMATCH',
            409,
            'El lote no pertenece al producto indicado',
        );
    }

    const balances = await tx.$queryRaw<LockedBatchWarehouseStockRow[]>(Prisma.sql`
        SELECT id, productId, stock, heldStock
        FROM \`ProductBatchWarehouseStock\`
        WHERE tenantId = ${intent.tenantId}
          AND batchId = ${intent.batchId}
          AND warehouseId = ${intent.warehouseId}
        FOR UPDATE
    `);
    const balance = balances[0];
    if (!balance) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BALANCE_NOT_FOUND',
            409,
            'No existe un saldo exacto lote-bodega para registrar la retención',
        );
    }
    if (balance.productId !== intent.productId) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BALANCE_SCOPE_MISMATCH',
            409,
            'El saldo lote-bodega no pertenece al producto indicado',
        );
    }

    const lockedReplay = await lockHold(tx, intent.tenantId, intent.sourceKey);
    if (lockedReplay) return resultFromExisting(lockedReplay, payloadHash);

    let physicalStock: Decimal;
    let heldBefore: Decimal;
    try {
        physicalStock = new Decimal(balance.stock.toString());
        heldBefore = new Decimal(balance.heldStock.toString());
    } catch {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BALANCE_CORRUPT',
            500,
            'El saldo exacto lote-bodega contiene valores inválidos',
        );
    }
    if (!physicalStock.isFinite()
        || !heldBefore.isFinite()
        || physicalStock.isNegative()
        || heldBefore.isNegative()
        || heldBefore.greaterThan(physicalStock)) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BALANCE_CORRUPT',
            500,
            'El saldo exacto lote-bodega no conserva 0 <= retenido <= físico',
        );
    }

    const quantityDelta = new Decimal(intent.quantityDelta);
    const heldAfter = heldBefore.plus(quantityDelta);
    try {
        canonicalProductBatchHoldBalance(heldAfter);
    } catch (error) {
        if (!(error instanceof ProductBatchHoldError)) throw error;
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_BALANCE_OVERFLOW',
            409,
            'El saldo retenido excedería el rango exacto permitido',
        );
    }
    if (heldAfter.isNegative()) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_INSUFFICIENT_HELD_STOCK',
            409,
            'La liberación excede las existencias retenidas de este lote',
        );
    }
    if (heldAfter.greaterThan(physicalStock)) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_INSUFFICIENT_PHYSICAL_STOCK',
            409,
            'La retención excede las existencias físicas de este lote en la bodega',
        );
    }

    const sellableBefore = physicalStock.minus(heldBefore);
    const sellableAfter = physicalStock.minus(heldAfter);
    const physicalStockSnapshot = canonicalProductBatchHoldBalance(physicalStock);
    const heldBeforeText = canonicalProductBatchHoldBalance(heldBefore);
    const heldAfterText = canonicalProductBatchHoldBalance(heldAfter);
    const sellableBeforeText = canonicalProductBatchHoldBalance(sellableBefore);
    const sellableAfterText = canonicalProductBatchHoldBalance(sellableAfter);

    const updated = await tx.productBatchWarehouseStock.updateMany({
        where: {
            id: balance.id,
            tenantId: intent.tenantId,
            stock: physicalStock,
            heldStock: heldBefore,
        },
        data: { heldStock: { increment: quantityDelta } },
    });
    if (updated.count !== 1) {
        throw new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_CONCURRENT_WRITE',
            409,
            'El saldo lote-bodega cambió concurrentemente; intentá nuevamente',
        );
    }

    const hold = await tx.productBatchHold.create({
        data: {
            tenantId: intent.tenantId,
            productId: intent.productId,
            batchId: intent.batchId,
            warehouseId: intent.warehouseId,
            quantityDelta,
            heldBefore,
            heldAfter,
            physicalStockSnapshot: physicalStock,
            sellableBefore,
            sellableAfter,
            holdReasonCode: intent.holdReasonCode,
            referenceId: intent.referenceId,
            referenceType: intent.referenceType,
            sourceKey: intent.sourceKey,
            payloadHash,
            notes: intent.notes,
            userId: intent.userId,
        },
        select: { id: true },
    });

    await tx.auditLog.create({
        data: {
            tenantId: intent.tenantId,
            userId: intent.userId,
            action: quantityDelta.isPositive()
                ? 'PRODUCT_BATCH_HOLD_APPLIED'
                : 'PRODUCT_BATCH_HOLD_RELEASED',
            details: auditDetails({
                intent,
                physicalStockSnapshot,
                heldBefore: heldBeforeText,
                heldAfter: heldAfterText,
                sellableBefore: sellableBeforeText,
                sellableAfter: sellableAfterText,
            }),
        },
    });

    return {
        holdId: hold.id,
        replay: false,
        quantityDelta: intent.quantityDelta,
        physicalStockSnapshot,
        heldBefore: heldBeforeText,
        heldAfter: heldAfterText,
        sellableBefore: sellableBeforeText,
        sellableAfter: sellableAfterText,
    };
}

/** Frontera transaccional reusable para comandos que no traen su propia tx. */
export async function executeProductBatchHoldDelta({
    db = prisma,
    ...rawIntent
}: ExecuteProductBatchHoldDeltaInput): Promise<ProductBatchHoldDeltaResult> {
    const intent = normalizeProductBatchHoldDeltaIntent(rawIntent);
    const payloadHash = buildProductBatchHoldPayloadHash(intent);
    try {
        return await db.$transaction(
            tx => applyProductBatchHoldDelta({ tx, ...intent }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await findHold(db, intent.tenantId, intent.sourceKey);
        if (!existing) throw error;
        return resultFromExisting(existing, payloadHash);
    }
}

export { ProductBatchHoldError };
