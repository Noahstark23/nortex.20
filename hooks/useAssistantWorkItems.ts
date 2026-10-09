import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantRequest } from './useNortexAssistant';
import type { AssistantWorkAcceptanceInput, AssistantWorkItemDTO, AssistantWorkItemEventInput, AssistantWorkItemListDTO } from '../shared/assistantWorkItems';
import { readAssistantWorkDraft, saveAssistantWorkDraft } from '../utils/assistantWorkDraft';

const initial = { items: [] as AssistantWorkItemListDTO['items'], nextCursor: null as string | null,
    selected: null as AssistantWorkItemDTO | null, recoveryId: null as string | null, note: '', error: '', busy: false, storageBlocked: false,
    pending: null as { id: string; input: AssistantWorkItemEventInput } | null,
    pendingAcceptance: null as { id: string; input: AssistantWorkAcceptanceInput } | null };

/** Referencia e intentos privados de esta pestaña; el estado autoritativo vive en el servidor. */
export function useAssistantWorkItems(request: AssistantRequest, scope: string, enabled: boolean, storageScope?: string | null) {
    const [state, setState] = useState({ ...initial, scope });
    const [storageReady, setStorageReady] = useState(!storageScope);
    const current = useRef({ scope, enabled }); current.current = { scope, enabled };
    const requestRef = useRef(request); requestRef.current = request;
    const epoch = useRef(0); const busy = useRef(false);
    const persist = (value: typeof state) => {
        if (!storageScope) return;
        saveAssistantWorkDraft({ version: 1, scope: storageScope, selectedId: value.selected?.id ?? value.recoveryId,
            note: value.note, pending: value.pending, pendingAcceptance: value.pendingAcceptance });
    };
    const run = useCallback(async (action: (valid: () => boolean) => Promise<void>, readOnly = false) => {
        if (!enabled || !storageReady || (state.storageBlocked && !readOnly) || busy.current) return false;
        const generation = epoch.current;
        const valid = () => current.current.enabled && current.current.scope === scope && epoch.current === generation;
        busy.current = true; setState(s => ({ ...s, busy: true, error: '' }));
        try { await action(valid); return valid(); }
        catch (error) { if (valid()) setState(s => ({ ...s, error: error instanceof Error ? error.message : 'No pudimos comprobar el trabajo.' })); return false; }
        finally { if (valid()) { busy.current = false; setState(s => ({ ...s, busy: false })); } }
    }, [scope, enabled, storageReady, state.storageBlocked]);
    useEffect(() => () => { epoch.current++; }, []);
    const accept = (item: AssistantWorkItemDTO) => setState(s => {
        const acknowledged = s.pending?.id === item.id && (item.receiptEventId === s.pending?.input.eventId || item.events.some(event => event.id === s.pending?.input.eventId));
        const acceptanceAcknowledged = s.pendingAcceptance?.id === item.id && (item.receiptEventId === s.pendingAcceptance.input.eventId
            || item.acceptance?.eventId === s.pendingAcceptance.input.eventId);
        return { ...s, selected: item, recoveryId: item.id, items: [item, ...s.items.filter(row => row.id !== item.id)],
            ...(acknowledged ? { pending: null, note: s.pending?.input.type === 'ADD_NOTE' ? '' : s.note } : {}),
            ...(acceptanceAcknowledged ? { pendingAcceptance: null } : {}) };
    });
    useEffect(() => {
        const generation = ++epoch.current; busy.current = false; setStorageReady(false);
        if (!enabled) { setState({ ...initial, scope }); return; }
        let saved: ReturnType<typeof readAssistantWorkDraft> = null;
        try { if (storageScope) saved = readAssistantWorkDraft(storageScope); }
        catch (error) {
            setState({ ...initial, scope, storageBlocked: true, error: error instanceof Error ? error.message : 'No pudimos recuperar el trabajo.' });
            setStorageReady(true); return;
        }
        setState({ ...initial, scope, recoveryId: saved?.selectedId ?? null, note: saved?.note ?? '',
            pending: saved?.pending ?? null, pendingAcceptance: saved?.pendingAcceptance ?? null });
        setStorageReady(true);
        if (!saved?.selectedId) return;
        void requestRef.current<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(saved.selectedId)}`).then(item => {
            if (current.current.enabled && current.current.scope === scope && epoch.current === generation) accept(item);
        }).catch(error => {
            if (!current.current.enabled || current.current.scope !== scope || epoch.current !== generation) return;
            const failure = error as { status?: number };
            if (failure.status === 401 || failure.status === 403) {
                setState(s => ({ ...s, storageBlocked: true,
                    error: 'No pudimos comprobar el trabajo con esta sesión. Conservamos la nota y el intento en esta pestaña; iniciá sesión y comprobá antes de enviar.' }));
                return;
            }
            setState(s => ({ ...s, error: error instanceof Error ? error.message : 'No pudimos comprobar el trabajo guardado.' }));
        });
    }, [scope, enabled, storageScope]);
    useEffect(() => {
        if (!enabled || !storageReady || state.scope !== scope || state.storageBlocked || !storageScope) return;
        try { persist(state); }
        catch (error) { setState(s => ({ ...s, storageBlocked: true, error: error instanceof Error ? error.message : 'No pudimos conservar el trabajo.' })); }
    }, [enabled, storageReady, state.scope, state.selected?.id, state.recoveryId, state.note, state.pending, state.pendingAcceptance, state.storageBlocked, storageScope]);
    useEffect(() => {
        if (!enabled || (!state.note && !state.pending && !state.pendingAcceptance)) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [enabled, state.note, state.pending, state.pendingAcceptance]);
    const load = useCallback((more = false) => run(async valid => {
        const result = await request<AssistantWorkItemListDTO>(`/work-items${more && state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : ''}`);
        if (valid()) setState(s => ({ ...s, items: more ? [...new Map([...s.items, ...result.items].map(item => [item.id, item])).values()] : result.items, nextCursor: result.nextCursor }));
    }, true), [request, run, state.nextCursor]);
    const open = useCallback((id: string) => run(async valid => {
        if ((state.note.trim() || state.pending || state.pendingAcceptance) && (state.selected?.id ?? state.recoveryId) !== id) throw new Error('Guardá tu nota o comprobá el envío pendiente antes de abrir otro trabajo.');
        const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}`);
        if (valid()) accept(item);
    }, true), [request, run, state.note, state.pending, state.pendingAcceptance, state.selected?.id, state.recoveryId]);
    const create = useCallback((runId: string) => run(async valid => {
        if (state.note.trim() || state.pending || state.pendingAcceptance) throw new Error('Conservá primero la nota o el envío pendiente del trabajo actual.');
        const item = await request<AssistantWorkItemDTO>('/work-items', { method: 'POST', body: JSON.stringify({ runId }) });
        if (valid()) accept(item);
    }), [request, run, state.note, state.pending, state.pendingAcceptance]);
    const rejectPending = (error: unknown) => {
        const failure = error as { status?: number; code?: string };
        if (failure.status === 409 && ['WORK_ITEM_CHANGED', 'WORK_ITEM_TRANSITION', 'WORK_ITEM_CANCELLED', 'WORK_ITEM_EVENT_CONFLICT'].includes(failure.code ?? '')) setState(s => ({ ...s, pending: null }));
    };
    const change = useCallback((type: AssistantWorkItemEventInput['type']) => run(async valid => {
        if (!state.selected) return;
        if (state.pending) throw new Error('Comprobá o reintentá el envío pendiente con su misma referencia.');
        if (state.pendingAcceptance) throw new Error('Comprobá la aceptación pendiente antes de cambiar el trabajo.');
        if (state.note.trim() && type !== 'ADD_NOTE') throw new Error('Guardá la nota antes de cambiar el estado.');
        const input: AssistantWorkItemEventInput = { eventId: crypto.randomUUID(), version: state.selected.version,
            ...(type === 'ADD_NOTE' ? { type, note: state.note.trim() } : { type }) };
        const id = state.selected.id;
        persist({ ...state, pending: { id, input } });
        setState(s => ({ ...s, pending: { id, input } }));
        try {
            const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(item);
        } catch (error) { if (valid()) rejectPending(error); throw error; }
    }), [request, run, state.selected, state.pending, state.pendingAcceptance, state.note]);
    const retry = useCallback(() => run(async valid => {
        if (!state.pending) return;
        const { id, input } = state.pending;
        try {
            const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(item);
        } catch (error) { if (valid()) rejectPending(error); throw error; }
    }), [request, run, state.pending]);
    const rejectAcceptance = (error: unknown) => {
        const failure = error as { status?: number; code?: string };
        if (failure.status === 409 && ['WORK_ITEM_CHANGED', 'WORK_ITEM_REPORT_CHANGED', 'WORK_ITEM_TRANSITION',
            'WORK_ITEM_HISTORY_TRUNCATED', 'WORK_ITEM_EVENT_CONFLICT', 'WORK_ITEM_ACCEPTED'].includes(failure.code ?? '')) {
            setState(s => ({ ...s, pendingAcceptance: null }));
        }
    };
    const acceptReport = useCallback(() => run(async valid => {
        const item = state.selected;
        if (!item || item.status !== 'IN_REVIEW' || state.note.trim() || state.pending || state.pendingAcceptance || item.report.notesTruncated) {
            throw new Error('Revisá el informe y guardá o comprobá los cambios pendientes antes de aceptarlo.');
        }
        const input: AssistantWorkAcceptanceInput = { eventId: crypto.randomUUID(), version: item.version, reportHash: item.report.reportHash };
        persist({ ...state, pendingAcceptance: { id: item.id, input } });
        setState(s => ({ ...s, pendingAcceptance: { id: item.id, input } }));
        try {
            const accepted = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(item.id)}/accept`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(accepted);
        } catch (error) { if (valid()) rejectAcceptance(error); throw error; }
    }), [request, run, state.selected, state.note, state.pending, state.pendingAcceptance]);
    const retryAcceptance = useCallback(() => run(async valid => {
        if (!state.pendingAcceptance) return;
        const { id, input } = state.pendingAcceptance;
        try {
            const accepted = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(accepted);
        } catch (error) { if (valid()) rejectAcceptance(error); throw error; }
    }), [request, run, state.pendingAcceptance]);
    const visible = state.scope === scope && enabled && storageReady ? state : { ...initial, scope };
    return { ...visible, load, open, create, change, retry, acceptReport, retryAcceptance,
        setNote: (note: string) => {
            if (!enabled || state.pending || state.pendingAcceptance || state.storageBlocked) return;
            try { persist({ ...state, note }); setState(s => ({ ...s, note })); }
            catch (error) { setState(s => ({ ...s, note, storageBlocked: true, error: error instanceof Error ? error.message : 'No pudimos conservar la nota.' })); }
        } };
}
export type AssistantWorkItemsController = ReturnType<typeof useAssistantWorkItems>;
