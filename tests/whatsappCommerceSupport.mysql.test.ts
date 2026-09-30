// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma.js';
import { getSupportActivationRequest, listSupportActivationRequests, transitionSupportActivationRequest } from '../backend/services/whatsapp/commerce/activationSupport.js';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const tenants: string[] = [];
const action = 'WHATSAPP_COMMERCE_ACTIVATION_SUPPORT';
let network: ReturnType<typeof vi.spyOn>;
async function seed(role = 'SUPER_ADMIN') {
  const tenantId = `qa-wa-support-${randomUUID()}`; tenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, businessName: 'QA support', taxId: tenantId, type: 'FERRETERIA' } });
  const user = await prisma.user.create({ data: { tenantId, email: `qa-${randomUUID()}@example.invalid`, password: 'SYNTHETIC-NOT-A-CREDENTIAL', name: 'QA operator', role } });
  return { tenantId, user, principal: { tenantId, userId: user.id, role } };
}
async function request() {
  const merchant = await seed('OWNER');
  const row = await prisma.waCommerceActivationRequest.create({ data: { tenantId: merchant.tenantId, phone: '+50588889999', requestedBy: merchant.user.id, noticeVersion: 'QA' } });
  return { merchant, row };
}
qa('Soporte asistido sin activar transporte, MySQL descartable', () => {
  beforeAll(() => {
    expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
    const url = new URL(process.env.DATABASE_URL!); expect(['localhost', '127.0.0.1']).toContain(url.hostname); expect(url.protocol).toBe('mysql:'); expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/);
    network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: externo bloqueado'));
  });
  afterEach(async () => {
    const where = { tenantId: { in: tenants } };
    await prisma.auditLog.deleteMany({ where: { ...where, action } });
    await prisma.waCommerceActivationRequest.deleteMany({ where });
    await prisma.user.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }); tenants.length = 0;
  });
  afterAll(async () => { try { if (network) expect(network).not.toHaveBeenCalled(); } finally { network?.mockRestore(); await prisma.$disconnect(); } });

  it('permite sólo SUPER_ADMIN vigente; ni OWNER ni rol forjado, revocado o tenant equivocado', async () => {
    const support = await seed(); const { merchant, row } = await request();
    for (const principal of [merchant.principal, { ...merchant.principal, role: 'SUPER_ADMIN' }, { ...support.principal, tenantId: merchant.tenantId }]) {
      await expect(listSupportActivationRequests(principal, {}, prisma)).rejects.toMatchObject({ statusCode: 403 });
      await expect(getSupportActivationRequest(principal, row.id, prisma)).rejects.toMatchObject({ statusCode: 403 });
      await expect(transitionSupportActivationRequest(principal, row.id, { version: 1, status: 'IN_PROGRESS' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    }
    const admin = await seed('ADMIN');
    await expect(listSupportActivationRequests(admin.principal, {}, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: support.user.id }, data: { status: 'DISABLED' } });
    await expect(getSupportActivationRequest(support.principal, row.id, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await expect(transitionSupportActivationRequest(support.principal, row.id, { version: 1, status: 'IN_PROGRESS' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: support.user.id }, data: { status: 'ACTIVE', role: 'ADMIN' } });
    await expect(listSupportActivationRequests(support.principal, {}, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await expect(transitionSupportActivationRequest(support.principal, row.id, { version: 1, status: 'IN_PROGRESS' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.waCommerceActivationRequest.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(1);
    expect(await prisma.auditLog.count({ where: { action, tenantId: { in: tenants } } })).toBe(0);
  });

  it('dos operadores compiten por una asignación; transiciones y auditoría conservan responsable', async () => {
    const first = await seed(), second = await seed(); const { merchant, row } = await request();
    const claims = await Promise.allSettled([first, second].map(actor => transitionSupportActivationRequest(actor.principal, row.id, { version: 1, status: 'IN_PROGRESS' }, prisma)));
    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(claims.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'COMMERCE_SUPPORT_VERSION' } });
    const assigned = await getSupportActivationRequest(first.principal, row.id, prisma);
    const winner = assigned.assignedTo === first.user.id ? first : second, loser = winner === first ? second : first;
    expect(assigned).toMatchObject({ version: 2, status: 'IN_PROGRESS', assignedTo: winner.user.id });
    await expect(transitionSupportActivationRequest(loser.principal, row.id, { version: 2, status: 'WAITING_OWNER' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_ASSIGNMENT' });
    const waiting = await transitionSupportActivationRequest(winner.principal, row.id, { version: 2, status: 'WAITING_OWNER' }, prisma);
    const resumed = await transitionSupportActivationRequest(winner.principal, row.id, { version: waiting.version, status: 'IN_PROGRESS' }, prisma);
    const prepared = await transitionSupportActivationRequest(winner.principal, row.id, { version: resumed.version, status: 'PREPARED' }, prisma);
    expect(prepared).toMatchObject({ status: 'PREPARED', version: 5, assignedTo: winner.user.id });
    await expect(transitionSupportActivationRequest(winner.principal, row.id, { version: 5, status: 'CANCELLED' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_TRANSITION' });
    const audits = await prisma.auditLog.findMany({ where: { tenantId: merchant.tenantId, action }, take: 10 });
    expect(audits).toHaveLength(4); expect(audits.every(log => log.userId === winner.user.id && !log.details.includes('88889999'))).toBe(true);
    expect(await prisma.whatsAppChannel.count({ where: { tenantId: merchant.tenantId } })).toBe(0);
    expect((await listSupportActivationRequests(first.principal, {}, prisma)).items).toHaveLength(0);
    expect((await listSupportActivationRequests(first.principal, { status: 'PREPARED' }, prisma)).items.map(item => item.id)).toEqual([row.id]);
  });

  it('rechaza saltos, stale y cancelación sin asignación; CANCELLED no admite reabrir', async () => {
    const actor = await seed(); const { row } = await request();
    for (const status of ['PREPARED', 'CANCELLED', 'WAITING_OWNER']) await expect(transitionSupportActivationRequest(actor.principal, row.id, { version: 1, status }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_TRANSITION' });
    const claimed = await transitionSupportActivationRequest(actor.principal, row.id, { version: 1, status: 'IN_PROGRESS' }, prisma);
    await expect(transitionSupportActivationRequest(actor.principal, row.id, { version: 1, status: 'PREPARED' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_VERSION' });
    await transitionSupportActivationRequest(actor.principal, row.id, { version: claimed.version, status: 'CANCELLED' }, prisma);
    await expect(transitionSupportActivationRequest(actor.principal, row.id, { version: 3, status: 'IN_PROGRESS' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_TRANSITION' });
  });

  it('la auditoría fallida revierte estado, versión y asignación juntos', async () => {
    const actor = await seed(); const { row } = await request();
    const failing = { $transaction: (callback, options) => prisma.$transaction(tx => callback(new Proxy(tx, { get(target, key) { if (key === 'auditLog') return { create: async () => { throw new Error('QA_AUDIT_FAILURE'); } }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } })), options) } as unknown as PrismaClient;
    await expect(transitionSupportActivationRequest(actor.principal, row.id, { version: 1, status: 'IN_PROGRESS' }, failing)).rejects.toThrow('QA_AUDIT_FAILURE');
    expect(await getSupportActivationRequest(actor.principal, row.id, prisma)).toMatchObject({ version: 1, status: 'REQUESTED', assignedTo: null });
    expect(await prisma.auditLog.count({ where: { action, tenantId: { in: tenants } } })).toBe(0);
  });

  it('pagina 51 solicitudes con fecha igual sin duplicar y sólo devuelve el expediente permitido', async () => {
    const actor = await seed(); const createdAt = new Date('2026-09-29T10:00:00Z');
    const ids: string[] = [];
    for (let index = 0; index < 51; index++) { const { row } = await request(); ids.push(row.id); }
    await prisma.waCommerceActivationRequest.updateMany({ where: { id: { in: ids } }, data: { createdAt } });
    const first = await listSupportActivationRequests(actor.principal, {}, prisma);
    expect(first.items).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const second = await listSupportActivationRequests(actor.principal, { cursor: first.nextCursor! }, prisma);
    expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(ids.sort());
    expect(Object.keys(first.items[0]).sort()).toEqual(['id', 'tenantId', 'phone', 'status', 'version', 'assignedTo', 'createdAt', 'updatedAt'].sort());
    await expect(listSupportActivationRequests(actor.principal, { cursor: 'missing' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_SUPPORT_CURSOR' });
    expect(await prisma.auditLog.count({ where: { action, tenantId: { in: tenants } } })).toBe(0);
  });
});
