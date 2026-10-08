import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStockDelta } from '../backend/services/stockService';
import { lockWarehouseTopology } from '../backend/services/warehouseTopologyService';

const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = base ? describe.sequential : describe.skip;
let db: PrismaClient;
let token = ''; let tenantId = ''; let productId = ''; let principal = ''; let secondary = ''; let destination = '';
const api = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
};
const okay = (res: { status: number; body: unknown }, status: number) => expect(res.status, JSON.stringify(res.body)).toBe(status);
const book = async (warehouseId: string) => {
    const res = await api(`/api/warehouses/${warehouseId}/stock`); okay(res, 200);
    return Number(res.body.data.items.find((row: any) => row.productId === productId)?.stock ?? 0);
};
const createCount = async (warehouseId: string) => {
    const res = await api('/api/stock-counts', 'POST', { warehouseId, scope: 'CATEGORY', category: 'QA Topología' }); okay(res, 201); return res.body.count.id as string;
};
const capture = async (countId: string, counted: number) => {
    const res = await api(`/api/stock-counts/${countId}/count`, 'PATCH', { productId, counted }); okay(res, 200); return res;
};

qaDescribe('HTTP/MySQL: conteos y configuración preservan ubicación física', () => {
    beforeAll(async () => {
        if (process.env.NORTEX_QA_DATABASE_ACK !== 'disposable-database' || !/nortex_(?:qa|quality|test)/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('La prueba requiere MySQL descartable reconocido.');
        db = new PrismaClient();
        const run = crypto.randomUUID();
        const registered = await api('/api/auth/register', 'POST', { companyName: `QA Topología ${run}`, email: `qa-topology-${run}@example.invalid`, password: `Qa-${run}-Seguro!`, type: 'FERRETERIA' }); okay(registered, 200); token = registered.body.token;
        const wh = await api('/api/warehouses'); okay(wh, 200); principal = wh.body.data.find((row: any) => row.isDefault).id;
        const second = await api('/api/warehouses', 'POST', { name: `Secundaria ${run}` }); okay(second, 201); secondary = second.body.data.id;
        const target = await api('/api/warehouses', 'POST', { name: `Nueva principal ${run}` }); okay(target, 201); destination = target.body.data.id;
        const product = await api('/api/products', 'POST', { name: `QA Topología Producto ${run}`, sku: `TOPO-${run}`, category: 'QA Topología', price: 20, cost: 5, stock: 0, minStock: 0, unit: 'unidad', isPublished: false }); okay(product, 200); productId = product.body.id;
        const fixture = await db.product.findFirstOrThrow({ where: { id: productId, sku: `TOPO-${run}` }, select: { tenantId: true } }); tenantId = fixture.tenantId;
        // Fixture legado exclusiva del tenant sintético: agregado 10, secundaria 3,
        // principal implícita 7. Sin tocar otras filas ni usar datos de usuarios.
        await db.$transaction(async tx => {
            await tx.product.updateMany({ where: { id: productId, tenantId }, data: { stock: 10 } });
            await tx.productStock.deleteMany({ where: { tenantId, productId } });
            await tx.productStock.create({ data: { tenantId, productId, warehouseId: secondary, stock: 3 } });
        });
    }, 120_000);
    afterAll(async () => { await db?.$disconnect(); });

    it('cierra la principal implícita con residual 7 sin conflicto permanente ni alteración global', async () => {
        const countId = await createCount(principal);
        const result = await capture(countId, 7);
        expect(Number(result.body.bookStockAtCapture)).toBe(7);
        const closed = await api(`/api/stock-counts/${countId}/close`, 'POST', {}); okay(closed, 200);
        expect(closed.body.adjusted).toBe(0);
        expect(await book(principal)).toBe(7); expect(await book(secondary)).toBe(3);
        expect(Number((await db.product.findFirstOrThrow({ where: { id: productId, tenantId } })).stock)).toBe(10);
    }, 120_000);

    it('cambiar principal conserva stock implícito en ubicación anterior y cero en la nueva', async () => {
        await db.productStock.deleteMany({ where: { tenantId, productId, warehouseId: principal } });
        const beforeMovements = await db.kardexMovement.count({ where: { tenantId, productId } });
        const changed = await api(`/api/warehouses/${destination}/set-default`, 'POST', {}); okay(changed, 200);
        expect(await book(principal)).toBe(7); expect(await book(secondary)).toBe(3); expect(await book(destination)).toBe(0);
        expect(await db.kardexMovement.count({ where: { tenantId, productId } })).toBe(beforeMovements);
        expect(await db.auditLog.count({ where: { tenantId, action: 'WAREHOUSE_SET_DEFAULT' } })).toBe(1);
    }, 120_000);

    it('movimiento después de capturar exige reconteo aunque se retrofeche el Kardex', async () => {
        const countId = await createCount(principal); await capture(countId, 7);
        const loss = await api('/api/inventory/adjust', 'POST', { clientEventId: crypto.randomUUID(), productId, warehouseId: principal, quantity: -2, type: 'ADJUST_LOSS', reason: 'Salida sintética posterior a contar' }); okay(loss, 200);
        await db.kardexMovement.updateMany({ where: { tenantId, productId, warehouseId: principal }, data: { date: new Date('2000-01-01T12:00:00Z') } });
        const blocked = await api(`/api/stock-counts/${countId}/close`, 'POST', {}); okay(blocked, 409);
        expect(blocked.body.code).toBe('STOCK_COUNT_RECOUNT_REQUIRED'); expect(await book(principal)).toBe(5);
        const recaptured = await capture(countId, 5); expect(Number(recaptured.body.bookStockAtCapture)).toBe(5);
        okay(await api(`/api/stock-counts/${countId}/close`, 'POST', {}), 200); expect(await book(principal)).toBe(5);
    }, 120_000);

    it('un conteo antiguo sin saldo de captura exige confirmación expresa', async () => {
        const countId = await createCount(principal); await capture(countId, 5);
        await db.stockCountItem.updateMany({ where: { countId, productId }, data: { bookStockAtCapture: null } });
        const blocked = await api(`/api/stock-counts/${countId}/close`, 'POST', {}); okay(blocked, 409);
        expect(blocked.body.code).toBe('STOCK_COUNT_RECOUNT_REQUIRED');
        await capture(countId, 5); okay(await api(`/api/stock-counts/${countId}/close`, 'POST', {}), 200);
    }, 120_000);

    it('desactivar contra entradas concurrentes nunca deja saldos en una bodega inactiva', async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const created = await api('/api/warehouses', 'POST', { name: `Concurrencia ${crypto.randomUUID()}` }); okay(created, 201);
            const id = created.body.data.id;
            const outcomes = await Promise.all([
                api('/api/inventory/adjust', 'POST', { clientEventId: crypto.randomUUID(), productId, warehouseId: id, quantity: 1, type: 'ADJUST_GAIN', reason: 'Entrada sintética concurrente' }),
                api(`/api/warehouses/${id}`, 'PUT', { isActive: false }),
            ]);
            for (const outcome of outcomes) expect([200, 400, 404, 409], JSON.stringify(outcome.body)).toContain(outcome.status);
            const wh = await db.warehouse.findFirstOrThrow({ where: { id, tenantId } });
            const row = await db.productStock.findFirst({ where: { warehouseId: id, tenantId, productId } });
            expect(wh.isActive || Number(row?.stock ?? 0) === 0).toBe(true);
        }
    }, 120_000);

    it('0.1+0.2 se puede contar como0.3, pero un movimiento0.0001 exige recaptura', async () => {
        const tag = crypto.randomUUID(); const category = `QA Precision ${tag}`;
        const product = await api('/api/products', 'POST', { name: `Medido ${tag}`, sku: `MEAS-${tag}`, category, price: 1, cost: 1, stock: 0, minStock: 0, unit: 'kg', saleMode: 'MEASURED', quantityStep: '0.0001', isPublished: false }); okay(product, 200);
        const measuredId = product.body.id;
        const adjust = async (quantity: number) => { const res = await api('/api/inventory/adjust', 'POST', { clientEventId: crypto.randomUUID(), productId: measuredId, warehouseId: principal, quantity, type: 'ADJUST_GAIN', reason: 'Preparación precisión cuatro decimales' }); okay(res, 200); };
        await adjust(0.1); await adjust(0.2);
        const start = async () => { const res = await api('/api/stock-counts', 'POST', { warehouseId: principal, scope: 'CATEGORY', category }); okay(res, 201); return res.body.count.id; };
        const first = await start();
        okay(await api(`/api/stock-counts/${first}/count`, 'PATCH', { productId: measuredId, counted: '0.3' }), 200);
        const closed = await api(`/api/stock-counts/${first}/close`, 'POST', {}); okay(closed, 200); expect(closed.body.adjusted).toBe(0);
        const second = await start();
        okay(await api(`/api/stock-counts/${second}/count`, 'PATCH', { productId: measuredId, counted: '0.3' }), 200);
        await adjust(0.0001);
        const conflict = await api(`/api/stock-counts/${second}/close`, 'POST', {}); okay(conflict, 409); expect(conflict.body.code).toBe('STOCK_COUNT_RECOUNT_REQUIRED');
        okay(await api(`/api/stock-counts/${second}/count`, 'PATCH', { productId: measuredId, counted: '0.3001' }), 200);
        okay(await api(`/api/stock-counts/${second}/close`, 'POST', {}), 200);
    }, 120_000);

    it('caller sin pre-lock respeta Product→Warehouse frente a configuración concurrente', async () => {
        let signalProductLocked!: () => void; const productLocked = new Promise<void>(resolve => { signalProductLocked = resolve; });
        let signalSaleUpdating!: () => void; const saleUpdating = new Promise<void>(resolve => { signalSaleUpdating = resolve; });
        const before = await book(principal);
        const topology = db.$transaction(async tx => {
            const instrumented = new Proxy(tx, { get(target, key) {
                if (key !== '$queryRaw') return Reflect.get(target, key);
                return async (query: any) => {
                    const rows = await target.$queryRaw(query);
                    if (query.sql.includes('FROM `Product`')) { signalProductLocked(); await saleUpdating; }
                    return rows;
                };
            } });
            await lockWarehouseTopology(instrumented, tenantId);
        }, { timeout: 10_000 });
        const movement = (async () => {
            await productLocked;
            return db.$transaction(async tx => {
                const instrumented = new Proxy(tx, { get(target, key) {
                    if (key !== 'product') return Reflect.get(target, key);
                    return new Proxy(target.product, { get(model, operation) {
                        if (operation !== 'updateMany') return Reflect.get(model, operation);
                        return (args: any) => { signalSaleUpdating(); return model.updateMany(args); };
                    } });
                } });
                return applyStockDelta(instrumented, { tenantId, productId, warehouseId: principal, delta: -1, enforceSufficient: true });
            }, { timeout: 10_000 });
        })();
        const outcomes = await Promise.allSettled([topology, movement]);
        expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(await book(principal)).toBe(before - 1);
    }, 30_000);
});
