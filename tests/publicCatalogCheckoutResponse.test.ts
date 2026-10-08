import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { resolvePublicOrderItems } from '../backend/services/publicOrderItemService';

type PedidosRouteModule = typeof import('../backend/routes/pedidos');
let pedidosRouteModule: PedidosRouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'public-checkout-response-test-secret');
    pedidosRouteModule = await import('../backend/routes/pedidos');
});

afterAll(() => {
    vi.unstubAllEnvs();
});

const serverSource = readFileSync(new URL('../backend/server.ts', import.meta.url), 'utf8');
const pedidosSource = readFileSync(new URL('../backend/routes/pedidos.ts', import.meta.url), 'utf8');

const publicOrderStart = serverSource.indexOf("app.post('/api/public/orders'");
const publicOrderEnd = serverSource.indexOf('// GET /api/public-orders', publicOrderStart);
const publicOrderRoute = serverSource.slice(publicOrderStart, publicOrderEnd);

const pedidoStart = pedidosSource.indexOf("router.post('/', createPedidoLimiter");
const pedidoEnd = pedidosSource.indexOf('// GET /api/v1/pedidos', pedidoStart);
const pedidoRoute = pedidosSource.slice(pedidoStart, pedidoEnd);
const publicPedidoResponseStart = pedidoRoute.indexOf('const publicPedidoResponse = {');
const publicPedidoResponseEnd = pedidoRoute.indexOf('};', publicPedidoResponseStart);
const publicPedidoResponse = pedidoRoute.slice(publicPedidoResponseStart, publicPedidoResponseEnd);

const expectCanonicalConfirmation = (source: string, responseOwner: string) => {
    expect(source).toContain('const confirmationItems = resolvedItems.map((item) =>');
    expect(source).toContain('name: item.productName');
    expect(source).toContain('quantity: item.presentationQuantityAtSale.toFixed()');
    expect(source).toContain('presentation: item.presentationAtSale');
    expect(source).toContain("subtotal: item.subtotal.toFixed(2)");
    expect(source).toContain(`items: ${responseOwner}.confirmationItems`);
};

describe('respuesta autoritativa de los checkouts públicos', () => {
    it('public orders devuelve únicamente renglones resueltos dentro del tenant publicado', () => {
        expect(publicOrderStart).toBeGreaterThan(-1);
        expect(publicOrderRoute).toContain('where: { tenantId: tenant.id, id: { in: productIds }, isPublished: true }');
        expect(publicOrderRoute).toContain('resolvePublicOrderItems(');
        expectCanonicalConfirmation(publicOrderRoute, 'created');
    });

    it('delivery devuelve el mismo contrato canónico y conserva el total con flete del servidor', () => {
        expect(pedidoStart).toBeGreaterThan(-1);
        expect(pedidoRoute).toContain('where: { tenantId, id: { in: productIds }, isPublished: true }');
        expect(pedidoRoute).toContain('resolvePublicOrderItems(');
        expect(pedidoRoute).toContain('const granTotal = totalSuma.plus(costoEntrega).toDecimalPlaces(2)');
        expect(pedidoRoute).toContain('buildPublicPedidoConfirmationItems(resolvedItems, productsDB)');
        expect(pedidosSource).toContain("? product.packUnit?.trim()");
        expect(pedidoRoute).toContain('items: pedidoCreated.confirmationItems');
    });

    it('delivery expone únicamente el DTO público mínimo y no materializa relaciones internas', () => {
        expect(publicPedidoResponseStart).toBeGreaterThan(-1);
        const expectedFields = ['pedidoId', 'estado', 'total', 'costoEntrega', 'items', 'trackingPath'];
        for (const field of expectedFields) {
            expect(publicPedidoResponse).toMatch(new RegExp(`\\b${field}:`));
        }
        expect(Array.from(
            publicPedidoResponse.matchAll(/^ {12}([A-Za-z]\w*):/gm),
            match => match[1],
        )).toEqual(expectedFields);
        expect(publicPedidoResponse).not.toMatch(/\bpedido\s*:/);
        expect(publicPedidoResponse).not.toMatch(/\btenantId\s*:/);
        expect(publicPedidoResponse).not.toMatch(/\beventos\s*:/);
        expect(publicPedidoResponse).not.toMatch(/\b(?:latitud|longitud)\w*\s*:/);
        expect(publicPedidoResponse).not.toMatch(/\bcliente(?:Nombre|Telefono)\s*:/);
        expect(pedidoRoute).toContain('select: { id: true, estado: true }');
        expect(pedidoRoute).not.toContain('pedido: pedidoCreated.pedido');
        expect(pedidoRoute).toContain('res.status(201).json(publicPedidoResponse)');
    });

    it('proyecta PACK con packUnit y cantidad de presentación, no con unidades base', () => {
        const product = {
            id: 'product-pack',
            tenantId: 'tenant-a',
            isPublished: true,
            name: 'Café',
            unit: 'unidad',
            price: 15,
            cost: 5,
            ivaExento: false,
            saleMode: 'COUNTED',
            quantityStep: '1',
            wholesalePrice: null,
            wholesaleMinQty: null,
            packUnit: 'caja',
            packSize: 12,
            packPrice: 120,
            requiresBatchTracking: false,
        };
        const resolved = resolvePublicOrderItems('tenant-a', [{
            productId: product.id,
            quantity: '2',
            presentation: 'PACK',
        }], [product]);

        expect(resolved[0].quantityExact).toEqual(new Decimal(24));
        expect(pedidosRouteModule.buildPublicPedidoConfirmationItems(resolved, [product])).toEqual([{
            productId: 'product-pack',
            name: 'Café',
            quantity: '2',
            presentation: 'PACK',
            unit: 'caja',
            subtotal: '240.00',
        }]);
    });
});
