// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { preparePurchasePreview, registerPurchase } from '../backend/services/purchaseRegistrationService';
import { api, baseUrl, fixture, purchaseInput, roleActor, status, assertDisposableDatabase, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' && baseUrl ? describe.sequential : describe.skip;
async function openShift(actor: TestActor, initialCash: string, startTime = new Date()) {
  return prisma.shift.create({data: {tenantId: actor.tenantId, userId: actor.userId, initialCash, status: 'OPEN', startTime}});
}
async function movements(tenantId: string) {
  return prisma.cashMovement.findMany({where: {tenantId}, select: {shiftId: true, userId: true, type: true, amount: true}, take: 10});
}
async function ddl(sql: string) {
  assertDisposableDatabase();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], {stdio: ['pipe', 'ignore', 'pipe']});
    child.stderr.resume(); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`DDL de QA falló (${code})`))); child.stdin.end(sql);
  });
}

qa('compras de contado: autoridad de la gaveta por HTTP y MySQL8', () => {
  beforeAll(() => { assertDisposableDatabase(); });

  it('reproducción: MANAGER sin turno propio no debe retirar efectivo del último turno ajeno', async () => {
    const owner = await fixture(), manager = await roleActor(owner, 'MANAGER');
    const earlier = await openShift(owner, '100', new Date(Date.now() - 60_000));
    const cashier = await roleActor(owner, 'CASHIER');
    const latest = await openShift(cashier, '200');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    const result = await api('/api/purchases', manager, 'POST', input, {'Idempotency-Key': randomUUID()});
    const effects = {
      response: result.status,
      movements: (await movements(owner.tenantId)).map(row => ({...row, amount: row.amount.toString()})),
      purchases: await prisma.purchase.count({where: {tenantId: owner.tenantId, invoiceNumber: input.invoiceNumber}}),
      stock: (await prisma.product.findFirstOrThrow({where: {tenantId: owner.tenantId, id: owner.productId}})).stock,
    };
    expect(effects).toEqual({response: 409, movements: [], purchases: 0, stock: 0});
    expect((await prisma.shift.findUniqueOrThrow({where: {id: latest.id}})).userId).toBe(cashier.userId);
    expect((await prisma.shift.findUniqueOrThrow({where: {id: earlier.id}})).userId).toBe(owner.userId);
  });

  it('reproducción: OWNER sin turno propio tampoco debe elegir caja ajena implícitamente', async () => {
    const owner = await fixture(), cashier = await roleActor(owner, 'CASHIER');
    await openShift(cashier, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    const result = await api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': randomUUID()});
    expect({response: result.status, movements: (await movements(owner.tenantId)).length}).toEqual({response: 409, movements: 0});
    expect(await prisma.purchase.count({where: {tenantId: owner.tenantId, invoiceNumber: input.invoiceNumber}})).toBe(0);
  });

  it('caracterización: turno propio prevalece sobre otra caja más reciente y el reintento no duplica salida', async () => {
    const owner = await fixture(), cashier = await roleActor(owner, 'CASHIER');
    const own = await openShift(owner, '100', new Date(Date.now() - 60_000));
    const other = await openShift(cashier, '200');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    const key = randomUUID();
    const first = await api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': key}); status(first, 200);
    const replay = await api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': key}); status(replay, 200);
    expect(first.body.purchase.id).toBe(replay.body.purchase.id);
    const rows = await movements(owner.tenantId);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({shiftId: own.id, userId: owner.userId, type: 'OUT'});
    expect(rows[0].amount.toString()).toBe('23');
    expect(rows.some(row => row.shiftId === other.id)).toBe(false);
    const audit = await prisma.auditLog.findFirstOrThrow({where: {tenantId: owner.tenantId, action: 'PURCHASE_CREATED'}});
    expect(JSON.parse(audit.details!)).toMatchObject({shiftId: own.id, efectivoAntes: 100, efectivoDespues: 77});
  });

  it('caracterización: no admite cajero registrando compras y no usa cajas de otro tenant', async () => {
    const owner = await fixture(), cashier = await roleActor(owner, 'CASHIER'), foreign = await fixture();
    await openShift(foreign, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    status(await api('/api/purchases', cashier, 'POST', input), 403);
    status(await api('/api/purchases', owner, 'POST', input), 409);
    expect(await movements(foreign.tenantId)).toEqual([]); expect(await movements(owner.tenantId)).toEqual([]);
    expect(await prisma.purchase.count({where: {tenantId: owner.tenantId, invoiceNumber: input.invoiceNumber}})).toBe(0);
  });

  it('caracterización: crédito registra deuda sin usar ninguna caja abierta', async () => {
    const owner = await fixture(), cashier = await roleActor(owner, 'CASHIER');
    await openShift(cashier, '100');
    const input = purchaseInput(owner);
    const result = await api('/api/purchases', owner, 'POST', input); status(result, 200);
    expect(await movements(owner.tenantId)).toEqual([]);
    const purchase = await prisma.purchase.findFirstOrThrow({where: {tenantId: owner.tenantId, id: result.body.purchase.id}});
    expect(purchase.balanceDue?.toString()).toBe('23');
  });

  it('preview exige caja propia y muestra la misma gaveta usada al confirmar', async () => {
    const owner = await fixture(), cashier = await roleActor(owner, 'CASHIER');
    await openShift(cashier, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    await expect(preparePurchasePreview({principal: owner, input})).rejects.toMatchObject({code: 'SIN_CAJA_ABIERTA', httpStatus: 409});
    const own = await openShift(owner, '100');
    const preview = await preparePurchasePreview({principal: owner, input});
    expect(preview.shiftId).toBe(own.id); expect(preview.shiftLabel).toBeTruthy();
    const result = await registerPurchase({principal: owner, input, idempotencyKey: randomUUID(), expectedPreviewHash: preview.hash});
    expect(result.purchase.id).toBeTruthy();
    expect((await movements(owner.tenantId))[0]).toMatchObject({shiftId: own.id});
  });

  it('replay posterior al cierre recupera comprobante sin exigir una nueva caja ni debitar otra', async () => {
    const owner = await fixture(), own = await openShift(owner, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined}), key = randomUUID();
    const first = await api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': key}); status(first, 200);
    await prisma.shift.update({where: {id: own.id}, data: {status: 'CLOSED', endTime: new Date()}});
    const replay = await api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': key}); status(replay, 200);
    expect(replay.body.purchase.id).toBe(first.body.purchase.id);
    expect(await movements(owner.tenantId)).toHaveLength(1);
  });

  it('un traspaso HTTP que gana mientras la compra espera stock impide usar la gaveta reasignada', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), own = await openShift(owner, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    let release!: () => void, ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${owner.productId} AND tenantId = ${owner.tenantId} FOR UPDATE`;
      ready(); await wait;
    });
    await started;
    const registration = api('/api/purchases', owner, 'POST', input, {'Idempotency-Key': randomUUID()});
    try { status(await api(`/api/shifts/${own.id}/tomar`, admin, 'POST'), 200); }
    finally { release(); await blocker; }
    status(await registration, 409);
    expect(await movements(owner.tenantId)).toEqual([]);
    expect((await prisma.shift.findUniqueOrThrow({where: {id: own.id}})).userId).toBe(admin.userId);
    expect(await prisma.purchase.count({where: {tenantId: owner.tenantId, invoiceNumber: input.invoiceNumber}})).toBe(0);
  });

  it('el traspaso HTTP espera el lock de una compra que ya eligió su caja propia', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), own = await openShift(owner, '100');
    const input = purchaseInput(owner, {paymentMethod: 'CASH', dueDate: undefined});
    let release!: () => void, ready!: () => void, ownerAtCommit = '';
    const started = new Promise<void>(resolve => { ready = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    // Se pausa el adaptador después de resolver la caja y antes de crear la compra;
    // registro, SQL, débito y traspaso siguen ejecutando las autoridades reales.
    const db = new Proxy(prisma, {get(target, key, receiver) {
      if (key !== '$transaction') return Reflect.get(target, key, receiver);
      return (callback: any, options: any) => target.$transaction(tx => callback(new Proxy(tx, {get(inner, name, getter) {
        if (name !== 'purchase') return Reflect.get(inner, name, getter);
        return new Proxy(inner.purchase, {get(delegate, method, delegateReceiver) {
          if (method !== 'create') return Reflect.get(delegate, method, delegateReceiver);
          return async (args: any) => { ready(); await wait; return delegate.create(args); };
        }});
      }})), options);
    }});
    const registration = registerPurchase({principal: owner, input, idempotencyKey: randomUUID(), beforeCommit: async tx => {
      const [shift] = await tx.$queryRaw<Array<{userId: string}>>`SELECT userId FROM \`Shift\` WHERE id = ${own.id} AND tenantId = ${owner.tenantId} FOR UPDATE`;
      ownerAtCommit = shift.userId;
    }}, db);
    await started;
    let transferred = false;
    const transfer = api(`/api/shifts/${own.id}/tomar`, admin, 'POST').then(result => { transferred = true; return result; });
    let transferredBeforeCommit: boolean;
    try { await new Promise(resolve => setTimeout(resolve, 150)); transferredBeforeCommit = transferred; }
    finally { release(); }
    await registration; status(await transfer, 200);
    expect(transferredBeforeCommit).toBe(false);
    expect(ownerAtCommit).toBe(owner.userId);
    expect((await movements(owner.tenantId))[0]).toMatchObject({shiftId: own.id, userId: owner.userId});
    expect((await prisma.shift.findUniqueOrThrow({where: {id: own.id}})).userId).toBe(admin.userId);
    const handoverAudit = await prisma.auditLog.findFirstOrThrow({where: {tenantId: owner.tenantId, action: 'SHIFT_HANDOVER'}});
    expect(JSON.parse(handoverAudit.details!).efectivoAlTraspaso).toBe('77');
  });

  it('dos traspasos concurrentes al mismo receptor producen una sola auditoría', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), own = await openShift(owner, '100');
    const results = await Promise.all([1, 2].map(() => api(`/api/shifts/${own.id}/tomar`, admin, 'POST')));
    results.forEach(result => status(result, 200));
    expect(results.filter(result => result.body.yaEraPropio === true)).toHaveLength(1);
    expect(await prisma.auditLog.count({where: {tenantId: owner.tenantId, action: 'SHIFT_HANDOVER'}})).toBe(1);
    expect((await prisma.shift.findUniqueOrThrow({where: {id: own.id}})).userId).toBe(admin.userId);
  });

  it('corte de traspaso conserva monedas, crédito de tienda, agente y exclusión de anulados', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), own = await openShift(owner, '100');
    await prisma.shift.update({where: {id: own.id}, data: {initialCashUsd: 5}});
    await prisma.sale.createMany({data: [
      {tenantId: owner.tenantId, shiftId: own.id, total: 30, storeCreditApplied: 7, status: 'COMPLETED', paymentMethod: 'CASH'},
      {tenantId: owner.tenantId, shiftId: own.id, total: 100, status: 'VOIDED', paymentMethod: 'CASH'},
      {tenantId: owner.tenantId, shiftId: own.id, total: 200, status: 'COMPLETED', paymentMethod: 'CARD'},
    ]});
    const rows = [
      {type: 'IN', currency: 'NIO', category: 'AJUSTE', amount: 2},
      {type: 'IN', currency: 'NIO', category: 'AJUSTE', amount: 8},
      {type: 'OUT', currency: 'NIO', category: 'AJUSTE', amount: 4},
      {type: 'OUT', currency: 'NIO', category: 'AGENTE_BANCARIO', amount: 6},
      {type: 'IN', currency: 'USD', category: 'AJUSTE', amount: 3},
      {type: 'OUT', currency: 'USD', category: 'AJUSTE', amount: 1},
      {type: 'OUT', currency: 'NIO', category: 'AJUSTE', amount: 99, isVoided: true},
    ];
    await prisma.cashMovement.createMany({data: rows.map(row => ({...row, tenantId: owner.tenantId, shiftId: own.id, userId: owner.userId, description: 'Fixture sintética de monedas'}))});
    const result = await api(`/api/shifts/${own.id}/tomar`, admin, 'POST'); status(result, 200);
    expect(result.body).toMatchObject({efectivoRecibido: 123, efectivoUsdRecibido: 7});
    const audit = await prisma.auditLog.findFirstOrThrow({where: {tenantId: owner.tenantId, action: 'SHIFT_HANDOVER'}});
    expect(JSON.parse(audit.details!)).toMatchObject({efectivoAlTraspaso: '123', efectivoUsdAlTraspaso: '7'});
  });

  it('traspaso rechaza caja cerrada, tenant ajeno y rol sin permiso sin reasignar', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), viewer = await roleActor(owner, 'VIEWER'), foreign = await fixture();
    const own = await openShift(owner, '100'), foreignShift = await openShift(foreign, '100');
    status(await api(`/api/shifts/${own.id}/tomar`, viewer, 'POST'), 403);
    status(await api(`/api/shifts/${foreignShift.id}/tomar`, admin, 'POST'), 404);
    await prisma.shift.update({where: {id: own.id}, data: {status: 'CLOSED', endTime: new Date()}});
    status(await api(`/api/shifts/${own.id}/tomar`, admin, 'POST'), 404);
    expect((await prisma.shift.findUniqueOrThrow({where: {id: own.id}})).userId).toBe(owner.userId);
    expect((await prisma.shift.findUniqueOrThrow({where: {id: foreignShift.id}})).userId).toBe(foreign.userId);
    expect(await prisma.auditLog.count({where: {tenantId: owner.tenantId, action: 'SHIFT_HANDOVER'}})).toBe(0);
  });

  it('fallo de auditoría revierte el nuevo responsable del turno', async () => {
    const owner = await fixture(), admin = await roleActor(owner, 'ADMIN'), own = await openShift(owner, '100');
    const trigger = `qa_handover_${randomUUID().replaceAll('-', '')}`;
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${owner.tenantId}' AND NEW.action = 'SHIFT_HANDOVER' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA handover audit failure'; END IF; END`);
    try {
      const result = await api(`/api/shifts/${own.id}/tomar`, admin, 'POST'); status(result, 500);
      expect(result.body.error).not.toMatch(/Prisma|SQL|45000|SIGNAL/);
      expect((await prisma.shift.findUniqueOrThrow({where: {id: own.id}})).userId).toBe(owner.userId);
      expect(await prisma.auditLog.count({where: {tenantId: owner.tenantId, action: 'SHIFT_HANDOVER'}})).toBe(0);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
  });
});
