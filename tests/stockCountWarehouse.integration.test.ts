import { beforeAll, describe, expect, it } from 'vitest';

/**
 * QA HTTP real del ciclo create → count → close/cancel con dos bodegas.
 * Se omite en la suite normal y corre contra una instancia QA descartable.
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = { status: number; body: T };

let token = '';
let defaultWarehouseId = '';
let secondaryWarehouseId = '';

async function api<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    let body: any = null;
    if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: response.status, body };
}

const post = <T = any>(path: string, body: unknown = {}) =>
    api<T>(path, { method: 'POST', body: JSON.stringify(body) });

function expectStatus(result: ApiResult, expected: number) {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function warehouseStock(warehouseId: string, productId: string): Promise<number> {
    const result = await api(`/api/warehouses/${warehouseId}/stock`);
    expectStatus(result, 200);
    const item = result.body.data.items.find((candidate: any) => candidate.productId === productId);
    return Number(item?.stock ?? 0);
}

qaDescribe('QA integración: toma física aislada por bodega', () => {
    beforeAll(async () => {
        const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const registration = await post('/api/auth/register', {
            companyName: `QA Conteos ${runId}`,
            email: `qa-conteos-${runId}@example.invalid`,
            password: `Qa-${runId}-Seguro!`,
            type: 'FARMACIA',
        });
        expectStatus(registration, 200);
        token = registration.body.token;

        const warehouses = await api('/api/warehouses');
        expectStatus(warehouses, 200);
        defaultWarehouseId = warehouses.body.data.find((warehouse: any) => warehouse.isDefault).id;

        const secondary = await post('/api/warehouses', { name: `Sucursal QA ${runId}` });
        expectStatus(secondary, 201);
        secondaryWarehouseId = secondary.body.data.id;
    }, 120_000);

    it('mantiene dos conteos abiertos y ajusta únicamente la bodega cerrada', async () => {
        const runId = crypto.randomUUID().slice(0, 8);
        const product = await post('/api/products', {
            name: `QA Conteo Producto ${runId}`,
            sku: `QA-COUNT-${runId}`,
            category: 'QA Conteos',
            price: 20,
            cost: 8,
            stock: 0,
            minStock: 0,
            unit: 'unidad',
            isPublished: false,
            ivaExento: false,
        });
        expectStatus(product, 200);
        const productId = product.body.id;

        expectStatus(await post('/api/inventory/adjust', {
            productId,
            warehouseId: defaultWarehouseId,
            quantity: 5,
            type: 'ADJUST_GAIN',
            reason: 'Preparación QA en principal',
        }), 200);
        expectStatus(await post('/api/inventory/adjust', {
            productId,
            warehouseId: secondaryWarehouseId,
            quantity: 2,
            type: 'ADJUST_GAIN',
            reason: 'Preparación QA en sucursal',
        }), 200);

        const principalCount = await post('/api/stock-counts', {
            warehouseId: defaultWarehouseId,
            scope: 'CATEGORY',
            category: 'QA Conteos',
            notes: 'Conteo principal simultáneo',
        });
        expectStatus(principalCount, 201);

        const secondaryCount = await post('/api/stock-counts', {
            warehouseId: secondaryWarehouseId,
            scope: 'CATEGORY',
            category: 'QA Conteos',
            notes: 'Conteo sucursal simultáneo',
        });
        expectStatus(secondaryCount, 201);

        const duplicate = await post('/api/stock-counts', {
            warehouseId: secondaryWarehouseId,
            scope: 'CATEGORY',
            category: 'QA Conteos',
        });
        expectStatus(duplicate, 409);
        expect(duplicate.body.code).toBe('STOCK_COUNT_ALREADY_OPEN');

        const detail = await api(`/api/stock-counts/${secondaryCount.body.count.id}`);
        expectStatus(detail, 200);
        expect(detail.body.count.warehouseId).toBe(secondaryWarehouseId);
        const item = detail.body.items.find((candidate: any) => candidate.productId === productId);
        expect(Number(item.expected)).toBe(2);

        const captured = await api(`/api/stock-counts/${secondaryCount.body.count.id}/count`, {
            method: 'PATCH',
            body: JSON.stringify({ productId, counted: 4 }),
        });
        expectStatus(captured, 200);

        const closed = await post(`/api/stock-counts/${secondaryCount.body.count.id}/close`);
        expectStatus(closed, 200);
        expect(closed.body.adjusted).toBe(1);

        expect(await warehouseStock(defaultWarehouseId, productId)).toBe(5);
        expect(await warehouseStock(secondaryWarehouseId, productId)).toBe(4);

        const kardex = await api(`/api/kardex/${productId}`);
        expectStatus(kardex, 200);
        const countMovement = kardex.body.find((movement: any) =>
            movement.referenceType === 'STOCK_COUNT' && movement.referenceId === secondaryCount.body.count.id,
        );
        expect(countMovement.warehouseId).toBe(secondaryWarehouseId);
        expect(Number(countMovement.stockBefore)).toBe(2);
        expect(Number(countMovement.stockAfter)).toBe(4);

        expectStatus(await post(`/api/stock-counts/${principalCount.body.count.id}/cancel`), 200);
    }, 120_000);

    it('serializa dos altas concurrentes para la misma bodega', async () => {
        const requests = await Promise.all([
            post('/api/stock-counts', {
                warehouseId: secondaryWarehouseId,
                scope: 'CATEGORY',
                category: 'QA Conteos',
            }),
            post('/api/stock-counts', {
                warehouseId: secondaryWarehouseId,
                scope: 'CATEGORY',
                category: 'QA Conteos',
            }),
        ]);
        expect(requests.map(result => result.status).sort()).toEqual([201, 409]);
        const opened = requests.find(result => result.status === 201)!;
        expectStatus(await post(`/api/stock-counts/${opened.body.count.id}/cancel`), 200);
    }, 120_000);
});
