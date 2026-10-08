// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma.js';
import { getCommerceActivationRequest, requestCommerceActivation } from '../backend/services/whatsapp/commerce/activation.js';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const tenantIds: string[] = [];
const auditAction = 'WHATSAPP_COMMERCE_ACTIVATION_REQUESTED';
let network: ReturnType<typeof vi.spyOn>;

async function seed(type = 'FERRETERIA') {
  const tenantId = `qa-wa-activation-${randomUUID()}`;
  tenantIds.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, businessName: `QA ${type}`, taxId: tenantId, type } });
  const user = await prisma.user.create({ data: { tenantId, email: `qa-${randomUUID()}@example.invalid`, password: 'SYNTHETIC-NOT-A-CREDENTIAL', name: 'QA Activation Owner', role: 'OWNER' } });
  return { tenantId, user, principal: { tenantId, userId: user.id, role: 'OWNER' } };
}

async function cleanup() {
  if (!tenantIds.length) return;
  const where = { tenantId: { in: tenantIds } };
  await prisma.waCommerceActivationRequest.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { ...where, action: auditAction } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  tenantIds.length = 0;
}

qa('Entrada asistida de WhatsApp en MySQL 8 descartable', () => {
  beforeAll(() => {
    expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: red externa bloqueada'));
  });
  afterEach(cleanup);
  afterAll(async () => { try { expect(network).not.toHaveBeenCalled(); } finally { network?.mockRestore(); await prisma.$disconnect(); } });

  it('guarda solo una solicitud del tenant, normaliza el número y audita sin incluirlo', async () => {
    const first = await seed();
    const other = await seed();
    expect(await getCommerceActivationRequest(first.principal, prisma)).toBeNull();
    const created = await requestCommerceActivation(first.principal, { phone: '+505 8888-9999' }, prisma);
    expect(created.replayed).toBe(false);
    expect(created.request).toEqual({ id: expect.any(String), phone: '+50588889999', status: 'REQUESTED', createdAt: expect.any(Date) });
    expect(await getCommerceActivationRequest(first.principal, prisma)).toEqual(created.request);
    expect(await getCommerceActivationRequest(other.principal, prisma)).toBeNull();
    const stored = await prisma.waCommerceActivationRequest.findUniqueOrThrow({ where: { tenantId: first.tenantId } });
    expect(stored).toMatchObject({ id: created.request.id, requestedBy: first.user.id, noticeVersion: 'connection-assistance-v1' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: first.tenantId, action: auditAction } });
    expect(audit.userId).toBe(first.user.id);
    expect(audit.details).toContain(created.request.id);
    expect(audit.details).not.toContain('88889999');
    expect(await prisma.whatsAppChannel.count({ where: { tenantId: first.tenantId } })).toBe(0);
  });

  it('repite con el mismo número sin alterar solicitante ni auditoría; otro número da 409', async () => {
    const fixture = await seed();
    const admin = await prisma.user.create({ data: { tenantId: fixture.tenantId, email: `qa-${randomUUID()}@example.invalid`, password: 'SYNTHETIC-NOT-A-CREDENTIAL', name: 'QA Admin', role: 'ADMIN' } });
    const first = await requestCommerceActivation(fixture.principal, { phone: '7888-1111' }, prisma);
    const replay = await requestCommerceActivation({ tenantId: fixture.tenantId, userId: admin.id, role: 'ADMIN' }, { phone: '505 7888 1111' }, prisma);
    expect(replay).toEqual({ request: first.request, replayed: true });
    await expect(requestCommerceActivation(fixture.principal, { phone: '7888-2222' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_ACTIVATION_CONFLICT', statusCode: 409 });
    expect((await prisma.waCommerceActivationRequest.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } })).requestedBy).toBe(fixture.user.id);
    expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantId, action: auditAction } })).toBe(1);
  });

  it('rechaza rol menor, revocación, rol desactualizado y otros tenants antes de leer o escribir', async () => {
    const fixture = await seed();
    const other = await seed();
    const manager = await prisma.user.create({ data: { tenantId: fixture.tenantId, email: `qa-${randomUUID()}@example.invalid`, password: 'SYNTHETIC-NOT-A-CREDENTIAL', name: 'QA Manager', role: 'MANAGER' } });
    const denied = { tenantId: fixture.tenantId, userId: manager.id, role: 'MANAGER' };
    await expect(getCommerceActivationRequest(denied, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await expect(requestCommerceActivation(denied, { phone: '88889999' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await expect(requestCommerceActivation({ tenantId: other.tenantId, userId: fixture.user.id, role: 'OWNER' }, { phone: '88889999' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: fixture.user.id }, data: { status: 'DISABLED' } });
    await expect(getCommerceActivationRequest(fixture.principal, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await expect(requestCommerceActivation(fixture.principal, { phone: '88889999' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: fixture.user.id }, data: { status: 'ACTIVE', role: 'ADMIN' } });
    await expect(requestCommerceActivation(fixture.principal, { phone: '88889999' }, prisma)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.waCommerceActivationRequest.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
  });

  it.each(['FARMACIA', 'RETAIL'])('rechaza %s sin prometer conexión', async type => {
    const fixture = await seed(type);
    await expect(getCommerceActivationRequest(fixture.principal, prisma)).rejects.toMatchObject({ code: 'COMMERCE_ACTIVATION_VERTICAL', statusCode: 403 });
    await expect(requestCommerceActivation(fixture.principal, { phone: '88889999' }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_ACTIVATION_VERTICAL', statusCode: 403 });
    expect(await prisma.waCommerceActivationRequest.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
  });

  it('rechaza países ajenos, extensiones, texto, dígitos incorrectos y campos extra', async () => {
    const fixture = await seed();
    for (const phone of ['+50688889999', '+1 212 555 0100', '88889999 ext 2', '8888--9999', '38889999', '8888999', '888899999', '+505+88889999']) {
      await expect(requestCommerceActivation(fixture.principal, { phone }, prisma)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(requestCommerceActivation(fixture.principal, { phone: '88889999', token: 'NO' } as { phone: string }, prisma)).rejects.toThrow();
    expect(await prisma.waCommerceActivationRequest.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
  });

  it('serializa dos altas concurrentes del mismo tenant, tanto replay como conflicto', async () => {
    const same = await seed();
    const concurrent = await Promise.all([
      requestCommerceActivation(same.principal, { phone: '5888-1111' }, prisma),
      requestCommerceActivation(same.principal, { phone: '+505 5888 1111' }, prisma),
    ]);
    expect(new Set(concurrent.map(result => result.request.id)).size).toBe(1);
    expect(concurrent.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(await prisma.auditLog.count({ where: { tenantId: same.tenantId, action: auditAction } })).toBe(1);

    const different = await seed();
    const outcomes = await Promise.allSettled([
      requestCommerceActivation(different.principal, { phone: '5888-1111' }, prisma),
      requestCommerceActivation(different.principal, { phone: '5888-2222' }, prisma),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ status: 'rejected', reason: { code: 'COMMERCE_ACTIVATION_CONFLICT', statusCode: 409 } });
    expect(await prisma.waCommerceActivationRequest.count({ where: { tenantId: different.tenantId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: different.tenantId, action: auditAction } })).toBe(1);
  });

  it('no confunde un número local que empieza en 505 con el prefijo del país',async()=>{
    const fixture=await seed();
    const first=await requestCommerceActivation(fixture.principal,{phone:'5050 1234'},prisma);
    expect(first.request.phone).toBe('+50550501234');
    const replay=await requestCommerceActivation(fixture.principal,{phone:'+505 5050 1234'},prisma);
    expect(replay).toEqual({request:first.request,replayed:true});
    expect(await prisma.auditLog.count({where:{tenantId:fixture.tenantId,action:auditAction}})).toBe(1);
  });

  it('revierte el alta si falla la auditoría dentro de la misma transacción', async () => {
    const fixture = await seed();
    const failing = {
      $transaction: (callback: (tx: unknown) => Promise<unknown>, options: unknown) => prisma.$transaction(
        tx => callback(new Proxy(tx, {
          get(target, property) {
            if (property === 'auditLog') return { create: async () => { throw new Error('QA_AUDIT_FAILURE'); } };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        })),
        options as Parameters<typeof prisma.$transaction>[1],
      ),
    } as unknown as PrismaClient;
    await expect(requestCommerceActivation(fixture.principal, { phone: '88889999' }, failing)).rejects.toThrow('QA_AUDIT_FAILURE');
    expect(await prisma.waCommerceActivationRequest.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantId, action: auditAction } })).toBe(0);
  });
});
