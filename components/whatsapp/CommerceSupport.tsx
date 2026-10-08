import { useEffect, useRef, useState } from 'react';

type RequestRow = { id: string; tenantId: string; phone: string; status: string; version: number; assignedTo: string | null; createdAt: string; updatedAt: string };
type Page = { items: RequestRow[]; nextCursor: string | null };
type Attempt = { id: string; version: number; status: string };
const base = '/api/whatsapp-commerce/support/activation-requests';
const labels: Record<string, string> = { REQUESTED: 'Solicitada', IN_PROGRESS: 'En preparación', WAITING_OWNER: 'Esperando al dueño', PREPARED: 'Preparada; activación pendiente', CANCELLED: 'Cancelada' };
const actions: Record<string, { status: string; label: string }[]> = {
  REQUESTED: [{ status: 'IN_PROGRESS', label: 'Tomar solicitud' }],
  IN_PROGRESS: [{ status: 'WAITING_OWNER', label: 'Esperar al dueño' }, { status: 'PREPARED', label: 'Marcar preparada' }, { status: 'CANCELLED', label: 'Cancelar solicitud' }],
  WAITING_OWNER: [{ status: 'IN_PROGRESS', label: 'Retomar preparación' }, { status: 'CANCELLED', label: 'Cancelar solicitud' }],
};

export default function CommerceSupport() {
  const [open, setOpen] = useState(false), [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState<Attempt | null>(null);
  const lock = useRef(false), cursor = useRef<string | null>(null);
  let userId = '';
  try { userId = JSON.parse(localStorage.getItem('nortex_user') ?? '{}').id ?? ''; } catch { /* El servicio verifica la autoridad vigente. */ }

  async function api<T>(path = '', body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${localStorage.getItem('nortex_token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'No fue posible comprobar la solicitud.');
    return payload as T;
  }
  async function load(next: string | null = cursor.current) {
    const result = await api<Page>(`?status=ALL${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
    cursor.current = next; setPage(result);
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'No fue posible comprobar el estado.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function recover(attempt: Attempt) {
    const result = await api<{ request: RequestRow }>(`/${encodeURIComponent(attempt.id)}`);
    if (result.request.id !== attempt.id) throw new Error('La respuesta no corresponde a la solicitud pendiente.');
    setPage(previous => previous ? { ...previous, items: previous.items.map(row => row.id === attempt.id ? result.request : row) } : previous);
    setUncertain(null);
    setNotice(result.request.version === attempt.version + 1 && result.request.status === attempt.status && result.request.assignedTo === userId ? 'Cambio comprobado. No se repitió la acción.' : 'Estado consultado. Revisalo antes de decidir otra acción.');
  }
  async function transition(row: RequestRow, status: string) {
    const attempt = { id: row.id, version: row.version, status };
    try {
      const result = await api<{ request: RequestRow }>(`/${encodeURIComponent(row.id)}/transition`, { version: row.version, status });
      if (result.request.id !== row.id || result.request.version !== row.version + 1 || result.request.status !== status) throw new Error('No se pudo vincular el comprobante al cambio solicitado.');
      setPage(previous => previous ? { ...previous, items: previous.items.map(item => item.id === row.id ? result.request : item) } : previous);
      setNotice('Estado actualizado. Preparada significa que la activación sigue pendiente.');
    } catch {
      setUncertain(attempt);
      try { await recover(attempt); } catch { throw new Error('El resultado es incierto. Consultá esta solicitud antes de repetir una acción.'); }
    }
  }
  useEffect(() => { if (open && !page) void run(() => load(null)); }, [open]);

  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="nx-shell-control rounded-card border p-4">
    <summary className="nx-shell-text cursor-pointer font-medium">Conexiones asistidas de WhatsApp</summary>
    {open && <div className="mt-3 space-y-3">
      <p className="nx-shell-muted text-sm">Soporte prepara la conexión. Marcar preparada no conecta el número ni activa mensajes o cotizaciones.</p>
      <div className="flex flex-wrap gap-2"><button disabled={busy} type="button" className="nx-shell-control rounded-control border px-3 py-2" onClick={() => void run(() => uncertain ? recover(uncertain) : load())}>{uncertain ? 'Consultar solicitud pendiente' : 'Actualizar solicitudes'}</button><button disabled={busy || !!uncertain} type="button" className="nx-shell-control rounded-control border px-3 py-2" onClick={() => void run(() => load(null))}>Volver al inicio</button></div>
      {busy && <p role="status">Comprobando estado…</p>}{error && <p role="alert" className="nx-tone-warning rounded-control border p-3">{error}</p>}{notice && <p role="status" className="nx-tone-success rounded-control border p-3">{notice}</p>}
      {!busy && !error && page?.items.length === 0 && <p>No hay solicitudes en esta página.</p>}
      {page?.items.map(row => <article key={row.id} aria-label={`Solicitud ${row.phone}`} className="nx-shell-control space-y-2 rounded-control border p-3">
        <p className="nx-shell-text font-medium">{row.phone} · {labels[row.status] ?? row.status}</p>
        <p className="nx-shell-muted text-sm">Negocio {row.tenantId} · versión {row.version} · {row.assignedTo ? row.assignedTo === userId ? 'A tu cargo' : 'Otro operador' : 'Sin asignar'}</p>
        <div className="flex flex-wrap gap-2">{(row.assignedTo === userId || row.status === 'REQUESTED' && !row.assignedTo) && (actions[row.status] ?? []).map(action => <button key={action.status} disabled={busy || !!uncertain} type="button" className="nx-shell-control rounded-control border px-3 py-2" onClick={() => void run(() => transition(row, action.status))}>{action.label}</button>)}</div>
      </article>)}
      {page?.nextCursor && <button disabled={busy || !!uncertain} type="button" className="nx-shell-control rounded-control border px-3 py-2" onClick={() => void run(() => load(page.nextCursor))}>Siguiente página</button>}
    </div>}
  </details>;
}
