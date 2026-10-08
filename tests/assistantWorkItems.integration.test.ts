// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { reviewWeeklyCash } from '../backend/services/assistant/operations/weeklyCashReview';
import { cleanupAssistantWorkItems } from '../backend/services/assistant/workItems/service';
import type { WeeklyCashReview } from '../shared/assistantWeeklyCashReview';
import { api, assertDisposableDatabase, baseUrl, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function fixture(): Promise<{ actor: TestActor; runId: string; shiftId: string }> {
  assertDisposableDatabase();
  const nonce = randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA continuidad W01', taxId: `QA-${nonce}`, type: 'FERRETERIA' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, role: 'OWNER', name: 'QA dueño W01',
    email: `w01-${nonce}@example.invalid`, password: 'no-login-synthetic-fixture' } });
  const { signAuthToken } = await import('../backend/services/secrets');
  const actor = { tenantId: tenant.id, userId: user.id, role: user.role,
    token: signAuthToken({ userId: user.id, tenantId: tenant.id, role: user.role, email: user.email! }) };
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, operationsEnabled: true } });
  const shift = await prisma.shift.create({ data: { tenantId: tenant.id, userId: user.id, status: 'CLOSED',
    startTime: new Date('2026-09-18T12:00:00.000Z'), endTime: new Date('2026-09-18T17:00:00.000Z'),
    initialCash: '100', finalCashDeclared: '100', systemExpectedCash: '100', difference: '0' } });
  const sourceReview = await reviewWeeklyCash(actor, { startDate: '2026-09-12', endDate: '2026-09-18' });
  const expiresAt = new Date(Date.now() + 90 * 86_400_000);
  const conversation = await prisma.assistantConversation.create({ data: { tenantId: tenant.id, userId: user.id,
    roleAtCreation: user.role, expiresAt } });
  const run = await prisma.assistantRun.create({ data: { tenantId: tenant.id, userId: user.id, roleAtCreation: user.role,
    conversationId: conversation.id, requestId: randomUUID(), payloadHash: 'a'.repeat(64), inputText: 'Revisión sintética W01',
    knowledgeChannel: 'WEB_INTERNAL', status: 'SUCCEEDED', result: asJson({ text: 'Revisión parcial de QA.',
      evidence: [{ id: `evidence-${nonce}`, tool: 'review_weekly_cash', label: 'Revisión semanal', data: sourceReview }],
      actionProposalIds: [], degraded: true }), expiresAt } });
  return { actor, runId: run.id, shiftId: shift.id };
}

qa('W01 continuidad HTTP y MySQL descartable', () => {
  beforeAll(assertDisposableDatabase);

  it('db push amplía una tabla W01 poblada, repara estado parcial y se puede repetir', async () => {
    const { actor, runId } = await fixture();
    const created = await api('/api/assistant/work-items', actor, 'POST', { runId }); status(created, 200);
    const note = await api(`/api/assistant/work-items/${created.body.id}/events`, actor, 'POST', {
      eventId: randomUUID(), version: 0, type: 'ADD_NOTE', note: 'Nota anterior a la ampliación.' }); status(note, 200);
    const push = () => spawnSync(process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', 'backend/prisma/schema.prisma'],
      { env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 120_000 });
    await prisma.$executeRawUnsafe('ALTER TABLE `AssistantWorkItem` DROP COLUMN `acceptedAt`, DROP COLUMN `acceptedByUserId`, DROP COLUMN `acceptedReportHash`, DROP COLUMN `acceptedReportVersion`, DROP COLUMN `acceptedEventId`');
    expect(push().status).toBe(0);
    await prisma.$executeRawUnsafe('ALTER TABLE `AssistantWorkItem` DROP COLUMN `acceptedEventId`');
    expect(push().status).toBe(0);
    expect(push().status).toBe(0);
    const columns = await prisma.$queryRaw<Array<{ COLUMN_NAME: string }>>`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='AssistantWorkItem' AND COLUMN_NAME LIKE 'accepted%'`;
    expect(columns.map(row => row.COLUMN_NAME).sort()).toEqual([
      'acceptedAt', 'acceptedByUserId', 'acceptedEventId', 'acceptedReportHash', 'acceptedReportVersion',
    ].sort());
    const recovered = await api(`/api/assistant/work-items/${created.body.id}`, actor); status(recovered, 200);
    expect(recovered.body.events.map((event: { note: string | null }) => event.note)).toContain('Nota anterior a la ampliación.');
    expect(recovered.body.version).toBe(1);
  }, 180_000);

  it('creación concurrente, recuperación y reintento conservan un solo evento y no escriben caja', async () => {
    const { actor, runId, shiftId } = await fixture();
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
      exceptions: expect.arrayContaining([expect.objectContaining({ shiftId, status: 'PENDING', assignedUserId: actor.userId })]) });
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
    ])).toEqual([1, 0, 0, 0, 0]);
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
    const result = structuredClone(stored.result as unknown as { evidence: Array<{ data: WeeklyCashReview }> });
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

  it('acepta exactamente un hash y conserva el comprobante en reintentos sin escribir caja', async () => {
    const { actor, runId } = await fixture();
    const created = await api('/api/assistant/work-items', actor, 'POST', { runId }); status(created, 200);
    const route = `/api/assistant/work-items/${created.body.id}`;
    const invalid = await api(`${route}/accept`, actor, 'POST', { eventId: randomUUID(), version: 0, reportHash: '0'.repeat(64) });
    status(invalid, 409); expect(invalid.body.code).toBe('WORK_ITEM_REPORT_CHANGED');
    expect(await prisma.assistantWorkEvent.count({ where: { workItemId: created.body.id } })).toBe(1);

    const note = await api(`${route}/events`, actor, 'POST', { eventId: randomUUID(), version: 0,
      type: 'ADD_NOTE', note: 'Pendiente: solicitar el reporte original.' }); status(note, 200);
    const stale = await api(`${route}/accept`, actor, 'POST', { eventId: randomUUID(), version: 0,
      reportHash: created.body.report.reportHash });
    status(stale, 409); expect(stale.body.code).toBe('WORK_ITEM_CHANGED');
    const input = { eventId: randomUUID(), version: note.body.version, reportHash: note.body.report.reportHash };
    const accepted = await api(`${route}/accept`, actor, 'POST', input); status(accepted, 200);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', version: 2, receiptEventId: input.eventId,
      acceptance: { eventId: input.eventId, reportHash: input.reportHash, reportVersion: 1, withExceptions: true } });
    expect(accepted.body.report.reportHash).toBe(input.reportHash);
    const replay = await api(`${route}/accept`, actor, 'POST', input); status(replay, 200);
    expect(replay.body.acceptance).toEqual(accepted.body.acceptance);
    expect((await api(route, actor)).body.report.reportHash).toBe(input.reportHash);
    expect(await prisma.assistantWorkEvent.count({ where: { workItemId: created.body.id } })).toBe(3);
    const conflict = await api(`${route}/accept`, actor, 'POST', { ...input, reportHash: 'f'.repeat(64) });
    status(conflict, 409); expect(conflict.body.code).toBe('WORK_ITEM_EVENT_CONFLICT');
    const second = await api(`${route}/accept`, actor, 'POST', { ...input, eventId: randomUUID() });
    status(second, 409); expect(second.body.code).toBe('WORK_ITEM_ACCEPTED');
    expect(await Promise.all([
      prisma.shift.count({ where: { tenantId: actor.tenantId } }),
      prisma.cashMovement.count({ where: { tenantId: actor.tenantId } }),
      prisma.journalEntry.count({ where: { tenantId: actor.tenantId } }),
      prisma.auditLog.count({ where: { tenantId: actor.tenantId } }),
      prisma.assistantUsage.count({ where: { tenantId: actor.tenantId } }),
    ])).toEqual([1, 0, 0, 0, 0]);
  });

  it('dos aceptaciones concurrentes producen un único comprobante', async () => {
    const { actor, runId } = await fixture();
    const created = await api('/api/assistant/work-items', actor, 'POST', { runId }); status(created, 200);
    const route = `/api/assistant/work-items/${created.body.id}/accept`;
    const base = { version: 0, reportHash: created.body.report.reportHash };
    const responses = await Promise.all([
      api(route, actor, 'POST', { ...base, eventId: randomUUID() }),
      api(route, actor, 'POST', { ...base, eventId: randomUUID() }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.assistantWorkEvent.count({ where: { workItemId: created.body.id, type: 'ACCEPT_REPORT' } })).toBe(1);
    const stored = await prisma.assistantWorkItem.findFirstOrThrow({ where: { id: created.body.id, tenantId: actor.tenantId } });
    expect(stored).toMatchObject({ status: 'ACCEPTED', version: 1, acceptedReportHash: base.reportHash });
  });

  it('otro proceso backend recupera la nota y el hash aceptado sin ejecutar IA', async () => {
    const { actor, runId } = await fixture();
    const created = await api('/api/assistant/work-items', actor, 'POST', { runId }); status(created, 200);
    const route = `/api/assistant/work-items/${created.body.id}`;
    const note = await api(`${route}/events`, actor, 'POST', { eventId: randomUUID(), version: 0,
      type: 'ADD_NOTE', note: 'Aporte que debe sobrevivir al proceso.' }); status(note, 200);
    const accepted = await api(`${route}/accept`, actor, 'POST', { eventId: randomUUID(), version: 1,
      reportHash: note.body.report.reportHash }); status(accepted, 200);
    const socket = createServer();
    await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Puerto QA no disponible');
    const port = address.port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore',
    });
    try {
      const otherBase = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (child.exitCode !== null) throw new Error('El segundo backend terminó antes de estar listo');
        try {
          const health = await fetch(`${otherBase}/api/health`, { signal: AbortSignal.timeout(1000) });
          if (health.ok) { ready = true; break; }
        } catch { /* Espera breve por arranque local. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(ready).toBe(true);
      const response = await fetch(`${otherBase}${route}`, { headers: { authorization: `Bearer ${actor.token}` } });
      expect(response.status).toBe(200);
      const item = await response.json();
      expect(item).toMatchObject({ status: 'ACCEPTED', acceptance: { reportHash: accepted.body.acceptance.reportHash } });
      expect(item.events.map((event: { note: string | null }) => event.note)).toContain('Aporte que debe sobrevivir al proceso.');
      expect(item.report.reportHash).toBe(accepted.body.report.reportHash);
      expect(await prisma.assistantUsage.count({ where: { tenantId: actor.tenantId } })).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 90_000);
});
