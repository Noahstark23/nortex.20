// @vitest-environment jsdom

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AccountsReceivable, { formatReceivableDate, formatReceivableDateTime } from '../components/AccountsReceivable';
import { authFetch } from '../utils/auth';

vi.mock('../utils/auth', () => ({
    authFetch: vi.fn(),
}));

vi.mock('../utils/tours', () => ({
    maybeAutostartTour: vi.fn(),
}));

const mockedAuthFetch = vi.mocked(authFetch);

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const worklistPayload = {
    summary: {
        totalReceivable: 1200,
        totalOverdue: 1200,
        overdueCount: 1,
        dueSoon: 0,
        dueSoonCount: 0,
        collectedToday: 250,
        dueSoonDays: 7,
    },
    items: [{
        saleId: 'sale-1',
        customerId: 'customer-1',
        customerName: 'Pulpería San José',
        phone: '88881111',
        invoiceNumber: 'F-100',
        date: '2026-08-20T10:00:00.000Z',
        dueDate: '2026-08-25T10:00:00.000Z',
        total: 1500,
        balance: 1200,
        daysOverdue: 2,
        bucket: 'b1_30',
        status: 'OVERDUE',
    }],
};

const statementPayload = {
    customer: {
        id: 'customer-1',
        name: 'Pulpería San José',
        phone: '88881111',
        creditLimit: 5000,
        currentDebt: 1200,
        isBlocked: false,
    },
    invoices: [{
        id: 'sale-1',
        invoiceNumber: 'F-100',
        date: '2026-08-20T10:00:00.000Z',
        dueDate: '2026-08-25T10:00:00.000Z',
        total: 1500,
        paid: 300,
        balance: 1200,
        daysOverdue: 2,
        status: 'OVERDUE',
        payments: [{
            id: 'payment-old',
            amount: 300,
            method: 'CASH',
            date: '2026-08-21T10:00:00.000Z',
            collectedBy: 'Caja 1',
        }],
    }],
    totals: { billed: 1500, paid: 300, balance: 1200, overdue: 1200 },
    generatedAt: '2026-08-27T10:00:00.000Z',
};

const renderModule = (entry = '/app/receivables') => render(
    <MemoryRouter initialEntries={[entry]}>
        <AccountsReceivable />
    </MemoryRouter>,
);

describe('Cobranza Customer 360', () => {
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
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('presenta fechas y horas con el día civil de Managua en los bordes UTC', async () => {
        expect(formatReceivableDate('2026-08-21T03:30:00.000Z')).toBe('20 ago 2026');
        expect(formatReceivableDateTime('2026-08-21T03:30:00.000Z')).toContain('20 ago 2026, 09:30');
        expect(formatReceivableDateTime('2026-08-21T03:30:00.000Z')).not.toContain('21 ago');
        expect(formatReceivableDate('fecha-inválida')).toBe('—');

        const boundaryWorklist = {
            ...worklistPayload,
            items: [{
                ...worklistPayload.items[0],
                dueDate: '2026-08-26T03:30:00.000Z',
            }],
        };
        const boundaryStatement = {
            ...statementPayload,
            generatedAt: '2026-08-28T03:30:00.000Z',
            invoices: [{
                ...statementPayload.invoices[0],
                date: '2026-08-21T03:30:00.000Z',
                dueDate: '2026-08-26T03:30:00.000Z',
                payments: [{
                    ...statementPayload.invoices[0].payments[0],
                    date: '2026-08-22T03:30:00.000Z',
                }],
            }],
        };
        let printedStatement = '';
        vi.spyOn(window, 'open').mockReturnValue({
            document: {
                write: vi.fn((html: string) => { printedStatement = html; }),
                close: vi.fn(),
            },
        } as unknown as Window);
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(boundaryWorklist);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(boundaryStatement);
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();

        expect(await screen.findByText('Vence: 25 ago 2026')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));

        expect(await screen.findByText(/Estado generado 27 ago 2026, 09:30/)).toBeTruthy();
        expect(screen.getByText('Emitida 20 ago 2026 · vence 25 ago 2026')).toBeTruthy();
        expect(screen.getAllByText(/21 ago 2026, 09:30/).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Imprimir estado' }));
        expect(printedStatement).toContain('Generado: 27 ago 2026, 09:30');
        expect(printedStatement).not.toContain('Generado: 28 ago 2026');
    });

    it('mantiene el clientEventId entre un fallo y el reintento y ofrece el recibo en un modal', async () => {
        const paymentBodies: Array<Record<string, unknown>> = [];
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            if (url === '/api/credits/payment' && init?.method === 'POST') {
                paymentBodies.push(JSON.parse(String(init.body)));
                return paymentBodies.length === 1
                    ? jsonResponse({ error: 'El servidor no confirmó el abono.' }, 503)
                    : jsonResponse({ id: 'payment-new' }, 201);
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();

        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Abonar factura F-100' }));

        const paymentDialog = screen.getByRole('dialog', { name: /Registrar abono/i });
        expect(paymentDialog).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));
        expect(await screen.findByText('Ingresá un monto mayor que cero.')).toBeTruthy();
        expect(paymentBodies).toHaveLength(0);

        fireEvent.change(screen.getByLabelText('Monto a cobrar (C$)'), { target: { value: '100.50' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));
        await waitFor(() => expect(paymentBodies).toHaveLength(1));
        expect((await screen.findAllByText('El servidor no confirmó el abono.')).length).toBeGreaterThan(0);

        await waitFor(() => expect((screen.getByRole('button', { name: /Confirmar abono/i }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));

        await waitFor(() => expect(paymentBodies).toHaveLength(2));
        expect(paymentBodies[0]).toMatchObject({
            saleId: 'sale-1',
            amount: '100.50',
            method: 'CASH',
            clientEventId: '11111111-1111-4111-8111-111111111111',
        });
        expect(paymentBodies[1].clientEventId).toBe(paymentBodies[0].clientEventId);

        const receiptDialog = await screen.findByRole('dialog', { name: /Abono registrado/i });
        expect(receiptDialog).toBeTruthy();
        expect(screen.getByRole('button', { name: /Imprimir recibo/i })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
        expect(screen.queryByRole('dialog', { name: /Abono registrado/i })).toBeNull();
    });

    it('valida la justificación dentro del modal antes de castigar una cuenta', async () => {
        let writeoffBody: Record<string, unknown> | null = null;
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            if (url === '/api/credits/sale-1/writeoff' && init?.method === 'POST') {
                writeoffBody = JSON.parse(String(init.body));
                return jsonResponse({ message: 'Castigo registrado.' });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();

        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Marcar factura F-100 como incobrable' }));

        expect(screen.getByRole('dialog', { name: /Marcar como incobrable/i })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Confirmar castigo/i }));
        expect(await screen.findByText('Escribí una justificación de al menos 3 caracteres.')).toBeTruthy();
        expect(writeoffBody).toBeNull();

        fireEvent.change(screen.getByLabelText('Justificación'), {
            target: { value: 'Cliente cerró operaciones.' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar castigo/i }));

        await waitFor(() => expect(writeoffBody).toEqual({ reason: 'Cliente cerró operaciones.' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Marcar como incobrable/i })).toBeNull());
        expect(await screen.findByText('Venta castigada como incobrable')).toBeTruthy();
    });

    it('encierra el foco del abono, permite cierre seguro y vuelve al botón invocador', async () => {
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();

        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));
        const paymentTrigger = await screen.findByRole('button', { name: 'Abonar factura F-100' });
        fireEvent.click(paymentTrigger);

        let paymentDialog = screen.getByRole('dialog', { name: /Registrar abono/i });
        const amountInput = screen.getByLabelText('Monto a cobrar (C$)');
        const closeButton = screen.getByRole('button', { name: 'Cerrar registro de abono' });
        const confirmButton = screen.getByRole('button', { name: /Confirmar abono/i });
        await waitFor(() => expect(document.activeElement).toBe(amountInput));

        confirmButton.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(closeButton);
        closeButton.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirmButton);

        paymentTrigger.focus();
        expect(paymentDialog.contains(document.activeElement)).toBe(true);
        fireEvent.mouseDown(paymentDialog);
        expect(screen.getByRole('dialog', { name: /Registrar abono/i })).toBeTruthy();
        fireEvent.mouseDown(paymentDialog.parentElement!);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Registrar abono/i })).toBeNull());
        expect(document.activeElement).toBe(paymentTrigger);

        paymentTrigger.focus();
        fireEvent.click(paymentTrigger);
        paymentDialog = screen.getByRole('dialog', { name: /Registrar abono/i });
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Registrar abono/i })).toBeNull());
        expect(document.activeElement).toBe(paymentTrigger);
        expect(paymentDialog.isConnected).toBe(false);
    });

    it('encierra el foco del recibo y conserva Escape, backdrop y retorno de foco', async () => {
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            if (url === '/api/credits/payment' && init?.method === 'POST') return jsonResponse({ id: 'payment-new' }, 201);
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();
        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));

        const openReceipt = async () => {
            const trigger = await screen.findByRole('button', { name: 'Abonar factura F-100' });
            fireEvent.click(trigger);
            fireEvent.change(screen.getByLabelText('Monto a cobrar (C$)'), { target: { value: '25.00' } });
            fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));
            const dialog = await screen.findByRole('dialog', { name: /Abono registrado/i });
            return { dialog, trigger };
        };

        let receipt = await openReceipt();
        let safeButton = screen.getByRole('button', { name: 'Ahora no' });
        let printButton = screen.getByRole('button', { name: /Imprimir recibo/i });
        await waitFor(() => expect(document.activeElement).toBe(safeButton));

        printButton.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(safeButton);
        safeButton.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(printButton);
        receipt.trigger.focus();
        expect(receipt.dialog.contains(document.activeElement)).toBe(true);

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Abono registrado/i })).toBeNull());
        expect(document.activeElement).toBe(receipt.trigger);

        receipt = await openReceipt();
        safeButton = screen.getByRole('button', { name: 'Ahora no' });
        printButton = screen.getByRole('button', { name: /Imprimir recibo/i });
        await waitFor(() => expect(document.activeElement).toBe(safeButton));
        fireEvent.mouseDown(receipt.dialog);
        expect(screen.getByRole('dialog', { name: /Abono registrado/i })).toBeTruthy();
        fireEvent.mouseDown(receipt.dialog.parentElement!);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Abono registrado/i })).toBeNull());
        expect(document.activeElement).toBe(receipt.trigger);
        expect(printButton.isConnected).toBe(false);
    });

    it('devuelve el foco a un detalle vivo si el abono liquida y elimina el botón invocador', async () => {
        let statementCalls = 0;
        const settledStatement = {
            ...statementPayload,
            customer: { ...statementPayload.customer, currentDebt: 0 },
            invoices: [{
                ...statementPayload.invoices[0],
                paid: 1500,
                balance: 0,
                status: 'PAID',
            }],
            totals: { billed: 1500, paid: 1500, balance: 0, overdue: 0 },
        };
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') {
                statementCalls += 1;
                return jsonResponse(statementCalls === 1 ? statementPayload : settledStatement);
            }
            if (url === '/api/credits/payment' && init?.method === 'POST') return jsonResponse({ id: 'payment-final' }, 201);
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();
        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));
        const trigger = await screen.findByRole('button', { name: 'Abonar factura F-100' });
        fireEvent.click(trigger);
        fireEvent.change(screen.getByLabelText('Monto a cobrar (C$)'), { target: { value: '1200.00' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));

        await screen.findByRole('dialog', { name: /Abono registrado/i });
        await waitFor(() => expect(trigger.isConnected).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));

        const detail = screen.getByRole('region', { name: 'Detalle de cobranza' });
        await waitFor(() => expect(document.activeElement).toBe(detail));
    });

    it('no deja cerrar abono o castigo con Escape/backdrop mientras la mutación está en curso', async () => {
        let resolvePayment!: (response: Response) => void;
        let resolveWriteoff!: (response: Response) => void;
        const paymentPending = new Promise<Response>((resolve) => { resolvePayment = resolve; });
        const writeoffPending = new Promise<Response>((resolve) => { resolveWriteoff = resolve; });

        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            if (url === '/api/credits/payment' && init?.method === 'POST') return paymentPending;
            if (url === '/api/credits/sale-1/writeoff' && init?.method === 'POST') return writeoffPending;
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();
        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));

        fireEvent.click(await screen.findByRole('button', { name: 'Abonar factura F-100' }));
        fireEvent.change(screen.getByLabelText('Monto a cobrar (C$)'), { target: { value: '25.00' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar abono/i }));
        const paymentDialog = screen.getByRole('dialog', { name: /Registrar abono/i });
        await waitFor(() => expect((screen.getByRole('button', { name: /Registrando/i }) as HTMLButtonElement).disabled).toBe(true));
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseDown(paymentDialog.parentElement!);
        expect(screen.getByRole('dialog', { name: /Registrar abono/i })).toBeTruthy();
        resolvePayment(jsonResponse({ error: 'Fallo controlado.' }, 503));
        await waitFor(() => expect((screen.getByRole('button', { name: /Confirmar abono/i }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar registro de abono' }));

        fireEvent.click(screen.getByRole('button', { name: 'Marcar factura F-100 como incobrable' }));
        fireEvent.change(screen.getByLabelText('Justificación'), { target: { value: 'Cliente insolvente.' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar castigo/i }));
        const writeoffDialog = screen.getByRole('dialog', { name: /Marcar como incobrable/i });
        await waitFor(() => expect((screen.getByRole('button', { name: /Registrando/i }) as HTMLButtonElement).disabled).toBe(true));
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseDown(writeoffDialog.parentElement!);
        expect(screen.getByRole('dialog', { name: /Marcar como incobrable/i })).toBeTruthy();
        resolveWriteoff(jsonResponse({ error: 'Fallo controlado.' }, 503));
        await waitFor(() => expect((screen.getByRole('button', { name: /Confirmar castigo/i }) as HTMLButtonElement).disabled).toBe(false));
    });

    it('encierra el foco del castigo y conserva Escape, backdrop y retorno de foco', async () => {
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse(worklistPayload);
            if (url === '/api/customers/customer-1/statement') return jsonResponse(statementPayload);
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule();
        fireEvent.click(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' }));
        const writeoffTrigger = await screen.findByRole('button', { name: 'Marcar factura F-100 como incobrable' });

        fireEvent.click(writeoffTrigger);
        let writeoffDialog = screen.getByRole('dialog', { name: /Marcar como incobrable/i });
        const reasonInput = screen.getByLabelText('Justificación');
        const closeButton = screen.getByRole('button', { name: 'Cerrar castigo de cuenta' });
        const confirmButton = screen.getByRole('button', { name: /Confirmar castigo/i });
        await waitFor(() => expect(document.activeElement).toBe(reasonInput));

        confirmButton.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(closeButton);
        closeButton.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirmButton);
        writeoffTrigger.focus();
        expect(writeoffDialog.contains(document.activeElement)).toBe(true);

        fireEvent.mouseDown(writeoffDialog);
        expect(screen.getByRole('dialog', { name: /Marcar como incobrable/i })).toBeTruthy();
        fireEvent.mouseDown(writeoffDialog.parentElement!);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Marcar como incobrable/i })).toBeNull());
        expect(document.activeElement).toBe(writeoffTrigger);

        writeoffTrigger.focus();
        fireEvent.click(writeoffTrigger);
        writeoffDialog = screen.getByRole('dialog', { name: /Marcar como incobrable/i });
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Marcar como incobrable/i })).toBeNull());
        expect(document.activeElement).toBe(writeoffTrigger);
        expect(writeoffDialog.isConnected).toBe(false);
    });

    it('deja el error de carga visible y permite reintentar la bandeja', async () => {
        let attempts = 0;
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url !== '/api/collections/worklist?dueSoonDays=7') throw new Error(`URL no esperada: ${url}`);
            attempts += 1;
            return attempts === 1
                ? jsonResponse({ error: 'Servicio temporalmente no disponible.' }, 503)
                : jsonResponse(worklistPayload);
        });

        renderModule();

        expect(await screen.findByText('No pudimos actualizar la bandeja')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('button', { name: 'Abrir estado de cuenta de Pulpería San José' })).toBeTruthy();
        expect(attempts).toBe(2);
    });

    it('muestra el fallo de un acceso directo aunque el cliente no esté en la bandeja', async () => {
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/collections/worklist?dueSoonDays=7') return jsonResponse({ ...worklistPayload, items: [] });
            if (url === '/api/customers/customer-missing/statement') {
                return jsonResponse({ error: 'El cliente ya no está disponible.' }, 404);
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        renderModule('/app/receivables?customerId=customer-missing');

        expect(await screen.findByText('No pudimos abrir el estado de cuenta')).toBeTruthy();
        expect(screen.getAllByText('El cliente ya no está disponible.').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Reintentar detalle' })).toBeTruthy();
    });

    it('no vuelve a introducir diálogos nativos ni colores decorativos ajenos a Nortex', () => {
        const source = readFileSync(resolve(process.cwd(), 'components/AccountsReceivable.tsx'), 'utf8');
        expect(source).not.toMatch(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
        expect(source).not.toMatch(/(?:bg|text|border|from|to)-(?:blue|indigo)-/);
        expect(source.match(/role="dialog"/g)).toHaveLength(3);
        expect(source).toContain("xl:grid-cols-[minmax(330px,410px)_minmax(0,1fr)]");
    });
});
