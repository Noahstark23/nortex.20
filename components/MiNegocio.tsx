import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, PackagePlus, LayoutGrid, ArrowRight } from 'lucide-react';
import { formatMoney } from '../utils/money';
import { HomeSalesJourney } from './activation/HomeSalesJourney';
import { readActivationSession, useActivationSession, type ActivationSession } from '../hooks/useActivationJourney';

/**
 * Mi Negocio — pantalla de inicio del modo simple (Fase B del plan UX Simple).
 *
 * Una venta como acción principal y las cifras del día como contexto.
 * Los atajos secundarios conservan acceso a productos, fiado y reportes. Nada de gráficos ni jerga — eso vive en
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
    const session = useActivationSession();
    return <MiNegocioSession key={session.key} session={session} />;
};

// Cambiar de sesión desmonta los datos y el progreso del negocio anterior.
const MiNegocioSession: React.FC<{ session: ActivationSession }> = ({ session }) => {
    const navigate = useNavigate();
    const [nums, setNums] = useState<DayNumbers>({ vendiHoy: null, meDeben: null, enCaja: null, gananciaHoy: null });
    const [businessName, setBusinessName] = useState('');
    // Líneas vendidas hoy SIN costo cargado: la ganancia está sobreestimada y
    // hay que decirlo, no maquillarlo (NX-01).
    const [lineasSinCosto, setLineasSinCosto] = useState(0);

    useEffect(() => {
        try {
            const u = JSON.parse(localStorage.getItem('nortex_user') || '{}');
            setBusinessName(u?.tenant?.businessName || u?.tenant?.name || '');
        } catch { /* sin nombre — el saludo sale genérico */ }

        if (!session.token) return;
        const headers = { Authorization: `Bearer ${session.token}` };
        let mounted = true;
        let generation = 0;
        let controller: AbortController | null = null;
        const refreshNumbers = () => {
            if (readActivationSession().key !== session.key) return;
            const request = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;
            const isCurrent = () => mounted && request === generation
                && readActivationSession().key === session.key;

            // Las lecturas son independientes: si una falla, las demás siguen disponibles.
            (async () => {
                try {
                    const res = await fetch('/api/dashboard/stats', { headers, signal });
                    if (!res.ok) throw new Error('Cifras del día no disponibles');
                    const data = await res.json();
                    if (!isCurrent()) return;
                    setNums(prev => ({
                        ...prev,
                        vendiHoy: numeroDelBackend(data?.todayStats?.totalSales),
                        // NX-01: la ganancia del día es la GANANCIA BRUTA —
                        // ingreso neto (el precio de góndola trae el IVA del
                        // fisco adentro) menos el costo de lo vendido. No es
                        // lo vendido, ni las ventas menos los gastos.
                        gananciaHoy: numeroDelBackend(data?.todayStats?.gananciaBruta),
                    }));
                    const sinCosto = numeroDelBackend(data?.todayStats?.lineasSinCosto);
                    setLineasSinCosto(sinCosto !== null && sinCosto > 0 ? Math.trunc(sinCosto) : 0);
                } catch {
                    if (isCurrent()) {
                        setNums(prev => ({ ...prev, vendiHoy: null, gananciaHoy: null }));
                        setLineasSinCosto(0);
                    }
                }
            })();

            (async () => {
                try {
                    // "En caja": suma del efectivo estimado de los turnos abiertos.
                    // Mismo gate de rol que esta pantalla (OWNER/ADMIN/MANAGER); si
                    // igual devuelve 403 o falla, el número queda en "—".
                    const res = await fetch('/api/shifts/monitor', { headers, signal });
                    if (!res.ok) throw new Error('Caja no disponible');
                    const data = await res.json();
                    if (!isCurrent()) return;
                    const shifts = data?.activeShifts;
                    if (!Array.isArray(shifts) || shifts.some(s => numeroDelBackend(s?.estimatedPhysicalCash) === null)) {
                        throw new Error('Caja incompleta');
                    }
                    const total = shifts.reduce(
                        (sum: number, s: { estimatedPhysicalCash: number }) => sum + s.estimatedPhysicalCash, 0);
                    setNums(prev => ({ ...prev, enCaja: numeroDelBackend(total) }));
                } catch {
                    if (isCurrent()) setNums(prev => ({ ...prev, enCaja: null }));
                }
            })();

            (async () => {
                try {
                    const res = await fetch('/api/collections/worklist?dueSoonDays=7', { headers, signal });
                    if (!res.ok) throw new Error('Fiado no disponible');
                    const data = await res.json();
                    if (!isCurrent()) return;
                    // El worklist responde { summary: { totalReceivable, ... }, items }.
                    const total = data?.summary?.totalReceivable ?? data?.totalReceivable;
                    setNums(prev => ({ ...prev, meDeben: numeroDelBackend(total) }));
                } catch {
                    if (isCurrent()) setNums(prev => ({ ...prev, meDeben: null }));
                }
            })();

        };
        refreshNumbers();
        window.addEventListener('nortex:data-changed', refreshNumbers);
        return () => {
            mounted = false;
            controller?.abort();
            window.removeEventListener('nortex:data-changed', refreshNumbers);
        };
    }, [session.key, session.token]);

    const hoy = new Date().toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });

    const acciones = [
        { label: 'Cobrar fiado', desc: 'Quién te debe', path: '/app/receivables', icon: Wallet, tone: 'warning' },
        { label: 'Agregar producto', desc: 'Meter mercadería', path: '/app/inventory?quick=1', icon: PackagePlus, tone: 'neutral' },
        { label: 'Mi plata', desc: 'Cómo va el negocio', path: '/app/dashboard', icon: LayoutGrid, tone: 'info' },
    ] as const;

    const actionToneClass = {
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

                <HomeSalesJourney session={session} />

                {/* Cifras del negocio después de la acción principal. */}
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

                {/* Atajos secundarios: Vender ya tiene una única acción principal. */}
                <section aria-label="Acciones" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {acciones.map(a => {
                        const Icon = a.icon;
                        return (
                            <button
                                key={a.path}
                                type="button"
                                onClick={() => navigate(a.path)}
                                className="nx-fluid-press nx-canvas-card nx-canvas-text flex items-center gap-3 p-4 rounded-card border text-left transition-colors min-h-[80px] hover:brightness-[0.98]"
                            >
                                <div className={`w-10 h-10 rounded-control flex items-center justify-center flex-shrink-0 ${actionToneClass[a.tone]}`}>
                                    <Icon size={22} aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm leading-tight">{a.label}</p>
                                    <p className="nx-canvas-muted text-xs mt-0.5">{a.desc}</p>
                                </div>
                                <ArrowRight size={17} aria-hidden="true" className="nx-canvas-faint shrink-0" />
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
