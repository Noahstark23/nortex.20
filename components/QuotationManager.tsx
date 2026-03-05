import React, { useState, useEffect } from 'react';
import { FileText, Plus, Search, ShoppingCart, Calendar, User, Printer, ArrowRight, Trash2, Clock, CheckCircle, Globe, Phone, Package, Loader2, RefreshCw } from 'lucide-react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Quotation, PublicOrder } from '../types';
import { useNavigate } from 'react-router-dom';

const QuotationManager: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'NEW' | 'HISTORY' | 'WEB_ORDERS'>('NEW');

    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);

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
    const [searchTerm, setSearchTerm] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerRuc, setCustomerRuc] = useState('');

    // Persistence for history
    const [history, setHistory] = useState<Quotation[]>([]);

    // Web Orders (Public Orders)
    const [webOrders, setWebOrders] = useState<PublicOrder[]>([]);
    const [loadingWebOrders, setLoadingWebOrders] = useState(false);
    const [convertingId, setConvertingId] = useState<string | null>(null);

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

    useEffect(() => {
        fetchQuotations();
        fetchWebOrders();
    }, []);

    // --- LOGIC ---
    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = total * 0.15; // IVA 15% Nicaragua
    const grandTotal = total + tax;

    const handleSaveQuotation = async () => {
        if (cart.length === 0) return alert("Agrega productos primero.");
        if (!customerName) return alert("Ingresa el nombre del cliente.");

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
                    items: cart, // Backend will calculate totals
                    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
                })
            });

            if (res.ok) {
                const savedQuote = await res.json();
                setHistory(prev => [savedQuote, ...prev]);

                // Reset
                setCart([]);
                setCustomerName('');
                setCustomerRuc('');
                setActiveTab('HISTORY');
                alert(`✅ Cotización ${savedQuote.id} generada exitosamente.`);
            } else {
                alert('Error al guardar cotización');
            }
        } catch (error) {
            console.error('Error saving quotation:', error);
            alert('Error de conexión al guardar cotización');
        }
    };

    const convertToSale = (quote: Quotation) => {
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
                alert('✅ Pedido convertido en cotización exitosamente.');
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
        <div className="flex h-full bg-slate-100 overflow-hidden">
            {/* Left Panel: Navigation & Products/List */}
            <div className="flex-1 flex flex-col border-r border-slate-200 bg-white text-slate-800">
                <div className="p-6 border-b border-slate-200 text-slate-800">
                    <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                        <FileText className="text-nortex-500" /> Cotizaciones B2B
                    </h1>
                    <div className="flex gap-2 mt-6">
                        <button
                            onClick={() => setActiveTab('NEW')}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'NEW' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                            + NUEVA
                        </button>
                        <button
                            onClick={() => setActiveTab('HISTORY')}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'HISTORY' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                            HISTORIAL
                        </button>
                        <button
                            onClick={() => { setActiveTab('WEB_ORDERS'); fetchWebOrders(); }}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all relative ${activeTab === 'WEB_ORDERS' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
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
                        <div className="p-4 border-b border-slate-100 text-slate-800">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Buscar productos para cotizar..."
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-nortex-500"
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
                                    className="p-3 text-left border border-slate-200 rounded-lg hover:border-nortex-500 hover:bg-slate-50 transition-all group text-slate-800"
                                >
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                                        <div className="opacity-0 group-hover:opacity-100 text-nortex-600 bg-nortex-100 p-1 rounded-full"><Plus size={14} /></div>
                                    </div>
                                    <div className="font-medium text-slate-800 text-sm line-clamp-1 mt-1">{product.name}</div>
                                    <div className="font-bold text-slate-900 mt-1">${product.price.toFixed(2)}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : activeTab === 'HISTORY' ? (
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {history.length === 0 && <div className="text-center text-slate-400 mt-10">No hay cotizaciones guardadas.</div>}
                        {history.map(quote => (
                            <div key={quote.id} className="p-4 mb-3 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-slate-50 text-slate-800">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-nortex-900">{quote.customerName}</h3>
                                        <span className="text-xs text-slate-500 font-mono">ID: {quote.id}</span>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded font-bold ${quote.status === 'CONVERTED' ? 'bg-green-100 text-green-700' :
                                        quote.status === 'EXPIRED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
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
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-slate-500">
                                Pedidos recibidos desde tu catálogo público
                            </p>
                            <button
                                onClick={fetchWebOrders}
                                disabled={loadingWebOrders}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
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
                                const orderItems = (order.items || []) as any[];
                                const orderTotal = orderItems.reduce((sum: number, item: any) =>
                                    sum + (Number(item.price) * Number(item.quantity)), 0
                                );

                                return (
                                    <div
                                        key={order.id}
                                        className={`p-4 mb-3 border rounded-xl transition-all ${order.status === 'PENDING'
                                            ? 'border-emerald-200 bg-emerald-50/50 hover:shadow-md'
                                            : 'border-slate-200 bg-slate-50 opacity-70'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                                                    <User size={14} className="text-slate-400" />
                                                    {order.customerName}
                                                </h3>
                                                {order.customerPhone && (
                                                    <a
                                                        href={`https://wa.me/${order.customerPhone.replace(/\D/g, '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-xs text-green-600 hover:underline flex items-center gap-1 mt-0.5"
                                                    >
                                                        <Phone size={10} /> {order.customerPhone}
                                                    </a>
                                                )}
                                            </div>
                                            <span className={`text-xs px-2 py-1 rounded font-bold ${order.status === 'PENDING'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-green-100 text-green-700'
                                                }`}>
                                                {order.status === 'PENDING' ? 'PENDIENTE' : 'CONVERTIDO'}
                                            </span>
                                        </div>

                                        {/* Items preview */}
                                        <div className="bg-white/80 rounded-lg p-2 mb-3 space-y-1">
                                            {orderItems.slice(0, 4).map((item: any, idx: number) => (
                                                <div key={idx} className="flex justify-between text-xs text-slate-600">
                                                    <span className="truncate flex-1">{item.quantity}× {item.name}</span>
                                                    <span className="font-medium ml-2">C${(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
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
                                                <span className="font-bold text-slate-900">C${orderTotal.toFixed(2)}</span>
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
                <div className="w-96 bg-slate-50 flex flex-col border-l border-slate-200 text-slate-800">
                    <div className="p-6 border-b border-slate-200 bg-white text-slate-800">
                        <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2">Detalle de Cotización</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-mono text-slate-500 mb-1">CLIENTE / EMPRESA</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-800"
                                        placeholder="Nombre del Cliente"
                                        value={customerName}
                                        onChange={e => setCustomerName(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-mono text-slate-500 mb-1">RUC / NIT (Opcional)</label>
                                <input
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-800"
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
                                <div key={item.id} className="flex justify-between items-center bg-white p-3 rounded border border-slate-200 text-sm text-slate-800">
                                    <div>
                                        <div className="font-medium text-slate-800 line-clamp-1">{item.name}</div>
                                        <div className="text-xs text-slate-500">{item.quantity} x ${item.price.toFixed(2)}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-bold">${(item.quantity * item.price).toFixed(2)}</span>
                                        <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-6 bg-white border-t border-slate-200 text-slate-800">
                        <div className="space-y-2 text-sm mb-4">
                            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>${total.toFixed(2)}</span></div>
                            <div className="flex justify-between text-slate-500"><span>Impuesto (18%)</span><span>${tax.toFixed(2)}</span></div>
                            <div className="flex justify-between font-bold text-nortex-900 text-lg pt-2 border-t border-slate-100 text-slate-800"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button className="py-3 border border-slate-300 rounded-lg font-bold text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 text-slate-800">
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
