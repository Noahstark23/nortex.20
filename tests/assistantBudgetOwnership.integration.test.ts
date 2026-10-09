import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { budgetMonth, reserveAssistantBudget, settleAssistantBudget } from '../backend/services/assistant/budget';
import { setAssistantBudgetOwnership } from '../backend/services/assistant/budgetOwnership';
import { api, assertDisposableDatabase, baseUrl, roleActor, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const path = '/api/admin/assistant-budget/ownership';
const auditAction = 'ASSISTANT_BUDGET_OWNERSHIP_CHANGED';
const reason = 'Autoridad de presupuesto revisada por Nortex para esta cuenta QA.';
let reviewer: TestActor;
let monthSequence = 0;
const clock = () => new Date(Date.UTC(2091, monthSequence++, 10, 18));
const input = (target: TestActor, granted: boolean) => ({ targetTenantId: target.tenantId, targetUserId: target.userId, granted, reason });
const change = (target: TestActor, granted: boolean, actor: TestActor = reviewer) => api(path, actor, 'POST', input(target, granted));
const identity = (target: TestActor) => prisma.user.findFirstOrThrow({ where: { id: target.userId, tenantId: target.tenantId } });
const audits = (target: TestActor) => prisma.auditLog.findMany({ where: { tenantId: target.tenantId, action: auditAction }, orderBy: { createdAt: 'asc' }, take: 20 });

async function tenantActor(role = 'ADMIN', assistantBudgetOwner = false, configured = false) {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA autoridad de presupuesto aislada', taxId: `QA-${randomUUID()}`, type: 'FERRETERIA' } });
  const actor = await roleActor({ tenantId: tenant.id, userId: '', role: '', token: '' }, role);
  if (assistantBudgetOwner) await prisma.user.update({ where: { id: actor.userId }, data: { assistantBudgetOwner: true } });
  if (configured) await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, monthlyBudgetUsd: '10', approvedMonthlyBudgetUsd: '2' } });
  return actor;
}

/** MySQL conserva la transacción real; sólo se hace fallar su auditoría final. */
function failAudit(): typeof prisma {
  return new Proxy(prisma, { get(target, field) {
    if (field === '$transaction') return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
      prisma.$transaction(tx => work(new Proxy(tx, { get(transaction, key) {
        if (key === 'auditLog') return new Proxy(transaction.auditLog, { get(delegate, method) {
          if (method === 'create') return (args: Parameters<typeof delegate.create>[0]) => {
            if (args.data.action === auditAction) throw new Error('QA autoridad: auditoría indisponible');
            return delegate.create(args);
          };
          const value = Reflect.get(delegate, method);
          return typeof value === 'function' ? value.bind(delegate) : value;
        } });
        const value = Reflect.get(transaction, key);
        return typeof value === 'function' ? value.bind(transaction) : value;
      } })), options as Parameters<typeof prisma.$transaction>[1]);
    const value = Reflect.get(target, field);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

async function consumption(target: TestActor, now: Date) {
  const month = budgetMonth(now);
  return {
    config: await prisma.assistantTenantConfig.findUnique({ where: { tenantId: target.tenantId } }),
    tenant: await prisma.assistantBudget.findUnique({ where: { id: `tenant:${target.tenantId}:${month}` } }),
    global: await prisma.assistantBudget.findUnique({ where: { id: `global:${month}` } }),
    usage: await prisma.assistantUsage.findMany({ where: { tenantId: target.tenantId }, orderBy: { id: 'asc' }, take: 20 }),
    requests: await prisma.assistantBudgetRequest.findMany({ where: { tenantId: target.tenantId }, orderBy: { id: 'asc' }, take: 20 }),
  };
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

qa('Autoridad de presupuesto NortexGPT: administración independiente HTTP/MySQL', () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    reviewer = await tenantActor('SUPER_ADMIN');
  }, 120_000);

  it('concede autoridad al ADMIN exacto y audita identidad, antes, después y motivo', async () => {
    const target = await tenantActor('ADMIN', false, true), peer = await roleActor(target, 'ADMIN');
    status(await api('/api/assistant/budget', target), 403);
    const before = await identity(target);
    const result = await change(target, true);
    status(result, 200);
    expect(result.cacheControl).toBe('private, no-store');
    expect(result.body).toEqual({ tenantId: target.tenantId, userId: target.userId, assistantBudgetOwner: true, changed: true });
    expect(await identity(target)).toEqual({ ...before, assistantBudgetOwner: true });
    expect((await identity(peer)).assistantBudgetOwner).toBe(false);
    status(await api('/api/assistant/budget', target), 200);
    status(await api('/api/assistant/budget', peer), 403);
    const recorded = await audits(target);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ tenantId: target.tenantId, userId: reviewer.userId, action: auditAction });
    expect(JSON.parse(recorded[0].details!)).toEqual({ targetTenantId: target.tenantId, targetUserId: target.userId,
      before: { assistantBudgetOwner: false }, after: { assistantBudgetOwner: true }, reason });
  });

  it('revoca autoridad y el mismo JWT ya no permite leer ni solicitar presupuesto', async () => {
    const target = await tenantActor('ADMIN', true, true);
    status(await api('/api/assistant/budget', target), 200);
    const result = await change(target, false);
    status(result, 200);
    expect(result.body).toEqual({ tenantId: target.tenantId, userId: target.userId, assistantBudgetOwner: false, changed: true });
    status(await api('/api/assistant/budget', target), 403);
    status(await api('/api/assistant/budget/requests', target, 'POST', { idempotencyKey: randomUUID(), requestedUsd: '6.00', reason }), 403);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: target.tenantId } })).toBe(0);
    const recorded = await audits(target);
    expect(recorded).toHaveLength(1);
    expect(JSON.parse(recorded[0].details!)).toMatchObject({ before: { assistantBudgetOwner: true }, after: { assistantBudgetOwner: false } });
  });

  it('repetir el estado conserva el resultado sin duplicar la auditoría', async () => {
    const target = await tenantActor();
    for (const granted of [false, true, true, false, false]) {
      const result = await change(target, granted);
      status(result, 200);
      expect(result.body).toMatchObject({ tenantId: target.tenantId, userId: target.userId, assistantBudgetOwner: granted });
    }
    expect(await audits(target)).toHaveLength(2);
    const replay = await api(path, reviewer, 'POST', { ...input(target, false), reason: 'Nueva comprobación sin cambiar la autoridad ya revocada QA.' });
    status(replay, 200); expect(replay.body.changed).toBe(false);
    expect(await audits(target)).toHaveLength(2);
    expect(await prisma.assistantTenantConfig.count({ where: { tenantId: target.tenantId } })).toBe(0);
  });

  it('concesiones concurrentes producen un cambio y una auditoría', async () => {
    const target = await tenantActor();
    const results = await Promise.all(Array.from({ length: 4 }, () => change(target, true)));
    for (const result of results) { status(result, 200); expect(result.body.assistantBudgetOwner).toBe(true); }
    expect(results.filter(result => result.body.changed)).toHaveLength(1);
    expect(await audits(target)).toHaveLength(1);
  });

  it('requiere sesión autenticada y SUPER_ADMIN independiente para ambos cambios', async () => {
    const target = await tenantActor();
    status(await api(path, undefined, 'POST', input(target, true)), 401);
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'VIEWER', 'BODEGUERO']) {
      const actor = await roleActor(reviewer, role);
      for (const granted of [true, false]) status(await change(target, granted, actor), 403);
    }
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it.each(['status', 'role'] as const)('el JWT del revisor pierde acceso tras cambiar su %s vigente', async field => {
    const actor = await roleActor(reviewer, 'SUPER_ADMIN'), target = await tenantActor();
    await prisma.user.update({ where: { id: actor.userId }, data: field === 'status' ? { status: 'DISABLED' } : { role: 'ADMIN' } });
    status(await change(target, true, actor), 403);
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it('el servicio también exige identidad administrativa vigente', async () => {
    const actor = await roleActor(reviewer, 'ADMIN'), target = await tenantActor();
    await expect(setAssistantBudgetOwnership({ ...actor, role: 'SUPER_ADMIN' }, input(target, true)))
      .rejects.toMatchObject({ statusCode: 403, code: 'ASSISTANT_FORBIDDEN' });
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it('vincula al usuario objetivo con el tenant exacto y rechaza identidades ausentes', async () => {
    const target = await tenantActor(), other = await tenantActor();
    for (const body of [
      { ...input(target, true), targetTenantId: other.tenantId },
      { ...input(target, true), targetUserId: `missing-${randomUUID()}` },
      { ...input(target, true), targetTenantId: `missing-${randomUUID()}` },
    ]) {
      const result = await api(path, reviewer, 'POST', body);
      status(result, 404); expect(result.body.code).toBe('BUDGET_OWNER_NOT_FOUND');
    }
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect((await identity(other)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0); expect(await audits(other)).toHaveLength(0);
  });

  it('no permite cambios para la propia cuenta ni para otro usuario del tenant del revisor', async () => {
    const sameTenant = await roleActor(reviewer, 'ADMIN');
    for (const target of [reviewer, sameTenant]) for (const granted of [true, false]) {
      const result = await change(target, granted);
      status(result, 403); expect(result.body.code).toBe('BUDGET_OWNERSHIP_SELF_CHANGE');
    }
    expect((await identity(sameTenant)).assistantBudgetOwner).toBe(false);
    expect(await audits(reviewer)).toHaveLength(0);
  });

  it.each(['OWNER', 'SUPER_ADMIN', 'MANAGER', 'CASHIER'] as const)('no concede el atributo a un usuario %s', async role => {
    const target = await tenantActor(role);
    const result = await change(target, true);
    status(result, 409); expect(result.body.code).toBe('BUDGET_OWNER_INELIGIBLE');
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it('no concede autoridad a un ADMIN inactivo', async () => {
    const target = await tenantActor();
    await prisma.user.update({ where: { id: target.userId }, data: { status: 'DISABLED' } });
    const result = await change(target, true);
    status(result, 409); expect(result.body.code).toBe('BUDGET_OWNER_INELIGIBLE');
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it.each(['status', 'role'] as const)('permite limpiar el atributo después de cambiar el %s del objetivo', async field => {
    const target = await tenantActor('ADMIN', true);
    await prisma.user.update({ where: { id: target.userId }, data: field === 'status' ? { status: 'DISABLED' } : { role: 'CASHIER' } });
    const before = await identity(target), result = await change(target, false);
    status(result, 200); expect(result.body.changed).toBe(true);
    expect(await identity(target)).toEqual({ ...before, assistantBudgetOwner: false });
    expect(await audits(target)).toHaveLength(1);
  });

  it('limpiar el atributo no revoca la autoridad del rol OWNER explícito', async () => {
    const target = await tenantActor('OWNER', true, true);
    status(await change(target, false), 200);
    expect(await identity(target)).toMatchObject({ role: 'OWNER', assistantBudgetOwner: false, status: 'ACTIVE' });
    status(await api('/api/assistant/budget', target), 200);
    expect(await audits(target)).toHaveLength(1);
  });

  it.each([
    { reason: 'corto' }, { reason: 'x'.repeat(501) }, { granted: 'true' },
    { targetUserId: '' }, { targetTenantId: '' }, { tenantId: 'no-admitido' }, { role: 'OWNER' },
  ])('rechaza payload incompatible sin cambiar autoridad: %j', async patch => {
    const target = await tenantActor();
    status(await api(path, reviewer, 'POST', { ...input(target, true), ...patch }), 400);
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  });

  it.each([true, false])('un fallo de auditoría revierte granted=%s y permite reintentar', async granted => {
    const target = await tenantActor('ADMIN', !granted, true), before = await identity(target);
    await expect(setAssistantBudgetOwnership(reviewer, input(target, granted), { db: failAudit() })).rejects.toThrow('QA autoridad');
    expect(await identity(target)).toEqual(before);
    expect(await audits(target)).toHaveLength(0);
    const result = await change(target, granted);
    status(result, 200); expect(result.body.changed).toBe(true);
    expect(await audits(target)).toHaveLength(1);
  });

  it('conceder y revocar conserva configuración, gasto, reservas y uso UNKNOWN', async () => {
    const target = await tenantActor('ADMIN', false, true), now = clock();
    const deps = { db: prisma, capability: 'help' as const, now: () => now };
    const paid = await reserveAssistantBudget(target, '0.20', deps);
    await settleAssistantBudget(target, paid.id, { inputTokens: 100000, outputTokens: 0, requestId: 'synthetic-ownership-paid' }, deps);
    const uncertain = await reserveAssistantBudget(target, '0.20', deps);
    await settleAssistantBudget(target, uncertain.id, null, deps);
    const held = await reserveAssistantBudget(target, '0.15', deps), before = await consumption(target, now);
    expect(before.tenant?.spentUsd.toFixed(6)).toBe('0.100000');
    expect(before.tenant?.reservedUsd.toFixed(6)).toBe('0.350000');
    expect(before.usage.find(row => row.id === uncertain.id)?.status).toBe('UNKNOWN');
    expect(before.usage.find(row => row.id === held.id)?.status).toBe('RESERVED');
    for (const granted of [true, false]) {
      status(await change(target, granted), 200);
      expect(await consumption(target, now)).toEqual(before);
    }
    expect(await audits(target)).toHaveLength(2);
  });

  it('la administración de autoridad coexiste con reservas exactas del mismo negocio', async () => {
    const target = await tenantActor('ADMIN', false, true), now = clock();
    const deps = { db: prisma, capability: 'help' as const, now: () => now };
    const [grant, first] = await Promise.all([change(target, true), reserveAssistantBudget(target, '0.20', deps)]);
    status(grant, 200);
    const [revoke, second] = await Promise.all([change(target, false), reserveAssistantBudget(target, '0.15', deps)]);
    status(revoke, 200);
    const after = await consumption(target, now);
    expect(after.usage.map(row => row.id).sort()).toEqual([first.id, second.id].sort());
    for (const bucket of [after.tenant, after.global]) {
      expect(bucket?.reservedUsd.toFixed(6)).toBe('0.350000');
      expect(bucket?.spentUsd.toFixed(6)).toBe('0.000000');
    }
    expect(after.config?.approvedMonthlyBudgetUsd.toFixed(2)).toBe('2.00');
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(2);
  });

  it('vuelve a comprobar al revisor tras esperar el lock de su identidad', async () => {
    const actor = await roleActor(reviewer, 'SUPER_ADMIN'), target = await tenantActor(), held = signal(), release = signal();
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${actor.userId} FOR UPDATE`;
      held.resolve();
      await release.promise;
      await tx.user.update({ where: { id: actor.userId }, data: { status: 'DISABLED' } });
    }, { timeout: 20000 });
    await held.promise;
    const changing = setAssistantBudgetOwnership(actor, input(target, true)).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    );
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count
          FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE r.OBJECT_SCHEMA = DATABASE() AND r.OBJECT_NAME = 'User' AND r.LOCK_DATA LIKE ${`%${actor.userId}%`}`;
        expect(Number(row.count)).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
    } finally {
      release.resolve();
      await holder;
      await changing;
    }
    expect((await changing).error).toMatchObject({ statusCode: 403, code: 'ASSISTANT_FORBIDDEN' });
    expect((await identity(target)).assistantBudgetOwner).toBe(false);
    expect(await audits(target)).toHaveLength(0);
  }, 30000);
});
