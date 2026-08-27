import React, { useState, useEffect } from 'react';
import { FileText, Plus, Search, ShoppingCart, Calendar, User, Printer, ArrowRight, Trash2, Clock, CheckCircle, Globe, Phone, Loader2, RefreshCw, Copy, Minus } from 'lucide-react';
import { Product, CartItem, Quotation, PublicOrder } from '../types';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '../utils/money';
import Decimal from 'decimal.js';
import { formatQuantityValue, validateQuantity } from '../utils/quantity';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    includedVatFromGross,
    normalizeFiscalRegime,
    resolveSaleFiscalAmounts,
    type FiscalRegime,
} from '../utils/fiscalRegime';
import {
    normalizeFiscalSettingsSnapshot,
    type FiscalSettingsSnapshot,
} from '../utils/fiscalSettingsSnapshot';

type FiscalQuotation = Quotation & {
    fiscalRegimeAtQuote?: FiscalRegime;
};

const fiscalSettingsFromTenantCache = (): FiscalSettingsSnapshot => {
    try {
        return normalizeFiscalSettingsSnapshot(
            JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}'),
        );
    } catch {
        return normalizeFiscalSettingsSnapshot(undefined);
    }
};

const cacheFiscalSettings = (settings: FiscalSettingsSnapshot): void => {
    try {
        const raw = localStorage.getItem('nortex_tenant_data');
        if (!raw) return;
        const tenant = JSON.parse(raw);
        if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant) || typeof tenant.id !== 'string') return;
        localStorage.setItem('nortex_tenant_data', JSON.stringify({ ...tenant, ...settings }));
    } catch {
        // El cache es un fallback; una entrada ilegible no bloquea cotizaciones.
    }
};

const sanitizeDecimalInput = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
};

const effectiveSaleMode = (product: Pick<Product, 'saleMode'>): 'COUNTED' | 'MEASURED' =>
    product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';

const effectiveQuantityStep = (product: Pick<Product, 'saleMode' | 'quantityStep'>): number => {
    if (Number.isFinite(product.quantityStep) && Number(product.quantityStep) > 0) {
        return Number(product.quantityStep);
    }
    return product.saleMode === 'COUNTED' ? 1 : 0.0001;
};

const publicOrderLineTotal = (item: Record<string, unknown>): Decimal => {
    try {
        const quantity = new Decimal(String(item.quantityExact ?? item.quantity));
        const price = new Decimal(String(item.unitPriceExact ?? item.price));
        if (!quantity.isFinite() || !quantity.greaterThan(0) || !price.isFinite()) return new Decimal(0);
        return price.mul(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } catch {
        return new Decimal(0);
    }
};

const QuotationManager: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'NEW' | 'HISTORY' | 'WEB_ORDERS'>('NEW');

    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [fiscalSettings, setFiscalSettings] = useState<FiscalSettingsSnapshot>(fiscalSettingsFromTenantCache);

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/products', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setProducts(data);
            }
        } catch (error) {
            console.error('Error fetching products:', error);
        }
    };

    const fetchFiscalSettings = async () => {
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/tenant/fiscal-settings', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const payload = await res.json();
            setFiscalSettings(previous => {
                const normalized = normalizeFiscalSettingsSnapshot(payload, previous);
                cacheFiscalSettings(normalized);
                return normalized;
            });
        } catch {
            // Sin red se conserva el régimen/version del tenant cacheado.
        }
    };
    const [searchTerm, setSearchTerm] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerRuc, setCustomerRuc] = useState('');
    const [quantityErrors, setQuantityErrors] = useState<Record<string, string>>({});

    // Persistence for history
    const [history, setHistory] = useState<FiscalQuotation[]>([]);

    // Web Orders (Public Orders)
    const [webOrders, setWebOrders] = useState<PublicOrder[]>([]);
    const [loadingWebOrders, setLoadingWebOrders] = useState(false);
    const [convertingId, setConvertingId] = useState<string | null>(null);

    // Tenant Info for Public Catalog Link
    const [tenantSlug, setTenantSlug] = useState<string | null>(null);
    const [businessName, setBusinessName] = useState<string>('');
    const [copiedInfo, setCopiedInfo] = useState(false);
    const [creatingSlug, setCreatingSlug] = useState(false);

    // Fetch from API
    const fetchQuotations = async () => {
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/quotations', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } catch (error) {
            console.error('Error fetching quotations:', error);
        }
    };

    const fetchWebOrders = async () => {
        setLoadingWebOrders(true);
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/public-orders', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setWebOrders(data);
            }
        } catch (error) {
            console.error('Error fetching web orders:', error);
        } finally {
            setLoadingWebOrders(false);
        }
    };

    const fetchTenantInfo = async () => {
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/tenant/info', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTenantSlug(data.slug);
                setBusinessName(data.businessName || 'tienda');
            }
        } catch (error) {
            console.error('Error fetching tenant info:', error);
        }
    };

    const handleCreateSlug = async () => {
        if (!businessName) return;
        setCreatingSlug(true);
        // Generar un slug simple (letras, números, guiones) sin espacios ni caracteres raros
        let baseSlug = businessName.toLowerCase().trim()
            .replace(/[^\w\s-]/g, '') // Remove non-word [a-z0-9_], non-whitespace, non-hyphen chars
            .replace(/[\s_-]+/g, '-') // Swap whitespace, underscores and hyphens with a single hyphen
            .replace(/^-+|-+$/g, ''); // Trim hyphens

        // Si el baseSlug queda muy corto, le agregamos un prefijo
        if (baseSlug.length < 3) baseSlug = `tienda-${baseSlug || Math.floor(Math.random() * 10000)}`;

        const generatedSlug = baseSlug;

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/tenant/slug', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ slug: generatedSlug })
            });

            if (res.ok) {
                setTenantSlug(generatedSlug);
                alert('¡Enlace de catálogo generado exitosamente!');
            } else {
                const data = await res.json();
                alert(data.error || 'Error al generar el enlace. Intenta cambiar el nombre de tu empresa.');
            }
        } catch (error) {
            console.error('Error creating slug:', error);
            alert('Error de conexión al generar el enlace');
        } finally {
            setCreatingSlug(false);
        }
    };

    useEffect(() => {
        fetchQuotations();
        fetchWebOrders();
        fetchTenantInfo();
        fetchFiscalSettings();
    }, []);

    // --- LOGIC ---
    const addToCart = (product: Product) => {
        const step = effectiveQuantityStep(product);
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                const newQuantity = new Decimal(existing.quantity).plus(step).toNumber();
                return prev.map(item => item.id === product.id ? { ...item, quantity: newQuantity } : item);
            }
            return [...prev, { ...product, quantity: step }];
        });
        setQuantityErrors(prev => {
            if (!prev[product.id]) return prev;
            const next = { ...prev };
            delete next[product.id];
            return next;
        });
    };

    const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

    const setItemQuantity = (id: string, raw: string) => {
        const product = cart.find((item) => item.id === id);
        if (!product) return;
        const clean = sanitizeDecimalInput(raw);
        if (!clean) {
            setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: 0 as unknown as number } : item));
            setQuantityErrors(prev => ({ ...prev, [id]: 'La cantidad es obligatoria' }));
            return;
        }
        try {
            const valid = validateQuantity(clean, {
                saleMode: effectiveSaleMode(product),
                quantityStep: effectiveQuantityStep(product),
            });
            setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: valid.toNumber() } : item));
            setQuantityErrors(prev => {
                if (!prev[id]) return prev;
                const next = { ...prev };
                delete next[id];
                return next;
            });
        } catch (error) {
            setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: Number(clean) || item.quantity } : item));
            setQuantityErrors(prev => ({ ...prev, [id]: error instanceof Error ? error.message : 'Cantidad inválida' }));
        }
    };

    const bumpItemQuantity = (id: string, direction: -1 | 1) => {
        const product = cart.find((item) => item.id === id);
        if (!product) return;
        const step = new Decimal(effectiveQuantityStep(product));
        const current = new Decimal(product.quantity);
        const next = direction > 0 ? current.plus(step) : Decimal.max(current.minus(step), step);
        setItemQuantity(id, next.toString());
    };

    // T1: el precio del producto es de GÓNDOLA — YA incluye el IVA (así lo trata
    // la venta: neto = total / 1.15). Antes acá se le sumaba 15% ENCIMA, así que
    // la proforma mostraba un total ~15% mayor al que el POS le cobra al cliente.
    // El IVA se deriva por RESTA para que neto + IVA === total exacto.
    const quoteTotals = cart.reduce((acc, item) => {
        const lineTotal = new Decimal(item.price)
            .mul(item.quantity)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        acc.grand = acc.grand.plus(lineTotal);
        if (item.ivaExento) {
            acc.subtotal = acc.subtotal.plus(lineTotal);
            return acc;
        }
        const iva = includedVatFromGross(lineTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const net = lineTotal.minus(iva);
        acc.subtotal = acc.subtotal.plus(net);
        acc.tax = acc.tax.plus(iva);
        return acc;
    }, { subtotal: new Decimal(0), tax: new Decimal(0), grand: new Decimal(0) });
    const grandTotal = quoteTotals.grand.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const generalTax = quoteTotals.tax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const quoteFiscalAmounts = resolveSaleFiscalAmounts(
        grandTotal,
        generalTax,
        fiscalSettings.fiscalRegime,
    );
    const total = quoteFiscalAmounts.netRevenue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const tax = quoteFiscalAmounts.vatAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const isFixedQuota = quoteFiscalAmounts.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA;

    const handleSaveQuotation = async () => {
        if (cart.length === 0) return alert("Agrega productos primero.");
        if (!customerName) return alert("Ingresa el nombre del cliente.");
        if (Object.keys(quantityErrors).length > 0) return alert('Corregí las cantidades marcadas antes de guardar.');

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/quotations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    customerName,
                    customerRuc,
                    items: cart.map((item) => ({
                        productId: item.id,
                        quantity: formatQuantityValue(item.quantity),
                    })),
                    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
                })
            });

            if (res.ok) {
                const response = await res.json();
                // El POST recalcula importes y régimen desde el tenant del JWT.
                // Si los devuelve, esos snapshots reemplazan la proyección local.
                const savedQuote: FiscalQuotation = {
                    ...response,
                    tax: response.tax ?? tax.toNumber(),
                    subtotal: response.subtotal ?? total.toNumber(),
                    total: response.total ?? grandTotal.toNumber(),
                    fiscalRegimeAtQuote: normalizeFiscalRegime(
                        response.fiscalRegimeAtQuote ?? fiscalSettings.fiscalRegime,
                    ),
                };
                setHistory(prev => [savedQuote, ...prev]);

                // Reset
                setCart([]);
                setCustomerName('');
                setCustomerRuc('');
                setActiveTab('HISTORY');
                alert(`Cotización ${savedQuote.id} generada exitosamente.`);
            } else {
                alert('Error al guardar cotización');
            }
        } catch (error) {
            console.error('Error saving quotation:', error);
            alert('Error de conexión al guardar cotización');
        }
    };

    const convertToSale = (quote: FiscalQuotation) => {
        if (confirm(`¿Convertir Cotización ${quote.id} en una Venta Activa?`)) {
            // WE USE THE EXISTING HOOK IN POS.TSX
            localStorage.setItem('nortex_pending_cart', JSON.stringify(quote.items));

            // Mark as converted
            const updated = history.map(q => q.id === quote.id ? { ...q, status: 'CONVERTED' as const } : q);
            setHistory(updated);
            localStorage.setItem('nortex_quotations', JSON.stringify(updated));

            navigate('/app/pos');
        }
    };

    const convertWebOrder = async (order: PublicOrder) => {
        if (!confirm(`¿Convertir pedido de "${order.customerName}" en Cotización?`)) return;
        setConvertingId(order.id);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch(`/api/public-orders/${order.id}/convert`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                alert('Pedido convertido en cotización exitosamente.');
                // Refresh both lists
                await Promise.all([fetchWebOrders(), fetchQuotations()]);
                setActiveTab('HISTORY');
            } else {
                const data = await res.json();
                alert(data.error || 'Error al convertir pedido');
            }
        } catch (error) {
            console.error('Error converting web order:', error);
            alert('Error de conexión');
        } finally {
            setConvertingId(null);
        }
    };

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const pendingWebOrders = webOrders.filter(o => o.status === 'PENDING');

    return (
        <div className="flex h-full bg-white/[0.04] overflow-hidden">
            {/* Left Panel: Navigation & Products/List */}
            <div className="flex-1 flex flex-col border-r border-white/[0.06] bg-surface-900 text-slate-100">
                <div className="p-6 border-b border-white/[0.06] text-slate-100">
                    <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                        <FileText className="text-nortex-500" /> Proformas
                    </h1>
                    <div className="flex gap-2 mt-6">
                        <button
                            onClick={() => setActiveTab('NEW')}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'NEW' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-surface-900 border-white/[0.06] text-slate-500'}`}
                        >
                            + NUEVA
                        </button>
                        <button
                            onClick={() => setActiveTab('HISTORY')}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'HISTORY' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-surface-900 border-white/[0.06] text-slate-500'}`}
                        >
                            HISTORIAL
                        </button>
                        <button
                            onClick={() => { setActiveTab('WEB_ORDERS'); fetchWebOrders(); }}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all relative ${activeTab === 'WEB_ORDERS' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-surface-900 border-white/[0.06] text-slate-500'}`}
                        >
                            <Globe size={14} className="inline mr-1" />
                            PEDIDOS WEB
                            {pendingWebOrders.length > 0 && (
                                <span className="absolute -top-2 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                    {pendingWebOrders.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {activeTab === 'NEW' ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-white/[0.04] text-slate-100">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Buscar productos para cotizar..."
                                    className="w-full pl-10 pr-4 py-2 bg-surface-800/40 border border-white/[0.06] rounded-lg focus:outline-none focus:border-nortex-500"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 content-start custom-scrollbar">
                            {filteredProducts.map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => addToCart(product)}
                                    className="p-3 text-left border border-white/[0.06] rounded-lg hover:border-nortex-500 hover:bg-surface-800/40 transition-all group text-slate-100"
                                >
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                                        <div className="opacity-0 group-hover:opacity-100 text-nortex-600 bg-nortex-100 p-1 rounded-full"><Plus size={14} /></div>
                                    </div>
                                    <div className="font-medium text-slate-100 text-sm line-clamp-1 mt-1">{product.name}</div>
                                        <div className="font-bold text-white mt-1">{formatMoney(product.price)}</div>
                                        <div className="mt-1 text-[11px] text-slate-500">
                                            {effectiveSaleMode(product) === 'COUNTED'
                                                ? `Contado · paso ${formatQuantityValue(effectiveQuantityStep(product))}`
                                                : `Medido · ${product.unit || 'unidad'} · paso ${formatQuantityValue(effectiveQuantityStep(product))}`}
                                        </div>
                                    </button>
                                ))}
                            </div>
                    </div>
                ) : activeTab === 'HISTORY' ? (
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {history.length === 0 && <div className="text-center text-slate-400 mt-10">No hay cotizaciones guardadas.</div>}
                        {history.map(quote => (
                            <div key={quote.id} className="p-4 mb-3 border border-white/[0.06] rounded-xl hover:shadow-md transition-shadow bg-surface-800/40 text-slate-100">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-slate-100">{quote.customerName}</h3>
                                        <span className="text-xs text-slate-500 font-mono">ID: {quote.id}</span>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded font-bold ${quote.status === 'CONVERTED' ? 'bg-green-500/15 text-green-400' :
                                        quote.status === 'EXPIRED' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'
                                        }`}>
                                        {quote.status}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="text-xs text-slate-500">
                                        <div className="flex items-center gap-1"><Calendar size={12} /> {new Date(quote.createdAt).toLocaleDateString()}</div>
                                        <div className="flex items-center gap-1 text-red-400"><Clock size={12} /> Vence: {new Date(quote.expiresAt).toLocaleDateString()}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-lg">${quote.total.toFixed(2)}</div>
                                        {quote.status === 'SENT' && (
                                            <button
                                                onClick={() => convertToSale(quote)}
                                                className="mt-2 flex items-center gap-1 text-xs bg-nortex-900 text-white px-3 py-1.5 rounded hover:bg-nortex-800 transition-colors"
                                            >
                                                Convertir a Venta <ArrowRight size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* WEB_ORDERS Tab */
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {tenantSlug ? (
                            <div className="mb-6 bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                                {/* Decorative Blur */}
                                <div className="absolute -top-10 -right-10 w-32 h-32 bg-nortex-500/30 rounded-full blur-3xl pointer-events-none"></div>

                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                                    <div>
                                        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                                            <Globe className="text-nortex-400" size={20} />
                                            Tu Catálogo Público
                                        </h3>
                                        <p className="text-sm text-slate-300 mb-3">
                                            Comparte este enlace para que tus clientes hagan pedidos directamente.
                                        </p>
                                        <div className="flex items-center gap-2 bg-black/30 p-2 rounded-lg border border-white/10 w-fit">
                                            <span className="text-sm font-mono text-slate-200 select-all pb-1">
                                                {`${window.location.origin}/pedidos/${tenantSlug}`}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 min-w-[180px]">
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(`${window.location.origin}/pedidos/${tenantSlug}`);
                                                setCopiedInfo(true);
                                                setTimeout(() => setCopiedInfo(false), 2000);
                                            }}
                                            className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all"
                                        >
                                            {copiedInfo ? <CheckCircle size={16} className="text-green-400" /> : <Copy size={16} />}
                                            {copiedInfo ? '¡Copiado!' : 'Copiar Enlace'}
                                        </button>
                                        <a
                                            href={`https://wa.me/?text=${encodeURIComponent(`¡Hola! Visita nuestro catálogo en línea y haz tu pedido aquí: ${window.location.origin}/pedidos/${tenantSlug}`)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-whatsapp hover:bg-whatsapp-hover text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                                        >
                                            <Phone size={16} />
                                            Enviar por WhatsApp
                                        </a>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="mb-6 bg-surface-900 border border-white/[0.06] rounded-xl p-5 shadow-sm text-center">
                                <Globe className="mx-auto text-slate-400 mb-2" size={32} />
                                <h3 className="font-bold text-slate-100 mb-1">Activa tu Catálogo Público</h3>
                                <p className="text-sm text-slate-500 mb-4">Aún no tienes un enlace público para compartir con tus clientes.</p>
                                <button
                                    onClick={handleCreateSlug}
                                    disabled={creatingSlug}
                                    className="px-4 py-2 bg-nortex-900 hover:bg-nortex-800 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all mx-auto disabled:opacity-50"
                                >
                                    {creatingSlug ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                                    Generar Enlace Ahora
                                </button>
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-slate-500">
                                Pedidos recibidos desde tu catálogo público
                            </p>
                            <button
                                onClick={fetchWebOrders}
                                disabled={loadingWebOrders}
                                className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-slate-300 transition-colors"
                            >
                                <RefreshCw size={16} className={loadingWebOrders ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        {loadingWebOrders && webOrders.length === 0 ? (
                            <div className="text-center py-10 text-slate-400">
                                <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                                <p className="text-sm">Cargando pedidos...</p>
                            </div>
                        ) : webOrders.length === 0 ? (
                            <div className="text-center py-10 text-slate-400">
                                <Globe className="mx-auto mb-3 opacity-40" size={40} />
                                <p className="font-medium text-slate-500">No hay pedidos web</p>
                                <p className="text-xs mt-1">Comparte tu catálogo para recibir pedidos</p>
                            </div>
                        ) : (
                            webOrders.map(order => {
                                const orderItems = (order.items || []) as Record<string, unknown>[];
                                const orderTotal = orderItems.reduce(
                                    (sum, item) => sum.plus(publicOrderLineTotal(item)),
                                    new Decimal(0),
                                );

                                return (
                                    <div
                                        key={order.id}
                                        className={`p-4 mb-3 border rounded-xl transition-all ${order.status === 'PENDING'
                                            ? 'border-emerald-500/20 bg-emerald-500/10 hover:shadow-md'
                                            : 'border-white/[0.06] bg-surface-800/40 opacity-70'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h3 className="font-bold text-white flex items-center gap-2">
                                                    <User size={14} className="text-slate-400" />
                                                    {order.customerName}
                                                </h3>
                                                {order.customerPhone && (
                                                    <a
                                                        href={`https://wa.me/${order.customerPhone.replace(/\D/g, '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-xs text-green-400 hover:underline flex items-center gap-1 mt-0.5"
                                                    >
                                                        <Phone size={10} /> {order.customerPhone}
                                                    </a>
                                                )}
                                            </div>
                                            <span className={`text-xs px-2 py-1 rounded font-bold ${order.status === 'PENDING'
                                                ? 'bg-amber-500/15 text-amber-400'
                                                : 'bg-green-500/15 text-green-400'
                                                }`}>
                                                {order.status === 'PENDING' ? 'PENDIENTE' : 'CONVERTIDO'}
                                            </span>
                                        </div>

                                        {/* Items preview */}
                                        <div className="bg-white/80 rounded-lg p-2 mb-3 space-y-1">
                                            {orderItems.slice(0, 4).map((item, idx) => (
                                                <div key={idx} className="flex justify-between text-xs text-slate-300">
                                                    <span className="truncate flex-1">
                                                        {String(item.presentationQuantityAtSale ?? item.quantityExact ?? item.quantity)} {String(
                                                            item.presentationAtSale === 'PACK'
                                                                ? item.packUnit ?? 'empaque'
                                                                : item.unit ?? 'unidad',
                                                        )} · {String(item.name ?? '')}
                                                    </span>
                                                    <span className="font-medium ml-2">{formatMoney(publicOrderLineTotal(item).toNumber())}</span>
                                                </div>
                                            ))}
                                            {orderItems.length > 4 && (
                                                <p className="text-xs text-slate-400">+{orderItems.length - 4} más...</p>
                                            )}
                                        </div>

                                        <div className="flex justify-between items-center">
                                            <div className="text-xs text-slate-400 flex items-center gap-1">
                                                <Clock size={12} />
                                                {new Date(order.createdAt).toLocaleString()}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-white">{formatMoney(orderTotal.toNumber())}</span>
                                                {order.status === 'PENDING' && (
                                                    <button
                                                        onClick={() => convertWebOrder(order)}
                                                        disabled={convertingId === order.id}
                                                        className="flex items-center gap-1.5 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors font-semibold disabled:opacity-50"
                                                    >
                                                        {convertingId === order.id ? (
                                                            <Loader2 className="animate-spin" size={12} />
                                                        ) : (
                                                            <ArrowRight size={12} />
                                                        )}
                                                        Convertir en Cotización
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* Right Panel: Active Quotation Details */}
            {activeTab === 'NEW' && (
                <div className="w-96 bg-surface-800/40 flex flex-col border-l border-white/[0.06] text-slate-100">
                    <div className="p-6 border-b border-white/[0.06] bg-surface-900 text-slate-100">
                        <h2 className="font-bold text-slate-100 mb-4 flex items-center gap-2">Detalle de Cotización</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-mono text-slate-500 mb-1">CLIENTE / EMPRESA</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        className="bg-transparent w-full pl-9 pr-3 py-2 border border-white/[0.06] rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-100"
                                        placeholder="Nombre del Cliente"
                                        value={customerName}
                                        onChange={e => setCustomerName(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-mono text-slate-500 mb-1">RUC / NIT (Opcional)</label>
                                <input
                                    className="bg-transparent w-full px-3 py-2 border border-white/[0.06] rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-100"
                                    placeholder="00000000000"
                                    value={customerRuc}
                                    onChange={e => setCustomerRuc(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                                <ShoppingCart size={32} />
                                <p className="text-sm mt-2 text-center">Agrega items para cotizar</p>
                            </div>
                        ) : (
                            cart.map(item => (
                                <div key={item.id} className="bg-surface-900 p-3 rounded border border-white/[0.06] text-sm text-slate-100">
                                    <div className="flex justify-between items-start gap-3">
                                        <div className="min-w-0">
                                            <div className="font-medium text-slate-100 line-clamp-1">{item.name}</div>
                                            <div className="text-xs text-slate-500">
                                                {effectiveSaleMode(item) === 'COUNTED' ? 'Contado' : 'Medido'} · {item.unit || 'unidad'} · paso {formatQuantityValue(effectiveQuantityStep(item))}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {formatMoney(item.price)} / {item.unit || 'unidad'}
                                            </div>
                                        </div>
                                        <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-1 bg-surface-800/60 rounded-lg border border-white/[0.06] p-1">
                                            <button
                                                onClick={() => bumpItemQuantity(item.id, -1)}
                                                className="w-9 h-9 flex items-center justify-center rounded text-slate-300 hover:bg-white/[0.06]"
                                                aria-label={`Restar ${formatQuantityValue(effectiveQuantityStep(item))} ${item.unit || 'unidad'} de ${item.name}`}
                                            >
                                                <Minus size={15} />
                                            </button>
                                            <input
                                                value={formatQuantityValue(item.quantity)}
                                                onChange={(event) => setItemQuantity(item.id, event.target.value)}
                                                inputMode="decimal"
                                                className="w-20 bg-transparent text-center font-mono text-sm outline-none"
                                                aria-label={`Cantidad de ${item.name}`}
                                            />
                                            <button
                                                onClick={() => bumpItemQuantity(item.id, 1)}
                                                className="w-9 h-9 flex items-center justify-center rounded text-slate-300 hover:bg-white/[0.06]"
                                                aria-label={`Agregar ${formatQuantityValue(effectiveQuantityStep(item))} ${item.unit || 'unidad'} a ${item.name}`}
                                            >
                                                <Plus size={15} />
                                            </button>
                                        </div>
                                        <div className="text-right">
                                            <span className="font-bold">{formatMoney(new Decimal(item.price).mul(item.quantity).toNumber())}</span>
                                        </div>
                                    </div>
                                    {quantityErrors[item.id] && <p className="mt-2 text-[11px] text-red-400">{quantityErrors[item.id]}</p>}
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-6 bg-surface-900 border-t border-white/[0.06] text-slate-100">
                        <div className="space-y-2 text-sm mb-4">
                            {!isFixedQuota && (
                                <>
                                    <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="font-mono tabular-nums">{formatMoney(total.toNumber())}</span></div>
                                    <div className="flex justify-between text-slate-500"><span>IVA (15%)</span><span className="font-mono tabular-nums">{formatMoney(tax.toNumber())}</span></div>
                                </>
                            )}
                            <div className="flex justify-between font-bold text-slate-100 text-lg pt-2 border-t border-white/[0.04]"><span>Total</span><span className="font-mono tabular-nums">{formatMoney(grandTotal.toNumber())}</span></div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button className="py-3 border border-white/10 rounded-lg font-bold text-slate-300 hover:bg-surface-800/40 flex items-center justify-center gap-2 text-slate-100">
                                <Printer size={18} /> IMPRIMIR
                            </button>
                            <button
                                onClick={handleSaveQuotation}
                                className="py-3 bg-nortex-900 text-white rounded-lg font-bold hover:bg-nortex-800 flex items-center justify-center gap-2"
                            >
                                <CheckCircle size={18} /> GUARDAR
                            </button>
                        </div>
                        <p className="text-xs text-center text-slate-400 mt-3">
                            Válido por 15 días. Se generará un enlace público.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuotationManager;
