import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/** HTTP real + MySQL descartable. No importa el servidor ni simula sus servicios. */
const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const enabled = Boolean(base) && process.env.NORTEX_MYSQL_INTEGRATION === '1';
const qa = enabled ? describe.sequential : describe.skip;
type Response = { status: number; body: any; cache: string | null };
type Fixture = { tenantId: string; userId: string; token: string; email: string; password: string; shiftId: string };
type Method = 'CASH' | 'CARD' | 'TRANSFER' | 'QR';

async function api(token: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text.slice(0, 300) }; }
    return { status: response.status, body: parsed, cache: response.headers.get('cache-control') };
}

function status(response: Response, expected: number) {
    // Un fallo de registro/login jamás vuelca tokens ni contraseñas al reporte.
    const diagnostic = JSON.stringify(response.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value);
    expect(response.status, diagnostic).toBe(expected);
}

async function fixture(label: string, options: { initialCash?: number; initialCashUsd?: string } = {}): Promise<Fixture> {
    const id = randomUUID();
    const email = `qa-pos-${id}@example.invalid`;
    const password = `Qa-${randomUUID()}-Seguro!`;
    const registration = await api('', '/api/auth/register', {
        companyName: `QA Integridad ${label} ${id}`, email, password, type: 'MISCELANEA',
    });
    status(registration, 200);
    const f = { tenantId: registration.body.tenant.id, userId: registration.body.user.id,
        token: registration.body.token, email, password, shiftId: '' };
    const opened = await api(f.token, '/api/shifts/open', { initialCash: options.initialCash ?? 500, initialCashUsd: options.initialCashUsd });
    status(opened, 200);
    f.shiftId = opened.body.id;
    return f;
}

async function product(f: Fixture, stock = 5) {
    const id = randomUUID();
    const result = await api(f.token, '/api/products', {
        name: `QA Integridad ${id}`, sku: `QA-POS-${id}`, category: 'QA', price: 50, cost: 30,
        stock, minStock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1,
        isPublished: false, ivaExento: false,
    });
    status(result, 200);
    return result.body.id as string;
}

const salePayload = (productId: string, paymentMethod: Method = 'CASH', quantity = 1, offlineId = randomUUID()) => ({
    items: [{ id: productId, quantity }], paymentMethod, offlineId,
});
const stock = async (f: Fixture, id: string) => (await prisma.product.findFirstOrThrow({ where: { id, tenantId: f.tenantId } })).stock;
const fixed = (value: Decimal.Value | { toString(): string }) => new Decimal(value.toString()).toFixed(4);

async function balances(f: Fixture): Promise<Record<string, string>> {
    const accounts = await prisma.account.findMany({ where: { tenantId: f.tenantId }, orderBy: { code: 'asc' }, take: 100 });
    return Object.fromEntries(accounts.map(account => [account.code, fixed(account.balance)]));
}

async function assertBalanced(f: Fixture) {
    const entries = await prisma.journalEntry.findMany({ where: { tenantId: f.tenantId }, include: { lines: true }, take: 100 });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
        expect(entry.lines.length).toBeGreaterThan(1);
        const net = entry.lines.reduce((sum, line) => sum.plus(line.debit.toString()).minus(line.credit.toString()), new Decimal(0));
        expect(net.toFixed(4), `Póliza ${entry.id}`).toBe('0.0000');
    }
}

async function snapshot(f: Fixture) {
    const where = { tenantId: f.tenantId };
    const [sales, products, shifts, audits, kardex, entries, returns, movements, accounts, refunds, inspections] = await Promise.all([
        prisma.sale.findMany({ where, orderBy: { id: 'asc' }, include: { items: true }, take: 100 }),
        prisma.product.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.shift.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.auditLog.findMany({ where, orderBy: { id: 'asc' }, take: 200 }),
        prisma.kardexMovement.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.journalEntry.findMany({ where, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } }, take: 100 }),
        prisma.productReturn.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.cashMovement.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        balances(f), prisma.returnRefund.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.returnInspection.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
    ]);
    return JSON.stringify({ sales, products, shifts, audits, kardex, entries, returns, movements, accounts, refunds, inspections });
}

qa('Auditoría UX y QA: HTTP, stock, caja y comprobante en MySQL real', () => {
    beforeAll(() => {
        const endpoint = new URL(base!);
        const database = new URL(process.env.DATABASE_URL!);
        const loopback = ['127.0.0.1', 'localhost', '[::1]'];
        expect(endpoint.protocol).toBe('http:');
        expect(loopback).toContain(endpoint.hostname);
        expect(database.protocol).toBe('mysql:');
        expect(loopback).toContain(database.hostname);
        expect(database.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    });
    afterAll(async () => { await prisma.$disconnect(); });

    it('la apertura C$ 200 queda en el turno, la auditoría y el monitor', async () => {
        const f = await fixture('fondo-apertura', { initialCash: 200 });
        const current = await api(f.token, '/api/shifts/current');
        status(current, 200);
        expect(current.body.id).toBe(f.shiftId);
        expect(fixed(current.body.initialCash)).toBe('200.0000');
        const monitor = await api(f.token, '/api/shifts/monitor');
        status(monitor, 200);
        expect(monitor.body.activeShifts.find((shift: { id: string }) => shift.id === f.shiftId)).toMatchObject({ initialCash: 200 });
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: 'SHIFT_OPENED' } });
        expect(JSON.parse(audit.details!).after).toMatchObject({ shiftId: f.shiftId, initialCash: '200' });
        expect((await api(f.token, '/api/shifts/open', { initialCash: 0 })).status).toBe(400);
        expect(await prisma.shift.count({ where: { tenantId: f.tenantId, status: 'OPEN' } })).toBe(1);
    });

    it('el stock inicial ingresa al libro antes de vender y no deja inventario negativo', async () => {
        const f = await fixture('apertura-inventario');
        const productId = await product(f, 5);
        const before = await balances(f);
        expect(before['1.1.4']).toBe('150.0000');
        expect(before['3.1.4']).toBe('150.0000');
        const opening = await prisma.journalEntry.findFirst({
            where: { tenantId: f.tenantId, referenceId: productId, referenceType: 'INITIAL_INVENTORY' },
            include: { lines: { include: { account: true } } },
        });
        expect(opening?.lines.map(line => [line.account.code, fixed(line.debit), fixed(line.credit)])).toEqual([
            ['1.1.4', '150.0000', '0.0000'],
            ['3.1.4', '0.0000', '150.0000'],
        ]);
        status(await api(f.token, '/api/sales', salePayload(productId, 'CASH', 1)), 200);
        expect(await stock(f, productId)).toBe(4);
        expect((await balances(f))['1.1.4']).toBe('120.0000');
        await assertBalanced(f);
    });

    it('recupera una copia fiel del comprobante por tenant sin segunda venta ni efectos', async () => {
        const owner = await fixture('copia-comprobante');
        const other = await fixture('copia-otro-tenant');
        const productId = await product(owner, 5);
        const sold = await api(owner.token, '/api/sales', salePayload(productId, 'CASH', 2));
        status(sold, 200);
        const before = await snapshot(owner);
        const receipt = await api(owner.token, `/api/sales/${sold.body.id}/receipt`);
        status(receipt, 200);
        expect(receipt.body).toMatchObject({ id: sold.body.id, paymentMethod: 'CASH' });
        expect(fixed(receipt.body.total)).toBe(fixed(sold.body.total));
        expect(receipt.body.items).toHaveLength(1);
        expect(receipt.body.items[0]).toMatchObject({ quantity: 2 });
        expect(receipt.body.items[0]).not.toHaveProperty('productId');
        expect(receipt.body.tenant.businessName).toContain('copia-comprobante');
        status(await api(other.token, `/api/sales/${sold.body.id}/receipt`), 404);
        expect(await snapshot(owner)).toBe(before);
    });

    it('el catálogo de ejemplo ingresa existencias y apertura por conciliar una sola vez', async () => {
        const f = await fixture('catalogo-ejemplo');
        const loaded = await api(f.token, '/api/onboarding/seed-catalog', {});
        status(loaded, 200);
        const products = await prisma.product.findMany({ where: { tenantId: f.tenantId }, take: 100 });
        expect(products.length).toBe(loaded.body.count);
        const value = products.reduce((sum, product) => sum.plus(new Decimal(product.stock.toString()).mul(product.cost.toString())), new Decimal(0)).toFixed(4);
        const account = await balances(f);
        expect(account['1.1.4']).toBe(value);
        expect(account['3.1.4']).toBe(value);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.tenantId, referenceType: 'SEED_CATALOG_OPENING' } })).toBe(products.length);
        expect((await api(f.token, '/api/onboarding/seed-catalog', {})).status).toBe(409);
        expect((await balances(f))['1.1.4']).toBe(value);
        await assertBalanced(f);
    });

});
