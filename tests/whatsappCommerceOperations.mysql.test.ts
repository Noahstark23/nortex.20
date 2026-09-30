// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { getCommerceOperations, publishCommerceHeartbeat } from '../backend/services/whatsapp/commerce/operations';
import { createCommerceWorkerRuntime } from '../backend/workers/whatsappCommerce';
const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const tenantId = `qa-wa-ops-${randomUUID()}`, otherId = `${tenantId}-other`, userId = randomUUID(), workerId = randomUUID();
const now = new Date('2026-09-29T15:00:00Z');
const principal = { tenantId, userId, role: 'OWNER' };
qa('Operación durable del canal comercial', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)/);
    for (const id of [tenantId, otherId]) await prisma.tenant.create({ data: { id, businessName: 'QA ops', taxId: id, type: 'FERRETERIA' } });
    await prisma.user.create({ data: { id: userId, tenantId, name: 'QA Owner', email: `${userId}@synthetic.invalid`, password: 'synthetic-no-login', role: 'OWNER', status: 'ACTIVE' } });
  });
  afterAll(async () => {
    const scope = { in: [tenantId, otherId] };
    await prisma.waCommerceInbox.deleteMany({ where: { tenantId: scope } });
    await prisma.waCommerceOutbox.deleteMany({ where: { tenantId: scope } });
    await prisma.waCommerceWorkerHeartbeat.deleteMany({ where: { id: workerId } });
    await prisma.user.deleteMany({ where: { tenantId: scope } });
    await prisma.tenant.deleteMany({ where: { id: scope } });
    await prisma.$disconnect();
  });
  it('sin worker es MISSING; falla de BD no se convierte en cero', async () => {
    expect((await getCommerceOperations(principal, prisma, now)).worker.state).toBe('MISSING');
    const failedDb = new Proxy(prisma, { get(target, key) {
      if (key === 'waCommerceInbox') return new Proxy(target.waCommerceInbox, { get(delegate, method) {
        if (method === 'groupBy') return async () => { throw new Error('synthetic private unavailable'); };
        return Reflect.get(delegate, method);
      } });
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(getCommerceOperations(principal, failedDb, now)).rejects.toThrow();
  });
  it('backlog por tenant, UNKNOWN visible, edad y leases vencidos sin contenido', async () => {
    for (const id of [tenantId, otherId]) {
      for (const [status, seconds] of [['PENDING', 60], ['PROCESSING', 30], ['DONE', 120]] as const) {
        await prisma.waCommerceInbox.create({ data: { tenantId: id, channelId: randomUUID(), conversationId: randomUUID(), waId: 'synthetic', body: 'private query', providerMessageId: randomUUID(), payloadHash: 'a'.repeat(64), eventAt: now, status, createdAt: new Date(now.getTime() - seconds * 1000), leaseUntil: status === 'PROCESSING' ? new Date(now.getTime() - 1) : null } });
      }
      for (const [status, seconds] of [['PENDING', 20], ['SENDING', 30], ['UNKNOWN', 90]] as const) {
        await prisma.waCommerceOutbox.create({ data: { tenantId: id, channelId: randomUUID(), conversationId: randomUUID(), waId: 'synthetic', body: 'private response', idempotencyKey: randomUUID(), policyVersion: 1, expiresAt: now, status, createdAt: new Date(now.getTime() - seconds * 1000), leaseUntil: status === 'SENDING' ? new Date(now.getTime() - 1) : null } });
      }
    }
    const result = await getCommerceOperations(principal, prisma, now);
    expect(result.inbox).toEqual({ counts: { PENDING: 1, PROCESSING: 1, DONE: 1 }, oldestPendingAt: new Date(now.getTime() - 60000), oldestPendingAgeMs: 60000, expiredLeases: 1 });
    expect(result.outbox).toEqual({ counts: { PENDING: 1, SENDING: 1, UNKNOWN: 1 }, oldestPendingAt: new Date(now.getTime() - 90000), oldestPendingAgeMs: 90000, expiredLeases: 1 });
    expect(JSON.stringify(result)).not.toContain('private');
    await expect(getCommerceOperations({ ...principal, tenantId: otherId }, prisma, now)).rejects.toMatchObject({ code: 'COMMERCE_FORBIDDEN' });
    await expect(getCommerceOperations({ ...principal, role: 'ADMIN' }, prisma, now)).rejects.toMatchObject({ code: 'COMMERCE_FORBIDDEN' });
  });
  it('worker PAUSED, RUNNING idle, progreso real, throttle, ERROR safe, STOPPED y STALE', async () => {
    let time = new Date(now), enabled = false, progresses = false;
    const processInbox = vi.fn(async () => progresses);
    const runtime = createCommerceWorkerRuntime({ db: prisma, now: () => time, instanceId: workerId,
      flags: () => ({ processingEnabled: enabled, sendingEnabled: false }), recover: async () => 0, processInbox, dispatch: async () => false });
    expect(await runtime.tick()).toEqual({ progress: false, status: 'PAUSED' });
    expect(processInbox).not.toHaveBeenCalled();
    expect((await getCommerceOperations(principal, prisma, time)).worker.state).toBe('PAUSED');
    enabled = true; await runtime.tick();
    let row = await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.status).toBe('RUNNING'); expect(row.lastProgressAt).toBeNull();
    expect((await getCommerceOperations(principal, prisma, time)).worker.state).toBe('RUNNING');
    time = new Date(now.getTime() + 1000); progresses = true; await runtime.tick();
    expect((await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } })).lastSeenAt).toEqual(now);
    time = new Date(now.getTime() + 5000); progresses = false; await runtime.tick();
    row = await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.lastProgressAt).toEqual(new Date(now.getTime() + 1000));
    expect((await getCommerceOperations(principal, prisma, new Date(time.getTime() + 30000))).worker.state).toBe('RUNNING');
    const publicState = await getCommerceOperations(principal, prisma, new Date(time.getTime() + 30001));
    expect(publicState.worker.state).toBe('STALE'); expect(JSON.stringify(publicState.worker)).not.toContain(workerId);
    processInbox.mockRejectedValueOnce(new Error('private error token never stored'));
    expect((await runtime.tick()).status).toBe('ERROR');
    row = await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.errorCode).toBe('COMMERCE_WORKER_FAILED');
    expect((await getCommerceOperations(principal, prisma, time)).worker.state).toBe('ERROR');
    await runtime.stop();
    expect((await getCommerceOperations(principal, prisma, time)).worker.state).toBe('STOPPED');
    expect((await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } })).errorCode).toBeNull();
  });
  it('heartbeat solo publica código permitido aunque un caller intente texto sensible', async () => {
    await publishCommerceHeartbeat({ id: workerId, startedAt: now, now, lastProgressAt: null, processingEnabled: true, sendingEnabled: false, status: 'ERROR', errorCode: 'private sensitive string' as never }, prisma);
    expect((await prisma.waCommerceWorkerHeartbeat.findUniqueOrThrow({ where: { id: workerId } })).errorCode).toBe('COMMERCE_WORKER_FAILED');
    await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
    await expect(getCommerceOperations(principal, prisma, now)).rejects.toMatchObject({ code: 'COMMERCE_FORBIDDEN' });
  });
});
