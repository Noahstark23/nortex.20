import React, { useEffect, useState, useCallback } from 'react';
import { ClipboardList, Plus, CheckCircle, XCircle, PackageCheck, X, RefreshCw } from 'lucide-react';

/** Órdenes de Compra (issue #77): DRAFT→APPROVED→PARTIALLY_RECEIVED→RECEIVED. */
interface POItem { id: string; productId: string; productName: string; quantityOrdered: number; quantityReceived: number; unitCost: string | number; }
interface PO { id: string; orderNumber: string; status: string; notes?: string | null; createdAt: string; supplier: { name: string }; items: POItem[]; }
interface Supplier { id: string; name: string; }
interface ProductLite { id: string; name: string; sku: string; cost: number; }

const H = (): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}` });
const BADGE: Record<string, string> = {
    DRAFT: 'bg-slate-500/20 text-slate-300', APPROVED: 'bg-blue-500/20 text-blue-400',
    PARTIALLY_RECEIVED: 'bg-amber-500/20 text-amber-400', RECEIVED: 'bg-emerald-500/20 text-emerald-400', CANCELLED: 'bg-red-500/20 text-red-400',
};
const LABEL: Record<string, string> = { DRAFT: 'BORRADOR', APPROVED: 'APROBADA', PARTIALLY_RECEIVED: 'PARCIAL', RECEIVED: 'RECIBIDA', CANCELLED: 'CANCELADA' };

const PurchaseOrders: React.FC = () => {
    const [orders, setOrders] = useState<PO[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [receiving, setReceiving] = useState<PO | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    // Form crear
    const [supplierId, setSupplierId] = useState('');
    const [rows, setRows] = useState<{ productId: string; name: string; quantity: string; unitCost: string }[]>([]);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<ProductLite[]>([]);
    // Form recibir: itemId → cantidad
    const [recv, setRecv] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        const r = await fetch('/api/purchase-orders', { headers: H() });
        if (r.ok) setOrders((await r.json()).data);
    }, []);
    useEffect(() => { load(); fetch('/api/suppliers', { headers: H() }).then(r => r.json()).then(setSuppliers).catch(() => {}); }, [load]);

    const searchProducts = async (q: string) => {
        setSearch(q);
        if (q.length < 2) { setResults([]); return; }
        const r = await fetch(`/api/products?search=${encodeURIComponent(q)}&pageSize=8`, { headers: H() });
        if (r.ok) setResults(await r.json());
    };

    const createPO = async () => {
        if (!supplierId || rows.length === 0) { alert('Proveedor y al menos un ítem son requeridos'); return; }
        const items = rows.map(r => ({ productId: r.productId, quantity: parseFloat(r.quantity), unitCost: parseFloat(r.unitCost) }));
        if (items.some(i => !(i.quantity > 0) || !(i.unitCost >= 0))) { alert('Cantidades y costos inválidos'); return; }
        const r = await fetch('/api/purchase-orders', { method: 'POST', headers: H(), body: JSON.stringify({ supplierId, items }) });
        const d = await r.json();
        if (r.ok) { setShowCreate(false); setRows([]); setSupplierId(''); load(); } else alert(d.error);
    };

    const act = async (po: PO, action: 'approve' | 'cancel') => {
        if (action === 'cancel' && !confirm(`¿Cancelar la OC ${po.orderNumber}?`)) return;
        setBusy(po.id);
        const r = await fetch(`/api/purchase-orders/${po.id}/${action}`, { method: 'POST', headers: H() });
        const d = await r.json();
        if (!r.ok) alert(d.error);
        setBusy(null); load();
    };

    const receive = async () => {
        if (!receiving) return;
        const items = Object.entries(recv).filter(([, q]) => parseFloat(q) > 0)
            .map(([itemId, q]) => ({ itemId, quantityReceived: parseFloat(q) }));
        if (items.length === 0) { alert('Indicá al menos una cantidad a recibir'); return; }
        const r = await fetch(`/api/purchase-orders/${receiving.id}/receive`, { method: 'POST', headers: H(), body: JSON.stringify({ items }) });
        const d = await r.json();
        if (r.ok) { setReceiving(null); setRecv({}); load(); } else alert(d.error);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2"><ClipboardList className="text-brand" /> Órdenes de Compra</h1>
                <div className="flex gap-2">
                    <button onClick={load} className="p-2 text-slate-400 hover:text-white"><RefreshCw size={16} /></button>
                    <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-brand text-white rounded-lg font-bold text-sm flex items-center gap-1.5"><Plus size={16} /> Nueva OC</button>
                </div>
            </div>

            <div className="space-y-3">
                {orders.map(po => (
                    <div key={po.id} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                                <span className="font-mono font-bold text-white">{po.orderNumber}</span>
                                <span className={`ml-3 px-2 py-0.5 rounded text-[10px] font-bold ${BADGE[po.status] ?? BADGE.DRAFT}`}>{LABEL[po.status] ?? po.status}</span>
                                <div className="text-xs text-slate-400 mt-1">{po.supplier.name} · {new Date(po.createdAt).toLocaleDateString('es-NI')}</div>
                            </div>
                            <div className="flex gap-2">
                                {po.status === 'DRAFT' && (
                                    <>
                                        <button disabled={busy === po.id} onClick={() => act(po, 'approve')} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold flex items-center gap-1"><CheckCircle size={13} /> Aprobar</button>
                                        <button disabled={busy === po.id} onClick={() => act(po, 'cancel')} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-bold flex items-center gap-1"><XCircle size={13} /> Cancelar</button>
                                    </>
                                )}
                                {(po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED') && (
                                    <button onClick={() => { setReceiving(po); setRecv({}); }} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1"><PackageCheck size={13} /> Recibir</button>
                                )}
                            </div>
                        </div>
                        <table className="w-full text-xs mt-3">
                            <tbody className="divide-y divide-slate-700/50">
                                {po.items.map(it => (
                                    <tr key={it.id} className="text-slate-300">
                                        <td className="py-1.5">{it.productName}</td>
                                        <td className="py-1.5 text-right font-mono">{it.quantityReceived}/{it.quantityOrdered} und</td>
                                        <td className="py-1.5 text-right font-mono text-slate-400">C$ {Number(it.unitCost).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
                {orders.length === 0 && <div className="text-center text-slate-500 py-12">Sin órdenes de compra. Creá la primera con "Nueva OC".</div>}
            </div>

            {/* Modal crear */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center"><h3 className="font-bold text-white">Nueva Orden de Compra</h3><button onClick={() => setShowCreate(false)} className="text-slate-400"><X size={18} /></button></div>
                        <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm">
                            <option value="">— Proveedor —</option>
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <div>
                            <input value={search} onChange={e => searchProducts(e.target.value)} placeholder="Buscar producto para agregar…"
                                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm" />
                            {results.length > 0 && (
                                <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700 max-h-40 overflow-y-auto">
                                    {results.map(p => (
                                        <button key={p.id} onClick={() => { setRows(prev => [...prev, { productId: p.id, name: p.name, quantity: '1', unitCost: String(p.cost ?? 0) }]); setSearch(''); setResults([]); }}
                                            className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">{p.name} <span className="text-slate-500 font-mono text-xs">{p.sku}</span></button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {rows.map((r, i) => (
                            <div key={i} className="flex gap-2 items-center text-sm">
                                <span className="flex-1 text-slate-200 truncate">{r.name}</span>
                                <input value={r.quantity} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x))} className="w-16 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" title="Cantidad" />
                                <input value={r.unitCost} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, unitCost: e.target.value.replace(/[^\d.]/g, '') } : x))} className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" title="Costo unitario" />
                                <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-red-400"><X size={14} /></button>
                            </div>
                        ))}
                        <button onClick={createPO} className="w-full py-2.5 bg-brand text-white rounded-lg font-bold text-sm">Crear borrador</button>
                    </div>
                </div>
            )}

            {/* Modal recibir */}
            {receiving && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg p-5 space-y-4">
                        <div className="flex justify-between items-center"><h3 className="font-bold text-white">Recibir {receiving.orderNumber}</h3><button onClick={() => setReceiving(null)} className="text-slate-400"><X size={18} /></button></div>
                        <p className="text-xs text-slate-400">Ingresá lo que llegó físicamente (recepción parcial permitida). El stock, costo promedio y Kardex se actualizan solos.</p>
                        {receiving.items.map(it => {
                            const pending = it.quantityOrdered - it.quantityReceived;
                            return (
                                <div key={it.id} className="flex gap-2 items-center text-sm">
                                    <span className="flex-1 text-slate-200 truncate">{it.productName} <span className="text-slate-500 text-xs">(pendiente {pending})</span></span>
                                    <input value={recv[it.id] ?? ''} onChange={e => setRecv(prev => ({ ...prev, [it.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                                        placeholder="0" className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" disabled={pending <= 0} />
                                </div>
                            );
                        })}
                        <button onClick={receive} className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-sm">Confirmar recepción</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrders;
