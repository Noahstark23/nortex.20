// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MiEspacio from '../components/MiEspacio';

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const profileFixture = {
    id: 'employee-1',
    name: 'Admin Principal',
    role: 'Administrador',
    cedula: '001-010190-0001A',
    inss: '1234567',
    baseSalary: 15000,
    vacationDays: 12.5,
    jornada: 'DIURNA',
    hireDate: '2024-01-15T00:00:00.000Z',
    antiguedadTexto: '2 años y 7 meses',
};

const payrollFixture = {
    id: 'payroll-1',
    month: 1,
    year: 2026,
    grossSalary: 10000,
    commissions: 500,
    overtimePay: 0,
    holidayPay: 0,
    totalIncome: 10500,
    inssLaboral: 735,
    irLaboral: 265,
    advanceDeduction: 500,
    absenceDeduction: 0,
    judicialDeduction: 0,
    netSalary: 9000,
    inssPatronal: 2257.5,
    inatec: 210,
    status: 'PAGADO',
};

type RouteHandler = (init?: RequestInit) => Response | Promise<Response>;

interface FetchOptions {
    payrolls?: unknown[];
    requests?: { leaves: unknown[]; advances: unknown[] };
    routes?: Record<string, RouteHandler>;
}

const installFetch = ({
    payrolls = [],
    requests = { leaves: [], advances: [] },
    routes = {},
}: FetchOptions = {}) => {
    const handlers: Record<string, RouteHandler> = {
        'GET /api/me/profile': () => jsonResponse(profileFixture),
        'GET /api/me/payrolls': () => jsonResponse(payrolls),
        'GET /api/me/requests': () => jsonResponse(requests),
        ...routes,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        const method = init?.method?.toUpperCase() ?? 'GET';
        const handler = handlers[`${method} ${url}`];
        if (!handler) throw new Error(`Solicitud inesperada: ${method} ${url}`);
        return handler(init);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

const findCall = (
    fetchMock: ReturnType<typeof vi.fn>,
    method: string,
    url: string,
) => fetchMock.mock.calls.find(([input, init]) => (
    String(input) === url && (init?.method?.toUpperCase() ?? 'GET') === method
));

describe('MiEspacio', () => {
    const originalTimezone = process.env.TZ;

    beforeEach(() => {
        process.env.TZ = 'America/Managua';
        localStorage.clear();
        localStorage.setItem('nortex_token', 'qa-token');
    });

    afterEach(() => {
        vi.useRealTimers();
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    });

    it('carga el expediente y expone formularios etiquetados y comprensibles', async () => {
        const fetchMock = installFetch({
            requests: {
                leaves: [{
                    id: 'leave-pending',
                    type: 'VACATION',
                    startDate: '2026-09-10',
                    endDate: '2026-09-12T00:00:00.000Z',
                    status: 'PENDING',
                }],
                advances: [{ id: 'advance-deducted', amount: 500, fee: 25, status: 'DEDUCTED' }],
            },
        });

        render(<MiEspacio />);

        expect(await screen.findByRole('heading', { name: 'Mi Espacio' })).toBeVisible();
        expect(screen.getByText('Admin Principal')).toBeVisible();
        expect(screen.getByText('15/1/2024')).toBeVisible();
        expect(screen.getByRole('region', { name: 'Resumen laboral' })).toBeVisible();
        expect(screen.getByText('Aún no tenés colillas registradas.')).toBeVisible();
        expect(screen.getByText(/10 sept 26 → 12 sept 26/)).toBeVisible();

        expect(screen.getByRole('combobox', { name: 'Tipo de ausencia' })).toHaveValue('VACATION');
        expect(screen.getByLabelText('Desde')).toHaveAttribute('type', 'date');
        expect(screen.getByLabelText('Hasta')).toHaveAttribute('type', 'date');
        expect(screen.getByLabelText(/Motivo/)).toHaveAttribute('placeholder', 'Contanos brevemente');

        const advanceAmount = screen.getByRole('textbox', { name: 'Monto solicitado (C$)' });
        expect(advanceAmount).toHaveAttribute('inputmode', 'decimal');
        expect(advanceAmount).toHaveAccessibleDescription(/Hasta el 30% de tu salario/);
        const deductedBadge = screen.getByText('Aprobada');
        expect(deductedBadge).toHaveClass('nx-tone-positive-bg', 'nx-tone-positive');

        expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
            '/api/me/profile',
            '/api/me/payrolls',
            '/api/me/requests',
        ]);
        fetchMock.mock.calls.forEach(([, init]) => {
            expect(init?.headers).toEqual({ Authorization: 'Bearer qa-token' });
        });
    });

    it.each([
        {
            name: 'un expediente inexistente',
            profile: () => jsonResponse({ error: 'Sin expediente laboral vinculado.' }, 404),
            message: 'Sin expediente laboral vinculado.',
        },
        {
            name: 'un fallo de conexión',
            profile: () => Promise.reject(new Error('offline')),
            message: 'No se pudo cargar tu espacio.',
        },
    ])('presenta $name dentro de una alerta accesible', async ({ profile, message }) => {
        const fetchMock = installFetch({ routes: { 'GET /api/me/profile': profile } });

        render(<MiEspacio />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('No pudimos abrir tu expediente');
        expect(alert).toHaveTextContent(message);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Enviar solicitud' })).not.toBeInTheDocument();
    });

    it('envía la ausencia exacta, refresca solicitudes y restablece el formulario', async () => {
        const alertMock = vi.fn();
        vi.stubGlobal('alert', alertMock);
        const requestReads = vi.fn(() => jsonResponse({ leaves: [], advances: [] }));
        const fetchMock = installFetch({
            routes: {
                'GET /api/me/requests': requestReads,
                'POST /api/me/leave': () => jsonResponse({ message: 'Solicitud de ausencia enviada.' }, 201),
            },
        });

        render(<MiEspacio />);
        await screen.findByText('Admin Principal');

        fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de ausencia' }), {
            target: { value: 'UNPAID' },
        });
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-10' } });
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-12' } });
        fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Trámite familiar' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

        await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Solicitud de ausencia enviada.'));

        const post = findCall(fetchMock, 'POST', '/api/me/leave');
        expect(post?.[1]).toEqual({
            method: 'POST',
            headers: {
                Authorization: 'Bearer qa-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: 'UNPAID',
                startDate: '2026-09-10',
                endDate: '2026-09-12',
                reason: 'Trámite familiar',
            }),
        });
        expect(requestReads).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('combobox', { name: 'Tipo de ausencia' })).toHaveValue('VACATION');
        expect(screen.getByLabelText('Desde')).toHaveValue('');
        expect(screen.getByLabelText('Hasta')).toHaveValue('');
        expect(screen.getByLabelText(/Motivo/)).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeEnabled();
    });

    it('sanea el monto, envía el adelanto exacto, refresca y limpia el campo', async () => {
        const alertMock = vi.fn();
        vi.stubGlobal('alert', alertMock);
        const requestReads = vi.fn(() => jsonResponse({ leaves: [], advances: [] }));
        const fetchMock = installFetch({
            routes: {
                'GET /api/me/requests': requestReads,
                'POST /api/me/advance': () => jsonResponse({ message: 'Adelanto solicitado.' }, 201),
            },
        });

        render(<MiEspacio />);
        await screen.findByText('Admin Principal');

        const amount = screen.getByRole('textbox', { name: 'Monto solicitado (C$)' });
        fireEvent.change(amount, { target: { value: '1.2.3' } });
        expect(amount).toHaveValue('1.23');
        fireEvent.change(amount, { target: { value: 'C$ 1,250.50x' } });
        expect(amount).toHaveValue('1250.50');
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar adelanto' }));

        await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Adelanto solicitado.'));

        const post = findCall(fetchMock, 'POST', '/api/me/advance');
        expect(post?.[1]).toEqual({
            method: 'POST',
            headers: {
                Authorization: 'Bearer qa-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount: '1250.50' }),
        });
        expect(requestReads).toHaveBeenCalledTimes(2);
        expect(amount).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Solicitar adelanto' })).toBeEnabled();
    });

    it('genera la colilla y espera antes de abrir el diálogo de impresión', async () => {
        installFetch({ payrolls: [payrollFixture] });
        render(<MiEspacio />);
        await screen.findByText('Admin Principal');

        const popup = {
            document: { write: vi.fn(), close: vi.fn() },
            print: vi.fn(),
        };
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
        vi.useFakeTimers();

        fireEvent.click(screen.getAllByRole('button', { name: 'Imprimir colilla de Enero 2026' })[0]);

        expect(openSpy).toHaveBeenCalledWith('', '_blank');
        expect(popup.document.close).toHaveBeenCalledOnce();
        const html = String(popup.document.write.mock.calls[0]?.[0]);
        expect(html).toContain('COLILLA DE PAGO');
        expect(html).toContain('Admin Principal · Enero 2026');
        expect(html).toContain('Neto a recibir');
        expect(html).toContain('C$ 9,000.00');

        vi.advanceTimersByTime(399);
        expect(popup.print).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(popup.print).toHaveBeenCalledOnce();
    });
});
