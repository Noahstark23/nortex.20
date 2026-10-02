import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { resolvePosCredit } from '../utils/posCredit';

const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const enabled = Boolean(base) && process.env.NORTEX_MYSQL_INTEGRATION === '1';
const qa = enabled ? describe.sequential : describe.skip;
type Response = { status: number; body: any };
type Fixture = { tenantId: string; token: string };

async function api(token: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
}
function status(response: Response, expected: number) {
    const safe = JSON.stringify(response.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value);
    expect(response.status, safe).toBe(expected);
}
async function fixture(label: string): Promise<Fixture> {
    const id = randomUUID();
    const registration = await api('', '/api/auth/register', {
        companyName: `QA Crédito ${label} ${id}`, email: `qa-credit-${id}@example.invalid`, password: `Qa-${randomUUID()}-Seguro!`, type: 'MISCELANEA',
    });
    status(registration, 200);
    const f = { tenantId: registration.body.tenant.id, token: registration.body.token };
    status(await api(f.token, '/api/shifts/open', { initialCash: 0 }), 200);
    return f;
}
async function snapshot(f: Fixture) {
    const where = { tenantId: f.tenantId };
    const [customers, sales, products, audits, kardex, entries, accounts] = await Promise.all([
        prisma.customer.findMany({ where, orderBy: { id: 'asc' }, take: 10 }),
        prisma.sale.findMany({ where, orderBy: { id: 'asc' }, include: { items: true }, take: 10 }),
        prisma.product.findMany({ where, orderBy: { id: 'asc' }, take: 10 }),
        prisma.auditLog.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.kardexMovement.findMany({ where, orderBy: { id: 'asc' }, take: 10 }),
        prisma.journalEntry.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } }, take: 10 }),
        prisma.account.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
    ]);
    return JSON.stringify({ customers, sales, products, audits, kardex, entries, accounts });
}
async function assertBalanced(f: Fixture) {
    const entries = await prisma.journalEntry.findMany({ where: { tenantId: f.tenantId }, include: { lines: true }, take: 10 });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
        const net = entry.lines.reduce((sum, line) => sum.plus(line.debit.toString()).minus(line.credit.toString()), new Decimal(0));
        expect(net.toFixed(4)).toBe('0.0000');
    }
}
qa('Crédito POS: HTTP y MySQL descartable', () => {
    beforeAll(() => {
        expect(['localhost', '127.0.0.1']).toContain(new URL(base!).hostname);
        expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/^\/nortex_(qa|quality|test)/);
        expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
    });
    afterAll(async () => { await prisma.$disconnect(); });
    it('crédito: Prisma devuelve strings y 900 + 1960 registra 2860 sin duplicar el replay offline', async () => {
        const f = await fixture('Crédito Decimal');
        const created = await api(f.token, '/api/customers', { name: 'Cliente sintético Decimal QA', creditLimit: '30000' });
        status(created, 200);
        const customerId = created.body.id;
        const makeProduct = async (price: number) => {
            const result = await api(f.token, '/api/products', { name: `Artículo sintético ${price}`, sku: `QA-CREDIT-${randomUUID()}`, price, cost: 0, stock: 3, unit: 'unidad', category: 'QA', ivaExento: false });
            status(result, 200);
            return result.body.id;
        };
        const priorProduct = await makeProduct(900);
        const productId = await makeProduct(1960);
        status(await api(f.token, '/api/sales', { items: [{ id: priorProduct, quantity: 1 }], paymentMethod: 'CREDIT', customerId, offlineId: randomUUID() }), 200);
        const listed = await api(f.token, `/api/customers?page=1&pageSize=20&search=${encodeURIComponent('Cliente sintético Decimal QA')}`);
        status(listed, 200);
        const row = listed.body.customers.find((item: any) => item.id === customerId);
        expect(row.currentDebt).toBe('900');
        expect(row.creditLimit).toBe('30000');
        expect(resolvePosCredit(row, '1960')?.projectedDebt).toBe('2860');
        const payload = { items: [{ id: productId, quantity: 1 }], paymentMethod: 'CREDIT', customerId, offlineId: randomUUID() };
        const sale = await api(f.token, '/api/sales', payload);
        status(sale, 200);
        expect(String(sale.body.total)).toBe('1960');
        const debt = await prisma.customer.findFirstOrThrow({ where: { id: customerId, tenantId: f.tenantId } });
        expect(debt.currentDebt.toString()).toBe('2860');
        const before = await snapshot(f);
        const replay = await api(f.token, '/api/sales', payload);
        status(replay, 200);
        expect(replay.body.id).toBe(sale.body.id);
        expect(await snapshot(f)).toBe(before);
        expect((await prisma.customer.findFirstOrThrow({ where: { id: customerId, tenantId: f.tenantId } })).currentDebt.toString()).toBe('2860');
        await assertBalanced(f);
    }, 60_000);

    it('crédito: permite el límite exacto de centavos y rechaza excederlo sin efectos', async () => {
        const f = await fixture('Centavos Decimal');
        const created = await api(f.token, '/api/customers', { name: 'Cliente sintético Centavos QA', creditLimit: '0.30' });
        status(created, 200);
        const customerId = created.body.id;
        for (const price of [0.1, 0.2, 0.01]) {
            const item = await api(f.token, '/api/products', { name: `Centavos QA ${price}`, sku: `QA-CENTS-${randomUUID()}`, price, cost: 0, stock: 2, unit: 'unidad', category: 'QA', ivaExento: false });
            status(item, 200);
            const before = await snapshot(f);
            const sale = await api(f.token, '/api/sales', { items: [{ id: item.body.id, quantity: 1 }], paymentMethod: 'CREDIT', customerId, offlineId: randomUUID() });
            if (price === 0.01) {
                status(sale, 402);
                expect(sale.body.code).toBe('CREDIT_LIMIT_EXCEEDED');
                expect(await snapshot(f)).toBe(before);
            } else status(sale, 200);
        }
        expect((await prisma.customer.findFirstOrThrow({ where: { id: customerId, tenantId: f.tenantId } })).currentDebt.toString()).toBe('0.3');
        await assertBalanced(f);
    }, 60_000);

});
