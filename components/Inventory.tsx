import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import ImageUploader from './ImageUploader';
import { sanitizeDecimalInput } from '../utils/money';
import {
    Package, Plus, Search, Eye, Edit, Trash2, AlertTriangle,
    RotateCcw, TrendingDown, TrendingUp, Clock, User, FileWarning, Upload, Zap, Globe, CheckSquare, EyeOff,
    Shield, ChevronDown, X, ArrowDownCircle, ArrowUpCircle, Wrench, Layers, Download, ChevronLeft, ChevronRight,
    Tag, DollarSign, Printer
} from 'lucide-react';
import ProductImporter from './ProductImporter';
import QuickAddProduct from './QuickAddProduct';
import { maybeAutostartTour } from '../utils/tours';

// ==========================================
// TYPES
// ==========================================

interface Product {
    id: string;
    name: string;
    sku: string;
    description?: string;
    category?: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    unit: string;
    isPublished?: boolean;
    imageUrl?: string;
    creator?: { name: string };
    updatedAt?: string;
    requiresBatchTracking?: boolean;
    reorderPoint?: number;
    maxStock?: number;
    defaultSupplierId?: string | null;
    wholesalePrice?: number | null;
    wholesaleMinQty?: number | null;
    packUnit?: string | null;
    packSize?: number | null;
    packPrice?: number | null;
}

interface ProductBatch {
    id: string;
    batchNumber: string;
    expiryDate: string;
    stock: number;
}

interface KardexEntry {
    id: string;
    type: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    reason?: string;
    referenceId?: string;
    referenceType?: string;
    date: string;
    user: { name: string; email: string };
    product?: { name: string; sku: string };
    batch?: { batchNumber: string; expiryDate: string } | null;
}

type AdjustType = 'ADJUST_LOSS' | 'ADJUST_GAIN' | 'IN_PURCHASE' | 'RETURN';

// ==========================================
// HELPERS
// ==========================================

const MOVEMENT_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    'IN_PURCHASE': { label: 'Compra', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '' },
    'IN': { label: 'Entrada', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '' },
    'OUT_SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    'OUT': { label: 'Salida', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    'SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    'ADJUST_LOSS': { label: 'Pérdida', color: 'bg-orange-900/60 text-orange-300 border-orange-700', icon: '' },
    'ADJUST_GAIN': { label: 'Ganancia', color: 'bg-blue-900/60 text-blue-300 border-blue-700', icon: '' },
    'ADJUSTMENT': { label: 'Ajuste', color: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', icon: '' },
    'RETURN': { label: 'Devolución', color: 'bg-purple-900/60 text-purple-300 border-purple-700', icon: '↩' },
};

const getMovementMeta = (type: string) => {
    return MOVEMENT_LABELS[type] || { label: type, color: 'bg-slate-700 text-slate-300 border-slate-600', icon: '' };
};

const formatCurrency = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Como sanitizeDecimalInput pero admite un '-' inicial (para ajustes porcentuales). */
const sanitizeSignedDecimal = (raw: string): string => {
    const neg = raw.trim().startsWith('-');
    let cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
    return (neg ? '-' : '') + cleaned;
};

const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
});

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function Inventory() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [userRole, setUserRole] = useState('EMPLOYEE');

    // Paginación / filtros / orden (server-side)
    const PAGE_SIZE = 50;
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState(''); // '' | out | published | unpublished
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [categories, setCategories] = useState<string[]>([]);
    const [stats, setStats] = useState<{ totalProducts: number; inventoryValue: number; totalUnits: number; outOfStock: number; lowStockCount: number } | null>(null);
    const [exporting, setExporting] = useState(false);

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showQuickAddModal, setShowQuickAddModal] = useState(false);
    const [quickAddSKU, setQuickAddSKU] = useState('');
    const [showKardexModal, setShowKardexModal] = useState(false);
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
    const [showBatchesModal, setShowBatchesModal] = useState(false);
    const [showBulkEditModal, setShowBulkEditModal] = useState(false);

    // Kardex (A5: paginado + filtro por fecha)
    const [kardexData, setKardexData] = useState<KardexEntry[]>([]);
    const [kardexLoading, setKardexLoading] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [kardexPage, setKardexPage] = useState(1);
    const [kardexTotal, setKardexTotal] = useState(0);
    const [kardexFrom, setKardexFrom] = useState('');
    const [kardexTo, setKardexTo] = useState('');
    const KARDEX_PAGE_SIZE = 25;

    // Batches (A4: alta de lotes)
    const [batchesData, setBatchesData] = useState<ProductBatch[]>([]);
    const [batchesLoading, setBatchesLoading] = useState(false);
    const [showAddBatchForm, setShowAddBatchForm] = useState(false);
    const [batchForm, setBatchForm] = useState({ batchNumber: '', expiryDate: '', quantity: '' });
    const [batchSubmitting, setBatchSubmitting] = useState(false);

    // Bulk edit form (A2: edición masiva de categoría/precio)
    const [bulkEditForm, setBulkEditForm] = useState({
        category: '',
        priceMode: '' as '' | 'set' | 'pct',
        priceValue: ''
    });
    const [bulkEditSubmitting, setBulkEditSubmitting] = useState(false);

    // Adjust form
    const [adjustForm, setAdjustForm] = useState({
        type: 'ADJUST_LOSS' as AdjustType,
        quantity: '',
        reason: ''
    });
    const [adjustSubmitting, setAdjustSubmitting] = useState(false);

    // Edit form (solo datos cosméticos/comerciales — sin stock para no disparar Kardex)
    const [editForm, setEditForm] = useState({
        name: '', description: '', category: '', price: '', imageUrl: '', reorderPoint: '', maxStock: '', defaultSupplierId: '', wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: ''
    });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

    // Create form
    const [formData, setFormData] = useState({
        name: '', sku: '', description: '', category: '',
        price: '', cost: '', stock: '', minStock: '5', unit: 'unidad', isPublished: false, imageUrl: '', requiresBatchTracking: false, reorderPoint: '', maxStock: '',
        wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: ''
    });

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    // ==========================================
    // DATA FETCHING
    // ==========================================

    const fetchProducts = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: sortField, dir: sortDir });
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (categoryFilter) params.set('category', categoryFilter);
            if (statusFilter) params.set('status', statusFilter);
            const res = await fetch(`/api/products?${params.toString()}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setProducts(data.products || []);
                setTotal(data.total || 0);
            }
        } catch (e) {
            console.error('Error fetching products:', e);
        } finally {
            setLoading(false);
            setSelectedProductIds([]); // Reset selection on fetch
        }
    }, [page, debouncedSearch, categoryFilter, statusFilter, sortField, sortDir, headers]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/reports/inventory', { headers });
            if (res.ok) {
                const d = await res.json();
                setStats({
                    totalProducts: d.totalProducts || 0,
                    inventoryValue: d.inventoryValue || 0,
                    totalUnits: d.totalUnits || 0,
                    outOfStock: d.outOfStock || 0,
                    lowStockCount: Math.max(0, (d.lowStock?.length || 0) - (d.outOfStock || 0)),
                });
            }
        } catch (e) { console.error('Error fetching stats:', e); }
    }, [headers]);

    const fetchCategories = useCallback(async () => {
        try {
            const res = await fetch('/api/products/categories', { headers });
            if (res.ok) setCategories(await res.json());
        } catch (e) { console.error('Error fetching categories:', e); }
    }, [headers]);

    // Recarga todo (lista + KPIs) tras una mutación.
    const reload = useCallback(() => { fetchProducts(); fetchStats(); }, [fetchProducts, fetchStats]);

    // Exporta a Excel TODO lo que coincide con el filtro actual (no solo la página).
    const handleExport = async () => {
        setExporting(true);
        try {
            const params = new URLSearchParams({ sort: sortField, dir: sortDir });
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (categoryFilter) params.set('category', categoryFilter);
            if (statusFilter) params.set('status', statusFilter);
            const res = await fetch(`/api/products?${params.toString()}`, { headers });
            const data = res.ok ? await res.json() : [];
            const arr = Array.isArray(data) ? data : (data.products || []);
            const rows = arr.map((p: any) => ({
                SKU: p.sku, Producto: p.name, 'Categoría': p.category || '', Unidad: p.unit,
                Stock: Number(p.stock), 'Stock mínimo': Number(p.minStock),
                Costo: Number(p.cost), Precio: Number(p.price),
                'Valor (costo)': Number((Number(p.stock) * Number(p.cost)).toFixed(2)),
                Publicado: p.isPublished ? 'Sí' : 'No',
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
            XLSX.writeFile(wb, `Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (e) { alert('No se pudo exportar.'); }
        finally { setExporting(false); }
    };

    // C3: hoja de etiquetas imprimibles (precio + código) de los productos seleccionados.
    const handlePrintLabels = () => {
        const selected = products.filter(p => selectedProductIds.includes(p.id));
        if (selected.length === 0) return;
        const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
        const labels = selected.map(p => `
            <div class="label">
                <div class="name">${esc(p.name)}</div>
                <div class="price">${esc(formatCurrency(p.price))}</div>
                <div class="sku">${esc(p.sku)}</div>
            </div>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
            *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:10px;background:#fff;color:#111}
            .sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
            .label{border:1px dashed #aaa;border-radius:6px;padding:10px 8px;text-align:center;page-break-inside:avoid}
            .name{font-size:12px;font-weight:600;min-height:32px;line-height:1.2;overflow:hidden}
            .price{font-size:22px;font-weight:800;margin:6px 0}
            .sku{font-family:'Courier New',monospace;font-size:13px;letter-spacing:3px;background:#f1f1f1;border-radius:4px;padding:3px 4px;display:inline-block}
            .bar{font-size:10px;color:#666;margin-top:2px}
            @media print{.no-print{display:none}}
        </style></head><body>
            <button class="no-print" style="margin-bottom:10px;padding:8px 14px;font-weight:700;cursor:pointer" onclick="window.print()">Imprimir</button>
            <div class="sheet">${labels}</div>
            <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},350)}<\/script>
        </body></html>`;
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
        else { alert('Permite las ventanas emergentes para imprimir etiquetas.'); }
    };

    useEffect(() => {
        const userData = localStorage.getItem('nortex_user');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                setUserRole(user.role || 'EMPLOYEE');
            } catch (e) { /* ignore */ }
        }
        fetchStats();
        fetchCategories();
        // Proveedores para asignar el proveedor por defecto al editar (C2)
        fetch('/api/suppliers', { headers })
            .then(r => r.ok ? r.json() : [])
            .then((data) => setSuppliers(Array.isArray(data) ? data.map((s: any) => ({ id: s.id, name: s.name })) : []))
            .catch(() => { /* noop */ });
    }, [fetchStats, fetchCategories, headers]);

    // Debounce de la búsqueda (y vuelve a la página 1).
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Recarga la página al cambiar paginación/filtros/orden.
    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    // Tutorial guiado: si entran con ?tour=inv (desde Ayuda o el checklist).
    useEffect(() => { maybeAutostartTour(); }, []);

    // Alta rápida directa: si entran con ?quick=1 (botón "Agregar producto" del
    // home Mi Negocio), se abre el modal de 3 campos sin pasos intermedios.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('quick') === '1') {
            setQuickAddSKU('');
            setShowQuickAddModal(true);
        }
    }, []);

    // ==========================================
    // SCAN DETECTION
    // ==========================================

    const playScanSound = useCallback((found: boolean) => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (found) {
            oscillator.frequency.value = 1000;
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } else {
            oscillator.frequency.value = 600;
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        }
    }, []);

    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (showCreateModal || showImportModal || showQuickAddModal || showKardexModal || showAdjustModal || showEditModal) return;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const currentTime = Date.now();

            if (currentTime - lastKeyTime > 100) {
                buffer = '';
            }

            lastKeyTime = currentTime;

            if (e.key === 'Enter') {
                if (buffer.length >= 3) {
                    const scannedCode = buffer;
                    // Consulta al servidor (la lista está paginada; no basta el arreglo local).
                    (async () => {
                        try {
                            const res = await fetch(`/api/products?search=${encodeURIComponent(scannedCode)}`, { headers });
                            const data = res.ok ? await res.json() : [];
                            const arr = Array.isArray(data) ? data : (data.products || []);
                            const found = arr.find((p: any) => p.sku === scannedCode || p.sku === scannedCode.toUpperCase());
                            if (found) { playScanSound(true); setSearchTerm(found.sku); }
                            else { playScanSound(false); setQuickAddSKU(scannedCode); setShowQuickAddModal(true); }
                        } catch { playScanSound(false); }
                    })();
                }
                buffer = '';
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [headers, showCreateModal, showImportModal, showQuickAddModal, showKardexModal, showAdjustModal, showEditModal, playScanSound]);

    // ==========================================
    // INVENTORY TOTALS
    // ==========================================

    // KPIs sobre TODO el inventario (no solo la página visible): vienen del stats.
    const totals = useMemo(() => ({
        totalValue: stats?.inventoryValue ?? 0,
        totalItems: stats?.totalUnits ?? 0,
        lowStockCount: stats?.lowStockCount ?? 0,
        outOfStockCount: stats?.outOfStock ?? 0,
    }), [stats]);

    // ==========================================
    // KARDEX
    // ==========================================

    // Fetch paginado del Kardex (A5). from/to son días locales (YYYY-MM-DD); el
    // backend los interpreta en hora Nicaragua (UTC-6).
    const fetchKardex = async (productId: string, targetPage: number, from: string, to: string) => {
        setKardexLoading(true);
        try {
            const params = new URLSearchParams({ page: String(targetPage), pageSize: String(KARDEX_PAGE_SIZE) });
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            const res = await fetch(`/api/kardex/${productId}?${params.toString()}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setKardexData(data.entries || []);
                setKardexTotal(data.total || 0);
                setKardexPage(data.page || targetPage);
            }
        } catch (e) {
            console.error('Error fetching kardex:', e);
        } finally {
            setKardexLoading(false);
        }
    };

    const openKardex = (product: Product) => {
        setSelectedProduct(product);
        setKardexFrom('');
        setKardexTo('');
        setKardexPage(1);
        setShowKardexModal(true);
        fetchKardex(product.id, 1, '', '');
    };

    // ==========================================
    // BATCHES
    // ==========================================

    const openBatches = async (product: Product) => {
        setSelectedProduct(product);
        setShowBatchesModal(true);
        setShowAddBatchForm(false);
        setBatchForm({ batchNumber: '', expiryDate: '', quantity: '' });
        setBatchesLoading(true);

        try {
            const res = await fetch(`/api/inventory/batches/${product.id}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setBatchesData(data);
            }
        } catch (e) {
            console.error('Error fetching batches:', e);
        } finally {
            setBatchesLoading(false);
        }
    };

    // A4: alta de lote → suma stock + Kardex (backend). Refresca lotes y la lista.
    const handleAddBatch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct) return;

        const qty = parseInt(batchForm.quantity);
        if (!batchForm.batchNumber.trim() || !batchForm.expiryDate || isNaN(qty) || qty <= 0) {
            alert('Completa número de lote, fecha de vencimiento y una cantidad mayor que cero.');
            return;
        }

        setBatchSubmitting(true);
        try {
            const res = await fetch('/api/inventory/batches', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    productId: selectedProduct.id,
                    batchNumber: batchForm.batchNumber.trim(),
                    expiryDate: batchForm.expiryDate,
                    quantity: qty
                })
            });
            const data = await res.json();
            if (res.ok) {
                setBatchForm({ batchNumber: '', expiryDate: '', quantity: '' });
                setShowAddBatchForm(false);
                // Refrescar lotes del producto
                const r = await fetch(`/api/inventory/batches/${selectedProduct.id}`, { headers });
                if (r.ok) setBatchesData(await r.json());
                // El stock del producto cambió → actualizar encabezado del modal y la lista
                setSelectedProduct(prev => prev ? { ...prev, stock: data.newStock, requiresBatchTracking: true } : prev);
                reload();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error agregando lote');
        } finally {
            setBatchSubmitting(false);
        }
    };

    // B3: dar de baja un lote (merma) → resta stock + Kardex + asiento de merma.
    const handleWriteoffBatch = async (batchId: string, batchNumber: string) => {
        if (!selectedProduct) return;
        if (!confirm(`¿Dar de baja el lote ${batchNumber}? Se restará su stock y se registrará como merma (no se puede deshacer).`)) return;
        try {
            const res = await fetch(`/api/inventory/batches/${batchId}/writeoff`, { method: 'POST', headers, body: JSON.stringify({}) });
            const data = await res.json();
            if (res.ok) {
                const r = await fetch(`/api/inventory/batches/${selectedProduct.id}`, { headers });
                if (r.ok) setBatchesData(await r.json());
                setSelectedProduct(prev => prev ? { ...prev, stock: data.newStock } : prev);
                reload();
                alert(data.message);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error dando de baja el lote');
        }
    };

    // ==========================================
    // ADJUST
    // ==========================================

    const openAdjust = (product: Product) => {
        setSelectedProduct(product);
        setAdjustForm({ type: 'ADJUST_LOSS', quantity: '', reason: '' });
        setShowAdjustModal(true);
    };

    // ==========================================
    // EDIT PRODUCT (solo datos comerciales — sin stock)
    // ==========================================

    const openEditModal = (product: Product) => {
        setSelectedProduct(product);
        setEditForm({
            name: product.name,
            description: product.description || '',
            category: product.category || '',
            price: String(product.price),
            imageUrl: product.imageUrl || '',
            reorderPoint: product.reorderPoint ? String(product.reorderPoint) : '',
            maxStock: product.maxStock ? String(product.maxStock) : '',
            defaultSupplierId: product.defaultSupplierId || '',
            wholesalePrice: product.wholesalePrice ? String(product.wholesalePrice) : '',
            wholesaleMinQty: product.wholesaleMinQty ? String(product.wholesaleMinQty) : '',
            packUnit: product.packUnit || '',
            packSize: product.packSize ? String(product.packSize) : '',
            packPrice: product.packPrice ? String(product.packPrice) : ''
        });
        setShowEditModal(true);
    };

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct) return;
        setEditSubmitting(true);
        try {
            const res = await fetch(`/api/products/${selectedProduct.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    name: editForm.name,
                    description: editForm.description,
                    category: editForm.category,
                    price: parseFloat(editForm.price),
                    imageUrl: editForm.imageUrl,
                    reorderPoint: editForm.reorderPoint === '' ? 0 : parseFloat(editForm.reorderPoint),
                    maxStock: editForm.maxStock === '' ? 0 : parseFloat(editForm.maxStock),
                    defaultSupplierId: editForm.defaultSupplierId || null,
                    wholesalePrice: editForm.wholesalePrice, // '' limpia el mayoreo (backend → null)
                    wholesaleMinQty: editForm.wholesaleMinQty,
                    packUnit: editForm.packUnit,
                    packSize: editForm.packSize,
                    packPrice: editForm.packPrice
                    // ⚠️ stock, cost, minStock y unit EXCLUIDOS intencionalmente
                    //    para no disparar el Kardex ni el sistema antirobo
                })
            });
            if (res.ok) {
                setShowEditModal(false);
                reload();
            } else {
                const err = await res.json();
                alert(`Error: ${err.error}`);
            }
        } catch {
            alert('Error actualizando producto');
        } finally {
            setEditSubmitting(false);
        }
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct) return;

        const qty = parseInt(adjustForm.quantity);
        if (isNaN(qty) || qty === 0) {
            alert('La cantidad debe ser un numero distinto de cero.');
            return;
        }

        const adjustedQty = adjustForm.type === 'ADJUST_LOSS'
            ? -Math.abs(qty)
            : Math.abs(qty);

        setAdjustSubmitting(true);

        try {
            const res = await fetch('/api/inventory/adjust', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    productId: selectedProduct.id,
                    quantity: adjustedQty,
                    reason: adjustForm.reason.trim(),
                    type: adjustForm.type
                })
            });

            const data = await res.json();

            if (res.ok) {
                setShowAdjustModal(false);
                reload();
                alert(`Ajuste registrado: ${data.message}`);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error procesando ajuste');
        } finally {
            setAdjustSubmitting(false);
        }
    };

    // ==========================================
    // CREATE PRODUCT
    // ==========================================

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...formData,
                    price: parseFloat(formData.price),
                    cost: parseFloat(formData.cost),
                    stock: parseInt(formData.stock) || 0,
                    minStock: parseInt(formData.minStock) || 5,
                    requiresBatchTracking: formData.requiresBatchTracking
                })
            });

            if (res.ok) {
                setShowCreateModal(false);
                setFormData({ name: '', sku: '', description: '', category: '', price: '', cost: '', stock: '', minStock: '5', unit: 'unidad', isPublished: false, imageUrl: '', requiresBatchTracking: false, reorderPoint: '', maxStock: '', wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: '' });
                reload();
                alert('Producto creado exitosamente');
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error creando producto');
        }
    };

    // ==========================================
    // DELETE PRODUCT
    // ==========================================

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Eliminar producto "${name}"? Solo se puede eliminar si stock = 0`)) return;

        try {
            const res = await fetch(`/api/products/${id}`, {
                method: 'DELETE',
                headers
            });

            if (res.ok) {
                reload();
                alert('Producto eliminado');
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error eliminando producto');
        }
    };

    // ==========================================
    // TOGGLE PUBLISH PRODUCT
    // ==========================================

    const handleTogglePublish = async (id: string, currentStatus: boolean, name: string) => {
        try {
            const res = await fetch(`/api/products/${id}/publish`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ isPublished: !currentStatus })
            });

            if (res.ok) {
                reload();
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error actualizando estado del producto en el catálogo');
        }
    };

    // ==========================================
    // BULK PUBLISH
    // ==========================================

    const handleBulkPublish = async (publish: boolean) => {
        if (selectedProductIds.length === 0) return;

        try {
            const res = await fetch('/api/products/publish-bulk', {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    productIds: selectedProductIds,
                    isPublished: publish
                })
            });

            if (res.ok) {
                const data = await res.json();
                reload();
                setSelectedProductIds([]);
                // alert(`Catálogo actualizado: ${data.count} productos modificados`);
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error actualizando productos de forma masiva');
        }
    };

    // ==========================================
    // BULK EDIT (A2: categoría / precio) — no toca stock ni costo
    // ==========================================

    const openBulkEdit = () => {
        setBulkEditForm({ category: '', priceMode: '', priceValue: '' });
        setShowBulkEditModal(true);
    };

    const handleBulkEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedProductIds.length === 0) return;

        const category = bulkEditForm.category.trim();
        const hasCategory = category.length > 0;
        const hasPrice = bulkEditForm.priceMode !== '';

        if (!hasCategory && !hasPrice) {
            alert('Indica al menos un cambio: categoría o precio.');
            return;
        }

        const payload: any = { ids: selectedProductIds };
        if (hasCategory) payload.category = category;
        if (hasPrice) {
            const val = parseFloat(bulkEditForm.priceValue);
            if (isNaN(val)) {
                alert('Ingresa un valor de precio válido.');
                return;
            }
            if (bulkEditForm.priceMode === 'set' && val < 0) {
                alert('El precio no puede ser negativo.');
                return;
            }
            if (bulkEditForm.priceMode === 'pct' && val <= -100) {
                alert('El descuento porcentual no puede ser ≥ 100%.');
                return;
            }
            payload.priceMode = bulkEditForm.priceMode;
            payload.priceValue = val;
        }

        setBulkEditSubmitting(true);
        try {
            const res = await fetch('/api/products/bulk-edit', {
                method: 'PATCH',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                setShowBulkEditModal(false);
                setSelectedProductIds([]);
                reload();
                fetchCategories();
                alert(data.message || 'Productos actualizados.');
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error en la edición masiva');
        } finally {
            setBulkEditSubmitting(false);
        }
    };

    const toggleSelection = (productId: string) => {
        setSelectedProductIds(prev =>
            prev.includes(productId)
                ? prev.filter(id => id !== productId)
                : [...prev, productId]
        );
    };

    const toggleSelectAll = () => {
        if (selectedProductIds.length === filteredProducts.length) {
            setSelectedProductIds([]);
        } else {
            setSelectedProductIds(filteredProducts.map(p => p.id));
        }
    };

    // ==========================================
    // FILTERED PRODUCTS
    // ==========================================

    // El servidor ya filtra y pagina; la página actual es `products`.
    const filteredProducts = products;

    const isOwner = userRole === 'OWNER' || userRole === 'ADMIN';

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="h-full overflow-y-auto p-6 space-y-6">
            {/* HEADER */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
                        <Shield size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Inventario Blindado</h1>
                        <span className="ml-3 inline-flex gap-2">
                            <a href="/app/warehouses" className="px-3 py-1.5 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg text-xs font-bold hover:border-brand transition-colors">Bodegas</a>
                            <a href="/app/serials" className="px-3 py-1.5 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg text-xs font-bold hover:border-brand transition-colors">Series</a>
                        </span>
                        <p className="text-sm text-slate-400">Sistema Kardex con auditoría inmutable</p>
                    </div>
                </div>

                {isOwner && (
                    <div className="relative">
                        <button
                            data-tour="inv-new"
                            onClick={() => setShowDropdown(!showDropdown)}
                            className="btn-primary flex items-center gap-2"
                        >
                            <Plus size={20} />
                            Nuevo Producto
                            <ChevronDown size={16} className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showDropdown && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                                <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden z-20">
                                    <button
                                        onClick={() => { setShowCreateModal(true); setShowDropdown(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                    >
                                        <Plus size={18} className="text-blue-400" />
                                        <div>
                                            <p className="font-semibold">Crear Manual</p>
                                            <p className="text-xs text-slate-400">Producto individual</p>
                                        </div>
                                    </button>
                                    <div className="border-t border-slate-700" />
                                    <button
                                        onClick={() => { setShowQuickAddModal(true); setQuickAddSKU(''); setShowDropdown(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                    >
                                        <Zap size={18} className="text-orange-400" />
                                        <div>
                                            <p className="font-semibold">Modo Rápido </p>
                                            <p className="text-xs text-slate-400">Escáner / Teclado</p>
                                        </div>
                                    </button>
                                    <div className="border-t border-slate-700" />
                                    <button
                                        onClick={() => { setShowImportModal(true); setShowDropdown(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                    >
                                        <Upload size={18} className="text-emerald-400" />
                                        <div>
                                            <p className="font-semibold">Importar Masivo</p>
                                            <p className="text-xs text-slate-400">Carga desde Excel/CSV</p>
                                        </div>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* KPI CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <Package size={16} className="text-blue-400" />
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Productos</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{(stats?.totalProducts ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{totals.totalItems.toLocaleString()} unidades en bodega</p>
                </div>

                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <TrendingUp size={16} className="text-emerald-400" />
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Valor Inventario</span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totals.totalValue)}</p>
                    <p className="text-xs text-slate-500">Al costo de compra</p>
                </div>

                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle size={16} className="text-amber-400" />
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Stock Bajo</span>
                    </div>
                    <p className={`text-2xl font-bold ${totals.lowStockCount > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {totals.lowStockCount}
                    </p>
                    <p className="text-xs text-slate-500">Productos bajo mínimo</p>
                </div>

                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <FileWarning size={16} className="text-red-400" />
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Agotados</span>
                    </div>
                    <p className={`text-2xl font-bold ${totals.outOfStockCount > 0 ? 'text-red-400' : 'text-white'}`}>
                        {totals.outOfStockCount}
                    </p>
                    <p className="text-xs text-slate-500">Stock en cero</p>
                </div>
            </div>

            {/* SEARCH + FILTROS + ORDEN + EXPORTAR */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[200px] relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        data-tour="inv-search"
                        type="text"
                        placeholder="Buscar por nombre, SKU o categoría..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                </div>
                <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                    className="bg-slate-800 border border-slate-700 rounded-lg text-white text-sm px-3 py-2.5 focus:border-blue-500">
                    <option value="">Todas las categorías</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    className="bg-slate-800 border border-slate-700 rounded-lg text-white text-sm px-3 py-2.5 focus:border-blue-500">
                    <option value="">Todos</option>
                    <option value="out">Agotados</option>
                    <option value="published">Publicados</option>
                    <option value="unpublished">Ocultos</option>
                </select>
                <select value={`${sortField}:${sortDir}`} onChange={(e) => { const [f, d] = e.target.value.split(':'); setSortField(f); setSortDir(d as 'asc' | 'desc'); setPage(1); }}
                    className="bg-slate-800 border border-slate-700 rounded-lg text-white text-sm px-3 py-2.5 focus:border-blue-500">
                    <option value="name:asc">Nombre A-Z</option>
                    <option value="name:desc">Nombre Z-A</option>
                    <option value="stock:asc">Stock ↑ (bajos primero)</option>
                    <option value="stock:desc">Stock ↓</option>
                    <option value="price:desc">Precio ↓</option>
                    <option value="price:asc">Precio ↑</option>
                    <option value="cost:desc">Costo ↓</option>
                </select>
                <button onClick={handleExport} disabled={exporting}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 border border-slate-600 disabled:opacity-50 transition-colors">
                    <Download size={16} /> {exporting ? 'Exportando…' : 'Excel'}
                </button>
            </div>

            {/* BULK ACTIONS BAR */}
            {selectedProductIds.length > 0 && isOwner && (
                <div className="bg-blue-900/40 border border-blue-500/30 rounded-lg p-3 flex items-center justify-between mb-4 shadow-lg animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <CheckSquare size={18} className="text-blue-400" />
                        <span className="text-white font-medium">
                            {selectedProductIds.length} productos seleccionados
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={openBulkEdit}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                        >
                            <Edit size={16} />
                            Editar precio/categoría
                        </button>
                        <button
                            onClick={handlePrintLabels}
                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-600"
                        >
                            <Printer size={16} />
                            Etiquetas
                        </button>
                        <button
                            onClick={() => handleBulkPublish(true)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                        >
                            <Globe size={16} />
                            Publicar
                        </button>
                        <button
                            onClick={() => handleBulkPublish(false)}
                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-600"
                        >
                            <EyeOff size={16} />
                            Ocultar
                        </button>
                    </div>
                </div>
            )}

            {/* PRODUCTS TABLE */}
            <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="table-premium w-full">
                        <thead>
                            <tr className="bg-slate-900/80">
                                {isOwner && (
                                    <th className="text-center px-4 py-3">
                                        <input
                                            type="checkbox"
                                            checked={filteredProducts.length > 0 && selectedProductIds.length === filteredProducts.length}
                                            onChange={toggleSelectAll}
                                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-slate-900"
                                        />
                                    </th>
                                )}
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">SKU</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Producto</th>
                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Categoría</th>
                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Stock</th>
                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Precio</th>
                                {isOwner && (
                                    <>
                                        <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Costo</th>
                                        <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Valor Total</th>
                                    </>
                                )}
                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={isOwner ? 8 : 6} className="text-center py-12 text-slate-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                            <span>Cargando inventario...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={isOwner ? 8 : 6} className="text-center py-16 px-4">
                                        <div className="flex flex-col items-center justify-center max-w-md mx-auto">
                                            <div className="w-20 h-20 bg-blue-900/30 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(59,130,246,0.2)]">
                                                <Package size={40} className="text-blue-400" />
                                            </div>

                                            {searchTerm ? (
                                                <>
                                                    <h3 className="text-xl font-bold text-white mb-2">No se encontraron resultados</h3>
                                                    <p className="text-slate-400 text-center mb-6">
                                                        No hay ningún producto que coincida con "{searchTerm}". Intenta con otro nombre o SKU.
                                                    </p>
                                                    <button
                                                        onClick={() => setSearchTerm('')}
                                                        className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl transition-colors border border-slate-700"
                                                    >
                                                        Limpiar Búsqueda
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <h3 className="text-2xl font-bold text-white mb-3">Tu inventario está vacío</h3>
                                                    <p className="text-slate-400 text-center mb-8">
                                                        ¡Bienvenido a Nortex! Comienza a facturar agregando tu primer producto al sistema en menos de 10 segundos.
                                                    </p>

                                                    {isOwner && (
                                                        <div className="flex flex-col sm:flex-row gap-4 w-full">
                                                            <button
                                                                onClick={() => { setShowQuickAddModal(true); setQuickAddSKU(''); }}
                                                                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] hover:-translate-y-1"
                                                            >
                                                                <Zap size={20} />
                                                                Modo Rápido                                                             </button>
                                                            <button
                                                                onClick={() => setShowCreateModal(true)}
                                                                className="flex items-center justify-center gap-2 px-6 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all border border-slate-700 hover:border-slate-500"
                                                            >
                                                                <Plus size={20} />
                                                                Manual
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product) => {
                                    const isLow = product.stock <= product.minStock && product.stock > 0;
                                    const isOut = product.stock === 0;
                                    const rowBg = isOut
                                        ? 'bg-red-950/20'
                                        : isLow
                                            ? 'bg-amber-950/10'
                                            : 'hover:bg-slate-700/30';

                                    return (
                                        <tr key={product.id} className={`${rowBg} transition-colors`}>
                                            {isOwner && (
                                                <td className="px-4 py-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedProductIds.includes(product.id)}
                                                        onChange={() => toggleSelection(product.id)}
                                                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-slate-900"
                                                    />
                                                </td>
                                            )}
                                            <td className="px-4 py-3">
                                                <span className="font-mono text-sm text-slate-300 bg-slate-900/60 px-2 py-0.5 rounded">
                                                    {product.sku}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col">
                                                    <span className="text-white font-semibold">{product.name}</span>
                                                    {product.description && (
                                                        <span className="text-xs text-slate-500 truncate max-w-[200px]">{product.description}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {product.category ? (
                                                    <span className="text-xs bg-slate-700/60 text-slate-300 px-2 py-1 rounded-full">
                                                        {product.category}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-600">-</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <span className={`font-mono tabular-nums font-bold ${isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-white'}`}>
                                                        {product.stock}
                                                    </span>
                                                    <span className="text-xs text-slate-500">{product.unit}</span>
                                                </div>
                                                <div className="mt-1 flex justify-end">
                                                    {isOut ? (
                                                        <span className="badge-soft-danger"><AlertTriangle size={11} /> Agotado</span>
                                                    ) : isLow ? (
                                                        <span className="badge-soft-warning"><AlertTriangle size={11} /> Reorden · mín {product.minStock}</span>
                                                    ) : (
                                                        <span className="badge-soft-success">OK</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-emerald-400 font-semibold font-mono tabular-nums">
                                                {formatCurrency(product.price)}
                                            </td>
                                            {isOwner && (
                                                <>
                                                    <td className="px-4 py-3 text-right text-slate-400 font-mono tabular-nums">
                                                        {formatCurrency(product.cost)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-semibold text-cyan-400 font-mono tabular-nums">
                                                        {formatCurrency(product.stock * product.cost)}
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-center gap-1">
                                                    {isOwner && (
                                                        <>
                                                            <button
                                                                onClick={() => handleTogglePublish(product.id, product.isPublished || false, product.name)}
                                                                className={`p-2 rounded-lg transition-colors ${product.isPublished ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/40' : 'hover:bg-slate-700/60 text-slate-400 hover:text-white'}`}
                                                                title={product.isPublished ? "Ocultar del catálogo público" : "Publicar en catálogo público"}
                                                            >
                                                                <Globe size={17} />
                                                            </button>
                                                            <button
                                                                onClick={() => openKardex(product)}
                                                                className="btn-ghost p-2 rounded-lg"
                                                                title="Auditar Kardex"
                                                            >
                                                                <Eye size={17} />
                                                            </button>
                                                            <button
                                                                onClick={() => openEditModal(product)}
                                                                className="btn-ghost p-2 rounded-lg"
                                                                title="Editar Producto"
                                                            >
                                                                <Edit size={17} />
                                                            </button>
                                                            {product.requiresBatchTracking && (
                                                                <button
                                                                    onClick={() => openBatches(product)}
                                                                    className="p-2 hover:bg-orange-500/20 rounded-lg text-orange-400 transition-colors"
                                                                    title="Ver Lotes y Vencimientos"
                                                                >
                                                                    <Layers size={17} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => openAdjust(product)}
                                                                className="btn-ghost p-2 rounded-lg"
                                                                title="Ajuste de Stock (Kardex)"
                                                            >
                                                                <Wrench size={17} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(product.id, product.name)}
                                                                className="p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                                                                title="Eliminar"
                                                            >
                                                                <Trash2 size={17} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                {total > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 text-sm text-slate-400">
                        <span>{((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} de {total.toLocaleString()}</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 flex items-center gap-1 transition-colors"><ChevronLeft size={16} /> Anterior</button>
                            <span className="text-slate-300 font-mono">{page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
                            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / PAGE_SIZE)}
                                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 flex items-center gap-1 transition-colors">Siguiente <ChevronRight size={16} /></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ==========================================
                MODAL: KARDEX (HISTORIAL DE AUDITORÍA)
               ========================================== */}
            {showKardexModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowKardexModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        {/* Kardex Header */}
                        <div className="bg-gradient-to-r from-blue-900/50 to-cyan-900/30 px-6 py-4 flex items-center justify-between border-b border-slate-700">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Shield size={20} className="text-blue-400" />
                                    <h2 className="text-xl font-bold text-white">Kardex - {selectedProduct.name}</h2>
                                </div>
                                <p className="text-sm text-slate-400 mt-1">
                                    SKU: <span className="font-mono text-slate-300">{selectedProduct.sku}</span>
                                    {' '} | Stock Actual: <span className={`font-bold ${selectedProduct.stock <= selectedProduct.minStock ? 'text-red-400' : 'text-emerald-400'}`}>{selectedProduct.stock} {selectedProduct.unit}</span>
                                    {' '} | Valor: <span className="text-cyan-400 font-semibold">{formatCurrency(selectedProduct.stock * selectedProduct.cost)}</span>
                                </p>
                            </div>
                            <button onClick={() => setShowKardexModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Kardex: Filtro por fecha (A5) */}
                        <div className="px-6 py-3 border-b border-slate-700 bg-slate-900/40 flex flex-wrap items-end gap-3">
                            <div>
                                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Desde</label>
                                <input
                                    type="date"
                                    value={kardexFrom}
                                    onChange={(e) => setKardexFrom(e.target.value)}
                                    className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Hasta</label>
                                <input
                                    type="date"
                                    value={kardexTo}
                                    onChange={(e) => setKardexTo(e.target.value)}
                                    className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <button
                                onClick={() => fetchKardex(selectedProduct.id, 1, kardexFrom, kardexTo)}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                            >
                                <Search size={15} /> Filtrar
                            </button>
                            {(kardexFrom || kardexTo) && (
                                <button
                                    onClick={() => { setKardexFrom(''); setKardexTo(''); fetchKardex(selectedProduct.id, 1, '', ''); }}
                                    className="text-slate-400 hover:text-white px-3 py-1.5 rounded-lg text-sm border border-slate-600 hover:bg-slate-700 transition-colors"
                                >
                                    Limpiar
                                </button>
                            )}
                            <div className="ml-auto text-xs text-slate-400 self-center">
                                {kardexTotal} movimiento{kardexTotal === 1 ? '' : 's'}
                            </div>
                        </div>

                        {/* Kardex Table */}
                        <div className="overflow-y-auto max-h-[calc(90vh-250px)]">
                            {kardexLoading ? (
                                <div className="flex flex-col items-center justify-center py-16">
                                    <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
                                    <span className="text-slate-400">Cargando historial...</span>
                                </div>
                            ) : kardexData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                    <Clock size={40} className="opacity-30 mb-2" />
                                    <p>No hay movimientos registrados</p>
                                    <p className="text-xs text-slate-600 mt-1">El historial se llenará automáticamente con cada operación</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead className="bg-slate-900/80 sticky top-0">
                                        <tr>
                                            <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Fecha</th>
                                            <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Tipo</th>
                                            <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Usuario</th>
                                            <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Cantidad</th>
                                            <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Saldo Final</th>
                                            <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Justificación</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {kardexData.map((entry) => {
                                            const meta = getMovementMeta(entry.type);
                                            return (
                                                <tr key={entry.id} className="hover:bg-slate-700/20 transition-colors">
                                                    <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                                                        {formatDate(entry.date)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${meta.color}`}>
                                                            <span>{meta.icon}</span>
                                                            {meta.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center">
                                                                <User size={12} className="text-slate-400" />
                                                            </div>
                                                            <span className="text-sm text-slate-300">{entry.user.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className={`font-bold text-sm ${entry.quantity > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className="text-white font-bold text-sm bg-slate-700/60 px-2 py-0.5 rounded">
                                                            {entry.stockAfter}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-sm text-slate-400 max-w-[200px] truncate block">
                                                            {entry.reason || '-'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Kardex: Paginación (A5) */}
                        {kardexTotal > KARDEX_PAGE_SIZE && (
                            <div className="px-6 py-3 border-t border-slate-700 bg-slate-900/40 flex items-center justify-between">
                                <span className="text-xs text-slate-400">
                                    Página {kardexPage} de {Math.max(1, Math.ceil(kardexTotal / KARDEX_PAGE_SIZE))}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={kardexPage <= 1 || kardexLoading}
                                        onClick={() => fetchKardex(selectedProduct.id, kardexPage - 1, kardexFrom, kardexTo)}
                                        className="px-3 py-1.5 rounded-lg text-sm border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                                    >
                                        <ChevronLeft size={15} /> Anterior
                                    </button>
                                    <button
                                        disabled={kardexPage >= Math.ceil(kardexTotal / KARDEX_PAGE_SIZE) || kardexLoading}
                                        onClick={() => fetchKardex(selectedProduct.id, kardexPage + 1, kardexFrom, kardexTo)}
                                        className="px-3 py-1.5 rounded-lg text-sm border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                                    >
                                        Siguiente <ChevronRight size={15} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: AJUSTE MANUAL (SOLO OWNER)
               ========================================== */}
            {showAdjustModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowAdjustModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        {/* Adjust Header */}
                        <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/20 px-6 py-4 border-b border-slate-700">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <Shield size={20} className="text-amber-400" />
                                        Ajuste Manual de Inventario
                                    </h2>
                                    <p className="text-sm text-slate-400 mt-1">
                                        {selectedProduct.name} | Stock actual: <span className="font-bold text-white">{selectedProduct.stock}</span>
                                    </p>
                                </div>
                                <button onClick={() => setShowAdjustModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <form onSubmit={handleAdjust} className="p-6 space-y-5">
                            {/* Warn banner */}
                            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-300/80">
                                    Este movimiento queda registrado permanentemente en el Kardex con tu nombre, fecha y justificación. No se puede borrar ni editar.
                                </p>
                            </div>

                            {/* Type */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Tipo de Ajuste</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { value: 'ADJUST_LOSS', label: 'Pérdida / Merma', icon: TrendingDown, color: 'red' },
                                        { value: 'ADJUST_GAIN', label: 'Ganancia / Hallazgo', icon: TrendingUp, color: 'emerald' },
                                        { value: 'IN_PURCHASE', label: 'Compra / Entrada', icon: ArrowDownCircle, color: 'blue' },
                                        { value: 'RETURN', label: 'Devolución', icon: RotateCcw, color: 'purple' },
                                    ] as const).map(opt => {
                                        const Icon = opt.icon;
                                        const isSelected = adjustForm.type === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setAdjustForm({ ...adjustForm, type: opt.value as AdjustType })}
                                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${isSelected
                                                    ? `border-${opt.color}-500 bg-${opt.color}-950/40 text-${opt.color}-300`
                                                    : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600'
                                                    }`}
                                            >
                                                <Icon size={16} />
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Quantity */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Cantidad {adjustForm.type === 'ADJUST_LOSS' ? '(se restará del stock)' : '(se sumará al stock)'}
                                </label>
                                <input
                                    required
                                    type="text"
                                    inputMode="decimal"
                                    value={adjustForm.quantity}
                                    onChange={(e) => setAdjustForm({ ...adjustForm, quantity: sanitizeDecimalInput(e.target.value) })}
                                    placeholder="Ej: 5"
                                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg font-bold font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                />
                                {adjustForm.quantity && (
                                    <p className="text-xs mt-1.5 text-slate-400">
                                        Stock resultante:{' '}
                                        <span className="font-bold text-white">
                                            {adjustForm.type === 'ADJUST_LOSS'
                                                ? selectedProduct.stock - Math.abs(parseInt(adjustForm.quantity) || 0)
                                                : selectedProduct.stock + Math.abs(parseInt(adjustForm.quantity) || 0)
                                            }
                                        </span>
                                    </p>
                                )}
                            </div>

                            {/* Reason (MANDATORY) */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Justificación <span className="text-red-400">*</span>
                                </label>
                                <textarea
                                    required
                                    minLength={3}
                                    value={adjustForm.reason}
                                    onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                                    placeholder='Ej: "Producto dañado por lluvia", "Conteo físico encontró 3 extra", "Compra a Proveedor X Factura #123"'
                                    rows={3}
                                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="submit"
                                    disabled={adjustSubmitting}
                                    className={`flex-1 py-3 rounded-lg font-bold text-white transition-all ${adjustForm.type === 'ADJUST_LOSS'
                                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
                                        : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800'
                                        } disabled:opacity-50`}
                                >
                                    {adjustSubmitting ? 'Procesando...' : (
                                        adjustForm.type === 'ADJUST_LOSS'
                                            ? 'Registrar Pérdida'
                                            : 'Registrar Ajuste'
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAdjustModal(false)}
                                    className="px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: EDITAR PRODUCTO (solo datos comerciales)
               ========================================== */}
            {showEditModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowEditModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-gradient-to-r from-blue-900/40 to-cyan-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Edit size={20} className="text-blue-400" />
                                    Editar Producto
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5 font-mono">{selectedProduct.sku}</p>
                            </div>
                            <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleEdit} className="p-6 space-y-4">
                            {/* Nombre */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Nombre del Producto *</label>
                                <input
                                    required
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                                />
                            </div>

                            {/* Categoría */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Categoría</label>
                                <input
                                    value={editForm.category}
                                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                                />
                            </div>

                            {/* Descripción */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Descripción</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                    rows={2}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
                                />
                            </div>

                            {/* Precio */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Precio de Venta *</label>
                                <input
                                    required
                                    type="text"
                                    inputMode="decimal"
                                    value={editForm.price}
                                    onChange={(e) => setEditForm({ ...editForm, price: sanitizeDecimalInput(e.target.value) })}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                />
                            </div>

                            {/* Venta por mayor (distribuidora/miscelánea) */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Precio Mayoreo</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.wholesalePrice}
                                        onChange={(e) => setEditForm({ ...editForm, wholesalePrice: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Vacío = sin mayoreo"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Cant. mínima mayoreo</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.wholesaleMinQty}
                                        onChange={(e) => setEditForm({ ...editForm, wholesaleMinQty: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Ej: 12 (docena)"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                            </div>

                            {/* Empaque (caja/fardo): atajo de cantidad + precio por caja en el POS */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Empaque</label>
                                    <input
                                        type="text"
                                        value={editForm.packUnit}
                                        onChange={(e) => setEditForm({ ...editForm, packUnit: e.target.value })}
                                        placeholder="caja / fardo"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Unid. por empaque</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.packSize}
                                        onChange={(e) => setEditForm({ ...editForm, packSize: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Ej: 12"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Precio empaque</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.packPrice}
                                        onChange={(e) => setEditForm({ ...editForm, packPrice: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Vacío = solo atajo"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                            </div>

                            {/* Reposición (B2) */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Punto de Reorden</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.reorderPoint}
                                        onChange={(e) => setEditForm({ ...editForm, reorderPoint: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="0 = sin alerta"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Objetivo (máx)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editForm.maxStock}
                                        onChange={(e) => setEditForm({ ...editForm, maxStock: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="sugiere cuánto comprar"
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                                    />
                                </div>
                            </div>

                            {/* Proveedor por defecto (C2) */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Proveedor por defecto</label>
                                <select
                                    value={editForm.defaultSupplierId}
                                    onChange={(e) => setEditForm({ ...editForm, defaultSupplierId: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                                >
                                    <option value="">— Sin proveedor —</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                                <p className="text-[11px] text-slate-500 mt-1">Agrupa este producto al armar órdenes de compra en Compras Inteligentes.</p>
                            </div>

                            {/* Imagen */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Foto del Producto</label>
                                <ImageUploader
                                    value={editForm.imageUrl}
                                    onChange={(url) => setEditForm({ ...editForm, imageUrl: url })}
                                />
                            </div>

                            {/* Aviso de seguridad */}
                            <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 flex items-start gap-2">
                                <Shield size={14} className="text-blue-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-slate-400">
                                    Stock, costo y unidad <span className="text-blue-300 font-semibold">no se modifican aquí</span> — para eso existe el Ajuste de Kardex (<Wrench size={11} className="inline" />).
                                </p>
                            </div>

                            {/* Acciones */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="submit"
                                    disabled={editSubmitting}
                                    className="flex-1 bg-blue-600 py-3 rounded-lg hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white font-bold transition-colors"
                                >
                                    {editSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: NUEVO PRODUCTO
               ========================================== */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-blue-900/40 to-cyan-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Plus size={20} className="text-blue-400" />
                                Nuevo Producto
                            </h2>
                            <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Nombre del Producto *</label>
                                    <input
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">SKU / Código *</label>
                                    <input
                                        required
                                        value={formData.sku}
                                        onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Descripción</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Categoría</label>
                                    <input
                                        value={formData.category}
                                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Unidad</label>
                                    <select
                                        value={formData.unit}
                                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                                    >
                                        <option>unidad</option>
                                        <option>kg</option>
                                        <option>litro</option>
                                        <option>caja</option>
                                        <option>metro</option>
                                        <option>par</option>
                                        <option>rollo</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Precio de Venta *</label>
                                    <input
                                        required
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Costo de Compra *</label>
                                    <input
                                        required
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.cost}
                                        onChange={(e) => setFormData({ ...formData, cost: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Precio Mayoreo</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.wholesalePrice}
                                        onChange={(e) => setFormData({ ...formData, wholesalePrice: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Vacío = sin mayoreo"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Cant. mínima mayoreo</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.wholesaleMinQty}
                                        onChange={(e) => setFormData({ ...formData, wholesaleMinQty: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Ej: 12 (docena)"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Empaque</label>
                                    <input
                                        type="text"
                                        value={formData.packUnit}
                                        onChange={(e) => setFormData({ ...formData, packUnit: e.target.value })}
                                        placeholder="caja"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Unid./emp.</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.packSize}
                                        onChange={(e) => setFormData({ ...formData, packSize: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="12"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Precio empaque</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.packPrice}
                                        onChange={(e) => setFormData({ ...formData, packPrice: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="Vacío = solo atajo"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Inicial</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.stock}
                                        onChange={(e) => setFormData({ ...formData, stock: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Mínimo</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.minStock}
                                        onChange={(e) => setFormData({ ...formData, minStock: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Punto de Reorden</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.reorderPoint}
                                        onChange={(e) => setFormData({ ...formData, reorderPoint: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="0 = sin alerta"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Objetivo (máx)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.maxStock}
                                        onChange={(e) => setFormData({ ...formData, maxStock: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="para sugerir cuánto comprar"
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand"
                                    />
                                </div>
                                <div className="col-span-4 mt-2">
                                    <label className="block text-sm text-slate-300 mb-2 font-medium">Foto del Producto</label>
                                    <ImageUploader
                                        value={formData.imageUrl}
                                        onChange={(url) => setFormData({ ...formData, imageUrl: url })}
                                    />
                                </div>
                                <div className="col-span-4 mt-2">
                                    <label className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer hover:border-blue-500/50 transition-colors">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.isPublished}
                                                onChange={(e) => setFormData({ ...formData, isPublished: e.target.checked })}
                                                className="sr-only"
                                            />
                                            <div className={`w-10 h-5 bg-slate-700 rounded-full transition-colors ${formData.isPublished ? 'bg-blue-600' : ''}`}></div>
                                            <div className={`absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform ${formData.isPublished ? 'translate-x-5' : ''}`}></div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Publicar en Catálogo Online</span>
                                            <span className="text-xs text-slate-400">Si está activo, tus clientes podrán ver este producto</span>
                                        </div>
                                    </label>
                                </div>
                                <div className="col-span-4 mt-2">
                                    <label className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer hover:border-blue-500/50 transition-colors">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.requiresBatchTracking}
                                                onChange={(e) => setFormData({ ...formData, requiresBatchTracking: e.target.checked })}
                                                className="sr-only"
                                            />
                                            <div className={`w-10 h-5 bg-slate-700 rounded-full transition-colors ${formData.requiresBatchTracking ? 'bg-orange-600' : ''}`}></div>
                                            <div className={`absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform ${formData.requiresBatchTracking ? 'translate-x-5' : ''}`}></div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Requiere Control de Lote/Vencimiento</span>
                                            <span className="text-xs text-slate-400">Activar para farmacias. Exigirá lote y fecha al comprar.</span>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    className="flex-1 bg-blue-600 py-3 rounded-lg hover:bg-blue-700 text-white font-bold transition-colors"
                                >
                                    Crear Producto
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
            MODAL: IMPORTADOR MASIVO
           ========================================== */}
            {showImportModal && (
                <ProductImporter
                    onClose={() => setShowImportModal(false)}
                    onSuccess={() => {
                        reload();
                        setShowImportModal(false);
                    }}
                />
            )}
            {/* ==========================================
            MODAL: QUICK ADD SCANNER MODE
           ========================================== */}
            {showQuickAddModal && (
                <QuickAddProduct
                    initialSKU={quickAddSKU}
                    onClose={() => setShowQuickAddModal(false)}
                    onSuccess={() => {
                        reload();
                    }}
                />
            )}

            {/* ==========================================
                MODAL: BATCHES (LOTES)
               ========================================== */}
            {showBatchesModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowBatchesModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700 flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-orange-900/50 to-amber-900/30 px-6 py-4 flex items-center justify-between border-b border-slate-700">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Layers size={20} className="text-orange-400" />
                                    <h2 className="text-xl font-bold text-white">Lotes Activos - {selectedProduct.name}</h2>
                                </div>
                                <p className="text-sm text-slate-400 mt-1">
                                    SKU: <span className="font-mono text-slate-300">{selectedProduct.sku}</span>
                                    {' '} | Stock Total: <span className="font-bold text-white">{selectedProduct.stock}</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isOwner && (
                                    <button
                                        onClick={() => setShowAddBatchForm(v => !v)}
                                        className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                                    >
                                        <Plus size={16} /> Agregar lote
                                    </button>
                                )}
                                <button onClick={() => setShowBatchesModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        {/* A4: Formulario de alta de lote */}
                        {isOwner && showAddBatchForm && (
                            <form onSubmit={handleAddBatch} className="px-6 py-4 border-b border-slate-700 bg-slate-900/40 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Nº Lote</label>
                                    <input
                                        type="text"
                                        value={batchForm.batchNumber}
                                        onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
                                        placeholder="L-2026-001"
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Vencimiento</label>
                                    <input
                                        type="date"
                                        value={batchForm.expiryDate}
                                        onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Cantidad</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={batchForm.quantity}
                                        onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                                        placeholder="0"
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={batchSubmitting}
                                    className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                                >
                                    {batchSubmitting ? 'Guardando...' : (<><Plus size={16} /> Sumar al stock</>)}
                                </button>
                                <p className="sm:col-span-4 text-[11px] text-orange-300/70 flex items-center gap-1.5">
                                    <AlertTriangle size={13} /> Agregar un lote suma al stock del producto y queda registrado en el Kardex. Si el nº de lote ya existe, se acumula.
                                </p>
                            </form>
                        )}

                        <div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-900/80 sticky top-0 z-10 shadow-md">
                                    <tr>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700">Nº Lote</th>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700">Vencimiento</th>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700 text-right">Stock</th>
                                        {isOwner && <th className="px-6 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700 text-right">Acción</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {batchesLoading ? (
                                        <tr>
                                            <td colSpan={isOwner ? 4 : 3} className="px-6 py-12 text-center text-slate-400">
                                                <div className="flex justify-center mb-2">
                                                    <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                                                </div>
                                                Cargando lotes...
                                            </td>
                                        </tr>
                                    ) : batchesData.length === 0 ? (
                                        <tr>
                                            <td colSpan={isOwner ? 4 : 3} className="px-6 py-8 text-center text-slate-400">
                                                No hay lotes con stock positivo para este producto.
                                            </td>
                                        </tr>
                                    ) : (
                                        batchesData.map((batch) => {
                                            const isExpired = new Date(batch.expiryDate) < new Date();
                                            const isExpiringSoon = new Date(batch.expiryDate) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

                                            return (
                                                <tr key={batch.id} className="hover:bg-slate-700/20 transition-colors">
                                                    <td className="px-6 py-4 text-sm font-medium text-white font-mono">
                                                        {batch.batchNumber}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${isExpired ? 'bg-red-900/40 text-red-400' : isExpiringSoon ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                                                            {isExpired ? '' : ''}{new Date(batch.expiryDate).toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-right font-bold text-white">
                                                        {batch.stock}
                                                    </td>
                                                    {isOwner && (
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => handleWriteoffBatch(batch.id, batch.batchNumber)}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isExpired ? 'bg-red-600/20 border-red-600/50 text-red-300 hover:bg-red-600/40' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                                                                title="Dar de baja este lote (merma)"
                                                            >
                                                                Dar de baja
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: EDICIÓN MASIVA (A2 — categoría / precio)
               ========================================== */}
            {showBulkEditModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowBulkEditModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-blue-900/50 to-cyan-900/30 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Edit size={20} className="text-blue-400" />
                                    Edición masiva
                                </h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {selectedProductIds.length} producto{selectedProductIds.length === 1 ? '' : 's'} seleccionado{selectedProductIds.length === 1 ? '' : 's'}
                                </p>
                            </div>
                            <button onClick={() => setShowBulkEditModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleBulkEdit} className="p-6 space-y-5">
                            <div className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 flex items-start gap-2">
                                <Shield size={16} className="text-blue-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-slate-400">
                                    Solo se cambia lo que llenes. El <strong className="text-slate-300">stock</strong> y el <strong className="text-slate-300">costo</strong> no se tocan (el costo lo calcula el sistema por promedio ponderado).
                                </p>
                            </div>

                            {/* Categoría */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium flex items-center gap-1.5">
                                    <Tag size={15} className="text-slate-400" /> Categoría
                                </label>
                                <input
                                    type="text"
                                    list="bulk-category-list"
                                    value={bulkEditForm.category}
                                    onChange={(e) => setBulkEditForm({ ...bulkEditForm, category: e.target.value })}
                                    placeholder="Dejar vacío para no cambiar"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                                <datalist id="bulk-category-list">
                                    {categories.map((c) => <option key={c} value={c} />)}
                                </datalist>
                            </div>

                            {/* Precio */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-2 font-medium flex items-center gap-1.5">
                                    <DollarSign size={15} className="text-slate-400" /> Precio
                                </label>
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                    <button
                                        type="button"
                                        onClick={() => setBulkEditForm({ ...bulkEditForm, priceMode: '', priceValue: '' })}
                                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${bulkEditForm.priceMode === '' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                                    >
                                        Sin cambio
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBulkEditForm({ ...bulkEditForm, priceMode: 'set', priceValue: '' })}
                                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${bulkEditForm.priceMode === 'set' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                                    >
                                        Fijar C$
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBulkEditForm({ ...bulkEditForm, priceMode: 'pct', priceValue: '' })}
                                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${bulkEditForm.priceMode === 'pct' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                                    >
                                        Ajustar %
                                    </button>
                                </div>
                                {bulkEditForm.priceMode !== '' && (
                                    <div className="relative">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={bulkEditForm.priceValue}
                                            onChange={(e) => setBulkEditForm({ ...bulkEditForm, priceValue: bulkEditForm.priceMode === 'pct' ? sanitizeSignedDecimal(e.target.value) : sanitizeDecimalInput(e.target.value) })}
                                            placeholder={bulkEditForm.priceMode === 'set' ? 'Nuevo precio en C$' : 'Ej: 10 (sube 10%) o -5 (baja 5%)'}
                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                                            {bulkEditForm.priceMode === 'set' ? 'C$' : '%'}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowBulkEditModal(false)}
                                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={bulkEditSubmitting}
                                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                                >
                                    {bulkEditSubmitting ? 'Aplicando...' : `Aplicar a ${selectedProductIds.length}`}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
