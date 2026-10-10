import type { Prisma } from '@prisma/client';

export async function assistantBudgetTenantId(db: Pick<Prisma.TransactionClient, 'tenant'>, tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { demoResetRootId: true } });
  if (!tenant) throw new Error('No se encontró la identidad del presupuesto.');
  return tenant.demoResetRootId ?? tenantId;
}
