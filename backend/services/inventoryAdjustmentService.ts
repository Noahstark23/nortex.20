import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { InventoryAdjustSchema } from '../validation/schemas.js';
import { BODEGUERO_ROLE } from '../security/bodegueroPolicy.js';
import { QuantityValidationError, validateQuantity } from '../../utils/quantity.js';
import { resolveProductQuantityRules } from '../../utils/productQuantityRules.js';
import { applyStockDelta, asegurarBodegaPorDefecto, materializeWarehouseRow, resolveOperationalWarehouse, StockError } from './stockService.js';
import { assertPeriodOpen, createJournalEntry, PeriodLockedError } from './accounting.js';
import { calculateBatchWriteoffValue } from './batchWriteoffValue.js';

type Database = Prisma.TransactionClient | PrismaClient;
type Principal = { tenantId: string; userId: string };
type AdjustmentResponse = Record<string, any>;
const commandType = 'INVENTORY_ADJUSTMENT';
const roles = ['OWNER', 'ADMIN', BODEGUERO_ROLE, 'SUPER_ADMIN'];
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export class InventoryAdjustmentError extends Error {
  constructor(readonly code: string, readonly httpStatus: number, message: string, readonly rejection?: Record<string, unknown>) {
    super(message); this.name = 'InventoryAdjustmentError';
  }
}

async function assertPrincipal(db: Database, principal: Principal) {
  const user = await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' }, select: { role: true } });
  if (!user || !roles.includes(user.role)) throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_FORBIDDEN', 403, 'Tu usuario no puede registrar ajustes de inventario.');
}

function parseCommand(principal: Principal, input: unknown) {
  const parsed = InventoryAdjustSchema.parse(input);
  const delta = new Decimal(parsed.quantity);
  const type = parsed.type ?? (delta.isNegative() ? 'ADJUST_LOSS' : 'ADJUST_GAIN');
  if (type !== 'ADJUST_LOSS' && type !== 'ADJUST_GAIN') {
    throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_DOCUMENT_REQUIRED', 409,
      type === 'IN_PURCHASE' ? 'Registrá esta entrada en Compras para conservar proveedor, costo y documento.' : 'Registrá la devolución desde su venta para conservar el documento y su efecto contable.');
  }
  if ((type === 'ADJUST_LOSS') !== delta.isNegative()) throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_DIRECTION', 400, 'La pérdida requiere cantidad negativa y el sobrante cantidad positiva.');
  const reason = parsed.reason?.trim();
  if (!reason || reason.length < 3) throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_REASON_REQUIRED', 400, 'La justificación es obligatoria para registrar una diferencia física.');
  // Sin UUID no es posible reconocer un reintento antiguo. La UI actual lo
  // envía; el UUID generado conserva la compatibilidad sin mezclar operaciones.
  const clientEventId = parsed.clientEventId ?? randomUUID();
  const commandId = hash([1, commandType, principal.tenantId, clientEventId]);
  return { ...parsed, clientEventId, delta, type, reason, commandId,
    movementId: hash([commandId, 'MOVEMENT']), resultId: hash([commandId, 'RESULT']),
    payloadHash: hash([1, commandType, principal.tenantId, principal.userId, parsed.productId, parsed.warehouseId ?? null, delta.toFixed(4), type, reason]) };
}
type Command = ReturnType<typeof parseCommand>;

const rejectionReceipt = (principal: Principal, command: Command) => ({
  id: command.resultId, ...principal, productId: command.productId, warehouseId: command.warehouseId ?? null,
  quantity: command.delta.toFixed(4), type: command.type, reason: command.reason, clientEventId: command.clientEventId,
});
const claimData = (principal: Principal, command: Command) => ({ id: command.commandId, ...principal, action: 'INVENTORY_ADJUSTMENT_COMMAND', details: JSON.stringify({ version: 1, commandType, payloadHash: command.payloadHash, resultId: command.resultId }) });

function businessRejection(error: unknown): InventoryAdjustmentError | null {
  if (error instanceof PeriodLockedError) return new InventoryAdjustmentError('FISCAL_PERIOD_CLOSED', 409, error.message);
  if (error instanceof QuantityValidationError) return new InventoryAdjustmentError(error.code, 400, error.message);
  if (error instanceof StockError) return new InventoryAdjustmentError(error.code,
    error.code === 'PRODUCT_NOT_FOUND' ? 404 : ['WAREHOUSE_REQUIRED', 'INSUFFICIENT_STOCK'].includes(error.code) ? 409 : 400, error.message);
  if (error instanceof InventoryAdjustmentError && ['BATCH_SELECTION_REQUIRED', 'SERIAL_SELECTION_REQUIRED'].includes(error.code)) return error;
  return null;
}

async function replay(db: Database, principal: Principal, command: Command): Promise<AdjustmentResponse | null> {
  const claim = await db.auditLog.findFirst({ where: { id: command.commandId, tenantId: principal.tenantId }, select: { action: true, details: true } });
  if (!claim) return null;
  let data: any;
  try { data = JSON.parse(claim.details ?? 'null'); } catch { data = null; }
  if (claim.action !== 'INVENTORY_ADJUSTMENT_COMMAND' || data?.version !== 1 || data?.commandType !== commandType || typeof data?.payloadHash !== 'string' || data?.resultId !== command.resultId) {
    throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_COMMAND_CORRUPT', 500, 'El registro del ajuste está incompleto. Revisá su evidencia antes de continuar.');
  }
  if (data.payloadHash !== command.payloadHash) throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_IDEMPOTENCY_CONFLICT', 409, 'Este identificador ya confirmó un ajuste diferente. Revisá el movimiento registrado.');
  const result = await db.auditLog.findFirst({ where: { id: command.resultId, tenantId: principal.tenantId }, select: { action: true, details: true } });
  let stored: any;
  try { stored = JSON.parse(result?.details ?? 'null'); } catch { stored = null; }
  if (result?.action === 'INVENTORY_ADJUSTMENT_REJECTED' && stored?.version === 1 && stored?.commandId === command.commandId && stored?.payloadHash === command.payloadHash
      && stored?.outcome === 'REJECTED' && [400, 404, 409].includes(stored.httpStatus) && typeof stored.code === 'string' && typeof stored.error === 'string'
      && JSON.stringify(stored.rejection) === JSON.stringify(rejectionReceipt(principal, command))) {
    throw new InventoryAdjustmentError(stored.code, stored.httpStatus, stored.error, stored.rejection);
  }
  if (result?.action !== 'INVENTORY_ADJUSTMENT' || stored?.version !== 1 || stored?.commandId !== command.commandId || stored?.payloadHash !== command.payloadHash || stored?.response?.movement?.id !== command.movementId) {
    throw new InventoryAdjustmentError('INVENTORY_ADJUSTMENT_COMMAND_INCOMPLETE', 500, 'El ajuste tiene un registro previo sin resultado íntegro. No se volverá a aplicar.');
  }
  return stored.response;
}

async function recordRejection(db: PrismaClient, principal: Principal, command: Command, error: InventoryAdjustmentError) {
  const rejection = rejectionReceipt(principal, command);
  try {
    await db.$transaction(async tx => {
      await assertPrincipal(tx, principal);
      // Compite con cualquier retry mediante la misma PK. Una vez confirmado,
      // este UUID no puede aplicarse aunque el stock o el período cambien.
      await tx.auditLog.create({ data: claimData(principal, command) });
      await tx.auditLog.create({ data: { id: command.resultId, ...principal, action: 'INVENTORY_ADJUSTMENT_REJECTED', details: JSON.stringify({ version: 1, commandId: command.commandId, payloadHash: command.payloadHash, outcome: 'REJECTED', httpStatus: error.httpStatus, code: error.code, error: error.message, rejection }) } });
    }, { isolationLevel: 'ReadCommitted' });
  } catch (failure) {
    if ((failure as { code?: string })?.code === 'P2002') {
      await assertPrincipal(db, principal);
      const winner = await replay(db, principal, command);
      if (winner) return { ...winner, replayed: true };
    }
    // Si la evidencia no se confirmó, no se entrega un recibo terminal.
    throw failure;
  }
  throw new InventoryAdjustmentError(error.code, error.httpStatus, error.message, rejection);
}

/** Reclamo, existencias, Kardex, asiento y evidencia se confirman juntos. */
export async function executeInventoryAdjustment(args: { principal: Principal; input: unknown }, db: PrismaClient = prisma) {
  const { principal } = args;
  await assertPrincipal(db, principal);
  const command = parseCommand(principal, args.input);
  const previous = await replay(db, principal, command);
  if (previous) return { ...previous, replayed: true };
  await asegurarBodegaPorDefecto(db, principal.tenantId);
  let claimAcquired = false;
  try {
    return await db.$transaction(async tx => {
      await assertPrincipal(tx, principal);
      // La PK del claim serializa dos entregas del mismo UUID antes de efectos.
      await tx.auditLog.create({ data: claimData(principal, command) });
      claimAcquired = true;
      const warehouse = await resolveOperationalWarehouse(tx, principal.tenantId, command.warehouseId);
      const rows = await tx.$queryRaw<Array<{ id: string; name: string; sku: string; unit: string; cost: number; saleMode: string | null; quantityStep: Prisma.Decimal | null; requiresBatchTracking: boolean | number; requiresSerialTracking: boolean | number }>>`
        SELECT id, name, sku, unit, cost, saleMode, quantityStep, requiresBatchTracking, requiresSerialTracking
        FROM Product WHERE id = ${command.productId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
      const product = rows[0];
      if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');
      // También en modo OFF: alterar únicamente el agregado deja los lotes
      // con otra existencia. Su entrada/merma debe identificar el lote.
      if (Boolean(product.requiresBatchTracking)) throw new InventoryAdjustmentError('BATCH_SELECTION_REQUIRED', 409, 'Este producto controla lotes. Registrá la entrada o merma desde sus lotes y elegí la bodega.');
      if (Boolean(product.requiresSerialTracking)) throw new InventoryAdjustmentError('SERIAL_SELECTION_REQUIRED', 409, 'Este producto controla números de serie. Identificá las unidades afectadas desde el control de series.');
      const magnitude = validateQuantity(command.delta.abs(), resolveProductQuantityRules({ ...product, quantityStep: product.quantityStep?.toString() }));
      const delta = command.delta.isNegative() ? magnitude.negated() : magnitude;
      const postingDate = new Date();
      // Se exige también cuando el costo es cero y no habrá asiento monetario.
      await assertPeriodOpen(tx, principal.tenantId, postingDate);
      await materializeWarehouseRow(tx, { tenantId: principal.tenantId, productId: product.id, warehouseId: warehouse.id, isDefault: warehouse.isDefault });
      const localBefore = await tx.productStock.findFirstOrThrow({ where: { tenantId: principal.tenantId, productId: product.id, warehouseId: warehouse.id }, select: { stock: true } });
      if (delta.isNegative() && new Decimal(localBefore.stock).lt(magnitude)) throw new StockError('INSUFFICIENT_STOCK', `Stock insuficiente en ${warehouse.name}. Disponible: ${localBefore.stock}.`);
      const stock = await applyStockDelta(tx, { tenantId: principal.tenantId, productId: product.id, warehouseId: warehouse.id, delta: delta.toNumber(), enforceSufficient: delta.isNegative() });
      const localAfter = await tx.productStock.findFirstOrThrow({ where: { tenantId: principal.tenantId, productId: product.id, warehouseId: warehouse.id }, select: { stock: true } });
      const movement = await tx.kardexMovement.create({ data: { id: command.movementId, ...principal, productId: product.id, warehouseId: warehouse.id, type: command.type, quantity: delta.toNumber(), stockBefore: localBefore.stock, stockAfter: localAfter.stock, referenceType: 'ADJUSTMENT', referenceId: command.commandId, reason: command.reason } });
      const value = calculateBatchWriteoffValue(magnitude, product.cost);
      if (value.gt(0)) {
        const amount = value.toNumber();
        // Mismas cuentas y valoración del conteo físico; referencia propia.
        const lines = delta.isNegative()
          ? [{ accountCode: '5.1.2', debit: amount, credit: 0 }, { accountCode: '1.1.4', debit: 0, credit: amount }]
          : [{ accountCode: '1.1.4', debit: amount, credit: 0 }, { accountCode: '4.1.3', debit: 0, credit: amount }];
        await createJournalEntry(tx, principal.tenantId, `Ajuste físico: ${product.name}`, movement.id, commandType, principal.userId, lines, { date: postingDate });
      }
      const response = { message: `Ajuste registrado en ${warehouse.name}: ${product.name} → ${localAfter.stock}`, movement, newStock: stock.stockAfter, warehouseStock: localAfter.stock, aggregateStock: stock.stockAfter, adjustmentValue: value.toFixed(2), clientEventId: command.clientEventId };
      await tx.auditLog.create({ data: { id: command.resultId, ...principal, action: 'INVENTORY_ADJUSTMENT', details: JSON.stringify({ version: 1, commandId: command.commandId, payloadHash: command.payloadHash, productId: product.id, productName: product.name, sku: product.sku, movementType: command.type, warehouseId: warehouse.id, warehouseName: warehouse.name, direction: delta.isNegative() ? 'LOSS' : 'GAIN', quantity: delta.toFixed(4), warehouseStockBefore: localBefore.stock, warehouseStockAfter: localAfter.stock, aggregateStockBefore: stock.stockBefore, aggregateStockAfter: stock.stockAfter, reason: command.reason, adjustmentValue: value.toFixed(2), response }) } });
      return { ...response, replayed: false };
    }, { isolationLevel: 'ReadCommitted' });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      await assertPrincipal(db, principal);
      const stored = await replay(db, principal, command);
      if (stored) return { ...stored, replayed: true };
    }
    // $transaction ya terminó el rollback. Errores transitorios/SQL, permisos,
    // payload previo al claim o evidencia corrupta permanecen sin confirmación.
    const rejection = claimAcquired ? businessRejection(error) : null;
    if (rejection) return recordRejection(db, principal, command, rejection);
    throw error;
  }
}
