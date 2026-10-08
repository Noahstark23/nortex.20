import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
    publicOrderItemsForQuotation,
    resolvePublicOrderItems,
    PublicOrderItemError,
} from '../backend/services/publicOrderItemService';

const product = (patch: Record<string, unknown> = {}) => ({
    id: 'product-a',
    tenantId: 'tenant-a',
    isPublished: true,
    name: 'Carne por kilo',
    unit: 'kg',
    price: 120,
    cost: 80,
    ivaExento: false,
    saleMode: 'MEASURED',
    quantityStep: { toString: () => '0.01' },
    wholesalePrice: null,
    wholesaleMinQty: null,
    packUnit: null,
    packSize: null,
    packPrice: null,
    requiresBatchTracking: true,
    ...patch,
});

describe('items públicos autoritativos', () => {
    it('acepta 0.75 kg medidos y conserva la cantidad exacta', () => {
        const [item] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '0.75' }],
            [product()],
        );
        expect(item.quantityExact.toString()).toBe('0.75');
        expect(item.quantityLegacy).toBe(1);
        expect(item.subtotal.toFixed(2)).toBe('90.00');
        expect(item.saleMode).toBe('MEASURED');
    });

    it('rechaza 1.5 para COUNTED explícito', () => {
        expect(() => resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1.5' }],
            [product({ saleMode: 'COUNTED', quantityStep: { toString: () => '1' } })],
        )).toThrow(PublicOrderItemError);
    });

    it('legacy null conserva fracciones con paso efectivo 0.0001', () => {
        const [item] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '0.3333' }],
            [product({ saleMode: null, quantityStep: null })],
        );
        expect(item.quantityExact.toString()).toBe('0.3333');
        expect(item.quantityStep).toBe('0.0001');
    });

    it('deriva factor y precio de empaque desde Product', () => {
        const [item] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '2', presentation: 'PACK' }],
            [product({ packUnit: 'saco', packSize: 25, packPrice: 2500 })],
        );
        expect(item.quantityExact.toString()).toBe('50');
        expect(item.presentationQuantityAtSale.toString()).toBe('2');
        expect(item.unitPrice.toFixed(2)).toBe('100.00');
        expect(item.subtotal.toFixed(2)).toBe('5000.00');
    });

    it('no aplica precio pack por alcanzar el tamaño si la presentación es BASE', () => {
        const [base] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '12.5', presentation: 'BASE' }],
            [product({ price: 10, packUnit: 'caja', packSize: 12, packPrice: 90 })],
        );
        const [pack] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1', presentation: 'PACK' }],
            [product({ price: 10, packUnit: 'caja', packSize: 12, packPrice: 90 })],
        );

        expect(base.quantityExact.toString()).toBe('12.5');
        expect(base.unitPrice.toFixed(2)).toBe('10.00');
        expect(base.subtotal.toFixed(2)).toBe('125.00');
        expect(pack.quantityExact.toString()).toBe('12');
        expect(pack.unitPrice.toFixed(2)).toBe('7.50');
        expect(pack.subtotal.toFixed(2)).toBe('90.00');
    });

    it('redondea al final un pack de 3 unidades por C$10', () => {
        const [item] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1', presentation: 'PACK' }],
            [product({ price: 5, packUnit: 'paquete', packSize: 3, packPrice: 10 })],
        );

        expect(item.quantityExact.toString()).toBe('3');
        expect(item.unitPrice.toFixed(4)).toBe('3.3333');
        expect(item.subtotal.toFixed(2)).toBe('10.00');
    });

    it('permite BASE y PACK del mismo SKU y suma 103.5 unidades exactas', () => {
        const items = resolvePublicOrderItems(
            'tenant-a',
            [
                { productId: 'product-a', quantity: '1', presentation: 'PACK' },
                { productId: 'product-a', quantity: '3.5', presentation: 'BASE' },
            ],
            [product({ price: 100, packUnit: 'caja', packSize: 100, packPrice: 8000 })],
        );

        expect(items[0].quantityExact.toString()).toBe('100');
        expect(items[0].unitPrice.toFixed(2)).toBe('80.00');
        expect(items[1].quantityExact.toString()).toBe('3.5');
        expect(items[1].unitPrice.toFixed(2)).toBe('100.00');
        expect(items.reduce((sum, item) => sum.plus(item.quantityExact), new Decimal(0)).toString()).toBe('103.5');
    });

    it('rechaza producto cross-tenant o no publicado', () => {
        expect(() => resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1' }],
            [product({ tenantId: 'tenant-b' })],
        )).toThrowError(expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }));
        expect(() => resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1' }],
            [product({ isPublished: false })],
        )).toThrowError(expect.objectContaining({ code: 'PRODUCT_NOT_PUBLIC' }));
    });

    it('ignora cualquier precio cliente y usa únicamente Product', () => {
        const malicious = { productId: 'product-a', quantity: '1', price: '0.01' } as any;
        const [item] = resolvePublicOrderItems('tenant-a', [malicious], [product({ price: 120 })]);
        expect(item.unitPrice.toFixed(2)).toBe('120.00');
        expect(item.subtotal.toFixed(2)).toBe('120.00');
    });

    it('convierte el snapshot público conservando cantidad y precio exactos', () => {
        const [item] = publicOrderItemsForQuotation([{
            productId: 'product-a',
            name: 'Pack de tres',
            quantity: '3',
            quantityExact: '3.0000',
            price: 3.33,
            unitPriceExact: '3.3333',
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: '1',
            presentationAtSale: 'PACK',
            presentationQuantityAtSale: '1',
            ivaExento: true,
        }]);

        expect(item.quantityLegacy).toBe(3);
        expect(item.quantityExact.toFixed(4)).toBe('3.0000');
        expect(item.priceLegacy.toFixed(2)).toBe('3.33');
        expect(item.lineTotal.toFixed(2)).toBe('10.00');
    });

    it('envía a conciliación pedidos legacy sin precio/IVA/presentación exactos', () => {
        expect(() => publicOrderItemsForQuotation([{
            productId: 'product-a',
            name: 'Producto viejo',
            quantity: 3,
            price: 3.33,
        }])).toThrowError(expect.objectContaining({
            code: 'RECONCILIATION_REQUIRED',
            httpStatus: 409,
        }));
    });
});
