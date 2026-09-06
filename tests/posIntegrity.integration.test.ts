import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { approveQaCorrection, inviteQaMember } from './helpers/saleCorrectionQa';

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

async function fixture(label: string, initialCashUsd?: string): Promise<Fixture> {
    const id = randomUUID();
    const email = `qa-pos-${id}@example.invalid`;
    const password = `Qa-${randomUUID()}-Seguro!`;
    const registration = await api('', '/api/auth/register', {
        companyName: `QA Integridad ${label} ${id}`, email, password, type: 'MISCELANEA',
    });
    status(registration, 200);
    const f = { tenantId: registration.body.tenant.id, userId: registration.body.user.id,
        token: registration.body.token, email, password, shiftId: '' };
    const opened = await api(f.token, '/api/shifts/open', { initialCash: 500, initialCashUsd });
    status(opened, 200);
    f.shiftId = opened.body.id;
    return f;
}

const user = (f: Fixture, role: 'MANAGER' | 'CASHIER' | 'VIEWER') => inviteQaMember((path, body) => api(f.token, path, body), role);

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

async function approvedReturn(f: Fixture, saleId: string, saleItemId: string, method: Method, quantity = 2, disposition: 'RESTOCK' | 'QUARANTINE' = 'RESTOCK') {
    const approver = await user(f, 'MANAGER');
    const reason = 'Devolución completa autorizada en QA';
    const correctionRequestId = await approveQaCorrection((path, body) => api(f.token, path, body), approver, {
        saleId, kind: 'RETURN', reason, resolution: 'REFUND', refundMethod: method,
        lines: [{ saleItemId, quantity: String(quantity), disposition }],
    });
    return { correctionRequestId, clientEventId: randomUUID(), saleId,
        items: [{ saleItemId, quantity }], reason, refundMethod: method };
}

qa('Integridad POS: HTTP, stock y contabilidad en MySQL real', () => {
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

    it('movimiento manual rechaza USD y moneda inválida sin efectos en gaveta o contabilidad', async () => {
        const f = await fixture('moneda manual', '20.00');
        const state = async () => JSON.stringify({
            snapshot: await snapshot(f),
            expenses: await prisma.expense.findMany({ where: { tenantId: f.tenantId }, orderBy: { id: 'asc' }, take: 20 }),
            ledgerHead: await prisma.ledgerHead.findUnique({ where: { tenantId: f.tenantId } }),
        });
        const before = await state();
        for (const type of ['IN', 'OUT']) {
            const rejected = await api(f.token, '/api/cash-movements', {
                type, amount: '10.00', currency: 'USD',
                category: type === 'OUT' ? 'GASTO_OPERATIVO' : 'INYECCION_CAPITAL',
                description: 'No convertir USD a NIO silenciosamente',
            });
            status(rejected, 409);
            expect(rejected.body.code).toBe('CASH_MOVEMENT_USD_UNSUPPORTED');
            expect(await state()).toBe(before);
        }
        for (const currency of ['EUR', '', null]) {
            const rejected = await api(f.token, '/api/cash-movements', {
                type: 'OUT', amount: '10.00', currency, category: 'GASTO_OPERATIVO',
                description: 'Moneda inválida rechazada',
            });
            status(rejected, 400);
            expect(rejected.body.details.currency).toBeInstanceOf(Array);
            expect(await state()).toBe(before);
        }
    }, 60_000);

    it('movimientos NIO explícito y legado mantienen centavos exactos en gaveta, gasto y asiento', async () => {
        const f = await fixture('NIO manual');
        for (const [amount, currency] of [['1.20', undefined], ['2.30', 'NIO']] as const) {
            const saved = await api(f.token, '/api/cash-movements', {
                type: 'OUT', amount, ...(currency === undefined ? {} : { currency }),
                category: 'GASTO_OPERATIVO', description: 'Gasto operativo sintético exacto',
            });
            status(saved, 200);
            const movement = await prisma.cashMovement.findFirstOrThrow({ where: { id: saved.body.id, tenantId: f.tenantId } });
            expect(movement.currency).toBe('NIO');
            expect(movement.amount.toFixed(2)).toBe(amount);
            expect(movement.shiftId).toBe(f.shiftId);
            const expense = await prisma.expense.findFirstOrThrow({ where: { id: movement.expenseId!, tenantId: f.tenantId } });
            expect(expense.amount.toFixed(2)).toBe(amount);
            const journal = await prisma.journalEntry.findFirstOrThrow({
                where: { referenceId: movement.id, tenantId: f.tenantId, referenceType: 'CASH_OUT' },
                include: { lines: { include: { account: true } } },
            });
            expect(journal.lines.map(line => ({ account: line.account.code, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) }))
                .sort((a, b) => a.account.localeCompare(b.account))).toEqual([
                { account: '1.1.1', debit: '0.00', credit: amount },
                { account: '5.2.1', debit: amount, credit: '0.00' },
            ]);
        }
        expect((await balances(f))['1.1.1']).toBe('-3.5000');
        expect((await balances(f))['5.2.1']).toBe('3.5000');
        expect(await prisma.cashMovement.count({ where: { tenantId: f.tenantId } })).toBe(2);
        expect(await prisma.expense.count({ where: { tenantId: f.tenantId } })).toBe(2);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'CASH_OUT' } })).toBe(2);
        await assertBalanced(f);
    }, 60_000);

    it('movimiento NIO limita Decimal(10,2): rechaza fracciones y exceso, conserva el máximo exacto', async () => {
        const f = await fixture('límite moneda manual');
        const before = await snapshot(f);
        const expenseCount = await prisma.expense.count({ where: { tenantId: f.tenantId } });
        for (const amount of ['0.001', '10.001', '99999999.999', '100000000.00']) {
            const rejected = await api(f.token, '/api/cash-movements', {
                type: 'IN', amount, currency: 'NIO', category: 'INYECCION_CAPITAL',
                description: 'Importe no persistible',
            });
            status(rejected, 400);
            expect(rejected.body.details.amount).toBeInstanceOf(Array);
            expect(await snapshot(f)).toBe(before);
            expect(await prisma.expense.count({ where: { tenantId: f.tenantId } })).toBe(expenseCount);
        }
        const saved = await api(f.token, '/api/cash-movements', {
            type: 'IN', amount: '99999999.99', currency: 'NIO', category: 'INYECCION_CAPITAL',
            description: 'Máximo permitido sintético',
        });
        status(saved, 200);
        const movement = await prisma.cashMovement.findFirstOrThrow({ where: { id: saved.body.id, tenantId: f.tenantId } });
        expect(movement.currency).toBe('NIO');
        expect(movement.amount.toFixed(2)).toBe('99999999.99');
        expect((await balances(f))['1.1.1']).toBe('99999999.9900');
        expect(await prisma.expense.count({ where: { tenantId: f.tenantId } })).toBe(expenseCount);
        await assertBalanced(f);
    }, 60_000);

    it.each<Method>(['CASH', 'CARD', 'TRANSFER', 'QR'])('%s: venta → aprobación → devolución → reembolso conserva saldos y stock', async method => {
        const f = await fixture(method);
        const productId = await product(f);
        const sale = await api(f.token, '/api/sales', salePayload(productId, method, 2));
        status(sale, 200);
        expect(fixed(sale.body.total)).toBe('100.0000');
        expect(await stock(f, productId)).toBe(3);
        const afterSale = await balances(f);
        const tender = method === 'CASH' ? '1.1.1' : '1.1.2';
        const other = method === 'CASH' ? '1.1.2' : '1.1.1';
        expect(afterSale[tender]).toBe('100.0000');
        expect(afterSale[other]).toBe('0.0000');
        expect(afterSale['1.1.4']).toBe('-60.0000');
        expect(afterSale['5.1.1']).toBe('60.0000');
        const saleLine = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.body.id, sale: { tenantId: f.tenantId } } });
        const payload = await approvedReturn(f, sale.body.id, saleLine.id, method);
        const returned = await api(f.token, '/api/returns', payload);
        status(returned, 200);
        expect(fixed(returned.body.total)).toBe('100.0000');
        expect(await stock(f, productId)).toBe(5);
        const refund = await prisma.returnRefund.findFirstOrThrow({ where: { tenantId: f.tenantId, productReturnId: returned.body.id } });
        expect(refund.method).toBe(method);
        expect(fixed(refund.amount)).toBe('100.0000');
        expect(refund.status).toBe(method === 'CASH' ? 'COMPLETED' : 'PENDING');
        if (method !== 'CASH') {
            const pending = await balances(f);
            expect(pending[tender]).toBe('100.0000');
            expect(pending['2.1.13']).toBe('100.0000');
            const settled = await api(f.token, `/api/return-refunds/${refund.id}/complete`, {
                externalReference: `QA-${randomUUID()}`, evidenceNote: 'Simulación QA de evidencia de reembolso; ningún proveedor externo',
            });
            status(settled, 200);
            expect(settled.body.status).toBe('COMPLETED');
        }
        const final = await balances(f);
        for (const account of ['1.1.1', '1.1.2', '1.1.4', '2.1.2', '2.1.13', '5.1.1']) expect(final[account], account).toBe('0.0000');
        expect(new Decimal(final['4.1.1']).plus(final['4.1.2']).toFixed(4)).toBe('0.0000');
        expect(await prisma.cashMovement.count({ where: { tenantId: f.tenantId, category: 'DEVOLUCION' } })).toBe(method === 'CASH' ? 1 : 0);
        const saved = await snapshot(f);
        const replay = await api(f.token, '/api/returns', payload);
        status(replay, 200);
        expect(replay.body.id).toBe(returned.body.id);
        expect(replay.body.idempotentReplay).toBe(true);
        expect(await snapshot(f)).toBe(saved);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'SALE_CREATED' } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'RETURN_CREATED' } })).toBe(1);
        await assertBalanced(f);
    }, 60_000);

    it('dos liberaciones concurrentes de cuarentena restituyen stock una sola vez', async () => {
        const f = await fixture('cuarentena');
        const productId = await product(f);
        const sale = await api(f.token, '/api/sales', salePayload(productId, 'CASH', 2));
        status(sale, 200);
        const saleItem = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.body.id, sale: { tenantId: f.tenantId } } });
        const payload = await approvedReturn(f, sale.body.id, saleItem.id, 'CASH', 2, 'QUARANTINE');
        status(await api(f.token, '/api/returns', payload), 200);
        expect(await stock(f, productId)).toBe(3);
        const inspection = await prisma.returnInspection.findFirstOrThrow({ where: { tenantId: f.tenantId, productId, status: 'PENDING' } });
        const resolve = () => api(f.token, `/api/return-inspections/${inspection.id}/resolve`, {
            resolution: 'RESTOCK', reason: 'Inspección sanitaria completada en fixture QA',
        });
        // Simula evidencia histórica dañada: falla después de reclamar la fila.
        // El rollback debe devolverla a PENDING, sin autor/fecha de resolución.
        await prisma.returnInspection.updateMany({ where: { id: inspection.id, tenantId: f.tenantId }, data: {
            batchEvidence: { ...(inspection.batchEvidence as Record<string, any>), aggregateOnlyQuantity: '1' },
        } });
        const beforeRejectedRelease = await snapshot(f);
        const rejectedRelease = await resolve();
        status(rejectedRelease, 409);
        expect(rejectedRelease.body.code).toBe('INSPECTION_EVIDENCE_INVALID');
        expect(await snapshot(f)).toBe(beforeRejectedRelease);
        const stillPending = await prisma.returnInspection.findFirstOrThrow({ where: { id: inspection.id, tenantId: f.tenantId } });
        expect(stillPending).toMatchObject({ status: 'PENDING', resolvedBy: null, resolvedAt: null, resolutionReason: null });
        await prisma.returnInspection.updateMany({ where: { id: inspection.id, tenantId: f.tenantId },
            data: { batchEvidence: inspection.batchEvidence as any } });
        const results = await Promise.all([resolve(), resolve()]);
        const result = {
            statuses: results.map(response => response.status).sort(), stock: await stock(f, productId),
            movements: await prisma.kardexMovement.count({ where: { tenantId: f.tenantId, referenceId: inspection.id } }),
            journals: await prisma.journalEntry.count({ where: { tenantId: f.tenantId, referenceId: inspection.id } }),
            audits: await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'RETURN_INSPECTION_RESOLVED' } }),
        };
        expect(result).toEqual({ statuses: [200, 409], stock: 5, movements: 1, journals: 1, audits: 1 });
    }, 60_000);

    it('dos ventas concurrentes con mismo offlineId confirman una sola vez; contenido divergente da 409', async () => {
        const f = await fixture('replay');
        const productId = await product(f);
        const payload = salePayload(productId);
        const pair = await Promise.all([api(f.token, '/api/sales', payload), api(f.token, '/api/sales', payload)]);
        pair.forEach(response => status(response, 200));
        expect(pair[0].body.id).toBe(pair[1].body.id);
        expect(await stock(f, productId)).toBe(4);
        expect(await prisma.sale.count({ where: { tenantId: f.tenantId } })).toBe(1);
        expect(await prisma.kardexMovement.count({ where: { tenantId: f.tenantId, referenceId: pair[0].body.id } })).toBe(1);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.tenantId, referenceId: pair[0].body.id } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'SALE_CREATED' } })).toBe(1);
        const before = await snapshot(f);
        const changed = await api(f.token, '/api/sales', { ...payload, items: [{ id: productId, quantity: 2 }] });
        status(changed, 409);
        expect(changed.body.code).toBe('OFFLINE_PAYLOAD_MISMATCH');
        expect(await snapshot(f)).toBe(before);
        await assertBalanced(f);
    }, 60_000);

    it('offlineId divergente concurrente tiene un ganador y un 409 sin efectos del perdedor', async () => {
        const f = await fixture('conflicto');
        const productId = await product(f);
        const payload = salePayload(productId);
        const pair = await Promise.all([api(f.token, '/api/sales', payload),
            api(f.token, '/api/sales', { ...payload, items: [{ id: productId, quantity: 2 }] })]);
        expect(pair.map(response => response.status).sort()).toEqual([200, 409]);
        expect(pair.find(response => response.status === 409)!.body.code).toBe('OFFLINE_PAYLOAD_MISMATCH');
        const winner = pair.find(response => response.status === 200)!;
        const quantity = new Decimal(winner.body.total).div(50).toNumber();
        expect(await stock(f, productId)).toBe(5 - quantity);
        expect(await prisma.sale.count({ where: { tenantId: f.tenantId } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'SALE_CREATED' } })).toBe(1);
        expect((await balances(f))['1.1.1']).toBe(fixed(winner.body.total));
    }, 60_000);

    it('dos cajeros compiten por la última unidad: solo una venta y stock cero', async () => {
        const f = await fixture('última unidad');
        const second = await user(f, 'CASHIER');
        status(await api(second.token, '/api/shifts/open', { initialCash: 0 }), 200);
        const productId = await product(f, 1);
        const pair = await Promise.all([api(f.token, '/api/sales', salePayload(productId)), api(second.token, '/api/sales', salePayload(productId))]);
        expect(pair.filter(response => response.status === 200)).toHaveLength(1);
        const rejected = pair.find(response => response.status !== 200)!;
        status(rejected, 422);
        expect(rejected.body.code).toBe('INSUFFICIENT_STOCK');
        expect(await stock(f, productId)).toBe(0);
        expect(await prisma.sale.count({ where: { tenantId: f.tenantId } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'SALE_CREATED' } })).toBe(1);
        expect((await balances(f))['1.1.1']).toBe('50.0000');
    }, 60_000);

    it('cierre con reporte conserva USD4 y repite solo la identidad y el contenido originales', async () => {
        const f = await fixture('reporte idempotente USD', '20.1234');
        const productId = await product(f);
        status(await api(f.token, '/api/sales', salePayload(productId)), 200);
        const payload = {
            shiftId: f.shiftId, clientEventId: randomUUID(),
            declaredCash: '550.00', declaredCashUsd: '20.1235', auditNotes: 'Arqueo QA exacto',
        };
        const closed = await api(f.token, '/api/shifts/close', payload);
        status(closed, 200);
        expect(closed.body.idempotentReplay).toBe(false);
        expect(closed.body.closeReport.report.cash).toMatchObject({
            expectedNio: '550.00', countedNio: '550.00', differenceNio: '0.00',
            openingUsd: '20.1234', expectedUsd: '20.1234', countedUsd: '20.1235', differenceUsd: '0.0001',
        });
        const persistedShift = await prisma.shift.findFirstOrThrow({ where: { id: f.shiftId, tenantId: f.tenantId } });
        expect(fixed(persistedShift.finalCashDeclaredUsd!)).toBe('20.1235');
        expect(fixed(persistedShift.systemExpectedUsd!)).toBe('20.1234');
        expect(fixed(persistedShift.differenceUsd!)).toBe('0.0001');
        expect(persistedShift.closeEventId).toBe(payload.clientEventId);
        expect(persistedShift.closePayloadHash).toMatch(/^[a-f0-9]{64}$/);
        const persistedReport = await prisma.shiftCloseReport.findFirstOrThrow({ where: { shiftId: f.shiftId, tenantId: f.tenantId } });
        expect(persistedReport.report).toEqual(closed.body.closeReport.report);
        expect(persistedReport.contentHash).toBe(closed.body.closeReport.contentHash);
        const closedAudit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: 'SHIFT_CLOSED' } });
        expect(JSON.parse(closedAudit.details)).toMatchObject({
            closeEventId: payload.clientEventId, closePayloadHash: persistedShift.closePayloadHash,
            expectedUsd: '20.1234', countedUsd: '20.1235', differenceUsd: '0.0001',
        });
        const beforeRetries = await snapshot(f);
        const replay = await api(f.token, '/api/shifts/close', {
            ...payload, declaredCash: '550.0', auditNotes: '  Arqueo QA exacto  ',
        });
        status(replay, 200);
        expect(replay.body.idempotentReplay).toBe(true);
        expect(replay.body.closeReport).toEqual(closed.body.closeReport);
        for (const change of [
            { declaredCash: '549.99' }, { declaredCashUsd: '20.1236' },
            { auditNotes: 'Otra intención' }, { clientEventId: randomUUID() },
        ]) {
            status(await api(f.token, '/api/shifts/close', { ...payload, ...change }), 409);
        }
        expect(await snapshot(f)).toBe(beforeRetries);
        expect(await prisma.shiftCloseReport.count({ where: { shiftId: f.shiftId, tenantId: f.tenantId } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: f.tenantId, action: 'SHIFT_CLOSED' } })).toBe(1);
        const afterReport = await prisma.shiftCloseReport.findFirstOrThrow({ where: { shiftId: f.shiftId, tenantId: f.tenantId } });
        expect(afterReport).toEqual(persistedReport);
        const consulted = await api(f.token, `/api/reports/shifts/${f.shiftId}`);
        status(consulted, 200);
        expect(consulted.body.contentHash).toBe(persistedReport.contentHash);
        await assertBalanced(f);
    }, 60_000);

    it.each([0, 1, 2])('venta contra cierre, intercalado %i: el cierre incluye toda venta que confirma', async iteration => {
        const f = await fixture(`cierre ${iteration}`);
        const productId = await product(f, 1);
        const sell = () => api(f.token, '/api/sales', salePayload(productId));
        const close = () => api(f.token, '/api/shifts/close', { shiftId: f.shiftId, declaredCash: 500, clientEventId: randomUUID() });
        const pair = iteration % 2 === 0 ? await Promise.all([sell(), close()]) : (await Promise.all([close(), sell()])).reverse();
        status(pair[1], 200);
        expect([200, 400, 409]).toContain(pair[0].status);
        const sold = pair[0].status === 200;
        const shift = await prisma.shift.findFirstOrThrow({ where: { id: f.shiftId, tenantId: f.tenantId } });
        expect(shift.status).toBe('CLOSED');
        expect(fixed(shift.systemExpectedCash!)).toBe(sold ? '550.0000' : '500.0000');
        expect(await stock(f, productId)).toBe(sold ? 0 : 1);
        expect(await prisma.sale.count({ where: { tenantId: f.tenantId, shiftId: f.shiftId } })).toBe(sold ? 1 : 0);
        const before = await snapshot(f);
        const afterClose = await sell();
        expect([400, 409]).toContain(afterClose.status);
        expect(afterClose.body.code).toBe('NO_SHIFT');
        expect(await snapshot(f)).toBe(before);
    }, 60_000);

    it('rechaza otro tenant y rol VIEWER sin dinero, stock ni auditoría de negocio adicionales', async () => {
        const f = await fixture('aislamiento');
        const foreign = await fixture('tenant ajeno');
        const productId = await product(f);
        const foreignProductId = await product(foreign);
        status(await api(foreign.token, '/api/sales', salePayload(foreignProductId)), 200);
        const payload = salePayload(productId);
        const sale = await api(f.token, '/api/sales', payload);
        status(sale, 200);
        const before = await snapshot(f);
        const foreignBefore = await snapshot(foreign);
        const crossSale = await api(foreign.token, '/api/sales', { ...payload, tenantId: f.tenantId });
        expect([400, 404]).toContain(crossSale.status);
        const crossEvidence = await api(foreign.token, `/api/sales/offline-evidence/${payload.offlineId}`);
        status(crossEvidence, 200);
        expect(crossEvidence.body.status).toBe('not_found');
        status(await api('', `/api/sales/offline-evidence/${payload.offlineId}`), 401);
        await prisma.user.updateMany({ where: { id: f.userId, tenantId: f.tenantId }, data: { role: 'VIEWER' } });
        try {
            status(await api(f.token, '/api/sales', salePayload(productId)), 403);
            status(await api(f.token, `/api/sales/offline-evidence/${payload.offlineId}`), 403);
        } finally {
            await prisma.user.updateMany({ where: { id: f.userId, tenantId: f.tenantId }, data: { role: 'ADMIN' } });
        }
        expect(await snapshot(f)).toBe(before);
        expect(await snapshot(foreign)).toBe(foreignBefore);
    }, 60_000);

    it('evidencia offline lee ID event y legado crudo, limita al autor y no escribe', async () => {
        const f = await fixture('evidencia');
        const another = await user(f, 'CASHIER');
        const productId = await product(f);
        const event = salePayload(productId);
        const persisted = await api(f.token, '/api/sales', event);
        status(persisted, 200);
        const stored = await prisma.sale.findFirstOrThrow({ where: { id: persisted.body.id, tenantId: f.tenantId } });
        expect(stored.offlineId).toBe(`event:${createHash('sha256').update(f.tenantId).update('\0').update(event.offlineId).digest('hex')}`);
        // Historia sintética deliberada: el endpoint debe poder leer filas legacy sin huella.
        const rawId = randomUUID();
        const legacy = await prisma.sale.create({ data: {
            tenantId: f.tenantId, soldById: f.userId, shiftId: f.shiftId, total: '12.00', status: 'COMPLETED',
            paymentMethod: 'CASH', offlineId: rawId, offlinePayloadHash: null,
        } });
        const before = await snapshot(f);
        for (const [reference, saleId, fingerprint] of [[event.offlineId, persisted.body.id, true], [rawId, legacy.id, false]] as const) {
            const result = await api(f.token, `/api/sales/offline-evidence/${reference}`);
            status(result, 200);
            expect(result.cache).toContain('no-store');
            expect(result.body.status).toBe('recorded');
            expect(result.body.record.saleId).toBe(saleId);
            expect(result.body.record.hasReplayFingerprint).toBe(fingerprint);
            expect(result.body.record).not.toHaveProperty('offlinePayloadHash');
            const wrongSeller = await api(another.token, `/api/sales/offline-evidence/${reference}`);
            status(wrongSeller, 200);
            expect(wrongSeller.body.status).toBe('not_found');
        }
        const missing = await api(f.token, `/api/sales/offline-evidence/${randomUUID()}`);
        status(missing, 200);
        expect(missing.body.status).toBe('not_found');
        expect(await snapshot(f)).toBe(before);
    }, 60_000);
});
