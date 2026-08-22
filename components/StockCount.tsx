import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ClipboardList, Plus, X, Search, Check, AlertTriangle, Loader2, ScanLine,
    TrendingDown, TrendingUp, Lock, ChevronLeft, Package, Trash2, Warehouse as WarehouseIcon
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';

// ==========================================
// TYPES
// ==========================================

interface StockCountSummary {
    id: string;
    warehouseId: string | null;
    warehouse?: { id: string; name: string } | null;
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
    product: { name: string; sku: string; unit: string; cost?: number };
}

interface CountDetail {
    count: StockCountSummary;
    items: CountItem[];
}

interface WarehouseOption {
    id: string;
    name: string;
    isDefault: boolean;
    isActive: boolean;
}

const formatCurrency = (n: number) => formatMoney(n);
const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const sanitizeCountInput = (value: string): string | null => {
    if (!/^\d*(?:\.\d{0,4})?$/.test(value)) return null;
    return value.replace(/^0+(?=\d)/, '');
};
export const parseCountInput = (value: string): number | null => {
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Abierta', color: 'bg-blue-900/60 text-blue-300 border-blue-700' },
    CLOSING: { label: 'Cerrando', color: 'bg-amber-900/60 text-amber-300 border-amber-700' },
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
    const [createWarehouseId, setCreateWarehouseId] = useState('');
    const [categories, setCategories] = useState<string[]>([]);
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [warehousesLoading, setWarehousesLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // Captura
    const [search, setSearch] = useState('');
    const [inputs, setInputs] = useState<Record<string, string>>({}); // productId → texto del input
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
    const [closing, setClosing] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const { toast, showToast, dismissToast } = useToast();

    const confirmationDialogRef = useRef<HTMLDivElement>(null);
    const confirmationSafeActionRef = useRef<HTMLButtonElement>(null);
    const confirmationReturnFocusRef = useRef<HTMLElement | null>(null);
    const confirmationBusyRef = useRef(false);
    confirmationBusyRef.current = closing || cancelling;

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }), [token]);
    const roleCapabilities = useMemo(() => roleCapabilitiesFor(currentSessionRole()), []);
    const { canManageWarehouseTopology, canViewInventoryValuation } = roleCapabilities;

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

    const fetchWarehouses = useCallback(async () => {
        setWarehousesLoading(true);
        try {
            const res = await fetch('/api/warehouses', { headers });
            if (res.ok) {
                const payload = await res.json();
                const available = (payload.data || []).filter((warehouse: WarehouseOption) => warehouse.isActive);
                setWarehouses(available);
                setCreateWarehouseId(current => {
                    if (current && available.some((warehouse: WarehouseOption) => warehouse.id === current)) return current;
                    return available.length === 1 ? available[0].id : '';
                });
            }
        } catch (e) {
            console.error('Error fetching warehouses:', e);
        } finally {
            setWarehousesLoading(false);
        }
    }, [headers]);

    const openCreateForm = () => {
        setCreateWarehouseId(current => current || (warehouses.length === 1 ? warehouses[0].id : ''));
        setShowCreate(true);
    };

    useEffect(() => {
        fetchCounts();
        fetchCategories();
        fetchWarehouses();
    }, [fetchCounts, fetchCategories, fetchWarehouses]);

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
        if (!createWarehouseId) {
            showToast({
                tone: 'warning',
                title: 'Elegí una bodega',
                message: 'La toma física necesita una ubicación para aplicar las diferencias de forma segura.',
            });
            return;
        }
        if (createScope === 'CATEGORY' && !createCategory) {
            showToast({ tone: 'warning', title: 'Elegí una categoría', message: 'Seleccioná qué grupo de productos vas a contar.' });
            return;
        }
        setCreating(true);
        try {
            const body: any = {
                warehouseId: createWarehouseId,
                scope: createScope,
                notes: createNotes.trim() || undefined,
            };
            if (createScope === 'CATEGORY') {
                body.category = createCategory;
            }
            const res = await fetch('/api/stock-counts', { method: 'POST', headers, body: JSON.stringify(body) });
            const data = await res.json();
            if (res.ok) {
                setShowCreate(false);
                setCreateScope('ALL'); setCreateCategory(''); setCreateNotes(''); setCreateWarehouseId('');
                await fetchCounts();
                await openDetail(data.count.id);
            } else {
                showToast({ tone: 'error', title: 'No se pudo crear la toma', message: data.error || 'Revisá los datos e intentá de nuevo.' });
            }
        } catch (e) {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No pudimos crear la toma física. Revisá tu conexión e intentá de nuevo.' });
        } finally {
            setCreating(false);
        }
    };

    // Guardar el conteo de un producto (PATCH). counted ya parseado.
    const saveCount = useCallback(async (productId: string, counted: number) => {
        if (!detail) return;
        const previousCount = detail.items.find(it => it.productId === productId)?.counted ?? null;
        const restorePreviousCount = () => {
            setInputs(prev => {
                const next = { ...prev };
                if (previousCount === null) delete next[productId];
                else next[productId] = String(previousCount);
                return next;
            });
        };
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
                restorePreviousCount();
                showToast({ tone: 'error', title: 'No se guardó el conteo', message: d.error || 'El valor anterior se mantuvo. Intentá de nuevo.' });
            }
        } catch (e) {
            restorePreviousCount();
            showToast({ tone: 'error', title: 'No se guardó el conteo', message: 'Revisá tu conexión. El valor anterior se mantuvo.' });
        } finally {
            setSavingIds(prev => { const n = new Set(prev); n.delete(productId); return n; });
        }
    }, [detail, headers, showToast]);

    const updateCountInput = useCallback((productId: string, value: string) => {
        const sanitized = sanitizeCountInput(value);
        if (sanitized === null) {
            setInputs(prev => ({ ...prev, [productId]: '' }));
            showToast({
                tone: 'warning',
                title: 'Cantidad inválida',
                message: 'Usá un valor positivo con hasta cuatro decimales y punto como separador.',
            });
            return;
        }
        setInputs(prev => ({ ...prev, [productId]: sanitized }));
    }, [showToast]);

    const commitCountInput = useCallback((item: CountItem, rawValue: string) => {
        if (rawValue === '') return;
        const counted = parseCountInput(rawValue);
        if (counted === null) {
            setInputs(prev => {
                const next = { ...prev };
                if (item.counted === null) delete next[item.productId];
                else next[item.productId] = String(item.counted);
                return next;
            });
            showToast({
                tone: 'warning',
                title: 'Cantidad inválida',
                message: 'Ingresá un número igual o mayor que cero, con hasta cuatro decimales.',
            });
            return;
        }
        if (counted !== item.counted) void saveCount(item.productId, counted);
    }, [saveCount, showToast]);

    const closeCount = async () => {
        if (!detail) return;
        setClosing(true);
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/close`, { method: 'POST', headers });
            const data = await res.json();
            if (res.ok) {
                setShowCloseConfirm(false);
                const resultParts = [`${data.adjusted} ajuste(s) aplicado(s)`];
                if (canViewInventoryValuation && data.lossValue > 0) resultParts.push(`merma ${formatCurrency(data.lossValue)}`);
                if (canViewInventoryValuation && data.gainValue > 0) resultParts.push(`sobrante ${formatCurrency(data.gainValue)}`);
                if (data.uncounted > 0) resultParts.push(`${data.uncounted} producto(s) sin contar no se ajustaron`);
                showToast({ tone: 'success', title: 'Toma física cerrada', message: `${resultParts.join(' · ')}.` });
                setDetail(null);
                fetchCounts();
            } else {
                showToast({ tone: 'error', title: 'No se pudo cerrar la toma', message: data.error || 'El inventario no fue ajustado. Intentá de nuevo.' });
            }
        } catch (e) {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No pudimos confirmar el cierre. Revisá el estado de la toma antes de reintentar.' });
        } finally {
            setClosing(false);
        }
    };

    const cancelCount = async () => {
        if (!detail) return;
        setCancelling(true);
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/cancel`, { method: 'POST', headers });
            if (res.ok) {
                setShowCancelConfirm(false);
                showToast({ tone: 'success', title: 'Toma física cancelada', message: 'No se aplicó ningún ajuste y el historial quedó disponible para consulta.' });
                setDetail(null);
                fetchCounts();
            } else {
                const d = await res.json();
                showToast({ tone: 'error', title: 'No se pudo cancelar la toma', message: d.error || 'Intentá de nuevo.' });
            }
        } catch {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'La toma sigue abierta. Revisá tu conexión e intentá de nuevo.' });
        } finally {
            setCancelling(false);
        }
    };

    const closeConfirmationDialogs = useCallback(() => {
        if (confirmationBusyRef.current) return;
        setShowCloseConfirm(false);
        setShowCancelConfirm(false);
    }, []);

    const openCloseConfirmation = (trigger: HTMLElement) => {
        confirmationReturnFocusRef.current = trigger;
        setShowCloseConfirm(true);
    };

    const openCancelConfirmation = (trigger: HTMLElement) => {
        confirmationReturnFocusRef.current = trigger;
        setShowCancelConfirm(true);
    };

    const confirmationOpen = showCloseConfirm || showCancelConfirm;

    useEffect(() => {
        if (!confirmationOpen) return;

        const dialog = confirmationDialogRef.current;
        const returnFocus = confirmationReturnFocusRef.current
            ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        const focusFrame = window.requestAnimationFrame(() => {
            (confirmationSafeActionRef.current ?? dialog)?.focus();
        });

        const keepFocusInside = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeConfirmationDialogs();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const focusable = (Array.from(dialog.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            )) as HTMLElement[]).filter(element => element.getAttribute('aria-hidden') !== 'true');

            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', keepFocusInside);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', keepFocusInside);
            if (returnFocus?.isConnected && !returnFocus.hasAttribute('disabled')) returnFocus.focus();
            confirmationReturnFocusRef.current = null;
        };
    }, [confirmationOpen, closeConfirmationDialogs]);

    // ==========================================
    // ESCÁNER (suma 1 al contado del SKU escaneado)
    // ==========================================
    const scanBuffer = useRef('');
    const scanTimer = useRef<any>(null);

    useEffect(() => {
        if (!detail || detail.count.status !== 'OPEN' || !detail.count.warehouseId) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
            if (e.key === 'Enter') {
                const code = scanBuffer.current.trim();
                scanBuffer.current = '';
                if (code.length < 3) return;
                const item = detail.items.find(it => it.product.sku.toLowerCase() === code.toLowerCase());
                if (item) {
                    const inputCount = inputs[item.productId] !== undefined ? parseCountInput(inputs[item.productId]) : null;
                    const current = inputCount ?? item.counted ?? 0;
                    const next = Math.trunc(current) + 1;
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
    const openWarehouseIds = useMemo(
        () => new Set(counts.filter((count) => ['OPEN', 'CLOSING'].includes(count.status) && count.warehouseId).map((count) => count.warehouseId as string)),
        [counts],
    );
    const selectedWarehouseHasOpenCount = createWarehouseId ? openWarehouseIds.has(createWarehouseId) : false;
    const createFormValid = Boolean(createWarehouseId)
        && !selectedWarehouseHasOpenCount
        && (createScope !== 'CATEGORY' || Boolean(createCategory));

    const detailStats = useMemo(() => {
        if (!detail) return { total: 0, counted: 0, lossValue: 0, gainValue: 0, diffUnits: 0 };
        let counted = 0, lossValue = 0, gainValue = 0, diffUnits = 0;
        for (const it of detail.items) {
            const raw = inputs[it.productId];
            const val = raw !== undefined && raw !== '' ? parseCountInput(raw) : (it.counted ?? null);
            if (val === null) continue;
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
        const canOperate = isOpen && Boolean(detail.count.warehouseId);
        return (
            <div className="p-4 sm:p-6 max-w-6xl mx-auto">
                <ToastViewport toast={toast} onDismiss={dismissToast} />

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
                                <span className="inline-flex items-center gap-1 text-blue-300 font-medium">
                                    <WarehouseIcon size={14} />
                                    {detail.count.warehouse?.name || 'Ubicación histórica/no especificada'}
                                </span>
                                {' '}· {detail.count.scope === 'CATEGORY' ? `Categoría: ${detail.count.category}` : 'Todo el inventario'}
                                {' '}· Creada {formatDate(detail.count.createdAt)}
                                {detail.count.creator ? ` por ${detail.count.creator.name}` : ''}
                            </p>
                            {detail.count.notes && <p className="text-sm text-slate-500 mt-1 italic">"{detail.count.notes}"</p>}
                        </div>
                        {isOpen && (
                            <div className="flex items-center gap-2">
                                <button onClick={(event) => openCancelConfirmation(event.currentTarget)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-600">
                                    <Trash2 size={15} /> Cancelar
                                </button>
                                {canOperate && (
                                    <button onClick={(event) => openCloseConfirmation(event.currentTarget)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors">
                                        <Lock size={15} /> Cerrar y ajustar
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {!detail.count.warehouseId && (
                        <div className="mt-4 bg-amber-950/50 border border-amber-700/60 rounded-lg p-3 flex items-start gap-2" role="alert">
                            <AlertTriangle size={17} className="text-amber-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-amber-200">Conteo histórico sin ubicación</p>
                                <p className="text-xs text-amber-300/80 mt-0.5">No es seguro aplicar este snapshot al inventario actual. Cancélalo y crea una toma nueva eligiendo la bodega.</p>
                            </div>
                        </div>
                    )}

                    {/* Stats */}
                    <div className={`grid grid-cols-2 ${canViewInventoryValuation ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-3 mt-4`}>
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400">Progreso</p>
                            <p className="text-lg font-bold text-white">{detailStats.counted}<span className="text-sm text-slate-500"> / {detailStats.total}</span></p>
                        </div>
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400">Diferencia</p>
                            <p className={`text-lg font-bold ${detailStats.diffUnits < 0 ? 'text-red-400' : detailStats.diffUnits > 0 ? 'text-emerald-400' : 'text-white'}`}>
                                {detailStats.diffUnits > 0 ? '+' : ''}{detailStats.diffUnits}
                            </p>
                        </div>
                        {canViewInventoryValuation && (
                            <>
                                <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                                    <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingDown size={12} className="text-red-400" /> Merma estimada</p>
                                    <p className="text-lg font-bold text-red-400">{formatCurrency(detailStats.lossValue)}</p>
                                </div>
                                <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                                    <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingUp size={12} className="text-emerald-400" /> Sobrante estimado</p>
                                    <p className="text-lg font-bold text-emerald-400">{formatCurrency(detailStats.gainValue)}</p>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            aria-label="Buscar producto o SKU"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar producto o SKU..."
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    {canOperate && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                            <ScanLine size={15} className="text-blue-400" /> Escanea para sumar 1
                        </div>
                    )}
                </div>

                {/* Items */}
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="sm:hidden divide-y divide-slate-700/50" aria-label="Productos de la toma física">
                        {filteredItems.map((it) => {
                            const raw = inputs[it.productId];
                            const val = raw !== undefined && raw !== '' ? parseCountInput(raw) : (it.counted ?? null);
                            const diff = val !== null ? val - it.expected : null;
                            const isSaving = savingIds.has(it.productId);
                            const isCounted = it.counted !== null;
                            const inputId = `stock-count-mobile-${it.id}`;
                            return (
                                <article key={it.id} className="p-4" aria-busy={isSaving}>
                                    <div className="flex items-start gap-2">
                                        {isCounted && <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />}
                                        <div className="min-w-0">
                                            <h2 className="text-sm font-semibold text-white break-words">{it.product.name}</h2>
                                            <p className="text-xs text-slate-400 font-mono mt-1 break-all">SKU: {it.product.sku}</p>
                                        </div>
                                    </div>

                                    <dl className="grid grid-cols-2 gap-3 mt-4">
                                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 p-3">
                                            <dt className="text-xs text-slate-400">Esperado</dt>
                                            <dd className="text-base font-semibold text-slate-200 mt-1">{it.expected} {it.product.unit}</dd>
                                        </div>
                                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 p-3">
                                            <dt className="text-xs text-slate-400">Diferencia</dt>
                                            <dd className={`text-base font-bold mt-1 ${diff === null ? 'text-slate-600' : diff < 0 ? 'text-red-400' : diff > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                                {diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff}`}
                                            </dd>
                                        </div>
                                        <div className="col-span-2">
                                            <dt className="flex items-center justify-between gap-2 mb-1.5">
                                                    <label htmlFor={inputId} className="text-xs font-medium text-slate-300">Contado</label>
                                                {isSaving && (
                                                    <span className="inline-flex items-center gap-1.5 text-xs text-blue-300" role="status">
                                                        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Guardando...
                                                    </span>
                                                )}
                                            </dt>
                                            <dd>
                                                {canOperate ? (
                                                    <input
                                                        id={inputId}
                                                        aria-label={`Conteo físico de ${it.product.name}`}
                                                        type="text"
                                                        inputMode="decimal"
                                                        pattern="[0-9]*([.][0-9]{0,4})?"
                                                        value={raw ?? ''}
                                                        placeholder="Ingresa las unidades contadas"
                                                        onChange={(e) => updateCountInput(it.productId, e.target.value)}
                                                        onBlur={(e) => commitCountInput(it, e.target.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                        className="w-full min-h-11 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-base text-white text-right focus:outline-none focus:border-blue-500"
                                                    />
                                                ) : (
                                                    <div className="min-h-11 flex items-center justify-end bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-base font-semibold text-slate-200">
                                                        {it.counted ?? '—'}{it.counted !== null ? ` ${it.product.unit}` : ''}
                                                    </div>
                                                )}
                                            </dd>
                                        </div>
                                    </dl>
                                </article>
                            );
                        })}
                        {filteredItems.length === 0 && (
                            <p className="px-4 py-10 text-center text-slate-500">Sin productos que coincidan.</p>
                        )}
                    </div>

                    <div className="hidden sm:block overflow-x-auto">
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
                                    const val = raw !== undefined && raw !== '' ? parseCountInput(raw) : (it.counted ?? null);
                                    const diff = val !== null ? val - it.expected : null;
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
                                                {canOperate ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        {isSaving && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                                                        <input
                                                            aria-label={`Conteo físico de ${it.product.name}`}
                                                            type="text"
                                                            inputMode="decimal"
                                                            pattern="[0-9]*([.][0-9]{0,4})?"
                                                            value={raw ?? ''}
                                                            placeholder="—"
                                                            onChange={(e) => updateCountInput(it.productId, e.target.value)}
                                                            onBlur={(e) => commitCountInput(it, e.target.value)}
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
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeConfirmationDialogs}>
                        <div
                            ref={confirmationDialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="stock-count-close-title"
                            aria-describedby="stock-count-close-description"
                            tabIndex={-1}
                            className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl border border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
                                <Lock size={20} className="text-emerald-400" />
                                <h2 id="stock-count-close-title" className="text-lg font-bold text-white">Cerrar toma física</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <p id="stock-count-close-description" className="text-sm text-slate-300">
                                    Se ajustará exclusivamente <strong className="text-white">{detail.count.warehouse?.name}</strong>, se registrará el Kardex y el asiento contable de la merma/sobrante. <strong className="text-amber-300">Esta acción no se puede deshacer.</strong>
                                </p>
                                <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700 space-y-1.5 text-sm">
                                    <div className="flex justify-between"><span className="text-slate-400">Contados</span><span className="text-white font-semibold">{detailStats.counted} / {detailStats.total}</span></div>
                                    {detailStats.total - detailStats.counted > 0 && (
                                        <div className="flex justify-between"><span className="text-amber-400">Sin contar (no se ajustan)</span><span className="text-amber-400 font-semibold">{detailStats.total - detailStats.counted}</span></div>
                                    )}
                                    {canViewInventoryValuation && (
                                        <>
                                            <div className="flex justify-between"><span className="text-red-400">Merma estimada</span><span className="text-red-400 font-semibold">{formatCurrency(detailStats.lossValue)}</span></div>
                                            <div className="flex justify-between"><span className="text-emerald-400">Sobrante estimado</span><span className="text-emerald-400 font-semibold">{formatCurrency(detailStats.gainValue)}</span></div>
                                        </>
                                    )}
                                </div>
                                {detailStats.total - detailStats.counted > 0 && (
                                    <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                        <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                                        <p className="text-xs text-amber-300/80">Los productos sin contar se quedan con su stock actual (no se asumen en cero).</p>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-1">
                                    <button ref={confirmationSafeActionRef} type="button" onClick={closeConfirmationDialogs} disabled={closing} className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors">Volver</button>
                                    <button onClick={closeCount} disabled={closing} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                        {closing ? <><Loader2 size={15} className="animate-spin" /> Cerrando...</> : 'Confirmar cierre'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirmación de cancelación */}
                {showCancelConfirm && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeConfirmationDialogs}>
                        <div
                            ref={confirmationDialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="stock-count-cancel-title"
                            aria-describedby="stock-count-cancel-description"
                            tabIndex={-1}
                            className="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle size={21} className="text-red-300 mt-0.5 shrink-0" aria-hidden="true" />
                                    <div>
                                        <h2 id="stock-count-cancel-title" className="text-lg font-bold text-white">Cancelar toma física</h2>
                                        <p id="stock-count-cancel-description" className="text-sm text-slate-300 mt-1.5">
                                            Se descartará este conteo y <strong className="text-white">no se ajustará el stock de {detail.count.warehouse?.name || 'ninguna bodega'}</strong>. La toma seguirá visible en el historial como cancelada.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-6">
                                    <button ref={confirmationSafeActionRef} type="button" onClick={closeConfirmationDialogs} disabled={cancelling} className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors">
                                        Volver
                                    </button>
                                    <button type="button" onClick={() => void cancelCount()} disabled={cancelling} className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                        {cancelling ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Cancelando...</> : 'Cancelar toma'}
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
            <ToastViewport toast={toast} onDismiss={dismissToast} />

            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ClipboardList size={24} className="text-blue-400" /> Toma Física
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Cuenta una bodega a la vez. Las diferencias solo ajustan la ubicación elegida.</p>
                </div>
                <button onClick={openCreateForm} className="w-full sm:w-auto justify-center bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors">
                    <Plus size={16} /> Nueva toma física
                </button>
            </div>

            <section className="sm:hidden space-y-3" aria-label="Historial de tomas físicas">
                {loading ? (
                    <div className="bg-slate-800/60 rounded-xl border border-slate-700 px-4 py-12 text-center text-slate-400" role="status">
                        <Loader2 className="animate-spin inline mr-2" size={18} aria-hidden="true" /> Cargando...
                    </div>
                ) : counts.length === 0 ? (
                    <div className="bg-slate-800/60 rounded-xl border border-slate-700 px-4 py-14 text-center text-slate-500">
                        <Package size={40} className="opacity-30 mb-2 mx-auto" aria-hidden="true" />
                        <p>Aún no has hecho ninguna toma física.</p>
                        <p className="text-xs text-slate-600 mt-1">Crea una para cuadrar tu inventario real con el sistema.</p>
                    </div>
                ) : counts.map((c) => {
                    const actionLabel = c.status === 'OPEN' && c.warehouseId ? 'Continuar' : 'Ver detalle';
                    return (
                        <article
                            key={c.id}
                            className="w-full bg-slate-800/60 rounded-xl border border-slate-700 p-4 text-left"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <time dateTime={c.createdAt} className="text-sm font-medium text-slate-200">{formatDate(c.createdAt)}</time>
                                <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_META[c.status]?.color}`}>
                                    {STATUS_META[c.status]?.label}
                                </span>
                            </div>

                            <p className="flex items-start gap-2 text-sm font-semibold text-white mt-3 break-words">
                                <WarehouseIcon size={16} className={`shrink-0 mt-0.5 ${c.warehouse ? 'text-blue-400' : 'text-amber-400'}`} aria-hidden="true" />
                                {c.warehouse?.name || 'Bodega no especificada'}
                            </p>

                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4">
                                <div>
                                    <dt className="text-xs text-slate-500">Alcance</dt>
                                    <dd className="text-sm text-slate-300 mt-0.5 break-words">{c.scope === 'CATEGORY' ? c.category : 'Todo el inventario'}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">Productos</dt>
                                    <dd className="text-sm text-slate-300 mt-0.5">{c._count?.items ?? '—'}</dd>
                                </div>
                                <div className="col-span-2">
                                    <dt className="text-xs text-slate-500">Creada por</dt>
                                    <dd className="text-sm text-slate-300 mt-0.5 break-words">{c.creator?.name || '—'}</dd>
                                </div>
                            </dl>

                            <button
                                type="button"
                                onClick={() => openDetail(c.id)}
                                className="w-full mt-4 pt-3 border-t border-slate-700/70 flex items-center justify-end text-sm font-semibold text-blue-400 hover:text-blue-300 focus:outline-none focus:text-blue-200"
                                aria-label={`${actionLabel}: toma de ${c.warehouse?.name || 'bodega no especificada'}, ${formatDate(c.createdAt)}`}
                            >
                                {actionLabel} <span aria-hidden="true">→</span>
                            </button>
                        </article>
                    );
                })}
            </section>

            <div className="hidden sm:block bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-slate-900/80">
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Fecha</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Bodega</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Alcance</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Creada por</th>
                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Productos</th>
                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Estado</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {loading ? (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando...</td></tr>
                            ) : counts.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                                    <Package size={40} className="opacity-30 mb-2 mx-auto" />
                                    <p>Aún no has hecho ninguna toma física.</p>
                                    <p className="text-xs text-slate-600 mt-1">Crea una para cuadrar tu inventario real con el sistema.</p>
                                </td></tr>
                            ) : counts.map((c) => (
                                <tr key={c.id} className="hover:bg-slate-700/20 transition-colors cursor-pointer" onClick={() => openDetail(c.id)}>
                                    <td className="px-4 py-3 text-sm text-slate-300">{formatDate(c.createdAt)}</td>
                                    <td className="px-4 py-3 text-sm text-slate-300">
                                        <span className="inline-flex items-center gap-1.5">
                                            <WarehouseIcon size={14} className={c.warehouse ? 'text-blue-400' : 'text-amber-400'} />
                                            {c.warehouse?.name || 'No especificada'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-300">{c.scope === 'CATEGORY' ? c.category : 'Todo'}</td>
                                    <td className="px-4 py-3 text-sm text-slate-400">{c.creator?.name || '—'}</td>
                                    <td className="px-4 py-3 text-right text-sm text-slate-300">{c._count?.items ?? '—'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_META[c.status]?.color}`}>{STATUS_META[c.status]?.label}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={(event) => { event.stopPropagation(); openDetail(c.id); }}
                                            className="text-blue-400 text-sm hover:text-blue-300 focus:outline-none focus:text-blue-200"
                                            aria-label={`${c.status === 'OPEN' && c.warehouseId ? 'Continuar' : 'Ver detalle'}: toma de ${c.warehouse?.name || 'bodega no especificada'}, ${formatDate(c.createdAt)}`}
                                        >
                                            {c.status === 'OPEN' && c.warehouseId ? 'Continuar →' : 'Ver →'}
                                        </button>
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
                    <div className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Plus size={20} className="text-blue-400" /> Nueva toma física</h2>
                            <button aria-label="Cerrar" onClick={() => setShowCreate(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label htmlFor="stock-count-warehouse" className="block text-sm text-slate-300 mb-2 font-medium">
                                    Bodega a contar <span className="text-red-400">*</span>
                                </label>
                                <select
                                    id="stock-count-warehouse"
                                    value={createWarehouseId}
                                    onChange={(e) => setCreateWarehouseId(e.target.value)}
                                    disabled={warehousesLoading || warehouses.length === 0}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
                                >
                                    <option value="">{warehousesLoading ? 'Cargando bodegas...' : 'Selecciona una bodega...'}</option>
                                    {warehouses.map((warehouse) => {
                                        const hasOpenCount = openWarehouseIds.has(warehouse.id);
                                        return (
                                            <option key={warehouse.id} value={warehouse.id} disabled={hasOpenCount}>
                                                {warehouse.name}{warehouse.isDefault ? ' (Principal)' : ''}{hasOpenCount ? ' — conteo abierto' : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                                {!warehousesLoading && warehouses.length === 0 && (
                                    <p className="text-xs text-amber-300 mt-2">
                                        No hay bodegas activas.{' '}
                                        {canManageWarehouseTopology ? (
                                            <a href="/app/warehouses" className="underline hover:text-amber-200">Configurar bodegas</a>
                                        ) : (
                                            <span>Pedile a un administrador que active una bodega.</span>
                                        )}
                                    </p>
                                )}
                                {selectedWarehouseHasOpenCount && (
                                    <p className="text-xs text-amber-300 mt-2" role="alert">Esa bodega ya tiene una toma abierta. Continúa o cancela esa toma primero.</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Alcance</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setCreateScope('ALL')} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'ALL' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Todo el inventario</button>
                                    <button onClick={() => setCreateScope('CATEGORY')} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'CATEGORY' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Por categoría</button>
                                </div>
                            </div>
                            {createScope === 'CATEGORY' && (
                                <div>
                                    <label htmlFor="stock-count-category" className="block text-sm text-slate-300 mb-2 font-medium">Categoría</label>
                                    <select id="stock-count-category" value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                                        <option value="">Selecciona...</option>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label htmlFor="stock-count-notes" className="block text-sm text-slate-300 mb-2 font-medium">Notas (opcional)</label>
                                <input id="stock-count-notes" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder="Ej: conteo mensual de cierre" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                            </div>
                            <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={16} className="text-blue-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-blue-300/80">Se tomará una foto del stock de la bodega elegida. Evita ventas o movimientos mientras cuentas; si ocurren, vuelve a verificar los productos afectados antes de cerrar.</p>
                            </div>
                            <button onClick={createCount} disabled={creating || !createFormValid} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                {creating ? <><Loader2 size={15} className="animate-spin" /> Creando...</> : 'Crear y empezar a contar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
