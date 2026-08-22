import { beforeAll, describe, expect, it } from 'vitest';

/**
 * QA HTTP real de idempotencia de devoluciones.
 *
 * Requiere una instancia local descartable con la migración aplicada:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3100 vitest run tests/returnIdempotency.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = { status: number; body: T };

let token = '';
let productId = '';
let saleId = '';
let saleItemId = '';

async function api<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
    };
}

const post = <T = any>(path: string, body: unknown): Promise<ApiResult<T>> =>
    api<T>(path, { method: 'POST', body: JSON.stringify(body) });

const expectStatus = (result: ApiResult, expected: number) =>
    expect(result.status, JSON.stringify(result.body)).toBe(expected);

const productStock = async (): Promise<number> => {
    const products = await api<any[]>('/api/products');
    expectStatus(products, 200);
    return Number(products.body.find((product) => product.id === productId)?.stock);
};

qaDescribe('QA integración: devolución idempotente', () => {
    beforeAll(async () => {
        const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const registration = await post('/api/auth/register', {
            companyName: `QA Returns ${runId}`,
            email: `qa-returns-${runId}@example.invalid`,
            password: `Qa-${runId}-Seguro!`,
            type: 'MISCELANEA',
        });
        expectStatus(registration, 200);
        token = registration.body.token;

        expectStatus(await post('/api/shifts/open', {
            initialCash: 500,
            employeePin: '1234',
        }), 200);

        const product = await post('/api/products', {
            name: `QA Pollo ${runId}`,
            sku: `QA-RETURN-${runId}`,
            category: 'QA',
            price: 50,
            cost: 30,
            stock: 5,
            minStock: 0,
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: 1,
            isPublished: false,
            ivaExento: false,
        });
        expectStatus(product, 200);
        productId = product.body.id;

        const sale = await post('/api/sales', {
            items: [{ id: productId, quantity: 2 }],
            paymentMethod: 'CASH',
            offlineId: crypto.randomUUID(),
        });
        expectStatus(sale, 200);
        saleId = sale.body.id;

        const searchable = await api(`/api/sales/search?q=${encodeURIComponent(saleId)}`);
        expectStatus(searchable, 200);
        saleItemId = searchable.body.items[0].saleItemId;
    }, 120_000);

    it('dos POST concurrentes idénticos crean una vez y ambos recuperan la misma devolución', async () => {
        const clientEventId = crypto.randomUUID();
        const payload = {
            clientEventId,
            saleId,
            items: [{ saleItemId, quantity: 1 }],
            reason: 'Producto regresado en QA',
        };

        const stockBefore = await productStock();
        const [first, second] = await Promise.all([
            post('/api/returns', payload),
            post('/api/returns', payload),
        ]);

        expectStatus(first, 200);
        expectStatus(second, 200);
        expect(first.body.id).toBe(second.body.id);
        expect([first.body.idempotentReplay, second.body.idempotentReplay].sort()).toEqual([false, true]);
        expect(await productStock()).toBe(stockBefore + 1);
    }, 120_000);

    it('dos payloads divergentes concurrentes dejan un ganador y un 409, nunca un 500', async () => {
        const clientEventId = crypto.randomUUID();
        const stockBefore = await productStock();
        const base = {
            clientEventId,
            saleId,
            items: [{ saleItemId, quantity: 1 }],
        };
        const responses = await Promise.all([
            post('/api/returns', { ...base, reason: 'Motivo concurrente A' }),
            post('/api/returns', { ...base, reason: 'Motivo concurrente B' }),
        ]);
        const winner = responses.find((response) => response.status === 200);
        const loser = responses.find((response) => response.status === 409);

        expect(winner, JSON.stringify(responses)).toBeTruthy();
        expect(loser, JSON.stringify(responses)).toBeTruthy();
        expect(responses.every((response) => response.status !== 500)).toBe(true);
        expect(winner?.body.idempotentReplay).toBe(false);
        expect(loser?.body.code).toBe('RETURN_IDEMPOTENCY_CONFLICT');
        expect(await productStock()).toBe(stockBefore + 1);
    }, 120_000);
});
