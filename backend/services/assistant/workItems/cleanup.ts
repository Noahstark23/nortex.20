import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma.js';

/** Sólo almacenamiento auxiliar vencido. Eventos e item se eliminan juntos; no toca el run. */
export async function cleanupAssistantWorkItems(db: PrismaClient = prisma, now = new Date()): Promise<number> {
  const candidates = await db.assistantWorkItem.findMany({ where: { expiresAt: { lte: now } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true } });
  if (!candidates.length) return 0;
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM AssistantWorkItem
      WHERE id IN (${Prisma.join(candidates.map(row => row.id))}) AND expiresAt<=${now} ORDER BY id FOR UPDATE`);
    const ids = locked.map(row => row.id);
    if (!ids.length) return 0;
    // Volver a aplicar caducidad dentro de la transacción antes de borrar hijos.
    const expired = await tx.assistantWorkItem.findMany({ where: { id: { in: ids }, expiresAt: { lte: now } }, take: 100, select: { id: true } });
    const eligible = expired.map(row => row.id);
    if (!eligible.length) return 0;
    await tx.assistantWorkEvent.deleteMany({ where: { workItemId: { in: eligible } } });
    const removed = await tx.assistantWorkItem.deleteMany({ where: { id: { in: eligible }, expiresAt: { lte: now } } });
    if (removed.count !== eligible.length) throw new Error('Work item retention changed; transaction must roll back.');
    return removed.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
