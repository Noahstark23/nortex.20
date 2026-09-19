import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PackageCheck, ReceiptText } from 'lucide-react';
import { formatMoney } from '../../utils/money';

const authHeaders = (): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

type Refund = {
    id: string; amount: string; method: string; createdAt: string;
    sale: { invoiceNumber: number | null; invoiceSeries: string | null; customerName: string | null };
};
type Inspection = {
    id: string; quantity: string; createdAt: string;
    product: { name: string; sku: string; unit: string };
};

export default function PendingCorrections() {
    const [refunds, setRefunds] = useState<Refund[]>([]);
    const [inspections, setInspections] = useState<Inspection[]>([]);
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    const [working, setWorking] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [returnWindowDays, setReturnWindowDays] = useState(30);
    const [canConfigure] = useState(() => {
        try { return ['OWNER', 'ADMIN'].includes(JSON.parse(localStorage.getItem('nortex_user') ?? '{}').role ?? ''); }
        catch { return false; }
    });

    const load = useCallback(async () => {
        setError('');
        try {
            const [refundResponse, inspectionResponse] = await Promise.all([
                fetch('/api/return-refunds?status=PENDING', { headers: authHeaders() }),
                fetch('/api/return-inspections?status=PENDING', { headers: authHeaders() }),
            ]);
            const [refundBody, inspectionBody] = await Promise.all([refundResponse.json(), inspectionResponse.json()]);
            if (!refundResponse.ok) throw new Error(refundBody.error || 'No pudimos cargar reembolsos');
            if (!inspectionResponse.ok) throw new Error(inspectionBody.error || 'No pudimos cargar cuarentena');
            setRefunds(refundBody); setInspections(inspectionBody);
            if (canConfigure) {
                const settingsResponse = await fetch('/api/tenant/return-settings', { headers: authHeaders() });
                if (settingsResponse.ok) {
                    const settings = await settingsResponse.json();
                    setReturnWindowDays(Number(settings.returnWindowDays ?? 30));
                }
            }
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos cargar pendientes'); }
    }, [canConfigure]);

    useEffect(() => { void load(); }, [load]);

    const completeRefund = async (id: string) => {
        setWorking(id); setError('');
        try {
            const response = await fetch(`/api/return-refunds/${id}/complete`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({ externalReference: reference, evidenceNote: note }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos completar el reembolso');
            setReference(''); setNote(''); await load();
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos completar el reembolso'); }
        finally { setWorking(null); }
    };

    const resolveInspection = async (id: string, resolution: 'RESTOCK' | 'DISCARD') => {
        setWorking(id); setError('');
        try {
            const response = await fetch(`/api/return-inspections/${id}/resolve`, {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ resolution, reason: note || (resolution === 'RESTOCK' ? 'Producto inspeccionado y apto para reventa' : 'Producto inspeccionado y descartado por daño') }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos resolver la inspección');
            setNote(''); await load();
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos resolver la inspección'); }
        finally { setWorking(null); }
    };

    const saveSettings = async () => {
        setWorking('settings'); setError('');
        try {
            const response = await fetch('/api/tenant/return-settings', {
                method: 'PUT', headers: authHeaders(), body: JSON.stringify({ returnWindowDays }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos guardar el plazo');
            setReturnWindowDays(Number(body.returnWindowDays));
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos guardar el plazo'); }
        finally { setWorking(null); }
    };

    return <div className="space-y-6">
        {canConfigure && <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-900 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="font-black text-white">Política de devoluciones</h2><p className="mt-1 text-xs text-slate-400">Plazo estándar; las excepciones vencidas exigen un motivo ampliado y aprobación.</p></div>
            <div className="flex items-end gap-2"><label className="text-xs font-bold text-slate-300">Días<input type="number" min={0} max={365} value={returnWindowDays} onChange={(event) => setReturnWindowDays(Number(event.target.value))} className="mt-1 block w-24 rounded-xl border border-white/10 bg-surface-950 px-3 py-2 text-white" /></label><button type="button" disabled={working === 'settings' || !Number.isInteger(returnWindowDays) || returnWindowDays < 0 || returnWindowDays > 365} onClick={() => void saveSettings()} className="nx-fluid-press min-h-tap rounded-xl bg-brand px-4 py-2 font-black text-brand-on disabled:opacity-40">Guardar</button></div>
        </section>}
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-surface-900 p-4 sm:grid-cols-2">
            <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Referencia bancaria o del adquirente" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evidencia o motivo de inspección" className="rounded-xl border border-white/10 bg-surface-950 px-3 py-3 text-white" />
        </div>

        <section><h2 className="mb-3 flex items-center gap-2 text-lg font-black"><ReceiptText size={19} className="text-sky-400" />Reembolsos externos pendientes</h2>
            <div className="space-y-3">{refunds.length === 0 ? <p className="rounded-2xl border border-white/10 bg-surface-900 p-6 text-sm text-slate-400">No hay reembolsos externos pendientes.</p> : refunds.map((refund) => <div key={refund.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-900 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-white">{refund.sale.customerName || 'Cliente de mostrador'} · {formatMoney(refund.amount)}</p><p className="text-xs text-slate-400">{refund.method} · Factura {refund.sale.invoiceSeries ?? 'A'}-{refund.sale.invoiceNumber ?? '—'}</p></div><button type="button" disabled={working === refund.id || reference.trim().length < 4 || note.trim().length < 4} onClick={() => void completeRefund(refund.id)} className="nx-fluid-press min-h-tap rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-40">{working === refund.id ? <Loader2 className="animate-spin" size={16} /> : <><CheckCircle2 className="mr-2 inline" size={16} />Marcar enviado</>}</button></div>)}</div>
        </section>

        <section><h2 className="mb-3 flex items-center gap-2 text-lg font-black"><PackageCheck size={19} className="text-amber-400" />Productos en cuarentena</h2>
            <div className="space-y-3">{inspections.length === 0 ? <p className="rounded-2xl border border-white/10 bg-surface-900 p-6 text-sm text-slate-400">No hay productos esperando inspección.</p> : inspections.map((inspection) => <div key={inspection.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-900 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-white">{inspection.product.name}</p><p className="text-xs text-slate-400">{inspection.quantity} {inspection.product.unit} · SKU {inspection.product.sku}</p></div><div className="flex gap-2"><button type="button" disabled={working === inspection.id} onClick={() => void resolveInspection(inspection.id, 'DISCARD')} className="nx-fluid-press min-h-tap rounded-xl border border-danger/30 px-3 py-2 text-xs font-black text-danger">Descartar</button><button type="button" disabled={working === inspection.id} onClick={() => void resolveInspection(inspection.id, 'RESTOCK')} className="nx-fluid-press min-h-tap rounded-xl bg-brand px-3 py-2 text-xs font-black text-brand-on hover:bg-brand-hover">Liberar a stock</button></div></div>)}</div>
        </section>
        {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
    </div>;
}
