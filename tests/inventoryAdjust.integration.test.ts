import { beforeAll, describe, expect, it } from 'vitest';

/**
 * QA HTTP real de POST /api/inventory/adjust.
 *
 * Requiere una instancia local descartable:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3000 vitest run tests/inventoryAdjust.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
    status: number;
    body: T;
};

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
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    return { status: response.status, body };
}

async function post<T = any>(path: string, body: unknown): Promise<ApiResult<T>> {
    return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function expectStatus(result: ApiResult, expected: number) {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function createProduct(name: string, sku: string): Promise<string> {
    const result = await post('/api/products', {
        name,
        sku,
        category: 'QA Ajustes',
        price: 20,
        cost: 8,
        stock: 0,
        minStock: 0,
        unit: 'unidad',
        isPublished: false,
        ivaExento: false,
    });
    expectStatus(result, 200);
    return result.body.id;
}

async function createWarehouse(name: string): Promise<string> {
    const result = await post('/api/warehouses', { name });
    expectStatus(result, 201);
    return result.body.data.id;
}

async function getWarehouses(): Promise<any[]> {
    const result = await api('/api/warehouses');
    expectStatus(result, 200);
    return Array.isArray(result.body.data) ? result.body.data : [];
}

async function getWarehouseStock(warehouseId: string): Promise<any[]> {
    const result = await api(`/api/warehouses/${warehouseId}/stock`);
    expectStatus(result, 200);
    return Array.isArray(result.body.data?.items) ? result.body.data.items : [];
}

async function getKardex(productId: string): Promise<any[]> {
    const result = await api(`/api/kardex/${productId}`);
    expectStatus(result, 200);
    return Array.isArray(result.body) ? result.body : [];
}

qaDescribe('QA integración: ajuste manual multi-bodega', () => {
    beforeAll(async () => {
        const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const registration = await post('/api/auth/register', {
            companyName: `QA Ajustes ${runId}`,
            email: `qa-ajustes-${runId}@example.invalid`,
            password: `Qa-${runId}-Seguro!`,
            type: 'FARMACIA',
        });
        expectStatus(registration, 200);
        token = registration.body.token;

        const warehouses = await getWarehouses();
        const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault);
        expect(defaultWarehouse).toBeTruthy();
        defaultWarehouseId = defaultWarehouse.id;
        secondaryWarehouseId = await createWarehouse(`Bodega Ajustes ${runId}`);
    }, 120_000);

    it('aplica la ganancia en la bodega elegida y deja Kardex con warehouseId', async () => {
        const runId = crypto.randomUUID().slice(0, 8);
        const productId = await createProduct(`QA Ajuste Ganancia ${runId}`, `QA-ADJ-GAIN-${runId}`);

        const secondaryGain = await post('/api/inventory/adjust', {
            productId,
            warehouseId: secondaryWarehouseId,
            quantity: 7,
            type: 'ADJUST_GAIN',
            reason: 'Ingreso inicial en sucursal',
        });
        expectStatus(secondaryGain, 200);
        expect(secondaryGain.body.warehouseStock).toBe(7);
        expect(secondaryGain.body.aggregateStock).toBe(7);

        const defaultGain = await post('/api/inventory/adjust', {
            productId,
            warehouseId: defaultWarehouseId,
            quantity: 3,
            type: 'ADJUST_GAIN',
            reason: 'Ingreso inicial en principal',
        });
        expectStatus(defaultGain, 200);
        expect(defaultGain.body.warehouseStock).toBe(3);
        expect(defaultGain.body.aggregateStock).toBe(10);

        const secondaryStock = await getWarehouseStock(secondaryWarehouseId);
        const defaultStock = await getWarehouseStock(defaultWarehouseId);
        const secondaryRow = secondaryStock.find((item) => item.productId === productId);
        const defaultRow = defaultStock.find((item) => item.productId === productId);
        expect(Number(secondaryRow?.stock ?? 0)).toBe(7);
        expect(Number(defaultRow?.stock ?? 0)).toBe(3);

        const kardex = await getKardex(productId);
        expect(kardex).toHaveLength(2);
        expect(kardex[0].warehouseId).toBe(defaultWarehouseId);
        expect(Number(kardex[0].stockBefore)).toBe(0);
        expect(Number(kardex[0].stockAfter)).toBe(3);
        expect(kardex[1].warehouseId).toBe(secondaryWarehouseId);
        expect(Number(kardex[1].stockBefore)).toBe(0);
        expect(Number(kardex[1].stockAfter)).toBe(7);
    }, 120_000);

    it('rechaza omitir warehouseId cuando el negocio ya opera varias bodegas', async () => {
        const runId = crypto.randomUUID().slice(0, 8);
        const productId = await createProduct(`QA Ajuste Sin Bodega ${runId}`, `QA-ADJ-NOWH-${runId}`);

        const result = await post('/api/inventory/adjust', {
            productId,
            quantity: 1,
            type: 'ADJUST_GAIN',
            reason: 'Alta sin ubicación',
        });

        expectStatus(result, 409);
        expect(result.body.code).toBe('WAREHOUSE_REQUIRED');
    }, 120_000);

    it('rechaza una pérdida mayor al stock de la bodega aunque el agregado alcance', async () => {
        const runId = crypto.randomUUID().slice(0, 8);
        const productId = await createProduct(`QA Ajuste Pérdida ${runId}`, `QA-ADJ-LOSS-${runId}`);

        expectStatus(await post('/api/inventory/adjust', {
            productId,
            warehouseId: defaultWarehouseId,
            quantity: 5,
            type: 'ADJUST_GAIN',
            reason: 'Stock principal',
        }), 200);

        expectStatus(await post('/api/inventory/adjust', {
            productId,
            warehouseId: secondaryWarehouseId,
            quantity: 1,
            type: 'ADJUST_GAIN',
            reason: 'Stock sucursal',
        }), 200);

        const rejected = await post('/api/inventory/adjust', {
            productId,
            warehouseId: secondaryWarehouseId,
            quantity: -2,
            type: 'ADJUST_LOSS',
            reason: 'Merma sucursal',
        });

        expectStatus(rejected, 409);
        expect(rejected.body.code).toBe('INSUFFICIENT_STOCK');
        expect(String(rejected.body.error ?? '')).toContain('Bodega Ajustes');

        const secondaryStock = await getWarehouseStock(secondaryWarehouseId);
        const defaultStock = await getWarehouseStock(defaultWarehouseId);
        const secondaryRow = secondaryStock.find((item) => item.productId === productId);
        const defaultRow = defaultStock.find((item) => item.productId === productId);
        expect(Number(secondaryRow?.stock ?? 0)).toBe(1);
        expect(Number(defaultRow?.stock ?? 0)).toBe(5);
    }, 120_000);
});
