import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { BulkEditProductsSchema } from '../validation/schemas.js';
import { withPromotionPriceVersion } from './promotions/productVersion.js';
import { calculateProductBulkEditPrice } from './productBulkEditPrice.js';

export type ProductBulkEditPrincipal = {tenantId: string; userId: string; role: string};
export class ProductBulkEditError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
    super(message); this.name = 'ProductBulkEditError';
  }
}
const roles = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

/** Conserva la edición del formulario y confirma precios, versión comercial y auditoría juntos. */
export async function executeProductBulkEdit(
  {principal, input: raw}: {principal: ProductBulkEditPrincipal; input: unknown}, db: PrismaClient = prisma,
): Promise<{count: number}> {
  const input = BulkEditProductsSchema.parse(raw);
  if (!principal.tenantId || !principal.userId || !roles.includes(principal.role)) {
    throw new ProductBulkEditError('PRODUCT_BULK_FORBIDDEN', 403, 'Tu rol no puede editar precios o categorías de forma masiva.');
  }
  return db.$transaction(async tx => {
    const [user] = await tx.$queryRaw<Array<{id: string; role: string; status: string}>>`
      SELECT id, role, status FROM \`User\` WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
    if (!user || user.status !== 'ACTIVE' || user.role !== principal.role || !roles.includes(user.role)) {
      throw new ProductBulkEditError('PRODUCT_BULK_SESSION_REVOKED', 403, 'Tu sesión o permiso cambió. Volvé a ingresar.');
    }
    // Lectura actual bajo lock, ordenada para dos lotes parcialmente solapados.
    // El porcentaje siempre se calcula sobre el precio de la operación anterior confirmada.
    const products = await tx.$queryRaw<Array<{id: string; price: number}>>(Prisma.sql`
      SELECT id, price FROM \`Product\` WHERE tenantId = ${principal.tenantId}
      AND id IN (${Prisma.join([...new Set(input.ids)].sort())}) ORDER BY id FOR UPDATE`);
    const priceChanges: Array<{id: string; priceBefore: string; priceAfter: string}> = [];
    for (const product of products) {
      const data: {price?: number; category?: string} = {};
      if (input.category !== undefined) data.category = input.category;
      if (input.priceMode) {
        const before = new Decimal(product.price.toString());
        const after = calculateProductBulkEditPrice(before, input.priceMode, input.priceValue!);
        data.price = after.toNumber();
        priceChanges.push({id: product.id, priceBefore: before.toFixed(2), priceAfter: after.toFixed(2)});
      }
      await tx.product.update({where: {id: product.id, tenantId: principal.tenantId},
        data: await withPromotionPriceVersion(tx, principal.tenantId, product.id, data)});
    }
    await tx.auditLog.create({data: {
      tenantId: principal.tenantId, userId: principal.userId, action: 'PRODUCT_BULK_EDIT',
      details: JSON.stringify({count: products.length, requestedIds: input.ids.length,
        category: input.category ?? null, priceMode: input.priceMode ?? null, priceValue: input.priceValue ?? null,
        priceChanges, timestamp: new Date().toISOString()}),
    }});
    return {count: products.length};
  }, {isolationLevel: 'ReadCommitted', timeout: 15000});
}
