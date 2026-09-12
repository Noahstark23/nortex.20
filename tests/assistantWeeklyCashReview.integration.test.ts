// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Prisma } from '@prisma/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { buildShiftCloseReport, hashShiftCloseReport, type BuildShiftCloseReportInput } from '../backend/lib/shiftCloseReport';
import { reviewWeeklyCash } from '../backend/services/assistant/operations/weeklyCashReview';
import { createOperationTools } from '../backend/services/assistant/operations/tools';
import { executeAssistantRun, getAssistantRun } from '../backend/services/assistant/operations/runService';
import { api, assertDisposableDatabase, baseUrl, roleActor, status, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
const now = new Date('2026-09-08T18:00:00.000Z');
const period = { startDate: '2026-09-01', endDate: '2026-09-07' };
const deps = { db: prisma, now: () => now };
const missingTotals = { shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null };
const zeroTotals = { shortageNio: '0.00', surplusNio: '0.00', shortageUsd: '0.0000', surplusUsd: '0.0000' };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function actorFixture(role = 'OWNER') {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA revisión de caja', taxId: `QA-${randomUUID()}`, type: 'FERRETERIA' } });
  const actor = await roleActor({ tenantId: tenant.id, userId: '', role: '', token: '' }, role);
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, operationsEnabled: true } });
  return actor;
}

type CashInput = BuildShiftCloseReportInput['cash'];
async function closedShift(actor: TestActor, options: {
  closedAt?: string; openedAt?: string; businessDate?: string; cash?: Partial<CashInput>; noReport?: boolean;
} = {}) {
  const closedAt = new Date(options.closedAt ?? '2026-09-05T23:00:00.000Z');
  const openedAt = new Date(options.openedAt ?? '2026-09-05T12:00:00.000Z');
  const cash: CashInput = { openingNio: '100', expectedNio: '100', countedNio: '100', differenceNio: '0',
    openingUsd: '10', expectedUsd: '10', countedUsd: '10', differenceUsd: '0', cashRefundsNio: '0', ...options.cash };
  const shift = await prisma.shift.create({ data: { tenantId: actor.tenantId, userId: actor.userId, status: 'CLOSED',
    startTime: openedAt, endTime: closedAt, initialCash: String(cash.openingNio), finalCashDeclared: String(cash.countedNio),
    systemExpectedCash: String(cash.expectedNio), difference: String(cash.differenceNio), initialCashUsd: String(cash.openingUsd),
    finalCashDeclaredUsd: String(cash.countedUsd), systemExpectedUsd: String(cash.expectedUsd), differenceUsd: String(cash.differenceUsd) } });
  const report = buildShiftCloseReport({ folio: `Z-QA-${randomUUID()}`, businessDate: options.businessDate ?? '2026-09-05', generatedAt: closedAt,
    business: { name: 'Negocio sintético QA', taxId: 'QA-SYNTHETIC', address: null, phone: null },
    shift: { id: shift.id, openedAt, closedAt, openedBy: 'QA caja', cashierName: 'QA caja', closedBy: 'QA caja', auditNotes: null },
    payments: [], soldProducts: [], returnedProducts: [], returns: { count: 0, total: '0', vat: '0', cogs: '0' },
    fiscal: { vatCollectedBeforeReturns: '0', discountTotal: '0' }, cash, movements: [] });
  const stored = options.noReport ? null : await prisma.shiftCloseReport.create({ data: { tenantId: actor.tenantId, shiftId: shift.id,
    folio: report.folio, businessDate: report.businessDate, version: report.version, report: asJson(report),
    contentHash: hashShiftCloseReport(report), createdBy: actor.userId, createdAt: closedAt } });
  return { shift, report, stored };
}

async function openShift(actor: TestActor) {
  return prisma.shift.create({ data: { tenantId: actor.tenantId, userId: actor.userId, status: 'OPEN',
    startTime: new Date('2026-08-28T12:00:00Z'), initialCash: '987.65', initialCashUsd: '12.3456' } });
}

/** Filas completas y orden estable: detecta también actualizaciones, no sólo inserciones. */
async function businessState(actor: TestActor) {
  const where = { tenantId: actor.tenantId }, orderBy = { id: 'asc' as const };
  return Promise.all([
    prisma.shift.findMany({ where, orderBy }), prisma.shiftCloseReport.findMany({ where, orderBy }),
    prisma.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    prisma.auditLog.findMany({ where, orderBy }), prisma.cashMovement.findMany({ where, orderBy }),
    prisma.account.findMany({ where, orderBy }), prisma.sale.findMany({ where, orderBy }),
  ]);
}

async function conversation(actor: TestActor) {
  return prisma.assistantConversation.create({ data: { tenantId: actor.tenantId, userId: actor.userId,
    roleAtCreation: actor.role, expiresAt: new Date('2099-12-31T00:00:00Z') } });
}

qa('W01 revisión semanal de caja: snapshots, permisos y lectura HTTP/MySQL', () => {
  beforeAll(() => { assertDisposableDatabase(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('el índice aditivo conserva cierres existentes y db push se puede repetir', async () => {
    assertDisposableDatabase();
    const owner = await actorFixture();
    await closedShift(owner);
    const before = await reviewWeeklyCash(owner, period, deps);
    await prisma.$executeRaw`DROP INDEX Shift_tenantId_status_endTime_idx ON Shift`;
    const push = () => spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', 'backend/prisma/schema.prisma'], {
      env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 120_000,
    });
    try {
      expect(push().status).toBe(0);
      expect(push().status).toBe(0);
      const indices = await prisma.$queryRaw<Array<{ COLUMN_NAME: string }>>`SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Shift' AND INDEX_NAME='Shift_tenantId_status_endTime_idx' ORDER BY SEQ_IN_INDEX`;
      expect(indices.map(row => row.COLUMN_NAME)).toEqual(['tenantId', 'status', 'endTime']);
      expect(await reviewWeeklyCash(owner, period, deps)).toEqual(before);
    } finally {
      // Restaura únicamente el índice de este MySQL descartable si el ensayo falló.
      const found = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Shift' AND INDEX_NAME='Shift_tenantId_status_endTime_idx'`;
      if (Number(found[0].n) === 0) await prisma.$executeRaw`CREATE INDEX Shift_tenantId_status_endTime_idx ON Shift (tenantId,status,endTime)`;
    }
  }, 180_000);

  it('suma faltantes y sobrantes por moneda sin compensarlos y conserva fuentes verificables', async () => {
    const owner = await actorFixture();
    const shortage = await closedShift(owner, { cash: { countedNio: '95', differenceNio: '-5', countedUsd: '9.9999', differenceUsd: '-0.0001' } });
    const surplus = await closedShift(owner, { cash: { countedNio: '107', differenceNio: '7', countedUsd: '10.25', differenceUsd: '0.25' } });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result).toMatchObject({ kind: 'WEEKLY_CASH_REVIEW', status: 'ok', scope: 'business', checkedAt: now.toISOString(),
      counts: { closed: 2, verified: 2, differences: 2, missingReports: 0, invalidReports: 0, open: 0 },
      totals: { shortageNio: '5.00', surplusNio: '7.00', shortageUsd: '0.0001', surplusUsd: '0.2500' } });
    for (const saved of [shortage, surplus]) {
      expect(result.rows.find(row => row.shiftId === saved.shift.id)).toMatchObject({ status: 'DIFFERENCE',
        source: { id: saved.stored!.id, version: 1, contentHash: saved.stored!.contentHash, documentUrl: `/api/reports/shifts/${saved.shift.id}/document` } });
    }
  });

  it('dos negocios no comparten cierres, cajas abiertas ni evidencia', async () => {
    const a = await actorFixture(), b = await actorFixture();
    const own = await closedShift(a), foreign = await closedShift(b, { cash: { countedNio: '1', differenceNio: '-99' } });
    const foreignOpen = await openShift(b);
    const result = await reviewWeeklyCash(a, period, deps);
    expect(result.rows.map(row => row.shiftId)).toEqual([own.shift.id]);
    expect(result.totals).toEqual(zeroTotals);
    expect(JSON.stringify(result)).not.toContain(foreign.shift.id);
    expect(JSON.stringify(result)).not.toContain(foreignOpen.id);
  });

  it.each(['CASHIER', 'EMPLOYEE', 'VENDEDOR'])('%s sólo revisa Shift.userId, nunca amplía alcance por soldById', async role => {
    const owner = await actorFixture(), cashier = await roleActor(owner, role);
    const own = await closedShift(cashier), foreign = await closedShift(owner), ownOpen = await openShift(cashier);
    await prisma.sale.create({ data: { tenantId: owner.tenantId, shiftId: foreign.shift.id, soldById: cashier.userId,
      total: '500', status: 'COMPLETED', paymentMethod: 'CASH' } });
    await prisma.sale.create({ data: { tenantId: owner.tenantId, shiftId: own.shift.id, soldById: owner.userId,
      total: '100', status: 'COMPLETED', paymentMethod: 'CASH' } });
    const result = await reviewWeeklyCash(cashier, period, deps);
    expect(result.scope).toBe('own-shifts');
    expect(result.rows.map(row => row.shiftId).sort()).toEqual([own.shift.id, ownOpen.id].sort());
    expect(result.rows.find(row => row.shiftId === ownOpen.id)).toMatchObject({ status: 'OPEN', cash: null, source: null });
    expect(JSON.stringify(result)).not.toContain(foreign.shift.id);
  });

  it('gerencia, contabilidad y consulta conservan acceso a cierres del negocio', async () => {
    const owner = await actorFixture(), saved = await closedShift(owner);
    for (const role of ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER']) {
      const actor = await roleActor(owner, role), result = await reviewWeeklyCash(actor, period, deps);
      expect(result.scope).toBe('business'); expect(result.rows[0].shiftId).toBe(saved.shift.id);
    }
  });

  it.each(['BODEGUERO', 'LENDER', 'DRIVER'])('niega a %s importes de cierres y no ofrece la herramienta', async role => {
    const actor = await actorFixture(role);
    await expect(reviewWeeklyCash(actor, period, deps)).rejects.toMatchObject({ code: 'REPORT_ROLE_FORBIDDEN', httpStatus: 403 });
    expect((await createOperationTools(actor, deps)).some(tool => tool.name === 'review_weekly_cash')).toBe(false);
  });

  it.each(['role', 'status'])('revalida %s antes de consultar con identidad vieja', async field => {
    const owner = await actorFixture(); await closedShift(owner);
    await prisma.user.update({ where: { id: owner.userId }, data: field === 'role' ? { role: 'BODEGUERO' } : { status: 'DISABLED' } });
    await expect(reviewWeeklyCash(owner, period, deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('un cierre sin snapshot no equivale a diferencia cero y no se repara durante la consulta', async () => {
    const owner = await actorFixture(), missing = await closedShift(owner, { noReport: true });
    const before = await businessState(owner), result = await reviewWeeklyCash(owner, period, deps);
    expect(result.status).not.toBe('ok'); expect(result.totals).toEqual(missingTotals);
    expect(result.counts).toMatchObject({ closed: 1, verified: 0, missingReports: 1 });
    expect(result.rows[0]).toMatchObject({ shiftId: missing.shift.id, status: 'MISSING_REPORT', cash: null });
    expect(await businessState(owner)).toEqual(before);
  });

  it('alterar contenido sin actualizar su hash invalida el reporte', async () => {
    const owner = await actorFixture(), saved = await closedShift(owner);
    const changed = structuredClone(saved.report); changed.cash.countedNio = '101.00';
    await prisma.shiftCloseReport.update({ where: { id: saved.stored!.id }, data: { report: asJson(changed) } });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result.rows[0]).toMatchObject({ status: 'INVALID_REPORT', cash: null });
    expect(result.counts.invalidReports).toBe(1); expect(result.totals).toEqual(missingTotals);
  });

  it('un cierre íntegro junto a otro sin fuente no se publica como un total completo', async () => {
    const owner = await actorFixture();
    await closedShift(owner, { cash: { countedNio: '95', differenceNio: '-5' } });
    await closedShift(owner, { noReport: true });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result).toMatchObject({ status: 'partial', counts: { closed: 2, verified: 1, missingReports: 1 }, totals: missingTotals });
  });

  it('fallo real del acceso a consultas se informa indisponible, nunca como cajas en cero', async () => {
    const owner = await actorFixture(); await closedShift(owner);
    const before = await businessState(owner);
    // Sólo la consulta falla; autorización y observaciones antes/después usan MySQL real.
    const unavailable = new Proxy(prisma, { get(target, field) {
      if (field === '$transaction') return async () => { throw new Error('QA consulta de cierres indisponible'); };
      const value = Reflect.get(target, field); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(reviewWeeklyCash(owner, period, { db: unavailable, now: () => now })).rejects.toMatchObject({ code: 'CASH_REVIEW_UNAVAILABLE', statusCode: 503 });
    expect(await businessState(owner)).toEqual(before);
  });

  it.each(['Nio', 'Usd'] as const)('un hash válido no legitima una ecuación %s incoherente', async currency => {
    const owner = await actorFixture(), saved = await closedShift(owner);
    const changed = structuredClone(saved.report);
    changed.cash[`difference${currency}`] = currency === 'Nio' ? '9.00' : '9.0000';
    await prisma.shiftCloseReport.update({ where: { id: saved.stored!.id }, data: { report: asJson(changed), contentHash: hashShiftCloseReport(changed) } });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result.rows[0]).toMatchObject({ status: 'INVALID_REPORT', cash: null });
    expect(result.totals).toEqual(missingTotals);
  });

  it('rechaza metadatos de otro turno aun con payload y hash formalmente válidos', async () => {
    const owner = await actorFixture(), saved = await closedShift(owner);
    const changed = structuredClone(saved.report); changed.shift.id = randomUUID();
    await prisma.shiftCloseReport.update({ where: { id: saved.stored!.id }, data: { report: asJson(changed), contentHash: hashShiftCloseReport(changed) } });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result.rows[0].status).toBe('INVALID_REPORT'); expect(result.totals).toEqual(missingTotals);
  });

  it('aplica fronteras Managua inclusiva inicial y exclusiva final sobre endTime', async () => {
    const owner = await actorFixture();
    const before = await closedShift(owner, { openedAt: '2026-08-31T20:00:00Z', closedAt: '2026-09-01T05:59:59.999Z', businessDate: '2026-08-31' });
    const first = await closedShift(owner, { openedAt: '2026-08-31T20:00:00Z', closedAt: '2026-09-01T06:00:00.000Z', businessDate: '2026-09-01' });
    const last = await closedShift(owner, { closedAt: '2026-09-08T05:59:59.999Z', businessDate: '2026-09-07' });
    const after = await closedShift(owner, { closedAt: '2026-09-08T06:00:00.000Z', businessDate: '2026-09-08' });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result.rows.map(row => row.shiftId).sort()).toEqual([first.shift.id, last.shift.id].sort());
    expect(result.period).toMatchObject({ ...period, timeZone: 'America/Managua', completeDays: true });
    expect(JSON.stringify(result)).not.toContain(before.shift.id); expect(JSON.stringify(result)).not.toContain(after.shift.id);
  });

  it('el turno iniciado el día anterior se selecciona por cierre después de medianoche', async () => {
    const owner = await actorFixture();
    const saved = await closedShift(owner, { openedAt: '2026-09-01T23:00:00Z', closedAt: '2026-09-02T06:15:00Z', businessDate: '2026-09-02' });
    const result = await reviewWeeklyCash(owner, { startDate: '2026-09-02', endDate: '2026-09-02' }, deps);
    expect(result.rows[0]).toMatchObject({ shiftId: saved.shift.id, businessDate: '2026-09-02', closedAt: '2026-09-02T06:15:00.000Z' });
  });

  it('por defecto revisa los siete días completos anteriores en Managua', async () => {
    const owner = await actorFixture(); await closedShift(owner);
    const result = await reviewWeeklyCash(owner, {}, deps);
    expect(result.period).toMatchObject({ ...period, completeDays: true, timeZone: 'America/Managua' });
    const nearMidnight = await reviewWeeklyCash(owner, {}, { db: prisma, now: () => new Date('2026-09-08T05:59:59Z') });
    expect(nearMidnight.period).toMatchObject({ startDate: '2026-08-31', endDate: '2026-09-06' });
  });

  it('distingue ningún cierre de un cierre verificado con importes cero', async () => {
    const owner = await actorFixture(), empty = await reviewWeeklyCash(owner, period, deps);
    expect(empty.counts.closed).toBe(0); expect(empty.totals).toEqual(missingTotals); expect(empty.status).toBe('unavailable');
    await closedShift(owner, { cash: { openingNio: '0', expectedNio: '0', countedNio: '0', openingUsd: '0', expectedUsd: '0', countedUsd: '0' } });
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result).toMatchObject({ status: 'ok', totals: zeroTotals, counts: { closed: 1, verified: 1 } });
  });

  it.each(['closed', 'open'] as const)('exceso de %s se informa incompleto y nunca publica totales parciales', async kind => {
    const owner = await actorFixture();
    if (kind === 'closed') for (let i = 0; i < 21; i++) await closedShift(owner);
    else { await closedShift(owner); for (let i = 0; i < 11; i++) await openShift(owner); }
    const result = await reviewWeeklyCash(owner, period, deps);
    expect(result.status).not.toBe('ok'); expect(result.truncated).toBe(true); expect(result.totals).toEqual(missingTotals); expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.rows.filter(row => row.status === 'OPEN').length).toBeLessThanOrEqual(10);
    expect(result.rows.filter(row => row.status !== 'OPEN').length).toBeLessThanOrEqual(20);
  });

  it('consultas repetidas no alteran Shift, Report, Journal, Audit, Cash ni catálogo contable', async () => {
    const owner = await actorFixture(), saved = await closedShift(owner); await openShift(owner);
    await prisma.cashMovement.create({ data: { tenantId: owner.tenantId, userId: owner.userId, shiftId: saved.shift.id,
      type: 'IN', amount: '1.25', currency: 'NIO', category: 'QA', description: 'Movimiento sintético posterior al snapshot' } });
    const debit = await prisma.account.create({ data: { tenantId: owner.tenantId, code: 'QA.1', name: 'Caja sintética', type: 'ASSET', balance: '1.25' } });
    const credit = await prisma.account.create({ data: { tenantId: owner.tenantId, code: 'QA.2', name: 'Aporte sintético', type: 'EQUITY', balance: '1.25' } });
    await prisma.journalEntry.create({ data: { tenantId: owner.tenantId, createdBy: owner.userId,
      description: 'Asiento sintético de referencia, no lo genera el asistente', lines: { create: [
        { accountId: debit.id, debit: '1.25', credit: '0' }, { accountId: credit.id, debit: '0', credit: '1.25' },
      ] } } });
    await prisma.auditLog.create({ data: { tenantId: owner.tenantId, userId: owner.userId, action: 'QA_EXISTING_RECORD', details: 'Evidencia previa sintética e inmutable.' } });
    const before = await businessState(owner);
    const first = await reviewWeeklyCash(owner, period, deps), second = await reviewWeeklyCash(owner, period, deps);
    expect(second).toEqual(first); expect(await businessState(owner)).toEqual(before);
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await prisma.assistantActionProposal.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it.each([
    { startDate: '2026-09-01' }, { endDate: '2026-09-07' }, { startDate: '2026-09-01', endDate: '2026-09-08' },
    { startDate: '2026-09-07', endDate: '2026-09-01' }, { startDate: '2026-02-30', endDate: '2026-03-01' },
    { ...period, tenantId: 'tenant-forjado' }, { ...period, sql: 'SELECT * FROM User' },
  ])('rechaza entrada inválida o alcance inyectado: %j', async input => {
    const owner = await actorFixture();
    await expect(reviewWeeklyCash(owner, input, deps)).rejects.toBeDefined();
    expect(await prisma.shift.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('la herramienta aplica schema estricto y no acepta identidad dentro de sus argumentos', async () => {
    const owner = await actorFixture(), foreign = await actorFixture(); await closedShift(foreign);
    const tool = (await createOperationTools(owner, deps)).find(entry => entry.name === 'review_weekly_cash');
    expect(tool).toBeDefined(); expect(tool!.kind).toBe('READ');
    await expect(tool!.execute({ principal: owner, conversationId: randomUUID(), runId: randomUUID(), toolCallId: 'step1', assertActive: async () => {} },
      { ...period, tenantId: foreign.tenantId })).rejects.toBeDefined();
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it('fallback durable sin proveedor entrega revisión y reload conserva resultado sin uso ni propuestas', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const owner = await actorFixture(), saved = await closedShift(owner), chat = await conversation(owner), before = await businessState(owner);
    const input = { requestId: randomUUID(), text: 'Revisá el cierre semanal de caja 2026-09-01 2026-09-07' };
    const run = await executeAssistantRun(owner, chat.id, input, deps);
    expect(run.status).toBe('SUCCEEDED'); expect(run.result?.degraded).toBe(true);
    const evidence = run.result?.evidence.find(item => item.tool === 'review_weekly_cash');
    expect(evidence?.data).toMatchObject({ kind: 'WEEKLY_CASH_REVIEW', counts: { verified: 1 } });
    expect(JSON.stringify(evidence)).toContain(saved.shift.id);
    expect((await getAssistantRun(owner, run.id, deps)).result).toEqual(run.result);
    expect((await executeAssistantRun(owner, chat.id, input, deps)).id).toBe(run.id);
    expect(await prisma.assistantRun.count({ where: { tenantId: owner.tenantId } })).toBe(1);
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await prisma.assistantProposal.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await prisma.assistantActionProposal.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    expect(await businessState(owner)).toEqual(before);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    await expect(getAssistantRun(owner, run.id, deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('HTTP crea ejecución, permite polling/reload y niega historial ajeno o sesión deshabilitada', async () => {
    const owner = await actorFixture(), foreign = await actorFixture(), chat = await conversation(owner);
    const saved = await closedShift(owner), before = await businessState(owner);
    const submitted = await api(`/api/assistant/conversations/${chat.id}/runs`, owner, 'POST',
      { requestId: randomUUID(), text: 'Revisá el cierre semanal de caja 2026-09-01 2026-09-07' });
    status(submitted, 202);
    let completed: Awaited<ReturnType<typeof api>>;
    await vi.waitFor(async () => {
      completed = await api(`/api/assistant/runs/${submitted.body.id}`, owner); status(completed, 200);
      expect(completed.body.status).toBe('SUCCEEDED');
    }, { timeout: 12000, interval: 50 });
    expect(completed!.body.result.degraded).toBe(true);
    const evidence = completed!.body.result.evidence.find((item: { tool: string }) => item.tool === 'review_weekly_cash');
    expect(JSON.stringify(evidence)).toContain(saved.shift.id);
    const reload = await api(`/api/assistant/runs/${submitted.body.id}`, owner); status(reload, 200);
    expect(reload.body.result).toEqual(completed!.body.result); expect(reload.cacheControl).toBe('private, no-store');
    status(await api(`/api/assistant/runs/${submitted.body.id}`, foreign), 404);
    status(await api(`/api/assistant/conversations/${chat.id}/runs`, foreign), 404);
    expect(await businessState(owner)).toEqual(before);
    expect(await prisma.assistantUsage.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'VIEWER' } });
    const revoked = await api(`/api/assistant/runs/${submitted.body.id}`, owner); status(revoked, 404);
    expect(JSON.stringify(revoked.body)).not.toContain(saved.shift.id);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    status(await api(`/api/assistant/runs/${submitted.body.id}`, owner), 403);
  }, 20000);
});
