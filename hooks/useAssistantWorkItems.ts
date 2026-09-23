import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantRequest } from './useNortexAssistant';
import type { AssistantWorkItemDTO, AssistantWorkItemEventInput, AssistantWorkItemListDTO } from '../shared/assistantWorkItems';

const initial = { items: [] as AssistantWorkItemListDTO['items'], nextCursor: null as string | null,
    selected: null as AssistantWorkItemDTO | null, note: '', error: '', busy: false,
    pending: null as { id: string; input: AssistantWorkItemEventInput } | null };

/** Estado privado en memoria; cada confirmación auxiliar tiene identidad durable en el servidor. */
export function useAssistantWorkItems(request: AssistantRequest, scope: string, enabled: boolean) {
    const [state, setState] = useState({ ...initial, scope });
    const current = useRef({ scope, enabled }); current.current = { scope, enabled };
    const epoch = useRef(0); const busy = useRef(false);
    useEffect(() => { epoch.current++; busy.current = false; setState({ ...initial, scope }); }, [scope, enabled]);
    const run = useCallback(async (action: (valid: () => boolean) => Promise<void>) => {
        if (!enabled || busy.current) return false;
        const generation = epoch.current;
        const valid = () => current.current.enabled && current.current.scope === scope && epoch.current === generation;
        busy.current = true; setState(s => ({ ...s, busy: true, error: '' }));
        try { await action(valid); return valid(); }
        catch (error) { if (valid()) setState(s => ({ ...s, error: error instanceof Error ? error.message : 'No pudimos comprobar el trabajo.' })); return false; }
        finally { if (valid()) { busy.current = false; setState(s => ({ ...s, busy: false })); } }
    }, [scope, enabled]);
    useEffect(() => () => { epoch.current++; }, []);
    const accept = (item: AssistantWorkItemDTO) => setState(s => {
        const acknowledged = s.pending?.id === item.id && (item.receiptEventId === s.pending?.input.eventId || item.events.some(event => event.id === s.pending?.input.eventId));
        return { ...s, selected: item, items: [item, ...s.items.filter(row => row.id !== item.id)],
            ...(acknowledged ? { pending: null, note: s.pending?.input.type === 'ADD_NOTE' ? '' : s.note } : {}) };
    });
    const load = useCallback((more = false) => run(async valid => {
        const result = await request<AssistantWorkItemListDTO>(`/work-items${more && state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : ''}`);
        if (valid()) setState(s => ({ ...s, items: more ? [...new Map([...s.items, ...result.items].map(item => [item.id, item])).values()] : result.items, nextCursor: result.nextCursor }));
    }), [request, run, state.nextCursor]);
    const open = useCallback((id: string) => run(async valid => {
        if ((state.note.trim() || state.pending) && state.selected?.id !== id) throw new Error('Guardá tu nota o comprobá el envío pendiente antes de abrir otro trabajo.');
        const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}`);
        if (valid()) accept(item);
    }), [request, run, state.note, state.pending, state.selected?.id]);
    const create = useCallback((runId: string) => run(async valid => {
        if (state.note.trim() || state.pending) throw new Error('Conservá primero la nota o el envío pendiente del trabajo actual.');
        const item = await request<AssistantWorkItemDTO>('/work-items', { method: 'POST', body: JSON.stringify({ runId }) });
        if (valid()) accept(item);
    }), [request, run, state.note, state.pending]);
    const rejectPending = (error: unknown) => {
        const failure = error as { status?: number; code?: string };
        if (failure.status === 409 && ['WORK_ITEM_CHANGED', 'WORK_ITEM_TRANSITION', 'WORK_ITEM_CANCELLED', 'WORK_ITEM_EVENT_CONFLICT'].includes(failure.code ?? '')) setState(s => ({ ...s, pending: null }));
    };
    const change = useCallback((type: AssistantWorkItemEventInput['type']) => run(async valid => {
        if (!state.selected) return;
        if (state.pending) throw new Error('Comprobá o reintentá el envío pendiente con su misma referencia.');
        if (state.note.trim() && type !== 'ADD_NOTE') throw new Error('Guardá la nota antes de cambiar el estado.');
        const input: AssistantWorkItemEventInput = { eventId: crypto.randomUUID(), version: state.selected.version,
            ...(type === 'ADD_NOTE' ? { type, note: state.note.trim() } : { type }) };
        const id = state.selected.id;
        setState(s => ({ ...s, pending: { id, input } }));
        try {
            const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(item);
        } catch (error) { if (valid()) rejectPending(error); throw error; }
    }), [request, run, state.selected, state.pending, state.note]);
    const retry = useCallback(() => run(async valid => {
        if (!state.pending) return;
        const { id, input } = state.pending;
        try {
            const item = await request<AssistantWorkItemDTO>(`/work-items/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(input) });
            if (valid()) accept(item);
        } catch (error) { if (valid()) rejectPending(error); throw error; }
    }), [request, run, state.pending]);
    const visible = state.scope === scope && enabled ? state : { ...initial, scope };
    return { ...visible, load, open, create, change, retry,
        setNote: (note: string) => { if (enabled && !state.pending) setState(s => ({ ...s, note })); } };
}
export type AssistantWorkItemsController = ReturnType<typeof useAssistantWorkItems>;
