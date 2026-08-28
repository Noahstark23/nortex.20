// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Contabilidad from '../components/Contabilidad';

const componentSource = readFileSync(resolve(process.cwd(), 'components/Contabilidad.tsx'), 'utf8');

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const closedPeriod = {
    id: 'period-1',
    year: 2026,
    month: 7,
    status: 'CLOSED',
    closedAt: '2026-08-01T12:00:00.000Z',
};

const activeAsset = {
    id: 'asset-1',
    nombre: 'Laptop Caja',
    categoria: 'COMPUTO',
    costo: 1200,
    fechaAdquisicion: '2026-01-15T12:00:00.000Z',
    vidaUtilMeses: 24,
    depreciacionAcumulada: 400,
    mesesDepreciados: 8,
    valorEnLibros: 800,
    estado: 'ACTIVO',
};

const cierreFixture = {
    period: '2026-08',
    obligaciones: [],
    totalDeclarar: 0,
    pendientes: 0,
    periodoCerrado: false,
    planillaCalculada: true,
    vetSummary: '',
};

const setSessionRole = (role: string) => {
    localStorage.setItem('nortex_token', `header.${btoa(JSON.stringify({ role }))}.signature`);
};

const installFetchMock = (options: { failFirstRetentionPost?: boolean } = {}) => {
    let retentionPostAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/accounting/chart') return jsonResponse([]);
        if (url.startsWith('/api/accounting/cierre-mensual/')) return jsonResponse(cierreFixture);
        if (url === '/api/accounting/periods' && !init?.method) return jsonResponse({ periods: [closedPeriod] });
        if (url === '/api/accounting/fiscal-close' && init?.method === 'POST') return jsonResponse({ message: 'Período cerrado.' });
        if (url === '/api/accounting/periods/2026/7/reopen' && init?.method === 'POST') return jsonResponse({ message: 'Período reabierto.' });
        if (url === '/api/accounting/fixed-assets' && !init?.method) return jsonResponse({ assets: [activeAsset] });
        if (url === '/api/accounting/fixed-assets/asset-1/baja' && init?.method === 'PATCH') return jsonResponse({ message: 'Activo dado de baja.' });
        if (url === '/api/accounting/tax-config' && !init?.method) {
            return jsonResponse({ inssPatronalRate: 0.215, anticipoIrRate: 0.01, imiRate: 0.01, salarioMinimo: 8000 });
        }
        if (url === '/api/accounting/exchange-rate/latest' && !init?.method) return jsonResponse({ rate: 36.8, fecha: '2026-08-27' });
        if (url === '/api/collections/worklist' && !init?.method) {
            return jsonResponse({
                summary: {},
                items: [
                    {
                        saleId: 'sale-open-1',
                        customerName: 'Empresa retenedora',
                        invoiceNumber: '1042',
                        date: '2026-08-20T12:00:00.000Z',
                        dueDate: '2026-09-20T12:00:00.000Z',
                        total: 1000,
                        balance: 1000,
                    },
                    {
                        saleId: 'sale-partial-1',
                        customerName: 'Cliente parcialmente pagado',
                        invoiceNumber: '1043',
                        date: '2026-08-21T12:00:00.000Z',
                        dueDate: '2026-09-21T12:00:00.000Z',
                        total: 1000,
                        balance: 5,
                    },
                ],
            });
        }
        if (url === '/api/accounting/retenciones-sufridas' && !init?.method) return jsonResponse({ retenciones: [] });
        if (url === '/api/accounting/retenciones-sufridas' && init?.method === 'POST') {
            retentionPostAttempts += 1;
            if (options.failFirstRetentionPost && retentionPostAttempts === 1) {
                return jsonResponse({ error: 'Servicio temporalmente no disponible.' }, 503);
            }
            return jsonResponse({ message: 'Retención registrada.', idempotentReplay: retentionPostAttempts > 1 }, retentionPostAttempts > 1 ? 200 : 201);
        }
        throw new Error(`URL no esperada en la prueba: ${url} (${init?.method || 'GET'})`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

describe('Contabilidad: feedback y decisiones accesibles', () => {
    beforeEach(() => {
        localStorage.clear();
        setSessionRole('OWNER');
        if (!window.requestAnimationFrame) {
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
            vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        }
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('no conserva diálogos nativos y monta el viewport accesible', () => {
        expect(componentSource).toContain("import { ToastViewport, useToast } from './ui/Toast'");
        expect(componentSource).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
        expect(componentSource).not.toMatch(/\b(?:alert|confirm|prompt)\s*\(/);
        expect(componentSource).toContain('role="alertdialog"');
        expect(componentSource).toContain('aria-modal="true"');
        expect(componentSource).toContain("event.key === 'Escape'");
        expect(componentSource).toContain('decisionReturnFocusRef');
        expect(componentSource).toContain("timeZone: 'America/Managua'");
        expect(componentSource).not.toContain("today.toISOString().slice(0, 10)");
    });

    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN'])(
        '%s puede cerrar y reabrir períodos conforme al bypass efectivo de checkRole',
        async (role) => {
            setSessionRole(role);
            installFetchMock();
            render(<Contabilidad />);

            fireEvent.click(screen.getByRole('button', { name: 'Períodos' }));

            expect(await screen.findByRole('button', { name: /Cerrar / })).toBeTruthy();
            expect(await screen.findByRole('button', { name: 'Reabrir' })).toBeTruthy();
            expect(screen.queryByText(/Solo el propietario o la administración/)).toBeNull();
        },
    );

    it('ACCOUNTANT conserva las mutaciones contables permitidas sin controles de cierre', async () => {
        setSessionRole('ACCOUNTANT');
        installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Períodos' }));
        await screen.findByText('Jul 2026');
        expect(screen.queryByRole('button', { name: /Cerrar / })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull();
        expect(screen.getByText('Solo el propietario o la administración pueden cerrar períodos')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Asiento Manual' }));
        expect(screen.getByRole('button', { name: 'Registrar' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Retenciones' }));
        expect(screen.getByRole('button', { name: 'Registrar retención' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Config Fiscal' }));
        expect(screen.getByRole('button', { name: 'Guardar tasas' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Activos Fijos' }));
        expect(screen.getByRole('button', { name: 'Agregar activo' })).toBeTruthy();
        expect(await screen.findByRole('button', { name: 'Dar de baja Laptop Caja' })).toBeTruthy();
    });

    it.each(['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO'])(
        '%s no ve controles contables ni dispara lecturas por una URL directa',
        (role) => {
            setSessionRole(role);
            const fetchMock = installFetchMock();
            render(<Contabilidad />);

            expect(screen.getByRole('alert').textContent).toContain('Contabilidad restringida');
            expect(screen.queryByRole('navigation', { name: 'Secciones de contabilidad' })).toBeNull();
            expect(screen.queryByRole('button', { name: 'Registrar' })).toBeNull();
            expect(screen.queryByRole('button', { name: /Cerrar / })).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );

    it('confirma el cierre sin disparar la mutación antes de la decisión', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Períodos' }));
        const closeButton = await screen.findByRole('button', { name: /Cerrar / });
        fireEvent.click(closeButton);

        expect(screen.getByRole('alertdialog', { name: /Cerrar / })).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/accounting/fiscal-close' && init?.method === 'POST')).toBe(false);

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(closeButton);

        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));

        expect(await screen.findByText('Período cerrado.', { selector: 'p' })).toBeTruthy();
        await waitFor(() => {
            const mutation = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/accounting/fiscal-close' && init?.method === 'POST');
            expect(mutation).toBeTruthy();
            expect(JSON.parse(String(mutation?.[1]?.body))).toEqual(expect.objectContaining({ month: expect.any(Number), year: expect.any(Number) }));
        });
    });

    it('exige un motivo inline antes de reabrir y envía el texto auditado', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Períodos' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
        const reason = screen.getByLabelText('Motivo de reapertura');

        fireEvent.click(screen.getByRole('button', { name: 'Reabrir período' }));
        expect(screen.getByRole('alert').textContent).toContain('Escribí un motivo de al menos 3 caracteres.');
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/reopen') && init?.method === 'POST')).toBe(false);

        fireEvent.change(reason, { target: { value: 'Corregir factura del mes anterior' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reabrir período' }));

        expect(await screen.findByText('Período reabierto.', { selector: 'p' })).toBeTruthy();
        await waitFor(() => {
            const mutation = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/reopen') && init?.method === 'POST');
            expect(mutation).toBeTruthy();
            expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({ reason: 'Corregir factura del mes anterior' });
        });
    });

    it('pide confirmación contextual antes de dar de baja un activo', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Activos Fijos' }));
        const retireButton = await screen.findByRole('button', { name: 'Dar de baja Laptop Caja' });
        fireEvent.click(retireButton);

        expect(screen.getByRole('alertdialog', { name: 'Dar de baja Laptop Caja' })).toBeTruthy();
        expect(screen.getByText(/valor en libros/i)).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/asset-1/baja') && init?.method === 'PATCH')).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));

        expect(await screen.findByText('Activo dado de baja', { selector: 'p' })).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/asset-1/baja') && init?.method === 'PATCH')).toBe(true);
    });

    it('muestra validación inline para tasa y activo sin solicitudes inválidas', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Config Fiscal' }));
        await screen.findByText(/Vigente:/);
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        expect(screen.getByRole('alert').textContent).toContain('Ingresá una tasa mayor a cero.');

        fireEvent.click(screen.getByRole('button', { name: 'Activos Fijos' }));
        await screen.findByText('Laptop Caja');
        fireEvent.click(screen.getByRole('button', { name: 'Agregar activo' }));
        expect(screen.getByRole('alert').textContent).toContain('Escribí el nombre del activo.');

        expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/accounting/exchange-rate' && init?.method === 'POST')).toBe(false);
        expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/accounting/fixed-assets' && init?.method === 'POST')).toBe(false);
    });

    it('obliga a seleccionar una factura abierta sin pedir IDs manuales', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Retenciones' }));
        await screen.findByRole('option', { name: /Factura #1042/ });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar retención' }));

        expect(screen.getByText('Seleccioná la factura a crédito que recibió la retención.')).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/accounting/retenciones-sufridas' && init?.method === 'POST')).toBe(false);
        expect(componentSource).not.toMatch(/placeholder=["'](?:saleId|ID de venta)/i);
    });

    it('conserva el UUID y los decimales exactos al reintentar una retención', async () => {
        const fetchMock = installFetchMock({ failFirstRetentionPost: true });
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Retenciones' }));
        await screen.findByText('Aún no hay retenciones registradas.');
        fireEvent.change(await screen.findByLabelText('Factura a crédito abierta'), { target: { value: 'sale-open-1' } });

        fireEvent.click(screen.getByRole('button', { name: 'Registrar retención' }));
        expect(await screen.findByText('Servicio temporalmente no disponible.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Registrar retención' }));
        expect(await screen.findByText('Retención registrada.')).toBeTruthy();

        const bodies = fetchMock.mock.calls
            .filter(([url, init]) => String(url) === '/api/accounting/retenciones-sufridas' && init?.method === 'POST')
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toEqual(expect.objectContaining({
            saleId: 'sale-open-1',
            clienteRetenedor: 'Empresa retenedora',
            baseAmount: '1000.00',
            amount: '20.00',
            clientEventId: expect.any(String),
        }));
        expect(bodies[1]).toEqual(bodies[0]);
    });

    it('limita el cálculo automático al saldo abierto de una factura parcialmente pagada', async () => {
        const fetchMock = installFetchMock();
        render(<Contabilidad />);

        fireEvent.click(screen.getByRole('button', { name: 'Retenciones' }));
        fireEvent.change(await screen.findByLabelText('Factura a crédito abierta'), { target: { value: 'sale-partial-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar retención' }));

        expect(await screen.findByText('Retención registrada.')).toBeTruthy();
        const call = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/accounting/retenciones-sufridas' && init?.method === 'POST');
        expect(JSON.parse(String(call?.[1]?.body))).toEqual(expect.objectContaining({
            saleId: 'sale-partial-1',
            baseAmount: '1000.00',
            amount: '5.00',
        }));
    });
});
