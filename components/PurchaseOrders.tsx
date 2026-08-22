import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, CheckCircle, ClipboardList, PackageCheck, Plus,
    RefreshCw, X, XCircle,
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import { ToastViewport, useToast } from './ui/Toast';

/** Órdenes de Compra: DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED. */
interface POItem {
    id: string;
    productId: string;
    productName: string;
    quantityOrdered: number;
    quantityReceived: number;
    unitCost: string | number;
    product?: { requiresBatchTracking: boolean };
}

interface PO {
    id: string;
    orderNumber: string;
    status: string;
    notes?: string | null;
    createdAt: string;
    supplier: { name: string };
    items: POItem[];
}

interface Supplier { id: string; name: string; }
interface ProductLite { id: string; name: string; sku: string; cost: number; }
interface ReceiptDraft { quantity: string; batchNumber: string; expiryDate: string; }

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
    CANCELLED: 'bg-red-500/20 text-red-400',
};

const LABEL: Record<string, string> = {
    DRAFT: 'BORRADOR',
    APPROVED: 'APROBADA',
    PARTIALLY_RECEIVED: 'PARCIAL',
    RECEIVED: 'RECIBIDA',
    CANCELLED: 'CANCELADA',
};

const emptyReceipt = (): ReceiptDraft => ({ quantity: '', batchNumber: '', expiryDate: '' });

const PurchaseOrders: React.FC = () => {
    const [orders, setOrders] = useState<PO[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [receiving, setReceiving] = useState<PO | null>(null);
    const [cancelToConfirm, setCancelToConfirm] = useState<PO | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const [supplierId, setSupplierId] = useState('');
    const [rows, setRows] = useState<{ productId: string; name: string; quantity: string; unitCost: string }[]>([]);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<ProductLite[]>([]);
    const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
    const { toast, showToast, dismissToast } = useToast();

    const load = useCallback(async () => {
        try {
            const response = await requestWithTimeout('/api/purchase-orders', { headers: headers() });
            const data: any = await response.json().catch(() => ({}));
            if (response.ok) setOrders(Array.isArray(data.data) ? data.data : []);
            else showToast({ tone: 'error', title: 'No se pudieron cargar las órdenes', message: data.error });
        } catch {
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No pudimos cargar las órdenes de compra.' });
        }
    }, [showToast]);

    useEffect(() => {
        void load();
        void requestWithTimeout('/api/suppliers', { headers: headers() })
            .then(async response => {
                const data: any = await response.json().catch(() => []);
                if (response.ok) setSuppliers(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                showToast({ tone: 'error', title: 'No se cargaron los proveedores', message: 'Revisá tu conexión e intentá de nuevo.' });
            });
    }, [load, showToast]);

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

        const items = rows.map(row => ({
            productId: row.productId,
            quantity: Number(row.quantity),
            unitCost: Number(row.unitCost),
        }));
        if (items.some(item => !(item.quantity > 0) || !(item.unitCost >= 0))) {
            showToast({ tone: 'warning', title: 'Revisá los productos', message: 'Las cantidades deben ser mayores que cero y los costos no pueden ser negativos.' });
            return;
        }

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

    const openReceipt = (po: PO) => {
        setReceiving(po);
        setReceiptDrafts(Object.fromEntries(
            po.items.map(item => [item.id, emptyReceipt()]),
        ) as Record<string, ReceiptDraft>);
    };

    const updateReceipt = (itemId: string, patch: Partial<ReceiptDraft>) => {
        setReceiptDrafts(current => ({
            ...current,
            [itemId]: { ...emptyReceipt(), ...current[itemId], ...patch },
        }));
    };

    const receive = async () => {
        if (!receiving || busy) return;

        const items = receiving.items.flatMap(item => {
            const draft = receiptDrafts[item.id] ?? emptyReceipt();
            const quantityReceived = Number(draft.quantity);
            if (!(quantityReceived > 0)) return [];
            return [{
                itemId: item.id,
                quantityReceived,
                batchNumber: draft.batchNumber.trim() || undefined,
                expiryDate: draft.expiryDate || undefined,
            }];
        });
        if (items.length === 0) {
            showToast({ tone: 'warning', title: 'Falta la cantidad recibida', message: 'Indicá al menos una cantidad mayor que cero.' });
            return;
        }

        const overReceived = receiving.items.find(item => {
            const quantity = Number(receiptDrafts[item.id]?.quantity ?? 0);
            return quantity > Number(item.quantityOrdered) - Number(item.quantityReceived);
        });
        if (overReceived) {
            showToast({ tone: 'warning', title: 'Cantidad mayor que la pendiente', message: `Revisá ${overReceived.productName}.` });
            return;
        }

        const incompleteBatch = receiving.items.find(item => {
            const draft = receiptDrafts[item.id] ?? emptyReceipt();
            return Number(draft.quantity) > 0 && item.product?.requiresBatchTracking &&
                (!draft.batchNumber.trim() || !draft.expiryDate);
        });
        if (incompleteBatch) {
            showToast({
                tone: 'warning',
                title: 'Falta la trazabilidad del lote',
                message: `Ingresá lote y vencimiento para ${incompleteBatch.productName}.`,
            });
            return;
        }

        setBusy(receiving.id);
        try {
            const response = await requestWithTimeout(`/api/purchase-orders/${receiving.id}/receive`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ items }),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast({ tone: 'error', title: 'No se pudo registrar la recepción', message: data.error || `El servidor respondió ${response.status}.` });
                return;
            }

            showToast({ tone: 'success', title: 'Mercadería recibida', message: 'Stock, costo promedio, lotes y Kardex quedaron actualizados.' });
            setReceiving(null);
            setReceiptDrafts({});
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

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <ToastViewport toast={toast} onDismiss={dismissToast} />

            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <ClipboardList className="text-brand" /> Órdenes de Compra
                </h1>
                <div className="flex gap-2">
                    <button onClick={() => void load()} className="p-2 text-slate-400 hover:text-white" aria-label="Actualizar órdenes">
                        <RefreshCw size={16} />
                    </button>
                    <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-brand text-white rounded-lg font-bold text-sm flex items-center gap-1.5">
                        <Plus size={16} /> Nueva OC
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {orders.map(po => (
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
                                {po.status === 'DRAFT' && (
                                    <>
                                        <button disabled={busy === po.id} onClick={() => void act(po, 'approve')} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                            <CheckCircle size={13} /> Aprobar
                                        </button>
                                        <button disabled={busy === po.id} onClick={() => setCancelToConfirm(po)} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                            <XCircle size={13} /> Cancelar
                                        </button>
                                    </>
                                )}
                                {(po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED') && (
                                    <button disabled={Boolean(busy)} onClick={() => openReceipt(po)} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                                        <PackageCheck size={13} /> Recibir
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
                                        <td className="py-1.5 text-right font-mono">{item.quantityReceived}/{item.quantityOrdered} und</td>
                                        <td className="py-1.5 text-right font-mono text-slate-400">{formatMoney(Number(item.unitCost))}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
                {orders.length === 0 && (
                    <div className="text-center text-slate-500 py-12">Sin órdenes de compra. Creá la primera con “Nueva OC”.</div>
                )}
            </div>

            {showCreate && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) setShowCreate(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="new-po-title" className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h2 id="new-po-title" className="font-bold text-white">Nueva Orden de Compra</h2>
                            <button onClick={() => setShowCreate(false)} disabled={Boolean(busy)} className="text-slate-400 disabled:opacity-50" aria-label="Cerrar"><X size={18} /></button>
                        </div>
                        <select value={supplierId} onChange={event => setSupplierId(event.target.value)} className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm">
                            <option value="">— Proveedor —</option>
                            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                        </select>
                        <div>
                            <input value={search} onChange={event => void searchProducts(event.target.value)} placeholder="Buscar producto para agregar…" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm" />
                            {results.length > 0 && (
                                <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700 max-h-40 overflow-y-auto">
                                    {results.map(product => (
                                        <button
                                            key={product.id}
                                            onClick={() => {
                                                setRows(current => current.some(row => row.productId === product.id)
                                                    ? current
                                                    : [...current, { productId: product.id, name: product.name, quantity: '1', unitCost: String(product.cost ?? 0) }]);
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
                            <div key={row.productId} className="flex gap-2 items-center text-sm">
                                <span className="flex-1 text-slate-200 truncate">{row.name}</span>
                                <input value={row.quantity} onChange={event => setRows(current => current.map((candidate, i) => i === index ? { ...candidate, quantity: event.target.value.replace(/[^\d.]/g, '') } : candidate))} className="w-16 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" aria-label={`Cantidad de ${row.name}`} />
                                <input value={row.unitCost} onChange={event => setRows(current => current.map((candidate, i) => i === index ? { ...candidate, unitCost: event.target.value.replace(/[^\d.]/g, '') } : candidate))} className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white font-mono text-right" aria-label={`Costo de ${row.name}`} />
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
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) setReceiving(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="receive-po-title" className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h2 id="receive-po-title" className="font-bold text-white">Recibir {receiving.orderNumber}</h2>
                            <button onClick={() => setReceiving(null)} disabled={Boolean(busy)} className="text-slate-400 disabled:opacity-50" aria-label="Cerrar"><X size={18} /></button>
                        </div>
                        <p className="text-xs text-slate-400">Ingresá lo que llegó físicamente. El stock, costo promedio, lotes y Kardex se actualizan en una sola operación.</p>
                        {receiving.items.map(item => {
                            const pending = Number(item.quantityOrdered) - Number(item.quantityReceived);
                            const draft = receiptDrafts[item.id] ?? emptyReceipt();
                            return (
                                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                                    <div className="flex gap-3 items-center text-sm">
                                        <span className="flex-1 text-slate-200 truncate">
                                            {item.productName} <span className="text-slate-500 text-xs">(pendiente {pending})</span>
                                        </span>
                                        <input
                                            value={draft.quantity}
                                            onChange={event => updateReceipt(item.id, { quantity: event.target.value.replace(/[^\d.]/g, '') })}
                                            inputMode="decimal"
                                            placeholder="0"
                                            className="w-24 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white font-mono text-right"
                                            disabled={pending <= 0}
                                            aria-label={`Cantidad recibida de ${item.productName}`}
                                        />
                                    </div>
                                    {item.product?.requiresBatchTracking && Number(draft.quantity) > 0 && (
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
                        <button onClick={() => void receive()} disabled={busy === receiving.id} className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-sm disabled:opacity-60">
                            {busy === receiving.id ? 'Recibiendo…' : 'Confirmar recepción'}
                        </button>
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
