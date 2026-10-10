import React, { useEffect, useRef, useState } from 'react';
import ProductImporter from '../ProductImporter';
import { readActivationSession, useActivationSession } from '../../hooks/useActivationJourney';
type Tenant = { id: string; businessName: string; owner: { id: string; email: string } | null };
type Attempt = { requestKey: string; tenant: Tenant; preview?: { previewId: string; businessName: string; ownerEmail: string; counts: Record<string, number> } };
type Receipt = { requestKey: string; status: string; loginRequired: boolean; imported: number; warehouses: { id: string; name: string; isActive: boolean }[] };
export default function AdminDemoReset(props: { tenants: Tenant[]; onChanged: () => void }) {
  const session = useActivationSession();
  return <Session key={session.key} {...props} session={session} />;
}
const Session: React.FC<{ tenants: Tenant[]; onChanged: () => void; session: ReturnType<typeof readActivationSession> }> = ({ tenants, onChanged, session }) => {
  const [open, setOpen] = useState(false), [targetId, setTargetId] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [phase, setPhase] = useState<'select' | 'review' | 'uncertain' | 'applied'>('select');
  const [password, setPassword] = useState(''), [phrase, setPhrase] = useState(''), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [importing, setImporting] = useState(false);
  const locked = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  let actorId = '';
  try { actorId = JSON.parse(localStorage.getItem('nortex_user') ?? '{}').id ?? ''; } catch { /* Servidor exige sesión. */ }
  const storageKey = 'nortex_admin_demo_reset:' + session.tenantId + ':' + actorId;
  const current = () => session.key === readActivationSession().key;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Attempt | null;
      if (saved?.requestKey && saved.tenant?.id) { setAttempt(saved); setPhase('uncertain'); }
    } catch { setError('No se pudo recuperar la asistencia guardada.'); }
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open, importing]);
  const base = (a: Attempt) => '/api/admin/demo-reset/' + encodeURIComponent(a.tenant.id);
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: {
      Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!current()) throw new Error('La sesión cambió. Volvé a ingresar.');
    if (!response.ok) throw new Error(data.error || 'No se pudo verificar el resultado.');
    return data;
  }
  function save(a: Attempt) { localStorage.setItem(storageKey, JSON.stringify(a)); setAttempt(a); }
  async function run(action: () => Promise<void>) {
    if (locked.current || !current()) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { locked.current = false; if (current()) setBusy(false); }
  }
  async function review() {
    const tenant = tenants.find(t => t.id === targetId);
    if (!tenant?.owner) return;
    await run(async () => {
      const a = { tenant, requestKey: crypto.randomUUID() };
      // Persistir antes de enviar; un fallo de almacenamiento no inicia la operación.
      save(a);
      try {
        const preview = await request(base(a) + '/preview', { requestKey: a.requestKey, ownerId: tenant.owner!.id });
        if (preview.requestKey !== a.requestKey || !preview.previewId || preview.ownerEmail !== tenant.owner!.email) throw new Error('La identidad del dueño cambió. Actualizá la lista antes de continuar.');
        save({ ...a, preview }); setPhase('review');
      } catch (e) { localStorage.removeItem(storageKey); setAttempt(null); throw e; }
    });
  }
  async function check(a = attempt) {
    if (!a) return;
    const result: Receipt = await request(base(a) + '/receipts/' + a.requestKey);
    if (result.requestKey !== a.requestKey || result.loginRequired !== false) throw new Error('Comprobante inesperado. Conservá este intento.');
    if (result.status === 'APPLIED') { setReceipt(result); setPassword(''); setPhase('applied'); onChanged(); return; }
    if (result.status === 'PREVIEWED') {
      const preview = await request(base(a) + '/preview', { requestKey: a.requestKey, ownerId: a.tenant.owner!.id });
      save({ ...a, preview }); setPhase('review'); return;
    }
    if (result.status === 'EXPIRED') { localStorage.removeItem(storageKey); setAttempt(null); setPhase('select'); throw new Error('La revisión venció sin aplicarse. Volvé a revisar la empresa.'); }
    throw new Error('No se pudo determinar el resultado.');
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!attempt?.preview || !password || phrase !== 'REINICIAR' || !consent) return;
    await run(async () => {
      setPhase('uncertain');
      await request(base(attempt) + '/confirm', { requestKey: attempt.requestKey, ownerId: attempt.tenant.owner!.id,
        previewId: attempt.preview!.previewId, password, confirmation: phrase, confirmedTestData: true, confirmedUnpaid: true });
      setPassword(''); await check();
    });
  }
  function cancelReview() {
    if (busy || phase !== 'review') return;
    try { localStorage.removeItem(storageKey); setAttempt(null); setPassword(''); setPhrase(''); setConsent(false); setPhase('select'); }
    catch { setError('No se pudo cerrar la revisión guardada.'); }
  }
  const title = attempt?.tenant.businessName;
  return <section className="my-4 rounded-xl border border-amber-500/30 p-4">
    <button type="button" className="nx-form-field rounded-lg border border-surface-500 px-4 py-2 disabled:opacity-50" onClick={() => setOpen(true)}>{attempt ? 'Continuar reinicio asistido' : 'Reiniciar cuenta de prueba'}</button>
    <dialog ref={dialog} aria-label="Reinicio asistido de cuenta" className="nx-dark-context max-h-[90vh] w-[min(42rem,92vw)] overflow-y-auto rounded-xl border border-surface-500 bg-surface-900 p-6 font-sans text-slate-100 backdrop:bg-black/70" onCancel={e => { e.preventDefault(); if (!busy && !importing) setOpen(false); }}>
      <div hidden={importing}>
      <h2 className="text-xl font-bold">Reinicio asistido {title ? '— ' + title : ''}</h2>
      {error && <p role="alert" className="my-3 text-red-400">{error}</p>}
      {phase === 'select' && <div className="space-y-4 my-4">
        <label className="block">Empresa<select aria-label="Empresa para reiniciar" value={targetId} onChange={e => setTargetId(e.target.value)} className="nx-form-field mt-1 block w-full rounded-lg border p-2">
          <option value="">Seleccioná la empresa</option>{tenants.filter(t => t.owner).map(t => <option key={t.id} value={t.id}>{t.businessName} — {t.owner!.email}</option>)}
        </select></label>
        <p>El servidor comprobará que no haya pagos ni compromisos de plataforma.</p>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50" disabled={busy || !targetId} onClick={review}>Revisar datos de prueba</button>
      </div>}
      {phase === 'review' && attempt?.preview && <form onSubmit={confirm} className="space-y-4 my-4">
        <p>Dueño: <strong>{attempt.preview.ownerEmail}</strong></p>
        <p>Se archivarán {attempt.preview.counts.sales} ventas, {attempt.preview.counts.purchases} compras y {attempt.preview.counts.products} productos, junto con sus existencias y demás datos de prueba. Se conservarán el acceso del dueño, la configuración y las fechas actuales de acceso. Los demás usuarios quedarán desactivados.</p>
        <label className="block"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Confirmo que todos los datos son de prueba y que esta cuenta fue activada sin cobrar.</label>
        <label className="block">Escribí REINICIAR<input className="nx-form-field mt-1 block w-full rounded-lg border p-2" value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off" /></label>
        <label className="block">Tu contraseña de administrador<input type="password" className="nx-form-field mt-1 block w-full rounded-lg border p-2" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50" disabled={busy || !consent || phrase !== 'REINICIAR' || !password}>Confirmar reinicio</button>
        <button type="button" className="nx-form-field rounded-lg border border-surface-500 px-4 py-2 disabled:opacity-50" disabled={busy} onClick={cancelReview}>Cancelar revisión</button>
      </form>}
      {phase === 'uncertain' && <div className="space-y-4 my-4"><p>Verificá el mismo intento antes de continuar. Si se perdió la conexión, el reinicio puede haberse aplicado.</p><button className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50" disabled={busy} onClick={() => run(() => check())}>Verificar intento</button></div>}
      {phase === 'applied' && receipt && <div className="space-y-4 my-4">
        <p role="status">Reinicio confirmado. {receipt.imported} productos cargados mediante esta asistencia.</p>
        <p>El dueño puede entrar con su mismo correo y contraseña. Cargá el Excel revisado con las existencias iniciales. Si se interrumpe, podés repetir el mismo archivo sin duplicar stock.</p>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50" onClick={() => setImporting(true)}>Cargar productos en {title}</button>
        <button className="nx-form-field rounded-lg border border-surface-500 px-4 py-2 disabled:opacity-50" onClick={() => { try { localStorage.removeItem(storageKey); setAttempt(null); setReceipt(null); setPhase('select'); setPhrase(''); setConsent(false); setOpen(false); } catch { setError('No se pudo cerrar la asistencia guardada.'); } }}>Terminar asistencia</button>
      </div>}
      <button className="nx-form-field rounded-lg border border-surface-500 px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => setOpen(false)}>Cerrar</button>
      </div>
    {importing && attempt && receipt && <ProductImporter onClose={() => { setImporting(false); void run(() => check()); }} onSuccess={() => { void run(() => check()); }}
      assisted={{ productsUrl: base(attempt) + '/receipts/' + attempt.requestKey + '/products', warehouses: receipt.warehouses, businessName: attempt.tenant.businessName }} />}
    </dialog>
  </section>;
}
