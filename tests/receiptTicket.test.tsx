import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReceiptLineItem, ReceiptTicket } from '../components/ReceiptTicket';

const product = (overrides: Partial<ReceiptLineItem>): ReceiptLineItem => ({
    id: 'product-1',
    name: 'Producto',
    price: 1,
    costPrice: 0.5,
    stock: 100,
    sku: 'SKU-1',
    category: 'General',
    quantity: 1,
    ...overrides,
});

const receiptData = (items: ReceiptLineItem[]) => ({
    tenantName: 'Nortex',
    date: '22/08/2026 10:30',
    customerName: 'Cliente General',
    items,
    subtotal: 140.1,
    tax: 18.27,
    total: 140.1,
    paymentMethod: 'EFECTIVO',
    user: 'Caja Uno',
});

describe('ticket visual del POS', () => {
    it('muestra medidos, precision minima, legacy y empaque sin confundir stock base', () => {
        const html = renderToStaticMarkup(<ReceiptTicket data={receiptData([
            product({
                id: 'meat',
                name: 'Carne molida',
                quantity: 1.25,
                price: 48,
                unit: 'lb',
                saleMode: 'MEASURED',
            }),
            product({
                id: 'sample',
                name: 'Muestra',
                quantity: 0.0001,
                price: 1000,
                unit: 'kg',
                saleMode: 'MEASURED',
            }),
            product({
                id: 'legacy',
                name: 'Martillo',
                quantity: 2,
                price: 10,
                unit: null,
            }),
            product({
                id: 'feed',
                name: 'Concentrado bovino',
                quantity: 100,
                price: 0.6,
                unit: 'lb',
                presentation: 'PACK',
                presentationQuantity: 1,
                packUnit: 'saco',
            }),
        ])} />);

        expect(html).toContain('1.25 lb × C$ 48.00/lb');
        expect(html).toContain('C$ 60.00');
        expect(html).toContain('0.0001 kg × C$ 1000.00/kg');
        expect(html).toContain('2 x C$ 10.00');
        expect(html).toContain('1 saco × C$ 60.00/saco');
        expect(html).not.toContain('100 lb');
    });

    it('delega el escape de contenido controlado por usuario a React', () => {
        const html = renderToStaticMarkup(<ReceiptTicket data={receiptData([
            product({ name: '<script>alert(1)</script>' }),
        ])} />);

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
});
