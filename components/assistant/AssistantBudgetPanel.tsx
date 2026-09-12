import { useEffect, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { AssistantRequestError, type AssistantRequest } from '../../hooks/useNortexAssistant';
import { formatMoney } from '../../utils/money';
import { assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';

export interface AssistantBudgetRequestView {
    id: string; requestedUsd: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: string; decidedAt: string | null; decisionReason: string | null;
}
export interface AssistantBudgetView {
    month: string; limitUsd: string; spentUsd: string; reservedUsd: string; remainingUsd: string;
    blocked: boolean; canRequest: boolean; maxLimitUsd: string; requests: AssistantBudgetRequestView[];
    platformAvailable: boolean; availabilityReason: null | 'NOT_ENABLED' | 'PLATFORM_LIMIT' | 'REVIEW_REQUIRED' | 'TENANT_LIMIT';
}
export const budgetStatusLabel = { PENDING: 'Pendiente de Nortex', APPROVED: 'Aprobada', REJECTED: 'Rechazada' };
export const budgetUsd = (value: string) => formatMoney(value, 'USD', { decimals: Math.max(2, new Decimal(value).decimalPlaces()) });
type PendingRequest = { idempotencyKey: string; requestedUsd: string; reason: string };

/** El montaje con clave descarta respuestas y formularios de otra sesión. */
export function AssistantBudgetPanel({ request, sessionKey }: { request: AssistantRequest; sessionKey: string }) {
    return <BudgetContent key={sessionKey} request={request} />;
}

function BudgetContent({ request }: { request: AssistantRequest; key?: string }) {
    const [budget, setBudget] = useState<AssistantBudgetView | null>(null);
    const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [uncertain, setUncertain] = useState(false); const [denied, setDenied] = useState(false);
    const pending = useRef<PendingRequest | null>(null); const lock = useRef(false); const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const handleError = (failure: unknown) => {
        if (!alive.current) return;
        setBudget(null);
        if (failure instanceof AssistantRequestError && [401, 403].includes(failure.status)) {
            pending.current = null; setUncertain(false); setDenied(true); setAmount(''); setReason(''); setNotice('');
        }
        setError(failure instanceof Error ? failure.message : 'No pudimos comprobar el presupuesto.');
    };
    const refresh = async () => {
        if (lock.current) return; lock.current = true; setBusy(true); setError('');
        try { const value = await request<AssistantBudgetView>('/budget'); if (alive.current) { setBudget(value); setDenied(false); } }
        catch (failure) { handleError(failure); }
        finally { lock.current = false; if (alive.current) setBusy(false); }
    };
    useEffect(() => { void refresh(); }, [request]);
    const submit = async () => {
        if (lock.current || denied) return;
        if (!pending.current) {
            if (!budget?.canRequest) return;
            if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(amount) || new Decimal(amount).lte(2)
                || new Decimal(amount).lte(budget.limitUsd) || new Decimal(amount).gt(budget.maxLimitUsd)
                || reason.trim().length < 10 || reason.trim().length > 500) {
                setError('Ingresá un límite mayor al actual y de hasta US$10, y un motivo de 10 a 500 caracteres.'); return;
            }
            pending.current = { idempotencyKey: crypto.randomUUID(), requestedUsd: new Decimal(amount).toFixed(2), reason: reason.trim() };
        }
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            const result = await request<AssistantBudgetRequestView>('/budget/requests', { method: 'POST', body: JSON.stringify(pending.current) });
            if (!alive.current) return;
            pending.current = null; setUncertain(false); setAmount(''); setReason('');
            setNotice(`Solicitud ${result.id}: ${budgetStatusLabel[result.status]}.`);
            setBudget(previous => previous ? { ...previous, canRequest: false, requests: [result, ...previous.requests.filter(row => row.id !== result.id)] } : null);
            const latest = await request<AssistantBudgetView>('/budget');
            if (alive.current) setBudget(latest);
        } catch (failure) {
            if (!alive.current) return;
            const definite = failure instanceof AssistantRequestError && failure.status >= 400 && failure.status < 500;
            if (definite) { pending.current = null; setUncertain(false); }
            else setUncertain(pending.current !== null);
            handleError(failure);
        } finally { lock.current = false; if (alive.current) setBusy(false); }
    };
    const availability = budget?.availabilityReason;
    return <section aria-label="Presupuesto de NortexGPT" className="nx-shell-control space-y-3 rounded-card border p-4">
        <h3 className="nx-shell-text font-semibold">Uso de NortexGPT</h3>
        <p className="nx-shell-muted text-sm">Base: US$2 al mes por negocio. Un aumento aprobado por Nortex se mantiene cada mes, hasta US$10. Solicitarlo o aprobarlo no genera cobros automáticos.</p>
        {busy && <p role="status" className="nx-shell-muted text-sm">Comprobando presupuesto…</p>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        {notice && <p role="status" className="nx-shell-text break-words text-sm">{notice}</p>}
        {budget && <>
            <p className="nx-shell-muted text-xs">Mes {budget.month} · corte de Managua</p>
            <dl className="nx-shell-text grid grid-cols-2 gap-3 text-sm">
                <div><dt>Límite mensual</dt><dd>{budgetUsd(budget.limitUsd)}</dd></div>
                <div><dt>Consumo confirmado</dt><dd>{budgetUsd(budget.spentUsd)}</dd></div>
                <div><dt>Reservado</dt><dd>{budgetUsd(budget.reservedUsd)}</dd></div>
                <div><dt>Saldo del negocio</dt><dd>{budgetUsd(budget.remainingUsd)}</dd></div>
            </dl>
            <p className="nx-shell-muted text-xs">Las reservas incluyen llamadas pendientes o de costo incierto; siguen retenidas hasta su conciliación. El saldo no garantiza una consulta: primero se reserva su costo máximo.</p>
            {(availability === 'PLATFORM_LIMIT' || !budget.platformAvailable) && <p role="status" className="nx-tone-warning text-sm">El presupuesto compartido de Nortex no permite nuevas llamadas. Aumentar el límite de tu negocio no restablece el servicio ahora.</p>}
            {availability === 'NOT_ENABLED' && <p role="status" className="nx-tone-warning text-sm">NortexGPT aún no está habilitado para este negocio.</p>}
            {(availability === 'REVIEW_REQUIRED' || budget.blocked) && <p role="status" className="nx-tone-warning text-sm">Nortex debe revisar el consumo antes de habilitar nuevas llamadas.</p>}
            {availability === 'TENANT_LIMIT' && <p role="status" className="nx-tone-warning text-sm">El saldo del negocio no alcanza para reservar otra consulta.</p>}
            {budget.requests.length > 0 && <ul className="space-y-2" aria-label="Tus solicitudes">{budget.requests.map(row => <li key={row.id} className="nx-shell-border border-t pt-2 text-sm">
                <p className="nx-shell-text">{budgetUsd(row.requestedUsd)} al mes · {budgetStatusLabel[row.status]}</p>
                <p className="nx-shell-muted break-words">{row.reason}</p>
                {row.decisionReason && <p className="nx-shell-text break-words">Respuesta de Nortex: {row.decisionReason}</p>}
                <p className="nx-shell-muted break-all text-xs">Referencia: {row.id}</p>
            </li>)}</ul>}
        </>}
        <p className="nx-shell-muted text-xs">La plataforma conserva un límite compartido de US$20 al mes. Las funciones habituales de Nortex siguen disponibles cuando se agota la IA.</p>
        {!denied && (budget?.canRequest || uncertain) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
            <label className="nx-shell-text block text-sm">Nuevo límite mensual en US$<input className={assistantInputClass} inputMode="decimal" value={amount} disabled={busy || uncertain} onChange={event => setAmount(event.target.value)} /></label>
            <label className="nx-shell-text block text-sm">Motivo del aumento<textarea className={assistantInputClass} value={reason} maxLength={500} disabled={busy || uncertain} onChange={event => setReason(event.target.value)} /></label>
            {uncertain && <p role="status" className="nx-tone-warning text-sm">La respuesta se perdió. Conservamos la misma solicitud; consultá el estado o reintentá ese envío sin cambiar el contenido.</p>}
            <button type="submit" disabled={busy} className={assistantButtonClass}>{uncertain ? 'Reintentar la misma solicitud' : 'Solicitar aumento a Nortex'}</button>
        </form>}
        <button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void refresh()}>Consultar estado del presupuesto</button>
    </section>;
}
