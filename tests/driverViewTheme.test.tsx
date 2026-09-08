// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverView from '../components/DriverView';
import {
    DRIVER_THEME_KEY_PREFIX,
    DRIVER_THEME_SCOPE_KEY,
    resolveDriverThemeStorageKey,
} from '../utils/driverTheme';

const DRIVER_TOKEN_KEY = 'nortex_driver_token';

const response = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
} as unknown as Response);

const renderDriver = () => render(
    <MemoryRouter initialEntries={['/driver']}>
        <DriverView />
    </MemoryRouter>,
);

const settleAsyncWork = async () => {
    await act(async () => {
        for (let turn = 0; turn < 5; turn += 1) {
            await Promise.resolve();
        }
    });
};

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('fetch inesperado en esta prueba');
    }));
});

afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('DriverView: tema y accesibilidad de sesión', () => {
    it('abre el login en Día con un único toggle accesible y permite pasar a Noche', () => {
        const staleDriverKey = resolveDriverThemeStorageKey('driver-anterior')!;
        localStorage.setItem(DRIVER_THEME_SCOPE_KEY, 'driver-anterior');
        localStorage.setItem(staleDriverKey, 'dark');

        renderDriver();

        const root = screen.getByTestId('driver-theme-root');
        const toggles = screen.getAllByRole('button', { name: /cambiar a modo noche/i });

        expect(root).toHaveAttribute('data-nx-theme', 'light');
        expect(toggles).toHaveLength(1);
        expect(toggles[0]).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(toggles[0]);

        expect(root).toHaveAttribute('data-nx-theme', 'dark');
        expect(screen.getAllByRole('button', { name: /cambiar a modo día/i })).toHaveLength(1);
        expect(screen.getByRole('button', { name: /cambiar a modo día/i })).toHaveAttribute('aria-pressed', 'true');
        expect(localStorage.getItem(staleDriverKey)).toBe('dark');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('expone labels para Teléfono y PIN y anuncia el error de login', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response({
            error: 'Teléfono o PIN inválido.',
        }, 401));
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();

        const phone = screen.getByLabelText('Teléfono');
        const pin = screen.getByLabelText('PIN');

        expect(phone).toHaveAttribute('type', 'tel');
        expect(pin).toHaveAttribute('type', 'password');

        fireEvent.change(phone, { target: { value: '8888-0000' } });
        fireEvent.change(pin, { target: { value: '1234' } });
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await settleAsyncWork();

        expect(screen.getByRole('alert')).toHaveTextContent('Teléfono o PIN inválido.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/driver/login', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telefono: '8888-0000', pin: '1234' }),
        }));
        expect(localStorage.getItem(DRIVER_TOKEN_KEY)).toBeNull();
    });

    it('completa login, enlaza el tema y arranca la sesión autenticada sin presembrar token', async () => {
        const driverId = 'driver-login-sintetico';
        const driverThemeKey = resolveDriverThemeStorageKey(driverId)!;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/driver/login') {
                return response({
                    token: 'token-login-sintetico',
                    driver: { id: driverId, nombre: 'Repartidora Login QA', tipoFlota: 'NORTEX' },
                });
            }
            if (url === '/api/driver/me/orders') {
                return response({
                    driver: { id: driverId, nombre: 'Repartidora Login QA', tipoFlota: 'NORTEX' },
                    orders: [],
                    liquidacionDiaria: {
                        pedidosEntregados: 0,
                        totalCobrado: 0,
                        comisionesGanadas: 0,
                        netoADepositarA_Tienda: 0,
                    },
                });
            }
            throw new Error(`fetch inesperado: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '8888-0000' } });
        fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await settleAsyncWork();
        await settleAsyncWork();

        expect(screen.getByRole('heading', { name: 'Repartidora Login QA' })).toBeInTheDocument();
        expect(screen.getByText('¡Estás al día!')).toBeInTheDocument();
        expect(localStorage.getItem(DRIVER_TOKEN_KEY)).toBe('token-login-sintetico');
        expect(localStorage.getItem(DRIVER_THEME_SCOPE_KEY)).toBe(driverId);
        expect(localStorage.getItem(driverThemeKey)).toBe('light');
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/driver/login', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ telefono: '8888-0000', pin: '2468' }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/driver/me/orders', {
            headers: { Authorization: 'Bearer token-login-sintetico' },
        });
    });

    it('mantiene completos los montos del dock en su grid móvil', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-dock-sintetico');
        const fetchMock = vi.fn().mockResolvedValue(response({
            driver: { id: 'driver-dock', nombre: 'Repartidor Dock QA', tipoFlota: 'NORTEX' },
            orders: [{
                id: 'order-preparando',
                clienteNombre: 'Cliente Sintético',
                clienteTelefono: '88880000',
                direccionEntrega: 'Dirección de prueba',
                estado: 'preparando',
                total: 845.75,
                items: [{ id: 'item-1', cantidad: 1, producto: { name: 'Producto de prueba' } }],
            }],
            liquidacionDiaria: {
                pedidosEntregados: 7,
                totalCobrado: 9400,
                comisionesGanadas: 875.5,
                netoADepositarA_Tienda: 8524.5,
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { container } = renderDriver();
        await settleAsyncWork();

        const dockGrid = container.querySelector('.nx-driver-dock-grid');
        expect(dockGrid).toBeInTheDocument();
        expect(dockGrid).toHaveClass('grid-cols-[auto_minmax(0,1fr)_auto]');
        expect(screen.getByLabelText('Efectivo a entregar a caja')).toHaveTextContent('C$ 8,524.50');
        expect(dockGrid).toHaveTextContent('C$ 875.50');
        expect(dockGrid).toHaveTextContent('7');
    });

    it('retira la liquidación fija si el polling deja de reportarla', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-liquidacion-sintetica');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response({
                driver: { id: 'driver-liquidacion', nombre: 'Repartidor QA', tipoFlota: 'NORTEX' },
                orders: [],
                liquidacionDiaria: {
                    pedidosEntregados: 7,
                    totalCobrado: 9400,
                    comisionesGanadas: 875.5,
                    netoADepositarA_Tienda: 8524.5,
                },
            }))
            .mockResolvedValueOnce(response({
                driver: { id: 'driver-liquidacion', nombre: 'Repartidor QA', tipoFlota: 'NORTEX' },
                orders: [],
            }));
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();

        expect(screen.getByLabelText('Efectivo a entregar a caja')).toHaveTextContent('C$ 8,524.50');

        await act(async () => {
            vi.advanceTimersByTime(10_000);
            await Promise.resolve();
        });
        await settleAsyncWork();

        expect(screen.queryByLabelText('Efectivo a entregar a caja')).toBeNull();
    });

    it('hidrata la sesión en Noche, persiste por repartidor y vuelve a Día al salir', async () => {
        const driverId = 'driver-sintetico-7';
        const otherDriverId = 'driver-ajeno-9';
        const driverThemeKey = resolveDriverThemeStorageKey(driverId)!;
        const otherDriverThemeKey = resolveDriverThemeStorageKey(otherDriverId)!;

        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-sintetico-local');
        localStorage.setItem(DRIVER_THEME_SCOPE_KEY, driverId);
        localStorage.setItem(driverThemeKey, 'dark');
        localStorage.setItem(otherDriverThemeKey, 'dark');

        const fetchMock = vi.fn().mockResolvedValue(response({
            driver: {
                id: driverId,
                nombre: 'Repartidora QA',
                tipoFlota: 'PROPIA',
            },
            orders: [],
            liquidacionDiaria: {
                pedidosEntregados: 0,
                totalCobrado: 0,
                comisionesGanadas: 0,
                netoADepositarA_Tienda: 0,
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();

        const root = screen.getByTestId('driver-theme-root');
        expect(root).toHaveAttribute('data-nx-theme', 'dark');

        await settleAsyncWork();

        expect(screen.getByRole('heading', { name: 'Repartidora QA' })).toBeInTheDocument();
        expect(screen.getByText('¡Estás al día!')).toBeInTheDocument();
        expect(root).toHaveAttribute('data-nx-theme', 'dark');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/driver/me/orders', {
            headers: { Authorization: 'Bearer token-sintetico-local' },
        });

        fireEvent.click(screen.getByRole('button', { name: /cambiar a modo día/i }));

        expect(root).toHaveAttribute('data-nx-theme', 'light');
        expect(localStorage.getItem(driverThemeKey)).toBe('light');
        expect(localStorage.getItem(otherDriverThemeKey)).toBe('dark');
        expect(localStorage.getItem(DRIVER_THEME_KEY_PREFIX)).toBeNull();
        expect(localStorage.getItem(DRIVER_THEME_SCOPE_KEY)).toBe(driverId);

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

        expect(screen.getByRole('heading', { name: 'App de Repartidores' })).toBeInTheDocument();
        expect(screen.getByTestId('driver-theme-root')).toHaveAttribute('data-nx-theme', 'light');
        expect(screen.getAllByRole('button', { name: /cambiar a modo noche/i })).toHaveLength(1);
        expect(localStorage.getItem(DRIVER_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(DRIVER_THEME_SCOPE_KEY)).toBeNull();
        expect(localStorage.getItem(driverThemeKey)).toBe('light');
        expect(localStorage.getItem(otherDriverThemeKey)).toBe('dark');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('mantiene billetera y confirmación como diálogos de solo lectura hasta confirmar', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-sintetico-local');
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/driver/me/orders') {
                return response({
                    driver: { id: 'driver-dialogs', nombre: 'Repartidor QA', tipoFlota: 'NORTEX' },
                    orders: [{
                        id: 'order-1',
                        clienteNombre: 'Cliente Sintético',
                        clienteTelefono: '88880000',
                        direccionEntrega: 'Dirección de prueba',
                        estado: 'en_camino',
                        total: 125,
                        items: [{ id: 'item-1', cantidad: 1, producto: { name: 'Producto de prueba' } }],
                    }],
                    liquidacionDiaria: {
                        pedidosEntregados: 0,
                        totalCobrado: 0,
                        comisionesGanadas: 0,
                        netoADepositarA_Tienda: 0,
                    },
                });
            }
            if (url === '/api/driver/me/wallet') {
                return response({ walletBalance: 0, movimientos: [] });
            }
            throw new Error(`fetch inesperado: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();

        const walletTrigger = screen.getByRole('button', { name: 'Abrir mi billetera' });
        walletTrigger.focus();
        fireEvent.click(walletTrigger);
        await settleAsyncWork();

        expect(screen.getByRole('dialog', { name: 'Mi Billetera Nortex' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cerrar billetera' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        expect(screen.queryByRole('dialog', { name: 'Mi Billetera Nortex' })).toBeNull();
        expect(walletTrigger).toHaveFocus();

        const deliver = screen.getByRole('button', { name: 'Entregar y Cobrar' });
        deliver.focus();
        fireEvent.click(deliver);
        expect(screen.getByRole('alertdialog', { name: 'Confirmar Entrega' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        expect(screen.queryByRole('alertdialog', { name: 'Confirmar Entrega' })).toBeNull();
        expect(deliver).toHaveFocus();

        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });

    it('no ofrece entregar pedidos solo asignados hasta que entren a un estado entregable', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-driver-asignado');
        const fetchMock = vi.fn().mockResolvedValue(response({
            driver: { id: 'driver-asignado', nombre: 'Repartidor Asignado QA', tipoFlota: 'PROPIA' },
            orders: [{
                id: 'order-assigned',
                clienteNombre: 'Cliente Pendiente',
                clienteTelefono: '88880000',
                direccionEntrega: 'Dirección de prueba',
                estado: 'asignado',
                total: 95,
                items: [{ id: 'item-1', cantidad: 1, producto: { name: 'Producto de prueba' } }],
            }],
            liquidacionDiaria: {
                pedidosEntregados: 0,
                totalCobrado: 0,
                comisionesGanadas: 0,
                netoADepositarA_Tienda: 0,
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();

        const disabledAction = screen.getByRole('button', { name: 'Esperando preparación' });
        expect(disabledAction).toBeDisabled();
        fireEvent.click(disabledAction);
        expect(screen.queryByRole('alertdialog', { name: 'Confirmar Entrega' })).toBeNull();
    });

    it('no reusa la billetera del repartidor anterior cuando cambia la sesión', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-driver-a');
        const walletA = createDeferred<Response>();
        const walletB = createDeferred<Response>();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/driver/me/orders') {
                const token = (init?.headers as Record<string, string> | undefined)?.Authorization;
                if (token === 'Bearer token-driver-a') {
                    return response({
                        driver: { id: 'driver-a', nombre: 'Repartidora A', tipoFlota: 'NORTEX' },
                        orders: [],
                    });
                }
                if (token === 'Bearer token-driver-b') {
                    return response({
                        driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'NORTEX' },
                        orders: [],
                    });
                }
            }
            if (url === '/api/driver/me/wallet') {
                const token = (init?.headers as Record<string, string> | undefined)?.Authorization;
                if (token === 'Bearer token-driver-a') return walletA.promise;
                if (token === 'Bearer token-driver-b') return walletB.promise;
            }
            if (url === '/api/driver/login') {
                return response({
                    token: 'token-driver-b',
                    driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'NORTEX' },
                });
            }
            throw new Error(`fetch inesperado: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();

        fireEvent.click(screen.getByRole('button', { name: 'Abrir mi billetera' }));
        expect(screen.getByRole('dialog', { name: 'Mi Billetera Nortex' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        await settleAsyncWork();

        await act(async () => {
            walletA.resolve(response({
                walletBalance: 999,
                movimientos: [{ id: 'mov-a', type: 'AJUSTE', amount: 999, descripcion: 'Saldo A', createdAt: '2026-09-01T10:00:00.000Z', firmado: true }],
            }));
            await Promise.resolve();
        });
        await settleAsyncWork();

        expect(screen.queryByText('Saldo A')).toBeNull();

        fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '8888-0001' } });
        fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await settleAsyncWork();
        await settleAsyncWork();

        fireEvent.click(screen.getByRole('button', { name: 'Abrir mi billetera' }));
        expect(screen.getByRole('dialog', { name: 'Mi Billetera Nortex' })).toBeInTheDocument();
        expect(screen.queryByText('Saldo A')).toBeNull();

        await act(async () => {
            walletB.resolve(response({
                walletBalance: 125.5,
                movimientos: [{ id: 'mov-b', type: 'COMISION_ENTREGA', amount: 125.5, descripcion: 'Saldo B', createdAt: '2026-09-01T11:00:00.000Z', firmado: true }],
            }));
            await Promise.resolve();
        });
        await settleAsyncWork();

        expect(screen.getByText('Saldo B')).toBeInTheDocument();
        expect(screen.queryByText('Saldo A')).toBeNull();
    });

    it('ignora un polling tardío de pedidos después de cambiar de repartidor', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-driver-a');
        const staleOrdersA = createDeferred<Response>();
        let driverAOrderCalls = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/driver/me/orders') {
                const token = (init?.headers as Record<string, string> | undefined)?.Authorization;
                if (token === 'Bearer token-driver-a') {
                    driverAOrderCalls += 1;
                    if (driverAOrderCalls > 1) return staleOrdersA.promise;
                    return response({
                        driver: { id: 'driver-a', nombre: 'Repartidora A', tipoFlota: 'PROPIA' },
                        orders: [],
                    });
                }
                if (token === 'Bearer token-driver-b') {
                    return response({
                        driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'PROPIA' },
                        orders: [],
                    });
                }
            }
            if (url === '/api/driver/login') {
                return response({
                    token: 'token-driver-b',
                    driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'PROPIA' },
                });
            }
            throw new Error(`fetch inesperado: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();
        expect(screen.getByRole('heading', { name: 'Repartidora A' })).toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(10_000);
            await Promise.resolve();
        });
        expect(driverAOrderCalls).toBe(2);

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '8888-0002' } });
        fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '5678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await settleAsyncWork();
        await settleAsyncWork();

        expect(screen.getByRole('heading', { name: 'Repartidor B' })).toBeInTheDocument();

        await act(async () => {
            staleOrdersA.resolve(response({
                driver: { id: 'driver-a', nombre: 'Repartidora A tardía', tipoFlota: 'PROPIA' },
                orders: [],
            }));
            await Promise.resolve();
        });
        await settleAsyncWork();

        expect(screen.getByRole('heading', { name: 'Repartidor B' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Repartidora A tardía' })).toBeNull();
        expect(localStorage.getItem(DRIVER_THEME_SCOPE_KEY)).toBe('driver-b');
    });

    it('ignora 401 y error de red tardíos de la sesión anterior', async () => {
        localStorage.setItem(DRIVER_TOKEN_KEY, 'token-driver-a');
        const staleUnauthorizedA = createDeferred<Response>();
        const staleNetworkErrorA = createDeferred<Response>();
        let driverAOrderCalls = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/driver/me/orders') {
                const token = (init?.headers as Record<string, string> | undefined)?.Authorization;
                if (token === 'Bearer token-driver-a') {
                    driverAOrderCalls += 1;
                    if (driverAOrderCalls === 2) return staleUnauthorizedA.promise;
                    if (driverAOrderCalls === 3) return staleNetworkErrorA.promise;
                    return response({
                        driver: { id: 'driver-a', nombre: 'Repartidora A', tipoFlota: 'PROPIA' },
                        orders: [],
                    });
                }
                if (token === 'Bearer token-driver-b') {
                    return response({
                        driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'PROPIA' },
                        orders: [],
                    });
                }
            }
            if (url === '/api/driver/login') {
                return response({
                    token: 'token-driver-b',
                    driver: { id: 'driver-b', nombre: 'Repartidor B', tipoFlota: 'PROPIA' },
                });
            }
            throw new Error(`fetch inesperado: ${url} ${init?.method ?? 'GET'}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderDriver();
        await settleAsyncWork();

        await act(async () => {
            vi.advanceTimersByTime(20_000);
            await Promise.resolve();
        });
        expect(driverAOrderCalls).toBe(3);

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '8888-0003' } });
        fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '9012' } });
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await settleAsyncWork();
        await settleAsyncWork();

        await act(async () => {
            staleUnauthorizedA.resolve(response({ error: 'Sesión A expirada' }, 401));
            staleNetworkErrorA.reject(new Error('Red A desconectada'));
            await Promise.resolve();
        });
        await settleAsyncWork();

        expect(screen.getByRole('heading', { name: 'Repartidor B' })).toBeInTheDocument();
        expect(screen.queryByText('No pudimos cargar tus entregas')).toBeNull();
        expect(localStorage.getItem(DRIVER_TOKEN_KEY)).toBe('token-driver-b');
        expect(localStorage.getItem(DRIVER_THEME_SCOPE_KEY)).toBe('driver-b');
    });
});
