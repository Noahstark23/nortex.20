import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ClipboardList, Plus, X, Search, Check, AlertTriangle, Loader2, ScanLine,
    TrendingDown, TrendingUp, Lock, ChevronLeft, Package, Trash2, Warehouse as WarehouseIcon
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';
import { resolveProductQuantityRules } from '../utils/productQuantityRules';
import { useLocation } from 'react-router-dom';
import { CameraScanButton } from './ui/CameraScanButton';
import { FluidSheet } from './ui/FluidSheet';
import { StockCountWorkspaceList } from './inventory/StockCountWorkspaceList';
import { readStockWorkspaceContext, stockWorkspaceHref } from './inventory/WarehouseWorkspaceHeader';

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
    bookStockAtCapture?: number | string | null;
    product: { name: string; brand?: string | null; sku: string; unit: string; cost?: number; saleMode?: string | null; quantityStep?: string | number | null };
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
    value = value.replace(',', '.');
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
    const location = useLocation();
    const context = useMemo(() => readStockWorkspaceContext(location.search), [location.search]);
    const latestWarehouseContext = useRef(context.warehouseId);
    latestWarehouseContext.current = context.warehouseId;
    const appliedWarehouseContext = useRef<string | null>(null);
    const [contextProductId, setContextProductId] = useState(context.productId);
    const returnHref = stockWorkspaceHref('/app/inventory', { search: context.search, productId: context.productId });
    const [counts, setCounts] = useState<StockCountSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<CountDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [warehouseError, setWarehouseError] = useState('');
    const [categoryError, setCategoryError] = useState('');

    // Crear conteo
    const [showCreate, setShowCreate] = useState(false);
    const [createScope, setCreateScope] = useState<'ALL' | 'CATEGORY'>('ALL');
    const [createCategory, setCreateCategory] = useState('');
    const [createNotes, setCreateNotes] = useState('');
    const [showNotes, setShowNotes] = useState(false);
    const [createWarehouseId, setCreateWarehouseId] = useState('');
    const [categories, setCategories] = useState<string[]>([]);
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [warehousesLoading, setWarehousesLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // Captura
    const [search, setSearch] = useState('');
    const [inputs, setInputs] = useState<Record<string, string>>({}); // productId → texto del input
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
    const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
    const saveQueue = useRef(new Map<string, number>());
    const activeSaves = useRef(new Set<string>());
    useEffect(() => () => { saveQueue.current.clear(); }, []);
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
        setLoadError('');
        try {
            const res = await fetch('/api/stock-counts', { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las tomas físicas.');
            setCounts(data);
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : 'No se pudieron cargar las tomas físicas.');
        } finally {
            setLoading(false);
        }
    }, [headers]);

    const fetchCategories = useCallback(async () => {
        setCategoryError('');
        try {
            const res = await fetch('/api/products/categories', { headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las categorías.');
            setCategories(data);
        } catch { setCategoryError('No se pudieron cargar las categorías. Reintentá antes de contar por categoría.'); }
    }, [headers]);

    const fetchWarehouses = useCallback(async () => {
        setWarehousesLoading(true);
        setWarehouseError('');
        try {
            const res = await fetch('/api/warehouses', { headers });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'No se pudieron cargar las bodegas.');
            }
            if (res.ok) {
                const payload = await res.json();
                if (latestWarehouseContext.current !== context.warehouseId) return;
                const contextChanged = appliedWarehouseContext.current !== context.warehouseId;
                appliedWarehouseContext.current = context.warehouseId;
                const available = (payload.data || []).filter((warehouse: WarehouseOption) => warehouse.isActive);
                setWarehouses(available);
                setCreateWarehouseId(current => {
                    if (!contextChanged && current && available.some((warehouse: WarehouseOption) => warehouse.id === current)) return current;
                    if (context.warehouseId) return available.find((warehouse: WarehouseOption) => warehouse.id === context.warehouseId)?.id || '';
                    return available.length === 1 ? available[0].id : '';
                });
            }
        } catch (e) {
            if (latestWarehouseContext.current !== context.warehouseId) return;
            setWarehouseError(e instanceof Error ? e.message : 'No se pudieron cargar las bodegas.');
        } finally {
            if (latestWarehouseContext.current === context.warehouseId) setWarehousesLoading(false);
        }
    }, [headers, context.warehouseId]);

    const openCreateForm = () => {
        setCreateWarehouseId(current => current || (context.warehouseId ? warehouses.find(warehouse => warehouse.id === context.warehouseId)?.id || '' : warehouses.length === 1 ? warehouses[0].id : ''));
        setShowCreate(true);
    };

    useEffect(() => {
        fetchCounts();
        fetchCategories();
        fetchWarehouses();
    }, [fetchCounts, fetchCategories, fetchWarehouses]);

    const openDetail = async (id: string) => {
        if (activeSaves.current.size > 0) return;
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/stock-counts/${id}`, { headers });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'No se pudo abrir la toma física.');
            }
            if (res.ok) {
                const data: CountDetail = await res.json();
                setDetail(data);
                // Pre-cargar inputs con lo ya contado
                const init: Record<string, string> = {};
                for (const it of data.items) if (it.counted !== null) init[it.productId] = String(it.counted);
                if (data.count.status === 'OPEN') {
                    try {
                        const draft = JSON.parse(sessionStorage.getItem(`nortex_count_draft:${id}`) || '{}');
                        for (const it of data.items) {
                            if (typeof draft[it.productId] === 'string' && sanitizeCountInput(draft[it.productId]) !== null) init[it.productId] = draft[it.productId];
                        }
                    } catch { /* El servidor conserva la captura confirmada. */ }
                }
                saveQueue.current.clear();
                setSaveErrors({});
                setInputs(init);
                setSearch('');
                setContextProductId(context.productId);
            }
        } catch (e) {
            showToast({ tone: 'error', title: 'No se pudo abrir la toma', message: e instanceof Error ? e.message : 'Revisá la conexión e intentá nuevamente.' });
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

    // Una sola petición por producto; cambios posteriores se confirman en orden.
    // La captura local nunca se sustituye con una respuesta de una petición vieja.
    const saveCount = useCallback(async (productId: string, counted: number) => {
        if (!detail) return;
        const countId = detail.count.id;
        const key = `${countId}:${productId}`;
        saveQueue.current.set(key, counted);
        if (activeSaves.current.has(key)) return;
        activeSaves.current.add(key);
        setSavingIds(prev => new Set(prev).add(productId));
        try {
            while (saveQueue.current.has(key)) {
                const nextCount = saveQueue.current.get(key)!;
                saveQueue.current.delete(key);
                const res = await fetch(`/api/stock-counts/${countId}/count`, {
                    method: 'PATCH', headers, body: JSON.stringify({ productId, counted: nextCount }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'No se confirmó la captura.');
                setDetail(prev => prev?.count.id === countId ? {
                    ...prev,
                    items: prev.items.map(it => it.productId === productId
                        ? { ...it, counted: nextCount, countedAt: data.countedAt || new Date().toISOString(), bookStockAtCapture: data.bookStockAtCapture ?? it.bookStockAtCapture }
                        : it),
                } : prev);
                setSaveErrors(prev => { const next = { ...prev }; delete next[productId]; return next; });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : 'No se pudo confirmar el guardado.';
            setSaveErrors(prev => ({ ...prev, [productId]: message }));
            showToast({ tone: 'error', title: 'No se guardó el conteo', message: `${message} La cantidad sigue escrita; reintentá para confirmarla.` });
        } finally {
            activeSaves.current.delete(key);
            setSavingIds(prev => { const n = new Set(prev); n.delete(productId); return n; });
        }
    }, [detail, headers, showToast]);

    const updateCountInput = useCallback((productId: string, value: string) => {
        const sanitized = sanitizeCountInput(value);
        if (sanitized === null) {
            showToast({
                tone: 'warning',
                title: 'Cantidad inválida',
                message: 'Usá cero o una cantidad positiva con hasta cuatro decimales. La cantidad anterior se conservó.',
            });
            return;
        }
        setInputs(prev => ({ ...prev, [productId]: sanitized }));
    }, [showToast]);

    const commitCountInput = useCallback((item: CountItem, rawValue: string) => {
        if (rawValue === '') {
            if (item.counted !== null) setInputs(prev => ({ ...prev, [item.productId]: String(item.counted) }));
            return;
        }
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
        if (counted !== item.counted || activeSaves.current.has(`${detail?.count.id}:${item.productId}`) || saveErrors[item.productId]) void saveCount(item.productId, counted);
    }, [detail?.count.id, saveCount, saveErrors, showToast]);

    const pendingItems = detail?.items.filter(item => {
        const raw = inputs[item.productId];
        return Boolean(saveErrors[item.productId]) || (raw !== undefined && raw !== '' && parseCountInput(raw) !== item.counted);
    }) ?? [];
    const hasUnconfirmedCounts = savingIds.size > 0 || pendingItems.length > 0;

    useEffect(() => {
        if (!detail || detail.count.status !== 'OPEN') return;
        const draft = Object.fromEntries(detail.items.flatMap(item => {
            const raw = inputs[item.productId];
            return raw !== undefined && raw !== '' && (parseCountInput(raw) !== item.counted || saveErrors[item.productId]) ? [[item.productId, raw]] : [];
        }));
        try {
            if (Object.keys(draft).length) sessionStorage.setItem(`nortex_count_draft:${detail.count.id}`, JSON.stringify(draft));
            else sessionStorage.removeItem(`nortex_count_draft:${detail.count.id}`);
        } catch { /* Storage no disponible: se conserva en pantalla. */ }
    }, [detail, inputs, saveErrors]);

    useEffect(() => {
        if (!hasUnconfirmedCounts) return;
        const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [hasUnconfirmedCounts]);

    const closeCount = async () => {
        if (!detail || hasUnconfirmedCounts || activeSaves.current.size > 0) return;
        setClosing(true);
        try {
            const res = await fetch(`/api/stock-counts/${detail.count.id}/close`, { method: 'POST', headers });
            const data = await res.json();
            if (res.ok) {
                try { sessionStorage.removeItem(`nortex_count_draft:${detail.count.id}`); } catch { /* Sin almacenamiento local. */ }
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
                try { sessionStorage.removeItem(`nortex_count_draft:${detail.count.id}`); } catch { /* Sin almacenamiento local. */ }
                setShowCancelConfirm(false);
                showToast({ tone: 'success', title: 'Toma física cancelada', message: 'No se aplicó ningún ajuste y el historial quedó disponible para consulta.' });
                setDetail(null);
                fetchCounts();
            } else {
                const d = await res.json();
                showToast({ tone: 'error', title: 'No se pudo cancelar la toma', message: d.error || 'Intentá de nuevo.' });
            }
        } catch {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No pudimos confirmar la cancelación. Revisá el estado de la toma antes de reintentar.' });
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
        scanBuffer.current = '';
        if (!detail || detail.count.status !== 'OPEN' || !detail.count.warehouseId || confirmationOpen || closing || cancelling) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.querySelector('[data-camera-scanner]')) { scanBuffer.current = ''; return; }
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
            if (e.key === 'Enter') {
                const code = scanBuffer.current.trim();
                scanBuffer.current = '';
                if (code.length < 3) return;
                const item = detail.items.find(it => it.product.sku.toLowerCase() === code.toLowerCase());
                if (item) {
                    const rules = resolveProductQuantityRules(item.product);
                    if (rules.saleMode === 'MEASURED' || Number(rules.quantityStep) !== 1) {
                        setSearch(item.product.sku);
                        showToast({ tone: 'info', title: 'Ingresá la cantidad física', message: `${item.product.name} se cuenta en ${item.product.unit}, en pasos de ${rules.quantityStep}. Conservamos lo ya capturado.` });
                        return;
                    }
                    const inputCount = inputs[item.productId] !== undefined ? parseCountInput(inputs[item.productId]) : null;
                    const current = inputCount ?? item.counted ?? 0;
                    const next = current + 1;
                    setInputs(prev => ({ ...prev, [item.productId]: String(next) }));
                    saveCount(item.productId, next);
                } else showToast({ tone: 'warning', title: 'Código fuera de esta toma', message: 'Buscá el producto por nombre o verificá el código.' });
            } else if (e.key.length === 1) {
                scanBuffer.current += e.key;
                if (scanTimer.current) clearTimeout(scanTimer.current);
                scanTimer.current = setTimeout(() => { scanBuffer.current = ''; }, 100);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => { window.removeEventListener('keydown', handleKeyDown); if (scanTimer.current) clearTimeout(scanTimer.current); };
    }, [detail, inputs, saveCount, confirmationOpen, closing, cancelling, showToast]);

    // ==========================================
    // DERIVED
    // ==========================================
    const openWarehouseIds = useMemo(
        () => new Set(counts.filter((count) => ['OPEN', 'CLOSING'].includes(count.status) && count.warehouseId).map((count) => count.warehouseId as string)),
        [counts],
    );
    const selectedWarehouseHasOpenCount = createWarehouseId ? openWarehouseIds.has(createWarehouseId) : false;
    const createFormValid = Boolean(createWarehouseId)
        && !warehousesLoading && !warehouseError && (createScope !== 'CATEGORY' || !categoryError)
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
            const diff = val - Number(it.bookStockAtCapture ?? it.expected);
            diffUnits += diff;
            if (diff < 0) lossValue += Math.abs(diff) * (Number(it.product.cost) || 0);
            else if (diff > 0) gainValue += diff * (Number(it.product.cost) || 0);
        }
        return { total: detail.items.length, counted, lossValue, gainValue, diffUnits };
    }, [detail, inputs]);

    const filteredItems = useMemo(() => {
        if (!detail) return [];
        const q = search.trim().toLowerCase();
        const contextualItems = contextProductId ? detail.items.filter(item => item.productId === contextProductId) : detail.items;
        if (!q) return contextualItems;
        return contextualItems.filter(it => it.product.name.toLowerCase().includes(q) || (it.product.brand ?? '').toLowerCase().includes(q) || it.product.sku.toLowerCase().includes(q));
    }, [detail, search, contextProductId]);

    // ==========================================
    // RENDER — DETALLE / CAPTURA
    // ==========================================
    if (detail) {
        const isOpen = detail.count.status === 'OPEN';
        const canOperate = isOpen && Boolean(detail.count.warehouseId);
        return (
            <div className="stock-workspace nx-workspace">
                <ToastViewport toast={toast} onDismiss={dismissToast} />
                <header className="stock-count-capture-header">
                    <button disabled={savingIds.size > 0} onClick={() => { setDetail(null); fetchCounts(); }} className="stock-workspace-back nx-fluid-press"><ChevronLeft size={17}/> Todos los conteos</button>
                    <div className="stock-workspace-title"><h1>{detail.count.warehouse?.name || 'Conteo sin ubicación'}</h1>{isOpen && <button onClick={(event) => openCancelConfirmation(event.currentTarget)} className="stock-workspace-quiet nx-fluid-press">Cancelar conteo</button>}</div>
                    <p className="stock-count-capture-subtitle">{detail.count.scope === 'CATEGORY' ? detail.count.category : 'Todos los productos'} · {STATUS_META[detail.count.status]?.label} · {formatDate(detail.count.createdAt)}</p>
                    {detail.count.notes && <p className="stock-count-capture-subtitle">{detail.count.notes}</p>}
                    {!detail.count.warehouseId && <p role="alert" className="stock-workspace-notice">Este conteo histórico no tiene ubicación. Cancelalo y creá uno nuevo eligiendo la bodega.</p>}
                    <div className="stock-count-progress"><span>{detailStats.counted} de {detailStats.total} productos contados</span><progress aria-label="Progreso del conteo" value={detailStats.counted} max={detailStats.total || 1}/></div>
                </header>
                {contextProductId && <p role="status" className="stock-workspace-notice">{detail.items.some(item => item.productId === contextProductId) ? 'Mostrando el producto que elegiste. El conteo conserva su alcance completo.' : 'El producto del enlace no está incluido en este conteo.'} <button className="underline nx-fluid-press" onClick={() => { setContextProductId(''); setSearch(''); }}>Ver todos los productos de este conteo</button></p>}
                {hasUnconfirmedCounts && <div role="status" className="mb-4 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
                    {savingIds.size > 0 ? 'Guardando capturas. Esperá antes de cerrar.' : 'Hay cantidades sin confirmar. Se conservan en esta pestaña; revisalas y guardalas antes de cerrar.'}
                    {savingIds.size === 0 && <button type="button" className="ml-3 underline font-semibold" onClick={() => pendingItems.forEach(item => commitCountInput(item, inputs[item.productId] ?? ''))}>Reintentar guardados</button>}
                </div>}

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            aria-label="Buscar producto o SKU"
                            value={search}
                            onChange={(e) => { setContextProductId(''); setSearch(e.target.value); }}
                            placeholder="Buscar producto o SKU..."
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <CameraScanButton disabled={closing || cancelling} onCode={code => { const found = detail.items.find(item => item.product.sku.toUpperCase() === code.toUpperCase()); if (!found) throw new Error('El código no está en esta toma física. Revisá el producto y la bodega.'); setContextProductId(''); setSearch(found.product.sku); }} />
                    {canOperate && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                            <ScanLine size={15} className="text-blue-400" /> Escaneá unidades para sumar 1; medidos requieren cantidad
                        </div>
                    )}
                </div>

                {/* Items */}
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="sm:hidden divide-y divide-slate-700/50" aria-label="Productos de la toma física">
                        {filteredItems.map((it) => {
                            const raw = inputs[it.productId];
                            const val = raw !== undefined && raw !== '' ? parseCountInput(raw) : (it.counted ?? null);
                            const diff = val !== null ? val - Number(it.bookStockAtCapture ?? it.expected) : null;
                            const isSaving = savingIds.has(it.productId);
                            const isCounted = it.counted !== null;
                            const inputId = `stock-count-mobile-${it.id}`;
                            return (
                                <article key={it.id} className="p-4" aria-busy={isSaving}>
                                    <div className="flex items-start gap-2">
                                        {isCounted && <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />}
                                        <div className="min-w-0">
                                            <h2 className="text-sm font-semibold text-white break-words">{it.product.name}</h2>{it.product.brand && <p className="text-xs text-slate-300">{it.product.brand}</p>}
                                            <p className="text-xs text-slate-400 font-mono mt-1 break-all">SKU: {it.product.sku}</p>
                                        </div>
                                    </div>

                                    <dl className="grid grid-cols-2 gap-3 mt-4">
                                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 p-3">
                                            <dt className="text-xs text-slate-400">Esperado</dt>
                                            <dd className="text-base font-semibold text-slate-200 mt-1">{it.bookStockAtCapture ?? it.expected} {it.product.unit}</dd>
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
                                                    <><input
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
                                                    {isCounted && <button type="button" aria-label={`Guardar reconteo de ${it.product.name}`} disabled={isSaving || parseCountInput(raw ?? '') === null} onClick={() => void saveCount(it.productId, parseCountInput(raw ?? '')!)} className="mt-2 text-xs text-blue-300 underline disabled:opacity-50">Volví a contar: guardar cantidad</button>}</>
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
                                    const diff = val !== null ? val - Number(it.bookStockAtCapture ?? it.expected) : null;
                                    const isSaving = savingIds.has(it.productId);
                                    const isCounted = it.counted !== null;
                                    return (
                                        <tr key={it.id} className="hover:bg-slate-700/20 transition-colors">
                                            <td className="px-4 py-3 text-sm text-white font-medium flex items-center gap-2">
                                                {isCounted && <Check size={14} className="text-emerald-400 shrink-0" />}
                                                <span>{it.product.name}{it.product.brand && <span className="block text-xs text-slate-300">{it.product.brand}</span>}</span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-400 font-mono">{it.product.sku}</td>
                                            <td className="px-4 py-3 text-right text-sm text-slate-300">{it.bookStockAtCapture ?? it.expected} {it.product.unit}</td>
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
                                                {canOperate && isCounted && <button type="button" aria-label={`Guardar reconteo de ${it.product.name}`} disabled={isSaving || parseCountInput(raw ?? '') === null} onClick={() => void saveCount(it.productId, parseCountInput(raw ?? '')!)} className="mt-1 block ml-auto text-xs text-blue-300 underline disabled:opacity-50">Guardar reconteo</button>}
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
                {isOpen && canOperate && <footer className="stock-count-reviewbar"><span>{hasUnconfirmedCounts ? 'Esperando confirmar capturas' : 'Revisá las diferencias antes de terminar'}</span><button disabled={hasUnconfirmedCounts} onClick={event => openCloseConfirmation(event.currentTarget)} className="stock-count-primary nx-fluid-press">Revisar y terminar</button></footer>}
                {showCloseConfirm && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeConfirmationDialogs}>
                        <div
                            ref={confirmationDialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="stock-count-close-title"
                            aria-describedby="stock-count-close-description"
                            tabIndex={-1}
                            className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl border border-slate-700"
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
                                    <button onClick={closeCount} disabled={closing || hasUnconfirmedCounts} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
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
        <div className="stock-workspace nx-workspace">
            <ToastViewport toast={toast} onDismiss={dismissToast} />


            {(loadError || warehouseError || categoryError) && <div role="alert" className="mb-4 rounded-lg border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
                {[loadError, warehouseError, categoryError].filter(Boolean).join(' ')}
                <button type="button" className="ml-3 underline font-semibold" onClick={() => { void fetchCounts(); void fetchWarehouses(); void fetchCategories(); }}>Reintentar carga</button>
            </div>}

            <StockCountWorkspaceList counts={counts} loading={loading} error={Boolean(loadError)} selectedWarehouseId={createWarehouseId} onOpen={openDetail} onCreate={openCreateForm} returnHref={returnHref} />
            {context.warehouseId && !warehousesLoading && !warehouseError && !warehouses.some(warehouse => warehouse.id === context.warehouseId) && <p role="alert" className="stock-workspace-notice">La bodega del enlace no está disponible. Elegí una ubicación al crear un conteo.</p>}

            {detailLoading && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40">
                    <Loader2 className="animate-spin text-blue-400" size={32} />
                </div>
            )}

            {/* Crear */}
            <FluidSheet open={showCreate} onClose={() => { if (!creating) setShowCreate(false); }} labelledBy="stock-count-create-title" closeOnBackdrop={!creating} closeOnEscape={!creating} dragToDismiss={!creating} panelClassName="stock-count-create-sheet">
                    <fieldset disabled={creating} className="min-w-0 border-0 p-0 overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <h2 id="stock-count-create-title" className="text-lg font-bold text-white">Nuevo conteo</h2>
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
                                {warehouseError && <p role="alert" className="text-sm text-red-300 mt-2">{warehouseError} <button className="underline" onClick={() => void fetchWarehouses()}>Reintentar bodegas</button></p>}
                                {!warehousesLoading && !warehouseError && warehouses.length === 0 && (
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
                                    <button onClick={() => setCreateScope('ALL')} className={`nx-fluid-press px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'ALL' ? 'bg-brand border-brand text-brand-on' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Todo el inventario</button>
                                    <button onClick={() => setCreateScope('CATEGORY')} className={`nx-fluid-press px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${createScope === 'CATEGORY' ? 'bg-brand border-brand text-brand-on' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}>Por categoría</button>
                                </div>
                            </div>
                            {createScope === 'CATEGORY' && (
                                <div>
                                    {categoryError && <p role="alert" className="text-sm text-red-300 mb-2">{categoryError} <button className="underline" onClick={() => void fetchCategories()}>Reintentar categorías</button></p>}
                                    <label htmlFor="stock-count-category" className="block text-sm text-slate-300 mb-2 font-medium">Categoría</label>
                                    <select id="stock-count-category" value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                                        <option value="">Selecciona...</option>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            )}
                            <details onToggle={event => setShowNotes(event.currentTarget.open)}>
                                <summary className="cursor-pointer text-sm text-slate-400">Agregar nota</summary>
                                {showNotes && <><label htmlFor="stock-count-notes" className="block text-sm text-slate-300 mb-2 font-medium">Notas (opcional)</label>
                                <input id="stock-count-notes" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder="Ej: conteo mensual de cierre" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></>}
                            </details>
                            <div className="nx-count-guidance rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                <p className="text-xs">Se tomará una foto del stock de la bodega elegida. Evita ventas o movimientos mientras cuentas; si ocurren, vuelve a verificar los productos afectados antes de cerrar.</p>
                            </div>
                            <button onClick={createCount} disabled={creating || !createFormValid} className="nx-fluid-press w-full bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-brand-on px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                                {creating ? <><Loader2 size={15} className="animate-spin" /> Creando...</> : 'Crear y empezar a contar'}
                            </button>
                        </div>
                    </fieldset>
            </FluidSheet>
        </div>
    );
}
