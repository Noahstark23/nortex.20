import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Zap, Users, Building2, DollarSign, TrendingUp, AlertTriangle, Ban, CheckCircle, Eye, RefreshCw, Skull, Activity, CreditCard, ArrowRight, Clock, BarChart3, Wallet, Target, XCircle, Banknote, FileCheck, X } from 'lucide-react';

interface TenantInfo {
    id: string;
    businessName: string;
    taxId: string;
    walletBalance: number;
    creditLimit: number;
    creditScore: number;
    subscriptionStatus: string;
    createdAt: string;
    owner: { id: string; name: string; email: string; role: string } | null;
    stats: { sales: number; products: number; employees: number };
}

interface PlatformStats {
    totalTenants: number;
    activeTenants: number;
    morosos: number;
    activeUsers: number;
    totalDebtLent: number;
    totalWallet: number;
    monthlySales: number;
    monthlyTransactions: number;
    platformFee: number;
    interestIncome: number;
    monthlyRevenue: number;
}

interface LoanRequest {
    id: string;
    tenantId: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    tenant: { businessName: string; creditScore: number; walletBalance: number; creditLimit: number };
}

interface ManualPaymentAdmin {
    id: string;
    tenantId: string;
    amount: number;
    currency: string;
    bank: string;
    referenceNumber: string;
    proofUrl: string | null;
    notes: string | null;
    status: string;
    rejectionReason: string | null;
    createdAt: string;
    tenant: { businessName: string; subscriptionStatus: string; users: { email: string; name: string }[] };
}

const formatMoney = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const getScoreColor = (score: number) => {
    if (score >= 700) return 'text-green-400';
    if (score >= 500) return 'text-yellow-400';
    return 'text-red-400';
};

const getScoreLabel = (score: number) => {
    if (score >= 800) return 'AAA';
    if (score >= 700) return 'AA';
    if (score >= 600) return 'A';
    if (score >= 500) return 'BBB';
    return 'RIESGO';
};

const getStatusBadge = (status: string) => {
    switch (status) {
        case 'ACTIVE': return <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-mono rounded">ACTIVO</span>;
        case 'TRIAL': return <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-mono rounded">TRIAL</span>;
        case 'PAST_DUE': return <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-mono rounded animate-pulse">SUSPENDIDO</span>;
        case 'CANCELLED': return <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs font-mono rounded">CANCELADO</span>;
        default: return <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-mono rounded">ACTIVO</span>;
    }
};

const SuperAdmin: React.FC = () => {
    const [stats, setStats] = useState<PlatformStats | null>(null);
    const [tenants, setTenants] = useState<TenantInfo[]>([]);
    const [loanRequests, setLoanRequests] = useState<LoanRequest[]>([]);
    const [manualPayments, setManualPayments] = useState<ManualPaymentAdmin[]>([]);
    const [rejectModal, setRejectModal] = useState<{ id: string; reason: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState(new Date());

    const token = localStorage.getItem('nortex_token');
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [statsRes, tenantsRes, loansRes, paymentsRes] = await Promise.all([
                fetch('/api/admin/stats', { headers }),
                fetch('/api/admin/tenants', { headers }),
                fetch('/api/admin/loan-requests', { headers }),
                fetch('/api/admin/manual-payments', { headers }),
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (tenantsRes.ok) setTenants(await tenantsRes.json());
            if (loansRes.ok) setLoanRequests(await loansRes.json());
            if (paymentsRes.ok) setManualPayments(await paymentsRes.json());
            setLastRefresh(new Date());
        } catch (e) {
            console.error('Admin fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Auto-refresh every 30s
    useEffect(() => {
        const interval = setInterval(fetchAll, 30000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    const handleSuspend = async (tenantId: string, name: string) => {
        if (!confirm(`CONFIRMAR SUSPENSIÓN de "${name}"\n\nEsta acción bloqueará todas las operaciones de escritura inmediatamente.`)) return;
        setActionLoading(tenantId);
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/suspend`, { method: 'POST', headers });
            if (res.ok) {
                fetchAll();
            } else {
                const err = await res.json();
                alert(err.error || 'Error');
            }
        } catch (e) { alert('Error de conexión'); }
        finally { setActionLoading(null); }
    };

    const handleReactivate = async (tenantId: string, name: string) => {
        if (!confirm(`¿Reactivar "${name}"?`)) return;
        setActionLoading(tenantId);
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/reactivate`, { method: 'POST', headers });
            if (res.ok) {
                fetchAll();
            }
        } catch (e) { alert('Error de conexión'); }
        finally { setActionLoading(null); }
    };

    const handleApproveLoan = async (orderId: string, amount: number) => {
        if (!confirm(`¿Aprobar préstamo de ${formatMoney(amount)}?`)) return;
        setActionLoading(orderId);
        try {
            const res = await fetch('/api/admin/loans/approve', {
                method: 'POST', headers,
                body: JSON.stringify({ orderId, amount }),
            });
            if (res.ok) { fetchAll(); }
        } catch (e) { alert('Error'); }
        finally { setActionLoading(null); }
    };

    const handleRejectLoan = async (orderId: string) => {
        if (!confirm('¿Rechazar esta solicitud?')) return;
        setActionLoading(orderId);
        try {
            const res = await fetch('/api/admin/loans/reject', {
                method: 'POST', headers,
                body: JSON.stringify({ orderId }),
            });
            if (res.ok) { fetchAll(); }
        } catch (e) { alert('Error'); }
        finally { setActionLoading(null); }
    };

    const handleApprovePayment = async (id: string) => {
        if (!confirm('¿Aprobar este pago y activar la suscripción del cliente?')) return;
        setActionLoading(`approve-pay-${id}`);
        try {
            const res = await fetch(`/api/admin/manual-payments/${id}/approve`, { method: 'POST', headers });
            const data = await res.json();
            if (res.ok) { alert(data.message); fetchAll(); }
            else alert(data.error);
        } catch (e: any) { alert(e.message); }
        finally { setActionLoading(null); }
    };

    const handleRejectPayment = async () => {
        if (!rejectModal) return;
        setActionLoading(`reject-pay-${rejectModal.id}`);
        try {
            const res = await fetch(`/api/admin/manual-payments/${rejectModal.id}/reject`, {
                method: 'POST', headers,
                body: JSON.stringify({ reason: rejectModal.reason || 'Comprobante inválido.' }),
            });
            const data = await res.json();
            if (res.ok) { alert(data.message); setRejectModal(null); fetchAll(); }
            else alert(data.error);
        } catch (e: any) { alert(e.message); }
        finally { setActionLoading(null); }
    };

    const handleLogout = () => {
        localStorage.removeItem('nortex_token');
        localStorage.removeItem('nortex_user');
        window.location.href = '/login';
    };

    if (loading && !stats) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <Shield className="w-16 h-16 text-red-500 mx-auto animate-pulse" />
                    <p className="text-green-400 font-mono mt-4 text-sm">INICIALIZANDO CENTRO DE COMANDO...</p>
                    <div className="w-48 h-1 bg-gray-800 mt-4 rounded-full overflow-hidden mx-auto">
                        <div className="h-full bg-green-500 animate-pulse rounded-full" style={{ width: '60%' }} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
            {/* HEADER BAR */}
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Shield className="w-6 h-6 text-red-500" />
                        <span className="font-bold text-lg text-white tracking-tight">NORTEX</span>
                        <span className="text-red-500 text-xs font-bold bg-red-500/10 px-2 py-0.5 rounded">COMMAND CENTER</span>
                    </div>
                    <div className="h-4 w-px bg-gray-700" />
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Activity size={12} className="text-green-500 animate-pulse" />
                        LIVE
                        <span className="text-gray-600">|</span>
                        Last: {lastRefresh.toLocaleTimeString()}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={fetchAll} className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                        LOGOUT
                    </button>
                </div>
            </div>

            <div className="p-6 max-w-[1600px] mx-auto">
                {/* KPI STRIP */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                    <KPICard icon={<Building2 size={18} />} label="EMPRESAS" value={String(stats?.totalTenants || 0)} sub={`${stats?.activeTenants || 0} activas`} color="blue" />
                    <KPICard icon={<Ban size={18} />} label="MOROSOS" value={String(stats?.morosos || 0)} sub="Suspendidos" color={stats?.morosos ? "red" : "green"} />
                    <KPICard icon={<Users size={18} />} label="USUARIOS" value={String(stats?.activeUsers || 0)} sub="Registrados" color="cyan" />
                    <KPICard icon={<DollarSign size={18} />} label="PRESTADO" value={formatMoney(stats?.totalDebtLent || 0)} sub="Riesgo actual" color="yellow" />
                    <KPICard icon={<BarChart3 size={18} />} label="VENTAS MES" value={formatMoney(stats?.monthlySales || 0)} sub={`${stats?.monthlyTransactions || 0} txns`} color="green" />
                    <KPICard icon={<TrendingUp size={18} />} label="TU GANANCIA" value={formatMoney(stats?.monthlyRevenue || 0)} sub="Fees + Intereses" color="emerald" highlight />
                </div>

                {/* Revenue breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                        <div className="text-[10px] text-gray-500 mb-1">PLATFORM FEE (2% VENTAS)</div>
                        <div className="text-xl font-bold text-blue-400">{formatMoney(stats?.platformFee || 0)}</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                        <div className="text-[10px] text-gray-500 mb-1">INTERESES (5% DEUDA)</div>
                        <div className="text-xl font-bold text-yellow-400">{formatMoney(stats?.interestIncome || 0)}</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                        <div className="text-[10px] text-gray-500 mb-1">WALLETS TOTALES</div>
                        <div className="text-xl font-bold text-green-400">{formatMoney(stats?.totalWallet || 0)}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* TENANT TABLE - 2 cols */}
                    <div className="lg:col-span-2">
                        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Skull size={16} className="text-red-500" />
                                    <span className="font-bold text-sm text-gray-300">LISTA NEGRA - TODAS LAS EMPRESAS</span>
                                </div>
                                <span className="text-[10px] text-gray-600">{tenants.length} registros</span>
                            </div>
                            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-800/50 text-gray-500 uppercase sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Empresa</th>
                                            <th className="px-3 py-2 text-left">Dueño</th>
                                            <th className="px-3 py-2 text-center">Score</th>
                                            <th className="px-3 py-2 text-right">Wallet</th>
                                            <th className="px-3 py-2 text-center">Estado</th>
                                            <th className="px-3 py-2 text-center">Stats</th>
                                            <th className="px-3 py-2 text-center">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/50">
                                        {tenants.map(t => (
                                            <tr key={t.id} className={`hover:bg-gray-800/30 transition-colors ${t.subscriptionStatus === 'PAST_DUE' ? 'bg-red-900/10' : ''}`}>
                                                <td className="px-3 py-3">
                                                    <div className="font-bold text-gray-200">{t.businessName}</div>
                                                    <div className="text-[10px] text-gray-600">{t.taxId}</div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    {t.owner ? (
                                                        <div>
                                                            <div className="text-gray-300">{t.owner.name}</div>
                                                            <div className="text-[10px] text-gray-600">{t.owner.email}</div>
                                                        </div>
                                                    ) : <span className="text-gray-600">-</span>}
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className={`font-bold text-lg ${getScoreColor(t.creditScore)}`}>{t.creditScore}</div>
                                                    <div className={`text-[9px] font-bold ${getScoreColor(t.creditScore)}`}>{getScoreLabel(t.creditScore)}</div>
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <span className="text-green-400 font-bold">{formatMoney(t.walletBalance)}</span>
                                                </td>
                                                <td className="px-3 py-3 text-center">{getStatusBadge(t.subscriptionStatus)}</td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="text-[10px] text-gray-500">
                                                        <span title="Ventas">{t.stats.sales}v</span> / <span title="Productos">{t.stats.products}p</span> / <span title="Empleados">{t.stats.employees}e</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {t.subscriptionStatus === 'PAST_DUE' || t.subscriptionStatus === 'CANCELLED' ? (
                                                            <button
                                                                onClick={() => handleReactivate(t.id, t.businessName)}
                                                                disabled={actionLoading === t.id}
                                                                className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-[10px] font-bold hover:bg-green-500/30 transition-colors disabled:opacity-50"
                                                            >
                                                                REACTIVAR
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleSuspend(t.id, t.businessName)}
                                                                disabled={actionLoading === t.id}
                                                                className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-[10px] font-bold hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                                            >
                                                                KILL
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {tenants.length === 0 && (
                                            <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600">Sin empresas registradas</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* ==================== TESORERIA - PAGOS MANUALES ==================== */}
                    <div>
                        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Banknote size={16} className="text-green-500" />
                                    <span className="font-bold text-sm text-gray-300">TESORERIA - PAGOS MANUALES</span>
                                </div>
                                {manualPayments.filter(p => p.status === 'PENDING').length > 0 && (
                                    <span className="bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">
                                        {manualPayments.filter(p => p.status === 'PENDING').length} PENDIENTES
                                    </span>
                                )}
                            </div>
                            <div className="max-h-96 overflow-y-auto">
                                {manualPayments.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-gray-600 text-sm">Sin pagos manuales reportados</div>
                                ) : (
                                    <div className="divide-y divide-gray-800">
                                        {manualPayments.map(p => (
                                            <div key={p.id} className={`p-4 ${p.status === 'PENDING' ? 'bg-yellow-500/5' : ''}`}>
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <div className="font-bold text-gray-200 text-sm flex items-center gap-2">
                                                            {p.tenant?.businessName || 'Empresa'}
                                                            <span className={`text-[10px] px-2 py-0.5 rounded ${
                                                                p.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                                                                p.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                                                                'bg-yellow-500/20 text-yellow-400'
                                                            }`}>
                                                                {p.status === 'APPROVED' ? 'APROBADO' : p.status === 'REJECTED' ? 'RECHAZADO' : 'PENDIENTE'}
                                                            </span>
                                                        </div>
                                                        <div className="text-[11px] text-gray-500 mt-0.5">
                                                            {p.tenant?.users?.[0]?.email || ''} | {new Date(p.createdAt).toLocaleString('es-NI')}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-mono font-bold text-green-400 text-lg">
                                                            {p.currency === 'NIO' ? 'C$' : '$'}{Number(p.amount).toFixed(2)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-[11px] text-gray-400 mb-2">
                                                    <span className="bg-gray-800 px-2 py-0.5 rounded">Banco: <strong className="text-gray-300">{p.bank}</strong></span>
                                                    <span className="bg-gray-800 px-2 py-0.5 rounded">Ref: <strong className="text-gray-300">{p.referenceNumber}</strong></span>
                                                    {p.notes && <span className="bg-gray-800 px-2 py-0.5 rounded">Nota: {p.notes}</span>}
                                                    {p.proofUrl && (
                                                        <a href={p.proofUrl} target="_blank" rel="noreferrer" className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded hover:bg-blue-500/30 transition-colors flex items-center gap-1">
                                                            <Eye size={10} /> Ver Voucher
                                                        </a>
                                                    )}
                                                </div>
                                                {p.status === 'REJECTED' && p.rejectionReason && (
                                                    <div className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded mb-2">
                                                        Motivo: {p.rejectionReason}
                                                    </div>
                                                )}
                                                {p.status === 'PENDING' && (
                                                    <div className="flex gap-2 mt-2">
                                                        <button
                                                            onClick={() => handleApprovePayment(p.id)}
                                                            disabled={actionLoading === `approve-pay-${p.id}`}
                                                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500/20 text-green-400 rounded font-bold text-xs hover:bg-green-500/30 transition-colors disabled:opacity-50"
                                                        >
                                                            <FileCheck size={14} /> APROBAR & ACTIVAR
                                                        </button>
                                                        <button
                                                            onClick={() => setRejectModal({ id: p.id, reason: '' })}
                                                            disabled={actionLoading === `reject-pay-${p.id}`}
                                                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-500/20 text-red-400 rounded font-bold text-xs hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                                        >
                                                            <XCircle size={14} /> RECHAZAR
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* LOAN REQUESTS - 1 col */}
                    <div>
                        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <CreditCard size={16} className="text-yellow-500" />
                                    <span className="font-bold text-sm text-gray-300">SOLICITUDES DE CREDITO</span>
                                </div>
                                {loanRequests.length > 0 && (
                                    <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">
                                        {loanRequests.length}
                                    </span>
                                )}
                            </div>
                            <div className="max-h-[600px] overflow-y-auto">
                                {loanRequests.length === 0 ? (
                                    <div className="p-8 text-center text-gray-600">
                                        <CreditCard size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-xs">Sin solicitudes pendientes</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-800/50">
                                        {loanRequests.map(lr => (
                                            <div key={lr.id} className="p-4 hover:bg-gray-800/20 transition-colors">
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <div className="font-bold text-gray-200 text-sm">{lr.tenant.businessName}</div>
                                                        <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                                            <Clock size={10} /> {new Date(lr.createdAt).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-yellow-400 font-bold text-lg">{formatMoney(Number(lr.totalAmount))}</div>
                                                    </div>
                                                </div>

                                                {/* Score badge */}
                                                <div className="flex items-center gap-3 mb-3">
                                                    <div className={`flex items-center gap-1 px-2 py-1 rounded ${
                                                        lr.tenant.creditScore >= 700 ? 'bg-green-500/10' : 
                                                        lr.tenant.creditScore >= 500 ? 'bg-yellow-500/10' : 'bg-red-500/10'
                                                    }`}>
                                                        <Target size={12} className={getScoreColor(lr.tenant.creditScore)} />
                                                        <span className={`font-bold text-sm ${getScoreColor(lr.tenant.creditScore)}`}>
                                                            {lr.tenant.creditScore}
                                                        </span>
                                                        <span className={`text-[10px] font-bold ${getScoreColor(lr.tenant.creditScore)}`}>
                                                            {getScoreLabel(lr.tenant.creditScore)}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500">
                                                        Wallet: {formatMoney(Number(lr.tenant.walletBalance))} | Limit: {formatMoney(Number(lr.tenant.creditLimit))}
                                                    </div>
                                                </div>

                                                {/* Action buttons */}
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleApproveLoan(lr.id, Number(lr.totalAmount))}
                                                        disabled={actionLoading === lr.id}
                                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500/20 text-green-400 rounded font-bold text-xs hover:bg-green-500/30 transition-colors disabled:opacity-50"
                                                    >
                                                        <CheckCircle size={14} /> APROBAR
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectLoan(lr.id)}
                                                        disabled={actionLoading === lr.id}
                                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-500/20 text-red-400 rounded font-bold text-xs hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                                    >
                                                        <XCircle size={14} /> RECHAZAR
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* System status */}
                        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mt-3">
                            <div className="text-[10px] text-gray-500 font-bold mb-3">SYSTEM STATUS</div>
                            <div className="space-y-2">
                                <StatusLine label="API Server" status="online" />
                                <StatusLine label="Database" status="online" />
                                <StatusLine label="Payment Gateway" status="standby" />
                                <StatusLine label="Notifications" status="online" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* REJECT MODAL */}
            {rejectModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-bold text-red-400 flex items-center gap-2"><XCircle size={20} /> Rechazar Pago</h3>
                            <button onClick={() => setRejectModal(null)} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-400">Motivo del Rechazo</label>
                            <textarea
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-lg p-3 mt-1 text-sm"
                                rows={3}
                                placeholder="Ej: Comprobante no legible, monto incorrecto..."
                                value={rejectModal.reason}
                                onChange={e => setRejectModal({...rejectModal, reason: e.target.value})}
                            />
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setRejectModal(null)} className="flex-1 bg-gray-800 text-gray-400 py-2 rounded-lg font-bold text-sm hover:bg-gray-700">Cancelar</button>
                            <button
                                onClick={handleRejectPayment}
                                disabled={actionLoading?.startsWith('reject-pay')}
                                className="flex-1 bg-red-500/20 text-red-400 py-2 rounded-lg font-bold text-sm hover:bg-red-500/30 disabled:opacity-50"
                            >Confirmar Rechazo</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ==========================================
// SUB-COMPONENTS
// ==========================================

const KPICard: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string; color: string; highlight?: boolean }> = 
    ({ icon, label, value, sub, color, highlight }) => {
    const colorMap: Record<string, string> = {
        blue: 'text-blue-400 bg-blue-500/10',
        red: 'text-red-400 bg-red-500/10',
        green: 'text-green-400 bg-green-500/10',
        yellow: 'text-yellow-400 bg-yellow-500/10',
        cyan: 'text-cyan-400 bg-cyan-500/10',
        emerald: 'text-emerald-400 bg-emerald-500/10',
    };
    const c = colorMap[color] || colorMap.blue;
    const [textColor] = c.split(' ');

    return (
        <div className={`bg-gray-900 border rounded-lg p-3 ${highlight ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-gray-800'}`}>
            <div className="flex items-center justify-between mb-2">
                <div className={`p-1.5 rounded ${c}`}>{icon}</div>
                <span className="text-[9px] text-gray-600 font-bold">{label}</span>
            </div>
            <div className={`text-xl font-bold ${textColor}`}>{value}</div>
            <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>
        </div>
    );
};

const StatusLine: React.FC<{ label: string; status: 'online' | 'offline' | 'standby' }> = ({ label, status }) => {
    const colors = {
        online: 'bg-green-500',
        offline: 'bg-red-500',
        standby: 'bg-yellow-500',
    };
    return (
        <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-gray-400">
                <div className={`w-1.5 h-1.5 rounded-full ${colors[status]} ${status === 'online' ? 'animate-pulse' : ''}`} />
                {label}
            </div>
            <span className={`text-[10px] font-bold ${status === 'online' ? 'text-green-500' : status === 'offline' ? 'text-red-500' : 'text-yellow-500'}`}>
                {status.toUpperCase()}
            </span>
        </div>
    );
};

export default SuperAdmin;
