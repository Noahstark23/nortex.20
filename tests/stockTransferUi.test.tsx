// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Warehouses from '../components/Warehouses';

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const warehouses = [
    { id: 'warehouse-a', name: 'Principal', isDefault: true, isActive: true },
    { id: 'warehouse-b', name: 'Sucursal', isDefault: false, isActive: true },
];

const stockResponse = jsonResponse({
    data: {
        items: [{
            productId: 'product-meat',
            name: 'Carne de res',
            sku: 'CARNE-01',
            unit: 'lb',
            stock: 5,
            implicit: false,
            saleMode: 'MEASURED',
            quantityStep: '0.01',
        }],
    },
});

const baseFetch = (
    onTransfer: (payload: Record<string, unknown>) => Response | Promise<Response>,
) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/warehouses' && !init?.method) return jsonResponse({ data: warehouses });
    if (url === '/api/team') return jsonResponse([]);
    if (url === '/api/warehouses/warehouse-a/stock') return stockResponse.clone();
    if (url === '/api/stock-transfers' && init?.method === 'POST') {
        return onTransfer(JSON.parse(String(init.body)) as Record<string, unknown>);
    }
    return jsonResponse({ error: `Ruta inesperada ${url}` }, 500);
});

const openMeasuredTransfer = async () => {
    render(<MemoryRouter initialEntries={['/inventario/bodegas']}><Warehouses /></MemoryRouter>);
    await screen.findAllByText('Carne de res');
    fireEvent.click(screen.getAllByRole('button', { name: 'Transferir Carne de res a otra bodega' })[0]);
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '1,25' } });
};

describe('UX idempotente de transferencias', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        localStorage.setItem('nortex_token', 'token-prueba');
        let counter = 0;
        vi.stubGlobal('crypto', {
            randomUUID: vi.fn(() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++counter).padStart(12, '0')}`),
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reintenta una falla de red con el mismo UUID y cantidad string exacta', async () => {
        const payloads: Record<string, unknown>[] = [];
        baseFetch(async (payload) => {
            payloads.push(payload);
            if (payloads.length === 1) throw new TypeError('sin red');
            return jsonResponse({ success: true, replay: true, data: { id: 'transfer-a' } });
        });

        await openMeasuredTransfer();
        fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
        await screen.findByText('sin red');
        fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
        await screen.findByText('Transferencia confirmada');

        expect(payloads).toHaveLength(2);
        expect(payloads[0].clientEventId).toBe(payloads[1].clientEventId);
        expect(payloads[0]).toMatchObject({
            fromWarehouseId: 'warehouse-a',
            toWarehouseId: 'warehouse-b',
            items: [{ productId: 'product-meat', quantity: '1.2500' }],
        });
        expect(typeof (payloads[0].items as Array<{ quantity: unknown }>)[0].quantity).toBe('string');
    });

    it('rota el UUID después de un conflicto y permite confirmar la intención revisada', async () => {
        const payloads: Record<string, unknown>[] = [];
        baseFetch((payload) => {
            payloads.push(payload);
            return payloads.length === 1
                ? jsonResponse({
                    error: 'clientEventId ya fue usado',
                    code: 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT',
                }, 409)
                : jsonResponse({ success: true, replay: false, data: { id: 'transfer-b' } }, 201);
        });

        await openMeasuredTransfer();
        fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
        await screen.findByText('La intención anterior ya fue usada. Revisá los datos y reintentá.');
        fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
        await screen.findByText('Transferencia realizada');

        expect(payloads).toHaveLength(2);
        expect(payloads[1].clientEventId).not.toBe(payloads[0].clientEventId);
        expect(payloads[1].items).toEqual(payloads[0].items);
    });
});
