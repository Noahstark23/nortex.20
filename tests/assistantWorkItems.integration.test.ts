// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { cleanupAssistantWorkItems } from '../backend/services/assistant/workItems/service';
import { api, assertDisposableDatabase, baseUrl, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function review() {
  return {
    kind: 'WEEKLY_CASH_REVIEW', status: 'partial', checkedAt: new Date().toISOString(), scope: 'business', truncated: false,
    period: { startDate: '2026-09-12', endDate: '2026-09-18', cutoff: '2026-09-19T06:00:00.000Z', timeZone: 'America/Managua', completeDays: true },
    rows: [{ shiftId: 'synthetic-shift', status: 'MISSING_REPORT', closedAt: '2026-09-18T17:00:00.000Z', businessDate: '2026-09-18',
      folio: null, source: null, cash: null, message: 'Falta el comprobante de prueba.' }],
    counts: { closed: 1, verified: 0, differences: 0, missingReports: 1, invalidReports: 0, open: 0 },
    totals: { shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null },
    warnings: ['La causa no está acreditada.'], evidence: ['Solo referencia sintética de QA.'],
  };
}

async function fixture(): Promise<{ actor: TestActor; runId: string }> {
  assertDisposableDatabase();
  const nonce = randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA continuidad W01', taxId: `QA-${nonce}`, type: 'FERRETERIA' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, role: 'OWNER', name: 'QA dueño W01',
    email: `w01-${nonce}@example.invalid`, password: 'no-login-synthetic-fixture' } });
  const { signAuthToken } = await import('../backend/services/secrets');
  const actor = { tenantId: tenant.id, userId: user.id, role: user.role,
    token: signAuthToken({ userId: user.id, tenantId: tenant.id, role: user.role, email: user.email! }) };
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, operationsEnabled: true } });
  const expiresAt = new Date(Date.now() + 90 * 86_400_000);
  const conversation = await prisma.assistantConversation.create({ data: { tenantId: tenant.id, userId: user.id,
    roleAtCreation: user.role, expiresAt } });
  const run = await prisma.assistantRun.create({ data: { tenantId: tenant.id, userId: user.id, roleAtCreation: user.role,
    conversationId: conversation.id, requestId: randomUUID(), payloadHash: 'a'.repeat(64), inputText: 'Revisión sintética W01',
    knowledgeChannel: 'WEB_INTERNAL', status: 'SUCCEEDED', result: asJson({ text: 'Revisión parcial de QA.',
      evidence: [{ id: `evidence-${nonce}`, tool: 'review_weekly_cash', label: 'Revisión semanal', data: review() }],
      actionProposalIds: [], degraded: true }), expiresAt } });
  return { actor, runId: run.id };
}

qa('W01 continuidad HTTP y MySQL descartable', () => {
  beforeAll(assertDisposableDatabase);

  it('creación concurrente, recuperación y reintento conservan un solo evento y no escriben caja', async () => {
    const { actor, runId } = await fixture();
    const [first, second] = await Promise.all([
      api('/api/assistant/work-items', actor, 'POST', { runId }),
      api('/api/assistant/work-items', actor, 'POST', { runId }),
    ]);
    status(first, 200); status(second, 200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.assistantWorkItem.count({ where: { tenantId: actor.tenantId } })).toBe(1);
    expect(await prisma.assistantWorkEvent.count({ where: { tenantId: actor.tenantId } })).toBe(1);

    const event = { eventId: randomUUID(), type: 'ADD_NOTE', note: 'Falta comprobante original.', version: 0 };
    const route = `/api/assistant/work-items/${first.body.id}`;
    const saved = await api(`${route}/events`, actor, 'POST', event); status(saved, 200);
    expect(saved.body).toMatchObject({ status: 'IN_REVIEW', version: 1, receiptEventId: event.eventId });
    const replay = await api(`${route}/events`, actor, 'POST', event); status(replay, 200);
    expect(replay.body.version).toBe(1);
    expect(await prisma.assistantWorkEvent.count({ where: { workItemId: first.body.id } })).toBe(2);
    const conflict = await api(`${route}/events`, actor, 'POST', { ...event, note: 'Texto distinto' });
    status(conflict, 409); expect(conflict.body.code).toBe('WORK_ITEM_EVENT_CONFLICT');

    const recovered = await api(route, actor); status(recovered, 200);
    expect(recovered.body.events.map((row: { type: string }) => row.type)).toEqual(['CREATED', 'ADD_NOTE']);
    expect(recovered.body.review.totals.shortageNio).toBeNull();
    expect(recovered.body.report).toMatchObject({ kind: 'W01_CASH_REPORT', workItemVersion: 1,
      sourceHash: recovered.body.source.contentHash, totals: { shortageNio: null },
      exceptions: expect.arrayContaining([expect.objectContaining({ shiftId: 'synthetic-shift', status: 'PENDING', assignedUserId: actor.userId })]) });
    expect(recovered.body.report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(recovered.body.report.reportHash).not.toBe(first.body.report.reportHash);
    expect((await api(route, actor)).body.report.reportHash).toBe(recovered.body.report.reportHash);
    const listed = await api('/api/assistant/work-items', actor); status(listed, 200);
    expect(listed.body.items.map((row: { id: string }) => row.id)).toContain(first.body.id);
    expect(await prisma.assistantRun.count({ where: { tenantId: actor.tenantId } })).toBe(1);
    expect(await Promise.all([
      prisma.shift.count({ where: { tenantId: actor.tenantId } }),
      prisma.cashMovement.count({ where: { tenantId: actor.tenantId } }),
      prisma.journalEntry.count({ where: { tenantId: actor.tenantId } }),
      prisma.auditLog.count({ where: { tenantId: actor.tenantId } }),
      prisma.assistantUsage.count({ where: { tenantId: actor.tenantId } }),
    ])).toEqual([0, 0, 0, 0, 0]);
  });

  it('revocación, fuente cambiada y limpieza respetan autoridad y no borran el run', async () => {
    const { actor, runId } = await fixture();
    const created = await api('/api/assistant/work-items', actor, 'POST', { runId }); status(created, 200);
    const route = `/api/assistant/work-items/${created.body.id}`;
    const other = await fixture();
    const foreign = await api(route, other.actor); status(foreign, 404);
    await prisma.user.update({ where: { id: actor.userId }, data: { role: 'CASHIER' } });
    const revoked = await api(route, actor); status(revoked, 404);
    expect(revoked.body.code).toBe('WORK_ITEM_NOT_FOUND');
    await prisma.user.update({ where: { id: actor.userId }, data: { role: 'OWNER' } });

    const stored = await prisma.assistantRun.findUniqueOrThrow({ where: { id: runId } });
    const result = structuredClone(stored.result as { evidence: Array<{ data: ReturnType<typeof review> }> });
    result.evidence[0].data.warnings = ['La fuente cambió.'];
    await prisma.assistantRun.update({ where: { id: runId }, data: { result: asJson(result) } });
    const changed = await api(route, actor); status(changed, 409);
    expect(changed.body.code).toBe('WORK_ITEM_SOURCE_UNAVAILABLE');
    expect(await prisma.assistantWorkItem.count({ where: { id: created.body.id } })).toBe(1);

    await prisma.assistantWorkItem.update({ where: { id: created.body.id }, data: { expiresAt: new Date(0) } });
    expect(await cleanupAssistantWorkItems(prisma)).toBe(1);
    expect(await prisma.assistantWorkEvent.count({ where: { workItemId: created.body.id } })).toBe(0);
    expect(await prisma.assistantWorkItem.count({ where: { id: created.body.id } })).toBe(0);
    expect(await prisma.assistantRun.count({ where: { id: runId } })).toBe(1);
  });
});
