import type { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';

type Principal = {tenantId: string; userId: string; role: string};
export class ProductDeletionError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
    super(message); this.name = 'ProductDeletionError';
  }
}

/**
 * Product tiene cascadas sobre evidencia y documentos sin FK. Un guard de
 * saldo/historial no cierra la carrera documental: hasta un archivo coherente
 * con todos los consumidores, este endpoint conserva siempre la ficha.
 */
export async function rejectProductDeletion(
  {principal, productId}: {principal: Principal; productId: string}, db: Pick<PrismaClient, 'product'> = prisma,
): Promise<never> {
  if (!principal.tenantId || !principal.userId || !['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(principal.role)) {
    throw new ProductDeletionError('PRODUCT_DELETION_FORBIDDEN', 403, 'Tu rol no puede gestionar productos.');
  }
  const product = await db.product.findFirst({where: {id: productId, tenantId: principal.tenantId}, select: {id: true}});
  if (!product) throw new ProductDeletionError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado');
  throw new ProductDeletionError('PRODUCT_DELETION_DISABLED', 409,
    'Los productos se conservan para proteger su historial. Podés corregir su ficha u ocultarlo del catálogo público.');
}
