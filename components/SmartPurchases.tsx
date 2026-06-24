import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Zap, Loader2, AlertTriangle, ShoppingCart, Check, RefreshCw, Truck, Package, X, TrendingDown
} from 'lucide-react';
import { sanitizeDecimalInput } from '../utils/money';

// ==========================================
// TYPES
// ==========================================

interface ReorderItem {
    productId: string;
    name: string;
    sku: string;
    category: string | null;
    currentStock: number;
    reorderPoint: number;
    maxStock: number;
    cost: number;
    supplierId: string | null;
    supplierName: string | null;
    vpd: number;
    daysRemaining: number | null;
    reason: 'BOTH' | 'REORDER_POINT' | 'VELOCITY';
    suggestedQty: number;
    suggestedCost: number;
}

interface Supplier { id: string; name: string; }

interface RowEdit { selected: boolean; qty: string; cost: string; supplierId: string; }

const formatCurrency = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON_META: Record<string, { label: string; color: string }> = {
    BOTH: { label: 'Reorden + Rotación', color: 'bg-red-900/50 text-red-300 border-red-700' },
    REORDER_POINT: { label: 'Bajo reorden', color: 'bg-amber-900/50 text-amber-300 border-amber-700' },
    VELOCITY: { label: 'Se agota pronto', color: 'bg-blue-900/50 text-blue-300 border-blue-700' },
};

export default function SmartPurchases() {
    const [items, setItems] = useState<ReorderItem[]>([]);
    const [edits, setEdits] = useState<Record<string, RowEdit>>({});
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT'>('CREDIT');
    const [showConfirm, setShowConfirm] = useState(false);
    const [generating, setGenerating] = useState(false);

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }), [token]);

    const fetchReorder = useCallback(async () => {
        setLoading(true);
        try {
            const [r1, r2] = await Promise.all([
                fetch('/api/inventory/reorder', { headers }),
                fetch('/api/suppliers', { headers }),
            ]);
            if (r1.ok) {
                const data = await r1.json();
                const list: ReorderItem[] = data.items || [];
                setItems(list);
                const init: Record<string, RowEdit> = {};
                for (const it of list) {
                    init[it.productId] = {
                        selected: true,
                        qty: String(it.suggestedQty),
                        cost: String(it.cost),
                        supplierId: it.supplierId || '',
                    };
                }
                setEdits(init);
            }
            if (r2.ok) setSuppliers(await r2.json());
        } catch (e) {
            console.error('Error fetching reorder:', e);
        } finally {
            setLoading(false);
        }
    }, [headers]);

    useEffect(() => { fetchReorder(); }, [fetchReorder]);

    const setEdit = (productId: string, patch: Partial<RowEdit>) =>
        setEdits(prev => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));

    // ==========================================
    // DERIVED
    // ==========================================
    // Una fila marcada está LISTA para ordenar si tiene cantidad entera ≥ 1,
    // costo > 0 y proveedor (POST /api/purchases exige int positivo y costo > 0).
    const rowReady = (it: ReorderItem) => {
        const e = edits[it.productId];
        if (!e || !e.selected) return false;
        const q = parseInt(e.qty, 10);
        const c = parseFloat(e.cost);
        return q >= 1 && c > 0 && !!e.supplierId;
    };

    const checkedRows = useMemo(() => items.filter(it => edits[it.productId]?.selected), [items, edits]);
    const validRows = useMemo(() => checkedRows.filter(rowReady), [checkedRows, edits]);
    const invalidCount = checkedRows.length - validRows.length;

    const totalSelected = useMemo(() => validRows.reduce((s, it) => {
        const e = edits[it.productId];
        return s + (parseInt(e.qty, 10) || 0) * (parseFloat(e.cost) || 0);
    }, 0), [validRows, edits]);

    // Agrupado por proveedor para el modal de confirmación (solo filas listas)
    const groups = useMemo(() => {
        const map: Record<string, { supplierId: string; supplierName: string; rows: ReorderItem[]; total: number }> = {};
        for (const it of validRows) {
            const e = edits[it.productId];
            const sid = e.supplierId;
            if (!map[sid]) {
                const sup = suppliers.find(s => s.id === sid);
                map[sid] = { supplierId: sid, supplierName: sup?.name || it.supplierName || 'Proveedor', rows: [], total: 0 };
            }
            map[sid].rows.push(it);
            map[sid].total += (parseInt(e.qty, 10) || 0) * (parseFloat(e.cost) || 0);
        }
        return Object.values(map);
    }, [validRows, edits, suppliers]);

    // ==========================================
    // GENERAR ÓRDENES → POST /api/purchases por proveedor
    // ==========================================
    const generateOrders = async () => {
        setGenerating(true);
        // Sello con milisegundos + sufijo aleatorio → evita choque de nº de orden
        // si se genera dos veces en el mismo segundo (p. ej. reintento).
        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
        const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
        let ok = 0, fail = 0;
        const errors: string[] = [];
        try {
            for (let i = 0; i < groups.length; i++) {
                const g = groups[i];
                const body = {
                    supplierId: g.supplierId,
                    invoiceNumber: `OC-${stamp}-${rnd}-${i + 1}`,
                    paymentMethod,
                    notes: 'Orden generada por reposición inteligente',
                    items: g.rows.map(it => {
                        const e = edits[it.productId];
                        return { productId: it.productId, quantity: parseInt(e.qty, 10), unitCost: parseFloat(e.cost) };
                    }),
                };
                try {
                    const res = await fetch('/api/purchases', { method: 'POST', headers, body: JSON.stringify(body) });
                    if (res.ok) ok++;
                    else { fail++; const d = await res.json().catch(() => ({})); errors.push(`${g.supplierName}: ${d.error || res.status}`); }
                } catch {
                    fail++; errors.push(`${g.supplierName}: error de red`);
                }
            }
            setShowConfirm(false);
            let msg = `${ok} orden(es) de compra creada(s).`;
            if (fail > 0) msg += `\n${fail} fallaron:\n${errors.join('\n')}`;
            alert(msg);
            fetchReorder();
        } finally {
            setGenerating(false);
        }
    };

    // ==========================================
    // RENDER
    // ==========================================
    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Zap size={24} className="text-amber-400" /> Compras Inteligentes
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">¿Qué reponer? Combina tu punto de reorden con la velocidad de venta y arma la orden de compra por proveedor.</p>
                </div>
                <button onClick={fetchReorder} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-600">
                    <RefreshCw size={15} /> Actualizar
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Loader2 className="animate-spin mb-3" size={28} />
                    Analizando inventario...
                </div>
            ) : items.length === 0 ? (
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-12 text-center">
                    <Check size={40} className="text-emerald-400 opacity-60 mx-auto mb-3" />
                    <p className="text-white font-semibold">Todo en orden</p>
                    <p className="text-sm text-slate-400 mt-1">No hay productos bajo el punto de reorden ni por agotarse. Define puntos de reorden en cada producto para afinar las sugerencias.</p>
                </div>
            ) : (
                <>
                    <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden mb-4">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-slate-900/80">
                                        <th className="px-3 py-3 w-10"></th>
                                        <th className="text-left px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Producto</th>
                                        <th className="text-center px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Motivo</th>
                                        <th className="text-right px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Stock</th>
                                        <th className="text-right px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Días</th>
                                        <th className="text-right px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Comprar</th>
                                        <th className="text-right px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Costo u.</th>
                                        <th className="text-left px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Proveedor</th>
                                        <th className="text-right px-3 py-3 text-xs text-slate-400 uppercase font-semibold">Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {items.map((it) => {
                                        const e = edits[it.productId];
                                        if (!e) return null;
                                        const subtotal = (parseInt(e.qty, 10) || 0) * (parseFloat(e.cost) || 0);
                                        const badQty = e.selected && !(parseInt(e.qty, 10) >= 1);
                                        const badCost = e.selected && !(parseFloat(e.cost) > 0);
                                        const noSupplier = e.selected && !e.supplierId;
                                        return (
                                            <tr key={it.productId} className={`transition-colors ${e.selected ? 'bg-slate-800/40' : 'opacity-60'} hover:bg-slate-700/20`}>
                                                <td className="px-3 py-3 text-center">
                                                    <input type="checkbox" checked={e.selected} onChange={(ev) => setEdit(it.productId, { selected: ev.target.checked })}
                                                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50" />
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="text-sm text-white font-medium">{it.name}</div>
                                                    <div className="text-xs text-slate-500 font-mono">{it.sku}</div>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${REASON_META[it.reason]?.color}`}>{REASON_META[it.reason]?.label}</span>
                                                </td>
                                                <td className="px-3 py-3 text-right text-sm text-slate-300">{it.currentStock}</td>
                                                <td className="px-3 py-3 text-right text-sm">
                                                    {it.daysRemaining === null ? <span className="text-slate-600">—</span> :
                                                        <span className={it.daysRemaining <= 3 ? 'text-red-400 font-semibold' : 'text-slate-300'}>{it.daysRemaining}d</span>}
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <input type="text" inputMode="numeric" value={e.qty} disabled={!e.selected}
                                                        onChange={(ev) => setEdit(it.productId, { qty: ev.target.value.replace(/[^\d]/g, '') })}
                                                        className={`w-20 bg-slate-900 border rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-amber-500 disabled:opacity-50 ${badQty ? 'border-red-600/70' : 'border-slate-600'}`} />
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <input type="text" inputMode="decimal" value={e.cost} disabled={!e.selected}
                                                        onChange={(ev) => setEdit(it.productId, { cost: sanitizeDecimalInput(ev.target.value) })}
                                                        className={`w-24 bg-slate-900 border rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-amber-500 disabled:opacity-50 ${badCost ? 'border-red-600/70' : 'border-slate-600'}`} />
                                                </td>
                                                <td className="px-3 py-3">
                                                    <select value={e.supplierId} disabled={!e.selected}
                                                        onChange={(ev) => setEdit(it.productId, { supplierId: ev.target.value })}
                                                        className={`w-40 bg-slate-900 border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50 ${noSupplier ? 'border-red-600/70' : 'border-slate-600'}`}>
                                                        <option value="">— Asignar —</option>
                                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3 text-right text-sm font-semibold text-white">{formatCurrency(subtotal)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Barra de acción */}
                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 sticky bottom-4 shadow-2xl">
                        <div className="flex items-center gap-4">
                            <div>
                                <p className="text-xs text-slate-400">Listos</p>
                                <p className="text-lg font-bold text-white">{validRows.length} <span className="text-sm text-slate-500">/ {items.length}</span></p>
                                {invalidCount > 0 && <p className="text-[11px] text-red-400">{invalidCount} con datos incompletos</p>}
                            </div>
                            <div>
                                <p className="text-xs text-slate-400">Total estimado</p>
                                <p className="text-lg font-bold text-amber-400">{formatCurrency(totalSelected)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 mb-1">Forma de pago</p>
                                <div className="flex gap-1">
                                    <button onClick={() => setPaymentMethod('CREDIT')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${paymentMethod === 'CREDIT' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>Crédito</button>
                                    <button onClick={() => setPaymentMethod('CASH')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${paymentMethod === 'CASH' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>Contado</button>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowConfirm(true)}
                            disabled={validRows.length === 0 || invalidCount > 0}
                            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                        >
                            <ShoppingCart size={16} /> {invalidCount > 0 ? `Revisa ${invalidCount} fila(s)` : `Generar ${groups.length} orden(es)`}
                        </button>
                    </div>
                </>
            )}

            {/* Confirmación */}
            {showConfirm && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowConfirm(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700 flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Truck size={20} className="text-amber-400" /> Confirmar órdenes de compra</h2>
                            <button onClick={() => setShowConfirm(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-3">
                            <p className="text-sm text-slate-300">Se creará <strong className="text-white">una compra por proveedor</strong> ({paymentMethod === 'CREDIT' ? 'a crédito → cuenta por pagar' : 'de contado'}), ingresando el stock al inventario.</p>
                            {groups.map(g => (
                                <div key={g.supplierId} className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-semibold text-white flex items-center gap-1.5"><Truck size={14} className="text-slate-400" /> {g.supplierName}</span>
                                        <span className="text-sm font-bold text-amber-400">{formatCurrency(g.total)}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">{g.rows.length} producto(s)</p>
                                </div>
                            ))}
                            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-300/80">Se genera un número de orden automático (OC-…). Podrás editar la factura real del proveedor desde Compras al recibir la mercadería.</p>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-700 flex gap-3">
                            <button onClick={() => setShowConfirm(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors">Cancelar</button>
                            <button onClick={generateOrders} disabled={generating} className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                {generating ? <><Loader2 size={15} className="animate-spin" /> Creando...</> : `Crear ${groups.length} compra(s)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
