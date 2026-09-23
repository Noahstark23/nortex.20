import type { Prisma } from '@prisma/client';
import type { AssistantPrincipal } from '../../../shared/assistant.js';

export async function canManageAssistantBudget(principal: AssistantPrincipal, db: Pick<Prisma.TransactionClient, 'user'>): Promise<boolean> {
  const user = await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' }, select: { role: true, assistantBudgetOwner: true } });
  if (!user || user.role !== principal.role) return false;
  if (user.role === 'OWNER') return true;
  // La concesión pertenece a la identidad; un expediente de RRHH no concede permisos.
  return user.role === 'ADMIN' && user.assistantBudgetOwner === true;
}
