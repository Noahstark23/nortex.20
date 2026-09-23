// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import NortexAssistantLauncher from '../components/assistant/NortexAssistantLauncher';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantKnowledgeContext, AssistantKnowledgeSource, assistantKnowledgePath } from '../components/assistant/AssistantKnowledgeSource';
import { AssistantOperationalEvidence } from '../components/assistant/AssistantOperationalEvidence';
import { useAssistantKnowledge, hideRunKnowledge } from '../hooks/useAssistantKnowledge';
import { useAssistantOperations } from '../hooks/useAssistantOperations';
import { useNortexAssistant } from '../hooks/useNortexAssistant';
import type { AssistantRequest } from '../hooks/useNortexAssistant';
import type { AssistantCitation, AssistantCapabilities } from '../shared/assistant';
import type { AssistantKnowledgePassage } from '../shared/assistantKnowledge';
import type { AssistantActionProposalDTO, AssistantRunDTO } from '../shared/assistantOperations';
const citation: AssistantCitation = { id: 'compras', title: 'Compras', section: 'Registrar', version: '2026-09-05.1', path: 'https://foreign.invalid/secret', sectionId: 'main', contentHash: 'a'.repeat(64) };
const passage: AssistantKnowledgePassage = { reference: { documentId: citation.id, sectionId: 'main', version: citation.version, contentHash: citation.contentHash! }, title: 'Compras', section: 'Registrar', body: 'Pasaje exacto autorizado.', publication: 'LEGACY', historical: true, revision: 'r1' };
const run: AssistantRunDTO = { id: 'run1', conversationId: 'c1', requestId: 'rq1', status: 'SUCCEEDED', version: 1, iterations: 1, steps: [], createdAt: '2026-09-19', updatedAt: '2026-09-19', result: { text: 'Explicación derivada.', evidence: [{ id: 'e1', tool: 'search_help', label: 'Ayuda', data: { text: 'Ayuda histórica', citations: [{ ...citation }] } }], actionProposalIds: [], degraded: false, knowledgeReferences: [passage.reference] } };
const proposal: AssistantActionProposalDTO = { id: 'p1', kind: 'BATCH_WRITEOFF', version: 1, status: 'DRAFT', expiresAt: '2026-10-01', issues: [], draft: { quantity: '3' }, preview: null };
const caps: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, extractionEnabled: false, executionEnabled: false, accessScope: 'OWNER', operations: true };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
const context = (request: AssistantRequest, extra = {}) => ({ request, scope: 'u1:t1', revision: 'r1', available: true, epoch: 1, invalidate: vi.fn(), ...extra });

describe('pasaje autenticado y retiro en UI', () => {
    it('construye únicamente la ruta documental y abre el pasaje exacto, sin navegar al path de la cita', async () => {
        const request = vi.fn(async () => passage);
        render(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest)}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' }));
        expect(await screen.findByText(passage.body)).toBeVisible();
        expect(request).toHaveBeenCalledWith('/knowledge/documents/compras/versions/2026-09-05.1/sections/main?contentHash=' + citation.contentHash);
        expect(screen.getByText(/Ayuda heredada · Versión histórica/)).toBeVisible(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(assistantKnowledgePath({ ...citation, id: 'a/b', contentHash: undefined, sectionId: undefined })).toContain('a%2Fb/versions/2026-09-05.1/sections/main');
    });
    it('reabrir una fuente espera una lectura nueva y no muestra su copia anterior', async () => {
        let finish!: (value: AssistantKnowledgePassage) => void;
        const request = vi.fn(async () => passage); const invalidate = vi.fn();
        render(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest, { invalidate })}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' })); await screen.findByText(passage.body);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar fuente' }));
        request.mockImplementationOnce(() => new Promise(done => { finish = done; }));
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' }));
        expect(screen.queryByText(passage.body)).not.toBeInTheDocument(); expect(screen.getByText('Comprobando la fuente…')).toBeVisible();
        await act(async () => { finish({ ...passage, revision: 'withdrawn' }); });
        expect(invalidate).toHaveBeenCalled(); expect(screen.queryByText(passage.body)).not.toBeInTheDocument();
    });
    it('usa el mismo lector desde la evidencia del orquestador', async () => {
        const request = vi.fn(async () => passage);
        render(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest)}><AssistantOperationalEvidence evidence={run.result!.evidence[0]} /></AssistantKnowledgeContext.Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' })); expect(await screen.findByText(passage.body)).toBeVisible();
    });
    it('un cambio de sesión retira el cuerpo y una respuesta tardía no lo repuebla', async () => {
        let resolve!: (value: AssistantKnowledgePassage) => void;
        const request = vi.fn(() => new Promise<AssistantKnowledgePassage>(done => { resolve = done; }));
        const { rerender } = render(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest)}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' }));
        rerender(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest, { scope: 'u2:t2', available: false, epoch: 2 })}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        await act(async () => { resolve(passage); }); expect(screen.queryByText(passage.body)).not.toBeInTheDocument(); expect(screen.queryByText(/Compras · Registrar/)).not.toBeInTheDocument();
    });
    it('retiro o error no reutiliza el cuerpo anterior; un hash distinto se rechaza', async () => {
        const invalidate = vi.fn(); const request = vi.fn(async () => passage);
        const { rerender } = render(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest, { invalidate })}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver fuente' })); await screen.findByText(passage.body);
        request.mockRejectedValueOnce(new Error('retired'));
        rerender(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest, { revision: 'r2', epoch: 2, invalidate })}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        expect(screen.queryByText(passage.body)).not.toBeInTheDocument(); await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
        request.mockResolvedValueOnce({ ...passage, revision: 'r3', reference: { ...passage.reference, contentHash: 'b'.repeat(64) } });
        rerender(<AssistantKnowledgeContext.Provider value={context(request as AssistantRequest, { revision: 'r3', epoch: 3, invalidate })}><AssistantKnowledgeSource citation={citation} /></AssistantKnowledgeContext.Provider>);
        await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2)); expect(screen.queryByText(passage.body)).not.toBeInTheDocument();
    });
    it('consulta vigencia sin IA, refresca una vez por revisión y oculta ayuda al fallar la consulta', async () => {
        const request = vi.fn(async (_path: string) => ({ revision: 'r1', available: true })); const refresh = vi.fn(async () => undefined);
        const { result } = renderHook(() => useAssistantKnowledge(request as AssistantRequest, 's1', true, refresh));
        await waitFor(() => expect(result.current.available).toBe(true)); expect(refresh).toHaveBeenCalledTimes(1);
        await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); }); expect(refresh).toHaveBeenCalledTimes(1);
        request.mockResolvedValueOnce({ revision: 'r2', available: true });
        await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); }); expect(refresh).toHaveBeenCalledTimes(2); expect(result.current.revision).toBe('r2');
        request.mockRejectedValueOnce(new Error('unavailable'));
        await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); }); expect(result.current.available).toBe(false);
        expect(request.mock.calls.every(call => call[0] === '/knowledge/revision')).toBe(true);
    });
    it('una respuesta de vigencia en vuelo no muestra fuentes después de desconectar', async () => {
        let resolve!: (value: unknown) => void; const request = vi.fn(() => new Promise(done => { resolve = done; }));
        const { result } = renderHook(() => useAssistantKnowledge(request as AssistantRequest, 's1', true, vi.fn(async () => undefined)));
        act(() => window.dispatchEvent(new Event('offline')));
        await act(async () => { resolve({ revision: 'r1', available: true }); }); expect(result.current.available).toBe(false);
    });
    it('al retirar ayuda mixta oculta toda su explicación y conserva la evidencia operativa independiente', () => {
        const independent = { id: 'sql1', tool: 'audit_business_health', label: 'Ventas', data: { value: '20.00' } };
        const hidden = hideRunKnowledge({ ...run, result: { ...run.result!, evidence: [independent], actionProposalIds: ['p1'] } });
        expect(hidden.result!.text).not.toContain('Explicación derivada'); expect(hidden.result!.evidence).toEqual([independent]); expect(hidden.result!.actionProposalIds).toEqual(['p1']);
    });
    it('vuelve a consultar un run terminado sin borrar una propuesta editada', async () => {
        const request = vi.fn(async (path: string) => path.startsWith('/action-proposals') ? proposal : run);
        const { result } = renderHook(() => useAssistantOperations(request as AssistantRequest, 's1', true, ['run1']));
        await waitFor(() => expect(result.current.runs.run1?.status).toBe('SUCCEEDED'));
        await act(() => result.current.openProposal('p1')); act(() => result.current.edit({ quantity: '7' }));
        request.mockImplementation(async path => path.startsWith('/action-proposals') ? proposal : hideRunKnowledge(run));
        await act(() => result.current.refreshKnowledge());
        expect(result.current.runs.run1.result!.knowledgeUnavailable).toBe(true); expect(result.current.draft).toEqual({ quantity: '7' }); expect(result.current.dirty).toBe(true);
        expect(request.mock.calls.filter(([path]) => path === '/runs/run1')).toHaveLength(2);
    });
    it('refresca sólo el texto/fuentes del chat sin perder una respuesta pendiente durante la comprobación', async () => {
        localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
        const message = { id: 'm1', role: 'assistant', text: 'Ayuda histórica', createdAt: '2026-09-19', citations: [citation] };
        let refreshed = false; const fetcher = vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok(caps);
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [{ ...message, ...(refreshed ? { text: 'Ayuda retirada', citations: [], knowledgeUnavailable: true } : {}) }] });
            if (url.endsWith('/messages')) throw new Error('offline');
            throw new Error('Unexpected path');
        }); vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => useNortexAssistant()); await waitFor(() => expect(result.current.capabilities?.help).toBe(true));
        await act(() => result.current.recoverConversation('c1')); await act(() => result.current.send('Mi texto pendiente'));
        const pendingId = result.current.pendingMessage!.id; refreshed = true; await act(() => result.current.refreshKnowledge());
        expect(result.current.messages.find(item => item.id === 'm1')!.text).toBe('Ayuda retirada'); expect(result.current.pendingMessage!.id).toBe(pendingId); expect(result.current.messages.some(item => item.text === 'Mi texto pendiente')).toBe(true);
        expect(fetcher.mock.calls.every(call => String(call[0]).startsWith('/api/assistant/'))).toBe(true);
    });
    it('una recuperación tardía no reinyecta ayuda retirada durante su lectura', async () => {
        localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
        let finish!: (value: unknown) => void;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok(caps);
            if (url.endsWith('/conversations/old')) return new Promise(done => { finish = done; });
            throw new Error('Unexpected path');
        }));
        const { result } = renderHook(() => useNortexAssistant()); await waitFor(() => expect(result.current.capabilities?.help).toBe(true));
        let pending!: Promise<void>; act(() => { pending = result.current.recoverConversation('old'); });
        await act(() => result.current.refreshKnowledge());
        await act(async () => { finish(ok({ id: 'old', messages: [{ id: 'm1', role: 'assistant', text: 'Copia retirada', citations: [citation], createdAt: '2026-09-19' }] })); await pending; });
        expect(result.current.messages[0].text).not.toBe('Copia retirada'); expect(result.current.messages[0].citations).toEqual([]); expect(result.current.messages[0].knowledgeUnavailable).toBe(true);
    });
    it('en el panel conserva el mensaje sin enviar al retirar una fuente y mantiene bloqueado el fondo', async () => {
        localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
        const message = { id: 'm1', role: 'assistant', text: 'Respuesta con ayuda.', createdAt: '2026-09-19', citations: [citation], knowledgeReferences: [passage.reference] };
        let retired = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic');
            if (url.endsWith('/capabilities')) return ok(caps);
            if (url.endsWith('/knowledge/revision')) return ok({ revision: retired ? 'r2' : 'r1', available: true });
            if (url.includes('/knowledge/documents/')) return ok(passage);
            if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) return ok(message);
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [{ ...message, ...(retired ? { text: 'La fuente fue retirada.', citations: [], knowledgeReferences: [], knowledgeUnavailable: true } : {}) }] });
            throw new Error('Unexpected path');
        }));
        const host = document.createElement('div'); host.id = 'root'; document.body.appendChild(host);
        try {
            render(<MemoryRouter><NortexAssistantLauncher /></MemoryRouter>, { container: host });
            fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' }));
            fireEvent.change(await screen.findByLabelText('Tu consulta'), { target: { value: 'Cómo registrar una compra' } });
            fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }));
            fireEvent.click(await screen.findByRole('button', { name: 'Ver fuente' })); await screen.findByText(passage.body);
            fireEvent.change(screen.getByLabelText('Tu consulta'), { target: { value: 'Esto sigue sin enviar' } });
            retired = true; await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); });
            expect(await screen.findByText('La fuente fue retirada.')).toBeVisible(); expect(screen.queryByText(passage.body)).not.toBeInTheDocument();
            expect(screen.getByLabelText('Tu consulta')).toHaveValue('Esto sigue sin enviar'); expect(host).toHaveAttribute('inert');
            expect(document.querySelector('[data-operational-alerts][data-nortex-assistant]')).not.toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Cerrar NortexGPT' }));
            await waitFor(() => expect(host).not.toHaveAttribute('inert'));
        } finally { cleanup(); host.remove(); }
    });

});
