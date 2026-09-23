import { Prisma, type PrismaClient } from '@prisma/client';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { AssistantAccessError } from '../access.js';
import { KNOWLEDGE_CONTROL_ID } from './model.js';

const fail = (code: string, message: string, status = 409): never => { throw new AssistantAccessError(status, code, message); };
type Tx = Prisma.TransactionClient;

export async function authorizeEditor(principal: AssistantPrincipal, tx: Pick<Tx, 'user'>) {
  if (!principal.tenantId || !principal.userId || principal.role !== 'SUPER_ADMIN') fail('KNOWLEDGE_EDITOR_REQUIRED', 'Se requiere una sesión editorial vigente de Nortex.', 403);
  const actor = await tx.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!actor) fail('KNOWLEDGE_EDITOR_REQUIRED', 'Se requiere una sesión editorial vigente de Nortex.', 403);
  return actor;
}
export async function withEditorialLock<T>(principal: AssistantPrincipal, db: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  await authorizeEditor(principal, db);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`);
    await authorizeEditor(principal, tx);
    // Inicialización atómica de MySQL: el upsert de Prisma puede separar lectura e INSERT y competir por la PK.
    // Sólo una mutación editorial crea este control; las lecturas nunca siembran el corpus global.
    await tx.$executeRaw(Prisma.sql`INSERT INTO AssistantKnowledgeControl (id, generation, updatedAt)
      VALUES (${KNOWLEDGE_CONTROL_ID}, 0, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id = id`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantKnowledgeControl WHERE id = ${KNOWLEDGE_CONTROL_ID} FOR UPDATE`);
    await authorizeEditor(principal, tx);
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function audit(tx: Tx, principal: AssistantPrincipal, action: string, details: unknown) {
  // El corpus es global; el tenant del actor sólo atribuye la decisión, no convierte documentos privados en ayuda común.
  await tx.auditLog.create({ data: { tenantId: principal.tenantId, userId: principal.userId, action, details: JSON.stringify(details) } });
}
