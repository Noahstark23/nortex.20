import React, { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, Clock, ShoppingCart, ArrowDownCircle, ArrowUpCircle, DollarSign, AlertTriangle, CheckCircle, X, Printer, User, TrendingUp, Banknote, Lock, Calculator, Loader2 } from 'lucide-react';

interface LiveShift {
    id: string;
    employee: { firstName: string; lastName: string; role: string } | null;
    user: { name: string; email: string };
    startTime: string;
    initialCash: number;
    vaultCashSales: number;
    vaultCardSales: number;
    vaultCreditSales: number;
    vaultManualINs: number;
    vaultManualOUTs: number;
    estimatedPhysicalCash: number;
    salesCount: number;
    movementsCount: number;
    lastSaleAt: string | null;
    recentMovements: { type: string; amount: number; category: string; description: string; createdAt: string }[];
}

interface ClosedShift {
    id: string;
    startTime: string;
    endTime: string;
    employee: { firstName: string; lastName: string } | null;
    user: { name: string };
    initialCash: number;
    finalCashDeclared: number | null;
    systemExpectedCash: number | null;
    difference: number;
    status: 'PERFECT' | 'WARNING' | 'ALERT';
    salesCount: number;
    cashTotal: number;
    cardTotal: number;
    creditTotal: number;
    grandTotal: number;
}

const CashRegisters: React.FC = () => {
    const [activeShifts, setActiveShifts] = useState<LiveShift[]>([]);
    const [closedShifts, setClosedShifts] = useState<ClosedShift[]>([]);
    const [theftThreshold, setTheftThreshold] = useState(500);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [selectedShift, setSelectedShift] = useState<ClosedShift | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Force Close Modal State
    const [shiftToClose, setShiftToClose] = useState<LiveShift | null>(null);
    const [closing, setClosing] = useState(false);
    const [auditNotes, setAuditNotes] = useState('');
    const [denominations, setDenominations] = useState({
        1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0
    });

    const calculateTotalDeclared = () => {
        return Object.entries(denominations).reduce((total, [value, count]) => {
            return total + (Number(value) * Number(count));
        }, 0);
    };

    const handleDenominationChange = (value: number, count: string) => {
        const parsed = parseInt(count) || 0;
        setDenominations(prev => ({ ...prev, [value]: Math.max(0, parsed) }));
    };

    const handleForceClose = async () => {
        if (!shiftToClose) return;
        setClosing(true);
        const finalCashDeclared = calculateTotalDeclared();

        try {
            const res = await fetch(`/api/shifts/close`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify({
                    shiftId: shiftToClose.id,
                    declaredCash: finalCashDeclared,
                    auditNotes
                })
            });

            if (res.ok) {
                setShiftToClose(null);
                setDenominations({ 1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
                setAuditNotes('');
                fetchMonitor();
            } else {
                const data = await res.json();
                alert(data.error || 'Error al cerrar la caja');
            }
        } catch (err) {
            alert('Error de conexión al cerrar la caja');
        } finally {
            setClosing(false);
        }
    };

    const token = localStorage.getItem('nortex_token');
    const headers = { 'Authorization': `Bearer ${token}` };

    const fetchMonitor = useCallback(async () => {
        try {
            const res = await fetch('/api/shifts/monitor', { headers });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Error cargando monitor');
            }
            const data = await res.json();
            setActiveShifts(data.activeShifts);
            setClosedShifts(data.closedShifts);
            setTheftThreshold(data.theftThreshold);
            setLastRefresh(new Date());
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load + auto-refresh every 15 seconds
    useEffect(() => {
        fetchMonitor();
        const interval = setInterval(fetchMonitor, 15000);
        return () => clearInterval(interval);
    }, [fetchMonitor]);

    const timeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Ahora mismo';
        if (mins < 60) return `Hace ${mins} min`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `Hace ${hrs}h ${mins % 60}m`;
        return `Hace ${Math.floor(hrs / 24)} día(s)`;
    };

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 text-slate-500">
                    <RefreshCw className="animate-spin" size={24} />
                    <span className="text-lg font-medium">Cargando monitor de cajas...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md text-center">
                    <AlertTriangle className="text-red-500 mx-auto mb-3" size={32} />
                    <h3 className="font-bold text-red-700 mb-1">Error de Acceso</h3>
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            {/* HEADER */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-nortex-900 text-nortex-accent rounded-xl flex items-center justify-center">
                            <Monitor size={22} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-800">Cajas y Arqueos</h1>
                            <p className="text-xs text-slate-500">Última actualización: {formatTime(lastRefresh.toISOString())} · Auto-refresh 15s</p>
                        </div>
                    </div>
                    <button
                        onClick={fetchMonitor}
                        className="flex items-center gap-2 text-sm font-medium text-nortex-600 hover:text-nortex-700 bg-nortex-50 hover:bg-nortex-100 px-4 py-2 rounded-lg transition-all"
                    >
                        <RefreshCw size={16} /> Actualizar
                    </button>
                </div>
            </div>

            <div className="p-6 space-y-8">

                {/* ====== ZONA 1: CAJAS ACTIVAS (LIVE MONITOR) ====== */}
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                        <h2 className="text-lg font-bold text-slate-800">Cajas Activas</h2>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{activeShifts.length}</span>
                    </div>

                    {activeShifts.length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                            <Monitor className="text-slate-300 mx-auto mb-3" size={48} />
                            <p className="text-slate-500 font-medium">Todas las cajas están cerradas</p>
                            <p className="text-xs text-slate-400 mt-1">Los turnos activos aparecerán aquí en tiempo real</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                            {activeShifts.map(shift => (
                                <div key={shift.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                    {/* Card Header */}
                                    <div className="bg-nortex-900 px-4 py-3 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-nortex-accent/20 text-nortex-accent rounded-full flex items-center justify-center font-bold text-sm">
                                                {shift.employee ? shift.employee.firstName.charAt(0) + shift.employee.lastName.charAt(0) : '??'}
                                            </div>
                                            <div>
                                                <p className="text-white font-bold text-sm">
                                                    {shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}
                                                </p>
                                                <p className="text-slate-400 text-[10px] flex items-center gap-1">
                                                    <Clock size={10} /> Abierta: {formatTime(shift.startTime)} ({timeAgo(shift.startTime)})
                                                </p>
                                            </div>
                                        </div>
                                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                    </div>

                                    {/* Vaults */}
                                    <div className="p-4 space-y-3">
                                        {/* Vault: Cash Sales */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ShoppingCart size={14} className="text-blue-500" />
                                                <span>Ventas Efectivo</span>
                                            </div>
                                            <span className="font-bold text-slate-800">C${shift.vaultCashSales.toFixed(2)}</span>
                                        </div>

                                        {/* Vault: Manual INs */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ArrowDownCircle size={14} className="text-emerald-500" />
                                                <span>Entradas Manuales</span>
                                            </div>
                                            <span className="font-bold text-emerald-600">+C${shift.vaultManualINs.toFixed(2)}</span>
                                        </div>

                                        {/* Vault: Manual OUTs */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ArrowUpCircle size={14} className="text-amber-500" />
                                                <span>Salidas</span>
                                            </div>
                                            <span className="font-bold text-amber-600">-C${shift.vaultManualOUTs.toFixed(2)}</span>
                                        </div>

                                        {/* Divider */}
                                        <div className="border-t border-dashed border-slate-200 pt-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                                    <Banknote size={16} className="text-nortex-600" />
                                                    Efectivo en Gaveta
                                                </div>
                                                <span className="text-xl font-black text-nortex-900">C${shift.estimatedPhysicalCash.toFixed(2)}</span>
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-1">Fondo: C${shift.initialCash.toFixed(2)} · {shift.salesCount} ventas · {shift.movementsCount} movimientos</p>
                                        </div>
                                    </div>

                                    {/* Card Footer */}
                                    <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                                        <div className="text-[10px] text-slate-400">
                                            <span className="flex items-center gap-1 mb-1">
                                                {shift.vaultCardSales > 0 && <span>💳 C${shift.vaultCardSales.toFixed(0)}</span>}
                                                {shift.vaultCreditSales > 0 && <span> · 📝 C${shift.vaultCreditSales.toFixed(0)} crédito</span>}
                                            </span>
                                            <span>{shift.lastSaleAt ? `Última venta: ${timeAgo(shift.lastSaleAt)}` : 'Sin ventas'}</span>
                                        </div>
                                        <button
                                            onClick={() => setShiftToClose(shift)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-bold text-xs rounded-lg transition-colors border border-red-100"
                                        >
                                            <Lock size={14} /> Forzar Cierre
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* ====== ZONA 2: HISTORIAL DE CIERRES (AUDITORÍA) ====== */}
                <section>
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Clock size={20} className="text-slate-500" />
                        Historial de Cierres
                    </h2>

                    {closedShifts.length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                            <Clock className="text-slate-300 mx-auto mb-3" size={48} />
                            <p className="text-slate-500 font-medium">Sin cierres registrados</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="text-left px-4 py-3 font-bold text-slate-600 text-xs uppercase">Fecha</th>
                                            <th className="text-left px-4 py-3 font-bold text-slate-600 text-xs uppercase">Cajero</th>
                                            <th className="text-right px-4 py-3 font-bold text-slate-600 text-xs uppercase">Fondo</th>
                                            <th className="text-right px-4 py-3 font-bold text-slate-600 text-xs uppercase">Esperado</th>
                                            <th className="text-right px-4 py-3 font-bold text-slate-600 text-xs uppercase">Declarado</th>
                                            <th className="text-right px-4 py-3 font-bold text-slate-600 text-xs uppercase">Diferencia</th>
                                            <th className="text-center px-4 py-3 font-bold text-slate-600 text-xs uppercase">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {closedShifts.map(shift => (
                                            <tr
                                                key={shift.id}
                                                onClick={() => setSelectedShift(shift)}
                                                className="hover:bg-slate-50 cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-3">
                                                    <p className="font-medium text-slate-700">{formatDate(shift.endTime)}</p>
                                                    <p className="text-[10px] text-slate-400">{formatTime(shift.startTime)} - {formatTime(shift.endTime)}</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600">
                                                            {shift.employee ? shift.employee.firstName.charAt(0) : <User size={12} />}
                                                        </div>
                                                        <span className="text-slate-700 font-medium">
                                                            {shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-600">C${shift.initialCash.toFixed(2)}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">{shift.systemExpectedCash !== null ? `C$${shift.systemExpectedCash.toFixed(2)}` : '—'}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">{shift.finalCashDeclared !== null ? `C$${shift.finalCashDeclared.toFixed(2)}` : '—'}</td>
                                                <td className={`px-4 py-3 text-right font-bold ${shift.status === 'PERFECT' ? 'text-green-600' :
                                                    shift.status === 'WARNING' ? 'text-amber-600' : 'text-red-600'
                                                    }`}>
                                                    {shift.difference > 0 ? '+' : ''}C${shift.difference.toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {shift.status === 'PERFECT' && <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold"><CheckCircle size={10} /> OK</span>}
                                                    {shift.status === 'WARNING' && <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold"><AlertTriangle size={10} /> Rev</span>}
                                                    {shift.status === 'ALERT' && <span className="inline-flex items-center gap-1 text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold animate-pulse"><AlertTriangle size={10} /> ⚠️</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            {/* ====== DETAIL SLIDE-OUT ====== */}
            {selectedShift && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end" onClick={() => setSelectedShift(null)}>
                    <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
                        {/* Detail Header */}
                        <div className="bg-nortex-900 p-6 sticky top-0">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-white font-bold text-lg">Detalle de Cierre</h3>
                                <button onClick={() => setSelectedShift(null)} className="text-slate-400 hover:text-white p-1">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-nortex-accent/20 text-nortex-accent rounded-full flex items-center justify-center font-bold text-sm">
                                    {selectedShift.employee ? selectedShift.employee.firstName.charAt(0) + selectedShift.employee.lastName.charAt(0) : '??'}
                                </div>
                                <div>
                                    <p className="text-white font-bold">{selectedShift.employee ? `${selectedShift.employee.firstName} ${selectedShift.employee.lastName}` : selectedShift.user.name}</p>
                                    <p className="text-slate-400 text-xs">{formatDate(selectedShift.endTime)} · {formatTime(selectedShift.startTime)} - {formatTime(selectedShift.endTime)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Detail Body */}
                        <div className="p-6 space-y-6">
                            {/* Difference Card */}
                            <div className={`rounded-xl p-4 text-center ${selectedShift.status === 'PERFECT' ? 'bg-green-50 border border-green-200' :
                                selectedShift.status === 'WARNING' ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                                }`}>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Diferencia</p>
                                <p className={`text-3xl font-black ${selectedShift.status === 'PERFECT' ? 'text-green-600' :
                                    selectedShift.status === 'WARNING' ? 'text-amber-600' : 'text-red-600'
                                    }`}>
                                    {selectedShift.difference > 0 ? '+' : ''}C${selectedShift.difference.toFixed(2)}
                                </p>
                                {selectedShift.status === 'ALERT' && (
                                    <p className="text-xs text-red-500 mt-2 font-medium">⚠️ Excede umbral de C${theftThreshold.toFixed(2)}</p>
                                )}
                            </div>

                            {/* Breakdown */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase">Desglose</h4>
                                <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Fondo Inicial</span>
                                        <span className="font-bold text-slate-700">C${selectedShift.initialCash.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Ventas Efectivo</span>
                                        <span className="font-bold text-blue-600">+C${selectedShift.cashTotal.toFixed(2)}</span>
                                    </div>
                                    {selectedShift.cardTotal > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Ventas Tarjeta</span>
                                            <span className="font-bold text-slate-600">C${selectedShift.cardTotal.toFixed(2)}</span>
                                        </div>
                                    )}
                                    {selectedShift.creditTotal > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Ventas Crédito</span>
                                            <span className="font-bold text-slate-600">C${selectedShift.creditTotal.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
                                        <span className="font-bold text-slate-700">Sistema Esperaba</span>
                                        <span className="font-bold text-slate-900">{selectedShift.systemExpectedCash !== null ? `C$${selectedShift.systemExpectedCash.toFixed(2)}` : '—'}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-slate-700">Cajero Declaró</span>
                                        <span className="font-bold text-slate-900">{selectedShift.finalCashDeclared !== null ? `C$${selectedShift.finalCashDeclared.toFixed(2)}` : '—'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Ticket Promedio */}
                            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center">
                                        <TrendingUp size={20} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-500 uppercase">Ticket Promedio</p>
                                        <p className="text-sm font-medium text-slate-700">{selectedShift.salesCount > 0 ? `${selectedShift.salesCount} ventas procesadas` : 'Sin ventas'}</p>
                                    </div>
                                </div>
                                <span className="text-xl font-black text-slate-800">
                                    C${selectedShift.salesCount > 0 ? (selectedShift.grandTotal / selectedShift.salesCount).toFixed(2) : '0.00'}
                                </span>
                            </div>

                            {/* Recent Movements (Only showing up to 3) */}
                            {selectedShift.recentMovements && selectedShift.recentMovements.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                                        <ArrowDownCircle size={14} /> Movimientos Manuales (Últimos 3)
                                    </h4>
                                    <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-100">
                                        {selectedShift.recentMovements.slice(0, 3).map((mov, idx) => (
                                            <div key={idx} className="p-3 border-b border-slate-100 last:border-0 flex justify-between items-center bg-white">
                                                <div>
                                                    <p className="text-sm font-bold text-slate-700">{mov.category}</p>
                                                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{mov.description}</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(mov.createdAt)}</p>
                                                </div>
                                                <span className={`font-bold ${mov.type === 'IN' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                    {mov.type === 'IN' ? '+' : '-'}C${mov.amount.toFixed(2)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-blue-50 rounded-xl p-3 text-center">
                                    <p className="text-xs text-blue-500 font-bold">VENTAS</p>
                                    <p className="text-2xl font-black text-blue-700">{selectedShift.salesCount}</p>
                                </div>
                                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                                    <p className="text-xs text-emerald-500 font-bold">TOTAL BRUTO</p>
                                    <p className="text-lg font-black text-emerald-700">C${selectedShift.grandTotal.toFixed(2)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== MODAL: FORZAR CIERRE DE CAJA (Calculadora de Denominaciones) ====== */}
            {shiftToClose && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
                                    <Lock size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Forzar Cierre de Caja</h3>
                                    <p className="text-xs text-slate-500 flex items-center gap-1">
                                        <User size={12} /> Cajero: {shiftToClose.employee ? `${shiftToClose.employee.firstName} ${shiftToClose.employee.lastName}` : shiftToClose.user.name}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShiftToClose(null)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full hover:bg-slate-200 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Zona Izquierda: Calculadora */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Calculator className="text-blue-500" size={18} />
                                        <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Calculadora de Efectivo</h4>
                                    </div>
                                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm grid grid-cols-2 gap-x-4 gap-y-3">
                                        {[1000, 500, 200, 100, 50, 20, 10, 5, 1].map(den => (
                                            <div key={den} className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500 w-12 text-right">C$ {den}</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={denominations[den as keyof typeof denominations] || ''}
                                                    onChange={(e) => handleDenominationChange(den, e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all text-center"
                                                    placeholder="0"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Zona Derecha: Resumen y Notas */}
                                <div className="space-y-6 flex flex-col justify-between">
                                    {/* Total Box */}
                                    <div className="bg-nortex-900 rounded-2xl p-6 text-center shadow-lg relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                                        <p className="text-nortex-accent text-xs font-bold uppercase tracking-widest mb-2 relative z-10">Total Declarado</p>
                                        <p className="text-4xl font-black text-white tracking-tight relative z-10">
                                            C${calculateTotalDeclared().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>

                                    {/* Expectativa del Sistema (Opcional, puede ocultarse si el cajero no debe verlo, pero al ser Admin, es útil) */}
                                    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex justify-between items-center shadow-sm">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Aprox. Sistema</span>
                                        <span className="font-bold text-slate-800">C${shiftToClose.estimatedPhysicalCash.toFixed(2)}</span>
                                    </div>

                                    {/* Notas de Auditoría */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Notas de Auditoría (Opcional)</label>
                                        <textarea
                                            rows={3}
                                            value={auditNotes}
                                            onChange={(e) => setAuditNotes(e.target.value)}
                                            placeholder="Justificación del cierre forzado, discrepancias, etc."
                                            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-3">
                            <button
                                onClick={() => setShiftToClose(null)}
                                className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleForceClose}
                                disabled={closing}
                                className="px-6 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 min-w-[160px] disabled:opacity-75"
                            >
                                {closing ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                                {closing ? 'Cerrando...' : 'Confirmar Cierre'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CashRegisters;
