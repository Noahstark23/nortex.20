// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import NortexAssistantLauncher from '../components/assistant/NortexAssistantLauncher';
import { useAssistantOperations } from '../hooks/useAssistantOperations';
import { AssistantActionReview } from '../components/assistant/AssistantActionReview';
import { AssistantOperationalEvidence } from '../components/assistant/AssistantOperationalEvidence';
import type { AssistantActionProposalDTO, AssistantRunDTO } from '../shared/assistantOperations';
import type { AssistantCapabilities } from '../shared/assistant';
const caps: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, extractionEnabled: true, executionEnabled: true, purchasePrepare: true, accessScope: 'OWNER', operations: true, actionPrepare: true, actionConfirm: true };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const run: AssistantRunDTO = { id: 'run1', conversationId: 'c1', requestId: 'r1', version: 1, iterations: 1, status: 'SUCCEEDED', steps: [{ id: 's1', tool: 'health', label: 'Verificar ventas registradas', status: 'SUCCEEDED' }], createdAt: '2026-09-05T10:00:00Z', updatedAt: '2026-09-05T10:00:01Z', result: { text: 'Las ventas aumentaron; faltan datos de gastos.', degraded: true, actionProposalIds: ['a1'], evidence: [{ id: 'e1', tool: 'health', label: 'Ventas de tu negocio', data: { kind: 'BUSINESS_HEALTH', period: { startDate: '2026-09-01', endDate: '2026-09-05', completeDays: false }, checkedAt: '2026-09-05T10:00:00Z', metrics: [{ label: 'Ventas registradas', value: '230.00', unit: 'money', status: 'ok', source: 'Ventas confirmadas menos devoluciones' }, { label: 'Gastos', value: null, status: 'unavailable', source: 'Gastos registrados' }] } }] } };
const proposal = (): AssistantActionProposalDTO => ({ id: 'a1', kind: 'BATCH_WRITEOFF', version: 2, status: 'READY', expiresAt: '2026-09-06', issues: [], draft: { batchId: 'lot1', warehouseId: 'w1', quantity: '3', reason: 'Vencido', physicalRemovalConfirmed: true }, preview: { summary: 'Retirar 3 unidades del lote L-1', lines: [{ name: 'Medicamento QA', batchNumber: 'L-1', quantity: '3' }], effects: [{ label: 'Existencias que salen', value: '3', unit: 'unidades' }, { label: 'Cuenta por pagar', value: '0.00', unit: 'C$' }], warnings: [], confirmLabel: 'Confirmar retiro de 3 unidades' } });
beforeEach(() => { localStorage.clear(); localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } })); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('conversación operativa y revisión exacta', () => {
    it('muestra advertencias y estado junto al lote afectado sin convertir stock no conciliado en cero', () => {
        render(<AssistantOperationalEvidence evidence={{ id: 'batch-evidence', tool: 'inspect_batch_expiry', label: 'Lotes', data: { kind: 'BATCH_EXPIRY', status: 'partial', warnings: ['Revisá la procedencia antes de actuar.'], rows: [
            { name: 'Acetaminofén', batchNumber: 'L-2', expiryDate: '2026-09-04', physicalStock: null, sellableStock: null, status: 'unavailable', warnings: ['El lote no está conciliado con las existencias físicas.'] },
            { name: 'Alcohol', batchNumber: 'L-3', expiryDate: '2026-09-09', physicalStock: '12', sellableStock: '12', status: 'ok', warnings: [] },
        ] } }} />);
        const unresolved = within(screen.getByRole('rowgroup', { name: 'Acetaminofén · Lote L-2' }));
        expect(unresolved.getByText('El lote no está conciliado con las existencias físicas.')).toBeVisible(); expect(unresolved.getByText('Información incompleta')).toBeVisible(); expect(unresolved.getAllByText('No disponible')).toHaveLength(2); expect(unresolved.queryByText('0')).not.toBeInTheDocument();
        const verified = within(screen.getByRole('rowgroup', { name: 'Alcohol · Lote L-3' })); expect(verified.getByText('Datos verificados')).toBeVisible(); expect(verified.queryByText('El lote no está conciliado con las existencias físicas.')).not.toBeInTheDocument();
        expect(screen.getByText('Revisá la procedencia antes de actuar.')).toBeVisible();
    });
    it('explica historial insuficiente, mínimo explícito y cobertura no disponible sin inventar consumo ni sugerencias', () => {
        render(<AssistantOperationalEvidence evidence={{ id: 'inventory-evidence', tool: 'check_inventory_burn_rate', label: 'Inventario', data: { kind: 'INVENTORY_BURN_RATE', status: 'partial', rows: [
            { name: 'Cemento nuevo', unit: 'bolsa', physicalStock: '2', sellableStock: '2', dailyAverage: null, estimatedDaysRemaining: null, pendingOrderQuantity: '0', suggestedQuantity: '3', configuredMinimum: '5', configuredMaximum: '20', historyStatus: 'INSUFFICIENT', historyAvailableDays: 6, historyRequiredDays: 30, suggestionBasis: 'CONFIGURED_MINIMUM', status: 'partial', warnings: ['Sólo hay 6 días desde el alta; no alcanza el historial para estimar consumo o cobertura. La sugerencia usa únicamente el mínimo configurado.'] },
            { name: 'Tornillos verificados', unit: 'unidad', physicalStock: '25', sellableStock: '25', dailyAverage: '2', estimatedDaysRemaining: '12.5', pendingOrderQuantity: '0', suggestedQuantity: '35', configuredMinimum: '10', configuredMaximum: null, historyStatus: 'SUFFICIENT', historyAvailableDays: 30, historyRequiredDays: 30, suggestionBasis: 'RECORDED_RATE', status: 'ok', warnings: ['Los días desde el alta no acreditan que una importación esté completa.'] },
        ] } }} />);
        const recent = within(screen.getByRole('rowgroup', { name: 'Cemento nuevo' })); expect(recent.getByText('Datos parciales')).toBeVisible(); expect(recent.getByText('Días insuficientes para estimar')).toBeVisible(); expect(recent.getByText(/Sólo hay 6 días desde el alta/)).toBeVisible(); expect(recent.getAllByText('No disponible')).toHaveLength(2);
        expect(recent.getByText('Días disponibles desde el alta').parentElement).toHaveTextContent('6'); expect(recent.getByText('Días de historial requeridos').parentElement).toHaveTextContent('30'); expect(recent.getByText('5')).toBeVisible(); expect(recent.getByText('20')).toBeVisible(); expect(recent.getByText('Base de la cantidad sugerida').parentElement).toHaveTextContent('Mínimo configurado'); expect(recent.getByRole('cell', { name: '3' })).toBeVisible();
        const verified = within(screen.getByRole('rowgroup', { name: 'Tornillos verificados' })); expect(verified.getByText('Días suficientes para estimar')).toBeVisible(); expect(verified.getByRole('cell', { name: '12.5' })).toBeVisible(); expect(verified.getByText('Base de la cantidad sugerida').parentElement).toHaveTextContent('Salidas por venta y reintegros registrados'); expect(verified.getByText(/no acreditan que una importación esté completa/)).toBeVisible();
        expect(screen.getByRole('columnheader', { name: 'Consumo neto de inventario registrado por día' })).toBeVisible(); expect(screen.getByRole('columnheader', { name: 'Días de cobertura estimados' })).toBeVisible(); expect(screen.queryByText('Venta diaria estimada')).not.toBeInTheDocument(); expect(screen.getByText(/Las devoluciones en cuarentena o por pérdida no se restan/)).toBeVisible();
    });
    it('usa el mismo chat, muestra evidencia sin convertir el fallo en cero y nunca confirma desde el resultado', async () => {
        const fetcher = vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok(caps);
            if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) return ok({ id: 'm1', role: 'assistant', text: 'Estoy revisando.', operationalRunId: 'run1', createdAt: '2026-09-05' });
            if (url.endsWith('/runs/run1')) return ok(run);
            if (url.endsWith('/action-proposals/a1')) return ok(proposal());
            if (url.includes('/catalog?')) return ok({ items: [] });
            throw new Error('Ruta inesperada');
        }); vi.stubGlobal('fetch', fetcher);
        render(<MemoryRouter><NortexAssistantLauncher /></MemoryRouter>); fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' }));
        fireEvent.change(await screen.findByLabelText('Tu consulta'), { target: { value: 'Analizá mi negocio' } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }));
        expect(await screen.findByText('Las ventas aumentaron; faltan datos de gastos.')).toBeVisible(); expect(screen.getByText('No disponible')).toBeVisible(); expect(screen.getByText(/Ventas confirmadas menos devoluciones/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Revisar propuesta 1' })); expect(await screen.findByRole('region', { name: 'Revisión de acción' })).toHaveTextContent('Retirar 3 unidades del lote L-1');
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
        fireEvent.change(screen.getByLabelText('Cantidad que se retira'), { target: { value: '2' } }); expect(screen.getByRole('button', { name: 'Confirmar retiro de 3 unidades' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: 'Abrir NortexGPT' }));
        expect(await screen.findByLabelText('Cantidad que se retira')).toHaveValue('2');
    });
    it('una confirmación incierta bloquea edición y reintenta con la misma clave; sólo evidencia persistida acredita éxito', async () => {
        const request = vi.fn(async (path: string) => { if (path.endsWith('/confirm')) throw new TypeError('lost'); return proposal(); });
        const { result } = renderHook(() => useAssistantOperations(request as any, 'session-a', true, []));
        await act(() => result.current.openProposal('a1')); await act(() => result.current.confirm());
        expect(result.current.uncertain).toBe(true); act(() => result.current.edit({ ...proposal().draft, quantity: '99' })); expect(result.current.draft.quantity).toBe('3');
        await act(() => result.current.confirm()); const calls = request.mock.calls.filter(([path]) => path.endsWith('/confirm')) as any[];
        expect(calls).toHaveLength(2); expect(JSON.parse(calls[0][1].body)).toEqual(JSON.parse(calls[1][1].body)); expect(result.current.proposal.result).toBeUndefined();
        request.mockImplementation(async () => ({ ...proposal(), status: 'COMMITTED', result: { id: 'receipt1', kind: 'BATCH_WRITEOFF', message: 'Retiro registrado', replayed: true } }));
        await act(() => result.current.recover()); expect(result.current.uncertain).toBe(false); expect(result.current.proposal.result.id).toBe('receipt1');
    });
    it('descarta respuesta de otro alcance y preserva correcciones si solamente se apaga ejecución', async () => {
        let resolve!: (value: unknown) => void; const request = vi.fn(() => new Promise(done => { resolve = done; }));
        const { result, rerender } = renderHook(({ scope }) => useAssistantOperations(request as any, scope, true, []), { initialProps: { scope: 'owner' } });
        let pending: Promise<void>; act(() => { pending = result.current.openProposal('a1'); }); rerender({ scope: 'warehouse' }); await act(async () => { resolve(proposal()); await pending; }); expect(result.current.proposal).toBeNull();
        const controller = { ...result.current, proposal: proposal(), draft: { ...proposal().draft, quantity: '7' }, dirty: true };
        render(<AssistantActionReview controller={controller} capabilities={{ ...caps, actionConfirm: false, executionEnabled: false }} request={request as any} />);
        expect(screen.getByLabelText('Cantidad que se retira')).toHaveValue('7'); expect(screen.getByRole('button', { name: 'Confirmar retiro de 3 unidades' })).toBeDisabled();
    });
    it('la vigencia promocional revisada usa Managua y no altera los instantes originales', async () => {
        const draft = { operation: 'PUBLISH', name: 'Oferta QA', percent: '5', productIds: ['p1'], startsAt: '2026-09-05T22:49:00.000Z', endsAt: '2026-10-05T22:50:00.000Z' };
        const prepared: AssistantActionProposalDTO = { ...proposal(), kind: 'PROMOTION', draft, preview: { summary: 'Oferta QA', lines: [{ startsAt: draft.startsAt, endsAt: draft.endsAt }], effects: [], warnings: [], confirmLabel: 'Publicar promoción' } };
        const request = vi.fn(async () => prepared); const { result } = renderHook(() => useAssistantOperations(request as any, 'session-promotion', true, [])); await act(() => result.current.openProposal('a1'));
        render(<AssistantActionReview controller={result.current} capabilities={caps} request={request as any} />);
        expect(screen.getByText('5/9/26, 16:49 · Managua')).toBeVisible(); expect(screen.getByText('5/10/26, 16:50 · Managua')).toBeVisible(); expect(result.current.draft).toEqual(draft); expect(request).toHaveBeenCalledTimes(1);
    });
});

describe('resumen diario y enlaces privados', () => {
    it('muestra hasta tres avisos y preparar envía una intención de conversación, sin ejecutar una acción', async () => {
        const messages: any[] = []; let dismissed: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, dailyBrief: true });
            const brief = { id: 'day1', localDay: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date()), items: [1, 2, 3, 4].map(n => ({ id: `i${n}`, title: `Revisión ${n}`, text: `Dato comprobado ${n}`, area: 'business', evidence: {} })), dismissedIds: dismissed };
            if (url.endsWith('/daily-brief')) return ok(brief);
            if (url.endsWith('/daily-brief/day1/dismiss')) { dismissed = [JSON.parse(String(init?.body)).itemId]; return ok({ ...brief, dismissedIds: dismissed }); }
            if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) { messages.push(JSON.parse(String(init?.body))); return ok({ id: 'm1', role: 'assistant', text: 'Primero voy a comprobar los datos.', createdAt: '2026-09-05' }); }
            throw new Error('No se permite ejecutar otra ruta');
        }));
        render(<MemoryRouter><NortexAssistantLauncher /></MemoryRouter>); fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' }));
        expect(await screen.findByText('Revisión 1')).toBeVisible(); expect(screen.queryByText('Revisión 4')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Preparar' })[0]).toBeEnabled()); fireEvent.click(screen.getAllByRole('button', { name: 'Preparar' })[0]); await screen.findByText('Primero voy a comprobar los datos.');
        expect(messages[0].text).toContain('Revisión 1'); expect(messages[0].text).toContain('verificá los datos');
        fireEvent.click(screen.getAllByRole('button', { name: 'Descartar por hoy' })[0]); await waitFor(() => expect(screen.queryByText('Revisión 1')).not.toBeInTheDocument());
    });
    it('recupera un enlace autenticado de conversación y extracción sin confirmar ni subir un documento', async () => {
        const calls: string[] = []; vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); if (url.endsWith('/capabilities')) return ok(caps); if (url.endsWith('/conversations/c-shared')) return ok({ id: 'c-shared', messages: [{ id: 'm1', role: 'assistant', text: 'Compra compartida por tu usuario', createdAt: '2026-09-05' }] }); if (url.endsWith('/extractions/j-shared')) return ok({ id: 'j-shared', status: 'PENDING' }); throw new Error('Ruta inesperada'); }));
        render(<MemoryRouter initialEntries={['/app/pos?assistantConversation=c-shared&assistantExtraction=j-shared']}><NortexAssistantLauncher /></MemoryRouter>);
        expect(await screen.findByText('Factura en espera para lectura.')).toBeVisible(); expect(calls.indexOf('/api/assistant/conversations/c-shared')).toBeLessThan(calls.indexOf('/api/assistant/extractions/j-shared')); expect(calls.some(url => url.endsWith('/confirm'))).toBe(false);
    });
    it('vincula WhatsApp sólo por solicitud y no persiste el código ni lo envía como mensaje', async () => {
        const code = 'abcdef012345abcdef012345'; const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); if (url.endsWith('/capabilities')) return ok({ ...caps, privateWhatsapp: true }); if (url.endsWith('/private-whatsapp/challenge')) return ok({ code, expiresAt: new Date(Date.now() + 600_000).toISOString(), instruction: 'Instrucción autorizada.' }); throw new Error('Ruta inesperada'); }));
        const writes = vi.spyOn(Storage.prototype, 'setItem'); render(<MemoryRouter><NortexAssistantLauncher /></MemoryRouter>); fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' }));
        fireEvent.click(await screen.findByText('Mi WhatsApp privado')); fireEvent.click(screen.getByRole('button', { name: 'Vincular mi WhatsApp' })); expect(await screen.findByText(`VINCULAR ${code}`)).toBeVisible(); expect(writes).not.toHaveBeenCalled(); expect(calls.some(url => url.endsWith('/messages'))).toBe(false);
    });
    it('cancelar usa la versión actual y un conflicto vuelve a leer progreso sin reiniciar el trabajo', async () => {
        const request = vi.fn(async (path: string) => { if (path.endsWith('/cancel')) throw Object.assign(new Error('advanced'), { status: 409 }); return { ...run, status: 'RUNNING', version: 3 }; });
        const { result } = renderHook(() => useAssistantOperations(request as any, 'session-c', true, ['run1'])); await waitFor(() => expect(result.current.runs.run1?.version).toBe(3)); await act(() => result.current.changeRun('run1', 'cancel'));
        const cancel = request.mock.calls.find(([path]) => path.endsWith('/cancel')) as any[]; expect(JSON.parse(cancel[1].body)).toEqual({ version: 3 }); expect(result.current.runs.run1.id).toBe('run1'); expect(result.current.runs.run1.version).toBe(3);
    });
});
