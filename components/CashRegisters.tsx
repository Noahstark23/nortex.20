import React, { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, Clock, ShoppingCart, ArrowDownCircle, ArrowUpCircle, DollarSign, AlertTriangle, CheckCircle, X, Printer, User, TrendingUp, Banknote, Lock, Calculator, Loader2, Landmark, Undo2, FileText } from 'lucide-react';
import { formatMoney, formatUSD } from '../utils/money';
import { openAuthenticatedPreview } from '../utils/authenticatedDownload';
import { ToastViewport, useToast } from './ui/Toast';

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
    // Fase B: operaciones de agente bancario (corresponsalía) separadas
    vaultAgentINs: number;
    vaultAgentOUTs: number;
    estimatedPhysicalCash: number;
    // Fase D: gaveta USD (dólares físicos del agente)
    estimatedPhysicalUsd?: number;
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
    // Movimientos manuales de caja recientes (mostramos los últimos 3 en el detalle)
    recentMovements?: {
        category: string;
        description: string;
        createdAt: string;
        type: 'IN' | 'OUT';
        amount: number;
    }[];
}

interface CloseReportReference {
    id: string;
    shiftId: string;
    folio: string;
    documentUrl: string;
    generatedAt?: string;
}

const reportReferenceForShift = (shiftId: string, raw?: unknown): CloseReportReference => {
    const report = raw && typeof raw === 'object'
        ? raw as Partial<CloseReportReference>
        : {};
    const canonicalUrl = `/api/reports/shifts/${encodeURIComponent(shiftId)}/document`;
    const safeDocumentUrl = typeof report.documentUrl === 'string'
        && report.documentUrl.startsWith('/api/reports/shifts/')
        && !report.documentUrl.includes('://')
        ? report.documentUrl
        : canonicalUrl;

    return {
        id: typeof report.id === 'string' && report.id ? report.id : shiftId,
        shiftId: typeof report.shiftId === 'string' && report.shiftId ? report.shiftId : shiftId,
        folio: typeof report.folio === 'string' && report.folio
            ? report.folio
            : `Z-${shiftId.slice(-8).toUpperCase()}`,
        documentUrl: safeDocumentUrl,
        ...(typeof report.generatedAt === 'string' ? { generatedAt: report.generatedAt } : {}),
    };
};

const CashRegisters: React.FC = () => {
    const [activeShifts, setActiveShifts] = useState<LiveShift[]>([]);
    const [closedShifts, setClosedShifts] = useState<ClosedShift[]>([]);
    const [theftThreshold, setTheftThreshold] = useState(500);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [selectedShift, setSelectedShift] = useState<ClosedShift | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastCloseReport, setLastCloseReport] = useState<CloseReportReference | null>(null);
    const [openingReportId, setOpeningReportId] = useState<string | null>(null);
    const { toast, showToast, dismissToast } = useToast();

    // Force Close Modal State
    const [shiftToClose, setShiftToClose] = useState<LiveShift | null>(null);
    const [closing, setClosing] = useState(false);
    const [forceCloseError, setForceCloseError] = useState<string | null>(null);
    const [auditNotes, setAuditNotes] = useState('');
    const [declaredUsdForce, setDeclaredUsdForce] = useState('');
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

    const token = localStorage.getItem('nortex_token');
    const headers = { 'Authorization': `Bearer ${token}` };

    const handleOpenReport = async (report: CloseReportReference) => {
        setOpeningReportId(report.id);
        try {
            await openAuthenticatedPreview(report.documentUrl, { token });
        } catch (reportError) {
            showToast({
                tone: 'error',
                title: 'No se pudo abrir el reporte Z',
                message: reportError instanceof Error
                    ? reportError.message
                    : 'Intentá nuevamente en unos segundos.',
            });
        } finally {
            setOpeningReportId(null);
        }
    };

    const handleForceClose = async () => {
        if (!shiftToClose) return;
        setClosing(true);
        setForceCloseError(null);
        const finalCashDeclared = calculateTotalDeclared();

        try {
            const res = await fetch('/api/shifts/close', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify({
                    shiftId: shiftToClose.id,
                    declaredCash: finalCashDeclared,
                    ...(declaredUsdForce.trim() !== '' ? { declaredCashUsd: parseFloat(declaredUsdForce) } : {}),
                    auditNotes
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Error al cerrar la caja');
            }

            const closeReport = reportReferenceForShift(shiftToClose.id, data.closeReport);
            setLastCloseReport(closeReport);
            setShiftToClose(null);
            setDenominations({ 1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
            setAuditNotes('');
            setDeclaredUsdForce('');
            showToast({
                tone: 'success',
                title: 'Caja cerrada y reporte Z listo',
                message: `Folio ${closeReport.folio}. Podés abrirlo ahora o desde el historial.`,
                durationMs: 10_000,
                action: {
                    label: 'Ver / imprimir reporte Z',
                    onClick: () => { void handleOpenReport(closeReport); },
                },
            });
            void fetchMonitor();
        } catch (closeError) {
            const message = closeError instanceof Error
                ? closeError.message
                : 'Error de conexión al cerrar la caja';
            setForceCloseError(message);
            showToast({
                tone: 'error',
                title: 'No se pudo cerrar la caja',
                message,
            });
        } finally {
            setClosing(false);
        }
    };

    // ── 🏦 Agente Bancario — conciliación (Fase B) ──
    const [agentAgreements, setAgentAgreements] = useState<any[]>([]);
    const [agentTxs, setAgentTxs] = useState<any[]>([]);
    const [agentBusy, setAgentBusy] = useState(false);
    // Fase C: umbrales de gaveta + reporte agregado
    const [agentThresholds, setAgentThresholds] = useState<{ min: string; max: string }>({ min: '', max: '' });
    const [agentReport, setAgentReport] = useState<any | null>(null);

    const fetchAgentData = useCallback(async () => {
        try {
            const [ra, rt, rs, rr] = await Promise.all([
                fetch('/api/agent-banking/agreements', { headers }),
                fetch('/api/agent-banking/transactions?take=15', { headers }),
                fetch('/api/agent-banking/settings', { headers }),
                fetch('/api/agent-banking/report?days=30', { headers }),
            ]);
            if (ra.ok) {
                const da = await ra.json();
                if (da.success) setAgentAgreements(da.data);
            }
            if (rt.ok) {
                const dt = await rt.json();
                if (dt.success) setAgentTxs(dt.data);
            }
            if (rs.ok) {
                const ds = await rs.json();
                if (ds.success) setAgentThresholds({
                    min: ds.data.agentCashMin != null ? String(ds.data.agentCashMin) : '',
                    max: ds.data.agentCashMax != null ? String(ds.data.agentCashMax) : '',
                });
            }
            if (rr.ok) {
                const dr = await rr.json();
                if (dr.success) setAgentReport(dr.data);
            }
        } catch (e) { /* sección opcional: si falla, simplemente no se muestra */ }
    }, [token]);

    // Guardar umbrales de alerta de gaveta ('' limpia el umbral).
    const handleSaveThresholds = async () => {
        setAgentBusy(true);
        try {
            const res = await fetch('/api/agent-banking/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                    agentCashMin: agentThresholds.min.trim() === '' ? null : parseFloat(agentThresholds.min),
                    agentCashMax: agentThresholds.max.trim() === '' ? null : parseFloat(agentThresholds.max),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error guardando umbrales');
            fetchMonitor();
        } catch (e: any) { alert(e.message); } finally { setAgentBusy(false); }
    };

    // Liquidar comisiones devengadas del convenio (el banco paga a la cuenta).
    const handleSettleCommissions = async (agreement: any) => {
        const accrued = Number(agreement.commissionAccrued);
        if (!(accrued > 0)) { alert('No hay comisiones por liquidar en este convenio.'); return; }
        if (!confirm(`¿Registrar que ${agreement.name} liquidó ${formatMoney(accrued)} de comisiones a tu cuenta bancaria?`)) return;
        setAgentBusy(true);
        try {
            const res = await fetch(`/api/agent-banking/agreements/${agreement.id}/settle-commissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error liquidando comisiones');
            fetchAgentData();
        } catch (e: any) { alert(e.message); } finally { setAgentBusy(false); }
    };

    // Traslado de efectivo con el banco (entrega de lo captado / fondeo de gaveta).
    const handleCashSettlement = async (agreement: any, operation: 'LIQUIDACION_ENTREGA' | 'LIQUIDACION_FONDEO') => {
        const label = operation === 'LIQUIDACION_ENTREGA'
            ? '¿Cuánto efectivo ENTREGÁS al banco? (sale de tu gaveta abierta)'
            : '¿Cuánto efectivo traés del banco para FONDEAR la gaveta? (entra a tu gaveta abierta)';
        const raw = prompt(label);
        if (raw === null) return;
        const monto = parseFloat(raw);
        if (!isFinite(monto) || monto <= 0) { alert('Monto inválido.'); return; }
        setAgentBusy(true);
        try {
            const res = await fetch('/api/agent-banking/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ agreementId: agreement.id, operation, amount: monto, currency: 'NIO' }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error registrando el traslado');
            fetchAgentData();
            fetchMonitor();
        } catch (e: any) { alert(e.message); } finally { setAgentBusy(false); }
    };

    // Configurar límites del contrato por operación (Fase C).
    const handleConfigureLimits = async (agreement: any) => {
        const OPS = ['DEPOSITO', 'RETIRO', 'PAGO_TARJETA', 'PAGO_PRESTAMO', 'PAGO_SERVICIO', 'RECARGA', 'REMESA_ENVIO', 'REMESA_COBRO'];
        const op = prompt(`¿Qué operación querés limitar en ${agreement.name}?\n(${OPS.join(', ')})`)?.trim().toUpperCase();
        if (!op) return;
        if (!OPS.includes(op)) { alert('Operación desconocida.'); return; }
        const actual = agreement.limitsConfig?.[op];
        const rawTx = prompt(`Límite POR TRANSACCIÓN para ${op} (C$). Vacío = sin límite.`, actual?.maxTx != null ? String(actual.maxTx) : '');
        if (rawTx === null) return;
        const rawDia = prompt(`Límite POR DÍA para ${op} (C$). Vacío = sin límite.`, actual?.maxDia != null ? String(actual.maxDia) : '');
        if (rawDia === null) return;
        const maxTx = rawTx.trim() === '' ? undefined : parseFloat(rawTx);
        const maxDia = rawDia.trim() === '' ? undefined : parseFloat(rawDia);
        if ((maxTx !== undefined && !(maxTx > 0)) || (maxDia !== undefined && !(maxDia > 0))) { alert('Los límites deben ser mayores que cero.'); return; }
        const limitsConfig = { ...(agreement.limitsConfig || {}) };
        if (maxTx === undefined && maxDia === undefined) {
            delete limitsConfig[op];
        } else {
            limitsConfig[op] = { ...(maxTx !== undefined ? { maxTx } : {}), ...(maxDia !== undefined ? { maxDia } : {}) };
        }
        setAgentBusy(true);
        try {
            const res = await fetch(`/api/agent-banking/agreements/${agreement.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ limitsConfig }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error guardando límites');
            fetchAgentData();
        } catch (e: any) { alert(e.message); } finally { setAgentBusy(false); }
    };

    // Reversar una operación (falló/se anuló en el dispositivo del banco).
    const handleReverseTx = async (txItem: any) => {
        const reason = prompt(`Motivo de la reversa de ${txItem.operation} ${formatMoney(Number(txItem.amount))} (${txItem.agreement?.name || ''}):`);
        if (reason === null) return;
        if (reason.trim().length < 3) { alert('Indicá un motivo (mínimo 3 caracteres).'); return; }
        setAgentBusy(true);
        try {
            const res = await fetch(`/api/agent-banking/transactions/${txItem.id}/reverse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ reason: reason.trim() }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error reversando la operación');
            fetchAgentData();
            fetchMonitor();
        } catch (e: any) { alert(e.message); } finally { setAgentBusy(false); }
    };

    const fetchMonitor = useCallback(async () => {
        try {
            const res = await fetch('/api/shifts/monitor', { headers });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Error cargando monitor');
            }
            const data = await res.json();
            // Lectura defensiva del contrato (NX-03): el backend está unificando
            // la fórmula del efectivo esperado con la del POS y puede sumar
            // campos. Si una lista viniera ausente o renombrada, la pantalla se
            // caía entera con "…is not iterable" en pleno arqueo. Los córdobas y
            // los dólares se siguen leyendo y mostrando POR SEPARADO
            // (estimatedPhysicalCash vs estimatedPhysicalUsd): nunca se suman,
            // son monedas distintas.
            setActiveShifts(Array.isArray(data.activeShifts) ? data.activeShifts : []);
            setClosedShifts(Array.isArray(data.closedShifts) ? data.closedShifts : []);
            const umbral = Number(data.theftThreshold);
            if (Number.isFinite(umbral)) setTheftThreshold(umbral);
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
        fetchAgentData();
        const interval = setInterval(() => { fetchMonitor(); fetchAgentData(); }, 15000);
        return () => clearInterval(interval);
    }, [fetchMonitor, fetchAgentData]);

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
            <div className="nx-light-context nx-workspace flex h-full items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 text-slate-600">
                    <RefreshCw className="animate-spin" size={24} />
                    <span className="text-lg font-medium">Cargando monitor de cajas...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="nx-light-context nx-workspace flex h-full items-center justify-center bg-slate-50 p-4">
                <div className="max-w-md rounded-card border border-red-200 bg-red-50 p-6 text-center shadow-sm">
                    <AlertTriangle className="mx-auto mb-3 text-red-600" size={32} />
                    <h3 className="mb-1 font-bold text-red-800">Error de Acceso</h3>
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="nx-light-context nx-workspace h-full overflow-y-auto bg-slate-50 text-slate-950">
            {/* HEADER */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur-xl sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-control border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm">
                            <Monitor size={22} />
                        </div>
                        <div>
                            <h1 className="nx-module-header text-2xl font-semibold text-slate-950">Cajas y Arqueos</h1>
                            <p className="text-xs text-slate-500">Última actualización: {formatTime(lastRefresh.toISOString())} · Auto-refresh 15s</p>
                        </div>
                    </div>
                    <button
                        onClick={fetchMonitor}
                        className="nx-fluid-press flex min-h-tap items-center justify-center gap-2 self-stretch rounded-control border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100 sm:self-auto"
                    >
                        <RefreshCw size={16} /> Actualizar
                    </button>
                </div>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-8 p-4 sm:p-6 lg:p-8">

                {lastCloseReport && (
                    <section
                        aria-label="Último reporte Z generado"
                        className="flex flex-col gap-4 rounded-card border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-emerald-100 text-emerald-700">
                                <CheckCircle size={21} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <p className="font-bold text-emerald-900">Último cierre completado</p>
                                <p className="text-sm text-emerald-800">
                                    Reporte Z <span className="font-mono font-semibold">{lastCloseReport.folio}</span> listo para revisión o impresión.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => { void handleOpenReport(lastCloseReport); }}
                            disabled={openingReportId === lastCloseReport.id}
                            className="nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 rounded-control bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
                        >
                            {openingReportId === lastCloseReport.id
                                ? <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                                : <Printer size={17} aria-hidden="true" />}
                            Ver / imprimir reporte Z
                        </button>
                    </section>
                )}

                {/* ====== ZONA 1: CAJAS ACTIVAS (LIVE MONITOR) ====== */}
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                        <h2 className="text-lg font-semibold text-slate-950">Cajas Activas</h2>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{activeShifts.length}</span>
                    </div>

                    {activeShifts.length === 0 ? (
                        <div className="nx-canvas-card p-8 text-center">
                            <Monitor className="mx-auto mb-3 text-slate-300" size={48} />
                            <p className="font-medium text-slate-700">Todas las cajas están cerradas</p>
                            <p className="mt-1 text-xs text-slate-500">Los turnos activos aparecerán aquí en tiempo real</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                            {activeShifts.map(shift => (
                                <div key={shift.id} className="nx-canvas-card overflow-hidden transition-shadow hover:shadow-md">
                                    {/* Card Header */}
                                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">
                                                {shift.employee ? shift.employee.firstName.charAt(0) + shift.employee.lastName.charAt(0) : '??'}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-950">
                                                    {shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}
                                                </p>
                                                <p className="flex items-center gap-1 text-[10px] text-slate-500">
                                                    <Clock size={10} /> Abierta: {formatTime(shift.startTime)} ({timeAgo(shift.startTime)})
                                                </p>
                                            </div>
                                        </div>
                                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                                    </div>

                                    {/* Vaults */}
                                    <div className="p-4 space-y-3">
                                        {/* Vault: Cash Sales */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ShoppingCart size={14} className="text-slate-500" />
                                                <span>Ventas Efectivo</span>
                                            </div>
                                            <span className="font-bold tabular-nums text-slate-950">{formatMoney(shift.vaultCashSales)}</span>
                                        </div>

                                        {/* Vault: Manual INs */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ArrowDownCircle size={14} className="text-emerald-500" />
                                                <span>Entradas Manuales</span>
                                            </div>
                                            <span className="font-bold tabular-nums text-emerald-700">+{formatMoney(shift.vaultManualINs)}</span>
                                        </div>

                                        {/* Vault: Manual OUTs */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <ArrowUpCircle size={14} className="text-amber-500" />
                                                <span>Salidas</span>
                                            </div>
                                            <span className="font-bold tabular-nums text-amber-700">-{formatMoney(shift.vaultManualOUTs)}</span>
                                        </div>

                                        {/* Vault: Agente Bancario (Fase B) — plata del banco, separada */}
                                        {((shift.vaultAgentINs ?? 0) > 0 || (shift.vaultAgentOUTs ?? 0) > 0) && (
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                                    <Landmark size={14} className="text-slate-500" />
                                                    <span>Agente Bancario</span>
                                                </div>
                                                <span className="font-bold tabular-nums text-slate-800">
                                                    +{formatMoney((shift.vaultAgentINs ?? 0))} / -{formatMoney((shift.vaultAgentOUTs ?? 0))}
                                                </span>
                                            </div>
                                        )}

                                        {/* Divider */}
                                        <div className="border-t border-dashed border-slate-200 pt-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                                    <Banknote size={16} className="text-emerald-700" />
                                                    Efectivo en Gaveta
                                                </div>
                                                <span className="font-mono text-xl font-black tabular-nums text-slate-950">{formatMoney(shift.estimatedPhysicalCash)}</span>
                                            </div>
                                            <p className="mt-1 text-[10px] text-slate-500">Fondo: {formatMoney(shift.initialCash)} · {shift.salesCount} ventas · {shift.movementsCount} movimientos</p>
                                            {/* Alertas de gaveta del agente (Fase C) */}
                                            {agentThresholds.min !== '' && shift.estimatedPhysicalCash < parseFloat(agentThresholds.min) && (
                                                <p className="mt-2 flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
                                                    <AlertTriangle size={12} /> Gaveta baja: podrías no poder pagar retiros. Considerá fondear.
                                                </p>
                                            )}
                                            {agentThresholds.max !== '' && shift.estimatedPhysicalCash > parseFloat(agentThresholds.max) && (
                                                <p className="mt-2 flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-800">
                                                    <AlertTriangle size={12} /> Exceso de efectivo (riesgo de robo). Considerá entregar al banco.
                                                </p>
                                            )}
                                            {/* Gaveta USD (Fase D) */}
                                            {(shift.estimatedPhysicalUsd ?? 0) !== 0 && (
                                                <div className="mt-2 flex items-center justify-between text-sm">
                                                    <span className="text-slate-500 flex items-center gap-1"><DollarSign size={13} className="text-emerald-500" /> Dólares en gaveta</span>
                                                    <span className="font-mono font-bold text-emerald-700">{formatUSD((shift.estimatedPhysicalUsd ?? 0))}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Card Footer */}
                                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="text-[10px] text-slate-500">
                                            <span className="flex items-center gap-1 mb-1">
                                                {shift.vaultCardSales > 0 && <span>{formatMoney(shift.vaultCardSales, 'NIO', { decimals: 0 })}</span>}
                                                {shift.vaultCreditSales > 0 && <span> · {formatMoney(shift.vaultCreditSales, 'NIO', { decimals: 0 })} crédito</span>}
                                            </span>
                                            <span>{shift.lastSaleAt ? `Última venta: ${timeAgo(shift.lastSaleAt)}` : 'Sin ventas'}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setForceCloseError(null);
                                                setShiftToClose(shift);
                                            }}
                                            className="nx-fluid-press flex min-h-tap items-center gap-1.5 rounded-control border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100"
                                        >
                                            <Lock size={14} /> Forzar Cierre
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* ====== ZONA 1.5: AGENTE BANCARIO — CONCILIACIÓN (Fase B) ====== */}
                {agentAgreements.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Landmark size={18} className="text-emerald-700" />
                            <h2 className="text-lg font-semibold text-slate-950">Agente Bancario — Conciliación</h2>
                        </div>

                        {/* Umbrales de alerta de gaveta (Fase C) */}
                        <div className="nx-canvas-card mb-4 flex flex-wrap items-end gap-3 p-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Alerta gaveta mínima (C$)</label>
                                <input
                                    type="number" min="0" step="0.01"
                                    value={agentThresholds.min}
                                    onChange={e => setAgentThresholds(prev => ({ ...prev, min: e.target.value }))}
                                    placeholder="Sin alerta"
                                    className="w-36 rounded-control border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-950 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Alerta gaveta máxima (C$)</label>
                                <input
                                    type="number" min="0" step="0.01"
                                    value={agentThresholds.max}
                                    onChange={e => setAgentThresholds(prev => ({ ...prev, max: e.target.value }))}
                                    placeholder="Sin alerta"
                                    className="w-36 rounded-control border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-950 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>
                            <button
                                onClick={handleSaveThresholds}
                                disabled={agentBusy}
                                className="nx-fluid-press min-h-tap rounded-control bg-brand px-4 py-2.5 text-xs font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-50"
                            >
                                Guardar umbrales
                            </button>
                            <p className="basis-full text-[10px] text-slate-500">Bajo el mínimo: aviso de que no vas a poder pagar retiros. Sobre el máximo: aviso de exceso de efectivo (entregá al banco). Vacío = sin alerta.</p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
                            {agentAgreements.map((a: any) => {
                                const saldo = Number(a.settlementBalance);
                                const comisiones = Number(a.commissionAccrued);
                                return (
                                    <div key={a.id} className="nx-canvas-card p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <p className="font-bold text-slate-950">{a.name}</p>
                                                <p className="text-[10px] text-slate-500">{a.kind === 'BANCO' ? 'Banco' : a.kind === 'RED_RECAUDADORA' ? 'Red de pagos' : 'Remesera'}{!a.active && ' · INACTIVO'}</p>
                                            </div>
                                            <Landmark size={20} className="text-emerald-700" />
                                        </div>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">{saldo >= 0 ? 'Le debés al banco:' : 'El banco te debe:'}</span>
                                                <span className={`font-mono font-bold ${saldo >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatMoney(Math.abs(saldo))}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Comisiones por cobrar:</span>
                                                <span className="font-mono font-bold text-slate-800">{formatMoney(comisiones)}</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-4">
                                            <button
                                                onClick={() => handleCashSettlement(a, 'LIQUIDACION_ENTREGA')}
                                                disabled={agentBusy}
                                                className="nx-fluid-press min-h-tap rounded-control border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                                                title="Llevar el efectivo captado al banco (sale de tu gaveta)"
                                            >
                                                Entregar al banco
                                            </button>
                                            <button
                                                onClick={() => handleCashSettlement(a, 'LIQUIDACION_FONDEO')}
                                                disabled={agentBusy}
                                                className="nx-fluid-press min-h-tap rounded-control border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                                title="Traer efectivo del banco para pagar retiros (entra a tu gaveta)"
                                            >
                                                Fondear gaveta
                                            </button>
                                            <button
                                                onClick={() => handleSettleCommissions(a)}
                                                disabled={agentBusy || !(comisiones > 0)}
                                                className="nx-fluid-press min-h-tap rounded-control border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                                title="El banco pagó las comisiones a tu cuenta bancaria"
                                            >
                                                Liquidar comisiones
                                            </button>
                                            <button
                                                onClick={() => handleConfigureLimits(a)}
                                                disabled={agentBusy}
                                                className="nx-fluid-press min-h-tap rounded-control border border-slate-300 bg-white px-2 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                                title="Límites del contrato por operación (por transacción y por día)"
                                            >
                                                Límites
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Reporte de conciliación 30 días (Fase C, agregado en SQL) */}
                        {agentReport && agentReport.breakdown?.length > 0 && (
                            <div className="nx-canvas-card mb-4 overflow-hidden">
                                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                                    <h3 className="text-sm font-bold text-slate-800">Resumen últimos {agentReport.days} días</h3>
                                    <span className="text-[10px] text-slate-500">para conciliar contra el reporte del banco/red</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-600">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-medium">Convenio</th>
                                                <th className="px-4 py-2 text-left font-medium">Operación</th>
                                                <th className="px-4 py-2 text-right font-medium"># Ops</th>
                                                <th className="px-4 py-2 text-right font-medium">Volumen</th>
                                                <th className="px-4 py-2 text-right font-medium">Comisiones</th>
                                                <th className="px-4 py-2 text-center font-medium">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {agentReport.breakdown.map((b: any, i: number) => {
                                                const agr = agentReport.agreements.find((a: any) => a.id === b.agreementId);
                                                return (
                                                    <tr key={i} className="border-t border-slate-200">
                                                        <td className="px-4 py-2 text-slate-800">{agr?.name || '—'}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-600">{b.operation.replace(/_/g, ' ')}</td>
                                                        <td className="px-4 py-2 text-right font-mono text-slate-800">{b.count}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-bold text-slate-950">{formatMoney(b.totalAmount)}</td>
                                                        <td className="px-4 py-2 text-right font-mono text-slate-700">{formatMoney(b.totalCommission)}</td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${b.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                                                {b.status === 'COMPLETED' ? 'OK' : 'REVERSADAS'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Últimas operaciones con botón de reversa */}
                        {agentTxs.length > 0 && (
                            <div className="nx-canvas-card overflow-hidden">
                                <div className="border-b border-slate-200 px-4 py-3">
                                    <h3 className="text-sm font-bold text-slate-800">Últimas operaciones de agente</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-600">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-medium">Fecha</th>
                                                <th className="px-4 py-2 text-left font-medium">Convenio</th>
                                                <th className="px-4 py-2 text-left font-medium">Operación</th>
                                                <th className="px-4 py-2 text-right font-medium">Monto</th>
                                                <th className="px-4 py-2 text-right font-medium">Comisión</th>
                                                <th className="px-4 py-2 text-left font-medium">Ref.</th>
                                                <th className="px-4 py-2 text-center font-medium">Estado</th>
                                                <th className="px-4 py-2"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {agentTxs.map((t: any) => (
                                                <tr key={t.id} className="border-t border-slate-200">
                                                    <td className="px-4 py-2 text-slate-500 text-xs">{new Date(t.createdAt).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="px-4 py-2 text-slate-800">{t.agreement?.name}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`text-xs font-bold ${t.direction === 'IN' ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                            {t.operation.replace(/_/g, ' ')}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono font-bold text-slate-950">
                                                        {t.direction === 'IN' ? '+' : '-'}{formatMoney(Number(t.amount))}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-slate-700">{formatMoney(Number(t.commission))}</td>
                                                    <td className="px-4 py-2 text-xs text-slate-500">{t.externalRef || '—'}</td>
                                                    <td className="px-4 py-2 text-center">
                                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                                            {t.status === 'COMPLETED' ? 'OK' : 'REVERSADA'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        {t.status === 'COMPLETED' && (
                                                            <button
                                                                onClick={() => handleReverseTx(t)}
                                                                disabled={agentBusy}
                                                                className="nx-fluid-press flex min-h-tap items-center gap-1 rounded-control border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                                                                title="Reversar (la transacción falló o se anuló en el equipo del banco)"
                                                            >
                                                                <Undo2 size={12} /> Reversar
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {/* ====== ZONA 2: HISTORIAL DE CIERRES (AUDITORÍA) ====== */}
                <section>
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-950">
                        <Clock size={20} className="text-slate-500" />
                        Historial de Cierres
                    </h2>

                    {closedShifts.length === 0 ? (
                        <div className="nx-canvas-card p-8 text-center">
                            <Clock className="mx-auto mb-3 text-slate-300" size={48} />
                            <p className="font-medium text-slate-700">Sin cierres registrados</p>
                        </div>
                    ) : (
                        <div className="nx-canvas-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50">
                                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">Fecha</th>
                                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">Cajero</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-slate-600">Fondo</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-slate-600">Esperado</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-slate-600">Declarado</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-slate-600">Diferencia</th>
                                            <th className="px-4 py-3 text-center text-xs font-bold uppercase text-slate-600">Estado</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-slate-600">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {closedShifts.map(shift => (
                                            <tr
                                                key={shift.id}
                                                className="transition-colors hover:bg-slate-50"
                                            >
                                                <td className="px-4 py-3">
                                                    <p className="font-medium text-slate-800">{formatDate(shift.endTime)}</p>
                                                    <p className="text-[10px] text-slate-500">{formatTime(shift.startTime)} - {formatTime(shift.endTime)}</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-700">
                                                            {shift.employee ? shift.employee.firstName.charAt(0) : <User size={12} />}
                                                        </div>
                                                        <span className="font-medium text-slate-800">
                                                            {shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatMoney(shift.initialCash)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{shift.systemExpectedCash !== null ? `${formatMoney(shift.systemExpectedCash)}` : '—'}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{shift.finalCashDeclared !== null ? `${formatMoney(shift.finalCashDeclared)}` : '—'}</td>
                                                <td className={`px-4 py-3 text-right font-bold tabular-nums ${shift.status === 'PERFECT' ? 'text-emerald-700' :
                                                    shift.status === 'WARNING' ? 'text-amber-700' : 'text-red-700'
                                                    }`}>
                                                    {shift.difference > 0 ? '+' : ''}{formatMoney(shift.difference)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {shift.status === 'PERFECT' && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800"><CheckCircle size={10} /> OK</span>}
                                                    {shift.status === 'WARNING' && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"><AlertTriangle size={10} /> Rev</span>}
                                                    {shift.status === 'ALERT' && <span className="inline-flex animate-pulse items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800"><AlertTriangle size={10} /> </span>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedShift(shift)}
                                                            className="nx-fluid-press inline-flex min-h-tap items-center gap-1.5 rounded-control border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100"
                                                            aria-label={`Ver detalle del cierre de ${shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}`}
                                                        >
                                                            <FileText size={14} aria-hidden="true" /> Detalle
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => { void handleOpenReport(reportReferenceForShift(shift.id)); }}
                                                            disabled={openingReportId === shift.id}
                                                            className="nx-fluid-press inline-flex min-h-tap items-center gap-1.5 rounded-control border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                                                            aria-label={`Ver o imprimir reporte Z del cierre de ${shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : shift.user.name}`}
                                                        >
                                                            {openingReportId === shift.id
                                                                ? <Loader2 className="animate-spin" size={14} aria-hidden="true" />
                                                                : <Printer size={14} aria-hidden="true" />}
                                                            Reporte Z
                                                        </button>
                                                    </div>
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
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cash-register-detail-title"
                        className="nx-light-context nx-workspace h-full w-full max-w-md overflow-y-auto bg-slate-50 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Detail Header */}
                        <div className="sticky top-0 border-b border-slate-200 bg-white/95 p-6 backdrop-blur-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 id="cash-register-detail-title" className="text-lg font-bold text-slate-950">Detalle de Cierre</h3>
                                <button type="button" onClick={() => setSelectedShift(null)} className="nx-fluid-press inline-flex min-h-tap min-w-tap items-center justify-center rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950" aria-label="Cerrar detalle del cierre">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">
                                    {selectedShift.employee ? selectedShift.employee.firstName.charAt(0) + selectedShift.employee.lastName.charAt(0) : '??'}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-950">{selectedShift.employee ? `${selectedShift.employee.firstName} ${selectedShift.employee.lastName}` : selectedShift.user.name}</p>
                                    <p className="text-xs text-slate-500">{formatDate(selectedShift.endTime)} · {formatTime(selectedShift.startTime)} - {formatTime(selectedShift.endTime)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Detail Body */}
                        <div className="p-6 space-y-6">
                            <button
                                type="button"
                                onClick={() => { void handleOpenReport(reportReferenceForShift(selectedShift.id)); }}
                                disabled={openingReportId === selectedShift.id}
                                className="nx-fluid-press inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-control bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
                            >
                                {openingReportId === selectedShift.id
                                    ? <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                                    : <Printer size={18} aria-hidden="true" />}
                                Ver / imprimir reporte Z completo
                            </button>

                            {/* Difference Card */}
                            <div className={`rounded-card border p-4 text-center ${selectedShift.status === 'PERFECT' ? 'border-emerald-200 bg-emerald-50' :
                                selectedShift.status === 'WARNING' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
                                }`}>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Diferencia</p>
                                <p className={`text-3xl font-black ${selectedShift.status === 'PERFECT' ? 'text-emerald-700' :
                                    selectedShift.status === 'WARNING' ? 'text-amber-700' : 'text-red-700'
                                    }`}>
                                    {selectedShift.difference > 0 ? '+' : ''}{formatMoney(selectedShift.difference)}
                                </p>
                                {selectedShift.status === 'ALERT' && (
                                    <p className="text-xs text-red-500 mt-2 font-medium">Excede umbral de {formatMoney(theftThreshold)}</p>
                                )}
                            </div>

                            {/* Breakdown */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase">Desglose</h4>
                                <div className="space-y-2.5 rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Fondo Inicial</span>
                                        <span className="font-bold tabular-nums text-slate-800">{formatMoney(selectedShift.initialCash)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Ventas Efectivo</span>
                                        <span className="font-bold tabular-nums text-emerald-700">+{formatMoney(selectedShift.cashTotal)}</span>
                                    </div>
                                    {selectedShift.cardTotal > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Ventas Tarjeta</span>
                                            <span className="font-bold tabular-nums text-slate-700">{formatMoney(selectedShift.cardTotal)}</span>
                                        </div>
                                    )}
                                    {selectedShift.creditTotal > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Ventas Crédito</span>
                                            <span className="font-bold tabular-nums text-slate-700">{formatMoney(selectedShift.creditTotal)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                                        <span className="font-bold text-slate-800">Sistema Esperaba</span>
                                        <span className="font-bold tabular-nums text-slate-950">{selectedShift.systemExpectedCash !== null ? `${formatMoney(selectedShift.systemExpectedCash)}` : '—'}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-slate-800">Cajero Declaró</span>
                                        <span className="font-bold tabular-nums text-slate-950">{selectedShift.finalCashDeclared !== null ? `${formatMoney(selectedShift.finalCashDeclared)}` : '—'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Ticket Promedio */}
                            <div className="nx-canvas-card flex items-center justify-between p-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                                        <TrendingUp size={20} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-500 uppercase">Ticket Promedio</p>
                                        <p className="text-sm font-medium text-slate-700">{selectedShift.salesCount > 0 ? `${selectedShift.salesCount} ventas procesadas` : 'Sin ventas'}</p>
                                    </div>
                                </div>
                                <span className="text-xl font-black tabular-nums text-slate-950">
                                    {formatMoney(selectedShift.salesCount > 0 ? selectedShift.grandTotal / selectedShift.salesCount : 0)}
                                </span>
                            </div>

                            {/* Recent Movements (Only showing up to 3) */}
                            {selectedShift.recentMovements && selectedShift.recentMovements.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                                        <ArrowDownCircle size={14} /> Movimientos Manuales (Últimos 3)
                                    </h4>
                                    <div className="overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm">
                                        {selectedShift.recentMovements.slice(0, 3).map((mov, idx) => (
                                            <div key={idx} className="flex items-center justify-between border-b border-slate-200 bg-white p-3 last:border-0">
                                                <div>
                                                    <p className="text-sm font-bold text-slate-800">{mov.category}</p>
                                                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{mov.description}</p>
                                                    <p className="mt-0.5 text-[10px] text-slate-500">{formatTime(mov.createdAt)}</p>
                                                </div>
                                                <span className={`font-bold tabular-nums ${mov.type === 'IN' ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                    {mov.type === 'IN' ? '+' : '-'}{formatMoney(mov.amount)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-card border border-slate-200 bg-white p-3 text-center shadow-sm">
                                    <p className="text-xs font-bold text-slate-600">VENTAS</p>
                                    <p className="text-2xl font-black text-slate-950">{selectedShift.salesCount}</p>
                                </div>
                                <div className="rounded-card border border-emerald-200 bg-emerald-50 p-3 text-center shadow-sm">
                                    <p className="text-xs font-bold text-emerald-700">TOTAL BRUTO</p>
                                    <p className="text-lg font-black tabular-nums text-emerald-800">{formatMoney(selectedShift.grandTotal)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== MODAL: FORZAR CIERRE DE CAJA (Calculadora de Denominaciones) ====== */}
            {shiftToClose && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="force-close-title"
                        className="nx-light-context flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-slate-200 bg-white shadow-2xl"
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-control bg-red-50 text-red-700">
                                    <Lock size={20} />
                                </div>
                                <div>
                                    <h3 id="force-close-title" className="text-lg font-bold text-slate-950">Forzar Cierre de Caja</h3>
                                    <p className="text-xs text-slate-500 flex items-center gap-1">
                                        <User size={12} /> Cajero: {shiftToClose.employee ? `${shiftToClose.employee.firstName} ${shiftToClose.employee.lastName}` : shiftToClose.user.name}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setForceCloseError(null);
                                    setShiftToClose(null);
                                }}
                                disabled={closing}
                                className="nx-fluid-press inline-flex min-h-tap min-w-tap items-center justify-center rounded-full bg-white p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"
                                aria-label="Cancelar cierre forzado"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="nx-workspace flex-1 overflow-y-auto bg-slate-50 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Zona Izquierda: Calculadora */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Calculator className="text-emerald-700" size={18} />
                                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-800">Calculadora de Efectivo</h4>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                                        {[1000, 500, 200, 100, 50, 20, 10, 5, 1].map(den => (
                                            <div key={den} className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500 w-12 text-right">{formatMoney(den, 'NIO', { decimals: 0 })}</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={denominations[den as keyof typeof denominations] || ''}
                                                    onChange={(e) => handleDenominationChange(den, e.target.value)}
                                                    className="w-full rounded-control border border-slate-300 bg-white px-2 py-1.5 text-center text-sm font-medium text-slate-950 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                                    placeholder="0"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Zona Derecha: Resumen y Notas */}
                                <div className="space-y-6 flex flex-col justify-between">
                                    {/* Total Box */}
                                    <div className="relative overflow-hidden rounded-card border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
                                        <p className="relative z-10 mb-2 text-xs font-bold uppercase tracking-widest text-emerald-700">Total Declarado</p>
                                        <p className="relative z-10 text-4xl font-black tracking-tight text-emerald-950">
                                            {formatMoney(calculateTotalDeclared())}
                                        </p>
                                    </div>

                                    {/* Expectativa del Sistema (Opcional, puede ocultarse si el cajero no debe verlo, pero al ser Admin, es útil) */}
                                    <div className="flex items-center justify-between rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Aprox. Sistema</span>
                                        <span className="font-bold tabular-nums text-slate-950">{formatMoney(shiftToClose.estimatedPhysicalCash)}</span>
                                    </div>

                                    {/* Gaveta USD (Fase D): solo si el turno manejó dólares */}
                                    {(shiftToClose.estimatedPhysicalUsd ?? 0) !== 0 && (
                                        <div className="space-y-2 rounded-card border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-bold uppercase text-emerald-700">Dólares esperados</span>
                                                <span className="font-bold tabular-nums text-emerald-800">{formatUSD((shiftToClose.estimatedPhysicalUsd ?? 0))}</span>
                                            </div>
                                            <input
                                                type="number" min="0" step="0.01"
                                                value={declaredUsdForce}
                                                onChange={(e) => setDeclaredUsdForce(e.target.value)}
                                                placeholder="Dólares contados (US$)"
                                                className="w-full rounded-control border border-emerald-200 bg-white px-3 py-2 font-mono text-sm text-slate-950 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                            />
                                        </div>
                                    )}

                                    {/* Notas de Auditoría */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Notas de Auditoría (Opcional)</label>
                                        <textarea
                                            rows={3}
                                            value={auditNotes}
                                            onChange={(e) => setAuditNotes(e.target.value)}
                                            placeholder="Justificación del cierre forzado, discrepancias, etc."
                                            className="w-full resize-none rounded-card border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                    </div>
                                </div>
                            </div>

                            {forceCloseError && (
                                <div role="alert" className="mt-5 flex items-start gap-2 rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                                    <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
                                    <span>{forceCloseError}</span>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="flex justify-end gap-3 border-t border-slate-200 bg-white p-4">
                            <button
                                type="button"
                                onClick={() => {
                                    setForceCloseError(null);
                                    setShiftToClose(null);
                                }}
                                disabled={closing}
                                className="nx-fluid-press min-h-tap rounded-control border border-slate-300 bg-white px-6 py-2.5 font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleForceClose}
                                disabled={closing}
                                className="nx-fluid-press min-h-tap px-6 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 transition-colors flex items-center justify-center gap-2 min-w-[160px] disabled:opacity-75"
                            >
                                {closing ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                                {closing ? 'Cerrando...' : 'Confirmar Cierre'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ToastViewport toast={toast} onDismiss={dismissToast} />
        </div>
    );
};

export default CashRegisters;
