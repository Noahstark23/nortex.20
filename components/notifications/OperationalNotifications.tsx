import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Check, RefreshCw, WifiOff, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import FluidSheet from '../ui/FluidSheet';
import { useOperationalAlerts } from '../../hooks/useOperationalAlerts';
import { useVentaEnCurso } from '../VentaEnCursoContext';
import { OfflineSaleRecovery } from './OfflineSaleRecovery';
import type { OfflineRecoveryController } from './offlineRecovery';

export interface LocalSaleAlerts {
    isOnline: boolean;
    pendingCount: number | null;
    reconciliationCount: number;
    syncing: boolean;
    onSync: () => Promise<void>;
    onRefresh?: () => Promise<void>;
    recovery?: OfflineRecoveryController;
}

const copy: Record<string, { title: string; description: string; action: string; path: string; urgent?: boolean }> = {
    out_of_stock: { title: 'Productos sin existencia', description: 'Revisá las existencias antes de ofrecerlos.', action: 'Ver productos', path: '/app/inventory' },
    low_stock: { title: 'Productos en su mínimo', description: 'Queda existencia, pero alcanzó el mínimo configurado.', action: 'Revisar productos', path: '/app/inventory' },
    expired_batches: { title: 'Lotes vencidos con existencia', description: 'Revisá estos lotes antes de vender. Este aviso no retira mercadería.', action: 'Revisar lotes', path: '/app/inventory', urgent: true },
    expiring_batches: { title: 'Lotes por vencer en 30 días', description: 'Organizá su revisión según la fecha de vencimiento.', action: 'Revisar lotes', path: '/app/inventory' },
    pending_orders: { title: 'Pedidos web por atender', description: 'Revisá los pedidos recibidos para preparar su proforma.', action: 'Ver pedidos web', path: '/app/quotations' },
};

/** Pendientes actuales, no un contador de mensajes leídos. Cerrar nunca resuelve una incidencia. */
export function OperationalNotifications({ local }: { local?: LocalSaleAlerts }) {
    const [open, setOpen] = useState(false);
    const [syncError, setSyncError] = useState(false);
    const [destination, setDestination] = useState<string | null>(null);
    const warningRef = useRef<HTMLHeadingElement>(null);
    const sale = useVentaEnCurso();
    const titleId = useId();
    const navigate = useNavigate();
    const { data, status, refresh, sessionKey } = useOperationalAlerts(open);
    useEffect(() => { setOpen(false); setSyncError(false); setDestination(null); }, [sessionKey]);
    useEffect(() => { if (destination) warningRef.current?.focus(); }, [destination]);
    useEffect(() => { if (open) void local?.onRefresh?.().catch(() => undefined); }, [open, local?.onRefresh]);
    const go = (path: string) => {
        if (sale.hayVenta) { setDestination(path); return; }
        setOpen(false); navigate(path);
    };
    const sections = data?.sections ?? [];
    const actionable = sections.filter(section => section.status === 'ok' && (section.count ?? 0) > 0)
        .sort((a, b) => Number(Boolean(copy[b.id]?.urgent)) - Number(Boolean(copy[a.id]?.urgent)));
    const failed = sections.filter(section => section.status === 'error');
    const retryable = Math.max(0, (local?.pendingCount ?? 0) - (local?.reconciliationCount ?? 0));
    const localIssues = Number(Boolean(local && !local.isOnline)) + Number(retryable > 0) + Number((local?.reconciliationCount ?? 0) > 0);
    const issueCount = actionable.length + localIssues;
    const uncertain = status !== 'ready' || failed.length > 0 || Boolean(local && local.pendingCount === null);
    const runSync = async () => {
        setSyncError(false);
        try { await local?.onSync(); refresh(); } catch { setSyncError(true); }
    };
    const actionClass = 'nx-shell-control nx-fluid-press mt-3 flex min-h-tap w-full items-center justify-between gap-2 rounded-control border px-3 text-sm font-semibold';
    return <>
        <button type="button" onClick={() => { setDestination(null); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open}
            aria-label={`Avisos importantes${issueCount ? `, ${issueCount} asuntos por atender` : uncertain ? ', estado por comprobar' : ', sin pendientes detectados'}${local && !local.isOnline ? ', sin internet' : ''}`}
            className="nx-shell-control nx-fluid-press relative inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-2 rounded-control border px-3 text-sm font-semibold">
            {local && !local.isOnline ? <WifiOff size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}<span className="hidden sm:inline">{local && !local.isOnline ? 'Sin internet' : 'Avisos'}</span>
            {issueCount > 0 ? <span className="nx-tone-warning text-xs font-bold tabular-nums">{issueCount}</span>
                : uncertain && <span aria-hidden="true" className="nx-shell-muted text-xs">·</span>}
        </button>
        {createPortal(<FluidSheet open={open} onClose={() => setOpen(false)} labelledBy={titleId} dragToDismiss={false}
            className="nx-app-shell" panelClassName="max-w-lg">
            <div data-operational-alerts className="nx-shell-border flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
                <div><h2 id={titleId} className="nx-shell-text text-lg font-bold">Avisos importantes</h2>
                    <p className="nx-shell-muted mt-1 text-sm">Lo que necesita atención para seguir trabajando.</p></div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar avisos" data-fluid-sheet-initial-focus
                    className="nx-shell-control nx-fluid-press flex min-h-tap min-w-tap items-center justify-center rounded-control"><X size={20} /></button>
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
                {destination && <section aria-label="Venta en curso" className="nx-shell-control rounded-card border p-4">
                    <h3 ref={warningRef} tabIndex={-1} className="nx-shell-text font-semibold">Tenés una venta abierta</h3>
                    <p className="nx-shell-muted mt-1 text-sm">Terminá o aparcá la venta antes de abrir otro módulo. Podés seguir consultando los avisos sin salir de la caja.</p>
                    <button type="button" className={actionClass} onClick={() => { setDestination(null); setOpen(false); }}>Seguir vendiendo<ArrowRight size={17} /></button>
                </section>}
                {local && (localIssues > 0 || local.pendingCount === null) && <section aria-label="En esta caja" className="space-y-3">
                    <h3 className="nx-shell-muted text-xs font-bold uppercase tracking-wider">En esta caja</h3>
                    {local.pendingCount === null && <p role="status" className="nx-tone-warning text-sm">Las ventas guardadas en este dispositivo están sin comprobar. Cerrá el panel y reintentá; no borres los datos del navegador.</p>}
                    {!local.isOnline && <div className="nx-shell-control rounded-card border p-4">
                        <h4 className="nx-shell-text flex items-center gap-2 font-semibold"><WifiOff size={18} /> Sin internet</h4>
                        <p className="nx-shell-muted mt-1 text-sm">Los datos del negocio no se pueden comprobar ahora. Las ventas pendientes siguen en este dispositivo.</p>
                    </div>}
                    {local.reconciliationCount > 0 && <div className="nx-shell-control rounded-card border p-4">
                        <h4 className="nx-tone-danger flex items-center gap-2 font-semibold"><AlertTriangle size={18} /> {local.reconciliationCount} venta{local.reconciliationCount === 1 ? '' : 's'} requiere{local.reconciliationCount === 1 ? '' : 'n'} revisión</h4>
                        <p className="nx-shell-muted mt-1 text-sm">Conservamos los datos originales en este dispositivo. Revisá cada referencia y su motivo para conciliarla con soporte antes de volver a cobrar.</p>
                    </div>}
                    {retryable > 0 && <div className="nx-shell-control rounded-card border p-4">
                        <h4 className="nx-shell-text font-semibold">{retryable} venta{retryable === 1 ? '' : 's'} pendiente{retryable === 1 ? '' : 's'} de confirmar</h4>
                        <p className="nx-shell-muted mt-1 text-sm">Guardadas en esta caja. No vuelvas a ingresarlas: el reintento conserva su referencia original.</p>
                        <button type="button" onClick={() => { void runSync(); }} disabled={!local.isOnline || local.syncing}
                            className={`${actionClass} disabled:cursor-not-allowed disabled:opacity-50`}>
                            {local.syncing ? 'Comprobando ventas…' : 'Reintentar confirmación'}<RefreshCw size={17} className={local.syncing ? 'animate-spin' : ''} />
                        </button>
                        {syncError && <p role="alert" className="nx-tone-danger mt-2 text-sm">No se pudieron confirmar. Siguen guardadas; revisá la conexión o pedí ayuda al responsable.</p>}
                    </div>}
                </section>}
                {local?.recovery && <OfflineSaleRecovery controller={local.recovery} isOnline={local.isOnline} syncing={local.syncing} active={open} />}
                <section aria-label="En el negocio" className="space-y-3">
                    <h3 className="nx-shell-muted text-xs font-bold uppercase tracking-wider">En el negocio</h3>
                    {status === 'loading' && <p role="status" className="nx-shell-muted text-sm">Consultando pendientes…</p>}
                    {status === 'error' && <p role="status" className="nx-tone-warning text-sm">No pudimos comprobar los pendientes del negocio. No significa que esté todo resuelto.</p>}
                    {failed.map(section => <p key={section.id} role="status" className="nx-tone-warning text-sm">No se pudo comprobar: {copy[section.id]?.title.toLowerCase()}.</p>)}
                    {actionable.map(section => { const item = copy[section.id]; return <article key={section.id} className="nx-shell-control rounded-card border p-4">
                        <h4 className={`font-semibold ${item.urgent ? 'nx-tone-danger' : 'nx-shell-text'}`}>{item.title} <span className="tabular-nums">({section.count})</span></h4>
                        <p className="nx-shell-muted mt-1 text-sm">{item.description}</p>
                        {section.status === 'ok' && section.samples && section.samples.length > 0 && <div className="mt-3 space-y-1">
                            <p className="nx-shell-muted text-xs">{section.count > section.samples.length ? `Mostrando ${section.samples.length} de ${section.count}` : 'Para revisar'}</p>
                            {section.samples.map(sample => <button key={sample.id} type="button"
                                className="nx-shell-text nx-fluid-press flex min-h-tap w-full items-center justify-between gap-2 rounded-control text-left text-sm"
                                onClick={() => go(`/app/inventory?search=${encodeURIComponent(sample.name)}`)}>
                                <span className="min-w-0"><span className="block break-words font-medium">{sample.name}</span>{sample.detail && <span className="nx-shell-muted block text-xs">{sample.detail}</span>}</span>
                                <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
                            </button>)}
                        </div>}
                        <button type="button" className={actionClass} onClick={() => go(item.path)}>{item.action}<ArrowRight size={17} /></button>
                    </article>; })}
                    {!uncertain && actionable.length === 0 && <p className="nx-shell-muted flex items-start gap-2 text-sm"><Check size={18} className="nx-tone-positive shrink-0" /> Sin pendientes detectados en las categorías disponibles para tu rol.</p>}
                </section>
                <div className="nx-shell-border border-t pt-3">
                    {data && <p className="nx-shell-muted text-xs">Consultado a las {new Date(data.checkedAt).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}. Se comprueba cada minuto mientras la app está visible.</p>}
                    <button type="button" onClick={refresh} disabled={status === 'loading'} className={`${actionClass} disabled:opacity-50`}>Actualizar avisos<RefreshCw size={17} /></button>
                    <p className="nx-shell-muted mt-3 text-xs">Los avisos se retiran cuando cambia su causa. Cerrar este panel conserva los pendientes.</p>
                </div>
            </div>
        </FluidSheet>, document.body)}
    </>;
}
