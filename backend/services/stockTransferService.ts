import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertMatchingStockTransferReplay,
    buildStockTransferPayloadHash,
    normalizeStockTransferCommand,
    StockTransferError,
    type CanonicalStockTransferCommand,
    type StockTransferCommandRequest,
} from '../lib/stockTransferCommand.js';
import {
    buildBoundedBatchWarehouseSourceKey,
    type BatchWarehouseLedgerMode,
} from '../lib/batchWarehouseLedger.js';
import { materializeWarehouseRow } from './stockService.js';
import {
    consumeProductBatchesByWarehouseFefo,
    consumeProductBatchesFefo,
    type FefoAllocation,
} from './saleBatchAllocationService.js';
import {
    applyBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode,
    type BatchWarehouseDeltaResult,
} from './productBatchWarehouseLedgerService.js';
import { validateStockTransferQuantity } from '../../utils/stockTransferQuantity.js';
import { QuantityValidationError } from '../../utils/quantity.js';

type PrismaTx = Prisma.TransactionClient;

interface WarehouseAuthority {
    id: string;
    name: string;
    isDefault: boolean;
}

interface LockedWarehouseAuthority extends Omit<WarehouseAuthority, 'isDefault'> {
    isDefault: boolean | number;
}

interface LockedProductAuthority {
    id: string;
    name: string;
    saleMode: string | null;
    quantityStep: Decimal.Value | null;
    requiresBatchTracking: boolean | number;
}

interface LockedProductStockRow {
    id: string;
    productId: string;
    warehouseId: string;
    stock: Decimal.Value;
}

export interface StockTransferRecord {
    id: string;
    tenantId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    clientEventId: string | null;
    payloadHash: string | null;
    payloadVersion: number;
    batchLedgerMode: string;
    batchTransferStatus: string;
    batchSnapshot: Prisma.JsonValue | null;
    notes: string | null;
    items: Prisma.JsonValue;
    createdBy: string;
    createdAt: Date;
}

export interface StockTransferResult {
    transfer: StockTransferRecord;
    replay: boolean;
}

export interface ExecuteStockTransferInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    request: StockTransferCommandRequest;
    now?: Date;
}

export interface ExecuteStockTransferTransactionInput
    extends Omit<ExecuteStockTransferInput, 'tx'> {
    db: PrismaClient;
}

interface BatchAllocationSnapshot {
    batchId: string;
    batchNumber: string;
    quantity: string;
    out: {
        status: string;
        stockBefore: string | null;
        stockAfter: string | null;
        gap: string | null;
    };
    in: {
        status: string;
        stockBefore: string | null;
        stockAfter: string | null;
    } | null;
}

interface BatchLineSnapshot {
    productId: string;
    quantity: string;
    status: 'APPLIED' | 'SHADOW_GAP';
    unallocatedQuantity: string;
    allocations: BatchAllocationSnapshot[];
}

interface BatchTransferSnapshot {
    version: 1;
    mode: Exclude<BatchWarehouseLedgerMode, 'OFF'>;
    status: 'APPLIED' | 'SHADOW_GAP';
    lines: BatchLineSnapshot[];
}

interface AggregateMovementSnapshot {
    productId: string;
    name: string;
    quantity: string;
    from: { stockBefore: string; stockAfter: string };
    to: { stockBefore: string; stockAfter: string };
}

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const transferSelect = {
    id: true,
    tenantId: true,
    fromWarehouseId: true,
    toWarehouseId: true,
    clientEventId: true,
    payloadHash: true,
    payloadVersion: true,
    batchLedgerMode: true,
    batchTransferStatus: true,
    batchSnapshot: true,
    notes: true,
    items: true,
    createdBy: true,
    createdAt: true,
} as const;

const findTransferByClientEvent = async (
    db: Pick<PrismaTx, 'stockTransfer'> | Pick<PrismaClient, 'stockTransfer'>,
    tenantId: string,
    clientEventId: string,
): Promise<StockTransferRecord | null> => db.stockTransfer.findFirst({
    where: { tenantId, clientEventId },
    select: transferSelect,
}) as Promise<StockTransferRecord | null>;

const serializeReplay = (
    existing: StockTransferRecord,
    payloadHash: string,
): StockTransferResult => {
    assertMatchingStockTransferReplay(existing, payloadHash);
    return { transfer: existing, replay: true };
};

const validateContext = (input: {
    tenantId: string;
    userId: string;
    now: Date;
}): void => {
    if (!input.tenantId || !input.userId) {
        throw new StockTransferError(
            'INVALID_TRANSFER_CONTEXT',
            400,
            'tenantId y userId son obligatorios',
        );
    }
    if (Number.isNaN(input.now.getTime())) {
        throw new StockTransferError('INVALID_TRANSFER_DATE', 400, 'La fecha de transferencia no es válida');
    }
};

const stockKey = (productId: string, warehouseId: string): string => `${productId}:${warehouseId}`;

const ledgerProjection = (result: BatchWarehouseDeltaResult): BatchAllocationSnapshot['out'] => ({
    status: result.status,
    stockBefore: result.stockBefore,
    stockAfter: result.stockAfter,
    gap: result.gap,
});

const compensateGlobalBatch = async (
    tx: PrismaTx,
    input: { tenantId: string; productId: string; allocation: FefoAllocation },
): Promise<void> => {
    const restored = await tx.productBatch.updateMany({
        where: {
            id: input.allocation.batchId,
            tenantId: input.tenantId,
            productId: input.productId,
        },
        data: { stock: { increment: input.allocation.quantity.toNumber() } },
    });
    if (restored.count !== 1) {
        throw new StockTransferError(
            'BATCH_GLOBAL_COMPENSATION_FAILED',
            409,
            'No se pudo conservar el agregado global del lote; intentá nuevamente',
        );
    }
};

const applyBatchDestination = async (
    tx: PrismaTx,
    input: {
        mode: Exclude<BatchWarehouseLedgerMode, 'OFF'>;
        tenantId: string;
        userId: string;
        transferId: string;
        productId: string;
        warehouseId: string;
        allocation: FefoAllocation;
        reason: string;
    },
): Promise<BatchAllocationSnapshot['in']> => {
    const result = await applyBatchWarehouseDelta({
        tx,
        mode: input.mode,
        tenantId: input.tenantId,
        productId: input.productId,
        batchId: input.allocation.batchId,
        warehouseId: input.warehouseId,
        delta: input.allocation.quantity.toFixed(4),
        movementType: 'TRANSFER_IN',
        referenceId: input.transferId,
        referenceType: 'STOCK_TRANSFER',
        userId: input.userId,
        reason: input.reason,
        sourceKey: buildBoundedBatchWarehouseSourceKey(
            `stock-transfer:${input.transferId}:line:${input.productId}:in`,
            input.allocation.batchId,
        ),
        allowNegative: false,
    });
    if (result.status !== 'APPLIED') {
        throw new StockTransferError(
            'BATCH_DESTINATION_WRITE_FAILED',
            409,
            'No se pudo acreditar el lote en la bodega destino',
        );
    }
    return {
        status: result.status,
        stockBefore: result.stockBefore,
        stockAfter: result.stockAfter,
    };
};

const transferTrackedProductEnforced = async (
    tx: PrismaTx,
    input: {
        tenantId: string;
        userId: string;
        transferId: string;
        fromWarehouseId: string;
        toWarehouseId: string;
        productId: string;
        quantity: string;
        reason: string;
    },
): Promise<BatchLineSnapshot> => {
    const result = await consumeProductBatchesByWarehouseFefo(tx, {
        tenantId: input.tenantId,
        productId: input.productId,
        quantity: input.quantity,
        context: {
            mode: 'ENFORCED',
            warehouseId: input.fromWarehouseId,
            userId: input.userId,
            movementType: 'TRANSFER_OUT',
            referenceId: input.transferId,
            referenceType: 'STOCK_TRANSFER',
            sourceKeyPrefix: `stock-transfer:${input.transferId}:line:${input.productId}:out`,
            reason: input.reason,
        },
    });

    const allocations: BatchAllocationSnapshot[] = [];
    for (const allocation of result.allocations) {
        await compensateGlobalBatch(tx, { tenantId: input.tenantId, productId: input.productId, allocation });
        const destination = await applyBatchDestination(tx, {
            mode: 'ENFORCED',
            tenantId: input.tenantId,
            userId: input.userId,
            transferId: input.transferId,
            productId: input.productId,
            warehouseId: input.toWarehouseId,
            allocation,
            reason: input.reason,
        });
        allocations.push({
            batchId: allocation.batchId,
            batchNumber: allocation.batchNumber,
            quantity: allocation.quantity.toFixed(4),
            out: { status: 'APPLIED', stockBefore: null, stockAfter: null, gap: null },
            in: destination,
        });
    }

    return {
        productId: input.productId,
        quantity: input.quantity,
        status: 'APPLIED',
        unallocatedQuantity: '0.0000',
        allocations,
    };
};

/**
 * SHADOW no bloquea la transferencia agregada. Observa FEFO global, registra el
 * OUT local y solo acredita destino cuando ese OUT fue aplicado realmente.
 */
const transferTrackedProductShadow = async (
    tx: PrismaTx,
    input: {
        tenantId: string;
        userId: string;
        transferId: string;
        fromWarehouseId: string;
        toWarehouseId: string;
        productId: string;
        quantity: string;
        reason: string;
    },
): Promise<BatchLineSnapshot> => {
    const result = await consumeProductBatchesFefo(tx, {
        tenantId: input.tenantId,
        productId: input.productId,
        quantity: input.quantity,
        enforceComplete: false,
    });
    let hasGap = result.unallocatedQuantity.greaterThan(0);
    const allocations: BatchAllocationSnapshot[] = [];

    for (const allocation of result.allocations) {
        const out = await applyBatchWarehouseDelta({
            tx,
            mode: 'SHADOW',
            tenantId: input.tenantId,
            productId: input.productId,
            batchId: allocation.batchId,
            warehouseId: input.fromWarehouseId,
            delta: allocation.quantity.negated().toFixed(4),
            movementType: 'TRANSFER_OUT',
            referenceId: input.transferId,
            referenceType: 'STOCK_TRANSFER',
            userId: input.userId,
            reason: input.reason,
            sourceKey: buildBoundedBatchWarehouseSourceKey(
                `stock-transfer:${input.transferId}:line:${input.productId}:out`,
                allocation.batchId,
            ),
            allowNegative: false,
        });
        await compensateGlobalBatch(tx, { tenantId: input.tenantId, productId: input.productId, allocation });

        let destination: BatchAllocationSnapshot['in'] = null;
        if (out.status === 'APPLIED') {
            destination = await applyBatchDestination(tx, {
                mode: 'SHADOW',
                tenantId: input.tenantId,
                userId: input.userId,
                transferId: input.transferId,
                productId: input.productId,
                warehouseId: input.toWarehouseId,
                allocation,
                reason: input.reason,
            });
        } else {
            hasGap = true;
        }

        allocations.push({
            batchId: allocation.batchId,
            batchNumber: allocation.batchNumber,
            quantity: allocation.quantity.toFixed(4),
            out: ledgerProjection(out),
            in: destination,
        });
    }

    return {
        productId: input.productId,
        quantity: input.quantity,
        status: hasGap ? 'SHADOW_GAP' : 'APPLIED',
        unallocatedQuantity: result.unallocatedQuantity.toFixed(4),
        allocations,
    };
};

const applyBatchTransfer = async (
    tx: PrismaTx,
    input: {
        mode: Exclude<BatchWarehouseLedgerMode, 'OFF'>;
        tenantId: string;
        userId: string;
        transferId: string;
        from: WarehouseAuthority;
        to: WarehouseAuthority;
        lines: Array<{ product: LockedProductAuthority; quantity: string }>;
    },
): Promise<BatchTransferSnapshot> => {
    const reason = `Transferencia ${input.from.name} → ${input.to.name}`;
    const lines: BatchLineSnapshot[] = [];
    for (const line of input.lines) {
        if (line.product.requiresBatchTracking !== true && line.product.requiresBatchTracking !== 1) continue;
        lines.push(input.mode === 'ENFORCED'
            ? await transferTrackedProductEnforced(tx, {
                tenantId: input.tenantId,
                userId: input.userId,
                transferId: input.transferId,
                fromWarehouseId: input.from.id,
                toWarehouseId: input.to.id,
                productId: line.product.id,
                quantity: line.quantity,
                reason,
            })
            : await transferTrackedProductShadow(tx, {
                tenantId: input.tenantId,
                userId: input.userId,
                transferId: input.transferId,
                fromWarehouseId: input.from.id,
                toWarehouseId: input.to.id,
                productId: line.product.id,
                quantity: line.quantity,
                reason,
            }));
    }
    return {
        version: 1,
        mode: input.mode,
        status: lines.some(line => line.status === 'SHADOW_GAP') ? 'SHADOW_GAP' : 'APPLIED',
        lines,
    };
};

const lockProducts = async (
    tx: PrismaTx,
    tenantId: string,
    productIds: string[],
): Promise<LockedProductAuthority[]> => tx.$queryRaw<LockedProductAuthority[]>(Prisma.sql`
    SELECT \`id\`, \`name\`, \`saleMode\`, \`quantityStep\`, \`requiresBatchTracking\`
    FROM \`Product\`
    WHERE \`tenantId\` = ${tenantId}
      AND \`id\` IN (${Prisma.join(productIds)})
    ORDER BY \`id\` ASC
    FOR UPDATE
`);

const lockWarehouses = async (
    tx: PrismaTx,
    input: { tenantId: string; warehouseIds: string[] },
): Promise<WarehouseAuthority[]> => {
    const rows = await tx.$queryRaw<LockedWarehouseAuthority[]>(Prisma.sql`
        SELECT \`id\`, \`name\`, \`isDefault\`
        FROM \`Warehouse\`
        WHERE \`tenantId\` = ${input.tenantId}
          AND \`id\` IN (${Prisma.join(input.warehouseIds)})
          AND \`isActive\` = TRUE
        ORDER BY \`id\` ASC
        FOR UPDATE
    `);
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        isDefault: row.isDefault === true || row.isDefault === 1,
    }));
};

const lockProductStocks = async (
    tx: PrismaTx,
    input: { tenantId: string; productIds: string[]; warehouseIds: string[] },
): Promise<LockedProductStockRow[]> => tx.$queryRaw<LockedProductStockRow[]>(Prisma.sql`
    SELECT \`id\`, \`productId\`, \`warehouseId\`, \`stock\`
    FROM \`ProductStock\`
    WHERE \`tenantId\` = ${input.tenantId}
      AND \`productId\` IN (${Prisma.join(input.productIds)})
      AND \`warehouseId\` IN (${Prisma.join(input.warehouseIds)})
    ORDER BY \`productId\` ASC, \`warehouseId\` ASC
    FOR UPDATE
`);

const executeAggregateMovements = async (
    tx: PrismaTx,
    input: {
        tenantId: string;
        userId: string;
        transferId: string;
        from: WarehouseAuthority;
        to: WarehouseAuthority;
        lines: Array<{ product: LockedProductAuthority; quantity: string }>;
        lockedStocks: LockedProductStockRow[];
    },
): Promise<AggregateMovementSnapshot[]> => {
    const lockedByKey = new Map(input.lockedStocks.map(row => [stockKey(row.productId, row.warehouseId), row]));
    const moved: Array<{
        line: { product: LockedProductAuthority; quantity: string };
        quantityAtFloatBoundary: number;
        fromBefore: LockedProductStockRow;
        toBefore: LockedProductStockRow;
    }> = [];
    for (const line of input.lines) {
        const fromBefore = lockedByKey.get(stockKey(line.product.id, input.from.id));
        const toBefore = lockedByKey.get(stockKey(line.product.id, input.to.id));
        if (!fromBefore || !toBefore) {
            throw new StockTransferError(
                'TRANSFER_STOCK_ROW_MISSING',
                409,
                'No se pudieron bloquear todas las existencias de la transferencia',
            );
        }
        const quantity = new Decimal(line.quantity);
        if (new Decimal(fromBefore.stock.toString()).lessThan(quantity)) {
            throw new StockTransferError(
                'INSUFFICIENT_WAREHOUSE_STOCK',
                422,
                `Stock insuficiente en ${input.from.name} para "${line.product.name}"`,
                { productId: line.product.id, available: fromBefore.stock.toString() },
            );
        }
        // Product.stock no cambia en una transferencia: movemos solo las dos
        // filas ya bloqueadas y dejamos Kardex doble dentro de esta misma tx.
        const quantityAtFloatBoundary = quantity.toNumber();
        const debited = await tx.productStock.updateMany({
            where: {
                tenantId: input.tenantId,
                productId: line.product.id,
                warehouseId: input.from.id,
                stock: { gte: quantityAtFloatBoundary },
            },
            data: { stock: { decrement: quantityAtFloatBoundary } },
        });
        if (debited.count !== 1) {
            throw new StockTransferError(
                'TRANSFER_STOCK_CONCURRENT_WRITE',
                409,
                'Las existencias de origen cambiaron; intentá nuevamente',
            );
        }
        const credited = await tx.productStock.updateMany({
            where: {
                tenantId: input.tenantId,
                productId: line.product.id,
                warehouseId: input.to.id,
            },
            data: { stock: { increment: quantityAtFloatBoundary } },
        });
        if (credited.count !== 1) {
            throw new StockTransferError(
                'TRANSFER_STOCK_CONCURRENT_WRITE',
                409,
                'Las existencias de destino cambiaron; intentá nuevamente',
            );
        }

        moved.push({ line, quantityAtFloatBoundary, fromBefore, toBefore });
    }

    // Una sola relectura y un solo INSERT masivo mantienen la tx corta aun con
    // varias líneas, sin inventar before/after a partir de aritmética Float.
    const afterRows = await tx.productStock.findMany({
        where: {
            tenantId: input.tenantId,
            productId: { in: input.lines.map(line => line.product.id) },
            warehouseId: { in: [input.from.id, input.to.id] },
        },
        select: { productId: true, warehouseId: true, stock: true },
        take: input.lines.length * 2,
    });
    const afterByKey = new Map(afterRows.map(row => [stockKey(row.productId, row.warehouseId), row.stock]));
    const reason = `Transferencia ${input.from.name} → ${input.to.name}`;
    const kardex: Prisma.KardexMovementCreateManyInput[] = [];
    const snapshots: AggregateMovementSnapshot[] = [];
    for (const movement of moved) {
        const fromAfter = afterByKey.get(stockKey(movement.line.product.id, input.from.id));
        const toAfter = afterByKey.get(stockKey(movement.line.product.id, input.to.id));
        if (fromAfter === undefined || toAfter === undefined) {
            throw new StockTransferError(
                'TRANSFER_STOCK_ROW_MISSING',
                409,
                'No se pudo verificar el saldo final de la transferencia',
            );
        }
        kardex.push(
            {
                tenantId: input.tenantId,
                productId: movement.line.product.id,
                type: 'TRANSFER_OUT',
                quantity: -movement.quantityAtFloatBoundary,
                stockBefore: Number(movement.fromBefore.stock),
                stockAfter: Number(fromAfter),
                referenceId: input.transferId,
                referenceType: 'STOCK_TRANSFER',
                reason,
                userId: input.userId,
                warehouseId: input.from.id,
            },
            {
                tenantId: input.tenantId,
                productId: movement.line.product.id,
                type: 'TRANSFER_IN',
                quantity: movement.quantityAtFloatBoundary,
                stockBefore: Number(movement.toBefore.stock),
                stockAfter: Number(toAfter),
                referenceId: input.transferId,
                referenceType: 'STOCK_TRANSFER',
                reason,
                userId: input.userId,
                warehouseId: input.to.id,
            },
        );
        snapshots.push({
            productId: movement.line.product.id,
            name: movement.line.product.name,
            quantity: movement.line.quantity,
            from: {
                stockBefore: new Decimal(movement.fromBefore.stock.toString()).toFixed(4),
                stockAfter: new Decimal(fromAfter.toString()).toFixed(4),
            },
            to: {
                stockBefore: new Decimal(movement.toBefore.stock.toString()).toFixed(4),
                stockAfter: new Decimal(toAfter.toString()).toFixed(4),
            },
        });
    }
    await tx.kardexMovement.createMany({ data: kardex });
    return snapshots;
};

/** Ejecuta un comando ya autenticado dentro de una única transacción. */
export async function executeStockTransfer({
    tx,
    tenantId,
    userId,
    request,
    now = new Date(),
}: ExecuteStockTransferInput): Promise<StockTransferResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const canonical = normalizeStockTransferCommand(request);
    validateContext({ tenantId: scopedTenantId, userId: scopedUserId, now });
    const payloadHash = buildStockTransferPayloadHash({ tenantId: scopedTenantId, command: canonical });

    const actor = await tx.user.findFirst({
        where: { id: scopedUserId, tenantId: scopedTenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!actor) {
        throw new StockTransferError(
            'STOCK_TRANSFER_ACTOR_FORBIDDEN',
            403,
            'El usuario no está activo en este negocio para transferir existencias',
        );
    }

    const existing = await findTransferByClientEvent(tx, scopedTenantId, canonical.clientEventId);
    if (existing) return serializeReplay(existing, payloadHash);

    const warehouses = await tx.warehouse.findMany({
        where: {
            tenantId: scopedTenantId,
            id: { in: [canonical.fromWarehouseId, canonical.toWarehouseId] },
            isActive: true,
        },
        select: { id: true, name: true, isDefault: true },
        take: 2,
    }) as WarehouseAuthority[];
    const fromPreview = warehouses.find(warehouse => warehouse.id === canonical.fromWarehouseId);
    const toPreview = warehouses.find(warehouse => warehouse.id === canonical.toWarehouseId);
    if (!fromPreview || !toPreview) {
        throw new StockTransferError('WAREHOUSE_NOT_FOUND', 404, 'Bodega no encontrada o inactiva');
    }

    const productIds = canonical.items.map(item => item.productId);
    const productPreview = await tx.product.findMany({
        where: { tenantId: scopedTenantId, id: { in: productIds } },
        select: { id: true, name: true },
        take: productIds.length,
    });
    if (productPreview.length !== productIds.length) {
        throw new StockTransferError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado en este negocio');
    }
    const previewById = new Map(productPreview.map(product => [product.id, product.name]));
    const mode = await resolveBatchWarehouseLedgerMode(tx, scopedTenantId);
    const preliminaryItems = canonical.items.map(item => ({
        productId: item.productId,
        name: previewById.get(item.productId) ?? '',
        quantity: item.quantity,
    }));

    // Las FK del header consultan ambas bodegas. Bloquearlas primero en un
    // orden único evita que dos traslados A→B / B→A intenten promover locks
    // de FK en orden inverso y formen un ciclo.
    const warehouseIds = [fromPreview.id, toPreview.id].sort((left, right) => left.localeCompare(right));
    const lockedWarehouses = await lockWarehouses(tx, { tenantId: scopedTenantId, warehouseIds });
    const from = lockedWarehouses.find(warehouse => warehouse.id === fromPreview.id);
    const to = lockedWarehouses.find(warehouse => warehouse.id === toPreview.id);
    if (!from || !to) {
        throw new StockTransferError('WAREHOUSE_NOT_FOUND', 404, 'Bodega no encontrada o inactiva');
    }

    // Claim idempotente antes de materializar, debitar o escribir Kardex/lotes.
    const header = await tx.stockTransfer.create({
        data: {
            tenantId: scopedTenantId,
            fromWarehouseId: from.id,
            toWarehouseId: to.id,
            clientEventId: canonical.clientEventId,
            payloadHash,
            payloadVersion: 1,
            batchLedgerMode: mode,
            batchTransferStatus: mode === 'OFF' ? 'OFF' : 'PENDING',
            notes: canonical.notes,
            items: preliminaryItems,
            createdBy: scopedUserId,
            createdAt: now,
        },
        select: { id: true },
    });

    const products = await lockProducts(tx, scopedTenantId, productIds);
    if (products.length !== productIds.length) {
        throw new StockTransferError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado en este negocio');
    }
    const productById = new Map(products.map(product => [product.id, product]));
    const lines = canonical.items.map(item => {
        const product = productById.get(item.productId);
        if (!product) throw new StockTransferError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado');
        try {
            return {
                product,
                quantity: validateStockTransferQuantity(item.quantity, product).toFixed(4),
            };
        } catch (error) {
            if (error instanceof QuantityValidationError) {
                throw new StockTransferError(error.code, 422, error.message);
            }
            throw error;
        }
    });

    for (const line of lines) {
        for (const warehouseId of warehouseIds) {
            const warehouse = warehouseId === from.id ? from : to;
            await materializeWarehouseRow(tx, {
                tenantId: scopedTenantId,
                productId: line.product.id,
                warehouseId,
                isDefault: warehouse.isDefault,
            });
        }
    }
    const lockedStocks = await lockProductStocks(tx, { tenantId: scopedTenantId, productIds, warehouseIds });
    if (lockedStocks.length !== productIds.length * 2) {
        throw new StockTransferError(
            'TRANSFER_STOCK_ROW_MISSING',
            409,
            'No se pudieron bloquear todas las existencias de la transferencia',
        );
    }

    const aggregateSnapshot = await executeAggregateMovements(tx, {
        tenantId: scopedTenantId,
        userId: scopedUserId,
        transferId: header.id,
        from,
        to,
        lines,
        lockedStocks,
    });
    const batchSnapshot = mode === 'OFF'
        ? null
        : await applyBatchTransfer(tx, {
            mode,
            tenantId: scopedTenantId,
            userId: scopedUserId,
            transferId: header.id,
            from,
            to,
            lines,
        });
    const batchTransferStatus = batchSnapshot?.status ?? 'OFF';
    const finalItems = lines.map(line => ({
        productId: line.product.id,
        name: line.product.name,
        quantity: line.quantity,
    }));
    const finalized = await tx.stockTransfer.updateMany({
        where: { id: header.id, tenantId: scopedTenantId, clientEventId: canonical.clientEventId },
        data: {
            items: finalItems,
            batchTransferStatus,
            ...(batchSnapshot === null
                ? {}
                : { batchSnapshot: batchSnapshot as unknown as Prisma.InputJsonValue }),
        },
    });
    if (finalized.count !== 1) {
        throw new StockTransferError(
            'STOCK_TRANSFER_FINALIZE_FAILED',
            409,
            'No se pudo finalizar la transferencia bloqueada',
        );
    }

    await tx.auditLog.create({
        data: {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            action: 'STOCK_TRANSFER',
            details: JSON.stringify({
                transferId: header.id,
                clientEventId: canonical.clientEventId,
                from: { id: from.id, name: from.name },
                to: { id: to.id, name: to.name },
                before: aggregateSnapshot.map(item => ({
                    productId: item.productId,
                    sourceStock: item.from.stockBefore,
                    destinationStock: item.to.stockBefore,
                })),
                after: aggregateSnapshot.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    sourceStock: item.from.stockAfter,
                    destinationStock: item.to.stockAfter,
                })),
                batch: batchSnapshot,
            }),
        },
    });

    const transfer = await tx.stockTransfer.findFirst({
        where: { id: header.id, tenantId: scopedTenantId },
        select: transferSelect,
    }) as StockTransferRecord | null;
    if (!transfer) {
        throw new StockTransferError(
            'STOCK_TRANSFER_FINALIZE_FAILED',
            409,
            'No se pudo releer la transferencia finalizada',
        );
    }
    return { transfer, replay: false };
}

/**
 * Frontera HTTP: el P2002 aborta la tx perdedora y la relectura se hace en un
 * snapshot fresco, fuera de la transacción que ya quedó inválida.
 */
export async function executeStockTransferTransaction({
    db,
    tenantId,
    userId,
    request,
    now,
}: ExecuteStockTransferTransactionInput): Promise<StockTransferResult> {
    const scopedTenantId = tenantId.trim();
    const canonical: CanonicalStockTransferCommand = normalizeStockTransferCommand(request);
    const payloadHash = buildStockTransferPayloadHash({ tenantId: scopedTenantId, command: canonical });
    try {
        return await db.$transaction(
            tx => executeStockTransfer({ tx, tenantId, userId, request, now }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await findTransferByClientEvent(db, scopedTenantId, canonical.clientEventId);
        if (!existing) throw error;
        return serializeReplay(existing, payloadHash);
    }
}

export { StockTransferError };
