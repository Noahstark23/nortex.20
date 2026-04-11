import React, { useState, useEffect } from 'react';
import {
    AlertTriangle, Shield, Package, XCircle, Percent, Clock, User, ChevronDown,
    Loader2, RefreshCw, Filter, Eye, FileSpreadsheet, Download, Stamp
} from 'lucide-react';

// Types
interface AuditAlert {
    id: string;
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
    userName?: string;
    amount?: number;
    timestamp: string;
}

interface KardexSuspicion {
    movementId: string;
    productName: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    reason: string | null;
    userName: string;
    date: string;
    severity: string;
    riskReason: string;
}

interface VoidAnalysis {
    userId: string;
    userName: string;
    totalVoids: number;
    totalAmountVoided: number;
    riskLevel: string;
    voids: { id: string; amount: number; reason: string | null; category: string; voidedAt: string }[];
}

interface DiscountAnalysis {
    userId: string;
    userName: string;
    totalSales: number;
    salesWithDiscount: number;
    totalDiscountGiven: number;
    avgDiscountPercent: number;
    riskLevel: string;
}

type Tab = 'feed' | 'kardex' | 'voids' | 'discounts' | 'fiscal';

const AuditDashboard: React.FC = () => {
    // ACCOUNTANT role defaults to fiscal tab
    const getUserRole = () => {
        try {
            const t = localStorage.getItem('nortex_token');
            if (!t) return '';
            return JSON.parse(atob(t.split('.')[1])).role || '';
        } catch { return ''; }
    };
    const userRole = getUserRole();
    const defaultTab: Tab = userRole === 'ACCOUNTANT' ? 'fiscal' : 'feed';

    const [tab, setTab] = useState<Tab>(defaultTab);
    const [feed, setFeed] = useState<AuditAlert[]>([]);
    const [kardex, setKardex] = useState<KardexSuspicion[]>([]);
    const [voids, setVoids] = useState<VoidAnalysis[]>([]);
    const [discounts, setDiscounts] = useState<DiscountAnalysis[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedVoid, setExpandedVoid] = useState<string | null>(null);

    // Fiscal tab state
    const now = new Date();
    const [fiscalMonth, setFiscalMonth] = useState(now.getMonth() + 1);
    const [fiscalYear, setFiscalYear] = useState(now.getFullYear());

    const token = localStorage.getItem('nortex_token');
    const headers = { Authorization: `Bearer ${token}` };

    const fetchTab = async (t: Tab) => {
        if (t === 'fiscal') { setLoading(false); return; }
        setLoading(true);
        try {
            const routes: Record<Exclude<Tab, 'fiscal'>, string> = {
                feed: '/api/audit/feed',
                kardex: '/api/audit/kardex-suspicious',
                voids: '/api/audit/voided-movements',
                discounts: '/api/audit/discounts',
            };
            const res = await fetch(routes[t as Exclude<Tab, 'fiscal'>], { headers });
            if (res.ok) {
                const data = await res.json();
                if (t === 'feed') setFeed(data);
                if (t === 'kardex') setKardex(data);
                if (t === 'voids') setVoids(data);
                if (t === 'discounts') setDiscounts(data);
            }
        } catch (e) { /* silent */ }
        setLoading(false);
    };

    useEffect(() => { fetchTab(tab); }, [tab]);

    const formatC = (n: number) => `C$${Math.abs(n).toLocaleString('es-NI', { minimumFractionDigits: 2 })}`;
    const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    const severityConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
        LOW: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400', label: 'Bajo' },
        MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', label: 'Medio' },
        HIGH: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', label: 'Alto' },
        CRITICAL: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Crítico' },
    };

    const riskBadge = (level: string) => {
        const cfg = severityConfig[level] || severityConfig.LOW;
        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
            </span>
        );
    };

    const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
        { key: 'fiscal', label: 'Exportaciones DGI', icon: <FileSpreadsheet size={16} /> },
        { key: 'feed', label: 'Alertas', icon: <AlertTriangle size={16} />, count: feed.filter(f => f.severity === 'HIGH' || f.severity === 'CRITICAL').length },
        { key: 'kardex', label: 'Kardex Pro', icon: <Package size={16} />, count: kardex.filter(k => k.severity === 'HIGH' || k.severity === 'CRITICAL').length },
        { key: 'voids', label: 'Anulaciones', icon: <XCircle size={16} />, count: voids.filter(v => v.riskLevel === 'HIGH').length },
        { key: 'discounts', label: 'Descuentos', icon: <Percent size={16} />, count: discounts.filter(d => d.riskLevel === 'HIGH').length },
    ];

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-6 custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Shield className="text-red-500" /> Auditoría Forense
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Detección de anomalías — últimos 30 días</p>
                </div>
                <button onClick={() => fetchTab(tab)} className="p-2 rounded-xl hover:bg-white text-slate-400 hover:text-slate-600 border border-transparent hover:border-slate-200 transition-all">
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${tab === t.key
                                ? 'bg-white text-slate-900 shadow-md border border-slate-200'
                                : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
                            }`}
                    >
                        {t.icon}
                        {t.label}
                        {t.count !== undefined && t.count > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                {t.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── FISCAL TAB ─────────────────────────────── */}
            {tab === 'fiscal' && (
                <div className="space-y-6">
                    {/* Month / Year picker */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                            <FileSpreadsheet size={16} className="text-indigo-500" />
                            Período fiscal
                        </h2>
                        <div className="flex items-center gap-3">
                            <select
                                value={fiscalMonth}
                                onChange={e => setFiscalMonth(Number(e.target.value))}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            >
                                {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                                    <option key={i+1} value={i+1}>{m}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                value={fiscalYear}
                                onChange={e => setFiscalYear(Number(e.target.value))}
                                min={2020} max={2099}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 w-24 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                        </div>
                    </div>

                    {/* Download cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <a
                            href={`/api/fiscal/libro-ventas/${fiscalMonth}/${fiscalYear}`}
                            download
                            className="flex flex-col items-center gap-3 bg-white border border-emerald-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-emerald-400 transition-all group"
                        >
                            <FileSpreadsheet size={32} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                            <div className="text-center">
                                <p className="font-semibold text-slate-800 text-sm">Libro de Ventas</p>
                                <p className="text-xs text-slate-500 mt-0.5">Excel (.xlsx) — DGI Nicaragua</p>
                            </div>
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-medium">Descargar</span>
                        </a>

                        <a
                            href={`/api/fiscal/libro-compras/${fiscalMonth}/${fiscalYear}`}
                            download
                            className="flex flex-col items-center gap-3 bg-white border border-blue-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-blue-400 transition-all group"
                        >
                            <FileSpreadsheet size={32} className="text-blue-500 group-hover:scale-110 transition-transform" />
                            <div className="text-center">
                                <p className="font-semibold text-slate-800 text-sm">Libro de Compras</p>
                                <p className="text-xs text-slate-500 mt-0.5">Excel (.xlsx) — DGI Nicaragua</p>
                            </div>
                            <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">Descargar</span>
                        </a>

                        <a
                            href={`/api/fiscal/vet-export/${fiscalMonth}/${fiscalYear}`}
                            download
                            className="flex flex-col items-center gap-3 bg-white border border-violet-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-violet-400 transition-all group"
                        >
                            <Download size={32} className="text-violet-500 group-hover:scale-110 transition-transform" />
                            <div className="text-center">
                                <p className="font-semibold text-slate-800 text-sm">Archivo VET</p>
                                <p className="text-xs text-slate-500 mt-0.5">TXT pipe-delimited — DGI VET</p>
                            </div>
                            <span className="text-xs bg-violet-100 text-violet-700 px-3 py-1 rounded-full font-medium">Descargar</span>
                        </a>
                    </div>

                    {/* Constancias note */}
                    <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex items-start gap-3">
                        <Stamp size={20} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-indigo-800">Constancias de Retención</p>
                            <p className="text-xs text-indigo-600 mt-1">
                                Las constancias individuales se generan desde el módulo <strong>Compras</strong> — botón violeta <Stamp size={11} className="inline" /> junto a cada factura de proveedor.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {tab !== 'fiscal' && loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-nortex-500" size={28} />
                </div>
            ) : tab !== 'fiscal' && (
                <>
                    {/* Feed Tab */}
                    {tab === 'feed' && (
                        <div className="space-y-2">
                            {feed.length === 0 ? (
                                <EmptyState message="Sin alertas en los últimos 30 días" />
                            ) : feed.map(alert => {
                                const cfg = severityConfig[alert.severity] || severityConfig.LOW;
                                return (
                                    <div key={alert.id} className={`flex items-start gap-3 p-4 rounded-xl border ${cfg.bg} border-slate-200/60`}>
                                        <div className={`w-2 h-2 rounded-full ${cfg.dot} mt-2 flex-shrink-0`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-sm font-semibold ${cfg.text}`}>{alert.title}</span>
                                                {riskBadge(alert.severity)}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">{alert.description}</p>
                                            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                                                {alert.userName && <span className="flex items-center gap-1"><User size={10} /> {alert.userName}</span>}
                                                <span className="flex items-center gap-1"><Clock size={10} /> {formatDate(alert.timestamp)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Kardex Tab */}
                    {tab === 'kardex' && (
                        <div className="space-y-2">
                            {kardex.length === 0 ? (
                                <EmptyState message="Sin movimientos sospechosos detectados" />
                            ) : kardex.map(k => (
                                <div key={k.movementId} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition-shadow">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-semibold text-sm text-slate-800">{k.productName}</span>
                                        {riskBadge(k.severity)}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 mb-2">
                                        <span>Stock antes: <strong className="text-slate-700">{k.stockBefore}</strong></span>
                                        <span>Stock después: <strong className="text-slate-700">{k.stockAfter}</strong></span>
                                        <span>Cantidad: <strong className={`${Number(k.quantity) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{k.quantity}</strong></span>
                                    </div>
                                    <p className="text-xs text-orange-600 font-medium">{k.riskReason}</p>
                                    {k.reason && <p className="text-xs text-slate-400 mt-1">Razón: {k.reason}</p>}
                                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                                        <span className="flex items-center gap-1"><User size={10} /> {k.userName}</span>
                                        <span className="flex items-center gap-1"><Clock size={10} /> {formatDate(k.date)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Voids Tab */}
                    {tab === 'voids' && (
                        <div className="space-y-3">
                            {voids.length === 0 ? (
                                <EmptyState message="Sin anulaciones registradas" />
                            ) : voids.map(v => (
                                <div key={v.userId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                    <button
                                        onClick={() => setExpandedVoid(expandedVoid === v.userId ? null : v.userId)}
                                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                                                <User size={18} className="text-slate-500" />
                                            </div>
                                            <div className="text-left">
                                                <div className="font-semibold text-sm text-slate-800">{v.userName}</div>
                                                <div className="text-xs text-slate-400">{v.totalVoids} anulaciones — {formatC(v.totalAmountVoided)}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {riskBadge(v.riskLevel)}
                                            <ChevronDown size={16} className={`text-slate-400 transition-transform ${expandedVoid === v.userId ? 'rotate-180' : ''}`} />
                                        </div>
                                    </button>
                                    {expandedVoid === v.userId && (
                                        <div className="border-t border-slate-100 p-4 bg-slate-50 space-y-2">
                                            {v.voids.map(vo => (
                                                <div key={vo.id} className="flex items-center justify-between text-xs bg-white rounded-lg p-3 border border-slate-200">
                                                    <div>
                                                        <span className="font-medium text-slate-700">{vo.category}</span>
                                                        <span className="text-slate-400 ml-2">{vo.reason || 'SIN RAZÓN'}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-red-600">{formatC(vo.amount)}</div>
                                                        <div className="text-slate-400">{formatDate(vo.voidedAt)}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Discounts Tab */}
                    {tab === 'discounts' && (
                        <div className="space-y-3">
                            {discounts.length === 0 ? (
                                <EmptyState message="Sin descuentos registrados" />
                            ) : (
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                                            <tr>
                                                <th className="text-left px-4 py-3">Cajero</th>
                                                <th className="text-center px-4 py-3">Ventas c/Desc</th>
                                                <th className="text-center px-4 py-3">% de Ventas</th>
                                                <th className="text-right px-4 py-3">Total Desc.</th>
                                                <th className="text-center px-4 py-3">Riesgo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {discounts.map(d => (
                                                <tr key={d.userId} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-3 font-medium text-slate-800">{d.userName}</td>
                                                    <td className="px-4 py-3 text-center text-slate-600">
                                                        {d.salesWithDiscount} / {d.totalSales}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-600">
                                                        {d.avgDiscountPercent.toFixed(1)}%
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-red-600">
                                                        {formatC(d.totalDiscountGiven)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {riskBadge(d.riskLevel)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const EmptyState = ({ message }: { message: string }) => (
    <div className="text-center py-16 text-slate-400">
        <Shield size={40} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">{message}</p>
        <p className="text-xs mt-1">🟢 Todo en orden</p>
    </div>
);

export default AuditDashboard;
