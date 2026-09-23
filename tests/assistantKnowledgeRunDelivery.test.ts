import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantRun, executeAssistantRun, getAssistantRun, listAssistantRuns } from '../backend/services/assistant/operations/runService';

const state = vi.hoisted(() => ({ valid: true, authorized: true, validate: vi.fn() }));
vi.mock('../backend/services/assistant/access', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), assertAssistantAccess: vi.fn(async () => { if (!state.authorized) throw new Error('session revoked'); }) }));
vi.mock('../backend/services/assistant/actions/service', () => ({ readAssistantRunActionReferences: vi.fn(async () => []) }));
vi.mock('../backend/services/assistant/knowledge/service', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), validateAssistantKnowledgeReferences: (...args: unknown[]) => { state.validate(...args); return Promise.resolve(state.valid); } }));
const principal = { tenantId: 'tenant-help', userId: 'user-help', role: 'OWNER' };
const reference = { documentId: 'help', version: 'v1', sectionId: 'main', contentHash: 'a'.repeat(64) };
const text = 'Solicitud de ayuda';
function harness() {
  const now = new Date('2026-09-19T12:00:00Z');
  const row = { id: 'run-help', tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: 'OWNER', conversationId: 'conversation-help', requestId: 'aaaabbbb-1111-4222-8333-0123456789ab', payloadHash: createHash('sha256').update(text).digest('hex'), knowledgeChannel: 'WHATSAPP_PRIVATE', status: 'SUCCEEDED', version: 2, iterations: 1, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000), errorCode: null,
    checkpoint: { iterations: 1, messages: [], steps: [], evidence: [], actionProposalIds: [], knowledgeReferences: [reference] },
    result: { text: 'Explicación que dependió de la fuente', evidence: [{ id: 'e1', tool: 'read_sample', label: 'Fuente independiente', data: { checked: true } }], actionProposalIds: [], degraded: false, knowledgeReferences: [reference] } };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const version = row.version; Object.assign(row, data); if (data.version && typeof data.version === 'object' && 'increment' in data.version) row.version = version + Number(data.version.increment); return { count: 1 }; });
  const db = { $queryRaw: vi.fn(async () => [{ id: row.conversationId }]), assistantRun: { findFirst: vi.fn(async () => row), findMany: vi.fn(async () => [row]), updateMany: update }, assistantMessage: { findMany: vi.fn(async () => []) }, assistantConversation: { findFirst: vi.fn(async () => ({ id: row.conversationId, expiresAt: row.expiresAt })) }, assistantWaBinding: { findFirst: vi.fn(async () => null) }, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db) };
  return { row, db, deps: { db: db as never, now: () => now } };
}
beforeEach(() => { state.valid = true; state.authorized = true; state.validate.mockClear(); });
describe('revalidación real de DTOs de ejecuciones guardadas', () => {
  it('get y list ocultan prosa retirada aunque la respuesta sólo muestre evidencia operativa', async () => {
    const h = harness(); state.valid = false;
    const one = await getAssistantRun(principal, h.row.id, { ...h.deps, channel: 'WEB_INTERNAL' });
    const many = await listAssistantRuns(principal, h.row.conversationId, { ...h.deps, channel: 'WEB_INTERNAL' });
    for (const result of [one.result, many[0].result]) {
      expect(result?.knowledgeUnavailable).toBe(true);
      expect(result?.text).not.toBe(h.row.result.text);
      expect(result?.evidence).toEqual(h.row.result.evidence);
    }
  });
  it('reintentar el mismo requestId no devuelve el texto original después del retiro', async () => {
    const h = harness(); state.valid = false;
    const actual = await createAssistantRun(principal, h.row.conversationId, { requestId: h.row.requestId, text }, { ...h.deps, channel: 'WEB_INTERNAL' });
    expect(actual.id).toBe(h.row.id);
    expect(actual.result?.knowledgeUnavailable).toBe(true);
    expect(actual.result?.text).not.toBe(h.row.result.text);
  });
  it('conserva origen privado después de desvincular y admite filtro de entrega web explícito', async () => {
    const h = harness();
    await getAssistantRun(principal, h.row.id, h.deps);
    expect(state.validate.mock.calls.at(-1)?.[3]).toBe('WHATSAPP_PRIVATE');
    await getAssistantRun(principal, h.row.id, { ...h.deps, channel: 'WEB_INTERNAL' });
    expect(state.validate.mock.calls.at(-1)?.[3]).toBe('WEB_INTERNAL');
  });
  it('una sesión revocada no lee la fila del historial', async () => {
    const h = harness(); state.authorized = false;
    await expect(getAssistantRun(principal, h.row.id, h.deps)).rejects.toThrow('session revoked');
    expect(h.db.assistantRun.findFirst).not.toHaveBeenCalled();
  });
  it('el origen persistido controla la ejecución aunque la entrega solicite canal web', async () => {
    const h = harness(); h.row.status = 'PENDING'; h.row.result = null; h.row.checkpoint = null;
    h.db.assistantRun.findMany.mockResolvedValue([]);
    const orchestrate = vi.fn(async (_input: unknown, _deps: unknown) => ({ text: 'Consulta independiente', evidence: [], actionProposalIds: [], degraded: true, knowledgeReferences: [] }));
    const actual = await executeAssistantRun(principal, h.row.conversationId, { requestId: h.row.requestId, text }, { ...h.deps, channel: 'WEB_INTERNAL', tools: [], orchestrate });
    expect(actual.status).toBe('SUCCEEDED');
    expect(orchestrate.mock.calls[0]?.[0]).toMatchObject({ channel: 'WHATSAPP_PRIVATE' });
    expect(h.row.knowledgeChannel).toBe('WHATSAPP_PRIVATE');
  });
  it('un PENDING legacy sin origen verificable conserva su identidad y pide nueva consulta', async () => {
    const h = harness(); h.row.status = 'PENDING'; h.row.result = null; h.row.checkpoint = null; h.row.knowledgeChannel = null;
    const orchestrate = vi.fn(async (_input: unknown, _deps: unknown) => ({ text: 'No debe ejecutarse', evidence: [], actionProposalIds: [], degraded: true }));
    const actual = await executeAssistantRun(principal, h.row.conversationId, { requestId: h.row.requestId, text }, { ...h.deps, tools: [], orchestrate });
    expect(actual).toMatchObject({ id: h.row.id, status: 'FAILED', errorCode: 'RUN_CHANNEL_UNKNOWN' });
    expect(orchestrate).not.toHaveBeenCalled();
  });
});
