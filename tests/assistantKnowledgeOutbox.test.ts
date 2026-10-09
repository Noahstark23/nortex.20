import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchPrivateWaOutboxOnce } from '../backend/services/assistant/privateWhatsapp/outbox';

const state = vi.hoisted(() => ({ valid: true, validate: vi.fn(), binding: { id: 'binding-help', tenantId: 'tenant-help', userId: 'user-help', roleAtBinding: 'OWNER', waId: 'synthetic-recipient', phoneNumberId: 'synthetic-channel' } }));
vi.mock('../backend/services/assistant/privateWhatsapp/identity', () => ({ requirePrivateWaBinding: vi.fn(async () => ({ binding: state.binding, principal: { tenantId: state.binding.tenantId, userId: state.binding.userId, role: state.binding.roleAtBinding } })) }));
vi.mock('../backend/services/assistant/knowledge/service', () => ({ validateAssistantKnowledgeReferences: (...args: unknown[]) => { state.validate(...args); return Promise.resolve(state.valid); } }));
const reference = { documentId: 'help', version: 'v1', sectionId: 'main', contentHash: 'a'.repeat(64) };
function harness(references: unknown) {
  const now = new Date('2026-09-19T12:00:00Z');
  const row = { ...state.binding, id: 'outbox-help', bindingId: state.binding.id, bindingVersion: 1, roleAtCreation: 'OWNER', knowledgeReferences: references, text: 'Ayuda pendiente de envío', expiresAt: new Date(now.getTime() + 60000), status: 'PENDING', leaseToken: 'lease-help' };
  const update = vi.fn(async (input: { data: Record<string, unknown> }) => { Object.assign(row, input.data); return { count: 1 }; });
  const db = { $queryRaw: vi.fn(async () => [{ id: row.id, phoneNumberId: row.phoneNumberId, waId: row.waId }]), assistantWaOutbox: { findMany: vi.fn(async () => []), updateMany: update, findUnique: vi.fn(async () => row) }, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db) };
  const sender = { send: vi.fn(async () => ({ messageId: 'mock-only-message' })) };
  return { row, db, sender, update, deps: { db: db as never, sender, now: () => now, config: { enabled: true, sendingEnabled: true, phoneNumberId: state.binding.phoneNumberId } as never } };
}
beforeEach(() => { state.valid = true; state.validate.mockClear(); });
describe('retiro de ayuda antes de salida privada durable', () => {
  it('revalida el canal privado inmediatamente antes del sender simulado', async () => {
    const h = harness([reference]);
    expect(await dispatchPrivateWaOutboxOnce(h.deps)).toBe(true);
    expect(state.validate).toHaveBeenCalledWith({ tenantId: 'tenant-help', userId: 'user-help', role: 'OWNER' }, [reference], h.db, 'WHATSAPP_PRIVATE');
    expect(h.sender.send).toHaveBeenCalledOnce();
    expect(h.row.status).toBe('SENT');
  });
  it('cancela sin invocar el sender cuando la ayuda se retiró después de preparar la salida', async () => {
    const h = harness([reference]); state.valid = false;
    await dispatchPrivateWaOutboxOnce(h.deps);
    expect(h.sender.send).not.toHaveBeenCalled();
    expect(h.row.status).toBe('CANCELLED');
  });
  it.each([null, undefined, [{ ...reference, contentHash: 'invalid' }]])('no considera limpia la procedencia legacy o inválida: %j', async references => {
    const h = harness(references);
    await dispatchPrivateWaOutboxOnce(h.deps);
    expect(h.sender.send).not.toHaveBeenCalled();
    expect(h.row.status).toBe('CANCELLED');
  });
  it('una salida nueva sin fuentes documentales usa evidencia explícita vacía', async () => {
    const h = harness([]);
    await dispatchPrivateWaOutboxOnce(h.deps);
    expect(h.sender.send).toHaveBeenCalledOnce();
    expect(h.row.status).toBe('SENT');
  });
  it('conserva UNKNOWN cuando el sender fue invocado y la respuesta se perdió', async () => {
    const h = harness([reference]); h.sender.send.mockRejectedValue(new Error('mock timeout'));
    await dispatchPrivateWaOutboxOnce(h.deps);
    expect(h.sender.send).toHaveBeenCalledOnce();
    expect(h.row.status).toBe('UNKNOWN');
  });
});
