import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { WriteoffBatchSchema } from '../validation/schemas.js';
import { validateQuantity } from '../../utils/quantity.js';
import { batchExpiryDayStart } from '../../utils/batchExpiry.js';
import { purchasePayloadHash } from './purchaseRegistrationAuthority.js';
import { resolveOperationalWarehouse, StockError } from './stockService.js';
import { resolveBatchWarehouseLedgerMode } from './productBatchWarehouseLedgerService.js';
import { assertPeriodOpen } from './accounting.js';
import { calculateBatchWriteoffValue } from './batchWriteoffValue.js';

export type BatchWriteoffPrincipal = {tenantId: string; userId: string; role: string};
type Database = PrismaClient | Prisma.TransactionClient;
export const BATCH_WRITEOFF_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];
export const batchWriteoffDraftSchema = WriteoffBatchSchema.omit({clientEventId: true}).extend({
  batchId: z.string().trim().min(1).max(191),
}).strict();
export class BatchWriteoffError extends Error {
  constructor(readonly code: string, readonly httpStatus: number, message: string) {super(message); this.name = 'BatchWriteoffError';}
}
export async function assertBatchWriteoffPrincipal(principal: BatchWriteoffPrincipal, db: Database, lock = false) {
  if (!principal.tenantId || !principal.userId || !BATCH_WRITEOFF_ROLES.includes(principal.role)) throw new BatchWriteoffError('BATCH_WRITEOFF_FORBIDDEN', 403, 'Tu usuario no puede dar de baja lotes.');
  const actor = lock
    ? (await db.$queryRaw<Array<{id: string; status: string; role: string}>>`SELECT id, status, role FROM \`User\` WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`)[0]
    : await db.user.findFirst({where: {id: principal.userId, tenantId: principal.tenantId}, select: {id: true, status: true, role: true}});
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== principal.role) throw new BatchWriteoffError('BATCH_WRITEOFF_FORBIDDEN', 403, 'Tu sesión o permiso cambió. Volvé a ingresar.');
}

/** Sólo lecturas: el saldo implícito de Principal se calcula sin sembrar filas. */
export async function prepareBatchWriteoff(principal: BatchWriteoffPrincipal, raw: unknown, db: Database = prisma) {
  await assertBatchWriteoffPrincipal(principal, db);
  const draft = batchWriteoffDraftSchema.parse(raw);
  const batch = await db.productBatch.findFirst({where: {id: draft.batchId, tenantId: principal.tenantId}, include: {product: true}});
  if (!batch || batch.product.tenantId !== principal.tenantId) throw new BatchWriteoffError('BATCH_NOT_FOUND', 404, 'El lote no existe en tu negocio.');
  const product = batch.product;
  const warehouse = await resolveOperationalWarehouse(db, principal.tenantId, draft.warehouseId);
  const rules = {saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' as const : 'MEASURED' as const, quantityStep: product.quantityStep?.toString() || (product.saleMode === 'COUNTED' ? '1' : '0.0001')};
  const quantity = validateQuantity(draft.quantity, rules);
  const cost = new Decimal(product.cost.toString());
  if (!cost.isFinite() || cost.isNegative()) throw new BatchWriteoffError('BATCH_COST_INVALID', 409, 'El costo del producto necesita revisión.');
  const local = await db.productStock.findFirst({where: {tenantId: principal.tenantId, productId: product.id, warehouseId: warehouse.id}, select: {stock: true}});
  const other = !local && warehouse.isDefault ? await db.productStock.aggregate({where: {tenantId: principal.tenantId, productId: product.id, warehouseId: {not: warehouse.id}}, _sum: {stock: true}}) : null;
  const localStock = new Decimal(local?.stock?.toString() ?? (warehouse.isDefault ? new Decimal(product.stock.toString()).minus(other?._sum.stock?.toString() ?? 0).toString() : '0'));
  const batchStock = new Decimal(batch.stock.toString());
  if (quantity.gt(localStock) || quantity.gt(batchStock) || quantity.gt(product.stock.toString())) throw new StockError('INSUFFICIENT_STOCK', 'El saldo del lote o la bodega no alcanza para esta merma.');
  const mode = await resolveBatchWarehouseLedgerMode(db, principal.tenantId);
  const batchLocal = await db.productBatchWarehouseStock.findFirst({where: {tenantId: principal.tenantId, batchId: batch.id, warehouseId: warehouse.id}, select: {stock: true}});
  if (mode !== 'OFF' && (!batchLocal || quantity.gt(batchLocal.stock.toString()))) throw new BatchWriteoffError('BATCH_WAREHOUSE_REVIEW_REQUIRED', 409, 'El saldo del lote en esta bodega necesita conciliación antes de preparar la merma.');
  await assertPeriodOpen(db, principal.tenantId, new Date());
  const authority = {
    draft: {...draft, quantity: quantity.toFixed(4)},
    product: {id: product.id, name: product.name, unit: product.unit, cost: cost.toString(), stock: new Decimal(product.stock.toString()).toFixed(4), ...rules},
    batch: {id: batch.id, number: batch.batchNumber, expiryDate: batch.expiryDate.toISOString().slice(0, 10), stock: batchStock.toFixed(4)},
    warehouse: {...warehouse, stock: localStock.toFixed(4)},
    batchWarehouseStock: batchLocal?.stock?.toString() ?? null, mode,
    asOfDay: batchExpiryDayStart().toISOString(),
    lossValue: calculateBatchWriteoffValue(quantity, cost).toFixed(2),
  };
  return {...authority, hash: purchasePayloadHash(authority)};
}
