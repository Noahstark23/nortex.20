// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import NortexAssistantLauncher from '../components/assistant/NortexAssistantLauncher';
import { useNortexAssistant, type AssistantRequest } from '../hooks/useNortexAssistant';
import { useAssistantKnowledge } from '../hooks/useAssistantKnowledge';
import type { AssistantCapabilities, AssistantMessageDTO, AssistantProposalDTO } from '../shared/assistant';
import type { AssistantKnowledgePassage } from '../shared/assistantKnowledge';
import { assistantKnowledgeCapabilityScope } from '../shared/assistantKnowledgeScope';

const caps: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, extractionEnabled: true, executionEnabled: false, operations: false, promotionManage: true, accessScope: 'same-owner-scope' };
const citation = { id: 'qa', title: 'Ayuda sintética', section: 'Preparación', version: '1', path: '/ignored', sectionId: 'main', contentHash: 'a'.repeat(64) };
const passage: AssistantKnowledgePassage = { title: 'Ayuda sintética', section: 'Preparación', body: 'Contenido visible con permiso de preparación.', reference: { documentId: 'qa', version: '1', sectionId: 'main', contentHash: citation.contentHash }, historical: false, publication: 'PUBLISHED', revision: 'same-editorial-revision' };
const message: AssistantMessageDTO = { id: 'm1', role: 'assistant', text: 'Explicación con fuentes permitidas.', createdAt: '2026-09-19', citations: [citation], knowledgeReferences: [passage.reference] };
const redacted = { ...message, text: 'Ayuda retirada por permisos vigentes.', citations: [], knowledgeReferences: [], knowledgeUnavailable: true };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
    localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', tenant: { id: 't1' } }));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function openWithMessage() {
    render(<MemoryRouter><NortexAssistantLauncher /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir NortexGPT' }));
    fireEvent.change(await screen.findByLabelText('Tu consulta'), { target: { value: 'Cómo preparar una compra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver fuente' }));
}
describe('vigencia de ayuda por capacidades', () => {
    it('la identidad cubre todos los flags sin depender del orden ni distinguir ausente de falso', () => {
        const enabled: AssistantCapabilities = { ...caps, purchasePrepare: true, operations: true, dailyBrief: true, actionPrepare: true, actionConfirm: true, privateWhatsapp: true, budgetManage: true, cashReview: true, executionEnabled: true };
        const original = assistantKnowledgeCapabilityScope(enabled);
        for (const key of Object.keys(enabled).filter(key => key !== 'accessScope') as Array<keyof AssistantCapabilities>) {
            expect(assistantKnowledgeCapabilityScope({ ...enabled, [key]: false }), key).not.toBe(original);
        }
        expect(assistantKnowledgeCapabilityScope(Object.fromEntries(Object.entries(enabled).reverse()) as unknown as AssistantCapabilities)).toBe(original);
        expect(assistantKnowledgeCapabilityScope({ ...caps, cashReview: false })).toBe(assistantKnowledgeCapabilityScope(caps));
        expect(assistantKnowledgeCapabilityScope(null)).not.toBe(assistantKnowledgeCapabilityScope(caps));
        expect(assistantKnowledgeCapabilityScope({ ...caps, accessScope: 'another-scope' })).not.toBe(assistantKnowledgeCapabilityScope(caps));
    });
    it.each(['invoicePrepare', 'extractionEnabled', 'promotionManage'] as const)('revocar %s retira texto y fuente sin cambiar scope editorial ni perder el mensaje sin enviar', async flag => {
        let revoked = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, [flag]: !revoked });
            if (url.endsWith('/knowledge/revision')) return ok({ revision: passage.revision, available: true });
            if (url.includes('/knowledge/documents/')) return ok(passage);
            if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) return ok(message);
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [revoked ? redacted : message] });
            throw new Error('Ruta no prevista: ' + url);
        }));
        await openWithMessage(); await screen.findByText(passage.body);
        fireEvent.change(screen.getByLabelText('Tu consulta'), { target: { value: 'Mi compra sigue pendiente' } });
        revoked = true; await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); });
        await waitFor(() => expect(screen.queryByText(passage.body)).not.toBeInTheDocument());
        expect(screen.queryByText(message.text)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Tu consulta')).toHaveValue('Mi compra sigue pendiente');
    });
    it('una fuente que llega después del cambio de capacidad nunca revive el contenido anterior', async () => {
        let revoked = false; const late = deferred<ReturnType<typeof ok>>();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, invoicePrepare: !revoked });
            if (url.endsWith('/knowledge/revision')) return ok({ revision: passage.revision, available: true });
            if (url.includes('/knowledge/documents/')) return late.promise;
            if (url.endsWith('/conversations')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) return ok(message);
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [redacted] });
            throw new Error('Ruta no prevista: ' + url);
        }));
        await openWithMessage(); expect(screen.getByText('Comprobando la fuente…')).toBeVisible();
        revoked = true; await act(async () => { window.dispatchEvent(new Event('nortex:data-changed')); });
        await act(async () => { late.resolve(ok(passage)); });
        expect(screen.queryByText(passage.body)).not.toBeInTheDocument();
    });
    it('la revocación de preparación conserva la propuesta y sus datos mientras oculta la ayuda', async () => {
        let revoked = false;
        const proposal: AssistantProposalDTO = { id: 'p1', version: 7, status: 'DRAFT', attachmentIds: [], expiresAt: '2026-09-26', issues: [], preview: null, draft: { currency: 'NIO', invoiceNumber: 'qa', date: '', documentTotal: '', receivedConfirmed: false, paymentConfirmed: false, warnings: [], items: [{ description: 'Cemento', quantity: '50', unitCost: '', purchaseUnit: 'BASE' }] } };
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, invoicePrepare: !revoked });
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [message] });
            if (url.endsWith('/proposals/p1')) return ok(proposal);
            throw new Error('Ruta no prevista: ' + url);
        }));
        const { result } = renderHook(() => useNortexAssistant()); await waitFor(() => expect(result.current.capabilities?.enabled).toBe(true));
        await act(() => result.current.recoverConversation('c1')); await act(() => result.current.openProposal('p1'));
        revoked = true; await act(() => result.current.refreshCapabilities());
        expect(result.current.proposal).toEqual(proposal); expect(result.current.messages.find(item => item.id === message.id)?.text).not.toBe(message.text);
        expect(result.current.conversationId).toBe('c1');
    });
    it('cambiar el transporte oculta inmediatamente la disponibilidad anterior aun con el mismo scope', async () => {
        const oldRequest = vi.fn(async () => ({ revision: passage.revision, available: true })) as AssistantRequest;
        const next = deferred<{ revision: string; available: boolean }>(); const nextRequest = vi.fn(() => next.promise) as AssistantRequest;
        const refresh = vi.fn(async () => {}); const observations: boolean[] = [];
        const { result, rerender } = renderHook(({ request }) => { const knowledge = useAssistantKnowledge(request, 'same-scope', true, refresh); observations.push(knowledge.available); return knowledge; }, { initialProps: { request: oldRequest } });
        await waitFor(() => expect(result.current.available).toBe(true)); observations.length = 0;
        rerender({ request: nextRequest }); expect(observations[0]).toBe(false);
        await act(async () => { next.resolve({ revision: passage.revision, available: true }); }); expect(result.current.available).toBe(true);
    });
    it('una respuesta de conversación iniciada antes de revocar permisos no repuebla la ayuda', async () => {
        let revoked = false; const late = deferred<ReturnType<typeof ok>>();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/capabilities')) return ok({ ...caps, invoicePrepare: !revoked });
            if (url.endsWith('/conversations/c1')) return ok({ id: 'c1', messages: [] });
            if (url.endsWith('/messages')) return late.promise;
            throw new Error('Ruta no prevista: ' + url);
        }));
        const { result } = renderHook(() => useNortexAssistant()); await waitFor(() => expect(result.current.capabilities?.enabled).toBe(true));
        await act(() => result.current.recoverConversation('c1'));
        let sending!: Promise<void>; act(() => { sending = result.current.send('Cómo registrar una compra'); });
        revoked = true; await act(() => result.current.refreshCapabilities());
        await act(async () => { late.resolve(ok(message)); await sending; });
        const delivered = result.current.messages.find(item => item.id === message.id);
        expect(delivered?.text).not.toBe(message.text); expect(delivered?.citations).toEqual([]); expect(delivered?.knowledgeUnavailable).toBe(true);
        expect(result.current.messages.find(item => item.role === 'user')?.text).toBe('Cómo registrar una compra');
    });
});
