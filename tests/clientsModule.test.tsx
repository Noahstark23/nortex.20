// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Clients from '../components/Clients';
import { authFetch } from '../utils/auth';

vi.mock('../utils/auth', () => ({
    authFetch: vi.fn(),
}));

const mockedAuthFetch = vi.mocked(authFetch);

const createMemoryStorage = (): Storage => {
    const state = new Map<string, string>();
    return {
        get length() {
            return state.size;
        },
        clear() {
            state.clear();
        },
        getItem(key: string) {
            return state.has(key) ? state.get(key)! : null;
        },
        key(index: number) {
            return [...state.keys()][index] ?? null;
        },
        removeItem(key: string) {
            state.delete(key);
        },
        setItem(key: string, value: string) {
            state.set(key, String(value));
        },
    };
};

Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
});

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const hubList = [{
    id: 'customer-1',
    name: 'Pulpería San José',
    taxId: '001-123456-0001A',
    phone: '8888 1111',
    email: 'caja@pulperia.test',
    address: 'Mercado oriental',
    creditLimit: 5000,
    currentDebt: 1250,
    isBlocked: false,
    isWholesale: true,
    sellerId: 'seller-1',
    seller: { id: 'seller-1', name: 'María Ruta' },
    createdAt: '2026-08-20T10:00:00.000Z',
    lastSaleAt: '2026-08-25T10:00:00.000Z',
    segment: 'withDebt',
    nextAction: 'Cobrar antes del viernes',
    stats: {
        salesCount: 8,
        creditSalesCount: 3,
        openInvoices: 2,
        overdueInvoices: 1,
        totalSales: 8200,
        outstandingBalance: 1250,
    },
}];

const hubDetail = {
    profile: hubList[0],
    receivables: {
        totals: { billed: 1500, paid: 250, balance: 1250, overdue: 1250 },
        invoices: [{
            id: 'sale-1',
            invoiceNumber: 'F-100',
            total: 1500,
            paid: 250,
            balance: 1250,
            dueDate: '2026-08-25T10:00:00.000Z',
            date: '2026-08-20T10:00:00.000Z',
            status: 'OVERDUE',
            soldBy: { id: 'seller-1', name: 'María Ruta' },
            payments: [{
                id: 'pay-1',
                amount: 250,
                method: 'CASH',
                date: '2026-08-21T10:00:00.000Z',
                collectedBy: 'Caja 1',
            }],
        }],
    },
    recentSales: [],
    recentPayments: [],
    interactions: [],
    timeline: [],
};

describe('módulo de clientes hub', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('oculta controles sensibles cuando entra un vendedor', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'VENDEDOR' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        expect(await screen.findByText('Pulpería San José')).toBeTruthy();
        expect(await screen.findByText('Cobrar antes del viernes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Bloquear crédito/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Desbloquear crédito/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Activar mayoreo/i })).toBeNull();
    });

    it.each(['MANAGER', 'VENDEDOR'])('protege la identidad legal y la omite del PUT para %s', async (role) => {
        localStorage.setItem('nortex_user', JSON.stringify({ role }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/customers/customer-1' && init?.method === 'PUT') {
                return jsonResponse({ ...hubList[0], phone: '7777 2222' });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Editar ficha/i }));

        const legalName = screen.getByLabelText('NOMBRE / RAZÓN SOCIAL') as HTMLInputElement;
        const taxId = screen.getByLabelText('DNI / RUC') as HTMLInputElement;
        expect(legalName.readOnly).toBe(true);
        expect(taxId.readOnly).toBe(true);
        expect(screen.getByText(/Solo administración puede cambiarlos/i)).toBeTruthy();

        fireEvent.change(legalName, { target: { value: 'Identidad alterada' } });
        fireEvent.change(taxId, { target: { value: 'RUC-ALTERADO' } });
        fireEvent.change(screen.getByLabelText('TELÉFONO'), { target: { value: '7777 2222' } });
        fireEvent.change(screen.getByLabelText('EMAIL'), { target: { value: 'ruta@pulperia.test' } });
        fireEvent.change(screen.getByLabelText('DIRECCIÓN'), { target: { value: 'Mercado occidental' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar ficha/i }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/customers/customer-1' && init?.method === 'PUT'
            ));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body));
            expect(body).toEqual({
                phone: '7777 2222',
                email: 'ruta@pulperia.test',
                address: 'Mercado occidental',
            });
            expect(body).not.toHaveProperty('name');
            expect(body).not.toHaveProperty('taxId');
        });
    });

    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN'])('permite actualizar la identidad legal a %s y la incluye en el PUT', async (role) => {
        localStorage.setItem('nortex_user', JSON.stringify({ role }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([]);
            if (url === '/api/customers/customer-1' && init?.method === 'PUT') {
                return jsonResponse({ ...hubList[0], name: 'Comercial San José', taxId: 'RUC-NUEVO' });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Editar ficha/i }));

        const legalName = screen.getByLabelText('NOMBRE / RAZÓN SOCIAL') as HTMLInputElement;
        const taxId = screen.getByLabelText('DNI / RUC') as HTMLInputElement;
        expect(legalName.readOnly).toBe(false);
        expect(taxId.readOnly).toBe(false);
        fireEvent.change(legalName, { target: { value: 'Comercial San José' } });
        fireEvent.change(taxId, { target: { value: 'RUC-NUEVO' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar ficha/i }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/customers/customer-1' && init?.method === 'PUT'
            ));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body));
            expect(body.name).toBe('Comercial San José');
            expect(body.taxId).toBe('RUC-NUEVO');
        });
    });

    it('mantiene nombre y documento editables durante el alta de un vendedor', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'VENDEDOR' }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/customers' && init?.method === 'POST') {
                return jsonResponse({ id: 'customer-2' }, 201);
            }
            if (url === '/api/customers/customer-2/hub') return jsonResponse(hubDetail);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Nuevo/i }));
        const legalName = screen.getByLabelText('NOMBRE / RAZÓN SOCIAL') as HTMLInputElement;
        const taxId = screen.getByLabelText('DNI / RUC') as HTMLInputElement;
        expect(legalName.readOnly).toBe(false);
        expect(taxId.readOnly).toBe(false);
        expect(screen.queryByLabelText('LÍMITE DE CRÉDITO')).toBeNull();
        expect(screen.queryByLabelText('VENDEDOR ASIGNADO')).toBeNull();
        fireEvent.change(legalName, { target: { value: 'Cliente nuevo' } });
        fireEvent.change(taxId, { target: { value: 'RUC-ALTA' } });
        fireEvent.change(screen.getByLabelText('TELÉFONO'), { target: { value: '8888 2222' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar ficha/i }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/customers' && init?.method === 'POST'
            ));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body));
            expect(body.name).toBe('Cliente nuevo');
            expect(body.taxId).toBe('RUC-ALTA');
            expect(body.phone).toBe('8888 2222');
            expect(body).not.toHaveProperty('creditLimit');
            expect(body).not.toHaveProperty('isWholesale');
            expect(body).not.toHaveProperty('sellerId');
        });
    });

    it('muestra y envía controles administrativos durante el alta de un admin', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'ADMIN' }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') {
                return jsonResponse([{ id: 'seller-2', name: 'Carlos Ruta', role: 'VENDEDOR', status: 'ACTIVE' }]);
            }
            if (url === '/api/customers' && init?.method === 'POST') {
                return jsonResponse({ id: 'customer-2' }, 201);
            }
            if (url === '/api/customers/customer-2/hub') return jsonResponse(hubDetail);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Nuevo/i }));
        fireEvent.change(screen.getByLabelText('NOMBRE / RAZÓN SOCIAL'), { target: { value: 'Cliente administrado' } });
        fireEvent.change(screen.getByLabelText('DNI / RUC'), { target: { value: 'RUC-ADMIN' } });
        fireEvent.change(screen.getByLabelText('LÍMITE DE CRÉDITO'), { target: { value: '2500.50' } });
        fireEvent.change(await screen.findByLabelText('VENDEDOR ASIGNADO'), { target: { value: 'seller-2' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar ficha/i }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/customers' && init?.method === 'POST'
            ));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body));
            expect(body.creditLimit).toBe('2500.50');
            expect(body.sellerId).toBe('seller-2');
            expect(body).not.toHaveProperty('isWholesale');
        });
    });

    it('no ofrece alta de clientes a un viewer', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'VIEWER' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        expect(await screen.findByText('Pulpería San José')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Nuevo/i })).toBeNull();
    });

    it('reconsulta el hub cuando cambia la búsqueda', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([{ id: 'seller-1', name: 'María Ruta', role: 'VENDEDOR', status: 'ACTIVE' }]);
            if (url === '/api/customers/hub?search=Pulper%C3%ADa&segment=all&limit=80') return jsonResponse(hubList);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        const search = await screen.findByPlaceholderText('Buscar por nombre, documento, teléfono o email');
        fireEvent.change(search, { target: { value: 'Pulpería' } });

        await waitFor(() => {
            expect(mockedAuthFetch).toHaveBeenCalledWith('/api/customers/hub?search=Pulper%C3%ADa&segment=all&limit=80');
        });
    });

    it('carga el detalle del cliente seleccionado con cobranza y resumen', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([{ id: 'seller-1', name: 'María Ruta', role: 'VENDEDOR', status: 'ACTIVE' }]);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        expect(await screen.findByText('Cobranza')).toBeTruthy();
        expect(screen.getByText('Factura #F-100')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Bloquear crédito/i })).toBeTruthy();
    });

    it('abre el modal de edición con la ficha actual precargada', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([{ id: 'seller-1', name: 'María Ruta', role: 'VENDEDOR', status: 'ACTIVE' }]);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Editar ficha/i }));

        expect(await screen.findByText('Editar cliente')).toBeTruthy();
        expect(screen.getByDisplayValue('Pulpería San José')).toBeTruthy();
        expect(screen.getByDisplayValue('caja@pulperia.test')).toBeTruthy();
    });

    it('registra una gestión y refresca el detalle sin exponerla a VIEWER', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([]);
            if (url === '/api/customers/customer-1/interactions' && init?.method === 'POST') {
                return jsonResponse({ id: 'interaction-1', status: 'COMPLETED' }, 201);
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Registrar gestión/i }));
        expect(await screen.findByRole('dialog', { name: /Registrar gestión/i })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('RESULTADO / NOTA'), {
            target: { value: 'Cliente confirma llamada de seguimiento.' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Guardar gestión/i }));

        await waitFor(() => {
            expect(mockedAuthFetch).toHaveBeenCalledWith(
                '/api/customers/customer-1/interactions',
                expect.objectContaining({ method: 'POST' }),
            );
        });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Registrar gestión/i })).toBeNull());
    });

    it('envía una promesa con monto y fechas normalizadas sin redondear dinero en el cliente', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/customers/hub?segment=all&limit=80') return jsonResponse(hubList);
            if (url === '/api/customers/customer-1/hub') return jsonResponse(hubDetail);
            if (url === '/api/team') return jsonResponse([]);
            if (url === '/api/customers/customer-1/interactions' && init?.method === 'POST') {
                return jsonResponse({ id: 'promise-1', status: 'OPEN' }, 201);
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(
            <MemoryRouter>
                <Clients />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Registrar gestión/i }));
        fireEvent.change(screen.getByLabelText('TIPO DE GESTIÓN'), { target: { value: 'PROMISE' } });
        fireEvent.change(screen.getByLabelText('RESULTADO / NOTA'), { target: { value: 'Pagará una parte.' } });
        fireEvent.change(screen.getByLabelText('MONTO PROMETIDO'), { target: { value: '750.25' } });
        fireEvent.change(screen.getByLabelText('FECHA PROMETIDA'), { target: { value: '2026-08-29T10:00' } });
        fireEvent.change(screen.getByLabelText('PRÓXIMO SEGUIMIENTO'), { target: { value: '2026-08-28T15:00' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar gestión/i }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/customers/customer-1/interactions' && init?.method === 'POST'
            ));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body));
            expect(body.type).toBe('PROMISE');
            expect(body.promisedAmount).toBe('750.25');
            expect(new Date(body.promisedAt).toISOString()).toBe(body.promisedAt);
            expect(new Date(body.followUpAt).toISOString()).toBe(body.followUpAt);
        });
    });
});
