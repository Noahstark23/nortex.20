import React, { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronRight, Clock3, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import SaleCorrectionPanel from './sales/SaleCorrectionPanel';
import PendingCorrections from './sales/PendingCorrections';
import type { CorrectionRequest, ReturnableSale, SalesLedgerItem } from './sales/types';
import { formatMoney } from '../utils/money';

const headers = (): HeadersInit => ({ Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}` });
const invoiceLabel = (sale: Pick<SalesLedgerItem, 'id' | 'invoiceNumber' | 'invoiceSeries'>) => sale.invoiceNumber
    ? `${sale.invoiceSeries ?? 'A'}-${String(sale.invoiceNumber).padStart(6, '0')}`
    : sale.id.slice(0, 12);

export default function Sales() {
    const [canManagePending] = useState(() => {
        try { return ['OWNER', 'ADMIN', 'MANAGER'].includes(JSON.parse(localStorage.getItem('nortex_user') ?? '{}').role ?? ''); }
        catch { return false; }
    });
    const [tab, setTab] = useState<'history' | 'approvals' | 'pending'>('history');
    const [sales, setSales] = useState<SalesLedgerItem[]>([]);
    const [requests, setRequests] = useState<CorrectionRequest[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedSale, setSelectedSale] = useState<ReturnableSale | null>(null);
    const [approverEmail, setApproverEmail] = useState('');
    const [approverPassword, setApproverPassword] = useState('');
    const [workingRequestId, setWorkingRequestId] = useState<string | null>(null);

    const loadSales = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const response = await fetch(`/api/sales?take=50${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`, { headers: headers() });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos cargar las ventas');
            setSales(body.items ?? []);
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos cargar las ventas'); }
        finally { setLoading(false); }
    }, [query]);

    const loadRequests = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const response = await fetch('/api/sale-corrections', { headers: headers() });
            const body = await response.json().catch(() => []);
            if (!response.ok) throw new Error(body.error || 'No pudimos cargar aprobaciones');
            setRequests(Array.isArray(body) ? body : []);
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos cargar aprobaciones'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (tab !== 'pending') void (tab === 'history' ? loadSales() : loadRequests()); }, [tab, loadSales, loadRequests]);

    const openSale = async (saleId: string) => {
        setError('');
        try {
            const response = await fetch(`/api/sales/search?q=${encodeURIComponent(saleId)}`, { headers: headers() });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos abrir la venta');
            setSelectedSale(body);
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos abrir la venta'); }
    };

    const approveRequest = async (request: CorrectionRequest) => {
        setWorkingRequestId(request.id); setError('');
        try {
            const grantResponse = await fetch('/api/auth/approval-grants', {
                method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: approverEmail, password: approverPassword }),
            });
            const grant = await grantResponse.json().catch(() => ({}));
            if (!grantResponse.ok) throw new Error(grant.error || 'No pudimos validar al aprobador');
            const response = await fetch(`/api/sale-corrections/${request.id}/approve`, {
                method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ grantToken: grant.grantToken }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos aprobar la solicitud');
            await loadRequests();
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos aprobar la solicitud'); }
        finally { setWorkingRequestId(null); }
    };

    const executeRequest = async (request: CorrectionRequest) => {
        setWorkingRequestId(request.id); setError('');
        try {
            const endpoint = request.kind === 'VOID' ? `/api/sales/${request.saleId}/cancel` : '/api/returns';
            const payload = request.kind === 'VOID'
                ? { correctionRequestId: request.id, motivo: request.reason }
                : {
                    correctionRequestId: request.id,
                    clientEventId: crypto.randomUUID(), saleId: request.saleId, reason: request.reason,
                    items: request.lines.map((line) => ({ saleItemId: line.saleItemId, quantity: line.quantity })),
                    ...(request.resolution === 'REFUND' && request.refundMethod ? { refundMethod: request.refundMethod } : {}),
                };
            const response = await fetch(endpoint, {
                method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos ejecutar la solicitud');
            if (request.resolution === 'EXCHANGE' && request.sale?.customerId && body?.id) {
                sessionStorage.setItem('nortex_pending_exchange', JSON.stringify({
                    customerId: request.sale.customerId,
                    customerName: request.sale.customerName ?? '',
                    returnId: body.id,
                }));
                window.location.assign('/app/pos');
                return;
            }
            await Promise.all([loadRequests(), loadSales()]);
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos ejecutar la solicitud'); }
        finally { setWorkingRequestId(null); }
    };

    return <div className="nx-app-shell min-h-full bg-surface-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="nx-tone-positive text-xs font-black uppercase tracking-[0.18em]">Operación</p><h1 className="mt-1 text-3xl font-black tracking-tight text-white">Ventas</h1><p className="mt-1 text-sm text-slate-400">Buscá comprobantes, devolvé productos o anulá errores sin borrar el historial.</p></div>
                <button type="button" onClick={() => void (tab === 'history' ? loadSales() : loadRequests())} className="nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-bold hover:bg-white/5"><RefreshCw size={16} />Actualizar</button>
            </header>

            <div className={`mb-5 grid ${canManagePending ? 'grid-cols-3' : 'grid-cols-2'} gap-2 rounded-2xl border border-white/10 bg-surface-900 p-1.5`}>
                <button type="button" onClick={() => setTab('history')} className={`nx-fluid-press min-h-tap rounded-xl px-4 py-3 text-sm font-bold ${tab === 'history' ? 'bg-brand text-brand-on' : 'text-slate-400'}`}>Historial de ventas</button>
                <button type="button" onClick={() => setTab('approvals')} className={`nx-fluid-press min-h-tap rounded-xl px-4 py-3 text-sm font-bold ${tab === 'approvals' ? 'bg-brand text-brand-on' : 'text-slate-400'}`}>Aprobaciones</button>
                {canManagePending && <button type="button" onClick={() => setTab('pending')} className={`nx-fluid-press min-h-tap rounded-xl px-4 py-3 text-sm font-bold ${tab === 'pending' ? 'bg-brand text-brand-on' : 'text-slate-400'}`}>Pendientes</button>}
            </div>

            {tab === 'history' && <>
                <form onSubmit={(event) => { event.preventDefault(); void loadSales(); }} className="mb-5 flex gap-2">
                    <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Factura A-000123, cliente, teléfono o ID" className="h-12 w-full rounded-xl border border-white/10 bg-surface-900 pl-10 pr-3 text-white outline-none focus:border-brand" /></div>
                    <button className="nx-fluid-press min-h-tap rounded-xl bg-brand px-5 font-black text-brand-on">Buscar</button>
                </form>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface-900">
                    {loading ? <div className="p-12 text-center text-slate-400"><Loader2 className="mr-2 inline animate-spin" />Cargando ventas…</div> : sales.length === 0 ? <div className="p-12 text-center text-slate-400">No encontramos ventas con ese criterio.</div> : sales.map((sale) => <button key={sale.id} type="button" onClick={() => void openSale(sale.id)} className="nx-fluid-press min-h-tap grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-white/[0.06] px-4 py-4 text-left last:border-0 hover:bg-white/[0.03] sm:grid-cols-[140px_1fr_130px_120px_auto]">
                        <div><p className="font-mono text-sm font-black text-white">{invoiceLabel(sale)}</p><p className="mt-0.5 text-[11px] text-slate-500">{new Date(sale.createdAt).toLocaleString('es-NI')}</p></div>
                        <div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-bold">{sale.customerName || 'Cliente de mostrador'}</p><p className="text-xs text-slate-500">{sale._count.items} producto(s) · {sale.paymentMethod}</p></div>
                        <p className="hidden text-right font-mono font-black sm:block">{formatMoney(sale.total)}</p>
                        <div className="hidden text-right sm:block"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${sale.status === 'VOIDED' ? 'bg-danger-soft text-danger' : sale._count.productReturns > 0 ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{sale.status === 'VOIDED' ? 'ANULADA' : sale._count.productReturns > 0 ? 'CON DEVOLUCIÓN' : 'VIGENTE'}</span></div>
                        <ChevronRight className="text-slate-600" size={18} />
                    </button>)}
                </div>
            </>}

            {tab === 'approvals' && <div className="space-y-3">
                <div className="grid gap-3 rounded-2xl border border-white/10 bg-surface-900 p-4 sm:grid-cols-2">
                    <input type="email" autoComplete="username" value={approverEmail} onChange={(event) => setApproverEmail(event.target.value)} placeholder="Correo del gerente o dueño" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
                    <input type="password" autoComplete="current-password" value={approverPassword} onChange={(event) => setApproverPassword(event.target.value)} placeholder="Contraseña para aprobar" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
                </div>
                {loading ? <div className="p-12 text-center text-slate-400"><Loader2 className="mr-2 inline animate-spin" />Cargando solicitudes…</div> : requests.length === 0 ? <div className="rounded-2xl border border-white/10 bg-surface-900 p-12 text-center text-slate-400">No hay solicitudes.</div> : requests.map((request) => <div key={request.id} className="rounded-2xl border border-white/10 bg-surface-900 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                    <div><p className="font-bold text-white">{request.kind === 'VOID' ? <Ban className="mr-2 inline text-danger" size={16} /> : <RefreshCw className="mr-2 inline text-amber-400" size={16} />}{request.kind === 'VOID' ? 'Anulación completa' : request.resolution === 'EXCHANGE' ? 'Cambio de productos' : 'Devolución'}</p><p className="mt-1 text-sm text-slate-400">{request.sale?.customerName || 'Cliente de mostrador'} · {request.reason}</p><p className="mt-1 text-xs text-slate-600"><Clock3 className="mr-1 inline" size={12} />{new Date(request.createdAt).toLocaleString('es-NI')}</p></div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0"><span className={`rounded-full px-3 py-1 text-[11px] font-black ${request.status === 'PENDING_APPROVAL' ? 'bg-amber-500/10 text-amber-300' : request.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-300'}`}>{request.status}</span>{request.status === 'PENDING_APPROVAL' && <button type="button" disabled={workingRequestId === request.id || !approverEmail || !approverPassword} onClick={() => void approveRequest(request)} className="nx-fluid-press min-h-tap rounded-lg bg-brand px-3 py-2 text-xs font-black text-brand-on disabled:opacity-40">{workingRequestId === request.id ? <Loader2 className="animate-spin" size={14} /> : 'Aprobar'}</button>}{request.status === 'APPROVED' && <button type="button" disabled={workingRequestId === request.id} onClick={() => void executeRequest(request)} className="nx-fluid-press min-h-tap rounded-lg bg-brand px-3 py-2 text-xs font-black text-brand-on hover:bg-brand-hover disabled:opacity-40">{workingRequestId === request.id ? <Loader2 className="animate-spin" size={14} /> : 'Ejecutar'}</button>}</div>
                </div>)}
            </div>}
            {tab === 'pending' && canManagePending && <PendingCorrections />}

            {error && <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
        </div>
        {selectedSale && <SaleCorrectionPanel sale={selectedSale} onClose={() => setSelectedSale(null)} onCompleted={async () => { await loadSales(); await loadRequests(); }} />}
    </div>;
}
