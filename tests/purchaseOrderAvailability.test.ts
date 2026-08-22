import { describe, expect, it } from 'vitest';
import { calculatePurchaseOrderInvoiceAvailability } from '../backend/lib/purchaseOrderAvailability';

describe('calculatePurchaseOrderInvoiceAvailability', () => {
    it('descuenta lo ya facturado de lo recibido', () => {
        const result = calculatePurchaseOrderInvoiceAvailability(
            [{ productId: 'p1', productName: 'Arroz', quantityReceived: 12 }],
            [{ items: [{ productId: 'p1', quantity: 5 }] }],
        );

        expect(result.get('p1')?.remaining.toString()).toBe('7');
    });

    it('agrega líneas históricas repetidas del mismo producto', () => {
        const result = calculatePurchaseOrderInvoiceAvailability(
            [
                { productId: 'p1', productName: 'Arroz', quantityReceived: '4' },
                { productId: 'p1', productName: 'Arroz', quantityReceived: '6' },
            ],
            [
                { items: [{ productId: 'p1', quantity: 2 }] },
                { items: [{ productId: 'p1', quantity: 3 }] },
            ],
        );

        expect(result.get('p1')?.remaining.toString()).toBe('5');
    });

    it('mantiene saldos separados por producto', () => {
        const result = calculatePurchaseOrderInvoiceAvailability(
            [
                { productId: 'p1', productName: 'Arroz', quantityReceived: 8 },
                { productId: 'p2', productName: 'Frijol', quantityReceived: 3 },
            ],
            [{ items: [{ productId: 'p1', quantity: 8 }] }],
        );

        expect(result.get('p1')?.remaining.toString()).toBe('0');
        expect(result.get('p2')?.remaining.toString()).toBe('3');
    });
});
