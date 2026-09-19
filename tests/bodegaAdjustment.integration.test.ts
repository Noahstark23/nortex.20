import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

const baseUrl = process.env.NORTEX_QA_BASE_URL;
const qaDescribe = baseUrl ? describe.sequential : describe.skip;
type Fixture = { tenantId: string; userId: string; token: string; warehouseId: string; productId: string };
async function call(f: Pick<Fixture, 'token'>, body: unknown, path = '/api/inventory/adjust') {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${f.token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function fixture(overrides: Record<string, unknown> = {}): Promise<Fixture> {
  const { signAuthToken } = await import('../backend/services/secrets');
  const url = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/.test(url.pathname)) throw new Error('Solo DB local descartable');
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA ajustes ' + randomUUID(), taxId: 'QA-' + randomUUID(), subscriptionStatus: 'ACTIVE' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Dueña QA', email: randomUUID() + '@example.invalid', password: 'synthetic-no-login', role: 'OWNER' } });
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, name: 'Principal QA', isDefault: true } });
  const token = signAuthToken({ tenantId: tenant.id, userId: user.id, role: 'OWNER' });
  const product = await call({ token }, { name: 'Tornillo QA', sku: 'QA-' + randomUUID(), price: 20, cost: 8, stock: 10, minStock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', ...overrides }, '/api/products');
  expect(product.status, JSON.stringify(product.body)).toBe(200);
  return { tenantId: tenant.id, userId: user.id, token, warehouseId: warehouse.id, productId: product.body.id };
}
const input = (f: Fixture, overrides: Record<string, unknown> = {}) => ({ clientEventId: randomUUID(), productId: f.productId, warehouseId: f.warehouseId, quantity: '5', type: 'ADJUST_GAIN', reason: 'Sobrante verificado en conteo físico', ...overrides });
async function effects(f: Fixture) {
  return {
    stock: (await prisma.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.tenantId } })).stock,
    local: (await prisma.productStock.findFirst({ where: { productId: f.productId, warehouseId: f.warehouseId, tenantId: f.tenantId } }))?.stock ?? 0,
    movements: await prisma.kardexMovement.count({ where: { tenantId: f.tenantId, productId: f.productId, referenceType: 'ADJUSTMENT' } }),
    audits: await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT' } }),
    journals: await prisma.journalEntry.count({ where: { tenantId: f.tenantId, referenceType: 'INVENTORY_ADJUSTMENT' } }),
  };
}
async function ddl(sql: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], { stdio: ['pipe', 'ignore', 'pipe'] });
    child.stderr.resume(); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Falló DDL sintético de QA (${code})`))); child.stdin.end(sql);
  });
}

qaDescribe('QA bodega: ajuste físico auditable e idempotente', () => {
  it('una respuesta perdida y reintento del mismo UUID mueve existencias solo una vez', async () => {
    const f = await fixture(); const body = input(f);
    const first = await call(f, body); const replay = await call(f, body);
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(first.body).toMatchObject({ clientEventId: body.clientEventId, movement: { tenantId: f.tenantId, productId: f.productId, warehouseId: f.warehouseId, quantity: 5 } });
    expect(replay.body.clientEventId).toBe(body.clientEventId);
    expect(replay.body.movement.id).toBe(first.body.movement.id);
    expect(await effects(f)).toEqual({ stock: 15, local: 15, movements: 1, audits: 1, journals: 1 });
  });

  it('el sobrante y la pérdida generan asientos balanceados al costo vigente', async () => {
    const f = await fixture();
    const gain = await call(f, input(f, { quantity: '2' }));
    const loss = await call(f, input(f, { quantity: '-1', type: 'ADJUST_LOSS', reason: 'Pieza dañada verificada' }));
    expect(gain.status).toBe(200); expect(loss.status).toBe(200);
    const entries = await prisma.journalEntry.findMany({ where: { tenantId: f.tenantId, referenceType: 'INVENTORY_ADJUSTMENT' }, include: { lines: { include: { account: true } } }, take: 10 });
    expect(entries).toHaveLength(2);
    const lines = (id: string) => entries.find(entry => entry.referenceId === id)!.lines.map(line => ({ account: line.account.code, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) }));
    expect(lines(gain.body.movement.id)).toEqual(expect.arrayContaining([{ account: '1.1.4', debit: '16.00', credit: '0.00' }, { account: '4.1.3', debit: '0.00', credit: '16.00' }]));
    expect(lines(loss.body.movement.id)).toEqual(expect.arrayContaining([{ account: '5.1.2', debit: '8.00', credit: '0.00' }, { account: '1.1.4', debit: '0.00', credit: '8.00' }]));
  });

  it('período cerrado rechaza incluso productos a costo cero sin modificar stock', async () => {
    const f = await fixture({ cost: 0 }); const now = new Date();
    await prisma.fiscalPeriod.create({ data: { tenantId: f.tenantId, year: now.getFullYear(), month: now.getMonth() + 1, status: 'CLOSED', closedBy: f.userId, closedAt: now } });
    const before = await effects(f); const body = input(f); const result = await call(f, body);
    expect(result.status).toBe(409); expect(result.body.outcome).toBe('REJECTED'); expect(await effects(f)).toEqual(before);
    await prisma.fiscalPeriod.updateMany({ where: { tenantId: f.tenantId }, data: { status: 'OPEN' } });
    const replay = await call(f, body);
    expect(replay.status).toBe(409); expect(replay.body.rejection).toEqual(result.body.rejection); expect(await effects(f)).toEqual(before);
  });

  it('UUID repetido con otra cantidad no vuelve a mover stock', async () => {
    const f = await fixture(); const body = input(f);
    expect((await call(f, body)).status).toBe(200);
    const before = await effects(f); const conflict = await call(f, { ...body, quantity: '8' });
    expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('INVENTORY_ADJUSTMENT_IDEMPOTENCY_CONFLICT');
    expect(await effects(f)).toEqual(before);
  });

  it('dos requests concurrentes del mismo UUID comparten movimiento y asiento', async () => {
    const f = await fixture(); const body = input(f);
    const results = await Promise.all([call(f, body), call(f, body)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.movement.id).toBe(results[1].body.movement.id);
    expect(await effects(f)).toEqual({ stock: 15, local: 15, movements: 1, audits: 1, journals: 1 });
  });

  it('bloquea compras/devoluciones sin documento y ajuste genérico sobre lotes', async () => {
    const f = await fixture(); const before = await effects(f);
    for (const type of ['IN_PURCHASE', 'RETURN']) expect((await call(f, input(f, { type }))).status).toBe(409);
    expect(await effects(f)).toEqual(before);
    const tracked = await fixture({ stock: 0, requiresBatchTracking: true });
    const result = await call(tracked, input(tracked));
    expect(result.status).toBe(409); expect(result.body.code).toBe('BATCH_SELECTION_REQUIRED');
    expect((await effects(tracked)).stock).toBe(0);
  });

  it('mantiene tenant, rol y paso contado autoritativos', async () => {
    const f = await fixture(); const other = await fixture(); const before = await effects(f);
    expect((await call(other, input(f, { warehouseId: other.warehouseId }))).status).toBe(404);
    expect((await call(f, input(f, { quantity: '0.5' }))).status).toBe(400);
    await prisma.user.update({ where: { id: f.userId }, data: { role: 'CASHIER' } });
    expect((await call(f, input(f))).status).toBe(403);
    expect(await effects(f)).toEqual(before);
  });

  it('revierte stock, Kardex, asiento y claim si falla la auditoría final; reintento posterior funciona', async () => {
    const f = await fixture(); const body = input(f); const before = await effects(f);
    const trigger = `qa_adjust_${randomUUID().replaceAll('-', '')}`;
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.tenantId}' AND NEW.action = 'INVENTORY_ADJUSTMENT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA adjustment audit failure'; END IF; END`);
    try {
      const failed = await call(f, body);
      expect(failed.status).toBe(500); expect(failed.body.rejection).toBeUndefined();
      expect(await effects(f)).toEqual(before);
      expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_COMMAND' } })).toBe(0);
      expect(await prisma.journalEntry.count({ where: { tenantId: f.tenantId } })).toBe(0);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
    expect((await call(f, body)).status).toBe(200);
    expect(await effects(f)).toEqual({ stock: 15, local: 15, movements: 1, audits: 1, journals: 1 });
  });

  it('replay conserva evidencia tras cerrar el período; ajustes nuevos quedan bloqueados', async () => {
    const f = await fixture(); const body = input(f); const first = await call(f, body);
    expect(first.status).toBe(200); const before = await effects(f); const now = new Date();
    await prisma.fiscalPeriod.create({ data: { tenantId: f.tenantId, year: now.getFullYear(), month: now.getMonth() + 1, status: 'CLOSED' } });
    const replay = await call(f, body); expect(replay.status).toBe(200);
    expect(replay.body.movement.id).toBe(first.body.movement.id);
    expect((await call(f, input(f))).status).toBe(409);
    expect(await effects(f)).toEqual(before);
  });

  it('respeta enteros heredados y permite precisión medida sin redondear existencias', async () => {
    const counted = await fixture({ unit: 'cajas', saleMode: null, quantityStep: null });
    expect((await call(counted, input(counted, { quantity: '1.5' }))).status).toBe(400);
    const measured = await fixture({ unit: 'metro', saleMode: 'MEASURED', quantityStep: '0.01' });
    const result = await call(measured, input(measured, { quantity: '0.25' }));
    expect(result.status).toBe(200); expect(result.body.warehouseStock).toBe(10.25);
    expect(result.body.adjustmentValue).toBe('2.00');
  });

  it('exige identificar series para no desajustar existencia contra equipos disponibles', async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.productId }, data: { requiresSerialTracking: true } });
    const before = await effects(f);
    const result = await call(f, input(f, { quantity: '-1', type: 'ADJUST_LOSS' }));
    expect(result.status).toBe(409); expect(result.body.code).toBe('SERIAL_SELECTION_REQUIRED');
    expect(await effects(f)).toEqual(before);
  });

  it('SUPER_ADMIN conserva permiso previo dentro de su tenant autenticado sin ampliar acceso', async () => {
    const f = await fixture(); const other = await fixture();
    await prisma.user.update({ where: { id: f.userId }, data: { role: 'SUPER_ADMIN' } });
    const { signAuthToken } = await import('../backend/services/secrets');
    f.token = signAuthToken({ tenantId: f.tenantId, userId: f.userId, role: 'SUPER_ADMIN' });
    const response = await call(f, input(f)); expect(response.status).toBe(200);
    expect((await call(f, input(f, { productId: other.productId }))).status).toBe(404);
    expect((await effects(other)).stock).toBe(10);
  });

  it('rechazo terminal permite corregir con UUID nuevo y nunca aplica el UUID rechazado aunque vuelva el stock', async () => {
    const f = await fixture(); const body = input(f, { quantity: '-11', type: 'ADJUST_LOSS' });
    const rejected = await call(f, body);
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ outcome: 'REJECTED', clientEventId: body.clientEventId,
      rejection: { id: expect.any(String), tenantId: f.tenantId, userId: f.userId, productId: f.productId, warehouseId: f.warehouseId, quantity: '-11.0000', type: body.type, reason: body.reason, clientEventId: body.clientEventId } });
    expect((await call(f, input(f))).status).toBe(200);
    const replay = await call(f, body);
    expect(replay.status).toBe(409); expect(replay.body.rejection).toEqual(rejected.body.rejection);
    expect((await effects(f)).stock).toBe(15);
    const conflict = await call(f, { ...body, quantity: '-1' });
    expect(conflict.status).toBe(409); expect(conflict.body.rejection).toBeUndefined();
    expect((await call(f, { ...body, clientEventId: randomUUID(), quantity: '-1' })).status).toBe(200);
    expect((await effects(f)).stock).toBe(14);
    expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_REJECTED' } })).toBe(1);
  });

  it('rechazos concurrentes del mismo UUID comparten una sola decisión durable sin efectos de inventario', async () => {
    const f = await fixture(); const before = await effects(f); const body = input(f, { quantity: '-11', type: 'ADJUST_LOSS' });
    const results = await Promise.all([call(f, body), call(f, body), call(f, body)]);
    expect(results.map(result => result.status)).toEqual([409, 409, 409]);
    const decision = results.find(result => result.body.outcome === 'REJECTED');
    expect(decision, JSON.stringify(results)).toBeDefined();
    for (const result of results) {
      if (result.body.outcome === 'REJECTED') expect(result.body.rejection).toEqual(decision!.body.rejection);
      else {
        // InnoDB puede abortar un contender. Ese 409 transitorio NO afirma
        // resultado terminal; su retry debe recuperar la decisión ganadora.
        expect(result.body.code).toBe('INVENTORY_ADJUSTMENT_CONCURRENT_WRITE'); expect(result.body.rejection).toBeUndefined();
      }
      const retry = await call(f, body);
      expect(retry.status).toBe(409); expect(retry.body.rejection).toEqual(decision!.body.rejection);
    }
    expect(await effects(f)).toEqual(before);
    expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_COMMAND' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_REJECTED' } })).toBe(1);
  });

  it('si el retry gana entre rollback y rechazo, ambos devuelven el mismo ajuste aplicado', async () => {
    const { executeInventoryAdjustment } = await import('../backend/services/inventoryAdjustmentService');
    const f = await fixture(); const body = input(f, { quantity: '-11', type: 'ADJUST_LOSS' });
    let reached!: () => void; let release!: () => void;
    const rolledBack = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    const controlled = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async (...args: any[]) => {
        try { return await (target.$transaction as any).apply(target, args); }
        catch (error) {
          if (!intercepted) { intercepted = true; reached(); await resume; }
          throw error;
        }
      };
      return Reflect.get(target, key);
    } });
    const first = executeInventoryAdjustment({ principal: { tenantId: f.tenantId, userId: f.userId }, input: body }, controlled)
      .then(value => ({ value, error: null }), error => ({ value: null, error }));
    await rolledBack;
    let winner: Awaited<ReturnType<typeof call>>;
    try {
      expect((await call(f, input(f))).status).toBe(200);
      winner = await call(f, body); expect(winner.status).toBe(200);
    } finally { release(); }
    const loser = await first;
    expect(loser.error).toBeNull(); expect(loser.value?.movement.id).toBe(winner!.body.movement.id);
    expect((await effects(f)).stock).toBe(4);
    expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_REJECTED' } })).toBe(0);
  });

  it('no afirma rechazo durable si su auditoría falla y no bloquea un retry legítimo posterior', async () => {
    const f = await fixture(); const body = input(f, { quantity: '-11', type: 'ADJUST_LOSS' });
    const trigger = `qa_rejected_${randomUUID().replaceAll('-', '')}`;
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.tenantId}' AND NEW.action = 'INVENTORY_ADJUSTMENT_REJECTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA rejected audit failure'; END IF; END`);
    try {
      const result = await call(f, body);
      expect(result.status).toBe(500); expect(result.body.rejection).toBeUndefined();
      expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_COMMAND' } })).toBe(0);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
    expect((await call(f, input(f))).status).toBe(200);
    expect((await call(f, body)).status).toBe(200);
    expect((await effects(f)).stock).toBe(4);
  });

  it('evidencia rechazada corrupta y errores previos al claim nunca entregan recibo terminal', async () => {
    const f = await fixture(); const body = input(f, { quantity: '-11', type: 'ADJUST_LOSS' });
    const first = await call(f, body); expect(first.body.outcome).toBe('REJECTED');
    const stored = await prisma.auditLog.findFirstOrThrow({ where: { id: first.body.rejection.id, tenantId: f.tenantId } });
    const details = JSON.parse(stored.details!); details.rejection.quantity = '-1.0000';
    await prisma.auditLog.update({ where: { id: stored.id }, data: { details: JSON.stringify(details) } });
    const corrupt = await call(f, body);
    expect(corrupt.status).toBe(500); expect(corrupt.body.rejection).toBeUndefined();
    const invalid = await call(f, input(f, { type: 'IN_PURCHASE' }));
    expect(invalid.status).toBe(409); expect(invalid.body.rejection).toBeUndefined();
    await prisma.user.update({ where: { id: f.userId }, data: { role: 'CASHIER' } });
    const forbidden = await call(f, input(f));
    expect(forbidden.status).toBe(403); expect(forbidden.body.rejection).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'INVENTORY_ADJUSTMENT_COMMAND' } })).toBe(1);
    expect((await effects(f)).stock).toBe(10);
  });
});
