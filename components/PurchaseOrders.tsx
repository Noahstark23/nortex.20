import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, CheckCircle, ChevronDown, ChevronUp, ClipboardList,
    History, PackageCheck, Plus, RefreshCw, X, XCircle,
} from 'lucide-react';
import Decimal from 'decimal.js';
import { formatMoney, sanitizeDecimalInput } from '../utils/money';
import { formatQuantityValue, validateNonNegativeQuantity, validateQuantity } from '../utils/quantity';
import {
    orderedQuantityForItem,
    purchaseOrderRulesForProduct,
    purchaseOrderRulesForReceipt,
    receivedQuantityForItem,
    sanitizePurchaseQuantityInput,
} from '../utils/purchaseOrderQuantities';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';

/** Órdenes de Compra: DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED/CLOSED_SHORT. */
interface POItem {
    id: string;
    productId: string;
    productName: string;
    quantityOrdered: string | number;
    quantityReceived: string | number;
    quantityOrderedExact?: string | number | null;
    quantityReceivedExact?: string | number | null;
    quantityRejectedExact?: string | number | null;
    quantityClosedShortExact?: string | number | null;
    unitAtOrder?: string | null;
    saleModeAtOrder?: string | null;
    quantityStepAtOrder?: string | number | null;
    unitCost: string | number;
    product?: {
        requiresBatchTracking: boolean;
        unit: string;
        saleMode: string | null;
        quantityStep: string | number | null;
    };
}

interface PO {
    id: string;
    orderNumber: string;
    status: string;
    notes?: string | null;
    createdAt: string;
    supplier: { name: string };
    items: POItem[];
    goodsReceipts?: GoodsReceipt[];
    closeShorts?: PurchaseOrderCloseShort[];
}

interface GoodsReceiptItem {
    id: string;
    purchaseOrderItemId: string;
    productId: string;
    quantityExact: string;
    deliveredQuantityExact?: string | null;
    rejectedQuantityExact?: string | null;
    rejectionReasonCode?: InspectionReasonCode | null;
    rejectionNotes?: string | null;
    supplierFault?: boolean | null;
    unitSnapshot: string;
    saleModeSnapshot?: string | null;
    unitCostExact?: string;
    batchId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
}

interface GoodsReceipt {
    id: string;
    purchaseOrderId: string;
    warehouseId: string;
    receiptNumber: string;
    status: string;
    supplierDeliveryRef?: string | null;
    clientEventId?: string;
    payloadVersion?: number;
    inspectionOutcome?: InspectionOutcome;
    inspectedLineCount?: number;
    rejectedLineCount?: number;
    hasSupplierFault?: boolean;
    receivedBy: string;
    receivedAt: string;
    createdAt: string;
    warehouse?: { id: string; name: string };
    receiver?: { id: string; name: string };
    items?: GoodsReceiptItem[];
}

type InspectionReasonCode = 'DAMAGE' | 'EXPIRED' | 'SHORTAGE' | 'QUALITY' | 'DOC_MISMATCH' | 'OTHER';
type InspectionOutcome = 'FULL_ACCEPT' | 'PARTIAL_REJECT' | 'FULL_REJECT';
type CloseShortReasonCode = 'SUPPLIER_SHORTAGE' | 'DISCONTINUED' | 'DELIVERY_CANCELLED' | 'QUALITY_REJECTION' | 'OTHER';

interface PurchaseOrderCloseShortItem {
    id: string;
    purchaseOrderItemId: string;
    quantityExact: string;
    reasonCode: CloseShortReasonCode;
    supplierFault?: boolean | null;
    note?: string | null;
    unitSnapshot?: string;
}

interface PurchaseOrderCloseShort {
    id: string;
    purchaseOrderId: string;
    status: string;
    clientEventId?: string;
    closedBy?: string;
    closedAt: string;
    createdAt?: string;
    lineCount?: number;
    closedLineCount?: number;
    hasSupplierFault?: boolean;
    reasonSummaryCode?: CloseShortReasonCode | null;
    note?: string | null;
    creator?: { id: string; name: string };
    items?: PurchaseOrderCloseShortItem[];
}

interface Supplier { id: string; name: string; }
interface ProductLite {
    id: string;
    name: string;
    sku: string;
    cost: number;
    unit: string;
    saleMode: string | null;
    quantityStep: string | number | null;
}
interface PORow extends ProductLite { quantity: string; unitCost: string; }
interface ReceiptDraft {
    quantity: string;
    quantityRejected: string;
    rejectionReasonCode: '' | InspectionReasonCode;
    rejectionNotes: string;
    supplierFault: '' | 'true' | 'false';
    batchNumber: string;
    expiryDate: string;
}
interface CloseShortDraft {
    reasonCode: '' | CloseShortReasonCode;
    supplierFault: '' | 'true' | 'false';
    note: string;
}
interface WarehouseOption { id: string; name: string; isDefault: boolean; isActive: boolean; }

/** Una sola bodega puede preseleccionarse; con dos o más decide la persona. */
export const soleActiveReceiptWarehouseId = (warehouses: WarehouseOption[]): string => {
    const active = warehouses.filter(warehouse => warehouse.isActive);
    return active.length === 1 ? active[0].id : '';
};

const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

const requestWithTimeout = async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        window.clearTimeout(timeoutId);
    }
};

const BADGE: Record<string, string> = {
    DRAFT: 'bg-slate-500/20 text-slate-300',
    APPROVED: 'bg-blue-500/20 text-blue-400',
    PARTIALLY_RECEIVED: 'bg-amber-500/20 text-amber-400',
    RECEIVED: 'bg-emerald-500/20 text-emerald-400',
    CLOSED_SHORT: 'bg-orange-500/20 text-orange-300',
    CANCELLED: 'bg-red-500/20 text-red-400',
};

const LABEL: Record<string, string> = {
    DRAFT: 'BORRADOR',
    APPROVED: 'APROBADA',
    PARTIALLY_RECEIVED: 'PARCIAL',
    RECEIVED: 'RECIBIDA',
    CLOSED_SHORT: 'CERRADA CON FALTANTE',
    CANCELLED: 'CANCELADA',
};

const INSPECTION_REASON_LABEL: Record<InspectionReasonCode, string> = {
    DAMAGE: 'Daño',
    EXPIRED: 'Vencido',
    SHORTAGE: 'Faltante',
    QUALITY: 'Calidad',
    DOC_MISMATCH: 'Documento no coincide',
    OTHER: 'Otro',
};

const INSPECTION_REASON_OPTIONS = Object.entries(INSPECTION_REASON_LABEL) as Array<[InspectionReasonCode, string]>;

const CLOSE_SHORT_REASON_LABEL: Record<CloseShortReasonCode, string> = {
    SUPPLIER_SHORTAGE: 'Faltante del proveedor',
    DISCONTINUED: 'Producto descontinuado',
    DELIVERY_CANCELLED: 'Entrega cancelada',
    QUALITY_REJECTION: 'Rechazo de calidad',
    OTHER: 'Otro',
};

const CLOSE_SHORT_REASON_OPTIONS = Object.entries(CLOSE_SHORT_REASON_LABEL) as Array<[CloseShortReasonCode, string]>;

const INSPECTION_OUTCOME_LABEL: Record<InspectionOutcome, string> = {
    FULL_ACCEPT: 'Aceptación total',
    PARTIAL_REJECT: 'Aceptación con rechazo',
    FULL_REJECT: 'Rechazo total',
};

const emptyReceipt = (): ReceiptDraft => ({
    quantity: '',
    quantityRejected: '',
    rejectionReasonCode: '',
    rejectionNotes: '',
    supplierFault: '',
    batchNumber: '',
    expiryDate: '',
});

const emptyCloseShortDraft = (): CloseShortDraft => ({ reasonCode: '', supplierFault: '', note: '' });

const decimalOrZero = (value: string | number | null | undefined): Decimal => {
    try {
        const parsed = new Decimal(value ?? 0);
        return parsed.isFinite() && !parsed.isNegative() ? parsed : new Decimal(0);
    } catch {
        return new Decimal(0);
    }
};

const rejectedQuantityForItem = (item: POItem): Decimal => decimalOrZero(item.quantityRejectedExact);
const closedShortQuantityForItem = (item: POItem): Decimal => decimalOrZero(item.quantityClosedShortExact);

/** El rechazo informa la inspección, pero no consume el remanente: el proveedor puede reentregar. */
export const openPurchaseOrderQuantityForItem = (item: POItem): Decimal => Decimal.max(
    orderedQuantityForItem(item)
        .minus(receivedQuantityForItem(item))
        .minus(closedShortQuantityForItem(item)),
    0,
);

const newReceiptClientEventId = (): string => {
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

const formatReceiptDate = (value: string): string => new Date(value).toLocaleString('es-NI', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Managua',
});

const isValidCost = (value: string): boolean => {
    try {
        const parsed = new Decimal(value);
        return parsed.isFinite() && !parsed.isNegative() && parsed.decimalPlaces() <= 6;
    } catch {
        return false;
    }
};

const receiptRules = (item: POItem) => purchaseOrderRulesForReceipt(
    item,
    {
        id: item.productId,
        name: item.productName,
        unit: item.product?.unit || item.unitAtOrder || 'unidad',
        saleMode: item.product?.saleMode ?? null,
        quantityStep: item.product?.quantityStep ?? null,
    },
);

const PurchaseOrders: React.FC = () => {
    const {
        isBodeguero,
        canManagePurchaseOrders,
        canReceivePurchaseOrders,
    } = roleCapabilitiesFor(currentSessionRole());
    const [orders, setOrders] = useState<PO[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [ordersError, setOrdersError] = useState('');
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [receiving, setReceiving] = useState<PO | null>(null);
    const [closingShort, setClosingShort] = useState<PO | null>(null);
    const [cancelToConfirm, setCancelToConfirm] = useState<PO | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const [supplierId, setSupplierId] = useState('');
    const [rows, setRows] = useState<PORow[]>([]);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<ProductLite[]>([]);
    const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
    const [receiptWarehouses, setReceiptWarehouses] = useState<WarehouseOption[]>([]);
    const [receiptWarehouseId, setReceiptWarehouseId] = useState('');
    const [receiptWarehousesLoading, setReceiptWarehousesLoading] = useState(false);
    const [receiptWarehouseError, setReceiptWarehouseError] = useState('');
    const [receiptClientEventId, setReceiptClientEventId] = useState('');
    const [supplierDeliveryRef, setSupplierDeliveryRef] = useState('');
    const [closeShortClientEventId, setCloseShortClientEventId] = useState('');
    const [closeShortReasonSummaryCode, setCloseShortReasonSummaryCode] = useState<'' | CloseShortReasonCode>('');
    const [closeShortNote, setCloseShortNote] = useState('');
    const [closeShortDrafts, setCloseShortDrafts] = useState<Record<string, CloseShortDraft>>({});
    const [closeShortAcknowledged, setCloseShortAcknowledged] = useState(false);
    const [closeShortError, setCloseShortError] = useState('');
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
    const [detailError, setDetailError] = useState('');
    const [lastReceiptNotice, setLastReceiptNotice] = useState<{ receiptNumber: string; replay: boolean } | null>(null);
    const [lastCloseShortNotice, setLastCloseShortNotice] = useState<{ orderNumber: string; replay: boolean } | null>(null);
    const { toast, showToast, dismissToast } = useToast();

    const load = useCallback(async () => {
        setOrdersLoading(true);
        setOrdersError('');
        try {
            const response = await requestWithTimeout('/api/purchase-orders', { headers: headers() });
            const data: any = await response.json().catch(() => ({}));
            if (response.ok) setOrders(Array.isArray(data.data) ? data.data : []);
            else {
                const message = data.error || 'El servidor no pudo cargar las órdenes.';
                setOrdersError(message);
                showToast({ tone: 'error', title: 'No se pudieron cargar las órdenes', message });
            }
        } catch {
            setOrdersError('Revisá tu conexión y volvé a intentar.');
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No pudimos cargar las órdenes de compra.' });
        } finally {
            setOrdersLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        void load();
        if (!canManagePurchaseOrders) return;
        void requestWithTimeout('/api/suppliers', { headers: headers() })
            .then(async response => {
                const data: any = await response.json().catch(() => []);
                if (response.ok) setSuppliers(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                showToast({ tone: 'error', title: 'No se cargaron los proveedores', message: 'Revisá tu conexión e intentá de nuevo.' });
            });
    }, [canManagePurchaseOrders, load, showToast]);

    const searchProducts = async (query: string) => {
        setSearch(query);
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }

        try {
            const response = await requestWithTimeout(
                `/api/products?search=${encodeURIComponent(query)}&page=1&pageSize=8`,
                { headers: headers() },
            );
            if (!response.ok) return;
            const data: any = await response.json();
            setResults(Array.isArray(data) ? data : Array.isArray(data.products) ? data.products : []);
        } catch {
            setResults([]);
        }
    };

    const createPO = async () => {
        if (!supplierId || rows.length === 0) {
            showToast({ tone: 'warning', title: 'Faltan datos', message: 'Seleccioná un proveedor y agregá al menos un producto.' });
            return;
        }

        const invalidRow = rows.find(row => {
            try {
                validateQuantity(row.quantity, purchaseOrderRulesForProduct(row));
                return !isValidCost(row.unitCost);
            } catch {
                return true;
            }
        });
        if (invalidRow) {
            showToast({ tone: 'warning', title: 'Revisá los productos', message: 'Las cantidades deben ser mayores que cero y los costos no pueden ser negativos.' });
            return;
        }
        const items = rows.map(row => ({
            productId: row.id,
            // Se envían strings: el servidor valida Decimal y nunca recibe un
            // Number ya redondeado por IEEE-754.
            quantity: row.quantity,
            unitCost: row.unitCost,
        }));

        setBusy('create');
        try {
            const response = await requestWithTimeout('/api/purchase-orders', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ supplierId, items }),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast({ tone: 'error', title: 'No se pudo crear la orden', message: data.error || `El servidor respondió ${response.status}.` });
                return;
            }

            setShowCreate(false);
            setRows([]);
            setSupplierId('');
            showToast({ tone: 'success', title: 'Borrador creado', message: 'La orden ya está lista para revisión y aprobación.' });
            void load();
        } catch (error: any) {
            showToast({
                tone: 'error',
                title: error?.name === 'AbortError' ? 'La conexión tardó demasiado' : 'Error de conexión',
                message: 'Conservamos los datos para que podás volver a intentar.',
            });
        } finally {
            setBusy(null);
        }
    };

    const act = async (po: PO, action: 'approve' | 'cancel') => {
        if (busy) return;
        setBusy(po.id);
        try {
            const response = await requestWithTimeout(`/api/purchase-orders/${po.id}/${action}`, {
                method: 'POST',
                headers: headers(),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast({ tone: 'error', title: 'No se pudo actualizar la orden', message: data.error || `El servidor respondió ${response.status}.` });
                return;
            }

            showToast({
                tone: 'success',
                title: action === 'approve' ? 'Orden aprobada' : 'Orden cancelada',
                message: po.orderNumber,
            });
            setCancelToConfirm(null);
            void load();
        } catch {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'La orden no fue actualizada.' });
        } finally {
            setBusy(null);
        }
    };

    const loadReceiptWarehouses = async () => {
        setReceiptWarehousesLoading(true);
        setReceiptWarehouseError('');
        setReceiptWarehouses([]);
        setReceiptWarehouseId('');
        try {
            const response = await requestWithTimeout('/api/warehouses', { headers: headers() });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                setReceiptWarehouseError(data.error || 'No se pudieron cargar las bodegas activas.');
                return;
            }

            const available = (Array.isArray(data.data) ? data.data : [])
                .filter((warehouse: WarehouseOption) => warehouse.isActive);
            setReceiptWarehouses(available);
            setReceiptWarehouseId(soleActiveReceiptWarehouseId(available));
            if (available.length === 0) {
                setReceiptWarehouseError('No hay una bodega activa. Pedile a un administrador que active una.');
            }
        } catch {
            setReceiptWarehouseError('No pudimos cargar las bodegas. Revisá tu conexión e intentá de nuevo.');
        } finally {
            setReceiptWarehousesLoading(false);
        }
    };

    const closeReceipt = () => {
        setReceiving(null);
        setReceiptDrafts({});
        setReceiptWarehouseId('');
        setReceiptWarehouses([]);
        setReceiptWarehouseError('');
        setReceiptClientEventId('');
        setSupplierDeliveryRef('');
    };

    const openReceipt = (po: PO) => {
        setReceiving(po);
        // El UUID nace al abrir y sobrevive todos los reintentos de este diálogo.
        setReceiptClientEventId(newReceiptClientEventId());
        setSupplierDeliveryRef('');
        setReceiptDrafts(Object.fromEntries(
            po.items.map(item => [item.id, emptyReceipt()]),
        ) as Record<string, ReceiptDraft>);
        void loadReceiptWarehouses();
    };

    const toggleReceiptTimeline = async (po: PO, forceReload = false) => {
        if (expandedOrderId === po.id && !forceReload) {
            setExpandedOrderId(null);
            setDetailError('');
            return;
        }

        setExpandedOrderId(po.id);
        setDetailError('');
        setDetailLoadingId(po.id);
        try {
            const response = await requestWithTimeout(`/api/purchase-orders/${po.id}`, { headers: headers() });
            const payload: any = await response.json().catch(() => ({}));
            if (!response.ok || !payload.data) {
                setDetailError(payload.error || 'No se pudo cargar el historial de recepciones.');
                return;
            }
            setOrders(current => current.map(order => order.id === po.id ? { ...order, ...payload.data } : order));
        } catch {
            setDetailError('No pudimos cargar el historial. Revisá tu conexión y reintentá.');
        } finally {
            setDetailLoadingId(null);
        }
    };

    const updateReceipt = (itemId: string, patch: Partial<ReceiptDraft>) => {
        setReceiptDrafts(current => ({
            ...current,
            [itemId]: { ...emptyReceipt(), ...current[itemId], ...patch },
        }));
    };

    const receive = async () => {
        if (!receiving || busy) return;
        setReceiptWarehouseError('');

        if (!receiptWarehouseId) {
            setReceiptWarehouseError('Seleccioná la bodega donde ingresará esta mercadería.');
            return;
        }

        const items: Array<{
            itemId: string;
            quantityReceived: string;
            quantityRejected?: string;
            rejectionReasonCode?: InspectionReasonCode;
            rejectionNotes?: string;
            supplierFault?: boolean;
            batchNumber?: string;
            expiryDate?: string;
        }> = [];

        for (const item of receiving.items) {
            const draft = receiptDrafts[item.id] ?? emptyReceipt();
            let accepted: Decimal;
            let rejected: Decimal;
            try {
                accepted = draft.quantity.trim()
                    ? validateNonNegativeQuantity(draft.quantity, receiptRules(item))
                    : new Decimal(0);
                rejected = draft.quantityRejected.trim()
                    ? validateNonNegativeQuantity(draft.quantityRejected, receiptRules(item))
                    : new Decimal(0);
            } catch {
                showToast({
                    tone: 'warning',
                    title: 'Cantidad de inspección inválida',
                    message: `Revisá lo aceptado, lo rechazado y el paso de ${item.productName}.`,
                });
                return;
            }

            if (accepted.isZero() && rejected.isZero()) continue;
            if (accepted.plus(rejected).greaterThan(openPurchaseOrderQuantityForItem(item))) {
                showToast({ tone: 'warning', title: 'Entrega mayor que la pendiente', message: `La entrega de ${item.productName} supera el saldo abierto de la línea.` });
                return;
            }
            if (rejected.greaterThan(0) && !draft.rejectionReasonCode) {
                showToast({ tone: 'warning', title: 'Falta el motivo del rechazo', message: `Indicá por qué rechazaste ${item.productName}.` });
                return;
            }
            if (rejected.greaterThan(0) && draft.supplierFault === '') {
                showToast({ tone: 'warning', title: 'Falta asignar responsabilidad', message: `Indicá si el rechazo de ${item.productName} es responsabilidad del proveedor.` });
                return;
            }
            if (
                accepted.greaterThan(0)
                && item.product?.requiresBatchTracking
                && (!draft.batchNumber.trim() || !draft.expiryDate)
            ) {
                showToast({
                    tone: 'warning',
                    title: 'Falta la trazabilidad del lote',
                    message: `Ingresá lote y vencimiento para ${item.productName}.`,
                });
                return;
            }

            const receiptItem: typeof items[number] = {
                itemId: item.id,
                // Un rechazo total conserva el contrato: aceptada = 0.
                quantityReceived: accepted.toString(),
            };
            if (accepted.greaterThan(0)) {
                receiptItem.batchNumber = draft.batchNumber.trim() || undefined;
                receiptItem.expiryDate = draft.expiryDate || undefined;
            }
            if (rejected.greaterThan(0)) {
                receiptItem.quantityRejected = rejected.toString();
                receiptItem.rejectionReasonCode = draft.rejectionReasonCode || undefined;
                receiptItem.rejectionNotes = draft.rejectionNotes.trim() || undefined;
                receiptItem.supplierFault = draft.supplierFault === 'true';
            }
            items.push(receiptItem);
        }

        if (items.length === 0) {
            showToast({ tone: 'warning', title: 'Falta la inspección', message: 'Indicá al menos una cantidad aceptada o rechazada.' });
            return;
        }

        setBusy(receiving.id);
        try {
            // El contrato anterior, `JSON.stringify({ warehouseId: receiptWarehouseId, items })`,
            // no podía distinguir un retry de una segunda recepción real.
            const response = await requestWithTimeout(`/api/purchase-orders/${receiving.id}/receive`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    clientEventId: receiptClientEventId,
                    warehouseId: receiptWarehouseId,
                    supplierDeliveryRef: supplierDeliveryRef.trim() || undefined,
                    items,
                }),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = data.error || `El servidor respondió ${response.status}.`;
                setReceiptWarehouseError(message);
                showToast({ tone: 'error', title: 'No se pudo registrar la recepción', message });
                return;
            }

            const receipt = data.receipt as GoodsReceipt | undefined;
            const replay = Boolean(data.replay);
            const warehouseName = receipt?.warehouse?.name
                || receiptWarehouses.find(warehouse => warehouse.id === receiptWarehouseId)?.name;
            if (receipt?.receiptNumber) {
                setLastReceiptNotice({ receiptNumber: receipt.receiptNumber, replay });
            }
            showToast({
                tone: 'success',
                title: replay ? 'Recepción ya confirmada' : 'Mercadería recibida',
                message: receipt?.receiptNumber
                    ? `${receipt.receiptNumber}${warehouseName ? ` · ${warehouseName}` : ''}${replay ? ' · sin duplicar existencias' : ''}`
                    : warehouseName
                        ? `Las existencias ingresaron a ${warehouseName} y el Kardex quedó actualizado.`
                        : 'Las existencias y el Kardex quedaron actualizados.',
            });
            closeReceipt();
            void load();
        } catch (error: any) {
            showToast({
                tone: 'error',
                title: error?.name === 'AbortError' ? 'La conexión tardó demasiado' : 'Error de conexión',
                message: 'Revisá el estado de la orden antes de volver a intentar.',
            });
        } finally {
            setBusy(null);
        }
    };

    const closeCloseShort = () => {
        setClosingShort(null);
        setCloseShortClientEventId('');
        setCloseShortReasonSummaryCode('');
        setCloseShortNote('');
        setCloseShortDrafts({});
        setCloseShortAcknowledged(false);
        setCloseShortError('');
    };

    const openCloseShort = (po: PO) => {
        setClosingShort(po);
        // Igual que la recepción: el UUID cambia solo al abrir una operación nueva.
        setCloseShortClientEventId(newReceiptClientEventId());
        setCloseShortReasonSummaryCode('');
        setCloseShortNote('');
        setCloseShortDrafts(Object.fromEntries(
            po.items
                .filter(item => openPurchaseOrderQuantityForItem(item).greaterThan(0))
                .map(item => [item.id, emptyCloseShortDraft()]),
        ) as Record<string, CloseShortDraft>);
        setCloseShortAcknowledged(false);
        setCloseShortError('');
    };

    const updateCloseShort = (itemId: string, patch: Partial<CloseShortDraft>) => {
        setCloseShortDrafts(current => ({
            ...current,
            [itemId]: { ...emptyCloseShortDraft(), ...current[itemId], ...patch },
        }));
    };

    const submitCloseShort = async () => {
        if (!closingShort || busy) return;
        setCloseShortError('');

        const items: Array<{
            itemId: string;
            quantity: string;
            reasonCode: CloseShortReasonCode;
            supplierFault?: boolean;
            note?: string;
        }> = [];

        for (const item of closingShort.items) {
            const remaining = openPurchaseOrderQuantityForItem(item);
            if (!remaining.greaterThan(0)) continue;
            const draft = closeShortDrafts[item.id] ?? emptyCloseShortDraft();
            if (!draft.reasonCode) {
                const message = `Seleccioná el motivo del faltante de ${item.productName}.`;
                setCloseShortError(message);
                showToast({ tone: 'warning', title: 'Falta un motivo', message });
                return;
            }
            items.push({
                itemId: item.id,
                quantity: remaining.toFixed(4),
                reasonCode: draft.reasonCode,
                supplierFault: draft.supplierFault === '' ? undefined : draft.supplierFault === 'true',
                note: draft.note.trim() || undefined,
            });
        }

        if (items.length === 0) {
            setCloseShortError('La orden ya no tiene cantidades abiertas para cerrar.');
            return;
        }
        if (!closeShortAcknowledged) {
            setCloseShortError('Confirmá que entendés el efecto irreversible antes de continuar.');
            return;
        }

        const busyKey = `close-short-${closingShort.id}`;
        setBusy(busyKey);
        try {
            const response = await requestWithTimeout(`/api/purchase-orders/${closingShort.id}/close-short`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    clientEventId: closeShortClientEventId,
                    reasonSummaryCode: closeShortReasonSummaryCode || undefined,
                    note: closeShortNote.trim() || undefined,
                    items,
                }),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = data.error || `El servidor respondió ${response.status}.`;
                setCloseShortError(message);
                showToast({ tone: 'error', title: 'No se pudo cerrar el faltante', message });
                return;
            }

            const replay = Boolean(data.replay);
            setLastCloseShortNotice({ orderNumber: closingShort.orderNumber, replay });
            showToast({
                tone: 'success',
                title: replay ? 'Cierre ya confirmado' : 'Faltante cerrado',
                message: replay
                    ? `${closingShort.orderNumber} se recuperó sin duplicar el cierre.`
                    : `${closingShort.orderNumber} quedó cerrada y auditada.`,
            });
            closeCloseShort();
            void load();
        } catch (error: any) {
            const message = error?.name === 'AbortError'
                ? 'La conexión tardó demasiado. Conservamos el mismo identificador para reintentar.'
                : 'Revisá tu conexión y el estado de la orden antes de reintentar.';
            setCloseShortError(message);
            showToast({ tone: 'error', title: 'No se pudo confirmar el cierre', message });
        } finally {
            setBusy(null);
        }
    };

    const selectedReceiptWarehouse = receiptWarehouses.find(warehouse => warehouse.id === receiptWarehouseId);

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <ToastViewport toast={toast} onDismiss={dismissToast} />

            <div className="flex items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ClipboardList className="text-brand" /> {isBodeguero ? 'Recepción de mercadería' : 'Órdenes de Compra'}
                    </h1>
                    {isBodeguero && <p className="mt-1 text-sm text-slate-400">Revisá lo pendiente y registrá únicamente lo que llegó físicamente.</p>}
                </div>
                <div className="flex gap-2">
                    <button onClick={() => void load()} className="p-2 text-slate-400 hover:text-white" aria-label="Actualizar órdenes">
                        <RefreshCw size={16} />
                    </button>
                    {canManagePurchaseOrders && (
                        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-brand text-white rounded-lg font-bold text-sm flex items-center gap-1.5">
                            <Plus size={16} /> Nueva OC
                        </button>
                    )}
                </div>
            </div>

            {lastReceiptNotice && (
                <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    <div>
                        <p className="font-semibold">
                            {lastReceiptNotice.replay ? 'Recepción recuperada sin duplicar' : 'Recepción registrada'}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-emerald-300">{lastReceiptNotice.receiptNumber}</p>
                    </div>
                    <button type="button" onClick={() => setLastReceiptNotice(null)} className="rounded p-1 text-emerald-300 hover:bg-emerald-500/10" aria-label="Cerrar confirmación de recepción">
                        <X size={16} />
                    </button>
                </div>
            )}

            {lastCloseShortNotice && (
                <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
                    <div>
                        <p className="font-semibold">
                            {lastCloseShortNotice.replay ? 'Cierre recuperado sin duplicar' : 'Orden cerrada con faltante'}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-orange-300">{lastCloseShortNotice.orderNumber}</p>
                    </div>
                    <button type="button" onClick={() => setLastCloseShortNotice(null)} className="rounded p-1 text-orange-300 hover:bg-orange-500/10" aria-label="Cerrar confirmación de faltante">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="space-y-3">
                {ordersLoading ? (
                    <div aria-label="Cargando órdenes de compra" className="space-y-3">
                        {[0, 1, 2].map(index => <div key={index} className="h-32 animate-pulse rounded-xl border border-slate-700 bg-slate-800/60" />)}
                    </div>
                ) : ordersError ? (
                    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
                        <AlertTriangle className="mx-auto text-red-300" size={28} />
                        <p className="mt-2 font-semibold text-red-100">No pudimos cargar las órdenes</p>
                        <p className="mt-1 text-sm text-red-200">{ordersError}</p>
                        <button type="button" onClick={() => void load()} className="mt-4 rounded-lg border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/10">
                            Reintentar
                        </button>
                    </div>
                ) : orders.map(po => (
                    <div key={po.id} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                                <span className="font-mono font-bold text-white">{po.orderNumber}</span>
                                <span className={`ml-3 px-2 py-0.5 rounded text-[10px] font-bold ${BADGE[po.status] ?? BADGE.DRAFT}`}>
                                    {LABEL[po.status] ?? po.status}
                                </span>
                                <div className="text-xs text-slate-400 mt-1">
                                    {po.supplier.name} · {new Date(po.createdAt).toLocaleDateString('es-NI')}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {((po.goodsReceipts?.length ?? 0) > 0 || (po.closeShorts?.length ?? 0) > 0) && (
                                    <button
                                        type="button"
                                        onClick={() => void toggleReceiptTimeline(po)}
                                        className="px-3 py-1.5 bg-slate-700/70 text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-slate-700"
                                        aria-expanded={expandedOrderId === po.id}
                                    >
                                        <History size={13} /> {po.goodsReceipts?.length ?? 0} recepción{po.goodsReceipts?.length === 1 ? '' : 'es'}
                                        {(po.closeShorts?.length ?? 0) > 0 && ` · ${po.closeShorts?.length} cierre${po.closeShorts?.length === 1 ? '' : 's'}`}
                                        {expandedOrderId === po.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                )}
                                {canManagePurchaseOrders && po.status === 'DRAFT' && (
                                    <>
                                        <button disabled={busy === po.id} onClick={() => void act(po, 'approve')} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                            <CheckCircle size={13} /> Aprobar
                                        </button>
                                        <button disabled={busy === po.id} onClick={() => setCancelToConfirm(po)} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                            <XCircle size={13} /> Cancelar
                                        </button>
                                    </>
                                )}
                                {canReceivePurchaseOrders && (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED') && (
                                    <button disabled={Boolean(busy)} onClick={() => openReceipt(po)} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                        <PackageCheck size={13} /> Recibir
                                    </button>
                                )}
                                {canManagePurchaseOrders
                                    && (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED')
                                    && po.items.some(item => openPurchaseOrderQuantityForItem(item).greaterThan(0)) && (
                                    <button disabled={Boolean(busy)} onClick={() => openCloseShort(po)} className="px-3 py-1.5 bg-orange-500/20 text-orange-300 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                        <XCircle size={13} /> Cerrar faltante
                                    </button>
                                )}
                            </div>
                        </div>
                        <table className="w-full text-xs mt-3">
                            <tbody className="divide-y divide-slate-700/50">
                                {po.items.map(item => (
                                    <tr key={item.id} className="text-slate-300">
                                        <td className="py-1.5">
                                            {item.productName}
                                            {item.product?.requiresBatchTracking && (
                                                <span className="ml-2 rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">LOTE</span>
                                            )}
                                        </td>
                                        <td className="py-1.5 text-right font-mono">
                                            <span>{formatQuantityValue(receivedQuantityForItem(item))}/{formatQuantityValue(orderedQuantityForItem(item))} {item.unitAtOrder || item.product?.unit || 'unidad'}</span>
                                            {rejectedQuantityForItem(item).greaterThan(0) && (
                                                <span className="mt-0.5 block text-[10px] text-red-300">Rechazado {formatQuantityValue(rejectedQuantityForItem(item))}</span>
                                            )}
                                            {closedShortQuantityForItem(item).greaterThan(0) && (
                                                <span className="mt-0.5 block text-[10px] text-orange-300">Cerrado {formatQuantityValue(closedShortQuantityForItem(item))}</span>
                                            )}
                                        </td>
                                        {!isBodeguero && (
                                            <td className="py-1.5 text-right font-mono text-slate-400">{formatMoney(Number(item.unitCost))}</td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {expandedOrderId === po.id && (
                            <section className="mt-4 border-t border-slate-700 pt-4" aria-label={`Historial físico de ${po.orderNumber}`}>
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                                    <History size={16} className="text-emerald-300" /> Historial físico
                                </h3>
                                {detailLoadingId === po.id ? (
                                    <div aria-label="Cargando historial de recepciones" className="mt-3 h-20 animate-pulse rounded-lg bg-slate-900/60" />
                                ) : detailError ? (
                                    <div role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                                        <p>{detailError}</p>
                                        <button type="button" onClick={() => void toggleReceiptTimeline(po, true)} className="mt-2 font-semibold underline">
                                            Reintentar
                                        </button>
                                    </div>
                                ) : (po.goodsReceipts?.length ?? 0) === 0 && (po.closeShorts?.length ?? 0) === 0 ? (
                                    <p className="mt-3 text-sm text-slate-500">Todavía no hay movimientos físicos registrados.</p>
                                ) : (
                                    <div className="mt-3 space-y-3">
                                        <ol className="space-y-3" aria-label="Recepciones e inspecciones">
                                            {po.goodsReceipts?.map(receipt => (
                                                <li key={receipt.id} className="rounded-lg border border-slate-700 bg-slate-900/45 p-3">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="font-mono text-sm font-bold text-emerald-300">{receipt.receiptNumber}</p>
                                                                {receipt.inspectionOutcome && (
                                                                    <span className="rounded bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                                                                        {INSPECTION_OUTCOME_LABEL[receipt.inspectionOutcome]}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="mt-0.5 text-xs text-slate-400">
                                                                {receipt.warehouse?.name || 'Bodega registrada'} · {receipt.receiver?.name || 'Usuario registrado'} · {formatReceiptDate(receipt.receivedAt)}
                                                            </p>
                                                        </div>
                                                        {receipt.supplierDeliveryRef && (
                                                            <span className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-300">Remisión {receipt.supplierDeliveryRef}</span>
                                                        )}
                                                    </div>
                                                    {receipt.items && receipt.items.length > 0 && (
                                                        <ul className="mt-3 divide-y divide-slate-700/60 text-xs">
                                                            {receipt.items.map(receiptItem => {
                                                                const orderItem = po.items.find(item => item.id === receiptItem.purchaseOrderItemId);
                                                                const accepted = decimalOrZero(receiptItem.quantityExact);
                                                                const rejected = decimalOrZero(receiptItem.rejectedQuantityExact);
                                                                const delivered = receiptItem.deliveredQuantityExact == null
                                                                    ? accepted.plus(rejected)
                                                                    : decimalOrZero(receiptItem.deliveredQuantityExact);
                                                                return (
                                                                    <li key={receiptItem.id} className="py-2 text-slate-300">
                                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                                            <span>{orderItem?.productName || 'Producto inspeccionado'}</span>
                                                                            <span className="text-right font-mono text-slate-200">
                                                                                Entregado {formatQuantityValue(delivered)} {receiptItem.unitSnapshot}
                                                                                <span className="mt-0.5 block text-emerald-300">Aceptado {formatQuantityValue(accepted)}</span>
                                                                                {rejected.greaterThan(0) && (
                                                                                    <span className="mt-0.5 block text-red-300">Rechazado {formatQuantityValue(rejected)}</span>
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        {rejected.greaterThan(0) && receiptItem.rejectionReasonCode && (
                                                                            <p className="mt-1 text-red-200">
                                                                                Motivo: {INSPECTION_REASON_LABEL[receiptItem.rejectionReasonCode]}
                                                                                {' · '}Proveedor responsable: {receiptItem.supplierFault ? 'Sí' : 'No'}
                                                                            </p>
                                                                        )}
                                                                        {rejected.greaterThan(0) && receiptItem.rejectionNotes && (
                                                                            <p className="mt-1 text-slate-400">Observación: {receiptItem.rejectionNotes}</p>
                                                                        )}
                                                                        {accepted.greaterThan(0) && (receiptItem.batchNumber || receiptItem.expiryDate) && (
                                                                            <p className="mt-1 font-mono text-slate-400">
                                                                                {receiptItem.batchNumber ? `Lote ${receiptItem.batchNumber}` : ''}
                                                                                {receiptItem.batchNumber && receiptItem.expiryDate ? ' · ' : ''}
                                                                                {receiptItem.expiryDate ? `Vence ${new Date(receiptItem.expiryDate).toLocaleDateString('es-NI', { timeZone: 'UTC' })}` : ''}
                                                                            </p>
                                                                        )}
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    )}
                                                </li>
                                            ))}
                                        </ol>
                                        {!isBodeguero && (po.closeShorts?.length ?? 0) > 0 && (
                                            <ol className="space-y-3" aria-label="Cierres de faltante">
                                                {po.closeShorts?.map(closeShort => (
                                                    <li key={closeShort.id} className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-3">
                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <div>
                                                                <p className="text-sm font-bold text-orange-300">Cierre de faltante</p>
                                                                <p className="mt-0.5 text-xs text-slate-400">
                                                                    {closeShort.creator?.name || 'Usuario autorizado'} · {formatReceiptDate(closeShort.closedAt)}
                                                                </p>
                                                            </div>
                                                            {closeShort.reasonSummaryCode && (
                                                                <span className="rounded bg-orange-500/15 px-2 py-1 text-[11px] text-orange-200">
                                                                    {CLOSE_SHORT_REASON_LABEL[closeShort.reasonSummaryCode]}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {closeShort.note && <p className="mt-2 text-xs text-slate-300">Nota: {closeShort.note}</p>}
                                                        {closeShort.items && closeShort.items.length > 0 && (
                                                            <ul className="mt-3 divide-y divide-orange-500/15 text-xs">
                                                                {closeShort.items.map(closeItem => {
                                                                    const orderItem = po.items.find(item => item.id === closeItem.purchaseOrderItemId);
                                                                    return (
                                                                        <li key={closeItem.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-slate-300">
                                                                            <span>{orderItem?.productName || 'Producto'}</span>
                                                                            <span className="text-right font-mono text-orange-200">
                                                                                Cerrado {formatQuantityValue(closeItem.quantityExact)} {closeItem.unitSnapshot || orderItem?.unitAtOrder || 'unidad'}
                                                                                <span className="mt-0.5 block font-sans text-slate-400">
                                                                                    {CLOSE_SHORT_REASON_LABEL[closeItem.reasonCode]}
                                                                                    {closeItem.supplierFault != null ? ` · Proveedor responsable: ${closeItem.supplierFault ? 'Sí' : 'No'}` : ''}
                                                                                </span>
                                                                            </span>
                                                                        </li>
                                                                    );
                                                                })}
                                                            </ul>
                                                        )}
                                                    </li>
                                                ))}
                                            </ol>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                ))}
                {!ordersLoading && !ordersError && orders.length === 0 && (
                    <div className="text-center text-slate-500 py-12">
                        {canManagePurchaseOrders
                            ? 'Sin órdenes de compra. Creá la primera con “Nueva OC”.'
                            : isBodeguero
                                ? 'No hay órdenes pendientes para recibir.'
                                : 'No hay órdenes de compra registradas.'}
                    </div>
                )}
            </div>

            {canManagePurchaseOrders && showCreate && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) setShowCreate(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="new-po-title" className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h2 id="new-po-title" className="font-bold text-white">Nueva Orden de Compra</h2>
                            <button onClick={() => setShowCreate(false)} disabled={Boolean(busy)} className="text-slate-400 disabled:opacity-50" aria-label="Cerrar"><X size={18} /></button>
                        </div>
                        <div>
                            <label htmlFor="po-supplier" className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Proveedor *</label>
                            <select
                                id="po-supplier"
                                value={supplierId}
                                onChange={event => setSupplierId(event.target.value)}
                                disabled={suppliers.length === 0}
                                className="mt-1 w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm disabled:text-slate-500"
                            >
                                <option value="">{suppliers.length === 0 ? 'Todavía no hay proveedores' : 'Seleccionar proveedor…'}</option>
                                {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                            {suppliers.length === 0 && (
                                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                                    <span>Necesitás un proveedor para crear la orden.</span>
                                    <a href="/app/suppliers" className="shrink-0 font-bold text-amber-300 underline decoration-amber-500/60 underline-offset-2 hover:text-amber-200">
                                        Crear proveedor
                                    </a>
                                </div>
                            )}
                        </div>
                        <div>
                            <input value={search} onChange={event => void searchProducts(event.target.value)} placeholder="Buscar producto para agregar…" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm" />
                            {results.length > 0 && (
                                <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700 max-h-40 overflow-y-auto">
                                    {results.map(product => (
                                        <button
                                            key={product.id}
                                            onClick={() => {
                                                setRows(current => current.some(row => row.id === product.id)
                                                    ? current
                                                    : [...current, {
                                                        ...product,
                                                        quantity: purchaseOrderRulesForProduct(product).quantityStep,
                                                        unitCost: String(product.cost ?? 0),
                                                    }]);
                                                setSearch('');
                                                setResults([]);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                                        >
                                            {product.name} <span className="text-slate-500 font-mono text-xs">{product.sku}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {rows.map((row, index) => (
                            <div key={row.id} className="flex gap-2 items-center text-sm">
                                <span className="flex-1 text-slate-200 truncate">{row.name} <span className="text-xs text-slate-500">({row.unit || 'unidad'})</span></span>
                                <input inputMode="decimal" value={row.quantity} onChange={event => setRows(current => current.map((candidate, i) => i === index ? { ...candidate, quantity: sanitizePurchaseQuantityInput(event.target.value) } : candidate))} className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" aria-label={`Cantidad de ${row.name}`} />
                                <input inputMode="decimal" value={row.unitCost} onChange={event => setRows(current => current.map((candidate, i) => i === index ? { ...candidate, unitCost: sanitizeDecimalInput(event.target.value) } : candidate))} className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" aria-label={`Costo de ${row.name}`} />
                                <button onClick={() => setRows(current => current.filter((_, i) => i !== index))} className="text-red-400" aria-label={`Quitar ${row.name}`}><X size={14} /></button>
                            </div>
                        ))}
                        <button onClick={() => void createPO()} disabled={busy === 'create'} className="w-full py-2.5 bg-brand text-white rounded-lg font-bold text-sm disabled:opacity-60">
                            {busy === 'create' ? 'Creando…' : 'Crear borrador'}
                        </button>
                    </div>
                </div>
            )}

            {receiving && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) closeReceipt(); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="receive-po-title" className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h2 id="receive-po-title" className="font-bold text-white">Recibir {receiving.orderNumber}</h2>
                            <button onClick={closeReceipt} disabled={Boolean(busy)} className="text-slate-400 disabled:opacity-50" aria-label="Cerrar"><X size={18} /></button>
                        </div>
                        <p className="text-xs text-slate-400">
                            Separá lo aceptado de lo rechazado. Solo lo aceptado actualiza existencias, lotes y Kardex.
                        </p>

                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                            <label htmlFor="receipt-warehouse" className="mb-1.5 block text-sm font-semibold text-slate-200">
                                Bodega de destino <span className="text-red-400">*</span>
                            </label>
                            <select
                                id="receipt-warehouse"
                                required
                                value={receiptWarehouseId}
                                onChange={event => {
                                    setReceiptWarehouseId(event.target.value);
                                    setReceiptWarehouseError('');
                                }}
                                disabled={receiptWarehousesLoading}
                                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                            >
                                <option value="">
                                    {receiptWarehousesLoading
                                        ? 'Cargando bodegas…'
                                        : receiptWarehouses.length === 0
                                            ? 'No hay bodegas activas'
                                            : 'Seleccioná dónde ingresará'}
                                </option>
                                {receiptWarehouses.map(warehouse => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                        {warehouse.name}{warehouse.isDefault ? ' · Principal' : ''}
                                    </option>
                                ))}
                            </select>
                            {selectedReceiptWarehouse ? (
                                <p className="mt-1.5 text-xs text-emerald-300">
                                    Todo lo aceptado en esta operación ingresará a <strong>{selectedReceiptWarehouse.name}</strong>.
                                </p>
                            ) : (
                                <p className="mt-1.5 text-xs text-slate-400">Elegí la ubicación física antes de confirmar.</p>
                            )}
                            {receiptWarehouses.length === 0 && !receiptWarehousesLoading && (
                                <p role="alert" className="mt-2 text-xs text-red-300">No hay una bodega activa disponible. Actualizá la página o revisá Bodegas.</p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="supplier-delivery-ref" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Referencia de entrega (opcional)
                            </label>
                            <input
                                id="supplier-delivery-ref"
                                value={supplierDeliveryRef}
                                onChange={event => setSupplierDeliveryRef(event.target.value)}
                                maxLength={191}
                                placeholder="Remisión, guía o documento del proveedor"
                                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        {receiving.items.map(item => {
                            const pending = openPurchaseOrderQuantityForItem(item);
                            const draft = receiptDrafts[item.id] ?? emptyReceipt();
                            const hasRejectedQuantity = decimalOrZero(draft.quantityRejected).greaterThan(0);
                            const hasAcceptedQuantity = decimalOrZero(draft.quantity).greaterThan(0);
                            return (
                                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                                    <div className="text-sm">
                                        <p className="text-slate-200">
                                            {item.productName} <span className="text-slate-500 text-xs">(saldo abierto {formatQuantityValue(pending)} {item.unitAtOrder || item.product?.unit || 'unidad'})</span>
                                        </p>
                                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div>
                                                <label htmlFor={`accepted-${item.id}`} className="mb-1 block text-xs font-semibold text-emerald-300">Cantidad aceptada</label>
                                                <input
                                                    id={`accepted-${item.id}`}
                                                    value={draft.quantity}
                                                    onChange={event => updateReceipt(item.id, { quantity: sanitizePurchaseQuantityInput(event.target.value) })}
                                                    inputMode="decimal"
                                                    placeholder="0"
                                                    className="w-full rounded border border-emerald-800/70 bg-slate-900 px-2 py-2 text-right font-mono text-white"
                                                    disabled={pending.lessThanOrEqualTo(0)}
                                                    aria-label={`Cantidad recibida de ${item.productName}`}
                                                />
                                                <p className="mt-1 text-[11px] text-slate-500">Ingresará a inventario.</p>
                                            </div>
                                            <div>
                                                <label htmlFor={`rejected-${item.id}`} className="mb-1 block text-xs font-semibold text-red-300">Cantidad rechazada</label>
                                                <input
                                                    id={`rejected-${item.id}`}
                                                    value={draft.quantityRejected}
                                                    onChange={event => updateReceipt(item.id, { quantityRejected: sanitizePurchaseQuantityInput(event.target.value) })}
                                                    inputMode="decimal"
                                                    placeholder="0"
                                                    className="w-full rounded border border-red-800/70 bg-slate-900 px-2 py-2 text-right font-mono text-white"
                                                    disabled={pending.lessThanOrEqualTo(0)}
                                                    aria-label={`Cantidad rechazada de ${item.productName}`}
                                                />
                                                <p className="mt-1 text-[11px] text-slate-500">No entra a inventario y puede reentregarse.</p>
                                            </div>
                                        </div>
                                    </div>
                                    {hasRejectedQuantity && (
                                        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label htmlFor={`rejection-reason-${item.id}`} className="mb-1 block text-xs font-semibold text-red-200">Motivo del rechazo *</label>
                                                    <select
                                                        id={`rejection-reason-${item.id}`}
                                                        value={draft.rejectionReasonCode}
                                                        onChange={event => updateReceipt(item.id, { rejectionReasonCode: event.target.value as '' | InspectionReasonCode })}
                                                        className="w-full rounded border border-red-800/70 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                        aria-label={`Motivo del rechazo de ${item.productName}`}
                                                    >
                                                        <option value="">Seleccioná un motivo…</option>
                                                        {INSPECTION_REASON_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label htmlFor={`supplier-fault-${item.id}`} className="mb-1 block text-xs font-semibold text-red-200">Responsabilidad del proveedor *</label>
                                                    <select
                                                        id={`supplier-fault-${item.id}`}
                                                        value={draft.supplierFault}
                                                        onChange={event => updateReceipt(item.id, { supplierFault: event.target.value as '' | 'true' | 'false' })}
                                                        className="w-full rounded border border-red-800/70 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                        aria-label={`Responsabilidad del proveedor en rechazo de ${item.productName}`}
                                                    >
                                                        <option value="">Indicá sí o no…</option>
                                                        <option value="true">Sí, es responsabilidad del proveedor</option>
                                                        <option value="false">No, no es responsabilidad del proveedor</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="mt-3">
                                                <label htmlFor={`rejection-notes-${item.id}`} className="mb-1 block text-xs text-slate-300">Observación física (opcional)</label>
                                                <textarea
                                                    id={`rejection-notes-${item.id}`}
                                                    value={draft.rejectionNotes}
                                                    onChange={event => updateReceipt(item.id, { rejectionNotes: event.target.value })}
                                                    maxLength={1000}
                                                    rows={2}
                                                    className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                    placeholder="Ej: empaque roto al descargar"
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {item.product?.requiresBatchTracking && hasAcceptedQuantity && (
                                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs text-orange-300 mb-1">Número de lote *</label>
                                                <input
                                                    value={draft.batchNumber}
                                                    onChange={event => updateReceipt(item.id, { batchNumber: event.target.value })}
                                                    maxLength={100}
                                                    placeholder="Ej: LOTE-2026-08"
                                                    className="w-full px-2.5 py-2 bg-slate-900 border border-orange-800/70 rounded text-white text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-orange-300 mb-1">Vencimiento *</label>
                                                <input
                                                    type="date"
                                                    value={draft.expiryDate}
                                                    onChange={event => updateReceipt(item.id, { expiryDate: event.target.value })}
                                                    className="w-full px-2.5 py-2 bg-slate-900 border border-orange-800/70 rounded text-white text-sm"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {receiptWarehouseError && (
                            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                                {receiptWarehouseError}
                            </div>
                        )}
                        <button
                            onClick={() => void receive()}
                            disabled={busy === receiving.id || receiptWarehousesLoading || !receiptWarehouseId}
                            className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {busy === receiving.id
                                ? 'Recibiendo…'
                                : receiptWarehousesLoading
                                    ? 'Cargando bodegas…'
                                    : 'Confirmar recepción'}
                        </button>
                    </div>
                </div>
            )}

            {canManagePurchaseOrders && closingShort && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { if (!busy) closeCloseShort(); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="close-short-title" className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-orange-500/30 bg-slate-900 p-5" onClick={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 id="close-short-title" className="font-bold text-white">Cerrar faltante de {closingShort.orderNumber}</h2>
                                <p className="mt-1 text-xs text-orange-200">Esta acción es terminal, irreversible y queda auditada. No mueve inventario ni dinero.</p>
                            </div>
                            <button type="button" onClick={closeCloseShort} disabled={Boolean(busy)} className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-50" aria-label="Cerrar diálogo de faltante"><X size={18} /></button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label htmlFor="close-short-summary-reason" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Motivo general (opcional)</label>
                                <select
                                    id="close-short-summary-reason"
                                    value={closeShortReasonSummaryCode}
                                    onChange={event => setCloseShortReasonSummaryCode(event.target.value as '' | CloseShortReasonCode)}
                                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white"
                                >
                                    <option value="">Sin motivo general…</option>
                                    {CLOSE_SHORT_REASON_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="close-short-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Nota general (opcional)</label>
                                <input
                                    id="close-short-note"
                                    value={closeShortNote}
                                    onChange={event => setCloseShortNote(event.target.value)}
                                    maxLength={1000}
                                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white"
                                    placeholder="Acuerdo o referencia con el proveedor"
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            {closingShort.items
                                .filter(item => openPurchaseOrderQuantityForItem(item).greaterThan(0))
                                .map(item => {
                                    const draft = closeShortDrafts[item.id] ?? emptyCloseShortDraft();
                                    const remaining = openPurchaseOrderQuantityForItem(item);
                                    const unit = item.unitAtOrder || item.product?.unit || 'unidad';
                                    return (
                                        <div key={item.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-100">{item.productName}</p>
                                                    <p className="mt-0.5 text-xs text-slate-400">Se cerrará todo el saldo abierto.</p>
                                                </div>
                                                <div>
                                                    <label htmlFor={`close-quantity-${item.id}`} className="mb-1 block text-xs text-orange-200">Cantidad</label>
                                                    <input
                                                        id={`close-quantity-${item.id}`}
                                                        readOnly
                                                        value={remaining.toFixed(4)}
                                                        className="w-full rounded border border-orange-700/60 bg-slate-950 px-2 py-2 text-right font-mono text-orange-100"
                                                        aria-label={`Cantidad a cerrar de ${item.productName}`}
                                                    />
                                                    <p className="mt-1 text-right text-[10px] text-slate-500">{unit}</p>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label htmlFor={`close-reason-${item.id}`} className="mb-1 block text-xs font-semibold text-orange-200">Motivo de la línea *</label>
                                                    <select
                                                        id={`close-reason-${item.id}`}
                                                        value={draft.reasonCode}
                                                        onChange={event => updateCloseShort(item.id, { reasonCode: event.target.value as '' | CloseShortReasonCode })}
                                                        className="w-full rounded border border-orange-700/60 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                        aria-label={`Motivo del faltante de ${item.productName}`}
                                                    >
                                                        <option value="">Seleccioná un motivo…</option>
                                                        {CLOSE_SHORT_REASON_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label htmlFor={`close-supplier-fault-${item.id}`} className="mb-1 block text-xs text-slate-300">Responsabilidad del proveedor (opcional)</label>
                                                    <select
                                                        id={`close-supplier-fault-${item.id}`}
                                                        value={draft.supplierFault}
                                                        onChange={event => updateCloseShort(item.id, { supplierFault: event.target.value as '' | 'true' | 'false' })}
                                                        className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                        aria-label={`Responsabilidad del proveedor en faltante de ${item.productName}`}
                                                    >
                                                        <option value="">Sin indicar</option>
                                                        <option value="true">Sí</option>
                                                        <option value="false">No</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="mt-3">
                                                <label htmlFor={`close-line-note-${item.id}`} className="mb-1 block text-xs text-slate-300">Nota de la línea (opcional)</label>
                                                <input
                                                    id={`close-line-note-${item.id}`}
                                                    value={draft.note}
                                                    onChange={event => updateCloseShort(item.id, { note: event.target.value })}
                                                    maxLength={1000}
                                                    className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>

                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-orange-500/25 bg-orange-500/5 p-3 text-sm text-orange-100">
                            <input
                                type="checkbox"
                                checked={closeShortAcknowledged}
                                onChange={event => {
                                    setCloseShortAcknowledged(event.target.checked);
                                    setCloseShortError('');
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900"
                            />
                            <span>Entiendo que la orden quedará cerrada con faltante y ya no podrá recibir más mercadería.</span>
                        </label>

                        {closeShortError && (
                            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{closeShortError}</div>
                        )}

                        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button type="button" onClick={closeCloseShort} disabled={Boolean(busy)} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Volver</button>
                            <button
                                type="button"
                                onClick={() => void submitCloseShort()}
                                disabled={busy === `close-short-${closingShort.id}` || !closeShortAcknowledged}
                                className="rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {busy === `close-short-${closingShort.id}` ? 'Cerrando…' : 'Confirmar cierre'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {cancelToConfirm && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) setCancelToConfirm(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="cancel-po-title" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 shrink-0 text-red-300" size={20} />
                            <div>
                                <h2 id="cancel-po-title" className="font-semibold text-white">Cancelar {cancelToConfirm.orderNumber}</h2>
                                <p className="mt-1 text-sm text-slate-300">La orden dejará de estar disponible para recepción. Esta acción no borra su historial.</p>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-3">
                            <button onClick={() => setCancelToConfirm(null)} disabled={Boolean(busy)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Volver</button>
                            <button onClick={() => void act(cancelToConfirm, 'cancel')} disabled={busy === cancelToConfirm.id} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                                {busy === cancelToConfirm.id ? 'Cancelando…' : 'Cancelar orden'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrders;
