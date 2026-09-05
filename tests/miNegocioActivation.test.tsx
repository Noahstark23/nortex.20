// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import MiNegocio from '../components/MiNegocio';
import { fetchOnboardingStatus, invalidateOnboardingStatusCache, type OnboardingStatus } from '../utils/onboardingStatus';

vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));

const progress = (count?: number, hasSale = false, hasProduct = false): OnboardingStatus => ({
    type: 'FERRETERIA', businessName: 'Ferretería QA', completed: 0, total: 3, allDone: false,
    steps: [
        { key: 'product', label: 'Producto', done: hasProduct, href: '/app/inventory', cta: 'Agregar' },
        { key: 'sale', label: 'Venta', done: hasSale, href: '/app/pos', cta: 'Vender' },
    ],
    ...(count === undefined ? {} : { salesProgress: { confirmedSales: count, lastSaleAt: count > 0 ? '2026-09-04T12:00:00.000Z' : null } }),
});

const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

let onboarding: () => Promise<Response>;
let onboardingRequests: number;
let metricResponses: Record<string, () => Promise<Response>>;

const metricPaths = {
    dashboard: '/api/dashboard/stats',
    shifts: '/api/shifts/monitor',
    collections: '/api/collections/worklist?dueSoonDays=7',
} as const;

const setSession = (id: string, name = 'Ferretería QA') => {
    localStorage.setItem('nortex_token', `token-${id}`);
    localStorage.setItem('nortex_tenant_id', id);
    localStorage.setItem('nortex_user', JSON.stringify({
        id: `owner-${id}`, role: 'OWNER', tenant: { id, businessName: name, type: 'FERRETERIA' },
    }));
};

const CurrentRoute = () => {
    const location = useLocation();
    return <div data-testid="route">{location.pathname}{location.search}</div>;
};
const mount = () => render(
    <MemoryRouter initialEntries={['/app/inicio']}><MiNegocio /><CurrentRoute /></MemoryRouter>,
);

beforeEach(() => {
    localStorage.clear();
    setSession('a');
    invalidateOnboardingStatusCache();
    onboardingRequests = 0;
    onboarding = async () => response(progress(0));
    metricResponses = {
        [metricPaths.dashboard]: async () => response({ todayStats: { totalSales: 120, gananciaBruta: 30, lineasSinCosto: 2 } }),
        [metricPaths.shifts]: async () => response({ activeShifts: [{ estimatedPhysicalCash: 50 }] }),
        [metricPaths.collections]: async () => response({ summary: { totalReceivable: 90 } }),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path === '/api/onboarding') {
            onboardingRequests += 1;
            return onboarding();
        }
        if (metricResponses[path]) return metricResponses[path]();
        throw new Error(`Ruta inesperada: ${path}`);
    }));
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    invalidateOnboardingStatusCache();
    vi.unstubAllGlobals();
});

describe('Inicio orienta una venta real y el regreso', () => {
    it('sin ventas muestra una única acción de venta antes de las cifras y lleva al flujo guiado', async () => {
        mount();
        const button = await screen.findByRole('button', { name: 'Registrar primera venta' });
        expect(screen.getByText(/existencia real/)).toBeVisible();
        const journey = screen.getByRole('region', { name: 'Hacé tu primera venta' });
        const summary = screen.getByRole('region', { name: 'Resumen del día' });
        expect(journey.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Vender' })).not.toBeInTheDocument();
        await userEvent.click(button);
        expect(screen.getByTestId('route')).toHaveTextContent('/app/pos?first_sale=1');
    });

    it('con una venta propone atender al próximo cliente sin reiniciar la primera venta', async () => {
        // Los metadatos del servidor prevalecen sobre un checklist anterior.
        onboarding = async () => response(progress(1, false, true));
        mount();
        const button = await screen.findByRole('button', { name: 'Registrar otra venta' });
        expect(screen.getByRole('heading', { name: 'Seguí con tu próximo cliente' })).toBeVisible();
        expect(screen.queryByText('Hacé tu primera venta')).not.toBeInTheDocument();
        await userEvent.click(button);
        expect(screen.getByTestId('route').textContent).toBe('/app/pos');
    });

    it('con varias ventas conserva Vender como acción principal y evita duplicarlo', async () => {
        onboarding = async () => response(progress(18, true, true));
        mount();
        await waitFor(() => expect(screen.queryByText('Cargando tu progreso…')).not.toBeInTheDocument());
        expect(screen.getAllByRole('button', { name: 'Vender' })).toHaveLength(1);
        expect(screen.queryByText('Ya registraste una venta')).not.toBeInTheDocument();
    });

    it.each([false, true])('es compatible sin salesProgress; hasSale=%s no inventa una cantidad', async (hasSale) => {
        onboarding = async () => response(progress(undefined, hasSale, true));
        mount();
        await waitFor(() => expect(screen.queryByText('Cargando tu progreso…')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: hasSale ? 'Vender' : 'Registrar primera venta' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Registrar otra venta' })).not.toBeInTheDocument();
    });

    it('mantiene práctica aislada y ayuda accesibles para quien ya vendió', async () => {
        onboarding = async () => response(progress(1, true, true));
        mount();
        await screen.findByRole('button', { name: 'Registrar otra venta' });
        await userEvent.click(screen.getByRole('button', { name: 'Practicar sin guardar datos' }));
        expect(screen.getByTestId('route')).toHaveTextContent('/demo?source=onboarding');
        await userEvent.click(screen.getByRole('button', { name: 'Necesito ayuda' }));
        expect(screen.getByTestId('route').textContent).toBe('/app/ayuda');
        const calls = vi.mocked(fetch).mock.calls;
        expect(calls.every(([, options]) => options?.method === undefined)).toBe(true);
    });

    it('durante la carga no inventa progreso y permite abrir la caja', async () => {
        const pending = deferred<Response>();
        onboarding = () => pending.promise;
        mount();
        expect(screen.getByRole('status')).toHaveTextContent('Cargando tu progreso');
        expect(screen.getByRole('button', { name: 'Vender' })).toBeEnabled();
        expect(screen.queryByText('Hacé tu primera venta')).not.toBeInTheDocument();
        await act(async () => pending.resolve(response(progress(0))));
        expect(await screen.findByRole('button', { name: 'Registrar primera venta' })).toBeVisible();
    });

    it('un error mantiene Vender y permite reintentar sin recargar toda la página', async () => {
        onboarding = async () => response({}, false);
        mount();
        expect(await screen.findByRole('alert')).toHaveTextContent('Podés seguir vendiendo');
        expect(screen.getByRole('button', { name: 'Vender' })).toBeEnabled();
        onboarding = async () => response(progress(1, true, true));
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('button', { name: 'Registrar otra venta' })).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onboardingRequests).toBe(2);
    });

    it('refresca el progreso tras una venta mientras Inicio sigue montado', async () => {
        mount();
        await screen.findByRole('button', { name: 'Registrar primera venta' });
        onboarding = async () => response(progress(1, true, true));
        act(() => window.dispatchEvent(new Event('nortex:data-changed')));
        expect(await screen.findByRole('button', { name: 'Registrar otra venta' })).toBeVisible();
        expect(onboardingRequests).toBe(2);
    });

    it('al volver de Caja refresca el caché previo aunque Inicio no haya recibido el evento de venta', async () => {
        await fetchOnboardingStatus('token-a');
        onboarding = async () => response(progress(1, true, true));
        window.dispatchEvent(new Event('nortex:data-changed'));
        mount();
        expect(await screen.findByRole('button', { name: 'Registrar otra venta' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Registrar primera venta' })).not.toBeInTheDocument();
        expect(onboardingRequests).toBe(2);
    });

    it('un cambio durante una lectura exige datos posteriores y descarta la respuesta vieja', async () => {
        const old = deferred<Response>();
        onboarding = () => old.promise;
        mount();
        act(() => window.dispatchEvent(new Event('nortex:data-changed')));
        onboarding = async () => response(progress(1, true, true));
        await act(async () => old.resolve(response(progress(0))));
        expect(await screen.findByRole('button', { name: 'Registrar otra venta' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Registrar primera venta' })).not.toBeInTheDocument();
        expect(onboardingRequests).toBe(2);
    });

    it('al cambiar de tenant y token descarta respuestas pendientes de la sesión anterior', async () => {
        const old = deferred<Response>();
        onboarding = () => old.promise;
        mount();
        onboarding = async () => response(progress(15, true, true));
        act(() => {
            setSession('b', 'Farmacia nueva');
            window.dispatchEvent(new StorageEvent('storage', { key: 'nortex_token' }));
        });
        await waitFor(() => expect(screen.queryByText('Cargando tu progreso…')).not.toBeInTheDocument());
        await act(async () => old.resolve(response(progress(1, true, true))));
        expect(screen.getByRole('heading', { name: '¡Hola, Farmacia nueva!' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Vender' })).toBeVisible();
        expect(screen.queryByText('Ya registraste una venta')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '¡Hola, Ferretería QA!' })).not.toBeInTheDocument();
    });

    it('al desmontar retira listeners y no procesa respuestas pendientes', async () => {
        const old = deferred<Response>();
        onboarding = () => old.promise;
        const view = mount();
        view.unmount();
        const requests = vi.mocked(fetch).mock.calls.length;
        act(() => {
            window.dispatchEvent(new Event('nortex:data-changed'));
            window.dispatchEvent(new StorageEvent('storage', { key: 'nortex_token' }));
        });
        await act(async () => old.resolve(response(progress(1, true, true))));
        expect(fetch).toHaveBeenCalledTimes(requests);
        expect(view.container).toBeEmptyDOMElement();
    });

    it.each([
        ['dashboard', '503'], ['dashboard', 'red'], ['dashboard', 'parcial'],
        ['shifts', '503'], ['shifts', 'red'], ['shifts', 'parcial'],
        ['collections', '503'], ['collections', 'red'], ['collections', 'parcial'],
    ] as const)('si %s falla por %s después de una actualización retira solo sus cifras viejas', async (endpoint, failure) => {
        mount();
        await screen.findByRole('button', { name: 'Registrar primera venta' });
        expect(screen.getByText('C$ 120.00')).toBeVisible();
        expect(screen.getByText('C$ 30.00')).toBeVisible();
        expect(screen.getByText('C$ 50.00')).toBeVisible();
        expect(screen.getByText('C$ 90.00')).toBeVisible();
        expect(screen.getByText(/faltan costos en 2 productos/)).toBeVisible();

        const incomplete = endpoint === 'dashboard' ? { todayStats: { totalSales: 140 } }
            : endpoint === 'shifts' ? { activeShifts: [{ id: 'shift-incomplete' }] }
                : { summary: {} };
        metricResponses[metricPaths[endpoint]] = async () => {
            if (failure === 'red') throw new Error('Sin red');
            return failure === '503' ? response({}, false) : response(incomplete);
        };
        act(() => window.dispatchEvent(new Event('nortex:data-changed')));
        const oldValue = endpoint === 'dashboard' ? 'C$ 30.00' : endpoint === 'shifts' ? 'C$ 50.00' : 'C$ 90.00';
        await waitFor(() => expect(screen.queryByText(oldValue)).not.toBeInTheDocument());
        expect(screen.getAllByText('—')).toHaveLength(endpoint === 'dashboard' && failure !== 'parcial' ? 2 : 1);
        if (endpoint === 'dashboard') {
            expect(screen.queryByText('C$ 120.00')).not.toBeInTheDocument();
            expect(screen.queryByText(/faltan costos en 2 productos/)).not.toBeInTheDocument();
            if (failure === 'parcial') expect(screen.getByText('C$ 140.00')).toBeVisible();
        } else {
            expect(screen.getByText('C$ 120.00')).toBeVisible();
            expect(screen.getByText('C$ 30.00')).toBeVisible();
            expect(screen.getByText(/faltan costos en 2 productos/)).toBeVisible();
        }
        if (endpoint !== 'shifts') expect(screen.getByText('C$ 50.00')).toBeVisible();
        if (endpoint !== 'collections') expect(screen.getByText('C$ 90.00')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Registrar primera venta' })).toBeEnabled();
    });

    it('un fallo tardío de cifras no borra una actualización más reciente', async () => {
        mount();
        await screen.findByRole('button', { name: 'Registrar primera venta' });
        const old = deferred<Response>();
        metricResponses[metricPaths.dashboard] = () => old.promise;
        act(() => window.dispatchEvent(new Event('nortex:data-changed')));
        metricResponses[metricPaths.dashboard] = async () => response({
            todayStats: { totalSales: 180, gananciaBruta: 40, lineasSinCosto: 0 },
        });
        act(() => window.dispatchEvent(new Event('nortex:data-changed')));
        expect(await screen.findByText('C$ 180.00')).toBeVisible();
        await act(async () => old.resolve(response({}, false)));
        expect(screen.getByText('C$ 180.00')).toBeVisible();
        expect(screen.getByText('C$ 40.00')).toBeVisible();
        expect(screen.queryAllByText('—')).toHaveLength(0);
    });
});
