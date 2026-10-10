import React, { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { SWRConfig } from 'swr';
import { Activity, RefreshCw, Shield } from 'lucide-react';
import type { AdminBusinessKind, AdminFocus, AdminOverview } from '../../utils/adminMetrics';
import { formatMoney, type Currency } from '../../utils/money';
import AdminBusinessList, { kindLabels } from './AdminBusinessList';
import { readAdminOverviewSession, useAdminOverviewSession, type AdminOverviewSession } from '../../hooks/useAdminOverviewSession';

class AdminReadError extends Error { constructor(public status: number, message = `HTTP ${status}`) { super(message); } }
export async function readAdminOverview(url: string, session = readAdminOverviewSession(), active = () => true, signal?: AbortSignal): Promise<AdminOverview> {
    const current = () => active() && readAdminOverviewSession().key === session.key;
    const assertCurrent = () => { if (!current()) throw new AdminReadError(401, 'La sesión cambió; se descartó la respuesta.'); };
    assertCurrent();
    if (!session.token || !session.userId || session.role !== 'SUPER_ADMIN') throw new AdminReadError(401);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', ...(signal ? { signal } : {}) });
    assertCurrent();
    if (!res.ok) throw new AdminReadError(res.status);
    const data = await res.json();
    assertCurrent();
    return data;
}

const focusLabels: Record<AdminFocus, string> = {
    NO_CATALOG: 'Sin catálogo', NO_SALE: 'Sin primera venta', INACTIVE: 'Sin actividad en 30 días',
    ERRORS: 'Con incidencias observadas', FOUNDER_DATES: 'Fundadores sin fechas', OPERATIONS: 'Revisar inventario, caja o fiado',
};
const percent = (value: number, total: number): string => total ? `${Math.round(value * 100 / total)}%` : 'Sin base';

type PanelProps = { children?: React.ReactNode; navigation?: React.ReactNode; onExit?: () => void; operations?: (tenants: AdminOverview['tenants'], refresh: () => void) => React.ReactNode };
export default function AdminOverviewPanel(props: PanelProps) {
    const session = useAdminOverviewSession();
    // Provider privado y desmontado sólo al cambiar principal/sesión, nunca al
    // filtrar métricas. No comparte datos globales con otra sesión de SWR.
    const cache = useMemo(() => new Map(), [session.key]);
    return <SWRConfig key={session.key} value={{ provider: () => cache }}>
        <AdminOverviewContent {...props} session={session} clearCache={() => cache.clear()} />
    </SWRConfig>;
}

function AdminOverviewContent({ children, navigation, onExit, operations, session, clearCache }: PanelProps & { session: AdminOverviewSession; clearCache: () => void }) {
    const alive = useRef(true), revoked = useRef(false);
    const controllers = useRef(new Set<AbortController>());
    const [deniedByServer, setDeniedByServer] = useState(false);
    const [authorized, setAuthorized] = useState(false);
    const current = () => alive.current && !revoked.current && readAdminOverviewSession().key === session.key;
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; controllers.current.forEach(controller => controller.abort()); clearCache(); };
    }, [session.key]);
    const [page, setPage] = useState(1);
    const [kind, setKind] = useState<AdminBusinessKind | ''>('');
    const [focus, setFocus] = useState<AdminFocus | ''>('');
    const [draftSearch, setDraftSearch] = useState('');
    const [search, setSearch] = useState('');
    const params = new URLSearchParams({ page: String(page) });
    if (kind) params.set('kind', kind);
    if (focus) params.set('focus', focus);
    if (search) params.set('search', search);
    const hasToken = Boolean(session.token);
    const eligible = hasToken && Boolean(session.userId) && session.role === 'SUPER_ADMIN';
    const { data: snapshot, error, isLoading, isValidating, mutate } = useSWR<AdminOverview>(eligible && current() ? [`/api/admin/metrics?${params}`, session.key] as const : null, async ([url]: readonly [string, string]) => {
        const controller = new AbortController(); controllers.current.add(controller);
        try {
            const value = await readAdminOverview(url, session, current, controller.signal);
            if (current()) setAuthorized(true);
            return value;
        } catch (failure) {
            if (current() && failure instanceof AdminReadError && [401, 403].includes(failure.status)) {
                revoked.current = true; clearCache(); setDeniedByServer(true);
                controllers.current.forEach(item => item.abort());
            }
            throw failure;
        } finally { controllers.current.delete(controller); }
    },
        { refreshInterval: 60000, revalidateOnFocus: false, keepPreviousData: false, shouldRetryOnError: false });
    const drill = (next: AdminFocus | '', nextKind: AdminBusinessKind | '' = 'REAL') => {
        setPage(1); setFocus(next); setKind(nextKind); setSearch(''); setDraftSearch('');
    };
    const denied = !eligible || deniedByServer || !current();
    const data = denied ? undefined : snapshot;

    return <main className="min-h-screen bg-surface-950 text-slate-100 p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div><p className="text-sm text-slate-400 flex items-center gap-2"><Shield size={16} aria-hidden="true" /> Administración de Nortex</p>
                    <h1 className="text-2xl sm:text-3xl font-semibold mt-1">Negocios que arrancan y vuelven</h1>
                    <p className="text-sm text-slate-400 mt-2">Decidí qué necesita atención con evidencia del uso del comercio.</p></div>
                {navigation}
                {hasToken && !denied && <button type="button" onClick={() => void mutate()} disabled={isValidating} className="min-h-11 px-4 rounded-lg border border-surface-700 flex items-center gap-2 disabled:opacity-50">
                    <RefreshCw size={16} aria-hidden="true" /> {isValidating ? 'Actualizando…' : 'Actualizar'}</button>}
            </header>
            <aside className="p-4 rounded-xl border border-surface-700 bg-surface-900 text-sm">
                <strong>Fundadores: un año gratis.</strong> Contexto confirmado por Noel el 30/09/2026: nadie había pagado Nortex. La lista y las fechas de cada cuenta requieren verificación. Este panel sólo consulta datos y no modifica beneficios.
            </aside>
            {(!hasToken || denied) && <section role="alert" className="p-6 rounded-xl border border-surface-700">
                <h2 className="font-semibold">Acceso reservado a administradores de Nortex</h2>
                <p className="text-slate-400 mt-2">Iniciá sesión con una cuenta SUPER_ADMIN activa para consultar la plataforma.</p>
                <button type="button" className="inline-block mt-4 underline text-nortex-accent" onClick={onExit}>Ir al inicio de sesión</button>
            </section>}
            {hasToken && !denied && isLoading && <p role="status">Leyendo evidencia administrativa…</p>}
            {hasToken && !denied && error && <p role="alert" className="p-4 border border-surface-700 rounded-xl">
                {data ? 'Datos anteriores: falló la actualización. No los tomés como un corte actual.' : 'No se pudo leer la evidencia administrativa. Los datos no están disponibles; esto no significa cero.'} Volvé a intentar con Actualizar.
            </p>}
            {data && !denied && <>
                <p className="text-sm text-slate-400">Corte: {new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Managua' }).format(new Date(data.asOf))} · Managua. {data.metrics.registered} cuentas registradas.</p>
                <section aria-label="Cobertura de cuentas" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {([['REAL', data.metrics.real], ['DEMO', data.metrics.demo], ['INTERNAL', data.metrics.internal], ['UNKNOWN', data.metrics.unclassified]] as const).map(([key, value]) =>
                        <button type="button" key={key} onClick={() => drill('', key)} className="p-4 text-left bg-surface-900 border border-surface-700 rounded-xl">
                            <span className="text-sm text-slate-400">{kindLabels[key]}</span><strong className="block text-2xl mt-1">{value}</strong></button>)}
                </section>
                <p className="text-sm text-slate-400">{data.coverage.classification}</p>
                <section aria-label="Prioridades de negocios reales" className="space-y-3">
                    <h2 className="text-xl font-semibold flex items-center gap-2"><Activity size={20} aria-hidden="true" /> Qué atender primero</h2>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {([
                            ['Sin catálogo', data.metrics.real - data.metrics.catalogReady, 'NO_CATALOG'],
                            ['Sin primera venta', data.metrics.real - data.metrics.activated, 'NO_SALE'],
                            ['Sin actividad en 30 días', data.metrics.inactive30d, 'INACTIVE'],
                            ['Fundadores sin fechas', data.metrics.founderDatesUnknown, 'FOUNDER_DATES'],
                            ['Incidencias observadas', data.metrics.accountingWarnings30d + data.metrics.assistantFailures30d, 'ERRORS'],
                            ['Comercios para revisar operación', data.metrics.businessesToReview, 'OPERATIONS'],
                        ] as const).map(([label, value, next]) => <button type="button" key={next} onClick={() => drill(next)} className="p-4 text-left bg-surface-900 border border-surface-700 rounded-xl">
                            <span className="text-sm text-slate-400">{label}</span><strong className="block text-2xl mt-1">{value}</strong><span className="text-xs text-slate-400">Ver cuentas</span>
                        </button>)}
                    </div>
                    <p className="text-sm text-slate-400">Sin actividad: cuentas con al menos 30 días de antigüedad. Incidencias cuenta eventos observados; operación cuenta comercios con señales para revisar.</p>
                </section>
                <section className="p-5 bg-surface-900 border border-surface-700 rounded-xl space-y-3" aria-label="Activación y recurrencia">
                    <h2 className="text-xl font-semibold">Activación y uso de los negocios reales</h2>
                    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {([['Primera venta confirmada', data.metrics.activated], ['Actividad en 30 días', data.metrics.active30d], ['Vendieron en 30 días', data.metrics.selling30d], ['Vendieron en ≥2 días', data.metrics.recurring30d]] as const).map(([label, value]) =>
                            <div key={label}><dt className="text-sm text-slate-400">{label}</dt><dd className="text-xl font-semibold">{value} <span className="text-sm font-normal text-slate-400">/ {data.metrics.real} · {percent(value, data.metrics.real)}</span></dd></div>)}
                    </dl>
                    <p className="text-sm text-slate-400">{data.coverage.activity}</p>
                </section>
                <section className="bg-surface-900 border border-surface-700 rounded-xl" aria-label="Lista de negocios">
                    <div className="p-4 sm:p-5 space-y-3">
                        <h2 className="text-xl font-semibold">Cuentas para revisar</h2>
                        <form onSubmit={event => { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }} className="flex flex-wrap gap-3 items-end">
                            <label className="flex-1 min-w-48 text-sm">Buscar negocio<input value={draftSearch} onChange={e => setDraftSearch(e.target.value)} maxLength={80} className="block mt-1 w-full min-h-11 px-3 rounded-lg bg-surface-950 border border-surface-700" /></label>
                            <label className="text-sm">Clasificación<select value={kind} onChange={e => { setKind(e.target.value as AdminBusinessKind | ''); setPage(1); }} className="block mt-1 min-h-11 px-3 rounded-lg bg-surface-950 border border-surface-700">
                                <option value="">Todas las cuentas</option>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                            <label className="text-sm">Atención<select value={focus} onChange={e => { setFocus(e.target.value as AdminFocus | ''); setPage(1); }} className="block mt-1 min-h-11 max-w-full px-3 rounded-lg bg-surface-950 border border-surface-700">
                                <option value="">Todas las situaciones</option>{Object.entries(focusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                            <button type="submit" className="min-h-11 px-4 border border-surface-700 rounded-lg">Buscar</button>
                        </form>
                        <p className="text-sm text-slate-400">{data.pagination.total} cuentas coinciden. Los KPIs de arriba conservan el alcance global verificado.</p>
                    </div>
                    <AdminBusinessList rows={data.tenants} />
                    <nav aria-label="Páginas de cuentas" className="p-4 flex items-center justify-between gap-2 border-t border-surface-700 text-sm">
                        <button type="button" disabled={page <= 1 || isValidating} onClick={() => setPage(p => p - 1)} className="min-h-11 px-3 rounded-lg border border-surface-700 disabled:opacity-40">Anterior</button>
                        <span>Página {data.pagination.page} de {Math.max(data.pagination.pages, 1)}</span>
                        <button type="button" disabled={page >= data.pagination.pages || isValidating} onClick={() => setPage(p => p + 1)} className="min-h-11 px-3 rounded-lg border border-surface-700 disabled:opacity-40">Siguiente</button>
                    </nav>
                </section>
                <section className="p-5 bg-surface-900 border border-surface-700 rounded-xl space-y-3">
                    <h2 className="text-xl font-semibold">Cohortes de alta</h2>
                    <p className="text-sm text-slate-400">Últimos 12 meses con altas de negocios reales. Uso observado en los últimos 30 días sobre el total de cada cohorte; las cohortes nuevas tienen menos tiempo de exposición.</p>
                    {!data.cohorts.length ? <p>Sin cohortes de negocios reales verificados.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                        <thead><tr>{['Mes', 'Negocios', 'Fundadores', 'Primera venta', 'Activos · 30 d', 'Ventas ≥2 días · 30 d'].map(label => <th key={label} className="py-2 pr-4 font-medium whitespace-nowrap">{label}</th>)}</tr></thead>
                        <tbody>{data.cohorts.map(row => <tr key={row.month} className="border-t border-surface-700">
                            <td className="py-3 pr-4">{row.month}</td><td>{row.registered}</td><td>{row.founders}</td><td>{row.activated} · {percent(row.activated, row.registered)}</td>
                            <td>{row.active30d} · {percent(row.active30d, row.registered)}</td><td>{row.recurring30d} · {percent(row.recurring30d, row.registered)}</td>
                        </tr>)}</tbody></table></div>}
                </section>
                <section className="p-5 bg-surface-900 border border-surface-700 rounded-xl space-y-3" aria-label="Pagos de Nortex">
                    <h2 className="text-xl font-semibold">Pagos de Nortex y año gratis</h2>
                    <p>{data.metrics.founders} fundadores verificados · {data.metrics.benefitsEnding30d} beneficios con fin documentado en los próximos 30 días.</p>
                    <p>MRR: <strong>Desconocido</strong> · Suscripciones pagadas: <strong>Desconocidas</strong></p>
                    {data.billing.reconciledPaymentsThisMonth.length ? <ul className="list-disc pl-5">
                        {data.billing.reconciledPaymentsThisMonth.map(row => <li key={row.currency}>{row.count} recibos conciliados del mes · {formatMoney(row.amount, row.currency as Currency, { decimals: 4 })}</li>)}
                    </ul> : <p>Sin recibos conciliados registrados para este mes. Cobertura parcial.</p>}
                    <p className="text-sm text-slate-400">{data.coverage.billing}</p>
                </section>
                <details className="p-5 bg-surface-900 border border-surface-700 rounded-xl text-sm text-slate-400">
                    <summary className="cursor-pointer min-h-6">Fuentes y límites de los datos</summary>
                    <div className="mt-3 space-y-2"><p>{data.coverage.founderBenefit}</p><p>{data.coverage.imports}</p><p>{data.coverage.errors}</p></div>
                </details>
            </>}
            {(authorized || data) && !denied && children}
            {(authorized || data) && !denied && operations?.(data?.tenants ?? [], () => { void mutate(); })}
        </div>
    </main>;
}
