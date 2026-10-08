import React, { useState, useEffect } from 'react';
import { formatMoney } from '../utils/money';
import {
    TrendingUp, DollarSign, Target, BarChart3, PieChart,
    ArrowUpRight, ArrowDownRight, Loader2, RefreshCw, AlertTriangle,
    Landmark, Scale
} from 'lucide-react';

interface FinancialData {
    kpis: {
        profitMargin: number;
        breakEven: number;
        ebitda: number;
        liquidityRatio: number;
        debtToEquity: number;
        netMargin: number;
    };
    balance: {
        assets: { code: string; name: string; balance: number }[];
        liabilities: { code: string; name: string; balance: number }[];
        equity: { code: string; name: string; balance: number }[];
        totals: {
            assets: number;
            liabilities: number;
            equity: number;
            netIncome: number;
            isBalanced: boolean;
        };
    };
    estadoResultados: {
        period: string;
        revenue: { total: number };
        costOfSales: number;
        grossProfit: number;
        operatingExpenses: { total: number };
        netIncome: number;
    };
}

const FinancialHealth: React.FC = () => {
    const [data, setData] = useState<FinancialData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/financial-health', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setData(await res.json());
                setError('');
            } else {
                setError('Error al cargar datos financieros');
            }
        } catch {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // Además de unificar el símbolo, fija 2 decimales: el toLocaleString anterior
    // permitía un tercero y la misma cifra se veía distinta según el monto.
    const formatC = (n: number) => formatMoney(n);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-surface-800/40">
                <Loader2 className="animate-spin text-nortex-500" size={32} />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center h-full bg-surface-800/40">
                <div className="text-center text-slate-500">
                    <AlertTriangle className="mx-auto mb-3" size={40} />
                    <p>{error || 'Sin datos'}</p>
                    <button onClick={fetchData} className="mt-3 text-nortex-500 hover:underline">Reintentar</button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-surface-800/40 p-6 custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <BarChart3 className="text-nortex-500" /> Salud Financiera
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Vista ejecutiva de tu negocio — datos en tiempo real</p>
                </div>
                <button onClick={fetchData} className="p-2 rounded-xl hover:bg-surface-900 text-slate-400 hover:text-slate-300 transition-colors border border-transparent hover:border-white/[0.06]">
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <KPICard
                    title="Margen de Utilidad"
                    value={`${data.kpis.profitMargin.toFixed(1)}%`}
                    icon={<TrendingUp size={20} />}
                    trend={data.kpis.profitMargin > 0 ? 'up' : 'down'}
                    color={data.kpis.profitMargin > 15 ? 'emerald' : data.kpis.profitMargin > 0 ? 'amber' : 'red'}
                />
                <KPICard
                    title="Punto de Equilibrio"
                    value={formatC(data.kpis.breakEven)}
                    icon={<Target size={20} />}
                    color="blue"
                />
                <KPICard
                    title="EBITDA"
                    value={formatC(data.kpis.ebitda)}
                    icon={<DollarSign size={20} />}
                    trend={data.kpis.ebitda > 0 ? 'up' : 'down'}
                    color={data.kpis.ebitda > 0 ? 'emerald' : 'red'}
                />
                <KPICard
                    title="Ratio de Liquidez"
                    value={`${data.kpis.liquidityRatio.toFixed(1)}x`}
                    icon={<Scale size={20} />}
                    color={data.kpis.liquidityRatio >= 1.5 ? 'emerald' : data.kpis.liquidityRatio >= 1 ? 'amber' : 'red'}
                />
            </div>

            {/* Acá vivía la tarjeta "Nortex Score" con su barra 300–850 y la
                "Línea de crédito". Nortex no otorga crédito hoy, así que el
                número no habilitaba nada: solo calificaba al dueño en su propia
                pantalla. El score se sigue calculando y se consulta desde el
                panel de SUPER_ADMIN. Lo que queda es lo que sí es suyo y sí
                puede usar: balance, estado de resultados y los KPIs de arriba. */}
            <div className="grid lg:grid-cols-2 gap-6">
                {/* Balance General */}
                <div className="lg:col-span-1 bg-surface-900 rounded-2xl border border-white/[0.06] p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Landmark size={16} /> Balance General
                    </h2>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-xs font-semibold text-emerald-400 uppercase mb-2">Activos</h3>
                            {data.balance.assets.filter(a => Number(a.balance) !== 0).map(a => (
                                <div key={a.code} className="flex justify-between text-sm py-1">
                                    <span className="text-slate-300">{a.name}</span>
                                    <span className="font-medium text-slate-100">{formatC(a.balance)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-sm font-bold border-t border-white/[0.04] pt-1 mt-1">
                                <span className="text-emerald-400">Total Activos</span>
                                <span>{formatC(data.balance.totals.assets)}</span>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-semibold text-red-500 uppercase mb-2">Pasivos</h3>
                            {data.balance.liabilities.filter(a => Number(a.balance) !== 0).map(a => (
                                <div key={a.code} className="flex justify-between text-sm py-1">
                                    <span className="text-slate-300">{a.name}</span>
                                    <span className="font-medium text-slate-100">{formatC(Math.abs(a.balance))}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-sm font-bold border-t border-white/[0.04] pt-1 mt-1">
                                <span className="text-red-400">Total Pasivos</span>
                                <span>{formatC(Math.abs(data.balance.totals.liabilities))}</span>
                            </div>
                        </div>

                        <div className={`flex justify-between text-sm font-bold px-3 py-2 rounded-lg ${data.balance.totals.isBalanced ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                            <span>{data.balance.totals.isBalanced ? 'Cuadrado' : 'Descuadrado'}</span>
                            <span>Capital: {formatC(data.balance.totals.equity + data.balance.totals.netIncome)}</span>
                        </div>
                    </div>
                </div>

                {/* Estado de Resultados */}
                <div className="lg:col-span-1 bg-surface-900 rounded-2xl border border-white/[0.06] p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <PieChart size={16} /> Estado de Resultados
                    </h2>

                    <div className="space-y-3">
                        <ResultRow label="Ventas" value={data.estadoResultados.revenue.total} color="emerald" formatC={formatC} />
                        <ResultRow label="(−) Costo de Ventas" value={-data.estadoResultados.costOfSales} color="red" formatC={formatC} />
                        <ResultRow label="= Utilidad Bruta" value={data.estadoResultados.grossProfit} color="blue" bold formatC={formatC} />
                        <ResultRow label="(−) Gastos Operativos" value={-data.estadoResultados.operatingExpenses.total} color="red" formatC={formatC} />
                        <div className="border-t-2 border-white/[0.06] pt-2">
                            <ResultRow
                                label="= Utilidad Neta"
                                value={data.estadoResultados.netIncome}
                                color={data.estadoResultados.netIncome >= 0 ? 'emerald' : 'red'}
                                bold
                                large
                                formatC={formatC}
                            />
                        </div>
                    </div>

                    <div className="mt-4 p-3 bg-surface-800/40 rounded-xl text-xs text-slate-500">
                        Periodo: <strong>{data.estadoResultados.period}</strong>
                    </div>
                </div>
            </div>
        </div>
    );
};

// KPI Card Component
// La tarjeta ya NO se tiñe entera del color del estado: con 4 tarjetas en fila,
// cada una de un color, la vista se vuelve inescaneable. La superficie es
// neutra y el color queda reservado al indicador de tendencia.
const KPICard = ({ title, value, icon, trend, color }: {
    title: string; value: string; icon: React.ReactNode;
    trend?: 'up' | 'down'; color: string;
}) => {
    // El color califica el estado del indicador (solo el chip del ícono).
    const iconColorMap: Record<string, string> = {
        emerald: 'bg-brand-soft text-brand',
        blue: 'bg-white/[0.05] text-slate-300',
        amber: 'bg-warning-soft text-amber-400',
        red: 'bg-danger-soft text-danger',
    };

    return (
        <div className="rounded-card border border-white/[0.06] bg-surface-900 p-4">
            <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-control ${iconColorMap[color] ?? iconColorMap.blue}`}>{icon}</div>
                {trend && (
                    trend === 'up'
                        ? <ArrowUpRight size={16} className="text-brand" />
                        : <ArrowDownRight size={16} className="text-danger" />
                )}
            </div>
            {/* La cifra siempre en color de texto principal. */}
            <div className="nx-kpi text-lg">{value}</div>
            <div className="text-xs font-medium text-slate-500">{title}</div>
        </div>
    );
};

// Mapa estático de colores: una clase construida en runtime (`text-${color}-600`)
// no la ve el escaneo de contenido de Tailwind y nunca se genera.
const RESULT_ROW_COLOR: Record<string, string> = {
    emerald: 'text-brand',
    green: 'text-brand',
    red: 'text-danger',
    amber: 'text-amber-400',
    blue: 'text-slate-100',
    slate: 'text-slate-300',
};

// Result Row Component
const ResultRow = ({ label, value, color, bold, large, formatC }: {
    label: string; value: number; color: string; bold?: boolean; large?: boolean;
    formatC: (n: number) => string;
}) => (
    <div className={`flex justify-between items-center ${bold ? 'font-bold' : ''} ${large ? 'text-base' : 'text-sm'}`}>
        <span className="text-slate-300">{label}</span>
        <span className={RESULT_ROW_COLOR[color] ?? 'text-slate-100'}>
            {value >= 0 ? formatC(value) : `(${formatC(Math.abs(value))})`}
        </span>
    </div>
);

export default FinancialHealth;
