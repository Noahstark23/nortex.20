import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantRunDTO } from '../../../../shared/assistantOperations.js';
import type { WeeklyCashReview } from '../../../../shared/assistantWeeklyCashReview.js';
import type { AssistantWorkItemSource } from '../../../../shared/assistantWorkItems.js';
import { getAssistantRun } from '../operations/runService.js';
import { unavailableWorkItemSource, type WorkItemDatabase } from './contracts.js';

const id = z.string().min(1).max(191);
const timestamp = z.iso.datetime({ offset: true });
const money = z.string().max(64).regex(/^-?\d+(?:\.\d{1,4})?$/);
const count = z.number().int().min(0).max(30);
const source = z.object({ id, version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), documentUrl: z.string().min(1).max(500) }).strict();
const cash = z.object({ expectedNio: money, countedNio: money, differenceNio: money, expectedUsd: money, countedUsd: money, differenceUsd: money }).strict();
const row = z.object({
  shiftId: id, status: z.enum(['BALANCED', 'DIFFERENCE', 'MISSING_REPORT', 'INVALID_REPORT', 'OPEN']),
  closedAt: timestamp.nullable(), businessDate: z.iso.date().nullable(), folio: z.string().max(191).nullable(),
  source: source.nullable(), cash: cash.nullable(), message: z.string().max(2000),
}).strict().refine(value => ['BALANCED', 'DIFFERENCE'].includes(value.status)
  ? value.source !== null && value.cash !== null && value.closedAt !== null
  : value.source === null && value.cash === null, 'La fila no conserva la evidencia esperada.');

/** Valida la evidencia persistida; no calcula, reconstruye ni ejecuta una revisión. */
export const savedWeeklyCashReviewSchema = z.object({
  kind: z.literal('WEEKLY_CASH_REVIEW'), status: z.enum(['ok', 'partial', 'unavailable']),
  period: z.object({ startDate: z.iso.date(), endDate: z.iso.date(), cutoff: timestamp, timeZone: z.literal('America/Managua'), completeDays: z.boolean() }).strict()
    .refine(value => { const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000; return days >= 0 && days <= 6; }),
  checkedAt: timestamp, scope: z.enum(['business', 'own-shifts']), truncated: z.boolean(), rows: z.array(row).max(30),
  counts: z.object({ closed: count, verified: count, differences: count, missingReports: count, invalidReports: count, open: count }).strict(),
  totals: z.object({ shortageNio: money.nullable(), surplusNio: money.nullable(), shortageUsd: money.nullable(), surplusUsd: money.nullable() }).strict(),
  warnings: z.array(z.string().max(2000)).max(20), evidence: z.array(z.string().max(2000)).max(20),
}).strict();

export async function readWorkItemSource(principal: AssistantPrincipal, runId: string, db: WorkItemDatabase, now: Date,
  expected?: { conversationId: string; evidenceId: string; sourceHash: string }) {
  // Esta función de lectura revalida propietario, rol, conversación, caducidad y fuentes.
  // Nunca llamar process/recover/executeAssistantRun para recuperar un encargo.
  let run: AssistantRunDTO;
  try {
    run = await getAssistantRun(principal, runId, { db: db as PrismaClient, now: () => now, channel: 'WEB_INTERNAL' });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // Una sesión revocada conserva su rechazo explícito; una referencia perdida no se sustituye.
    if (error instanceof z.ZodError) throw unavailableWorkItemSource();
    if (status && status >= 400 && status < 500 && status !== 401 && status !== 403) throw unavailableWorkItemSource();
    throw error;
  }
  const stored = await db.assistantRun.findFirst({
    where: { id: runId, tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role, expiresAt: { gt: now } },
    select: { id: true, conversationId: true, expiresAt: true },
  });
  const matches = run.result?.evidence.filter(item => item.tool === 'review_weekly_cash') ?? [];
  if (!stored || run.id !== runId || run.status !== 'SUCCEEDED' || !run.result || run.result.knowledgeUnavailable || matches.length !== 1
    || stored.conversationId !== run.conversationId || !(stored.expiresAt instanceof Date)) throw unavailableWorkItemSource();
  if (!id.safeParse(matches[0].id).success) throw unavailableWorkItemSource();
  const parsed = savedWeeklyCashReviewSchema.safeParse(matches[0].data);
  if (!parsed.success || JSON.stringify(parsed.data).length > 18_000 || stored.expiresAt <= now) throw unavailableWorkItemSource();
  // Con strictNullChecks desactivado Zod infiere como opcionales campos obligatorios;
  // el parse estricto anterior valida todos los campos y sus null explícitos.
  const review = parsed.data as WeeklyCashReview;
  const contentHash = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  if (expected && (expected.conversationId !== run.conversationId || expected.evidenceId !== matches[0].id || expected.sourceHash !== contentHash)) throw unavailableWorkItemSource();
  const summary: AssistantWorkItemSource = { runId, evidenceId: matches[0].id, contentHash, period: review.period,
    checkedAt: review.checkedAt, reviewStatus: review.status, scope: review.scope, truncated: review.truncated, counts: review.counts };
  return { summary, review, conversationId: run.conversationId, expiresAt: stored.expiresAt };
}
