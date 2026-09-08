import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';
import { prepareAssistantAction, reviseAssistantAction, previewAssistantAction, confirmAssistantAction, getAssistantAction } from '../backend/services/assistant/actions/service';
import { executeBatchWriteoff } from '../backend/services/batchWriteoffService';
import { registerPurchase } from '../backend/services/purchaseRegistrationService';
import type { AssistantActionKind } from '../shared/assistantOperations';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
async function executeTestDdl(sql: string) {
  assertDisposableDatabase();
  // El motor SQL de Prisma acepta CREATE TRIGGER; el protocolo preparado no.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], {stdio: ['pipe', 'ignore', 'pipe']});
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`DDL temporal de QA falló (${code}).`)));
    child.stdin.end(sql);
  });
}
async function fixture(options: {tracked?: boolean; stock?: number; role?: string} = {}) {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({data: {businessName: 'QA acciones operativas aisladas', taxId: randomUUID(), batchWarehouseLedgerMode: 'ENFORCED'}});
  const user = await prisma.user.create({data: {tenantId: tenant.id, name: 'QA operador', password: 'synthetic-no-login', role: options.role ?? 'OWNER'}});
  const principal = {tenantId: tenant.id, userId: user.id, role: user.role};
  await prisma.assistantTenantConfig.create({data: {tenantId: tenant.id, enabled: true, actionsEnabled: true, executionEnabled: true}});
  const supplier = await prisma.supplier.create({data: {tenantId: tenant.id, name: 'Proveedor sintético'}});
  const warehouse = await prisma.warehouse.create({data: {tenantId: tenant.id, name: 'Principal', isDefault: true}});
  const product = await prisma.product.create({data: {tenantId: tenant.id, createdBy: user.id, name: 'Pintura sintética', sku: randomUUID(), price: 20, cost: 12.34, stock: options.stock ?? 10, unit: 'litro', saleMode: 'MEASURED', quantityStep: '0.25', requiresBatchTracking: options.tracked ?? true}});
  await prisma.productStock.create({data: {tenantId: tenant.id, productId: product.id, warehouseId: warehouse.id, stock: product.stock}});
  const batch = options.tracked === false ? null : await prisma.productBatch.create({data: {tenantId: tenant.id, productId: product.id, batchNumber: 'QA-LOTE', expiryDate: new Date('2025-01-01T00:00:00Z'), stock: product.stock}});
  if (batch) await prisma.productBatchWarehouseStock.create({data: {tenantId: tenant.id, productId: product.id, batchId: batch.id, warehouseId: warehouse.id, stock: product.stock}});
  return {principal, supplier, warehouse, product, batch};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const orderDraft = (f: Fixture) => ({supplierId: f.supplier.id, items: [{productId: f.product.id, quantity: '2.5', unitCost: '4.25'}]});
const writeoffDraft = (f: Fixture) => ({batchId: f.batch!.id, warehouseId: f.warehouse.id, quantity: '1.25', reason: 'Retiro físico por vencimiento', physicalRemovalConfirmed: true});
async function ready(f: Fixture, kind: AssistantActionKind, draft: object) {
  let proposal = await prepareAssistantAction(f.principal, kind, draft, randomUUID());
  proposal = await reviseAssistantAction(f.principal, proposal.id, proposal.version, draft);
  const reviewed = await previewAssistantAction(f.principal, proposal.id, proposal.version);
  expect(reviewed.status, JSON.stringify(reviewed.issues)).toBe('READY');
  return reviewed;
}
async function effects(f: Fixture) {
  const where = {tenantId: f.principal.tenantId};
  const [product, local, batch, batchLocal, orders, purchases, returns, cash, journals, kardex, commands] = await Promise.all([
    prisma.product.findFirstOrThrow({where: {...where, id: f.product.id}, select: {stock: true, cost: true}}),
    prisma.productStock.findFirstOrThrow({where: {...where, productId: f.product.id, warehouseId: f.warehouse.id}, select: {stock: true}}),
    f.batch ? prisma.productBatch.findFirstOrThrow({where: {...where, id: f.batch.id}, select: {stock: true}}) : null,
    f.batch ? prisma.productBatchWarehouseStock.findFirstOrThrow({where: {...where, batchId: f.batch.id, warehouseId: f.warehouse.id}, select: {stock: true}}) : null,
    prisma.purchaseOrder.count({where}), prisma.purchase.count({where}), prisma.supplierReturn.count({where}), prisma.cashMovement.count({where}),
    prisma.journalEntry.count({where}), prisma.kardexMovement.count({where}), prisma.assistantActionCommand.count({where}),
  ]);
  return {product, local, batch, batchLocal: batchLocal?.stock.toString() ?? null, orders, purchases, returns, cash, journals, kardex, commands};
}

qa('acciones operativas: efectos atómicos en MySQL 8 descartable', () => {
  beforeAll(() => {
    assertDisposableDatabase();
    for (const name of ['NORTEX_ASSISTANT_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED']) vi.stubEnv(name, 'true');
  });
  afterAll(() => {vi.unstubAllEnvs();});

  it('doble confirmación de OC y recuperación tras respuesta perdida producen un borrador sin inventario ni deuda', async () => {
    const f = await fixture(); const before = await effects(f); const proposal = await ready(f, 'PURCHASE_ORDER_DRAFT', orderDraft(f)); const requestKey = randomUUID();
    const results = await Promise.all([1, 2].map(() => confirmAssistantAction(f.principal, proposal.id, proposal.version, requestKey)));
    expect(results[0].id).toBe(results[1].id);
    expect(await effects(f)).toEqual({...before, orders: 1, commands: 1});
    expect((await getAssistantAction(f.principal, proposal.id)).result).toMatchObject({id: results[0].id, resourceId: results[0].resourceId, replayed: true});
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'ASSISTANT_ACTION_COMMITTED'}})).toBe(1);
  }, 20_000);

  it('la merma y el formulario usan el mismo dominio, con unidades fraccionarias y asiento real', async () => {
    const f = await fixture(); const proposal = await ready(f, 'BATCH_WRITEOFF', writeoffDraft(f)); const requestKey = randomUUID();
    expect(await prisma.account.count({where: {tenantId: f.principal.tenantId}})).toBe(0);
    expect((await effects(f))).toMatchObject({commands: 0, kardex: 0, journals: 0, product: {stock: 10}});
    const [first, second] = await Promise.all([1, 2].map(() => confirmAssistantAction(f.principal, proposal.id, proposal.version, requestKey)));
    expect(first.id).toBe(second.id);
    const after = await effects(f);
    expect(after).toMatchObject({product: {stock: 8.75, cost: 12.34}, local: {stock: 8.75}, batch: {stock: 8.75}, batchLocal: '8.75', commands: 1, kardex: 1, journals: 1, cash: 0, purchases: 0});
    const journal = await prisma.journalEntry.findFirstOrThrow({where: {tenantId: f.principal.tenantId, referenceType: 'BATCH_WRITEOFF'}, include: {lines: {include: {account: true}}}});
    expect(journal.lines.map(line => ({code: line.account.code, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2)})).sort((a, b) => a.code.localeCompare(b.code))).toEqual([{code: '1.1.4', debit: '0.00', credit: '15.43'}, {code: '5.1.2', debit: '15.43', credit: '0.00'}]);
    const direct = await fixture();
    const {physicalRemovalConfirmed: _physical, batchId, ...input} = writeoffDraft(direct);
    const form = await executeBatchWriteoff({principal: direct.principal, batchId, input: {...input, clientEventId: randomUUID()}});
    expect(form.result).toMatchObject({quantity: '1.2500', lossValue: '15.43', warehouseStock: '8.7500', batchStock: '8.7500'});
    expect(await effects(direct)).toEqual({...after, commands: 0});
  }, 20_000);

  it('fallo real de auditoría del asistente revierte merma, asiento y comprobantes de ambos dominios', async () => {
    const f = await fixture(); const proposal = await ready(f, 'BATCH_WRITEOFF', writeoffDraft(f)); const before = await effects(f);
    const trigger = `qa_action_audit_${randomUUID().replaceAll('-', '')}`;
    // Identificadores y tenant provienen exclusivamente de fixtures sintéticas UUID.
    await executeTestDdl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.principal.tenantId}' AND NEW.action = 'ASSISTANT_ACTION_COMMITTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA atomic action audit failure'; END IF; END`);
    try {
      await expect(confirmAssistantAction(f.principal, proposal.id, proposal.version, randomUUID())).rejects.toThrow();
      expect(await effects(f)).toEqual(before);
      expect((await getAssistantAction(f.principal, proposal.id)).status).toBe('READY');
      expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId}})).toBe(0);
      expect(await prisma.account.count({where: {tenantId: f.principal.tenantId}})).toBe(0);
    } finally {await executeTestDdl(`DROP TRIGGER \`${trigger}\``);}
  }, 20_000);

  it('un costo cambiado después de revisar impide ejecutar; una revisión nueva recupera la propuesta', async () => {
    const f = await fixture(); const proposal = await ready(f, 'BATCH_WRITEOFF', writeoffDraft(f));
    await prisma.product.updateMany({where: {id: f.product.id, tenantId: f.principal.tenantId}, data: {cost: 15}});
    const before = await effects(f);
    await expect(confirmAssistantAction(f.principal, proposal.id, proposal.version, randomUUID())).rejects.toMatchObject({code: 'ACTION_REVIEW_STALE'});
    expect(await effects(f)).toEqual(before);
    const reviewed = await previewAssistantAction(f.principal, proposal.id, proposal.version);
    expect(reviewed.preview?.effects).toContainEqual({label: 'Pérdida por merma', value: '18.75', unit: 'C$'});
    await confirmAssistantAction(f.principal, reviewed.id, reviewed.version, randomUUID());
    expect((await effects(f)).product.stock).toBe(8.75);
  }, 20_000);

  it('edición concurrente de la versión revisada sólo puede conservar uno de los cambios', async () => {
    const f = await fixture(); const proposal = await ready(f, 'PURCHASE_ORDER_DRAFT', orderDraft(f));
    const results = await Promise.allSettled(['Uno', 'Dos'].map(notes => reviseAssistantAction(f.principal, proposal.id, proposal.version, {...orderDraft(f), notes})));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const current = await getAssistantAction(f.principal, proposal.id);
    expect(current).toMatchObject({version: proposal.version + 1, status: 'DRAFT', preview: null});
  });

  it('otro tenant, otro usuario y un permiso revocado no confirman ni recuperan la operación', async () => {
    const f = await fixture(); const proposal = await ready(f, 'PURCHASE_ORDER_DRAFT', orderDraft(f)); const foreign = await fixture();
    await expect(getAssistantAction(foreign.principal, proposal.id)).rejects.toMatchObject({code: 'ACTION_NOT_FOUND'});
    const other = await prisma.user.create({data: {tenantId: f.principal.tenantId, role: 'OWNER', name: 'Otro dueño QA', password: 'synthetic-no-login'}});
    await expect(confirmAssistantAction({...f.principal, userId: other.id}, proposal.id, proposal.version, randomUUID())).rejects.toMatchObject({code: 'ACTION_NOT_FOUND'});
    await prisma.user.updateMany({where: {id: f.principal.userId, tenantId: f.principal.tenantId}, data: {status: 'DISABLED'}});
    await expect(confirmAssistantAction(f.principal, proposal.id, proposal.version, randomUUID())).rejects.toThrow();
    expect((await effects(f)).commands).toBe(0);
  });

  it('revalida el usuario dentro de la transacción después del primer control de acceso', async () => {
    const f = await fixture(); const proposal = await ready(f, 'PURCHASE_ORDER_DRAFT', orderDraft(f));
    const intercepted = new Proxy(prisma, {get(target, field) {
      if (field === '$transaction') return async (run: any, options: any) => {
        await prisma.user.updateMany({where: {tenantId: f.principal.tenantId, id: f.principal.userId}, data: {status: 'DISABLED'}});
        return prisma.$transaction(run, options);
      };
      const value = Reflect.get(target, field); return typeof value === 'function' ? value.bind(target) : value;
    }});
    await expect(confirmAssistantAction(f.principal, proposal.id, proposal.version, randomUUID(), intercepted)).rejects.toMatchObject({code: 'ACTION_SESSION_REVOKED'});
    expect((await effects(f))).toMatchObject({orders: 0, commands: 0});
  });

  it('la misma clave concurrente entre dos usuarios no crea dos efectos ni devuelve un comprobante ajeno', async () => {
    const f = await fixture(); const first = await ready(f, 'PURCHASE_ORDER_DRAFT', orderDraft(f));
    const user = await prisma.user.create({data: {tenantId: f.principal.tenantId, role: 'MANAGER', name: 'Gerente QA', password: 'synthetic-no-login'}});
    const manager = {...f, principal: {...f.principal, userId: user.id, role: user.role}};
    const second = await ready(manager, 'PURCHASE_ORDER_DRAFT', orderDraft(f)); const requestKey = randomUUID();
    const settled = await Promise.allSettled([
      confirmAssistantAction(f.principal, first.id, first.version, requestKey),
      confirmAssistantAction(manager.principal, second.id, second.version, requestKey),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = settled.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({code: 'ACTION_IDEMPOTENCY_CONFLICT'});
    expect((await effects(f))).toMatchObject({orders: 1, commands: 1});
  }, 20_000);

  it('devolución física desde compra directa conserva deuda y contabilización de la compra', async () => {
    const f = await fixture({tracked: false, stock: 0});
    const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Managua'});
    const dueDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const purchase = await registerPurchase({principal: f.principal, idempotencyKey: randomUUID(), input: {supplierId: f.supplier.id, warehouseId: f.warehouse.id, invoiceNumber: randomUUID(), date: today, postingDate: today, dueDate, paymentMethod: 'CREDIT', items: [{productId: f.product.id, quantity: '10', unitCost: '12.34', purchaseUnit: 'BASE'}]}});
    const line = await prisma.purchaseItem.findFirstOrThrow({where: {purchaseId: purchase.purchase.id}, select: {id: true}});
    const body = {supplierId: f.supplier.id, reasonCode: 'DAMAGE', reason: 'Entrega física de producto dañado', physicalShipmentConfirmed: true, lines: [{sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: line.id, quantity: '1.25'}]};
    const proposal = await ready(f, 'SUPPLIER_RETURN', body); const before = await effects(f);
    const balanceBefore = await prisma.purchase.findFirstOrThrow({where: {id: purchase.purchase.id, tenantId: f.principal.tenantId}, select: {balanceDue: true}});
    const result = await confirmAssistantAction(f.principal, proposal.id, proposal.version, randomUUID());
    expect((await effects(f))).toEqual({...before, product: {...before.product, stock: 8.75}, local: {stock: 8.75}, returns: 1, kardex: before.kardex + 1, commands: 1});
    expect(await prisma.purchase.findFirstOrThrow({where: {id: purchase.purchase.id, tenantId: f.principal.tenantId}, select: {balanceDue: true}})).toEqual(balanceBefore);
    expect(await prisma.supplierCreditNote.count({where: {tenantId: f.principal.tenantId}})).toBe(0);
    expect((await getAssistantAction(f.principal, proposal.id)).result?.resourceId).toBe(result.resourceId);
  }, 20_000);
});
