// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
let base: string;
type Actor = {tenantId: string; userId: string; token: string};
async function actor(tenantId?: string, role = 'OWNER'): Promise<Actor> {
  assertDisposableDatabase();
  const tenant = tenantId ? {id: tenantId} : await prisma.tenant.create({data: {businessName: 'QA Importación', taxId: randomUUID(), subscriptionStatus: 'ACTIVE'}});
  const password = `QA-${randomUUID()}`;
  const user = await prisma.user.create({data: {tenantId: tenant.id, role, name: 'Importación QA', email: `import-${randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 4)}});
  const response = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: user.email, password})});
  expect(response.status).toBe(200);
  const body = await response.json();
  return {tenantId: tenant.id, userId: user.id, token: body.token};
}
async function fixture() {
  const principal = await actor();
  const product = await prisma.product.create({data: {tenantId: principal.tenantId, createdBy: principal.userId, sku: randomUUID(), name: 'Original', category: 'Original', price: 100, cost: 42, stock: 17, minStock: 3, unit: 'kg', saleMode: 'MEASURED', quantityStep: 0.25, requiresBatchTracking: false, ivaExento: true}});
  return {principal, product};
}
async function post(principal: Actor, products: unknown[], extra = {}) {
  const response = await fetch(`${base}/api/products/bulk`, {method: 'POST', headers: {authorization: `Bearer ${principal.token}`, 'content-type': 'application/json'}, body: JSON.stringify({products, ...extra})});
  return {status: response.status, body: await response.json()};
}
const current = (id: string) => prisma.product.findUniqueOrThrow({where: {id}});
async function ddl(sql: string) {
  assertDisposableDatabase();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], {stdio: ['pipe', 'ignore', 'pipe']});
    let failure = ''; child.stderr.on('data', chunk => { failure += chunk.toString(); }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`DDL de QA falló (${code}): ${failure.replace(/mysql:\/\/[^\s]+/g, '[QA DB]')}`))); child.stdin.end(sql);
  });
}

qa('importación de productos: HTTP real y MySQL 8', () => {
  beforeAll(() => {
    assertDisposableDatabase();
    const url = new URL(process.env.NORTEX_QA_BASE_URL ?? 'invalid:');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Se requiere backend local descartable.');
    base = url.origin;
  });

  it('caracterización: aliases, opcionales ausentes, cero, falso y resumen de fila real', async () => {
    const f = await fixture();
    const result = await post(f.principal, [{sku: f.product.sku, nombre: 'Nuevo nombre', precio: 101, costo: 0, ivaExento: false}, {sku: 'INVALIDO', nombre: '', precio: 1, excelRow: 8}]);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({created: 0, updated: 1, total: 2});
    expect(result.body.errors).toEqual(['Fila 8: sin código o sin nombre']);
    expect(await current(f.product.id)).toMatchObject({name: 'Nuevo nombre', price: 101, cost: 0, ivaExento: false, stock: 17, category: 'Original', minStock: 3, saleMode: 'MEASURED'});
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRICE_CHANGED'}})).toBe(1);
  });

  it('caracterización: alta inicial registra desglose, Kardex y auditoría sin duplicar al reintentar sin stock', async () => {
    const principal = await actor(), sku = randomUUID();
    const input = {sku, nombre: 'Producto nuevo', precio: 20, costo: 7, stock: 5, unidad: 'unidad', saleMode: 'COUNTED', quantityStep: 1};
    const result = await post(principal, [input]);
    expect(result.status).toBe(200); expect(result.body).toMatchObject({created: 1, updated: 0, errors: []});
    const product = await prisma.product.findUniqueOrThrow({where: {tenantId_sku: {tenantId: principal.tenantId, sku: sku.toUpperCase()}}});
    expect(product.stock).toBe(5);
    expect(await prisma.productStock.findFirst({where: {tenantId: principal.tenantId, productId: product.id}})).toMatchObject({stock: 5});
    expect(await prisma.kardexMovement.findFirst({where: {tenantId: principal.tenantId, productId: product.id}})).toMatchObject({stockBefore: 0, stockAfter: 5, quantity: 5, referenceType: 'BULK_IMPORT'});
    const {stock, ...catalog} = input;
    expect((await post(principal, [catalog])).body).toMatchObject({created: 0, updated: 1, errors: []});
    expect((await current(product.id)).stock).toBe(5);
    expect(await prisma.kardexMovement.count({where: {tenantId: principal.tenantId, productId: product.id}})).toBe(1);
  });

  it('caracterización: tenant y roles salen de sesión autenticada', async () => {
    const own = await fixture(), foreign = await fixture();
    const result = await post(own.principal, [{sku: foreign.product.sku, nombre: 'Mi producto', precio: 55, tenantId: foreign.principal.tenantId}], {tenantId: foreign.principal.tenantId});
    expect(result.body).toMatchObject({created: 1, updated: 0, errors: []});
    expect((await current(foreign.product.id)).price).toBe(100);
    for (const role of ['BODEGUERO', 'MANAGER', 'CASHIER', 'VIEWER']) expect((await post(await actor(own.principal.tenantId, role), [{sku: own.product.sku, nombre: 'No autorizado', precio: 1}])).status).toBe(403);
    expect((await current(own.product.id)).price).toBe(100);
  });

  it('reproducción: fallo de auditoría revierte toda la fila y permite confirmar la siguiente', async () => {
    const f = await fixture(), nextSku = randomUUID(), trigger = `qa_import_${randomUUID().replaceAll('-', '')}`;
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.principal.tenantId}' AND NEW.action = 'PRODUCT_BULK_UPDATED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA import audit failure'; END IF; END`);
    try {
      const result = await post(f.principal, [{sku: f.product.sku, nombre: 'No debe persistir', precio: 5, costo: 2, requiresBatchTracking: false}, {sku: nextSku, nombre: 'Fila siguiente', precio: 10}]);
      expect(result.status).toBe(200); expect(result.body).toMatchObject({created: 1, updated: 0, total: 2}); expect(result.body.errors).toHaveLength(1);
      expect(await current(f.product.id)).toMatchObject({name: 'Original', price: 100, cost: 42, stock: 17, promotionPriceVersion: f.product.promotionPriceVersion});
      expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRICE_CHANGED'}})).toBe(0);
      expect(await prisma.product.count({where: {tenantId: f.principal.tenantId, sku: nextSku.toUpperCase()}})).toBe(1);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
  });

  it('reproducción: modo/paso nuevos revalidan cantidades de reposición y mayoreo persistidas', async () => {
    const f = await fixture();
    await prisma.product.update({where: {id: f.product.id}, data: {reorderPoint: 1.25, maxStock: 20.25, wholesalePrice: 80, wholesaleMinQty: 2.25}});
    const result = await post(f.principal, [{sku: f.product.sku, nombre: 'No debe cambiar', precio: 1, saleMode: 'COUNTED', quantityStep: 1, requiresBatchTracking: false}]);
    expect(result.status).toBe(200); expect(result.body).toMatchObject({created: 0, updated: 0}); expect(result.body.errors).toHaveLength(1);
    expect(await current(f.product.id)).toMatchObject({name: 'Original', price: 100, saleMode: 'MEASURED'});
  });

  it('rechaza existencia explícita en existente sin cambiar ninguna columna ni bodega', async () => {
    const f = await fixture();
    const warehouse = await prisma.warehouse.create({data: {tenantId: f.principal.tenantId, name: 'Bodega existente', isDefault: true}});
    await prisma.productStock.create({data: {tenantId: f.principal.tenantId, productId: f.product.id, warehouseId: warehouse.id, stock: 17}});
    const result = await post(f.principal, [{sku: f.product.sku, nombre: 'Cambio peligroso', precio: 1, stock: 0}]);
    expect(result.body).toMatchObject({created: 0, updated: 0}); expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors[0]).toContain('conteo o ajuste');
    expect(await current(f.product.id)).toMatchObject({name: 'Original', price: 100, stock: 17});
    expect(await prisma.productStock.findFirst({where: {tenantId: f.principal.tenantId, productId: f.product.id}})).toMatchObject({stock: 17});
    expect(await prisma.kardexMovement.count({where: {tenantId: f.principal.tenantId, productId: f.product.id}})).toBe(0);
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId}})).toBe(0);
  });

  it('alta con stock requiere ubicación inequívoca y rechaza bodegas ajenas e inactivas', async () => {
    const principal = await actor(), foreign = await actor();
    const main = await prisma.warehouse.create({data: {tenantId: principal.tenantId, name: 'Principal', isDefault: true}});
    const chosen = await prisma.warehouse.create({data: {tenantId: principal.tenantId, name: 'Segunda'}});
    const disabled = await prisma.warehouse.create({data: {tenantId: principal.tenantId, name: 'Inactiva', isActive: false}});
    const foreignWarehouse = await prisma.warehouse.create({data: {tenantId: foreign.tenantId, name: 'Ajena'}});
    const input = {sku: randomUUID(), nombre: 'Alta en ubicación', precio: 15, stock: 3};
    for (const extra of [{}, {warehouseId: disabled.id}, {warehouseId: foreignWarehouse.id}]) {
      const result = await post(principal, [input], extra);
      expect(result.body).toMatchObject({created: 0, updated: 0}); expect(result.body.errors).toHaveLength(1);
      expect(await prisma.product.count({where: {tenantId: principal.tenantId}})).toBe(0);
    }
    expect((await post(principal, [input], {warehouseId: chosen.id})).body).toMatchObject({created: 1, errors: []});
    const stocks = await prisma.productStock.findMany({where: {tenantId: principal.tenantId}});
    expect(stocks).toHaveLength(1); expect(stocks[0]).toMatchObject({warehouseId: chosen.id, stock: 3});
    expect(stocks.some(row => row.warehouseId === main.id)).toBe(false);
  });

  it('fallo tardío en alta revierte producto, ProductStock, Kardex y auditoría; error público no revela SQL', async () => {
    const principal = await actor(), sku = randomUUID(), trigger = `qa_import_${randomUUID().replaceAll('-', '')}`;
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${principal.tenantId}' AND NEW.action = 'PRODUCT_CREATED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA import audit failure'; END IF; END`);
    try {
      const result = await post(principal, [{sku, nombre: 'Alta que falla', precio: 100, stock: 12}]);
      expect(result.body).toMatchObject({created: 0, updated: 0}); expect(result.body.errors).toHaveLength(1);
      expect(result.body.errors[0]).toContain('Sus cambios no se aplicaron');
      expect(result.body.errors[0]).not.toMatch(/Prisma|SELECT|INSERT|server\.ts|SIGNAL|45000/);
      for (const table of [prisma.product, prisma.productStock, prisma.kardexMovement, prisma.auditLog] as any[]) expect(await table.count({where: {tenantId: principal.tenantId}})).toBe(0);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
  });

  it('dos importaciones concurrentes preservan opcionales omitidos con estado bloqueado', async () => {
    const f = await fixture(), admin = await actor(f.principal.tenantId, 'ADMIN');
    let release!: () => void, ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${f.product.id} AND tenantId = ${f.principal.tenantId} FOR UPDATE`;
      ready(); await wait;
    });
    await started;
    const first = post(f.principal, [{sku: f.product.sku, nombre: 'Concurrente', precio: 100, costo: 99}]);
    const second = post(admin, [{sku: f.product.sku, nombre: 'Concurrente', precio: 100, categoria: 'Nueva'}]);
    await new Promise(resolve => setTimeout(resolve, 100)); release(); await blocker;
    const results = await Promise.all([first, second]);
    results.forEach(result => expect(result.body).toMatchObject({updated: 1, errors: []}));
    expect(await current(f.product.id)).toMatchObject({cost: 99, category: 'Nueva', stock: 17});
    const audits = await prisma.auditLog.findMany({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_BULK_UPDATED'}, take: 3});
    expect(audits).toHaveLength(2);
    const costAudit = audits.map(row => JSON.parse(row.details!)).find(detail => detail.before.cost === '42' && detail.after.cost === '99');
    expect(costAudit).toBeDefined();
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRICE_CHANGED'}})).toBe(1);
  });

  it('rechaza cambiar unidad base con stock', async () => {
    const f = await fixture();
    const result = await post(f.principal, [{sku: f.product.sku, nombre: 'No debe cambiar', precio: 10, unidad: 'unidad'}]);
    expect(result.body).toMatchObject({updated: 0}); expect(result.body.errors).toHaveLength(1);
    expect(await current(f.product.id)).toMatchObject({unit: 'kg', name: 'Original', price: 100});
  });

  it('blancos y LEGACY preservan configuración mientras cero y falso explícitos siguen admitidos', async () => {
    const f = await fixture();
    const result = await post(f.principal, [{sku: f.product.sku, nombre: 'Actualizado', precio: 100, costo: ' ', categoria: '', stock: '', saleMode: 'LEGACY', quantityStep: 1}]);
    expect(result.body).toMatchObject({updated: 1, errors: []});
    expect(await current(f.product.id)).toMatchObject({cost: 42, category: 'Original', saleMode: 'MEASURED', stock: 17});
    expect(String((await current(f.product.id)).quantityStep)).toBe('0.25');
  });

  it('alta con paso de dos unidades no inventa un mínimo incompatible', async () => {
    const principal = await actor(), sku = randomUUID();
    const result = await post(principal, [{sku, nombre: 'Paquete doble', precio: 12, stock: 4, saleMode: 'COUNTED', quantityStep: 2}]);
    expect(result.body).toMatchObject({created: 1, updated: 0, errors: []});
    const product = await prisma.product.findUniqueOrThrow({where: {tenantId_sku: {tenantId: principal.tenantId, sku: sku.toUpperCase()}}});
    expect(product).toMatchObject({stock: 4, minStock: 0});
  });

  it('no ingresa stock de lote sin lote cuando el libro de lotes está habilitado', async () => {
    const principal = await actor();
    await prisma.tenant.update({where: {id: principal.tenantId}, data: {batchWarehouseLedgerMode: 'ENFORCED'}});
    const result = await post(principal, [{sku: randomUUID(), nombre: 'Medicamento', precio: 10, stock: 3, requiresBatchTracking: true}]);
    expect(result.body).toMatchObject({created: 0, updated: 0}); expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors[0]).toContain('lote');
    expect(await prisma.product.count({where: {tenantId: principal.tenantId}})).toBe(0);
  });
});
