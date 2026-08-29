import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  LogOut,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import { validateCashReceived } from '../utils/posCash';
import { trackEvent } from '../utils/analytics';
import {
  buildPublicRegistrationPath,
  normalizePublicAcquisitionSource,
} from '../utils/publicActivation';

interface MockProduct {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  image: string;
}

interface CartItem {
  product: MockProduct;
  quantity: number;
}

const MOCK_ITEMS: MockProduct[] = [
  {
    id: 'cemento',
    code: 'FER-001',
    name: 'Cemento Holcim',
    description: 'Uso General 42.5 kg',
    price: 275,
    image: '/demo-products/cemento.png',
  },
  {
    id: 'pintura',
    code: 'FER-002',
    name: 'Pintura SUR',
    description: 'Látex Blanco 1 gal',
    price: 315,
    image: '/demo-products/pintura.png',
  },
  {
    id: 'codo-pvc',
    code: 'FER-003',
    name: 'Codo PVC 1/2\"',
    description: 'Presión',
    price: 18,
    image: '/demo-products/codo-pvc.png',
  },
  {
    id: 'bombillo-led',
    code: 'FER-004',
    name: 'Bombillo LED 12W',
    description: 'Luz Blanca',
    price: 65,
    image: '/demo-products/bombillo-led.png',
  },
  {
    id: 'clavos',
    code: 'FER-005',
    name: 'Clavo para madera 2\"',
    description: '(50 mm)',
    price: 38,
    image: '/demo-products/clavos.png',
  },
  {
    id: 'cable-electrico',
    code: 'FER-006',
    name: 'Cable Eléctrico',
    description: 'THHN 12 AWG por metro',
    price: 22,
    image: '/demo-products/cable-electrico.png',
  },
];

const GuestPOS: React.FC = () => {
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const paymentStartRef = useRef<HTMLButtonElement>(null);
  const completedCtaRef = useRef<HTMLAnchorElement>(null);
  const trackedStartRef = useRef(false);
  const trackedFirstProductRef = useRef(false);
  const practiceStartedAtRef = useRef(Date.now());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState('');
  const [guideVisible, setGuideVisible] = useState(true);
  const [choosingPayment, setChoosingPayment] = useState(false);
  const [confirmingCash, setConfirmingCash] = useState(false);
  const [practiceCashReceived, setPracticeCashReceived] = useState('');
  const [cartInView, setCartInView] = useState(false);
  const [missingImages, setMissingImages] = useState<Record<string, boolean>>({});
  const [completedSale, setCompletedSale] = useState<{
    total: number;
    itemCount: number;
    paymentType: 'CASH' | 'CARD' | 'TRANSFER';
    change?: number;
  } | null>(null);

  const demoSource = useMemo(() => {
    return normalizePublicAcquisitionSource(
      new URLSearchParams(location.search).get('source'),
    );
  }, [location.search]);
  const isAuthenticated = useMemo(() => Boolean(localStorage.getItem('nortex_token')), []);
  const ownProductsPath = isAuthenticated
    ? '/app/pos?first_sale=1'
    : buildPublicRegistrationPath(demoSource, 'own_products');
  const completedCtaPath = isAuthenticated
    ? '/app/pos?first_sale=1'
    : buildPublicRegistrationPath(demoSource, 'completed_sale');

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Probá una venta | Nortex';
    if (!trackedStartRef.current) {
      trackedStartRef.current = true;
      trackEvent('demo_started', {
        source: demoSource,
        onboarding_step: 'practice',
      });
    }
    return () => {
      document.title = previousTitle;
    };
  }, [demoSource]);

  const trackFirstProduct = () => {
    if (trackedFirstProductRef.current) return;
    trackedFirstProductRef.current = true;
    trackEvent('demo_product_added', {
      source: demoSource,
      onboarding_step: 'product',
      has_products: true,
    });
  };

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es');
    if (!normalizedQuery) return MOCK_ITEMS;

    return MOCK_ITEMS.filter((product) =>
      [product.name, product.description, product.code]
        .join(' ')
        .toLocaleLowerCase('es')
        .includes(normalizedQuery),
    );
  }, [query]);

  const subtotal = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0,
  );
  const total = subtotal;
  const cartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const practiceCashValidation = useMemo(
    () => validateCashReceived(practiceCashReceived, total),
    [practiceCashReceived, total],
  );

  useEffect(() => {
    if (completedSale) {
      completedCtaRef.current?.focus();
      return;
    }
    if (choosingPayment && !confirmingCash) paymentStartRef.current?.focus();
  }, [choosingPayment, completedSale, confirmingCash]);

  useEffect(() => {
    const cartNode = cartRef.current;
    if (!cartNode || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setCartInView(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(cartNode);
    return () => observer.disconnect();
  }, []);

  const addToCart = (product: MockProduct) => {
    trackFirstProduct();
    setCompletedSale(null);
    setChoosingPayment(false);
    setConfirmingCash(false);
    setPracticeCashReceived('');
    setCart((previous) => {
      const existing = previous.find((item) => item.product.id === product.id);
      if (existing) {
        return previous.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...previous, { product, quantity: 1 }];
    });
  };

  const decrementItem = (id: string) => {
    setCart((previous) =>
      previous
        .map((item) =>
          item.product.id === id
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const removeFromCart = (id: string) => {
    setCart((previous) => previous.filter((item) => item.product.id !== id));
  };

  const clearCart = () => {
    setCart([]);
    setCompletedSale(null);
    setChoosingPayment(false);
    setConfirmingCash(false);
    setPracticeCashReceived('');
  };

  const startTrialSale = () => {
    trackFirstProduct();
    setCompletedSale(null);
    setChoosingPayment(false);
    setConfirmingCash(false);
    setPracticeCashReceived('');
    const product = filteredProducts.length === 1 ? filteredProducts[0] : MOCK_ITEMS[0];
    setCart([{ product, quantity: 1 }]);
    setQuery('');
  };

  const checkout = () => {
    if (cart.length === 0) return;
    setChoosingPayment(true);
    setConfirmingCash(false);
    setPracticeCashReceived('');
  };

  const completePracticeSale = (paymentType: 'CASH' | 'CARD' | 'TRANSFER') => {
    if (cart.length === 0) return;
    const cashPayment = paymentType === 'CASH' ? practiceCashValidation : null;
    if (cashPayment?.ok === false) return;

    setCompletedSale({
      total,
      itemCount: cartQuantity,
      paymentType,
      ...(cashPayment?.ok === true ? { change: cashPayment.change.toNumber() } : {}),
    });
    setChoosingPayment(false);
    setConfirmingCash(false);
    trackEvent('demo_checkout_completed', {
      source: demoSource,
      onboarding_step: 'completed',
      payment_type: paymentType,
    });
    trackEvent('practice_sale_completed', {
      source: demoSource,
      onboarding_step: 'completed',
      has_products: true,
      payment_type: paymentType,
      elapsed_seconds: Math.max(0, Math.round((Date.now() - practiceStartedAtRef.current) / 1000)),
    });
  };

  const startAnotherSale = () => {
    setCart([]);
    setQuery('');
    setCompletedSale(null);
    setChoosingPayment(false);
    setConfirmingCash(false);
    setPracticeCashReceived('');
    practiceStartedAtRef.current = Date.now();
    searchRef.current?.focus();
  };

  return (
    <div className="min-h-[100dvh] bg-surface-950 text-slate-100">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1600px]">
        <aside className="hidden w-[184px] shrink-0 border-r border-white/[0.08] px-3 py-6 lg:flex lg:flex-col">
          <div className="mb-8 flex h-touch items-center px-3 text-[27px] font-bold tracking-tight text-slate-50">
            nortex<span className="text-brand">.</span>
          </div>

          <nav aria-label="Navegación del demo" className="space-y-2">
            <div
              aria-current="page"
              className="flex min-h-tap w-full items-center gap-3 rounded-control bg-brand/10 px-3 text-sm font-medium text-brand shadow-nav-active"
            >
              <Banknote aria-hidden="true" size={22} strokeWidth={1.8} />
              Vender
            </div>
          </nav>

          <div className="mt-auto border-t border-white/[0.08] pt-3">
            <Link
              to={isAuthenticated ? '/app/inicio' : '/'}
              className="flex min-h-tap w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <LogOut aria-hidden="true" size={21} />
              {isAuthenticated ? 'Volver a mi negocio' : 'Salir del demo'}
            </Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex min-h-[72px] items-center justify-between border-b border-white/[0.08] px-4 sm:px-6">
            <div className="text-2xl font-bold tracking-tight text-slate-50 lg:hidden">
              nortex<span className="text-brand">.</span>
            </div>
            <div className="hidden items-center gap-2 text-sm text-slate-400 lg:flex">
              <Store aria-hidden="true" size={18} />
              Demo de punto de venta
            </div>
            <div className="flex min-h-tap items-center gap-2 rounded-control px-2 text-sm font-semibold text-slate-100">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-bold text-surface-950">
                P
              </span>
              <span className="hidden sm:inline">Práctica · datos de ejemplo</span>
            </div>
          </header>

          <main className="p-3 pb-24 sm:p-4 sm:pb-24 lg:pb-4">
            {guideVisible && (
              <section className="relative mb-3 overflow-hidden rounded-card border border-brand/50 bg-brand/10 p-4 sm:min-h-[112px] sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                    <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-surface-800 text-slate-100 sm:flex">
                      <ShoppingCart aria-hidden="true" size={25} />
                    </div>
                    <div className="pr-8">
                      <h1 className="text-lg font-bold text-slate-50">
                        Probá Nortex con una venta de ejemplo
                      </h1>
                      <p className="mt-1 text-sm text-slate-300">
                        Tocá un producto, cobrá y descubrí lo fácil que es vender.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pr-8 sm:flex-row xl:pr-0">
                    <button
                      type="button"
                      onClick={startTrialSale}
                      className="min-h-tap rounded-control bg-brand px-5 text-sm font-bold text-surface-950 transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900"
                    >
                      Iniciar venta de prueba
                    </button>
                    <Link
                      to={ownProductsPath}
                      onClick={() => {
                        if (!isAuthenticated) trackEvent('register_cta_click', { source: demoSource, onboarding_step: 'practice' });
                      }}
                      className="inline-flex min-h-tap items-center justify-center rounded-control border border-brand/60 px-5 text-sm font-semibold text-slate-100 transition-colors hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {isAuthenticated ? 'Vender con mis productos' : 'Usar mis propios productos'}
                    </Link>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGuideVisible(false)}
                  className="absolute right-2 top-2 flex h-touch w-touch items-center justify-center rounded-control text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  aria-label="Cerrar introducción"
                >
                  <X aria-hidden="true" size={22} />
                </button>
              </section>
            )}

            <div className={`grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_clamp(360px,30vw,440px)] ${guideVisible ? 'lg:min-h-[calc(100dvh-260px)]' : 'lg:min-h-[calc(100dvh-104px)]'}`}>
              <section className="min-w-0 rounded-card border border-white/[0.06] bg-surface-900 p-4 sm:p-5">
                <label className="relative block" htmlFor="guest-pos-search">
                  <span className="sr-only">Buscar un producto</span>
                  <Search
                    aria-hidden="true"
                    size={22}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    ref={searchRef}
                    id="guest-pos-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscá por nombre o código"
                    autoComplete="off"
                    className="h-pay w-full rounded-control border border-brand/60 bg-surface-800 pl-12 pr-12 text-base text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        searchRef.current?.focus();
                      }}
                      className="absolute right-1.5 top-1/2 flex h-touch w-touch -translate-y-1/2 items-center justify-center rounded-control text-slate-400 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      aria-label="Limpiar búsqueda"
                    >
                      <X aria-hidden="true" size={19} />
                    </button>
                  )}
                </label>

                <div className="mb-4 mt-6 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-50">
                    {query ? 'Resultados' : 'Productos de ejemplo'}
                  </h2>
                  <span className="text-sm text-slate-400">
                    {filteredProducts.length} {filteredProducts.length === 1 ? 'producto' : 'productos'}
                  </span>
                </div>

                {filteredProducts.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredProducts.map((product) => {
                      const quantity = cart.find(
                        (item) => item.product.id === product.id,
                      )?.quantity;

                      return (
                        <article
                          key={product.id}
                          className="group flex min-h-[224px] flex-col rounded-card border border-white/[0.08] bg-surface-800 p-3 transition-colors hover:border-brand/50"
                        >
                          <div className="flex min-h-[112px] items-center gap-3">
                            <div className="flex h-28 w-[42%] shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-900">
                              {missingImages[product.id] ? (
                                <Package aria-hidden="true" size={42} className="text-slate-600" />
                              ) : (
                                <img
                                  src={product.image}
                                  alt=""
                                  className="h-full w-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-[1.04]"
                                  onError={() =>
                                    setMissingImages((previous) => ({
                                      ...previous,
                                      [product.id]: true,
                                    }))
                                  }
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-semibold leading-snug text-slate-100">
                                {product.name}
                              </h3>
                              <p className="mt-1 text-sm leading-snug text-slate-400">
                                {product.description}
                              </p>
                              <p className="mt-4 text-lg font-bold text-slate-50 nx-num">
                                {formatMoney(product.price)}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => addToCart(product)}
                            className="mt-auto flex min-h-tap w-full items-center justify-center gap-2 rounded-control text-sm font-semibold text-brand transition-colors hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            aria-label={`Agregar ${product.name} a la venta`}
                          >
                            {quantity ? `Agregar otro · ${quantity} en venta` : 'Agregar'}
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-brand">
                              <Plus aria-hidden="true" size={18} />
                            </span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-[340px] flex-col items-center justify-center rounded-card border border-dashed border-white/[0.10] px-6 text-center">
                    <Search aria-hidden="true" size={38} className="text-slate-600" />
                    <h3 className="mt-4 font-semibold text-slate-100">No encontramos ese producto</h3>
                    <p className="mt-1 text-sm text-slate-400">Probá con otra palabra o buscá por código.</p>
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="mt-4 min-h-tap rounded-control border border-white/[0.10] px-4 text-sm font-semibold text-slate-100 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      Ver todos
                    </button>
                  </div>
                )}
              </section>

              <aside ref={cartRef} className={`flex min-h-[560px] scroll-mt-3 flex-col rounded-card border border-white/[0.06] bg-surface-900 lg:sticky lg:top-3 lg:min-h-[460px] lg:self-start ${guideVisible ? 'lg:h-[calc(100dvh-260px)]' : 'lg:h-[calc(100dvh-104px)]'}`}>
                {completedSale ? (
                  <div className="flex flex-1 flex-col items-center justify-center p-6 text-center" aria-live="polite">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-brand">
                      <CheckCircle2 aria-hidden="true" size={44} />
                    </div>
                    <p className="mt-6 text-sm font-semibold text-brand">¡Venta lista!</p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-50">Cobro completado</h2>
                    <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
                      Vendiste {completedSale.itemCount}{' '}
                      {completedSale.itemCount === 1 ? 'producto' : 'productos'} por
                    </p>
                    <p className="mt-2 text-[32px] font-bold tracking-tight text-slate-50 nx-num">
                      {formatMoney(completedSale.total)}
                    </p>
                    <p className="mt-2 text-sm text-slate-400">
                      {completedSale.paymentType === 'CASH' ? 'Efectivo' : completedSale.paymentType === 'CARD' ? 'Tarjeta' : 'Transferencia'}
                      {completedSale.paymentType === 'CASH' &&
                      completedSale.change !== undefined &&
                      completedSale.change > 0
                        ? ` · Vuelto ${formatMoney(completedSale.change)}`
                        : ''}
                    </p>
                    <div className="mt-8 w-full rounded-card border border-brand/20 bg-brand/10 p-4 text-left">
                      <p className="flex items-start gap-2 text-sm text-slate-200">
                        <Check aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-brand" />
                        {isAuthenticated
                          ? 'Esta práctica no cambió tu caja ni tu inventario. Ahora podés repetirla con tus productos.'
                          : 'Esta práctica no guardó datos reales. En tu cuenta, Nortex actualizará caja e inventario.'}
                      </p>
                    </div>
                    <Link
                      ref={completedCtaRef}
                      to={completedCtaPath}
                      onClick={() => {
                        if (!isAuthenticated) trackEvent('register_cta_click', { source: demoSource, onboarding_step: 'completed' });
                      }}
                      className="mt-6 flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-surface-950 transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {isAuthenticated ? 'Hacer una venta real' : 'Crear mi negocio gratis'}
                      <ArrowRight aria-hidden="true" size={20} />
                    </Link>
                    <button
                      type="button"
                      onClick={startAnotherSale}
                      className="mt-3 min-h-tap w-full rounded-control text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      Hacer otra venta
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex min-h-[64px] items-center justify-between border-b border-white/[0.06] px-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-50">Tu primera venta</h2>
                        <p className="mt-0.5 text-sm text-slate-400" aria-live="polite">
                          {cartQuantity === 0
                            ? 'Todavía no agregaste productos'
                            : `${cartQuantity} ${cartQuantity === 1 ? 'producto' : 'productos'}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={clearCart}
                        disabled={cart.length === 0}
                        className="flex min-h-tap items-center gap-2 rounded-control px-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Vaciar venta"
                      >
                        <Trash2 aria-hidden="true" size={20} />
                        <span className="hidden sm:inline">Vaciar</span>
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                      {cart.length === 0 ? (
                        <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-card border border-white/[0.08] px-6 text-center">
                          <ShoppingCart aria-hidden="true" size={52} strokeWidth={1.5} className="text-slate-600" />
                          <p className="mt-5 font-medium text-slate-300">Agregá un producto</p>
                          <p className="mt-1 max-w-[220px] text-sm leading-relaxed text-slate-500">
                            Tocá “Agregar” para empezar tu venta.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {cart.map(({ product, quantity }) => (
                            <article
                              key={product.id}
                              className="rounded-card border border-white/[0.08] bg-surface-800 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="truncate text-sm font-semibold text-slate-100">
                                    {product.name}
                                  </h3>
                                  <p className="mt-1 text-sm text-slate-400 nx-num">
                                    {formatMoney(product.price)} c/u
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeFromCart(product.id)}
                                  className="flex h-touch w-touch shrink-0 items-center justify-center rounded-control text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                  aria-label={`Quitar ${product.name}`}
                                >
                                  <Trash2 aria-hidden="true" size={18} />
                                </button>
                              </div>
                              <div className="mt-3 flex items-end justify-between gap-3">
                                <div className="flex items-center rounded-control border border-white/[0.10] bg-surface-900">
                                  <button
                                    type="button"
                                    onClick={() => decrementItem(product.id)}
                                    className="flex h-touch w-touch items-center justify-center rounded-control text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                    aria-label={`Reducir cantidad de ${product.name}`}
                                  >
                                    <Minus aria-hidden="true" size={18} />
                                  </button>
                                  <span className="min-w-8 text-center text-sm font-bold text-slate-100 nx-num" aria-label={`Cantidad: ${quantity}`}>
                                    {quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addToCart(product)}
                                    className="flex h-touch w-touch items-center justify-center rounded-control text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                    aria-label={`Aumentar cantidad de ${product.name}`}
                                  >
                                    <Plus aria-hidden="true" size={18} />
                                  </button>
                                </div>
                                <p className="pb-2 text-base font-bold text-slate-50 nx-num">
                                  {formatMoney(product.price * quantity)}
                                </p>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-white/[0.06] bg-surface-800/40 p-4">
                      <div className="flex items-center justify-between text-sm text-slate-400">
                        <span>Subtotal</span>
                        <span className="font-semibold text-slate-200 nx-num">{formatMoney(subtotal)}</span>
                      </div>
                      <div className="my-4 border-t border-white/[0.08]" />
                      <div className="flex items-end justify-between gap-3">
                        <span className="text-lg font-bold text-slate-100">Total</span>
                        <span className="text-[30px] font-bold leading-none tracking-tight text-slate-50 nx-num">
                          {formatMoney(total)}
                        </span>
                      </div>
                      {choosingPayment && confirmingCash ? (
                        <div className="mt-5 space-y-3" aria-labelledby="practice-cash-title">
                          <div>
                            <p id="practice-cash-title" className="text-sm font-semibold text-slate-100">Efectivo recibido</p>
                            <p className="mt-0.5 text-xs text-slate-400">Total {formatMoney(total)}</p>
                          </div>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">C$</span>
                            <input
                              autoFocus
                              type="text"
                              inputMode="decimal"
                              value={practiceCashReceived}
                              onChange={(event) => {
                                const next = event.target.value.replace(',', '.');
                                if (/^\d*(?:\.\d{0,2})?$/.test(next)) setPracticeCashReceived(next);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && practiceCashValidation.ok) {
                                  event.preventDefault();
                                  completePracticeSale('CASH');
                                }
                              }}
                              aria-label="Efectivo recibido en la práctica"
                              aria-describedby="practice-cash-status"
                              className="h-pay w-full rounded-control border border-white/[0.10] bg-surface-900 pl-10 pr-3 text-xl font-bold text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 nx-num"
                              placeholder="0.00"
                            />
                          </div>
                          <div id="practice-cash-status" aria-live="polite">
                            {practiceCashReceived !== '' && practiceCashValidation.ok === false && (
                              <p className="rounded-control border border-amber-500/20 bg-warning-soft px-3 py-2 text-sm font-semibold text-amber-300">
                                {practiceCashValidation.shortfall
                                  ? `Falta ${formatMoney(practiceCashValidation.shortfall)}`
                                  : practiceCashValidation.message}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setPracticeCashReceived(total.toFixed(2))}
                            className="min-h-tap w-full rounded-control border border-white/[0.10] text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            Monto exacto · {formatMoney(total)}
                          </button>
                          {Number(practiceCashReceived) >= total && practiceCashReceived !== '' && (
                            <div className="rounded-control border border-brand/20 bg-brand/10 px-3 py-2 text-center" aria-live="polite">
                              <p className="text-xs font-semibold text-slate-400">Vuelto</p>
                              <p className="mt-0.5 text-2xl font-bold text-brand nx-num">{formatMoney(Number(practiceCashReceived) - total)}</p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => completePracticeSale('CASH')}
                            disabled={!practiceCashValidation.ok}
                            className="flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-base font-bold text-surface-950 transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                          >
                            Confirmar cobro <ArrowRight aria-hidden="true" size={19} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setConfirmingCash(false); setPracticeCashReceived(''); }}
                            className="min-h-tap w-full rounded-control text-sm font-semibold text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            Volver a métodos
                          </button>
                        </div>
                      ) : choosingPayment ? (
                        <div className="mt-5 space-y-2" role="group" aria-labelledby="practice-payment-title">
                          <p id="practice-payment-title" className="pb-1 text-sm font-semibold text-slate-200">¿Cómo pagó?</p>
                          <button
                            ref={paymentStartRef}
                            type="button"
                            onClick={() => setConfirmingCash(true)}
                            className="flex h-pay w-full items-center gap-3 rounded-control bg-brand px-4 text-base font-bold text-surface-950 transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            <Banknote aria-hidden="true" size={21} /> Efectivo
                            <ArrowRight aria-hidden="true" size={19} className="ml-auto" />
                          </button>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => completePracticeSale('TRANSFER')}
                              className="min-h-tap rounded-control border border-white/[0.10] px-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            >
                              Transferencia
                            </button>
                            <button
                              type="button"
                              onClick={() => completePracticeSale('CARD')}
                              className="min-h-tap rounded-control border border-white/[0.10] px-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            >
                              Tarjeta
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setChoosingPayment(false); setConfirmingCash(false); }}
                            className="min-h-tap w-full rounded-control text-sm font-semibold text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            Volver al carrito
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={checkout}
                          disabled={cart.length === 0}
                          className="mt-5 flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-surface-950 transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                        >
                          Cobrar
                          <ArrowRight aria-hidden="true" size={21} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </aside>
            </div>
          </main>

          {cartQuantity > 0 && !completedSale && !choosingPayment && !cartInView && (
            <button
              type="button"
              onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="fixed inset-x-3 bottom-3 z-checkout flex h-pay items-center justify-between rounded-control bg-brand px-5 text-surface-950 shadow-premium lg:hidden"
              aria-label={`Ver y cobrar ${cartQuantity} ${cartQuantity === 1 ? 'producto' : 'productos'} por ${formatMoney(total)}`}
            >
              <span className="text-left">
                <span className="block text-xs font-semibold opacity-75">
                  {cartQuantity} {cartQuantity === 1 ? 'producto' : 'productos'}
                </span>
                <span className="block text-sm font-extrabold">Ver y cobrar</span>
              </span>
              <span className="flex items-center gap-2 text-base font-extrabold nx-num">
                {formatMoney(total)}
                <ArrowRight aria-hidden="true" size={20} />
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GuestPOS;
