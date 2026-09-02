import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
    Truck, MapPin, Phone, CheckCircle, Package, Clock,
    Loader2, Navigation, MessageCircle, X, Wallet, AlertTriangle, Lock, LogOut,
    Moon, Sun,
} from 'lucide-react';
import { formatMoney } from '../utils/money';
import {
    bindDriverTheme,
    clearDriverThemeScope,
    nextDriverTheme,
    persistDriverTheme,
    readDriverTheme,
    readPreAuthDriverTheme,
    type DriverTheme,
} from '../utils/driverTheme';

// Sesión del repartidor: token firmado (teléfono+PIN). Reemplaza el
// magic-link /driver/:id — cualquiera que reenviara ese link podía entrar.
const DRIVER_TOKEN_KEY = 'nortex_driver_token';

const restoreFocusOnNextFrame = (element: HTMLElement | null) => {
    const restore = () => element?.focus();
    if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(restore);
        return;
    }
    globalThis.setTimeout(restore, 0);
};

// ─── Interfaces ────────────────────────────────────────────────────────────

interface OrderItem {
    id: string;
    cantidad: number;
    producto: { name: string };
}

interface Order {
    id: string;
    clienteNombre: string;
    clienteTelefono: string;
    direccionEntrega: string;
    referenciaDireccion?: string;
    notas?: string;
    estado: string;
    total: number;
    items: OrderItem[];
}

interface Driver {
    id: string;
    nombre: string;
    tipoFlota: string;
}

const DRIVER_DELIVERABLE_STATES = new Set(['en_tienda', 'en_ruta', 'en_camino', 'en_punto']);

const getDriverDeliveryAction = (estado: string) => {
    if (DRIVER_DELIVERABLE_STATES.has(estado)) {
        return {
            enabled: true,
            label: 'Entregar y Cobrar',
            icon: CheckCircle,
        };
    }
    if (estado === 'preparando') {
        return {
            enabled: false,
            label: 'Esperando en Ferretería',
            icon: Clock,
        };
    }
    return {
        enabled: false,
        label: 'Esperando preparación',
        icon: Clock,
    };
};

interface Liquidacion {
    pedidosEntregados: number;
    totalCobrado: number;
    comisionesGanadas: number;
    netoADepositarA_Tienda: number;
}

interface WalletMovimiento {
    id: string;
    type: string; // COMISION_ENTREGA | PAGO_NORTEX | AJUSTE
    amount: number;
    descripcion: string;
    createdAt: string;
    firmado: boolean;
}

interface WalletData {
    walletBalance: number;
    movimientos: WalletMovimiento[];
}

interface DriverThemeToggleProps {
    theme: DriverTheme;
    onToggle: () => void;
}

const DriverThemeToggle: React.FC<DriverThemeToggleProps> = ({ theme, onToggle }) => {
    const isDark = theme === 'dark';
    const currentModeLabel = isDark ? 'modo noche' : 'modo día';
    const actionLabel = isDark ? 'Modo día' : 'Modo noche';
    const Icon = isDark ? Sun : Moon;

    return (
        <button
            type="button"
            onClick={onToggle}
            className="nx-theme-toggle nx-fluid-press"
            aria-pressed={isDark}
            aria-label={`${currentModeLabel} activo. Cambiar a ${actionLabel.toLowerCase()}`}
            title={`Cambiar a ${actionLabel.toLowerCase()}`}
        >
            <Icon size={17} aria-hidden="true" />
            <span className="nx-theme-toggle-label">{actionLabel}</span>
        </button>
    );
};

interface DriverThemeSurfaceProps {
    theme: DriverTheme;
    children: React.ReactNode;
}

const DriverThemeSurface: React.FC<DriverThemeSurfaceProps> = ({ theme, children }) => (
    <div
        className="nx-app-shell min-h-dvh"
        data-nx-theme={theme}
        data-testid="driver-theme-root"
    >
        <div className={`nx-driver-workspace min-h-dvh ${
            theme === 'dark' ? 'nx-apple-dark-workspace' : 'nx-apple-light-workspace'
        }`}>
            {children}
        </div>
    </div>
);

// ─── Confirm Modal ─────────────────────────────────────────────────────────

interface ConfirmDeliveryModalProps {
    order: Order;
    onConfirm: () => void;
    onCancel: () => void;
    isProcessing: boolean;
}

const ConfirmDeliveryModal: React.FC<ConfirmDeliveryModalProps> = ({
    order, onConfirm, onCancel, isProcessing
}) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
        {/* Backdrop */}
        <div className="nx-overlay-backdrop absolute inset-0" onClick={onCancel} aria-hidden="true" />

        {/* Sheet */}
        <div
            className="nx-ticket-surface nx-dark-context relative w-full overflow-hidden rounded-t-3xl border border-slate-700 duration-300 sm:max-w-sm sm:rounded-3xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="driver-confirm-title"
            aria-describedby="driver-confirm-description"
        >

            {/* Warning strip */}
            <div className="bg-brand px-6 py-3 flex items-center gap-2 text-brand-on">
                <CheckCircle size={18} aria-hidden="true" />
                <span id="driver-confirm-title" className="font-black text-sm uppercase tracking-widest">
                    Confirmar Entrega
                </span>
            </div>

            <div className="px-6 pt-6 pb-4 text-center space-y-2">
                <p className="text-slate-400 text-sm">Pedido de</p>
                <p className="text-white font-black text-xl">{order.clienteNombre}</p>

                {/* ── MONTO GIGANTE ── */}
                <div className="py-5">
                    <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">
                        Efectivo a cobrar
                    </p>
                    <p className="text-6xl font-black text-emerald-400 tracking-tight leading-none">
                        {formatMoney(Number(order.total))}
                    </p>
                </div>

                <p id="driver-confirm-description" className="text-slate-400 text-sm leading-relaxed">
                    ¿Confirmas que <strong className="text-white">recibiste este efectivo</strong>{' '}
                    y el cliente firmó de recibido?
                </p>
            </div>

            {/* Items compactos */}
            <div className="mx-6 mb-5 bg-slate-800 rounded-2xl p-3 border border-slate-700">
                {order.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-slate-400 py-0.5">
                        <span className="truncate pr-2">{item.producto.name}</span>
                        <span className="font-bold text-slate-300 flex-shrink-0">×{item.cantidad}</span>
                    </div>
                ))}
                {order.items.length > 3 && (
                    <p className="text-[11px] text-slate-500 mt-1 italic">
                        +{order.items.length - 3} artículos más
                    </p>
                )}
            </div>

            {/* Botones */}
            <div className="nx-sheet px-6 pb-8 flex flex-col gap-3">
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isProcessing}
                    className="nx-driver-primary nx-fluid-press min-h-tap w-full bg-brand py-4 text-brand-on rounded-2xl font-black text-lg uppercase tracking-wide shadow-lg shadow-emerald-900/50 hover:bg-brand-hover flex items-center justify-center gap-2"
                >
                    {isProcessing
                        ? <><Loader2 className="animate-spin" size={22} /> Procesando...</>
                        : <><CheckCircle size={22} /> Sí, cobré {formatMoney(Number(order.total))}</>
                    }
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isProcessing}
                    autoFocus
                    className="nx-fluid-press min-h-tap w-full py-3 border border-slate-600 text-slate-300 rounded-2xl font-semibold hover:bg-slate-800 transition-colors"
                >
                    Cancelar
                </button>
            </div>
        </div>
    </div>
);

// ─── Main Component ────────────────────────────────────────────────────────

const DriverView: React.FC = () => {
    const [token, setToken] = useState<string | null>(() => localStorage.getItem(DRIVER_TOKEN_KEY));
    const [theme, setTheme] = useState<DriverTheme>(() => (
        token ? readDriverTheme() : readPreAuthDriverTheme()
    ));

    const [driver, setDriver]         = useState<Driver | null>(null);
    const [orders, setOrders]         = useState<Order[]>([]);
    const [liquidacion, setLiquidacion] = useState<Liquidacion | null>(null);
    const [loading, setLoading]       = useState(!!localStorage.getItem(DRIVER_TOKEN_KEY));
    const [error, setError]           = useState('');

    // Login state (teléfono + PIN)
    const [loginPhone, setLoginPhone] = useState('');
    const [loginPin, setLoginPin]     = useState('');
    const [loginError, setLoginError] = useState('');
    const [loggingIn, setLoggingIn]   = useState(false);

    // Modal state
    const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const confirmTriggerRef = useRef<HTMLElement | null>(null);

    // 💰 Wallet (solo Red NORTEX)
    const [wallet, setWallet] = useState<WalletData | null>(null);
    const [showWallet, setShowWallet] = useState(false);
    const [walletLoading, setWalletLoading] = useState(false);
    const walletTriggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!token) clearDriverThemeScope();
    }, [token]);

    const toggleDriverTheme = useCallback(() => {
        setTheme(currentTheme => {
            const nextTheme = nextDriverTheme(currentTheme);
            if (driver?.id) persistDriverTheme(driver.id, nextTheme);
            return nextTheme;
        });
    }, [driver?.id]);

    const fetchWallet = useCallback(async () => {
        const t = localStorage.getItem(DRIVER_TOKEN_KEY);
        if (!t) return;
        setWalletLoading(true);
        try {
            const res = await fetch('/api/driver/me/wallet', {
                headers: { Authorization: `Bearer ${t}` },
            });
            if (res.ok) {
                const nextWallet = await res.json();
                if (localStorage.getItem(DRIVER_TOKEN_KEY) !== t) return;
                setWallet(nextWallet);
            }
        } catch { /* sin red — se reintenta al reabrir */ }
        finally {
            if (localStorage.getItem(DRIVER_TOKEN_KEY) === t) {
                setWalletLoading(false);
            }
        }
    }, []);

    const openWallet = () => {
        setWallet(null);
        setShowWallet(true);
        fetchWallet();
    };

    const closeWallet = useCallback(() => {
        setShowWallet(false);
        restoreFocusOnNextFrame(walletTriggerRef.current);
    }, []);

    const closeConfirmation = useCallback(() => {
        if (processingId) return;
        setConfirmOrder(null);
        restoreFocusOnNextFrame(confirmTriggerRef.current);
    }, [processingId]);

    const logout = useCallback(() => {
        localStorage.removeItem(DRIVER_TOKEN_KEY);
        clearDriverThemeScope();
        setToken(null);
        setTheme('light');
        setDriver(null);
        setOrders([]);
        setLiquidacion(null);
        setWallet(null);
        setShowWallet(false);
        setWalletLoading(false);
        setConfirmOrder(null);
        setProcessingId(null);
        setError('');
        setLoginError('');
        setLoading(false);
    }, []);

    const fetchOrders = useCallback(async () => {
        const t = localStorage.getItem(DRIVER_TOKEN_KEY);
        if (!t) return;
        try {
            const res = await fetch('/api/driver/me/orders', {
                headers: { Authorization: `Bearer ${t}` },
            });
            if (res.ok) {
                const data = await res.json();
                if (localStorage.getItem(DRIVER_TOKEN_KEY) !== t) return;
                if (data.driver?.id) {
                    setTheme(currentTheme => bindDriverTheme(data.driver.id, currentTheme));
                }
                setDriver(data.driver);
                setOrders(data.orders ?? []);
                setLiquidacion(data.liquidacionDiaria ?? null);
                setError('');
            } else if (
                (res.status === 401 || res.status === 403)
                && localStorage.getItem(DRIVER_TOKEN_KEY) === t
            ) {
                logout(); // sesión expirada/cuenta inactiva → volver al login
            } else if (localStorage.getItem(DRIVER_TOKEN_KEY) === t) {
                setError('Error al cargar tus entregas.');
            }
        } catch {
            if (localStorage.getItem(DRIVER_TOKEN_KEY) === t) {
                setError('Error de conexión. Verifica tu internet.');
            }
        } finally {
            if (localStorage.getItem(DRIVER_TOKEN_KEY) === t) {
                setLoading(false);
            }
        }
    }, [logout]);

    useEffect(() => {
        if (!token) return;
        fetchOrders();
        const intv = setInterval(fetchOrders, 10_000);
        return () => clearInterval(intv);
    }, [token, fetchOrders]);

    useEffect(() => {
        if (!showWallet && !confirmOrder) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (showWallet) closeWallet();
            if (confirmOrder) closeConfirmation();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [closeConfirmation, closeWallet, confirmOrder, showWallet]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError('');
        setLoggingIn(true);
        try {
            const res = await fetch('/api/driver/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telefono: loginPhone, pin: loginPin }),
            });
            const data = await res.json();
            if (!res.ok) {
                setLoginError(data.error || 'No se pudo iniciar sesión.');
                return;
            }
            localStorage.setItem(DRIVER_TOKEN_KEY, data.token);
            if (data.driver?.id) {
                setTheme(currentTheme => bindDriverTheme(data.driver.id, currentTheme));
            }
            setToken(data.token);
            setLoading(true);
        } catch {
            setLoginError('Error de conexión. Intenta de nuevo.');
        } finally {
            setLoggingIn(false);
        }
    };

    // Called when driver taps the big green button
    const handleDeliverTap = (order: Order) => {
        if (processingId) return; // guard: one operation at a time
        confirmTriggerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setConfirmOrder(order);
    };

    // Called after modal confirmation
    const confirmDelivery = async () => {
        if (!confirmOrder) return;
        const orderId = confirmOrder.id;
        setProcessingId(orderId);

        let lat: number | null = null;
        let lng: number | null = null;

        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 6000,
                    enableHighAccuracy: true,
                })
            );
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } catch {
            // GPS no disponible — continuar sin coordenadas
        }

        try {
            const t = localStorage.getItem(DRIVER_TOKEN_KEY);
            const res = await fetch(`/api/driver/me/orders/${orderId}/deliver`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
                body: JSON.stringify({ lat, lng }),
            });

            if (res.ok) {
                setConfirmOrder(null);
                setOrders(prev => prev.filter(o => o.id !== orderId));
                fetchOrders(); // refresca liquidación
            } else {
                const d = await res.json();
                alert(d.error || 'Error al registrar la entrega');
                setConfirmOrder(null);
            }
        } catch {
            alert('Error de conexión. Intenta de nuevo.');
            setConfirmOrder(null);
        } finally {
            setProcessingId(null);
        }
    };

    // Navigation helpers
    const wazeUrl  = (dir: string) => `https://waze.com/ul?q=${encodeURIComponent(dir)}&navigate=yes`;
    const mapsUrl  = (dir: string) => `https://maps.google.com/?q=${encodeURIComponent(dir)}`;
    const waLink   = (phone: string) => `https://wa.me/505${phone.replace(/\D/g, '')}`;

    // ── Login (sin sesión) ──
    if (!token) {
        return (
            <DriverThemeSurface theme={theme}>
            <div className="relative min-h-dvh flex items-center justify-center p-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                <div className="fixed right-4 top-[calc(1rem+env(safe-area-inset-top))] z-30">
                    <DriverThemeToggle theme={theme} onToggle={toggleDriverTheme} />
                </div>
                <div className="w-full max-w-sm">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                            <Truck size={28} className="text-emerald-400" aria-hidden="true" />
                        </div>
                        <h1 className="text-2xl font-black text-white">App de Repartidores</h1>
                        <p className="text-slate-400 text-sm mt-1">Entrá con tu teléfono y PIN</p>
                    </div>

                    <form onSubmit={handleLogin} className="nx-driver-card rounded-3xl p-6 space-y-4">
                        <div>
                            <label htmlFor="driver-phone" className="mb-2 block text-sm font-bold text-slate-300">
                                Teléfono
                            </label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} aria-hidden="true" />
                                <input
                                    id="driver-phone"
                                    required
                                    type="tel"
                                    inputMode="numeric"
                                    autoComplete="tel"
                                    placeholder="8888-0000"
                                    value={loginPhone}
                                    onChange={e => setLoginPhone(e.target.value)}
                                    className="min-h-tap w-full bg-slate-900 border border-slate-700 text-slate-100 pl-10 pr-4 py-3.5 rounded-2xl text-lg font-mono focus:outline-none focus:border-emerald-500 placeholder:text-slate-500 placeholder:font-sans placeholder:text-base"
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="driver-pin" className="mb-2 block text-sm font-bold text-slate-300">
                                PIN
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} aria-hidden="true" />
                                <input
                                    id="driver-pin"
                                    required
                                    type="password"
                                    inputMode="numeric"
                                    autoComplete="current-password"
                                    placeholder="4 a 6 dígitos"
                                    value={loginPin}
                                    onChange={e => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="min-h-tap w-full bg-slate-900 border border-slate-700 text-slate-100 pl-10 pr-4 py-3.5 rounded-2xl text-2xl font-mono tracking-[0.5em] focus:outline-none focus:border-emerald-500 placeholder:text-slate-500 placeholder:tracking-normal placeholder:text-base"
                                />
                            </div>
                        </div>

                        {loginError && (
                            <div
                                className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 text-red-400 text-sm text-center"
                                role="alert"
                                aria-live="polite"
                            >
                                {loginError}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loggingIn || loginPin.length < 4}
                            className="nx-driver-primary nx-fluid-press min-h-tap w-full py-4 bg-brand text-brand-on rounded-2xl font-black text-lg uppercase tracking-wide hover:bg-brand-hover flex items-center justify-center gap-2"
                        >
                            {loggingIn ? <Loader2 className="animate-spin" size={22} /> : <CheckCircle size={22} />}
                            {loggingIn ? 'Entrando...' : 'Entrar'}
                        </button>
                    </form>

                    <p className="text-center text-sm text-slate-500 mt-6">
                        ¿Querés repartir con Nortex?{' '}
                        <Link to="/repartidor/registro" className="nx-fluid-press inline-flex min-h-tap items-center text-emerald-400 font-bold hover:text-emerald-300">Registrate aquí</Link>
                    </p>
                </div>
            </div>
            </DriverThemeSurface>
        );
    }

    // ── Loading ──
    if (loading) {
        return (
            <DriverThemeSurface theme={theme}>
            <div className="relative min-h-dvh flex flex-col items-center justify-center gap-4 px-6">
                <div className="fixed right-4 top-[calc(1rem+env(safe-area-inset-top))] z-30">
                    <DriverThemeToggle theme={theme} onToggle={toggleDriverTheme} />
                </div>
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 flex items-center justify-center">
                    <Truck size={28} className="text-emerald-400 animate-pulse" aria-hidden="true" />
                </div>
                <Loader2 className="animate-spin text-emerald-400" size={32} aria-hidden="true" />
                <p className="text-slate-500 text-sm" role="status">Cargando tus entregas...</p>
            </div>
            </DriverThemeSurface>
        );
    }

    // ── Error ──
    if (error || !driver) {
        return (
            <DriverThemeSurface theme={theme}>
            <div className="relative min-h-dvh flex items-center justify-center p-6 pt-[calc(5rem+env(safe-area-inset-top))]">
                <div className="fixed right-4 top-[calc(1rem+env(safe-area-inset-top))] z-30">
                    <DriverThemeToggle theme={theme} onToggle={toggleDriverTheme} />
                </div>
                <div className="nx-driver-card rounded-3xl p-8 w-full max-w-sm text-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="text-red-400" size={28} aria-hidden="true" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">No pudimos cargar tus entregas</h2>
                    <p className="text-slate-400 text-sm mb-6" role="alert">{error || 'Intenta de nuevo en unos segundos.'}</p>
                    <div className="flex gap-3">
                        <button onClick={() => { setLoading(true); fetchOrders(); }} className="nx-fluid-press min-h-tap flex-1 py-3 bg-brand text-brand-on rounded-2xl font-bold hover:bg-brand-hover transition-colors">
                            Reintentar
                        </button>
                        <button onClick={logout} className="nx-fluid-press min-h-tap flex-1 py-3 border border-slate-600 text-slate-300 rounded-2xl font-semibold hover:bg-slate-700 transition-colors">
                            Salir
                        </button>
                    </div>
                </div>
            </div>
            </DriverThemeSurface>
        );
    }

    const pendingCount = orders.length;

    return (
        <DriverThemeSurface theme={theme}>
        <div className="relative min-h-dvh pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-32">

            {/* ── Sticky Header ─────────────────────────────────────── */}
            <div className="nx-driver-chrome sticky top-0 z-30 px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] rounded-b-3xl">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center">
                        <Truck size={22} className="text-emerald-400" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="nx-shell-text font-black text-lg leading-tight truncate">{driver.nombre}</h1>
                        <p className="nx-shell-faint text-xs">
                            {driver.tipoFlota === 'NORTEX' ? 'Flota Nortex' : 'Flota Propia'}
                            {pendingCount > 0
                                ? <> &nbsp;·&nbsp; <span className="text-amber-400 font-semibold">{pendingCount} entrega{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}</span></>
                                : <> &nbsp;·&nbsp; <span className="text-emerald-400 font-semibold">Todo al día </span></>
                            }
                        </p>
                    </div>
                    <DriverThemeToggle theme={theme} onToggle={toggleDriverTheme} />
                    {driver.tipoFlota === 'NORTEX' && (
                        <button
                            ref={walletTriggerRef}
                            onClick={openWallet}
                            type="button"
                            title="Mi billetera"
                            aria-label="Abrir mi billetera"
                            className="nx-shell-control nx-fluid-press h-touch w-touch rounded-xl text-amber-400 hover:bg-amber-500/25 transition-colors flex flex-shrink-0 items-center justify-center"
                        >
                            <Wallet size={18} aria-hidden="true" />
                        </button>
                    )}
                    <button
                        onClick={logout}
                        type="button"
                        title="Cerrar sesión"
                        aria-label="Cerrar sesión"
                        className="nx-shell-control nx-fluid-press h-touch w-touch rounded-xl text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-colors flex flex-shrink-0 items-center justify-center"
                    >
                        <LogOut size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* ── Order Cards ───────────────────────────────────────── */}
            <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">

                {pendingCount === 0 ? (
                    <div className="nx-driver-card rounded-3xl p-10 text-center mt-6">
                        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="text-emerald-500" size={32} />
                        </div>
                        <p className="text-slate-800 font-black text-xl mb-1">¡Estás al día!</p>
                        <p className="text-slate-400 text-sm">No hay entregas pendientes.<br />La app se actualiza automáticamente.</p>
                    </div>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className="nx-driver-card rounded-3xl overflow-hidden">

                            {/* Card color strip */}
                            <div className={`h-1.5 w-full ${order.estado === 'preparando' ? 'bg-blue-400' : 'bg-purple-500'}`} />

                            {/* ── Total (MUY GRANDE) ── */}
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cobrar en efectivo</p>
                                    <p className="text-5xl font-black text-slate-900 leading-none mt-1">
                                        {formatMoney(Number(order.total))}
                                    </p>
                                </div>
                                <span className={`text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-xl ${
                                    order.estado === 'preparando'
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-purple-100 text-purple-700'
                                }`}>
                                    {order.estado === 'preparando' ? 'En tienda' : 'En camino'}
                                </span>
                            </div>

                            <div className="p-5 space-y-4">

                                {/* ── Cliente ── */}
                                <div>
                                    <p className="font-black text-slate-900 text-xl leading-tight">{order.clienteNombre}</p>

                                    {/* Contacto: Llamar + WA */}
                                    <div className="flex gap-2 mt-3">
                                        <a
                                            href={`tel:${order.clienteTelefono}`}
                                            className="nx-fluid-press min-h-tap flex-1 flex items-center justify-center gap-2 bg-sky-700 text-white py-3.5 rounded-2xl font-bold text-sm hover:bg-sky-800"
                                        >
                                            <Phone size={17} /> {order.clienteTelefono}
                                        </a>
                                        <a
                                            href={waLink(order.clienteTelefono)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="nx-fluid-press min-h-tap flex-1 flex items-center justify-center gap-2 bg-green-800 text-white py-3.5 rounded-2xl font-bold text-sm hover:bg-green-900"
                                        >
                                            <MessageCircle size={17} /> WhatsApp
                                        </a>
                                    </div>
                                </div>

                                {/* ── Dirección ── */}
                                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                                    <div className="flex items-start gap-2.5">
                                        <MapPin className="text-blue-500 flex-shrink-0 mt-0.5" size={18} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-slate-800 font-semibold text-sm leading-relaxed">
                                                {order.direccionEntrega}
                                            </p>
                                            {order.referenciaDireccion && (
                                                <p className="text-xs text-slate-500 mt-1 italic">
                                                    Ref: {order.referenciaDireccion}
                                                </p>
                                            )}
                                            {order.notas && (
                                                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                    <p className="text-xs font-semibold text-amber-700">
                                                        Nota: {order.notas}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Navegación: Waze + Maps ── */}
                                    <div className="flex gap-2 mt-3">
                                        <a
                                            href={wazeUrl(order.direccionEntrega)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="nx-fluid-press min-h-tap flex-1 flex items-center justify-center gap-1.5 bg-waze/10 border border-waze/30 text-blue-800 py-2.5 rounded-xl font-bold text-xs hover:bg-waze/20"
                                        >
                                            <Navigation size={14} /> Waze
                                        </a>
                                        <a
                                            href={mapsUrl(order.direccionEntrega)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="nx-fluid-press min-h-tap flex-1 flex items-center justify-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 py-2.5 rounded-xl font-bold text-xs hover:bg-blue-100"
                                        >
                                            <MapPin size={14} /> Maps
                                        </a>
                                    </div>
                                </div>

                                {/* ── Artículos ── */}
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                        Artículos del pedido
                                    </p>
                                    <div className="space-y-1.5">
                                        {order.items.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex justify-between text-sm text-slate-600">
                                                <span className="truncate pr-3">{item.producto.name}</span>
                                                <span className="font-bold text-slate-800 flex-shrink-0">×{item.cantidad}</span>
                                            </div>
                                        ))}
                                        {order.items.length > 3 && (
                                            <p className="text-xs text-slate-400 italic">
                                                +{order.items.length - 3} artículos más
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Botón de Entrega ── */}
                            <div className="px-5 pb-5">
                                {(() => {
                                    const action = getDriverDeliveryAction(order.estado);
                                    const ActionIcon = action.icon;
                                    return (
                                        <button
                                            onClick={action.enabled ? () => handleDeliverTap(order) : undefined}
                                            disabled={!action.enabled || !!processingId}
                                            className={`nx-fluid-press min-h-tap w-full py-5 rounded-2xl font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 ${
                                                action.enabled
                                                    ? 'nx-driver-primary bg-brand text-brand-on shadow-xl shadow-emerald-200 hover:bg-brand-hover'
                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <ActionIcon size={action.enabled ? 24 : 20} /> {action.label}
                                        </button>
                                    );
                                })()}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* ── FASE 3: Sticky Footer — Liquidación Diaria ─────────── */}
            {liquidacion && (liquidacion.pedidosEntregados > 0 || liquidacion.netoADepositarA_Tienda > 0) && (
                <div className="nx-bottom-bar nx-driver-dock fixed bottom-0 left-0 right-0 z-40 px-4 pt-2">
                    <div className="nx-driver-chrome max-w-lg mx-auto rounded-3xl px-3 py-3 sm:px-5 sm:py-4">
                        <div className={`nx-driver-dock-grid grid items-center gap-2 sm:gap-3 ${
                            liquidacion.comisionesGanadas > 0
                                ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                                : 'grid-cols-[auto_minmax(0,1fr)]'
                        }`}>
                            {/* Viajes completados */}
                            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/15 sm:h-9 sm:w-9">
                                    <CheckCircle size={16} className="text-emerald-400" aria-hidden="true" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">
                                        Viajes
                                    </p>
                                    <p className="nx-shell-text text-xl font-black leading-none tabular-nums sm:text-2xl">
                                        {liquidacion.pedidosEntregados}
                                    </p>
                                </div>
                            </div>

                            {/* Efectivo a entregar */}
                            <div
                                className="min-w-0 border-l border-slate-700 pl-2 sm:pl-3"
                                aria-label="Efectivo a entregar a caja"
                            >
                                <p className="mb-0.5 whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-widest text-slate-400">
                                    <span className="sm:hidden">A caja</span>
                                    <span className="hidden sm:inline">Entregar a caja</span>
                                </p>
                                <p
                                    className="whitespace-nowrap text-[clamp(.875rem,3.8vw,1.25rem)] font-black leading-none tabular-nums text-amber-400"
                                    title={formatMoney(Number(liquidacion.netoADepositarA_Tienda))}
                                >
                                    {formatMoney(Number(liquidacion.netoADepositarA_Tienda))}
                                </p>
                            </div>

                            {/* Ganancia del rider */}
                            {liquidacion.comisionesGanadas > 0 && (
                                <div className="min-w-0 border-l border-slate-700 pl-2 text-right sm:pl-3">
                                    <p className="mb-0.5 whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-widest text-slate-400">
                                        Ganancia
                                    </p>
                                    <p
                                        className="truncate text-[clamp(.85rem,3.7vw,1.25rem)] font-black leading-none tabular-nums text-emerald-400"
                                        title={formatMoney(Number(liquidacion.comisionesGanadas))}
                                    >
                                        {formatMoney(Number(liquidacion.comisionesGanadas))}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── 💰 Wallet Sheet (Red NORTEX) ───────────────────────── */}
            {showWallet && (
                <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
                    <div className="nx-overlay-backdrop absolute inset-0" onClick={closeWallet} aria-hidden="true" />
                    <div
                        className="nx-driver-chrome nx-driver-wallet-sheet nx-sheet relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="driver-wallet-title"
                    >
                        <div className="bg-amber-500 px-6 py-3 flex items-center justify-between">
                            <span id="driver-wallet-title" className="font-black text-amber-950 text-sm uppercase tracking-widest flex items-center gap-2">
                                <Wallet size={16} aria-hidden="true" /> Mi Billetera Nortex
                            </span>
                            <button
                                type="button"
                                onClick={closeWallet}
                                autoFocus
                                aria-label="Cerrar billetera"
                                className="nx-fluid-press min-h-tap min-w-tap flex items-center justify-center rounded-xl text-amber-950 hover:bg-amber-400"
                            >
                                <X size={20} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="px-6 py-5 text-center border-b border-slate-800">
                            <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">Comisiones por cobrar</p>
                            {walletLoading && !wallet ? (
                                <Loader2 className="animate-spin text-amber-400 mx-auto my-3" size={28} />
                            ) : (
                                <p className="text-5xl font-black text-amber-400 tracking-tight leading-none">
                                    {formatMoney((wallet?.walletBalance ?? 0))}
                                </p>
                            )}
                            <p className="text-[11px] text-slate-500 mt-2">
                                Cada movimiento queda firmado en tu libro — nadie puede alterarlo.
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                            {wallet && wallet.movimientos.length === 0 && (
                                <p className="text-center text-slate-500 text-sm py-6">
                                    Aún no tenés movimientos.<br />¡Tu primera entrega acredita tu comisión aquí!
                                </p>
                            )}
                            {wallet?.movimientos.map(m => (
                                <div key={m.id} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm text-slate-200 font-semibold truncate">{m.descripcion}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            {new Date(m.createdAt).toLocaleString()} {m.firmado && '· firmado'}
                                        </p>
                                    </div>
                                    <span className={`font-black text-lg flex-shrink-0 ${m.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {m.amount >= 0 ? '+' : ''}{formatMoney(m.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Confirmation Modal ─────────────────────────────────── */}
            {confirmOrder && (
                <ConfirmDeliveryModal
                    order={confirmOrder}
                    onConfirm={confirmDelivery}
                    onCancel={closeConfirmation}
                    isProcessing={processingId === confirmOrder.id}
                />
            )}
        </div>
        </DriverThemeSurface>
    );
};

export default DriverView;
