// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import userEvent from '@testing-library/user-event';
import POS from '../components/POS';
import { db } from '../lib/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NortexAssistantLauncher from '../components/assistant/NortexAssistantLauncher';
import { VentaEnCursoProvider, useReportarVenta, useVentaEnCurso } from '../components/VentaEnCursoContext';
import type { AssistantRunDTO } from '../shared/assistantOperations';
import { cashCloseInvestigationMessage } from '../shared/assistantCashCloseInvestigation';
import type { AssistantCapabilities, AssistantMessageDTO, AssistantProposalDTO } from '../shared/assistant';

const caps: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, extractionEnabled: true, executionEnabled: true, purchasePrepare: true, accessScope: 'OWNER' };
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
const denied = { ok: false, status: 403, json: async () => ({ error: 'Acceso no permitido' }) };
const ready = (): AssistantProposalDTO => ({ id: 'p1', version: 1, status: 'READY', attachmentIds: ['a1'], expiresAt: '2026-10-01T00:00:00Z', issues: [],
    draft: { currency: 'NIO', invoiceNumber: 'F-900', supplierId: 's1', supplierName: 'Proveedor QA', date: '2026-09-05', documentTotal: '115.00', receivedConfirmed: true, paymentConfirmed: true, paymentMethod: 'CASH', warnings: [], items: [{ productId: 'x1', description: 'Tornillo', quantity: '1', unitCost: '100', purchaseUnit: 'BASE' }] },
    preview: { supplierName: 'Proveedor QA', subtotal: '100', tax: '15', total: '115', stockEffect: 'INCREASE', cashOut: '115', payable: '0', cashShiftId: 'shift-qa', cashShiftLabel: 'Dueña QA · caja abierta', lines: [{ productId: 'x1', name: 'Tornillo', quantity: '1', purchaseUnit: 'BASE', baseQuantity: '1', unitCost: '100', lineTotal: '100' }], hash: 'preview' } });
let fetcher: ReturnType<typeof vi.fn>;
function mount() { return render(<MemoryRouter initialEntries={['/app/pos']}><NortexAssistantLauncher /></MemoryRouter>); }
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' })); return screen.findByRole('dialog', { name: 'NortexGPT' }); }
async function invoice() { await open(); fireEvent.click(screen.getByRole('tab', { name: 'Factura' })); }
async function sendMessage(text: string) { await waitFor(() => expect(screen.getByLabelText('Tu consulta')).toBeEnabled()); fireEvent.change(screen.getByLabelText('Tu consulta'), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' })); }
const captured = (): AssistantMessageDTO => ({ id: 'capture-1', role: 'assistant', text: 'Ya tengo las 50 bolsas de cemento. Adjuntá la factura o completamos por aquí.', createdAt: '2026-09-05T12:00:00Z',
    purchaseIntake: { id: 'intake-1', summary: '50 bolsas de cemento', phase: 'CHOOSE_INPUT', missing: ['supplierId', 'items.0.unitCost'] }, actions: [{ type: 'UPLOAD_INVOICE', label: 'Adjuntar foto o PDF' }, { type: 'CONTINUE_PURCHASE', label: 'Completar por aquí' }] });
function Route() { const location = useLocation(); const sale = useVentaEnCurso(); return <><output aria-label="Ruta">{location.pathname}</output><output aria-label="Carrito">{sale.lineas}:{sale.total}</output></>; }
function CurrentSale() { const report = useReportarVenta(); React.useEffect(() => report({ hayVenta: true, lineas: 3, total: 150 }), [report]); return <NortexAssistantLauncher />; }

beforeEach(() => {
    localStorage.clear(); localStorage.setItem('nortex_token', 'token-a'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fetcher = vi.fn(async (url: string) => {
        if (url.endsWith('/capabilities')) return ok(caps);
        if (url.includes('/catalog?')) return ok({ items: [] });
        if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
        if (url.endsWith('/messages')) return ok({ id: 'm1', role: 'assistant', text: 'Ventas no son utilidad.', createdAt: '2026-09-05T12:00:00Z', citations: [{ id: 'd1', title: 'Ayuda de Nortex', section: 'Ventas', version: '2026-09-05', path: 'help/sales' }], overview: { checkedAt: '2026-09-05T12:00:00Z', startDate: '2026-09-05', endDate: '2026-09-05', scope: 'Tu negocio', metrics: [{ key: 'expense', label: 'Gastos', value: null, status: 'unavailable', unit: 'money', source: 'Gastos registrados' }] } });
        if (url.endsWith('/attachments') || url.endsWith('/attachments/a1')) return ok({ id: 'a1', name: 'factura.png', mediaType: 'image/png', bytes: 100, pages: 1, status: 'AVAILABLE' });
        if (url.endsWith('/extractions')) return ok({ id: 'j1', status: 'PENDING' });
        if (url.endsWith('/extractions/j1')) return ok({ id: 'j1', status: 'SUCCEEDED', proposalId: 'p1' });
        if (url.endsWith('/proposals/p1')) return ok(ready());
        throw new Error(`Ruta inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function installCashReview(status: AssistantRunDTO['status'] = 'SUCCEEDED') {
    const base = fetcher.getMockImplementation() as (url: string, options?: RequestInit) => Promise<unknown>;
    const run: AssistantRunDTO = { id: 'run-cash', conversationId: 'c1', requestId: 'request-cash', status, version: 1, iterations: 0, steps: [], createdAt: '2026-09-09T15:00:00Z', updatedAt: '2026-09-09T15:00:00Z',
        result: { text: 'Cierre disponible para revisar.', degraded: true, actionProposalIds: [], evidence: [{ id: 'e1', tool: 'review_weekly_cash', label: 'Caja', data: {
            kind: 'WEEKLY_CASH_REVIEW', status: 'ok', checkedAt: '2026-09-09T15:00:00Z', scope: 'business', truncated: false,
            period: { startDate: '2026-09-02', endDate: '2026-09-08', cutoff: '2026-09-09T06:00:00Z', timeZone: 'America/Managua', completeDays: true },
            rows: [{ shiftId: 'shift-qa', status: 'BALANCED', closedAt: '2026-09-09T02:00:00Z', businessDate: '2026-09-08', folio: 'Z-QA', message: 'Reporte guardado.', source: { id: 'report-qa', version: 1, contentHash: 'a'.repeat(64), documentUrl: '/api/reports/shifts/shift-qa/document' }, cash: { expectedNio: '100.00', countedNio: '100.00', differenceNio: '0.00', expectedUsd: '0.0000', countedUsd: '0.0000', differenceUsd: '0.0000' } }],
            counts: { closed: 1, verified: 1, differences: 0, missingReports: 0, invalidReports: 0, open: 0 }, totals: { shortageNio: '0.00', surplusNio: '0.00', shortageUsd: '0.0000', surplusUsd: '0.0000' }, warnings: [], evidence: [],
        } }] } };
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/capabilities')) return ok({ ...caps, operations: true, cashReview: true });
        if (url.endsWith('/runs/run-cash')) return ok(run);
        if (url.endsWith('/messages') && JSON.parse(String(options?.body)).text === 'Revisar caja QA') return ok({ id: 'message-cash', role: 'assistant', text: 'Consulta de caja.', operationalRunId: 'run-cash', createdAt: '2026-09-09T15:00:00Z' });
        return base(url, options);
    });
}

describe('NortexGPT dentro del negocio', () => {
    it('investiga el cierre por el mismo chat y conserva borrador, carrito y ruta al cerrar y retomar', async () => {
        installCashReview();
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><CurrentSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await open(); await sendMessage('Revisar caja QA');
        const button = await screen.findByRole('button', { name: 'Investigar este cierre' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Tu consulta'), { target: { value: 'Mi siguiente consulta pendiente' } });
        fireEvent.click(button); await screen.findByText('Ventas no son utilidad.');
        const requests = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/messages'));
        expect(requests).toHaveLength(2);
        expect(requests[1][0]).toBe('/api/assistant/conversations/c1/messages');
        expect(JSON.parse(String(requests[1][1].body)).text).toBe(cashCloseInvestigationMessage('shift-qa', 'a'.repeat(64)));
        expect(screen.getByLabelText('Tu consulta')).toHaveValue('Mi siguiente consulta pendiente');
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' })); await open();
        expect(screen.getByLabelText('Tu consulta')).toHaveValue('Mi siguiente consulta pendiente');
        expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150'); expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos');
        expect(fetcher.mock.calls.some(([url]) => /\/confirm$|\/shifts\/close$|\/purchases$|\/document$/.test(String(url)))).toBe(false);
    });
    it.each(['PENDING', 'RUNNING'] as const)('bloquea investigar mientras la consulta está %s', async status => {
        installCashReview(status); mount(); await open(); await sendMessage('Revisar caja QA');
        const button = await screen.findByRole('button', { name: 'Investigar este cierre' }); expect(button).toBeDisabled(); fireEvent.click(button);
        expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(1);
    });
    it('bloquea investigar con una revisión de compra editada y conserva sus cambios', async () => {
        installCashReview(); mount(); await open(); await sendMessage('Revisar caja QA'); await screen.findByRole('button', { name: 'Investigar este cierre' });
        fireEvent.click(screen.getByRole('tab', { name: 'Factura' }));
        fireEvent.click(screen.getByText('Retomar una lectura o comprobar una compra'));
        fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' }));
        await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled()); fireEvent.change(screen.getByLabelText('Cantidad 1'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Consultar' }));
        const button = screen.getByRole('button', { name: 'Investigar este cierre' }); expect(button).toBeDisabled(); fireEvent.click(button);
        expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(1);
        fireEvent.click(screen.getByRole('tab', { name: 'Factura' })); expect(screen.getByLabelText('Cantidad 1')).toHaveValue('50');
    });
    it('bloquea un cierre anterior mientras otra consulta del chat sigue activa', async () => {
        installCashReview(); const base = fetcher.getMockImplementation() as (url: string, options?: RequestInit) => Promise<unknown>;
        fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/messages') && JSON.parse(String(options?.body)).text === 'Otra consulta') return ok({ id: 'm-active', role: 'assistant', text: 'Consulta pendiente.', operationalRunId: 'run-active', createdAt: '2026-09-09T15:00:00Z' });
            if (url.endsWith('/runs/run-active')) return ok({ id: 'run-active', conversationId: 'c1', requestId: 'request-active', status: 'RUNNING', version: 1, iterations: 0, steps: [], createdAt: '2026-09-09T15:00:00Z', updatedAt: '2026-09-09T15:00:00Z' });
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Revisar caja QA'); await screen.findByRole('button', { name: 'Investigar este cierre' });
        await sendMessage('Otra consulta'); await screen.findByText('NortexGPT está trabajando');
        expect(screen.getByRole('button', { name: 'Investigar este cierre' })).toBeDisabled();
    });
    it('bloquea investigar mientras se lee una factura sin abandonar el turno consultado', async () => {
        installCashReview(); mount(); await open(); await sendMessage('Revisar caja QA'); await screen.findByRole('button', { name: 'Investigar este cierre' });
        fireEvent.click(screen.getByRole('tab', { name: 'Factura' }));
        fireEvent.change(screen.getByLabelText('Adjuntar factura'), { target: { files: [new File(['synthetic'], 'qa.png', { type: 'image/png' })] } });
        await screen.findByText('Factura en espera para lectura.'); fireEvent.click(screen.getByRole('tab', { name: 'Consultar' }));
        expect(screen.getByRole('button', { name: 'Investigar este cierre' })).toBeDisabled();
        expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(1);
    });
    it('bloquea otra investigación después de una respuesta perdida conservando la identidad pendiente', async () => {
        installCashReview(); const base = fetcher.getMockImplementation() as (url: string, options?: RequestInit) => Promise<unknown>;
        fetcher.mockImplementation(async (url: string, options?: RequestInit) => { if (url.endsWith('/messages') && JSON.parse(String(options?.body)).text.startsWith('Investigá')) throw new Error('Respuesta perdida'); return base(url, options); });
        mount(); await open(); await sendMessage('Revisar caja QA'); fireEvent.click(await screen.findByRole('button', { name: 'Investigar este cierre' }));
        await screen.findByRole('button', { name: 'Reintentar mensaje pendiente' });
        const button = screen.getByRole('button', { name: 'Investigar este cierre' }); expect(button).toBeDisabled(); fireEvent.click(button);
        expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(2);
    });

    it('el acceso a revisión de caja envía la consulta y conserva carrito y ruta', async () => {
        const original = fetcher.getMockImplementation() as (url: string, options?: RequestInit) => Promise<unknown>;
        fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, operations: true, cashReview: true });
            return original(url, options);
        });
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><CurrentSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await open();
        fireEvent.click(screen.getByRole('button', { name: 'Revisar cierres de caja' }));
        await waitFor(() => expect(fetcher.mock.calls.some(([url, options]) => String(url).endsWith('/messages') && JSON.parse(String(options?.body)).text === 'Revisá mis cierres de caja de la última semana')).toBe(true));
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' }));
        expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150');
        expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos');
        expect(fetcher.mock.calls.some(([url]) => /\/confirm$|\/shifts\/close$|\/purchases$/.test(String(url)))).toBe(false);
    });
    it('sin permiso de caja oculta el acceso sugerido', async () => {
        mount(); await open();
        expect(screen.queryByRole('button', { name: 'Revisar cierres de caja' })).not.toBeInTheDocument();
    });
    it('solicitar presupuesto desde el panel conserva la venta y no registra una compra', async () => {
        const original = fetcher.getMockImplementation() as (url: string, options?: RequestInit) => Promise<unknown>;
        const budget = { month: '2026-09', limitUsd: '2.000000', spentUsd: '0.050000', reservedUsd: '0.000000', remainingUsd: '1.950000', blocked: false,
            platformAvailable: true, availabilityReason: null, canRequest: true, maxLimitUsd: '10', requests: [] };
        fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, budgetManage: true });
            if (url.endsWith('/budget')) return ok(budget);
            if (url.endsWith('/budget/requests')) {
                const input = JSON.parse(String(options?.body));
                return ok({ id: 'request-budget-qa', requestedUsd: input.requestedUsd, reason: input.reason, status: 'PENDING', createdAt: '2026-09-09T06:00:00Z', decidedAt: null, decisionReason: null });
            }
            return original!(url, options);
        });
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><CurrentSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await open();
        fireEvent.click(screen.getByText('Uso y presupuesto de NortexGPT'));
        await screen.findByText('US$ 1.95');
        fireEvent.change(screen.getByLabelText('Nuevo límite mensual en US$'), { target: { value: '5.00' } });
        fireEvent.change(screen.getByLabelText('Motivo del aumento'), { target: { value: 'Necesitamos revisar más productos del negocio.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar aumento a Nortex' }));
        await waitFor(() => expect(fetcher.mock.calls.filter(([url, options]) => String(url).endsWith('/budget/requests') && options?.method === 'POST')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' }));
        expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150');
        expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos');
        expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/confirm') || String(url).endsWith('/purchases'))).toBe(false);
    });
    it('conserva la captura y ofrece foto o texto al cerrar y retomar el panel', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? Promise.resolve(ok(captured())) : base(url, options));
        const persist = vi.spyOn(localStorage, 'setItem'); mount(); await open(); await sendMessage('Compré 50 bolsas de cemento');
        expect(await screen.findByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento');
        expect(screen.getByRole('button', { name: 'Adjuntar foto o PDF' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Completar por aquí' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await open();
        expect(screen.getByText('Compré 50 bolsas de cemento')).toBeVisible(); expect(screen.getByRole('button', { name: 'Completar por aquí' })).toBeEnabled();
        expect(screen.queryByText('supplierId')).not.toBeInTheDocument(); expect(screen.queryByText('items.0.unitCost')).not.toBeInTheDocument();
        expect(persist).not.toHaveBeenCalled(); expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/conversations'))).toHaveLength(1);
    });
    it('completa por conversación y sólo abre la revisión manual sin adjuntos ni confirmación en chat', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; const sent: Array<{ requestId: string; text: string }> = [];
        const manual = { ...ready(), source: 'MANUAL', attachmentIds: [] };
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, extractionEnabled: false, invoicePrepare: false });
            if (url.endsWith('/proposals/p1')) return ok(manual);
            if (url.endsWith('/messages')) {
                sent.push(JSON.parse(options.body));
                if (sent.length === 1) return ok(captured());
                if (sent.length === 2) return ok({ ...captured(), id: 'capture-2', text: '¿A quién se las compraste y cuánto costó cada bolsa?', purchaseIntake: { ...captured().purchaseIntake, phase: 'COLLECTING' }, actions: [] });
                return ok({ ...captured(), id: 'capture-3', text: 'La compra está preparada para revisar.', proposalId: 'p1', purchaseIntake: { ...captured().purchaseIntake, phase: 'REVIEW', summary: '50 bolsas de cemento de Proveedor QA', missing: [] }, actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra', proposalId: 'p1' }, { type: 'CONFIRM_PURCHASE', label: 'Ejecutar desde el chat' }] });
            }
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); await screen.findByRole('region', { name: 'Compra en preparación' });
        expect(screen.getByRole('button', { name: 'Adjuntar foto o PDF' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Completar por aquí' }));
        expect(await screen.findByText('¿A quién se las compraste y cuánto costó cada bolsa?')).toBeVisible();
        expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento');
        expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('Producto 1: Costo por unidad'); expect(screen.queryByText('items.0.unitCost')).not.toBeInTheDocument();
        await sendMessage('Proveedor QA, 100 córdobas por bolsa; estos son los demás datos reales de la factura.');
        fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' })); expect(await screen.findByRole('region', { name: 'Revisar compra' })).toBeVisible();
        expect(screen.getByLabelText('Total declarado')).toHaveValue('115.00'); expect(screen.queryByLabelText('Adjuntar factura')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ejecutar desde el chat' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: /Confirmar y registrar compra/ })).toBeDisabled();
        expect(sent.map(message => message.text)).toEqual(['Compré 50 bolsas de cemento', 'Completar por aquí', 'Proveedor QA, 100 córdobas por bolsa; estos son los demás datos reales de la factura.']);
        expect(new Set(sent.map(message => message.requestId)).size).toBe(3);
        expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/messages')).every(([url]) => url === '/api/assistant/conversations/c1/messages')).toBe(true);
        expect(fetcher.mock.calls.some(([url]) => /\/(attachments|extractions|confirm)(\/|$)/.test(url))).toBe(false);
    });
    it('adjunta a la misma conversación sin perder captura, ruta ni carrito', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? Promise.resolve(ok(captured())) : base(url, options));
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><CurrentSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Adjuntar foto o PDF' }));
        expect(screen.getByRole('tabpanel', { name: 'Factura' })).toHaveTextContent('50 bolsas de cemento');
        fireEvent.change(screen.getByLabelText('Adjuntar factura'), { target: { files: [new File(['synthetic'], 'cemento.pdf', { type: 'application/pdf' })] } });
        await screen.findByText('Factura en espera para lectura.'); const enqueue = fetcher.mock.calls.find(([url]) => url.endsWith('/extractions'))!;
        expect(JSON.parse(enqueue[1].body)).toEqual({ attachmentIds: ['a1'], conversationId: 'c1' });
        fireEvent.click(screen.getByRole('button', { name: 'Volver a la conversación' })); expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento');
        expect(screen.getByLabelText('Tu consulta')).toBeDisabled(); expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos'); expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150');
    });
    it('recupera la captura durable aunque no esté en los últimos mensajes y acepta el cierre explícito', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => {
            if (url.endsWith('/conversations/c-recovered')) return Promise.resolve(ok({ id: 'c-recovered', messages: [], purchaseIntake: captured().purchaseIntake, actions: captured().actions }));
            if (url.endsWith('/messages')) return Promise.resolve(ok({ id: 'closed', role: 'assistant', text: 'La captura se canceló sin registrar compras.', createdAt: '2026-09-05T12:01:00Z', purchaseIntake: null, actions: [] }));
            return base(url, options);
        });
        mount(); await open(); fireEvent.change(screen.getByLabelText('Referencia de conversación'), { target: { value: 'c-recovered' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar conversación' }));
        expect(await screen.findByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento');
        await sendMessage('Cancelar esta captura'); await screen.findByText('La captura se canceló sin registrar compras.'); expect(screen.queryByRole('region', { name: 'Compra en preparación' })).not.toBeInTheDocument();
        expect(fetcher.mock.calls.some(([url]) => url === '/api/assistant/conversations/c-recovered/messages')).toBe(true);
    });
    it('reintenta el mismo mensaje sin duplicar el texto ni reiniciar la captura', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; const sent: any[] = [];
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/messages')) { sent.push(JSON.parse(options.body)); if (sent.length === 1) return ok(captured()); if (sent.length === 2) throw new Error('Respuesta perdida'); return ok({ ...captured(), id: 'continue', text: 'Seguimos con las 50 bolsas. Falta el proveedor.', actions: [] }); }
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Completar por aquí' }));
        await screen.findByRole('button', { name: 'Reintentar mensaje pendiente' });
        fireEvent.change(screen.getByLabelText('Referencia de conversación'), { target: { value: 'c1' } }); expect(screen.getByRole('button', { name: 'Consultar conversación' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar mensaje pendiente' })); await screen.findByText('Seguimos con las 50 bolsas. Falta el proveedor.');
        expect(sent[1]).toEqual(sent[2]); expect(screen.getAllByText('Completar por aquí', { selector: 'p' })).toHaveLength(1);
        expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento'); expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/conversations'))).toHaveLength(1);
    });
    it('volver desde el chat a una revisión corregida conserva los cambios sin recargarla', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? Promise.resolve(ok({ ...captured(), actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra', proposalId: 'p1' }] })) : base(url, options));
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Cantidad 1'), { target: { value: '50' } }); fireEvent.click(screen.getByRole('tab', { name: 'Consultar' }));
        expect(screen.getByLabelText('Tu consulta')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Consultar conversación' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Revisar compra' })); expect(screen.getByLabelText('Cantidad 1')).toHaveValue('50');
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/proposals/p1'))).toHaveLength(1);
    });
    it('una nueva factura después del comprobante no reutiliza los datos de la captura anterior', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => {
            if (url.endsWith('/messages')) return Promise.resolve(ok({ ...captured(), proposalId: 'p1', actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra' }] }));
            if (url.endsWith('/proposals/p1')) return Promise.resolve(ok({ ...ready(), status: 'COMMITTED', result: { id: 'operation-old', proposalId: 'p1', purchaseId: 'purchase-old', message: 'Compra previa registrada.', replayed: true } }));
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' }));
        await screen.findByRole('region', { name: 'Comprobante de compra' }); await waitFor(() => expect(screen.getByRole('button', { name: 'Leer otra factura' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Leer otra factura' }));
        expect(screen.getByRole('tabpanel', { name: 'Factura' })).not.toHaveTextContent('50 bolsas de cemento');
        fireEvent.change(screen.getByLabelText('Adjuntar factura'), { target: { files: [new File(['synthetic'], 'factura-nueva.pdf', { type: 'application/pdf' })] } }); await screen.findByText('Factura en espera para lectura.');
        expect(JSON.parse(fetcher.mock.calls.find(([url]) => url.endsWith('/extractions'))![1].body)).toEqual({ attachmentIds: ['a1'] });
    });
    it('el cierre explícito de la captura quita su propuesta pendiente de la revisión', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; let count = 0;
        fetcher.mockImplementation((url, options) => {
            if (url.endsWith('/messages')) return Promise.resolve(ok(++count === 1 ? { ...captured(), proposalId: 'p1', actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra' }] } : { id: 'cancelled', role: 'assistant', text: 'La captura se canceló.', createdAt: '2026-09-05T12:05:00Z', purchaseIntake: null }));
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.click(screen.getByRole('tab', { name: 'Consultar' })); await sendMessage('Cancelar captura'); await screen.findByText('La captura se canceló.');
        expect(screen.queryByRole('region', { name: 'Compra en preparación' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Factura' })); expect(screen.queryByRole('region', { name: 'Revisar factura' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    });
    it('calcula un borrador manual a crédito intacto sin declarar un pago en efectivo', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; const original = ready();
        const proposal: AssistantProposalDTO = { ...original, source: 'MANUAL', status: 'DRAFT', attachmentIds: [], preview: null, draft: { ...original.draft, paymentMethod: 'CREDIT', paymentConfirmed: false, dueDate: '2026-10-05' } };
        let saved: unknown;
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/messages')) return ok({ ...captured(), proposalId: 'p1', actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra' }] });
            if (url.endsWith('/proposals/p1') && options?.method === 'PATCH') { saved = JSON.parse(options.body); return ok({ ...proposal, version: 2, status: 'READY', preview: { ...original.preview, cashOut: '0', payable: '115' } }); }
            if (url.endsWith('/proposals/p1')) return ok(proposal);
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' }));
        const save = await screen.findByRole('button', { name: 'Guardar revisión y calcular efectos' }); await waitFor(() => expect(save).toBeEnabled());
        expect(screen.queryByRole('checkbox', { name: /pago en efectivo/ })).not.toBeInTheDocument();
        fireEvent.click(save); await screen.findByRole('region', { name: 'Efectos de la compra' });
        expect(saved).toEqual({ version: 1, draft: proposal.draft }); expect(screen.getByRole('region', { name: 'Efectos de la compra' })).toHaveTextContent('Cuenta por pagar');
        expect(screen.getByRole('button', { name: /Confirmar y registrar compra/ })).toBeDisabled(); expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    });
    it('recuperar otra captura no mezcla una propuesta previa ya guardada con la factura nueva', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/conversations/c-new') ? Promise.resolve(ok({ id: 'c-new', messages: [], purchaseIntake: captured().purchaseIntake, actions: captured().actions })) : base(url, options));
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.click(screen.getByRole('tab', { name: 'Consultar' })); fireEvent.change(screen.getByLabelText('Referencia de conversación'), { target: { value: 'c-new' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar conversación' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Adjuntar foto o PDF' })); expect(screen.getByLabelText('Adjuntar factura')).toBeEnabled();
        expect(screen.queryByLabelText('Cantidad 1')).not.toBeInTheDocument(); expect(screen.getByRole('tabpanel', { name: 'Factura' })).toHaveTextContent('50 bolsas de cemento');
    });
    it('una propuesta no disponible mantiene la conversación y nunca muestra un registro exitoso', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => {
            if (url.endsWith('/messages')) return Promise.resolve(ok({ ...captured(), proposalId: 'p1', actions: [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra' }] }));
            if (url.endsWith('/proposals/p1')) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'No pudimos recuperar la revisión.' }) });
            return base(url, options);
        });
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); fireEvent.click(await screen.findByRole('button', { name: 'Revisar compra' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos recuperar la revisión.'); expect(screen.getByRole('tabpanel', { name: 'Consultar' })).toBeVisible();
        expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento'); expect(screen.queryByRole('region', { name: 'Comprobante de compra' })).not.toBeInTheDocument();
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    });
    it('revocar preparación bloquea las acciones y revocar lectura descarta la captura privada', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? Promise.resolve(ok(captured())) : base(url, options));
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); await screen.findByRole('region', { name: 'Compra en preparación' });
        fetcher.mockImplementation((url, options) => url.endsWith('/capabilities') ? Promise.resolve(ok({ ...caps, purchasePrepare: false, invoicePrepare: false, invoiceConfirm: false })) : base(url, options));
        fireEvent(window, new Event('nortex:data-changed')); await waitFor(() => expect(screen.getByRole('button', { name: 'Completar por aquí' })).toBeDisabled()); expect(screen.getByRole('button', { name: 'Adjuntar foto o PDF' })).toBeDisabled();
        expect(screen.getByRole('region', { name: 'Compra en preparación' })).toHaveTextContent('50 bolsas de cemento');
        fetcher.mockImplementation((url, options) => url.endsWith('/capabilities') ? Promise.resolve(ok({ ...caps, purchasePrepare: false, invoiceRead: false, invoicePrepare: false, invoiceConfirm: false })) : base(url, options));
        fireEvent(window, new Event('nortex:data-changed')); await waitFor(() => expect(screen.queryByRole('region', { name: 'Compra en preparación' })).not.toBeInTheDocument());
        expect(screen.queryByText('Compré 50 bolsas de cemento')).not.toBeInTheDocument(); expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/messages'))).toHaveLength(1);
    });
    it('un cambio de rol con las mismas capacidades descarta datos anteriores y respuestas pendientes', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? Promise.resolve(ok(captured())) : base(url, options));
        mount(); await open(); await sendMessage('Compré 50 bolsas de cemento'); await screen.findByRole('region', { name: 'Compra en preparación' });
        let finish!: (value: unknown) => void; const pending = new Promise(resolve => { finish = resolve; });
        fetcher.mockImplementation((url, options) => url.endsWith('/capabilities') ? Promise.resolve(ok({ ...caps, accessScope: 'MANAGER' })) : url.endsWith('/messages') ? pending : base(url, options));
        await sendMessage('Mostrame los gastos privados'); await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/messages'))).toHaveLength(2));
        fireEvent(window, new Event('nortex:data-changed'));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Compra en preparación' })).not.toBeInTheDocument());
        await act(async () => { finish(ok({ ...captured(), id: 'old-scope', text: 'Gastos privados del dueño anterior' })); });
        expect(screen.queryByText('Gastos privados del dueño anterior')).not.toBeInTheDocument(); expect(screen.queryByText('Compré 50 bolsas de cemento')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Tu consulta')).toBeEnabled(); expect(screen.queryByRole('button', { name: 'Reintentar mensaje pendiente' })).not.toBeInTheDocument();
    });
    it('oculta el acceso cuando el piloto está desactivado o no puede comprobarse', async () => {
        fetcher.mockResolvedValue(ok({ ...caps, enabled: false })); const view = mount();
        await waitFor(() => expect(fetcher).toHaveBeenCalled()); expect(screen.queryByRole('button', { name: 'Abrir NortexGPT' })).not.toBeInTheDocument();
        view.unmount(); fetcher.mockRejectedValue(new Error('offline')); mount();
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); expect(screen.queryByRole('button', { name: 'Abrir NortexGPT' })).not.toBeInTheDocument();
    });
    it('publica fuentes, período y ausencia de información sin convertirla en cero', async () => {
        mount(); await open(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' }));
        expect(await screen.findByText('Ventas no son utilidad.')).toBeVisible(); expect(screen.getByText('No disponible')).toBeVisible();
        expect(screen.getByText(/Fuente: Gastos registrados/)).toBeVisible(); expect(screen.getByText(/Ayuda de Nortex · Ventas · Versión 2026-09-05/)).toBeVisible();
        expect(screen.getByText(/Período: 2026-09-05 al 2026-09-05/)).toBeVisible(); expect(screen.queryByText('C$ 0.00')).not.toBeInTheDocument();
        const messageCall = fetcher.mock.calls.find(([url]) => url.endsWith('/messages'));
        expect(JSON.parse(messageCall![1].body)).toEqual({ requestId: expect.any(String), text: '¿Cómo va mi negocio hoy?' });
        expect(messageCall![1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer token-a' } });
    });
    it('mantiene la conversación al cerrar y nunca guarda texto en almacenamiento local', async () => {
        const persist = vi.spyOn(localStorage, 'setItem');
        mount(); await open(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' })); await screen.findByText('Ventas no son utilidad.');
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await open();
        expect(screen.getByText('Ventas no son utilidad.')).toBeVisible(); expect(persist).not.toHaveBeenCalled();
    });
    it('todo rol puede abrir su ayuda y quien no lee costos no recibe controles de factura', async () => {
        fetcher.mockImplementation(async () => ok({ ...caps, overview: false, invoiceRead: false, invoicePrepare: false, invoiceConfirm: false }));
        mount(); await invoice(); expect(screen.getByText(/Tu rol no tiene acceso a facturas y costos/)).toBeVisible();
        expect(screen.queryByLabelText('Adjuntar factura')).not.toBeInTheDocument(); expect(fetcher.mock.calls.every(([url]) => url.endsWith('/capabilities'))).toBe(true);
    });
    it('abrir Compras conserva carrito y ruta cuando existe una venta', async () => {
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><CurrentSale /><Route /></VentaEnCursoProvider></MemoryRouter>);
        await invoice(); expect(document.querySelector('[data-operational-alerts]')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Abrir Compras' }));
        expect(screen.getByRole('heading', { name: 'Tenés una venta abierta' })).toHaveFocus(); expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos'); expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150');
        fireEvent.click(screen.getByRole('button', { name: 'Seguir vendiendo' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByLabelText('Carrito')).toHaveTextContent('3:150'); expect(document.querySelector('[data-operational-alerts]')).toBeNull();
    });
    it('descarta la respuesta de otra sesión y desmonta su historial', async () => {
        let finish!: (value: unknown) => void; const deferred = new Promise(resolve => { finish = resolve; });
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; fetcher.mockImplementation((url, options) => url.endsWith('/messages') ? deferred : base(url, options));
        mount(); await open(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' })); await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(true));
        localStorage.setItem('nortex_token', 'token-b'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u2', tenant: { id: 't2' } })); fireEvent(window, new Event('storage'));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        finish(ok({ id: 'private', role: 'assistant', text: 'Dato privado del negocio anterior', createdAt: '2026-09-05T12:00:00Z' })); await open();
        expect(screen.queryByText('Dato privado del negocio anterior')).not.toBeInTheDocument(); expect(screen.queryByText('¿Cómo va mi negocio hoy?', { selector: 'p' })).not.toBeInTheDocument();
    });
    it('revocar el acceso oculta datos previos y explica la comprobación fallida', async () => {
        mount(); await open(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' })); await screen.findByText('Ventas no son utilidad.');
        fetcher.mockResolvedValue(denied); fireEvent(window, new Event('nortex:data-changed'));
        expect(await screen.findByText(/No pudimos comprobar tu acceso/)).toBeVisible(); expect(screen.queryByText('Ventas no son utilidad.')).not.toBeInTheDocument();
    });
    it('lee documentos en segundo plano y nunca registra automáticamente', async () => {
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Adjuntar factura'), { target: { files: [new File(['synthetic'], 'factura.png', { type: 'image/png' })] } });
        expect(await screen.findByText('Factura en espera para lectura.')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Comprobar lectura' }));
        expect(await screen.findByRole('region', { name: 'Revisar factura' })).toBeVisible(); expect(screen.getByRole('button', { name: /Confirmar y registrar compra/ })).toBeDisabled();
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
        const upload = fetcher.mock.calls.find(([url]) => url.endsWith('/attachments'))!; expect(upload[1].body).toBeInstanceOf(File); expect(upload[1].headers['X-File-Name']).toBe('factura.png'); expect(upload[1].headers['Content-Type']).toBe('image/png');
    });
    it.each([
        ['BUDGET_EXHAUSTED', 'La lectura alcanzó el presupuesto disponible de IA.'],
        ['PROVIDER_UNAVAILABLE', 'El servicio de lectura no está disponible ahora.'],
        ['SQL_INTERNAL_PASSWORD', 'No pudimos completar la lectura.'],
        ['DOCUMENT_CONTEXT_CHANGED', 'La compra que declaraste cambió o se canceló.'],
        ['DOCUMENT_CONTEXT_INVALID', 'No pudimos verificar la captura de esta compra.'],
        ['DOCUMENT_CONTEXT_LIMIT', 'Hay demasiadas diferencias entre la factura y lo declarado.'],
        ['INTAKE_CHANGED', 'La compra cambió en otra revisión.'],
    ])('traduce el fallo de lectura %s sin exponer detalles internos', async (code, message) => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/extractions/j1') ? Promise.resolve(ok({ id: 'j1', status: 'FAILED', error: code })) : base(url, options));
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Adjuntar factura'), { target: { files: [new File(['synthetic'], 'factura.png', { type: 'image/png' })] } });
        await screen.findByText('Factura en espera para lectura.'); fireEvent.click(screen.getByRole('button', { name: 'Comprobar lectura' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(message); expect(screen.queryByText(code)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Abrir Compras' })).toBeEnabled();
    });
    it('al perder respuesta consulta la misma operación y sólo muestra evidencia persistida', async () => {
        let confirmKey = ''; const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/confirm')) { confirmKey = JSON.parse(options.body).idempotencyKey; throw new Error('Timeout'); }
            if (url.includes('/operations/')) return ok({ id: confirmKey, proposalId: 'p1', purchaseId: 'purchase-verified', message: 'La compra está registrada.', replayed: true });
            return base(url, options);
        });
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' }));
        await screen.findByRole('region', { name: 'Revisar factura' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: /Revisé el documento/ })).toBeEnabled()); fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el documento/ })); fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        expect(await screen.findByRole('region', { name: 'Comprobante de compra' })).toHaveTextContent('purchase-verified');
        expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1); expect(fetcher.mock.calls.some(([url]) => url === `/api/assistant/operations/${confirmKey}`)).toBe(true);
    });
    it('un rechazo definitivo permite corregir sin afirmar éxito ni crear otro registro', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        let finishEvidence!: (response: unknown) => void;
        const evidence = new Promise(resolve => { finishEvidence = resolve; });
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/confirm')) return { ok: false, status: 423, json: async () => ({ error: 'El período contable está cerrado.' }) };
            if (url.includes('/operations/')) return evidence;
            return base(url, options);
        });
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el documento/ })); fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('/operations/'))).toBe(true));
        expect(screen.getByLabelText('Fecha contable')).toBeDisabled();
        expect(screen.queryByRole('region', { name: 'Comprobante de compra' })).not.toBeInTheDocument();
        await act(async () => { finishEvidence({ ok: false, status: 404, json: async () => ({ error: 'Sin evidencia disponible' }) }); });
        expect(await screen.findByRole('alert')).toHaveTextContent('El período contable está cerrado.');
        // El mensaje HTTP puede aparecer antes del efecto que restablece el editor. Esperar la condición de uso.
        await waitFor(() => {
            expect(screen.getByLabelText('Fecha contable')).toBeEnabled();
            expect(screen.getByRole('checkbox', { name: /Revisé el documento/ })).not.toBeChecked();
        });
        expect(screen.queryByRole('region', { name: 'Comprobante de compra' })).not.toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Fecha contable'), { target: { value: '2026-09-06' } }); expect(screen.getByText(/Cambiaste la factura/)).toBeVisible();
        expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1);
    });
    it('una confirmación incierta sigue sin comprobante y conserva key en el reintento', async () => {
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; const keys: string[] = [];
        fetcher.mockImplementation(async (url, options) => {
            if (url.endsWith('/confirm')) { keys.push(JSON.parse(options.body).idempotencyKey); throw new Error('Timeout'); }
            if (url.includes('/operations/')) return { ok: false, status: 404, json: async () => ({ error: 'Sin evidencia disponible' }) };
            return base(url, options);
        });
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' })); await screen.findByRole('region', { name: 'Revisar factura' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: /Revisé el documento/ })).toBeEnabled());
        fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el documento/ })); fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Comprobá el resultado/); expect(screen.queryByRole('region', { name: 'Comprobante de compra' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación con la misma referencia' })); await waitFor(() => expect(keys).toHaveLength(2)); expect(keys[0]).toBe(keys[1]);
    });
    it('bloquea lector y atajos del POS real y restaura su venta al cerrar NortexGPT', async () => {
        await db.offline_sales.clear();
        localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 't1', businessName: 'Ferretería QA', type: 'FERRETERIA' }));
        localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', name: 'Dueña QA', role: 'OWNER', tenant: { id: 't1' } }));
        localStorage.setItem('token', 'token-a');
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation(async (url, options) => {
            if (url.startsWith('/api/assistant')) return base(url, options);
            const path = new URL(url, 'http://test').pathname;
            const product = { id: 'x1', name: 'Tornillo QA', sku: 'TOR-1', price: 25, cost: 10, stock: 20, category: 'General', unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1, minStock: 5 };
            const responses: Record<string, unknown> = {
                '/api/products': [product], '/api/customers': [], '/api/shifts/current': { id: 'shift-a', status: 'OPEN', initialCash: '500', userId: 'u1', startTime: '2026-09-04T12:00:00Z', esTurnoPropio: true, turnoDe: null },
                '/api/cash-movements': [], '/api/cash-movements/balance': { efectivo: 500, efectivoNIO: 500 }, '/api/tenant/inventory-settings': { allowNegativeStock: false }, '/api/agent-banking/agreements': [], '/api/operational-alerts': { checkedAt: '2026-09-05T12:00:00Z', sections: [] },
            };
            return ok(responses[path] ?? {});
        });
        const user = userEvent.setup();
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><POS /><NortexAssistantLauncher /></VentaEnCursoProvider></MemoryRouter>);
        await user.type(await screen.findByPlaceholderText('Escaneá o buscá un producto'), 'TOR-1{Enter}');
        const quantity = screen.getByRole('textbox', { name: 'Cantidad de Tornillo QA en unidad' }); expect(quantity).toHaveValue('1');
        await open(); const close = screen.getByRole('button', { name: 'Cerrar NortexGPT' }); await waitFor(() => expect(close).toHaveFocus());
        await user.keyboard('{F9}{F4}TOR-1'); expect(quantity).toHaveValue('1'); expect(screen.queryByRole('textbox', { name: /Efectivo recibido en córdobas/ })).not.toBeInTheDocument();
        await user.click(close); await waitFor(() => expect(screen.queryByRole('dialog', { name: 'NortexGPT' })).not.toBeInTheDocument());
        screen.getByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/ }).focus(); await user.keyboard('TOR-1{Enter}');
        await waitFor(() => expect(quantity).toHaveValue('2')); expect(fetcher.mock.calls.some(([url]) => url === '/api/sales')).toBe(false);
    });
    it('una falla transitoria de acceso oculta datos y conserva la corrección hasta reconectar', async () => {
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Cantidad 1'), { target: { value: '7' } });
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation(async (url, options) => { if (url.endsWith('/capabilities')) throw new Error('Temporary offline'); return base(url, options); });
        fireEvent(window, new Event('nortex:data-changed')); expect(await screen.findByText(/No pudimos comprobar tu acceso/)).toBeVisible(); expect(screen.queryByLabelText('Cantidad 1')).not.toBeInTheDocument();
        fetcher.mockImplementation(base); fireEvent.click(screen.getByRole('button', { name: 'Comprobar acceso' }));
        expect(await screen.findByLabelText('Cantidad 1')).toHaveValue('7'); expect(screen.getByText(/Cambiaste la factura/)).toBeVisible();
    });
    it('apagar la ejecución conserva correcciones y bloquea una nueva confirmación', async () => {
        mount(); await invoice(); fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'p1' } }); fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia' })); await waitFor(() => expect(screen.getByLabelText('Cantidad 1')).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Cantidad 1'), { target: { value: '7' } });
        const base = fetcher.getMockImplementation() as (...args: any[]) => any;
        fetcher.mockImplementation((url, options) => url.endsWith('/capabilities') ? Promise.resolve(ok({ ...caps, executionEnabled: false, invoiceConfirm: false })) : base(url, options));
        fireEvent(window, new Event('nortex:data-changed'));
        expect(await screen.findByText('El registro desde NortexGPT está desactivado.')).toBeVisible(); expect(screen.getByLabelText('Cantidad 1')).toHaveValue('7');
        expect(screen.getByText(/Cambiaste la factura/)).toBeVisible(); expect(screen.getByRole('button', { name: 'Guardar revisión y calcular efectos' })).toBeEnabled(); expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    });
    it('descarta capacidad vieja y consulta pendiente después de revocar permisos', async () => {
        mount(); await open();
        let finishCaps!: (value: unknown) => void; let finishMessage!: (value: unknown) => void;
        const lateCaps = new Promise(resolve => { finishCaps = resolve; }); const lateMessage = new Promise(resolve => { finishMessage = resolve; });
        const base = fetcher.getMockImplementation() as (...args: any[]) => any; let capCalls = 0;
        fetcher.mockImplementation((url, options) => {
            if (url.endsWith('/messages')) return lateMessage;
            if (url.endsWith('/capabilities')) return ++capCalls === 1 ? lateCaps : Promise.resolve(ok({ ...caps, overview: false, inventory: false, invoiceRead: false, invoicePrepare: false, invoiceConfirm: false }));
            return base(url, options);
        });
        fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' })); await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(true));
        fireEvent(window, new Event('nortex:data-changed')); fireEvent(window, new Event('nortex:data-changed'));
        await waitFor(() => expect(screen.queryByRole('button', { name: '¿Cómo va mi negocio hoy?' })).not.toBeInTheDocument());
        finishCaps(ok(caps)); finishMessage(ok({ id: 'late', role: 'assistant', text: 'Saldo confidencial', createdAt: '2026-09-05T12:00:00Z' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Factura' })); expect(await screen.findByText(/Tu rol no tiene acceso a facturas/)).toBeVisible(); expect(screen.queryByText('Saldo confidencial')).not.toBeInTheDocument();
    });
    it('sin conexión rechaza la consulta sin prometer cifras o ejecutar pedidos', async () => {
        mount(); await open(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); fireEvent.click(screen.getByRole('button', { name: '¿Cómo va mi negocio hoy?' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Sin internet/); expect(fetcher.mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(false);
    });
});
