import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantRequest } from './useNortexAssistant';
import type { AssistantMessageDTO } from '../shared/assistant';
import type { AssistantRunDTO } from '../shared/assistantOperations';
import type { AssistantKnowledgeRevision } from '../shared/assistantKnowledge';

export const knowledgeUnavailableText = 'La ayuda de esta respuesta no está disponible. Volvé a consultar para comprobar las fuentes vigentes.';
export const messageUsesKnowledge = (message: AssistantMessageDTO) => !!message.citations?.length || !!message.knowledgeReferences?.length || !!message.knowledgeUnavailable;
export function hideMessageKnowledge(message: AssistantMessageDTO): AssistantMessageDTO {
    return message.role === 'assistant' && messageUsesKnowledge(message) ? { ...message, text: knowledgeUnavailableText, citations: [], knowledgeUnavailable: true } : message;
}
export function hideRunKnowledge(run: AssistantRunDTO): AssistantRunDTO {
    const result = run.result;
    if (!result || (!result.knowledgeReferences?.length && !result.knowledgeUnavailable && !result.evidence.some(item => item.tool === 'search_help'))) return run;
    return { ...run, result: { ...result, text: knowledgeUnavailableText, degraded: true, knowledgeUnavailable: true, evidence: result.evidence.filter(item => item.tool !== 'search_help') } };
}

/** Sólo consulta vigencia. No reinicia conversaciones, propuestas ni llamadas al modelo. */
export function useAssistantKnowledge(request: AssistantRequest, scope: string, enabled: boolean, refresh: () => Promise<void>) {
    const [state, setState] = useState({ request, scope, revision: '', available: false, epoch: 0 });
    const activeScope = useRef(scope); activeScope.current = scope;
    const activeRequest = useRef(request); activeRequest.current = request;
    const invalidation = useRef(0); const epoch = useRef(0); const last = useRef({ revision: '', available: false });
    const refreshRef = useRef(refresh); refreshRef.current = refresh;
    useEffect(() => {
        const generation = ++epoch.current; last.current = { revision: '', available: false };
        setState({ request, scope, revision: '', available: false, epoch: generation });
        if (!enabled) return;
        let stopped = false; let pending = false;
        const valid = () => !stopped && activeScope.current === scope && activeRequest.current === request && generation === epoch.current;
        const check = async () => {
            if (pending || document.visibilityState === 'hidden') return;
            pending = true; const checkedInvalidation = invalidation.current;
            const canDeliver = () => valid() && checkedInvalidation === invalidation.current && document.visibilityState !== 'hidden';
            try {
                const result = await request<AssistantKnowledgeRevision>('/knowledge/revision');
                if (!canDeliver()) return;
                if (!result || typeof result.revision !== 'string' || !result.revision || result.available !== true) throw new Error('Ayuda no disponible');
                if (result.revision !== last.current.revision || !last.current.available) {
                    setState(previous => ({ ...previous, revision: result.revision, available: false, epoch: previous.epoch + 1 }));
                    await refreshRef.current();
                    if (!canDeliver()) return;
                }
                last.current = { revision: result.revision, available: true };
                setState(previous => ({ ...previous, scope, revision: result.revision, available: true }));
            } catch {
                if (valid()) { last.current.available = false; setState(previous => ({ ...previous, available: false, epoch: previous.epoch + 1 })); }
            } finally { pending = false; }
        };
        const hide = () => { if (document.visibilityState === 'hidden') { invalidation.current++; last.current.available = false; setState(previous => ({ ...previous, available: false, epoch: previous.epoch + 1 })); } else void check(); };
        const online = () => void check();
        const offline = () => { invalidation.current++; last.current.available = false; setState(previous => ({ ...previous, available: false, epoch: previous.epoch + 1 })); };
        void check();
        const timer = window.setInterval(() => void check(), 15_000);
        document.addEventListener('visibilitychange', hide); window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('nortex:data-changed', online);
        return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('nortex:data-changed', online); };
    }, [request, scope, enabled]);
    const invalidate = useCallback(() => { invalidation.current++; last.current.available = false; setState(previous => ({ ...previous, available: false, epoch: previous.epoch + 1 })); }, []);
    const visible = state.scope === scope && state.request === request && enabled;
    return { scope, revision: visible ? state.revision : '', available: visible && state.available, epoch: visible ? state.epoch : -1, invalidate };
}
