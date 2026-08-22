import { describe, expect, it } from 'vitest';
import {
    isBodegueroRouteAllowed,
    redactBodegueroProduct,
    redactBodegueroPurchaseOrder,
} from '../backend/security/bodegueroPolicy';

describe('isBodegueroRouteAllowed', () => {
    it('permite el flujo operativo de bodega', () => {
        expect(isBodegueroRouteAllowed('GET', '/api/warehouses')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/warehouses/wh_1/stock')).toBe(true);
        expect(isBodegueroRouteAllowed('POST', '/api/stock-transfers')).toBe(true);
        expect(isBodegueroRouteAllowed('POST', '/api/inventory/adjust')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/stock-counts/open?page=1')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/stock-counts')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/stock-counts/abc123')).toBe(true);
        expect(isBodegueroRouteAllowed('PATCH', '/api/stock-counts/abc123/count')).toBe(true);
        expect(isBodegueroRouteAllowed('POST', '/api/stock-counts/abc123/close')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/purchase-orders')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/purchase-orders/po_1')).toBe(true);
        expect(isBodegueroRouteAllowed('POST', '/api/purchase-orders/po_1/receive')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/products?search=aceite')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/products/categories')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/kardex/prod_1?from=2026-08-01&to=2026-08-22')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/inventory/batches/prod_1')).toBe(true);
        expect(isBodegueroRouteAllowed('GET', '/api/tenant/info')).toBe(true);
    });

    it('bloquea superficies financieras y administrativas aunque tengan authenticate', () => {
        expect(isBodegueroRouteAllowed('GET', '/api/purchases')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/purchases/pending')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/suppliers')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/reports/inventory')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/dashboard/stats')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/public-orders')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/onboarding')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/billing/status')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/warehouses')).toBe(false);
        expect(isBodegueroRouteAllowed('PUT', '/api/warehouses/wh_1')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/purchase-orders')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/purchase-orders/po_1/approve')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/purchase-orders/po_1/cancel')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/me/profile')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/accounting/balance-general')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/payments')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/team')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/warehouses/wh_1/stock/extra')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/kardex/record')).toBe(false);
    });

    it('es fail-closed para rutas o métodos nuevos', () => {
        expect(isBodegueroRouteAllowed('DELETE', '/api/products/prod_1')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/inventory/new-module')).toBe(false);
        expect(isBodegueroRouteAllowed('POST', '/api/purchase-orders/po_1/receive/confirm')).toBe(false);
        expect(isBodegueroRouteAllowed('GET', '/api/products#cost')).toBe(true);
    });
});

describe('redacción de datos para BODEGUERO', () => {
    it('conserva identificación y existencias del producto, pero no precios/costos', () => {
        const visible = redactBodegueroProduct({
            id: 'prod_1', tenantId: 'tenant_1', name: 'Aceite', sku: 'A-1',
            stock: 12, minStock: 3, price: 100, cost: 60,
            wholesalePrice: 90, wholesaleMinQty: 12, packPrice: 1080,
            defaultSupplierId: 'supplier_1', createdBy: 'owner_1',
            creator: { name: 'Dueño', email: 'owner@example.com' },
        });

        expect(visible).toMatchObject({ id: 'prod_1', name: 'Aceite', sku: 'A-1', stock: 12, minStock: 3 });
        for (const field of ['tenantId', 'price', 'cost', 'wholesalePrice', 'wholesaleMinQty', 'packPrice', 'defaultSupplierId', 'createdBy', 'creator']) {
            expect(visible).not.toHaveProperty(field);
        }
    });

    it('una OC para recepción expone cantidades, no costos, facturas ni datos privados del proveedor', () => {
        const visible = redactBodegueroPurchaseOrder({
            id: 'po_1', orderNumber: 'OC-0001', status: 'APPROVED', notes: 'Entregar atrás',
            expectedDate: new Date('2026-08-23'), createdAt: new Date('2026-08-22'), updatedAt: new Date('2026-08-22'),
            supplier: { name: 'Proveedor', ruc: 'J031', phone: '8888-8888', email: 'ventas@example.com' },
            receipts: [{ invoiceNumber: 'FAC-1', total: 5000 }],
            items: [{
                id: 'item_1', productId: 'prod_1', productName: 'Aceite',
                quantityOrdered: 20, quantityReceived: 5, unitCost: 250,
                product: { requiresBatchTracking: true, cost: 250 },
            }],
        });

        expect(visible.supplier).toEqual({ name: 'Proveedor' });
        expect(visible).not.toHaveProperty('receipts');
        expect(visible.items[0]).toEqual({
            id: 'item_1', productId: 'prod_1', productName: 'Aceite',
            quantityOrdered: 20, quantityReceived: 5,
            product: { requiresBatchTracking: true },
        });
        expect(visible.items[0]).not.toHaveProperty('unitCost');
    });
});
