// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases, { effectivePurchaseBalance, purchaseStatusLabel } from '../components/Purchases';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const partialPurchase = {
    id: 'purchase-partial',
    supplierId: 'supplier-1',
    supplier: { id: 'supplier-1', name: 'Carnes Molina' },
    invoiceNumber: 'FAC-101',
    date: '2026-08-25T12:00:00.000Z',
    dueDate: '2026-09-10T12:00:00.000Z',
    subtotal: '100.00',
    tax: '15.00',
    total: '115.00',
    balanceDue: '75.25',
    status: 'PARTIALLY_PAID',
    paymentMethod: 'CREDIT',
    items: [],
    createdAt: '2026-08-25T12:00:00.000Z',
};

const capitalPurchase = {
    ...partialPurchase,
    id: 'purchase-capital',
    invoiceNumber: 'CAP-22',
    balanceDue: null,
    status: 'PENDING_PAYMENT',
    paymentMethod: 'NORTEX_CAPITAL',
};

const completedPurchase = {
    ...partialPurchase,
    id: 'purchase-completed',
    invoiceNumber: 'FAC-100',
    balanceDue: '0.00',
    status: 'COMPLETED',
};

function installFetch(paymentHandler?: (init: RequestInit) => Response | Promise<Response>) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/suppliers') return jsonResponse([{ id: 'supplier-1', name: 'Carnes Molina' }]);
        if (url === '/api/products') return jsonResponse([]);
        if (url === '/api/purchases' && (!init?.method || init.method === 'GET')) {
            return jsonResponse([partialPurchase, capitalPurchase, completedPurchase]);
        }
        if (url === '/api/purchase-orders') return jsonResponse({ data: [] });
        if (url === '/api/warehouses') return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Principal', isDefault: true, isActive: true }] });
        if (url === '/api/purchases/purchase-partial/pay' && init?.method === 'POST' && paymentHandler) {
            return paymentHandler(init);
        }
        throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
    });
}

describe('abonos a proveedores en Compras', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('nortex_token', 'qa-token');
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        vi.stubGlobal('crypto', {
            randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('resuelve balance efectivo sin revivir una factura legacy completada', () => {
        expect(effectivePurchaseBalance({ balanceDue: '10.2500', status: 'PARTIALLY_PAID', total: '100' }).toString()).toBe('10.25');
        expect(effectivePurchaseBalance({ balanceDue: null, status: 'PENDING_PAYMENT', total: '100' }).toString()).toBe('100');
        expect(effectivePurchaseBalance({ balanceDue: null, status: 'COMPLETED', total: '100' }).toString()).toBe('0');
        expect(purchaseStatusLabel('PARTIALLY_PAID')).toBe('Abono parcial');
    });

    it('deja VIEWER en historial sin exponer alta ni pagos', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'VIEWER' }));
        installFetch();

        render(<Purchases />);

        expect(await screen.findByText('Cuentas por Pagar (1)')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Nueva Compra' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Abonar' })).toBeNull();
    });

    it('permite al contador abonar desde historial, pero no ingresar inventario', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'ACCOUNTANT' }));
        installFetch();

        render(<Purchases />);

        expect(await screen.findByText('Cuentas por Pagar (1)')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Nueva Compra' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Abonar' })).toHaveLength(1);
    });

    it('mantiene el clientEventId en un fallo y reintento y envía el decimal como string', async () => {
        const paymentBodies: Array<Record<string, unknown>> = [];
        installFetch((init) => {
            paymentBodies.push(JSON.parse(String(init.body)));
            if (paymentBodies.length === 1) return jsonResponse({ error: 'El servidor no confirmó el abono.' }, 503);
            return jsonResponse({
                purchase: { ...partialPurchase, balanceDue: '50.00', status: 'PARTIALLY_PAID' },
                payment: { id: 'supplier-payment-1', amount: '25.25', method: 'TRANSFER' },
                replay: false,
            });
        });

        render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        expect(await screen.findByText('Cuentas por Pagar (1)')).toBeTruthy();
        expect(screen.getByText('Abono parcial')).toBeTruthy();
        expect(screen.getByText('Financiamiento Nortex')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Abonar' })).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Abonar' }));
        expect(screen.getByRole('dialog', { name: 'Registrar abono' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));
        expect(await screen.findByText('Ingresá un monto válido.')).toBeTruthy();
        expect(paymentBodies).toHaveLength(0);

        fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '25.251' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));
        expect(await screen.findByText('El abono admite máximo dos decimales.')).toBeTruthy();
        expect(paymentBodies).toHaveLength(0);

        fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '25.25' } });
        fireEvent.change(screen.getByLabelText('Método del pago'), { target: { value: 'TRANSFER' } });
        fireEvent.change(screen.getByLabelText('Referencia del pago'), { target: { value: 'TRX-991' } });
        fireEvent.change(screen.getByLabelText('Notas del pago'), { target: { value: 'Transferencia BAC' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));

        expect((await screen.findAllByText('El servidor no confirmó el abono.')).length).toBeGreaterThan(0);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Registrar abono' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));

        await waitFor(() => expect(paymentBodies).toHaveLength(2));
        expect(paymentBodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            method: 'TRANSFER',
            amount: '25.25',
            reference: 'TRX-991',
            notes: 'Transferencia BAC',
        });
        expect(paymentBodies[1]).toEqual(paymentBodies[0]);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Registrar abono' })).toBeNull());
    });

    it('liquida el saldo omitiendo amount y genera un id nuevo solo al abrir otro intento', async () => {
        const paymentBodies: Array<Record<string, unknown>> = [];
        installFetch((init) => {
            paymentBodies.push(JSON.parse(String(init.body)));
            return jsonResponse({
                purchase: { ...partialPurchase, balanceDue: '0.00', status: 'COMPLETED' },
                payment: { id: 'supplier-payment-full', amount: '75.25', method: 'CASH' },
                replay: false,
            });
        });

        render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Abonar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Liquidar todo' }));

        await waitFor(() => expect(paymentBodies).toHaveLength(1));
        expect(paymentBodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            method: 'CASH',
        });
        expect(paymentBodies[0]).not.toHaveProperty('amount');
    });

    it('muestra loading en historial antes de evaluar el estado vacío', async () => {
        let resolvePurchases!: (response: Response) => void;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/suppliers') return jsonResponse([]);
            if (url === '/api/products') return jsonResponse([]);
            if (url === '/api/purchases') return new Promise<Response>((resolve) => { resolvePurchases = resolve; });
            if (url === '/api/purchase-orders') return jsonResponse({ data: [] });
            if (url === '/api/warehouses') return jsonResponse({ data: [] });
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        expect(await screen.findByLabelText('Cargando historial de compras')).toBeTruthy();
        expect(screen.queryByText('No hay compras registradas')).toBeNull();

        resolvePurchases(jsonResponse([]));
        expect(await screen.findByText('No hay compras registradas')).toBeTruthy();
    });
});
