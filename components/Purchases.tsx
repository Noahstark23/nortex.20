import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { maybeAutostartTour } from '../utils/tours';
import {
    Truck, Plus, Search, FileText, CreditCard, DollarSign, Package,
    Calendar, X, Check, AlertTriangle, Clock, Trash2,
    ShoppingCart, Wallet, Printer, Eye, Stamp, Loader2, GitCompareArrows,
    LockKeyhole, RotateCcw, SlidersHorizontal
} from 'lucide-react';
import { formatMoney, sanitizeDecimalInput } from '../utils/money';
import Decimal from 'decimal.js';
import { formatQuantityValue } from '../utils/quantity';
import {
    purchaseQuantityInputStep,
    resolvePurchaseLine,
    type PurchaseUnit,
} from '../utils/purchasePackaging';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';
import { authenticatedRequestErrorMessage, openAuthenticatedPreview } from '../utils/authenticatedDownload';

// ==========================================
// TYPES
// ==========================================

interface Supplier {
    id: string;
    name: string;
    contactName?: string;
    phone?: string;
}

interface Product {
    id: string;
    name: string;
    sku: string;
    price: number;
    cost: number;
    stock: number;
    unit: string;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: number | string | null;
    productFamily?: string | null;
    packUnit?: string | null;
    packSize?: number | string | null;
    ivaExento?: boolean;
    requiresBatchTracking?: boolean;
}

interface CartItem {
    cartKey: string;
    productId: string;
    purchaseOrderItemId?: string;
    productName: string;
    sku: string;
    quantity: number | string;
    unitCost: number | string;
    totalCost: number | string;
    currentSalePrice: number | string | null;
    salePrice: string;
    currentStock: number;
    unit: string;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: number | string | null;
    purchaseUnit: PurchaseUnit;
    packUnit?: string | null;
    packSize?: number | string | null;
    ivaExento?: boolean;
    requiresBatchTracking?: boolean;
    batchNumber?: string;
    expiryDate?: string;
    orderedQuantity?: string;
    receivedQuantity?: string;
    invoicedQuantity?: string;
    availableQuantity?: string;
}

interface PurchaseOrderItemLite {
    id: string;
    productId: string;
    productName: string;
    quantityOrdered: number | string;
    quantityReceived: number | string;
    quantityOrderedExact?: number | string | null;
    quantityReceivedExact?: number | string | null;
    unitCost: number | string;
    unitAtOrder?: string | null;
}

interface PurchaseOrderLite {
    id: string;
    supplierId: string;
    orderNumber: string;
    status: string;
    items: PurchaseOrderItemLite[];
    receipts?: {
        items: {
            productId: string;
            purchaseOrderItemId?: string | null;
            quantity: number | string;
            quantityExact?: number | string | null;
        }[];
    }[];
}

interface Purchase {
    id: string;
    supplierId: string;
    supplier: { id: string; name: string };
    invoiceNumber: string;
    date: string;
    dueDate?: string;
    postingDate?: string | null;
    subtotal: number | string;
    tax: number | string;
    total: number | string;
    balanceDue?: number | string | null;
    paidAt?: string | null;
    status: string;
    paymentMethod: string;
    documentStatus?: 'DRAFT' | 'POSTED' | 'VOID' | string;
    matchStatus?: 'NOT_REQUIRED' | 'MATCHED' | 'EXCEPTION' | 'RESOLVED' | string;
    paymentHold?: boolean;
    matchResolvedBy?: string | null;
    matchResolvedAt?: string | null;
    matchResolutionNote?: string | null;
    notes?: string;
    items: {
        id: string;
        productId: string;
        productName: string;
        purchaseOrderItemId?: string | null;
        quantity: number;
        quantityExact?: number | string | null;
        unit?: string;
        unitCost: number | string;
        totalCost: number | string;
    }[];
    createdAt: string;
}

interface PurchaseFormErrors {
    supplierId?: string;
    warehouseId?: string;
    invoiceNumber?: string;
    date?: string;
    dueDate?: string;
    notes?: string;
    items?: string;
}

interface WarehouseOption {
    id: string;
    name: string;
    isDefault: boolean;
    isActive: boolean;
}

type SupplierPaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'QR';

interface PaymentDialogState {
    id: string;
    invoiceNumber: string;
    clientEventId: string;
}

interface SupplierPaymentForm {
    amount: string;
    method: SupplierPaymentMethod;
    reference: string;
    notes: string;
}

type MatchStatus = 'NOT_REQUIRED' | 'MATCHED' | 'EXCEPTION' | 'RESOLVED';

interface ProcurementMatchSummary {
    id: string;
    invoiceNumber: string;
    date: string;
    postingDate?: string | null;
    documentStatus: string;
    matchStatus: MatchStatus;
    paymentHold: boolean;
    total: string;
    balanceDue: string | null;
    supplier: { id: string; name: string };
    purchaseOrder: { id: string; orderNumber: string } | null;
    openExceptionCount: number;
    varianceAmount: string;
}

interface ProcurementMatchPurchaseHeader {
    id: string;
    invoiceNumber: string;
    date: string;
    postingDate?: string | null;
    documentStatus: string;
    matchStatus: MatchStatus;
    paymentHold: boolean;
    total: string;
    balanceDue: string | null;
    supplier: { id: string; name: string };
    purchaseOrder: { id: string; orderNumber: string } | null;
    matchResolvedBy?: string | null;
    matchResolvedAt?: string | null;
    matchResolutionNote?: string | null;
}

interface ProcurementMatchDetail {
    purchase: ProcurementMatchPurchaseHeader;
    lines: Array<{
        id: string;
        productId: string;
        productName: string;
        purchaseOrderItemId: string | null;
        quantityExact: string;
        unitCostExact: string;
        expectedUnitCostExact: string | null;
        priceVarianceExact: string | null;
        allocations: Array<{
            id: string;
            goodsReceiptItemId: string;
            quantityExact: string;
        }>;
    }>;
    exceptions: Array<{
        id: string;
        purchaseItemId: string | null;
        type: string;
        status: string;
        expectedValueExact: string | null;
        actualValueExact: string | null;
        varianceExact: string | null;
        toleranceExact: string | null;
        resolutionNote: string | null;
        resolvedBy: string | null;
        resolvedAt: string | null;
        createdAt: string;
    }>;
    totals: {
        expectedAmount: string;
        invoiceAmount: string;
        varianceAmount: string;
    };
}

interface MatchResolutionState {
    purchaseId: string;
    invoiceNumber: string;
    clientEventId: string;
    reason: string;
}

const EMPTY_SUPPLIER_PAYMENT_FORM: SupplierPaymentForm = {
    amount: '',
    method: 'CASH',
    reference: '',
    notes: '',
};

// ==========================================
// HELPERS
// ==========================================

const formatCurrency = (n: Decimal.Value) => formatMoney(n);
const hasPackConfiguration = (
    product: Pick<Product, 'packUnit' | 'packSize'>,
): boolean => Boolean(
    product.packUnit?.trim()
    && product.packSize !== null
    && product.packSize !== undefined
    && Number.isFinite(Number(product.packSize))
    && Number(product.packSize) > 0,
);
const resolveCartLine = (item: CartItem) => resolvePurchaseLine({
    quantity: item.quantity,
    unitCost: item.unitCost,
    purchaseUnit: item.purchaseUnit,
}, item);
const exactPurchaseQuantity = (item: Pick<Purchase['items'][number], 'quantity' | 'quantityExact'>) =>
    item.quantityExact ?? item.quantity;
const FISCAL_DOCUMENT_ROLES = new Set(['OWNER', 'ADMIN', 'ACCOUNTANT']);
const PURCHASE_CREATE_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER']);
const SUPPLIER_PAYMENT_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT']);
const MATCH_RESOLVE_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT']);
const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
// Las fechas de factura, vencimiento y lote son días de calendario, no instantes.
// Prisma las devuelve como UTC; formatearlas en la zona local puede mostrar el
// día anterior.
export const localCalendarDateInputValue = (date: Date = new Date()) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const isValidCalendarDateInput = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
};

// Las filas nuevas se persisten al mediodía UTC; las históricas pueden conservar
// el instante real de creación. Proyectarlas siempre a la zona fiscal oficial
// evita tanto el día anterior en inputs civiles como el día siguiente en compras
// antiguas registradas de noche.
export const formatCalendarDate = (d: string) => new Date(d).toLocaleDateString('es-NI', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Managua',
});
export const formatCalendarDateLong = (d: string) => new Date(d).toLocaleDateString('es-NI', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Managua',
});

/**
 * Las compras históricas no tienen balanceDue. Solo en ese caso se conserva el
 * contrato legacy: una compra abierta debe el total y una completada debe cero.
 */
export const effectivePurchaseBalance = (
    purchase: Pick<Purchase, 'balanceDue' | 'status' | 'total'>,
): Decimal => {
    if (purchase.balanceDue !== null && purchase.balanceDue !== undefined) {
        try {
            return Decimal.max(0, new Decimal(purchase.balanceDue));
        } catch {
            return new Decimal(0);
        }
    }
    if (purchase.status === 'COMPLETED') return new Decimal(0);
    try {
        return Decimal.max(0, new Decimal(purchase.total));
    } catch {
        return new Decimal(0);
    }
};

export const purchaseStatusLabel = (status: string): string => {
    if (status === 'COMPLETED') return 'Pagado';
    if (status === 'PARTIALLY_PAID') return 'Abono parcial';
    return 'Pendiente';
};

const isNortexCapitalPurchase = (purchase: Pick<Purchase, 'paymentMethod'>) =>
    purchase.paymentMethod === 'NORTEX_CAPITAL';

const purchaseMethodLabel = (method: string) => {
    if (method === 'CASH') return 'Contado';
    if (method === 'NORTEX_CAPITAL') return 'Financiamiento Nortex';
    return 'Crédito';
};

const newClientEventId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const firstValidationMessage = (data: any): string | undefined => {
    if (!data?.details || typeof data.details !== 'object') return undefined;
    for (const value of Object.values(data.details)) {
        if (Array.isArray(value) && value.length > 0) return String(value[0]);
    }
    return undefined;
};

export const purchaseOrderLineAvailability = (purchaseOrder: PurchaseOrderLite) => {
    const invoicedByItemId = new Map<string, Decimal>();
    const legacyInvoicedByProduct = new Map<string, Decimal>();
    for (const receipt of purchaseOrder.receipts ?? []) {
        for (const item of receipt.items) {
            if (item.purchaseOrderItemId) {
                invoicedByItemId.set(
                    item.purchaseOrderItemId,
                    (invoicedByItemId.get(item.purchaseOrderItemId) ?? new Decimal(0)).plus(
                        item.quantityExact ?? item.quantity,
                    ),
                );
                continue;
            }
            legacyInvoicedByProduct.set(
                item.productId,
                (legacyInvoicedByProduct.get(item.productId) ?? new Decimal(0)).plus(
                    item.quantityExact ?? item.quantity,
                ),
            );
        }
    }

    return purchaseOrder.items.map(item => {
        const ordered = new Decimal(item.quantityOrderedExact ?? item.quantityOrdered);
        const received = new Decimal(item.quantityReceivedExact ?? item.quantityReceived);
        const explicitInvoiced = invoicedByItemId.get(item.id) ?? new Decimal(0);
        const legacyPool = legacyInvoicedByProduct.get(item.productId) ?? new Decimal(0);
        const legacyAllocated = Decimal.min(
            legacyPool,
            Decimal.max(0, received.minus(explicitInvoiced)),
        );
        legacyInvoicedByProduct.set(item.productId, Decimal.max(0, legacyPool.minus(legacyAllocated)));
        const invoiced = explicitInvoiced.plus(legacyAllocated);
        return {
            ...item,
            orderedQuantity: ordered.toString(),
            receivedQuantity: received.toString(),
            invoicedQuantity: invoiced.toString(),
            availableQuantity: Decimal.max(0, received.minus(invoiced)).toString(),
        };
    });
};

const availablePurchaseOrderItems = (purchaseOrder: PurchaseOrderLite) =>
    purchaseOrderLineAvailability(purchaseOrder)
        .filter(item => new Decimal(item.availableQuantity).greaterThan(0));

const matchStatusLabel = (status: string): string => ({
    NOT_REQUIRED: 'No requiere conciliación',
    MATCHED: 'Conciliada',
    EXCEPTION: 'Con diferencias',
    RESOLVED: 'Resuelta',
}[status] ?? status);

const matchStatusClass = (status: string): string => ({
    NOT_REQUIRED: 'border-slate-200 bg-slate-100 text-slate-600',
    MATCHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    EXCEPTION: 'border-amber-200 bg-amber-50 text-amber-700',
    RESOLVED: 'border-sky-200 bg-sky-50 text-sky-700',
}[status] ?? 'border-slate-200 bg-slate-100 text-slate-600');

const exceptionTypeLabel = (type: string): string => ({
    QUANTITY: 'Cantidad',
    PRICE: 'Precio',
    MISSING_RECEIPT: 'Sin recepción',
    UNORDERED_ITEM: 'Fuera de la OC',
    OVER_INVOICED: 'Cantidad excedida',
}[type] ?? type.replaceAll('_', ' '));

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function Purchases() {
    const currentRole = currentSessionRole();
    const canEditPurchaseSalePrice = roleCapabilitiesFor(currentRole).canManageProducts;
    const canCreatePurchase = PURCHASE_CREATE_ROLES.has(currentRole);
    const canPaySuppliers = SUPPLIER_PAYMENT_ROLES.has(currentRole);
    const canResolveMatches = MATCH_RESOLVE_ROLES.has(currentRole);

    // Tab state
    const [activeTab, setActiveTab] = useState<'new' | 'history' | 'matches'>(canCreatePurchase ? 'new' : 'history');

    // Data
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);

    // New Purchase form
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderLite[]>([]);
    const [selectedPO, setSelectedPO] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(() => localCalendarDateInputValue());
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT'>('CASH');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formErrors, setFormErrors] = useState<PurchaseFormErrors>({});
    const [paymentToConfirm, setPaymentToConfirm] = useState<PaymentDialogState | null>(null);
    const [supplierPaymentForm, setSupplierPaymentForm] = useState<SupplierPaymentForm>(EMPTY_SUPPLIER_PAYMENT_FORM);
    const [supplierPaymentError, setSupplierPaymentError] = useState('');
    const [paying, setPaying] = useState(false);
    const [openingRetentionId, setOpeningRetentionId] = useState<string | null>(null);
    const [matches, setMatches] = useState<ProcurementMatchSummary[]>([]);
    const [matchStatusFilter, setMatchStatusFilter] = useState<MatchStatus | 'ALL'>('EXCEPTION');
    const [matchHoldFilter, setMatchHoldFilter] = useState<'ALL' | 'true' | 'false'>('true');
    const [matchSupplierFilter, setMatchSupplierFilter] = useState('');
    const [matchesLoading, setMatchesLoading] = useState(false);
    const [matchesError, setMatchesError] = useState('');
    const [matchesNextCursor, setMatchesNextCursor] = useState<string | null>(null);
    const [selectedMatch, setSelectedMatch] = useState<ProcurementMatchDetail | null>(null);
    const [matchDetailLoadingId, setMatchDetailLoadingId] = useState<string | null>(null);
    const [matchDetailError, setMatchDetailError] = useState('');
    const [matchResolution, setMatchResolution] = useState<MatchResolutionState | null>(null);
    const [resolvingMatch, setResolvingMatch] = useState(false);
    const [matchResolutionError, setMatchResolutionError] = useState('');
    const matchRequestIdRef = useRef(0);
    const { toast, showToast, dismissToast } = useToast();

    // Invoice modal
    const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);

    // Auth
    const token = localStorage.getItem('nortex_token');
    const canAccessFiscalDocuments = FISCAL_DOCUMENT_ROLES.has(currentRole);
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    const handleOpenRetention = async (purchaseId: string) => {
        if (!canAccessFiscalDocuments) return;
        if (openingRetentionId) return;
        setOpeningRetentionId(purchaseId);
        try {
            // openAuthenticatedPreview crea la ventana antes de su primer await,
            // todavía dentro del gesto del click, y recién después hace el fetch.
            await openAuthenticatedPreview(`/api/fiscal/constancia-retencion/${purchaseId}`, { token });
        } catch (error) {
            showToast({
                tone: 'error',
                title: 'No se pudo abrir la constancia',
                message: authenticatedRequestErrorMessage(error),
            });
        } finally {
            setOpeningRetentionId(null);
        }
    };

    // ==========================================
    // DATA FETCHING
    // ==========================================

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const [suppRes, prodRes, purchRes, poRes, warehouseRes] = await Promise.all([
                fetch('/api/suppliers', { headers, signal: controller.signal }),
                fetch('/api/products', { headers, signal: controller.signal }),
                fetch('/api/purchases', { headers, signal: controller.signal }),
                fetch('/api/purchase-orders', { headers, signal: controller.signal }),
                fetch('/api/warehouses', { headers, signal: controller.signal }),
            ]);

            if (suppRes.ok) setSuppliers(await suppRes.json());
            if (prodRes.ok) {
                const productData = await prodRes.json();
                setProducts(Array.isArray(productData) ? productData.map((product: Product) => ({
                    ...product,
                    price: Number(product.price),
                    cost: Number(product.cost),
                    stock: Number(product.stock),
                    packSize: product.packSize === null || product.packSize === undefined
                        ? null
                        : Number(product.packSize),
                })) : []);
            }
            if (purchRes.ok) setPurchases(await purchRes.json());
            if (poRes.ok) {
                const poData = await poRes.json();
                setPurchaseOrders(Array.isArray(poData?.data) ? poData.data : []);
            }
            if (warehouseRes.ok) {
                const warehouseData = await warehouseRes.json();
                const activeWarehouses = Array.isArray(warehouseData?.data)
                    ? warehouseData.data.filter((warehouse: WarehouseOption) => warehouse.isActive)
                    : [];
                setWarehouses(activeWarehouses);
                setSelectedWarehouseId(current => {
                    if (current && activeWarehouses.some((warehouse: WarehouseOption) => warehouse.id === current)) return current;
                    return activeWarehouses.length === 1 ? activeWarehouses[0].id : '';
                });
            }
            const failed = [
                [suppRes, 'proveedores'],
                [prodRes, 'productos'],
                [purchRes, 'historial'],
                [poRes, 'órdenes de compra'],
                [warehouseRes, 'bodegas'],
            ].filter(([response]) => !(response as Response).ok)
                .map(([, label]) => label as string);
            if (failed.length > 0) {
                showToast({
                    tone: 'warning',
                    title: 'Algunos datos no se cargaron',
                    message: `Reintentá para actualizar: ${failed.join(', ')}.`,
                });
            }
        } catch (e: any) {
            console.error('Error fetching data:', e);
            showToast({
                tone: 'error',
                title: e?.name === 'AbortError' ? 'La carga tardó demasiado' : 'No pudimos cargar Compras',
                message: 'Revisá tu conexión y volvé a abrir el módulo para reintentar.',
            });
        } finally {
            window.clearTimeout(timeoutId);
            setLoading(false);
        }
    }, [headers, showToast]);

    useEffect(() => { void fetchAll(); }, [fetchAll]);

    // Tutorial guiado: si entran con ?tour=compras (desde Ayuda).
    useEffect(() => { maybeAutostartTour(); }, []);

    const loadMatches = useCallback(async (cursor?: string, append = false) => {
        const requestId = matchRequestIdRef.current + 1;
        matchRequestIdRef.current = requestId;
        setMatchesLoading(true);
        setMatchesError('');
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const query = new URLSearchParams({ limit: '50' });
            if (matchStatusFilter !== 'ALL') query.set('status', matchStatusFilter);
            if (matchHoldFilter !== 'ALL') query.set('paymentHold', matchHoldFilter);
            if (matchSupplierFilter) query.set('supplierId', matchSupplierFilter);
            if (cursor) query.set('cursor', cursor);

            const response = await fetch(`/api/procurement/matches?${query.toString()}`, {
                headers,
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({})) as {
                data?: ProcurementMatchSummary[];
                pageInfo?: { nextCursor?: string | null };
                error?: string;
            };
            if (!response.ok) {
                if (matchRequestIdRef.current !== requestId) return;
                setMatchesError(payload.error || 'No se pudo cargar la bandeja de conciliación.');
                return;
            }
            if (matchRequestIdRef.current !== requestId) return;
            const nextMatches = Array.isArray(payload.data) ? payload.data : [];
            setMatches(current => append ? [...current, ...nextMatches] : nextMatches);
            setMatchesNextCursor(payload.pageInfo?.nextCursor ?? null);
        } catch (error) {
            if (matchRequestIdRef.current !== requestId) return;
            setMatchesError((error as { name?: string })?.name === 'AbortError'
                ? 'La bandeja tardó demasiado en responder. Reintentá.'
                : 'No pudimos conectar con la bandeja de conciliación.');
        } finally {
            window.clearTimeout(timeoutId);
            if (matchRequestIdRef.current === requestId) setMatchesLoading(false);
        }
    }, [headers, matchHoldFilter, matchStatusFilter, matchSupplierFilter]);

    useEffect(() => {
        if (activeTab === 'matches') void loadMatches();
    }, [activeTab, loadMatches]);

    const openMatchDetail = async (purchaseId: string) => {
        if (matchDetailLoadingId) return;
        setSelectedMatch(null);
        setMatchDetailError('');
        setMatchDetailLoadingId(purchaseId);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(`/api/procurement/matches/${purchaseId}`, {
                headers,
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({})) as {
                data?: ProcurementMatchDetail;
                error?: string;
            };
            if (!response.ok || !payload.data) {
                setMatchDetailError(payload.error || 'No se pudo cargar el detalle de conciliación.');
                return;
            }
            setSelectedMatch(payload.data);
        } catch (error) {
            setMatchDetailError((error as { name?: string })?.name === 'AbortError'
                ? 'El detalle tardó demasiado en responder.'
                : 'No pudimos cargar el detalle de conciliación.');
        } finally {
            window.clearTimeout(timeoutId);
            setMatchDetailLoadingId(null);
        }
    };

    const openMatchResolution = (match: ProcurementMatchSummary | ProcurementMatchPurchaseHeader) => {
        if (!canResolveMatches || match.matchStatus !== 'EXCEPTION') return;
        setSelectedMatch(null);
        setMatchResolution({
            purchaseId: match.id,
            invoiceNumber: match.invoiceNumber,
            clientEventId: newClientEventId(),
            reason: '',
        });
        setMatchResolutionError('');
    };

    const closeMatchResolution = () => {
        if (resolvingMatch) return;
        setMatchResolution(null);
        setMatchResolutionError('');
    };

    const resolveMatch = async () => {
        if (!canResolveMatches || !matchResolution || resolvingMatch) return;
        const reason = matchResolution.reason.trim();
        if (reason.length < 3) {
            setMatchResolutionError('Explicá la decisión con al menos 3 caracteres.');
            return;
        }
        if (reason.length > 1000) {
            setMatchResolutionError('La explicación no puede superar 1000 caracteres.');
            return;
        }

        setResolvingMatch(true);
        setMatchResolutionError('');
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(`/api/procurement/matches/${matchResolution.purchaseId}/resolve`, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    clientEventId: matchResolution.clientEventId,
                    reason,
                }),
            });
            const payload = await response.json().catch(() => ({})) as {
                data?: {
                    purchaseId: string;
                    matchStatus: MatchStatus;
                    paymentHold: boolean;
                    matchResolvedBy: string | null;
                    matchResolvedAt: string | null;
                    matchResolutionNote: string | null;
                };
                replay?: boolean;
                error?: string;
            };
            if (!response.ok || !payload.data) {
                setMatchResolutionError(payload.error || 'No se pudo resolver la conciliación.');
                return;
            }

            setMatches(current => current.map(match => match.id === payload.data?.purchaseId
                ? { ...match, matchStatus: 'RESOLVED', paymentHold: false, openExceptionCount: 0 }
                : match));
            setPurchases(current => current.map(purchase => purchase.id === payload.data?.purchaseId
                ? {
                    ...purchase,
                    matchStatus: payload.data.matchStatus,
                    paymentHold: payload.data.paymentHold,
                    matchResolvedBy: payload.data.matchResolvedBy,
                    matchResolvedAt: payload.data.matchResolvedAt,
                    matchResolutionNote: payload.data.matchResolutionNote,
                }
                : purchase));
            if (selectedMatch?.purchase.id === payload.data.purchaseId) {
                setSelectedMatch(current => current ? {
                    ...current,
                    purchase: { ...current.purchase, matchStatus: 'RESOLVED', paymentHold: false },
                } : current);
            }
            showToast({
                tone: 'success',
                title: payload.replay ? 'Resolución ya confirmada' : 'Diferencia resuelta',
                message: payload.replay
                    ? 'El servidor reconoció el mismo intento y no duplicó la resolución.'
                    : `La factura #${matchResolution.invoiceNumber} quedó liberada para pago.`,
            });
            setMatchResolution(null);
            setMatchResolutionError('');
            void loadMatches();
        } catch (error) {
            setMatchResolutionError((error as { name?: string })?.name === 'AbortError'
                ? 'No se confirmó la resolución. Reintentá con este mismo diálogo para no duplicarla.'
                : 'No pudimos confirmar la resolución. El intento se conserva para reintentar.');
        } finally {
            window.clearTimeout(timeoutId);
            setResolvingMatch(false);
        }
    };

    // ==========================================
    // CART LOGIC
    // ==========================================

    const filteredProducts = useMemo(() => {
        if (!productSearch.trim()) return [];
        const term = productSearch.toLowerCase();
        return products.filter(p =>
            p.name.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term)
        ).slice(0, 8);
    }, [products, productSearch]);

    const addToCart = (product: Product) => {
        setCart(currentCart => {
            const existing = currentCart.find(c => c.productId === product.id);
            if (existing) {
                return currentCart.map(c =>
                    c.productId === product.id
                        ? (() => {
                            const increment = c.purchaseUnit === 'PACK'
                                ? new Decimal(1)
                                : new Decimal(product.quantityStep || 1);
                            const quantity = new Decimal(c.quantity).plus(increment).toString();
                            return {
                                ...c,
                                quantity,
                                totalCost: new Decimal(quantity).mul(c.unitCost).toDecimalPlaces(2).toString(),
                            };
                        })()
                        : c
                );
            }

            const initialQuantity = new Decimal(product.quantityStep || 1).toString();
            return [...currentCart, {
                cartKey: product.id,
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: initialQuantity,
                unitCost: new Decimal(product.cost).toDecimalPlaces(2).toString(),
                totalCost: new Decimal(initialQuantity).mul(product.cost).toDecimalPlaces(2).toString(),
                currentSalePrice: product.price,
                salePrice: '',
                currentStock: product.stock,
                unit: product.unit || 'unidad',
                saleMode: product.saleMode,
                quantityStep: product.quantityStep,
                purchaseUnit: 'BASE',
                packUnit: product.packUnit,
                packSize: product.packSize,
                ivaExento: product.ivaExento,
                requiresBatchTracking: product.requiresBatchTracking,
                batchNumber: '',
                expiryDate: ''
            }];
        });
        setFormErrors(current => ({ ...current, items: undefined }));
        setProductSearch('');
    };

    const updateCartItem = (
        cartKey: string,
        field: 'quantity' | 'unitCost' | 'salePrice' | 'batchNumber' | 'expiryDate',
        value: string | number,
    ) => {
        setCart(currentCart => {
            // Product.price es único por SKU, aunque una OC pueda repetir ese
            // SKU en varias líneas. Mantener los inputs sincronizados evita que
            // el formulario permita dos decisiones comerciales incompatibles.
            const salePriceProductId = field === 'salePrice'
                ? currentCart.find(item => item.cartKey === cartKey)?.productId
                : undefined;

            return currentCart.map(c => {
                if (field === 'salePrice' && salePriceProductId && c.productId === salePriceProductId) {
                    return { ...c, salePrice: String(value) };
                }
                if (c.cartKey !== cartKey) return c;
                const updated = { ...c, [field]: value };
                if (field === 'quantity' || field === 'unitCost') {
                    updated.totalCost = new Decimal(updated.quantity || 0)
                        .mul(updated.unitCost || 0)
                        .toDecimalPlaces(2)
                        .toString();
                }
                return updated;
            });
        });
        setFormErrors(current => ({ ...current, items: undefined }));
    };

    const updatePurchaseUnit = (cartKey: string, purchaseUnit: PurchaseUnit) => {
        setCart(currentCart => currentCart.map(item => {
            if (item.cartKey !== cartKey || item.purchaseUnit === purchaseUnit) return item;
            if (!hasPackConfiguration(item)) return item;

            const factor = new Decimal(item.packSize!);
            // El costo visible cambia de "por unidad base" a "por empaque" (o
            // viceversa). La cantidad visible se conserva: 2 lb pasa a 2 sacos
            // porque la persona cambió deliberadamente la unidad del input.
            const nextUnitCost = purchaseUnit === 'PACK'
                ? new Decimal(item.unitCost).mul(factor)
                : new Decimal(item.unitCost).div(factor);
            const unitCost = nextUnitCost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
            return {
                ...item,
                purchaseUnit,
                unitCost,
                totalCost: new Decimal(item.quantity || 0)
                    .mul(unitCost)
                    .toDecimalPlaces(2)
                    .toString(),
            };
        }));
        setFormErrors(current => ({ ...current, items: undefined }));
    };

    const removeFromCart = (cartKey: string) => {
        setCart(currentCart => currentCart.filter(c => c.cartKey !== cartKey));
    };

    // Una factura vinculada a una OC registra el dinero, no vuelve a ingresar
    // mercadería: el stock y los lotes pertenecen al acto de recepción.
    const purchaseOrdersForSupplier = useMemo(() =>
        purchaseOrders.filter(po =>
            po.supplierId === selectedSupplier &&
            ['PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status) &&
            availablePurchaseOrderItems(po).length > 0
        ), [purchaseOrders, selectedSupplier]);

    const linkPurchaseOrder = (poId: string) => {
        if (!poId) {
            setSelectedPO('');
            setCart([]);
            setFormErrors(current => ({ ...current, items: undefined }));
            return;
        }

        const purchaseOrder = purchaseOrders.find(po => po.id === poId);
        if (!purchaseOrder) return;

        const receivedItems = availablePurchaseOrderItems(purchaseOrder);
        if (receivedItems.length === 0) {
            showToast({
                tone: 'warning',
                title: 'Primero recibí la mercadería',
                message: 'Solo podés facturar una orden de compra después de registrar al menos una recepción.',
            });
            return;
        }

        setSelectedPO(poId);
        setCart(receivedItems.map(item => {
            const product = products.find(candidate => candidate.id === item.productId);
            const quantity = new Decimal(item.availableQuantity).toString();
            const unitCost = new Decimal(item.unitCost).toString();
            return {
                cartKey: item.id,
                productId: item.productId,
                purchaseOrderItemId: item.id,
                productName: item.productName,
                sku: product?.sku ?? '',
                quantity,
                unitCost,
                totalCost: new Decimal(quantity).mul(unitCost).toDecimalPlaces(2).toString(),
                currentSalePrice: product?.price ?? null,
                salePrice: '',
                currentStock: product?.stock ?? 0,
                unit: product?.unit || 'unidad',
                saleMode: product?.saleMode,
                quantityStep: product?.quantityStep,
                purchaseUnit: 'BASE',
                packUnit: product?.packUnit,
                packSize: product?.packSize,
                ivaExento: product?.ivaExento,
                // Los datos de lote se capturan al recibir la OC; exigirlos otra
                // vez en la factura induciría a duplicar la recepción.
                requiresBatchTracking: false,
                batchNumber: '',
                expiryDate: '',
                orderedQuantity: item.orderedQuantity,
                receivedQuantity: item.receivedQuantity,
                invoicedQuantity: item.invoicedQuantity,
                availableQuantity: item.availableQuantity,
            };
        }));
        setFormErrors(current => ({ ...current, items: undefined }));
    };

    const changeSupplier = (supplierId: string) => {
        setSelectedSupplier(supplierId);
        setFormErrors(current => ({ ...current, supplierId: undefined }));
        if (selectedPO) {
            setSelectedPO('');
            setCart([]);
        }
    };

    const cartTotals = useMemo(() => {
        const subtotal = cart.reduce((sum, item) => sum.plus(item.totalCost), new Decimal(0));
        const taxableSubtotal = cart.reduce(
            (sum, item) => item.ivaExento ? sum : sum.plus(item.totalCost),
            new Decimal(0),
        );
        const tax = taxableSubtotal.mul('0.15').toDecimalPlaces(2);
        return {
            subtotal: subtotal.toNumber(),
            taxableSubtotal: taxableSubtotal.toNumber(),
            tax: tax.toNumber(),
            total: subtotal.plus(tax).toNumber(),
        };
    }, [cart]);

    // ==========================================
    // SUBMIT PURCHASE
    // ==========================================

    const handleSubmit = async () => {
        if (submitting) return;

        const errors: PurchaseFormErrors = {};
        if (!selectedSupplier) errors.supplierId = 'Seleccioná un proveedor.';
        if (!selectedPO && !selectedWarehouseId) errors.warehouseId = 'Seleccioná la bodega donde entra la mercadería.';
        if (!invoiceNumber.trim()) errors.invoiceNumber = 'Ingresá el número de factura del proveedor.';
        if (!purchaseDate) errors.date = 'Ingresá la fecha de la factura.';
        else if (!isValidCalendarDateInput(purchaseDate)) errors.date = 'Ingresá una fecha de factura válida.';
        if (cart.length === 0) errors.items = 'Agregá al menos un producto.';
        if (paymentMethod === 'CREDIT' && !dueDate) errors.dueDate = 'Ingresá la fecha de vencimiento.';
        if (notes.trim().length > 500) errors.notes = 'Las notas no pueden superar 500 caracteres.';

        const invalidItem = cart.find(item => {
            try {
                resolveCartLine(item);
                return false;
            } catch {
                return true;
            }
        });
        if (invalidItem) {
            errors.items = `Revisá cantidad y costo de ${invalidItem.productName}.`;
        }

        const invalidPrecision = cart.find(item => {
            try {
                return new Decimal(item.quantity).decimalPlaces() > 4
                    || new Decimal(item.unitCost).decimalPlaces() > 6;
            } catch {
                return false;
            }
        });
        if (invalidPrecision) {
            errors.items = `${invalidPrecision.productName}: la cantidad admite 4 decimales y el costo 6.`;
        }

        const invalidSalePrice = canEditPurchaseSalePrice && cart.find(item => {
            const value = item.salePrice.trim();
            if (!value) return false;
            try {
                const price = new Decimal(value);
                const persistedPrice = price.toNumber();
                return !Number.isFinite(persistedPrice) || persistedPrice <= 0;
            } catch {
                return true;
            }
        });
        if (invalidSalePrice) {
            errors.items = `${invalidSalePrice.productName}: el nuevo precio de venta debe ser representable y mayor que cero.`;
        }

        const overAvailable = cart.find(item => item.purchaseOrderItemId && item.availableQuantity && (() => {
            try {
                return new Decimal(item.quantity).greaterThan(item.availableQuantity);
            } catch {
                return false;
            }
        })());
        if (overAvailable) {
            errors.items = `${overAvailable.productName}: la factura supera lo recibido disponible (${formatQuantityValue(overAvailable.availableQuantity!)}).`;
        }

        const incompleteBatch = cart.find(item =>
            item.requiresBatchTracking && (!item.batchNumber?.trim() || !item.expiryDate)
        );
        if (incompleteBatch) {
            errors.items = `Completá el lote y vencimiento de ${incompleteBatch.productName}.`;
        }

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            showToast({
                tone: 'warning',
                title: 'Revisá los datos de la compra',
                message: Object.values(errors)[0],
            });
            window.setTimeout(() => {
                document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            }, 0);
            return;
        }

        setFormErrors({});
        setSubmitting(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const res = await fetch('/api/purchases', {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    supplierId: selectedSupplier,
                    warehouseId: selectedPO ? undefined : selectedWarehouseId || undefined,
                    invoiceNumber: invoiceNumber.trim(),
                    date: purchaseDate,
                    postingDate: purchaseDate,
                    purchaseOrderId: selectedPO || undefined,
                    paymentMethod,
                    // JSON.stringify omite undefined: los opcionales no viajan como null.
                    dueDate: paymentMethod === 'CREDIT' && dueDate ? dueDate : undefined,
                    notes: notes.trim() || undefined,
                    items: cart.map(c => {
                        return {
                            productId: c.productId,
                            purchaseOrderItemId: c.purchaseOrderItemId,
                            quantity: new Decimal(c.quantity).toString(),
                            unitCost: new Decimal(c.unitCost).toString(),
                            purchaseUnit: c.purchaseUnit,
                            salePrice: canEditPurchaseSalePrice && c.salePrice.trim()
                                ? new Decimal(c.salePrice).toString()
                                : undefined,
                            batchNumber: c.batchNumber?.trim() || undefined,
                            expiryDate: c.expiryDate || undefined
                        };
                    })
                })
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                showToast({
                    tone: 'success',
                    title: 'Compra registrada',
                    message: data.message || 'El inventario y los saldos quedaron actualizados.',
                });
                // Reset form
                setSelectedSupplier('');
                setSelectedWarehouseId(warehouses.length === 1 ? warehouses[0].id : '');
                setSelectedPO('');
                setInvoiceNumber('');
                setPurchaseDate(localCalendarDateInputValue());
                setPaymentMethod('CASH');
                setDueDate('');
                setNotes('');
                setCart([]);
                setFormErrors({});
                void fetchAll();
            } else {
                const details = data?.details && typeof data.details === 'object' ? data.details : {};
                setFormErrors({
                    supplierId: Array.isArray(details.supplierId) ? String(details.supplierId[0]) : undefined,
                    warehouseId: Array.isArray(details.warehouseId) ? String(details.warehouseId[0]) : undefined,
                    invoiceNumber: Array.isArray(details.invoiceNumber) ? String(details.invoiceNumber[0]) : undefined,
                    date: Array.isArray(details.date) ? String(details.date[0]) : undefined,
                    dueDate: Array.isArray(details.dueDate) ? String(details.dueDate[0]) : undefined,
                    notes: Array.isArray(details.notes) ? String(details.notes[0]) : undefined,
                    items: Array.isArray(details.items) ? String(details.items[0]) : undefined,
                });
                showToast({
                    tone: 'error',
                    title: res.status === 409 ? 'Esta factura ya fue registrada' : 'No se pudo registrar la compra',
                    message: firstValidationMessage(data) || data.error || `El servidor respondió ${res.status}.`,
                });
            }
        } catch (e: any) {
            const timedOut = e?.name === 'AbortError';
            showToast({
                tone: 'error',
                title: timedOut ? 'La conexión tardó demasiado' : 'No pudimos conectar con el servidor',
                message: timedOut
                    ? 'Revisá el historial antes de reintentar: la compra pudo terminar de procesarse.'
                    : 'Conservamos todos los datos del formulario para que podás volver a intentar.',
            });
        } finally {
            window.clearTimeout(timeoutId);
            setSubmitting(false);
        }
    };

    // ==========================================
    // PAY PENDING
    // ==========================================

    const handlePay = (purchase: Purchase) => {
        if (!canPaySuppliers) return;
        if (purchase.paymentHold) {
            showToast({
                tone: 'warning',
                title: 'Pago retenido por conciliación',
                message: 'Revisá y resolvé las diferencias entre la OC, la recepción y la factura antes de pagar.',
            });
            return;
        }
        if (isNortexCapitalPurchase(purchase)) {
            showToast({
                tone: 'warning',
                title: 'Financiamiento Nortex',
                message: 'Esta obligación no se paga desde Cuentas por Pagar a proveedores.',
            });
            return;
        }
        setSupplierPaymentForm(EMPTY_SUPPLIER_PAYMENT_FORM);
        setSupplierPaymentError('');
        setPaymentToConfirm({
            id: purchase.id,
            invoiceNumber: purchase.invoiceNumber,
            clientEventId: newClientEventId(),
        });
    };

    const closePaymentDialog = () => {
        if (paying) return;
        setPaymentToConfirm(null);
        setSupplierPaymentForm(EMPTY_SUPPLIER_PAYMENT_FORM);
        setSupplierPaymentError('');
    };

    const confirmPayment = async (settleAll = false) => {
        if (!canPaySuppliers || !paymentToConfirm || paying) return;
        const purchase = purchases.find(candidate => candidate.id === paymentToConfirm.id);
        if (!purchase || isNortexCapitalPurchase(purchase) || purchase.paymentHold) {
            setSupplierPaymentError(purchase?.paymentHold
                ? 'El pago sigue retenido por una diferencia de conciliación.'
                : 'Esta compra no admite pagos desde este flujo.');
            return;
        }

        let normalizedAmount: string | undefined;
        if (!settleAll) {
            try {
                const amount = new Decimal(supplierPaymentForm.amount.trim());
                const balance = effectivePurchaseBalance(purchase);
                if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
                    setSupplierPaymentError('Ingresá un monto mayor que cero.');
                    return;
                }
                if (amount.decimalPlaces() > 2) {
                    setSupplierPaymentError('El abono admite máximo dos decimales.');
                    return;
                }
                if (amount.greaterThan(balance)) {
                    setSupplierPaymentError(`El abono no puede superar el saldo de ${formatCurrency(balance)}.`);
                    return;
                }
                normalizedAmount = amount.toFixed(amount.decimalPlaces());
            } catch {
                setSupplierPaymentError('Ingresá un monto válido.');
                return;
            }
        }
        if (supplierPaymentForm.reference.trim().length > 191) {
            setSupplierPaymentError('La referencia no puede superar 191 caracteres.');
            return;
        }
        if (supplierPaymentForm.notes.trim().length > 2000) {
            setSupplierPaymentError('Las notas no pueden superar 2000 caracteres.');
            return;
        }

        setPaying(true);
        setSupplierPaymentError('');
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const body = {
                clientEventId: paymentToConfirm.clientEventId,
                method: supplierPaymentForm.method,
                ...(normalizedAmount === undefined ? {} : { amount: normalizedAmount }),
                ...(supplierPaymentForm.reference.trim() ? { reference: supplierPaymentForm.reference.trim() } : {}),
                ...(supplierPaymentForm.notes.trim() ? { notes: supplierPaymentForm.notes.trim() } : {}),
            };
            const res = await fetch(`/api/purchases/${paymentToConfirm.id}/pay`, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                if (data.purchase?.id) {
                    setPurchases(current => current.map(candidate => (
                        candidate.id === data.purchase.id ? { ...candidate, ...data.purchase } : candidate
                    )));
                }
                showToast({
                    tone: 'success',
                    title: data.replay ? 'Pago ya confirmado' : settleAll ? 'Factura liquidada' : 'Abono registrado',
                    message: data.replay
                        ? 'El servidor reconoció el mismo intento y no duplicó el pago.'
                        : `La factura #${paymentToConfirm.invoiceNumber} quedó actualizada.`,
                });
                setPaymentToConfirm(null);
                setSupplierPaymentForm(EMPTY_SUPPLIER_PAYMENT_FORM);
                setSupplierPaymentError('');
                void fetchAll();
            } else {
                const message = data.error || `El servidor respondió ${res.status}.`;
                setSupplierPaymentError(message);
                showToast({ tone: 'error', title: 'No se pudo registrar el pago', message });
            }
        } catch (e: any) {
            const message = 'No se confirmó el pago. Revisá el historial antes de volver a intentar con el mismo botón.';
            setSupplierPaymentError(message);
            showToast({
                tone: 'error',
                title: e?.name === 'AbortError' ? 'La conexión tardó demasiado' : 'Error de conexión',
                message,
            });
        } finally {
            window.clearTimeout(timeoutId);
            setPaying(false);
        }
    };

    // ==========================================
    // INVOICE VIEW / PRINT
    // ==========================================

    const viewInvoice = (purchase: Purchase) => {
        setSelectedPurchase(purchase);
        setShowInvoiceModal(true);
    };

    const tenantName = (() => {
        try {
            const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
            return user.name || 'Mi Empresa';
        } catch { return 'Mi Empresa'; }
    })();

    const printInvoice = (format: 'ticket' | 'a4') => {
        if (!selectedPurchase) return;
        const p = selectedPurchase;
        const printedBalance = effectivePurchaseBalance(p);

        const itemsHTML = p.items.map(item => `
            <tr>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;font-size:${format === 'ticket' ? '11px' : '13px'}">${escapeHtml(item.productName)}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:center;font-size:${format === 'ticket' ? '11px' : '13px'}">${escapeHtml(formatQuantityValue(exactPurchaseQuantity(item)))} ${escapeHtml(item.unit || 'unidad')}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-size:${format === 'ticket' ? '11px' : '13px'}">${formatMoney(parseFloat(item.unitCost as any))}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold;font-size:${format === 'ticket' ? '11px' : '13px'}">${formatMoney(parseFloat(item.totalCost as any))}</td>
            </tr>
        `).join('');

        const isTicket = format === 'ticket';
        const width = isTicket ? '80mm' : '210mm';
        const fontFamily = isTicket ? 'monospace' : 'Arial, sans-serif';

        const html = `<!DOCTYPE html>
<html><head><title>Factura Compra #${escapeHtml(p.invoiceNumber)}</title>
<style>
    @page { size: ${isTicket ? '80mm auto' : 'A4'}; margin: ${isTicket ? '2mm' : '15mm'}; }
    body { font-family: ${fontFamily}; max-width: ${width}; margin: 0 auto; color: #333; }
    .header { text-align: center; padding-bottom: 8px; border-bottom: ${isTicket ? '1px dashed #000' : '2px solid #333'}; margin-bottom: 10px; }
    .title { font-size: ${isTicket ? '14px' : '22px'}; font-weight: bold; margin: 4px 0; }
    .subtitle { font-size: ${isTicket ? '10px' : '12px'}; color: #666; }
    .info { font-size: ${isTicket ? '11px' : '13px'}; margin: 8px 0; }
    .info-row { display: flex; justify-content: space-between; margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th { background: ${isTicket ? 'none' : '#f5f5f5'}; padding: 6px 8px; text-align: left; font-size: ${isTicket ? '10px' : '12px'}; border-bottom: ${isTicket ? '1px dashed #000' : '2px solid #333'}; text-transform: uppercase; }
    .totals { border-top: ${isTicket ? '1px dashed #000' : '2px solid #333'}; padding-top: 8px; margin-top: 8px; }
    .total-row { display: flex; justify-content: space-between; font-size: ${isTicket ? '12px' : '14px'}; margin: 3px 0; }
    .grand-total { font-size: ${isTicket ? '16px' : '20px'}; font-weight: bold; border-top: ${isTicket ? '1px dashed #000' : '2px solid #333'}; padding-top: 6px; margin-top: 6px; }
    .status { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: ${isTicket ? '10px' : '12px'}; font-weight: bold; }
    .paid { background: #d4edda; color: #155724; }
    .pending { background: #fff3cd; color: #856404; }
    .partial { background: #dbeafe; color: #1e40af; }
    .footer { text-align: center; margin-top: 15px; padding-top: 8px; border-top: ${isTicket ? '1px dashed #000' : '1px solid #ddd'}; font-size: ${isTicket ? '9px' : '11px'}; color: #999; }
    @media print { body { margin: 0; } }
</style></head><body>
    <div class="header">
        <div class="title">${isTicket ? '' : 'FACTURA DE COMPRA'}</div>
        <div class="title">${escapeHtml(tenantName)}</div>
        <div class="subtitle">Documento de Ingreso de Mercaderia</div>
    </div>

    <div class="info">
        <div class="info-row"><span><strong>Factura #:</strong></span><span>${escapeHtml(p.invoiceNumber)}</span></div>
        <div class="info-row"><span><strong>Proveedor:</strong></span><span>${escapeHtml(p.supplier.name)}</span></div>
        <div class="info-row"><span><strong>Fecha:</strong></span><span>${formatCalendarDateLong(p.date)}</span></div>
        ${p.dueDate ? `<div class="info-row"><span><strong>Vencimiento:</strong></span><span>${formatCalendarDateLong(p.dueDate)}</span></div>` : ''}
        <div class="info-row"><span><strong>Metodo:</strong></span><span>${escapeHtml(purchaseMethodLabel(p.paymentMethod))}</span></div>
        <div class="info-row"><span><strong>Estado:</strong></span><span class="status ${p.status === 'COMPLETED' ? 'paid' : p.status === 'PARTIALLY_PAID' ? 'partial' : 'pending'}">${escapeHtml(purchaseStatusLabel(p.status).toUpperCase())}</span></div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Producto</th>
                <th style="text-align:center">Cant.</th>
                <th style="text-align:right">C. Unit.</th>
                <th style="text-align:right">Total</th>
            </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
    </table>

    <div class="totals">
        <div class="total-row"><span>Subtotal:</span><span>${formatMoney(parseFloat(p.subtotal as any))}</span></div>
        <div class="total-row"><span>IVA (15%):</span><span>${formatMoney(parseFloat(p.tax as any))}</span></div>
        <div class="total-row grand-total"><span>TOTAL:</span><span>${formatMoney(parseFloat(p.total as any))}</span></div>
        ${!isNortexCapitalPurchase(p) && printedBalance.greaterThan(0) ? `<div class="total-row"><span>SALDO:</span><span>${formatMoney(printedBalance)}</span></div>` : ''}
    </div>

    ${p.notes ? `<div style="margin-top:10px;font-size:${isTicket ? '10px' : '12px'};color:#666"><strong>Notas:</strong> ${escapeHtml(p.notes)}</div>` : ''}

    <div class="footer">
        <p>Generado por NORTEX ERP | ${new Date().toLocaleString('es-NI')}</p>
    </div>
</body></html>`;

        const printWindow = window.open('', '_blank', `width=${isTicket ? 350 : 800},height=600`);
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => printWindow.print(), 300);
        } else {
            showToast({
                tone: 'warning',
                title: 'El navegador bloqueó la impresión',
                message: 'Permití las ventanas emergentes para imprimir esta factura.',
            });
        }
    };

    // ==========================================
    // COMPUTED
    // ==========================================

    const pendingPurchases = purchases.filter(p =>
        ['PENDING_PAYMENT', 'PARTIALLY_PAID'].includes(p.status)
        && !isNortexCapitalPurchase(p)
        && effectivePurchaseBalance(p).greaterThan(0)
    );
    const totalDebt = pendingPurchases.reduce(
        (sum, purchase) => sum.plus(effectivePurchaseBalance(purchase)),
        new Decimal(0),
    );
    const totalPurchasesMonth = purchases.reduce(
        (sum, purchase) => sum.plus(purchase.total),
        new Decimal(0),
    );
    const paymentPurchase = paymentToConfirm
        ? purchases.find(p => p.id === paymentToConfirm.id)
        : undefined;

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="nx-light-context nx-workspace h-full overflow-y-auto bg-slate-50 text-slate-950">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            {/* HEADER */}
            <div className="border-b border-slate-200 bg-white/90 px-4 py-5 backdrop-blur-xl sm:px-6 lg:px-8">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-control border border-emerald-200 bg-emerald-50 shadow-sm">
                            <Truck size={21} className="text-emerald-600" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="nx-module-header text-2xl font-semibold text-slate-950">Compras</h1>
                                <a href="/app/purchase-orders" className="nx-fluid-press inline-flex min-h-11 items-center rounded-control border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50">Órdenes de compra</a>
                            </div>
                            <p className="mt-0.5 text-sm text-slate-500">Ingreso de mercadería, conciliación y cuentas por pagar</p>
                        </div>
                    </div>

                    {/* KPI Cards */}
                    <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
                        <div className="nx-list-surface min-w-36 px-4 py-2 text-left">
                            <p className="text-xs font-medium text-slate-500">Compras del mes</p>
                            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-950">{loading ? '…' : formatCurrency(totalPurchasesMonth)}</p>
                        </div>
                        <div className={`min-w-36 rounded-card border px-4 py-2 text-left shadow-sm ${totalDebt.greaterThan(0) ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                            <p className="text-xs font-medium text-slate-500">Cuentas por pagar</p>
                            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${totalDebt.greaterThan(0) ? 'text-amber-700' : 'text-emerald-700'}`}>{loading ? '…' : formatCurrency(totalDebt)}</p>
                        </div>
                    </div>
                </div>

                {/* TABS */}
                <div className="mt-5 flex max-w-full w-fit gap-1 overflow-x-auto rounded-control border border-slate-200 bg-slate-100 p-1">
                    {canCreatePurchase && (
                        <button
                            type="button"
                            onClick={() => setActiveTab('new')}
                            aria-pressed={activeTab === 'new'}
                            className={`nx-fluid-press flex min-h-11 items-center gap-2 rounded-control px-4 py-2 text-sm font-medium ${activeTab === 'new' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'}`}
                        >
                            <Plus size={16} /> Nueva Compra
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setActiveTab('history')}
                        aria-pressed={activeTab === 'history'}
                        className={`nx-fluid-press flex min-h-11 items-center gap-2 rounded-control px-4 py-2 text-sm font-medium ${activeTab === 'history' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'}`}
                    >
                        <FileText size={16} /> Historial
                        {pendingPurchases.length > 0 && (
                            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pendingPurchases.length}</span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('matches')}
                        aria-pressed={activeTab === 'matches'}
                        className={`nx-fluid-press flex min-h-11 items-center gap-2 rounded-control px-4 py-2 text-sm font-medium ${activeTab === 'matches' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'}`}
                    >
                        <GitCompareArrows size={16} /> Conciliación
                        {purchases.some(purchase => purchase.paymentHold) && (
                            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-slate-950">
                                {purchases.filter(purchase => purchase.paymentHold).length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* CONTENT */}
            <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
                {activeTab === 'new' && Object.values(formErrors).some(Boolean) && (
                    <div role="alert" className="mb-4 flex items-start gap-3 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                        <AlertTriangle size={19} className="mt-0.5 shrink-0 text-red-600" />
                        <div>
                            <p className="font-semibold">Hay datos que necesitan tu atención</p>
                            <ul className="mt-1 list-disc pl-4 text-sm text-red-700">
                                {[...new Set(Object.values(formErrors).filter(Boolean))].map(message => (
                                    <li key={message}>{message}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
                {activeTab === 'matches' ? (
                    <section className="space-y-5" aria-labelledby="procurement-match-title">
                        <div className="nx-canvas-card flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <h2 id="procurement-match-title" className="nx-module-header flex items-center gap-2 text-lg font-semibold text-slate-950">
                                    <GitCompareArrows className="text-emerald-600" size={21} /> Conciliación de compras
                                </h2>
                                <p className="mt-1 max-w-2xl text-sm text-slate-500">
                                    Compará orden, recepción física y factura. Las diferencias abiertas retienen el pago hasta que una persona autorizada documente la decisión.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void loadMatches()}
                                disabled={matchesLoading}
                                className="nx-fluid-press inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                            >
                                <RotateCcw size={15} className={matchesLoading ? 'animate-spin' : ''} /> Actualizar
                            </button>
                        </div>

                        <div className="nx-list-surface grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-1">
                                <SlidersHorizontal size={17} className="text-slate-500" /> Filtros
                            </div>
                            <label className="space-y-1 text-xs font-semibold text-slate-600">
                                Estado
                                <select
                                    aria-label="Filtrar conciliaciones por estado"
                                    value={matchStatusFilter}
                                    onChange={event => setMatchStatusFilter(event.target.value as MatchStatus | 'ALL')}
                                    className="min-h-10 w-full rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                >
                                    <option value="ALL">Todos</option>
                                    <option value="EXCEPTION">Con diferencias</option>
                                    <option value="MATCHED">Conciliadas</option>
                                    <option value="RESOLVED">Resueltas</option>
                                    <option value="NOT_REQUIRED">No requeridas</option>
                                </select>
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-slate-600">
                                Pago
                                <select
                                    aria-label="Filtrar conciliaciones por retención"
                                    value={matchHoldFilter}
                                    onChange={event => setMatchHoldFilter(event.target.value as 'ALL' | 'true' | 'false')}
                                    className="min-h-10 w-full rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                >
                                    <option value="ALL">Todos</option>
                                    <option value="true">Retenido</option>
                                    <option value="false">Liberado</option>
                                </select>
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-slate-600">
                                Proveedor
                                <select
                                    aria-label="Filtrar conciliaciones por proveedor"
                                    value={matchSupplierFilter}
                                    onChange={event => setMatchSupplierFilter(event.target.value)}
                                    className="min-h-10 w-full rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                >
                                    <option value="">Todos</option>
                                    {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                                </select>
                            </label>
                        </div>

                        {matchDetailError && (
                            <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                <span>{matchDetailError}</span>
                                <button type="button" onClick={() => setMatchDetailError('')} className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control hover:bg-red-100" aria-label="Cerrar error"><X size={15} /></button>
                            </div>
                        )}

                        {matchesLoading && matches.length === 0 ? (
                            <div aria-label="Cargando conciliaciones" className="grid gap-3 lg:grid-cols-2">
                                {[0, 1, 2, 3].map(index => <div key={index} className="nx-list-surface h-40 animate-pulse bg-slate-100" />)}
                            </div>
                        ) : matchesError ? (
                            <div role="alert" className="rounded-card border border-red-200 bg-red-50 p-7 text-center text-red-800">
                                <AlertTriangle className="mx-auto text-red-600" size={30} />
                                <p className="mt-2 font-semibold">No pudimos cargar la conciliación</p>
                                <p className="mt-1 text-sm text-red-700">{matchesError}</p>
                                <button type="button" onClick={() => void loadMatches()} className="nx-fluid-press mt-4 min-h-11 rounded-control border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100">Reintentar</button>
                            </div>
                        ) : matches.length === 0 ? (
                            <div className="nx-list-surface p-12 text-center">
                                <Check className="mx-auto text-emerald-400" size={38} />
                                <p className="mt-3 font-semibold text-slate-950">No hay compras con estos filtros</p>
                                <p className="mt-1 text-sm text-slate-500">Probá otro estado o revisá las facturas nuevas más tarde.</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 lg:grid-cols-2">
                                {matches.map(match => (
                                    <article key={match.id} className="nx-list-surface p-4 transition-shadow hover:shadow-md">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-950">{match.supplier.name}</p>
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    Factura <span className="font-mono text-slate-700">#{match.invoiceNumber}</span>
                                                    {match.purchaseOrder ? ` · ${match.purchaseOrder.orderNumber}` : ' · Compra directa'}
                                                </p>
                                            </div>
                                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${matchStatusClass(match.matchStatus)}`}>
                                                {matchStatusLabel(match.matchStatus)}
                                            </span>
                                        </div>
                                        <div className="mt-4 grid grid-cols-3 gap-3 rounded-control bg-slate-50 p-3 text-sm">
                                            <div>
                                                <p className="text-[11px] text-slate-500">Factura</p>
                                                <p className="font-semibold tabular-nums text-slate-900">{formatCurrency(match.total)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-slate-500">Variación</p>
                                                <p className={`font-semibold tabular-nums ${new Decimal(match.varianceAmount || 0).isZero() ? 'text-emerald-700' : 'text-amber-700'}`}>{formatCurrency(match.varianceAmount || 0)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-slate-500">Diferencias</p>
                                                <p className="font-semibold text-slate-900">{match.openExceptionCount}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                            <div className={`flex items-center gap-1.5 text-xs font-semibold ${match.paymentHold ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                {match.paymentHold ? <LockKeyhole size={14} /> : <Check size={14} />}
                                                {match.paymentHold ? 'Pago retenido' : 'Pago liberado'}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void openMatchDetail(match.id)}
                                                    disabled={matchDetailLoadingId !== null}
                                                    className="nx-fluid-press min-h-11 rounded-control border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                                >
                                                    {matchDetailLoadingId === match.id ? 'Cargando…' : 'Ver diferencias'}
                                                </button>
                                                {canResolveMatches && match.matchStatus === 'EXCEPTION' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openMatchResolution(match)}
                                                        className="nx-fluid-press min-h-11 rounded-control bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
                                                    >
                                                        Resolver
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}

                        {matchesNextCursor && !matchesError && (
                            <div className="text-center">
                                <button type="button" onClick={() => void loadMatches(matchesNextCursor, true)} disabled={matchesLoading} className="nx-fluid-press min-h-11 rounded-control border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
                                    {matchesLoading ? 'Cargando…' : 'Cargar más'}
                                </button>
                            </div>
                        )}
                    </section>
                ) : activeTab === 'new' ? (
                    /* ==========================================
                       TAB: NUEVA COMPRA
                       ========================================== */
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                        {/* LEFT: Form + Product Search */}
                        <div className="space-y-4">
                            {/* Purchase Info */}
                            <div className="nx-canvas-card p-5 sm:p-6">
                                <h3 className="mb-5 flex items-center gap-2 font-semibold text-slate-950">
                                    <FileText size={18} className="text-emerald-600" />
                                    Datos de la compra
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="purchase-supplier" className="mb-1.5 block text-sm font-medium text-slate-700">Proveedor *</label>
                                        <select
                                            id="purchase-supplier"
                                            value={selectedSupplier}
                                            onChange={(e) => changeSupplier(e.target.value)}
                                            aria-invalid={Boolean(formErrors.supplierId)}
                                            className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 ${formErrors.supplierId ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                        >
                                            <option value="">{loading ? 'Cargando proveedores…' : suppliers.length === 0 ? 'Todavía no hay proveedores' : 'Seleccionar proveedor…'}</option>
                                            {suppliers.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                        {formErrors.supplierId && <p className="mt-1 text-xs text-red-600">{formErrors.supplierId}</p>}
                                        {!loading && suppliers.length === 0 && (
                                            <div className="mt-2 flex items-center justify-between gap-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                <span>Primero agregá a quien te vende.</span>
                                                <a href="/app/suppliers" className="shrink-0 font-semibold text-amber-800 underline decoration-amber-400 underline-offset-2 hover:text-amber-900">
                                                    Crear proveedor
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                    {!selectedPO && (
                                        <div>
                                            <label htmlFor="purchase-warehouse" className="mb-1.5 block text-sm font-medium text-slate-700">Bodega donde entrará la mercadería *</label>
                                            <select
                                                id="purchase-warehouse"
                                                value={selectedWarehouseId}
                                                onChange={(e) => {
                                                    setSelectedWarehouseId(e.target.value);
                                                    setFormErrors(current => ({ ...current, warehouseId: undefined }));
                                                }}
                                                aria-invalid={Boolean(formErrors.warehouseId)}
                                                required
                                                className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 ${formErrors.warehouseId ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                            >
                                                <option value="">{loading ? 'Cargando bodegas…' : 'Seleccionar bodega destino…'}</option>
                                                {warehouses.map(warehouse => (
                                                    <option key={warehouse.id} value={warehouse.id}>
                                                        {warehouse.name}{warehouse.isDefault ? ' · Principal' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="mt-1 text-xs text-slate-500">El stock se sumará solo en esta ubicación.</p>
                                            {formErrors.warehouseId && <p className="mt-1 text-xs text-red-600">{formErrors.warehouseId}</p>}
                                            {!loading && warehouses.length === 0 && (
                                                <p role="alert" className="mt-1 text-xs text-red-600">No hay una bodega activa disponible. Reintentá la carga antes de procesar el ingreso.</p>
                                            )}
                                        </div>
                                    )}
                                    {purchaseOrdersForSupplier.length > 0 && (
                                        <div>
                                            <label htmlFor="purchase-order-link" className="mb-1.5 block text-sm font-medium text-slate-700">Orden de compra (opcional)</label>
                                            <select
                                                id="purchase-order-link"
                                                value={selectedPO}
                                                onChange={(event) => linkPurchaseOrder(event.target.value)}
                                                className="min-h-11 w-full rounded-control border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                            >
                                                <option value="">Compra directa, sin OC</option>
                                                {purchaseOrdersForSupplier.map(po => (
                                                    <option key={po.id} value={po.id}>
                                                        {po.orderNumber} · {po.status === 'RECEIVED' ? 'Recibida' : po.status === 'PARTIALLY_RECEIVED' ? 'Recepción parcial' : 'Aprobada'}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div>
                                        <label htmlFor="purchase-invoice-number" className="mb-1.5 block text-sm font-medium text-slate-700"># Factura Proveedor *</label>
                                        <input
                                            id="purchase-invoice-number"
                                            value={invoiceNumber}
                                            onChange={(e) => {
                                                setInvoiceNumber(e.target.value);
                                                setFormErrors(current => ({ ...current, invoiceNumber: undefined }));
                                            }}
                                            placeholder="FAC-001234"
                                            aria-invalid={Boolean(formErrors.invoiceNumber)}
                                            className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 font-mono text-slate-900 outline-none focus:ring-2 ${formErrors.invoiceNumber ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                        />
                                        {formErrors.invoiceNumber && <p className="mt-1 text-xs text-red-600">{formErrors.invoiceNumber}</p>}
                                    </div>
                                    <div>
                                        <label htmlFor="purchase-invoice-date" className="mb-1.5 block text-sm font-medium text-slate-700">
                                            Fecha de la factura *
                                        </label>
                                        <input
                                            id="purchase-invoice-date"
                                            type="date"
                                            required
                                            value={purchaseDate}
                                            onChange={(event) => {
                                                setPurchaseDate(event.target.value);
                                                setFormErrors(current => ({ ...current, date: undefined }));
                                            }}
                                            aria-invalid={Boolean(formErrors.date)}
                                            aria-describedby={formErrors.date ? 'purchase-invoice-date-error' : undefined}
                                            className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 ${formErrors.date ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                        />
                                        {formErrors.date && (
                                            <p id="purchase-invoice-date-error" className="mt-1 text-xs text-red-600">
                                                {formErrors.date}
                                            </p>
                                        )}
                                    </div>
                                    {selectedPO && (
                                        <div className="col-span-2 flex items-start gap-2 rounded-control border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
                                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                            <span>
                                                Esta factura queda vinculada a la OC. La recepción maneja el stock y los lotes; aquí solo se registra el dinero y el IVA.
                                            </span>
                                        </div>
                                    )}
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-slate-700">Método de pago *</label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setPaymentMethod('CASH');
                                                    setDueDate('');
                                                    setFormErrors(current => ({ ...current, dueDate: undefined }));
                                                }}
                                                className={`nx-fluid-press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border px-3 py-2.5 text-sm font-medium ${paymentMethod === 'CASH'
                                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm'
                                                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                                            >
                                                <DollarSign size={16} /> Contado
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethod('CREDIT')}
                                                className={`nx-fluid-press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border px-3 py-2.5 text-sm font-medium ${paymentMethod === 'CREDIT'
                                                    ? 'border-amber-300 bg-amber-50 text-amber-700 shadow-sm'
                                                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                                            >
                                                <CreditCard size={16} /> Credito
                                            </button>
                                        </div>
                                    </div>
                                    {paymentMethod === 'CREDIT' && (
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-slate-700">Fecha de vencimiento *</label>
                                            <input
                                                type="date"
                                                value={dueDate}
                                                onChange={(e) => {
                                                    setDueDate(e.target.value);
                                                    setFormErrors(current => ({ ...current, dueDate: undefined }));
                                                }}
                                                aria-invalid={Boolean(formErrors.dueDate)}
                                                className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 ${formErrors.dueDate ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                            />
                                            {formErrors.dueDate && <p className="mt-1 text-xs text-red-600">{formErrors.dueDate}</p>}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4">
                                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Notas (opcional)</label>
                                    <input
                                        value={notes}
                                        onChange={(e) => {
                                            setNotes(e.target.value);
                                            setFormErrors(current => ({ ...current, notes: undefined }));
                                        }}
                                        placeholder="Ej: Pedido semanal, entrega parcial..."
                                        maxLength={500}
                                        aria-invalid={Boolean(formErrors.notes)}
                                        className={`min-h-11 w-full rounded-control border bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 ${formErrors.notes ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/15'}`}
                                    />
                                    {formErrors.notes && <p className="mt-1 text-xs text-red-600">{formErrors.notes}</p>}
                                </div>
                            </div>

                            {/* Product Search + Add */}
                            <div className={`nx-canvas-card p-5 sm:p-6 ${formErrors.items ? '!border-red-300' : ''}`}>
                                <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
                                    <Package size={18} className="text-emerald-600" />
                                    Productos recibidos
                                </h3>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        disabled={Boolean(selectedPO)}
                                        placeholder={selectedPO ? 'Los productos vienen de la orden de compra vinculada' : 'Buscar producto por nombre o SKU...'}
                                        className="min-h-11 w-full rounded-control border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                                    />
                                    {!selectedPO && filteredProducts.length > 0 && (
                                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-control border border-slate-200 bg-white shadow-xl">
                                            {filteredProducts.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => addToCart(p)}
                                                    className="nx-fluid-press flex min-h-12 w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 last:border-0"
                                                >
                                                    <div>
                                                        <span className="font-medium text-slate-950">{p.name}</span>
                                                        <span className="ml-2 font-mono text-xs text-slate-500">{p.sku}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-sm font-medium text-slate-700">Costo: {formatCurrency(p.cost)}</span>
                                                        <span className="text-xs text-slate-500 ml-2">Stock: {formatQuantityValue(p.stock)} {p.unit}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Cart Items Table */}
                                {cart.length > 0 && (
                                    <div className="mt-4 overflow-x-auto rounded-control border border-slate-200">
                                        <table className="min-w-[980px] w-full">
                                            <thead>
                                                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                                    <th className="text-left py-2 px-2">Producto</th>
                                                    <th className="text-center py-2 px-2 w-36">Cantidad recibida</th>
                                                    <th className="text-center py-2 px-2 w-40">Costo informado</th>
                                                    <th className="text-center py-2 px-2 w-52">Precio de venta</th>
                                                    <th className="text-right py-2 px-2 w-28">Total</th>
                                                    <th className="w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cart.map(item => {
                                                    let preview: ReturnType<typeof resolvePurchaseLine> | null = null;
                                                    try {
                                                        preview = resolveCartLine(item);
                                                    } catch {
                                                        // Mientras se edita un input puede estar temporalmente
                                                        // vacío/inválido; la validación visible lo reporta al enviar.
                                                    }
                                                    const inputStep = purchaseQuantityInputStep(item, item.purchaseUnit);
                                                    return (
                                                    <React.Fragment key={item.cartKey}>
                                                        <tr className="border-b border-slate-100 bg-white last:border-0">
                                                            <td className="py-3 px-2">
                                                                <div>
                                                                    <span className="text-sm font-medium text-slate-950">{item.productName}</span>
                                                                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                                                        <span className="text-xs text-slate-500 font-mono">{item.sku}</span>
                                                                        <span className="text-xs text-slate-500">Stock actual: {formatQuantityValue(item.currentStock)} {item.unit}</span>
                                                                    </div>
                                                                    {item.purchaseOrderItemId && (
                                                                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-4">
                                                                            <div><dt className="inline">Ordenado </dt><dd className="inline font-mono text-slate-700">{formatQuantityValue(item.orderedQuantity ?? '0')}</dd></div>
                                                                            <div><dt className="inline">Recibido </dt><dd className="inline font-mono text-slate-700">{formatQuantityValue(item.receivedQuantity ?? '0')}</dd></div>
                                                                            <div><dt className="inline">Facturado </dt><dd className="inline font-mono text-slate-700">{formatQuantityValue(item.invoicedQuantity ?? '0')}</dd></div>
                                                                            <div><dt className="inline">Disponible </dt><dd className="inline font-mono font-bold text-emerald-700">{formatQuantityValue(item.availableQuantity ?? '0')}</dd></div>
                                                                        </dl>
                                                                    )}
                                                                    {hasPackConfiguration(item) && (
                                                                        <select
                                                                            value={item.purchaseUnit}
                                                                            onChange={(event) => updatePurchaseUnit(item.cartKey, event.target.value as PurchaseUnit)}
                                                                            disabled={Boolean(selectedPO)}
                                                                            aria-label={`Unidad de compra de ${item.productName}`}
                                                                            className="mt-2 max-w-full rounded-control border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                                                                        >
                                                                            <option value="BASE">Base · {item.unit}</option>
                                                                            <option value="PACK">Empaque · {item.packUnit} ({formatQuantityValue(item.packSize!)} {item.unit})</option>
                                                                        </select>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateCartItem(item.cartKey, 'quantity', sanitizeDecimalInput(e.target.value))}
                                                                    aria-label={`Cantidad a facturar de ${item.productName}${item.purchaseOrderItemId ? ` · línea ${item.purchaseOrderItemId}` : ''}`}
                                                                    aria-invalid={Boolean(formErrors.items)}
                                                                    className="w-full rounded-control border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                                                />
                                                                <p className="mt-1 text-center text-[11px] text-slate-500">
                                                                    {item.purchaseUnit === 'PACK'
                                                                        ? preview
                                                                            ? `${formatQuantityValue(item.quantity)} ${item.packUnit} = ${formatQuantityValue(preview.baseQuantity)} ${item.unit}`
                                                                            : `${item.packUnit} de ${formatQuantityValue(item.packSize!)} ${item.unit}`
                                                                        : `en ${item.unit} · paso ${inputStep}`}
                                                                </p>
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    value={item.unitCost}
                                                                    onChange={(e) => updateCartItem(item.cartKey, 'unitCost', sanitizeDecimalInput(e.target.value))}
                                                                    aria-label={`Costo de ${item.productName}${item.purchaseOrderItemId ? ` · línea ${item.purchaseOrderItemId}` : ''}`}
                                                                    aria-invalid={Boolean(formErrors.items)}
                                                                    className="w-full rounded-control border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                                                />
                                                                <p className="mt-1 text-center text-[11px] text-slate-500">
                                                                    {item.purchaseUnit === 'PACK'
                                                                        ? preview
                                                                            ? `por ${item.packUnit} · ${formatCurrency(preview.baseUnitCost.toNumber())}/${item.unit}`
                                                                            : `costo por ${item.packUnit}`
                                                                        : `por ${item.unit}`}
                                                                </p>
                                                            </td>
                                                            <td className="py-3 px-2 align-top">
                                                                <p className="text-center text-xs text-slate-600">
                                                                    Actual:{' '}
                                                                    <span className="font-semibold tabular-nums text-slate-900">
                                                                        {item.currentSalePrice === null
                                                                            ? 'No disponible'
                                                                            : formatCurrency(item.currentSalePrice)}
                                                                    </span>
                                                                </p>
                                                                <p className="mt-0.5 text-center text-[11px] text-slate-500">
                                                                    por {item.unit} base
                                                                </p>
                                                                {canEditPurchaseSalePrice ? (
                                                                    <>
                                                                        <label
                                                                            htmlFor={`purchase-sale-price-${item.cartKey}`}
                                                                            className="mt-2 block text-xs font-medium text-slate-700"
                                                                        >
                                                                            Nuevo precio de venta (opcional)
                                                                        </label>
                                                                        <input
                                                                            id={`purchase-sale-price-${item.cartKey}`}
                                                                            type="text"
                                                                            inputMode="decimal"
                                                                            value={item.salePrice}
                                                                            onChange={(event) => updateCartItem(item.cartKey, 'salePrice', sanitizeDecimalInput(event.target.value))}
                                                                            aria-label={`Nuevo precio de venta (opcional) de ${item.productName}${item.purchaseOrderItemId ? ` · línea ${item.purchaseOrderItemId}` : ''}`}
                                                                            aria-invalid={Boolean(formErrors.items)}
                                                                            placeholder="Conservar actual"
                                                                            className="mt-1 min-h-11 w-full rounded-control border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                                                                        />
                                                                        <p className="mt-1 text-center text-[11px] text-slate-500">
                                                                            {cart.filter(candidate => candidate.productId === item.productId).length > 1
                                                                                ? 'Se sincroniza en todas las líneas de este producto.'
                                                                                : `Siempre por ${item.unit} base, aunque comprés por empaque.`}
                                                                        </p>
                                                                    </>
                                                                ) : (
                                                                    <p className="mt-2 rounded-control bg-slate-100 px-2 py-2 text-center text-[11px] text-slate-600">
                                                                        Solo un administrador puede cambiar el precio de venta.
                                                                    </p>
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-2 text-right">
                                                                <span className="text-sm font-semibold tabular-nums text-emerald-700">{formatCurrency(item.totalCost)}</span>
                                                            </td>
                                                            <td className="py-3 px-1">
                                                                <button
                                                                    onClick={() => removeFromCart(item.cartKey)}
                                                                    aria-label={`Quitar ${item.productName}`}
                                                                    className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-red-600 hover:bg-red-50"
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {item.requiresBatchTracking && (
                                                            <tr className="bg-slate-50">
                                                                <td colSpan={6} className="border-b border-slate-100 px-3 py-2">
                                                                    <div className="flex gap-4 items-center">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">REQUIERE LOTE</span>
                                                                        </div>
                                                                        <div className="flex-1 flex gap-3">
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Nº Lote"
                                                                                value={item.batchNumber || ''}
                                                                                onChange={(e) => updateCartItem(item.cartKey, 'batchNumber', e.target.value)}
                                                                                aria-invalid={Boolean(formErrors.items)}
                                                                                className="min-h-10 flex-1 rounded-control border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500"
                                                                            />
                                                                            <input
                                                                                type="date"
                                                                                value={item.expiryDate || ''}
                                                                                onChange={(e) => updateCartItem(item.cartKey, 'expiryDate', e.target.value)}
                                                                                aria-invalid={Boolean(formErrors.items)}
                                                                                className="min-h-10 flex-1 rounded-control border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {cart.length === 0 && (
                                    <div className="text-center py-8 text-slate-500">
                                        <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">Busca y agrega productos a la compra</p>
                                    </div>
                                )}
                                {formErrors.items && (
                                    <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
                                        <AlertTriangle size={15} /> {formErrors.items}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* RIGHT: Totals + Submit */}
                        <div className="space-y-4">
                            {/* Summary Card */}
                            <div className="nx-dark-context nx-ticket-surface sticky top-6 rounded-card border p-5 shadow-xl xl:p-6">
                                <h3 className="mb-5 flex items-center gap-2 font-semibold text-white">
                                    <Wallet size={18} className="text-emerald-400" />
                                    Resumen de compra
                                </h3>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Productos</span>
                                        <span className="text-white font-medium">{cart.length} línea{cart.length === 1 ? '' : 's'}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Subtotal</span>
                                        <span className="text-white">{formatCurrency(cartTotals.subtotal)}</span>
                                    </div>
                                    {cartTotals.taxableSubtotal !== cartTotals.subtotal && (
                                        <>
                                            <div className="flex justify-between text-xs">
                                                <span className="text-slate-500">Base gravada</span>
                                                <span className="text-slate-300">{formatCurrency(cartTotals.taxableSubtotal)}</span>
                                            </div>
                                            <div className="flex justify-between text-xs">
                                                <span className="text-slate-500">Productos exentos</span>
                                                <span className="text-slate-300">{formatCurrency(cartTotals.subtotal - cartTotals.taxableSubtotal)}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">IVA (15%)</span>
                                        <span className="text-white">{formatCurrency(cartTotals.tax)}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-white/10 pt-4">
                                        <span className="text-white font-bold text-lg">TOTAL</span>
                                        <span className="text-emerald-400 font-bold text-xl">{formatCurrency(cartTotals.total)}</span>
                                    </div>
                                </div>

                                {paymentMethod === 'CREDIT' && (
                                    <div className="mt-4 rounded-control border border-amber-400/20 bg-amber-400/10 p-3">
                                        <p className="text-xs text-amber-300 flex items-center gap-1.5">
                                            <Clock size={14} />
                                            Compra a crédito · No se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                {paymentMethod === 'CASH' && (
                                    <div className="mt-4 rounded-control border border-emerald-400/20 bg-emerald-400/10 p-3">
                                        <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                                            <DollarSign size={14} />
                                            Pago de contado · Se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || cart.length === 0 || !selectedSupplier || !invoiceNumber.trim() || (!selectedPO && !selectedWarehouseId) || (paymentMethod === 'CREDIT' && !dueDate)}
                                    aria-busy={submitting}
                                    className="nx-fluid-press nx-ticket-primary mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-emerald-500 py-3.5 text-base font-semibold text-white hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500"
                                >
                                    {submitting ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Procesando...
                                        </>
                                    ) : (
                                        <>
                                            <Truck size={20} />
                                            {selectedPO ? 'Registrar factura' : 'Procesar ingreso'}
                                        </>
                                    )}
                                </button>

                                <p className="text-xs text-slate-500 text-center mt-2">
                                    {selectedPO
                                        ? 'El stock se actualiza desde la recepción de la OC'
                                        : 'El stock se actualiza automáticamente'}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : loading ? (
                    <div aria-label="Cargando historial de compras" className="space-y-4">
                        <div className="nx-list-surface h-28 animate-pulse bg-slate-100" />
                        <div className="nx-list-surface h-72 animate-pulse bg-slate-100" />
                    </div>
                ) : (
                    /* ==========================================
                       TAB: HISTORIAL / CUENTAS POR PAGAR
                       ========================================== */
                    <div className="space-y-6">
                        {/* Pending Payments */}
                        {pendingPurchases.length > 0 && (
                            <div>
                                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
                                    <AlertTriangle size={18} className="text-amber-600" />
                                    Cuentas por Pagar ({pendingPurchases.length})
                                    <span className="ml-2 text-sm font-normal tabular-nums text-amber-700">
                                        Total: {formatCurrency(totalDebt)}
                                    </span>
                                </h3>
                                <div className="grid gap-3">
                                    {pendingPurchases.map(p => (
                                        <div key={p.id} className="flex flex-col gap-4 rounded-card border border-amber-200 bg-amber-50/70 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-amber-200 bg-white">
                                                    <Clock size={20} className="text-amber-600" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-950">{p.supplier.name}</p>
                                                    <p className="text-xs text-slate-500">
                                                        Factura #{p.invoiceNumber} | {formatCalendarDate(p.date)}
                                                        {p.dueDate && (
                                                            <span className="ml-2 text-amber-700">Vence: {formatCalendarDate(p.dueDate)}</span>
                                                        )}
                                                    </p>
                                                    {p.status === 'PARTIALLY_PAID' && <p className="mt-1 text-xs font-semibold text-sky-700">Ya tiene abonos registrados</p>}
                                                    {p.paymentHold && (
                                                        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                                                            <LockKeyhole size={12} /> Pago retenido hasta resolver la conciliación
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <div className="mr-1 text-right">
                                                    <p className="text-xs text-slate-500">Saldo pendiente</p>
                                                    <span className="text-xl font-semibold tabular-nums text-amber-700">{formatCurrency(effectivePurchaseBalance(p))}</span>
                                                    <p className="text-xs text-slate-500">de {formatCurrency(p.total)}</p>
                                                </div>
                                                <button
                                                    onClick={() => viewInvoice(p)}
                                                    className="nx-fluid-press flex min-h-11 items-center gap-1.5 rounded-control border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                                                    title="Ver Factura"
                                                >
                                                    <Eye size={15} /> Factura
                                                </button>
                                                {canAccessFiscalDocuments && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenRetention(p.id)}
                                                        disabled={openingRetentionId !== null}
                                                        className="nx-fluid-press flex min-h-11 items-center gap-1.5 rounded-control border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                        title="Constancia de Retención"
                                                    >
                                                        {openingRetentionId === p.id
                                                            ? <Loader2 size={15} className="animate-spin" />
                                                            : <Stamp size={15} />}
                                                        {openingRetentionId === p.id ? 'Generando…' : 'Retención'}
                                                    </button>
                                                )}
                                                {canPaySuppliers && !p.paymentHold && (
                                                    <button
                                                        onClick={() => handlePay(p)}
                                                        className="nx-fluid-press flex min-h-11 items-center gap-2 rounded-control bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
                                                    >
                                                        <DollarSign size={16} /> Abonar
                                                    </button>
                                                )}
                                                {canPaySuppliers && p.paymentHold && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('matches')}
                                                        className="nx-fluid-press flex min-h-11 items-center gap-2 rounded-control border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                                                    >
                                                        <GitCompareArrows size={16} /> Revisar diferencia
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Completed Purchases */}
                        <div>
                            <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
                                <Check size={18} className="text-emerald-600" />
                                Historial de compras ({purchases.length})
                            </h3>

                            {purchases.length === 0 ? (
                                <div className="nx-list-surface p-12 text-center">
                                    <Truck size={48} className="mx-auto mb-3 text-slate-300" />
                                    <p className="font-medium text-slate-700">No hay compras registradas</p>
                                    <p className="mt-1 text-xs text-slate-500">Registrá tu primera compra en “Nueva compra”.</p>
                                </div>
                            ) : (
                                <div className="nx-list-surface overflow-x-auto">
                                    <table className="min-w-[960px] w-full">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50">
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Fecha</th>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Proveedor</th>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase"># Factura</th>
                                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Items</th>
                                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Pago</th>
                                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Estado</th>
                                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">Total</th>
                                                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {purchases.map(p => (
                                                <tr key={p.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-sm text-slate-600">{formatCalendarDate(p.date)}</td>
                                                    <td className="px-4 py-3 text-sm font-medium text-slate-950">{p.supplier.name}</td>
                                                    <td className="px-4 py-3 font-mono text-sm text-slate-700">{p.invoiceNumber}</td>
                                                    <td className="px-4 py-3 text-center text-sm text-slate-500">{p.items.length} prod.</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`text-xs px-2 py-1 rounded-full ${p.paymentMethod === 'CASH'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : p.paymentMethod === 'NORTEX_CAPITAL'
                                                                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                                                : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                                            {p.paymentMethod === 'CASH' ? 'Contado' : p.paymentMethod === 'NORTEX_CAPITAL' ? 'Financiamiento Nortex' : 'Crédito'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'COMPLETED'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : p.status === 'PARTIALLY_PAID'
                                                                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                                                : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {purchaseStatusLabel(p.status)}
                                                        </span>
                                                        {p.paymentHold && (
                                                            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                                                <LockKeyhole size={11} /> Retenido
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                                                        {formatCurrency(p.total)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                onClick={() => viewInvoice(p)}
                                                                className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-sky-700 hover:bg-sky-50"
                                                                title="Ver Factura"
                                                                aria-label={`Ver factura ${p.invoiceNumber}`}
                                                            >
                                                                <Eye size={17} />
                                                            </button>
                                                            {canAccessFiscalDocuments && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenRetention(p.id)}
                                                                    disabled={openingRetentionId !== null}
                                                                    className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                                    title="Constancia de Retención"
                                                                    aria-label={`Abrir constancia de retención de la factura ${p.invoiceNumber}`}
                                                                >
                                                                    {openingRetentionId === p.id
                                                                        ? <Loader2 size={17} className="animate-spin" />
                                                                        : <Stamp size={17} />}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {selectedMatch && (
                <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setSelectedMatch(null)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="match-detail-title" className="nx-dark-context nx-ticket-surface max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-card border shadow-2xl" onClick={event => event.stopPropagation()}>
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-700 bg-slate-900/95 px-5 py-4 backdrop-blur">
                            <div>
                                <h2 id="match-detail-title" className="flex items-center gap-2 font-bold text-white">
                                    <GitCompareArrows size={20} className="text-emerald-400" /> Conciliación #{selectedMatch.purchase.invoiceNumber}
                                </h2>
                                <p className="mt-1 text-sm text-slate-400">
                                    {selectedMatch.purchase.supplier.name}{selectedMatch.purchase.purchaseOrder ? ` · ${selectedMatch.purchase.purchaseOrder.orderNumber}` : ''}
                                </p>
                            </div>
                            <button type="button" onClick={() => setSelectedMatch(null)} className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Cerrar detalle de conciliación"><X size={18} /></button>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
                                    <p className="text-xs text-slate-500">Esperado según OC</p>
                                    <p className="mt-1 text-lg font-bold text-white">{formatCurrency(selectedMatch.totals.expectedAmount)}</p>
                                </div>
                                <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
                                    <p className="text-xs text-slate-500">Factura recibida</p>
                                    <p className="mt-1 text-lg font-bold text-white">{formatCurrency(selectedMatch.totals.invoiceAmount)}</p>
                                </div>
                                <div className="rounded-xl border border-amber-800/60 bg-amber-950/25 p-3">
                                    <p className="text-xs text-amber-300/80">Variación</p>
                                    <p className="mt-1 text-lg font-bold text-amber-300">{formatCurrency(selectedMatch.totals.varianceAmount)}</p>
                                </div>
                            </div>

                            <section aria-labelledby="match-exceptions-title">
                                <h3 id="match-exceptions-title" className="text-sm font-bold uppercase tracking-wide text-slate-300">Diferencias detectadas</h3>
                                {selectedMatch.exceptions.length === 0 ? (
                                    <p className="mt-2 rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3 text-sm text-emerald-300">No quedan diferencias abiertas.</p>
                                ) : (
                                    <ul className="mt-2 space-y-2">
                                        {selectedMatch.exceptions.map(exception => (
                                            <li key={exception.id} className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-amber-200">{exceptionTypeLabel(exception.type)}</span>
                                                    <span className="rounded bg-amber-900/50 px-2 py-0.5 text-[11px] font-bold text-amber-300">{exception.status}</span>
                                                </div>
                                                <p className="mt-2 break-words font-mono text-xs text-slate-300">
                                                    Esperado: {exception.expectedValueExact ?? '—'} · Factura: {exception.actualValueExact ?? '—'} · Variación: {exception.varianceExact ?? '—'}
                                                </p>
                                                {exception.resolutionNote && <p className="mt-2 text-xs text-sky-300">Resolución: {exception.resolutionNote}</p>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <section aria-labelledby="match-lines-title">
                                <h3 id="match-lines-title" className="text-sm font-bold uppercase tracking-wide text-slate-300">Líneas de factura</h3>
                                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-700">
                                    <table className="min-w-[680px] w-full text-sm">
                                        <thead className="bg-slate-800/90 text-xs uppercase text-slate-400">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Producto</th>
                                                <th className="px-3 py-2 text-right">Cantidad</th>
                                                <th className="px-3 py-2 text-right">Costo OC</th>
                                                <th className="px-3 py-2 text-right">Costo factura</th>
                                                <th className="px-3 py-2 text-right">Variación</th>
                                                <th className="px-3 py-2 text-center">Recepciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {selectedMatch.lines.map(line => (
                                                <tr key={line.id} className="text-slate-300">
                                                    <td className="px-3 py-2 text-white">{line.productName}</td>
                                                    <td className="px-3 py-2 text-right font-mono">{formatQuantityValue(line.quantityExact)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">{line.expectedUnitCostExact === null ? '—' : formatCurrency(line.expectedUnitCostExact)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(line.unitCostExact)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-amber-300">{formatCurrency(line.priceVarianceExact ?? 0)}</td>
                                                    <td className="px-3 py-2 text-center">{line.allocations.length}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 bg-slate-800/40 px-5 py-4">
                            <p className={`flex items-center gap-1.5 text-sm font-semibold ${selectedMatch.purchase.paymentHold ? 'text-amber-300' : 'text-emerald-300'}`}>
                                {selectedMatch.purchase.paymentHold ? <LockKeyhole size={15} /> : <Check size={15} />}
                                {selectedMatch.purchase.paymentHold ? 'Pago retenido' : 'Pago liberado'}
                            </p>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setSelectedMatch(null)} className="nx-fluid-press min-h-11 rounded-control border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cerrar</button>
                                {canResolveMatches && selectedMatch.purchase.matchStatus === 'EXCEPTION' && (
                                    <button type="button" onClick={() => openMatchResolution(selectedMatch.purchase)} className="nx-fluid-press min-h-11 rounded-control bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400">Resolver diferencia</button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {matchResolution && (
                <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={closeMatchResolution}>
                    <div role="dialog" aria-modal="true" aria-labelledby="match-resolution-title" aria-describedby="match-resolution-description" aria-busy={resolvingMatch} className="nx-dark-context nx-ticket-surface max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-card border shadow-2xl" onClick={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
                            <div>
                                <h2 id="match-resolution-title" className="font-bold text-white">Resolver diferencia</h2>
                                <p className="mt-1 text-sm text-slate-400">Factura #{matchResolution.invoiceNumber}</p>
                            </div>
                            <button type="button" onClick={closeMatchResolution} disabled={resolvingMatch} className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-slate-400 hover:bg-slate-800 disabled:opacity-50" aria-label="Cancelar resolución"><X size={18} /></button>
                        </div>
                        <div className="space-y-4 p-5">
                            <p id="match-resolution-description" className="text-sm leading-6 text-slate-300">
                                Documentá por qué la diferencia es aceptable. Al confirmar se libera la retención de pago y queda evidencia auditable.
                            </p>
                            <label className="block space-y-1.5 text-sm font-semibold text-slate-300">
                                Motivo de la resolución
                                <textarea
                                    aria-label="Motivo de la resolución"
                                    rows={5}
                                    maxLength={1000}
                                    value={matchResolution.reason}
                                    onChange={event => {
                                        setMatchResolution(current => current ? { ...current, reason: event.target.value } : current);
                                        setMatchResolutionError('');
                                    }}
                                    placeholder="Ej: El proveedor notificó un ajuste de precio aprobado por gerencia…"
                                    className="w-full resize-y rounded-control border border-slate-600 bg-slate-800 px-3 py-2.5 font-normal text-white outline-none focus:border-emerald-500"
                                />
                            </label>
                            <p className="text-right text-xs text-slate-500">{matchResolution.reason.length}/1000</p>
                            {matchResolutionError && (
                                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{matchResolutionError}</p>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 border-t border-slate-700 px-5 py-4">
                            <button type="button" onClick={closeMatchResolution} disabled={resolvingMatch} className="nx-fluid-press min-h-11 rounded-control border border-slate-600 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Volver</button>
                            <button type="button" onClick={() => void resolveMatch()} disabled={resolvingMatch} className="nx-fluid-press inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-control bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                                {resolvingMatch && <Loader2 size={16} className="animate-spin" />}
                                {resolvingMatch ? 'Confirmando…' : 'Resolver y liberar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: CONFIRMAR PAGO
               ========================================== */}
            {paymentToConfirm && (
                <div
                    className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
                    onClick={closePaymentDialog}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirm-payment-title"
                        aria-describedby="confirm-payment-description"
                        aria-busy={paying}
                        className="nx-dark-context nx-ticket-surface max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-card border shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                                    <DollarSign size={21} />
                                </div>
                                <div>
                                    <h2 id="confirm-payment-title" className="font-semibold text-white">Registrar abono</h2>
                                    <p className="text-sm text-slate-400">Factura #{paymentToConfirm.invoiceNumber}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closePaymentDialog}
                                disabled={paying}
                                className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
                                aria-label="Cancelar pago"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-4 px-5 py-5">
                            <p id="confirm-payment-description" className="text-sm leading-6 text-slate-300">
                                Registrá un abono parcial o liquidá todo el saldo. El mismo intento se puede reintentar sin duplicar el pago.
                            </p>
                            {paymentPurchase && (
                                <div className="flex items-center justify-between rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3">
                                    <div>
                                        <p className="text-xs text-slate-400">Saldo pendiente</p>
                                        <p className="mt-0.5 text-xs text-slate-500">Total factura: {formatCurrency(paymentPurchase.total)}</p>
                                    </div>
                                    <span className="text-xl font-bold text-amber-300">{formatCurrency(effectivePurchaseBalance(paymentPurchase))}</span>
                                </div>
                            )}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="space-y-1.5 text-sm text-slate-300">
                                    Monto del abono
                                    <input
                                        aria-label="Monto del abono"
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={supplierPaymentForm.amount}
                                        onChange={(event) => {
                                            setSupplierPaymentForm(current => ({ ...current, amount: sanitizeDecimalInput(event.target.value) }));
                                            setSupplierPaymentError('');
                                        }}
                                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-500"
                                    />
                                </label>
                                <label className="space-y-1.5 text-sm text-slate-300">
                                    Método
                                    <select
                                        aria-label="Método del pago"
                                        value={supplierPaymentForm.method}
                                        onChange={(event) => setSupplierPaymentForm(current => ({ ...current, method: event.target.value as SupplierPaymentMethod }))}
                                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-500"
                                    >
                                        <option value="CASH">Efectivo</option>
                                        <option value="TRANSFER">Transferencia</option>
                                        <option value="CARD">Tarjeta</option>
                                        <option value="QR">QR</option>
                                    </select>
                                </label>
                            </div>
                            <label className="block space-y-1.5 text-sm text-slate-300">
                                Referencia (opcional)
                                <input
                                    aria-label="Referencia del pago"
                                    value={supplierPaymentForm.reference}
                                    onChange={(event) => setSupplierPaymentForm(current => ({ ...current, reference: event.target.value }))}
                                    placeholder="Número de transferencia o comprobante"
                                    className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-500"
                                />
                            </label>
                            <label className="block space-y-1.5 text-sm text-slate-300">
                                Notas (opcional)
                                <textarea
                                    aria-label="Notas del pago"
                                    rows={2}
                                    value={supplierPaymentForm.notes}
                                    onChange={(event) => setSupplierPaymentForm(current => ({ ...current, notes: event.target.value }))}
                                    className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-500"
                                />
                            </label>
                            <p className="text-xs text-slate-500">
                                {supplierPaymentForm.method === 'CASH'
                                    ? 'El efectivo se descontará de caja.'
                                    : 'El pago se registrará contra la cuenta bancaria, sin descontar efectivo de caja.'}
                            </p>
                            {supplierPaymentError && (
                                <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                                    {supplierPaymentError}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-700 px-5 py-4">
                            <button
                                type="button"
                                onClick={closePaymentDialog}
                                disabled={paying}
                                className="nx-fluid-press min-h-11 rounded-control border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmPayment(true)}
                                disabled={paying}
                                className="nx-fluid-press min-h-11 rounded-control border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60"
                            >
                                Liquidar todo
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmPayment(false)}
                                disabled={paying}
                                aria-busy={paying}
                                className="nx-fluid-press flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-control bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                            >
                                {paying && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                {paying ? 'Registrando…' : 'Registrar abono'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL: VISTA PREVIA DE FACTURA
               ========================================== */}
            {showInvoiceModal && selectedPurchase && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowInvoiceModal(false)}>
                    <div className="nx-light-context nx-canvas-card max-h-[90vh] w-full max-w-3xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                            <div>
                                <h2 className="nx-module-header flex items-center gap-2 text-xl font-semibold text-slate-950">
                                    <FileText size={20} className="text-emerald-600" />
                                    Factura de Compra #{selectedPurchase.invoiceNumber}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    {selectedPurchase.supplier.name} | {formatCalendarDate(selectedPurchase.date)}
                                </p>
                            </div>
                            <button onClick={() => setShowInvoiceModal(false)} className="nx-fluid-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-950" aria-label="Cerrar factura">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Invoice Preview */}
                        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                            {/* Company + Supplier Info */}
                            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                                <div>
                                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Comprador</p>
                                    <p className="text-lg font-semibold text-slate-950">{tenantName}</p>
                                </div>
                                <div className="sm:text-right">
                                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Proveedor</p>
                                    <p className="text-lg font-semibold text-slate-950">{selectedPurchase.supplier.name}</p>
                                </div>
                            </div>

                            {/* Invoice Details */}
                            <div className="mb-6 grid grid-cols-2 gap-4 rounded-control border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
                                <div>
                                    <p className="text-xs text-slate-500">Factura #</p>
                                    <p className="font-mono font-semibold text-slate-950">{selectedPurchase.invoiceNumber}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Fecha</p>
                                    <p className="text-slate-900">{formatCalendarDate(selectedPurchase.date)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Método</p>
                                    <p className={selectedPurchase.paymentMethod === 'CASH' ? 'text-emerald-700' : selectedPurchase.paymentMethod === 'NORTEX_CAPITAL' ? 'text-sky-700' : 'text-amber-700'}>
                                        {purchaseMethodLabel(selectedPurchase.paymentMethod)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Estado</p>
                                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${selectedPurchase.status === 'COMPLETED'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : selectedPurchase.status === 'PARTIALLY_PAID'
                                            ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                        {purchaseStatusLabel(selectedPurchase.status).toUpperCase()}
                                    </span>
                                </div>
                            </div>

                            <div className="mb-6 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                                    Documento: {selectedPurchase.documentStatus === 'POSTED' ? 'Contabilizado' : selectedPurchase.documentStatus || 'Histórico'}
                                </span>
                                {selectedPurchase.matchStatus && (
                                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${matchStatusClass(selectedPurchase.matchStatus)}`}>
                                        {matchStatusLabel(selectedPurchase.matchStatus)}
                                    </span>
                                )}
                                {selectedPurchase.paymentHold && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                        <LockKeyhole size={12} /> Pago retenido
                                    </span>
                                )}
                                {selectedPurchase.postingDate && selectedPurchase.postingDate !== selectedPurchase.date && (
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                                        Fecha contable: {formatCalendarDate(selectedPurchase.postingDate)}
                                    </span>
                                )}
                            </div>

                            {selectedPurchase.dueDate && (
                                <div className="mb-6 flex items-center gap-2 rounded-control border border-amber-200 bg-amber-50 p-3">
                                    <Calendar size={16} className="text-amber-600" />
                                    <span className="text-sm text-amber-700">Vencimiento: {formatCalendarDate(selectedPurchase.dueDate)}</span>
                                </div>
                            )}

                            {/* Items Table */}
                            <div className="mb-6 overflow-x-auto rounded-control border border-slate-200">
                            <table className="min-w-[600px] w-full">
                                <thead>
                                    <tr className="border-b-2 border-slate-200 bg-slate-50">
                                        <th className="text-left py-2 px-3 text-xs text-slate-400 uppercase">Producto</th>
                                        <th className="text-center py-2 px-3 text-xs text-slate-400 uppercase">Cantidad</th>
                                        <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">Costo Unit.</th>
                                        <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedPurchase.items.map((item, idx) => (
                                        <tr key={idx} className="border-b border-slate-100">
                                            <td className="px-3 py-3 text-slate-950">{item.productName}</td>
                                            <td className="px-3 py-3 text-center text-slate-700">
                                                {formatQuantityValue(exactPurchaseQuantity(item))} {item.unit || 'unidad'}
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">{formatCurrency(parseFloat(item.unitCost as any))}</td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-950">{formatCurrency(parseFloat(item.totalCost as any))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>

                            {/* Totals */}
                            <div className="space-y-2 border-t-2 border-slate-200 pt-4">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Subtotal</span>
                                    <span className="text-slate-950">{formatCurrency(parseFloat(selectedPurchase.subtotal as any))}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">IVA (15%)</span>
                                    <span className="text-slate-950">{formatCurrency(parseFloat(selectedPurchase.tax as any))}</span>
                                </div>
                                <div className="flex justify-between border-t border-slate-200 pt-3 text-xl font-semibold">
                                    <span className="text-slate-950">TOTAL</span>
                                    <span className="text-emerald-700">{formatCurrency(parseFloat(selectedPurchase.total as any))}</span>
                                </div>
                                {!isNortexCapitalPurchase(selectedPurchase) && effectivePurchaseBalance(selectedPurchase).greaterThan(0) && (
                                    <div className="flex justify-between text-base font-semibold text-amber-700">
                                        <span>SALDO PENDIENTE</span>
                                        <span>{formatCurrency(effectivePurchaseBalance(selectedPurchase))}</span>
                                    </div>
                                )}
                            </div>

                            {selectedPurchase.notes && (
                                <div className="mt-4 rounded-control bg-slate-50 p-3">
                                    <p className="text-xs text-slate-500 mb-1">Notas:</p>
                                    <p className="text-sm text-slate-700">{selectedPurchase.notes}</p>
                                </div>
                            )}
                        </div>

                        {/* Footer - Print Buttons */}
                        <div className="flex flex-col items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center">
                            <p className="text-xs text-slate-500">Generado por NORTEX ERP</p>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    onClick={() => printInvoice('ticket')}
                                    className="nx-fluid-press flex min-h-11 items-center gap-2 rounded-control border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    <Printer size={16} /> Ticket 80mm
                                </button>
                                <button
                                    onClick={() => printInvoice('a4')}
                                    className="nx-fluid-press flex min-h-11 items-center gap-2 rounded-control bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                                >
                                    <Printer size={16} /> Factura A4
                                </button>
                                {canAccessFiscalDocuments && (
                                    <button
                                        type="button"
                                        onClick={() => handleOpenRetention(selectedPurchase.id)}
                                        disabled={openingRetentionId !== null}
                                        className="nx-fluid-press flex min-h-11 items-center gap-2 rounded-control bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {openingRetentionId === selectedPurchase.id
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : <Stamp size={16} />}
                                        {openingRetentionId === selectedPurchase.id ? 'Generando…' : 'Constancia DGI'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
