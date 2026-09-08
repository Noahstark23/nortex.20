import React, { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { AlertTriangle, Ban, CheckCircle2, Loader2, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type {
    CorrectionRequest,
    CorrectionResolution,
    RefundMethod,
    ReturnDisposition,
    ReturnableSale,
} from './types';
import { formatMoney } from '../../utils/money';

const authHeaders = (json = false): HeadersInit => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

const uuid = (): string => crypto.randomUUID();

const refundLabels: Record<RefundMethod, string> = {
    CASH: 'Efectivo', CARD: 'Tarjeta', QR: 'QR', TRANSFER: 'Transferencia',
};

interface DraftLine {
    saleItemId: string;
    quantity: string;
    disposition: ReturnDisposition;
}

interface Props {
    sale: ReturnableSale;
    onClose: () => void;
    onCompleted: () => Promise<void> | void;
}

export default function SaleCorrectionPanel({ sale, onClose, onCompleted }: Props) {
    const [kind, setKind] = useState<'RETURN' | 'VOID'>('RETURN');
    const [reason, setReason] = useState('');
    const [resolution, setResolution] = useState<CorrectionResolution>('REFUND');
    const [refundMethod, setRefundMethod] = useState<RefundMethod | ''>(
        sale.allowedRefundMethods.length === 1 ? sale.allowedRefundMethods[0] : '',
    );
    const [lines, setLines] = useState<DraftLine[]>(sale.items.map((item) => ({
        saleItemId: item.saleItemId, quantity: '0', disposition: 'RESTOCK',
    })));
    const [request, setRequest] = useState<CorrectionRequest | null>(null);
    const [approverEmail, setApproverEmail] = useState('');
    const [approverPassword, setApproverPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const selectedLines = useMemo(() => lines.filter((line) => {
        try { return new Decimal(line.quantity).greaterThan(0); } catch { return false; }
    }), [lines]);

    const estimatedTotal = useMemo(() => selectedLines.reduce((sum, line) => {
        const item = sale.items.find((candidate) => candidate.saleItemId === line.saleItemId);
        return item ? sum.plus(new Decimal(line.quantity).mul(item.refundUnitPrice)) : sum;
    }, new Decimal(0)), [sale.items, selectedLines]);

    const updateLine = (saleItemId: string, patch: Partial<DraftLine>) => {
        setLines((current) => current.map((line) => line.saleItemId === saleItemId ? { ...line, ...patch } : line));
        setError('');
    };

    const createRequest = async () => {
        setBusy(true);
        setError('');
        try {
            const payload = {
                clientEventId: uuid(), saleId: sale.id, kind, reason,
                ...(kind === 'RETURN' ? {
                    resolution,
                    ...(resolution === 'REFUND' ? { refundMethod } : {}),
                    lines: selectedLines,
                } : {}),
            };
            const response = await fetch('/api/sale-corrections', {
                method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos crear la solicitud');
            setRequest(body);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'No pudimos crear la solicitud');
        } finally { setBusy(false); }
    };

    const executeApproved = async (approved: CorrectionRequest) => {
        const endpoint = approved.kind === 'VOID' ? `/api/sales/${approved.saleId}/cancel` : '/api/returns';
        const payload = approved.kind === 'VOID'
            ? { correctionRequestId: approved.id, motivo: approved.reason }
            : {
                correctionRequestId: approved.id,
                clientEventId: uuid(),
                saleId: approved.saleId,
                reason: approved.reason,
                items: approved.lines.map((line) => ({ saleItemId: line.saleItemId, quantity: line.quantity })),
                ...(approved.resolution === 'REFUND' && approved.refundMethod
                    ? { refundMethod: approved.refundMethod }
                    : {}),
            };
        const response = await fetch(endpoint, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'La operación aprobada no pudo ejecutarse');
        return body;
    };

    const approveAndExecute = async () => {
        if (!request) return;
        setBusy(true);
        setError('');
        try {
            const grantResponse = await fetch('/api/auth/approval-grants', {
                method: 'POST', headers: authHeaders(true),
                body: JSON.stringify({ email: approverEmail, password: approverPassword }),
            });
            const grant = await grantResponse.json().catch(() => ({}));
            if (!grantResponse.ok) throw new Error(grant.error || 'No se pudo validar al aprobador');
            const approvalResponse = await fetch(`/api/sale-corrections/${request.id}/approve`, {
                method: 'POST', headers: authHeaders(true), body: JSON.stringify({ grantToken: grant.grantToken }),
            });
            const approved = await approvalResponse.json().catch(() => ({}));
            if (!approvalResponse.ok) throw new Error(approved.error || 'No se pudo aprobar la solicitud');
            const result = await executeApproved(approved);
            if (approved.resolution === 'EXCHANGE' && sale.customerId && result?.id) {
                sessionStorage.setItem('nortex_pending_exchange', JSON.stringify({
                    customerId: sale.customerId,
                    customerName: sale.customerName ?? '',
                    returnId: result.id,
                }));
                window.location.assign('/app/pos');
                return;
            }
            await onCompleted();
            onClose();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'No pudimos completar la operación');
        } finally { setBusy(false); }
    };

    const canRequest = reason.trim().length >= 10
        && (kind === 'VOID' || (selectedLines.length > 0 && (resolution !== 'REFUND' || Boolean(refundMethod))));

    return (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="sale-correction-title">
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-surface-900 shadow-2xl">
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-surface-900 px-5 py-4">
                    <div>
                        <h2 id="sale-correction-title" className="text-lg font-black text-white">Corregir venta</h2>
                        <p className="text-xs text-slate-400">Factura {sale.invoiceSeries ?? 'A'}-{String(sale.invoiceNumber ?? '').padStart(6, '0')}</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Cerrar"><X size={20} /></button>
                </header>

                <div className="space-y-5 p-5">
                    {!request ? <>
                        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-950 p-1.5">
                            <button type="button" onClick={() => setKind('RETURN')} className={`rounded-xl px-3 py-3 text-sm font-bold ${kind === 'RETURN' ? 'bg-amber-500 text-white' : 'text-slate-400'}`}><RotateCcw className="mr-2 inline" size={16} />Devolver o cambiar</button>
                            <button type="button" onClick={() => setKind('VOID')} className={`rounded-xl px-3 py-3 text-sm font-bold ${kind === 'VOID' ? 'bg-danger text-white' : 'text-slate-400'}`}><Ban className="mr-2 inline" size={16} />Anular completa</button>
                        </div>

                        {kind === 'RETURN' ? <>
                            <div className="space-y-3">
                                {sale.items.map((item) => {
                                    const line = lines.find((candidate) => candidate.saleItemId === item.saleItemId)!;
                                    return <div key={item.saleItemId} className="rounded-2xl border border-white/10 bg-surface-950/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div><p className="font-bold text-white">{item.productNameAtSale}</p><p className="text-xs text-slate-400">Disponible {item.returnableQuantity} {item.unitAtSale} · {formatMoney(item.refundUnitPrice)} c/u</p></div>
                                            <input aria-label={`Cantidad de ${item.productNameAtSale}`} inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(item.saleItemId, { quantity: event.target.value })} className="w-24 rounded-xl border border-white/10 bg-surface-900 px-3 py-2 text-right font-mono text-white" />
                                        </div>
                                        <div className="mt-3 grid grid-cols-3 gap-2">
                                            {(['RESTOCK', 'QUARANTINE', 'LOSS'] as const).map((value) => <button key={value} type="button" onClick={() => updateLine(item.saleItemId, { disposition: value })} className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${line.disposition === value ? 'border-brand bg-brand/15 text-brand-200' : 'border-white/10 text-slate-400'}`}>{value === 'RESTOCK' ? 'Revendible' : value === 'QUARANTINE' ? 'Cuarentena' : 'Pérdida'}</button>)}
                                        </div>
                                    </div>;
                                })}
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-bold text-slate-300">Resultado</label>
                                <select value={resolution} onChange={(event) => setResolution(event.target.value as CorrectionResolution)} className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white">
                                    <option value="REFUND">Reembolsar</option>
                                    <option value="EXCHANGE">Cambio de productos</option>
                                    <option value="STORE_CREDIT">Saldo a favor</option>
                                </select>
                            </div>
                            {resolution === 'REFUND' && <div>
                                <label className="mb-2 block text-xs font-bold text-slate-300">Canal del reembolso</label>
                                <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as RefundMethod)} className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white">
                                    <option value="">Seleccioná el canal</option>
                                    {sale.allowedRefundMethods.map((method) => <option key={method} value={method}>{refundLabels[method]}</option>)}
                                </select>
                            </div>}
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Total estimado: <strong className="float-right">{formatMoney(estimatedTotal)}</strong></div>
                        </> : <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-slate-200"><AlertTriangle className="mr-2 inline text-danger" size={18} />Solo se permitirá si la venta es de hoy, la caja original sigue abierta y no existen abonos ni devoluciones.</div>}

                        <div>
                            <label className="mb-2 block text-xs font-bold text-slate-300">Motivo obligatorio</label>
                            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} className="w-full rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" placeholder="Describí exactamente qué ocurrió" />
                        </div>
                        <button type="button" disabled={!canRequest || busy} onClick={() => void createRequest()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 font-black text-white disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}Enviar a aprobación</button>
                    </> : <div className="space-y-4">
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"><p className="font-bold text-emerald-200"><CheckCircle2 className="mr-2 inline" size={18} />Solicitud preparada</p><p className="mt-1 text-xs text-slate-300">Todavía no se movió dinero ni inventario. Un gerente o dueño debe autorizar.</p></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <input type="email" autoComplete="username" value={approverEmail} onChange={(event) => setApproverEmail(event.target.value)} placeholder="Correo del aprobador" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
                            <input type="password" autoComplete="current-password" value={approverPassword} onChange={(event) => setApproverPassword(event.target.value)} placeholder="Contraseña" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
                        </div>
                        <button type="button" disabled={busy || !approverEmail || !approverPassword} onClick={() => void approveAndExecute()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-black text-white disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}Aprobar y ejecutar</button>
                    </div>}
                    {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
                </div>
            </div>
        </div>
    );
}
