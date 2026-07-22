import React, { useEffect, useState, useCallback } from 'react';
import { Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Star, RefreshCw, X } from 'lucide-react';

/** Multi-bodega: lista, stock por bodega y transferencias (Fase 3). */
interface Warehouse { id: string; name: string; address?: string | null; isDefault: boolean; isActive: boolean; }
interface StockItem { productId: string; name: string; sku: string; unit: string; stock: number; implicit: boolean; }

const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

const Warehouses: React.FC = () => {
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [selected, setSelected] = useState<Warehouse | null>(null);
    const [stock, setStock] = useState<StockItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [newName, setNewName] = useState('');
    const [transfer, setTransfer] = useState<{ toId: string; productId: string; qty: string } | null>(null);
    const [msg, setMsg] = useState('');

    const load = useCallback(async () => {
        const res = await fetch('/api/warehouses', { headers: authHeaders() });
        if (res.ok) {
            const d = await res.json();
            setWarehouses(d.data);
            if (!selected && d.data.length) setSelected(d.data.find((w: Warehouse) => w.isDefault) ?? d.data[0]);
        }
    }, [selected]);

    const loadStock = useCallback(async (wh: Warehouse) => {
        setLoading(true);
        const res = await fetch(`/api/warehouses/${wh.id}/stock`, { headers: authHeaders() });
        if (res.ok) { const d = await res.json(); setStock(d.data.items); }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (selected) loadStock(selected); }, [selected, loadStock]);

    const createWarehouse = async () => {
        if (!newName.trim()) return;
        const res = await fetch('/api/warehouses', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: newName.trim() }) });
        const d = await res.json();
        if (res.ok) { setNewName(''); load(); } else alert(d.error);
    };

    const doTransfer = async () => {
        if (!transfer || !selected) return;
        const qty = parseFloat(transfer.qty);
        if (!(qty > 0)) { alert('Cantidad inválida'); return; }
        const res = await fetch('/api/stock-transfers', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ fromWarehouseId: selected.id, toWarehouseId: transfer.toId, items: [{ productId: transfer.productId, quantity: qty }] }),
        });
        const d = await res.json();
        if (res.ok) { setMsg('✓ Transferencia realizada'); setTransfer(null); loadStock(selected); setTimeout(() => setMsg(''), 3000); }
        else alert(d.error);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto text-slate-800">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2"><WarehouseIcon className="text-brand" /> Bodegas</h1>
                {msg && <span className="text-emerald-600 font-bold text-sm">{msg}</span>}
                <button onClick={() => selected && loadStock(selected)} className="p-2 hover:bg-slate-100 rounded-lg"><RefreshCw size={16} /></button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Lista + crear */}
                <div className="space-y-2">
                    {warehouses.map(w => (
                        <button key={w.id} onClick={() => setSelected(w)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${selected?.id === w.id ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="font-bold text-sm flex items-center gap-1.5">{w.name}{w.isDefault && <Star size={12} className="text-amber-500 fill-amber-500" />}</div>
                            {!w.isActive && <span className="text-[10px] text-red-500">INACTIVA</span>}
                        </button>
                    ))}
                    <div className="flex gap-2 pt-2">
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nueva bodega"
                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                        <button onClick={createWarehouse} className="p-2 bg-brand text-white rounded-lg"><Plus size={16} /></button>
                    </div>
                </div>

                {/* Stock de la bodega seleccionada */}
                <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">
                        Existencias en {selected?.name ?? '—'} {loading && '…'}
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                            <tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">SKU</th><th className="p-3 text-right">Stock</th><th className="p-3"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {stock.map(it => (
                                <tr key={it.productId}>
                                    <td className="p-3">{it.name}{it.implicit && <span className="ml-2 text-[9px] text-slate-400" title="Stock legado aún no movido en esta bodega">IMPLÍCITO</span>}</td>
                                    <td className="p-3 text-slate-500 font-mono text-xs">{it.sku}</td>
                                    <td className="p-3 text-right font-mono font-bold">{it.stock} {it.unit}</td>
                                    <td className="p-3 text-right">
                                        {warehouses.filter(w => w.isActive).length > 1 && it.stock > 0 && (
                                            <button onClick={() => setTransfer({ toId: warehouses.find(w => w.id !== selected?.id && w.isActive)!.id, productId: it.productId, qty: '' })}
                                                className="text-brand hover:bg-brand/10 p-1.5 rounded" title="Transferir a otra bodega">
                                                <ArrowRightLeft size={14} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {stock.length === 0 && !loading && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Sin existencias en esta bodega</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal de transferencia */}
            {transfer && selected && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2"><ArrowRightLeft size={18} className="text-brand" /> Transferir desde {selected.name}</h3>
                            <button onClick={() => setTransfer(null)}><X size={18} /></button>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500">Bodega destino</label>
                            <select value={transfer.toId} onChange={e => setTransfer({ ...transfer, toId: e.target.value })}
                                className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm">
                                {warehouses.filter(w => w.id !== selected.id && w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500">Cantidad</label>
                            <input value={transfer.qty} onChange={e => setTransfer({ ...transfer, qty: e.target.value.replace(/[^\d.]/g, '') })}
                                inputMode="decimal" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" autoFocus />
                        </div>
                        <button onClick={doTransfer} className="w-full py-2.5 bg-brand text-white rounded-lg font-bold text-sm">Transferir</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Warehouses;
