import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Truck, Plus, Search, FileText, CreditCard, DollarSign, Package,
    Calendar, Hash, X, Check, AlertTriangle, Clock, ArrowRight, Trash2,
    ShoppingCart, TrendingUp, Wallet, Printer, Eye
} from 'lucide-react';

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
}

interface CartItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    currentStock: number;
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

// ==========================================
// HELPERS
// ==========================================

const formatCurrency = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: string) => new Date(d).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });

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
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT'>('CASH');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);

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
        try {
            const [suppRes, prodRes, purchRes] = await Promise.all([
                fetch('/api/suppliers', { headers }),
                fetch('/api/products', { headers }),
                fetch('/api/purchases', { headers })
            ]);

            if (suppRes.ok) setSuppliers(await suppRes.json());
            if (prodRes.ok) setProducts(await prodRes.json());
            if (purchRes.ok) setPurchases(await purchRes.json());
        } catch (e) {
            console.error('Error fetching data:', e);
        } finally {
            setLoading(false);
        }
    }, [headers]);

    useEffect(() => { fetchAll(); }, []);

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
        const existing = cart.find(c => c.productId === product.id);
        if (existing) {
            setCart(cart.map(c =>
                c.productId === product.id
                    ? { ...c, quantity: c.quantity + 1, totalCost: (c.quantity + 1) * c.unitCost }
                    : c
            ));
        } else {
            setCart([...cart, {
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: 1,
                unitCost: product.cost,
                totalCost: product.cost,
                currentStock: product.stock
            }]);
        }
        setProductSearch('');
    };

    const updateCartItem = (productId: string, field: 'quantity' | 'unitCost', value: number) => {
        setCart(cart.map(c => {
            if (c.productId !== productId) return c;
            const updated = { ...c, [field]: value };
            updated.totalCost = updated.quantity * updated.unitCost;
            return updated;
        }));
    };

    const removeFromCart = (productId: string) => {
        setCart(cart.filter(c => c.productId !== productId));
    };

    const cartTotals = useMemo(() => {
        const subtotal = cart.reduce((sum, c) => sum + c.totalCost, 0);
        const tax = subtotal * 0.15;
        const total = subtotal + tax;
        return { subtotal, tax, total };
    }, [cart]);

    // ==========================================
    // SUBMIT PURCHASE
    // ==========================================

    const handleSubmit = async () => {
        if (!selectedSupplier) return alert('Selecciona un proveedor.');
        if (!invoiceNumber.trim()) return alert('Ingresa el # de factura.');
        if (cart.length === 0) return alert('Agrega al menos un producto.');
        if (paymentMethod === 'CREDIT' && !dueDate) return alert('Ingresa la fecha de vencimiento para compras a credito.');

        setSubmitting(true);
        try {
            const res = await fetch('/api/purchases', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    supplierId: selectedSupplier,
                    invoiceNumber: invoiceNumber.trim(),
                    paymentMethod,
                    dueDate: paymentMethod === 'CREDIT' ? dueDate : null,
                    notes: notes.trim() || null,
                    items: cart.map(c => ({
                        productId: c.productId,
                        quantity: c.quantity,
                        unitCost: c.unitCost
                    }))
                })
            });

            const data = await res.json();

            if (res.ok) {
                alert(`Compra registrada exitosamente. Stock actualizado.`);
                // Reset form
                setSelectedSupplier('');
                setInvoiceNumber('');
                setPaymentMethod('CASH');
                setDueDate('');
                setNotes('');
                setCart([]);
                fetchAll();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de conexion al servidor.');
        } finally {
            setSubmitting(false);
        }
    };

    // ==========================================
    // PAY PENDING
    // ==========================================

    const handlePay = async (purchaseId: string, invoiceNum: string) => {
        if (!confirm(`Pagar factura #${invoiceNum}? Se descontara de tu caja.`)) return;

        try {
            const res = await fetch(`/api/purchases/${purchaseId}/pay`, {
                method: 'POST',
                headers
            });
            const data = await res.json();

            if (res.ok) {
                alert(data.message);
                fetchAll();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de conexion.');
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
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;font-size:${format === 'ticket' ? '11px' : '13px'}">${item.productName}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:center;font-size:${format === 'ticket' ? '11px' : '13px'}">${item.quantity}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-size:${format === 'ticket' ? '11px' : '13px'}">C$ ${parseFloat(item.unitCost as any).toFixed(2)}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold;font-size:${format === 'ticket' ? '11px' : '13px'}">C$ ${parseFloat(item.totalCost as any).toFixed(2)}</td>
            </tr>
        `).join('');

        const isTicket = format === 'ticket';
        const width = isTicket ? '80mm' : '210mm';
        const fontFamily = isTicket ? 'monospace' : 'Arial, sans-serif';

        const html = `<!DOCTYPE html>
<html><head><title>Factura Compra #${p.invoiceNumber}</title>
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
        <div class="title">${tenantName}</div>
        <div class="subtitle">Documento de Ingreso de Mercaderia</div>
    </div>

    <div class="info">
        <div class="info-row"><span><strong>Factura #:</strong></span><span>${p.invoiceNumber}</span></div>
        <div class="info-row"><span><strong>Proveedor:</strong></span><span>${p.supplier.name}</span></div>
        <div class="info-row"><span><strong>Fecha:</strong></span><span>${new Date(p.createdAt).toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
        ${p.dueDate ? `<div class="info-row"><span><strong>Vencimiento:</strong></span><span>${new Date(p.dueDate).toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>` : ''}
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
        <div class="total-row"><span>Subtotal:</span><span>C$ ${parseFloat(p.subtotal as any).toFixed(2)}</span></div>
        <div class="total-row"><span>IVA (15%):</span><span>C$ ${parseFloat(p.tax as any).toFixed(2)}</span></div>
        <div class="total-row grand-total"><span>TOTAL:</span><span>C$ ${parseFloat(p.total as any).toFixed(2)}</span></div>
    </div>

    ${p.notes ? `<div style="margin-top:10px;font-size:${isTicket ? '10px' : '12px'};color:#666"><strong>Notas:</strong> ${p.notes}</div>` : ''}

    <div class="footer">
        <p>Generado por NORTEX ERP | ${new Date().toLocaleString('es-NI')}</p>
    </div>
</body></html>`;

        const printWindow = window.open('', '_blank', `width=${isTicket ? 350 : 800},height=600`);
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => printWindow.print(), 300);
        }
    };

    // ==========================================
    // COMPUTED
    // ==========================================

    const pendingPurchases = purchases.filter(p => p.status === 'PENDING_PAYMENT');
    const completedPurchases = purchases.filter(p => p.status === 'COMPLETED');
    const totalDebt = pendingPurchases.reduce((sum, p) => sum + parseFloat(p.total as any), 0);
    const totalPurchasesMonth = purchases.reduce((sum, p) => sum + parseFloat(p.total as any), 0);

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="h-full overflow-y-auto bg-slate-900">
            {/* HEADER */}
            <div className="bg-slate-800/80 border-b border-slate-700 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-orange-600 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
                            <Truck size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Compras & Proveedores</h1>
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
                                            onChange={(e) => setSelectedSupplier(e.target.value)}
                                            className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                                        >
                                            <option value="">Seleccionar proveedor...</option>
                                            {suppliers.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1.5"># Factura Proveedor *</label>
                                        <input
                                            value={invoiceNumber}
                                            onChange={(e) => setInvoiceNumber(e.target.value)}
                                            placeholder="FAC-001234"
                                            className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1.5">Metodo de Pago *</label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethod('CASH')}
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
                                                onChange={(e) => setDueDate(e.target.value)}
                                                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4">
                                    <label className="block text-sm text-slate-300 mb-1.5">Notas (opcional)</label>
                                    <input
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Ej: Pedido semanal, entrega parcial..."
                                        className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                                    />
                                </div>
                            </div>

                            {/* Product Search + Add */}
                            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
                                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                    <Package size={18} className="text-blue-400" />
                                    Agregar Productos
                                </h3>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        placeholder="Buscar producto por nombre o SKU..."
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                                    />
                                    {filteredProducts.length > 0 && (
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
                                                    <tr key={item.productId} className="border-b border-slate-700/50">
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
                                            Compra a credito - No se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                {paymentMethod === 'CASH' && (
                                    <div className="mt-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg p-3">
                                        <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                                            <DollarSign size={14} />
                                            Pago de contado - Se descuenta de caja
                                        </p>
                                    </div>
                                )}

                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || cart.length === 0}
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
                                            Procesar Ingreso
                                        </>
                                    )}
                                </button>

                                <p className="text-xs text-slate-500 text-center mt-2">
                                    Stock se actualiza automaticamente
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
                                                            <span className="text-amber-400 ml-2">Vence: {formatDate(p.dueDate)}</span>
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
                                                        <button
                                                            onClick={() => viewInvoice(p)}
                                                            className="p-2 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors"
                                                            title="Ver Factura"
                                                        >
                                                            <Eye size={17} />
                                                        </button>
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
                                    <span className="text-sm text-amber-300">Vencimiento: {formatDate(selectedPurchase.dueDate)}</span>
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
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
