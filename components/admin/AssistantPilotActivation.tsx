import { useCallback, useRef, useState } from 'react';
import { readActivationSession, useActivationSession } from '../../hooks/useActivationJourney';
import { assistantButtonClass, assistantInputClass } from '../assistant/AssistantCatalogSelect';
import { formatMoney } from '../../utils/money';

type PilotAccount = {
  email: string; userId: string; tenantId: string; businessName: string; role: string;
  userStatus: string; eligible: boolean; helpReleaseReady: boolean; manifestHash: string;
  config: null | { enabled: boolean; effectiveBudgetUsd: string; extractionEnabled: boolean;
    executionEnabled: boolean; operationsEnabled: boolean; actionsEnabled: boolean;
    promotionsEnabled: boolean; privateWhatsappEnabled: boolean };
};
type ChangeResult = { changed: boolean; enabled: boolean; budgetUsd: string | null };

export function AssistantPilotActivation() {
  const session = useActivationSession();
  const [email, setEmail] = useState(''); const [account, setAccount] = useState<PilotAccount | null>(null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const current = useCallback(() => readActivationSession().key === session.key && Boolean(session.token), [session.key, session.token]);
  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    if (!current() || !navigator.onLine) throw new Error('La sesión o la conexión cambió. Consultá el estado antes de continuar.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/admin/assistant-pilot${path}`, { ...options, cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${session.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      if (!current()) throw new Error('La sesión cambió. Volvé a iniciar sesión.');
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'No se pudo verificar la cuenta.');
      return value as T;
    } finally { window.clearTimeout(timeout); }
  }, [current, session.token]);
  const inspect = async (targetEmail = email) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setAccount(null);
    try {
      const found = await request<PilotAccount>(`/account?email=${encodeURIComponent(targetEmail.trim().toLowerCase())}`);
      if (current()) setAccount(found);
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : 'No se pudo revisar la cuenta.'); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const change = async (mode: 'enable' | 'disable') => {
    if (lock.current || !account || reason.trim().length < 10 || reason.trim().length > 500) {
      setError('Escribí un motivo de 10 a 500 caracteres y volvé a revisar la cuenta.'); return;
    }
    const target = account;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setAccount(null);
    try {
      const result = await request<ChangeResult>(`/${mode}`, { method: 'POST', body: JSON.stringify({
        email: target.email, tenantId: target.tenantId, userId: target.userId,
        expectedRole: 'ADMIN', manifestHash: target.manifestHash, reason: reason.trim(), acknowledged: true,
      }) });
      if (current()) setNotice(`${target.businessName}: ${result.enabled ? 'piloto activo' : 'piloto desactivado'} · límite ${formatMoney(result.budgetUsd ?? '0', 'USD')}. ${result.changed ? 'Cambio registrado.' : 'Sin cambios.'} Volvé a consultar la cuenta para comprobar el estado.`);
    } catch (failure) {
      if (current()) setError(`${failure instanceof Error ? failure.message : 'No se pudo confirmar el cambio.'} El resultado puede ser incierto: consultá la cuenta antes de repetir.`);
    } finally { lock.current = false; if (current()) setBusy(false); }
  };
  const guarded = account?.config && [account.config.extractionEnabled, account.config.executionEnabled,
    account.config.operationsEnabled, account.config.actionsEnabled, account.config.promotionsEnabled,
    account.config.privateWhatsappEnabled].some(Boolean);
  return <section aria-label="Pilotos de NortexGPT" className="nx-shell-surface my-4 space-y-3 rounded-card border p-4">
    <h2 className="nx-shell-text text-lg font-semibold">Pilotos de NortexGPT</h2>
    <p className="nx-shell-muted text-sm">Activá sólo una de las dos cuentas del primer piloto, con ayuda publicada y límite de US$2 mensuales. El servidor rechaza cualquier otro negocio. La activación permite conversación web; no habilita operaciones, extracción ni WhatsApp.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="nx-shell-text text-sm">Correo exacto de la cuenta<input type="email" className={assistantInputClass} value={email} disabled={busy}
        onChange={event => { setEmail(event.target.value); setAccount(null); setError(''); setNotice(''); }} /></label>
      <button type="button" className={assistantButtonClass} disabled={busy || !email.trim()} onClick={() => void inspect()}>Revisar cuenta</button>
    </div>
    {busy && <p role="status" className="nx-shell-muted text-sm">Comprobando…</p>}
    {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
    {notice && <p role="status" className="nx-shell-text text-sm">{notice}</p>}
    {account && <div className="nx-shell-control space-y-2 rounded-control border p-3">
      <p className="nx-shell-text text-sm"><strong>{account.businessName}</strong> · {account.email} · {account.role} · {account.userStatus}</p>
      <p className="nx-shell-muted break-all text-xs">Negocio {account.tenantId} · Cuenta {account.userId}</p>
      <p className="nx-shell-text text-sm">Ayuda publicada: {account.helpReleaseReady ? 'sí' : 'no'} · Piloto: {account.config?.enabled ? 'activo' : 'apagado'} · Límite: {formatMoney(account.config?.effectiveBudgetUsd ?? '2', 'USD')}/mes</p>
      <p className="nx-shell-muted break-all text-xs">Manifiesto exacto: {account.manifestHash}</p>
      {guarded && <p role="alert" className="nx-tone-warning text-sm">Esta cuenta tiene capacidades adicionales; no se puede activar como primer piloto.</p>}
      <label className="nx-shell-text block text-sm">Motivo de la decisión<textarea className={assistantInputClass} value={reason} disabled={busy}
        onChange={event => setReason(event.target.value)} maxLength={500} /></label>
      <div className="flex flex-wrap gap-2">
        {!account.config?.enabled && <button type="button" className={assistantButtonClass}
          disabled={busy || !account.eligible || !account.helpReleaseReady || !!guarded || reason.trim().length < 10}
          onClick={() => void change('enable')}>Activar sólo este negocio</button>}
        {account.config?.enabled && <button type="button" className={assistantButtonClass} disabled={busy || reason.trim().length < 10}
          onClick={() => void change('disable')}>Desactivar este negocio</button>}
      </div>
    </div>}
  </section>;
}
