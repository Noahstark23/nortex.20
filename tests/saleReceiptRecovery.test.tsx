// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sales from '../components/Sales';

const sale = {
    id: 'sale-1', invoiceNumber: 16, invoiceSeries: 'A', createdAt: '2026-09-23T00:58:32.000Z',
    total: '34.00', status: 'COMPLETED', paymentMethod: 'CASH', customerName: 'Cliente Prueba',
    cancelledAt: null, cancelReason: null, vatAmountAtSale: '4.43',
    _count: { items: 1, productReturns: 0, correctionRequests: 0 },
};
const receipt = {
    ...sale,
    tenant: { businessName: 'Pulpería La Demo', taxId: 'TAX-interno', address: null, phone: null, dgiAuthCode: null },
    items: [{ id: 'item-1', productNameAtSale: 'Arroz histórico', quantity: 2, unitAtSale: 'libra', priceAtSale: '17.00', unitPriceExactAtSale: null }],
};
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recuperación del comprobante', () => {
    it('reabre la foto persistida desde Ventas sin volver a cobrar ni mostrar RUC demo', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input).startsWith('/api/sales?')) return response({ items: [sale] });
            if (String(input) === '/api/sales/sale-1/receipt') return response(receipt);
            throw new Error(`Ruta inesperada: ${String(input)}`);
        });
        render(<Sales />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ver comprobante A-000016' }));
        const dialog = await screen.findByRole('dialog', { name: 'Pulpería La Demo' });
        expect(dialog.textContent).toContain('Arroz histórico');
        expect(dialog.textContent).toContain('Total original: C$ 34.00');
        expect(dialog.textContent).toContain('22/9/2026');
        expect(dialog.textContent).not.toContain('TAX-interno');
        expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    });
});
