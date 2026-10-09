import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AssistantPrincipal } from '../shared/assistant';
import type { WeeklyCashReview } from '../shared/assistantWeeklyCashReview';
import { createWorkItemsFake } from './fixtures/assistant/workItemsFake';

const boundary = vi.hoisted(() => ({ access: vi.fn(), getRun: vi.fn(), reviewCash: vi.fn() }));
vi.mock('../backend/services/assistant/access', () => ({ assertAssistantAccess: boundary.access }));
vi.mock('../backend/services/assistant/operations/runService', () => ({ getAssistantRun: boundary.getRun }));
vi.mock('../backend/services/assistant/operations/weeklyCashReview', () => ({ reviewWeeklyCash: boundary.reviewCash }));
vi.mock('../backend/services/assistant/operations/orchestrator', () => ({ runAssistantOrchestrator: () => { throw new Error('Unexpected AI execution'); } }));
vi.mock('../backend/services/assistant/provider', () => ({ createExtractionProvider: () => { throw new Error('Unexpected AI provider'); } }));
vi.mock('../backend/lib/prisma', () => ({ default: new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected default database: ${String(key)}`); } }) }));

import {
  appendAssistantWorkItemEvent, createAssistantWorkItem, cleanupAssistantWorkItems,
  getAssistantWorkItem, listAssistantWorkItems,
} from '../backend/services/assistant/workItems/service';

const now = new Date('2026-09-19T18:00:00.000Z');
const principal: AssistantPrincipal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
const owner = (p: AssistantPrincipal = principal) => ({ tenantId: p.tenantId, userId: p.userId, roleAtCreation: p.role });
const failure = (code: string, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

function review(): WeeklyCashReview {
  return {
    kind: 'WEEKLY_CASH_REVIEW', status: 'partial', checkedAt: '2026-09-19T17:00:00.000Z', scope: 'business', truncated: false,
    period: { startDate: '2026-09-12', endDate: '2026-09-18', cutoff: '2026-09-19T06:00:00.000Z', timeZone: 'America/Managua', completeDays: true },
    rows: [
      { shiftId: 'shift-1', status: 'DIFFERENCE', closedAt: '2026-09-18T16:00:00.000Z', businessDate: '2026-09-18', folio: 'Z-20260918-shift-1',
        source: { id: 'report-1', version: 1, contentHash: 'a'.repeat(64), documentUrl: '/api/reports/shifts/shift-1/document' },
        cash: { expectedNio: '100.00', countedNio: '99.00', differenceNio: '-1.00', expectedUsd: '0.0000', countedUsd: '0.0000', differenceUsd: '0.0000' },
        message: 'Diferencia que requiere evidencia.' },
      { shiftId: 'shift-2', status: 'MISSING_REPORT', closedAt: '2026-09-18T17:00:00.000Z', businessDate: '2026-09-18', folio: null, source: null, cash: null, message: 'Sin snapshot verificable.' },
    ],
    counts: { closed: 2, verified: 1, differences: 1, missingReports: 1, invalidReports: 0, open: 0 },
    totals: { shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null },
    warnings: ['No acredita conciliación.'], evidence: ['Shift y reporte guardado.'],
  };
}

function harness() {
  const h = createWorkItemsFake();
  const authorization = { active: true, operations: true, cashReview: true };
  const deps = { db: h.db, now: () => now };
  boundary.reviewCash.mockImplementation(async (_p: AssistantPrincipal, _input: unknown, options: { tx: unknown }) => {
    expect(options.tx).toBe(h.db);
    return review();
  });
  const addRun = (id = 'run-a', identity = principal) => {
    const row = { id, ...owner(identity), conversationId: `conversation-${id}`, expiresAt: new Date('2026-10-30T18:00:00Z'), status: 'SUCCEEDED', result: { text: 'Revisión guardada.', evidence: [{ id: `evidence-${id}`, tool: 'review_weekly_cash', label: 'Revisión de caja', data: review() }], actionProposalIds: [], degraded: true } };
    h.runs.push(row); return row;
  };
  addRun();
  boundary.access.mockImplementation(async (p: AssistantPrincipal, capability: string) => {
    if (!authorization.active) throw failure('SESSION_REVOKED', 403);
    if (!p.tenantId || !p.userId || !p.role) throw failure('ASSISTANT_IDENTITY_REQUIRED', 401);
    if (!['operations', 'cashReview'].includes(capability)) throw new Error(`Unexpected capability: ${capability}`);
    if (!authorization[capability as 'operations' | 'cashReview'] || p.role === 'BODEGUERO') throw failure('ASSISTANT_FORBIDDEN', 403);
  });
  boundary.getRun.mockImplementation(async (p: AssistantPrincipal, id: string, options: typeof deps & { channel?: string }) => {
    expect(options.db).toBe(h.db);
    expect(options.channel).toBe('WEB_INTERNAL');
    const row = h.runs.find(value => value.id === id && value.tenantId === p.tenantId && value.userId === p.userId && value.roleAtCreation === p.role && value.expiresAt > options.now());
    if (!row) throw failure('RUN_NOT_FOUND', 404);
    return structuredClone({ ...row, createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1, iterations: 1, steps: [] });
  });
  return { ...h, deps, authorization, addRun };
}
type Harness = ReturnType<typeof harness>;
const create = (h: Harness, runId = 'run-a') => createAssistantWorkItem(principal, { runId }, h.deps);
const event = (h: Harness, id: string, version: number, type: 'WAIT' | 'RESUME' | 'CANCEL') => appendAssistantWorkItemEvent(principal, id, { eventId: randomUUID(), version, type }, h.deps);
beforeEach(() => {
  boundary.access.mockReset(); boundary.getRun.mockReset(); boundary.reviewCash.mockReset();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Unexpected outbound network'); });
});
afterEach(() => vi.restoreAllMocks());

describe('W01 continuidad: estado auxiliar con autoridad simulada explícita', () => {
  it('crea desde una fuente propia, limita retención y conserva desconocido como null', async () => {
    const h = harness(), result = await create(h);
    expect(result).toMatchObject({ kind: 'W01_CASH_REVIEW', status: 'IN_REVIEW', version: 0, source: { runId: 'run-a', evidenceId: 'evidence-run-a', reviewStatus: 'partial' } });
    expect(result.review.totals.shortageNio).toBeNull();
    expect(result.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt).toBe('2026-10-19T18:00:00.000Z');
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ type: 'CREATED', version: 0 });
    expect(h.items).toHaveLength(1); expect(h.events).toHaveLength(1);
    expect(h.forbiddenAccesses).toEqual([]);
  });
  it('caduca junto a su run cuando la fuente vence antes de treinta días', async () => {
    const h = harness(); h.runs[0].expiresAt = new Date('2026-09-20T18:00:00Z');
    expect((await create(h)).expiresAt).toBe('2026-09-20T18:00:00.000Z');
  });
  it('no acepta fuente, importes o identidad impuestos por el navegador', async () => {
    const h = harness();
    await expect(createAssistantWorkItem(principal, { runId: 'run-a', tenantId: 'tenant-b', review: review() }, h.deps)).rejects.toThrow();
    expect(h.items).toHaveLength(0); expect(h.events).toHaveLength(0);
  });
  it('reintentos y creaciones concurrentes devuelven el mismo encargo', async () => {
    const h = harness();
    const [first, ...duplicates] = await Promise.all([create(h), create(h), create(h)]);
    expect(duplicates.map(item => item.id)).toEqual([first.id, first.id]);
    expect(h.items).toHaveLength(1); expect(h.events).toHaveLength(1);
  });
  it.each(['tenant', 'user', 'role'])('otra identidad %s no recupera ni modifica el encargo', async kind => {
    const h = harness(), item = await create(h);
    const foreign = { ...principal, ...(kind === 'tenant' ? { tenantId: 'tenant-b' } : kind === 'user' ? { userId: 'user-b' } : { role: 'ACCOUNTANT' }) };
    await expect(getAssistantWorkItem(foreign, item.id, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_NOT_FOUND' });
    await expect(appendAssistantWorkItemEvent(foreign, item.id, { eventId: randomUUID(), type: 'WAIT', version: 0 }, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_NOT_FOUND' });
    expect((await listAssistantWorkItems(foreign, {}, h.deps)).items).toEqual([]);
    expect(h.events).toHaveLength(1);
  });
  it('tenant distinto mantiene su propio run/encargo sin filtrar el primero', async () => {
    const h = harness(), first = await create(h), secondPrincipal = { tenantId: 'tenant-b', userId: 'user-b', role: 'OWNER' };
    h.addRun('run-b', secondPrincipal);
    const second = await createAssistantWorkItem(secondPrincipal, { runId: 'run-b' }, h.deps);
    expect(second.id).not.toBe(first.id);
    expect((await listAssistantWorkItems(principal, {}, h.deps)).items.map(item => item.id)).toEqual([first.id]);
    expect((await listAssistantWorkItems(secondPrincipal, {}, h.deps)).items.map(item => item.id)).toEqual([second.id]);
  });
  it.each(['operations', 'cashReview'])('permiso %s revocado impide crear y leer', async capability => {
    const h = harness(), item = await create(h); h.authorization[capability as 'operations' | 'cashReview'] = false;
    await expect(create(h)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    expect(h.items).toHaveLength(1); expect(h.events).toHaveLength(1);
  });
  it('revocación durante una lectura impide entregar el contenido', async () => {
    const h = harness(), item = await create(h), read = boundary.getRun.getMockImplementation()!;
    boundary.getRun.mockImplementationOnce(async (...args) => { const result = await read(...args); h.authorization.active = false; return result; });
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
  it('revocación antes del commit revierte estado y evento juntos', async () => {
    const h = harness(), item = await create(h), write = h.mocks.assistantWorkEvent.create.getMockImplementation()!;
    h.mocks.assistantWorkEvent.create.mockImplementationOnce(async query => {
      const saved = await write(query); h.authorization.active = false; return saved;
    });
    await expect(event(h, item.id, 0, 'WAIT')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(h.items[0]).toMatchObject({ version: 0, status: 'IN_REVIEW', eventCount: 1 }); expect(h.events).toHaveLength(1);
  });
  it('caducidad del encargo o del run impide recuperar la fuente', async () => {
    const h = harness(), item = await create(h);
    h.items[0].expiresAt = now;
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_NOT_FOUND' });
    h.items[0].expiresAt = new Date('2026-10-01T00:00:00Z'); h.runs[0].expiresAt = now;
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
  });
  it.each(['PENDING', 'RUNNING', 'FAILED', 'CANCELLED'])('run %s no puede convertirse en fuente', async status => {
    const h = harness(); h.runs[0].status = status;
    await expect(create(h)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
    expect(h.items).toEqual([]); expect(h.events).toEqual([]);
  });
  it.each(['missing', 'duplicate', 'invalid'])('evidencia %s bloquea la creación', async kind => {
    const h = harness(), evidence = h.runs[0].result.evidence;
    if (kind === 'missing') h.runs[0].result.evidence = [];
    if (kind === 'duplicate') evidence.push({ ...evidence[0], id: 'second' });
    if (kind === 'invalid') evidence[0].data = { kind: 'WEEKLY_CASH_REVIEW', status: 'ok' };
    await expect(create(h)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
    expect(h.items).toEqual([]);
  });
  it('fuente alterada o retirada bloquea detalle, evento y listado sin sustituirla', async () => {
    const h = harness(), item = await create(h); h.runs[0].result.evidence[0].data.warnings.push('Cambio posterior');
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
    await expect(event(h, item.id, 0, 'WAIT')).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
    await expect(listAssistantWorkItems(principal, {}, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE' });
    expect(h.events).toHaveLength(1); expect(h.items[0].version).toBe(0);
  });
  it('result persistido malformado es fuente indisponible, no entrada inválida del usuario', async () => {
    const h = harness(), item = await create(h);
    const malformed = z.object({ evidence: z.array(z.unknown()) }).safeParse({ evidence: 'malformada' });
    if (malformed.success) throw new Error('La prueba necesita un error de validación del resultado guardado.');
    boundary.getRun.mockRejectedValueOnce(malformed.error);
    await expect(getAssistantWorkItem(principal, item.id, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_SOURCE_UNAVAILABLE', statusCode: 409 });
    expect(h.events).toHaveLength(1); expect(h.items[0].version).toBe(0);
  });
  it('guardar, esperar y retomar conserva las notas humanas sin modificar la revisión', async () => {
    const h = harness(), item = await create(h), original = structuredClone(h.runs[0].result);
    const note = await appendAssistantWorkItemEvent(principal, item.id, { eventId: randomUUID(), version: 0, type: 'ADD_NOTE', note: 'Pendiente revisar recibo físico; no es causa acreditada.' }, h.deps);
    expect(note.version).toBe(1); expect(note.status).toBe('IN_REVIEW');
    const waiting = await event(h, item.id, 1, 'WAIT'); expect(waiting).toMatchObject({ status: 'WAITING', version: 2 });
    const resumed = await event(h, item.id, 2, 'RESUME'); expect(resumed).toMatchObject({ status: 'IN_REVIEW', version: 3 });
    const recovered = await getAssistantWorkItem(principal, item.id, h.deps);
    expect(recovered.events.filter(value => value.type === 'ADD_NOTE').map(value => value.note)).toEqual(['Pendiente revisar recibo físico; no es causa acreditada.']);
    expect(recovered.review).toEqual(original.evidence[0].data); expect(h.runs[0].result).toEqual(original);
    expect(h.forbiddenAccesses).toEqual([]);
  });
  it('replay exacto se acepta antes de verificar la versión actual y no duplica la nota', async () => {
    const h = harness(), item = await create(h), command = { eventId: randomUUID(), version: 0, type: 'ADD_NOTE' as const, note: 'Comprobante solicitado.' };
    await appendAssistantWorkItemEvent(principal, item.id, command, h.deps);
    await event(h, item.id, 1, 'WAIT');
    const replay = await appendAssistantWorkItemEvent(principal, item.id, command, h.deps);
    expect(replay).toMatchObject({ version: 2, status: 'WAITING' });
    expect(h.events.filter(value => value.eventId === command.eventId)).toHaveLength(1);
    await expect(appendAssistantWorkItemEvent(principal, item.id, { ...command, note: 'Texto cambiado.' }, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_EVENT_CONFLICT' });
    expect(h.events).toHaveLength(3);
  });
  it('UUID normalizado conserva identidad; cambiar versión con el mismo UUID es conflicto', async () => {
    const h = harness(), item = await create(h), command = { eventId: randomUUID(), version: 0, type: 'WAIT' as const };
    await appendAssistantWorkItemEvent(principal, item.id, command, h.deps);
    expect((await appendAssistantWorkItemEvent(principal, item.id, { ...command, eventId: command.eventId.toUpperCase() }, h.deps)).version).toBe(1);
    await expect(appendAssistantWorkItemEvent(principal, item.id, { ...command, version: 1 }, h.deps)).rejects.toMatchObject({ code: 'WORK_ITEM_EVENT_CONFLICT' });
    expect(h.events).toHaveLength(2);
  });
  it('dos comandos sobre la misma versión sólo permiten un ganador', async () => {
    const h = harness(), item = await create(h);
    const results = await Promise.allSettled([event(h, item.id, 0, 'WAIT'), event(h, item.id, 0, 'CANCEL')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'WORK_ITEM_CHANGED' } });
    expect(h.items[0].version).toBe(1); expect(h.events).toHaveLength(2);
  });
  it('fallo del CAS no escribe evento ni avanza estado', async () => {
    const h = harness(), item = await create(h); h.failNextCas();
    await expect(event(h, item.id, 0, 'WAIT')).rejects.toMatchObject({ code: 'WORK_ITEM_CHANGED' });
    expect(h.items[0]).toMatchObject({ version: 0, status: 'IN_REVIEW' }); expect(h.events).toHaveLength(1);
  });
  it('fallo al persistir evento revierte el CAS en la misma transacción', async () => {
    const h = harness(), item = await create(h); h.failNextEventCreate();
    await expect(event(h, item.id, 0, 'WAIT')).rejects.toThrow('INJECTED_EVENT_WRITE_FAILURE');
    expect(h.items[0]).toMatchObject({ version: 0, status: 'IN_REVIEW' }); expect(h.events).toHaveLength(1);
  });
  it('fallo del evento inicial revierte también el encargo', async () => {
    const h = harness(); h.failNextEventCreate();
    await expect(create(h)).rejects.toThrow('INJECTED_EVENT_WRITE_FAILURE');
    expect(h.items).toEqual([]); expect(h.events).toEqual([]);
  });
  it('cancelar conserva evidencia y admite sólo replay exacto', async () => {
    const h = harness(), item = await create(h), command = { eventId: randomUUID(), version: 0, type: 'CANCEL' as const };
    const cancelled = await appendAssistantWorkItemEvent(principal, item.id, command, h.deps);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', version: 1 });
    expect((await appendAssistantWorkItemEvent(principal, item.id, command, h.deps)).status).toBe('CANCELLED');
    await expect(event(h, item.id, 1, 'RESUME')).rejects.toMatchObject({ code: 'WORK_ITEM_CANCELLED' });
    expect((await getAssistantWorkItem(principal, item.id, h.deps)).review).toEqual(review());
    expect(h.runs[0].status).toBe('SUCCEEDED'); expect(h.events).toHaveLength(2);
  });
  it('transiciones inválidas y notas vacías no crean eventos', async () => {
    const h = harness(), item = await create(h);
    await expect(event(h, item.id, 0, 'RESUME')).rejects.toMatchObject({ code: 'WORK_ITEM_TRANSITION' });
    await expect(appendAssistantWorkItemEvent(principal, item.id, { eventId: randomUUID(), version: 0, type: 'ADD_NOTE', note: '   ' }, h.deps)).rejects.toThrow();
    expect(h.events).toHaveLength(1);
  });
  it.each([
    { eventId: 'not-a-uuid', version: 0, type: 'WAIT' },
    { version: -1, type: 'WAIT' },
    { version: 0.5, type: 'WAIT' },
    { version: 0, type: 'ACCEPT' },
    { version: 0, type: 'ADD_NOTE', note: 'x'.repeat(2001) },
    { version: 0, type: 'WAIT', tenantId: 'tenant-b' },
  ])('entrada de evento inválida no cambia estado %#', async invalid => {
    const h = harness(), item = await create(h);
    await expect(appendAssistantWorkItemEvent(principal, item.id, { eventId: randomUUID(), ...invalid }, h.deps)).rejects.toThrow();
    expect(h.items[0].version).toBe(0); expect(h.events).toHaveLength(1);
  });
  it('listado se acota a veinte, pagina sin duplicados y revalida cada run', async () => {
    const h = harness();
    for (let i = 0; i < 23; i++) { const runId = `run-${String(i).padStart(2, '0')}`; h.addRun(runId); await create(h, runId); }
    boundary.getRun.mockClear();
    const first = await listAssistantWorkItems(principal, {}, h.deps);
    expect(first.items).toHaveLength(20); expect(first.nextCursor).not.toBeNull();
    expect(boundary.getRun.mock.calls.length).toBeGreaterThanOrEqual(20);
    const second = await listAssistantWorkItems(principal, { cursor: first.nextCursor }, h.deps);
    expect(second.items).toHaveLength(3); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(23);
    expect(h.forbiddenAccesses).toEqual([]);
  });
  it('recuperar varias veces nunca agrega eventos, runs ni consultas de dominio', async () => {
    const h = harness(), item = await create(h), before = structuredClone({ items: h.items, events: h.events, runs: h.runs });
    await getAssistantWorkItem(principal, item.id, h.deps); await listAssistantWorkItems(principal, {}, h.deps); await getAssistantWorkItem(principal, item.id, h.deps);
    expect({ items: h.items, events: h.events, runs: h.runs }).toEqual(before); expect(h.forbiddenAccesses).toEqual([]);
    expect(h.mocks.assistantRun.create).not.toHaveBeenCalled(); expect(h.mocks.assistantRun.updateMany).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('detalle limita cien eventos e indica si existen más', async () => {
    const h = harness(), item = await create(h), first = structuredClone(h.events[0]);
    for (let i = 1; i <= 101; i++) h.events.push({ ...first, id: `event-${String(i).padStart(3, '0')}`, eventId: randomUUID(), type: 'ADD_NOTE', note: `Aporte humano ${i}`, version: i, createdAt: new Date(now.getTime() + i) });
    h.items[0].eventCount = h.events.length; h.items[0].version = 101;
    const detail = await getAssistantWorkItem(principal, item.id, h.deps);
    expect(detail.events).toHaveLength(100); expect(detail.eventsTruncated).toBe(true);
    expect(h.mocks.assistantWorkEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: expect.any(Number) }));
    expect(h.mocks.assistantWorkEvent.findMany.mock.calls.every(([query]) => query.take! <= 101)).toBe(true);
  });
  it('el doble falla ante cualquier tabla ajena o escritura SQL', async () => {
    const h = harness();
    expect(() => (h.db as any).sale).toThrow('Forbidden work-item dependency');
    await expect(h.mocks.$queryRaw({ strings: ['DELETE FROM AssistantWorkItem'], values: [] })).rejects.toThrow('Forbidden work-item dependency');
  });
  it('limpieza borra como máximo cien vencidos con sus eventos y conserva runs/vigentes', async () => {
    const h = harness(), item = await create(h), baseItem = structuredClone(h.items[0]), baseEvent = structuredClone(h.events[0]);
    for (let i = 0; i < 101; i++) {
      h.items.push({ ...baseItem, id: `expired-${String(i).padStart(3, '0')}`, expiresAt: new Date(now.getTime() - 1) });
      h.events.push({ ...baseEvent, id: `expired-event-${i}`, workItemId: `expired-${String(i).padStart(3, '0')}` });
    }
    const runs = structuredClone(h.runs);
    expect(await cleanupAssistantWorkItems(h.db, now)).toBe(100);
    expect(h.items).toHaveLength(2); expect(h.events).toHaveLength(2);
    expect(h.items.some(value => value.id === item.id)).toBe(true); expect(h.runs).toEqual(runs);
    expect(h.events.every(value => h.items.some(row => row.id === value.workItemId))).toBe(true);
    expect(await cleanupAssistantWorkItems(h.db, now)).toBe(1);
    expect(await cleanupAssistantWorkItems(h.db, now)).toBe(0);
    expect(h.items.map(value => value.id)).toEqual([item.id]);
  });
  it('limpieza revierte el borrado de eventos si no puede borrar el encargo exacto', async () => {
    const h = harness(); await create(h); h.items[0].expiresAt = now;
    h.mocks.assistantWorkItem.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(cleanupAssistantWorkItems(h.db, now)).rejects.toThrow('must roll back');
    expect(h.items).toHaveLength(1); expect(h.events).toHaveLength(1);
  });
  it('limpieza revalida la caducidad bajo lock antes de borrar hijos', async () => {
    const h = harness(); await create(h); h.items[0].expiresAt = now;
    const query = h.mocks.$queryRaw.getMockImplementation()!;
    h.mocks.$queryRaw.mockImplementationOnce(async (...args) => {
      h.items[0].expiresAt = new Date(now.getTime() + 1000); return query(...args);
    });
    expect(await cleanupAssistantWorkItems(h.db, now)).toBe(0);
    expect(h.items).toHaveLength(1); expect(h.events).toHaveLength(1);
    expect(h.mocks.assistantWorkEvent.deleteMany).not.toHaveBeenCalled();
  });
});
