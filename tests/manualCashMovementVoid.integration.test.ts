import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { verifyTenantLedger } from '../backend/services/ledger';
import { fiscalCivilDate } from '../backend/lib/fiscalAccess';
import { inviteQaMember } from './helpers/saleCorrectionQa';

const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qa = base && process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type Fixture = { tenantId: string; userId: string; token: string; shiftId: string };
async function api(token: string, path: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
}
function status(response: Awaited<ReturnType<typeof api>>, expected: number) {
    const diagnostic = JSON.stringify(response.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value);
    expect(response.status, diagnostic).toBe(expected);
}
async function fixture(): Promise<Fixture> {
    const id = randomUUID();
    const registered = await api('', '/api/auth/register', {
        companyName: `QA anulación caja ${id}`, email: `qa-void-${id}@example.invalid`,
        password: `Qa-${randomUUID()}-Seguro!`, type: 'MISCELANEA',
    });
    status(registered, 200);
    const token = registered.body.token;
    const opened = await api(token, '/api/shifts/open', { initialCash: '500.00' });
    status(opened, 200);
    return { token, tenantId: registered.body.tenant.id, userId: registered.body.user.id, shiftId: opened.body.id };
}
async function createMovement(f: Fixture, type = 'OUT', category = 'GASTO_OPERATIVO', amount = '25.00') {
    const response = await api(f.token, '/api/cash-movements', { type, category, amount, description: 'Movimiento manual QA', currency: 'NIO' });
    status(response, 200);
    return response.body;
}
const voidMovement = (f: Fixture, id: string, reason = 'Error documentado de captura') => api(f.token, `/api/cash-movements/${id}/void`, { reason });
async function state(f: Fixture) {
    const where = { tenantId: f.tenantId };
    const [movements, expenses, journals, accounts, audits] = await Promise.all([
        prisma.cashMovement.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.expense.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.journalEntry.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } }, take: 100 }),
        prisma.account.findMany({ where, orderBy: { code: 'asc' }, take: 100 }),
        prisma.auditLog.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
    ]);
    return JSON.stringify({ movements, expenses, journals, accounts, audits });
}

qa('anulación manual de caja: SQL, mayor, gasto y libro firmado', () => {
    beforeAll(() => {
        expect(['127.0.0.1', 'localhost']).toContain(new URL(base!).hostname);
        const database = new URL(process.env.DATABASE_URL!);
        expect(['127.0.0.1', 'localhost']).toContain(database.hostname);
        expect(database.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    });
    afterAll(async () => { await prisma.$disconnect(); });

    it.each([
        ['IN', 'INYECCION_CAPITAL'], ['OUT', 'GASTO_OPERATIVO'], ['OUT', 'RETIRO_PERSONAL'],
    ])('%s %s revierte asiento exacto y conserva el histórico firmado', async (type, category) => {
        const f = await fixture();
        const movement = await createMovement(f, type, category);
        const original = await prisma.journalEntry.findFirstOrThrow({
            where: { tenantId: f.tenantId, referenceId: movement.id }, include: { lines: { orderBy: { id: 'asc' } } },
        });
        const result = await voidMovement(f, movement.id);
        status(result, 200);
        const reversal = await prisma.journalEntry.findFirstOrThrow({
            where: { tenantId: f.tenantId, reversalOfId: original.id }, include: { lines: true },
        });
        expect(reversal.entryKind).toBe('REVERSAL');
        expect(reversal.lines.map(row => ({ id: row.accountId, debit: row.debit.toFixed(2), credit: row.credit.toFixed(2) })).sort((a,b) => a.id.localeCompare(b.id)))
            .toEqual(original.lines.map(row => ({ id: row.accountId, debit: row.credit.toFixed(2), credit: row.debit.toFixed(2) })).sort((a,b) => a.id.localeCompare(b.id)));
        const saved = await prisma.cashMovement.findFirstOrThrow({ where: { id: movement.id, tenantId: f.tenantId } });
        expect(saved).toMatchObject({ isVoided: true, seq: movement.seq, signature: movement.signature, expenseId: movement.expenseId });
        expect((await verifyTenantLedger(prisma, f.tenantId)).ok).toBe(true);
        expect(await prisma.journalEntry.findFirst({ where: { id: original.id, tenantId: f.tenantId }, include: { lines: { orderBy: { id: 'asc' } } } })).toEqual(original);
        const accounts = await prisma.account.findMany({ where: { tenantId: f.tenantId }, take: 100 });
        for (const account of accounts) expect(account.balance.toFixed(2), account.code).toBe('0.00');
        if (category === 'GASTO_OPERATIVO') {
            const expenses = await prisma.expense.findMany({ where: { tenantId: f.tenantId }, take: 10 });
            expect(expenses).toHaveLength(2);
            expect(expenses.find(row => row.id === movement.expenseId)?.amount.toFixed(2)).toBe('25.00');
            expect(expenses.find(row => row.id !== movement.expenseId)?.amount.toFixed(2)).toBe('-25.00');
            const expenseReport = await api(f.token, '/api/reports/expenses');
            status(expenseReport, 200);
            expect(expenseReport.body.totalExpenses).toBe(0);
            expect(expenseReport.body.byCategory.OPERATIONAL).toBe(0);
            const income = await api(f.token, '/api/accounting/estado-resultados');
            status(income, 200);
            expect(income.body).toHaveProperty('netIncome', 0);
            expect(income.body.operatingExpenses.total).toBe(0);
            const [year, month] = fiscalCivilDate(new Date()).period.split('-').map(Number);
            const monthlyIncome = await api(f.token, `/api/accounting/estado-resultados?year=${year}&month=${month}`);
            status(monthlyIncome, 200);
            expect(monthlyIncome.body.netIncome).toBe(0);
            expect(monthlyIncome.body.operatingExpenses.total).toBe(0);
        }
        const beforeReplay = await state(f);
        const replay = await voidMovement(f, movement.id, '  Error documentado de captura  ');
        status(replay, 200);
        expect(replay.body.idempotentReplay).toBe(true);
        status(await voidMovement(f, movement.id, 'Una intención distinta'), 409);
        expect(await state(f)).toBe(beforeReplay);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'CASH_MOVEMENT_VOIDED' } })).toBe(1);
    }, 60_000);

    it('dos anulaciones simultáneas generan un solo reverso y compensación', async () => {
        const f = await fixture();
        const movement = await createMovement(f);
        const pair = await Promise.all([voidMovement(f, movement.id), voidMovement(f, movement.id)]);
        pair.forEach(response => status(response, 200));
        expect(pair.map(response => response.body.idempotentReplay).sort()).toEqual([false, true]);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.tenantId, entryKind: 'REVERSAL' } })).toBe(1);
        expect(await prisma.expense.count({ where: { tenantId: f.tenantId, amount: { lt: 0 } } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'CASH_MOVEMENT_VOIDED' } })).toBe(1);
    }, 60_000);

    it('CAMBIO sin asiento se anula sin inventar contabilidad ni borrar la firma', async () => {
        const f = await fixture();
        const movement = await createMovement(f, 'IN', 'CAMBIO');
        const result = await voidMovement(f, movement.id);
        status(result, 200);
        expect(result.body.reversalJournalId).toBeNull();
        expect(result.body.compensatingExpenseId).toBeNull();
        expect(await prisma.journalEntry.count({ where: { tenantId: f.tenantId } })).toBe(0);
        expect(await prisma.expense.count({ where: { tenantId: f.tenantId } })).toBe(0);
        expect((await verifyTenantLedger(prisma, f.tenantId)).ok).toBe(true);
    }, 60_000);

    it('caja cerrada o período cerrado rechazan antes de modificar estado y dinero', async () => {
        const f = await fixture();
        const movement = await createMovement(f);
        const [year, month] = fiscalCivilDate(new Date()).period.split('-').map(Number);
        const period = await prisma.fiscalPeriod.create({ data: { tenantId: f.tenantId, year, month, status: 'CLOSED' } });
        let before = await state(f);
        const closedPeriod = await voidMovement(f, movement.id);
        expect([409, 423]).toContain(closedPeriod.status);
        expect(await state(f)).toBe(before);
        await prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
        status(await api(f.token, '/api/shifts/close', { shiftId: f.shiftId, declaredCash: '475.00', clientEventId: randomUUID() }), 200);
        before = await state(f);
        status(await voidMovement(f, movement.id), 409);
        expect(await state(f)).toBe(before);
    }, 60_000);

    it('tenant y rol ajenos no pueden anular el movimiento', async () => {
        const f = await fixture();
        const other = await fixture();
        const cashier = await inviteQaMember((path, body) => api(f.token, path, body), 'CASHIER');
        const movement = await createMovement(f);
        const before = await state(f);
        status(await voidMovement(other, movement.id), 404);
        status(await voidMovement({ ...f, token: cashier.token }, movement.id), 403);
        expect(await state(f)).toBe(before);
    }, 60_000);

    it('el período del asiento original cerrado impide una reversa en un mes abierto', async () => {
        const f = await fixture();
        const movement = await createMovement(f);
        const originalDate = new Date('2025-01-15T18:00:00Z');
        await prisma.journalEntry.updateMany({ where: { tenantId: f.tenantId, referenceId: movement.id }, data: { date: originalDate } });
        await prisma.fiscalPeriod.create({ data: { tenantId: f.tenantId, year: 2025, month: 1, status: 'CLOSED' } });
        const before = await state(f);
        status(await voidMovement(f, movement.id), 423);
        expect(await state(f)).toBe(before);
    }, 60_000);

    it('bloquea movimientos derivados aunque existan físicamente en la gaveta', async () => {
        const f = await fixture();
        for (const category of ['COBRO_CREDITO', 'DEVOLUCION', 'PAGO_PROVEEDOR', 'AGENTE_BANCARIO', 'VENTA_EFECTIVO']) {
            const row = await prisma.cashMovement.create({ data: {
                tenantId: f.tenantId, userId: f.userId, shiftId: f.shiftId,
                type: 'IN', amount: '10.00', currency: 'NIO', category, description: 'Fixture derivada',
            } });
            const before = await state(f);
            status(await voidMovement(f, row.id), 409);
            expect(await state(f)).toBe(before);
        }
    }, 60_000);

    it('el fallo contable revierte el void y no compensa el gasto', async () => {
        const f = await fixture();
        const movement = await createMovement(f);
        await prisma.account.updateMany({ where: { tenantId: f.tenantId, code: '5.2.1' }, data: { type: 'QA_UNSUPPORTED' } });
        const before = await state(f);
        const response = await voidMovement(f, movement.id);
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(await state(f)).toBe(before);
    }, 60_000);

    it('no adivina cómo revertir un asiento histórico ausente ni un void sin evidencia atómica', async () => {
        const f = await fixture();
        const movement = await createMovement(f, 'IN', 'INYECCION_CAPITAL');
        await prisma.journalEntry.updateMany({
            where: { tenantId: f.tenantId, referenceId: movement.id }, data: { referenceId: 'qa-evidencia-ausente' },
        });
        let before = await state(f);
        status(await voidMovement(f, movement.id), 409);
        expect(await state(f)).toBe(before);
        await prisma.cashMovement.updateMany({
            where: { id: movement.id, tenantId: f.tenantId },
            data: { isVoided: true, voidReason: 'Error documentado de captura', voidedBy: f.userId, voidedAt: new Date() },
        });
        before = await state(f);
        status(await voidMovement(f, movement.id), 409);
        expect(await state(f)).toBe(before);
    }, 60_000);

    it('no borra una entrada ya consumida cuando anularla dejaría la caja negativa', async () => {
        const f = await fixture();
        const incoming = await createMovement(f, 'IN', 'INYECCION_CAPITAL', '100.00');
        await createMovement(f, 'OUT', 'RETIRO_PERSONAL', '600.00');
        const before = await state(f);
        const response = await voidMovement(f, incoming.id);
        status(response, 409);
        expect(response.body.code).toBe('CASH_VOID_INSUFFICIENT_BALANCE');
        expect(await state(f)).toBe(before);
    }, 60_000);
});
