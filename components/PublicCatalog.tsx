import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ShoppingCart, Plus, Minus, X, Send, Phone, User, Store, Search, Share2, Package, Loader2, CheckCircle } from 'lucide-react';

interface CatalogProduct {
    id: string;
    name: string;
    price: number;
    description?: string;
    imageUrl?: string;
    category?: string;
    unit?: string;
}

interface CartItem extends CatalogProduct {
    quantity: number;
}

interface BusinessInfo {
    id: string;
    name: string;
    slug: string;
    phone?: string;
}

const PublicCatalog: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const CART_KEY = `nortex_public_cart_${slug}`;
    const [business, setBusiness] = useState<BusinessInfo | null>(null);
    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [cart, setCart] = useState<CartItem[]>(() => {
        // 🔒 Persistencia: restaurar carrito de localStorage para sobrevivir refrescos
        try {
            const saved = localStorage.getItem(CART_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [showCart, setShowCart] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

    // Checkout state
    const [showCheckout, setShowCheckout] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [direccionEntrega, setDireccionEntrega] = useState('');
    const [referenciaDireccion, setReferenciaDireccion] = useState('');
    const [notas, setNotas] = useState('');
    const [phoneError, setPhoneError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [orderSuccess, setOrderSuccess] = useState(false);
    const [lastOrderId, setLastOrderId] = useState('');
    const [lastWhatsappUrl, setLastWhatsappUrl] = useState('');

    // 🔒 Persistir carrito en localStorage ante cada cambio
    useEffect(() => {
        if (cart.length > 0) {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
        } else {
            localStorage.removeItem(CART_KEY);
        }
    }, [cart, CART_KEY]);

    useEffect(() => {
        fetchCatalog();
    }, [slug]);

    const fetchCatalog = async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/public/catalog/${slug}`);
            if (!res.ok) {
                setError('Catálogo no encontrado');
                return;
            }
            const data = await res.json();
            setBusiness(data.business);
            setProducts(data.products);
        } catch (err) {
            setError('Error al cargar el catálogo');
        } finally {
            setLoading(false);
        }
    };

    const addToCart = (product: CatalogProduct) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
                );
            }
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const updateQuantity = (id: string, delta: number) => {
        setCart(prev =>
            prev.map(item => {
                if (item.id !== id) return item;
                const newQty = item.quantity + delta;
                return newQty <= 0 ? item : { ...item, quantity: newQty };
            }).filter(item => item.quantity > 0)
        );
    };

    const removeFromCart = (id: string) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    const generateWhatsAppLink = (
        cartItems: CartItem[],
        businessInfo: BusinessInfo,
        orderId: string,
        total: number
    ): string => {
        const orderNum = orderId.slice(-8).toUpperCase();
        const itemLines = cartItems
            .map(item => `- ${item.quantity}x ${item.name} (C$ ${(item.price * item.quantity).toFixed(2)})`)
            .join('\n');
        const message =
            `Hola ${businessInfo.name}, quiero hacer el pedido #${orderNum} por un total de C$ ${total.toFixed(2)}.\n\n` +
            `Detalles:\n${itemLines}\n\nPor favor, confírmenme mi pedido.`;
        const phone = businessInfo.phone?.replace(/\D/g, '') || '';
        return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    };

    // 🔒 Validación teléfono Nicaragua (8 dígitos)
    const validatePhone = (phone: string): boolean => {
        if (!phone.trim()) return true; // Opcional
        const digits = phone.replace(/\D/g, '');
        // Acepta: 8 dígitos locales o 505 + 8 dígitos
        if (digits.length !== 8 && digits.length !== 11) {
            setPhoneError('Número inválido. Usa 8 dígitos (ej: 8888-0000)');
            return false;
        }
        setPhoneError('');
        return true;
    };

    const handleSubmitOrder = async () => {
        if (!customerName.trim()) return alert('Ingresa tu nombre');
        if (!customerPhone.trim()) return alert('Ingresa tu teléfono');
        if (!direccionEntrega.trim()) return alert('Ingresa tu dirección de entrega');
        if (!validatePhone(customerPhone)) return;
        setSubmitting(true);

        // Snapshot cart + total before clearing
        const cartSnapshot = [...cart];
        const totalSnapshot = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

        try {
            const res = await fetch('/api/v1/pedidos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId: business?.id,
                    clienteNombre: customerName.trim(),
                    clienteTelefono: customerPhone.trim(),
                    direccionEntrega: direccionEntrega.trim(),
                    referenciaDireccion: referenciaDireccion.trim(),
                    notas: notas.trim(),
                    items: cart.map(item => ({
                        productoId: item.id,
                        cantidad: item.quantity
                    })),
                }),
            });

            if (res.ok) {
                const data = await res.json();
                const orderId: string = data.pedido?.id || '';
                setLastOrderId(orderId);

                // 🚀 Abrir WhatsApp automáticamente con resumen del pedido
                if (business?.phone && orderId) {
                    const waUrl = generateWhatsAppLink(cartSnapshot, business, orderId, totalSnapshot);
                    setLastWhatsappUrl(waUrl);
                    window.open(waUrl, '_blank');
                }

                setOrderSuccess(true);
                setCart([]); // Triggers localStorage cleanup via useEffect
                setCustomerName('');
                setCustomerPhone('');
                setDireccionEntrega('');
                setReferenciaDireccion('');
                setNotas('');
                setPhoneError('');
            } else {
                const data = await res.json();
                alert(data.error || 'Error al enviar pedido');
            }
        } catch {
            alert('Error de conexión');
        } finally {
            setSubmitting(false);
        }
    };

    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const whatsappShare = `https://wa.me/?text=${encodeURIComponent(`¡Mira el catálogo de ${business?.name || ''}! ${shareUrl}`)}`;

    const categories = ['ALL', ...Array.from(new Set(products.map(p => p.category || 'Otros').filter(Boolean)))];
    const filteredProducts = products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.description || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchCategory = selectedCategory === 'ALL' || (p.category || 'Otros') === selectedCategory;
        return matchSearch && matchCategory;
    });

    // ---- ORDER SUCCESS SCREEN ----
    if (orderSuccess) {
        const orderNum = lastOrderId ? lastOrderId.slice(-8).toUpperCase() : '';
        return (
            <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="text-emerald-600" size={40} />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-1">¡Pedido Enviado!</h1>
                    {orderNum && (
                        <p className="text-sm font-mono text-slate-400 mb-3">Pedido #{orderNum}</p>
                    )}
                    <p className="text-slate-500 mb-6">
                        <strong>{business?.name}</strong> recibirá tu pedido y se pondrá en contacto contigo pronto.
                    </p>

                    {lastWhatsappUrl && (
                        <a
                            href={lastWhatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full bg-green-500 text-white px-6 py-4 rounded-2xl font-bold text-base hover:bg-green-600 active:scale-[0.98] transition-all shadow-lg shadow-green-200 mb-3"
                        >
                            <Phone size={20} /> Confirmar pedido por WhatsApp
                        </a>
                    )}

                    <p className="text-xs text-slate-400 mb-4">
                        {lastWhatsappUrl
                            ? 'Si WhatsApp no se abrió automáticamente, toca el botón de arriba.'
                            : `Contáctalos directamente para confirmar tu pedido.`}
                    </p>

                    <button
                        onClick={() => {
                            setOrderSuccess(false);
                            setShowCheckout(false);
                            setShowCart(false);
                            setLastOrderId('');
                            setLastWhatsappUrl('');
                        }}
                        className="block w-full text-blue-600 font-medium hover:underline"
                    >
                        Volver al catálogo
                    </button>
                </div>
            </div>
        );
    }

    // ---- LOADING / ERROR ----
    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" size={40} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
                    <Package className="text-slate-300 mx-auto mb-4" size={48} />
                    <h1 className="text-xl font-bold text-slate-700 mb-2">Catálogo no disponible</h1>
                    <p className="text-slate-400">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
                <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
                            <Store className="text-white" size={20} />
                        </div>
                        <div>
                            <h1 className="font-bold text-slate-900 text-lg leading-tight">{business?.name}</h1>
                            <p className="text-xs text-slate-400">Catálogo en línea</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={whatsappShare}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                            title="Compartir por WhatsApp"
                        >
                            <Share2 size={20} />
                        </a>
                        <button
                            onClick={() => setShowCart(true)}
                            className="relative p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                        >
                            <ShoppingCart size={20} />
                            {cartCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center animate-bounce">
                                    {cartCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            {/* Search + Categories */}
            <div className="max-w-6xl mx-auto px-4 py-4 space-y-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar productos..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-slate-800 shadow-sm transition-all"
                    />
                </div>

                {categories.length > 2 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${selectedCategory === cat
                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
                                    }`}
                            >
                                {cat === 'ALL' ? 'Todos' : cat}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Product Grid */}
            <div className="max-w-6xl mx-auto px-4 pb-28">
                {filteredProducts.length === 0 ? (
                    <div className="text-center py-16 text-slate-400">
                        <Package size={40} className="mx-auto mb-3 opacity-50" />
                        <p>No se encontraron productos</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        {filteredProducts.map(product => {
                            const inCart = cart.find(c => c.id === product.id);
                            return (
                                <div
                                    key={product.id}
                                    className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all duration-300 overflow-hidden group"
                                >
                                    {/* Product Image */}
                                    <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-50 relative overflow-hidden">
                                        {product.imageUrl ? (
                                            <img
                                                src={product.imageUrl}
                                                alt={product.name}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Package className="text-slate-200" size={40} />
                                            </div>
                                        )}
                                        {product.category && (
                                            <span className="absolute top-2 left-2 text-[10px] font-semibold bg-white/90 backdrop-blur text-slate-600 px-2 py-0.5 rounded-lg">
                                                {product.category}
                                            </span>
                                        )}
                                    </div>

                                    {/* Product Info */}
                                    <div className="p-3">
                                        <h3 className="font-semibold text-slate-800 text-sm leading-tight line-clamp-2 mb-1">
                                            {product.name}
                                        </h3>
                                        {product.description && (
                                            <p className="text-xs text-slate-400 line-clamp-1 mb-2">{product.description}</p>
                                        )}
                                        <div className="flex items-center justify-between mt-2">
                                            <div>
                                                <span className="text-lg font-bold text-slate-900">
                                                    C${product.price.toFixed(2)}
                                                </span>
                                                {product.unit && product.unit !== 'unidad' && (
                                                    <span className="text-xs text-slate-400 ml-1">/{product.unit}</span>
                                                )}
                                            </div>
                                            {inCart ? (
                                                <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl px-1">
                                                    <button
                                                        onClick={() => updateQuantity(product.id, -1)}
                                                        className="p-1 rounded-lg hover:bg-blue-100 text-blue-600"
                                                    >
                                                        <Minus size={14} />
                                                    </button>
                                                    <span className="text-sm font-bold text-blue-700 min-w-[20px] text-center">{inCart.quantity}</span>
                                                    <button
                                                        onClick={() => updateQuantity(product.id, 1)}
                                                        className="p-1 rounded-lg hover:bg-blue-100 text-blue-600"
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => addToCart(product)}
                                                    className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-200 hover:shadow-lg transition-all active:scale-95"
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Floating Cart Button (mobile) */}
            {cartCount > 0 && !showCart && (
                <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-6 sm:w-auto">
                    <button
                        onClick={() => setShowCart(true)}
                        className="w-full sm:w-auto flex items-center justify-between gap-4 bg-blue-600 text-white px-6 py-4 rounded-2xl shadow-2xl shadow-blue-300 hover:bg-blue-700 transition-all active:scale-[0.98]"
                    >
                        <div className="flex items-center gap-3">
                            <ShoppingCart size={20} />
                            <span className="font-bold">{cartCount} {cartCount === 1 ? 'item' : 'items'}</span>
                        </div>
                        <span className="font-bold text-lg">C${cartTotal.toFixed(2)}</span>
                    </button>
                </div>
            )}

            {/* Cart Drawer */}
            {showCart && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowCart(false); setShowCheckout(false); }} />
                    <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
                        {/* Cart Header */}
                        <div className="flex items-center justify-between p-5 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <ShoppingCart size={20} className="text-blue-600" />
                                {showCheckout ? 'Finalizar Pedido' : 'Tu Carrito'}
                            </h2>
                            <button onClick={() => { setShowCart(false); setShowCheckout(false); }} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        {!showCheckout ? (
                            <>
                                {/* Cart Items */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                    {cart.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400">
                                            <ShoppingCart size={32} className="mx-auto mb-2 opacity-40" />
                                            <p className="text-sm">Tu carrito está vacío</p>
                                        </div>
                                    ) : (
                                        cart.map(item => (
                                            <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                                                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                    {item.imageUrl ? (
                                                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Package className="text-slate-300" size={20} />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                                                    <p className="text-xs text-slate-400">C${item.price.toFixed(2)} × {item.quantity}</p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">
                                                        <Minus size={12} />
                                                    </button>
                                                    <span className="text-sm font-bold text-slate-800 w-6 text-center">{item.quantity}</span>
                                                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600">
                                                        <Plus size={12} />
                                                    </button>
                                                    <button onClick={() => removeFromCart(item.id)} className="p-1 rounded-lg text-slate-300 hover:text-red-500 ml-1">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* Cart Footer */}
                                {cart.length > 0 && (
                                    <div className="p-5 border-t border-slate-100 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 font-medium">Total</span>
                                            <span className="text-2xl font-bold text-slate-900">C${cartTotal.toFixed(2)}</span>
                                        </div>
                                        <button
                                            onClick={() => setShowCheckout(true)}
                                            className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-bold text-base hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                                        >
                                            <Send size={18} /> Finalizar Pedido
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            /* Checkout Form */
                            <div className="p-5 space-y-4">
                                <p className="text-sm text-slate-500 mb-2">
                                    Ingresa tus datos para que <strong>{business?.name}</strong> reciba tu pedido.
                                </p>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                        Tu Nombre *
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            placeholder="Nombre completo"
                                            value={customerName}
                                            onChange={e => setCustomerName(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-slate-800"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                        Teléfono / WhatsApp *
                                    </label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="tel"
                                            placeholder="8888-0000"
                                            value={customerPhone}
                                            onChange={e => { setCustomerPhone(e.target.value); setPhoneError(''); }}
                                            onBlur={() => validatePhone(customerPhone)}
                                            className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-800 ${phoneError ? 'border-red-300 focus:border-red-400' : 'border-slate-200 focus:border-blue-400'
                                                }`}
                                        />
                                    </div>
                                    {phoneError && (
                                        <p className="text-xs text-red-500 mt-1">{phoneError}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                        Dirección de Entrega *
                                    </label>
                                    <textarea
                                        placeholder="Ej: Del parque central 2 cuadras al sur..."
                                        value={direccionEntrega}
                                        onChange={e => setDireccionEntrega(e.target.value)}
                                        rows={2}
                                        className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-slate-800 resize-none"
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                            Referencia (Opcional)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Color de casa, portón, etc."
                                            value={referenciaDireccion}
                                            onChange={e => setReferenciaDireccion(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-slate-800"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                            Notas al comercio
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej: Empaquetar para regalo"
                                            value={notas}
                                            onChange={e => setNotas(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-slate-800"
                                        />
                                    </div>
                                </div>

                                {/* Order Summary */}
                                <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                                    {cart.map(item => (
                                        <div key={item.id} className="flex justify-between text-sm">
                                            <span className="text-slate-600">{item.quantity}× {item.name}</span>
                                            <span className="font-medium text-slate-800">C${(item.price * item.quantity).toFixed(2)}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200 mt-2">
                                        <span className="text-slate-700">Total</span>
                                        <span className="text-slate-900">C${cartTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowCheckout(false)}
                                        className="flex-1 py-3 border border-slate-200 rounded-xl font-semibold text-slate-600 hover:bg-slate-50 transition-all"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={handleSubmitOrder}
                                        disabled={submitting || !customerName.trim() || !customerPhone.trim() || !direccionEntrega.trim()}
                                        className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                                        {submitting ? 'Enviando...' : 'Enviar Pedido'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Custom animations */}
            <style>{`
                @keyframes slide-up {
                    from { transform: translateY(100%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .animate-slide-up {
                    animation: slide-up 0.3s ease-out;
                }
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
};

export default PublicCatalog;
