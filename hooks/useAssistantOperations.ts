import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantRequest } from './useNortexAssistant';
import type { AssistantActionProposalDTO, AssistantDailyBriefDTO, AssistantJsonObject, AssistantRunDTO } from '../shared/assistantOperations';
const initial = { runs: {} as Record<string, AssistantRunDTO>, brief: null as AssistantDailyBriefDTO | null, proposal: null as AssistantActionProposalDTO | null, draft: null as AssistantJsonObject | null, dirty: false, uncertain: false, busy: false, error: '' };
const post = (body: unknown = {}) => ({ method: 'POST', body: JSON.stringify(body) });
/** El estado privado se invalida con la identidad/alcance; una respuesta tardía nunca repuebla otra sesión. */
export function useAssistantOperations(request: AssistantRequest, scope: string, enabled: boolean, runIds: string[]) {
    const [state, setState] = useState({ ...initial, scope });
    const generation = useRef(0); const activeScope = useRef(scope); activeScope.current = scope;
    const terminalRuns = useRef(new Set<string>());
    const lock = useRef(false); const confirmation = useRef<{ id: string; version: number; key: string } | null>(null);
    useEffect(() => { generation.current++; terminalRuns.current.clear(); lock.current = false; confirmation.current = null; setState({ ...initial, scope }); }, [scope]);
    const update = useCallback((patch: Partial<typeof initial>, epoch: number) => { if (generation.current === epoch && activeScope.current === scope) setState(previous => ({ ...previous, ...patch, scope })); }, [scope]);
    const execute = useCallback(async (task: (epoch: number) => Promise<void>) => {
        if (!enabled || lock.current) return; const epoch = generation.current; lock.current = true; update({ busy: true, error: '' }, epoch);
        try { await task(epoch); } catch { update({ error: 'No pudimos completar la consulta. Tu revisión sigue aquí; comprobá el resultado antes de repetir.' }, epoch); }
        finally { if (generation.current === epoch) { lock.current = false; update({ busy: false }, epoch); } }
    }, [enabled, update]);
    const mergeRun = useCallback((run: AssistantRunDTO, epoch: number) => {
        if (epoch !== generation.current || activeScope.current !== scope) return;
        setState(previous => {
            if ((previous.runs[run.id]?.version ?? -1) > run.version) return previous;
            if (['PENDING', 'RUNNING'].includes(run.status)) terminalRuns.current.delete(run.id); else terminalRuns.current.add(run.id);
            return { ...previous, runs: { ...previous.runs, [run.id]: run } };
        });
    }, [scope]);
    const refreshRun = useCallback(async (id: string) => {
        const epoch = generation.current;
        try { const run = await request<AssistantRunDTO>(`/runs/${encodeURIComponent(id)}`); mergeRun(run, epoch); }
        catch { update({ error: 'No pudimos comprobar el avance. Podés retomar la misma consulta.' }, epoch); }
    }, [mergeRun, request, update]);
    const ids = runIds.join('|');
    useEffect(() => {
        if (!enabled) return; let stopped = false; let timer: ReturnType<typeof setTimeout>;
        const poll = async () => { for (const id of ids.split('|').filter(Boolean)) { if (stopped) return; if (!terminalRuns.current.has(id)) await refreshRun(id); } if (!stopped) timer = setTimeout(poll, 3000); };
        void poll(); return () => { stopped = true; clearTimeout(timer); };
    }, [enabled, ids, refreshRun]);
    const changeRun = useCallback((id: string, action: 'cancel' | 'recover') => execute(async epoch => {
        try {
            const run = await request<AssistantRunDTO>(`/runs/${encodeURIComponent(id)}/${action}`, post(action === 'cancel' ? { version: state.runs[id]?.version } : {}));
            mergeRun(run, epoch);
        } catch (error) { await refreshRun(id); throw error; }
    }), [execute, mergeRun, refreshRun, request, state.runs]);
    const loadBrief = useCallback(() => execute(async epoch => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        if (state.brief?.localDay === day) return;
        update({ brief: await request<AssistantDailyBriefDTO>('/daily-brief') }, epoch);
    }), [execute, request, state.brief, update]);
    const dismiss = useCallback((itemId: string) => execute(async epoch => {
        if (!state.brief) return; const brief = await request<AssistantDailyBriefDTO>(`/daily-brief/${encodeURIComponent(state.brief.id)}/dismiss`, post({ itemId })); update({ brief }, epoch);
    }), [execute, request, state.brief, update]);
    const accept = useCallback((proposal: AssistantActionProposalDTO, epoch: number) => {
        if (epoch !== generation.current || activeScope.current !== scope) return;
        update({ proposal, draft: proposal.draft, dirty: false, uncertain: false }, epoch); confirmation.current = null;
    }, [scope, update]);
    const openProposal = useCallback((id: string) => execute(async epoch => {
        if (state.dirty || state.uncertain) { if (state.proposal?.id !== id) update({ error: 'Guardá la revisión actual o comprobá su resultado antes de abrir otra.' }, epoch); return; }
        accept(await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(id)}`), epoch);
    }), [accept, execute, request, state.dirty, state.proposal, state.uncertain, update]);
    const edit = useCallback((draft: AssistantJsonObject) => { if (!state.uncertain && !lock.current) { confirmation.current = null; update({ draft, dirty: true }, generation.current); } }, [state.uncertain, update]);
    const preview = useCallback(() => execute(async epoch => {
        if (!state.proposal || !state.draft || state.uncertain) return;
        let proposal = state.proposal;
        if (state.dirty) { proposal = await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(proposal.id)}`, { method: 'PATCH', body: JSON.stringify({ version: proposal.version, draft: state.draft }) }); accept(proposal, epoch); }
        accept(await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(proposal.id)}/preview`, post({ version: proposal.version })), epoch);
    }), [accept, execute, request, state.dirty, state.draft, state.proposal, state.uncertain]);
    const confirm = useCallback(() => execute(async epoch => {
        const proposal = state.proposal; if (!proposal || state.dirty || proposal.status !== 'READY') return;
        if (!confirmation.current || confirmation.current.id !== proposal.id || confirmation.current.version !== proposal.version) confirmation.current = { id: proposal.id, version: proposal.version, key: crypto.randomUUID() };
        update({ uncertain: true }, epoch);
        try {
            await request(`/action-proposals/${encodeURIComponent(proposal.id)}/confirm`, post({ version: proposal.version, requestKey: confirmation.current.key }));
            const refreshed = await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(proposal.id)}`);
            if (refreshed.result) { accept(refreshed, epoch); window.dispatchEvent(new Event('nortex:data-changed')); }
            else update({ error: 'Esperamos el comprobante. Conservamos esta referencia para comprobar el resultado.' }, epoch);
        } catch (error) {
            try { const refreshed = await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(proposal.id)}`); if (refreshed.result) { accept(refreshed, epoch); return; } } catch { /* La ausencia de comprobante no acredita que no se ejecutó. */ }
            const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
            if ([400, 409, 410, 422, 423].includes(status)) update({ uncertain: false }, epoch);
            throw error;
        }
    }), [accept, execute, request, state.dirty, state.proposal, update]);
    const recover = useCallback(() => execute(async epoch => {
        if (!state.proposal) return; const proposal = await request<AssistantActionProposalDTO>(`/action-proposals/${encodeURIComponent(state.proposal.id)}`);
        if (proposal.result) accept(proposal, epoch); else update({ error: 'Todavía no hay comprobante. Conservamos la misma referencia; no prepares otra operación.' }, epoch);
    }), [accept, execute, request, state.proposal, update]);
    return { ...(state.scope === scope && enabled ? state : { ...initial, scope }), refreshRun, changeRun, loadBrief, dismiss, openProposal, edit, preview, confirm, recover };
}
export type AssistantOperationsController = ReturnType<typeof useAssistantOperations>;
