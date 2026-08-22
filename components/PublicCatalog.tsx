import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Decimal from 'decimal.js';
import { ShoppingCart, Plus, Minus, X, Send, Phone, User, Store, Search, Share2, Package, Loader2, CheckCircle } from 'lucide-react';
import { formatMoney } from '../utils/money';
import { formatQuantityValue, validateQuantity } from '../utils/quantity';

type PublicPresentation = 'BASE' | 'PACK';

interface CatalogProduct {
    id: string;
    name: string;
    price: number | string;
    description?: string;
    imageUrl?: string;
    category?: string;
    unit?: string;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: number | string | null;
    packUnit?: string | null;
    packSize?: number | string | null;
    packPrice?: number | string | null;
}

interface CartItem extends CatalogProduct {
    /** Cantidad de la presentación elegida; el servidor deriva unidades base. */
    quantity: string;
    presentation: PublicPresentation;
}

interface BusinessInfo {
    name: string;
    slug: string;
    phone?: string;
}

const productRules = (product: CatalogProduct, presentation: PublicPresentation) => ({
    saleMode: presentation === 'PACK'
        ? 'COUNTED' as const
        : product.saleMode === 'COUNTED'
            ? 'COUNTED' as const
            : 'MEASURED' as const,
    quantityStep: presentation === 'PACK'
        ? '1'
        : String(product.quantityStep ?? (product.saleMode === 'COUNTED' ? '1' : '0.0001')),
});

const hasPackPresentation = (product: CatalogProduct): boolean => {
    try {
        const packPrice = new Decimal(product.packPrice ?? 0);
        const packSize = new Decimal(product.packSize ?? 0);
        return Boolean(
            product.packUnit?.trim()
            && product.packPrice !== null
            && product.packPrice !== undefined
            && product.packSize !== null
            && product.packSize !== undefined
            && packPrice.isFinite()
            && packPrice.greaterThan(0)
            && packSize.isFinite()
            && packSize.greaterThan(0),
        );
    } catch {
        return false;
    }
};

const defaultQuantity = (product: CatalogProduct, presentation: PublicPresentation): string => {
    const rules = productRules(product, presentation);
    try {
        return formatQuantityValue(validateQuantity('1', rules));
    } catch {
        return formatQuantityValue(validateQuantity(rules.quantityStep, rules));
    }
};

const normalizedCartQuantity = (
    product: CatalogProduct,
    presentation: PublicPresentation,
    value: unknown,
): string => formatQuantityValue(validateQuantity(String(value), productRules(product, presentation)));

const cartQuantityOrDefault = (
    product: CatalogProduct,
    presentation: PublicPresentation,
    value: unknown,
): Decimal => {
    try {
        return new Decimal(normalizedCartQuantity(product, presentation, value));
    } catch {
        return new Decimal(defaultQuantity(product, presentation));
    }
};

export const reconcilePublicCatalogCart = (
    cachedItems: unknown,
    publicProducts: CatalogProduct[],
): CartItem[] => {
    if (!Array.isArray(cachedItems)) return [];
    return cachedItems.flatMap((cached: unknown) => {
        if (!cached || typeof cached !== 'object') return [];
        const record = cached as Record<string, unknown>;
        const product = publicProducts.find(candidate => candidate.id === record.id);
        if (!product) return [];
        const requestedPresentation: PublicPresentation = record.presentation === 'PACK'
            ? 'PACK'
            : 'BASE';
        // Un PACK retirado no se convierte silenciosamente en unidades BASE:
        // el número representa empaques y cambiar su significado alteraría el
        // pedido. Se descarta la línea para que el cliente la elija de nuevo.
        if (requestedPresentation === 'PACK' && !hasPackPresentation(product)) return [];
        try {
            return [{
                ...product,
                presentation: requestedPresentation,
                quantity: normalizedCartQuantity(product, requestedPresentation, record.quantity),
            }];
        } catch {
            return [];
        }
    });
};

const presentationUnit = (item: CatalogProduct, presentation: PublicPresentation): string => (
    presentation === 'PACK' ? item.packUnit?.trim() || 'empaque' : item.unit?.trim() || 'unidad'
);

const presentationPrice = (item: CatalogProduct, presentation: PublicPresentation): Decimal => (
    new Decimal(presentation === 'PACK' ? item.packPrice ?? 0 : item.price)
);

const cartLineTotal = (item: CartItem): Decimal => {
    try {
        return presentationPrice(item, item.presentation).mul(new Decimal(item.quantity));
    } catch {
        return new Decimal(0);
    }
};

const PublicCatalog: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const CART_KEY = `nortex_public_cart_${slug}`;
    const [business, setBusiness] = useState<BusinessInfo | null>(null);
    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [cart, setCart] = useState<CartItem[]>(() => {
        try {
            const saved = localStorage.getItem(CART_KEY);
            if (!saved) return [];
            
            const parsed = JSON.parse(saved);
            // 🛡️ BLINDAJE: Si la data se corrompió y no es un array, la destruimos.
            if (!Array.isArray(parsed)) throw new Error("Data corrupta en carrito");
            
            return parsed;
        } catch (error) { 
            // Si explota el parseo, nukeamos el storage para evitar la pantalla blanca
            console.warn("Carrito corrupto detectado. Limpiando...");
            localStorage.removeItem(CART_KEY);
            return []; 
        }
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
    // Checkout híbrido: DELIVERY crea un Pedido (módulo motorizados+tracking);
    // QUOTE crea un PublicOrder → Cotización mayorista (flujo B2B).
    const [orderMode, setOrderMode] = useState<'DELIVERY' | 'QUOTE'>('DELIVERY');
    const [lastTrackingPath, setLastTrackingPath] = useState('');

    // 🔒 Persistir carrito en localStorage (sin imágenes para no reventar la cuota de 5MB)
    useEffect(() => {
        try {
            if (cart.length > 0) {
                const leanCart = cart.map(({ imageUrl, description, ...rest }) => rest);
                localStorage.setItem(CART_KEY, JSON.stringify(leanCart));
            } else {
                localStorage.removeItem(CART_KEY);
            }
        } catch {
            // QuotaExceededError — el carrito vive solo en memoria esta sesión
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
            
            setBusiness(data.business || null);
            // 🛡️ BLINDAJE: Si products viene null/undefined, forzamos un array vacío [] 
            // Esto evita que .map() o .filter() crasheen la app más abajo.
            const publicProducts: CatalogProduct[] = Array.isArray(data.products) ? data.products : [];
            setProducts(publicProducts);
            // LocalStorage es solo cache de UX: rehidratar siempre con el
            // catalogo publicado actual y descartar cantidades ya invalidas.
            setCart(previous => reconcilePublicCatalogCart(previous, publicProducts));
            
        } catch (err) {
            setError('Error al cargar el catálogo');
        } finally {
            setLoading(false);
        }
    };

    const addToCart = (product: CatalogProduct, presentation: PublicPresentation = 'BASE') => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id && item.presentation === presentation);
            if (existing) {
                return prev.map(item =>
                    item.id === product.id && item.presentation === presentation
                        ? {
                            ...item,
                            quantity: formatQuantityValue(
                                cartQuantityOrDefault(item, presentation, item.quantity)
                                    .plus(productRules(item, presentation).quantityStep),
                            ),
                        }
                        : item
                );
            }
            return [...prev, { ...product, presentation, quantity: defaultQuantity(product, presentation) }];
        });
    };

    const updateQuantity = (id: string, presentation: PublicPresentation, direction: -1 | 1) => {
        setCart(prev =>
            prev.flatMap(item => {
                if (item.id !== id || item.presentation !== presentation) return [item];
                const next = cartQuantityOrDefault(item, presentation, item.quantity).plus(
                    new Decimal(productRules(item, presentation).quantityStep).mul(direction),
                );
                if (!next.greaterThan(0)) return [];
                return [{ ...item, quantity: formatQuantityValue(next) }];
            }),
        );
    };

    const updateQuantityInput = (id: string, presentation: PublicPresentation, value: string) => {
        if (!/^\d*(?:\.\d{0,4})?$/.test(value)) return;
        setCart(prev => prev.map(item => (
            item.id === id && item.presentation === presentation
                ? { ...item, quantity: value }
                : item
        )));
    };

    const commitQuantityInput = (id: string, presentation: PublicPresentation) => {
        setCart(prev => prev.map(item => {
            if (item.id !== id || item.presentation !== presentation) return item;
            try {
                return { ...item, quantity: normalizedCartQuantity(item, presentation, item.quantity) };
            } catch {
                return { ...item, quantity: defaultQuantity(item, presentation) };
            }
        }));
    };

    const removeFromCart = (id: string, presentation: PublicPresentation) => {
        setCart(prev => prev.filter(item => item.id !== id || item.presentation !== presentation));
    };

    const cartTotal = cart.reduce((sum, item) => sum.plus(cartLineTotal(item)), new Decimal(0));
    const cartCount = cart.length;

    const generateWhatsAppLink = (
        cartItems: CartItem[],
        businessInfo: BusinessInfo,
        orderId: string,
        total: number,
        trackingUrl?: string
    ): string => {
        const orderNum = orderId.slice(-8).toUpperCase();
        const itemLines = cartItems
            .map(item => `- ${item.quantity} ${presentationUnit(item, item.presentation)} de ${item.name} (${formatMoney(cartLineTotal(item).toNumber())})`)
            .join('\n');
        const message =
            `Hola ${businessInfo.name}, quiero hacer el pedido #${orderNum} por un total de ${formatMoney(total)}.\n\n` +
            `Detalles:\n${itemLines}\n\n` +
            (trackingUrl ? `Seguimiento en vivo: ${trackingUrl}\n\n` : '') +
            `Por favor, confírmenme mi pedido.`;
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
        if (orderMode === 'DELIVERY' && !direccionEntrega.trim()) return alert('Ingresa tu dirección de entrega');
        if (!validatePhone(customerPhone)) return;
        let cartSnapshot: CartItem[];
        try {
            cartSnapshot = cart.map(item => ({
                ...item,
                quantity: normalizedCartQuantity(item, item.presentation, item.quantity),
            }));
        } catch (quantityError) {
            alert(quantityError instanceof Error ? quantityError.message : 'Revisa las cantidades del pedido');
            return;
        }
        setSubmitting(true);
        const totalSnapshot = cartSnapshot.reduce(
            (sum, item) => sum.plus(cartLineTotal(item)),
            new Decimal(0),
        ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

        try {
            if (orderMode === 'DELIVERY') {
                // 🛵 Entrega a domicilio → módulo de delivery (Pedido + motorizado +
                // tracking). El servidor deriva el tenant del slug y recalcula
                // precios/flete desde la BD — aquí solo van ids y cantidades.
                const res = await fetch('/api/v1/pedidos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        slug,
                        clienteNombre: customerName.trim(),
                        clienteTelefono: customerPhone.trim(),
                        direccionEntrega: direccionEntrega.trim(),
                        referenciaDireccion: referenciaDireccion.trim() || undefined,
                        notas: notas.trim() || undefined,
                        items: cartSnapshot.map(item => ({
                            productoId: item.id,
                            cantidad: item.quantity,
                            presentation: item.presentation,
                        })),
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.error || 'Error al enviar pedido');
                    return;
                }

                const pedidoId: string = data.pedidoId || '';
                // Sin capacidad firmada no construimos un enlace legacy por UUID:
                // el endpoint público falla cerrado y evita exponer el pedido.
                const trackingPath: string = typeof data.trackingPath === 'string'
                    && data.trackingPath.startsWith(`/track/${pedidoId}#token=`)
                    ? data.trackingPath
                    : '';
                const trackingUrl = trackingPath ? `${window.location.origin}${trackingPath}` : '';
                setLastOrderId(pedidoId);
                setLastTrackingPath(trackingPath);

                // 🚀 WhatsApp con resumen + link de seguimiento en vivo
                if (business?.phone && pedidoId) {
                    const waUrl = generateWhatsAppLink(cartSnapshot, business, pedidoId, Number(data.total ?? totalSnapshot), trackingUrl);
                    setLastWhatsappUrl(waUrl);
                    window.open(waUrl, '_blank');
                }
            } else {
                // 🧾 Cotización mayorista → PublicOrder (se convierte en Quotation)
                const res = await fetch('/api/public/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        slug: slug,
                        customerName: customerName.trim(),
                        customerPhone: customerPhone.trim(),
                        items: cartSnapshot.map(item => ({
                            productId: item.id,
                            quantity: item.quantity,
                            presentation: item.presentation,
                        })),
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.error || 'Error al enviar pedido');
                    return;
                }

                const orderId: string = data.orderId || '';
                setLastOrderId(orderId);
                setLastTrackingPath('');

                // 🚀 Abrir WhatsApp automáticamente con resumen del pedido
                if (business?.phone && orderId) {
                    const waUrl = generateWhatsAppLink(
                        cartSnapshot,
                        business,
                        orderId,
                        Number(data.total ?? totalSnapshot),
                    );
                    setLastWhatsappUrl(waUrl);
                    window.open(waUrl, '_blank');
                }
            }

            setOrderSuccess(true);
            setCart([]); // Triggers localStorage cleanup via useEffect
            setCustomerName('');
            setCustomerPhone('');
            setDireccionEntrega('');
            setReferenciaDireccion('');
            setNotas('');
            setPhoneError('');
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

                    {lastTrackingPath && (
                        <a
                            href={lastTrackingPath}
                            className="flex items-center justify-center gap-2 w-full bg-slate-900 text-white px-6 py-4 rounded-2xl font-bold text-base hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg mb-3"
                        >
                            Seguir mi pedido en vivo
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
                            setLastTrackingPath('');
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
                            const baseInCart = cart.find(c => c.id === product.id && c.presentation === 'BASE');
                            const packInCart = cart.find(c => c.id === product.id && c.presentation === 'PACK');
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
                                                    {formatMoney(Number(product.price))}
                                                </span>
                                                <span className="text-xs text-slate-400 ml-1">/{product.unit || 'unidad'}</span>
                                            </div>
                                            {baseInCart ? (
                                                <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl px-1">
                                                    <button
                                                        onClick={() => updateQuantity(product.id, 'BASE', -1)}
                                                        className="p-1 rounded-lg hover:bg-blue-100 text-blue-600"
                                                    >
                                                        <Minus size={14} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        inputMode="decimal"
                                                        min={productRules(product, 'BASE').quantityStep}
                                                        step={productRules(product, 'BASE').quantityStep}
                                                        value={baseInCart.quantity}
                                                        onChange={event => updateQuantityInput(product.id, 'BASE', event.target.value)}
                                                        onBlur={() => commitQuantityInput(product.id, 'BASE')}
                                                        aria-label={`Cantidad en ${product.unit || 'unidad'} de ${product.name}`}
                                                        className="w-14 bg-transparent text-sm font-bold text-blue-700 text-center focus:outline-none"
                                                    />
                                                    <button
                                                        onClick={() => updateQuantity(product.id, 'BASE', 1)}
                                                        className="p-1 rounded-lg hover:bg-blue-100 text-blue-600"
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => addToCart(product, 'BASE')}
                                                    className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-200 hover:shadow-lg transition-all active:scale-95"
                                                    aria-label={`Agregar ${product.name} por ${product.unit || 'unidad'}`}
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            )}
                                        </div>
                                        {hasPackPresentation(product) && (
                                            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-2 py-1.5 text-xs">
                                                <span className="min-w-0 text-amber-800">
                                                    {product.packUnit} × {String(product.packSize)} · {formatMoney(Number(product.packPrice))}
                                                </span>
                                                {packInCart ? (
                                                    <div className="flex items-center gap-1 rounded-lg bg-white px-1">
                                                        <button
                                                            onClick={() => updateQuantity(product.id, 'PACK', -1)}
                                                            className="p-1 text-amber-700"
                                                            aria-label="Quitar empaque"
                                                        >
                                                            <Minus size={12} />
                                                        </button>
                                                        <input
                                                            type="number"
                                                            inputMode="numeric"
                                                            min="1"
                                                            step="1"
                                                            value={packInCart.quantity}
                                                            onChange={event => updateQuantityInput(product.id, 'PACK', event.target.value)}
                                                            onBlur={() => commitQuantityInput(product.id, 'PACK')}
                                                            aria-label={`Cantidad de ${product.packUnit} de ${product.name}`}
                                                            className="w-10 bg-transparent text-center font-bold text-amber-800 focus:outline-none"
                                                        />
                                                        <button
                                                            onClick={() => updateQuantity(product.id, 'PACK', 1)}
                                                            className="p-1 text-amber-700"
                                                            aria-label="Agregar otro empaque"
                                                        >
                                                            <Plus size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => addToCart(product, 'PACK')}
                                                        className="rounded-lg bg-amber-600 px-2 py-1 font-bold text-white hover:bg-amber-700"
                                                    >
                                                        Agregar
                                                    </button>
                                                )}
                                            </div>
                                        )}
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
                        <span className="font-bold text-lg">{formatMoney(cartTotal.toNumber())}</span>
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
                                            <div key={`${item.id}:${item.presentation}`} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                                                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                    {item.imageUrl ? (
                                                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Package className="text-slate-300" size={20} />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                                                    <p className="text-xs text-slate-400">
                                                        {formatMoney(presentationPrice(item, item.presentation).toNumber())} / {presentationUnit(item, item.presentation)}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => updateQuantity(item.id, item.presentation, -1)} className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">
                                                        <Minus size={12} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        inputMode={item.presentation === 'PACK' || item.saleMode === 'COUNTED' ? 'numeric' : 'decimal'}
                                                        min={productRules(item, item.presentation).quantityStep}
                                                        step={productRules(item, item.presentation).quantityStep}
                                                        value={item.quantity}
                                                        onChange={event => updateQuantityInput(item.id, item.presentation, event.target.value)}
                                                        onBlur={() => commitQuantityInput(item.id, item.presentation)}
                                                        aria-label={`Cantidad en ${presentationUnit(item, item.presentation)} de ${item.name}`}
                                                        className="w-16 rounded-lg border border-slate-200 bg-white px-1 py-0.5 text-center text-sm font-bold text-slate-800"
                                                    />
                                                    <span className="max-w-14 truncate text-[10px] text-slate-500">{presentationUnit(item, item.presentation)}</span>
                                                    <button onClick={() => updateQuantity(item.id, item.presentation, 1)} className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600">
                                                        <Plus size={12} />
                                                    </button>
                                                    <button onClick={() => removeFromCart(item.id, item.presentation)} className="p-1 rounded-lg text-slate-300 hover:text-red-500 ml-1">
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
                                            <span className="text-2xl font-bold text-slate-900">{formatMoney(cartTotal.toNumber())}</span>
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
                                {/* 🔀 Modo híbrido: domicilio (B2C) vs cotización mayorista (B2B) */}
                                <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100 rounded-2xl">
                                    <button
                                        type="button"
                                        onClick={() => setOrderMode('DELIVERY')}
                                        className={`py-2.5 px-2 rounded-xl text-sm font-bold transition-all ${orderMode === 'DELIVERY' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        Pedir a Domicilio
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOrderMode('QUOTE')}
                                        className={`py-2.5 px-2 rounded-xl text-sm font-bold transition-all ${orderMode === 'QUOTE' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        Cotización Mayorista
                                    </button>
                                </div>
                                <p className="text-sm text-slate-500 mb-2">
                                    {orderMode === 'DELIVERY'
                                        ? <>Ingresa tus datos y <strong>{business?.name}</strong> te lo lleva a domicilio.</>
                                        : <>Ingresa tus datos y <strong>{business?.name}</strong> te enviará una cotización formal.</>}
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
                                {orderMode === 'DELIVERY' && (
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
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {orderMode === 'DELIVERY' && (
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
                                    )}
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
                                        <div key={`${item.id}:${item.presentation}`} className="flex justify-between gap-3 text-sm">
                                            <span className="text-slate-600">
                                                {item.quantity} {presentationUnit(item, item.presentation)} · {item.name}
                                            </span>
                                            <span className="font-medium text-slate-800">{formatMoney(cartLineTotal(item).toNumber())}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200 mt-2">
                                        <span className="text-slate-700">Total</span>
                                        <span className="text-slate-900">{formatMoney(cartTotal.toNumber())}</span>
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
                                        disabled={submitting || !customerName.trim() || !customerPhone.trim() || (orderMode === 'DELIVERY' && !direccionEntrega.trim())}
                                        className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${orderMode === 'DELIVERY' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}
                                    >
                                        {submitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                                        {submitting ? 'Enviando...' : orderMode === 'DELIVERY' ? 'Pedir a Domicilio' : 'Solicitar Cotización'}
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
