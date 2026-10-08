import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../shared/assistant.js';
import { AssistantAccessError } from './access.js';
import { AssistantDocumentError } from './attachments.js';

const ownershipInput = z.object({
  targetTenantId: z.string().trim().min(1).max(191),
  targetUserId: z.string().trim().min(1).max(191),
  granted: z.boolean(),
  reason: z.string().trim().min(10).max(500),
}).strict();

type Dependencies = { db?: typeof prisma };
export interface AssistantBudgetOwnershipResult {
  tenantId: string;
  userId: string;
  assistantBudgetOwner: boolean;
  changed: boolean;
}

async function authorizePlatform(principal: AssistantPrincipal, db: Pick<Prisma.TransactionClient, 'user'>) {
  if (!principal.userId || !principal.tenantId || principal.role !== 'SUPER_ADMIN') {
    throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu sesión no tiene permiso para conceder esta autorización.');
  }
  const actor = await db.user.findFirst({ where: {
    id: principal.userId, tenantId: principal.tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE',
  }, select: { id: true } });
  if (!actor) {
    throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu sesión no tiene permiso para conceder esta autorización.');
  }
}

/** Concesión puntual tras verificar al dueño; nunca se infiere desde RRHH ni cambia consumo. */
export async function setAssistantBudgetOwnership(principal: AssistantPrincipal, input: unknown, deps: Dependencies = {}): Promise<AssistantBudgetOwnershipResult> {
  const parsed = ownershipInput.parse(input), db = deps.db ?? prisma;
  await authorizePlatform(principal, db);
  if (principal.userId === parsed.targetUserId || principal.tenantId === parsed.targetTenantId) {
    throw new AssistantDocumentError('BUDGET_OWNERSHIP_SELF_CHANGE', 'La autorización requiere revisión desde otra cuenta de Nortex.', 403);
  }
  return db.$transaction(async tx => {
    // Orden global por User.id; dos cambios cruzados no invierten la adquisición de locks.
    const identities = [
      { id: principal.userId, tenantId: principal.tenantId },
      { id: parsed.targetUserId, tenantId: parsed.targetTenantId },
    ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const identity of identities) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id = ${identity.id} AND tenantId = ${identity.tenantId} FOR UPDATE`);
    }
    await authorizePlatform(principal, tx);
    const target = await tx.user.findFirst({ where: { id: parsed.targetUserId, tenantId: parsed.targetTenantId },
      select: { id: true, tenantId: true, role: true, status: true, assistantBudgetOwner: true } });
    if (!target) throw new AssistantDocumentError('BUDGET_OWNER_NOT_FOUND', 'No encontramos esa cuenta en el negocio indicado.', 404);
    if (parsed.granted && (target.role !== 'ADMIN' || target.status !== 'ACTIVE')) {
      throw new AssistantDocumentError('BUDGET_OWNER_INELIGIBLE', 'La concesión requiere una cuenta ADMIN activa y verificada por Nortex.', 409);
    }
    const result = { tenantId: target.tenantId, userId: target.id, assistantBudgetOwner: parsed.granted,
      changed: target.assistantBudgetOwner !== parsed.granted };
    if (!result.changed) return result;
    await tx.user.update({ where: { id: target.id }, data: { assistantBudgetOwner: parsed.granted } });
    await tx.auditLog.create({ data: {
      tenantId: target.tenantId, userId: principal.userId, action: 'ASSISTANT_BUDGET_OWNERSHIP_CHANGED',
      details: JSON.stringify({ targetTenantId: target.tenantId, targetUserId: target.id,
        before: { assistantBudgetOwner: target.assistantBudgetOwner }, after: { assistantBudgetOwner: parsed.granted }, reason: parsed.reason }),
    } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
