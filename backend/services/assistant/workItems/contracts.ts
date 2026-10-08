import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';

export type WorkItemDatabase = PrismaClient | Prisma.TransactionClient;
export interface WorkItemDependencies { db?: PrismaClient; now?: () => Date }
export const WORK_ITEM_TTL_MS = 30 * 86_400_000;
export const WORK_ITEM_PAGE_SIZE = 20;
export const WORK_ITEM_EVENT_LIMIT = 100;
export const workItemIdSchema = z.string().trim().min(1).max(191);
export const createWorkItemSchema = z.object({ runId: workItemIdSchema }).strict();
export const listWorkItemsSchema = z.object({ cursor: workItemIdSchema.optional() }).strict();
const eventIdentity = { eventId: z.uuid().transform(value => value.toLowerCase()), version: z.number().int().nonnegative().max(2_147_483_646) };
export const workItemEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventIdentity, type: z.literal('ADD_NOTE'), note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...eventIdentity, type: z.literal('WAIT') }).strict(),
  z.object({ ...eventIdentity, type: z.literal('RESUME') }).strict(),
  z.object({ ...eventIdentity, type: z.literal('CANCEL') }).strict(),
]);
export const acceptWorkItemReportSchema = z.object({ eventId: eventIdentity.eventId, version: eventIdentity.version,
  reportHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export class AssistantWorkItemError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message); this.name = 'AssistantWorkItemError';
  }
}

export function unavailableWorkItemSource(): AssistantWorkItemError {
  return new AssistantWorkItemError(409, 'WORK_ITEM_SOURCE_UNAVAILABLE', 'La revisión de origen cambió o ya no está disponible. No se reconstruyó ni se ejecutó otra consulta.');
}
