import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { inviteQaMember } from './helpers/saleCorrectionQa';

const base = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qa = base && process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type Result = { status: number; body: any };
let token = '';
let foreignToken = '';
let productA = '';
let productB = '';
let foreignProduct = '';

async function api(path: string, body?: unknown, session = token, method = body === undefined ? 'GET' : 'POST'): Promise<Result> {
    const response = await fetch(`${base}${path}`, {
        method, headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text.slice(0, 200) }; }
    return { status: response.status, body: parsed };
}

function status(response: Result, expected: number) {
    expect(response.status, JSON.stringify(response.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value)).toBe(expected);
}

async function register() {
    const id = randomUUID();
    const response = await api('/api/auth/register', {
        companyName: `QA Product Refresh ${id}`, email: `qa-refresh-${id}@example.invalid`,
        password: `Qa-${randomUUID()}-Seguro!`, type: 'FERRETERIA',
    }, '');
    status(response, 200);
    return response.body.token as string;
}

async function createProduct(session: string, label: string) {
    const response = await api('/api/products', {
        name: `QA Refresco ${label}`, sku: `QA-REFRESH-${randomUUID()}`, category: 'QA',
        price: 25, cost: 10, stock: 5, minStock: 0, unit: 'unidad', saleMode: 'COUNTED',
        quantityStep: 1, isPublished: false, ivaExento: false,
    }, session);
    status(response, 200);
    return response.body.id as string;
}

const refresh = (ids: string[], session = token) => api(`/api/products?ids=${encodeURIComponent(ids.join(','))}`, undefined, session);

qa('Refresco acotado del catálogo por HTTP real', () => {
    beforeAll(async () => {
        const url = new URL(base!);
        expect(url.protocol).toBe('http:');
        expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
        token = await register();
        foreignToken = await register();
        productA = await createProduct(token, 'A');
        productB = await createProduct(token, 'B');
        foreignProduct = await createProduct(foreignToken, 'ajeno');
    }, 60_000);

    it('trae solo las referencias pedidas, deduplica y una inexistente da vacío', async () => {
        const subset = await refresh([productA, productA]);
        status(subset, 200);
        expect(subset.body.map((product: any) => product.id)).toEqual([productA]);
        const missing = await refresh([randomUUID()]);
        status(missing, 200);
        expect(missing.body).toEqual([]);
        const full = await api('/api/products');
        status(full, 200);
        expect(full.body.map((product: any) => product.id).sort()).toEqual([productA, productB].sort());
    });

    it('devuelve precio, configuración fiscal y stock actuales después de cambios autorizados', async () => {
        const before = await refresh([productA]);
        status(before, 200);
        expect(Number(before.body[0].price)).toBe(25);
        expect(Number(before.body[0].stock)).toBe(5);
        status(await api(`/api/products/${productA}`, { price: '27.50', name: 'QA Refresco actualizado', ivaExento: true }, token, 'PUT'), 200);
        const warehouses = await api('/api/warehouses');
        status(warehouses, 200);
        const warehouseId = warehouses.body.data.find((warehouse: any) => warehouse.isDefault).id;
        status(await api('/api/inventory/adjust', {
            productId: productA, warehouseId, quantity: -2, type: 'ADJUST_LOSS', reason: 'Merma controlada de fixture QA',
        }), 200);
        const current = await refresh([productA]);
        status(current, 200);
        expect(current.body).toHaveLength(1);
        expect(current.body[0]).toMatchObject({ id: productA, name: 'QA Refresco actualizado', ivaExento: true, saleMode: 'COUNTED' });
        expect(Number(current.body[0].price)).toBe(27.5);
        expect(Number(current.body[0].stock)).toBe(3);
        expect(Number(current.body[0].quantityStep)).toBe(1);
    }, 30_000);

    it('interseca referencias con tenant autenticado, aun con un ID válido de otro negocio', async () => {
        const mixed = await refresh([productA, foreignProduct]);
        status(mixed, 200);
        expect(mixed.body.map((product: any) => product.id)).toEqual([productA]);
        const onlyForeign = await refresh([foreignProduct]);
        status(onlyForeign, 200);
        expect(onlyForeign.body).toEqual([]);
        const inverse = await refresh([productA, foreignProduct], foreignToken);
        status(inverse, 200);
        expect(inverse.body.map((product: any) => product.id)).toEqual([foreignProduct]);
    });

    it('un vendedor con catálogo asignado no amplía su acceso mediante ids ni paginación', async () => {
        const seller = await inviteQaMember((path, body) => api(path, body), 'VENDEDOR');
        status(await api(`/api/sellers/${seller.id}/catalog`, { productIds: [productA] }, token, 'PUT'), 200);
        const mixed = await refresh([productA, productB, foreignProduct], seller.token);
        status(mixed, 200);
        expect(mixed.body.map((product: any) => product.id)).toEqual([productA]);
        const unassigned = await refresh([productB], seller.token);
        status(unassigned, 200);
        expect(unassigned.body).toEqual([]);
        const paged = await api(`/api/products?ids=${productB}&page=1`, undefined, seller.token);
        status(paged, 200);
        expect(paged.body.products).toEqual([]);
        expect(paged.body.total).toBe(0);
    }, 30_000);

    it.each([
        { label: 'vacío', ids: '' }, { label: 'segmento vacío', ids: 'a,,b' }, { label: 'barra', ids: 'a/b' },
        { label: 'espacio inicial', ids: ' a' }, { label: 'espacio final', ids: 'a ' },
        { label: 'ID demasiado largo', ids: 'a'.repeat(192) },
        { label: '101 referencias', ids: Array(101).fill('same').join(',') },
    ])('rechaza ids fuera de contrato sin devolver catálogo: $label', async ({ ids }) => {
        const response = await api(`/api/products?ids=${encodeURIComponent(ids)}`);
        status(response, 400);
        expect(response.body.code).toBe('INVALID_PRODUCT_IDS');
        expect(response.body).not.toHaveProperty('products');
    });

    it('rechaza parámetros repetidos y admite exactamente cien referencias', async () => {
        const invalid = await api(`/api/products?ids=${productA}&ids=${productB}`);
        status(invalid, 400);
        expect(invalid.body.code).toBe('INVALID_PRODUCT_IDS');
        const boundary = await refresh([productA, productB, ...Array.from({ length: 98 }, () => randomUUID())]);
        status(boundary, 200);
        expect(boundary.body.map((product: any) => product.id).sort()).toEqual([productA, productB].sort());
    });
});
