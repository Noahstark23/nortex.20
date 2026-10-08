// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantBudgetPanel, type AssistantBudgetView } from '../components/assistant/AssistantBudgetPanel';
import { AssistantRequestError, type AssistantRequest } from '../hooks/useNortexAssistant';

const budget = (patch: Partial<AssistantBudgetView> = {}): AssistantBudgetView => ({ month: '2026-09', limitUsd: '2.000000', spentUsd: '0.123456', reservedUsd: '0.281920', remainingUsd: '1.594624', blocked: false, canRequest: true, maxLimitUsd: '10', requests: [], platformAvailable: true, availabilityReason: null, ...patch });
const row = { id: 'request-qa-1', requestedUsd: '5.00', reason: 'Necesitamos más consultas de ayuda', status: 'PENDING' as const, createdAt: '2026-09-08T17:00:00Z', decidedAt: null, decisionReason: null };
const mount = (request: ReturnType<typeof vi.fn>, sessionKey = 'session-a') => render(<AssistantBudgetPanel request={request as AssistantRequest} sessionKey={sessionKey} />);
async function fill() {
    fireEvent.change(await screen.findByLabelText('Nuevo límite mensual en US$'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Motivo del aumento'), { target: { value: row.reason } });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('presupuesto visible para el dueño', () => {
    it('muestra importes exactos, reservas retenidas y límite compartido sin prometer disponibilidad', async () => {
        mount(vi.fn().mockResolvedValue(budget({ platformAvailable: false, availabilityReason: 'PLATFORM_LIMIT' })));
        expect(await screen.findByText('US$ 0.123456')).toBeInTheDocument();
        expect(screen.getByText('US$ 0.28192')).toBeInTheDocument();
        expect(screen.getByText(/costo incierto/)).toHaveTextContent('siguen retenidas');
        expect(screen.getByText(/Aumentar el límite de tu negocio/)).toHaveTextContent('no restablece');
        expect(screen.getByText(/no genera cobros automáticos/)).toHaveTextContent('cada mes');
    });
    it('envía una solicitud y doble clic no duplica el envío', async () => {
        let finish!: (value: unknown) => void;
        const request = vi.fn(async (path: string) => path === '/budget' ? budget() : new Promise(resolve => { finish = resolve; }));
        mount(request); await fill();
        const submit = screen.getByRole('button', { name: 'Solicitar aumento a Nortex' });
        fireEvent.click(submit); fireEvent.click(submit);
        expect(request.mock.calls.filter(([path]) => path === '/budget/requests')).toHaveLength(1);
        const payload = JSON.parse((request.mock.calls.find(([path]) => path === '/budget/requests') as unknown as [string, RequestInit])[1].body as string);
        expect(payload).toEqual({ idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/), requestedUsd: '5.00', reason: row.reason });
        await act(async () => finish(row));
        expect(await screen.findByText(/Solicitud request-qa-1:/)).toHaveTextContent('Pendiente de Nortex');
    });
    it('respuesta perdida congela contenido y conserva UUID al reintentar incluso después de consultar estado', async () => {
        const bodies: string[] = []; let posts = 0;
        const request = vi.fn(async (path: string, options?: RequestInit) => {
            if (path === '/budget') return budget();
            bodies.push(options!.body as string);
            if (++posts === 1) throw new AssistantRequestError('La conexión se interrumpió.');
            return row;
        });
        mount(request); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Solicitar aumento a Nortex' }));
        await screen.findByRole('button', { name: 'Reintentar la misma solicitud' });
        expect(screen.getByLabelText('Nuevo límite mensual en US$')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Consultar estado del presupuesto' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar la misma solicitud' })).toBeEnabled());
        expect(posts).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar la misma solicitud' }));
        await screen.findByText(/Solicitud request-qa-1:/);
        expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    });
    it('fallo de lectura oculta importes; no se presenta como consumo cero', async () => {
        const request = vi.fn().mockResolvedValueOnce(budget()).mockRejectedValue(new AssistantRequestError('Consulta no disponible', 503));
        mount(request); await screen.findByText('US$ 0.123456');
        fireEvent.click(screen.getByRole('button', { name: 'Consultar estado del presupuesto' }));
        await screen.findByRole('alert'); expect(screen.queryByText('US$ 0.123456')).not.toBeInTheDocument();
        expect(screen.queryByText('Consumo confirmado')).not.toBeInTheDocument();
    });
    it('permiso revocado limpia saldo, historial y formulario', async () => {
        const request = vi.fn().mockResolvedValueOnce(budget({ requests: [row] })).mockRejectedValue(new AssistantRequestError('Permiso revocado', 403));
        mount(request); await fill();
        fireEvent.click(screen.getByRole('button', { name: 'Consultar estado del presupuesto' }));
        await screen.findByText('Permiso revocado');
        expect(screen.queryByLabelText('Motivo del aumento')).not.toBeInTheDocument();
        expect(screen.queryByText(row.reason)).not.toBeInTheDocument();
    });
    it('un cambio de sesión descarta una respuesta tardía del negocio anterior', async () => {
        let finish!: (value: unknown) => void;
        const old = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const view = mount(old); const next = vi.fn().mockResolvedValue(budget({ month: '2026-10', canRequest: false }));
        view.rerender(<AssistantBudgetPanel request={next as AssistantRequest} sessionKey="session-b" />);
        await screen.findByText('Mes 2026-10 · corte de Managua');
        await act(async () => finish(budget({ requests: [row] })));
        expect(screen.queryByText(row.reason)).not.toBeInTheDocument();
        expect(screen.queryByText('Mes 2026-09 · corte de Managua')).not.toBeInTheDocument();
    });
    it.each(['2', '10.01', '5.001', '-3'])('rechaza monto %s sin enviar mutación', async amount => {
        const request = vi.fn().mockResolvedValue(budget()); mount(request); await fill();
        fireEvent.change(screen.getByLabelText('Nuevo límite mensual en US$'), { target: { value: amount } });
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar aumento a Nortex' }));
        await screen.findByRole('alert'); expect(request).toHaveBeenCalledTimes(1);
    });
    it('una solicitud pendiente muestra estado sin ofrecer otro envío', async () => {
        mount(vi.fn().mockResolvedValue(budget({ requests: [row], canRequest: false })));
        await screen.findByText('US$ 5.00 al mes · Pendiente de Nortex');
        expect(screen.queryByRole('button', { name: 'Solicitar aumento a Nortex' })).not.toBeInTheDocument();
    });
});
