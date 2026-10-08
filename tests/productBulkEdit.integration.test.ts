// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { executeProductBulkEdit } from '../backend/services/productBulkEditService';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
let base: string;
type Actor = {tenantId: string; userId: string; role: string; token: string};
async function actor(tenantId?: string, role = 'OWNER'): Promise<Actor> {
  assertDisposableDatabase();
  const tenant = tenantId ? {id: tenantId} : await prisma.tenant.create({data: {businessName: 'QA edición masiva', taxId: randomUUID(), subscriptionStatus: 'ACTIVE'}});
  const password = `QA-${randomUUID()}`;
  const user = await prisma.user.create({data: {tenantId: tenant.id, role, name: 'Edición QA', email: `bulk-${randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 4)}});
  const login = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: user.email, password})});
  expect(login.status).toBe(200);
  const body = await login.json();
  return {tenantId: tenant.id, userId: user.id, role, token: body.token};
}
async function fixture(price = 100) {
  const principal = await actor();
  const product = await prisma.product.create({data: {tenantId: principal.tenantId, createdBy: principal.userId, sku: randomUUID(), name: 'Producto masivo', category: 'Original', price, cost: 4.25, stock: 17, wholesalePrice: 80, wholesaleMinQty: 10, packSize: 12, packPrice: 900, packUnit: 'caja'}});
  return {principal, product};
}
async function patch(principal: Actor, input: unknown) {
  const response = await fetch(`${base}/api/products/bulk-edit`, {method: 'PATCH', headers: {authorization: `Bearer ${principal.token}`, 'content-type': 'application/json'}, body: JSON.stringify(input)});
  return {status: response.status, body: await response.json()};
}
function success(response: Awaited<ReturnType<typeof patch>>, count = 1) {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body).toEqual({count, message: `${count} producto(s) actualizado(s).`});
}
const current = (id: string) => prisma.product.findUniqueOrThrow({where: {id}});
async function executeTestDdl(sql: string) {
  assertDisposableDatabase();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], {stdio: ['pipe', 'ignore', 'pipe']});
    child.stderr.resume(); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`DDL temporal de QA falló (${code}).`)));
    child.stdin.end(sql);
  });
}

qa('edición masiva: endpoint real + MySQL 8', () => {
  beforeAll(() => {
    assertDisposableDatabase();
    const url = new URL(process.env.NORTEX_QA_BASE_URL ?? 'invalid:');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Se requiere backend HTTP local descartable.');
    base = url.origin;
  });

  it('caracterización: set redondea a centavos y categoría comparte la respuesta y auditoría', async () => {
    const f = await fixture();
    success(await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: 2.345, category: '  Pinturas  '}));
    expect(await current(f.product.id)).toMatchObject({price: 2.35, category: 'Pinturas', cost: 4.25, stock: 17, wholesalePrice: 80, packPrice: 900});
    const audit = await prisma.auditLog.findFirstOrThrow({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_BULK_EDIT'}});
    expect(audit.userId).toBe(f.principal.userId);
    expect(JSON.parse(audit.details!)).toMatchObject({count: 1, requestedIds: 1, category: 'Pinturas', priceMode: 'set', priceValue: 2.345, priceChanges: [{id: f.product.id, priceBefore: '100.00', priceAfter: '2.35'}]});
    success(await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: 0}));
    expect((await current(f.product.id)).price).toBe(0);
  });

  it('caracterización: porcentaje usa Decimal y redondea cada producto', async () => {
    const f = await fixture(10.05);
    success(await patch(f.principal, {ids: [f.product.id], priceMode: 'pct', priceValue: 10}));
    expect((await current(f.product.id)).price).toBe(11.06);
    success(await patch(f.principal, {ids: [f.product.id], priceMode: 'pct', priceValue: -50}));
    expect((await current(f.product.id)).price).toBe(5.53);
  });

  it('caracterización: sólo categoría preserva precio, costo, stock y versiones comerciales', async () => {
    const f = await fixture();
    success(await patch(f.principal, {ids: [f.product.id], category: 'Nueva categoría'}));
    expect(await current(f.product.id)).toMatchObject({price: 100, category: 'Nueva categoría', cost: 4.25, stock: 17, wholesalePrice: 80, packPrice: 900, promotionPriceVersion: f.product.promotionPriceVersion});
  });

  it('caracterización: IDs repetidos cuentan una vez y productos ajenos nunca cambian', async () => {
    const own = await fixture(), foreign = await fixture();
    success(await patch(own.principal, {ids: [foreign.product.id, own.product.id, own.product.id, 'missing-id'], priceMode: 'set', priceValue: 75}));
    expect((await current(own.product.id)).price).toBe(75);
    expect((await current(foreign.product.id)).price).toBe(100);
    success(await patch(own.principal, {ids: [foreign.product.id, 'missing-id'], category: 'No pertenece'}), 0);
    expect((await current(foreign.product.id)).category).toBe('Original');
  });

  it('caracterización: valida antes de cambiar y respeta OWNER, ADMIN y la excepción SUPER_ADMIN', async () => {
    const f = await fixture();
    for (const input of [{ids: []}, {ids: [f.product.id]}, {ids: [f.product.id], priceMode: 'set', priceValue: -1}, {ids: [f.product.id], priceMode: 'pct', priceValue: -100}]) {
      expect((await patch(f.principal, input)).status).toBe(400);
    }
    for (const role of ['BODEGUERO', 'MANAGER', 'CASHIER', 'VIEWER', 'ACCOUNTANT', 'EMPLOYEE']) {
      const user = await actor(f.principal.tenantId, role);
      expect((await patch(user, {ids: [f.product.id], priceMode: 'set', priceValue: 1})).status).toBe(403);
    }
    expect((await current(f.product.id)).price).toBe(100);
    for (const role of ['ADMIN', 'SUPER_ADMIN']) success(await patch(await actor(f.principal.tenantId, role), {ids: [f.product.id], priceMode: 'set', priceValue: 100}));
  });

  it('un fallo real de auditoría revierte precio, categoría y versión de toda la edición', async () => {
    const f = await fixture();
    const trigger = `qa_bulk_audit_${randomUUID().replaceAll('-', '')}`;
    await executeTestDdl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.principal.tenantId}' AND NEW.action = 'PRODUCT_BULK_EDIT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA bulk audit failure'; END IF; END`);
    try {
      expect((await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: 75, category: 'No debe persistir'})).status).toBe(500);
      expect(await current(f.product.id)).toMatchObject({price: 100, category: 'Original', promotionPriceVersion: f.product.promotionPriceVersion});
      expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_BULK_EDIT'}})).toBe(0);
    } finally {await executeTestDdl(`DROP TRIGGER \`${trigger}\``);}
  });

  it('dos personas ajustan +10% concurrente sobre precio bloqueado y conservan ambas auditorías', async () => {
    const f = await fixture(), admin = await actor(f.principal.tenantId, 'ADMIN');
    const results = await Promise.all([f.principal, admin].map(user => patch(user, {ids: [f.product.id], priceMode: 'pct', priceValue: 10})));
    results.forEach(result => success(result));
    expect(await current(f.product.id)).toMatchObject({price: 121, promotionPriceVersion: f.product.promotionPriceVersion + 2});
    const audits = await prisma.auditLog.findMany({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_BULK_EDIT'}});
    expect(audits).toHaveLength(2);
    expect(audits.flatMap(row => JSON.parse(row.details!).priceChanges).sort((a, b) => Number(a.priceBefore) - Number(b.priceBefore)))
      .toEqual([{id: f.product.id, priceBefore: '100.00', priceAfter: '110.00'}, {id: f.product.id, priceBefore: '110.00', priceAfter: '121.00'}]);
  });

  it('set cambia la versión una sola vez por cambio material y no reusa una versión anterior', async () => {
    const f = await fixture();
    for (const [price, increment] of [[100, 0], [75, 1], [75, 1], [100, 2]] as const) {
      success(await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: price}));
      expect(await current(f.product.id)).toMatchObject({price, promotionPriceVersion: f.product.promotionPriceVersion + increment});
    }
  });

  it('una sesión degradada o deshabilitada no edita aunque conserve su JWT', async () => {
    const f = await fixture();
    await prisma.user.update({where: {id: f.principal.userId}, data: {role: 'MANAGER'}});
    expect((await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: 1})).status).toBe(403);
    await prisma.user.update({where: {id: f.principal.userId}, data: {role: 'OWNER', status: 'DISABLED'}});
    expect((await patch(f.principal, {ids: [f.product.id], priceMode: 'set', priceValue: 1})).status).toBe(403);
    expect(await current(f.product.id)).toMatchObject({price: 100, promotionPriceVersion: f.product.promotionPriceVersion});
  });

  it('el servicio revalida la revocación ocurrida después de autenticar y antes de abrir la transacción', async () => {
    const f = await fixture();
    const db = new Proxy(prisma, {get(target, name, receiver) {
      if (name !== '$transaction') return Reflect.get(target, name, receiver);
      return async (callback: any, options: any) => {
        await prisma.user.update({where: {id: f.principal.userId}, data: {role: 'MANAGER'}});
        return target.$transaction(callback, options);
      };
    }});
    await expect(executeProductBulkEdit({principal: f.principal, input: {ids: [f.product.id], priceMode: 'set', priceValue: 1}}, db))
      .rejects.toMatchObject({httpStatus: 403, code: 'PRODUCT_BULK_SESSION_REVOKED'});
    expect(await current(f.product.id)).toMatchObject({price: 100, promotionPriceVersion: f.product.promotionPriceVersion});
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_BULK_EDIT'}})).toBe(0);
  });
});
