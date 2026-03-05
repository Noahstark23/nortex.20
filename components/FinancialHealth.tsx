import React, { useState, useEffect } from 'react';
import {
    TrendingUp, TrendingDown, DollarSign, Shield, Target, BarChart3, PieChart,
    ArrowUpRight, ArrowDownRight, Loader2, RefreshCw, AlertTriangle, CheckCircle,
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
    score: {
        value: number;
        rating: string;
        creditLimit: number;
        factors: string[];
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

    const formatC = (n: number) => `C$${n.toLocaleString('es-NI', { minimumFractionDigits: 2 })}`;

    const getScoreColor = (score: number) => {
        if (score >= 800) return 'text-emerald-500';
        if (score >= 670) return 'text-blue-500';
        if (score >= 500) return 'text-amber-500';
        return 'text-red-500';
    };

    const getScoreGradient = (score: number) => {
        if (score >= 800) return 'from-emerald-500 to-green-600';
        if (score >= 670) return 'from-blue-500 to-indigo-600';
        if (score >= 500) return 'from-amber-500 to-orange-600';
        return 'from-red-500 to-rose-600';
    };

    const getRatingBadge = (rating: string) => {
        const colors: Record<string, string> = {
            'AAA': 'bg-emerald-100 text-emerald-700 border-emerald-200',
            'AA': 'bg-blue-100 text-blue-700 border-blue-200',
            'A': 'bg-sky-100 text-sky-700 border-sky-200',
            'B': 'bg-amber-100 text-amber-700 border-amber-200',
            'C': 'bg-orange-100 text-orange-700 border-orange-200',
            'D': 'bg-red-100 text-red-700 border-red-200',
        };
        return colors[rating] || 'bg-slate-100 text-slate-700';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-50">
                <Loader2 className="animate-spin text-nortex-500" size={32} />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-50">
                <div className="text-center text-slate-500">
                    <AlertTriangle className="mx-auto mb-3" size={40} />
                    <p>{error || 'Sin datos'}</p>
                    <button onClick={fetchData} className="mt-3 text-nortex-500 hover:underline">Reintentar</button>
                </div>
            </div>
        );
    }

    const scorePercent = ((data.score.value - 300) / 550) * 100;

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-6 custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <BarChart3 className="text-nortex-500" /> Salud Financiera
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Vista ejecutiva de tu negocio — datos en tiempo real</p>
                </div>
                <button onClick={fetchData} className="p-2 rounded-xl hover:bg-white text-slate-400 hover:text-slate-600 transition-colors border border-transparent hover:border-slate-200">
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

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Nortex Score */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Shield size={16} /> Nortex Score
                    </h2>
                    <div className="text-center mb-4">
                        <div className={`text-5xl font-black ${getScoreColor(data.score.value)}`}>
                            {data.score.value}
                        </div>
                        <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-bold border ${getRatingBadge(data.score.rating)}`}>
                            {data.score.rating}
                        </span>
                    </div>

                    {/* Score Bar */}
                    <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
                        <div
                            className={`absolute left-0 top-0 h-full rounded-full bg-gradient-to-r ${getScoreGradient(data.score.value)} transition-all`}
                            style={{ width: `${Math.min(scorePercent, 100)}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-slate-400 mb-4">
                        <span>300</span><span>550</span><span>700</span><span>850</span>
                    </div>

                    <div className="text-sm text-slate-600 mb-3">
                        <span className="font-medium">Línea de crédito: </span>
                        <span className="font-bold text-emerald-600">{formatC(data.score.creditLimit)}</span>
                    </div>

                    <div className="space-y-1.5">
                        {data.score.factors.slice(0, 5).map((f, i) => (
                            <div key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                                {f.includes('⚠️') || f.includes('RIESGO') ? (
                                    <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                ) : (
                                    <CheckCircle size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                                )}
                                {f}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Balance General */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Landmark size={16} /> Balance General
                    </h2>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-xs font-semibold text-emerald-600 uppercase mb-2">Activos</h3>
                            {data.balance.assets.filter(a => Number(a.balance) !== 0).map(a => (
                                <div key={a.code} className="flex justify-between text-sm py-1">
                                    <span className="text-slate-600">{a.name}</span>
                                    <span className="font-medium text-slate-800">{formatC(a.balance)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-sm font-bold border-t border-slate-100 pt-1 mt-1">
                                <span className="text-emerald-700">Total Activos</span>
                                <span>{formatC(data.balance.totals.assets)}</span>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-semibold text-red-500 uppercase mb-2">Pasivos</h3>
                            {data.balance.liabilities.filter(a => Number(a.balance) !== 0).map(a => (
                                <div key={a.code} className="flex justify-between text-sm py-1">
                                    <span className="text-slate-600">{a.name}</span>
                                    <span className="font-medium text-slate-800">{formatC(Math.abs(a.balance))}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-sm font-bold border-t border-slate-100 pt-1 mt-1">
                                <span className="text-red-600">Total Pasivos</span>
                                <span>{formatC(Math.abs(data.balance.totals.liabilities))}</span>
                            </div>
                        </div>

                        <div className={`flex justify-between text-sm font-bold px-3 py-2 rounded-lg ${data.balance.totals.isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            <span>{data.balance.totals.isBalanced ? '✅ Cuadrado' : '❌ Descuadrado'}</span>
                            <span>Capital: {formatC(data.balance.totals.equity + data.balance.totals.netIncome)}</span>
                        </div>
                    </div>
                </div>

                {/* Estado de Resultados */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <PieChart size={16} /> Estado de Resultados
                    </h2>

                    <div className="space-y-3">
                        <ResultRow label="Ventas" value={data.estadoResultados.revenue.total} color="emerald" formatC={formatC} />
                        <ResultRow label="(−) Costo de Ventas" value={-data.estadoResultados.costOfSales} color="red" formatC={formatC} />
                        <ResultRow label="= Utilidad Bruta" value={data.estadoResultados.grossProfit} color="blue" bold formatC={formatC} />
                        <ResultRow label="(−) Gastos Operativos" value={-data.estadoResultados.operatingExpenses.total} color="red" formatC={formatC} />
                        <div className="border-t-2 border-slate-200 pt-2">
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

                    <div className="mt-4 p-3 bg-slate-50 rounded-xl text-xs text-slate-500">
                        Periodo: <strong>{data.estadoResultados.period}</strong>
                    </div>
                </div>
            </div>
        </div>
    );
};

// KPI Card Component
const KPICard = ({ title, value, icon, trend, color }: {
    title: string; value: string; icon: React.ReactNode;
    trend?: 'up' | 'down'; color: string;
}) => {
    const colorMap: Record<string, string> = {
        emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
        blue: 'bg-blue-50 text-blue-600 border-blue-200',
        amber: 'bg-amber-50 text-amber-600 border-amber-200',
        red: 'bg-red-50 text-red-600 border-red-200',
    };
    const iconColorMap: Record<string, string> = {
        emerald: 'bg-emerald-100 text-emerald-600',
        blue: 'bg-blue-100 text-blue-600',
        amber: 'bg-amber-100 text-amber-600',
        red: 'bg-red-100 text-red-600',
    };

    return (
        <div className={`rounded-2xl border p-4 ${colorMap[color]}`}>
            <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-xl ${iconColorMap[color]}`}>{icon}</div>
                {trend && (
                    trend === 'up'
                        ? <ArrowUpRight size={16} className="text-emerald-500" />
                        : <ArrowDownRight size={16} className="text-red-500" />
                )}
            </div>
            <div className="font-bold text-lg text-slate-900">{value}</div>
            <div className="text-xs font-medium opacity-70">{title}</div>
        </div>
    );
};

// Result Row Component
const ResultRow = ({ label, value, color, bold, large, formatC }: {
    label: string; value: number; color: string; bold?: boolean; large?: boolean;
    formatC: (n: number) => string;
}) => (
    <div className={`flex justify-between items-center ${bold ? 'font-bold' : ''} ${large ? 'text-base' : 'text-sm'}`}>
        <span className="text-slate-600">{label}</span>
        <span className={`text-${color}-600`}>
            {value >= 0 ? formatC(value) : `(${formatC(Math.abs(value))})`}
        </span>
    </div>
);

export default FinancialHealth;
