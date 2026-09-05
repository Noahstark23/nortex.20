// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { OperationalNotifications, type LocalSaleAlerts } from '../components/notifications/OperationalNotifications';
import { VentaEnCursoProvider, useReportarVenta } from '../components/VentaEnCursoContext';

const response = (sections: unknown[]) => ({ checkedAt: '2026-09-04T20:00:00Z', sections });
const ok = (data: unknown) => ({ ok: true, json: async () => data });
const section = (id: string, count: number) => ({ id, status: 'ok', count });
function Route() { const route = useLocation(); return <output aria-label="Destino">{route.pathname}{route.search}</output>; }
function mount(local?: LocalSaleAlerts) { return render(<MemoryRouter initialEntries={['/app/pos']}><OperationalNotifications local={local} /><Route /></MemoryRouter>); }
async function open() { fireEvent.click(screen.getByRole('button', { name: /^Avisos importantes/ })); return screen.findByRole('dialog', { name: 'Avisos importantes' }); }

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nortex_token', 'tenant-a-token');
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('fetch', vi.fn(async () => ok(response([]))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('avisos operativos accionables', () => {
    it('con una venta abierta no navega ni promete haber guardado un carrito sin turno', async () => {
        const ActiveSale = () => {
            const report = useReportarVenta();
            React.useEffect(() => report({ hayVenta: true, lineas: 1, total: 10 }), [report]);
            return <OperationalNotifications />;
        };
        vi.stubGlobal('fetch', vi.fn(async () => ok(response([section('pending_orders', 2)]))));
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><ActiveSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await open();
        fireEvent.click(await screen.findByRole('button', { name: 'Ver pedidos web' }));
        expect(screen.getByRole('heading', { name: 'Tenés una venta abierta' })).toHaveFocus();
        expect(screen.getByLabelText('Destino')).toHaveTextContent('/app/pos');
        expect(screen.getByText(/Terminá o aparcá la venta/)).toBeVisible();
        expect(screen.queryByRole('button', { name: /Guardar y abrir/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Seguir vendiendo' }));
        expect(screen.getByLabelText('Destino')).toHaveTextContent('/app/pos');
    });
    it('muestra conteos completos y abre pedidos en su módulo real; cerrar no los marca resueltos', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ok(response([section('pending_orders', 127)]))));
        mount();
        const dialog = await open();
        expect(await within(dialog).findByText(/Pedidos web por atender/)).toHaveTextContent('(127)');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar avisos' }));
        expect(screen.getByRole('button', { name: /1 asuntos por atender/ })).toBeVisible();
        await open();
        fireEvent.click(await screen.findByRole('button', { name: 'Ver pedidos web' }));
        expect(screen.getByLabelText('Destino')).toHaveTextContent('/app/quotations');
    });

    it('prioriza vencidos y permite buscar el producto concreto sin inventar cobertura de la muestra', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ok(response([
            section('low_stock', 55),
            { ...section('expired_batches', 17), samples: [{ id: 'b1', name: 'Suero oral', detail: 'Lote A · 2026-09-01' }] },
        ]))));
        mount(); await open();
        const articles = await screen.findAllByRole('article');
        expect(articles[0]).toHaveTextContent('Lotes vencidos');
        expect(screen.getByText('Mostrando 1 de 17')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /Suero oral/ }));
        expect(screen.getByLabelText('Destino')).toHaveTextContent('/app/inventory?search=Suero%20oral');
    });

    it('un fallo parcial conserva avisos válidos y no afirma que todo está bien', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ok(response([
            section('pending_orders', 2), { id: 'low_stock', status: 'error', count: null },
        ]))));
        mount(); await open();
        expect(await screen.findByText(/No se pudo comprobar: productos en su mínimo/)).toBeVisible();
        expect(screen.queryByText(/Sin pendientes detectados/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ver pedidos web' })).toBeEnabled();
    });

    it('rechaza respuestas incompletas y permite volver a consultar', async () => {
        const fetcher = vi.fn(async () => ok({ sections: [] })); vi.stubGlobal('fetch', fetcher);
        mount(); await open();
        expect(await screen.findByText(/No pudimos comprobar los pendientes del negocio/)).toBeVisible();
        fetcher.mockImplementation(async () => ok(response([])));
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar avisos' }));
        expect(await screen.findByText(/Sin pendientes detectados/)).toBeVisible();
    });

    it('descarta una respuesta tardía de otro negocio y vacía su panel al cambiar de sesión', async () => {
        let finishA!: (value: unknown) => void;
        const oldResponse = new Promise(resolve => { finishA = resolve; });
        const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
            return (options.headers as Record<string, string>).Authorization.includes('tenant-a')
                ? oldResponse : ok(response([section('pending_orders', 4)]));
        });
        vi.stubGlobal('fetch', fetcher);
        mount(); await open();
        localStorage.setItem('nortex_token', 'tenant-b-token');
        localStorage.setItem('nortex_user', JSON.stringify({ id: 'u2', tenant: { id: 't2' } }));
        fireEvent(window, new Event('storage'));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        finishA(ok(response([section('out_of_stock', 999)])));
        await open();
        expect(await screen.findByText(/Pedidos web por atender/)).toHaveTextContent('(4)');
        expect(screen.queryByText(/Productos sin existencia/)).not.toBeInTheDocument();
        expect(fetcher).toHaveBeenLastCalledWith('/api/operational-alerts', expect.objectContaining({ cache: 'no-store', headers: { Authorization: 'Bearer tenant-b-token' } }));
    });

    it('separa pendientes de revisión y solo el botón explícito invoca el reintento', async () => {
        const sync = vi.fn(async () => { throw new Error('Sin confirmar'); });
        mount({ isOnline: true, pendingCount: 3, reconciliationCount: 1, syncing: false, onSync: sync });
        await open();
        expect(screen.getByText('2 ventas pendientes de confirmar')).toBeVisible();
        expect(screen.getByText('1 venta requiere revisión')).toBeVisible();
        expect(sync).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Siguen guardadas');
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('sin internet no permite reenviar y Escape devuelve el foco a la campana', async () => {
        const user = userEvent.setup();
        mount({ isOnline: false, pendingCount: 1, reconciliationCount: 0, syncing: false, onSync: vi.fn() });
        const trigger = screen.getByRole('button', { name: /^Avisos importantes/ });
        await user.click(trigger);
        expect(screen.getByRole('button', { name: 'Reintentar confirmación' })).toBeDisabled();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });
});
