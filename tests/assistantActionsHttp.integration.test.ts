// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';
import { registerPurchase } from '../backend/services/purchaseRegistrationService';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const localFetch = globalThis.fetch;
let server: Server, base: string, signAuthToken: typeof import('../backend/services/secrets')['signAuthToken'];
let outbound: ReturnType<typeof vi.spyOn>;
type Actor = {tenantId: string; userId: string; role: string; token: string};
async function roleActor(tenantId: string, role: string): Promise<Actor> {
  const user = await prisma.user.create({data: {tenantId, role, name: 'Equipo QA HTTP', password: 'synthetic-no-login'}});
  const principal = {tenantId, userId: user.id, role};
  return {...principal, token: signAuthToken(principal)};
}
async function fixture() {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({data: {businessName: 'QA rutas acciones operativas', taxId: randomUUID(), subscriptionStatus: 'ACTIVE'}});
  const actor = await roleActor(tenant.id, 'OWNER');
  await prisma.assistantTenantConfig.create({data: {tenantId: tenant.id, enabled: true, actionsEnabled: true, executionEnabled: true, promotionsEnabled: true}});
  const supplier = await prisma.supplier.create({data: {tenantId: tenant.id, name: 'Proveedor HTTP sintético'}});
  const warehouse = await prisma.warehouse.create({data: {tenantId: tenant.id, name: 'Principal', isDefault: true}});
  const product = await prisma.product.create({data: {tenantId: tenant.id, createdBy: actor.userId, name: 'Pintura HTTP', sku: randomUUID(), price: 20, cost: 4.25, stock: 0, unit: 'litro', saleMode: 'MEASURED', quantityStep: '0.25'}});
  return {actor, supplier, warehouse, product};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const orderDraft = (f: Fixture, quantity = '2.5') => ({supplierId: f.supplier.id, items: [{productId: f.product.id, quantity, unitCost: '4.25'}]});
async function call(path: string, actor?: Actor, method = 'GET', body?: unknown) {
  const response = await localFetch(`${base}/api/assistant${path}`, {method, headers: {...(actor ? {authorization: `Bearer ${actor.token}`} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json()};
}
function expectStatus(response: Awaited<ReturnType<typeof call>>, expected: number) {
  expect(response.status, JSON.stringify(response.body)).toBe(expected);
}
async function preparedOrder(f: Fixture) {
  const created = await call('/action-proposals', f.actor, 'POST', {kind: 'PURCHASE_ORDER_DRAFT', draft: orderDraft(f), requestKey: randomUUID()});
  expectStatus(created, 201); expect(created.body.status).toBe('DRAFT');
  const revised = await call(`/action-proposals/${created.body.id}`, f.actor, 'PATCH', {version: created.body.version, draft: orderDraft(f, '3.25')});
  expectStatus(revised, 200); expect(revised.body.version).toBe(created.body.version + 1);
  const preview = await call(`/action-proposals/${created.body.id}/preview`, f.actor, 'POST', {version: revised.body.version});
  expectStatus(preview, 200); expect(preview.body.status, JSON.stringify(preview.body.issues)).toBe('READY');
  expect(preview.body.preview.effects).toContainEqual({label: 'Subtotal estimado', value: '13.81', unit: 'C$'});
  return preview.body;
}
async function counts(actor: Actor) {
  const where = {tenantId: actor.tenantId};
  const [orders, commands, stock, purchases, journal, cash] = await Promise.all([
    prisma.purchaseOrder.count({where}), prisma.assistantActionCommand.count({where}), prisma.kardexMovement.count({where}),
    prisma.purchase.count({where}), prisma.journalEntry.count({where}), prisma.cashMovement.count({where}),
  ]);
  return {orders, commands, stock, purchases, journal, cash};
}

qa('router operativo real + JWT vigente + MySQL 8', () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    vi.stubEnv('JWT_SECRETS', randomBytes(48).toString('hex'));
    for (const flag of ['NORTEX_ASSISTANT_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED', 'NORTEX_PROMOTIONS_ENABLED']) vi.stubEnv(flag, 'true');
    // Cualquier llamada a un proveedor externo haría fallar esta suite.
    outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: proveedor externo deshabilitado'));
    const router = await import('../backend/routes/assistantActions');
    ({signAuthToken} = await import('../backend/services/secrets'));
    const app = express(); app.use(express.json()); app.use('/api/assistant', router.createAssistantActionsRouter(prisma));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  });
  afterAll(async () => {
    if (server) {server.close(); await once(server, 'close');}
    expect(outbound).not.toHaveBeenCalled(); outbound?.mockRestore(); vi.unstubAllEnvs();
  });

  it('exige JWT firmado y descarta identidad o autoridad financiera añadida al cuerpo', async () => {
    const f = await fixture();
    expectStatus(await call('/action-proposals', undefined, 'POST', {}), 401);
    expectStatus(await call('/action-proposals', {...f.actor, token: 'firma-inválida'}, 'POST', {}), 403);
    expectStatus(await call('/action-proposals', f.actor, 'POST', {kind: 'PURCHASE_ORDER_DRAFT', draft: orderDraft(f), requestKey: randomUUID(), tenantId: 'forged'}), 400);
    expectStatus(await call('/action-proposals', f.actor, 'POST', {kind: 'PURCHASE_ORDER_DRAFT', draft: {...orderDraft(f), status: 'APPROVED'}, requestKey: randomUUID()}), 400);
    expect((await counts(f.actor))).toEqual({orders: 0, commands: 0, stock: 0, purchases: 0, journal: 0, cash: 0});
  });

  it('confirmación rechaza contenido extra antes de registrar una sola operación', async () => {
    const f = await fixture(); const proposal = await preparedOrder(f);
    for (const extra of [{draft: orderDraft(f)}, {total: '0.01'}, {items: []}, {tenantId: 'forged'}, {previewHash: 'forged'}, {role: 'OWNER'}]) {
      const response = await call(`/action-proposals/${proposal.id}/confirm`, f.actor, 'POST', {version: proposal.version, requestKey: randomUUID(), ...extra});
      expectStatus(response, 400); expect(response.body.code).toBe('ACTION_INVALID_INPUT');
    }
    expect((await counts(f.actor))).toMatchObject({orders: 0, commands: 0});
    expect((await call(`/action-proposals/${proposal.id}`, f.actor)).body.status).toBe('READY');
  });

  it('prepare → editar → revisar → doble confirmar → GET conserva el mismo comprobante y ningún stock/deuda', async () => {
    const f = await fixture(); const proposal = await preparedOrder(f); const requestKey = randomUUID();
    const [first, second] = await Promise.all([1, 2].map(() => call(`/action-proposals/${proposal.id}/confirm`, f.actor, 'POST', {version: proposal.version, requestKey})));
    expectStatus(first, 200); expectStatus(second, 200); expect(first.body.id).toBe(second.body.id);
    expect([first.body.replayed, second.body.replayed].sort()).toEqual([false, true]);
    const recovered = await call(`/action-proposals/${proposal.id}`, f.actor);
    expectStatus(recovered, 200); expect(recovered.cacheControl).toBe('private, no-store');
    expect(recovered.body).toMatchObject({status: 'COMMITTED', version: proposal.version, result: {...first.body, replayed: true}});
    const order = await prisma.purchaseOrder.findFirstOrThrow({where: {id: first.body.resourceId, tenantId: f.actor.tenantId}, include: {items: true}});
    expect(order.status).toBe('DRAFT'); expect(order.items[0].quantityOrderedExact?.toFixed(4)).toBe('3.2500');
    expect(await counts(f.actor)).toEqual({orders: 1, commands: 1, stock: 0, purchases: 0, journal: 0, cash: 0});
    expectStatus(await call(`/action-proposals/${proposal.id}`, f.actor, 'PATCH', {version: proposal.version, draft: orderDraft(f)}), 409);
  });

  it('identificadores de otra persona o negocio no recuperan ni confirman propuestas', async () => {
    const f = await fixture(), foreign = await fixture(); const proposal = await preparedOrder(f);
    const colleague = await roleActor(f.actor.tenantId, 'OWNER');
    for (const actor of [foreign.actor, colleague]) {
      expectStatus(await call(`/action-proposals/${proposal.id}`, actor), 404);
      expectStatus(await call(`/action-proposals/${proposal.id}/confirm`, actor, 'POST', {version: proposal.version, requestKey: randomUUID()}), 404);
    }
    expect((await counts(f.actor)).orders).toBe(0);
  });

  it('bodega conserva la allowlist real: devolución física permitida; OC, merma y promoción denegadas', async () => {
    const f = await fixture(), actor = await roleActor(f.actor.tenantId, 'BODEGUERO');
    for (const kind of ['PURCHASE_ORDER_DRAFT', 'BATCH_WRITEOFF', 'PROMOTION']) {
      const response = await call('/action-proposals', actor, 'POST', {kind, draft: {}, requestKey: randomUUID()});
      expectStatus(response, 403); expect(response.body.code).toBe('ACTION_FORBIDDEN');
    }
    const requestKey = randomUUID();
    const prepared = await call('/action-proposals', actor, 'POST', {kind: 'SUPPLIER_RETURN', draft: {}, requestKey});
    expectStatus(prepared, 201); expect(prepared.body.status).toBe('DRAFT');
    expectStatus(await call(`/action-proposals/${prepared.body.id}`, actor), 200);
    const forgedRole = {...actor, token: signAuthToken({...actor, role: 'OWNER'})};
    expectStatus(await call('/action-proposals', forgedRole, 'POST', {kind: 'PURCHASE_ORDER_DRAFT', draft: orderDraft(f), requestKey: randomUUID()}), 403);
  });

  it('bodega confirma una devolución de su negocio sin recibir costos ni alterar la deuda', async () => {
    const f = await fixture();
    const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Managua'});
    const purchase = await registerPurchase({principal: f.actor, idempotencyKey: randomUUID(), input: {supplierId: f.supplier.id, warehouseId: f.warehouse.id, invoiceNumber: randomUUID(), date: today, postingDate: today, dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), paymentMethod: 'CREDIT', items: [{productId: f.product.id, quantity: '5', unitCost: '4.25', purchaseUnit: 'BASE'}]}});
    const purchaseItem = await prisma.purchaseItem.findFirstOrThrow({where: {purchaseId: purchase.purchase.id}});
    const actor = await roleActor(f.actor.tenantId, 'BODEGUERO');
    const draft = {supplierId: f.supplier.id, reasonCode: 'DAMAGE', reason: 'Entrega física al proveedor', physicalShipmentConfirmed: true, lines: [{sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: purchaseItem.id, quantity: '1.25'}]};
    const prepared = await call('/action-proposals', actor, 'POST', {kind: 'SUPPLIER_RETURN', draft, requestKey: randomUUID()}); expectStatus(prepared, 201);
    expect(prepared.body.draft.physicalShipmentConfirmed).toBe(false);
    const edited = await call(`/action-proposals/${prepared.body.id}`, actor, 'PATCH', {version: prepared.body.version, draft}); expectStatus(edited, 200);
    const preview = await call(`/action-proposals/${prepared.body.id}/preview`, actor, 'POST', {version: edited.body.version}); expectStatus(preview, 200);
    expect(preview.body.status, JSON.stringify(preview.body.issues)).toBe('READY');
    expect(JSON.stringify(preview.body)).not.toMatch(/"(?:cost|unitCost|bookUnitCostExact|bookValueExact|price|balanceDue)"/);
    const before = await prisma.purchase.findFirstOrThrow({where: {tenantId: actor.tenantId, id: purchase.purchase.id}, select: {balanceDue: true}});
    const confirmed = await call(`/action-proposals/${prepared.body.id}/confirm`, actor, 'POST', {version: preview.body.version, requestKey: randomUUID()}); expectStatus(confirmed, 200);
    expect((await prisma.product.findFirstOrThrow({where: {tenantId: actor.tenantId, id: f.product.id}})).stock).toBe(3.75);
    expect(await prisma.purchase.findFirstOrThrow({where: {tenantId: actor.tenantId, id: purchase.purchase.id}, select: {balanceDue: true}})).toEqual(before);
    expect(await prisma.supplierCreditNote.count({where: {tenantId: actor.tenantId}})).toBe(0);
  });

  it('deshabilitar el usuario revoca el JWT existente para confirmar y recuperar historial', async () => {
    const f = await fixture(); const proposal = await preparedOrder(f);
    await prisma.user.updateMany({where: {tenantId: f.actor.tenantId, id: f.actor.userId}, data: {status: 'DISABLED'}});
    const denied = await call(`/action-proposals/${proposal.id}/confirm`, f.actor, 'POST', {version: proposal.version, requestKey: randomUUID()});
    expectStatus(denied, 403); expect(denied.body.code).toBe('SESSION_REVOKED');
    expectStatus(await call(`/action-proposals/${proposal.id}`, f.actor), 403);
    expect((await counts(f.actor)).orders).toBe(0);
  });

  it('cambiar OWNER a bodega oculta la propuesta anterior aunque el JWT todavía afirme OWNER', async () => {
    const f = await fixture(); const proposal = await preparedOrder(f);
    await prisma.user.updateMany({where: {tenantId: f.actor.tenantId, id: f.actor.userId}, data: {role: 'BODEGUERO'}});
    expectStatus(await call(`/action-proposals/${proposal.id}/confirm`, f.actor, 'POST', {version: proposal.version, requestKey: randomUUID()}), 404);
    expectStatus(await call(`/action-proposals/${proposal.id}`, f.actor), 404);
    expectStatus(await call('/action-proposals', f.actor, 'POST', {kind: 'PURCHASE_ORDER_DRAFT', draft: orderDraft(f), requestKey: randomUUID()}), 403);
    expect((await counts(f.actor))).toEqual({orders: 0, commands: 0, stock: 0, purchases: 0, journal: 0, cash: 0});
  });
});
