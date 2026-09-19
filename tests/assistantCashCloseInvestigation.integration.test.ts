// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { buildShiftCloseReport, hashShiftCloseReport, type BuildShiftCloseReportInput } from '../backend/lib/shiftCloseReport';
import { closeShiftWithReport } from '../backend/services/shiftCloseService';
import { inspectCashClose } from '../backend/services/assistant/operations/cashCloseInvestigation';
import { createOperationTools } from '../backend/services/assistant/operations/tools';
import { cashCloseInvestigationMessage } from '../shared/assistantCashCloseInvestigation';
import { api, assertDisposableDatabase, baseUrl, roleActor, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const closedAt = new Date('2026-09-06T06:15:00.000Z');
const openedAt = new Date('2026-09-05T22:00:00.000Z');
const now = new Date('2026-09-08T18:00:00.000Z');
const deps = { db: prisma, now: () => now };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function actorFixture(role = 'OWNER') {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA investigación de cierre', taxId: `QA-${randomUUID()}`, type: 'FERRETERIA' } });
  const actor = await roleActor({ tenantId: tenant.id, userId: '', role: '', token: '' }, role);
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, operationsEnabled: true } });
  return actor;
}

async function savedClose(actor: TestActor, options: { state?: 'OPEN' | 'CLOSED'; missing?: boolean;
  cash?: Partial<BuildShiftCloseReportInput['cash']>; movements?: BuildShiftCloseReportInput['movements']; payments?: BuildShiftCloseReportInput['payments'];
} = {}) {
  const cash: BuildShiftCloseReportInput['cash'] = { openingNio: '100', expectedNio: '125', countedNio: '120', differenceNio: '-5',
    openingUsd: '10.1234', expectedUsd: '10.1234', countedUsd: '10.1235', differenceUsd: '0.0001', cashRefundsNio: '0', ...options.cash };
  const shift = await prisma.shift.create({ data: { tenantId: actor.tenantId, userId: actor.userId, status: options.state ?? 'CLOSED',
    startTime: openedAt, endTime: options.state === 'OPEN' ? null : closedAt, initialCash: String(cash.openingNio),
    finalCashDeclared: String(cash.countedNio), systemExpectedCash: String(cash.expectedNio), difference: String(cash.differenceNio),
    initialCashUsd: String(cash.openingUsd), finalCashDeclaredUsd: String(cash.countedUsd), systemExpectedUsd: String(cash.expectedUsd), differenceUsd: String(cash.differenceUsd) } });
  const report = buildShiftCloseReport({ folio: `Z-QA-${randomUUID()}`, businessDate: '2026-09-06', generatedAt: closedAt,
    business: { name: 'QA sintético', taxId: 'QA-SYNTHETIC', address: null, phone: null },
    shift: { id: shift.id, openedAt, closedAt, openedBy: 'QA', cashierName: 'QA', closedBy: 'QA', auditNotes: 'QA_NOTA_PRIVADA_NO_ENVIAR_AL_MODELO' },
    payments: options.payments ?? [], movements: options.movements ?? [{ type: 'IN', currency: 'NIO', category: 'CAMBIO', count: 1, amount: '25' }],
    soldProducts: [], returnedProducts: [], returns: { count: 0, total: '0', vat: '0', cogs: '0' }, fiscal: { vatCollectedBeforeReturns: '0', discountTotal: '0' }, cash });
  const stored = options.missing || options.state === 'OPEN' ? null : await prisma.shiftCloseReport.create({ data: { tenantId: actor.tenantId,
    shiftId: shift.id, folio: report.folio, businessDate: report.businessDate, version: report.version, report: asJson(report),
    contentHash: hashShiftCloseReport(report), createdBy: actor.userId, createdAt: closedAt } });
  return { shift, report, stored };
}
type Saved = Awaited<ReturnType<typeof savedClose>>;
const reference = (saved: Saved) => ({ shiftId: saved.shift.id, ...(saved.stored ? { reportHash: saved.stored.contentHash } : {}) });
async function movement(actor: TestActor, shiftId: string, extra: Partial<Prisma.CashMovementUncheckedCreateInput> = {}) {
  return prisma.cashMovement.create({ data: { tenantId: actor.tenantId, userId: actor.userId, shiftId,
    type: 'OUT', currency: 'NIO', amount: '3.25', category: 'GASTO', description: 'QA_TEXTO_PRIVADO_INSTRUCCION_IGNORAR_PERMISOS',
    createdAt: new Date('2026-09-07T18:00:00Z'), ...extra } });
}
async function businessState(actor: TestActor) {
  const where = { tenantId: actor.tenantId }, orderBy = { id: 'asc' as const };
  return Promise.all([
    prisma.shift.findMany({ where, orderBy }), prisma.shiftCloseReport.findMany({ where, orderBy }),
    prisma.cashMovement.findMany({ where, orderBy }), prisma.auditLog.findMany({ where, orderBy }),
    prisma.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }), prisma.account.findMany({ where, orderBy }),
    prisma.product.findMany({ where, orderBy }), prisma.kardexMovement.findMany({ where, orderBy }),
    prisma.sale.findMany({ where, orderBy }), prisma.purchase.findMany({ where, orderBy }),
  ]);
}
async function noAssistantEffects(actor: TestActor) {
  const where = { tenantId: actor.tenantId };
  expect(await Promise.all([prisma.assistantUsage.count({ where }), prisma.assistantProposal.count({ where }),
    prisma.assistantActionProposal.count({ where }), prisma.assistantAttachment.count({ where })])).toEqual([0, 0, 0, 0]);
}
async function replaceReport(saved: Saved, mutate: (report: typeof saved.report) => void, resign = true) {
  const changed = structuredClone(saved.report); mutate(changed);
  return prisma.shiftCloseReport.update({ where: { id: saved.stored!.id }, data: { report: asJson(changed),
    ...(resign ? { contentHash: hashShiftCloseReport(changed) } : {}) } });
}

qa('W01B investigar un cierre: evidencia privada HTTP/MySQL sin efectos', () => {
  beforeAll(() => { assertDisposableDatabase(); });

  it('el índice de movimientos conserva datos previos y permite dos db push sucesivos', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor); await movement(actor, saved.shift.id);
    const before = await businessState(actor);
    await prisma.$executeRaw`DROP INDEX CashMovement_tenantId_shiftId_createdAt_id_idx ON CashMovement`;
    const push = () => spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', 'backend/prisma/schema.prisma'], {
      env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 120000,
    });
    try {
      expect(push().status).toBe(0); expect(push().status).toBe(0);
      const index = await prisma.$queryRaw<Array<{ COLUMN_NAME: string }>>`SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CashMovement' AND INDEX_NAME='CashMovement_tenantId_shiftId_createdAt_id_idx' ORDER BY SEQ_IN_INDEX`;
      expect(index.map(row => row.COLUMN_NAME)).toEqual(['tenantId', 'shiftId', 'createdAt', 'id']);
      expect(await businessState(actor)).toEqual(before);
    } finally {
      const found = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CashMovement' AND INDEX_NAME='CashMovement_tenantId_shiftId_createdAt_id_idx'`;
      if (Number(found[0].n) === 0) await prisma.$executeRaw`CREATE INDEX CashMovement_tenantId_shiftId_createdAt_id_idx ON CashMovement (tenantId,shiftId,createdAt,id)`;
    }
  }, 180000);

  it('separa snapshot histórico de movimientos actuales y excluye textos libres privados', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    const current = await movement(actor, saved.shift.id, { isVoided: true, voidedAt: now, voidReason: 'QA_MOTIVO_PRIVADO_NO_ENVIAR' });
    const result = await inspectCashClose(actor, reference(saved), deps);
    expect(result).toMatchObject({ kind: 'CASH_CLOSE_INVESTIGATION', status: 'ok', checkedAt: now.toISOString(), scope: 'business',
      shift: { id: saved.shift.id, openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString(), businessDate: '2026-09-06', folio: saved.report.folio },
      snapshot: { source: { id: saved.stored!.id, version: 1, contentHash: saved.stored!.contentHash }, cash: {
        expectedNio: '125.00', countedNio: '120.00', differenceNio: '-5.00', openingNio: '100.00', paidInNio: '25.00', paidOutNio: '0.00',
        openingUsd: '10.1234', expectedUsd: '10.1234', countedUsd: '10.1235', differenceUsd: '0.0001',
      } }, currentMovements: { status: 'available', rows: [{ id: current.id, amount: '3.25', isVoided: true, voidedAt: now.toISOString() }] } });
    expect(result.snapshot!.movements).toEqual([{ type: 'IN', currency: 'NIO', category: 'CAMBIO', count: 1, amount: '25.00' }]);
    expect(Object.keys(result.currentMovements.rows[0]).sort()).toEqual(['id', 'type', 'currency', 'category', 'amount', 'createdAt', 'isVoided', 'voidedAt', 'expenseId'].sort());
    expect(JSON.stringify(result)).not.toMatch(/QA_TEXTO_PRIVADO|QA_NOTA_PRIVADA|QA_MOTIVO_PRIVADO/);
    expect(result.pendingChecks.length).toBeGreaterThan(0); expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('cierre real con crédito de tienda conserva venta bruta distinta del efectivo recibido', async () => {
    const actor = await actorFixture();
    const shift = await prisma.shift.create({ data: { tenantId: actor.tenantId, userId: actor.userId, status: 'OPEN', initialCash: '100', startTime: openedAt } });
    await prisma.sale.create({ data: { tenantId: actor.tenantId, shiftId: shift.id, soldById: actor.userId, status: 'COMPLETED',
      paymentMethod: 'CASH', total: '100', storeCreditApplied: '40', vatAmountAtSale: '0', createdAt: openedAt } });
    await closeShiftWithReport({ ...actor, shiftId: shift.id, declaredCash: '160', declaredCashUsd: '0', clientEventId: randomUUID() }, prisma, () => closedAt);
    const before = await businessState(actor), result = await inspectCashClose(actor, { shiftId: shift.id }, deps);
    expect(result.status).toBe('ok');
    expect(result.snapshot!.cash).toMatchObject({ openingNio: '100.00', grossCashSalesNio: '100.00', expectedNio: '160.00', countedNio: '160.00', differenceNio: '0.00' });
    expect(result.snapshot!.payments).toContainEqual({ method: 'CASH', transactionCount: 1, grossSalesNio: '100.00' });
    expect(await businessState(actor)).toEqual(before); await noAssistantEffects(actor);
  });

  it('referencias Expense y movimientos inconsistentes de otro tenant no filtran datos ajenos', async () => {
    const actor = await actorFixture(), foreign = await actorFixture(), saved = await savedClose(actor);
    const expense = await prisma.expense.create({ data: { tenantId: foreign.tenantId, amount: '99', description: 'QA_GASTO_AJENO_PRIVADO', category: 'QA' } });
    const own = await movement(actor, saved.shift.id, { expenseId: expense.id, currency: 'USD', amount: '1.23', category: 'QA_CATEGORIA_PRIVADA' });
    const foreignMovement = await movement(foreign, saved.shift.id);
    const result = await inspectCashClose(actor, reference(saved), deps);
    expect(result.currentMovements.rows).toHaveLength(1);
    expect(result.currentMovements.rows[0]).toMatchObject({ id: own.id, expenseId: null, currency: 'USD', amount: '1.2300', category: 'OTRA_CATEGORIA' });
    expect(JSON.stringify(result)).not.toContain(expense.id); expect(JSON.stringify(result)).not.toContain(foreignMovement.id);
    expect(JSON.stringify(result)).not.toMatch(/QA_GASTO_AJENO_PRIVADO|QA_CATEGORIA_PRIVADA/);
  });

  it('moneda inválida en movimientos actuales no se oculta como lista vacía disponible', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    await movement(actor, saved.shift.id, { currency: 'EUR' });
    const result = await inspectCashClose(actor, reference(saved), deps);
    expect(result).toMatchObject({ status: 'partial', currentMovements: { status: 'unavailable', rows: [] } });
    expect(result.snapshot!.cash.differenceNio).toBe('-5.00');
    expect(result.pendingChecks.some(check => check.code === 'CURRENT_MOVEMENTS_INCOMPLETE')).toBe(true);
  });

  it('otro negocio o identificador inexistente devuelve 404 sin datos ni diferencias de acceso', async () => {
    const a = await actorFixture(), b = await actorFixture(), saved = await savedClose(b);
    for (const shiftId of [saved.shift.id, randomUUID()]) await expect(inspectCashClose(a, { shiftId }, deps)).rejects.toMatchObject({ statusCode: 404 });
    await noAssistantEffects(a);
  });

  it.each(['CASHIER', 'EMPLOYEE', 'VENDEDOR'])('%s ve su turno; soldById no permite investigar caja de otro usuario', async role => {
    const owner = await actorFixture(), actor = await roleActor(owner, role), own = await savedClose(actor), other = await savedClose(owner);
    await prisma.sale.create({ data: { tenantId: owner.tenantId, shiftId: other.shift.id, soldById: actor.userId, total: '1', status: 'COMPLETED', paymentMethod: 'CASH' } });
    expect((await inspectCashClose(actor, reference(own), deps)).scope).toBe('own-shifts');
    await expect(inspectCashClose(actor, reference(other), deps)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('roles administrativos de reporte conservan acceso a cajas de otro usuario del negocio', async () => {
    const owner = await actorFixture(), saved = await savedClose(owner);
    for (const role of ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER']) {
      const actor = await roleActor(owner, role);
      expect((await inspectCashClose(actor, reference(saved), deps)).scope).toBe('business');
    }
  });

  it('bodega no recibe importes ni la herramienta de investigación', async () => {
    const owner = await actorFixture(), actor = await roleActor(owner, 'BODEGUERO'), saved = await savedClose(owner);
    await expect(inspectCashClose(actor, reference(saved), deps)).rejects.toMatchObject({ code: 'REPORT_ROLE_FORBIDDEN' });
    expect((await createOperationTools(actor, deps)).some(tool => tool.name === 'inspect_cash_close')).toBe(false);
  });

  it.each(['role', 'status', 'enabled'])('revalida %s revocado antes de leer la fuente', async change => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    if (change === 'enabled') await prisma.assistantTenantConfig.update({ where: { tenantId: actor.tenantId }, data: { enabled: false } });
    else await prisma.user.update({ where: { id: actor.userId }, data: change === 'role' ? { role: 'BODEGUERO' } : { status: 'DISABLED' } });
    await expect(inspectCashClose(actor, reference(saved), deps)).rejects.toMatchObject({ code: change === 'enabled' ? 'ASSISTANT_DISABLED' : 'SESSION_REVOKED' });
  });

  it('referencia con hash anterior exige nueva revisión y no devuelve el contenido cambiado', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    const updated = await replaceReport(saved, report => { report.cash.countedNio = '125.00'; report.cash.differenceNio = '0.00'; });
    await expect(inspectCashClose(actor, reference(saved), deps)).rejects.toMatchObject({ code: 'CASH_CLOSE_SOURCE_CHANGED', statusCode: 409 });
    expect((await inspectCashClose(actor, { shiftId: saved.shift.id, reportHash: updated.contentHash }, deps)).snapshot!.cash.differenceNio).toBe('0.00');
  });

  it.each(['missing', 'open', 'tampered', 'version', 'equation'] as const)('%s no se presenta como un cierre verificable', async kind => {
    const actor = await actorFixture(), saved = await savedClose(actor, { missing: kind === 'missing', state: kind === 'open' ? 'OPEN' : 'CLOSED' });
    if (kind === 'tampered') await replaceReport(saved, report => { report.cash.countedNio = '900.00'; }, false);
    if (kind === 'version') await prisma.shiftCloseReport.update({ where: { id: saved.stored!.id }, data: { version: 2 } });
    if (kind === 'equation') await replaceReport(saved, report => { report.cash.differenceUsd = '1.0000'; });
    const result = await inspectCashClose(actor, { shiftId: saved.shift.id }, deps);
    expect(result.status).toBe('unavailable'); expect(result.snapshot).toBeNull(); expect(result.pendingChecks.length).toBeGreaterThan(0);
    await noAssistantEffects(actor);
  });

  it('cero verificado conserva precisión NIO2 y USD4, no es falta de información', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor, { cash: { openingNio: '0', expectedNio: '0', countedNio: '0', differenceNio: '0',
      openingUsd: '0', expectedUsd: '0', countedUsd: '0', differenceUsd: '0' }, movements: [] });
    const result = await inspectCashClose(actor, reference(saved), deps);
    expect(result).toMatchObject({ status: 'ok', snapshot: { cash: { expectedNio: '0.00', countedNio: '0.00', differenceNio: '0.00',
      expectedUsd: '0.0000', countedUsd: '0.0000', differenceUsd: '0.0000' } } });
  });

  it('31 movimientos actuales truncan la lista sin sumar ni alterar el corte histórico', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    for (let i = 0; i < 31; i++) await movement(actor, saved.shift.id, { createdAt: new Date(now.getTime() + i) });
    const result = await inspectCashClose(actor, reference(saved), deps);
    expect(result.status).toBe('partial'); expect(result.currentMovements.status).toBe('truncated');
    expect(result.currentMovements.rows.length).toBeLessThanOrEqual(30);
    expect(result.snapshot!.cash).toMatchObject({ expectedNio: '125.00', differenceNio: '-5.00', paidOutNio: '0.00' });
  });

  it.each(['groups', 'payments', 'bytes'] as const)('snapshot excedido por %s falla cerrado', async kind => {
    const actor = await actorFixture(), saved = await savedClose(actor, {
      ...(kind === 'groups' ? { movements: Array.from({ length: 21 }, (_, i) => ({ type: 'IN', currency: 'NIO', category: `QA_${i}`, count: 1, amount: '1' })) } : {}),
      ...(kind === 'payments' ? { payments: Array.from({ length: 11 }, (_, i) => ({ method: `QA_${i}`, transactionCount: 1, grossSales: '1' })) } : {}),
    });
    if (kind === 'bytes') await replaceReport(saved, report => { report.shift.auditNotes = 'X'.repeat(270000); });
    const result = await inspectCashClose(actor, { shiftId: saved.shift.id }, deps);
    expect(result.status).toBe('unavailable'); expect(result.snapshot).toBeNull();
    expect(JSON.stringify(result).length).toBeLessThan(18000);
  });

  it('un fallo de consulta produce 503 y conserva todos los registros', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor), before = await businessState(actor);
    const db = new Proxy(prisma, { get(target, field) {
      if (field === '$transaction') return async () => { throw new Error('QA consulta indisponible'); };
      const value = Reflect.get(target, field); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(inspectCashClose(actor, reference(saved), { db, now: () => now })).rejects.toMatchObject({ statusCode: 503 });
    expect(await businessState(actor)).toEqual(before);
  });

  it.each([{ tenantId: 'tenant-ajeno' }, { sql: 'SELECT * FROM User' }, { reportHash: 'hash-inválido' }, { shiftId: '' }])('schema estricto rechaza %j', async forged => {
    const actor = await actorFixture(), saved = await savedClose(actor);
    await expect(inspectCashClose(actor, { ...reference(saved), ...forged }, deps)).rejects.toBeDefined();
    const tool = (await createOperationTools(actor, deps)).find(entry => entry.name === 'inspect_cash_close');
    expect(tool).toBeDefined(); expect(tool!.kind).toBe('READ');
    await expect(tool!.execute({ principal: actor, conversationId: randomUUID(), runId: randomUUID(), toolCallId: 'step1', assertActive: async () => {} },
      { ...reference(saved), ...forged })).rejects.toBeDefined();
    await noAssistantEffects(actor);
  });

  it('consulta repetida no escribe auditoría, contabilidad, caja, compras ni stock', async () => {
    const actor = await actorFixture(), saved = await savedClose(actor); await movement(actor, saved.shift.id);
    await prisma.product.create({ data: { tenantId: actor.tenantId, createdBy: actor.userId, name: 'QA stock intacto', sku: randomUUID(), price: 50, cost: 20, stock: 7, unit: 'unidad' } });
    await prisma.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'QA_IMMUTABLE', details: 'Antes de investigación' } });
    const account = await prisma.account.create({ data: { tenantId: actor.tenantId, code: 'QA.1', name: 'Caja QA', type: 'ASSET', balance: '123.45' } });
    await prisma.journalEntry.create({ data: { tenantId: actor.tenantId, createdBy: actor.userId, description: 'Asiento QA previo',
      lines: { create: [{ accountId: account.id, debit: '1', credit: '0' }, { accountId: account.id, debit: '0', credit: '1' }] } } });
    const before = await businessState(actor);
    const first = await inspectCashClose(actor, reference(saved), deps), second = await inspectCashClose(actor, reference(saved), deps);
    expect(second).toEqual(first); expect(await businessState(actor)).toEqual(before); await noAssistantEffects(actor);
  });

  it('HTTP POST/poll/reload conserva evidencia privada sin IA, adjuntos ni propuestas', async () => {
    const actor = await actorFixture(), foreign = await actorFixture(), coworker = await roleActor(actor, 'OWNER'), saved = await savedClose(actor);
    const chat = await prisma.assistantConversation.create({ data: { tenantId: actor.tenantId, userId: actor.userId, roleAtCreation: actor.role,
      expiresAt: new Date('2099-12-31T00:00:00Z') } });
    const before = await businessState(actor), requestId = randomUUID();
    const input = { requestId, text: cashCloseInvestigationMessage(saved.shift.id, saved.stored!.contentHash) };
    const submitted = await api(`/api/assistant/conversations/${chat.id}/runs`, actor, 'POST', input); status(submitted, 202);
    let completed: Awaited<ReturnType<typeof api>>;
    await vi.waitFor(async () => { completed = await api(`/api/assistant/runs/${submitted.body.id}`, actor); status(completed, 200);
      expect(completed.body.status).toBe('SUCCEEDED'); }, { timeout: 12000, interval: 50 });
    const evidence = completed!.body.result.evidence.find((item: { tool: string }) => item.tool === 'inspect_cash_close');
    expect(evidence?.data).toMatchObject({ kind: 'CASH_CLOSE_INVESTIGATION', shift: { id: saved.shift.id }, snapshot: { source: { contentHash: saved.stored!.contentHash } } });
    const replay = await api(`/api/assistant/conversations/${chat.id}/runs`, actor, 'POST', input); status(replay, 200);
    expect(replay.body.id).toBe(submitted.body.id);
    const reload = await api(`/api/assistant/runs/${submitted.body.id}`, actor); status(reload, 200);
    expect(reload.cacheControl).toBe('private, no-store'); expect(reload.body.result).toEqual(completed!.body.result);
    for (const denied of [foreign, coworker]) {
      status(await api(`/api/assistant/runs/${submitted.body.id}`, denied), 404);
      status(await api(`/api/assistant/conversations/${chat.id}/runs`, denied), 404);
    }
    expect(await businessState(actor)).toEqual(before); await noAssistantEffects(actor);
    await prisma.user.update({ where: { id: actor.userId }, data: { role: 'VIEWER' } });
    status(await api(`/api/assistant/runs/${submitted.body.id}`, actor), 404);
    await prisma.user.update({ where: { id: actor.userId }, data: { status: 'DISABLED' } });
    status(await api(`/api/assistant/runs/${submitted.body.id}`, actor), 403);
  }, 20000);
});
