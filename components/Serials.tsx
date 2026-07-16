import React, { useEffect, useState, useCallback } from 'react';
import { ScanBarcode, Plus, Search, X, RefreshCw } from 'lucide-react';

/** Control de series por unidad (issue #77): registrar, listar, trazar, mover estado. */
interface Serial { id: string; serial: string; status: string; createdAt: string; product: { name: string; sku: string }; }
interface Lookup { serial: string; status: string; product: { name: string; sku: string }; sale?: { id: string; createdAt: string; total: string | number } | null; purchase?: { id: string; invoiceNumber: string } | null; }
interface ProductLite { id: string; name: string; sku: string; }

const H = (): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}` });
const BADGE: Record<string, string> = { IN_STOCK: 'bg-emerald-500/20 text-emerald-400', SOLD: 'bg-blue-500/20 text-blue-400', RETURNED: 'bg-amber-500/20 text-amber-400', VOID: 'bg-red-500/20 text-red-400' };
const STATUSES = ['IN_STOCK', 'SOLD', 'RETURNED', 'VOID'];

const Serials: React.FC = () => {
    const [serials, setSerials] = useState<Serial[]>([]);
    const [filter, setFilter] = useState({ status: '', q: '' });
    const [showAdd, setShowAdd] = useState(false);
    const [lookup, setLookup] = useState<Lookup | null>(null);
    const [lookupQ, setLookupQ] = useState('');
    // Alta
    const [prodSearch, setProdSearch] = useState('');
    const [results, setResults] = useState<ProductLite[]>([]);
    const [product, setProduct] = useState<ProductLite | null>(null);
    const [bulk, setBulk] = useState('');

    const load = useCallback(async () => {
        const p = new URLSearchParams();
        if (filter.status) p.set('status', filter.status);
        if (filter.q) p.set('q', filter.q);
        const r = await fetch(`/api/serials?${p}`, { headers: H() });
        if (r.ok) setSerials((await r.json()).data);
    }, [filter]);
    useEffect(() => { load(); }, [load]);

    const searchProducts = async (q: string) => {
        setProdSearch(q);
        if (q.length < 2) { setResults([]); return; }
        const r = await fetch(`/api/products?search=${encodeURIComponent(q)}&pageSize=8`, { headers: H() });
        if (r.ok) setResults(await r.json());
    };

    const register = async () => {
        if (!product) { alert('Seleccioná el producto'); return; }
        const list = bulk.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
        if (list.length === 0) { alert('Pegá al menos una serie'); return; }
        const r = await fetch('/api/serials', { method: 'POST', headers: H(), body: JSON.stringify({ productId: product.id, serials: list }) });
        const d = await r.json();
        if (r.ok) { alert(`✓ ${d.registered} registradas${d.skipped ? ` · ${d.skipped} ya existían` : ''}`); setShowAdd(false); setBulk(''); setProduct(null); load(); }
        else alert(d.error);
    };

    const doLookup = async () => {
        if (!lookupQ.trim()) return;
        const r = await fetch(`/api/serials/lookup/${encodeURIComponent(lookupQ.trim())}`, { headers: H() });
        if (r.ok) setLookup((await r.json()).data); else { setLookup(null); alert('Serie no encontrada'); }
    };

    const changeStatus = async (id: string, status: string) => {
        const r = await fetch(`/api/serials/${id}/status`, { method: 'POST', headers: H(), body: JSON.stringify({ status }) });
        const d = await r.json();
        if (!r.ok) alert(d.error); else load();
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2"><ScanBarcode className="text-brand" /> Números de Serie</h1>
                <div className="flex gap-2">
                    <button onClick={load} className="p-2 text-slate-400 hover:text-white"><RefreshCw size={16} /></button>
                    <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-brand text-white rounded-lg font-bold text-sm flex items-center gap-1.5"><Plus size={16} /> Registrar series</button>
                </div>
            </div>

            {/* Trazador */}
            <div className="flex gap-2 mb-4">
                <input value={lookupQ} onChange={e => setLookupQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLookup()}
                    placeholder="Trazar una serie exacta (IMEI / S/N)…" className="flex-1 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono" />
                <button onClick={doLookup} className="px-4 bg-slate-700 text-white rounded-lg"><Search size={16} /></button>
            </div>
            {lookup && (
                <div className="mb-4 bg-slate-800/60 border border-brand/40 rounded-xl p-4 text-sm text-slate-200">
                    <div className="flex justify-between"><span className="font-mono font-bold">{lookup.serial}</span><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${BADGE[lookup.status]}`}>{lookup.status}</span></div>
                    <div className="text-slate-400 mt-1">{lookup.product.name} · {lookup.product.sku}</div>
                    {lookup.sale && <div className="text-xs mt-1 text-blue-300">Vendida el {new Date(lookup.sale.createdAt).toLocaleDateString('es-NI')} (venta {lookup.sale.id.slice(0, 8)}…)</div>}
                    {lookup.purchase && <div className="text-xs text-emerald-300">Ingresó con factura {lookup.purchase.invoiceNumber}</div>}
                </div>
            )}

            {/* Filtros + lista */}
            <div className="flex gap-2 mb-3">
                <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm">
                    <option value="">Todos los estados</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} placeholder="Filtrar por serie…"
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono" />
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-800 text-slate-500 text-xs uppercase"><tr><th className="p-3 text-left">Serie</th><th className="p-3 text-left">Producto</th><th className="p-3 text-center">Estado</th><th className="p-3"></th></tr></thead>
                    <tbody className="divide-y divide-slate-700/50">
                        {serials.map(s => (
                            <tr key={s.id} className="text-slate-200">
                                <td className="p-3 font-mono">{s.serial}</td>
                                <td className="p-3">{s.product.name} <span className="text-slate-500 text-xs">{s.product.sku}</span></td>
                                <td className="p-3 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${BADGE[s.status]}`}>{s.status}</span></td>
                                <td className="p-3 text-right">
                                    <select value={s.status} onChange={e => changeStatus(s.id, e.target.value)} className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300" title="Cambiar estado">
                                        {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                                    </select>
                                </td>
                            </tr>
                        ))}
                        {serials.length === 0 && <tr><td colSpan={4} className="p-10 text-center text-slate-500">Sin series registradas con ese filtro</td></tr>}
                    </tbody>
                </table>
            </div>

            {/* Modal registrar */}
            {showAdd && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-5 space-y-4">
                        <div className="flex justify-between items-center"><h3 className="font-bold text-white">Registrar series</h3><button onClick={() => setShowAdd(false)} className="text-slate-400"><X size={18} /></button></div>
                        {product ? (
                            <div className="flex justify-between items-center bg-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">{product.name}<button onClick={() => setProduct(null)} className="text-red-400"><X size={14} /></button></div>
                        ) : (
                            <div>
                                <input value={prodSearch} onChange={e => searchProducts(e.target.value)} placeholder="Buscar producto…" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm" />
                                {results.length > 0 && (
                                    <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700 max-h-40 overflow-y-auto">
                                        {results.map(p => <button key={p.id} onClick={() => { setProduct(p); setResults([]); setProdSearch(''); }} className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">{p.name} <span className="text-slate-500 font-mono text-xs">{p.sku}</span></button>)}
                                    </div>
                                )}
                            </div>
                        )}
                        <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={5} placeholder={'Una serie por línea (o separadas por coma):\nIMEI-001\nIMEI-002'}
                            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono" />
                        <p className="text-[11px] text-slate-500">Activa el control de series del producto automáticamente. Duplicadas se ignoran.</p>
                        <button onClick={register} className="w-full py-2.5 bg-brand text-white rounded-lg font-bold text-sm">Registrar</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Serials;
