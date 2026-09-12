import { EmptyState, type EmptyStateProps } from './ui/EmptyState';
import { useInventoryBarcode } from '../hooks/useInventoryBarcode';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
// xlsx (~430 KB) se importa dinámicamente en handleExport — fuera del bundle inicial.
import ImageUploader from './ImageUploader';
import { resolveProductQuantityRules } from '../utils/productQuantityRules';
import { sanitizeDecimalInput, formatMoney } from '../utils/money';
import { formatQuantityValue, validateQuantity } from '../utils/quantity';
import { resolveLegacySaleMode } from '../utils/legacySaleMode';
import { trackEvent } from '../utils/analytics';
import { batchExpiryPresentation } from '../utils/batchExpiry';
import { productFamilyPreset, type ProductFamily } from '../utils/productFamilyPresets';
import { buildCreateProductPayload, normalizeProductQuantityInput, productValidationMessage } from '../utils/productForm';
import { clearInventoryAdjustmentAttempt, inventoryAdjustmentScope, isConfirmedInventoryAdjustment, isRejectedInventoryAdjustment, readInventoryAdjustmentAttempt, saveInventoryAdjustmentAttempt, type InventoryAdjustmentAttempt, type InventoryAdjustmentScope } from '../utils/inventoryAdjustmentAttempt';
import {
    Package, Plus, Search, Eye, Edit, Trash2, AlertTriangle,
    RotateCcw, TrendingDown, TrendingUp, Clock, User, FileWarning, Upload, Zap, Globe, CheckSquare, EyeOff,
    Shield, ChevronDown, X, ArrowDownCircle, ArrowUpCircle, Wrench, Layers, Download, ChevronLeft, ChevronRight,
    Tag, DollarSign, Printer
} from 'lucide-react';
import { InventoryCatalog, type InventoryCatalogFilters } from './inventory/InventoryCatalog';
import { StockProductPane, StockPaneEmpty } from './inventory/StockProductPane';
import { FluidSheet } from './ui/FluidSheet';
import './inventory/stockWorkspace.css';
import { IconButton } from './ui/IconButton';
import { ActionMenu } from './ui/ActionMenu';
import ProductImporter from './ProductImporter';
import QuickAddProduct from './QuickAddProduct';
import { maybeAutostartTour } from '../utils/tours';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';

// ==========================================
// TYPES
// ==========================================

interface Product {
    id: string;
    brand?: string | null;
    name: string;
    sku: string;
    description?: string;
    category?: string;
    price?: number;
    cost?: number;
    stock: number;
    minStock: number;
    unit: string;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: number | string | null;
    productFamily?: 'GENERAL' | 'MEAT' | 'POULTRY' | 'ANIMAL_FEED' | 'AGRO_INPUT' | 'VETERINARY' | null;
    isPublished?: boolean;
    imageUrl?: string;
    creator?: { name: string };
    updatedAt?: string;
    requiresBatchTracking?: boolean;
    ivaExento?: boolean;
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

interface WarehouseOption {
    id: string;
    name: string;
    isActive: boolean;
    isDefault: boolean;
}

interface WarehouseStockItem {
    productId: string;
    stock: number;
}

interface ManualBatchFormState {
    batchNumber: string;
    expiryDate: string;
    quantity: string;
    warehouseId: string;
    clientEventId: string;
    attempted: boolean;
}

interface BatchWriteoffFormState {
    batchId: string;
    batchNumber: string;
    quantity: string;
    reason: string;
    warehouseId: string;
    clientEventId: string;
    attempted: boolean;
}

/** Nunca adivina una ubicación cuando hay más de una bodega activa. */
export const soleActiveWarehouseId = (warehouses: WarehouseOption[]): string => {
    const active = warehouses.filter(warehouse => warehouse.isActive);
    return active.length === 1 ? active[0].id : '';
};

/** Un producto sin fila explícita en una bodega secundaria tiene stock local 0. */
export const localStockForProduct = (items: WarehouseStockItem[], productId: string): number =>
    Number(items.find(item => item.productId === productId)?.stock ?? 0);

/** UUID v4 estable durante un retry; solo rota cuando nace un comando nuevo. */
export const newManualBatchClientEventId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const newManualBatchForm = (warehouseId = ''): ManualBatchFormState => ({
    batchNumber: '',
    expiryDate: '',
    quantity: '',
    warehouseId,
    clientEventId: newManualBatchClientEventId(),
    attempted: false,
});

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
/** El bodeguero registra hallazgos físicos; compras y devoluciones tienen su flujo propio. */
export const adjustmentTypesForRole = (_isBodeguero: boolean): AdjustType[] => ['ADJUST_LOSS', 'ADJUST_GAIN'];

// ==========================================
// HELPERS
// ==========================================

const MOVEMENT_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    'IN_PURCHASE': { label: 'Compra', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '' },
    'IN': { label: 'Entrada', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '' },
    'OUT_SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    'OUT': { label: 'Salida', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    'SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '' },
    // El Kardex vive dentro de una isla ticket que no cambia de material entre
    // Día y Noche. Usar sus tokens explícitos evita que la traducción Día de
    // `orange-*` deje una tinta clara sobre un fondo claro.
    'ADJUST_LOSS': { label: 'Pérdida', color: 'bg-[var(--nx-ticket-raised)] text-[var(--nx-ticket-warning)] border-[color:var(--nx-ticket-warning)]', icon: '' },
    'ADJUST_GAIN': { label: 'Sobrante', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '' },
    'ADJUSTMENT': { label: 'Ajuste', color: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', icon: '' },
    'RETURN': { label: 'Devolución', color: 'bg-purple-900/60 text-purple-300 border-purple-700', icon: '↩' },
};

const getMovementMeta = (type: string) => {
    return MOVEMENT_LABELS[type] || { label: type, color: 'bg-slate-700 text-slate-300 border-slate-600', icon: '' };
};

// Delegado en el formateador único (utils/money.ts): este helper local era una
// de las cinco convenciones de moneda que convivían en la app.
const formatCurrency = (n: number) => formatMoney(n);

/**
 * Tarjeta de KPI del inventario. Sin `onClick` es un bloque estático (sin hover,
 * sin cursor) — la diferencia importa: una tarjeta que parece clicable y no hace
 * nada es peor que una que se ve inerte.
 */
const TarjetaKpi: React.FC<{
    icono: React.ReactNode;
    titulo: string;
    valor: string;
    nota: string;
    activa?: boolean;
    onClick?: () => void;
    /** Qué hace el filtro, para lectores de pantalla. */
    etiquetaAccion?: string;
}> = ({ icono, titulo, valor, nota, activa = false, onClick, etiquetaAccion }) => {
    const contenido = (
        <>
            <div className="flex items-center gap-2 mb-1">
                {icono}
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{titulo}</span>
            </div>
            <p className="whitespace-nowrap text-xl font-bold tabular-nums text-slate-950 sm:text-kpi">{valor}</p>
            <p className="hidden text-xs text-slate-500 sm:block">{nota}</p>
        </>
    );

    if (!onClick) {
        return <div className="nx-canvas-card p-3 text-left sm:p-4">{contenido}</div>;
    }

    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={activa}
            aria-label={etiquetaAccion ?? titulo}
            className={`nx-canvas-card nx-fluid-press cursor-pointer p-3 text-left transition-colors sm:p-4 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring ${
                activa ? 'border-brand bg-brand-soft' : 'hover:border-slate-300'
            }`}
        >
            {contenido}
        </button>
    );
};

/** Como sanitizeDecimalInput pero admite un '-' inicial (para ajustes porcentuales). */
const sanitizeSignedDecimal = (raw: string): string => {
    const neg = raw.trim().startsWith('-');
    let cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
    return (neg ? '-' : '') + cleaned;
};

/** Los ajustes de existencias son unidades enteras (contrato Zod `.int()`). */
const sanitizeWholeNumberInput = (raw: string): string => raw.replace(/\D/g, '');

const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
});

// ==========================================
// MAIN COMPONENT
// ==========================================

function InventoryWorkspace() {
    const userRole = currentSessionRole() || 'EMPLOYEE';
    const {
        isBodeguero,
        canManageProducts,
        canAdjustStock,
        canViewKardex,
        canViewInventoryValuation, canTransferStock, canManagePurchaseOrders, canReceivePurchaseOrders,
    } = roleCapabilitiesFor(userRole);
    // Conserva el nombre histórico usado en el render; ahora su definición
    // vive antes de hooks que dependen de ella y no mezcla ajustes con edición.
    const isOwner = canManageProducts;
    const { toast, showToast, dismissToast } = useToast();
    const [products, setProducts] = useState<Product[]>([]);
    // Distingue "inventario vacío" de "no pudimos cargarlo" (auditoría C8).
    const [productsError, setProductsError] = useState(false);
    // Catálogo de ejemplo por giro también acá: el checklist manda PRIMERO a
    // Inventario, pero el atajo solo existía en el POS (detrás del PIN de caja).
    const [seeding, setSeeding] = useState(false);
    const [seedError, setSeedError] = useState('');
    const [loading, setLoading] = useState(true);
    const [inventoryParams] = useSearchParams();
    const navigate = useNavigate();
    const [activeProduct, setActiveProduct] = useState<Product | null>(null);
    const [stockRevision, setStockRevision] = useState(0);
    const [receivingBusy, setReceivingBusy] = useState(false);
    const [receivingOpen, setReceivingOpen] = useState(false);
    const receivingOpenRef = useRef(false);
    const updateReceivingOpen = (open: boolean) => {
        receivingOpenRef.current = open;
        setReceivingOpen(open);
        if (!open && typeof matchMedia === 'function') setCompactPane(matchMedia('(max-width: 1100px)').matches);
    };
    const [showSummary, setShowSummary] = useState(false);
    const [bulkMode, setBulkMode] = useState(false);
    const [compactPane, setCompactPane] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 1100px)').matches);
    useEffect(() => {
        if (typeof matchMedia !== 'function') return;
        const media = matchMedia('(max-width: 1100px)');
        const update = () => { if (!receivingOpenRef.current) setCompactPane(media.matches); };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    useEffect(() => {
        if (!receivingBusy) return;
        const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        const preventLink = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.nx-stock-pane') && !target.closest('[aria-label="Cerrar sesión"]')) { event.preventDefault(); event.stopPropagation(); }
        };
        window.addEventListener('beforeunload', preventLeave);
        document.addEventListener('click', preventLink, true);
        return () => { window.removeEventListener('beforeunload', preventLeave); document.removeEventListener('click', preventLink, true); };
    }, [receivingBusy]);
    const alertSearch = inventoryParams.get('search') ?? '';
    const [searchTerm, setSearchTerm] = useState(alertSearch);
    useEffect(() => { setSearchTerm(alertSearch); }, [alertSearch]);
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Paginación / filtros / orden (server-side)
    const PAGE_SIZE = 50;
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [familyFilter, setFamilyFilter] = useState('');
    const [modeFilter, setModeFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState(''); // '' | out | published | unpublished
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [categories, setCategories] = useState<string[]>([]);
    const [statsError, setStatsError] = useState(false);
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
    const [batchForm, setBatchForm] = useState<ManualBatchFormState>(() => newManualBatchForm());
    const [batchSubmitting, setBatchSubmitting] = useState(false);
    const [batchWarehouses, setBatchWarehouses] = useState<WarehouseOption[]>([]);
    const [batchWarehousesLoading, setBatchWarehousesLoading] = useState(false);
    const [batchCommandError, setBatchCommandError] = useState('');
    const [writeoffForm, setWriteoffForm] = useState<BatchWriteoffFormState | null>(null);
    const [writeoffSubmitting, setWriteoffSubmitting] = useState(false);

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
    const [adjustWarehouses, setAdjustWarehouses] = useState<WarehouseOption[]>([]);
    const [adjustWarehouseId, setAdjustWarehouseId] = useState('');
    const [adjustWarehouseStock, setAdjustWarehouseStock] = useState<number | null>(null);
    const [adjustWarehousesLoading, setAdjustWarehousesLoading] = useState(false);
    const [adjustStockLoading, setAdjustStockLoading] = useState(false);
    const [adjustError, setAdjustError] = useState('');
    const [adjustRecovery, setAdjustRecovery] = useState<InventoryAdjustmentAttempt | null>(null);
    const [adjustRecoveryBlocked, setAdjustRecoveryBlocked] = useState(false);
    const adjustPending = useRef(false);
    const adjustWarehouseRequest = useRef(0);
    const adjustScopeAtOpen = useRef<InventoryAdjustmentScope | null>(null);
    const closeAdjust = () => { if (!adjustPending.current) setShowAdjustModal(false); };

    // Edit form (solo datos cosméticos/comerciales — sin stock para no disparar Kardex)
    const [editForm, setEditForm] = useState({
        name: '', brand: '', sku: '', minStock: '0', ivaExento: false, requiresBatchTracking: false, description: '', category: '', price: '', imageUrl: '', reorderPoint: '', maxStock: '', defaultSupplierId: '', wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: '',
        unit: 'unidad', saleMode: 'LEGACY' as 'LEGACY' | 'COUNTED' | 'MEASURED', quantityStep: '', productFamily: 'GENERAL'
    });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const editPending = useRef(false);
    const closeEdit = () => { if (!editPending.current) setShowEditModal(false); };
    const [editError, setEditError] = useState('');
    const [kardexError, setKardexError] = useState('');
    const [batchLoadError, setBatchLoadError] = useState('');
    const batchRequest = useRef(0);
    const kardexRequest = useRef(0);
    const productRequest = useRef(0);
    const statsRequest = useRef(0);
    const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
    useEffect(() => {
        if (!showEditModal) return;
        const onEscape = (event: KeyboardEvent) => { if (document.querySelector('[data-camera-scanner]')) return; if (event.key === 'Escape') closeEdit(); };
        window.addEventListener('keydown', onEscape);
        return () => window.removeEventListener('keydown', onEscape);
    }, [showEditModal]);

    // Create form
    const [formData, setFormData] = useState({
        name: '', brand: '', sku: '', description: '', category: '',
        price: '', cost: '', stock: '', minStock: '5', unit: 'unidad', isPublished: false, imageUrl: '', requiresBatchTracking: false, ivaExento: false, reorderPoint: '', maxStock: '',
        wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: '',
        saleMode: 'COUNTED' as 'COUNTED' | 'MEASURED', quantityStep: '1', productFamily: 'GENERAL' as ProductFamily
    });

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    useEffect(() => {
        if (!showAdjustModal || !adjustScopeAtOpen.current) return;
        try {
            const scope = inventoryAdjustmentScope(token);
            if (scope.tenantId === adjustScopeAtOpen.current.tenantId && scope.userId === adjustScopeAtOpen.current.userId) return;
        } catch { /* A closed or different session cannot display this recovery. */ }
        setShowAdjustModal(false);
        setAdjustRecovery(null);
        setAdjustError('');
    }, [token, showAdjustModal]);

    const adjustQuantityState = useMemo(() => {
        if (!adjustForm.quantity || !selectedProduct) return { value: null as number | null, error: '' };

        try {
            const { saleMode, quantityStep } = resolveProductQuantityRules(selectedProduct);
            return {
                value: validateQuantity(adjustForm.quantity, { saleMode, quantityStep }).toNumber(),
                error: '',
            };
        } catch (error) {
            return {
                value: null as number | null,
                error: error instanceof Error ? error.message : 'La cantidad no es válida.',
            };
        }
    }, [adjustForm.quantity, selectedProduct]);

    useEffect(() => {
        if (!showAdjustModal) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (document.querySelector('[data-camera-scanner]')) return;
            if (event.key === 'Escape') closeAdjust();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [showAdjustModal, adjustSubmitting]);

    // ==========================================
    // DATA FETCHING
    // ==========================================

    const fetchProducts = useCallback(async () => {
        const request = ++productRequest.current;
        try {
            setLoading(true);
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: sortField, dir: sortDir });
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (categoryFilter) params.set('category', categoryFilter);
            if (familyFilter) params.set('family', familyFilter);
            if (modeFilter) params.set('mode', modeFilter);
            if (statusFilter) params.set('status', statusFilter);
            const res = await fetch(`/api/products?${params.toString()}`, { headers });
            if (request !== productRequest.current) return;
            if (res.ok) {
                const data = await res.json();
                if (request !== productRequest.current) return;
                setProducts(data.products || []);
                setTotal(data.total || 0);
                setProductsError(false);
            } else {
                // Falso empty-state (auditoría C8): un 500 mostraba "inventario
                // vacío" a quien SÍ tiene productos. Distinguimos error de vacío.
                setProductsError(true);
            }
        } catch (e) {
            if (request === productRequest.current) setProductsError(true);
        } finally {
            if (request === productRequest.current) {
                setLoading(false);
                setSelectedProductIds([]);
            }
        }
    }, [page, debouncedSearch, categoryFilter, familyFilter, modeFilter, statusFilter, sortField, sortDir, headers]);

    const fetchStats = useCallback(async () => {
        const request = ++statsRequest.current;
        setStatsError(false);
        try {
            const res = await fetch('/api/reports/inventory', { headers });
            if (!res.ok) throw new Error('No se pudo cargar el resumen.');
            if (res.ok) {
                const d = await res.json();
                if (request !== statsRequest.current) return;
                setStats({
                    totalProducts: d.totalProducts || 0,
                    inventoryValue: d.inventoryValue || 0,
                    totalUnits: d.totalUnits || 0,
                    outOfStock: d.outOfStock || 0,
                    lowStockCount: Math.max(0, (d.lowStock?.length || 0) - (d.outOfStock || 0)),
                });
            }
        } catch {
            if (request === statsRequest.current) { setStats(null); setStatsError(true); }
        }
    }, [headers]);

    const fetchCategories = useCallback(async () => {
        try {
            const res = await fetch('/api/products/categories', { headers });
            if (res.ok) setCategories(await res.json());
        } catch (e) { console.error('Error fetching categories:', e); }
    }, [headers]);

    // Recarga todo (lista + KPIs) tras una mutación.
    const reload = useCallback(() => {
        setStockRevision(value => value + 1);
        fetchProducts();
        fetchCategories();
        if (canViewInventoryValuation) fetchStats();
    }, [canViewInventoryValuation, fetchProducts, fetchStats, fetchCategories]);

    // Catálogo de EJEMPLO por giro (retención R2): mismo endpoint que el POS.
    const seedCatalog = useCallback(async () => {
        setSeeding(true); setSeedError('');
        try {
            const res = await fetch('/api/onboarding/seed-catalog', { method: 'POST', headers });
            if (res.ok) {
                trackEvent('seed_catalog_used', { source: 'inventory' });
                window.dispatchEvent(new CustomEvent('nortex:data-changed'));
                reload();
            } else {
                const d = await res.json().catch(() => ({}));
                setSeedError(d.error || 'No se pudo cargar el catálogo de ejemplo.');
            }
        } catch {
            setSeedError('No se pudo cargar el catálogo. Revisá tu conexión.');
        } finally {
            setSeeding(false);
        }
    }, [headers, reload]);

    // Exporta a Excel TODO lo que coincide con el filtro actual (no solo la página).
    const handleExport = async () => {
        setExporting(true);
        try {
            const params = new URLSearchParams({ sort: sortField, dir: sortDir });
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (categoryFilter) params.set('category', categoryFilter);
            if (familyFilter) params.set('family', familyFilter);
            if (modeFilter) params.set('mode', modeFilter);
            if (statusFilter) params.set('status', statusFilter);
            const res = await fetch(`/api/products?${params.toString()}`, { headers });
            if (!res.ok) throw new Error('No se pudo cargar el catálogo para exportar.');
            const data = await res.json();
            if (receivingOpenRef.current) return;
                            const arr = Array.isArray(data) ? data : (data.products || []);
            const rows = arr.map((p: any) => ({
                SKU: p.sku, Producto: p.name, Marca: p.brand || '', 'Categoría': p.category || '', Unidad: p.unit,
                'Modo de venta': p.saleMode || 'LEGACY',
                'Cantidad mínima por paso': p.quantityStep == null ? '' : String(p.quantityStep),
                'Familia operativa': p.productFamily || 'GENERAL',
                'Unidad de empaque': p.packUnit || '',
                'Tamaño de empaque': p.packSize == null ? '' : String(p.packSize),
                'Precio de empaque': p.packPrice == null ? '' : Number(p.packPrice),
                'Control por lote': p.requiresBatchTracking ? 'SÍ' : 'NO',
                'IVA exento': p.ivaExento ? 'SÍ' : 'NO',
                Stock: Number(p.stock), 'Stock mínimo': Number(p.minStock),
                Costo: Number(p.cost), Precio: Number(p.price),
                'Valor (costo)': Number((Number(p.stock) * Number(p.cost)).toFixed(2)),
                Publicado: p.isPublished ? 'Sí' : 'No',
            }));
            const XLSX = await import('xlsx');
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
                <div class="price">${esc(formatCurrency(Number(p.price ?? 0)))}</div>
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
        if (canViewInventoryValuation) fetchStats();
        fetchCategories();
        // Proveedores para asignar el proveedor por defecto al editar (C2)
        if (canManageProducts) {
            fetch('/api/suppliers', { headers })
                .then(r => r.ok ? r.json() : [])
                .then((data) => setSuppliers(Array.isArray(data) ? data.map((s: any) => ({ id: s.id, name: s.name })) : []))
                .catch(() => { /* noop */ });
        }
    }, [canManageProducts, canViewInventoryValuation, fetchStats, fetchCategories, headers]);

    // Debounce de la búsqueda (y vuelve a la página 1).
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Recarga la página al cambiar paginación/filtros/orden.
    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    // Tutorial guiado: si entran con ?tour=inv (desde Ayuda o el checklist).
    useEffect(() => { if (canManageProducts) maybeAutostartTour(); }, [canManageProducts]);

    // Alta rápida directa: si entran con ?quick=1 (botón "Agregar producto" del
    // home Mi Negocio), se abre el modal de 3 campos sin pasos intermedios.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (canManageProducts && params.get('quick') === '1') {
            setQuickAddSKU('');
            setShowQuickAddModal(true);
        }
    }, [canManageProducts]);

    const scanWithCamera = useInventoryBarcode<Product>(product => { if (!receivingOpenRef.current) { setSearchTerm(product.sku); setActiveProduct(product); } });

    // ==========================================
    // SCAN DETECTION
    // ==========================================

    const playScanSound = useCallback((found: boolean) => {
        try {
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
        oscillator.onended = () => { void audioContext.close().catch(() => {}); };
        } catch { /* El escáner conserva su resultado aunque no haya audio. */ }
    }, []);

    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (document.querySelector('[data-camera-scanner]')) return;
            if (receivingOpen || receivingBusy || (compactPane && activeProduct) || showSummary || showCreateModal || showImportModal || showQuickAddModal || showKardexModal || showAdjustModal || showEditModal || showBatchesModal || showBulkEditModal) return;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

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
                            if (!res.ok) {
                                showToast({ tone: 'error', title: 'No pudimos buscar el código', message: 'Reintentá la búsqueda. No se pudo comprobar si el producto existe.' });
                                return;
                            }
                            const data = await res.json();
                            if (receivingOpenRef.current) return;
                            const arr = Array.isArray(data) ? data : (data.products || []);
                            const found = arr.find((p: any) => p.sku === scannedCode || p.sku === scannedCode.toUpperCase());
                            if (found) { playScanSound(true); setSearchTerm(found.sku); setActiveProduct(found); }
                            else {
                                playScanSound(false);
                                if (canManageProducts) {
                                    setQuickAddSKU(scannedCode);
                                    setShowQuickAddModal(true);
                                }
                            }
                        } catch {
                            showToast({ tone: 'error', title: 'No pudimos buscar el código', message: 'Reintentá la búsqueda. No se pudo comprobar si el producto existe.' });
                            playScanSound(false);
                        }
                    })();
                }
                buffer = '';
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [receivingOpen, receivingBusy, compactPane, activeProduct, showSummary, canManageProducts, headers, showCreateModal, showImportModal, showQuickAddModal, showKardexModal, showAdjustModal, showEditModal, showBatchesModal, showBulkEditModal, playScanSound, showToast]);

    // ==========================================
    // INVENTORY TOTALS
    // ==========================================

    /** Alterna el filtro: volver a tocar la tarjeta activa lo quita. */
    const aplicarFiltroEstado = useCallback((valor: string) => {
        setShowSummary(false);
        setStatusFilter(prev => (prev === valor ? '' : valor));
        setPage(1);
    }, []);

    const limpiarFiltros = useCallback(() => {
        setShowSummary(false);
        setStatusFilter('');
        setCategoryFilter('');
        setFamilyFilter('');
        setModeFilter('');
        setSearchTerm('');
        setPage(1);
    }, []);

    const hayFiltro = Boolean(statusFilter || categoryFilter || familyFilter || modeFilter || searchTerm);

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
        const request = ++kardexRequest.current;
        setKardexLoading(true);
        setKardexError('');
        setKardexData([]);
        try {
            const params = new URLSearchParams({ page: String(targetPage), pageSize: String(KARDEX_PAGE_SIZE) });
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            const res = await fetch(`/api/kardex/${productId}?${params.toString()}`, { headers });
            if (!res.ok) throw new Error('No pudimos cargar los movimientos. Reintentá.');
            if (res.ok) {
                const data = await res.json();
                if (request !== kardexRequest.current) return;
                setKardexData(data.entries || []);
                setKardexTotal(data.total || 0);
                setKardexPage(data.page || targetPage);
            }
        } catch (e) {
            if (request === kardexRequest.current) setKardexError('No pudimos cargar los movimientos. Reintentá.');
        } finally {
            if (request === kardexRequest.current) setKardexLoading(false);
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
        const request = ++batchRequest.current;
        setBatchesData([]);
        setBatchWarehouses([]);
        setBatchLoadError('');
        setSelectedProduct(product);
        setShowBatchesModal(true);
        setShowAddBatchForm(false);
        setBatchForm(newManualBatchForm());
        setWriteoffForm(null);
        setBatchCommandError('');
        setBatchesLoading(true);
        setBatchWarehousesLoading(true);

        try {
            const [batchResponse, warehouseResponse] = await Promise.all([
                fetch(`/api/inventory/batches/${product.id}`, { headers }),
                fetch('/api/warehouses', { headers }),
            ]);
            if (request !== batchRequest.current) return;
            if (!batchResponse.ok) throw new Error('No pudimos cargar los lotes de este producto.');
            const batches = await batchResponse.json();
            if (request !== batchRequest.current) return;
            setBatchesData(batches);

            const warehouseData: any = await warehouseResponse.json().catch(() => ({}));
            if (request !== batchRequest.current) return;
            if (warehouseResponse.ok) {
                const available = (Array.isArray(warehouseData.data) ? warehouseData.data : [])
                    .filter((warehouse: WarehouseOption) => warehouse.isActive);
                const soleWarehouseId = soleActiveWarehouseId(available);
                setBatchWarehouses(available);
                setBatchForm(current => ({ ...current, warehouseId: soleWarehouseId }));
                if (available.length === 0) {
                    setBatchCommandError('No hay una bodega activa para registrar movimientos de lote.');
                }
            } else {
                setBatchWarehouses([]);
                setBatchCommandError(warehouseData.error || 'No se pudieron cargar las bodegas activas.');
            }
        } catch (e) {
            if (request !== batchRequest.current) return;
            setBatchesData([]);
            setBatchWarehouses([]);
            setBatchLoadError('No pudimos cargar los lotes de este producto. Revisá tu conexión y reintentá.');
        } finally {
            if (request === batchRequest.current) {
                setBatchesLoading(false);
                setBatchWarehousesLoading(false);
            }
        }
    };

    const refreshSelectedProductBatches = async () => {
        if (!selectedProduct) return;
        const request = batchRequest.current;
        const response = await fetch(`/api/inventory/batches/${selectedProduct.id}`, { headers });
        if (request !== batchRequest.current) return;
        if (!response.ok) { setBatchLoadError('El movimiento se registró, pero no pudimos actualizar la lista de lotes. Reintentá cargarla.'); return; }
        const batches = await response.json();
        if (request === batchRequest.current) { setBatchesData(batches); setBatchLoadError(''); }
    };

    const editBatchForm = (patch: Partial<Pick<ManualBatchFormState, 'batchNumber' | 'expiryDate' | 'quantity' | 'warehouseId'>>) => {
        setBatchForm(current => ({
            ...current,
            ...patch,
            ...(current.attempted
                ? { clientEventId: newManualBatchClientEventId(), attempted: false }
                : {}),
        }));
        setBatchCommandError('');
    };

    // A4: alta de lote → suma stock + Kardex (backend). Refresca lotes y la lista.
    const handleAddBatch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct) return;

        let quantityIsValid = false;
        try {
            const parsed = validateQuantity(batchForm.quantity, {
                saleMode: selectedProduct.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
                quantityStep: selectedProduct.quantityStep?.toString()
                    || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001'),
            });
            quantityIsValid = parsed.greaterThan(0);
        } catch {
            quantityIsValid = false;
        }
        if (!batchForm.batchNumber.trim() || !batchForm.expiryDate || !batchForm.warehouseId || !quantityIsValid) {
            setBatchCommandError('Completá lote, vencimiento, bodega y una cantidad válida mayor que cero.');
            return;
        }

        setBatchSubmitting(true);
        setBatchForm(current => ({ ...current, attempted: true }));
        setBatchCommandError('');
        try {
            const res = await fetch('/api/inventory/batches', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    clientEventId: batchForm.clientEventId,
                    productId: selectedProduct.id,
                    warehouseId: batchForm.warehouseId,
                    batchNumber: batchForm.batchNumber.trim(),
                    expiryDate: batchForm.expiryDate,
                    quantity: batchForm.quantity.trim(),
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setBatchForm(newManualBatchForm(batchForm.warehouseId));
                setShowAddBatchForm(false);
                await refreshSelectedProductBatches();
                // El stock del producto cambió → actualizar encabezado del modal y la lista
                setSelectedProduct(prev => prev ? { ...prev, stock: data.newStock, requiresBatchTracking: true } : prev);
                reload();
                showToast({
                    tone: 'success',
                    title: 'Lote registrado',
                    message: `${batchForm.batchNumber.trim()} quedó asociado a la bodega seleccionada.`,
                });
            } else {
                setBatchCommandError(data.error || 'No pudimos registrar el lote.');
            }
        } catch (e) {
            setBatchCommandError('No pudimos registrar el lote. Reintentá: el identificador se conserva.');
        } finally {
            setBatchSubmitting(false);
        }
    };

    const openWriteoffBatch = (batch: ProductBatch) => {
        setWriteoffForm({
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: '',
            reason: '',
            warehouseId: soleActiveWarehouseId(batchWarehouses),
            clientEventId: newManualBatchClientEventId(),
            attempted: false,
        });
        setShowAddBatchForm(false);
        setBatchCommandError('');
    };

    const editWriteoffForm = (patch: Partial<Pick<BatchWriteoffFormState, 'quantity' | 'reason' | 'warehouseId'>>) => {
        setWriteoffForm(current => current ? ({
            ...current,
            ...patch,
            ...(current.attempted
                ? { clientEventId: newManualBatchClientEventId(), attempted: false }
                : {}),
        }) : current);
        setBatchCommandError('');
    };

    // B3: baja parcial o total explícita por lote+bodega; nunca adivina ubicación.
    const handleWriteoffBatch = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedProduct) return;
        if (!writeoffForm) return;

        let quantityIsValid = false;
        try {
            const parsed = validateQuantity(writeoffForm.quantity, {
                saleMode: selectedProduct.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
                quantityStep: selectedProduct.quantityStep?.toString()
                    || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001'),
            });
            quantityIsValid = parsed.greaterThan(0);
        } catch {
            quantityIsValid = false;
        }
        if (!writeoffForm.warehouseId || !quantityIsValid || writeoffForm.reason.trim().length < 3) {
            setBatchCommandError('Elegí bodega, cantidad local y una justificación de al menos 3 caracteres.');
            return;
        }

        setWriteoffSubmitting(true);
        setWriteoffForm(current => current ? { ...current, attempted: true } : current);
        setBatchCommandError('');
        try {
            const res = await fetch(`/api/inventory/batches/${writeoffForm.batchId}/writeoff`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    clientEventId: writeoffForm.clientEventId,
                    warehouseId: writeoffForm.warehouseId,
                    quantity: writeoffForm.quantity.trim(),
                    reason: writeoffForm.reason.trim(),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                await refreshSelectedProductBatches();
                setSelectedProduct(prev => prev ? { ...prev, stock: data.newStock } : prev);
                setWriteoffForm(null);
                reload();
                showToast({ tone: 'success', title: 'Merma registrada', message: data.message });
            } else {
                setBatchCommandError(data.error || 'No pudimos registrar la baja del lote.');
            }
        } catch (e) {
            setBatchCommandError('No pudimos registrar la baja. Reintentá: el identificador se conserva.');
        } finally {
            setWriteoffSubmitting(false);
        }
    };

    // ==========================================
    // ADJUST
    // ==========================================

    const loadAdjustWarehouses = useCallback(async (recovery: InventoryAdjustmentAttempt | null = null) => {
        const request = ++adjustWarehouseRequest.current;
        setAdjustWarehousesLoading(true);
        setAdjustWarehouseId(recovery?.payload.warehouseId || '');
        setAdjustWarehouseStock(null);
        try {
            const response = await fetch('/api/warehouses', { headers });
            const data: any = await response.json().catch(() => ({}));
            if (request !== adjustWarehouseRequest.current) return;
            if (!response.ok) {
                setAdjustWarehouses([]);
                setAdjustError(current => current || data.error || 'No se pudieron cargar las bodegas activas.');
                return;
            }

            const available = (Array.isArray(data.data) ? data.data : [])
                .filter((warehouse: WarehouseOption) => warehouse.isActive);
            setAdjustWarehouses(available);
            setAdjustWarehouseId(recovery?.payload.warehouseId || soleActiveWarehouseId(available));
            if (available.length === 0) {
                setAdjustError(current => current || 'No hay una bodega activa. Pedile a un administrador que active una.');
            }
        } catch {
            if (request !== adjustWarehouseRequest.current) return;
            setAdjustWarehouses([]);
            setAdjustError(current => current || 'No pudimos cargar las bodegas. Revisá tu conexión e intentá de nuevo.');
        } finally {
            if (request === adjustWarehouseRequest.current) setAdjustWarehousesLoading(false);
        }
    }, [headers]);

    useEffect(() => {
        if (!showAdjustModal || !selectedProduct || !adjustWarehouseId || adjustRecovery || adjustRecoveryBlocked) {
            setAdjustWarehouseStock(null);
            setAdjustStockLoading(false);
            return;
        }

        let cancelled = false;
        setAdjustStockLoading(true);
        setAdjustWarehouseStock(null);
        void fetch(`/api/warehouses/${adjustWarehouseId}/stock`, { headers })
            .then(async response => {
                const data: any = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'No se pudo leer el stock de esta bodega.');
                if (cancelled) return;
                const items = Array.isArray(data.data?.items) ? data.data.items : [];
                setAdjustWarehouseStock(localStockForProduct(items, selectedProduct.id));
            })
            .catch(error => {
                if (!cancelled) setAdjustError(current => current || error?.message || 'No se pudo leer el stock local.');
            })
            .finally(() => {
                if (!cancelled) setAdjustStockLoading(false);
            });

        return () => { cancelled = true; };
    }, [adjustWarehouseId, headers, selectedProduct, showAdjustModal, adjustRecovery, adjustRecoveryBlocked]);

    const openAdjust = (product: Product) => {
        if (adjustPending.current) return;
        setSelectedProduct(product);
        setAdjustError('');
        setAdjustRecoveryBlocked(false);
        let recovery: InventoryAdjustmentAttempt | null = null;
        adjustScopeAtOpen.current = null;
        try {
            const scope = inventoryAdjustmentScope(localStorage.getItem('nortex_token'));
            adjustScopeAtOpen.current = scope;
            recovery = readInventoryAdjustmentAttempt(scope, product.id);
        } catch (error) {
            setAdjustRecoveryBlocked(true);
            setAdjustError(error instanceof Error ? error.message : 'No pudimos recuperar el ajuste pendiente.');
        }
        setAdjustRecovery(recovery);
        setAdjustForm(recovery
            ? { type: recovery.payload.type, quantity: String(Math.abs(recovery.payload.quantity)), reason: recovery.payload.reason }
            : { type: 'ADJUST_LOSS', quantity: '', reason: '' });
        setAdjustWarehouseStock(null);
        setShowAdjustModal(true);
        void loadAdjustWarehouses(recovery);
    };

    // ==========================================
    // EDIT PRODUCT (solo datos comerciales — sin stock)
    // ==========================================

    const openEditModal = (product: Product) => {
        if (editPending.current) return;
        setEditError('');
        setSelectedProduct(product);
        setEditForm({
            name: product.name,
            sku: product.sku,
            minStock: String(product.minStock ?? 0),
            ivaExento: Boolean(product.ivaExento),
            requiresBatchTracking: Boolean(product.requiresBatchTracking),
            brand: product.brand || '',
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
            packPrice: product.packPrice ? String(product.packPrice) : '',
            unit: product.unit || 'unidad',
            saleMode: product.saleMode ?? 'LEGACY',
            quantityStep: product.quantityStep?.toString() ?? '',
            productFamily: product.productFamily || 'GENERAL',
        });
        setShowEditModal(true);
    };

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct || editPending.current) return;
        editPending.current = true;
        setEditError('');
        setEditSubmitting(true);
        try {
            const res = await fetch(`/api/products/${selectedProduct.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    name: editForm.name,
                    sku: editForm.sku.trim(),
                    minStock: normalizeProductQuantityInput(editForm.minStock) ?? '0',
                    ivaExento: editForm.ivaExento,
                    requiresBatchTracking: editForm.requiresBatchTracking,
                    description: editForm.description,
                    brand: editForm.brand.trim() || null,
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
                    packPrice: editForm.packPrice,
                    unit: editForm.unit,
                    saleMode: editForm.saleMode === 'LEGACY' ? null : editForm.saleMode,
                    quantityStep: editForm.saleMode === 'LEGACY' ? null : editForm.quantityStep,
                    productFamily: editForm.productFamily,
                    // La ficha nunca reemplaza existencias ni el costo contable.
                })
            });
            if (res.ok) {
                if (selectedProduct.unit.trim().toLowerCase() !== editForm.unit.trim().toLowerCase()) {
                    trackEvent('product_base_unit_changed', {
                        from: selectedProduct.unit,
                        to: editForm.unit,
                    });
                }
                setShowEditModal(false);
                reload();
            } else {
                const err = await res.json().catch(() => ({}));
                setEditError(productValidationMessage(err, 'No pudimos actualizar el producto.'));
            }
        } catch {
            setEditError('No pudimos confirmar los cambios. Conservamos lo que escribiste para reintentar.');
        } finally {
            editPending.current = false;
            setEditSubmitting(false);
        }
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct || adjustPending.current || adjustRecoveryBlocked) return;
        setAdjustError('');
        let attempt: InventoryAdjustmentAttempt;
        let requestToken: string | null;
        try {
            requestToken = localStorage.getItem('nortex_token');
            const scope = inventoryAdjustmentScope(requestToken);
            const openedScope = adjustScopeAtOpen.current;
            if (!openedScope || scope.tenantId !== openedScope.tenantId || scope.userId !== openedScope.userId) {
                throw new Error('La sesión cambió. Cerrá y volvé a abrir el ajuste desde tu cuenta actual.');
            }
            const stored = readInventoryAdjustmentAttempt(scope, selectedProduct.id);
            if (stored && adjustRecovery && JSON.stringify(stored) !== JSON.stringify(adjustRecovery)) {
                setAdjustRecoveryBlocked(true);
                setAdjustError('La recuperación guardada cambió. Cerrá y volvé a abrir el formulario para revisar sus datos antes de enviarla.');
                return;
            }
            if (stored && !adjustRecovery) {
                setAdjustRecovery(stored);
                setAdjustWarehouseId(stored.payload.warehouseId);
                setAdjustForm({ type: stored.payload.type, quantity: String(Math.abs(stored.payload.quantity)), reason: stored.payload.reason });
                setAdjustError('Recuperamos un ajuste pendiente. Revisá sus datos antes de recuperar el resultado.');
                return;
            }
            // A replay asks for the already committed result, so current stock,
            // warehouse availability and changed product rules cannot prevent it.
            const recovery = stored || adjustRecovery;
            if (recovery) {
                if (recovery.scope.tenantId !== scope.tenantId || recovery.scope.userId !== scope.userId) throw new Error('La sesión cambió. Volvé a abrir el ajuste.');
                attempt = recovery;
            } else {
                if (!adjustmentTypesForRole(isBodeguero).includes(adjustForm.type)) {
                    setAdjustError('Usá Compras o Devoluciones para registrar ese movimiento.');
                    return;
                }
                if (!adjustWarehouseId) {
                    setAdjustError('Seleccioná la bodega donde ocurrió este movimiento.');
                    return;
                }
                if (adjustWarehouseStock === null) {
                    setAdjustError('Esperá a que cargue el stock de la bodega seleccionada.');
                    return;
                }
                if (!adjustmentFormReady || adjustQuantityState.value === null) {
                    setAdjustError('Revisá la bodega, el tipo, la cantidad y la justificación antes de registrar.');
                    return;
                }
                if (adjustForm.reason.trim().length > 300) {
                    setAdjustError('La justificación puede tener hasta 300 caracteres.');
                    return;
                }
                const adjustedQty = adjustForm.type === 'ADJUST_LOSS' ? -adjustQuantityState.value : adjustQuantityState.value;
                if (adjustedQty < 0 && Math.abs(adjustedQty) > adjustWarehouseStock) {
                    setAdjustError(`Stock insuficiente en esta bodega. Disponible: ${adjustWarehouseStock}.`);
                    return;
                }
                attempt = {
                    version: 1, scope, createdAt: new Date().toISOString(),
                    warehouseName: selectedAdjustWarehouse?.name || adjustWarehouseId,
                    payload: {
                        productId: selectedProduct.id,
                        warehouseId: adjustWarehouseId,
                        quantity: adjustedQty,
                        reason: adjustForm.reason.trim(),
                        type: adjustForm.type as 'ADJUST_LOSS' | 'ADJUST_GAIN',
                        clientEventId: newManualBatchClientEventId(),
                    },
                };
            }
            // Persist and verify BEFORE dispatch. Never mint a replacement for
            // uncertain evidence, including malformed storage or an unproven 4xx.
            saveInventoryAdjustmentAttempt(attempt);
        } catch (error) {
            setAdjustError(error instanceof Error ? error.message : 'No se envió el ajuste: no pudimos guardar su evidencia.');
            return;
        }
        adjustPending.current = true;
        setAdjustRecovery(attempt);
        setAdjustSubmitting(true);
        try {
            const res = await fetch('/api/inventory/adjust', {
                method: 'POST',
                headers: { ...headers, Authorization: `Bearer ${requestToken}` },
                body: JSON.stringify(attempt.payload),
            });
            const data = await res.json().catch(() => ({}));
            const currentScope = inventoryAdjustmentScope(localStorage.getItem('nortex_token'));
            if (currentScope.tenantId !== attempt.scope.tenantId || currentScope.userId !== attempt.scope.userId) return;
            if (res.ok && isConfirmedInventoryAdjustment(data, attempt)) {
                try {
                    clearInventoryAdjustmentAttempt(attempt);
                } catch {
                    setAdjustError('El ajuste se confirmó, pero no pudimos limpiar la recuperación de esta pestaña. Recuperá el resultado de nuevo antes de registrar otro ajuste.');
                    reload();
                    return;
                }
                setAdjustRecovery(null);
                setShowAdjustModal(false);
                reload();
                showToast({
                    tone: 'success',
                    title: 'Ajuste registrado',
                    message: `Existencia actualizada en ${attempt.warehouseName}.`,
                });
            } else if (!res.ok && isRejectedInventoryAdjustment(data, attempt)) {
                try {
                    clearInventoryAdjustmentAttempt(attempt);
                } catch {
                    setAdjustError('No se aplicó el ajuste, pero no pudimos limpiar su recuperación. Recuperá el resultado otra vez antes de corregir los datos.');
                    return;
                }
                setAdjustRecovery(null);
                setAdjustError(`No se aplicó el ajuste. ${data.error || 'El servidor rechazó este movimiento.'} Corregí los datos para intentarlo de nuevo.`);
            } else {
                setAdjustError(`${data.error || 'No pudimos confirmar el ajuste.'} Conservamos el intento. Recuperá su resultado antes de registrar otro ajuste para este producto.`);
            }
        } catch {
            setAdjustError('No pudimos confirmar el ajuste. Recuperá su resultado: conservamos los mismos datos y el identificador para evitar duplicados.');
        } finally {
            adjustPending.current = false;
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
                // Los opcionales en blanco se OMITEN y el dinero viaja como texto
                // decimal: el spread del estado mandaba '' y NaN, y el alta moría
                // con "Datos de entrada inválidos". Ver utils/productForm.ts.
                body: JSON.stringify(buildCreateProductPayload(formData))
            });

            if (res.ok) {
                if (formData.saleMode === 'MEASURED') {
                    trackEvent('measured_product_created', {
                        unit: formData.unit,
                        family: formData.productFamily,
                        source: 'inventory',
                    });
                }
                setShowCreateModal(false);
                setFormData({ name: '', brand: '', sku: '', description: '', category: '', price: '', cost: '', stock: '', minStock: '5', unit: 'unidad', isPublished: false, imageUrl: '', requiresBatchTracking: false, ivaExento: false, reorderPoint: '', maxStock: '', wholesalePrice: '', wholesaleMinQty: '', packUnit: '', packSize: '', packPrice: '', saleMode: 'COUNTED', quantityStep: '1', productFamily: 'GENERAL' });
                reload();
                alert('Producto creado exitosamente');
            } else {
                const error = await res.json().catch(() => ({}));
                alert(`Error: ${productValidationMessage(error, 'No pudimos crear el producto.')}`);
            }
        } catch (e) {
            alert('Error creando producto');
        }
    };

    // ==========================================
    // DELETE PRODUCT
    // ==========================================


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
    const selectedAdjustWarehouse = adjustWarehouses.find(warehouse => warehouse.id === adjustWarehouseId);
    const adjustmentQuantity = adjustQuantityState.value ?? 0;
    const projectedWarehouseStock = adjustWarehouseStock === null
        ? null
        : adjustForm.type === 'ADJUST_LOSS'
            ? adjustWarehouseStock - adjustmentQuantity
            : adjustWarehouseStock + adjustmentQuantity;
    const adjustmentExceedsStock = projectedWarehouseStock !== null && projectedWarehouseStock < 0;
    const adjustLossExceedsStock = adjustmentExceedsStock;
    const adjustResultingStock = projectedWarehouseStock;
    const adjustmentFormReady = Boolean(
        adjustWarehouseId
        && adjustWarehouseStock !== null
        && adjustmentQuantity > 0
        && adjustForm.reason.trim().length >= 3
        && !adjustmentExceedsStock
    );

    // Debajo de `lg` el catálogo se pinta como tarjetas y no como tabla (ver el
    // comentario del bloque de tarjetas). Las acciones del menú "…" son las
    // MISMAS en los dos modos, así que se arman una sola vez: duplicar el arreglo
    // era la forma segura de que un día "Eliminar" existiera en la tabla y no en
    // el teléfono, o peor, al revés.
    const accionesDe = (product: Product) => {
        const actions: Array<{
            label: string;
            icon: React.ReactNode;
            onClick: () => void;
            hidden?: boolean;
            danger?: boolean;
        }> = [
            {
                label: 'Lotes y vencimientos',
                icon: <Layers size={16} />,
                onClick: () => openBatches(product),
                hidden: !product.requiresBatchTracking,
            },
        ];

        // Para BODEGUERO el ajuste queda visible como acción diaria. En roles
        // administrativos permanece en el menú, conservando la jerarquía previa.
        if (canAdjustStock) {
            actions.push({
                label: 'Registrar pérdida o sobrante',
                icon: <Wrench size={16} />,
                onClick: () => openAdjust(product),
            });
        }

        if (canManageProducts) {
            actions.unshift({
                label: product.isPublished ? 'Ocultar del catálogo' : 'Publicar en catálogo',
                icon: <Globe size={16} />,
                onClick: () => handleTogglePublish(product.id, product.isPublished || false, product.name),
            });

        }

        return actions;
    };

    // El vacío dice lo MISMO en los dos modos; solo cambia el envoltorio
    // (`<tr><td colSpan>` en la tabla, bloque suelto en las tarjetas). Declararlo
    // una vez evita que el teléfono termine con un vacío mudo mientras el
    // escritorio ofrece "Modo rápido".
    const propsVacio: EmptyStateProps = productsError
        ? {
            mode: 'error',
            title: 'No pudimos cargar tu inventario',
            description: 'Puede ser tu conexión. Tus productos siguen ahí — reintentá.',
            action: { label: 'Reintentar', onClick: () => fetchProducts() },
        }
        : hayFiltro
            ? {
                mode: 'no-results',
                title: 'No se encontraron resultados',
                description: searchTerm ? `Ningún producto coincide con "${searchTerm}". Probá con otro nombre o SKU.` : 'Ningún producto coincide con estos filtros. Tus otros productos siguen en el catálogo.',
                action: { label: 'Limpiar filtros', onClick: limpiarFiltros },
            }
            : {
                icon: <Package size={32} />,
                title: 'Tu inventario está vacío',
                description: isBodeguero
                    ? 'Todavía no hay productos para operar. Pedile a un administrador que cargue el catálogo.'
                    : 'Importá tu lista desde Excel y Nortex arma el catálogo solo.',
                action: isOwner ? { label: 'Nuevo producto', icon: <Zap size={18} />, onClick: () => { setShowQuickAddModal(true); setQuickAddSKU(''); } } : undefined,
                secondaryAction: isOwner ? { label: 'Cargar manual', icon: <Plus size={18} />, onClick: () => setShowCreateModal(true) } : undefined,
                linkAction: isOwner ? { label: 'O cargá un catálogo de ejemplo de tu giro para probar', onClick: seedCatalog, loading: seeding, loadingLabel: 'Cargando catálogo…' } : undefined,
                errorText: seedError,
            };

    // La paginación vivía DENTRO del contenedor de la tabla. Al ocultar la tabla
    // en el teléfono se habría ido con ella, dejando al dueño encerrado en los
    // primeros 50 de 1,003 productos sin ninguna señal de que hay más.
    const paginacion = total > PAGE_SIZE ? (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>{((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} de {total.toLocaleString()}</span>
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="nx-fluid-press flex min-h-tap items-center gap-1 rounded-control border border-slate-300 bg-white px-3 text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={16} /> <span className="hidden sm:inline">Anterior</span></button>
                <span className="font-mono text-slate-700">{page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
                <button type="button" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / PAGE_SIZE)}
                    className="nx-fluid-press flex min-h-tap items-center gap-1 rounded-control border border-slate-300 bg-white px-3 text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"><span className="hidden sm:inline">Siguiente</span> <ChevronRight size={16} /></button>
            </div>
        </div>
    ) : null;

    useEffect(() => {
        const id = inventoryParams.get('productId');
        if (receivingBusy) return;
        setActiveProduct(current => {
            const updated = products.find(product => product.id === (current?.id ?? id));
            return updated ?? current;
        });
    }, [products, inventoryParams, receivingBusy]);
    const changeFilters = (next: Partial<InventoryCatalogFilters>) => {
        if (receivingBusy) return;
        if (next.search !== undefined) setSearchTerm(next.search);
        if (next.category !== undefined) setCategoryFilter(next.category);
        if (next.family !== undefined) setFamilyFilter(next.family);
        if (next.mode !== undefined) setModeFilter(next.mode);
        if (next.status !== undefined) setStatusFilter(next.status);
        if (next.sortField !== undefined) setSortField(next.sortField);
        if (next.sortDir !== undefined) setSortDir(next.sortDir);
        setPage(1);
    };
    const closeProductPane = () => {
        if (receivingBusy) return;
        updateReceivingOpen(false);
        setActiveProduct(null);
    };
    const productPane = activeProduct ? <StockProductPane key={activeProduct.id} product={activeProduct} revision={stockRevision}
        canReceive={canManagePurchaseOrders} canReceiveOrders={canReceivePurchaseOrders} canTransfer={canTransferStock}
        canCount={canAdjustStock} canViewPrice={!isBodeguero} onBusyChange={setReceivingBusy} onReceivingChange={updateReceivingOpen}
        onClose={closeProductPane}
        onCompleted={reload}
        onNavigate={(route, warehouseId) => {
            if (receivingBusy) return;
            const params = new URLSearchParams({ productId: activeProduct.id, search: searchTerm || activeProduct.sku });
            if (warehouseId) params.set('warehouseId', warehouseId);
            if (route === '/app/warehouses' && warehouseId) params.set('transfer', '1');
            navigate(`${route}?${params}`);
        }}
        actions={<>
            {canManageProducts && <button type="button" className="nx-fluid-press" aria-label={`Editar ${activeProduct.name}`} onClick={() => openEditModal(activeProduct)}>Editar producto</button>}
            {canViewKardex && <button type="button" className="nx-fluid-press" aria-label={`Auditar kardex de ${activeProduct.name}`} onClick={() => openKardex(activeProduct)}>Movimientos</button>}
            <ActionMenu label={`Más acciones de ${activeProduct.name}`} items={accionesDe(activeProduct)}/>
        </>}/> : null;

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="nx-light-context nx-workspace h-full overflow-y-auto bg-slate-50 text-slate-950">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            <div className={`nx-stock-workspace ${receivingOpen ? 'nx-stock-workspace--receiving' : ''}`}>
                <fieldset className="nx-stock-workspace__catalog" disabled={receivingOpen}>
                    <InventoryCatalog onCreateScannedProduct={canManageProducts ? code => { setQuickAddSKU(code); setShowQuickAddModal(true); } : undefined} onCameraCode={scanWithCamera} title="Mis productos" products={productsError ? [] : products} total={total} loading={loading} error={productsError}
                        filters={{search:searchTerm,category:categoryFilter,family:familyFilter,mode:modeFilter,status:statusFilter,sortField,sortDir}}
                        onFiltersChange={changeFilters} categories={categories} selectedProductId={activeProduct?.id ?? null}
                        onSelectProduct={product => { if (!receivingOpen) setActiveProduct(product as Product); }} canViewPrice={!isBodeguero}
                        actions={{
                            create: isOwner ? () => { setQuickAddSKU(''); setShowQuickAddModal(true); } : undefined,
                            fullCreate: isOwner ? () => setShowCreateModal(true) : undefined,
                            import: isOwner ? () => setShowImportModal(true) : undefined,
                            export: handleExport,
                            showSummary: canViewInventoryValuation ? () => setShowSummary(true) : undefined,
                            warehouses: canTransferStock ? () => navigate('/app/warehouses') : undefined,
                            receiving: canReceivePurchaseOrders ? () => navigate(isBodeguero ? '/app/purchase-orders' : '/app/purchases') : undefined,
                            count: canAdjustStock ? () => navigate('/app/inventory-count') : undefined,
                            serials: !isBodeguero ? () => navigate('/app/serials') : undefined,
                            bulk: isOwner ? () => { setBulkMode(value => !value); setSelectedProductIds([]); } : undefined,
                        }} exporting={exporting}
                        selection={{enabled:bulkMode,ids:selectedProductIds,onToggle:toggleSelection,onToggleAll:toggleSelectAll}}
                        bulkActions={selectedProductIds.length > 0 && isOwner ? <div className="nx-stock-bulk">
                            <button type="button" className="nx-fluid-press" onClick={openBulkEdit}>Editar precio/categoría</button>
                            <button type="button" className="nx-fluid-press" onClick={handlePrintLabels}>Etiquetas</button>
                            <button type="button" className="nx-fluid-press" onClick={() => handleBulkPublish(true)}>Publicar</button>
                            <button type="button" className="nx-fluid-press" onClick={() => handleBulkPublish(false)}>Ocultar</button>
                        </div> : null}
                        emptyState={<EmptyState {...propsVacio}/>} pagination={paginacion}/>
                </fieldset>
                {!compactPane && <aside className="nx-stock-workspace__detail">{productPane ?? <StockPaneEmpty/>}</aside>}
            </div>
            {compactPane && <FluidSheet open={Boolean(activeProduct) && !showQuickAddModal && !showEditModal && !showKardexModal && !showAdjustModal && !showBatchesModal}
                onClose={closeProductPane} ariaLabel="Detalle del producto" panelClassName="nx-light-context nx-stock-mobile-panel" size="content"
                closeOnBackdrop={!receivingBusy} closeOnEscape={!receivingBusy} dragToDismiss={!receivingBusy}>{productPane}</FluidSheet>}
            <FluidSheet open={showSummary} onClose={() => setShowSummary(false)} ariaLabel="Resumen de inventario" panelClassName="nx-light-context" size="content">
                <div className="nx-stock-summary"><div className="flex items-center justify-between"><h2>Resumen de inventario</h2><button type="button" className="nx-fluid-press nx-stock-icon" aria-label="Cerrar resumen" onClick={() => setShowSummary(false)}><X size={20}/></button></div>
                <p className="mb-4 text-sm text-slate-500">Todo el catálogo. Tocá un indicador para ver los productos.</p>
            {canViewInventoryValuation && <section aria-label="Resumen de inventario" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <TarjetaKpi
                    icono={<Package size={16} className="text-brand" />}
                    titulo="Productos"
                    valor={stats ? stats.totalProducts.toLocaleString() : '—'}
                    nota="Cada producto conserva su unidad de medida"
                    activa={statusFilter === '' && categoryFilter === '' && familyFilter === '' && modeFilter === '' && !searchTerm}
                    onClick={limpiarFiltros}
                    etiquetaAccion="Ver todo el catálogo, sin filtros"
                />
                {/* El valor del inventario no es un subconjunto filtrable: se deja
                    estática y sin hover para no prometer una interacción que no existe. */}
                <TarjetaKpi
                    icono={<TrendingUp size={16} className="text-emerald-400" />}
                    titulo="Valor Inventario"
                    valor={stats ? formatCurrency(totals.totalValue) : '—'}
                    nota="Al costo de compra"
                />
                <TarjetaKpi
                    icono={<AlertTriangle size={16} className="text-amber-400" />}
                    titulo="Stock Bajo"
                    valor={stats ? String(totals.lowStockCount) : '—'}
                    nota="Productos bajo mínimo"
                    activa={statusFilter === 'low'}
                    onClick={() => aplicarFiltroEstado('low')}
                    etiquetaAccion="Ver solo los productos bajo mínimo"
                />
                <TarjetaKpi
                    icono={<FileWarning size={16} className="text-red-400" />}
                    titulo="Agotados"
                    valor={stats ? String(totals.outOfStockCount) : '—'}
                    nota="Stock en cero"
                    activa={statusFilter === 'out'}
                    onClick={() => aplicarFiltroEstado('out')}
                    etiquetaAccion="Ver solo los productos agotados"
                />
            </section>}

            {canViewInventoryValuation && statsError && <div role="alert" className="text-sm text-red-700">No pudimos cargar el resumen. <button type="button" onClick={fetchStats} className="nx-fluid-press min-h-tap underline">Reintentar resumen</button></div>}
                </div>
            </FluidSheet>

            {/* ==========================================
                MODAL: KARDEX (HISTORIAL DE AUDITORÍA)
               ========================================== */}
            {showKardexModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowKardexModal(false)}>
                    <div className="nx-dark-context nx-ticket-surface w-full max-w-5xl max-h-[90dvh] overflow-hidden rounded-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        {/* Kardex Header */}
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Shield size={20} className="text-brand" />
                                    <h2 className="text-xl font-bold text-white">Kardex - {selectedProduct.name}</h2>
                                </div>
                                <p className="text-sm text-slate-400 mt-1">
                                    SKU: <span className="font-mono text-slate-300">{selectedProduct.sku}</span>
                                    {' '} | Stock Actual: <span className={`font-bold ${selectedProduct.stock <= selectedProduct.minStock ? 'text-red-400' : 'text-emerald-400'}`}>{formatQuantityValue(selectedProduct.stock)} {selectedProduct.unit}</span>
                                    {canViewInventoryValuation && (
                                        <> {' '} | Valor: <span className="font-semibold text-emerald-300">{formatCurrency(selectedProduct.stock * selectedProduct.cost)}</span></>
                                    )}
                                </p>
                            </div>
                            <IconButton
                                icon={<X size={18} />}
                                label="Cerrar historial de Kardex"
                                onClick={() => setShowKardexModal(false)}
                            />
                        </div>

                        {/* Kardex: Filtro por fecha (A5) */}
                        <div className="px-6 py-3 border-b border-slate-700 bg-slate-900/40 flex flex-wrap items-end gap-3">
                            <div>
                                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Desde</label>
                                <input
                                    type="date"
                                    value={kardexFrom}
                                    onChange={(e) => setKardexFrom(e.target.value)}
                            className="rounded-control border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Hasta</label>
                                <input
                                    type="date"
                                    value={kardexTo}
                                    onChange={(e) => setKardexTo(e.target.value)}
                                    className="rounded-control border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                                />
                            </div>
                            <button
                                onClick={() => fetchKardex(selectedProduct.id, 1, kardexFrom, kardexTo)}
                                className="nx-fluid-press flex min-h-tap items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover"
                            >
                                <Search size={15} /> Filtrar
                            </button>
                            {(kardexFrom || kardexTo) && (
                                <button
                                    onClick={() => { setKardexFrom(''); setKardexTo(''); fetchKardex(selectedProduct.id, 1, '', ''); }}
                                    className="nx-fluid-press min-h-tap text-slate-400 hover:text-white px-3 py-1.5 rounded-lg text-sm border border-slate-600 hover:bg-slate-700 transition-colors"
                                >
                                    Limpiar
                                </button>
                            )}
                            <div className="ml-auto text-xs text-slate-400 self-center">
                                {kardexTotal} movimiento{kardexTotal === 1 ? '' : 's'}
                            </div>
                        </div>

                        {/* Kardex Table — overflow-x: 6 columnas no caben en 360px */}
                        <div className="overflow-y-auto overflow-x-auto max-h-[calc(90dvh-250px)]">
                            {kardexLoading ? (
                                <div className="flex flex-col items-center justify-center py-16">
                                    <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                                    <span className="text-slate-400">Cargando historial...</span>
                                </div>
                            ) : kardexError ? (<div role="alert" className="p-6 text-red-300">{kardexError}<button type="button" onClick={() => fetchKardex(selectedProduct.id, kardexPage, kardexFrom, kardexTo)} className="nx-fluid-press ml-3 min-h-tap underline">Reintentar</button></div>) : kardexData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                    <Clock size={40} className="opacity-30 mb-2" />
                                    <p>No hay movimientos registrados</p>
                                    <p className="text-xs text-slate-300 mt-1">El historial se llenará automáticamente con cada operación</p>
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
                                                            {entry.quantity > 0 ? '+' : ''}{formatQuantityValue(entry.quantity)} {selectedProduct.unit}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className="text-white font-bold text-sm bg-slate-700/60 px-2 py-0.5 rounded">
                                                            {formatQuantityValue(entry.stockAfter)} {selectedProduct.unit}
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
                                        className="nx-fluid-press min-h-tap px-3 py-1.5 rounded-lg text-sm border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                                    >
                                        <ChevronLeft size={15} /> Anterior
                                    </button>
                                    <button
                                        disabled={kardexPage >= Math.ceil(kardexTotal / KARDEX_PAGE_SIZE) || kardexLoading}
                                        onClick={() => fetchKardex(selectedProduct.id, kardexPage + 1, kardexFrom, kardexTo)}
                                        className="nx-fluid-press min-h-tap px-3 py-1.5 rounded-lg text-sm border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
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
                MODAL: AJUSTE MANUAL (ROLES AUTORIZADOS)
               ========================================== */}
            {showAdjustModal && selectedProduct && (
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    onClick={closeAdjust}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="inventory-adjust-title"
                        className="nx-dark-context nx-ticket-surface w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-card shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Adjust Header */}
                        <div className="border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 id="inventory-adjust-title" className="text-xl font-bold text-white flex items-center gap-2">
                                        <Shield size={20} className="text-amber-400" />
                                        Ajustar existencias
                                    </h2>
                                    <p className="text-sm text-slate-400 mt-1">
                                        <span className="font-semibold text-slate-200">{selectedProduct.name}</span>
                                        <span className="font-mono text-xs"> · {selectedProduct.sku}</span>
                                    </p>
                                </div>
                                <IconButton
                                    icon={<X size={18} />}
                                    label="Cerrar ajuste de inventario"
                                    disabled={adjustSubmitting}
                                    onClick={closeAdjust}
                                />
                            </div>
                        </div>

                        <form onSubmit={handleAdjust} aria-busy={adjustSubmitting} className="p-6 space-y-5">
                            {adjustRecovery && (
                                <div role="status" className="rounded-lg border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-200">
                                    <p className="font-semibold">Hay un ajuste pendiente de confirmar.</p>
                                    <p className="mt-1">Recuperá su resultado con los mismos datos para evitar duplicarlo. Podés cerrar este formulario y volver; conservá esta pestaña del navegador hasta resolverlo.</p>
                                    <p className="mt-1 text-xs">Bodega: {adjustRecovery.warehouseName}</p>
                                </div>
                            )}
                            {/* Warn banner */}
                            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-300/80">
                                    Este movimiento queda registrado permanentemente en el Kardex con tu nombre, fecha y justificación. No se puede borrar ni editar.
                                </p>
                            </div>

                            {/* La ubicación es parte del movimiento, no un detalle
                                implícito: con varias bodegas nunca se preselecciona. */}
                            <div>
                                <label htmlFor="adjust-warehouse" className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Bodega del ajuste <span className="text-red-400">*</span>
                                </label>
                                <select
                                    id="adjust-warehouse"
                                    required
                                    value={adjustWarehouseId}
                                    onChange={event => {
                                        setAdjustWarehouseId(event.target.value);
                                        setAdjustError('');
                                    }}
                                    disabled={adjustWarehousesLoading || adjustSubmitting || Boolean(adjustRecovery) || adjustRecoveryBlocked}
                                    className="w-full px-4 py-2.5 border rounded-control focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60 bg-surface-900 text-slate-100 nx-form-field"
                                >
                                    <option value="">
                                        {adjustWarehousesLoading
                                            ? 'Cargando bodegas…'
                                            : adjustWarehouses.length === 0
                                                ? 'No hay bodegas activas'
                                                : 'Seleccioná una bodega'}
                                    </option>
                                    {adjustWarehouses.map(warehouse => (
                                        <option key={warehouse.id} value={warehouse.id}>
                                            {warehouse.name}{warehouse.isDefault ? ' · Principal' : ''}
                                        </option>
                                    ))}
                                    {adjustRecovery && !adjustWarehouses.some(warehouse => warehouse.id === adjustRecovery.payload.warehouseId) && (
                                        <option value={adjustRecovery.payload.warehouseId}>{adjustRecovery.warehouseName}</option>
                                    )}
                                </select>
                                {adjustStockLoading && (
                                    <p className="mt-2 text-xs text-slate-400">Consultando el stock de esta bodega…</p>
                                )}
                                {!adjustStockLoading && selectedAdjustWarehouse && adjustWarehouseStock !== null && (
                                    <div className="mt-2 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-sm text-slate-300">
                                        Stock en <strong className="text-white">{selectedAdjustWarehouse.name}</strong>:{' '}
                                        <span className="font-mono font-bold text-brand">{adjustWarehouseStock} {selectedProduct.unit}</span>
                                    </div>
                                )}
                            </div>

                            {/* Type */}
                            <div>
                                <p id="inventory-adjust-type-label" className="block text-sm text-slate-300 mb-2 font-medium">
                                    ¿Qué ocurrió? <span className="text-red-400">*</span>
                                </p>
                                <div aria-labelledby="inventory-adjust-type-label" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {([
                                        { value: 'ADJUST_LOSS', label: 'Pérdida / Merma', icon: TrendingDown, selectedClass: 'border-red-500 bg-red-950/40 text-red-300' },
                                        { value: 'ADJUST_GAIN', label: 'Ganancia / Hallazgo', icon: TrendingUp, selectedClass: 'border-emerald-500 bg-emerald-950/40 text-emerald-300' },
                                        { value: 'IN_PURCHASE', label: 'Compra / Entrada', icon: ArrowDownCircle, selectedClass: 'border-brand bg-emerald-950/40 text-emerald-300' },
                                        { value: 'RETURN', label: 'Devolución', icon: RotateCcw, selectedClass: 'border-purple-500 bg-purple-950/40 text-purple-300' },
                                    ] as const)
                                        .filter(opt => adjustmentTypesForRole(isBodeguero).includes(opt.value))
                                        .map(opt => {
                                        const Icon = opt.icon;
                                        const isSelected = adjustForm.type === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                aria-pressed={isSelected}
                                                disabled={adjustSubmitting || Boolean(adjustRecovery) || adjustRecoveryBlocked}
                                                onClick={() => {
                                                    setAdjustForm(current => ({ ...current, type: opt.value as AdjustType }));
                                                    setAdjustError('');
                                                }}
                                                className={`nx-fluid-press min-h-tap flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isSelected
                                                    ? opt.selectedClass
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
                                <label htmlFor="inventory-adjust-quantity" className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Cantidad <span className="text-red-400">*</span>
                                </label>
                                {/* En productos contados equivale a inputMode="numeric" y pattern="[0-9]*";
                                    los medidos necesitan el separador decimal del teclado móvil. */}
                                <input
                                    id="inventory-adjust-quantity"
                                    required
                                    type="text"
                                    inputMode={selectedProduct.saleMode === 'MEASURED' ? 'decimal' : 'numeric'}
                                    pattern={selectedProduct.saleMode === 'MEASURED' ? undefined : '[0-9]*'}
                                    value={adjustForm.quantity}
                                    disabled={adjustSubmitting || Boolean(adjustRecovery) || adjustRecoveryBlocked || !adjustWarehouseId}
                                    aria-invalid={Boolean(adjustQuantityState.error || adjustLossExceedsStock)}
                                    aria-describedby="inventory-adjust-quantity-help"
                                    onChange={(e) => {
                                        setAdjustForm(current => ({
                                            ...current,
                                            quantity: selectedProduct.saleMode === 'MEASURED'
                                                ? sanitizeDecimalInput(e.target.value)
                                                : sanitizeWholeNumberInput(e.target.value),
                                        }));
                                        setAdjustError('');
                                    }}
                                    placeholder="Ej: 5"
                                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg font-bold font-mono tabular-nums focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                />
                                <div id="inventory-adjust-quantity-help" className="mt-1.5 text-xs" hidden={Boolean(adjustRecovery)}>
                                    {adjustQuantityState.error && <p className="text-red-300">{adjustQuantityState.error}</p>}
                                    {!adjustQuantityState.error && adjustLossExceedsStock && (
                                        <p className="text-red-300">
                                            No podés retirar más de {formatQuantityValue(adjustWarehouseStock ?? 0)} {selectedProduct.unit} de esta bodega.
                                        </p>
                                    )}
                                    {!adjustQuantityState.error && !adjustLossExceedsStock && adjustResultingStock !== null && (
                                        <p className="text-slate-400">
                                            Quedarán <span className="font-bold text-white">{formatQuantityValue(adjustResultingStock)} {selectedProduct.unit}</span> en {selectedAdjustWarehouse?.name}.
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Reason (MANDATORY) */}
                            <div>
                                <label htmlFor="inventory-adjust-reason" className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Justificación <span className="text-red-400">*</span>
                                </label>
                                <textarea
                                    id="inventory-adjust-reason"
                                    required
                                    minLength={3}
                                    maxLength={300}
                                    value={adjustForm.reason}
                                    disabled={adjustSubmitting || Boolean(adjustRecovery) || adjustRecoveryBlocked}
                                    aria-invalid={Boolean(adjustForm.reason && adjustForm.reason.trim().length < 3)}
                                    onChange={(e) => {
                                        setAdjustForm(current => ({ ...current, reason: e.target.value }));
                                        setAdjustError('');
                                    }}
                                    placeholder='Ej: “Producto dañado durante el traslado”'
                                    rows={3}
                                    className="w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-4 py-2.5 text-white placeholder-slate-600 transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
                                />
                                {adjustForm.reason && adjustForm.reason.trim().length < 3 && (
                                    <p className="mt-1.5 text-xs text-red-300">Escribí al menos 3 caracteres para dejar un rastro útil.</p>
                                )}
                            </div>

                            {adjustError && (
                                <div role="alert" className="rounded-lg border border-red-800/70 bg-red-950/30 px-3 py-2.5 text-sm text-red-200">
                                    {adjustError}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                                <button
                                    type="button"
                                    disabled={adjustSubmitting}
                                    onClick={closeAdjust}
                                    className="nx-fluid-press sm:w-auto px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {adjustRecovery ? 'Cerrar y recuperar después' : 'Cancelar'}
                                </button>
                                <button
                                    type="submit"
                                    disabled={adjustSubmitting || adjustRecoveryBlocked || (!adjustRecovery && (adjustWarehousesLoading || adjustStockLoading || !adjustmentFormReady))}
                                    className={`nx-fluid-press flex-1 py-3 rounded-lg font-bold text-white transition-colors ${adjustForm.type === 'ADJUST_LOSS'
                                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
                                        : 'bg-brand hover:bg-brand-hover disabled:bg-emerald-900'
                                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {adjustSubmitting ? 'Procesando...' : adjustRecovery ? 'Recuperar resultado del ajuste' : (
                                        adjustForm.type === 'ADJUST_LOSS'
                                            ? 'Registrar pérdida'
                                            : adjustForm.type
                                                ? 'Registrar ajuste'
                                                : 'Completá el ajuste'
                                    )}
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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeEdit}>
                    <div className="nx-dark-context nx-ticket-surface w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Edit size={20} className="text-brand" />
                                    Editar Producto
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5 font-mono">{selectedProduct.sku}</p>
                            </div>
                            <IconButton
                                icon={<X size={18} />}
                                label="Cerrar edición de producto"
                                disabled={editSubmitting}
                                onClick={closeEdit}
                            />
                        </div>

                        <form onSubmit={handleEdit} aria-busy={editSubmitting} className="p-6">
                            <fieldset disabled={editSubmitting} className="space-y-4">
                            {editError && <p role="alert" className="text-sm text-red-300">{editError}</p>}
                            <p className="text-sm text-slate-400">Acá cambiás la ficha. Para cambiar existencias, recibí mercadería o hacé un conteo.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="text-sm text-slate-300">Código del producto<input required aria-label="Código del producto" value={editForm.sku} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} className="input-premium w-full min-h-tap mt-1" /></label>
                                <label className="text-sm text-slate-300">Avisarme cuando queden<input required aria-label="Avisarme cuando queden" inputMode="decimal" value={editForm.minStock} onChange={e => setEditForm({ ...editForm, minStock: e.target.value })} className="input-premium w-full min-h-tap mt-1" /><span className="text-xs text-slate-400">{editForm.unit}</span></label>
                            </div>
                            <label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={editForm.ivaExento} onChange={e => setEditForm({ ...editForm, ivaExento: e.target.checked })} />Exento de IVA</label>
                            <label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={editForm.requiresBatchTracking} onChange={e => setEditForm({ ...editForm, requiresBatchTracking: e.target.checked })} />Controlar lotes y vencimientos</label>
                            {/* Nombre */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Nombre del Producto *</label>
                                <input
                                    required
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2.5 text-white transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                />
                            </div>

                            <label className="block text-sm text-slate-300">Marca (opcional)<input aria-label="Marca (opcional)" maxLength={100} value={editForm.brand} onChange={e => setEditForm({ ...editForm, brand: e.target.value })} className="input-premium w-full min-h-tap mt-1" placeholder="Ej. Truper" /></label>
                            {/* Categoría */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Categoría</label>
                                <input
                                    value={editForm.category}
                                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                    className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2.5 text-white transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                />
                            </div>

                            {/* Descripción */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Descripción</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                    rows={2}
                                    className="w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-3 py-2.5 text-white transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Forma de venta</label>
                                    <select
                                        value={editForm.saleMode}
                                        onChange={(e) => {
                                            const mode = e.target.value as 'LEGACY' | 'COUNTED' | 'MEASURED';
                                            setEditForm({
                                                ...editForm,
                                                saleMode: mode,
                                                quantityStep: mode === 'COUNTED'
                                                    ? '1'
                                                    : mode === 'MEASURED'
                                                        ? '0.001'
                                                        : '',
                                            });
                                        }}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                                    >
                                        <option value="LEGACY">Configuración anterior</option>
                                        <option value="COUNTED">Por unidades contadas</option>
                                        <option value="MEASURED">Por peso/medida</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Unidad base</label>
                                    <select value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white">
                                        {['unidad', 'g', 'kg', 'oz', 'lb', 'ml', 'litro', 'metro', 'saco', 'caja', 'frasco', 'bolsa'].map(value => <option key={value}>{value}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Cantidad mínima por paso</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        disabled={editForm.saleMode === 'LEGACY'}
                                        value={editForm.quantityStep}
                                        onChange={(e) => setEditForm({ ...editForm, quantityStep: sanitizeDecimalInput(e.target.value) })}
                                        placeholder={editForm.saleMode === 'MEASURED' ? '0.001' : '1'}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white disabled:opacity-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Familia</label>
                                    <select value={editForm.productFamily} onChange={(e) => setEditForm({ ...editForm, productFamily: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white">
                                        <option value="GENERAL">General</option>
                                        <option value="MEAT">Carnes</option>
                                        <option value="POULTRY">Pollos y aves</option>
                                        <option value="ANIMAL_FEED">Alimento animal</option>
                                        <option value="AGRO_INPUT">Agroinsumos</option>
                                        <option value="VETERINARY">Veterinaria</option>
                                    </select>
                                </div>
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
                                    className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2.5 text-white transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                <Shield size={14} className="mt-0.5 shrink-0 text-brand" />
                                <p className="text-xs text-slate-400">
                                    El stock y el costo <span className="font-semibold text-emerald-300">no se modifican aquí</span>. Cambiar unidad, modo o paso no altera ventas anteriores; el stock actual debe ser compatible con el nuevo paso.
                                </p>
                            </div>

                            {/* Acciones */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="submit"
                                    disabled={editSubmitting}
                                    className="nx-fluid-press flex-1 rounded-control bg-brand py-3 font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:bg-emerald-900 disabled:opacity-50"
                                >
                                    {editSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                                </button>
                                <button
                                    type="button"
                                    onClick={closeEdit}
                                    className="nx-fluid-press px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    Cancelar
                                </button>
                            </div>
                            </fieldset>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: NUEVO PRODUCTO
               ========================================== */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
                    <div className="nx-dark-context nx-ticket-surface w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Plus size={20} className="text-brand" />
                                Nuevo Producto
                            </h2>
                            <IconButton
                                icon={<X size={18} />}
                                label="Cerrar creación de producto"
                                onClick={() => setShowCreateModal(false)}
                            />
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <label className="block text-sm text-slate-300">Marca (opcional)<input aria-label="Marca (opcional)" maxLength={100} value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} className="input-premium w-full min-h-tap mt-1" placeholder="Ej. Truper" /></label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Nombre del Producto *</label>
                                    <input
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">SKU / Código *</label>
                                    <input
                                        required
                                        value={formData.sku}
                                        onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                                        className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-300 mb-1 font-medium">Descripción</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Categoría</label>
                                    <input
                                        value={formData.category}
                                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                        className="w-full rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                        <option>g</option>
                                        <option>kg</option>
                                        <option>oz</option>
                                        <option>lb</option>
                                        <option>ml</option>
                                        <option>litro</option>
                                        <option>saco</option>
                                        <option>caja</option>
                                        <option>frasco</option>
                                        <option>bolsa</option>
                                        <option>metro</option>
                                        <option>par</option>
                                        <option>rollo</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 rounded-lg border border-brand/20 bg-brand/5 p-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Forma de venta</label>
                                    <select
                                        value={formData.saleMode}
                                        onChange={(e) => {
                                            const saleMode = e.target.value as 'COUNTED' | 'MEASURED';
                                            setFormData({
                                                ...formData,
                                                saleMode,
                                                quantityStep: saleMode === 'COUNTED' ? '1' : '0.001',
                                            });
                                        }}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                                    >
                                        <option value="COUNTED">Por unidades</option>
                                        <option value="MEASURED">Por peso/medida</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Cantidad mínima por paso</label>
                                    <input
                                        required
                                        type="text"
                                        inputMode="decimal"
                                        value={formData.quantityStep}
                                        onChange={(e) => setFormData({ ...formData, quantityStep: sanitizeDecimalInput(e.target.value) })}
                                        placeholder={formData.saleMode === 'MEASURED' ? '0.001' : '1'}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Familia</label>
                                    <select value={formData.productFamily} onChange={(e) => {
                                        const productFamily = e.target.value as ProductFamily;
                                        const preset = productFamilyPreset(productFamily);
                                        setFormData({
                                            ...formData,
                                            productFamily,
                                            unit: preset.unit,
                                            saleMode: preset.saleMode,
                                            quantityStep: preset.quantityStep,
                                            requiresBatchTracking: preset.requiresBatchTracking,
                                            packUnit: preset.packUnit,
                                            packSize: preset.packSize,
                                            // Fiscalidad y precios permanecen bajo confirmación del dueño.
                                        });
                                    }}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white">
                                        <option value="GENERAL">General</option>
                                        <option value="MEAT">Carnes</option>
                                        <option value="POULTRY">Pollos y aves</option>
                                        <option value="ANIMAL_FEED">Alimento animal</option>
                                        <option value="AGRO_INPUT">Agroinsumos</option>
                                        <option value="VETERINARY">Veterinaria</option>
                                    </select>
                                </div>
                                <p className="col-span-3 text-xs text-slate-400">
                                    El precio se interpreta por la unidad base. Ejemplo: carne a C$/kg con paso 0.001.
                                </p>
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
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Costo de Compra (opcional)</label>
                                    <input
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
                                    <label className="flex cursor-pointer items-center gap-3 rounded-control border border-slate-700 bg-slate-900 p-3 transition-colors hover:border-brand/50">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.isPublished}
                                                onChange={(e) => setFormData({ ...formData, isPublished: e.target.checked })}
                                                className="sr-only"
                                            />
                                            <div className={`h-5 w-10 rounded-full bg-slate-700 transition-colors ${formData.isPublished ? 'bg-brand' : ''}`}></div>
                                            <div className={`absolute left-1 top-1 w-3 h-3 bg-surface-900 rounded-full transition-transform ${formData.isPublished ? 'translate-x-5' : ''}`}></div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Publicar en Catálogo Online</span>
                                            <span className="text-xs text-slate-400">Si está activo, tus clientes podrán ver este producto</span>
                                        </div>
                                    </label>
                                </div>
                                <div className="col-span-4 mt-2">
                                    <label className="flex cursor-pointer items-center gap-3 rounded-control border border-slate-700 bg-slate-900 p-3 transition-colors hover:border-brand/50">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.requiresBatchTracking}
                                                onChange={(e) => setFormData({ ...formData, requiresBatchTracking: e.target.checked })}
                                                className="sr-only"
                                            />
                                            <div className={`w-10 h-5 bg-slate-700 rounded-full transition-colors ${formData.requiresBatchTracking ? 'bg-orange-600' : ''}`}></div>
                                            <div className={`absolute left-1 top-1 w-3 h-3 bg-surface-900 rounded-full transition-transform ${formData.requiresBatchTracking ? 'translate-x-5' : ''}`}></div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Requiere Control de Lote/Vencimiento</span>
                                            <span className="text-xs text-slate-400">Activar para farmacias. Exigirá lote y fecha al comprar.</span>
                                        </div>
                                    </label>
                                </div>
                                <div className="col-span-4 mt-2">
                                    <label className="flex items-center gap-3 p-3 bg-surface-900 border border-white/[0.06] rounded-lg cursor-pointer hover:border-brand/50 transition-colors">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.ivaExento}
                                                onChange={(e) => setFormData({ ...formData, ivaExento: e.target.checked })}
                                                className="sr-only"
                                            />
                                            <div className={`w-10 h-5 rounded-full transition-colors ${formData.ivaExento ? 'bg-accent' : 'bg-surface-700'}`}></div>
                                            <div className={`absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform ${formData.ivaExento ? 'translate-x-5' : ''}`}></div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Exonerado de IVA</span>
                                            <span className="text-xs text-slate-400">Canasta básica y medicamentos. Si lo activás, este producto NO lleva IVA en la venta ni en tu declaración.</span>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    className="nx-fluid-press flex-1 rounded-control bg-brand py-3 font-bold text-brand-on transition-colors hover:bg-brand-hover"
                                >
                                    Crear Producto
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="nx-fluid-press px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
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
                    onSuccess={created => {
                        reload();
                        if (created) setActiveProduct(created as Product);
                    }}
                />
            )}

            {/* ==========================================
                MODAL: BATCHES (LOTES)
               ========================================== */}
            {showBatchesModal && selectedProduct && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !batchSubmitting && !writeoffSubmitting && setShowBatchesModal(false)}>
                    <div role="dialog" aria-modal="true" aria-label={`Lotes de ${selectedProduct.name}`} className="nx-dark-context nx-ticket-surface flex w-full max-w-3xl max-h-[90dvh] flex-col overflow-hidden rounded-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Layers size={20} className="text-orange-400" />
                                    <h2 className="text-xl font-bold text-white">Lotes Activos - {selectedProduct.name}</h2>
                                </div>
                                <p className="text-sm text-slate-400 mt-1">
                                    SKU: <span className="font-mono text-slate-300">{selectedProduct.sku}</span>
                                    {' '} | Stock Total: <span className="font-bold text-white">{formatQuantityValue(selectedProduct.stock)} {selectedProduct.unit}</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isOwner && (
                                    <button
                                        onClick={() => {
                                            setWriteoffForm(null);
                                            setBatchCommandError('');
                                            setShowAddBatchForm(current => {
                                                if (!current) setBatchForm(newManualBatchForm(soleActiveWarehouseId(batchWarehouses)));
                                                return !current;
                                            });
                                        }}
                                        disabled={batchesLoading || Boolean(batchLoadError) || batchWarehousesLoading || batchWarehouses.length === 0}
                                        className="nx-fluid-press min-h-tap bg-orange-600 hover:bg-orange-500 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                                    >
                                        <Plus size={16} /> Agregar lote
                                    </button>
                                )}
                                <IconButton
                                    icon={<X size={18} />}
                                    label="Cerrar lotes activos"
                                    onClick={() => setShowBatchesModal(false)}
                                    disabled={batchSubmitting || writeoffSubmitting}
                                />
                            </div>
                        </div>

                        {/* A4: Formulario de alta de lote */}
                        {isOwner && showAddBatchForm && (
                            <form aria-label="Alta manual de lote" onSubmit={handleAddBatch} className="px-6 py-4 border-b border-slate-700 bg-slate-900/40 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Nº Lote</label>
                                    <input
                                        type="text"
                                        value={batchForm.batchNumber}
                                        onChange={(e) => editBatchForm({ batchNumber: e.target.value })}
                                        placeholder="L-2026-001"
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Vencimiento</label>
                                    <input
                                        type="date"
                                        value={batchForm.expiryDate}
                                        onChange={(e) => editBatchForm({ expiryDate: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Cantidad ({selectedProduct.unit})</label>
                                    <input
                                        type="number"
                                        inputMode={selectedProduct.saleMode === 'COUNTED' ? 'numeric' : 'decimal'}
                                        min={selectedProduct.quantityStep?.toString() || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001')}
                                        step={selectedProduct.quantityStep?.toString() || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001')}
                                        value={batchForm.quantity}
                                        onChange={(e) => editBatchForm({ quantity: e.target.value })}
                                        placeholder="0"
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Bodega</label>
                                    <select
                                        aria-label="Bodega para el alta del lote"
                                        value={batchForm.warehouseId}
                                        onChange={(event) => editBatchForm({ warehouseId: event.target.value })}
                                        disabled={batchWarehousesLoading}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    >
                                        <option value="">Seleccioná una bodega</option>
                                        {batchWarehouses.map(warehouse => (
                                            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    type="submit"
                                    disabled={batchSubmitting || batchWarehousesLoading || !batchForm.warehouseId}
                                    className="nx-fluid-press min-h-tap bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                                >
                                    {batchSubmitting ? 'Guardando...' : (<><Plus size={16} /> Sumar al stock</>)}
                                </button>
                                <p className="sm:col-span-6 text-[11px] text-orange-300/70 flex items-center gap-1.5">
                                    <AlertTriangle size={13} /> La entrada queda ligada al lote y a la bodega. Un reintento conserva el mismo identificador y no duplica stock.
                                </p>
                            </form>
                        )}

                        {isOwner && writeoffForm && (
                            <form aria-label={`Dar de baja lote ${writeoffForm.batchNumber}`} onSubmit={handleWriteoffBatch} className="px-6 py-4 border-b border-red-900/50 bg-red-950/20 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                                <div className="sm:col-span-6 flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-red-200">Merma del lote {writeoffForm.batchNumber}</p>
                                        <p className="text-xs text-slate-400">Indicá la cantidad que existe físicamente en una bodega. No se reparte ni se adivina ubicación.</p>
                                    </div>
                                    <IconButton
                                        icon={<X size={16} />}
                                        label="Cancelar merma del lote"
                                        onClick={() => setWriteoffForm(null)}
                                        disabled={writeoffSubmitting}
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Bodega</label>
                                    <select
                                        aria-label="Bodega de la merma"
                                        value={writeoffForm.warehouseId}
                                        onChange={(event) => editWriteoffForm({ warehouseId: event.target.value })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                    >
                                        <option value="">Seleccioná una bodega</option>
                                        {batchWarehouses.map(warehouse => (
                                            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="sm:col-span-1">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Cantidad ({selectedProduct.unit})</label>
                                    <input
                                        aria-label="Cantidad a dar de baja"
                                        type="number"
                                        inputMode={selectedProduct.saleMode === 'COUNTED' ? 'numeric' : 'decimal'}
                                        min={selectedProduct.quantityStep?.toString() || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001')}
                                        step={selectedProduct.quantityStep?.toString() || (selectedProduct.saleMode === 'COUNTED' ? '1' : '0.0001')}
                                        value={writeoffForm.quantity}
                                        onChange={(event) => editWriteoffForm({ quantity: event.target.value })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Justificación</label>
                                    <input
                                        aria-label="Justificación de la merma"
                                        type="text"
                                        maxLength={500}
                                        value={writeoffForm.reason}
                                        onChange={(event) => editWriteoffForm({ reason: event.target.value })}
                                        placeholder="Ej. vencimiento o daño"
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={writeoffSubmitting || !writeoffForm.warehouseId}
                                    className="nx-fluid-press min-h-tap bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
                                >
                                    {writeoffSubmitting ? 'Registrando...' : 'Confirmar merma'}
                                </button>
                            </form>
                        )}

                        {batchLoadError && (<div role="alert" className="p-4 text-sm text-red-300">{batchLoadError}<button type="button" onClick={() => openBatches(selectedProduct)} className="nx-fluid-press ml-3 min-h-tap underline">Reintentar carga</button></div>)}
                        {batchCommandError && (
                            <div role="alert" className="px-6 py-3 border-b border-red-900/50 bg-red-950/30 text-sm text-red-200">
                                {batchCommandError}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto overflow-x-auto p-0">
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
                                            const expiry = batchExpiryPresentation(batch.expiryDate);
                                            const isExpired = expiry.status === 'expired';
                                            const isExpiringSoon = expiry.status === 'expiring' || expiry.status === 'unknown';

                                            return (
                                                <tr key={batch.id} className="hover:bg-slate-700/20 transition-colors">
                                                    <td className="px-6 py-4 text-sm font-medium text-white font-mono">
                                                        {batch.batchNumber}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${isExpired ? 'bg-red-900/40 text-red-400' : isExpiringSoon ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                                                            {isExpired ? 'Vencido · ' : ''}{expiry.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-right font-bold text-white">
                                                        {batch.stock}
                                                    </td>
                                                    {isOwner && (
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => openWriteoffBatch(batch)}
                                                                className={`nx-fluid-press min-h-tap px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isExpired ? 'bg-red-600/20 border-red-600/50 text-red-300 hover:bg-red-600/40' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowBulkEditModal(false)}>
                    <div className="nx-dark-context nx-ticket-surface w-full max-w-lg overflow-hidden rounded-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-slate-900/55 px-6 py-4">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Edit size={20} className="text-brand" />
                                    Edición masiva
                                </h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {selectedProductIds.length} producto{selectedProductIds.length === 1 ? '' : 's'} seleccionado{selectedProductIds.length === 1 ? '' : 's'}
                                </p>
                            </div>
                            <IconButton
                                icon={<X size={18} />}
                                label="Cerrar edición masiva"
                                onClick={() => setShowBulkEditModal(false)}
                            />
                        </div>

                        <form onSubmit={handleBulkEdit} className="p-6 space-y-5">
                            <div className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 flex items-start gap-2">
                                <Shield size={16} className="mt-0.5 shrink-0 text-brand" />
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
                                    className="w-full rounded-control border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
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
                                        className={`nx-fluid-press min-h-tap px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${bulkEditForm.priceMode === '' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                                    >
                                        Sin cambio
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBulkEditForm({ ...bulkEditForm, priceMode: 'set', priceValue: '' })}
                                        className={`nx-fluid-press min-h-tap rounded-control border px-3 py-2 text-sm font-medium transition-colors ${bulkEditForm.priceMode === 'set' ? 'border-brand bg-brand text-brand-on' : 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                                    >
                                        Fijar C$
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBulkEditForm({ ...bulkEditForm, priceMode: 'pct', priceValue: '' })}
                                        className={`nx-fluid-press min-h-tap rounded-control border px-3 py-2 text-sm font-medium transition-colors ${bulkEditForm.priceMode === 'pct' ? 'border-brand bg-brand text-brand-on' : 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
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
                                            className="w-full rounded-control border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
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
                                    className="nx-fluid-press min-h-tap flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={bulkEditSubmitting}
                                    className="nx-fluid-press flex-1 rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-50"
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

/** A changed authenticated session discards all visible catalogue and receipt state. */
export default function Inventory() {
    const [, refreshSession] = useState(0);
    useEffect(() => {
        const refresh = () => refreshSession(value => value + 1);
        window.addEventListener('storage', refresh);
        window.addEventListener('focus', refresh);
        return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
    }, []);
    return <InventoryWorkspace key={`${localStorage.getItem('nortex_token')}:${currentSessionRole()}`}/>;
}
