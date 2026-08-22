import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { maybeAutostartTour } from '../utils/tours';
import {
    Truck, Plus, Search, FileText, CreditCard, DollarSign, Package,
    Calendar, X, Check, AlertTriangle, Clock, Trash2,
    ShoppingCart, Wallet, Printer, Eye, Stamp
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import { ToastViewport, useToast } from './ui/Toast';

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
    ivaExento?: boolean;
    requiresBatchTracking?: boolean;
}

interface CartItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    currentStock: number;
    ivaExento?: boolean;
    requiresBatchTracking?: boolean;
    batchNumber?: string;
    expiryDate?: string;
}

interface PurchaseOrderItemLite {
    id: string;
    productId: string;
    productName: string;
    quantityOrdered: number | string;
    quantityReceived: number | string;
    unitCost: number | string;
}

interface PurchaseOrderLite {
    id: string;
    supplierId: string;
    orderNumber: string;
    status: string;
    items: PurchaseOrderItemLite[];
    receipts?: { items: { productId: string; quantity: number | string }[] }[];
}

interface Purchase {
    id: string;
    supplierId: string;
    supplier: { id: string; name: string };
    invoiceNumber: string;
    date: string;
    dueDate?: string;
    subtotal: number;
    tax: number;
    total: number;
    status: string;
    paymentMethod: string;
    notes?: string;
    items: { id: string; productName: string; quantity: number; unitCost: number; totalCost: number }[];
    createdAt: string;
}

interface PurchaseFormErrors {
    supplierId?: string;
    invoiceNumber?: string;
    dueDate?: string;
    notes?: string;
    items?: string;
}

// ==========================================
// HELPERS
// ==========================================

const formatCurrency = (n: number) => formatMoney(n);
const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
const formatDate = (d: string) => new Date(d).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
// dueDate/expiryDate son días de calendario, no instantes. Prisma los devuelve
// como UTC; formatearlos en la zona local puede mostrar el día anterior.
const formatCalendarDate = (d: string) => new Date(d).toLocaleDateString('es-NI', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
});
const formatCalendarDateLong = (d: string) => new Date(d).toLocaleDateString('es-NI', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});

const firstValidationMessage = (data: any): string | undefined => {
    if (!data?.details || typeof data.details !== 'object') return undefined;
    for (const value of Object.values(data.details)) {
        if (Array.isArray(value) && value.length > 0) return String(value[0]);
    }
    return undefined;
};

const availablePurchaseOrderItems = (purchaseOrder: PurchaseOrderLite) => {
    const billedByProduct = new Map<string, number>();
    for (const receipt of purchaseOrder.receipts ?? []) {
        for (const item of receipt.items) {
            billedByProduct.set(
                item.productId,
                (billedByProduct.get(item.productId) ?? 0) + Number(item.quantity),
            );
        }
    }

    const receivedByProduct = new Map<string, PurchaseOrderItemLite & { availableQuantity: number }>();
    for (const item of purchaseOrder.items) {
        const current = receivedByProduct.get(item.productId);
        if (current) {
            current.availableQuantity += Number(item.quantityReceived);
        } else {
            receivedByProduct.set(item.productId, {
                ...item,
                availableQuantity: Number(item.quantityReceived),
            });
        }
    }

    return [...receivedByProduct.values()]
        .map(item => ({
            ...item,
            availableQuantity: Math.max(
                0,
                item.availableQuantity - (billedByProduct.get(item.productId) ?? 0),
            ),
        }))
        .filter(item => item.availableQuantity > 0);
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function Purchases() {
    // Tab state
    const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');

    // Data
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);

    // New Purchase form
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderLite[]>([]);
    const [selectedPO, setSelectedPO] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT'>('CASH');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formErrors, setFormErrors] = useState<PurchaseFormErrors>({});
    const [paymentToConfirm, setPaymentToConfirm] = useState<{ id: string; invoiceNumber: string } | null>(null);
    const [paying, setPaying] = useState(false);
    const { toast, showToast, dismissToast } = useToast();

    // Invoice modal
    const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);

    // Auth
    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    // ==========================================
    // DATA FETCHING
    // ==========================================

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const [suppRes, prodRes, purchRes, poRes] = await Promise.all([
                fetch('/api/suppliers', { headers, signal: controller.signal }),
                fetch('/api/products', { headers, signal: controller.signal }),
                fetch('/api/purchases', { headers, signal: controller.signal }),
                fetch('/api/purchase-orders', { headers, signal: controller.signal }),
            ]);

            if (suppRes.ok) setSuppliers(await suppRes.json());
            if (prodRes.ok) {
                const productData = await prodRes.json();
                setProducts(Array.isArray(productData) ? productData.map((product: Product) => ({
                    ...product,
                    price: Number(product.price),
                    cost: Number(product.cost),
                    stock: Number(product.stock),
                })) : []);
            }
            if (purchRes.ok) setPurchases(await purchRes.json());
            if (poRes.ok) {
                const poData = await poRes.json();
                setPurchaseOrders(Array.isArray(poData?.data) ? poData.data : []);
            }
            const failed = [
                [suppRes, 'proveedores'],
                [prodRes, 'productos'],
                [purchRes, 'historial'],
                [poRes, 'órdenes de compra'],
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
                        ? { ...c, quantity: c.quantity + 1, totalCost: (c.quantity + 1) * c.unitCost }
                        : c
                );
            }

            return [...currentCart, {
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: 1,
                unitCost: product.cost,
                totalCost: product.cost,
                currentStock: product.stock,
                ivaExento: product.ivaExento,
                requiresBatchTracking: product.requiresBatchTracking,
                batchNumber: '',
                expiryDate: ''
            }];
        });
        setFormErrors(current => ({ ...current, items: undefined }));
        setProductSearch('');
    };

    const updateCartItem = (productId: string, field: 'quantity' | 'unitCost' | 'batchNumber' | 'expiryDate', value: any) => {
        setCart(currentCart => currentCart.map(c => {
            if (c.productId !== productId) return c;
            const updated = { ...c, [field]: value };
            updated.totalCost = updated.quantity * updated.unitCost;
            return updated;
        }));
        setFormErrors(current => ({ ...current, items: undefined }));
    };

    const removeFromCart = (productId: string) => {
        setCart(currentCart => currentCart.filter(c => c.productId !== productId));
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
            const quantity = item.availableQuantity;
            const unitCost = Number(item.unitCost);
            return {
                productId: item.productId,
                productName: item.productName,
                sku: product?.sku ?? '',
                quantity,
                unitCost,
                totalCost: quantity * unitCost,
                currentStock: product?.stock ?? 0,
                ivaExento: product?.ivaExento,
                // Los datos de lote se capturan al recibir la OC; exigirlos otra
                // vez en la factura induciría a duplicar la recepción.
                requiresBatchTracking: false,
                batchNumber: '',
                expiryDate: '',
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
        const subtotal = cart.reduce((sum, c) => sum + c.totalCost, 0);
        const taxableSubtotal = cart.reduce((sum, c) => c.ivaExento ? sum : sum + c.totalCost, 0);
        const tax = taxableSubtotal * 0.15;
        const total = subtotal + tax;
        return { subtotal, taxableSubtotal, tax, total };
    }, [cart]);

    // ==========================================
    // SUBMIT PURCHASE
    // ==========================================

    const handleSubmit = async () => {
        if (submitting) return;

        const errors: PurchaseFormErrors = {};
        if (!selectedSupplier) errors.supplierId = 'Seleccioná un proveedor.';
        if (!invoiceNumber.trim()) errors.invoiceNumber = 'Ingresá el número de factura del proveedor.';
        if (cart.length === 0) errors.items = 'Agregá al menos un producto.';
        if (paymentMethod === 'CREDIT' && !dueDate) errors.dueDate = 'Ingresá la fecha de vencimiento.';
        if (notes.trim().length > 500) errors.notes = 'Las notas no pueden superar 500 caracteres.';

        const invalidItem = cart.find(item =>
            !Number.isInteger(item.quantity) || item.quantity <= 0 ||
            !Number.isFinite(item.unitCost) || item.unitCost <= 0
        );
        if (invalidItem) {
            errors.items = `Revisá cantidad y costo de ${invalidItem.productName}.`;
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
                    invoiceNumber: invoiceNumber.trim(),
                    purchaseOrderId: selectedPO || undefined,
                    paymentMethod,
                    // JSON.stringify omite undefined: los opcionales no viajan como
                    // null y el API también conserva compatibilidad con clientes viejos.
                    dueDate: paymentMethod === 'CREDIT' && dueDate ? dueDate : undefined,
                    notes: notes.trim() || undefined,
                    items: cart.map(c => {
                        return {
                            productId: c.productId,
                            quantity: c.quantity,
                            unitCost: c.unitCost,
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
                setSelectedPO('');
                setInvoiceNumber('');
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
                    invoiceNumber: Array.isArray(details.invoiceNumber) ? String(details.invoiceNumber[0]) : undefined,
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

    const handlePay = (purchaseId: string, invoiceNum: string) => {
        setPaymentToConfirm({ id: purchaseId, invoiceNumber: invoiceNum });
    };

    const confirmPayment = async () => {
        if (!paymentToConfirm || paying) return;

        setPaying(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const res = await fetch(`/api/purchases/${paymentToConfirm.id}/pay`, {
                method: 'POST',
                headers,
                signal: controller.signal,
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                showToast({
                    tone: 'success',
                    title: 'Factura pagada',
                    message: data.message || `La factura #${paymentToConfirm.invoiceNumber} quedó pagada.`,
                });
                setPaymentToConfirm(null);
                void fetchAll();
            } else {
                showToast({
                    tone: 'error',
                    title: 'No se pudo pagar la factura',
                    message: data.error || `El servidor respondió ${res.status}.`,
                });
            }
        } catch (e: any) {
            showToast({
                tone: 'error',
                title: e?.name === 'AbortError' ? 'La conexión tardó demasiado' : 'Error de conexión',
                message: 'No se confirmó el pago. Revisá el historial antes de volver a intentar.',
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

        const itemsHTML = p.items.map(item => `
            <tr>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;font-size:${format === 'ticket' ? '11px' : '13px'}">${escapeHtml(item.productName)}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:center;font-size:${format === 'ticket' ? '11px' : '13px'}">${item.quantity}</td>
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
        <div class="info-row"><span><strong>Fecha:</strong></span><span>${new Date(p.createdAt).toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
        ${p.dueDate ? `<div class="info-row"><span><strong>Vencimiento:</strong></span><span>${formatCalendarDateLong(p.dueDate)}</span></div>` : ''}
        <div class="info-row"><span><strong>Metodo:</strong></span><span>${p.paymentMethod === 'CASH' ? 'Contado' : 'Credito'}</span></div>
        <div class="info-row"><span><strong>Estado:</strong></span><span class="status ${p.status === 'COMPLETED' ? 'paid' : 'pending'}">${p.status === 'COMPLETED' ? 'PAGADO' : 'PENDIENTE'}</span></div>
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

    const pendingPurchases = purchases.filter(p => p.status === 'PENDING_PAYMENT');
    const completedPurchases = purchases.filter(p => p.status === 'COMPLETED');
    const totalDebt = pendingPurchases.reduce((sum, p) => sum + parseFloat(p.total as any), 0);
    const totalPurchasesMonth = purchases.reduce((sum, p) => sum + parseFloat(p.total as any), 0);
    const paymentPurchase = paymentToConfirm
        ? purchases.find(p => p.id === paymentToConfirm.id)
        : undefined;

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="h-full overflow-y-auto bg-slate-900">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            {/* HEADER */}
            <div className="bg-slate-800/80 border-b border-slate-700 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-orange-600 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
                            <Truck size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Compras & Proveedores</h1>
                            <a href="/app/purchase-orders" className="ml-3 px-3 py-1.5 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg text-xs font-bold hover:border-brand transition-colors">Órdenes de Compra →</a>
                            <p className="text-sm text-slate-400">Ingreso de mercaderia y cuentas por pagar</p>
                        </div>
                    </div>

                    {/* KPI Cards */}
                    <div className="flex gap-3">
                        <div className="bg-slate-900/60 border border-slate-700 rounded-lg px-4 py-2 text-center">
                            <p className="text-xs text-slate-400">Compras del Mes</p>
                            <p className="text-lg font-bold text-white">{formatCurrency(totalPurchasesMonth)}</p>
                        </div>
                        <div className={`border rounded-lg px-4 py-2 text-center ${totalDebt > 0 ? 'bg-red-950/40 border-red-800' : 'bg-slate-900/60 border-slate-700'}`}>
                            <p className="text-xs text-slate-400">Cuentas por Pagar</p>
                            <p className={`text-lg font-bold ${totalDebt > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCurrency(totalDebt)}</p>
                        </div>
                    </div>
                </div>

                {/* TABS */}
                <div className="flex gap-1 mt-4 bg-slate-900/60 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab('new')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'new' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Plus size={16} /> Nueva Compra
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'history' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        <FileText size={16} /> Historial
                        {pendingPurchases.length > 0 && (
                            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pendingPurchases.length}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* CONTENT */}
            <div className="p-6">
                {activeTab === 'new' && Object.values(formErrors).some(Boolean) && (
                    <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-700/70 bg-red-950/40 px-4 py-3 text-red-100">
                        <AlertTriangle size={19} className="mt-0.5 shrink-0 text-red-300" />
                        <div>
                            <p className="font-semibold">Hay datos que necesitan tu atención</p>
                            <ul className="mt-1 list-disc pl-4 text-sm text-red-200">
                                {[...new Set(Object.values(formErrors).filter(Boolean))].map(message => (
                                    <li key={message}>{message}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
                {activeTab === 'new' ? (
                    /* ==========================================
                       TAB: NUEVA COMPRA
                       ========================================== */
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* LEFT: Form + Product Search */}
                        <div className="lg:col-span-2 space-y-4">
                            {/* Purchase Info */}
                            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
                                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                    <FileText size={18} className="text-orange-400" />
                                    Datos de la Compra
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1.5">Proveedor *</label>
                                        <select
                                            value={selectedSupplier}
                                            onChange={(e) => changeSupplier(e.target.value)}
                                            aria-invalid={Boolean(formErrors.supplierId)}
                                            className={`w-full px-3 py-2.5 bg-slate-900 border rounded-lg text-white focus:ring-1 ${formErrors.supplierId ? 'border-red-500 focus:border-red-400 focus:ring-red-500' : 'border-slate-700 focus:border-orange-500 focus:ring-orange-500'}`}
                                        >
                                            <option value="">Seleccionar proveedor...</option>
                                            {suppliers.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                        {formErrors.supplierId && <p className="mt-1 text-xs text-red-300">{formErrors.supplierId}</p>}
                                    </div>
                                    {purchaseOrdersForSupplier.length > 0 && (
                                        <div>
                                            <label className="block text-sm text-slate-300 mb-1.5">Orden de compra (opcional)</label>
                                            <select
                                                value={selectedPO}
                                                onChange={(event) => linkPurchaseOrder(event.target.value)}
                                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
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
                                        <label className="block text-sm text-slate-300 mb-1.5"># Factura Proveedor *</label>
                                        <input
                                            value={invoiceNumber}
                                            onChange={(e) => {
                                                setInvoiceNumber(e.target.value);
                                                setFormErrors(current => ({ ...current, invoiceNumber: undefined }));
                                            }}
                                            placeholder="FAC-001234"
                                            aria-invalid={Boolean(formErrors.invoiceNumber)}
                                            className={`w-full px-3 py-2.5 bg-slate-900 border rounded-lg text-white font-mono focus:ring-1 ${formErrors.invoiceNumber ? 'border-red-500 focus:border-red-400 focus:ring-red-500' : 'border-slate-700 focus:border-orange-500 focus:ring-orange-500'}`}
                                        />
                                        {formErrors.invoiceNumber && <p className="mt-1 text-xs text-red-300">{formErrors.invoiceNumber}</p>}
                                    </div>
                                    {selectedPO && (
                                        <div className="col-span-2 flex items-start gap-2 rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2.5 text-sm text-sky-200">
                                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                            <span>
                                                Esta factura queda vinculada a la OC. La recepción maneja el stock y los lotes; aquí solo se registra el dinero y el IVA.
                                            </span>
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1.5">Metodo de Pago *</label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setPaymentMethod('CASH');
                                                    setDueDate('');
                                                    setFormErrors(current => ({ ...current, dueDate: undefined }));
                                                }}
                                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${paymentMethod === 'CASH'
                                                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300'
                                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
                                            >
                                                <DollarSign size={16} /> Contado
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethod('CREDIT')}
                                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${paymentMethod === 'CREDIT'
                                                    ? 'border-amber-500 bg-amber-950/40 text-amber-300'
                                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
                                            >
                                                <CreditCard size={16} /> Credito
                                            </button>
                                        </div>
                                    </div>
                                    {paymentMethod === 'CREDIT' && (
                                        <div>
                                            <label className="block text-sm text-slate-300 mb-1.5">Fecha de Vencimiento *</label>
                                            <input
                                                type="date"
                                                value={dueDate}
                                                onChange={(e) => {
                                                    setDueDate(e.target.value);
                                                    setFormErrors(current => ({ ...current, dueDate: undefined }));
                                                }}
                                                aria-invalid={Boolean(formErrors.dueDate)}
                                                className={`w-full px-3 py-2.5 bg-slate-900 border rounded-lg text-white focus:ring-1 ${formErrors.dueDate ? 'border-red-500 focus:border-red-400 focus:ring-red-500' : 'border-slate-700 focus:border-orange-500 focus:ring-orange-500'}`}
                                            />
                                            {formErrors.dueDate && <p className="mt-1 text-xs text-red-300">{formErrors.dueDate}</p>}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4">
                                    <label className="block text-sm text-slate-300 mb-1.5">Notas (opcional)</label>
                                    <input
                                        value={notes}
                                        onChange={(e) => {
                                            setNotes(e.target.value);
                                            setFormErrors(current => ({ ...current, notes: undefined }));
                                        }}
                                        placeholder="Ej: Pedido semanal, entrega parcial..."
                                        maxLength={500}
                                        aria-invalid={Boolean(formErrors.notes)}
                                        className={`w-full px-3 py-2.5 bg-slate-900 border rounded-lg text-white focus:ring-1 ${formErrors.notes ? 'border-red-500 focus:border-red-400 focus:ring-red-500' : 'border-slate-700 focus:border-orange-500 focus:ring-orange-500'}`}
                                    />
                                    {formErrors.notes && <p className="mt-1 text-xs text-red-300">{formErrors.notes}</p>}
                                </div>
                            </div>

                            {/* Product Search + Add */}
                            <div className={`bg-slate-800/80 border rounded-xl p-5 ${formErrors.items ? 'border-red-600/80' : 'border-slate-700'}`}>
                                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                    <Package size={18} className="text-blue-400" />
                                    Agregar Productos
                                </h3>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        disabled={Boolean(selectedPO)}
                                        placeholder={selectedPO ? 'Los productos vienen de la orden de compra vinculada' : 'Buscar producto por nombre o SKU...'}
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:cursor-not-allowed disabled:text-slate-500"
                                    />
                                    {!selectedPO && filteredProducts.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-20 max-h-60 overflow-y-auto">
                                            {filteredProducts.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => addToCart(p)}
                                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/60 text-left transition-colors border-b border-slate-700/50 last:border-0"
                                                >
                                                    <div>
                                                        <span className="text-white font-medium">{p.name}</span>
                                                        <span className="text-xs text-slate-400 ml-2 font-mono">{p.sku}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-slate-400 text-sm">Costo: {formatCurrency(p.cost)}</span>
                                                        <span className="text-xs text-slate-500 ml-2">Stock: {p.stock}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Cart Items Table */}
                                {cart.length > 0 && (
                                    <div className="mt-4 overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="text-xs text-slate-400 uppercase border-b border-slate-700">
                                                    <th className="text-left py-2 px-2">Producto</th>
                                                    <th className="text-center py-2 px-2 w-24">Cantidad</th>
                                                    <th className="text-center py-2 px-2 w-32">Costo Unit.</th>
                                                    <th className="text-right py-2 px-2 w-28">Total</th>
                                                    <th className="w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cart.map(item => (
                                                    <React.Fragment key={item.productId}>
                                                        <tr className="border-b border-slate-700/50">
                                                            <td className="py-3 px-2">
                                                                <div>
                                                                    <span className="text-white font-medium text-sm">{item.productName}</span>
                                                                    <div className="flex items-center gap-2 mt-0.5">
                                                                        <span className="text-xs text-slate-500 font-mono">{item.sku}</span>
                                                                        <span className="text-xs text-slate-600">Stock actual: {item.currentStock}</span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateCartItem(item.productId, 'quantity', parseInt(e.target.value) || 1)}
                                                                    aria-invalid={Boolean(formErrors.items)}
                                                                    className="w-full text-center bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white text-sm focus:border-orange-500"
                                                                />
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <input
                                                                    type="number"
                                                                    min="0.01"
                                                                    step="0.01"
                                                                    value={item.unitCost}
                                                                    onChange={(e) => updateCartItem(item.productId, 'unitCost', parseFloat(e.target.value) || 0)}
                                                                    aria-invalid={Boolean(formErrors.items)}
                                                                    className="w-full text-center bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white text-sm focus:border-orange-500"
                                                                />
                                                            </td>
                                                            <td className="py-3 px-2 text-right">
                                                                <span className="text-emerald-400 font-bold text-sm">{formatCurrency(item.totalCost)}</span>
                                                            </td>
                                                            <td className="py-3 px-1">
                                                                <button
                                                                    onClick={() => removeFromCart(item.productId)}
                                                                    className="p-1.5 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {item.requiresBatchTracking && (
                                                            <tr className="bg-slate-900/30">
                                                                <td colSpan={5} className="px-3 py-2 border-b border-slate-700/50">
                                                                    <div className="flex gap-4 items-center">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-xs text-orange-400 font-semibold bg-orange-500/10 px-2 py-1 rounded">REQUIERE LOTE</span>
                                                                        </div>
                                                                        <div className="flex-1 flex gap-3">
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Nº Lote"
                                                                                value={item.batchNumber || ''}
                                                                                onChange={(e) => updateCartItem(item.productId, 'batchNumber', e.target.value)}
                                                                                aria-invalid={Boolean(formErrors.items)}
                                                                                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-xs focus:border-orange-500"
                                                                            />
                                                                            <input
                                                                                type="date"
                                                                                value={item.expiryDate || ''}
                                                                                onChange={(e) => updateCartItem(item.productId, 'expiryDate', e.target.value)}
                                                                                aria-invalid={Boolean(formErrors.items)}
                                                                                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-xs focus:border-orange-500"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))}
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
                                    <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300">
                                        <AlertTriangle size={15} /> {formErrors.items}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* RIGHT: Totals + Submit */}
                        <div className="space-y-4">
                            {/* Summary Card */}
                            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 sticky top-6">
                                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                    <Wallet size={18} className="text-emerald-400" />
                                    Resumen de Compra
                                </h3>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Productos</span>
                                        <span className="text-white font-medium">{cart.length} items ({cart.reduce((s, c) => s + c.quantity, 0)} uds)</span>
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
                                    <div className="border-t border-slate-700 pt-3 flex justify-between">
                                        <span className="text-white font-bold text-lg">TOTAL</span>
                                        <span className="text-emerald-400 font-bold text-xl">{formatCurrency(cartTotals.total)}</span>
                                    </div>
                                </div>

                                {paymentMethod === 'CREDIT' && (
                                    <div className="mt-3 bg-amber-950/40 border border-amber-800/50 rounded-lg p-3">
                                        <p className="text-xs text-amber-300 flex items-center gap-1.5">
                                            <Clock size={14} />
                                            Compra a crédito · No se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                {paymentMethod === 'CASH' && (
                                    <div className="mt-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg p-3">
                                        <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                                            <DollarSign size={14} />
                                            Pago de contado · Se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || cart.length === 0}
                                    aria-busy={submitting}
                                    className="w-full mt-5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 disabled:text-slate-500 py-3.5 rounded-lg text-white font-bold text-lg transition-all flex items-center justify-center gap-2"
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
                ) : (
                    /* ==========================================
                       TAB: HISTORIAL / CUENTAS POR PAGAR
                       ========================================== */
                    <div className="space-y-6">
                        {/* Pending Payments */}
                        {pendingPurchases.length > 0 && (
                            <div>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <AlertTriangle size={18} className="text-amber-400" />
                                    Cuentas por Pagar ({pendingPurchases.length})
                                    <span className="text-sm text-red-400 font-normal ml-2">
                                        Total: {formatCurrency(totalDebt)}
                                    </span>
                                </h3>
                                <div className="grid gap-3">
                                    {pendingPurchases.map(p => (
                                        <div key={p.id} className="bg-amber-950/20 border border-amber-800/50 rounded-xl p-4 flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 bg-amber-900/40 rounded-lg flex items-center justify-center">
                                                    <Clock size={20} className="text-amber-400" />
                                                </div>
                                                <div>
                                                    <p className="text-white font-semibold">{p.supplier.name}</p>
                                                    <p className="text-xs text-slate-400">
                                                        Factura #{p.invoiceNumber} | {formatDate(p.createdAt)}
                                                        {p.dueDate && (
                                                            <span className="text-amber-400 ml-2">Vence: {formatCalendarDate(p.dueDate)}</span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xl font-bold text-amber-400">{formatCurrency(parseFloat(p.total as any))}</span>
                                                <button
                                                    onClick={() => viewInvoice(p)}
                                                    className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-slate-300 text-sm transition-colors"
                                                    title="Ver Factura"
                                                >
                                                    <Eye size={15} /> Factura
                                                </button>
                                                <a
                                                    href={`/api/fiscal/constancia-retencion/${p.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 bg-violet-900/40 hover:bg-violet-800/60 border border-violet-700 px-3 py-2 rounded-lg text-violet-300 text-sm transition-colors"
                                                    title="Constancia de Retención"
                                                >
                                                    <Stamp size={15} /> Retención
                                                </a>
                                                <button
                                                    onClick={() => handlePay(p.id, p.invoiceNumber)}
                                                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors"
                                                >
                                                    <DollarSign size={16} /> Pagar
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Completed Purchases */}
                        <div>
                            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                <Check size={18} className="text-emerald-400" />
                                Historial de Compras ({purchases.length})
                            </h3>

                            {purchases.length === 0 ? (
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-12 text-center">
                                    <Truck size={48} className="mx-auto text-slate-600 mb-3" />
                                    <p className="text-slate-400">No hay compras registradas</p>
                                    <p className="text-xs text-slate-600 mt-1">Registra tu primera compra en la pestana "Nueva Compra"</p>
                                </div>
                            ) : (
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-900/80">
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
                                        <tbody className="divide-y divide-slate-700/50">
                                            {purchases.map(p => (
                                                <tr key={p.id} className="hover:bg-slate-700/20 transition-colors">
                                                    <td className="px-4 py-3 text-sm text-slate-300">{formatDate(p.createdAt)}</td>
                                                    <td className="px-4 py-3 text-sm text-white font-medium">{p.supplier.name}</td>
                                                    <td className="px-4 py-3 text-sm text-slate-300 font-mono">{p.invoiceNumber}</td>
                                                    <td className="px-4 py-3 text-sm text-center text-slate-400">{p.items.length} prod.</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`text-xs px-2 py-1 rounded-full ${p.paymentMethod === 'CASH'
                                                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'
                                                            : 'bg-amber-900/40 text-amber-300 border border-amber-700'}`}>
                                                            {p.paymentMethod === 'CASH' ? 'Contado' : 'Credito'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'COMPLETED'
                                                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'
                                                            : 'bg-red-900/40 text-red-300 border border-red-700'}`}>
                                                            {p.status === 'COMPLETED' ? 'Pagado' : 'Pendiente'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-emerald-400">
                                                        {formatCurrency(parseFloat(p.total as any))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                onClick={() => viewInvoice(p)}
                                                                className="p-2 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors"
                                                                title="Ver Factura"
                                                            >
                                                                <Eye size={17} />
                                                            </button>
                                                            <a
                                                                href={`/api/fiscal/constancia-retencion/${p.id}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-2 hover:bg-violet-500/20 rounded-lg text-violet-400 transition-colors inline-flex"
                                                                title="Constancia de Retención"
                                                            >
                                                                <Stamp size={17} />
                                                            </a>
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

            {/* ==========================================
                MODAL: CONFIRMAR PAGO
               ========================================== */}
            {paymentToConfirm && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
                    onClick={() => { if (!paying) setPaymentToConfirm(null); }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirm-payment-title"
                        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                                    <DollarSign size={21} />
                                </div>
                                <div>
                                    <h2 id="confirm-payment-title" className="font-semibold text-white">Confirmar pago</h2>
                                    <p className="text-sm text-slate-400">Factura #{paymentToConfirm.invoiceNumber}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPaymentToConfirm(null)}
                                disabled={paying}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
                                aria-label="Cancelar pago"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="px-5 py-5">
                            <p className="text-sm leading-6 text-slate-300">
                                Este pago se descontará de tu caja y la cuenta quedará marcada como pagada.
                            </p>
                            {paymentPurchase && (
                                <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">
                                    <span className="text-sm text-slate-300">Monto a pagar</span>
                                    <span className="text-xl font-bold text-emerald-300">{formatCurrency(Number(paymentPurchase.total))}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 border-t border-slate-700 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setPaymentToConfirm(null)}
                                disabled={paying}
                                className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={confirmPayment}
                                disabled={paying}
                                aria-busy={paying}
                                className="flex min-w-32 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
                            >
                                {paying && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                {paying ? 'Pagando…' : 'Confirmar pago'}
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
                    <div className="bg-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-gradient-to-r from-orange-900/40 to-red-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <FileText size={20} className="text-orange-400" />
                                    Factura de Compra #{selectedPurchase.invoiceNumber}
                                </h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {selectedPurchase.supplier.name} | {formatDate(selectedPurchase.createdAt)}
                                </p>
                            </div>
                            <button onClick={() => setShowInvoiceModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Invoice Preview */}
                        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                            {/* Company + Supplier Info */}
                            <div className="grid grid-cols-2 gap-6 mb-6">
                                <div>
                                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Comprador</p>
                                    <p className="text-white font-bold text-lg">{tenantName}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Proveedor</p>
                                    <p className="text-white font-bold text-lg">{selectedPurchase.supplier.name}</p>
                                </div>
                            </div>

                            {/* Invoice Details */}
                            <div className="grid grid-cols-4 gap-4 mb-6 bg-slate-900/60 rounded-lg p-4">
                                <div>
                                    <p className="text-xs text-slate-500">Factura #</p>
                                    <p className="text-white font-mono font-bold">{selectedPurchase.invoiceNumber}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Fecha</p>
                                    <p className="text-white">{formatDate(selectedPurchase.createdAt)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Metodo</p>
                                    <p className={selectedPurchase.paymentMethod === 'CASH' ? 'text-emerald-400' : 'text-amber-400'}>
                                        {selectedPurchase.paymentMethod === 'CASH' ? 'Contado' : 'Credito'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Estado</p>
                                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${selectedPurchase.status === 'COMPLETED'
                                        ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'
                                        : 'bg-red-900/40 text-red-300 border border-red-700'}`}>
                                        {selectedPurchase.status === 'COMPLETED' ? 'PAGADO' : 'PENDIENTE'}
                                    </span>
                                </div>
                            </div>

                            {selectedPurchase.dueDate && (
                                <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-3 mb-6 flex items-center gap-2">
                                    <Calendar size={16} className="text-amber-400" />
                                    <span className="text-sm text-amber-300">Vencimiento: {formatCalendarDate(selectedPurchase.dueDate)}</span>
                                </div>
                            )}

                            {/* Items Table */}
                            <table className="w-full mb-6">
                                <thead>
                                    <tr className="border-b-2 border-slate-600">
                                        <th className="text-left py-2 px-3 text-xs text-slate-400 uppercase">Producto</th>
                                        <th className="text-center py-2 px-3 text-xs text-slate-400 uppercase">Cantidad</th>
                                        <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">Costo Unit.</th>
                                        <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedPurchase.items.map((item, idx) => (
                                        <tr key={idx} className="border-b border-slate-700/50">
                                            <td className="py-3 px-3 text-white">{item.productName}</td>
                                            <td className="py-3 px-3 text-center text-slate-300">{item.quantity}</td>
                                            <td className="py-3 px-3 text-right text-slate-400">{formatCurrency(parseFloat(item.unitCost as any))}</td>
                                            <td className="py-3 px-3 text-right text-white font-bold">{formatCurrency(parseFloat(item.totalCost as any))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Totals */}
                            <div className="border-t-2 border-slate-600 pt-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Subtotal</span>
                                    <span className="text-white">{formatCurrency(parseFloat(selectedPurchase.subtotal as any))}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">IVA (15%)</span>
                                    <span className="text-white">{formatCurrency(parseFloat(selectedPurchase.tax as any))}</span>
                                </div>
                                <div className="flex justify-between text-xl font-bold border-t border-slate-600 pt-3">
                                    <span className="text-white">TOTAL</span>
                                    <span className="text-emerald-400">{formatCurrency(parseFloat(selectedPurchase.total as any))}</span>
                                </div>
                            </div>

                            {selectedPurchase.notes && (
                                <div className="mt-4 bg-slate-900/60 rounded-lg p-3">
                                    <p className="text-xs text-slate-500 mb-1">Notas:</p>
                                    <p className="text-sm text-slate-300">{selectedPurchase.notes}</p>
                                </div>
                            )}
                        </div>

                        {/* Footer - Print Buttons */}
                        <div className="bg-slate-900/80 px-6 py-4 border-t border-slate-700 flex items-center justify-between">
                            <p className="text-xs text-slate-500">Generado por NORTEX ERP</p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => printInvoice('ticket')}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium text-sm transition-colors"
                                >
                                    <Printer size={16} /> Ticket 80mm
                                </button>
                                <button
                                    onClick={() => printInvoice('a4')}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 rounded-lg text-white font-bold text-sm transition-colors"
                                >
                                    <Printer size={16} /> Factura A4
                                </button>
                                <a
                                    href={`/api/fiscal/constancia-retencion/${selectedPurchase.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-4 py-2.5 bg-violet-700 hover:bg-violet-600 rounded-lg text-white font-bold text-sm transition-colors"
                                >
                                    <Stamp size={16} /> Constancia DGI
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
