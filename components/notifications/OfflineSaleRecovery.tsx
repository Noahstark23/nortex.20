import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Search } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import type { OfflineRecoveryController, OfflineServerEvidence } from './offlineRecovery';

const capturedDate = (value: string | null) => value === null ? 'Fecha original sin comprobar'
    : new Intl.DateTimeFormat('es-NI', { timeZone: 'America/Managua', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const label = { pending: 'Pendiente de confirmar', failed: 'Intento sin confirmar', review: 'Necesita revisión' };
const buttonClass = 'nx-shell-control nx-fluid-press flex min-h-tap w-full items-center justify-between gap-2 rounded-control border px-3 py-2 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

/** Revisión dentro de Avisos: no navega, edita el carrito ni modifica snapshots. */
export function OfflineSaleRecovery({ controller, isOnline, syncing, active }: {
    controller: OfflineRecoveryController; isOnline: boolean; syncing: boolean; active: boolean;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [limit, setLimit] = useState(20);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [evidence, setEvidence] = useState<OfflineServerEvidence | null>(null);
    const current = useRef({ key: controller.sessionKey, active });
    current.current = { key: controller.sessionKey, active };
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        setSelectedId(null); setEvidence(null); setMessage(null); setError(null); setBusy(false); setLimit(20);
    }, [controller.sessionKey, active]);
    useEffect(() => { if (selectedId) heading.current?.focus(); }, [selectedId]);
    useEffect(() => () => { current.current.active = false; }, []);

    const rows = controller.rows;
    const selected = rows?.find(row => row.offlineId === selectedId);
    const run = async (action: 'inspect' | 'retry' | 'export') => {
        if (!selected || busy || syncing) return;
        const key = controller.sessionKey;
        const isCurrent = () => current.current.active && current.current.key === key;
        setBusy(true); setError(null); setMessage(null);
        try {
            if (action === 'inspect') {
                setEvidence(null);
                const result = await controller.inspect(selected.offlineId);
                if (isCurrent()) setEvidence(result);
            } else if (action === 'retry') {
                await controller.retry(selected.offlineId);
                if (isCurrent()) setMessage('Reintento terminado. El listado conserva las ventas que siguen pendientes.');
            } else {
                const file = await controller.exportEvidence(selected.offlineId);
                if (!isCurrent()) return;
                const url = URL.createObjectURL(new Blob([file.content], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url; link.download = file.filename;
                document.body.append(link); link.click(); link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
                setMessage('Archivo de evidencia descargado. Compartilo con soporte por el canal que elijás.');
            }
        } catch (failure) {
            if (isCurrent()) setError(failure instanceof Error ? failure.message : 'No se pudo completar la consulta. La venta se conserva.');
        } finally { if (isCurrent()) setBusy(false); }
    };

    return <section aria-label="Ventas guardadas en este dispositivo" className="nx-shell-control space-y-3 rounded-card border p-4">
        <h4 className="nx-shell-text font-semibold">Ventas guardadas en este dispositivo</h4>
        <p className="nx-shell-muted text-sm">Solo ventas de tu usuario y negocio. Revisarlas conserva la venta que estás preparando.</p>
        {controller.status !== 'ready' || rows === null ? <p role="status" className="nx-tone-warning text-sm">No se pudo verificar la identidad o leer las ventas locales. Iniciá sesión con quien las guardó y actualizá los avisos. No borres los datos del navegador.</p>
            : selected ? <div className="space-y-3">
                <button type="button" className={buttonClass} onClick={() => { setSelectedId(null); setEvidence(null); setError(null); }} disabled={busy}><ArrowLeft size={16} /> Volver al listado</button>
                <h5 ref={heading} tabIndex={-1} className="nx-shell-text break-all font-semibold">Referencia {selected.offlineId}</h5>
                <dl className="nx-shell-muted space-y-2 text-sm">
                    <div><dt>Fecha original · Managua</dt><dd className="nx-shell-text">{capturedDate(selected.createdAt)}</dd></div>
                    <div><dt>Importe guardado</dt><dd className="nx-shell-text font-semibold">{selected.total === null ? 'Sin comprobar' : formatMoney(selected.total)}</dd></div>
                    <div><dt>Estado</dt><dd className={selected.status === 'review' ? 'nx-tone-danger' : 'nx-shell-text'}>{label[selected.status]}</dd></div>
                    <div><dt>Motivo</dt><dd className="nx-shell-text break-words">{selected.reason}</dd></div>
                    {selected.code && <div><dt>Código para soporte</dt><dd className="nx-shell-text break-all">{selected.code}</dd></div>}
                    <div><dt>Contenido guardado</dt><dd>{selected.lineCount} líneas · {selected.paymentMethod}</dd></div>
                    {selected.lastSyncAt && <div><dt>Último intento · Managua</dt><dd>{capturedDate(selected.lastSyncAt)}</dd></div>}
                </dl>
                <button type="button" className={buttonClass} disabled={!isOnline || busy || syncing} onClick={() => { void run('inspect'); }}>Consultar referencia en servidor<Search size={17} /></button>
                {evidence && <div role="status" className="nx-shell-border space-y-2 rounded-control border p-3 text-sm">
                    {evidence.status === 'recorded' ? <>
                        <p className="nx-shell-text font-semibold">Referencia encontrada en el servidor</p>
                        <p className="nx-shell-muted break-all">Venta {evidence.record.saleId} · {formatMoney(evidence.record.total)} · {evidence.record.status}</p>
                        <p className="nx-shell-muted">Fecha registrada: {capturedDate(evidence.record.createdAt)}.</p>
                        <p className="nx-shell-muted">La referencia por sí sola no confirma que el contenido coincida. El reintento permitido verifica el registro original; los conflictos necesitan revisión con soporte.</p>
                    </> : <p className="nx-shell-muted">{evidence.status === 'not_found'
                        ? 'No se encontró un registro accesible con esta referencia en tu sesión. No prueba que puedas volver a cobrar: conservá la venta original.'
                        : 'Hay más de un registro accesible para esta referencia. Conservá la evidencia y pedí conciliación con soporte.'}</p>}
                    <p className="nx-shell-muted text-xs">Consultado: {capturedDate(evidence.checkedAt)}. La copia local se conserva.</p>
                </div>}
                {selected.canRetry ? <button type="button" className={buttonClass} disabled={!isOnline || busy || syncing} onClick={() => { void run('retry'); }}>Reintentar esta venta<RefreshCw size={17} /></button>
                    : <p className="nx-tone-warning text-sm">No hay reintento automático para esta venta. Compará la evidencia con soporte; no cambiés su referencia ni la registres de nuevo.</p>}
                <button type="button" className={buttonClass} disabled={busy || syncing} onClick={() => { void run('export'); }}>Descargar evidencia para soporte<Download size={17} /></button>
                <p className="nx-shell-muted text-xs">La descarga es local. Incluye referencias, importes, cantidades y motivo; omite clientes, costos, tokens y códigos crudos de etiquetas.</p>
            </div> : <>
                {rows.length === 0 ? <p className="nx-shell-muted text-sm">No quedan ventas pendientes para esta sesión en este dispositivo.</p> : <>
                    <p className="nx-shell-muted text-xs">Mostrando {Math.min(limit, rows.length)} de {rows.length}. Fechas de Managua.</p>
                    <ul className="space-y-2">{rows.slice(0, limit).map(row => <li key={row.offlineId}>
                        <button type="button" className={buttonClass} onClick={() => { setSelectedId(row.offlineId); setEvidence(null); setError(null); setMessage(null); }}>
                            <span className="min-w-0"><span className="nx-shell-text block break-all">{row.offlineId}</span>
                                <span className="nx-shell-muted block text-xs">{capturedDate(row.createdAt)}</span>
                                <span className={`block text-xs ${row.status === 'review' ? 'nx-tone-danger' : 'nx-shell-muted'}`}>{label[row.status]}</span></span>
                            <span className="nx-shell-text shrink-0">{row.total === null ? 'Sin importe' : formatMoney(row.total)}</span>
                        </button>
                    </li>)}</ul>
                    {rows.length > limit && <button type="button" className={buttonClass} onClick={() => setLimit(value => value + 20)}>Mostrar más ventas</button>}
                </>}
            </>}
        {busy && <p role="status" className="nx-shell-muted text-sm">Comprobando la referencia…</p>}
        {message && <p role="status" className="nx-shell-muted text-sm">{message}</p>}
        {error && <p role="alert" className="nx-tone-danger text-sm">{error}</p>}
    </section>;
}
