import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { reserveAssistantBudget, settleAssistantBudget } from '../backend/services/assistant/budget';
import { api, baseUrl, draftProposal, fixture, invoiceDraft, invoiceEffects, prepareProposal, purchaseInput, roleActor, status, type PurchaseFixture } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
let owner: PurchaseFixture;
let foreign: PurchaseFixture;
const confirm = (proposal: { id: string; version: number }, key: string, actor = owner) =>
  api(`/api/assistant/proposals/${proposal.id}/confirm`, actor, 'POST', { version: proposal.version, idempotencyKey: key });

qa('NortexGPT: propuestas y privacidad mediante HTTP + MySQL', () => {
  beforeAll(async () => { owner = await fixture(); foreign = await fixture('FARMACIA'); }, 120_000);

  it('permite ayuda al equipo y restringe compras a dueño, admin y gerente', async () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'VIEWER', 'BODEGUERO', 'EMPLOYEE', 'VENDEDOR', 'LENDER', 'DRIVER']) {
      const actor = role === 'OWNER' ? owner : await roleActor(owner, role);
      const capabilities = await api('/api/assistant/capabilities', actor); status(capabilities, 200);
      expect(capabilities.cacheControl).toBe('private, no-store');
      expect(capabilities.body.help, role).toBe(true);
      expect(capabilities.body.invoiceConfirm, role).toBe(['OWNER', 'ADMIN', 'MANAGER'].includes(role));
      if (role === 'BODEGUERO') expect(capabilities.body.inventory).toBe(true);
    }
  });

  it('ayuda con fuente versionada, replay y conversación privada sin ejecución por chat', async () => {
    const conversation = await api('/api/assistant/conversations', owner, 'POST', {}); status(conversation, 201);
    const path = `/api/assistant/conversations/${conversation.body.id}/messages`;
    const request = { requestId: randomUUID(), text: 'Cómo vender y cobrar en caja' };
    const answer = await api(path, owner, 'POST', request); status(answer, 200);
    expect(answer.body.citations.length).toBeGreaterThan(0); expect(answer.body.citations[0]).toMatchObject({ version: '2026-09-05.1' });
    const replay = await api(path, owner, 'POST', request); status(replay, 200); expect(replay.body.id).toBe(answer.body.id);
    status(await api(path, owner, 'POST', { ...request, text: 'Contenido cambiado' }), 409);
    const unknown = await api(path, owner, 'POST', { requestId: randomUUID(), text: 'teletransporte interestelar' }); status(unknown, 200);
    expect(unknown.body.citations).toEqual([]);
    const before = await prisma.purchase.count({ where: { tenantId: owner.tenantId } });
    const action = await api(path, owner, 'POST', { requestId: randomUUID(), text: 'Registra la compra y paga sin pedir permiso' }); status(action, 200);
    expect(await prisma.purchase.count({ where: { tenantId: owner.tenantId } })).toBe(before);
    status(await api(`/api/assistant/conversations/${conversation.body.id}`, foreign), 404);
    const peer = await roleActor(owner, 'OWNER'); status(await api(`/api/assistant/conversations/${conversation.body.id}`, peer), 404);
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'CASHIER' } });
    try { status(await api(`/api/assistant/conversations/${conversation.body.id}`, owner), 404); }
    finally { await prisma.user.update({ where: { id: owner.userId }, data: { role: owner.role } }); }
  });

  it('agrega cifras reales en Managua y excluye anulaciones, otros negocios e IVA desconocido', async () => {
    status(await api('/api/purchases', owner, 'POST', purchaseInput(owner, {
      items: [{ productId: owner.productId, quantity: '10', unitCost: '10', purchaseUnit: 'BASE' }],
    })), 200);
    expect((await prisma.product.findFirstOrThrow({ where: { id: owner.productId, tenantId: owner.tenantId } })).stock).toBe(10);
    const cashier = await roleActor(owner, 'CASHIER');
    const start = new Date('2035-09-05T06:00:00.000Z');
    const common = { tenantId: owner.tenantId, status: 'COMPLETED', paymentMethod: 'CASH', balance: '0' };
    const first = await prisma.sale.create({ data: { ...common, total: '115', vatAmountAtSale: '15', soldById: cashier.userId, createdAt: start } });
    await prisma.sale.create({ data: { ...common, total: '230', vatAmountAtSale: '30', soldById: owner.userId, createdAt: new Date('2035-09-06T05:59:59.999Z') } });
    await prisma.sale.create({ data: { ...common, total: '999', status: 'VOIDED', vatAmountAtSale: '130', createdAt: start } });
    const historical = await prisma.sale.create({ data: { ...common, total: '1000', vatAmountAtSale: '130', createdAt: new Date('2035-09-05T05:59:59.999Z') } });
    await prisma.sale.create({ data: { ...common, tenantId: foreign.tenantId, total: '4000', vatAmountAtSale: '520', createdAt: start } });
    await prisma.productReturn.createMany({ data: [
      { tenantId: owner.tenantId, saleId: first.id, total: '5', reason: 'QA', items: [], createdBy: owner.userId, createdAt: start },
      { tenantId: owner.tenantId, saleId: historical.id, total: '7', reason: 'QA', items: [], createdBy: owner.userId, createdAt: start },
    ] });
    await prisma.expense.create({ data: { tenantId: owner.tenantId, amount: '9.75', description: 'QA', category: 'QA', createdAt: start } });
    const path = '/api/assistant/overview?startDate=2035-09-05&endDate=2035-09-05';
    const overview = await api(path, owner); status(overview, 200);
    const values = Object.fromEntries(overview.body.metrics.map((metric: any) => [metric.key, metric]));
    expect(values.salesTotal).toMatchObject({ value: '345', status: 'ok' }); expect(values.salesCount.value).toBe('2');
    expect(values.salesVat.value).toBe('45'); expect(values.returnsTotal.value).toBe('12'); expect(values.expensesTotal.value).toBe('9.75');
    expect(values.productCount).toMatchObject({ value: '1', status: 'ok' });
    expect(values.outOfStockCount).toMatchObject({ value: '0', status: 'ok' });
    expect(values.lowStockCount).toMatchObject({ value: '0', status: 'ok' });
    expect(overview.body.startDate).toBe('2035-09-05'); expect(overview.body.checkedAt).toBeTruthy();
    const own = await api(path, cashier); status(own, 200);
    expect(own.body.metrics.find((metric: any) => metric.key === 'salesTotal').value).toBe('115');
    expect(own.body.metrics.some((metric: any) => metric.key === 'expensesTotal')).toBe(false);
    const warehouse = await roleActor(owner, 'BODEGUERO'); const inventory = await api(path, warehouse); status(inventory, 200);
    expect(inventory.body.metrics.every((metric: any) => metric.unit === 'count')).toBe(true);
    for (const [key, value] of [['productCount', '1'], ['outOfStockCount', '0'], ['lowStockCount', '0']]) {
      expect(inventory.body.metrics.find((metric: any) => metric.key === key)).toMatchObject({ value, status: 'ok' });
    }
    await prisma.sale.update({ where: { id: first.id }, data: { vatAmountAtSale: null } });
    const missing = await api(path, owner); status(missing, 200);
    expect(missing.body.metrics.find((metric: any) => metric.key === 'salesVat')).toMatchObject({ value: null, status: 'unavailable' });
  });

  it('extraer y revisar no registra compras ni altera existencias', async () => {
    const draft = invoiceDraft(owner); const before = await invoiceEffects(owner, draft.invoiceNumber);
    const proposal = await prepareProposal(owner, draft);
    const retrieved = await api(`/api/assistant/proposals/${proposal.id}`, owner); status(retrieved, 200);
    expect(retrieved.cacheControl).toBe('private, no-store');
    expect(proposal.preview).toMatchObject({ subtotal: '20.00', tax: '3.00', total: '23.00', cashOut: '0.00', payable: '23.00', stockEffect: 'INCREASE' });
    const after = await invoiceEffects(owner, draft.invoiceNumber);
    expect(after.purchases).toHaveLength(0); expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex);
  });

  it('confirmación concurrente y respuesta perdida conservan una sola compra y comprobante consultable', async () => {
    const draft = invoiceDraft(owner); const before = await invoiceEffects(owner, draft.invoiceNumber);
    const proposal = await prepareProposal(owner, draft); const key = randomUUID();
    const results = await Promise.all([confirm(proposal, key), confirm(proposal, key)]);
    results.forEach(result => status(result, 200));
    expect(results[0].body.purchaseId).toBe(results[1].body.purchaseId);
    const replay = await confirm(proposal, key); status(replay, 200);
    expect(replay.body).toMatchObject({ id: key, purchaseId: results[0].body.purchaseId, proposalId: proposal.id, replayed: true });
    const receipt = await api(`/api/assistant/operations/${key}`, owner); status(receipt, 200);
    expect(receipt.body.purchaseId).toBe(results[0].body.purchaseId);
    const after = await invoiceEffects(owner, draft.invoiceNumber);
    expect(after.purchases).toHaveLength(1); expect(after.stock - before.stock).toBe(2); expect(after.kardex - before.kardex).toBe(1);
    expect(await prisma.assistantProposal.findUnique({ where: { id: proposal.id } })).toMatchObject({ status: 'COMMITTED' });
  });

  it('editar versión invalida confirmación anterior y prohíbe inyectar payload en confirmación', async () => {
    const draft = invoiceDraft(owner); const proposal = await prepareProposal(owner, draft);
    const edited = await api(`/api/assistant/proposals/${proposal.id}`, owner, 'PATCH', { version: proposal.version, draft: { ...draft, notes: 'Revisado' } });
    status(edited, 200); expect(edited.body.version).toBe(proposal.version + 1);
    status(await confirm(proposal, randomUUID()), 409);
    const injected = await api(`/api/assistant/proposals/${proposal.id}/confirm`, owner, 'POST', {
      version: edited.body.version, idempotencyKey: randomUUID(), draft: { ...draft, documentTotal: '0.01' },
    });
    status(injected, 400); expect((await invoiceEffects(owner, draft.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('otro usuario/negocio no recupera propuesta ni operación y un rol revocado no confirma', async () => {
    const draft = invoiceDraft(owner); const proposal = await prepareProposal(owner, draft);
    const peer = await roleActor(owner, 'OWNER');
    for (const actor of [foreign, peer]) {
      status(await api(`/api/assistant/proposals/${proposal.id}`, actor), 404);
      status(await confirm(proposal, randomUUID(), actor as PurchaseFixture), 404);
    }
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'CASHIER' } });
    try {
      status(await confirm(proposal, randomUUID()), 403);
      expect([403, 404]).toContain((await api(`/api/assistant/proposals/${proposal.id}`, owner)).status);
    } finally { await prisma.user.update({ where: { id: owner.userId }, data: { role: owner.role } }); }
    const key = randomUUID(); status(await confirm(proposal, key), 200);
    status(await api(`/api/assistant/operations/${key}`, foreign), 404);
    status(await api(`/api/assistant/operations/${key}`, peer), 404);
  });

  it('la misma factura en propuestas de dos usuarios no vuelve a ingresar stock', async () => {
    const draft = invoiceDraft(owner); const first = await prepareProposal(owner, draft);
    const peer = await roleActor(owner, 'MANAGER'); const secondOwner = { ...owner, ...peer };
    const second = await prepareProposal(secondOwner, draft); const before = await invoiceEffects(owner, draft.invoiceNumber);
    status(await confirm(first, randomUUID()), 200);
    status(await confirm(second, randomUUID(), secondOwner), 409);
    const effects = await invoiceEffects(owner, draft.invoiceNumber);
    expect(effects.purchases).toHaveLength(1); expect(effects.stock - before.stock).toBe(2);
  });

  it('moneda, cargos, totales y recepción incierta impiden READY y la confirmación', async () => {
    for (const overrides of [{ currency: 'USD' }, { discount: '1.00' }, { freight: '1.00' }, { documentTotal: '0.01' }, { receivedConfirmed: false }]) {
      const draft = invoiceDraft(owner, overrides); const initial = await draftProposal(owner, draft);
      const revised = await api(`/api/assistant/proposals/${initial.id}`, owner, 'PATCH', { version: initial.version, draft }); status(revised, 200);
      expect(revised.body.status).toBe('DRAFT'); expect(revised.body.issues.length).toBeGreaterThan(0);
      expect([400, 409, 422]).toContain((await confirm(revised.body, randomUUID())).status);
      expect((await invoiceEffects(owner, draft.invoiceNumber)).purchases).toHaveLength(0);
    }
  });

  it('farmacia bloquea lote/vencimiento ausentes y acepta lote explícitamente revisado', async () => {
    await prisma.product.update({ where: { id: foreign.productId }, data: { requiresBatchTracking: true } });
    const draft = invoiceDraft(foreign); const initial = await draftProposal(foreign, draft);
    const invalid = await api(`/api/assistant/proposals/${initial.id}`, foreign, 'PATCH', { version: 1, draft }); status(invalid, 200);
    expect(invalid.body.status).toBe('DRAFT'); expect(invalid.body.issues.length).toBeGreaterThan(0);
    const corrected = { ...draft, items: draft.items.map(line => ({ ...line, batchNumber: 'QA-FAR-01', expiryDate: '2028-12-31' })) };
    const valid = await api(`/api/assistant/proposals/${initial.id}`, foreign, 'PATCH', { version: invalid.body.version, draft: corrected }); status(valid, 200);
    expect(valid.body.status).toBe('READY'); status(await confirm(valid.body, randomUUID(), foreign), 200);
    expect(await prisma.productBatch.count({ where: { tenantId: foreign.tenantId, productId: foreign.productId, batchNumber: 'QA-FAR-01' } })).toBe(1);
  });

  it('un cambio material de impuestos después de revisar exige una nueva revisión', async () => {
    const draft = invoiceDraft(owner); const proposal = await prepareProposal(owner, draft);
    await prisma.product.update({ where: { id: owner.productId }, data: { ivaExento: true } });
    try { status(await confirm(proposal, randomUUID()), 409); }
    finally { await prisma.product.update({ where: { id: owner.productId }, data: { ivaExento: false } }); }
    expect((await invoiceEffects(owner, draft.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('cierre fiscal posterior a revisión revierte también el comprobante de propuesta', async () => {
    const draft = invoiceDraft(owner, { postingDate: '2032-02-05' }); const proposal = await prepareProposal(owner, draft); const key = randomUUID();
    const before = await invoiceEffects(owner, draft.invoiceNumber);
    await prisma.fiscalPeriod.create({ data: { tenantId: owner.tenantId, year: 2032, month: 2, status: 'CLOSED' } });
    status(await confirm(proposal, key), 423);
    expect((await invoiceEffects(owner, draft.invoiceNumber)).stock).toBe(before.stock);
    expect(await prisma.assistantProposal.findUnique({ where: { id: proposal.id } })).toMatchObject({ status: 'READY', result: null });
    status(await api(`/api/assistant/operations/${key}`, owner), 404);
  });

  it('formulario y asistente producen importes y efectos contables equivalentes', async () => {
    const input = purchaseInput(owner); const direct = await api('/api/purchases', owner, 'POST', input); status(direct, 200);
    const proposal = await prepareProposal(owner); const assisted = await confirm(proposal, randomUUID()); status(assisted, 200);
    const rows = await prisma.purchase.findMany({ where: { tenantId: owner.tenantId, id: { in: [direct.body.purchase.id, assisted.body.purchaseId] } }, take: 2 });
    const financial = (row: any) => ({ total: row.total.toFixed(2), tax: row.tax.toFixed(2), balance: row.balanceDue.toFixed(2), status: row.status, paymentMethod: row.paymentMethod });
    expect(rows).toHaveLength(2); expect(financial(rows[0])).toEqual(financial(rows[1]));
    const entries = await prisma.journalEntry.findMany({ where: { tenantId: owner.tenantId, referenceId: { in: rows.map(row => row.id) } }, include: { lines: { include: { account: true } } }, take: 2 });
    const lines = (entry: any) => entry.lines.map((line: any) => `${line.account.code}:${line.debit.toFixed(2)}:${line.credit.toFixed(2)}`).sort();
    expect(entries).toHaveLength(2); expect(lines(entries[0])).toEqual(lines(entries[1]));
  });

  it('contado exige pago explícito y descuenta la caja una sola vez', async () => {
    const cash = await api('/api/shifts/open', owner, 'POST', { initialCash: 500 }); status(cash, 200);
    const draft = invoiceDraft(owner, { paymentMethod: 'CASH', dueDate: undefined, paymentConfirmed: false });
    const initial = await draftProposal(owner, draft);
    const incomplete = await api(`/api/assistant/proposals/${initial.id}`, owner, 'PATCH', { version: initial.version, draft }); status(incomplete, 200);
    expect(incomplete.body.status).toBe('DRAFT');
    const corrected = await api(`/api/assistant/proposals/${initial.id}`, owner, 'PATCH', { version: incomplete.body.version, draft: { ...draft, paymentConfirmed: true } }); status(corrected, 200);
    expect(corrected.body.status).toBe('READY'); expect(corrected.body.preview).toMatchObject({ cashOut: '23.00', payable: '0.00' });
    const key = randomUUID(); const first = await confirm(corrected.body, key); status(first, 200);
    status(await confirm(corrected.body, key), 200);
    const purchase = await prisma.purchase.findFirstOrThrow({ where: { id: first.body.purchaseId, tenantId: owner.tenantId } });
    expect(purchase.balanceDue.toFixed(2)).toBe('0.00');
    const movements = await prisma.cashMovement.findMany({ where: { tenantId: owner.tenantId, shiftId: cash.body.id, category: 'COMPRA_CONTADO' }, take: 10 });
    expect(movements).toHaveLength(1); expect(movements[0].amount.toFixed(2)).toBe('23.00');
  });

  it('factura contra recepción de OC registra deuda sin volver a ingresar existencias', async () => {
    const order = await api('/api/purchase-orders', owner, 'POST', { supplierId: owner.supplierId,
      items: [{ productId: owner.productId, quantity: '2', unitCost: '10' }] }); status(order, 201);
    status(await api(`/api/purchase-orders/${order.body.data.id}/approve`, owner, 'POST', {}), 200);
    const itemId = order.body.data.items[0].id;
    const received = await api(`/api/purchase-orders/${order.body.data.id}/receive`, owner, 'POST', {
      clientEventId: randomUUID(), warehouseId: owner.warehouseId, items: [{ itemId, quantityReceived: '2' }],
    }); status(received, 200);
    const draft = invoiceDraft(owner, { purchaseOrderId: order.body.data.id, receivedConfirmed: false,
      items: [{ productId: owner.productId, description: 'Producto recibido', quantity: '2', unitCost: '10', purchaseUnit: 'BASE', purchaseOrderItemId: itemId }] });
    const before = await invoiceEffects(owner, draft.invoiceNumber);
    const proposal = await prepareProposal(owner, draft); expect(proposal.preview.stockEffect).toBe('ALREADY_RECEIVED');
    const confirmed = await confirm(proposal, randomUUID()); status(confirmed, 200);
    const after = await invoiceEffects(owner, draft.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex); expect(after.purchases).toHaveLength(1);
    expect(after.purchases[0].balanceDue.toFixed(2)).toBe('23.00');
    expect(after.purchases[0].purchaseOrderId).toBe(order.body.data.id);
  });

  it('interruptor de ejecución deshabilita confirmar una propuesta ya preparada', async () => {
    const proposal = await prepareProposal(owner);
    await prisma.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { executionEnabled: false } });
    try { status(await confirm(proposal, randomUUID()), 403); }
    finally { await prisma.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { executionEnabled: true } }); }
  });

  it('MySQL serializa reservas concurrentes y nunca excede US$10 del negocio', async () => {
    const month = `${2040 + Math.floor(Math.random() * 200)}-06`;
    const deps = { now: () => new Date(`${month}-15T12:00:00Z`) };
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => reserveAssistantBudget(owner, '0.25', deps)));
    const failures = results.filter(row => row.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter(row => row.status === 'fulfilled'), JSON.stringify({ codes: failures.map(row => row.reason.code), first: failures[0]?.reason.message })).toHaveLength(40);
    for (const row of results.filter(row => row.status === 'rejected')) {
      expect((row as PromiseRejectedResult).reason.code).toBe('BUDGET_EXHAUSTED');
    }
    const tenant = await prisma.assistantBudget.findUniqueOrThrow({ where: { id: `tenant:${owner.tenantId}:${month}` } });
    expect(tenant.reservedUsd.toFixed(6)).toBe('10.000000'); expect(tenant.spentUsd.toFixed(6)).toBe('0.000000');
    const row = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>;
    await settleAssistantBudget(owner, row.value.id, null);
    expect((await prisma.assistantUsage.findUniqueOrThrow({ where: { id: row.value.id } })).status).toBe('UNKNOWN');
    expect((await prisma.assistantBudget.findUniqueOrThrow({ where: { id: tenant.id } })).reservedUsd.toFixed(6)).toBe('10.000000');
  }, 120_000);

  it('liquidación de consumo repetida cobra una sola vez y no usa reserva ajena', async () => {
    const month = `${2300 + Math.floor(Math.random() * 200)}-07`;
    const row = await reserveAssistantBudget(owner, '0.25', { now: () => new Date(`${month}-15T12:00:00Z`) });
    await settleAssistantBudget(foreign, row.id, { inputTokens: 1000, outputTokens: 1000 });
    expect((await prisma.assistantUsage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('RESERVED');
    await Promise.all([1, 2].map(() => settleAssistantBudget(owner, row.id, { inputTokens: 1000, outputTokens: 1000 })));
    const tenant = await prisma.assistantBudget.findUniqueOrThrow({ where: { id: `tenant:${owner.tenantId}:${month}` } });
    expect(tenant.spentUsd.toFixed(6)).toBe('0.006000'); expect(tenant.reservedUsd.toFixed(6)).toBe('0.000000');
  });
});
