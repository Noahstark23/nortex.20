import React, { useEffect, useRef, useState } from 'react';
import { readActivationSession, useActivationSession } from '../../hooks/useActivationJourney';

type Preview = { previewId: string; requestKey: string; businessName: string; expiresAt: string; counts: Record<string, number> };
type Attempt = { requestKey: string; preview?: Preview };
type Phase = 'idle' | 'loading' | 'review' | 'submitting' | 'uncertain' | 'applied';
const base = '/api/billing/demo-reset';
const labels: Record<string, string> = { sales: 'ventas', purchases: 'compras', products: 'productos',
  customers: 'clientes', suppliers: 'proveedores', employees: 'empleados', users: 'usuarios', expenses: 'gastos',
  journals: 'asientos contables', warehouses: 'bodegas' };

export default function DemoAccountReset() {
  const session = useActivationSession();
  return <DemoResetSession key={session.key} session={session} />;
}
const DemoResetSession: React.FC<{ session: ReturnType<typeof readActivationSession> }> = ({ session }) => {
  let userId = 'unknown';
  try { userId = JSON.parse(localStorage.getItem('nortex_user') ?? '{}')?.id ?? userId; } catch { /* El servidor verifica al dueño. */ }
  const storageKey = 'nortex_demo_reset:' + session.tenantId + ':' + userId;
  const [eligible, setEligible] = useState(false);
  const [eligibilityRefresh, setEligibilityRefresh] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [testData, setTestData] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const current = () => readActivationSession().key === session.key;
  const headers = { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' };
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Attempt | null;
      if (saved?.requestKey) { setAttempt(saved); setPhase('uncertain'); }
    } catch { setError('No se pudo recuperar el intento guardado.'); }
    if (session.token) void fetch(base, { headers, signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (mounted && current()) {
        setEligible(response.ok && body.eligible === true);
        if (response.status >= 500) setError('No se pudo comprobar si tu cuenta permite el reinicio.');
      }
    }).catch(() => { if (mounted && current()) setError('No se pudo comprobar si tu cuenta permite el reinicio.'); });
    return () => { mounted = false; controller.abort(); };
  }, [session.key, eligibilityRefresh]);
  useEffect(() => {
    const open = ['review', 'submitting', 'uncertain', 'applied'].includes(phase);
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [phase]);
  function save(value: Attempt) {
    // Sin una identidad persistida no se envía una operación que pueda quedar incierta.
    localStorage.setItem(storageKey, JSON.stringify(value));
    setAttempt(value);
  }
  async function request(path: string, body?: unknown) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!current()) throw new Error('La sesión cambió.');
    return { response, data };
  }
  function applied(data: any, key: string) {
    return data?.status === 'APPLIED' && data.requestKey === key && data.loginRequired === true;
  }
  async function begin() {
    if (busy.current || !eligible || !current()) return;
    busy.current = true; setError(''); setPhase('loading');
    const next = { requestKey: crypto.randomUUID() };
    let persisted = false;
    try {
      save(next); persisted = true;
      const { response, data } = await request('/preview', next);
      if (!response.ok) throw new Error(data.error || 'No se pudo revisar el reinicio.');
      if (!data.previewId || data.requestKey !== next.requestKey || !data.counts
          || Object.keys(labels).some(key => !Number.isSafeInteger(data.counts[key]) || data.counts[key] < 0)) {
        throw new Error('La revisión recibida está incompleta.');
      }
      save({ ...next, preview: data }); setPhase('review');
    } catch (failure: any) {
      if (current()) {
        // La revisión nunca envía una confirmación: se puede cancelar aunque haya fallado su respuesta.
        try { if (persisted) localStorage.removeItem(storageKey); setAttempt(null); setPhase('idle'); }
        catch { setPhase('uncertain'); }
        setError(failure.message);
      }
    } finally { busy.current = false; }
  }
  async function check() {
    if (!attempt || busy.current || !current()) return;
    busy.current = true; setError('');
    try {
      const { response, data } = await request('/receipts/' + attempt.requestKey);
      if (!response.ok) throw new Error(data.error || 'No se pudo verificar el intento.');
      if (applied(data, attempt.requestKey)) { setPassword(''); setPhase('applied'); return; }
      if (data.status === 'EXPIRED' && data.requestKey === attempt.requestKey) {
        setPassword(''); setError('La revisión venció sin aplicar el reinicio. Cancelá y volvé a revisar los datos.'); setPhase('review'); return;
      }
      if (data.status !== 'PREVIEWED' || data.requestKey !== attempt.requestKey) throw new Error('No se recibió un resultado verificable.');
      // Recuperar la MISMA revisión y UUID; nunca iniciar otro reinicio para resolver un timeout.
      const review = await request('/preview', { requestKey: attempt.requestKey });
      if (!review.response.ok) throw new Error(review.data.error || 'No se pudo recuperar la revisión.');
      save({ requestKey: attempt.requestKey, preview: review.data }); setPhase('review');
    } catch (failure: any) { if (current()) setError(failure.message); }
    finally { busy.current = false; }
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!attempt?.preview || busy.current || !current() || !testData || confirmation !== 'REINICIAR' || !password) return;
    busy.current = true; setError(''); setPhase('submitting');
    try {
      const { response, data } = await request('/confirm', { requestKey: attempt.requestKey,
        previewId: attempt.preview.previewId, password, confirmation, confirmedTestData: true });
      if (response.ok && applied(data, attempt.requestKey)) { setPassword(''); setPhase('applied'); return; }
      if (!response.ok && response.status < 500) {
        const receipt = await request('/receipts/' + attempt.requestKey);
        if (receipt.response.ok && applied(receipt.data, attempt.requestKey)) { setPassword(''); setPhase('applied'); return; }
        setError(data.error || 'El servidor rechazó este reinicio.'); setPhase('review'); return;
      }
      throw new Error('No se pudo confirmar el resultado. Verificá este intento antes de continuar.');
    } catch (failure: any) { if (current()) { setError(failure.message); setPhase('uncertain'); } }
    finally { busy.current = false; }
  }
  function cancel() {
    if (phase !== 'review' || busy.current) return;
    try { localStorage.removeItem(storageKey); }
    catch { setError('No se pudo cerrar la revisión guardada.'); return; }
    setPassword(''); setConfirmation(''); setTestData(false); setAttempt(null); setPhase('idle');
  }
  function login() {
    if (!current()) return;
    try {
      localStorage.removeItem(storageKey);
      for (const key of ['nortex_token', 'nortex_user', 'nortex_tenant_id']) localStorage.removeItem(key);
    } catch { setError('La cuenta ya se reinició. Cerrá esta sesión y volvé a entrar.'); return; }
    window.location.assign('/login');
  }
  if (!eligible && !attempt && !error) return null;
  const locked = phase === 'submitting' || phase === 'uncertain' || phase === 'applied';
  return <section className="mb-6 rounded-xl border border-surface-600 bg-surface-900 p-5" aria-label="Reinicio de cuenta de prueba">
    <h2 className="text-lg font-semibold text-slate-100">Empezar de nuevo durante la prueba</h2>
    <p className="mt-2 text-sm text-slate-300">Si cargaste datos equivocados, podés reiniciar la cuenta demo antes de pagar.</p>
    {error && phase === 'idle' && <p role="alert" className="mt-3 text-slate-100">{error}</p>}
    {!eligible && !attempt && error && <button type="button" onClick={() => { setError(''); setEligibilityRefresh(value => value + 1); }} className="nx-form-field mt-3 rounded-lg border px-4 py-2">Volver a comprobar</button>}
    <button type="button" disabled={!eligible || phase !== 'idle'} onClick={begin}
      className="nx-form-field mt-4 rounded-lg border border-surface-500 px-4 py-2 text-slate-100 disabled:opacity-50">
      {phase === 'loading' ? 'Revisando datos…' : 'Reiniciar cuenta demo'}
    </button>
    <dialog ref={dialog} aria-labelledby="demo-reset-title" aria-describedby="demo-reset-description"
      onCancel={event => { event.preventDefault(); if (!locked) cancel(); }}
      className="max-h-[90vh] w-[min(36rem,92vw)] overflow-y-auto rounded-xl border border-surface-500 bg-surface-900 p-6 text-slate-100 backdrop:bg-black/70">
      <h2 id="demo-reset-title" className="text-xl font-semibold">{phase === 'applied' ? 'Cuenta demo reiniciada' : 'Revisá antes de reiniciar'}</h2>
      {phase === 'applied' ? <>
        <p id="demo-reset-description" className="mt-3">Tu cuenta está lista para cargar los productos correctos. Entrá con el mismo correo y contraseña.</p>
        <button type="button" onClick={login} className="nx-form-field mt-5 rounded-lg border px-4 py-2">Volver a entrar</button>
      </> : <>
        <p id="demo-reset-description" className="mt-3">Se retirarán todos los datos de prueba de {attempt?.preview?.businessName ?? 'tu cuenta'}: ventas, compras, productos, inventario, clientes, proveedores y demás operaciones.</p>
        {attempt?.preview && <ul className="my-4 grid grid-cols-2 gap-2">
          {Object.entries(labels).map(([key, label]) => <li key={key}>{attempt.preview!.counts[key]} {label}</li>)}
        </ul>}
        <p className="text-sm text-slate-300">Se conserva el acceso del dueño y la configuración del negocio. Los demás usuarios pierden acceso. La prueba mantiene su fecha de vencimiento y su presupuesto de IA.</p>
        <p className="mt-2 text-sm text-slate-300">Nortex conserva el espacio anterior desactivado como registro del reinicio.</p>
        {error && <p role="alert" className="my-3">{error}</p>}
        {phase === 'uncertain' ? <>
          <p role="status" className="mt-4">Hay un intento pendiente de verificar. Mantenemos su identificación para evitar repetirlo.</p>
          <button type="button" onClick={check} className="nx-form-field mt-4 rounded-lg border px-4 py-2">Verificar resultado</button>
        </> : <form onSubmit={confirm} className="mt-5 space-y-4">
          <label className="flex gap-2"><input type="checkbox" checked={testData} disabled={locked} onChange={event => setTestData(event.target.checked)} />
            Confirmo que son datos de prueba que quiero retirar.</label>
          <label className="block">Escribí REINICIAR
            <input className="nx-form-field mt-1 w-full rounded-lg border p-2" value={confirmation} disabled={locked} autoComplete="off" onChange={event => setConfirmation(event.target.value)} />
          </label>
          <label className="block">Tu contraseña
            <input type="password" autoComplete="current-password" className="nx-form-field mt-1 w-full rounded-lg border p-2" value={password} disabled={locked} onChange={event => setPassword(event.target.value)} />
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={cancel} disabled={locked} className="nx-form-field rounded-lg border px-4 py-2">Cancelar</button>
            <button type="submit" disabled={locked || !testData || confirmation !== 'REINICIAR' || !password} className="nx-form-field rounded-lg border px-4 py-2 disabled:opacity-50">
              {phase === 'submitting' ? 'Reiniciando…' : 'Confirmar reinicio'}
            </button>
          </div>
        </form>}
      </>}
    </dialog>
  </section>;
};
