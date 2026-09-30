import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { seedChartOfAccounts } from '../backend/services/accounting';
import { asegurarBodegaPorDefecto } from '../backend/services/stockService';
import { executeSaleWithResult } from '../backend/services/salesService';
import { inviteQaMember } from './helpers/saleCorrectionQa';

// HTTP real y locks observables de InnoDB; no se reemplazan servicios del producto.
const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' && base ? describe.sequential : describe.skip;
type Actor = { tenantId: string; token: string; userId: string; shiftId: string; productId: string; warehouseId: string };
type Result = { status: number; body: any };
async function api(token: string, path: string, body?: unknown, method = 'POST'): Promise<Result> {
    const response = await fetch(`${base}${path}`, {
        method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: await response.json() };
}
function status(result: Result, expected: number) {
    expect(result.status, JSON.stringify(result.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value)).toBe(expected);
}
async function actor(tenantId: string, token: string, creatorToken = token): Promise<Actor> {
    const opened = await api(token, '/api/shifts/open', { initialCash: 100 });
    status(opened, 200);
    const product = await api(creatorToken, '/api/products', { name: 'Producto fiscal sintético', sku: randomUUID(),
        category: 'QA', price: 50, cost: 30, stock: 10, minStock: 0, unit: 'unidad',
        saleMode: 'COUNTED', quantityStep: 1, isPublished: false, ivaExento: false });
    status(product, 200);
    const rows = await prisma.productStock.findMany({ where: { tenantId, productId: product.body.id }, take: 10 });
    expect(rows).toHaveLength(1); expect(rows[0].stock).toBe(10);
    return { tenantId, token, userId: opened.body.userId, shiftId: opened.body.id,
        productId: product.body.id, warehouseId: rows[0].warehouseId };
}
async function fixture(count = 1): Promise<Actor[]> {
    const nonce = randomUUID();
    const registered = await api('', '/api/auth/register', { companyName: `QA fiscal ${nonce}`,
        email: `qa-fiscal-${nonce}@example.invalid`, password: `Qa-${randomUUID()}-Seguro!`, type: 'MISCELANEA' });
    status(registered, 200);
    const tenantId = registered.body.tenant.id;
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).fiscalRegime).toBe('GENERAL');
    // Evitar que el catálogo/bodega de primer uso oculten la carrera de numeración.
    await seedChartOfAccounts(tenantId);
    await asegurarBodegaPorDefecto(prisma, tenantId);
    const actors = [await actor(tenantId, registered.body.token)];
    for (let index = 1; index < count; index++) {
        const member = await inviteQaMember((path, body) => api(registered.body.token, path, body), 'CASHIER');
        actors.push(await actor(tenantId, member.token, registered.body.token));
    }
    return actors;
}
const payload = (f: Actor, offlineId = randomUUID(), quantity = 1) => ({
    items: [{ id: f.productId, quantity }], paymentMethod: 'CASH', offlineId,
});
async function configure(f: Actor, series: 'A' | 'B', rangeStart: number, rangeEnd: number) {
    status(await api(f.token, '/api/invoice-series', { series, rangeStart, rangeEnd }, 'PUT'), 200);
}
function signal() {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
async function blockedSales(f: Actor, requests: (() => Promise<Result>)[], minimumWaiters: number) {
    const counter = await prisma.invoiceSeries.findFirstOrThrow({ where: { tenantId: f.tenantId, isActive: true } });
    const held = signal(), release = signal();
    const blocker = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM InvoiceSeries WHERE id = ${counter.id} AND tenantId = ${f.tenantId} FOR UPDATE`;
        held.resolve();
        await release.promise;
    }, { timeout: 15_000, maxWait: 5_000 });
    // Capturar inmediatamente un rechazo: nunca dejar una tx huérfana si falla la barrera.
    const ready = Promise.race([held.promise, blocker.then(() => { throw new Error('El lock terminó prematuramente'); })]);
    let pending: Promise<Result>[] = [];
    let observed = 0;
    try {
        await ready;
        pending = requests.map(request => request());
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
            const [row] = await prisma.$queryRaw<Array<{ waiters: bigint }>>`
                SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiters
                FROM performance_schema.data_lock_waits w
                JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
                WHERE r.OBJECT_SCHEMA = DATABASE() AND r.OBJECT_NAME = 'InvoiceSeries'
                  AND (r.LOCK_DATA LIKE ${`%${counter.id}%`} OR r.LOCK_DATA LIKE ${`%${f.tenantId}%`})`;
            observed = Number(row.waiters);
            if (observed >= minimumWaiters) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    } finally { release.resolve(); await blocker; }
    const results = await Promise.all(pending);
    expect(observed, 'Ventas realmente esperando el correlativo de InnoDB').toBeGreaterThanOrEqual(minimumWaiters);
    console.info(JSON.stringify({ scenario: 'invoice-lock-barrier', observedWaiters: observed, requests: requests.length }));
    return results;
}
async function state(f: Actor) {
    const where = { tenantId: f.tenantId };
    const [series, sales, products, stocks, kardex, journals, accounts, audits, cash, shifts, ledger] = await Promise.all([
        prisma.invoiceSeries.findMany({ where, orderBy: { id: 'asc' }, take: 10 }),
        prisma.sale.findMany({ where, include: { items: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' }, take: 30 }),
        prisma.product.findMany({ where, orderBy: { id: 'asc' }, take: 30 }),
        prisma.productStock.findMany({ where, orderBy: { id: 'asc' }, take: 30 }),
        prisma.kardexMovement.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.journalEntry.findMany({ where, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' }, take: 30 }),
        prisma.account.findMany({ where, orderBy: { code: 'asc' }, take: 100 }),
        prisma.auditLog.findMany({ where, orderBy: { id: 'asc' }, take: 100 }),
        prisma.cashMovement.findMany({ where, orderBy: { id: 'asc' }, take: 30 }),
        prisma.shift.findMany({ where, orderBy: { id: 'asc' }, take: 10 }),
        prisma.ledgerHead.findUnique({ where: { tenantId: f.tenantId } }),
    ]);
    return JSON.stringify({ series, sales, products, stocks, kardex, journals, accounts, audits, cash, shifts, ledger });
}
const fixed = (value: { toString(): string }) => new Decimal(value.toString()).toFixed(4);
async function effects(actors: Actor[], soldActors = actors) {
    const where = { tenantId: actors[0].tenantId };
    const [sales, entries, audits, movements] = await Promise.all([
        prisma.sale.findMany({ where, include: { items: true }, take: 30 }),
        prisma.journalEntry.findMany({ where, include: { lines: { include: { account: true } } }, take: 30 }),
        prisma.auditLog.findMany({ where: { ...where, action: 'SALE_CREATED' }, take: 30 }),
        prisma.kardexMovement.findMany({ where: { ...where, type: 'SALE' }, take: 30 }),
    ]);
    // Totales detectan efectos sobrantes; luego se exige una correspondencia
    // uno a uno POR VENTA (un total correcto no puede ocultar otra venta huérfana).
    for (const rows of [sales, entries, audits, movements]) expect(rows).toHaveLength(soldActors.length);
    expect(await prisma.saleItem.count({ where: { sale: where } })).toBe(soldActors.length);
    expect(sales.flatMap(s => s.items.map(i => i.productId)).sort()).toEqual(soldActors.map(a => a.productId).sort());
    const parsedAudits = audits.map(audit => ({ audit, details: JSON.parse(audit.details) }));
    for (const sale of sales) {
        expect(sale.items).toHaveLength(1);
        const item = sale.items[0], owner = soldActors.find(a => a.productId === item.productId)!;
        expect(owner).toBeDefined();
        expect(sale).toMatchObject({ tenantId: owner.tenantId, soldById: owner.userId, shiftId: owner.shiftId,
            status: 'COMPLETED', paymentMethod: 'CASH', fiscalRegimeAtSale: 'GENERAL' });
        expect(fixed(sale.total)).toBe('50.0000'); expect(fixed(sale.vatAmountAtSale!)).toBe('6.5200');
        expect(item).toMatchObject({ saleId: sale.id, productId: owner.productId, quantity: 1, ivaExento: false });
        expect(fixed(item.priceAtSale)).toBe('50.0000'); expect(fixed(item.unitPriceExactAtSale!)).toBe('50.0000');
        expect(fixed(item.costAtSale)).toBe('30.0000');

        const linkedEntries = entries.filter(entry => entry.referenceType === 'SALE' && entry.referenceId === sale.id);
        expect(linkedEntries).toHaveLength(1);
        const entry = linkedEntries[0];
        expect(entry).toMatchObject({ tenantId: owner.tenantId, createdBy: owner.userId, isAutomatic: true });
        // Oracle fijo de la fixture GENERAL: una unidad C$50 IVA incluido y costo C$30.
        // No se copia ni invoca la fórmula productiva para construir el esperado.
        const lines = entry.lines.map(line => [line.account.code, fixed(line.debit), fixed(line.credit)])
            .sort((a, b) => a[0].localeCompare(b[0]));
        expect(entry.lines.every(line => line.account.tenantId === owner.tenantId)).toBe(true);
        expect(lines).toEqual([
            ['1.1.1', '50.0000', '0.0000'], ['1.1.4', '0.0000', '30.0000'],
            ['2.1.2', '0.0000', '6.5200'], ['4.1.1', '0.0000', '43.4800'], ['5.1.1', '30.0000', '0.0000'],
        ]);

        const linkedAudits = parsedAudits.filter(row => row.details.saleId === sale.id);
        expect(linkedAudits).toHaveLength(1);
        expect(linkedAudits[0].audit).toMatchObject({ tenantId: owner.tenantId, userId: owner.userId });
        expect(linkedAudits[0].details).toMatchObject({ saleId: sale.id, total: '50.00', vatAmount: '6.5200',
            fiscalRegime: 'GENERAL', source: 'POS', itemCount: 1, paymentMethod: 'CASH' });

        const linkedMovements = movements.filter(row => row.referenceType === 'SALE' && row.referenceId === sale.id);
        expect(linkedMovements).toHaveLength(1);
        expect(linkedMovements[0]).toMatchObject({ tenantId: owner.tenantId, productId: owner.productId,
            warehouseId: owner.warehouseId, userId: owner.userId, type: 'SALE', quantity: -1, stockBefore: 10, stockAfter: 9 });
    }
}
async function stock(f: Actor) {
    const [product, warehouses] = await Promise.all([
        prisma.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.tenantId } }),
        prisma.productStock.findMany({ where: { tenantId: f.tenantId, productId: f.productId },
            select: { id: true, warehouseId: true, stock: true }, orderBy: { id: 'asc' }, take: 10 }),
    ]);
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].warehouseId).toBe(f.warehouseId);
    expect(warehouses.reduce((sum, row) => sum.plus(row.stock), new Decimal(0)).toFixed(4)).toBe(fixed(product.stock));
    return { aggregate: product.stock, warehouses };
}
async function assertStock(f: Actor, expected: number) {
    const saved = await stock(f);
    expect(saved.aggregate).toBe(expected);
    expect(saved.warehouses[0].stock).toBe(expected);
}

qa('Numeración fiscal concurrente: HTTP + MySQL descartable', () => {
    beforeAll(() => {
        const db = new URL(process.env.DATABASE_URL!);
        const http = new URL(base!);
        expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
        expect(db.protocol).toBe('mysql:'); expect(http.protocol).toBe('http:');
        for (const url of [db, http]) expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
        expect(db.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    });
    afterAll(async () => { await prisma.$disconnect(); });

    it.each(['A', 'B'] as const)('tres cajeros esperan el mismo lock y reciben %s-501/502/503 sin duplicar efectos', async series => {
        const actors = await fixture(3); const f = actors[0];
        await configure(f, series, 501, 510);
        const results = await blockedSales(f, actors.map(a => () => api(a.token, '/api/sales', payload(a))), 3);
        results.forEach(r => { status(r, 200); expect(r.body.invoiceSeries).toBe(series); });
        expect(results.map(r => r.body.invoiceNumber).sort((a, b) => a - b)).toEqual([501, 502, 503]);
        expect(new Set(results.map(r => r.body.id)).size).toBe(3);
        expect((await prisma.invoiceSeries.findFirstOrThrow({ where: { tenantId: f.tenantId, series } })).lastNumber).toBe(503);
        for (const a of actors) await assertStock(a, 9);
        await effects(actors);
    }, 60_000);

    it('primer uso simultáneo sin serie crea una sola A y confirma números 1/2/3', async () => {
        const actors = await fixture(3); const f = actors[0];
        expect(await prisma.invoiceSeries.count({ where: { tenantId: f.tenantId } })).toBe(0);
        const results = await Promise.all(actors.map(a => api(a.token, '/api/sales', payload(a))));
        results.forEach(r => status(r, 200));
        expect(results.map(r => r.body.invoiceNumber).sort((a, b) => a - b)).toEqual([1, 2, 3]);
        const counters = await prisma.invoiceSeries.findMany({ where: { tenantId: f.tenantId }, take: 10 });
        expect(counters).toHaveLength(1); expect(counters[0]).toMatchObject({ series: 'A', lastNumber: 3 });
        for (const a of actors) await assertStock(a, 9);
        await effects(actors);
    }, 60_000);

    it('tres ventas disputan el último número: una confirma y dos rechazan sin efectos parciales', async () => {
        const actors = await fixture(3); const f = actors[0];
        await configure(f, 'B', 801, 801);
        const beforeStocks = await Promise.all(actors.map(stock));
        const results = await blockedSales(f, actors.map(a => () => api(a.token, '/api/sales', payload(a))), 3);
        expect(results.map(r => r.status).sort()).toEqual([200, 422, 422]);
        for (let index = 0; index < results.length; index++) {
            const r = results[index];
            if (r.status === 200) expect(r.body).toMatchObject({ invoiceSeries: 'B', invoiceNumber: 801 });
            else expect(r.body.code).toBe('INVOICE_RANGE_EXHAUSTED');
            const before = beforeStocks[index];
            const expected = r.status === 200 ? {
                aggregate: before.aggregate - 1,
                warehouses: before.warehouses.map(row => row.warehouseId === actors[index].warehouseId
                    ? { ...row, stock: row.stock - 1 } : row),
            } : before;
            expect(await stock(actors[index])).toEqual(expected);
        }
        expect((await prisma.invoiceSeries.findFirstOrThrow({ where: { tenantId: f.tenantId, series: 'B' } })).lastNumber).toBe(801);
        await effects(actors, actors.filter((_actor, index) => results[index].status === 200));
        const saved = await state(f);
        const rejected = await api(f.token, '/api/sales', payload(f));
        status(rejected, 422); expect(rejected.body.code).toBe('INVOICE_RANGE_EXHAUSTED');
        expect(await state(f)).toBe(saved);
    }, 60_000);

    it('fallo de auditoría al final de la venta revierte número, venta, stock y asiento; reintento usa ese número', async () => {
        const [f] = await fixture(); await configure(f, 'A', 901, 910);
        const saved = await state(f); const request = payload(f);
        const shift = await prisma.shift.findFirstOrThrow({ where: { tenantId: f.tenantId, status: 'OPEN' } });
        const fault = new Error('QA: fallo deliberado después de persistir auditoría');
        const transaction = prisma.$transaction.bind(prisma);
        let written: { number: number | null; stock: number; journals: number; audits: number } | undefined;
        // Sólo se inyecta una excepción después de la escritura REAL: ni la tx,
        // ni sus queries/resultados/servicios se simulan. InnoDB debe revertirlo todo.
        const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: any, options: any) =>
            transaction(async tx => operation(new Proxy(tx, {
                get(target, property) {
                    if (property !== 'auditLog') return Reflect.get(target, property);
                    return new Proxy(target.auditLog, {
                        get(delegate, method) {
                            if (method !== 'create') return Reflect.get(delegate, method);
                            return async (args: any) => {
                                const result = await delegate.create(args);
                                if (args.data.action === 'SALE_CREATED' && args.data.tenantId === f.tenantId) {
                                    const sale = await tx.sale.findFirstOrThrow({ where: { tenantId: f.tenantId } });
                                    const product = await tx.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.tenantId } });
                                    written = { number: sale.invoiceNumber, stock: product.stock,
                                        journals: await tx.journalEntry.count({ where: { tenantId: f.tenantId } }),
                                        audits: await tx.auditLog.count({ where: { tenantId: f.tenantId, action: 'SALE_CREATED' } }) };
                                    throw fault;
                                }
                                return result;
                            };
                        },
                    });
                },
            })), options)) as any);
        try {
            await expect(executeSaleWithResult(f.tenantId, shift.userId, shift.id, request)).rejects.toBe(fault);
            expect(written).toEqual({ number: 901, stock: 9, journals: 1, audits: 1 });
            expect(await state(f)).toBe(saved);
        } finally { spy.mockRestore(); }
        const confirmed = await api(f.token, '/api/sales', request); status(confirmed, 200);
        expect(confirmed.body).toMatchObject({ invoiceSeries: 'A', invoiceNumber: 901 });
        await assertStock(f, 9); await effects([f]);
    }, 60_000);

    it('tres reintentos del mismo offlineId confirman una sola venta; replay y conflicto no consumen otro número', async () => {
        const [f] = await fixture(); await configure(f, 'A', 1001, 1010);
        const request = payload(f);
        const results = await blockedSales(f, [1, 2, 3].map(() => () => api(f.token, '/api/sales', request)), 1);
        results.forEach(r => { status(r, 200); expect(r.body.invoiceNumber).toBe(1001); });
        expect(new Set(results.map(r => r.body.id)).size).toBe(1);
        expect((await prisma.invoiceSeries.findFirstOrThrow({ where: { tenantId: f.tenantId, series: 'A' } })).lastNumber).toBe(1001);
        await assertStock(f, 9); await effects([f]);
        const saved = await state(f);
        status(await api(f.token, '/api/sales', request), 200);
        expect(await state(f)).toBe(saved);
        status(await api(f.token, '/api/sales', payload(f, request.offlineId, 2)), 409);
        expect(await state(f)).toBe(saved);
    }, 60_000);

    it('dos tenants pueden confirmar A-1101 y el mismo offlineId sin compartir contador ni efectos', async () => {
        const [a] = await fixture(); const [b] = await fixture();
        await configure(a, 'A', 1101, 1110); await configure(b, 'A', 1101, 1110);
        const offlineId = randomUUID();
        const results = await Promise.all([a, b].map(f => api(f.token, '/api/sales', payload(f, offlineId))));
        results.forEach(r => { status(r, 200); expect(r.body.invoiceNumber).toBe(1101); });
        expect(results[0].body.id).not.toBe(results[1].body.id);
        for (const f of [a, b]) { await assertStock(f, 9); await effects([f]); }
    }, 60_000);
});
