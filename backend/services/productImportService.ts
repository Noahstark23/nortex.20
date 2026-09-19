import Decimal from 'decimal.js';
import { type Prisma, type PrismaClient, type Product } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { BulkImportProductsSchema, CreateProductSchema } from '../validation/schemas.js';
import { ManualBatchMovementError, assertAggregateBatchMutationAllowed, assertBatchTrackingTransitionAllowed } from '../lib/manualBatchMovements.js';
import { resolveBatchWarehouseLedgerMode } from './productBatchWarehouseLedgerService.js';
import { assertBaseUnitChangeAllowed, QuantityValidationError } from '../../utils/quantity.js';
import { applyStockDelta, asegurarBodegaPorDefecto, resolveOperationalWarehouse, StockError } from './stockService.js';
import { withPromotionPriceVersion } from './promotions/productVersion.js';

type Principal = {tenantId: string; userId: string; role: string};
type ImportResult = {created: number; updated: number; errors: string[]; total: number; message: string};
type ImportRow = Record<string, unknown>;
const roles = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

export class ProductImportError extends Error {
  constructor(message: string, public readonly httpStatus = 400) { super(message); this.name = 'ProductImportError'; }
}

function firstPresent(row: ImportRow, ...keys: string[]): unknown {
  const key = keys.find(key => Object.prototype.hasOwnProperty.call(row, key)
    && row[key] !== undefined && row[key] !== null
    && !(typeof row[key] === 'string' && String(row[key]).trim() === ''));
  return key === undefined ? undefined : row[key];
}

/** El esquema recibe el estado FINAL bloqueado, incluidos umbrales que el Excel no expone. */
function normalizeRow(row: ImportRow, sku: string, name: string, existing: Product | null) {
  const value = (...keys: string[]) => firstPresent(row, ...keys);
  const saleMode = value('saleMode', 'modoVenta', 'modo_venta');
  const family = value('productFamily', 'familiaProducto', 'familia_producto');
  const legacy = saleMode !== undefined && String(saleMode).trim().toUpperCase() === 'LEGACY';
  const parsed = CreateProductSchema.safeParse({
    sku, name,
    brand: value('brand', 'marca') ?? existing?.brand ?? undefined,
    description: value('description', 'descripcion') ?? existing?.description ?? undefined,
    category: value('category', 'categoria') ?? existing?.category ?? 'General',
    price: value('price', 'precio') ?? existing?.price ?? 0,
    cost: value('cost', 'costo', 'costPrice') ?? existing?.cost ?? 0,
    stock: existing?.stock ?? value('stock', 'existencia') ?? 0,
    minStock: value('minStock', 'stockMinimo', 'stock_minimo') ?? existing?.minStock ?? 0,
    unit: value('unit', 'unidad') ?? existing?.unit ?? 'unidad',
    saleMode: saleMode === undefined || legacy ? existing?.saleMode ?? null : String(saleMode).trim().toUpperCase(),
    quantityStep: (!legacy ? value('quantityStep', 'pasoCantidad', 'paso_cantidad') : undefined) ?? existing?.quantityStep?.toString() ?? null,
    productFamily: family === undefined ? existing?.productFamily ?? null : String(family).trim().toUpperCase(),
    packUnit: value('packUnit', 'unidadEmpaque', 'unidad_empaque') ?? existing?.packUnit ?? null,
    packSize: value('packSize', 'tamanoEmpaque', 'tamano_empaque') ?? existing?.packSize ?? null,
    packPrice: value('packPrice', 'precioEmpaque', 'precio_empaque') ?? existing?.packPrice ?? null,
    requiresBatchTracking: value('requiresBatchTracking', 'requiereLote', 'requiere_lote') ?? existing?.requiresBatchTracking ?? false,
    ivaExento: value('ivaExento', 'iva_exento') ?? existing?.ivaExento ?? false,
    reorderPoint: existing?.reorderPoint ?? 0,
    maxStock: existing?.maxStock ?? 0,
    wholesalePrice: existing?.wholesalePrice ?? null,
    wholesaleMinQty: existing?.wholesaleMinQty ?? null,
  });
  if (!parsed.success) throw new ProductImportError(parsed.error.issues.map(issue => issue.message).join('; '));
  return parsed.data;
}

/** Conserva contratos abiertos al cambiar la unidad; páginas acotadas para pedidos JSON legacy. */
async function hasOpenCommitments(tx: Prisma.TransactionClient, tenantId: string, productId: string): Promise<boolean> {
  const [purchase, pedido, quotation] = await Promise.all([
    tx.purchaseOrderItem.findFirst({where: {productId, purchaseOrder: {tenantId, status: {in: ['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED']}}}, select: {id: true}}),
    tx.pedidoItem.findFirst({where: {productoId: productId, pedido: {tenantId, estado: {notIn: ['entregado', 'cancelado']}}}, select: {id: true}}),
    tx.quotationItem.findFirst({where: {productId, quotation: {tenantId, status: 'SENT', expiresAt: {gte: new Date()}}}, select: {id: true}}),
  ]);
  if (purchase || pedido || quotation) return true;
  let cursor: string | undefined;
  for (;;) {
    const orders = await tx.publicOrder.findMany({where: {tenantId, status: 'PENDING'}, select: {id: true, items: true},
      orderBy: {id: 'asc'}, take: 100, ...(cursor ? {cursor: {id: cursor}, skip: 1} : {})});
    if (orders.some(order => Array.isArray(order.items) && order.items.some(item => item && typeof item === 'object' && !Array.isArray(item) && item.productId === productId))) return true;
    if (orders.length < 100) return false;
    cursor = orders[orders.length - 1].id;
  }
}

function auditSnapshot(product: Product) {
  return {sku: product.sku, name: product.name, description: product.description, brand: product.brand, category: product.category,
    price: String(product.price), cost: String(product.cost), stock: String(product.stock),
    minStock: product.minStock, unit: product.unit, saleMode: product.saleMode,
    quantityStep: product.quantityStep?.toString() ?? null, productFamily: product.productFamily,
    packUnit: product.packUnit, packSize: product.packSize, packPrice: product.packPrice,
    requiresBatchTracking: product.requiresBatchTracking, ivaExento: product.ivaExento};
}

async function importRow(tx: Prisma.TransactionClient, principal: Principal, item: ImportRow, sku: string, name: string, warehouseId?: string) {
  const {tenantId, userId} = principal;
  // La revocación entre filas se detecta antes de empezar la siguiente escritura.
  const [user] = await tx.$queryRaw<Array<{role: string; status: string}>>`
    SELECT role, status FROM \`User\` WHERE id = ${userId} AND tenantId = ${tenantId} FOR UPDATE`;
  if (!user || user.status !== 'ACTIVE' || user.role !== principal.role || !roles.includes(user.role)) {
    throw new ProductImportError('Tu sesión o permiso cambió. Volvé a ingresar.', 403);
  }
  const locked = await tx.$queryRaw<Array<{id: string}>>`
    SELECT id FROM \`Product\` WHERE tenantId = ${tenantId} AND sku = ${sku} FOR UPDATE`;
  // Prisma normaliza BOOL de MySQL. El raw devuelve 0/1 y no sirve como dato Boolean de update.
  const existing = locked.length ? await tx.product.findFirstOrThrow({where: {id: locked[0].id, tenantId}}) : null;
  if (existing && firstPresent(item, 'stock', 'existencia') !== undefined) {
    throw new ProductImportError('Este código ya existe. Actualizá el catálogo sin existencias; para cambiar stock usá un conteo o ajuste en su bodega.');
  }
  const normalized = normalizeRow(item, sku, name, existing);
  const mode = await resolveBatchWarehouseLedgerMode(tx, tenantId);
  const targetStock = new Decimal(normalized.stock).toNumber();
  const data = {
    name: normalized.name, brand: normalized.brand || null, description: normalized.description || null, category: normalized.category || null,
    price: new Decimal(normalized.price).toNumber(), cost: new Decimal(normalized.cost ?? 0).toNumber(),
    minStock: new Decimal(normalized.minStock).toNumber(), unit: normalized.unit,
    saleMode: normalized.saleMode ?? null, quantityStep: normalized.quantityStep || null,
    productFamily: normalized.productFamily ?? null, packUnit: normalized.packUnit || null,
    packSize: normalized.packSize ? new Decimal(normalized.packSize).toNumber() : null,
    packPrice: normalized.packPrice ? new Decimal(normalized.packPrice).toNumber() : null,
    requiresBatchTracking: Boolean(normalized.requiresBatchTracking), ivaExento: Boolean(normalized.ivaExento),
  };
  if (existing) {
    if (existing.requiresBatchTracking !== data.requiresBatchTracking) {
      const batchHistory = existing.requiresBatchTracking && !data.requiresBatchTracking
        ? await tx.productBatch.findFirst({where: {tenantId, productId: existing.id}, select: {id: true}}) : null;
      assertBatchTrackingTransitionAllowed({mode, currentRequiresBatchTracking: existing.requiresBatchTracking,
        nextRequiresBatchTracking: data.requiresBatchTracking, currentStock: existing.stock, hasBatchHistory: Boolean(batchHistory)});
    }
    if (normalized.unit.trim().toLowerCase() !== existing.unit.trim().toLowerCase()) {
      const [movement, openCommitments] = await Promise.all([
        tx.kardexMovement.findFirst({where: {tenantId, productId: existing.id}, select: {id: true}}),
        hasOpenCommitments(tx, tenantId, existing.id),
      ]);
      assertBaseUnitChangeAllowed({currentUnit: existing.unit, nextUnit: normalized.unit, stock: existing.stock,
        hasMovements: Boolean(movement), hasOpenCommitments: openCommitments});
    }
    const after = await tx.product.update({where: {id: existing.id, tenantId}, data: await withPromotionPriceVersion(tx, tenantId, existing.id, data)});
    if (!new Decimal(existing.price).equals(data.price) || !new Decimal(existing.cost).equals(data.cost)) {
      await tx.auditLog.create({data: {tenantId, userId, action: 'PRICE_CHANGED', details: JSON.stringify({
        productId: existing.id, priceBefore: String(existing.price), priceAfter: String(data.price),
        costBefore: String(existing.cost), costAfter: String(data.cost), origen: 'BULK_IMPORT',
      })}});
    }
    await tx.auditLog.create({data: {tenantId, userId, action: 'PRODUCT_BULK_UPDATED', details: JSON.stringify({
      productId: existing.id, before: auditSnapshot(existing), after: auditSnapshot(after),
    })}});
    return 'updated' as const;
  }
  assertAggregateBatchMutationAllowed({mode, requiresBatchTracking: data.requiresBatchTracking, delta: targetStock});
  const warehouse = targetStock > 0 ? await resolveOperationalWarehouse(tx, tenantId, warehouseId) : undefined;
  const product = await tx.product.create({data: {...data, tenantId, sku, stock: 0, createdBy: userId}});
  if (targetStock > 0) {
    const stockResult = await applyStockDelta(tx, {tenantId, productId: product.id, delta: targetStock, enforceSufficient: false, warehouseId: warehouse!.id});
    await tx.kardexMovement.create({data: {tenantId, productId: product.id, type: 'IN', quantity: targetStock,
      stockBefore: stockResult.stockBefore, stockAfter: stockResult.stockAfter, referenceType: 'BULK_IMPORT',
      reason: 'Carga masiva - producto nuevo', userId, warehouseId: stockResult.warehouseId}});
  }
  await tx.auditLog.create({data: {tenantId, userId, action: 'PRODUCT_CREATED', details: JSON.stringify({
    productId: product.id, source: 'BULK_IMPORT', warehouseId: warehouse?.id ?? null,
    after: {...auditSnapshot(product), stock: String(targetStock)},
  })}});
  return 'created' as const;
}

function publicRowError(error: unknown): string {
  if (error instanceof ProductImportError || error instanceof QuantityValidationError
      || error instanceof ManualBatchMovementError || error instanceof StockError) return error.message;
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    return 'El código se creó en otra operación. Revisá el catálogo antes de reintentar.';
  }
  return 'No se pudo guardar esta fila. Sus cambios no se aplicaron; intentá nuevamente.';
}

/** Una fila rechazada nunca confirma producto, stock, precio o auditoría parcialmente. */
export async function executeProductImport(
  {principal, input: raw}: {principal: Principal; input: unknown}, db: PrismaClient = prisma,
): Promise<ImportResult> {
  const input = BulkImportProductsSchema.parse(raw);
  if (!principal.tenantId || !principal.userId || !roles.includes(principal.role)) {
    throw new ProductImportError('Tu rol no puede importar productos.', 403);
  }
  await asegurarBodegaPorDefecto(db, principal.tenantId);
  const counts = {created: 0, updated: 0};
  const errors: string[] = [];
  for (const [index, item] of input.products.entries()) {
    const excelRow = Number(item.excelRow);
    const rowNumber = Number.isInteger(excelRow) && excelRow >= 2 ? excelRow : index + 2;
    const sku = String(item.sku ?? '').trim().toUpperCase();
    const name = String(item.name ?? item.nombre ?? '').trim();
    if (!sku || !name) { errors.push(`Fila ${rowNumber}: sin código o sin nombre`); continue; }
    try {
      const action = await db.$transaction(tx => importRow(tx, principal, item, sku, name, input.warehouseId),
        {isolationLevel: 'ReadCommitted', timeout: 15000});
      counts[action]++;
    } catch (error) {
      errors.push(`Fila ${rowNumber} (${sku.slice(0, 100)}): ${publicRowError(error)}`);
    }
  }
  return {message: `Importación completada: ${counts.created} creados, ${counts.updated} actualizados`,
    ...counts, errors, total: input.products.length};
}
