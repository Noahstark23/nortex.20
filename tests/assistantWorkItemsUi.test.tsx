// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantWorkItems } from '../hooks/useAssistantWorkItems';
import { AssistantWorkItems } from '../components/assistant/AssistantWorkItems';
import type { AssistantWorkItemDTO } from '../shared/assistantWorkItems';

const fixture = (): AssistantWorkItemDTO => ({ id: 'work-1', kind: 'W01_CASH_REVIEW', status: 'IN_REVIEW', version: 0,
    conversationId: 'conversation-1', createdAt: '2026-09-19T12:00:00Z', updatedAt: '2026-09-19T12:00:00Z', expiresAt: '2026-10-10T12:00:00Z',
    source: { runId: 'run-1', evidenceId: 'evidence-1', contentHash: 'a'.repeat(64), period: { startDate: '2026-09-12', endDate: '2026-09-18', cutoff: '2026-09-19T06:00:00Z', timeZone: 'America/Managua', completeDays: true }, checkedAt: '2026-09-19T12:00:00Z', scope: 'business', reviewStatus: 'ok', truncated: false, counts: { closed: 0, verified: 0, differences: 0, missingReports: 0, invalidReports: 0, open: 0 } },
    review: { kind: 'WEEKLY_CASH_REVIEW', status: 'ok', checkedAt: '2026-09-19T12:00:00Z', scope: 'business', truncated: false,
        period: { startDate: '2026-09-12', endDate: '2026-09-18', cutoff: '2026-09-19T06:00:00Z', timeZone: 'America/Managua', completeDays: true },
        rows: [], counts: { closed: 0, verified: 0, differences: 0, missingReports: 0, invalidReports: 0, open: 0 },
        totals: { shortageNio: '0.00', surplusNio: '0.00', shortageUsd: '0.0000', surplusUsd: '0.0000' }, warnings: [], evidence: [] },
    events: [], eventsTruncated: false });
afterEach(cleanup);

describe('continuidad privada de revisiones', () => {
    it('abrir y listar sólo leen; conserva nota al comprobar la misma referencia', async () => {
        const request = vi.fn().mockResolvedValueOnce({ items: [fixture()], nextCursor: null }).mockResolvedValue(fixture());
        const { result } = renderHook(() => useAssistantWorkItems(request, 'user-a', true));
        await act(() => result.current.load()); await act(() => result.current.open('work-1'));
        act(() => result.current.setNote('Falta el recibo del proveedor'));
        await act(() => result.current.open('work-1'));
        expect(result.current.note).toBe('Falta el recibo del proveedor');
        expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
        expect(result.current.selected?.source.runId).toBe('run-1');
    });
    it('respuesta perdida conserva nota y reintenta exactamente el evento original', async () => {
        const item = fixture(); let calls = 0;
        const request = vi.fn(async (_path: string, init?: RequestInit) => {
            if (!init) return item;
            const body = JSON.parse(String(init.body));
            if (++calls === 1) throw new Error('Conexión interrumpida');
            return { ...item, version: 1, receiptEventId: body.eventId, events: [] };
        });
        const { result } = renderHook(() => useAssistantWorkItems(request as any, 'user-a', true));
        await act(() => result.current.open('work-1')); act(() => result.current.setNote('Revisar comprobante'));
        await act(() => result.current.change('ADD_NOTE'));
        expect(result.current.note).toBe('Revisar comprobante'); expect(result.current.pending).not.toBeNull();
        const id = result.current.pending!.input.eventId;
        act(() => result.current.setNote('No puede reemplazar el envío'));
        await act(() => result.current.retry());
        const writes = request.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(writes).toHaveLength(2); expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
        expect(JSON.parse(String(writes[1][1]?.body)).eventId).toBe(id);
        expect(result.current.pending).toBeNull(); expect(result.current.note).toBe('');
    });
    it('no descarta una nota para abrir otro trabajo ni para esperar', async () => {
        const request = vi.fn().mockResolvedValue(fixture());
        const { result } = renderHook(() => useAssistantWorkItems(request, 'user-a', true));
        await act(() => result.current.open('work-1')); act(() => result.current.setNote('Mi nota pendiente'));
        await act(() => result.current.open('work-2')); await act(() => result.current.change('WAIT'));
        expect(request).toHaveBeenCalledTimes(1); expect(result.current.note).toBe('Mi nota pendiente');
    });
    it('un conflicto versionado confirmado conserva la nota y permite recuperar antes de crear otro evento', async () => {
        const item = fixture(); let posted = 0;
        const request = vi.fn(async (_path: string, init?: RequestInit) => {
            if (!init) return { ...item, version: posted ? 1 : 0 };
            const body = JSON.parse(String(init.body));
            if (++posted === 1) throw { status: 409, code: 'WORK_ITEM_CHANGED' };
            return { ...item, version: 2, receiptEventId: body.eventId };
        });
        const { result } = renderHook(() => useAssistantWorkItems(request as any, 'user-a', true));
        await act(() => result.current.open('work-1')); act(() => result.current.setNote('Conservar esta nota'));
        await act(() => result.current.change('ADD_NOTE'));
        expect(result.current.pending).toBeNull(); expect(result.current.note).toBe('Conservar esta nota');
        await act(() => result.current.open('work-1')); await act(() => result.current.change('ADD_NOTE'));
        const payloads = request.mock.calls.filter(([, init]) => init).map(([, init]) => JSON.parse(String(init!.body)));
        expect(payloads.map(p => p.version)).toEqual([0, 1]); expect(payloads[0].eventId).not.toBe(payloads[1].eventId);
        expect(result.current.note).toBe('');
    });
    it('revocar acceso oculta datos y rechaza una respuesta antigua', async () => {
        let resolve!: (value: AssistantWorkItemDTO) => void;
        const request = vi.fn(() => new Promise<AssistantWorkItemDTO>(done => { resolve = done; }));
        const { result, rerender } = renderHook(({ enabled }) => useAssistantWorkItems(request as any, 'user-a', enabled), { initialProps: { enabled: true } });
        let pending: Promise<boolean>; act(() => { pending = result.current.open('work-1'); });
        rerender({ enabled: false }); await act(async () => { resolve(fixture()); await pending; });
        expect(result.current.selected).toBeNull(); expect(result.current.items).toEqual([]);
        await act(() => result.current.create('run-1')); expect(request).toHaveBeenCalledTimes(1);
    });
    it('componente muestra notas como aportes y bloquea aceptación no implementada', async () => {
        function Harness() { const c = useAssistantWorkItems(vi.fn().mockResolvedValue(fixture()), 'user-a', true); return <><button onClick={() => void c.create('run-1')}>Guardar fuente</button><AssistantWorkItems controller={c} /></>; }
        render(<Harness />); fireEvent.click(screen.getByText('Guardar fuente'));
        await screen.findByRole('region', { name: 'Revisión guardada' });
        fireEvent.change(screen.getByLabelText('Nota de la revisión'), { target: { value: 'Falta evidencia' } });
        expect(screen.getByRole('button', { name: 'Dejar en espera' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Aceptar informe|Confirmar caja/ })).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled());
    });
});
