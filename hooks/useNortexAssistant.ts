import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssistantOperations } from './useAssistantOperations';
import { readActivationSession, useActivationSession } from './useActivationJourney';
import type { AssistantAttachmentDTO, AssistantCapabilities, AssistantConversationDTO, AssistantJobDTO, AssistantMessageDTO, AssistantOperationDTO, AssistantProposalDTO, InvoiceDraft } from '../shared/assistant';

export class AssistantRequestError extends Error {
    constructor(message: string, public status = 0) { super(message); }
}
export interface AssistantCatalogItem { id: string; label: string; detail?: string; sourceType?: string; productId?: string; warehouseId?: string; supplierId?: string; items?: Array<{ id: string; productId: string; label: string }> }
export type AssistantCatalogKind = 'products' | 'suppliers' | 'warehouses' | 'purchaseOrders' | 'batches' | 'supplierReturnSources' | 'returnSuppliers';
export type AssistantRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
const empty = { messages: [] as AssistantMessageDTO[], pendingMessage: null as AssistantMessageDTO | null, purchaseIntake: null as AssistantConversationDTO['purchaseIntake'], actions: [] as NonNullable<AssistantMessageDTO['actions']>, attachments: [] as AssistantAttachmentDTO[], job: null as AssistantJobDTO | null, proposal: null as AssistantProposalDTO | null, operation: null as AssistantOperationDTO | null, error: '', busy: false, confirmationRejected: false };
const actionsFor = (message: Pick<AssistantMessageDTO, 'actions' | 'proposalId'>): NonNullable<AssistantMessageDTO['actions']> =>
    (message.actions ?? (message.proposalId ? [{ type: 'REVIEW_PURCHASE', label: 'Revisar compra', proposalId: message.proposalId }] : [])).map(action => action.type === 'REVIEW_PURCHASE' ? { ...action, proposalId: action.proposalId ?? message.proposalId } : action);

/** Solo memoria de la sesión actual: nunca guarda facturas o conversaciones en el navegador. */
export function useNortexAssistant() {
    const session = useActivationSession();
    const [state, setState] = useState({ ...empty, key: session.key });
    const [capabilities, setCapabilities] = useState<{ key: string; value: AssistantCapabilities | null; failed: boolean }>({ key: session.key, value: null, failed: false });
    const authorizationEpoch = useRef(0); const capabilityGeneration = useRef(0);
    const lastCapabilities = useRef<AssistantCapabilities | null>(null);
    const conversation = useRef<string | null>(null);
    const confirming = useRef(false);
    const busyRef = useRef(false);
    const controllers = useRef(new Set<AbortController>());
    const mounted = useRef(true);
    const current = useCallback(() => mounted.current && readActivationSession().key === session.key, [session.key]);
    const update = useCallback((patch: Partial<typeof empty>, epoch = authorizationEpoch.current) => { if (current() && epoch === authorizationEpoch.current) setState(previous => epoch === authorizationEpoch.current ? ({ ...(previous.key === session.key ? previous : { ...empty, key: session.key }), ...patch }) : previous); }, [current, session.key]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllers.current.forEach(controller => controller.abort()); }; }, []);
    useEffect(() => {
        authorizationEpoch.current += 1; lastCapabilities.current = null; busyRef.current = false; confirming.current = false;
        controllers.current.forEach(controller => controller.abort()); conversation.current = null;
        setState({ ...empty, key: session.key });
    }, [session.key]);
    const request: AssistantRequest = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
        if (!current() || !session.token) throw new AssistantRequestError('La sesión cambió. Volvé a abrir NortexGPT.', 401);
        if (!navigator.onLine) throw new AssistantRequestError('Sin internet. Tu trabajo sigue aquí; conectate para continuar.');
        const epoch = authorizationEpoch.current;
        const controller = new AbortController(); controllers.current.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), 45_000);
        try {
            const response = await fetch(`/api/assistant${path}`, { ...options, cache: 'no-store', signal: controller.signal,
                headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers, Authorization: `Bearer ${session.token}` } });
            if (!current() || epoch !== authorizationEpoch.current) throw new AssistantRequestError('La sesión o los permisos cambiaron.', 401);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    authorizationEpoch.current += 1; lastCapabilities.current = null; busyRef.current = false; confirming.current = false;
                    controllers.current.forEach(pending => { if (pending !== controller) pending.abort(); });
                    conversation.current = null; update({ ...empty });
                    setCapabilities({ key: session.key, value: null, failed: true });
                }
                const body = await response.json().catch(() => null);
                throw new AssistantRequestError(typeof body?.error === 'string' ? body.error : 'No pudimos completar la consulta.', response.status);
            }
            const result = await response.json();
            if (!current() || epoch !== authorizationEpoch.current) throw new AssistantRequestError('La sesión o los permisos cambiaron.', 401);
            return result as T;
        } catch (error) {
            if (error instanceof AssistantRequestError) throw error;
            throw new AssistantRequestError('La conexión se interrumpió. Comprobá el resultado antes de repetir una operación.');
        } finally { clearTimeout(timeout); controllers.current.delete(controller); }
    }, [current, session.key, session.token, update]);
    const refreshCapabilities = useCallback(async () => {
        const generation = ++capabilityGeneration.current;
        try {
            const value = await request<AssistantCapabilities>('/capabilities');
            if (!current() || generation !== capabilityGeneration.current) return;
            const previous = lastCapabilities.current;
            const readPermissions: Array<keyof AssistantCapabilities> = ['enabled', 'help', 'overview', 'inventory', 'invoiceRead', 'operations', 'dailyBrief'];
            if (previous && (previous.accessScope !== value.accessScope || readPermissions.some(key => previous[key] && !value[key]))) {
                authorizationEpoch.current += 1; busyRef.current = false; confirming.current = false; controllers.current.forEach(controller => controller.abort());
                conversation.current = null; update({ ...empty });
            }
            lastCapabilities.current = value;
            setCapabilities({ key: session.key, value, failed: false });
        } catch {
            // Un fallo de red oculta la información hasta comprobar acceso, conservando el trabajo en memoria.
            if (current() && generation === capabilityGeneration.current) setCapabilities({ key: session.key, value: null, failed: true });
        }
    }, [current, request, session.key, update]);
    useEffect(() => {
        void refreshCapabilities();
        const refresh = () => { if (document.visibilityState !== 'hidden') void refreshCapabilities(); };
        const interval = window.setInterval(refresh, 60_000);
        window.addEventListener('online', refresh); window.addEventListener('nortex:data-changed', refresh); document.addEventListener('visibilitychange', refresh);
        return () => { clearInterval(interval); window.removeEventListener('online', refresh); window.removeEventListener('nortex:data-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
    }, [refreshCapabilities]);
    const run = useCallback(async (action: (epoch: number) => Promise<void>) => {
        const epoch = authorizationEpoch.current;
        if (busyRef.current) return;
        busyRef.current = true; update({ busy: true, error: '' });
        try { await action(epoch); } catch (error) { update({ error: error instanceof Error ? error.message : 'No se pudo completar.' }, epoch); }
        finally { if (current() && epoch === authorizationEpoch.current) { busyRef.current = false; update({ busy: false }, epoch); } }
    }, [current, update]);
    const send = useCallback((text: string) => run(async epoch => {
        if (!text.trim()) return;
        if (state.pendingMessage && state.pendingMessage.text !== text.trim()) throw new AssistantRequestError('Retomá el mensaje pendiente antes de enviar otro.');
        const user: AssistantMessageDTO = state.pendingMessage ?? { id: crypto.randomUUID(), role: 'user', text: text.trim(), createdAt: new Date().toISOString() };
        if (!state.pendingMessage && current() && epoch === authorizationEpoch.current) setState(previous => epoch === authorizationEpoch.current ? ({ ...previous, messages: [...previous.messages, user], pendingMessage: user }) : previous);
        if (!conversation.current) {
            const created = await request<AssistantConversationDTO>('/conversations', { method: 'POST', body: '{}' });
            if (!current() || epoch !== authorizationEpoch.current) return; conversation.current = created.id;
        }
        let answer: AssistantMessageDTO;
        try { answer = await request<AssistantMessageDTO>(`/conversations/${encodeURIComponent(conversation.current)}/messages`, { method: 'POST', body: JSON.stringify({ requestId: user.id, text: user.text }) }); }
        catch (error) { if (error instanceof AssistantRequestError && [400, 422].includes(error.status)) update({ pendingMessage: null }, epoch); throw error; }
        if (current() && epoch === authorizationEpoch.current) setState(previous => epoch === authorizationEpoch.current ? ({ ...previous, messages: [...previous.messages.filter(message => message.id !== answer.id), answer], pendingMessage: null,
            ...((answer.purchaseIntake && answer.purchaseIntake.id !== previous.purchaseIntake?.id) || (answer.purchaseIntake === null && previous.purchaseIntake && !previous.operation) ? { attachments: [], proposal: null, job: null, operation: null, confirmationRejected: false } : {}),
            ...(answer.purchaseIntake !== undefined ? { purchaseIntake: answer.purchaseIntake, actions: answer.purchaseIntake === null ? [] : actionsFor(answer) } : answer.actions !== undefined || answer.proposalId ? { actions: actionsFor(answer) } : {}) }) : previous);
    }), [current, request, run, state.pendingMessage, update]);
    const upload = useCallback((files: File[]) => run(async epoch => {
        if (files.length === 0 || files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error('Adjuntá una factura de hasta 10 MB y 10 páginas o imágenes.');
        if (files.some(file => !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type))) throw new Error('Usá una foto JPG o PNG, o un PDF.');
        if (files.some(file => file.type === 'application/pdf') && files.length !== 1) throw new Error('Adjuntá un solo PDF o las fotos de una misma factura.');
        update({ attachments: [], job: null, proposal: null, operation: null });
        const attachments: AssistantAttachmentDTO[] = [];
        for (const file of files) {
            if (!current() || epoch !== authorizationEpoch.current) return;
            const attachment = await request<AssistantAttachmentDTO>('/attachments', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
            attachments.push(attachment); update({ attachments: [...attachments] }, epoch);
        }
        if (!current() || epoch !== authorizationEpoch.current) return;
        const job = await request<AssistantJobDTO>('/extractions', { method: 'POST', body: JSON.stringify({ attachmentIds: attachments.map(item => item.id), ...(state.purchaseIntake && conversation.current ? { conversationId: conversation.current } : {}) }) });
        update({ job }, epoch);
    }), [current, request, run, state.purchaseIntake, update]);
    const loadProposal = useCallback(async (id: string, epoch = authorizationEpoch.current) => {
        const proposal = await request<AssistantProposalDTO>(`/proposals/${encodeURIComponent(id)}`);
        if (!current() || epoch !== authorizationEpoch.current) throw new AssistantRequestError('Los permisos cambiaron.', 401);
        update({ proposal, attachments: [], job: null, operation: proposal.result ?? null }, epoch);
        const attachments = await Promise.all(proposal.attachmentIds.map(attachmentId => request<AssistantAttachmentDTO>(`/attachments/${encodeURIComponent(attachmentId)}`)));
        update({ attachments }, epoch); return proposal;
    }, [current, request, update]);
    const refreshJob = useCallback(() => run(async epoch => {
        if (state.key !== session.key || !state.job) return;
        const job = await request<AssistantJobDTO>(`/extractions/${encodeURIComponent(state.job.id)}`); update({ job }, epoch);
        if (job.status === 'SUCCEEDED' && job.proposalId) await loadProposal(job.proposalId, epoch);
    }), [loadProposal, request, run, session.key, state.job, state.key, update]);
    const save = useCallback((draft: InvoiceDraft) => run(async epoch => {
        if (state.key !== session.key || !state.proposal) return;
        const proposal = await request<AssistantProposalDTO>(`/proposals/${encodeURIComponent(state.proposal.id)}`, { method: 'PATCH', body: JSON.stringify({ version: state.proposal.version, draft }) }); update({ proposal, operation: proposal.result ?? null }, epoch);
    }), [request, run, session.key, state.key, state.proposal, update]);
    const confirm = useCallback((idempotencyKey: string) => run(async epoch => {
        if (confirming.current || state.key !== session.key || !state.proposal) return;
        confirming.current = true; update({ confirmationRejected: false }, epoch);
        try {
            const operation = await request<AssistantOperationDTO>(`/proposals/${encodeURIComponent(state.proposal.id)}/confirm`, { method: 'POST', body: JSON.stringify({ version: state.proposal.version, idempotencyKey }) });
            update({ operation }, epoch); if (epoch !== authorizationEpoch.current) return; window.dispatchEvent(new Event('nortex:data-changed'));
        } catch (error) {
            // La misma referencia consulta evidencia durable; un 404 nunca acredita que no se ejecutó.
            try { const operation = await request<AssistantOperationDTO>(`/operations/${encodeURIComponent(idempotencyKey)}`); update({ operation }, epoch); return; } catch { /* Mantener resultado incierto. */ }
            if (error instanceof AssistantRequestError && [400, 409, 410, 422, 423].includes(error.status)) {
                update({ confirmationRejected: true, ...(error.status === 410 ? { proposal: { ...state.proposal, status: 'EXPIRED' as const } } : {}) }, epoch);
                if (error.status === 409) await loadProposal(state.proposal.id, epoch);
            }
            throw error;
        } finally { if (epoch === authorizationEpoch.current) confirming.current = false; }
    }), [loadProposal, request, run, session.key, state.key, state.proposal, update]);
    const recover = useCallback((kind: 'proposals' | 'extractions' | 'operations', id: string) => run(async epoch => {
        if (!id.trim()) return;
        if (kind === 'proposals') await loadProposal(id.trim(), epoch);
        else if (kind === 'extractions') {
            const job = await request<AssistantJobDTO>(`/extractions/${encodeURIComponent(id.trim())}`); update({ job, proposal: null, operation: null, attachments: [] }, epoch);
            if (job.status === 'SUCCEEDED' && job.proposalId) await loadProposal(job.proposalId, epoch);
        } else {
            const operation = await request<AssistantOperationDTO>(`/operations/${encodeURIComponent(id.trim())}`);
            await loadProposal(operation.proposalId, epoch); update({ operation }, epoch);
        }
    }), [loadProposal, request, run, update]);
    const recoverConversation = useCallback((id: string) => run(async epoch => {
        if (state.pendingMessage) throw new AssistantRequestError('Retomá el mensaje pendiente antes de recuperar otra conversación.');
        const result = await request<AssistantConversationDTO>(`/conversations/${encodeURIComponent(id.trim())}`);
        if (!current() || epoch !== authorizationEpoch.current) return;
        const latestIntake = [...result.messages].reverse().find(message => message.purchaseIntake !== undefined);
        const changedConversation = conversation.current !== result.id;
        const purchaseIntake = result.purchaseIntake !== undefined ? result.purchaseIntake : latestIntake?.purchaseIntake ?? null;
        conversation.current = result.id; update({ messages: result.messages, pendingMessage: null,
            ...(changedConversation || (purchaseIntake === null && state.purchaseIntake && !state.operation) ? { attachments: [], proposal: null, job: null, operation: null, confirmationRejected: false } : {}),
            purchaseIntake, actions: purchaseIntake === null ? [] : actionsFor({ actions: result.actions ?? latestIntake?.actions, proposalId: result.proposalId ?? latestIntake?.proposalId }) }, epoch);
    }), [current, request, run, state.operation, state.pendingMessage, state.purchaseIntake, update]);
    const openProposal = useCallback(async (id: string) => {
        let loaded = false;
        await run(async epoch => { await loadProposal(id, epoch); loaded = true; });
        return loaded;
    }, [loadProposal, run]);
    const newInvoice = useCallback((preserveCapture = false) => { if (!busyRef.current) update({ attachments: [], job: null, proposal: null, operation: null, error: '', confirmationRejected: false,
        ...(!preserveCapture ? { purchaseIntake: null, actions: [] } : {}) }); }, [update]);
    const visible = state.key === session.key && current() ? state : { ...empty, key: session.key };
    const access = capabilities.key === session.key && current() ? capabilities.value : null;
    const operations = useAssistantOperations(request, `${session.key}:${authorizationEpoch.current}`, !!access?.enabled && !!access.operations, visible.messages.flatMap(message => message.operationalRunId ? [message.operationalRunId] : []));
    return { ...visible, operations, capabilities: capabilities.key === session.key && current() ? capabilities.value : null, capabilitiesFailed: capabilities.key === session.key && capabilities.failed,
        sessionKey: session.key, conversationId: current() ? conversation.current : null, recoverConversation, request, refreshCapabilities, send, upload, refreshJob, loadProposal, openProposal, save, confirm, recover, newInvoice };
}
export type NortexAssistantController = ReturnType<typeof useNortexAssistant>;
