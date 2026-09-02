import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Wallet, PackagePlus, LayoutGrid, ArrowRight, PlayCircle } from 'lucide-react';
import { formatMoney } from '../utils/money';
import { trackEvent } from '../utils/analytics';
import { fetchOnboardingStatus } from '../utils/onboardingStatus';

/**
 * Mi Negocio — pantalla de inicio del modo simple (Fase B del plan UX Simple).
 *
 * Para el dueño que no es de computadoras: el día en 3 números y las 4 acciones
 * de siempre en botones grandes. Nada de gráficos ni jerga — eso vive en
 * "Mi Plata" (/app/dashboard) para quien quiera profundizar.
 *
 * Datos: SOLO endpoints existentes (tenant-scoped por JWT en el backend):
 *   - /api/dashboard/stats      → todayStats.totalSales / gananciaBruta
 *   - /api/collections/worklist → totalReceivable (el fiado en la calle)
 * Si una llamada falla (sin red, permisos), el número muestra "—" y los
 * botones siguen funcionando: la pantalla nunca bloquea la operación.
 */

interface DayNumbers {
    vendiHoy: number | null;
    meDeben: number | null;
    enCaja: number | null;
    gananciaHoy: number | null;
}

interface ActivationStatus {
    hasProduct: boolean;
    hasSale: boolean;
}

const formatCordobas = (n: number | null): string => {
    if (n === null) return '—';
    return formatMoney(n);
};

/**
 * Número finito que MANDÓ el backend, o null si el campo no vino.
 * Se usa para los campos nuevos de /api/dashboard/stats: si la app corre
 * contra un backend todavía sin ellos, la pantalla muestra "—" en vez de
 * inventar un número (jamás las ventas disfrazadas de ganancia).
 */
const numeroDelBackend = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

const MiNegocio: React.FC = () => {
    const navigate = useNavigate();
    const [nums, setNums] = useState<DayNumbers>({ vendiHoy: null, meDeben: null, enCaja: null, gananciaHoy: null });
    const [businessName, setBusinessName] = useState('');
    // Líneas vendidas hoy SIN costo cargado: la ganancia está sobreestimada y
    // hay que decirlo, no maquillarlo (NX-01).
    const [lineasSinCosto, setLineasSinCosto] = useState(0);
    // Una venta real es el momento de activación. El backend deriva ambos hitos
    // de los datos del negocio; esta pantalla no guarda progreso paralelo.
    const [activation, setActivation] = useState<ActivationStatus | null>(null);

    useEffect(() => {
        try {
            const u = JSON.parse(localStorage.getItem('nortex_user') || '{}');
            setBusinessName(u?.tenant?.businessName || u?.tenant?.name || '');
        } catch { /* sin nombre — el saludo sale genérico */ }

        const token = localStorage.getItem('nortex_token');
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };

        // Los dos fetch son independientes: si uno falla, el otro igual pinta.
        (async () => {
            try {
                const res = await fetch('/api/dashboard/stats', { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.todayStats) {
                        setNums(prev => ({
                            ...prev,
                            vendiHoy: Number(data.todayStats.totalSales ?? 0),
                            // NX-01: la ganancia del día es la GANANCIA BRUTA —
                            // ingreso neto (el precio de góndola trae el IVA del
                            // fisco adentro) menos el costo de lo vendido. No es
                            // lo vendido, ni las ventas menos los gastos.
                            gananciaHoy: numeroDelBackend(data.todayStats.gananciaBruta),
                        }));
                        const sinCosto = numeroDelBackend(data.todayStats.lineasSinCosto);
                        setLineasSinCosto(sinCosto !== null && sinCosto > 0 ? Math.trunc(sinCosto) : 0);
                    }
                }
            } catch { /* sin red — se queda en "—" */ }
        })();

        (async () => {
            try {
                // "En caja": suma del efectivo estimado de los turnos abiertos.
                // Mismo gate de rol que esta pantalla (OWNER/ADMIN/MANAGER); si
                // igual devuelve 403 o falla, el número queda en "—".
                const res = await fetch('/api/shifts/monitor', { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.activeShifts)) {
                        const total = data.activeShifts.reduce(
                            (sum: number, s: { estimatedPhysicalCash?: number }) => sum + Number(s.estimatedPhysicalCash ?? 0), 0);
                        setNums(prev => ({ ...prev, enCaja: total }));
                    }
                }
            } catch { /* sin red — se queda en "—" */ }
        })();

        (async () => {
            try {
                const res = await fetch('/api/collections/worklist?dueSoonDays=7', { headers });
                if (res.ok) {
                    const data = await res.json();
                    // El worklist responde { summary: { totalReceivable, ... }, items }.
                    const total = data?.summary?.totalReceivable ?? data?.totalReceivable;
                    if (typeof total === 'number') {
                        setNums(prev => ({ ...prev, meDeben: total }));
                    }
                }
            } catch { /* sin red — se queda en "—" */ }
        })();

        (async () => {
            try {
                const data = await fetchOnboardingStatus(token);
                if (!Array.isArray(data?.steps)) return;

                const product = data.steps.find((step: { key?: string }) => step.key === 'product');
                const sale = data.steps.find((step: { key?: string }) => step.key === 'sale');

                // LENDER no tiene estos pasos y conserva su experiencia propia.
                if (sale) {
                    const next = { hasProduct: Boolean(product?.done), hasSale: Boolean(sale.done) };
                    setActivation(next);
                    if (!next.hasSale) {
                        trackEvent('activation_first_sale_viewed', {
                            source: 'mi_negocio',
                            has_products: next.hasProduct,
                            onboarding_step: next.hasProduct ? 'checkout' : 'product',
                        });
                    }
                }
            } catch { /* sin red — el inicio operativo sigue disponible */ }
        })();
    }, []);

    const startFirstSale = () => {
        if (!activation || activation.hasSale) return;

        trackEvent('activation_first_sale_started', {
            source: 'mi_negocio',
            has_products: activation.hasProduct,
            onboarding_step: activation.hasProduct ? 'checkout' : 'product',
        });
        // La primera venta es REAL. Nunca sembramos productos ficticios dentro
        // del inventario del negocio: si falta catálogo, el POS permite crear un
        // producto mínimo (nombre + precio) dentro del mismo flujo.
        navigate('/app/pos?first_sale=1');
    };

    const startPracticeSale = () => {
        trackEvent('activation_practice_started', { source: 'mi_negocio' });
        // /demo vive fuera del ledger autenticado: no abre turno, no descuenta
        // inventario y no altera reportes. Es la única práctica honesta.
        navigate('/demo?source=onboarding');
    };

    const hoy = new Date().toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });
    const needsActivation = activation !== null && !activation.hasSale;

    const acciones = [
        { label: 'Vender', desc: 'Cobrar en caja', path: '/app/pos', icon: ShoppingCart, principal: true, tone: 'positive' },
        { label: 'Cobrar fiado', desc: 'Quién te debe', path: '/app/receivables', icon: Wallet, principal: false, tone: 'warning' },
        { label: 'Agregar producto', desc: 'Meter mercadería', path: '/app/inventory?quick=1', icon: PackagePlus, principal: false, tone: 'neutral' },
        { label: 'Mi plata', desc: 'Cómo va el negocio', path: '/app/dashboard', icon: LayoutGrid, principal: false, tone: 'info' },
    ] as const;

    const actionToneClass = {
        positive: 'nx-tone-positive-bg nx-tone-positive',
        warning: 'nx-tone-warning-bg nx-tone-warning',
        neutral: 'nx-tone-neutral-bg nx-tone-neutral',
        info: 'nx-tone-info-bg nx-tone-info',
    } as const;

    return (
        <div className="nx-workspace h-full overflow-y-auto custom-scrollbar p-4 sm:p-8">
            <div className="max-w-3xl mx-auto">
                {/* Saludo */}
                <header className="mb-6">
                    <h1 className="nx-module-header nx-canvas-text text-2xl sm:text-3xl font-extrabold">
                        {businessName ? `¡Hola, ${businessName}!` : '¡Hola!'}
                    </h1>
                    <p className="nx-canvas-muted capitalize mt-1">{hoy}</p>
                </header>

                {needsActivation && (
                    <section
                        aria-labelledby="first-sale-title"
                        className="nx-canvas-card p-5 sm:p-8 mb-8"
                    >
                        <div className="max-w-2xl">
                            <p className="nx-tone-positive text-sm font-bold mb-2">Empezá por lo importante</p>
                            <h2 id="first-sale-title" className="nx-module-header nx-canvas-text text-2xl sm:text-3xl font-extrabold leading-tight">
                                Hacé tu primera venta
                            </h2>
                            <p className="nx-canvas-muted mt-3 leading-relaxed max-w-xl">
                                Elegí un producto, cobrá y listo. Si todavía no cargaste ninguno, te pediremos solo el nombre y el precio.
                            </p>

                            <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
                                <button
                                    type="button"
                                    onClick={startFirstSale}
                                    className="nx-fluid-press min-h-[52px] w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3 bg-brand border border-brand text-brand-on font-extrabold rounded-control hover:bg-brand-hover focus-visible:outline-none"
                                >
                                    <ShoppingCart size={20} aria-hidden="true" />
                                    Registrar una venta real
                                    <ArrowRight size={20} aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={startPracticeSale}
                                    className="nx-fluid-press nx-canvas-card nx-canvas-text min-h-[52px] w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 font-bold rounded-control hover:brightness-[0.98] focus-visible:outline-none"
                                >
                                    <PlayCircle size={19} aria-hidden="true" />
                                    Practicar sin guardar datos
                                </button>
                            </div>

                            <p className="nx-canvas-faint text-xs mt-4">
                                La venta real actualiza tu caja e inventario. La práctica no toca la información de tu negocio.
                            </p>
                        </div>
                    </section>
                )}

                {needsActivation && (
                    <div className="border-t border-[var(--nx-canvas-border)] pt-7 mb-4">
                        <h2 className="nx-canvas-text text-lg font-bold">Tu negocio en un vistazo</h2>
                        <p className="nx-canvas-muted text-sm mt-1">Estos datos se van a completar a medida que usás Nortex.</p>
                    </div>
                )}

                {/* El día en 3 números */}
                <section aria-label="Resumen del día" className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                    <div className="nx-canvas-card p-5">
                        <p className="nx-canvas-muted text-sm font-medium">Hoy vendí</p>
                        <p className="nx-tone-positive text-2xl font-extrabold mt-1">{formatCordobas(nums.vendiHoy)}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/app/receivables')}
                        className="nx-fluid-press nx-canvas-card p-5 text-left hover:border-warning transition-colors"
                    >
                        <p className="nx-canvas-muted text-sm font-medium">Me deben (fiado)</p>
                        <p className="nx-tone-warning text-2xl font-extrabold mt-1">{formatCordobas(nums.meDeben)}</p>
                    </button>
                    <div className="nx-canvas-card p-5">
                        <p className="nx-canvas-muted text-sm font-medium">En caja</p>
                        <p className="nx-tone-info text-2xl font-extrabold mt-1">{formatCordobas(nums.enCaja)}</p>
                    </div>
                    <div className="nx-canvas-card p-5">
                        <p className="nx-canvas-muted text-sm font-medium">Ganancia de hoy</p>
                        <p className="nx-tone-positive text-2xl font-extrabold mt-1">{formatCordobas(nums.gananciaHoy)}</p>
                        {/* Sin costos cargados la ganancia sale inflada: se avisa
                            y se ofrece el camino para arreglarlo (NX-01). */}
                        {lineasSinCosto > 0 && (
                            <button
                                type="button"
                                onClick={() => navigate('/app/inventory')}
                                className="nx-fluid-press nx-tone-warning mt-2 min-h-tap rounded-control text-left text-[11px] leading-snug underline underline-offset-2"
                            >
                                Ganancia estimada — faltan costos en {lineasSinCosto} producto{lineasSinCosto === 1 ? '' : 's'}
                            </button>
                        )}
                    </div>
                </section>

                {needsActivation && (
                    <h2 className="nx-canvas-text text-base font-bold mb-3">Otras cosas que podés hacer</h2>
                )}

                {/* Las 4 acciones del día — botones grandes, ícono + palabra */}
                <section aria-label="Acciones" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {acciones.map(a => {
                        const Icon = a.icon;
                        const isPrincipal = a.principal && !needsActivation;
                        return (
                            <button
                                key={a.path}
                                type="button"
                                onClick={() => navigate(a.path)}
                                className={`
                                    nx-fluid-press flex items-center gap-4 p-6 rounded-card border text-left transition-colors min-h-[96px]
                                    ${isPrincipal
                                        ? 'bg-brand border-brand text-brand-on hover:bg-brand-hover shadow-glow shadow-brand/20'
                                        : 'nx-canvas-card nx-canvas-text hover:brightness-[0.98]'}
                                `}
                            >
                                <div className={`w-14 h-14 rounded-control flex items-center justify-center flex-shrink-0 ${isPrincipal ? 'bg-brand-on/10 text-brand-on' : actionToneClass[a.tone]}`}>
                                    <Icon size={28} aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-extrabold text-lg leading-tight">{a.label}</p>
                                    <p className={`text-sm mt-0.5 ${isPrincipal ? 'text-brand-on/80' : 'nx-canvas-muted'}`}>{a.desc}</p>
                                </div>
                                <ArrowRight size={20} aria-hidden="true" className={isPrincipal ? 'text-brand-on/70' : 'nx-canvas-faint'} />
                            </button>
                        );
                    })}
                </section>

                <p className="nx-canvas-faint text-xs mt-8 text-center">
                    ¿Buscás algo más? En la compu está en "Más opciones" del menú; en el teléfono, en el botón "Menú" de abajo.
                </p>
            </div>
        </div>
    );
};

export default MiNegocio;
