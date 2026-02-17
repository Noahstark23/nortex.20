import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShieldCheck, TrendingUp, TrendingDown, Package, DollarSign, Receipt, Warehouse, FileSpreadsheet, Loader2, Calendar, AlertTriangle, RefreshCw, Landmark, Scale, Copy, CheckCircle, Building2, Printer, Clock, Users } from 'lucide-react';
import { ShiftReportTicket, type ShiftReportData } from './ShiftReportTicket';

// Helpers
const IVA_RATE = 0.15;

const formatCurrency = (n: number) =>
    n.toLocaleString('es-NI', { style: 'currency', currency: 'NIO', minimumFractionDigits: 2 }).replace('NIO', 'C$');

const formatUSD = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatC = (n: number) =>
    `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getDefaultDates = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
};

interface SalesReport {
    totalVentas: number;
    ventasNetas: number;
    ivaRecaudado: number;
    totalCOGS: number;
    utilidadBruta: number;
    totalTransacciones: number;
    chartData: { name: string; ventas: number; gastos: number }[];
}

interface InventoryReport {
    inventoryValue: number;
    totalProducts: number;
    lowStock: { id: string; name: string; sku: string; stock: number; minStock: number; cost: number }[];
}

interface ExpensesReport {
    totalExpenses: number;
    count: number;
    byCategory: Record<string, number>;
}

interface TaxReportData {
    month: number;
    year: number;
    totalSales: number;
    salesNetasSinIVA: number;
    totalIVACollected: number;
    totalPurchases: number;
    totalIVAPaid: number;
    ivaNeto: number;
    ivaCredito: number;
    anticipoIR: number;
    imiAlcaldia: number;
    totalToPay: number;
    vetSummary: string;
}

const Reports: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'CONTADOR' | 'CAJAS'>('DASHBOARD');
    const [dates, setDates] = useState(getDefaultDates);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [salesData, setSalesData] = useState<SalesReport | null>(null);
    const [inventoryData, setInventoryData] = useState<InventoryReport | null>(null);
    const [expensesData, setExpensesData] = useState<ExpensesReport | null>(null);

    // Contador tab state
    const [taxMonth, setTaxMonth] = useState(new Date().getMonth() + 1);
    const [taxYear, setTaxYear] = useState(new Date().getFullYear());
    const [taxReport, setTaxReport] = useState<TaxReportData | null>(null);
    const [generatingTax, setGeneratingTax] = useState(false);
    const [copiedVET, setCopiedVET] = useState(false);

    // Cajas (Shift History) tab state
    const [shiftHistory, setShiftHistory] = useState<any[]>([]);
    const [shiftHistoryLoading, setShiftHistoryLoading] = useState(false);
    const [zReportData, setZReportData] = useState<ShiftReportData | null>(null);

    const token = localStorage.getItem('nortex_token');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchReports = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true); else setLoading(true);
        const params = `startDate=${dates.startDate}&endDate=${dates.endDate}`;

        try {
            const [salesRes, inventoryRes, expensesRes] = await Promise.all([
                fetch(`/api/reports/sales?${params}`, { headers }),
                fetch('/api/reports/inventory', { headers }),
                fetch(`/api/reports/expenses?${params}`, { headers }),
            ]);

            if (salesRes.ok) setSalesData(await salesRes.json());
            if (inventoryRes.ok) setInventoryData(await inventoryRes.json());
            if (expensesRes.ok) setExpensesData(await expensesRes.json());
        } catch (e) {
            console.error('Error cargando reportes:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [dates]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    // Fetch shift history when CAJAS tab is active
    const fetchShiftHistory = useCallback(async () => {
        setShiftHistoryLoading(true);
        try {
            const res = await fetch('/api/shifts/history', { headers });
            if (res.ok) setShiftHistory(await res.json());
        } catch (e) { console.error('Error fetching shift history:', e); }
        finally { setShiftHistoryLoading(false); }
    }, []);

    useEffect(() => {
        if (activeTab === 'CAJAS') fetchShiftHistory();
    }, [activeTab]);

    const getTenantName = () => {
        try {
            const t = localStorage.getItem('nortex_tenant');
            return t ? JSON.parse(t).businessName : 'Mi Negocio';
        } catch { return 'Mi Negocio'; }
    };

    const handleReprintZ = (shift: any) => {
        const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        setZReportData({
            businessName: getTenantName(),
            cashierName: shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : 'Sin asignar',
            startTime: formatDate(shift.startTime),
            endTime: formatDate(shift.endTime),
            initialCash: shift.initialCash,
            cashTotal: shift.cashTotal,
            cardTotal: shift.cardTotal,
            creditTotal: shift.creditTotal,
            grandTotal: shift.grandTotal,
            systemExpectedCash: shift.systemExpectedCash ?? 0,
            finalCashDeclared: shift.finalCashDeclared ?? 0,
            difference: shift.difference ?? 0,
            totalSales: shift.totalSales,
        });
        setTimeout(() => window.print(), 200);
    };

    // Computed
    const utilidadNeta = (salesData?.ventasNetas ?? 0) - (salesData?.totalCOGS ?? 0) - (expensesData?.totalExpenses ?? 0);
    const margen = salesData && salesData.ventasNetas > 0
        ? (utilidadNeta / salesData.ventasNetas) * 100
        : 0;

    // Tax report generation
    const handleGenerateTaxReport = async () => {
        setGeneratingTax(true);
        try {
            const res = await fetch('/api/tax-report/generate', {
                method: 'POST',
                headers,
                body: JSON.stringify({ month: taxMonth, year: taxYear }),
            });
            if (res.ok) {
                const data = await res.json();
                setTaxReport(data);
            } else {
                const err = await res.json();
                alert(err.error || 'Error al generar reporte fiscal');
            }
        } catch (e: any) { alert('Error de conexión: ' + e?.message); }
        finally { setGeneratingTax(false); }
    };

    const handleCopyVET = () => {
        if (taxReport?.vetSummary) {
            navigator.clipboard.writeText(taxReport.vetSummary);
            setCopiedVET(true);
            setTimeout(() => setCopiedVET(false), 3000);
        }
    };

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500 gap-2">
                <Loader2 className="animate-spin" size={24} /> Cargando Inteligencia Financiera...
            </div>
        );
    }

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-nortex-900 flex items-center gap-2">
                        <ShieldCheck className="text-nortex-500" /> Inteligencia Financiera
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Reportes fiscales adaptados a normativa DGI Nicaragua (IVA 15%)</p>
                </div>

                {/* TAB SWITCHER */}
                <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                    <button
                        onClick={() => setActiveTab('DASHBOARD')}
                        className={`px-4 py-2 text-sm font-bold transition-colors ${activeTab === 'DASHBOARD' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        Dashboard
                    </button>
                    <button
                        onClick={() => setActiveTab('CONTADOR')}
                        className={`px-4 py-2 text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'CONTADOR' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Landmark size={14} /> Contador DGI
                    </button>
                    <button
                        onClick={() => setActiveTab('CAJAS')}
                        className={`px-4 py-2 text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'CAJAS' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Clock size={14} /> Historial Cajas
                    </button>
                </div>
            </div>

            {/* ==================== TAB: DASHBOARD ==================== */}
            {activeTab === 'DASHBOARD' && (
                <>
                    {/* DATE FILTER + ACTIONS */}
                    <div className="flex items-center gap-3 flex-wrap mb-8">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
                            <Calendar size={16} className="text-slate-400" />
                            <input
                                type="date"
                                className="text-sm text-slate-700 outline-none bg-transparent"
                                value={dates.startDate}
                                onChange={e => setDates(prev => ({ ...prev, startDate: e.target.value }))}
                            />
                            <span className="text-slate-400 text-xs">a</span>
                            <input
                                type="date"
                                className="text-sm text-slate-700 outline-none bg-transparent"
                                value={dates.endDate}
                                onChange={e => setDates(prev => ({ ...prev, endDate: e.target.value }))}
                            />
                        </div>
                        <button
                            onClick={() => fetchReports(true)}
                            disabled={refreshing}
                            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm text-slate-600 transition-colors"
                            title="Actualizar"
                        >
                            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => alert('Generando archivo Excel para la DGI...\n\nEsta funcionalidad se conectara a un generador de XLSX en una proxima version.')}
                            className="flex items-center gap-2 px-4 py-2 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800 shadow-lg transition-colors text-sm"
                        >
                            <FileSpreadsheet size={16} /> Descargar Reporte DGI
                        </button>
                    </div>

                    {/* KPI CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                        {/* Ventas Netas (Sin IVA) */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                    <DollarSign size={20} />
                                </div>
                                <span className="text-[10px] font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold">SIN IVA</span>
                            </div>
                            <div className="text-xs font-mono text-slate-500 mb-1">VENTAS NETAS</div>
                            <div className="text-2xl font-bold text-slate-800">{formatUSD(salesData?.ventasNetas ?? 0)}</div>
                            <div className="text-xs text-slate-400 mt-1">{salesData?.totalTransacciones ?? 0} transacciones</div>
                        </div>

                        {/* IVA Recaudado */}
                        <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-12 h-12 bg-amber-500/10 rounded-bl-full" />
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                                    <Receipt size={20} />
                                </div>
                                <span className="text-[10px] font-mono bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">DGI</span>
                            </div>
                            <div className="text-xs font-mono text-slate-500 mb-1">IVA RECAUDADO (15%)</div>
                            <div className="text-2xl font-bold text-amber-700">{formatUSD(salesData?.ivaRecaudado ?? 0)}</div>
                            <div className="text-xs text-amber-600 mt-1">Para declarar a la DGI</div>
                        </div>

                        {/* Utilidad Neta */}
                        <div className={`p-5 rounded-xl border shadow-sm relative overflow-hidden ${utilidadNeta >= 0 ? 'bg-white border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/5 rounded-bl-full" />
                            <div className="flex items-center justify-between mb-3">
                                <div className={`p-2 rounded-lg ${utilidadNeta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                                    {utilidadNeta >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                                </div>
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${margen >= 25 ? 'bg-emerald-50 text-emerald-700' : margen >= 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
                                    {margen.toFixed(1)}%
                                </span>
                            </div>
                            <div className="text-xs font-mono text-slate-500 mb-1">UTILIDAD NETA</div>
                            <div className={`text-2xl font-bold ${utilidadNeta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                {formatUSD(utilidadNeta)}
                            </div>
                            <div className="text-xs text-slate-400 mt-1">Ventas - Costo - Gastos</div>
                        </div>

                        {/* Gastos del Periodo */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2 bg-red-50 text-red-500 rounded-lg">
                                    <TrendingDown size={20} />
                                </div>
                            </div>
                            <div className="text-xs font-mono text-slate-500 mb-1">GASTOS OPERATIVOS</div>
                            <div className="text-2xl font-bold text-red-600">{formatUSD(expensesData?.totalExpenses ?? 0)}</div>
                            <div className="text-xs text-slate-400 mt-1">{expensesData?.count ?? 0} registros</div>
                        </div>

                        {/* Valor en Bodega */}
                        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-5 rounded-xl shadow-lg relative overflow-hidden">
                            <div className="absolute -right-4 -top-4 w-20 h-20 bg-nortex-accent blur-[40px] opacity-20" />
                            <div className="flex items-center justify-between mb-3 relative z-10">
                                <div className="p-2 bg-white/10 rounded-lg">
                                    <Warehouse size={20} />
                                </div>
                                <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded font-bold">
                                    {inventoryData?.totalProducts ?? 0} SKUs
                                </span>
                            </div>
                            <div className="text-xs font-mono text-slate-400 mb-1 relative z-10">VALOR EN BODEGA</div>
                            <div className="text-2xl font-bold text-white relative z-10">{formatUSD(inventoryData?.inventoryValue ?? 0)}</div>
                            <div className="text-xs text-slate-400 mt-1 relative z-10">Costo total inventario</div>
                        </div>
                    </div>

                    {/* CHART + EXPENSES BREAKDOWN */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                        {/* Sales vs Expenses Chart */}
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-1">Tendencia: Ventas vs Gastos</h3>
                            <p className="text-xs text-slate-400 mb-6">Flujo diario en el periodo seleccionado</p>
                            <div className="h-72">
                                {salesData && salesData.chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={salesData.chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                                            <Tooltip
                                                cursor={{ fill: '#f1f5f9' }}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                                formatter={(value: number) => ['$' + value.toFixed(2)]}
                                            />
                                            <Legend />
                                            <Bar dataKey="ventas" fill="#3b82f6" name="Ventas" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="gastos" fill="#ef4444" name="Gastos" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                        <BarChart width={48} height={48} data={[]}><Bar dataKey="x" /></BarChart>
                                        <p className="text-sm mt-2">Sin datos en el periodo seleccionado</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Expenses by Category */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-1">Gastos por Categoria</h3>
                            <p className="text-xs text-slate-400 mb-6">Desglose del periodo</p>
                            <div className="space-y-3">
                                {expensesData && Object.keys(expensesData.byCategory).length > 0 ? (
                                    Object.entries(expensesData.byCategory)
                                        .sort(([, a], [, b]) => (b as number) - (a as number))
                                        .map(([cat, amt]) => {
                                            const amount = amt as number;
                                            const pct = expensesData.totalExpenses > 0
                                                ? (amount / expensesData.totalExpenses) * 100
                                                : 0;
                                            return (
                                                <div key={cat}>
                                                    <div className="flex justify-between text-sm mb-1">
                                                        <span className="text-slate-600 font-medium">{cat}</span>
                                                        <span className="font-mono font-bold text-slate-800">{formatUSD(amount)}</span>
                                                    </div>
                                                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                                        <div className="bg-red-400 h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })
                                ) : (
                                    <div className="text-center py-8 text-slate-400 text-sm">
                                        Sin gastos registrados
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* DESGLOSE FISCAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        {/* Fiscal Summary Table */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Receipt size={18} className="text-amber-500" /> Desglose Fiscal (IVA 15%)
                            </h3>
                            <div className="overflow-hidden rounded-lg border border-slate-100">
                                <table className="w-full text-sm">
                                    <tbody className="divide-y divide-slate-100">
                                        <tr className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-600">Ventas Brutas (con IVA)</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                                                {formatUSD(salesData?.totalVentas ?? 0)}
                                            </td>
                                        </tr>
                                        <tr className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-600">(-) IVA 15%</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-amber-600">
                                                -{formatUSD(salesData?.ivaRecaudado ?? 0)}
                                            </td>
                                        </tr>
                                        <tr className="hover:bg-slate-50 bg-blue-50/50">
                                            <td className="px-4 py-3 font-bold text-blue-700">= Ventas Netas</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">
                                                {formatUSD(salesData?.ventasNetas ?? 0)}
                                            </td>
                                        </tr>
                                        <tr className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-600">(-) Costo de Ventas (COGS)</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-600">
                                                -{formatUSD(salesData?.totalCOGS ?? 0)}
                                            </td>
                                        </tr>
                                        <tr className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-600">(-) Gastos Operativos</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-red-500">
                                                -{formatUSD(expensesData?.totalExpenses ?? 0)}
                                            </td>
                                        </tr>
                                        <tr className={`${utilidadNeta >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                                            <td className={`px-4 py-4 font-bold text-lg ${utilidadNeta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                                = UTILIDAD NETA
                                            </td>
                                            <td className={`px-4 py-4 text-right font-mono font-bold text-lg ${utilidadNeta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                                {formatUSD(utilidadNeta)}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Low Stock Alert */}
                        <div className="bg-white p-6 rounded-xl border border-red-100 shadow-sm relative">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <AlertTriangle size={64} className="text-red-500" />
                            </div>
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Package className="text-red-500" size={18} /> Alerta de Stock Critico
                            </h3>
                            <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                                {inventoryData && inventoryData.lowStock.length > 0 ? (
                                    inventoryData.lowStock.map(p => (
                                        <div key={p.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100">
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                                                <div className="text-xs text-red-500 font-mono">SKU: {p.sku} | Min: {p.minStock}</div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-red-600">{p.stock}</span>
                                                <div className="text-[10px] text-red-400">unidades</div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-slate-400 text-sm">
                                        Inventario saludable. Sin alertas.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ==================== TAB: CONTADOR DGI ==================== */}
            {activeTab === 'CONTADOR' && (
                <div>
                    {/* Period Selector */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                                <Landmark className="text-blue-600" /> Oficina del Contador
                            </h2>
                            <p className="text-slate-500 text-sm">Declaración mensual DGI | Ley de Concertación Tributaria (LCT 822)</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <select
                                value={taxMonth}
                                onChange={e => setTaxMonth(Number(e.target.value))}
                                className="border p-2 rounded-lg text-slate-800 bg-white"
                            >
                                {monthNames.map((m, i) => (
                                    <option key={i} value={i + 1}>{m}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                value={taxYear}
                                onChange={e => setTaxYear(Number(e.target.value))}
                                className="border p-2 rounded-lg w-24 text-slate-800"
                            />
                            <button
                                onClick={handleGenerateTaxReport}
                                disabled={generatingTax}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"
                            >
                                <Scale size={18} /> {generatingTax ? 'Calculando...' : 'Generar Declaración'}
                            </button>
                        </div>
                    </div>

                    {!taxReport ? (
                        <div className="text-center py-20 text-slate-400">
                            <Landmark size={64} className="mx-auto mb-4 opacity-30" />
                            <p className="text-lg font-bold">Selecciona un periodo y genera la declaración</p>
                            <p className="text-sm mt-1">El sistema calculará IVA, Anticipo IR y Cuota Alcaldía automáticamente</p>
                        </div>
                    ) : (
                        <>
                            {/* MEGA CARD: Total a Pagar */}
                            <div className="bg-gradient-to-br from-red-600 to-red-800 text-white p-8 rounded-2xl shadow-xl mb-8 relative overflow-hidden">
                                <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/5 rounded-full" />
                                <div className="absolute -right-5 bottom-0 w-24 h-24 bg-white/5 rounded-full" />
                                <div className="relative z-10">
                                    <div className="text-sm font-mono opacity-80 mb-1">IMPUESTOS A PAGAR ESTE MES</div>
                                    <div className="text-xs opacity-60 mb-4">{monthNames[taxReport.month - 1]} {taxReport.year}</div>
                                    <div className="text-5xl font-bold mb-4">{formatC(taxReport.totalToPay)}</div>
                                    <div className="text-sm opacity-80">
                                        Fecha límite de presentación: 15 de {monthNames[taxReport.month] || monthNames[0]} {taxReport.month === 12 ? taxReport.year + 1 : taxReport.year}
                                    </div>
                                </div>
                            </div>

                            {/* Desglose de impuestos */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                {/* Alcaldía */}
                                <div className="bg-white p-6 rounded-xl border-2 border-blue-200 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                                            <Building2 size={24} />
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500 font-mono">ALCALDÍA (IMI 1%)</div>
                                            <div className="text-sm text-slate-400">Impuesto Municipal</div>
                                        </div>
                                    </div>
                                    <div className="text-3xl font-bold text-blue-700">{formatC(taxReport.imiAlcaldia)}</div>
                                    <div className="text-xs text-slate-400 mt-2">Base: {formatC(taxReport.salesNetasSinIVA)} (Ventas sin IVA)</div>
                                </div>

                                {/* DGI Anticipo IR */}
                                <div className="bg-white p-6 rounded-xl border-2 border-amber-200 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
                                            <Scale size={24} />
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500 font-mono">DGI ANTICIPO IR (1%)</div>
                                            <div className="text-sm text-slate-400">Dirección General de Ingresos</div>
                                        </div>
                                    </div>
                                    <div className="text-3xl font-bold text-amber-700">{formatC(taxReport.anticipoIR)}</div>
                                    <div className="text-xs text-slate-400 mt-2">Base: {formatC(taxReport.salesNetasSinIVA)} (Ingresos brutos)</div>
                                </div>

                                {/* IVA Neto */}
                                <div className="bg-white p-6 rounded-xl border-2 border-emerald-200 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                                            <Receipt size={24} />
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500 font-mono">IVA NETO (15%)</div>
                                            <div className="text-sm text-slate-400">Débito - Crédito Fiscal</div>
                                        </div>
                                    </div>
                                    <div className="text-3xl font-bold text-emerald-700">{formatC(taxReport.ivaNeto)}</div>
                                    {taxReport.ivaCredito > 0 && (
                                        <div className="text-xs text-emerald-600 mt-2 bg-emerald-50 p-2 rounded">
                                            Crédito fiscal a favor: {formatC(taxReport.ivaCredito)}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Desglose completo */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                                {/* Tabla desglose */}
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <h3 className="font-bold text-slate-800 mb-4">Desglose del Período</h3>
                                    <div className="overflow-hidden rounded-lg border border-slate-100">
                                        <table className="w-full text-sm">
                                            <tbody className="divide-y divide-slate-100">
                                                <tr className="bg-blue-50/50">
                                                    <td className="px-4 py-3 font-bold text-blue-700" colSpan={2}>VENTAS</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-600">Ventas Brutas (con IVA)</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold">{formatC(taxReport.totalSales)}</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-600">Ventas Netas (sin IVA)</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold">{formatC(taxReport.salesNetasSinIVA)}</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-600">IVA Cobrado (Débito Fiscal)</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-amber-600">{formatC(taxReport.totalIVACollected)}</td>
                                                </tr>

                                                <tr className="bg-green-50/50">
                                                    <td className="px-4 py-3 font-bold text-green-700" colSpan={2}>COMPRAS</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-600">Compras Brutas (con IVA)</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold">{formatC(taxReport.totalPurchases)}</td>
                                                </tr>
                                                <tr className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-600">IVA Pagado (Crédito Fiscal)</td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatC(taxReport.totalIVAPaid)}</td>
                                                </tr>

                                                <tr className="bg-red-50">
                                                    <td className="px-4 py-4 font-bold text-red-700 text-lg">TOTAL A PAGAR</td>
                                                    <td className="px-4 py-4 text-right font-mono font-bold text-red-700 text-lg">{formatC(taxReport.totalToPay)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* VET Summary */}
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                            <FileSpreadsheet size={18} className="text-blue-500" /> Resumen para VET
                                        </h3>
                                        <button
                                            onClick={handleCopyVET}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${copiedVET ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {copiedVET ? <><CheckCircle size={14} /> Copiado!</> : <><Copy size={14} /> Copiar</>}
                                        </button>
                                    </div>
                                    <div className="bg-slate-900 text-green-400 p-4 rounded-lg font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre">
                                        {taxReport.vetSummary}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3">
                                        Copia este resumen y pégalo en la <strong>Ventanilla Electrónica Tributaria (VET)</strong> de la DGI:
                                        <a href="https://ventanilla.dgi.gob.ni" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1">
                                            ventanilla.dgi.gob.ni
                                        </a>
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ==================== TAB: HISTORIAL DE CAJAS ==================== */}
            {activeTab === 'CAJAS' && (
                <div>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                                <Users className="text-nortex-500" /> Auditoría de Cajas
                            </h2>
                            <p className="text-slate-500 text-sm">Historial completo de cierres — rastro inmutable anti-robo hormiga</p>
                        </div>
                        <button
                            onClick={fetchShiftHistory}
                            disabled={shiftHistoryLoading}
                            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm text-slate-600"
                            title="Actualizar"
                        >
                            <RefreshCw size={18} className={shiftHistoryLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    {shiftHistoryLoading ? (
                        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
                            <Loader2 className="animate-spin" size={24} /> Cargando historial...
                        </div>
                    ) : shiftHistory.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Clock size={64} className="mx-auto mb-4 opacity-30" />
                            <p className="text-lg font-bold">Sin cierres de caja registrados</p>
                            <p className="text-sm mt-1">Los cierres aparecerán aquí automáticamente</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-4 py-3 text-left font-bold text-slate-600">Fecha Cierre</th>
                                            <th className="px-4 py-3 text-left font-bold text-slate-600">Cajero</th>
                                            <th className="px-4 py-3 text-right font-bold text-slate-600">Ventas</th>
                                            <th className="px-4 py-3 text-right font-bold text-slate-600">Esperado</th>
                                            <th className="px-4 py-3 text-right font-bold text-slate-600">Declarado</th>
                                            <th className="px-4 py-3 text-right font-bold text-slate-600">Diferencia</th>
                                            <th className="px-4 py-3 text-center font-bold text-slate-600">Estado</th>
                                            <th className="px-4 py-3 text-center font-bold text-slate-600">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {shiftHistory.map((s: any) => {
                                            const diff = s.difference ?? 0;
                                            const diffColor = diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-600' : 'text-emerald-600';
                                            const diffBg = diff < 0 ? 'bg-red-50' : diff > 0 ? 'bg-amber-50' : 'bg-emerald-50';
                                            const statusLabel = diff < 0 ? 'FALTANTE' : diff > 0 ? 'SOBRANTE' : 'CUADRADO';
                                            const statusIcon = diff < 0 ? '🔴' : diff > 0 ? '🟡' : '🟢';

                                            return (
                                                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <div className="font-mono text-slate-800">
                                                            {new Date(s.endTime).toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                        </div>
                                                        <div className="text-xs text-slate-400">
                                                            {new Date(s.endTime).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-slate-800">
                                                            {s.employee ? `${s.employee.firstName} ${s.employee.lastName}` : 'N/A'}
                                                        </div>
                                                        <div className="text-xs text-slate-400">{s.totalSales} ventas</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                                                        C$ {s.grandTotal.toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                                                        C$ {(s.systemExpectedCash ?? 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                                                        C$ {(s.finalCashDeclared ?? 0).toFixed(2)}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-mono font-bold ${diffColor}`}>
                                                        {diff > 0 ? '+' : ''}C$ {diff.toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${diffBg} ${diffColor}`}>
                                                            {statusIcon} {statusLabel}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={() => handleReprintZ(s)}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-nortex-900 text-white text-xs font-bold rounded-lg hover:bg-nortex-800 transition-colors shadow-sm"
                                                            title="Reimprimir Reporte Z"
                                                        >
                                                            <Printer size={14} /> Reporte Z
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* HIDDEN: Shift Report Ticket for printing */}
            <ShiftReportTicket data={zReportData} />
        </div>
    );
};

export default Reports;
