import { useCallback, useEffect, useRef, useState } from 'react';
import { readActivationSession, useActivationSession, type ActivationSession } from '../../hooks/useActivationJourney';
import { AssistantRequestError } from '../../hooks/useNortexAssistant';
import { budgetStatusLabel, budgetUsd, type AssistantBudgetRequestView } from '../assistant/AssistantBudgetPanel';
import { assistantButtonClass, assistantInputClass } from '../assistant/AssistantCatalogSelect';

type Status = AssistantBudgetRequestView['status'];
type AdminRow = AssistantBudgetRequestView & { tenantId: string; businessName: string };
type Page = { requests: AdminRow[]; nextCursor: string | null };
type Decision = { id: string; decision: 'APPROVED' | 'REJECTED'; reason: string };

export function AssistantBudgetRequests() {
    const session = useActivationSession();
    return <RequestsContent key={session.key} session={session} />;
}

function RequestsContent({ session }: { session: ActivationSession; key?: string }) {
    const [status, setStatus] = useState<Status>('PENDING'); const [page, setPage] = useState<Page | null>(null);
    const [review, setReview] = useState<AdminRow | null>(null); const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [uncertain, setUncertain] = useState(false); const [denied, setDenied] = useState(false);
    const alive = useRef(true); const lock = useRef(false); const pending = useRef<Decision | null>(null);
    const controllers = useRef(new Set<AbortController>());
    const current = useCallback(() => alive.current && readActivationSession().key === session.key, [session.key]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controllers.current.forEach(controller => controller.abort()); }; }, []);
    const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
        if (!current() || !session.token) throw new AssistantRequestError('La sesión cambió. Volvé a iniciar sesión.', 401);
        if (!navigator.onLine) throw new AssistantRequestError('Sin conexión. Comprobá el resultado antes de repetir.');
        const controller = new AbortController(); controllers.current.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(`/api/admin/assistant-budget${path}`, { ...options, cache: 'no-store', signal: controller.signal,
                headers: { Authorization: `Bearer ${session.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
            if (!current()) throw new AssistantRequestError('La sesión cambió.', 401);
            const value = await response.json().catch(() => null);
            if (!response.ok) throw new AssistantRequestError(typeof value?.error === 'string' ? value.error : 'No se pudo comprobar la solicitud.', response.status);
            if (!current()) throw new AssistantRequestError('La sesión cambió.', 401);
            return value as T;
        } catch (failure) {
            if (failure instanceof AssistantRequestError) throw failure;
            throw new AssistantRequestError('La conexión se interrumpió. Comprobá el resultado antes de repetir.');
        } finally { clearTimeout(timeout); controllers.current.delete(controller); }
    }, [current, session.token]);
    const handleError = (failure: unknown) => {
        if (!current()) return;
        setPage(null);
        if (failure instanceof AssistantRequestError && [401, 403].includes(failure.status)) {
            setReview(null); setReason(''); pending.current = null; setUncertain(false); setDenied(true); setNotice('');
        }
        setError(failure instanceof Error ? failure.message : 'No pudimos comprobar las solicitudes.');
    };
    const load = async (cursor?: string) => {
        if (lock.current) return; lock.current = true; setBusy(true); setError('');
        try {
            const value = await request<Page>(`/requests?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
            if (current()) {
                setPage(previous => cursor && previous ? { ...value, requests: [...previous.requests, ...value.requests.filter(row => !previous.requests.some(old => old.id === row.id))] } : value);
                setDenied(false);
            }
        } catch (failure) { handleError(failure); }
        finally { lock.current = false; if (current()) setBusy(false); }
    };
    useEffect(() => { void load(); }, [status, request]);
    const decide = async (decision: Decision['decision']) => {
        if (lock.current || denied || !review) return;
        if (!pending.current) {
            if (reason.trim().length < 10 || reason.trim().length > 500) { setError('Escribí un motivo de 10 a 500 caracteres para la decisión.'); return; }
            pending.current = { id: review.id, decision, reason: reason.trim() };
        }
        lock.current = true; setBusy(true); setError(''); setNotice('');
        const exact = pending.current;
        try {
            const result = await request<AssistantBudgetRequestView>(`/requests/${encodeURIComponent(exact.id)}/decision`, {
                method: 'POST', body: JSON.stringify({ decision: exact.decision, reason: exact.reason }),
            });
            if (!current()) return;
            pending.current = null; setUncertain(false); setReview(null); setReason('');
            setPage(previous => previous ? { ...previous, requests: previous.requests.filter(row => row.id !== result.id) } : null);
            setNotice(`Solicitud ${result.id}: ${budgetStatusLabel[result.status]}. No se generó ningún cobro.`);
        } catch (failure) {
            if (!current()) return;
            const definite = failure instanceof AssistantRequestError && failure.status >= 400 && failure.status < 500;
            if (definite) { pending.current = null; setUncertain(false); setReview(null); setReason(''); }
            else setUncertain(true);
            handleError(failure);
        } finally { lock.current = false; if (current()) setBusy(false); }
    };
    return <section aria-label="Solicitudes de presupuesto NortexGPT" className="nx-shell-control space-y-4 rounded-card border p-4">
        <h2 className="nx-shell-text text-lg font-semibold">Presupuesto de NortexGPT</h2>
        <p className="nx-shell-muted text-sm">Revisá aumentos del límite mensual del negocio: base US$2, máximo US$10. La aprobación es recurrente y no cobra al negocio. El límite compartido de Nortex sigue en US$20; aprobar no reserva fondos ni restablece un servicio agotado.</p>
        <div className="flex flex-wrap items-end gap-3">
            <label className="nx-shell-text text-sm">Estado de solicitudes<select className={assistantInputClass} value={status} disabled={busy || uncertain} onChange={event => { setPage(null); setReview(null); setReason(''); setNotice(''); setStatus(event.target.value as Status); }}>
                <option value="PENDING">Pendientes</option><option value="APPROVED">Aprobadas</option><option value="REJECTED">Rechazadas</option>
            </select></label>
            <button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void load()}>Actualizar solicitudes</button>
        </div>
        {busy && <p role="status" className="nx-shell-muted text-sm">Consultando solicitudes…</p>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        {notice && <p role="status" className="nx-shell-text break-words text-sm">{notice}</p>}
        {page && page.requests.length === 0 && <p role="status" className="nx-shell-muted text-sm">No hay solicitudes en este estado.</p>}
        {page && <ul className="space-y-3" aria-label="Solicitudes de negocios">{page.requests.map(row => <li key={row.id} className="nx-shell-border space-y-2 border-t pt-3">
            <h3 className="nx-shell-text font-semibold">{row.businessName}</h3>
            <p className="nx-shell-text text-sm">{budgetUsd(row.requestedUsd)} al mes · {budgetStatusLabel[row.status]}</p>
            <p className="nx-shell-muted break-words text-sm">{row.reason}</p>
            {row.decisionReason && <p className="nx-shell-text break-words text-sm">Decisión: {row.decisionReason}</p>}
            <p className="nx-shell-muted break-all text-xs">Negocio: {row.tenantId} · Solicitud: {row.id}</p>
            {row.status === 'PENDING' && <button type="button" className={assistantButtonClass} disabled={busy || uncertain || denied} onClick={() => { setReview(row); setReason(''); setError(''); }}>Revisar {row.businessName}</button>}
        </li>)}</ul>}
        {page?.nextCursor && <button type="button" className={assistantButtonClass} disabled={busy || uncertain} onClick={() => void load(page.nextCursor!)}>Cargar más solicitudes</button>}
        {review && !denied && <section aria-label="Revisar aumento de presupuesto" className="nx-shell-control space-y-3 rounded-card border p-4">
            <h3 className="nx-shell-text font-semibold">Revisar {review.businessName}</h3>
            <p className="nx-shell-text text-sm">Nuevo límite recurrente: {budgetUsd(review.requestedUsd)} al mes.</p>
            <p className="nx-shell-muted break-words text-sm">Motivo del negocio: {review.reason}</p>
            <p className="nx-shell-muted break-all text-xs">Negocio: {review.tenantId} · Solicitud exacta: {review.id}</p>
            <label className="nx-shell-text block text-sm">Motivo de la decisión<textarea className={assistantInputClass} value={reason} maxLength={500} disabled={busy || uncertain} onChange={event => setReason(event.target.value)} /></label>
            {uncertain ? <>
                <p role="status" className="nx-tone-warning text-sm">La respuesta se perdió. La decisión queda conservada; reintentá la misma decisión para recuperar su resultado.</p>
                <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void decide(pending.current!.decision)}>Reintentar la misma decisión</button>
            </> : <div className="flex flex-wrap gap-2">
                <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void decide('APPROVED')}>Confirmar aprobación sin cobro</button>
                <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void decide('REJECTED')}>Confirmar rechazo</button>
                <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => { setReview(null); setReason(''); }}>Cerrar revisión</button>
            </div>}
        </section>}
    </section>;
}
