import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import Decimal from 'decimal.js';
import { WriteoffBatchSchema } from '../validation/schemas.js';
import { validateQuantity } from '../../utils/quantity.js';
import { createJournalEntry, assertPeriodOpen } from './accounting.js';
import { applyStockDelta, materializeWarehouseRow, resolveOperationalWarehouse, StockError } from './stockService.js';
import { applyBatchWarehouseDelta, resolveBatchWarehouseLedgerMode, BatchWarehouseLedgerError } from './productBatchWarehouseLedgerService.js';
import { buildManualBatchCommandId, buildManualBatchRelatedId, buildManualBatchPayloadHash, ManualBatchMovementError } from '../lib/manualBatchMovements.js';
import { loadBatchWriteoffReplay } from './batchWriteoffIdempotency.js';
import { calculateBatchWriteoffValue } from './batchWriteoffValue.js';
import { prepareBatchWriteoff, assertBatchWriteoffPrincipal, BatchWriteoffError, type BatchWriteoffPrincipal } from './batchWriteoffPreparation.js';
export { prepareBatchWriteoff, BatchWriteoffError } from './batchWriteoffPreparation.js';
type ManualBatchCommandResponse = Record<string, unknown>;
export interface BatchWriteoffExecution {
    principal: BatchWriteoffPrincipal;
    batchId: string;
    input: unknown;
    expectedPreviewHash?: string;
    beforeCommit?: (tx: Prisma.TransactionClient, result: ManualBatchCommandResponse) => Promise<void>;
}
function command(input: BatchWriteoffExecution) {
    const parsed = WriteoffBatchSchema.parse(input.input);
    const commandType = 'MANUAL_BATCH_WRITEOFF' as const;
    const commandId = buildManualBatchCommandId({tenantId: input.principal.tenantId, clientEventId: parsed.clientEventId, commandType});
    const payloadHash = buildManualBatchPayloadHash(commandType, [input.principal.tenantId, input.principal.userId, input.batchId, parsed.warehouseId, new Decimal(parsed.quantity).toFixed(4), parsed.reason]);
    return {...parsed, commandType, commandId, payloadHash, resultAuditId: buildManualBatchRelatedId(commandId, 'RESULT'), movementId: buildManualBatchRelatedId(commandId, 'MOVEMENT')};
}

/** Dominio compartido: quien compone otra operación conserva esta misma transacción. */
export async function executeBatchWriteoffInTransaction(args: BatchWriteoffExecution, tx: Prisma.TransactionClient) {
    const {principal, batchId, expectedPreviewHash, beforeCommit} = args;
    const {clientEventId, quantity, reason, warehouseId: requestedWarehouseId, commandType, commandId, payloadHash, resultAuditId, movementId} = command(args);
    await assertBatchWriteoffPrincipal(principal, tx, true);
    const replay = await loadBatchWriteoffReplay(tx, {tenantId: principal.tenantId, commandId, commandType, payloadHash});
    if (replay) return {result: replay, replayed: true};
    const mode = await resolveBatchWarehouseLedgerMode(tx, principal.tenantId);
    const operationWarehouse = await resolveOperationalWarehouse(
        tx, principal.tenantId, requestedWarehouseId,
    );
    const batchHint = await tx.productBatch.findFirst({
        where: { id: batchId, tenantId: principal.tenantId },
        select: { productId: true },
    });
    if (!batchHint) throw new BatchWarehouseLedgerError(
        'BATCH_WAREHOUSE_BATCH_NOT_FOUND', 404, 'Lote no encontrado.',
    );
    const productRows: Array<{
        id: string;
        name: string;
        cost: any;
        saleMode: string | null;
        quantityStep: any;
    }> = await tx.$queryRaw`
        SELECT id, name, cost, saleMode, quantityStep
        FROM \`Product\`
        WHERE id = ${batchHint.productId} AND tenantId = ${principal.tenantId}
        FOR UPDATE`;
    const product = productRows[0];
    if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');
    const batchRows: Array<{
        id: string;
        productId: string;
        batchNumber: string;
        expiryDate: Date;
        stock: any;
    }> = await tx.$queryRaw`
        SELECT id, productId, batchNumber, expiryDate, stock
        FROM \`ProductBatch\`
        WHERE id = ${batchId} AND tenantId = ${principal.tenantId}
        FOR UPDATE`;
    const batch = batchRows[0];
    if (!batch || batch.productId !== product.id) throw new BatchWarehouseLedgerError(
        'BATCH_WAREHOUSE_BATCH_NOT_FOUND', 404, 'Lote no encontrado.',
    );
    const writeoffQuantity = validateQuantity(quantity, {saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED', quantityStep: product.quantityStep?.toString() || (product.saleMode === 'COUNTED' ? '1' : '0.0001')});
    const writeoffQuantityExact = writeoffQuantity.toFixed(4);
    const batchStockBefore = new Decimal(batch.stock.toString());
    if (batchStockBefore.lessThan(writeoffQuantity)) {
        throw new StockError(
            'INSUFFICIENT_STOCK',
            `El lote solo tiene ${batchStockBefore.toString()} disponibles en total.`,
        );
    }
    await assertPeriodOpen(tx, principal.tenantId, new Date());
    if (expectedPreviewHash) {
        const preview = await prepareBatchWriteoff(principal, {batchId, warehouseId: requestedWarehouseId, quantity, reason}, tx);
        if (preview.hash !== expectedPreviewHash) throw new BatchWriteoffError('BATCH_WRITEOFF_CHANGED', 409, 'El lote, costo o saldo cambió. Volvé a revisar la merma.');
    }

    await tx.auditLog.create({
        data: {
            id: commandId,
            tenantId: principal.tenantId,
            userId: principal.userId,
            action: 'MANUAL_BATCH_COMMAND',
            details: JSON.stringify({
                version: 1,
                commandType,
                payloadHash,
                resultAuditId,
                movementId,
                resourceId: batchId,
            }),
        },
    });

    const batchLedger = await applyBatchWarehouseDelta({
        tx,
        mode,
        tenantId: principal.tenantId,
        productId: product.id,
        batchId,
        warehouseId: operationWarehouse.id,
        delta: writeoffQuantity.negated().toFixed(4),
        movementType: 'WRITEOFF',
        referenceId: movementId,
        referenceType: 'KARDEX_MOVEMENT',
        userId: principal.userId,
        reason,
        sourceKey: `manual-batch-writeoff:${clientEventId}`,
        allowNegative: false,
    });
    if (batchLedger.replay) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT', 500,
            'El subledger ya contenía esta merma sin su claim de comando.',
        );
    }

    await materializeWarehouseRow(tx, {
        tenantId: principal.tenantId,
        productId: product.id,
        warehouseId: operationWarehouse.id,
        isDefault: operationWarehouse.isDefault,
    });
    const localRows: Array<{ stock: any }> = await tx.$queryRaw`
        SELECT stock FROM \`ProductStock\`
        WHERE tenantId = ${principal.tenantId}
          AND productId = ${product.id}
          AND warehouseId = ${operationWarehouse.id}
        FOR UPDATE`;
    if (!localRows[0]) throw new Error('No se pudo preparar el stock de la bodega seleccionada.');
    const localStockBefore = new Decimal(localRows[0].stock.toString());
    if (localStockBefore.lessThan(writeoffQuantity)) {
        throw new StockError(
            'INSUFFICIENT_STOCK',
            `Stock insuficiente en ${operationWarehouse.name}. Disponible: ${localStockBefore.toString()}.`,
        );
    }

    const stockResult = await applyStockDelta(tx, {
        tenantId: principal.tenantId,
        productId: product.id,
        delta: writeoffQuantity.negated().toNumber(),
        enforceSufficient: true,
        warehouseId: operationWarehouse.id,
    });
    const updatedBatch = await tx.productBatch.updateMany({
        where: {
            id: batchId,
            tenantId: principal.tenantId,
            stock: { gte: writeoffQuantity.toNumber() },
        },
        data: { stock: { decrement: writeoffQuantity.toNumber() } },
    });
    if (updatedBatch.count !== 1) {
        throw new StockError('INSUFFICIENT_STOCK', 'El saldo agregado del lote cambió concurrentemente.');
    }

    await tx.kardexMovement.create({
        data: {
            id: movementId,
            tenantId: principal.tenantId,
            productId: product.id,
            type: 'ADJUST_LOSS',
            quantity: writeoffQuantity.negated().toNumber(),
            stockBefore: localStockBefore.toNumber(),
            stockAfter: localStockBefore.minus(writeoffQuantity).toNumber(),
            referenceId: batchId,
            referenceType: 'BATCH_WRITEOFF',
            reason,
            userId: principal.userId,
            batchId,
            warehouseId: operationWarehouse.id,
        },
    });

    const lossValue = calculateBatchWriteoffValue(writeoffQuantity, product.cost?.toString() ?? '0');
    if (lossValue.greaterThan(0)) {
        // createJournalEntry conserva un contrato number legado; la
        // conversión ocurre solo después de cerrar el Decimal a 2dp.
        const journalValue = lossValue.toNumber();
        await createJournalEntry(
            tx, principal.tenantId, `Baja de lote vencido ${batch.batchNumber}`, batchId, 'BATCH_WRITEOFF', principal.userId,
            [
                { accountCode: '5.1.2', debit: journalValue, credit: 0 },
                { accountCode: '1.1.4', debit: 0, credit: journalValue },
            ]
        );
    }

    const response: ManualBatchCommandResponse = {
        message: `Lote ${batch.batchNumber}: baja de ${writeoffQuantityExact} uds. Merma: C$ ${lossValue.toFixed(2)}`,
        batchId,
        batchNumber: batch.batchNumber,
        quantity: writeoffQuantityExact,
        newStock: stockResult.stockAfter,
        warehouseId: operationWarehouse.id,
        warehouseStock: localStockBefore.minus(writeoffQuantity).toFixed(4),
        batchStock: batchStockBefore.minus(writeoffQuantity).toFixed(4),
        lossValue: lossValue.toFixed(2),
        batchWarehouseStatus: batchLedger.status,
    };
    await tx.auditLog.create({
        data: {
            id: resultAuditId,
            tenantId: principal.tenantId,
            userId: principal.userId,
            action: 'BATCH_WRITEOFF',
            details: JSON.stringify({
                version: 1,
                commandId,
                commandType,
                payloadHash,
                response,
            }),
        },
    });
    await beforeCommit?.(tx, response);
    return {result: response, replayed: false};
}

export async function executeBatchWriteoff(args: BatchWriteoffExecution, db: PrismaClient = prisma) {
    const current = command(args);
    await assertBatchWriteoffPrincipal(args.principal, db);
    const identity = {tenantId: args.principal.tenantId, commandId: current.commandId, commandType: current.commandType, payloadHash: current.payloadHash};
    const replay = await loadBatchWriteoffReplay(db, identity);
    if (replay) return {result: replay, replayed: true};
    try {
        return await db.$transaction(tx => executeBatchWriteoffInTransaction(args, tx), {isolationLevel: 'ReadCommitted'});
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            await assertBatchWriteoffPrincipal(args.principal, db);
            const replay = await loadBatchWriteoffReplay(db, identity);
            if (replay) return {result: replay, replayed: true};
        }
        throw error;
    }
}
