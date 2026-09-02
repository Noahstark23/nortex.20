// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import DeliveryManager, { mergePendingOrders } from '../components/DeliveryManager';
import type { DeliveryOrder } from '../components/delivery/DeliveryKanban';

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const baseOrder: DeliveryOrder = {
    id: 'pedido-1',
    clienteNombre: 'Pulpería San José',
    clienteTelefono: '8888-1111',
    direccionEntrega: 'De la iglesia, dos cuadras al lago',
    estado: 'pendiente',
    total: 485,
    createdAt: '2026-09-01T12:00:00.000Z',
    motorizadoId: null,
    items: [{ cantidad: 2, producto: { name: 'Arroz nacional' } }],
};

const orderForPage = (id: string, clienteNombre: string): DeliveryOrder => ({
    ...baseOrder,
    id,
    clienteNombre,
});

const rider = {
    id: 'rider-1',
    nombre: 'María López',
    telefono: '7777-2222',
    tipoFlota: 'PROPIA',
    activo: true,
};

const requestUrl = (input: RequestInfo | URL): string => (
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
);

const requestPath = (url: string): string => url.split('?')[0];

const isPedidosListGet = (url: string, init?: RequestInit): boolean => (
    requestPath(url) === '/api/v1/pedidos' && !init?.method
);

const installReducedMotion = () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nortex_token', 'qa-token');
    installReducedMotion();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('DeliveryManager — autoridad del servidor', () => {
    it('preserva la versión optimista mientras el polling trae un estado anterior', () => {
        const current = [{ ...baseOrder, estado: 'preparando' }];
        const staleServer = [{ ...baseOrder, estado: 'pendiente' }];

        expect(mergePendingOrders(staleServer, current, new Set(['pedido-1']))[0].estado)
            .toBe('preparando');
        expect(mergePendingOrders(staleServer, current, new Set())[0].estado)
            .toBe('pendiente');
    });

    it('carga la lista completa del contrato vigente sin agregar paginación cliente', async () => {
        const includedOrder = orderForPage('pedido-incluido', 'Cliente sin duplicar');
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({
                    pedidos: [
                        orderForPage('pedido-pagina-1', 'Cliente primera página'),
                        includedOrder,
                        orderForPage('pedido-pagina-2', 'Cliente segunda página'),
                    ],
                });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [] });
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);

        expect(await screen.findByText('Cliente primera página')).toBeVisible();
        expect(screen.getByText('Cliente segunda página')).toBeVisible();
        expect(screen.getAllByText('Cliente sin duplicar')).toHaveLength(1);

        const listCalls = fetchMock.mock.calls.filter(([input, init]) => (
            isPedidosListGet(requestUrl(input), init)
        ));
        expect(listCalls).toHaveLength(1);
        expect(requestUrl(listCalls[0][0])).toBe('/api/v1/pedidos');
    });

    it('revierte el movimiento y muestra el error cuando el servidor rechaza la reserva', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [baseOrder] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [] });
            }
            if (url === '/api/v1/pedidos/pedido-1/estado' && init?.method === 'PATCH') {
                return jsonResponse({ error: 'No hay inventario suficiente.' }, 422);
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', { name: /Iniciar preparación/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('No hay inventario suficiente.');
        expect(await screen.findByRole('button', { name: /Iniciar preparación/i })).toBeEnabled();

        const statePatches = fetchMock.mock.calls.filter(([input, init]) => (
            requestUrl(input) === '/api/v1/pedidos/pedido-1/estado'
            && init?.method === 'PATCH'
        ));
        expect(statePatches).toHaveLength(1);
    });

    it('acepta la respuesta autoritativa y nunca permite avanzar hasta entregado', async () => {
        let serverOrder = { ...baseOrder };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [serverOrder] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [] });
            }
            if (url === '/api/v1/pedidos/pedido-1/estado' && init?.method === 'PATCH') {
                serverOrder = { ...serverOrder, estado: 'preparando' };
                return jsonResponse({ pedido: serverOrder });
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', { name: /Iniciar preparación/i }));

        expect(await screen.findByText('Pedido de Pulpería San José actualizado correctamente.')).toBeVisible();
        expect(await screen.findByRole('button', { name: /Despachar/i })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Entregar|Marcar.*entregado/i })).not.toBeInTheDocument();

        const patch = fetchMock.mock.calls.find(([input, init]) => (
            requestUrl(input) === '/api/v1/pedidos/pedido-1/estado'
            && init?.method === 'PATCH'
        ));
        expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ estado: 'preparando' });
    });

    it('asigna el motorizado y auto-despacha para preservar el flujo operativo de main', async () => {
        let serverOrder = { ...baseOrder };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [serverOrder] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [rider] });
            }
            if (url === '/api/v1/pedidos/pedido-1/motorizado' && init?.method === 'PATCH') {
                serverOrder = { ...serverOrder, motorizadoId: 'rider-1' };
                return jsonResponse({ pedido: serverOrder });
            }
            if (url === '/api/v1/pedidos/pedido-1/estado' && init?.method === 'PATCH') {
                serverOrder = { ...serverOrder, estado: 'en_camino' };
                return jsonResponse({ pedido: serverOrder });
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.change(await screen.findByLabelText('Motorizado'), {
            target: { value: 'rider-1' },
        });

        expect(await screen.findByText('Motorizado asignado y pedido despachado correctamente.')).toBeVisible();
        expect(screen.queryByRole('button', { name: /Despachar/i })).not.toBeInTheDocument();

        const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
        expect(mutations).toHaveLength(2);
        expect(requestUrl(mutations[0][0])).toBe('/api/v1/pedidos/pedido-1/motorizado');
        expect(JSON.parse(String(mutations[0][1]?.body))).toEqual({ motorizadoId: 'rider-1' });
        expect(requestUrl(mutations[1][0])).toBe('/api/v1/pedidos/pedido-1/estado');
        expect(JSON.parse(String(mutations[1][1]?.body))).toEqual({
            estado: 'en_camino',
            nota: 'Motorizado asignado — pedido despachado.',
        });
    });

    it('distingue una asignación confirmada de un despacho rechazado', async () => {
        let serverOrder = { ...baseOrder, estado: 'preparando' };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [serverOrder] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [rider] });
            }
            if (url === '/api/v1/pedidos/pedido-1/motorizado' && init?.method === 'PATCH') {
                serverOrder = { ...serverOrder, motorizadoId: 'rider-1' };
                return jsonResponse({ pedido: serverOrder });
            }
            if (url === '/api/v1/pedidos/pedido-1/estado' && init?.method === 'PATCH') {
                return jsonResponse({ error: 'El pedido fue procesado por otra operación.' }, 409);
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.change(await screen.findByLabelText('Motorizado'), {
            target: { value: 'rider-1' },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'El motorizado quedó asignado, pero no pudimos confirmar el despacho: El pedido fue procesado por otra operación.',
        );
        await waitFor(() => expect(screen.getByLabelText('Motorizado')).toHaveValue('rider-1'));
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2);
    });

    it('obedece la asignación canónica del servidor aunque difiera de la solicitada', async () => {
        const serverOrder = { ...baseOrder, estado: 'preparando', motorizadoId: null };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [serverOrder] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [rider] });
            }
            if (url === '/api/v1/pedidos/pedido-1/motorizado' && init?.method === 'PATCH') {
                return jsonResponse({ pedido: serverOrder });
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        const riderSelect = await screen.findByLabelText('Motorizado');
        fireEvent.change(riderSelect, { target: { value: 'rider-1' } });

        expect(await screen.findByText('El servidor dejó el pedido sin motorizado.')).toBeVisible();
        expect(riderSelect).toHaveValue('');
        expect(screen.getByRole('button', { name: /Despachar/i })).toBeDisabled();
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    });

    it('copia el login general y no reconstruye el magic-link legado por id', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) return jsonResponse({ pedidos: [] });
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [rider] });
            }
            throw new Error(`Solicitud inesperada: ${url}`);
        }));

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', {
            name: 'Copiar login de repartidores para María López',
        }));

        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/driver`);
        expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('/driver/rider-1'));
        expect(await screen.findByText('¡Copiado!')).toBeVisible();
    });

    it('abre una hoja accesible, enfoca el nombre y permite cerrar con Escape', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url)) return jsonResponse({ pedidos: [] });
            if (url === '/api/v1/motorizados') return jsonResponse({ motorizados: [] });
            throw new Error(`Solicitud inesperada: ${url}`);
        }));

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', { name: 'Agregar Motorizado' }));

        expect(await screen.findByRole('dialog', { name: 'Registrar Motorizado' })).toBeVisible();
        const nameInput = screen.getByLabelText('Nombre completo *');
        expect(screen.getByLabelText('Teléfono / WhatsApp *')).toBeVisible();
        expect(screen.getByLabelText('Zona de cobertura *')).toBeVisible();
        expect(screen.getByLabelText('Placa / vehículo (opcional)')).toBeVisible();
        await waitFor(() => expect(nameInput).toHaveFocus());
        fireEvent.change(nameInput, { target: { value: 'Dato temporal' } });

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Registrar Motorizado' })).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Agregar Motorizado' }));
        expect(screen.getByLabelText('Nombre completo *')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled();
    });

    it('habilita el registro solo con datos válidos y envía el contrato exacto', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [] });
            }
            if (url === '/api/v1/motorizados' && init?.method === 'POST') {
                return jsonResponse({ motorizado: { id: 'rider-new' } }, 201);
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', { name: 'Agregar Motorizado' }));

        const registerButton = screen.getByRole('button', { name: 'Registrar' });
        const nameInput = screen.getByLabelText('Nombre completo *');
        const phoneInput = screen.getByLabelText('Teléfono / WhatsApp *');
        const zoneInput = screen.getByLabelText('Zona de cobertura *');
        const vehicleInput = screen.getByLabelText('Placa / vehículo (opcional)');

        expect(registerButton).toBeDisabled();
        fireEvent.change(nameInput, { target: { value: 'Juan Pérez' } });
        expect(registerButton).toBeDisabled();
        fireEvent.change(phoneInput, { target: { value: '7777-222' } });
        expect(registerButton).toBeDisabled();
        fireEvent.change(phoneInput, { target: { value: ' 8888-0000 ' } });
        expect(registerButton).toBeDisabled();
        fireEvent.change(zoneInput, { target: { value: 'M' } });
        expect(registerButton).toBeDisabled();
        fireEvent.change(zoneInput, { target: { value: ' Managua sur ' } });
        fireEvent.change(vehicleInput, { target: { value: ' M 123456 ' } });
        expect(registerButton).toBeEnabled();

        fireEvent.click(registerButton);

        await waitFor(() => {
            const mutation = fetchMock.mock.calls.find(([input, init]) => (
                requestUrl(input) === '/api/v1/motorizados' && init?.method === 'POST'
            ));
            expect(mutation).toBeDefined();
            expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
                nombre: 'Juan Pérez',
                telefono: '8888-0000',
                zonaCobertura: 'Managua sur',
                vehiculoPlaca: 'M 123456',
            });
        });

        expect(await screen.findByText('Motorizado registrado correctamente.')).toBeVisible();
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Registrar Motorizado' })).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Agregar Motorizado' }));
        expect(screen.getByLabelText('Nombre completo *')).toHaveValue('');
        expect(screen.getByLabelText('Teléfono / WhatsApp *')).toHaveValue('');
        expect(screen.getByLabelText('Zona de cobertura *')).toHaveValue('');
        expect(screen.getByLabelText('Placa / vehículo (opcional)')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled();
    });

    it('mantiene la hoja abierta y muestra el mensaje del servidor si el alta falla', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = requestUrl(input);
            if (isPedidosListGet(url, init)) {
                return jsonResponse({ pedidos: [] });
            }
            if (url === '/api/v1/motorizados' && !init?.method) {
                return jsonResponse({ motorizados: [] });
            }
            if (url === '/api/v1/motorizados' && init?.method === 'POST') {
                return jsonResponse({ error: 'Ya existe un motorizado con ese teléfono.' }, 409);
            }
            throw new Error(`Solicitud inesperada: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<DeliveryManager />);
        fireEvent.click(await screen.findByRole('button', { name: 'Agregar Motorizado' }));
        fireEvent.change(screen.getByLabelText('Nombre completo *'), {
            target: { value: 'María López' },
        });
        fireEvent.change(screen.getByLabelText('Teléfono / WhatsApp *'), {
            target: { value: '7777-2222' },
        });
        fireEvent.change(screen.getByLabelText('Zona de cobertura *'), {
            target: { value: 'Masaya urbana' },
        });

        const registerButton = screen.getByRole('button', { name: 'Registrar' });
        expect(registerButton).toBeEnabled();
        fireEvent.click(registerButton);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Ya existe un motorizado con ese teléfono.',
        );
        expect(screen.getByRole('dialog', { name: 'Registrar Motorizado' })).toBeVisible();
        await waitFor(() => expect(registerButton).toBeEnabled());

        const post = fetchMock.mock.calls.find(([input, init]) => (
            requestUrl(input) === '/api/v1/motorizados' && init?.method === 'POST'
        ));
        expect(JSON.parse(String(post?.[1]?.body))).toEqual({
            nombre: 'María López',
            telefono: '7777-2222',
            zonaCobertura: 'Masaya urbana',
        });
    });
});
