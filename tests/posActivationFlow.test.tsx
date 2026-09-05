// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import POS from '../components/POS';
import Layout from '../components/Layout';
import { VentaEnCursoProvider } from '../components/VentaEnCursoContext';
import { db, getPendingSales } from '../lib/db';

const product = {
    id: 'p1', name: 'Arroz', sku: 'ARR-1', price: 25, cost: 10, stock: 20,
    category: 'General', unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1, minStock: 5,
};
let catalog: typeof product[];
let customers: Array<{ id: string; name: string; creditLimit: number; currentDebt: number; isBlocked: boolean }>;
let allowNegativeStock: boolean;
let saleNetworkFails: boolean;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
let analytics: ReturnType<typeof vi.fn>;

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(async () => {
    await db.offline_sales.clear();
    catalog = [];
    customers = [];
    allowNegativeStock = false;
    saleNetworkFails = false;
    posts = [];
    analytics = vi.fn();
    vi.stubGlobal('nxTrack', analytics);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    localStorage.clear();
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 'activation-t', businessName: 'Tienda QA', type: 'PULPERIA' }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'activation-u', name: 'Dueña', role: 'OWNER' }));
    localStorage.setItem('token', 'qa-token');
    localStorage.setItem('nortex_token', 'qa-token');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const requestUrl = new URL(String(input), 'http://test');
        const path = requestUrl.pathname;
        if (init?.method === 'POST') {
            const body: Record<string, unknown> = typeof init.body === 'string' ? JSON.parse(init.body) : {};
            posts.push({ path, body });
            if (path === '/api/products') {
                const created = { ...product, ...body, id: `created-${posts.length}`,
                    price: Number(body.price), cost: Number(body.cost), stock: Number(body.stock) };
                catalog = [...catalog, created];
                return ok(created);
            }
            if (path === '/api/sales') {
                if (saleNetworkFails) throw new TypeError('Failed to fetch');
                return ok({ id: `sale-${posts.length}`, total: body.total, invoiceNumber: '0001' });
            }
        }
        const responses: Record<string, unknown> = {
            '/api/products': requestUrl.searchParams.has('ids')
                ? catalog.filter(product => requestUrl.searchParams.get('ids')!.split(',').includes(product.id)) : catalog,
            '/api/customers': customers,
            '/api/shifts/current': { id: 'shift-a', status: 'OPEN', initialCash: '500', userId: 'activation-u',
                startTime: '2026-09-04T12:00:00Z', esTurnoPropio: true, turnoDe: null },
            '/api/cash-movements': [],
            '/api/cash-movements/balance': { efectivo: 500, efectivoNIO: 500 },
            '/api/tenant/inventory-settings': { allowNegativeStock },
            '/api/agent-banking/agreements': [],
            '/api/operational-alerts': { checkedAt: '2026-09-04T15:00:00Z', sections: [] },
        };
        return ok(path in responses ? responses[path] : {});
    }));
});

afterEach(async () => {
    cleanup();
    await db.offline_sales.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function RouteState() {
    const location = useLocation();
    return <output aria-label="Ruta actual">{location.pathname}{location.search}</output>;
}

const mount = (route = '/app/pos?first_sale=1') => render(
    <MemoryRouter initialEntries={[route]}><POS /><RouteState /></MemoryRouter>,
);

function useMobileViewport() {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        media: query, matches: query === '(prefers-reduced-motion: reduce)', onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
    })));
}

async function openQuick() {
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }));
    return screen.findByRole('dialog', { name: 'Agregar producto' });
}

function fillProduct(dialog: HTMLElement, stock?: string) {
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Arroz' } });
    fireEvent.change(within(dialog).getByLabelText('Precio de venta'), { target: { value: '25' } });
    if (stock !== undefined) fireEvent.change(within(dialog).getByLabelText('Existencia'), { target: { value: stock } });
}

describe('primera venta con existencia real', () => {
    it('tras vender pide solo los ids vendidos y conserva los otros productos para la próxima venta', async () => {
        const unsold = { ...product, id: 'p2', sku: 'SUERO-1', name: 'Suero oral' };
        catalog = [product, unsold];
        const user = userEvent.setup();
        mount('/app/pos');
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(screen.getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }));
        await user.type(screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/ }), '25');
        catalog = [{ ...product, stock: 0 }, unsold]; // Estado autoritativo posterior del fixture.
        await user.click(screen.getByRole('button', { name: 'Registrar efectivo y seguir' }));
        await screen.findByRole('dialog', { name: 'Venta lista' });
        await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/products?includeSellableStock=true&ids=p1')).toBe(true));
        expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/products?includeSellableStock=true')).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'Hacer otra venta' }));
        expect(await screen.findByText('Agotado')).toBeVisible();
        await user.type(screen.getByPlaceholderText('Escaneá o buscá un producto'), 'SUERO-1{Enter}');
        expect(screen.getByRole('textbox', { name: 'Cantidad de Suero oral en unidad' })).toHaveValue('1');
    });

    it.each([5, 20])('conserva las %i líneas y permite ajustar la última o quitar la primera', async count => {
        catalog = Array.from({ length: count }, (_, i) => ({ ...product, id: `p${i}`, sku: `SKU-${i}`, name: `Producto ${i}` }));
        const user = userEvent.setup();
        mount('/app/pos');
        const search = await screen.findByPlaceholderText('Escaneá o buscá un producto');
        for (let i = 0; i < count; i++) await user.type(search, `SKU-${i}{Enter}`);
        expect(screen.getAllByRole('textbox', { name: /^Cantidad de Producto/ })).toHaveLength(count);
        await user.click(screen.getByRole('button', { name: `Agregar 1 unidad de Producto ${count - 1}` }));
        expect(screen.getByRole('textbox', { name: `Cantidad de Producto ${count - 1} en unidad` })).toHaveValue('2');
        await user.click(screen.getByRole('button', { name: 'Quitar Producto 0 del ticket' }));
        expect(screen.getAllByRole('textbox', { name: /^Cantidad de Producto/ })).toHaveLength(count - 1);
        expect(screen.queryByRole('textbox', { name: 'Cantidad de Producto 0 en unidad' })).not.toBeInTheDocument();
        expect(posts).toHaveLength(0);
    });

    it('comparte el cambio de menú con POS sin desmontar carrito ni turno', async () => {
        catalog = [product];
        customers = [{ id: 'customer-a', name: 'Cliente de prueba', creditLimit: 1000, currentDebt: 0, isBlocked: false }];
        const user = userEvent.setup();
        render(<MemoryRouter initialEntries={['/app/pos?first_sale=1']}>
            <VentaEnCursoProvider><Layout><POS /></Layout></VentaEnCursoProvider>
        </MemoryRouter>);
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        fireEvent.click(screen.getAllByRole('button', { name: 'Ver menú completo' })[0]);
        expect(await screen.findByRole('button', { name: /Rápido/ })).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'Cantidad de Arroz en unidad' })).toHaveValue('1');
        expect(screen.queryByRole('dialog', { name: /Abrir caja/ })).not.toBeInTheDocument();
        await user.type(screen.getByPlaceholderText('Buscar cliente'), 'Cliente');
        await user.click(await screen.findByRole('button', { name: /Cliente de prueba/ }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Ver menú simple' })[0]);
        expect(screen.queryByRole('button', { name: /Rápido/ })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Cantidad de Arroz en unidad' })).toHaveValue('1');
        expect(screen.getByPlaceholderText('Buscar cliente')).toHaveValue('Cliente de prueba');
        expect(posts).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }));
        await user.type(screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/ }), '25');
        await user.click(screen.getByRole('button', { name: 'Registrar efectivo y seguir' }));
        await waitFor(() => expect(posts.find(post => post.path === '/api/sales')?.body).toMatchObject({
            customerId: 'customer-a',
        }));
    });

    it('conserva el cobro abierto y el efectivo al cambiar modo desde otra pestaña', async () => {
        catalog = [product];
        useMobileViewport();
        const user = userEvent.setup();
        mount('/app/pos');
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /^Cobrar C\$ 25\.00$/ }));
        await user.type(screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/ }), '50');
        localStorage.setItem('nortex_ui_mode', 'full');
        fireEvent(window, new StorageEvent('storage', { key: 'nortex_ui_mode', newValue: 'full' }));
        expect(await screen.findByRole('dialog', { name: 'Efectivo' })).toBeVisible();
        expect(screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/ })).toHaveValue('50');
        localStorage.setItem('nortex_ui_mode', 'simple');
        fireEvent(window, new StorageEvent('storage', { key: 'nortex_ui_mode', newValue: 'simple' }));
        expect(await screen.findByRole('dialog', { name: /Venta actual/ })).toBeVisible();
        expect(screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/ })).toHaveValue('50');
        expect(posts).toHaveLength(0);
    });

    it('declina en singular la última unidad disponible', async () => {
        catalog = [{ ...product, stock: 1 }];
        mount();
        expect(await screen.findByText('Queda 1 unidad')).toBeVisible();
    });

    it('mantiene visible el cobro USD al elegir modo simple, sin cambiar la moneda en silencio', async () => {
        catalog = [product];
        useMobileViewport();
        const user = userEvent.setup();
        mount('/app/pos');
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /^Cobrar C\$ 25\.00$/ }));
        localStorage.setItem('nortex_ui_mode', 'full');
        fireEvent(window, new StorageEvent('storage', { key: 'nortex_ui_mode' }));
        await user.click(await screen.findByRole('button', { name: 'Cobrar en dólares' }));
        await user.type(screen.getByRole('textbox', { name: 'Monto recibido en dólares' }), '2');
        localStorage.setItem('nortex_ui_mode', 'simple');
        fireEvent(window, new StorageEvent('storage', { key: 'nortex_ui_mode' }));
        expect(await screen.findByRole('dialog', { name: 'Efectivo' })).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'Monto recibido en dólares' })).toHaveValue('2');
        expect(posts).toHaveLength(0);
    });

    it('respeta el mínimo configurado que devuelve la API, aunque sea distinto de cinco', async () => {
        catalog = [{ ...product, stock: 20, minStock: 25 }];
        mount();
        expect(await screen.findByText('Quedan 20 unidades')).toBeVisible();
        expect(posts).toHaveLength(0);
    });

    it('cobra desde la barra móvil sin abrir primero Ver venta y registra una sola venta tras confirmar el vuelto', async () => {
        catalog = [product];
        useMobileViewport();
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        expect(screen.queryByRole('dialog', { name: /Venta actual/ })).not.toBeInTheDocument();

        await user.click(await screen.findByRole('button', { name: /^Cobrar C\$ 25\.00$/ }));

        const ticket = await screen.findByRole('dialog', { name: /Venta actual/ });
        const received = within(ticket).getByRole('textbox', { name: /Efectivo recibido en córdobas/ });
        expect(received).toBeVisible();
        expect(received).toHaveValue('');
        expect(within(ticket).getByRole('textbox', { name: 'Cantidad de Arroz en unidad' })).toHaveValue('1');
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        expect(within(ticket).getByRole('button', { name: 'Registrar efectivo y seguir' })).toBeDisabled();

        await user.type(received, '50');
        expect(ticket).toHaveTextContent(/Vuelto\s*C\$\s*25\.00/);
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        await user.click(within(ticket).getByRole('button', { name: 'Registrar efectivo y seguir' }));

        expect(await screen.findByRole('dialog', { name: 'Tu primera venta quedó registrada' })).toBeVisible();
        const sales = posts.filter(post => post.path === '/api/sales');
        expect(sales).toHaveLength(1);
        expect(sales[0].body.paymentMethod).toBe('CASH');
    });

    it('permite volver del cobro directo móvil sin registrar ni perder el producto del ticket', async () => {
        catalog = [product];
        useMobileViewport();
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /^Cobrar C\$ 25\.00$/ }));
        const ticket = await screen.findByRole('dialog', { name: /Venta actual/ });
        await user.type(within(ticket).getByRole('textbox', { name: /Efectivo recibido en córdobas/ }), '50');

        await user.click(within(ticket).getByRole('button', { name: 'Volver' }));

        expect(screen.getByRole('dialog', { name: /Venta actual/ })).toBe(ticket);
        expect(within(ticket).queryByRole('textbox', { name: /Efectivo recibido en córdobas/ })).not.toBeInTheDocument();
        expect(within(ticket).getByRole('textbox', { name: 'Cantidad de Arroz en unidad' })).toHaveValue('1');
        expect(within(ticket).getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ })).toBeEnabled();
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        expect(screen.queryByRole('dialog', { name: 'Tu primera venta quedó registrada' })).not.toBeInTheDocument();
    });

    it('mantiene el ticket móvil abierto al cobrar efectivo y permite recibido, vuelto y confirmación', async () => {
        catalog = [product];
        vi.stubGlobal('innerWidth', 390);
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            media: query, matches: query === '(prefers-reduced-motion: reduce)', onchange: null,
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
        })));
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /Revisar venta, 1 productos/ }));
        const ticket = await screen.findByRole('dialog', { name: /Venta actual/ });
        await user.click(within(ticket).getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }));
        expect(screen.getByRole('dialog', { name: /Venta actual/ })).toBe(ticket);
        const received = within(ticket).getByRole('textbox', { name: /Efectivo recibido en córdobas/ });
        expect(received).toBeVisible();
        await user.type(received, '50');
        expect(within(ticket).getByText('Vuelto')).toBeVisible();
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        await user.click(within(ticket).getByRole('button', { name: 'Registrar efectivo y seguir' }));
        expect(await screen.findByRole('dialog', { name: 'Tu primera venta quedó registrada' })).toBeVisible();
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(1);
        expect(posts.find(post => post.path === '/api/sales')?.body.paymentMethod).toBe('CASH');
    });

    it('exige existencia visible sin expandir opcionales y guarda exactamente la cantidad ingresada', async () => {
        mount();
        const dialog = await openQuick();
        const stock = within(dialog).getByLabelText('Existencia');
        expect(stock).toBeVisible();
        expect(stock).toHaveValue('');
        expect(stock).toBeRequired();
        expect(within(dialog).queryByLabelText('Código o SKU')).not.toBeInTheDocument();
        fillProduct(dialog);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y agregar' }));
        expect(posts.filter(post => post.path === '/api/products')).toHaveLength(0);
        expect(stock).toHaveAttribute('aria-invalid', 'true');
        expect(stock).toHaveAccessibleDescription(/Ingresá la existencia real/);
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Ingresá la existencia real (0 si no tenés).');

        fireEvent.change(stock, { target: { value: '12' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y agregar' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar producto' })).not.toBeInTheDocument());
        const saved = posts.filter(post => post.path === '/api/products');
        expect(saved).toHaveLength(1);
        expect(saved[0].body).toEqual({
            name: 'Arroz', sku: expect.stringMatching(/^SKU-/), price: '25', cost: '0', stock: '12',
            minStock: '5', category: 'General', unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', productFamily: 'GENERAL',
        });
        expect(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ })).toBeVisible();
        expect(posts.some(post => post.path === '/api/sales')).toBe(false);
    });

    it('guarda cero explícito sin poner un agotado en el carrito cuando no permite negativos', async () => {
        mount();
        const dialog = await openQuick();
        fillProduct(dialog, '0');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
        expect(await screen.findByText('Producto guardado sin existencia')).toBeVisible();
        expect(posts.find(post => post.path === '/api/products')?.body.stock).toBe('0');
        expect(screen.getAllByText('Tu venta está vacía').length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /Cobrar C\$ 25\.00/ })).not.toBeInTheDocument();
        expect(posts.some(post => post.path === '/api/sales')).toBe(false);
    });

    it('respeta la política de negativos y reinicia el borrador de existencia después de guardar', async () => {
        allowNegativeStock = true;
        localStorage.setItem('nortex_ui_mode', 'full');
        mount('/app/pos');
        fireEvent.click(await screen.findByRole('button', { name: 'Rápido' }));
        let dialog = await screen.findByRole('dialog', { name: 'Agregar producto' });
        fillProduct(dialog, '0');
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Guardar y agregar' })).toBeVisible());
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y agregar' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar producto' })).not.toBeInTheDocument());
        expect(document.body).toHaveTextContent('1 unidad × C$ 25.00');
        expect(posts.find(post => post.path === '/api/products')?.body.stock).toBe('0');
        fireEvent.click(screen.getByRole('button', { name: 'Rápido' }));
        dialog = await screen.findByRole('dialog', { name: 'Agregar producto' });
        expect(within(dialog).getByLabelText('Existencia')).toHaveValue('');
        expect(within(dialog).getByLabelText('Nombre')).toHaveValue('');
    });

    it.each([
        { action: 'Hacer otra venta', route: '/app/pos' },
        { action: 'Ver mi negocio', route: '/app/inicio' },
    ])('prioriza otra venta y conserva la acción $action después de la primera venta', async ({ action, route }) => {
        catalog = [product];
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }));
        await user.click(await screen.findByRole('button', { name: /^C\$ 50$/ }));
        await user.click(await screen.findByRole('button', { name: /Registrar efectivo y seguir/ }));
        const success = await screen.findByRole('dialog', { name: 'Tu primera venta quedó registrada' });
        const again = within(success).getByRole('button', { name: 'Hacer otra venta' });
        const home = within(success).getByRole('button', { name: 'Ver mi negocio' });
        expect(again).toHaveClass('bg-brand', 'h-pay');
        expect(home).not.toHaveClass('bg-brand');
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(1);
        expect(analytics.mock.calls.filter(([name]) => name === 'sale_completed')).toHaveLength(1);
        expect(analytics.mock.calls.filter(([name]) => name === 'first_sale_flow_completed')).toHaveLength(1)
        expect(analytics.mock.calls.filter(([name]) => name === 'first_real_sale_completed')).toHaveLength(0);
        await user.click(action === 'Hacer otra venta' ? again : home);
        expect(screen.getByLabelText('Ruta actual')).toHaveTextContent(route);
        expect(screen.getByLabelText('Ruta actual')).not.toHaveTextContent('first_sale');
        expect(screen.queryByRole('dialog', { name: 'Tu primera venta quedó registrada' })).not.toBeInTheDocument();
        expect(screen.getAllByText('Tu venta está vacía').length).toBeGreaterThan(0);
        if (action === 'Hacer otra venta') {
            await user.type(screen.getByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
            expect(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ })).toBeVisible();
        }
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(1);
    });

    it.each(['offline', 'network-error'] as const)('guarda una venta %s como pendiente sin anunciar ni medir confirmación', async transport => {
        catalog = [product];
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }));
        await user.click(await screen.findByRole('button', { name: /^C\$ 50$/ }));
        if (transport === 'offline') {
            vi.mocked(Object.getOwnPropertyDescriptor(navigator, 'onLine')!.get!).mockReturnValue(false);
            fireEvent(window, new Event('offline'));
        } else {
            saleNetworkFails = true;
        }
        await user.click(await screen.findByRole('button', { name: /Registrar efectivo y seguir/ }));

        const result = await screen.findByRole('dialog', { name: 'Venta guardada para confirmar' });
        expect(result).toHaveTextContent('No la registres de nuevo.');
        expect(within(result).queryByText(/quedó registrada|quedaron actualizados|mejor día|Meta del día/)).not.toBeInTheDocument();
        const queued = await getPendingSales({ tenantId: 'activation-t', userId: 'activation-u' });
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ tenantId: 'activation-t', userId: 'activation-u', shiftId: 'shift-a', paymentMethod: 'CASH' });
        expect(queued[0].items).toHaveLength(1);
        expect(queued[0].items[0]).toMatchObject({ id: 'p1', quantity: '1' });
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(transport === 'offline' ? 0 : 1);
        expect(analytics.mock.calls.filter(([name]) => name === 'sale_queued')).toHaveLength(1);
        expect(analytics.mock.calls.filter(([name]) => name === 'sale_completed' || name === 'first_real_sale_completed')).toHaveLength(0);

        await user.click(within(result).getByRole('button', { name: 'Hacer otra venta' }));
        expect(screen.queryByRole('dialog', { name: 'Venta guardada para confirmar' })).not.toBeInTheDocument();
        expect(screen.getAllByText('Tu venta está vacía').length).toBeGreaterThan(0);
        expect(await getPendingSales({ tenantId: 'activation-t', userId: 'activation-u' })).toHaveLength(1);
        expect(analytics.mock.calls.filter(([name]) => name === 'sale_completed' || name === 'first_real_sale_completed')).toHaveLength(0);
    });

    it('mantiene el carrito y el cobro intactos al usar F9 y F4 dentro de Avisos', async () => {
        catalog = [product];
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        const quantity = screen.getByRole('textbox', { name: 'Cantidad de Arroz en unidad' });
        expect(quantity).toHaveValue('1');
        await user.click(screen.getByRole('button', { name: /^Avisos importantes/ }));
        const notices = await screen.findByRole('dialog', { name: 'Avisos importantes' });
        await waitFor(() => expect(within(notices).getByRole('button', { name: 'Cerrar avisos' })).toHaveFocus());

        await user.keyboard('{F9}{F4}');

        expect(screen.getByRole('dialog', { name: 'Avisos importantes' })).toBe(notices);
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(quantity).toHaveValue('1');
        expect(screen.queryByRole('textbox', { name: /Efectivo recibido en córdobas/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Tu venta está vacía')).not.toBeInTheDocument();
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        await user.click(within(notices).getByRole('button', { name: 'Cerrar avisos' }));
        expect(screen.getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ })).toBeEnabled();
        expect(quantity).toHaveValue('1');
    });

    it('no agrega un SKU del lector mientras el foco está en Cerrar avisos y vuelve a admitirlo al salir', async () => {
        catalog = [product];
        const user = userEvent.setup();
        mount();
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'ARR-1{Enter}');
        const quantity = screen.getByRole('textbox', { name: 'Cantidad de Arroz en unidad' });
        await user.click(screen.getByRole('button', { name: /^Avisos importantes/ }));
        const notices = await screen.findByRole('dialog', { name: 'Avisos importantes' });
        const close = within(notices).getByRole('button', { name: 'Cerrar avisos' });
        await waitFor(() => expect(close).toHaveFocus());

        await user.keyboard('ARR-1{Enter}');

        // Enter conserva la activación nativa del botón enfocado; el SKU no llega al carrito.
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Avisos importantes' })).not.toBeInTheDocument());
        expect(quantity).toHaveValue('1');
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
        expect(screen.queryByRole('textbox', { name: /Efectivo recibido en córdobas/ })).not.toBeInTheDocument();

        // Control positivo: el lector sigue funcionando fuera del panel.
        await waitFor(() => expect(document.querySelector('[data-operational-alerts]')).toBeNull());
        screen.getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }).focus();
        await user.keyboard('ARR-1{Enter}');
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Cantidad de Arroz en unidad' })).toHaveValue('2'));
        expect(posts.filter(post => post.path === '/api/sales')).toHaveLength(0);
    });
});
