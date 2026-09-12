// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantBudgetRequests } from '../components/admin/AssistantBudgetRequests';

const row = { id: 'budget-qa-1', tenantId: 'tenant-qa-a', businessName: 'Ferretería Sintética QA', requestedUsd: '5.00', reason: 'Más consultas para revisar inventario', status: 'PENDING', createdAt: '2026-09-08T17:00:00Z', decidedAt: null, decisionReason: null };
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
const session = (token: string, tenant = 'nortex-qa') => { localStorage.setItem('nortex_token', token); localStorage.setItem('nortex_user', JSON.stringify({ tenant: { id: tenant } })); };
async function review() {
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar Ferretería Sintética QA' }));
    fireEvent.change(screen.getByLabelText('Motivo de la decisión'), { target: { value: 'Aprobado para soporte del negocio' } });
}
beforeEach(() => { localStorage.clear(); session('synthetic-admin-token'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('revisión Nortex de aumentos sin cobros', () => {
    it('requiere revisión visual y envía decisión sin reconstruir monto o tenant', async () => {
        const fetcher = vi.fn(async (_url: string, options?: RequestInit) => ok(options?.method === 'POST' ? { ...row, status: 'APPROVED' } : { requests: [row], nextCursor: null }));
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />);
        await screen.findByRole('button', { name: 'Revisar Ferretería Sintética QA' });
        expect(screen.queryByRole('button', { name: 'Confirmar aprobación sin cobro' })).not.toBeInTheDocument();
        await review();
        expect(screen.getByRole('region', { name: 'Revisar aumento de presupuesto' })).toHaveTextContent('Nuevo límite recurrente: US$ 5.00 al mes.');
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprobación sin cobro' }));
        await screen.findByText(/No se generó ningún cobro/);
        const [url, options] = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
        expect(url).toBe('/api/admin/assistant-budget/requests/budget-qa-1/decision');
        expect(JSON.parse(options!.body as string)).toEqual({ decision: 'APPROVED', reason: 'Aprobado para soporte del negocio' });
        expect(options).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer synthetic-admin-token' } });
    });
    it('valida motivo y permite rechazo explícito', async () => {
        const fetcher = vi.fn(async (_url: string, options?: RequestInit) => ok(options?.method === 'POST' ? { ...row, status: 'REJECTED' } : { requests: [row], nextCursor: null }));
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />);
        fireEvent.click(await screen.findByRole('button', { name: 'Revisar Ferretería Sintética QA' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' })); await screen.findByRole('alert');
        expect(fetcher).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByLabelText('Motivo de la decisión'), { target: { value: 'Necesita aclarar su solicitud' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
        await screen.findByText(/Solicitud budget-qa-1: Rechazada/);
    });
    it('página siguiente conserva cursor y no duplica filas', async () => {
        const next = { ...row, id: 'budget-qa-2', businessName: 'Farmacia Sintética QA' };
        const fetcher = vi.fn().mockResolvedValueOnce(ok({ requests: [row], nextCursor: 'cursor/a' })).mockResolvedValueOnce(ok({ requests: [row, next], nextCursor: null }));
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />);
        fireEvent.click(await screen.findByRole('button', { name: 'Cargar más solicitudes' }));
        await screen.findByRole('heading', { name: 'Farmacia Sintética QA' });
        expect(screen.getAllByRole('heading', { name: 'Ferretería Sintética QA' })).toHaveLength(1);
        expect(fetcher.mock.calls[1][0]).toBe('/api/admin/assistant-budget/requests?status=PENDING&cursor=cursor%2Fa');
    });
    it('respuesta perdida conserva decisión exacta y bloquea cambiar motivo o resolver otra solicitud', async () => {
        let posts = 0; const bodies: string[] = [];
        const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
            if (options?.method !== 'POST') return ok({ requests: [row], nextCursor: null });
            bodies.push(options.body as string); if (++posts === 1) throw new Error('Network failed');
            return ok({ ...row, status: 'APPROVED' });
        });
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />); await review();
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprobación sin cobro' }));
        await screen.findByRole('button', { name: 'Reintentar la misma decisión' });
        expect(screen.getByLabelText('Motivo de la decisión')).toBeDisabled();
        expect(screen.getByLabelText('Estado de solicitudes')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Confirmar rechazo' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar solicitudes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar la misma decisión' })).toBeEnabled());
        expect(posts).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar la misma decisión' }));
        await screen.findByText(/No se generó ningún cobro/); expect(bodies[1]).toBe(bodies[0]);
    });
    it('permiso revocado oculta lista y revisión anteriores sin aparentar cola vacía', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(ok({ requests: [row], nextCursor: null })).mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Permiso revocado' }) });
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />); await review();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar solicitudes' }));
        await screen.findByText('Permiso revocado');
        expect(screen.queryByText(row.businessName)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Motivo de la decisión')).not.toBeInTheDocument();
        expect(screen.queryByText('No hay solicitudes en este estado.')).not.toBeInTheDocument();
    });
    it('cambio de sesión descarta respuesta anterior y utiliza autorización nueva', async () => {
        let finish!: (value: unknown) => void;
        const fetcher = vi.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(ok({ requests: [], nextCursor: null }));
        vi.stubGlobal('fetch', fetcher); render(<AssistantBudgetRequests />);
        session('other-synthetic-token', 'other-qa'); fireEvent(window, new Event('storage'));
        await screen.findByText('No hay solicitudes en este estado.');
        await act(async () => finish(ok({ requests: [row], nextCursor: null })));
        expect(screen.queryByText(row.businessName)).not.toBeInTheDocument();
        expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer other-synthetic-token');
    });
    it('fallo de consulta muestra error sin confundirlo con cero solicitudes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Disconnected'))); render(<AssistantBudgetRequests />);
        await screen.findByRole('alert'); expect(screen.queryByText('No hay solicitudes en este estado.')).not.toBeInTheDocument();
    });
});
