import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Wallet, PackagePlus, LayoutGrid, ArrowRight } from 'lucide-react';

/**
 * Mi Negocio — pantalla de inicio del modo simple (Fase B del plan UX Simple).
 *
 * Para el dueño que no es de computadoras: el día en 3 números y las 4 acciones
 * de siempre en botones grandes. Nada de gráficos ni jerga — eso vive en
 * "Mi Plata" (/app/dashboard) para quien quiera profundizar.
 *
 * Datos: SOLO endpoints existentes (tenant-scoped por JWT en el backend):
 *   - /api/dashboard/stats      → todayStats.totalSales / netProfit
 *   - /api/collections/worklist → totalReceivable (el fiado en la calle)
 * Si una llamada falla (sin red, permisos), el número muestra "—" y los
 * botones siguen funcionando: la pantalla nunca bloquea la operación.
 */

interface DayNumbers {
    vendiHoy: number | null;
    meDeben: number | null;
    gananciaHoy: number | null;
}

const formatCordobas = (n: number | null): string => {
    if (n === null) return '—';
    return `C$${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const MiNegocio: React.FC = () => {
    const navigate = useNavigate();
    const [nums, setNums] = useState<DayNumbers>({ vendiHoy: null, meDeben: null, gananciaHoy: null });
    const [businessName, setBusinessName] = useState('');

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
                            gananciaHoy: Number(data.todayStats.netProfit ?? 0),
                        }));
                    }
                }
            } catch { /* sin red — se queda en "—" */ }
        })();

        (async () => {
            try {
                const res = await fetch('/api/collections/worklist?dueSoonDays=7', { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (typeof data.totalReceivable === 'number') {
                        setNums(prev => ({ ...prev, meDeben: data.totalReceivable }));
                    }
                }
            } catch { /* sin red — se queda en "—" */ }
        })();
    }, []);

    const hoy = new Date().toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });

    const acciones = [
        { label: 'Vender', desc: 'Cobrar en caja', path: '/app/pos', icon: ShoppingCart, principal: true },
        { label: 'Cobrar fiado', desc: 'Quién te debe', path: '/app/receivables', icon: Wallet, principal: false },
        { label: 'Agregar producto', desc: 'Meter mercadería', path: '/app/inventory', icon: PackagePlus, principal: false },
        { label: 'Mi plata', desc: 'Cómo va el negocio', path: '/app/dashboard', icon: LayoutGrid, principal: false },
    ];

    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-surface-950 p-4 sm:p-8">
            <div className="max-w-3xl mx-auto">
                {/* Saludo */}
                <header className="mb-6">
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                        {businessName ? `¡Hola, ${businessName}!` : '¡Hola!'}
                    </h1>
                    <p className="text-slate-400 capitalize mt-1">{hoy}</p>
                </header>

                {/* El día en 3 números */}
                <section aria-label="Resumen del día" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                        <p className="text-slate-400 text-sm font-medium">Hoy vendí</p>
                        <p className="text-2xl font-extrabold text-emerald-400 mt-1">{formatCordobas(nums.vendiHoy)}</p>
                    </div>
                    <button
                        onClick={() => navigate('/app/receivables')}
                        className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 text-left hover:border-amber-400/40 transition-colors"
                    >
                        <p className="text-slate-400 text-sm font-medium">Me deben (fiado)</p>
                        <p className="text-2xl font-extrabold text-amber-400 mt-1">{formatCordobas(nums.meDeben)}</p>
                    </button>
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                        <p className="text-slate-400 text-sm font-medium">Ganancia de hoy</p>
                        <p className="text-2xl font-extrabold text-white mt-1">{formatCordobas(nums.gananciaHoy)}</p>
                    </div>
                </section>

                {/* Las 4 acciones del día — botones grandes, ícono + palabra */}
                <section aria-label="Acciones" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {acciones.map(a => {
                        const Icon = a.icon;
                        return (
                            <button
                                key={a.path}
                                onClick={() => navigate(a.path)}
                                className={`
                                    flex items-center gap-4 p-6 rounded-2xl border text-left transition-all active:scale-[0.98] min-h-[96px]
                                    ${a.principal
                                        ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500 shadow-glow shadow-emerald-500/20'
                                        : 'bg-white/[0.03] border-white/[0.08] text-white hover:bg-white/[0.06] hover:border-white/[0.16]'}
                                `}
                            >
                                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${a.principal ? 'bg-white/20' : 'bg-white/[0.06]'}`}>
                                    <Icon size={28} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-extrabold text-lg leading-tight">{a.label}</p>
                                    <p className={`text-sm mt-0.5 ${a.principal ? 'text-emerald-100' : 'text-slate-400'}`}>{a.desc}</p>
                                </div>
                                <ArrowRight size={20} className={a.principal ? 'text-emerald-200' : 'text-slate-500'} />
                            </button>
                        );
                    })}
                </section>

                <p className="text-slate-500 text-xs mt-8 text-center">
                    ¿Buscás algo más? Está en el menú de la izquierda, en "Más opciones".
                </p>
            </div>
        </div>
    );
};

export default MiNegocio;
