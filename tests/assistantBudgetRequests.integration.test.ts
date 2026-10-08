import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { budgetMonth, reserveAssistantBudget, settleAssistantBudget } from '../backend/services/assistant/budget';
import { decideAssistantBudget, getAssistantBudget, requestAssistantBudget } from '../backend/services/assistant/budgetRequests';
import { getAssistantCapabilities } from '../backend/services/assistant/access';
import { api, assertDisposableDatabase, baseUrl, fixture, roleActor, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const ownPath = '/api/assistant/budget';
const adminPath = '/api/admin/assistant-budget/requests';
const request = (requestedUsd = '6.00') => ({ idempotencyKey: randomUUID(), requestedUsd, reason: 'Más consultas para revisar la reposición de productos QA.' });
const approval = { decision: 'APPROVED', reason: 'Ampliación de presupuesto revisada por Nortex QA.' };
const rejection = { decision: 'REJECTED', reason: 'La solicitud necesita una justificación adicional QA.' };
let reviewer: TestActor;
let monthSequence = 0;
const clock = () => new Date(Date.UTC(2087, monthSequence++, 10, 18));
const budgetDeps = (now: Date) => ({ db: prisma, capability: 'help' as const, now: () => now });
const tenantBucket = (actor: TestActor, now: Date) => `tenant:${actor.tenantId}:${budgetMonth(now)}`;
const globalBucket = (now: Date) => `global:${budgetMonth(now)}`;

async function ownerFixture(legacy = false) {
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA presupuesto aislado', taxId: `QA-${randomUUID()}`, type: 'FERRETERIA' } });
  const actor = await roleActor({ tenantId: tenant.id, userId: '', role: '', token: '' }, legacy ? 'ADMIN' : 'OWNER');
  if (legacy) {
    await prisma.user.update({ where: { id: actor.userId }, data: { assistantBudgetOwner: true } });
    await prisma.employee.create({ data: { tenantId: tenant.id, userId: actor.userId,
      firstName: 'Dueño', lastName: 'QA', role: 'OWNER', baseSalary: '0', status: 'ACTIVE' } });
  }
  // Sembrar sólo prerrequisitos evita consumir el límite HTTP de registro por caso.
  // Todas las operaciones presupuestarias conservan su transporte HTTP real.
  await prisma.assistantTenantConfig.create({ data: { tenantId: actor.tenantId, enabled: true,
    monthlyBudgetUsd: '10', approvedMonthlyBudgetUsd: '2' } });
  return actor;
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function submit(actor: TestActor, body = request()) {
  const result = await api(`${ownPath}/requests`, actor, 'POST', body);
  status(result, 200);
  return result.body;
}
async function decision(id: string, actor = reviewer, body = approval) {
  return api(`${adminPath}/${id}/decision`, actor, 'POST', body);
}
async function auditCount(actor: TestActor, action: string) {
  return prisma.auditLog.count({ where: { tenantId: actor.tenantId, action } });
}
/** La transacción sigue siendo MySQL real; sólo se inyecta el fallo del último audit. */
function failAudit(action: string): typeof prisma {
  return new Proxy(prisma, { get(target, field) {
    if (field === '$transaction') return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
      prisma.$transaction(tx => work(new Proxy(tx, { get(transaction, key) {
        if (key === 'auditLog') return new Proxy(transaction.auditLog, { get(delegate, method) {
          if (method === 'create') return (args: Parameters<typeof delegate.create>[0]) => {
            if (args.data.action === action) throw new Error('QA presupuesto: auditoría indisponible');
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

qa('Presupuesto NortexGPT: autorización, solicitudes, reservas y auditoría HTTP/MySQL', () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    const platform = await prisma.tenant.create({ data: { businessName: 'Plataforma Nortex QA presupuesto', taxId: `QA-${randomUUID()}`, type: 'FERRETERIA' } });
    reviewer = await roleActor({ tenantId: platform.id, userId: '', role: '', token: '' }, 'SUPER_ADMIN');
  }, 120_000);

  it('GET informa US$2 pese al límite legacy=10 y no crea buckets, solicitudes ni auditoría', async () => {
    const owner = await ownerFixture();
    const before = await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: owner.tenantId } });
    const auditBefore = await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED');
    const results = await Promise.all([api(ownPath, owner), api(ownPath, owner)]);
    for (const result of results) {
      status(result, 200);
      expect(result.cacheControl).toBe('private, no-store');
      expect(result.body).toMatchObject({ limitUsd: '2.000000', spentUsd: '0.000000', reservedUsd: '0.000000', remainingUsd: '2.000000', canRequest: true, requests: [] });
    }
    expect(await prisma.assistantBudget.count({ where: { scope: `tenant:${owner.tenantId}` } })).toBe(0);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(auditBefore);
    expect(await prisma.assistantTenantConfig.findUnique({ where: { tenantId: owner.tenantId } })).toEqual(before);
  });

  it('sin configuración devuelve indisponibilidad presupuestaria sin sembrar y rechaza solicitar', async () => {
    const owner = await ownerFixture();
    await prisma.assistantTenantConfig.delete({ where: { tenantId: owner.tenantId } });
    const read = await api(ownPath, owner); status(read, 200);
    expect(read.body).toMatchObject({ limitUsd: '0', remainingUsd: '0.000000', canRequest: false });
    const submitted = await api(`${ownPath}/requests`, owner, 'POST', request());
    status(submitted, 404); expect(submitted.body.code).toBe('BUDGET_NOT_CONFIGURED');
    expect(await prisma.assistantTenantConfig.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('roles operativos no leen ni solicitan aumentos; dueño no accede a revisión administrativa', async () => {
    const owner = await ownerFixture();
    for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'VIEWER', 'BODEGUERO', 'EMPLOYEE', 'VENDEDOR', 'LENDER', 'DRIVER']) {
      const actor = await roleActor(owner, role);
      status(await api(ownPath, actor), 403);
      status(await api(`${ownPath}/requests`, actor, 'POST', request()), 403);
    }
    status(await api(ownPath), 401);
    status(await api(adminPath, owner), 403);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('el registro legítimo ADMIN recibe permiso presupuestario explícito', async () => {
    const owner = await fixture(); // Una prueba explícita del contrato real de registro.
    expect(owner.role).toBe('ADMIN');
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).toMatchObject({ assistantBudgetOwner: true, role: 'ADMIN', status: 'ACTIVE' });
    expect(await prisma.employee.findFirst({ where: { userId: owner.userId, tenantId: owner.tenantId } })).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    status(await api(ownPath, owner), 200);
    expect((await submit(owner)).status).toBe('PENDING');
    const plainAdmin = await roleActor(owner, 'ADMIN');
    expect(await prisma.user.findUnique({ where: { id: plainAdmin.userId } })).toMatchObject({ assistantBudgetOwner: false });
    status(await api(ownPath, plainAdmin), 403);
    status(await api(`${ownPath}/requests`, plainAdmin, 'POST', request()), 403);
  });

  it('revocar el permiso explícito impide historial y replay aunque ADMIN y Employee sigan activos', async () => {
    const owner = await ownerFixture(true), body = request();
    await submit(owner, body);
    await prisma.user.update({ where: { id: owner.userId }, data: { assistantBudgetOwner: false } });
    status(await api(ownPath, owner), 403);
    status(await api(`${ownPath}/requests`, owner, 'POST', body), 403);
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', assistantBudgetOwner: false });
    expect(await prisma.employee.findFirst({ where: { tenantId: owner.tenantId, userId: owner.userId } })).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
  });

  it('Employee OWNER de otro negocio no concede autoridad a un ADMIN', async () => {
    const owner = await ownerFixture(), admin = await roleActor(owner, 'ADMIN');
    await prisma.employee.create({ data: { tenantId: reviewer.tenantId, userId: admin.userId, firstName: 'Dueño', lastName: 'QA ajeno', role: 'OWNER', baseSalary: '0', status: 'ACTIVE' } });
    status(await api(ownPath, admin), 403);
    status(await api(`${ownPath}/requests`, admin, 'POST', request()), 403);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('cambios de RRHH en el mismo tenant no otorgan permiso presupuestario a ADMIN', async () => {
    const owner = await ownerFixture(), admin = await roleActor(owner, 'ADMIN');
    const employee = await prisma.employee.create({ data: { tenantId: owner.tenantId, userId: admin.userId,
      firstName: 'Responsable', lastName: 'QA', role: 'ADMIN', baseSalary: '0', status: 'ACTIVE' } });
    for (const data of [{ role: 'OWNER' }, { status: 'SUSPENDED' }, { status: 'ACTIVE' }]) {
      await prisma.employee.update({ where: { id: employee.id }, data });
      expect(await getAssistantCapabilities(admin)).toMatchObject({ budgetManage: false, help: true });
      await expect(getAssistantBudget(admin)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
      await expect(requestAssistantBudget(admin, request())).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    }
    expect(await prisma.user.findUnique({ where: { id: admin.userId } })).toMatchObject({ assistantBudgetOwner: false });
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(0);
  });

  it('ADMIN sin permiso de gestión conserva consumo help autorizado', async () => {
    const owner = await ownerFixture(true), now = clock();
    await prisma.user.update({ where: { id: owner.userId }, data: { assistantBudgetOwner: false } });
    expect(await getAssistantCapabilities(owner)).toMatchObject({ budgetManage: false, help: true });
    const usage = await reserveAssistantBudget(owner, '0.20', budgetDeps(now));
    expect(usage).toMatchObject({ tenantId: owner.tenantId, userId: owner.userId, status: 'RESERVED' });
    expect((await prisma.assistantBudget.findUniqueOrThrow({ where: { id: tenantBucket(owner, now) } })).reservedUsd.toFixed(6)).toBe('0.200000');
    await expect(getAssistantBudget(owner)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('revocar el permiso durante la lectura descarta historial ya consultado', async () => {
    const owner = await ownerFixture(true), submitted = await requestAssistantBudget(owner, request());
    let historyRead = false;
    const db = new Proxy(prisma, { get(target, field) {
      if (field === '$transaction') return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
        prisma.$transaction(tx => work(new Proxy(tx, { get(transaction, key) {
          if (key === 'assistantBudgetRequest') return new Proxy(transaction.assistantBudgetRequest, { get(delegate, method) {
            if (method === 'count') return async (args: Parameters<typeof delegate.count>[0]) => {
              const count = await delegate.count(args);
              // El historial y sus conteos ya se consultaron. La lectura debe
              // observar la revocación confirmada antes de entregar ese contenido.
              historyRead = true;
              await prisma.user.update({ where: { id: owner.userId }, data: { assistantBudgetOwner: false } });
              return count;
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
    await expect(getAssistantBudget(owner, { db })).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    expect(historyRead).toBe(true);
    expect(await prisma.assistantBudgetRequest.findUnique({ where: { id: submitted.id } })).toMatchObject({ status: 'PENDING' });
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
  });

  it('revocar el permiso mientras una solicitud espera User impide solicitud y auditoría', async () => {
    const owner = await ownerFixture(true), held = signal(), release = signal();
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${owner.userId} FOR UPDATE`;
      held.resolve();
      await release.promise;
      await tx.user.update({ where: { id: owner.userId }, data: { assistantBudgetOwner: false } });
    }, { timeout: 20000 });
    await held.promise;
    const submitted = requestAssistantBudget(owner, request()).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    );
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count
          FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE r.OBJECT_SCHEMA = DATABASE() AND r.OBJECT_NAME = 'User' AND r.LOCK_DATA LIKE ${`%${owner.userId}%`}`;
        expect(Number(row.count)).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
    } finally {
      release.resolve();
      await holder;
      await submitted;
    }
    expect((await submitted).error).toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(0);
    expect(await prisma.assistantBudget.count({ where: { scope: `tenant:${owner.tenantId}` } })).toBe(0);
  }, 30000);

  it.each(['2.00', '0', '-1.00', '10.01', '1000', '6.001', '1e1'])('rechaza monto incompatible %s sin mutaciones', async amount => {
    const owner = await ownerFixture();
    status(await api(`${ownPath}/requests`, owner, 'POST', request(amount)), 400);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(0);
  });

  it('rechaza tenant forjado, motivo corto y clave no UUID antes de crear una solicitud', async () => {
    const owner = await ownerFixture();
    for (const body of [{ ...request(), tenantId: reviewer.tenantId }, { ...request(), reason: 'breve' }, { ...request(), idempotencyKey: 'no-uuid' }]) {
      status(await api(`${ownPath}/requests`, owner, 'POST', body), 400);
    }
    status(await api(`${ownPath}?tenantId=${reviewer.tenantId}`, owner), 400);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('ocho reintentos concurrentes con la misma clave crean una solicitud y una auditoría', async () => {
    const owner = await ownerFixture(), body = request();
    const results = await Promise.all(Array.from({ length: 8 }, () => api(`${ownPath}/requests`, owner, 'POST', body)));
    for (const result of results) status(result, 200);
    expect(new Set(results.map(result => result.body.id)).size).toBe(1);
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(1);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
    const read = await api(ownPath, owner); status(read, 200);
    expect(read.body).toMatchObject({ limitUsd: '2.000000', canRequest: false });
    expect(read.body.requests[0]).toMatchObject({ id: results[0].body.id, requestedUsd: '6.00', status: 'PENDING' });
  });

  it('dos dueños con claves distintas no abren solicitudes pendientes duplicadas', async () => {
    const owner = await ownerFixture(), other = await roleActor(owner, 'OWNER');
    const results = await Promise.all([api(`${ownPath}/requests`, owner, 'POST', request()), api(`${ownPath}/requests`, other, 'POST', request('7.00'))]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(results.find(result => result.status === 409)?.body.code).toBe('BUDGET_REQUEST_PENDING');
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId, status: 'PENDING' } })).toBe(1);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
  });

  it('replay cambiado o de otro dueño rechaza y conserva el original', async () => {
    const owner = await ownerFixture(), body = request(), submitted = await submit(owner, body);
    const other = await roleActor(owner, 'OWNER');
    for (const [actor, changed] of [[owner, { ...body, requestedUsd: '7.00' }], [owner, { ...body, reason: 'Un motivo distinto suficientemente largo.' }], [other, body]] as const) {
      const result = await api(`${ownPath}/requests`, actor, 'POST', changed); status(result, 409);
      expect(result.body.code).toBe('BUDGET_REPLAY_CONFLICT');
    }
    const replay = await submit(owner, body); expect(replay.id).toBe(submitted.id);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
  });

  it('la misma clave en dos negocios conserva solicitudes e historial separados', async () => {
    const owner = await ownerFixture(), foreign = await ownerFixture(), body = request();
    const [first, second] = await Promise.all([submit(owner, body), submit(foreign, body)]);
    expect(first.id).not.toBe(second.id);
    for (const [actor, own, alien] of [[owner, first, second], [foreign, second, first]] as const) {
      const read = await api(ownPath, actor); status(read, 200);
      expect(read.body.requests.map((row: { id: string }) => row.id)).toEqual([own.id]);
      expect(JSON.stringify(read.body)).not.toContain(alien.id);
      status(await decision(alien.id, actor), 403);
    }
  });

  it('bandeja de SUPER_ADMIN es de solo lectura, privada y filtra estados', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    const before = await prisma.assistantBudgetRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    const listed = await api(`${adminPath}?status=PENDING`, reviewer); status(listed, 200);
    expect(listed.cacheControl).toBe('private, no-store');
    expect(listed.body.requests).toContainEqual(expect.objectContaining({ id: submitted.id, tenantId: owner.tenantId, status: 'PENDING' }));
    status(await api(`${adminPath}?tenantId=${owner.tenantId}`, reviewer), 400);
    expect(await prisma.assistantBudgetRequest.findUnique({ where: { id: submitted.id } })).toEqual(before);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
  });

  it('dos revisores concurrentes aprueban una vez; replay y respuesta perdida recuperan la decisión', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    const secondReviewer = await roleActor(reviewer, 'SUPER_ADMIN');
    const results = await Promise.all([decision(submitted.id), decision(submitted.id, secondReviewer)]);
    for (const result of results) { status(result, 200); expect(result.body).toMatchObject({ id: submitted.id, status: 'APPROVED' }); }
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(1);
    const config = await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: owner.tenantId } });
    expect(config.monthlyBudgetUsd.toFixed(2)).toBe('6.00'); expect(config.approvedMonthlyBudgetUsd.toFixed(2)).toBe('6.00');
    const replay = await decision(submitted.id); status(replay, 200);
    expect(replay.body).toEqual(results[0].body);
    const conflict = await decision(submitted.id, reviewer, rejection); status(conflict, 409);
    expect(conflict.body.code).toBe('BUDGET_DECIDED');
    status(await api(`${adminPath}/${submitted.id}/decision`, reviewer, 'POST', { ...approval, approvedUsd: '10.00' }), 400);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(1);
  });

  it('rechazar conserva US$2 y permite una nueva solicitud con identidad distinta', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    const result = await decision(submitted.id, reviewer, rejection); status(result, 200);
    expect(result.body.status).toBe('REJECTED');
    const read = await api(ownPath, owner); status(read, 200);
    expect(read.body).toMatchObject({ limitUsd: '2.000000', canRequest: true });
    const next = await submit(owner, request('8.00')); expect(next.id).not.toBe(submitted.id);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(1);
  });

  it('SUPER_ADMIN del mismo negocio no aprueba ni rechaza su propia ampliación', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner), sameTenant = await roleActor(owner, 'SUPER_ADMIN');
    for (const body of [approval, rejection]) {
      const result = await decision(submitted.id, sameTenant, body); status(result, 403);
      expect(result.body.code).toBe('BUDGET_SELF_APPROVAL');
    }
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
    expect((await prisma.assistantBudgetRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe('PENDING');
  });

  it('el solicitante trasladado a la cuenta Nortex tampoco puede aprobar su propia solicitud', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    // Cambio controlado de identidad sólo en la fixture: conserva requestedBy histórico.
    await prisma.user.update({ where: { id: owner.userId }, data: { tenantId: reviewer.tenantId, role: 'SUPER_ADMIN' } });
    const promoted = { tenantId: reviewer.tenantId, userId: owner.userId, role: 'SUPER_ADMIN' };
    await expect(decideAssistantBudget(promoted, submitted.id, approval)).rejects.toMatchObject({ code: 'BUDGET_SELF_APPROVAL' });
    expect((await prisma.assistantBudgetRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe('PENDING');
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
  });

  it('usuario o revisor revocado no lee, crea ni decide con un JWT anterior', async () => {
    const owner = await ownerFixture(), body = request(), submitted = await submit(owner, body);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    status(await api(ownPath, owner), 403);
    status(await api(`${ownPath}/requests`, owner, 'POST', body), 403);
    const removedReviewer = await roleActor(reviewer, 'SUPER_ADMIN');
    await prisma.user.update({ where: { id: removedReviewer.userId }, data: { role: 'OWNER' } });
    status(await decision(submitted.id, removedReviewer), 403);
    status(await api(adminPath, removedReviewer), 403);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
  });

  it('condiciones cambiadas antes de aprobar exigen revisión nueva y no actualizan la solicitud', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    await prisma.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { enabled: false } });
    const result = await decision(submitted.id); status(result, 409);
    expect(result.body.code).toBe('BUDGET_REVIEW_STALE');
    expect((await prisma.assistantBudgetRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe('PENDING');
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
  });

  it('fallo de auditoría revierte la creación y deja libre la clave para reintentar', async () => {
    const owner = await ownerFixture(), body = request();
    await expect(requestAssistantBudget(owner, body, { db: failAudit('ASSISTANT_BUDGET_REQUESTED') })).rejects.toThrow('QA presupuesto');
    expect(await prisma.assistantBudgetRequest.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(0);
    const result = await submit(owner, body); expect(result.status).toBe('PENDING');
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_REQUESTED')).toBe(1);
  });

  it('fallo de auditoría al aprobar revierte entitlement y decisión en la misma transacción', async () => {
    const owner = await ownerFixture(), submitted = await submit(owner);
    await expect(decideAssistantBudget(reviewer, submitted.id, approval, { db: failAudit('ASSISTANT_BUDGET_DECIDED') })).rejects.toThrow('QA presupuesto');
    const config = await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: owner.tenantId } });
    expect(config.monthlyBudgetUsd.toFixed(2)).toBe('10.00'); expect(config.approvedMonthlyBudgetUsd.toFixed(2)).toBe('2.00');
    expect(await prisma.assistantBudgetRequest.findUnique({ where: { id: submitted.id } })).toMatchObject({ status: 'PENDING', decidedBy: null, decidedAt: null });
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(0);
    status(await decision(submitted.id), 200);
  });

  it('aprobar conserva gasto, UNKNOWN y el mes original sin resetear buckets ni uso', async () => {
    const owner = await ownerFixture(), now = clock(), deps = budgetDeps(now);
    const paid = await reserveAssistantBudget(owner, '0.20', deps);
    await settleAssistantBudget(owner, paid.id, { inputTokens: 100000, outputTokens: 0, requestId: 'synthetic-budget-usage' }, deps);
    const uncertain = await reserveAssistantBudget(owner, '0.20', deps);
    await settleAssistantBudget(owner, uncertain.id, null, deps);
    const before = await prisma.assistantUsage.findMany({ where: { tenantId: owner.tenantId }, orderBy: { id: 'asc' } });
    const beforeGlobal = await prisma.assistantBudget.findUniqueOrThrow({ where: { id: globalBucket(now) } });
    const submitted = await submit(owner); status(await decision(submitted.id), 200);
    const read = await getAssistantBudget(owner, { db: prisma, now: () => now });
    expect(read).toMatchObject({ limitUsd: '6.000000', spentUsd: '0.100000', reservedUsd: '0.200000', remainingUsd: '5.700000' });
    expect(await prisma.assistantUsage.findMany({ where: { tenantId: owner.tenantId }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.assistantBudget.findUnique({ where: { id: globalBucket(now) } })).toEqual(beforeGlobal);
    expect(before.find(row => row.id === uncertain.id)?.status).toBe('UNKNOWN');
    await reserveAssistantBudget(owner, '0.20', deps);
    expect((await prisma.assistantBudget.findUniqueOrThrow({ where: { id: tenantBucket(owner, now) } })).limitUsd.toFixed(2)).toBe('6.00');
  });

  it('reservas concurrentes respetan US$2 aunque la configuración legacy permita diez', async () => {
    const owner = await ownerFixture(), now = clock();
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => reserveAssistantBudget(owner, '0.20', budgetDeps(now))));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    const bucket = await prisma.assistantBudget.findUniqueOrThrow({ where: { id: tenantBucket(owner, now) } });
    expect(bucket.reservedUsd.toFixed(6)).toBe('2.000000'); expect(bucket.spentUsd.toFixed(6)).toBe('0.000000');
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(10);
  });

  it.each(['config', 'user'] as const)('revocar %s mientras la reserva espera su lock impide crear consumo', async scope => {
    const owner = await ownerFixture(), now = clock(), held = signal(), release = signal();
    const holder = prisma.$transaction(async tx => {
      if (scope === 'config') await tx.$queryRaw`SELECT tenantId FROM AssistantTenantConfig WHERE tenantId = ${owner.tenantId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM User WHERE id = ${owner.userId} FOR UPDATE`;
      held.resolve();
      await release.promise;
      if (scope === 'config') await tx.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { enabled: false } });
      else await tx.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    }, { timeout: 20000 });
    await held.promise;
    const reserved = reserveAssistantBudget(owner, '0.20', budgetDeps(now)).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    );
    try {
      // Barrera del motor: la autorización inicial ya ocurrió y la reserva espera
      // la fila concreta. La revocación se confirma antes de soltar ese lock.
      const table = scope === 'config' ? 'AssistantTenantConfig' : 'User';
      const rowId = scope === 'config' ? owner.tenantId : owner.userId;
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count
          FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE r.OBJECT_SCHEMA = DATABASE() AND r.OBJECT_NAME = ${table} AND r.LOCK_DATA LIKE ${`%${rowId}%`}`;
        expect(Number(row.count)).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
    } finally {
      release.resolve();
      await holder;
      await reserved;
    }
    expect((await reserved).error).toMatchObject({ code: scope === 'config' ? 'ASSISTANT_DISABLED' : 'SESSION_REVOKED' });
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await prisma.assistantBudget.count({ where: { id: { in: [tenantBucket(owner, now), globalBucket(now)] } } })).toBe(0);
  }, 30000);

  it.each([
    { blocked: true, spentUsd: '0', reservedUsd: '0' },
    { blocked: false, spentUsd: '19.80', reservedUsd: '0.20' },
    { blocked: false, spentUsd: '19.75', reservedUsd: '0' },
  ])('informa indisponibilidad global sin exponer saldos ajenos: %j', async amounts => {
    const owner = await ownerFixture(), now = clock();
    const global = await prisma.assistantBudget.create({ data: { id: globalBucket(now), scope: 'global', month: budgetMonth(now), limitUsd: '20', ...amounts } });
    const read = await getAssistantBudget(owner, { db: prisma, now: () => now });
    expect(read).toMatchObject({ limitUsd: '2.000000', remainingUsd: '2.000000', spentUsd: '0.000000', reservedUsd: '0.000000',
      platformAvailable: false, availabilityReason: 'PLATFORM_LIMIT', canRequest: true });
    expect(Object.keys(read).sort()).toEqual(['month', 'limitUsd', 'spentUsd', 'reservedUsd', 'remainingUsd', 'blocked',
      'platformAvailable', 'availabilityReason', 'canRequest', 'maxLimitUsd', 'requests'].sort());
    expect(await prisma.assistantBudget.findUnique({ where: { id: global.id } })).toEqual(global);
    expect(await prisma.assistantBudget.count({ where: { scope: `tenant:${owner.tenantId}` } })).toBe(0);
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('aprobación concurrente con reservas mantiene una sola autorización y suma exacta', async () => {
    const owner = await ownerFixture(), now = clock(), submitted = await submit(owner);
    const [approved, outcomes] = await Promise.all([
      decision(submitted.id),
      Promise.allSettled(Array.from({ length: 20 }, () => reserveAssistantBudget(owner, '0.20', budgetDeps(now)))),
    ]);
    status(approved, 200);
    const accepted = outcomes.filter(result => result.status === 'fulfilled').length;
    expect(accepted).toBeGreaterThanOrEqual(10);
    for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    const expected = new Decimal(accepted).mul('0.20').toFixed(6);
    const read = await getAssistantBudget(owner, { db: prisma, now: () => now });
    expect(read.limitUsd).toBe('6.000000'); expect(read.reservedUsd).toBe(expected);
    expect(new Decimal(read.reservedUsd).lte(read.limitUsd)).toBe(true);
    expect((await prisma.assistantBudget.findUniqueOrThrow({ where: { id: globalBucket(now) } })).reservedUsd.toFixed(6)).toBe(expected);
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(accepted);
    expect(await auditCount(owner, 'ASSISTANT_BUDGET_DECIDED')).toBe(1);
  });

  it('ampliar a US$10 no evita el agotamiento global ni libera reservas inciertas', async () => {
    const owner = await ownerFixture(), now = clock(), month = budgetMonth(now);
    await prisma.assistantBudget.create({ data: { id: globalBucket(now), scope: 'global', month, limitUsd: '20', spentUsd: '19.80', reservedUsd: '0.20' } });
    const submitted = await submit(owner, request('10.00')); status(await decision(submitted.id), 200);
    await expect(reserveAssistantBudget(owner, '0.20', budgetDeps(now))).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    const global = await prisma.assistantBudget.findUniqueOrThrow({ where: { id: globalBucket(now) } });
    expect(global.limitUsd.toFixed(2)).toBe('20.00'); expect(global.spentUsd.toFixed(2)).toBe('19.80'); expect(global.reservedUsd.toFixed(2)).toBe('0.20');
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect((await getAssistantBudget(owner, { now: () => now })).canRequest).toBe(false);
  });
});
