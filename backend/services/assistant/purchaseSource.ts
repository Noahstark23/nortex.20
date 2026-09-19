import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { AssistantPrincipal } from '../../../shared/assistant';
import { AssistantAccessError } from './access.js';

const identifier = z.string().min(1).max(191);
export const manualPurchaseSourceSchema = z.object({
  kind: z.literal('MANUAL'), origin: z.literal('NORTEX_CHAT'),
  conversationId: identifier, intakeId: identifier,
  evidence: z.array(z.object({
    requestId: z.string().uuid(), field: z.string().min(1).max(100), suppliedText: z.string().min(1).max(4000),
  }).strict()).min(1).max(150),
}).strict();
export type ManualPurchaseSource = z.infer<typeof manualPurchaseSourceSchema>;

export function readManualPurchaseSource(value: unknown): ManualPurchaseSource | null {
  if (value === null || value === undefined) return null;
  const parsed = manualPurchaseSourceSchema.safeParse(value);
  if (!parsed.success) throw new AssistantAccessError(400, 'PURCHASE_SOURCE_INVALID', 'No pudimos verificar el origen de esta propuesta. Volvé a prepararla.');
  return parsed.data;
}

/** La procedencia la escribe el servicio; el navegador nunca puede sustituirla. */
export async function assertManualPurchaseSource(principal: AssistantPrincipal, source: ManualPurchaseSource, db: PrismaClient | Prisma.TransactionClient) {
  const conversation = await db.assistantConversation.findFirst({ where: {
    id: source.conversationId, tenantId: principal.tenantId, userId: principal.userId,
    roleAtCreation: principal.role, expiresAt: { gt: new Date() },
  }, select: { id: true } });
  if (!conversation) throw new AssistantAccessError(403, 'PURCHASE_SOURCE_UNAVAILABLE', 'Esta conversación ya no está disponible para tu sesión. Volvé a preparar la compra.');
}

export function appendManualPurchaseEvidence(existing: ManualPurchaseSource, next: ManualPurchaseSource): ManualPurchaseSource {
  if (existing.kind !== next.kind || existing.origin !== next.origin || existing.conversationId !== next.conversationId || existing.intakeId !== next.intakeId) {
    throw new AssistantAccessError(409, 'PURCHASE_SOURCE_CHANGED', 'La propuesta pertenece a otra captura. Actualizá la conversación.');
  }
  const evidence = [...new Map([...existing.evidence, ...next.evidence].map(item => [JSON.stringify(item), item])).values()];
  return manualPurchaseSourceSchema.parse({ ...existing, evidence });
}
