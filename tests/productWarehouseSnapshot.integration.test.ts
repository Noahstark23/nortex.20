// @vitest-environment node
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { readProductWarehouseSnapshot } from '../backend/services/productWarehouseSnapshot';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type Actor = { tenantId: string; userId: string; token: string };
let base: string;
let owner: Actor;
let bodeguero: Actor;
let neighbor: Actor;

async function actor(tenantId?: string, role = 'OWNER'): Promise<Actor> {
    const tenant = tenantId ? { id: tenantId } : await prisma.tenant.create({ data: {
        businessName: 'QA ubicación por producto', taxId: randomUUID(), subscriptionStatus: 'ACTIVE',
    } });
    const password = `QA-${randomUUID()}`;
    const user = await prisma.user.create({ data: {
        tenantId: tenant.id, role, name: 'Consulta QA', email: `${randomUUID()}@example.invalid`,
        password: await bcrypt.hash(password, 4),
    } });
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }),
    });
    expect(response.status).toBe(200);
    return { tenantId: tenant.id, userId: user.id, token: (await response.json()).token };
}
async function product(principal: Actor, stock: number) {
    return prisma.product.create({ data: {
        tenantId: principal.tenantId, createdBy: principal.userId, sku: randomUUID(),
        name: 'Cable físico QA', unit: 'm', stock, price: 88, cost: 35,
        wholesalePrice: 77, packPrice: 700, requiresBatchTracking: true,
    } });
}
async function warehouse(principal: Actor, name: string, options: { isDefault?: boolean; isActive?: boolean } = {}) {
    return prisma.warehouse.create({ data: { tenantId: principal.tenantId, name, ...options } });
}
async function read(principal: Actor | null, productId: string, query = '', method = 'GET') {
    const response = await fetch(`${base}/api/warehouses/product/${productId}/stock${query}`, {
        method, headers: principal ? { authorization: `Bearer ${principal.token}` } : {},
    });
    const text = await response.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* Una ruta ausente puede devolver HTML. */ }
    return { status: response.status, body };
}

qa('ubicación física por producto: HTTP real y snapshot MySQL', () => {
    beforeAll(async () => {
        assertDisposableDatabase();
        const url = new URL(process.env.NORTEX_QA_BASE_URL ?? 'invalid:');
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Se requiere backend local descartable.');
        base = url.origin;
        owner = await actor();
        bodeguero = await actor(owner.tenantId, 'BODEGUERO');
        neighbor = await actor();
    }, 30_000);

    it('usa autoridad del JWT, devuelve 404 al vecino y requiere autenticación', async () => {
        const foreign = await product(neighbor, 4);
        expect((await read(null, foreign.id)).status).toBe(401);
        expect((await read(owner, foreign.id)).status).toBe(404);
        expect((await read(owner, foreign.id, `?tenantId=${neighbor.tenantId}`)).status).toBe(404);
        expect((await read(owner, `missing-${randomUUID()}`)).status).toBe(404);
        expect((await read(neighbor, foreign.id)).status).toBe(200);
    });

    it('sin bodegas conserva el saldo sin bootstrap ni ninguna escritura', async () => {
        const p = await product(owner, 8.125);
        const before = await prisma.$transaction([
            prisma.warehouse.count({ where: { tenantId: owner.tenantId } }),
            prisma.productStock.count({ where: { tenantId: owner.tenantId, productId: p.id } }),
            prisma.auditLog.count({ where: { tenantId: owner.tenantId } }),
        ]);
        expect(await read(owner, p.id)).toEqual({ status: 200, body: { success: true, data: {
            productId: p.id, totalStock: '8.1250', unit: 'm', warehouses: [], hasMore: false, unlistedStock: '8.1250',
        } } });
        expect(await prisma.$transaction([
            prisma.warehouse.count({ where: { tenantId: owner.tenantId } }),
            prisma.productStock.count({ where: { tenantId: owner.tenantId, productId: p.id } }),
            prisma.auditLog.count({ where: { tenantId: owner.tenantId } }),
        ])).toEqual(before);
        expect(await prisma.product.findFirst({ where: { tenantId: owner.tenantId, id: p.id }, select: { stock: true } })).toEqual({ stock: 8.125 });
    });

    it('el bodeguero ve solo cantidades físicas y no recibe nueva autoridad de escritura', async () => {
        const p = await product(owner, 3);
        const response = await read(bodeguero, p.id);
        expect(response.status).toBe(200);
        expect(Object.keys(response.body.data).sort()).toEqual(['hasMore', 'productId', 'totalStock', 'unit', 'unlistedStock', 'warehouses']);
        expect(response.body.data.totalStock).toBe('3.0000');
        for (const field of ['price', 'cost', 'packPrice', 'wholesalePrice', 'tenantId', 'createdBy']) expect(JSON.stringify(response.body)).not.toContain(`"${field}"`);
        const mutation = await fetch(`${base}/api/warehouses`, { method: 'POST',
            headers: { authorization: `Bearer ${bodeguero.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'No autorizado' }),
        });
        expect(mutation.status).toBe(403);
    });

    it('la principal implícita resta TODAS las ubicaciones y muestra el saldo inactivo aparte', async () => {
        const main = await warehouse(owner, 'A Principal', { isDefault: true });
        const other = await warehouse(owner, 'B Reserva');
        const inactive = await warehouse(owner, 'C Inactiva', { isActive: false });
        const p = await product(owner, 30.3);
        await prisma.productStock.createMany({ data: [
            { tenantId: owner.tenantId, productId: p.id, warehouseId: other.id, stock: 10.125 },
            { tenantId: owner.tenantId, productId: p.id, warehouseId: inactive.id, stock: 5.0001 },
        ] });
        const result = await read(owner, p.id);
        expect(result.status).toBe(200);
        expect(result.body.data).toEqual({ productId: p.id, totalStock: '30.3000', unit: 'm', hasMore: false, unlistedStock: '5.0001', warehouses: [
            { id: main.id, name: main.name, isDefault: true, isActive: true, stock: '15.1749', implicit: true },
            { id: other.id, name: other.name, isDefault: false, isActive: true, stock: '10.1250', implicit: false },
        ] });
        expect(await prisma.productStock.count({ where: { tenantId: owner.tenantId, productId: p.id } })).toBe(2);
    });

    it('un cero explícito prevalece y no esconde un descuadre histórico del agregado', async () => {
        const main = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: owner.tenantId, isDefault: true } });
        const p = await product(owner, 5);
        await prisma.productStock.create({ data: { tenantId: owner.tenantId, productId: p.id, warehouseId: main.id, stock: 0 } });
        const result = await read(owner, p.id);
        expect(result.status).toBe(200);
        expect(result.body.data.warehouses.find((row: any) => row.id === main.id)).toMatchObject({ stock: '0.0000', implicit: false });
        expect(result.body.data.unlistedStock).toBe('5.0000');
    });

    it('normaliza residuos Float a cuatro decimales y conserva un cambio de 0.0001', async () => {
        const secondary = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: owner.tenantId, name: 'B Reserva' } });
        const p = await product(owner, 0.1 + 0.2 + 0.0001);
        await prisma.productStock.create({ data: { tenantId: owner.tenantId, productId: p.id, warehouseId: secondary.id, stock: 0.1 + 0.2 } });
        const result = await read(owner, p.id);
        expect(result.status).toBe(200);
        expect(result.body.data.totalStock).toBe('0.3001');
        expect(result.body.data.warehouses.find((row: any) => row.isDefault).stock).toBe('0.0001');
        expect(result.body.data.warehouses.find((row: any) => row.id === secondary.id).stock).toBe('0.3000');
        expect(result.body.data).not.toHaveProperty('unlistedStock');
    });

    it('no transforma un residual físico negativo en cero', async () => {
        const secondary = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: owner.tenantId, name: 'B Reserva' } });
        const p = await product(owner, 1);
        await prisma.productStock.create({ data: { tenantId: owner.tenantId, productId: p.id, warehouseId: secondary.id, stock: 2 } });
        const result = await read(owner, p.id);
        expect(result.status).toBe(200);
        expect(result.body.data.warehouses.find((row: any) => row.isDefault).stock).toBe('-1.0000');
    });

    it('mantiene el mismo snapshot cuando otra transacción cambia agregado y ubicación entre consultas', async () => {
        const secondary = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: owner.tenantId, name: 'B Reserva' } });
        const p = await product(owner, 10);
        await prisma.productStock.create({ data: { tenantId: owner.tenantId, productId: p.id, warehouseId: secondary.id, stock: 3 } });
        let changed = false;
        const instrumented = new Proxy(prisma, { get(target, key) {
            if (key !== '$transaction') return Reflect.get(target, key);
            return (callback: any, options: any) => target.$transaction(async tx => callback(new Proxy(tx, { get(transaction, operation) {
                if (operation !== '$queryRaw') return Reflect.get(transaction, operation);
                return async (query: any) => {
                    const rows = await transaction.$queryRaw(query);
                    if (query.sql.includes('FROM Product WHERE') && !changed) {
                        changed = true;
                        // Fixture exclusiva: publicación atómica de otro estado
                        // físico DESPUÉS de que la consulta leyó el agregado.
                        await prisma.$transaction([
                            prisma.product.updateMany({ where: { id: p.id, tenantId: owner.tenantId }, data: { stock: 20 } }),
                            prisma.productStock.updateMany({ where: { tenantId: owner.tenantId, productId: p.id, warehouseId: secondary.id }, data: { stock: 8 } }),
                        ]);
                    }
                    return rows;
                };
            } })), options);
        } });
        const result = await readProductWarehouseSnapshot({ tenantId: owner.tenantId, productId: p.id }, instrumented);
        expect(changed).toBe(true);
        expect(result?.totalStock).toBe('10.0000');
        expect(result?.warehouses.find(row => row.isDefault)?.stock).toBe('7.0000');
        expect(result?.warehouses.find(row => row.id === secondary.id)?.stock).toBe('3.0000');
        const current = await read(owner, p.id);
        expect(current.status).toBe(200);
        expect(current.body.data.totalStock).toBe('20.0000');
        expect(current.body.data.warehouses.find((row: any) => row.isDefault).stock).toBe('12.0000');
        expect(current.body.data.warehouses.find((row: any) => row.id === secondary.id).stock).toBe('8.0000');
    });

    it('acota a 100 ubicaciones activas y conserva fuera de lista la principal truncada e inactivas', async () => {
        const p = await product(neighbor, 20);
        const warehouses = Array.from({ length: 102 }, (_, i) => ({
            id: randomUUID(), tenantId: neighbor.tenantId, name: `B${String(i).padStart(3, '0')}`, isDefault: i === 101,
        }));
        await prisma.warehouse.createMany({ data: warehouses });
        const inactive = await warehouse(neighbor, 'Inactiva', { isActive: false });
        await prisma.productStock.createMany({ data: [
            ...warehouses.slice(0, 101).map(row => ({ tenantId: neighbor.tenantId, productId: p.id, warehouseId: row.id, stock: 0.125 })),
            { tenantId: neighbor.tenantId, productId: p.id, warehouseId: inactive.id, stock: 4 },
        ] });
        const result = await read(neighbor, p.id);
        expect(result.status).toBe(200);
        expect(result.body.data).toMatchObject({ productId: p.id, totalStock: '20.0000', hasMore: true, unlistedStock: '7.5000' });
        expect(result.body.data.warehouses).toHaveLength(100);
        expect(result.body.data.warehouses.map((row: any) => row.id)).toEqual(warehouses.slice(0, 100).map(row => row.id));
        expect(result.body.data.warehouses.every((row: any) => row.stock === '0.1250')).toBe(true);
    });
});
