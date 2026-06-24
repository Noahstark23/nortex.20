import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ClipboardList, Plus, X, Search, Check, AlertTriangle, Loader2, ScanLine,
    TrendingDown, TrendingUp, Lock, ChevronLeft, Package, Trash2
} from 'lucide-react';
import { sanitizeDecimalInput } from '../utils/money';

// ==========================================
// TYPES
// ==========================================

interface StockCountSummary {
    id: string;
    status: string; // OPEN | CLOSED | CANCELLED
    scope: string;
    category: string | null;
    notes: string | null;
    createdAt: string;
    closedAt: string | null;
    creator?: { name: string };
    _count?: { items: number };
}

interface CountItem {
    id: string;
    productId: string;
    expected: number;
    counted: number | null;
    diff: number;
    countedAt: string | null;
    product: { name: string; sku: string; unit: string; cost: number; stock: number };
}

interface CountDetail {
    count: StockCountSummary;
    items: CountItem[];
}

const formatCurrency = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS_META: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Abierta', color: 'bg-blue-900/60 text-blue-300 border-blue-700' },
    CLOSED: { label: 'Cerrada', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' },
    CANCELLED: { label: 'Cancelada', color: 'bg-slate-700/60 text-slate-400 border-slate-600' },
};

export default function StockCount() {
    const [counts, setCounts] = useState<StockCountSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<CountDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Crear conteo
    const [showCreate, setShowCreate] = useState(false);
    const [createScope, setCreateScope] = useState<'ALL' | 'CATEGORY'>('ALL');
    const [createCategory, setCreateCategory] = useState('');
    const [createNotes, setCreateNotes] = useState('');
    const [categories, setCategories] = useState<string[]>([]);
    const [creating, setCreating] = useState(false);

    // Captura
    const [search, setSearch] = useState('');
    const [inputs, setInputs] = useState<Record<string, string>>({}); // productId → texto del input
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
    const [closing, setClosing] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }), [token]);

    // ==========================================
    // DATA
    // ==========================================

    const fetchCounts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/stock-counts', { headers });
            if (res.ok) setCounts(await res.json());
        } catch (e) {
            console.error('Error fetching counts:', e);
        } finally {
            setLoading(false);
        }
    }, [headers]);

    const fetchCategories = useCallback(async () => {
        try {
            const res = await fetch('/api/products/categories', { headers });
            if (res.ok) setCategories(await res.json());
        } catch { /* noop */ }
    }, [headers]);

    useEffect(() => { fetchCounts(); fetchCategories(); }, [fetchCounts, fetchCategories]);

    const openDetail = async (id: string) => {
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/stock-counts/${id}`, { headers });
            if (res.ok) {
                const data: CountDetail = await res.json();
                setDetail(data);
                // Pre-cargar inputs con lo ya contado
                const init: Record<string, string> = {};
                for (const it of data.items) if (it.counted !== null) init[it.productId] = String(it.counted);
                setInputs(init);
                setSearch('');
            }
        } catch (e) {
            console.error('Error opening count:', e);
        } finally {
            setDetailLoading(false);
        }
    };

    const createCount = async () => {
        setCreating(true);
        try {
            const body: any = { scope: createScope, notes: createNotes.trim() || undefined };
            if (createScope === 'CATEGORY') {
                if (!createCategory) { alert('Selecciona una categoría.'); setCreating(false); return; }
                body.category = createCategory;
            }
            const res = await fetch('/api/stock-counts', { method: 'POST', headers, body: JSON.stringify(body) });
            const data = await res.json();
            if (res.ok) {
                setShowCreate(false);
                setCreateScope('ALL'); setCreateCategory(''); setCreateNotes('');
                await fetchCounts();
                await openDetail(data.count.id);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error creando la toma física');
        } finally {
            setCreating(false);
        }
    };

    // Guardar el conteo de un producto (PATCH). counted ya parseado.
    const saveCount = useCallback(async (productId: string, counted: number) => {
        if (!detail) return;
        setSavingIds(prev => new Set(prev).add(productId));
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/count`, {
                method: 'PATCH', headers, body: JSON.stringify({ productId, counted }),
            });
            if (res.ok) {
                setDetail(prev => prev ? {
                    ...prev,
                    items: prev.items.map(it => it.productId === productId
                        ? { ...it, counted, countedAt: new Date().toISOString() }
                        : it),
                } : prev);
            } else {
                const d = await res.json();
                alert(`Error: ${d.error}`);
            }
        } catch (e) {
            alert('Error guardando el conteo');
        } finally {
            setSavingIds(prev => { const n = new Set(prev); n.delete(productId); return n; });
        }
    }, [detail, headers]);

    const closeCount = async () => {
        if (!detail) return;
        setClosing(true);
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/close`, { method: 'POST', headers });
            const data = await res.json();
            if (res.ok) {
                setShowCloseConfirm(false);
                let msg = `Toma física cerrada.\n${data.adjusted} ajuste(s) aplicado(s).`;
                if (data.lossValue > 0) msg += `\nMerma: ${formatCurrency(data.lossValue)}`;
                if (data.gainValue > 0) msg += `\nSobrante: ${formatCurrency(data.gainValue)}`;
                if (data.uncounted > 0) msg += `\n${data.uncounted} producto(s) sin contar (no se ajustaron).`;
                alert(msg);
                setDetail(null);
                fetchCounts();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error cerrando la toma física');
        } finally {
            setClosing(false);
        }
    };

    const cancelCount = async () => {
        if (!detail) return;
        if (!confirm('¿Cancelar esta toma física? No se aplicará ningún ajuste.')) return;
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/cancel`, { method: 'POST', headers });
            if (res.ok) { setDetail(null); fetchCounts(); }
            else { const d = await res.json(); alert(`Error: ${d.error}`); }
        } catch { alert('Error cancelando'); }
    };

    // ==========================================
    // ESCÁNER (suma 1 al contado del SKU escaneado)
    // ==========================================
    const scanBuffer = useRef('');
    const scanTimer = useRef<any>(null);

    useEffect(() => {
        if (!detail || detail.count.status !== 'OPEN') return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
            if (e.key === 'Enter') {
                const code = scanBuffer.current.trim();
                scanBuffer.current = '';
                if (code.length < 3) return;
                const item = detail.items.find(it => it.product.sku.toLowerCase() === code.toLowerCase());
                if (item) {
                    const current = inputs[item.productId] !== undefined ? parseFloat(inputs[item.productId]) : (item.counted ?? 0);
                    const next = (isNaN(current) ? 0 : current) + 1;
                    setInputs(prev => ({ ...prev, [item.productId]: String(next) }));
                    saveCount(item.productId, next);
                }
            } else if (e.key.length === 1) {
                scanBuffer.current += e.key;
                if (scanTimer.current) clearTimeout(scanTimer.current);
                scanTimer.current = setTimeout(() => { scanBuffer.current = ''; }, 100);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [detail, inputs, saveCount]);

    // ==========================================
    // DERIVED
    // ==========================================
    const openCount = counts.find(c => c.status === 'OPEN');

    const detailStats = useMemo(() => {
        if (!detail) return { total: 0, counted: 0, lossValue: 0, gainValue: 0, diffUnits: 0 };
        let counted = 0, lossValue = 0, gainValue = 0, diffUnits = 0;
        for (const it of detail.items) {
            const raw = inputs[it.productId];
            const val = raw !== undefined && raw !== '' ? parseFloat(raw) : (it.counted ?? null);
            if (val === null || isNaN(val)) continue;
            counted++;
            const diff = val - it.expected;
            diffUnits += diff;
            if (diff < 0) lossValue += Math.abs(diff) * (Number(it.product.cost) || 0);
            else if (diff > 0) gainValue += diff * (Number(it.product.cost) || 0);
        }
        return { total: detail.items.length, counted, lossValue, gainValue, diffUnits };
    }, [detail, inputs]);

    const filteredItems = useMemo(() => {
        if (!detail) return [];
        const q = search.trim().toLowerCase();
        if (!q) return detail.items;
        return detail.items.filter(it => it.product.name.toLowerCase().includes(q) || it.product.sku.toLowerCase().includes(q));
    }, [detail, search]);

    // ==========================================
    // RENDER — DETALLE / CAPTURA
    // ==========================================
    if (detail) {
        const isOpen = detail.count.status === 'OPEN';
        return (
            <div className="p-4 sm:p-6 max-w-6xl mx-auto">
                <button onClick={() => { setDetail(null); fetchCounts(); }} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 text-sm transition-colors">
                    <ChevronLeft size={18} /> Volver a tomas físicas
                </button>

                {/* Header */}
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5 mb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2">
                                <ClipboardList size={22} className="text-blue-400" />
                                <h1 className="text-xl font-bold text-white">Toma Física</h1>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_META[detail.count.status]?.color}`}>
                                    {STATUS_META[detail.count.status]?.label}
                                </span>
                            </div>
                            <p className="text-sm text-slate-400 mt-1">
                                {detail.count.scope === 'CATEGORY' ? `Categoría: ${detail.count.category}` : 'Todo el inventario'}
                                {' '}· Creada {formatDate(detail.count.createdAt)}
                                {detail.count.creator ? ` por ${detail.count.creator.name}` : ''}
                            </p>
                            {detail.count.notes && <p className="text-sm text-slate-500 mt-1 italic">"{detail.count.notes}"</p>}
                        </div>
                        {isOpen && (
                            <div className="flex items-center gap-2">
                                <button onClick={cancelCount} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-600">
                                    <Trash2 size={15} /> Cancelar
                                </button>
                                <button onClick={() => setShowCloseConfirm(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors">
                                    <Lock size={15} /> Cerrar y ajustar
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400">Progreso</p>
                            <p className="text-lg font-bold text-white">{detailStats.counted}<span className="text-sm text-slate-500"> / {detailStats.total}</span></p>
                        </div>
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400">Diferencia (uds)</p>
                            <p className={`text-lg font-bold ${detailStats.diffUnits < 0 ? 'text-red-400' : detailStats.diffUnits > 0 ? 'text-emerald-400' : 'text-white'}`}>
                                {detailStats.diffUnits > 0 ? '+' : ''}{detailStats.diffUnits}
                            </p>
                        </div>
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingDown size={12} className="text-red-400" /> Merma estimada</p>
                            <p className="text-lg font-bold text-red-400">{formatCurrency(detailStats.lossValue)}</p>
                        </div>
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingUp size={12} className="text-emerald-400" /> Sobrante estimado</p>
                            <p className="text-lg font-bold text-emerald-400">{formatCurrency(detailStats.gainValue)}</p>
                        </div>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar producto o SKU..."
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    {isOpen && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                            <ScanLine size={15} className="text-blue-400" /> Escanea para sumar 1
                        </div>
                    )}
                </div>

                {/* Items */}
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-900/80">
                                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Producto</th>
                                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">SKU</th>
                                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Esperado</th>
                                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Contado</th>
                                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Diferencia</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {filteredItems.map((it) => {
                                    const raw = inputs[it.productId];
                                    const val = raw !== undefined && raw !== '' ? parseFloat(raw) : (it.counted ?? null);
                                    const diff = val !== null && !isNaN(val) ? val - it.expected : null;
                                    const isSaving = savingIds.has(it.productId);
                                    const isCounted = it.counted !== null;
                                    return (
                                        <tr key={it.id} className="hover:bg-slate-700/20 transition-colors">
                                            <td className="px-4 py-3 text-sm text-white font-medium flex items-center gap-2">
                                                {isCounted && <Check size={14} className="text-emerald-400 shrink-0" />}
                                                {it.product.name}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-400 font-mono">{it.product.sku}</td>
                                            <td className="px-4 py-3 text-right text-sm text-slate-300">{it.expected} {it.product.unit}</td>
                                            <td className="px-4 py-3 text-right">
                                                {isOpen ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        {isSaving && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={raw ?? ''}
                                                            placeholder="—"
                                                            onChange={(e) => setInputs(prev => ({ ...prev, [it.productId]: sanitizeDecimalInput(e.target.value) }))}
                                                            onBlur={(e) => {
                                                                const v = e.target.value;
                                                                if (v === '' ) return;
                                                                const n = parseFloat(v);
                                                                if (!isNaN(n) && n >= 0 && n !== it.counted) saveCount(it.productId, n);
                                                            }}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                            className="w-24 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-blue-500"
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-slate-300">{it.counted ?? '—'}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {diff === null ? (
                                                    <span className="text-slate-600 text-sm">—</span>
                                                ) : (
                                                    <span className={`font-bold text-sm ${diff < 0 ? 'text-red-400' : diff > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                                                        {diff > 0 ? '+' : ''}{diff}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredItems.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Sin productos que coincidan.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Confirmación de cierre */}
                {showCloseConfirm && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCloseConfirm(false)}>
                        <div className="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                            <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
                                <Lock size={20} className="text-emerald-400" />
                                <h2 className="text-lg font-bold text-white">Cerrar toma física</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-slate-300">
                                    Se aplicarán los ajustes de stock al Kardex y se registrará el asiento contable de la merma/sobrante. <strong className="text-amber-300">Esta acción no se puede deshacer.</strong>
                                </p>
                                <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700 space-y-1.5 text-sm">
                                    <div className="flex justify-between"><span className="text-slate-400">Contados</span><span className="text-white font-semibold">{detailStats.counted} / {detailStats.total}</span></div>
                                    {detailStats.total - detailStats.counted > 0 && (
                                        <div className="flex justify-between"><span className="text-amber-400">Sin contar (no se ajustan)</span><span className="text-amber-400 font-semibold">{detailStats.total - detailStats.counted}</span></div>
                                    )}
                                    <div className="flex justify-between"><span className="text-red-400">Merma estimada</span><span className="text-red-400 font-semibold">{formatCurrency(detailStats.lossValue)}</span></div>
                                    <div className="flex justify-between"><span className="text-emerald-400">Sobrante estimado</span><span className="text-emerald-400 font-semibold">{formatCurrency(detailStats.gainValue)}</span></div>
                                </div>
                                {detailStats.total - detailStats.counted > 0 && (
                                    <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                        <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                                        <p className="text-xs text-amber-300/80">Los productos sin contar se quedan con su stock actual (no se asumen en cero).</p>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-1">
                                    <button onClick={() => setShowCloseConfirm(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors">Cancelar</button>
                                    <button onClick={closeCount} disabled={closing} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                        {closing ? <><Loader2 size={15} className="animate-spin" /> Cerrando...</> : 'Confirmar cierre'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ==========================================
    // RENDER — LISTA / HISTORIAL
    // ==========================================
    return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ClipboardList size={24} className="text-blue-400" /> Toma Física
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Cuenta el inventario real y cuadra el sistema. Las diferencias generan ajuste de Kardex y asiento de merma.</p>
                </div>
                {openCount ? (
                    <button onClick={() => openDetail(openCount.id)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors">
                        <ClipboardList size={16} /> Continuar conteo abierto
                    </button>
                ) : (
                    <button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors">
                        <Plus size={16} /> Nueva toma física
                    </button>
                )}
            </div>

            <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-slate-900/80">
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Fecha</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Alcance</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Creada por</th>
                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Productos</th>
                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Estado</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {loading ? (
                                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando...</td></tr>
                            ) : counts.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                                    <Package size={40} className="opacity-30 mb-2 mx-auto" />
                                    <p>Aún no has hecho ninguna toma física.</p>
                                    <p className="text-xs text-slate-600 mt-1">Crea una para cuadrar tu inventario real con el sistema.</p>
                                </td></tr>
                            ) : counts.map((c) => (
                                <tr key={c.id} className="hover:bg-slate-700/20 transition-colors cursor-pointer" onClick={() => openDetail(c.id)}>
                                    <td className="px-4 py-3 text-sm text-slate-300">{formatDate(c.createdAt)}</td>
                                    <td className="px-4 py-3 text-sm text-slate-300">{c.scope === 'CATEGORY' ? c.category : 'Todo'}</td>
                                    <td className="px-4 py-3 text-sm text-slate-400">{c.creator?.name || '—'}</td>
                                    <td className="px-4 py-3 text-right text-sm text-slate-300">{c._count?.items ?? '—'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_META[c.status]?.color}`}>{STATUS_META[c.status]?.label}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-blue-400 text-sm hover:text-blue-300">{c.status === 'OPEN' ? 'Continuar →' : 'Ver →'}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {detailLoading && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40">
                    <Loader2 className="animate-spin text-blue-400" size={32} />
                </div>
            )}

            {/* Crear */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Plus size={20} className="text-blue-400" /> Nueva toma física</h2>
                            <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Alcance</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setCreateScope('ALL')} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'ALL' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Todo el inventario</button>
                                    <button onClick={() => setCreateScope('CATEGORY')} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'CATEGORY' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Por categoría</button>
                                </div>
                            </div>
                            {createScope === 'CATEGORY' && (
                                <div>
                                    <label className="block text-sm text-slate-300 mb-2 font-medium">Categoría</label>
                                    <select value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                                        <option value="">Selecciona...</option>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Notas (opcional)</label>
                                <input value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder="Ej: conteo mensual de cierre" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                            </div>
                            <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={16} className="text-blue-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-blue-300/80">Se tomará una foto del stock actual del sistema como "esperado". Haz el conteo idealmente sin ventas en proceso.</p>
                            </div>
                            <button onClick={createCount} disabled={creating} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                {creating ? <><Loader2 size={15} className="animate-spin" /> Creando...</> : 'Crear y empezar a contar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
