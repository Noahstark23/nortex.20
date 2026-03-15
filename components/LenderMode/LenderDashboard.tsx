import React, { useState, useEffect } from 'react';
import { DollarSign, Activity, AlertTriangle, Plus, Users, Wallet, X, Banknote } from 'lucide-react';

const LenderDashboard: React.FC = () => {
    const [loans, setLoans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showDepositModal, setShowDepositModal] = useState(false);
    const [depositData, setDepositData] = useState({ collectorId: '', motoName: '', amount: '', notes: '' });
    const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
    const [routeExpenses, setRouteExpenses] = useState<any[]>([]);
    const [collectors, setCollectors] = useState<any[]>([]);
    const [showPenaltyModal, setShowPenaltyModal] = useState(false);
    const [penaltyData, setPenaltyData] = useState({ loanId: '', clientName: '', amount: '', reason: 'Multa por atraso' });
    const [showRefiModal, setShowRefiModal] = useState(false);
    const [refiLoan, setRefiLoan] = useState<any>(null);
    const [refiData, setRefiData] = useState({ newPrincipal: '', interestRate: '', installments: '', frequency: 'DAILY', type: 'INFORMAL_FLAT' });
    const [showMotoModal, setShowMotoModal] = useState(false);
    const [motoData, setMotoData] = useState({ name: '', email: '', password: '' });
    const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'CLIENTS' | 'REPORTS' | 'TEAM' | 'ACCOUNTING'>('DASHBOARD');
    const [clientSearch, setClientSearch] = useState('');
    const [lenderClients, setLenderClients] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        clientName: '',
        principalAmount: '',
        interestRate: '',
        installments: '',
        frequency: 'DAILY',
        type: 'INFORMAL_FLAT'
    });

    useEffect(() => {
        fetchPortfolio();
        fetchRouteExpenses();
        fetchClients();
        fetchCollectors();
    }, []);

    const fetchPortfolio = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` }
            });
            const data = await response.json();
            if (data.success) {
                setLoans(data.data);
            }
        } catch (error) {
            console.error("Error al cargar el portafolio", error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateLoan = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('nortex_token')}`
                },
                body: JSON.stringify(formData)
            });
            const data = await response.json();
            if (data.success) {
                setShowModal(false);
                setFormData({ clientName: '', principalAmount: '', interestRate: '', installments: '', frequency: 'DAILY', type: 'INFORMAL_FLAT' });
                fetchPortfolio();
                fetchClients();
            } else {
                alert("Error al desembolsar: " + data.error);
            }
        } catch (error) {
            console.error("Error originando crédito", error);
            alert("Error de conexión con la Bóveda.");
        } finally {
            setSubmitting(false);
        }
    };

    const fetchRouteExpenses = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/route-expenses`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` }
            });
            const data = await response.json();
            if (data.success) setRouteExpenses(data.data);
        } catch (error) {
            console.error('Error cargando gastos de ruta:', error);
        }
    };

    const fetchCollectors = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/collectors`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` }
            });
            const data = await response.json();
            if (data.success) setCollectors(data.data);
        } catch (error) {
            console.error('Error cargando cobradores:', error);
        }
    };

    const fetchClients = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/clients`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` }
            });
            const data = await response.json();
            if (data.success) setLenderClients(data.data);
        } catch (error) {
            console.error('Error cargando clientes:', error);
        }
    };

    const toggleBlockClient = async (clientId: string, currentBlocked: boolean) => {
        try {
            await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/clients/${clientId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify({ isBlocked: !currentBlocked })
            });
            fetchClients();
        } catch (error) {
            console.error('Error actualizando cliente:', error);
        }
    };

    const handleCreateMoto = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/collectors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify(motoData)
            });
            const data = await response.json();
            if (data.success) {
                setShowMotoModal(false);
                setMotoData({ name: '', email: '', password: '' });
                alert("¡Motorizado reclutado! Ya puede descargar la app e iniciar sesión.");
            } else {
                alert("Error: " + data.error);
            }
        } catch (error) {
            alert("Error de conexión con la Bóveda.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/vault/deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify({ collectorId: depositData.collectorId, amount: depositData.amount, notes: depositData.notes })
            });
            const data = await response.json();
            if (data.success) {
                setShowDepositModal(false);
                setDepositData({ collectorId: '', motoName: '', amount: '', notes: '' });
                alert(`¡✅ Exito! Se han ingresado $${depositData.amount} a la Bóveda General Nortex.`);
            } else {
                alert("Error: " + data.error);
            }
        } catch (error) {
            alert("Error de conexión con la Bóveda.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleAssignCollector = async (loanId: string, collectorId: string) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/${loanId}/assign`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify({ assignedToId: collectorId || null })
            });
            const data = await response.json();
            if (data.success) {
                // Actualizar estado local
                setLoans(loans.map(l => l.id === loanId ? { ...l, assignedToId: collectorId, assignedTo: collectors.find(c => c.id === collectorId) || null } : l));
            } else {
                alert("Error al asignar: " + data.error);
            }
        } catch (error) {
            console.error("Error de conexión:", error);
        }
    };

    const handlePenalty = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/${penaltyData.loanId}/penalty`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify({ penaltyAmount: penaltyData.amount, reason: penaltyData.reason })
            });
            const data = await response.json();
            if (data.success) {
                setShowPenaltyModal(false);
                setPenaltyData({ loanId: '', clientName: '', amount: '', reason: 'Multa por atraso' });
                alert(`¡Multa aplicada! El saldo deudor ha incrementado en $${penaltyData.amount}.`);
                fetchPortfolio();
            } else {
                alert("Error aplicando multa: " + data.error);
            }
        } catch (error) {
            alert("Error de conexión al aplicar multa.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleRefinance = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!refiLoan) return;
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/loans/${refiLoan.id}/refinance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` },
                body: JSON.stringify(refiData)
            });
            const data = await response.json();
            if (data.success) {
                setShowRefiModal(false);
                setRefiLoan(null);
                setRefiData({ newPrincipal: '', interestRate: '', installments: '', frequency: 'DAILY', type: 'INFORMAL_FLAT' });
                fetchPortfolio();
            }
        } catch (error) {
            console.error('Error refinanciando:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Cálculos financieros en tiempo real
    const totalDeployed = loans.reduce((acc, loan) => acc + Number(loan.principalAmount), 0);
    const expectedReturn = loans.reduce((acc, loan) => acc + Number(loan.totalToRepay), 0);
    const totalCollected = loans.reduce((acc, loan) => acc + (Number(loan.totalToRepay) - Number(loan.balanceRemaining)), 0);
    const activeClients = loans.filter(l => l.status === 'ACTIVE').length;

    // Liquidación diaria: cuánto se cobró HOY
    const today = new Date().toISOString().split('T')[0];
    const collectedToday = loans.reduce((total, loan) => {
        const todayPayments = loan.payments?.filter((p: any) => p.paymentDate?.startsWith(today)) || [];
        const sumToday = todayPayments.reduce((acc: number, p: any) => acc + Number(p.amountPaid), 0);
        return total + sumToday;
    }, 0);

    // Desglose por cobrador (Arqueo)
    const collectorTotals = loans.reduce((acc, loan) => {
        const todayPayments = loan.payments?.filter((p: any) => p.paymentDate?.startsWith(today)) || [];
        todayPayments.forEach((p: any) => {
            const cobrador = p.collectedBy || 'Desconocido';
            acc[cobrador] = (acc[cobrador] || 0) + Number(p.amountPaid);
        });
        return acc;
    }, {} as Record<string, number>);

    // Gastos de ruta del día
    const todayExpenses = routeExpenses.filter((e: any) => e.date?.startsWith(today));
    const totalExpensesToday = todayExpenses.reduce((acc, e) => acc + Number(e.amount), 0);

    return (
        <div className="p-8 h-full overflow-y-auto bg-slate-900 text-slate-100 font-sans">
            <header className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Wallet className="text-nortex-accent" size={32} />
                        Mando Financiero
                    </h1>
                    <p className="text-slate-400 mt-2">Nortex Prestamistas - Panel de Inversor</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="bg-nortex-accent hover:bg-emerald-400 text-slate-900 font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                >
                    <Plus size={20} />
                    NUEVO CRÉDITO
                </button>
            </header>

            {/* Navegación por Pestañas */}
            <div className="flex border-b border-slate-800 mb-8 gap-6">
                <button onClick={() => setActiveTab('DASHBOARD')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'DASHBOARD' ? 'border-nortex-accent text-nortex-accent' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>PANEL DE CONTROL</button>
                <button onClick={() => setActiveTab('CLIENTS')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'CLIENTS' ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>DIRECTORIO DE CLIENTES</button>
                <button onClick={() => setActiveTab('REPORTS')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'REPORTS' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>REPORTES</button>
                <button onClick={() => setActiveTab('TEAM')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'TEAM' ? 'border-orange-400 text-orange-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>TROPAS Y COMISIONES</button>
                <button onClick={() => setActiveTab('ACCOUNTING')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'ACCOUNTING' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>CAJA CHICA</button>
            </div>

            {/* TAB: Dashboard */}
            {activeTab === 'DASHBOARD' && (<div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-slate-400">Capital Desplegado</p>
                            <DollarSign size={20} className="text-blue-400" />
                        </div>
                        <h3 className="text-2xl font-bold text-white">${totalDeployed.toFixed(2)}</h3>
                    </div>

                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-slate-400">Retorno Esperado</p>
                            <Activity size={20} className="text-purple-400" />
                        </div>
                        <h3 className="text-2xl font-bold text-white">${expectedReturn.toFixed(2)}</h3>
                    </div>

                    <div className="bg-slate-800 border border-nortex-accent/30 p-6 rounded-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-nortex-accent/10 rounded-bl-full"></div>
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-nortex-accent">Capital Recuperado</p>
                            <DollarSign size={20} className="text-nortex-accent" />
                        </div>
                        <h3 className="text-2xl font-bold text-nortex-accent">${totalCollected.toFixed(2)}</h3>
                    </div>

                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-slate-400">Clientes Activos</p>
                            <Users size={20} className="text-orange-400" />
                        </div>
                        <h3 className="text-2xl font-bold text-white">{activeClients}</h3>
                    </div>

                    {/* Cuadre de Ruta - Liquidación Diaria */}
                    <div className="bg-emerald-900/30 border border-emerald-500/50 p-6 rounded-2xl relative overflow-hidden ring-1 ring-emerald-500/20">
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-bold text-emerald-400">Efectivo a Recibir HOY</p>
                            <Banknote size={20} className="text-emerald-400" />
                        </div>
                        <h3 className="text-3xl font-black text-emerald-400">${collectedToday.toFixed(2)}</h3>
                        {totalExpensesToday > 0 && (
                            <p className="text-xs text-orange-400 mt-1">- Gastos: ${totalExpensesToday.toFixed(2)} = Neto: <span className="font-bold text-emerald-300">${(collectedToday - totalExpensesToday).toFixed(2)}</span></p>
                        )}
                        <p className="text-xs text-emerald-500 mt-1">Lo que los motorizados traen en el canguro.</p>

                        {/* Desglose por cobrador */}
                        <div className="mt-4 pt-4 border-t border-emerald-500/30">
                            <p className="text-xs font-bold text-emerald-500 mb-2 uppercase">Efectivo en canguros:</p>
                            {Object.entries(collectorTotals).length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Nadie ha cobrado hoy.</p>
                            ) : (
                                <div className="space-y-1">
                                    {Object.entries(collectorTotals).map(([moto, total]) => (
                                        <div key={moto} className="flex justify-between text-sm">
                                            <span className="text-emerald-100">{moto}</span>
                                            <span className="font-mono font-bold text-emerald-400">${Number(total).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tabla de Cartera Activa */}
                <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                        <h3 className="text-lg font-bold text-white">Cartera en la Calle</h3>
                        <span className="text-sm text-slate-400">Actualización en tiempo real</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/50 text-slate-400 text-sm">
                                <tr>
                                    <th className="p-4 font-medium">Cliente</th>
                                    <th className="p-4 font-medium">Tipo</th>
                                    <th className="p-4 font-medium">Frecuencia</th>
                                    <th className="p-4 font-medium text-right">Capital</th>
                                    <th className="p-4 font-medium text-right">Cuota</th>
                                    <th className="p-4 font-medium text-right">Saldo</th>
                                    <th className="p-4 font-medium text-center">Estado</th>
                                    <th className="p-4 font-medium text-center">Ruta / Motorizado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="p-8 text-center text-slate-500 animate-pulse">Cargando bóveda...</td></tr>
                                ) : loans.length === 0 ? (
                                    <tr><td colSpan={8} className="p-8 text-center text-slate-500">No hay capital en la calle.</td></tr>
                                ) : (
                                    loans.map((loan) => (
                                        <React.Fragment key={loan.id}>
                                            {(() => {
                                                const isOverdue = loan.status === 'ACTIVE' && new Date(loan.dueDate) < new Date();
                                                return (
                                                    <>
                                                        <tr
                                                            onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)}
                                                            className={`transition-colors cursor-pointer group ${isOverdue ? 'bg-red-900/10 hover:bg-red-900/20' : 'hover:bg-slate-700/50'}`}
                                                        >
                                                            <td className="p-4 font-medium text-white flex items-center gap-2">
                                                                <span className="text-slate-500 group-hover:text-nortex-accent transition-colors">{expandedLoan === loan.id ? '▼' : '▶'}</span>
                                                                {loan.clientName}
                                                                {isOverdue && <AlertTriangle size={14} className="text-red-500 ml-2 animate-pulse" title="Cliente en Mora" />}
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`px-2 py-1 rounded text-xs font-bold ${loan.type === 'FORMAL_AMORTIZED' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                                                    {loan.type === 'FORMAL_AMORTIZED' ? 'FINANCIERA' : 'GOTA'}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-slate-400 text-sm">{loan.frequency}</td>
                                                            <td className="p-4 text-right font-mono text-slate-300">${Number(loan.principalAmount).toFixed(2)}</td>
                                                            <td className="p-4 text-right font-mono text-slate-300">${Number(loan.installmentAmount).toFixed(2)}</td>
                                                            <td className="p-4 text-right font-mono font-bold text-nortex-accent">${Number(loan.balanceRemaining).toFixed(2)}</td>
                                                            <td className="p-4 text-center">
                                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${loan.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                                                                    loan.status === 'PAID_OFF' ? 'bg-blue-500/20 text-blue-400' :
                                                                        'bg-red-500/20 text-red-400'
                                                                    }`}>
                                                                    {loan.status}
                                                                </span>
                                                            </td>
                                                            <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                                                <select
                                                                    value={loan.assignedToId || ''}
                                                                    onChange={(e) => handleAssignCollector(loan.id, e.target.value)}
                                                                    className="bg-slate-800 border border-slate-700 text-xs text-slate-300 rounded px-2 py-1 outline-none focus:border-nortex-accent w-full max-w-[120px]"
                                                                >
                                                                    <option value="">Sin Asignar</option>
                                                                    {collectors.map(c => (
                                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                        </tr>

                                                        {/* Panel expandible con historial de pagos */}
                                                        {expandedLoan === loan.id && (
                                                            <tr className="bg-slate-900/50">
                                                                <td colSpan={7} className="p-4 border-l-2 border-nortex-accent">
                                                                    <div className="text-sm">
                                                                        <h4 className="font-bold text-slate-400 mb-2">Historial de Pagos</h4>
                                                                        {loan.payments && loan.payments.length > 0 ? (
                                                                            <div className="space-y-2">
                                                                                {loan.payments.map((payment: any) => (
                                                                                    <div key={payment.id} className="flex justify-between items-center bg-slate-800 p-3 rounded-lg">
                                                                                        <span className="text-slate-300">{new Date(payment.paymentDate).toLocaleDateString()}</span>
                                                                                        <span className="text-slate-400 font-mono">{payment.collectedBy}</span>
                                                                                        <span className="text-emerald-400 font-bold font-mono">+${Number(payment.amountPaid).toFixed(2)}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        ) : (
                                                                            <p className="text-slate-500 italic">No hay pagos registrados aún.</p>
                                                                        )}
                                                                    </div>

                                                                    {/* Botones de Acción (Refinanciar / Multar) */}
                                                                    <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between items-center bg-slate-800/50 p-3 rounded-lg">
                                                                        <div className="text-sm text-slate-400 font-mono">
                                                                            Saldo: <span className="font-bold text-white text-lg">${Number(loan.balanceRemaining).toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex gap-3">
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setPenaltyData({ loanId: loan.id, clientName: loan.clientName, amount: '', reason: 'Multa por atraso' });
                                                                                    setShowPenaltyModal(true);
                                                                                }}
                                                                                className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg font-bold text-xs hover:bg-red-500 hover:text-white transition-colors flex items-center gap-2"
                                                                            >
                                                                                <AlertTriangle size={14} />
                                                                                APLICAR PENALIDAD
                                                                            </button>

                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setRefiLoan(loan);
                                                                                    setRefiData({ ...refiData, type: loan.type, frequency: loan.frequency, interestRate: String(loan.interestRate) });
                                                                                    setShowRefiModal(true);
                                                                                }}
                                                                                className="px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/50 rounded-lg font-bold text-xs hover:bg-purple-500 hover:text-white transition-colors flex items-center gap-2"
                                                                            >
                                                                                <Activity size={14} />
                                                                                REFINANCIAR
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>)}

            {/* TAB: CRM de Clientes */}
            {activeTab === 'CLIENTS' && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Users className="text-blue-400" size={20} />
                            Gestión de Clientes (CRM)
                        </h3>
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 outline-none"
                        />
                    </div>

                    {lenderClients.length === 0 ? (
                        <p className="text-slate-500 text-center py-12">No hay clientes registrados aún. Se crean automáticamente al originar créditos.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {lenderClients
                                .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                                .map((client: any) => {
                                    const initials = client.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                                    const activeDebt = client.loans?.filter((l: any) => l.status === 'ACTIVE').reduce((acc: number, l: any) => acc + Number(l.balanceRemaining), 0) || 0;
                                    const isMoroso = client.loans?.some((l: any) => l.status === 'ACTIVE' && new Date(l.dueDate) < new Date());
                                    const totalLoans = client.loans?.length || 0;

                                    return (
                                        <div key={client.id} className={`bg-slate-900 border rounded-xl p-5 relative overflow-hidden transition-colors ${client.isBlocked ? 'border-red-500/50 opacity-60' : 'border-slate-700 hover:border-blue-500/50'}`}>
                                            <button
                                                onClick={() => toggleBlockClient(client.id, client.isBlocked)}
                                                className={`absolute top-4 right-4 transition-colors ${client.isBlocked ? 'text-red-500 hover:text-red-400' : 'text-slate-500 hover:text-red-500'}`}
                                                title={client.isBlocked ? 'Desbloquear' : 'Bloquear (Lista Negra)'}
                                            >
                                                <AlertTriangle size={20} />
                                            </button>

                                            <div className="flex items-center gap-4 mb-4">
                                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl ${client.isBlocked ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                                    {initials}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-white text-lg flex items-center gap-2">
                                                        {client.name}
                                                        {client.isBlocked && <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded font-bold">BLOQUEADO</span>}
                                                        {isMoroso && !client.isBlocked && <span className="bg-orange-500/20 text-orange-400 text-xs px-2 py-0.5 rounded font-bold">MOROSO</span>}
                                                    </h4>
                                                    <p className="text-xs text-slate-400">{client.phone || 'Sin teléfono'}</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2 mb-4">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400">Límite de Crédito:</span>
                                                    <span className="font-bold text-white">${Number(client.creditLimit).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400">Deuda Activa:</span>
                                                    <span className={`font-bold font-mono ${activeDebt > Number(client.creditLimit) ? 'text-red-400' : 'text-orange-400'}`}>${activeDebt.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400">Créditos Totales:</span>
                                                    <span className="text-white font-bold">{totalLoans}</span>
                                                </div>
                                            </div>

                                            {/* Mini historial */}
                                            {client.loans && client.loans.length > 0 && (
                                                <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                                                    {client.loans.slice(0, 3).map((loan: any) => (
                                                        <div key={loan.id} className="flex justify-between text-xs">
                                                            <span className="text-slate-400 font-mono">{new Date(loan.createdAt).toLocaleDateString()}</span>
                                                            <span className="text-slate-300">${Number(loan.principalAmount).toFixed(2)}</span>
                                                            <span className={`font-bold ${loan.status === 'PAID_OFF' ? 'text-blue-400' : 'text-orange-400'}`}>{loan.status}</span>
                                                        </div>
                                                    ))}
                                                    {client.loans.length > 3 && <p className="text-xs text-slate-500 text-center">+{client.loans.length - 3} más</p>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>
            )}

            {/* TAB: Reportes */}
            {activeTab === 'REPORTS' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
                        <h3 className="text-lg font-bold text-white mb-4">Análisis de Cartera</h3>
                        <div className="space-y-4">
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Capital Total Desplegado</span>
                                <span className="font-mono font-bold text-blue-400">${totalDeployed.toFixed(2)}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Total Intereses Proyectados</span>
                                <span className="font-mono font-bold text-purple-400">${(expectedReturn - totalDeployed).toFixed(2)}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Intereses Cobrados (Realidad)</span>
                                <span className="font-mono font-bold text-emerald-400">${Math.max(0, totalCollected - totalDeployed).toFixed(2)}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-red-500/20">
                                <span className="text-red-400 font-bold">Capital en Riesgo (Mora)</span>
                                <span className="font-mono font-bold text-red-400">
                                    ${loans.filter(l => l.status === 'ACTIVE' && new Date(l.dueDate) < new Date()).reduce((acc, l) => acc + Number(l.balanceRemaining), 0).toFixed(2)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
                        <h3 className="text-lg font-bold text-white mb-4">Resumen Operativo</h3>
                        <div className="space-y-4">
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Préstamos Activos</span>
                                <span className="font-mono font-bold text-nortex-accent">{loans.filter(l => l.status === 'ACTIVE').length}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Préstamos Liquidados</span>
                                <span className="font-mono font-bold text-blue-400">{loans.filter(l => l.status === 'PAID_OFF').length}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-700">
                                <span className="text-slate-400">Clientes Únicos</span>
                                <span className="font-mono font-bold text-white">{new Set(loans.map(l => l.clientName)).size}</span>
                            </div>
                            <div className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-orange-500/20">
                                <span className="text-orange-400">Gastos de Ruta (Hoy)</span>
                                <span className="font-mono font-bold text-orange-400">${totalExpensesToday.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB: Tropas y Comisiones */}
            {activeTab === 'TEAM' && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Users size={20} className="text-orange-400" /> Gestión de Cobradores</h3>
                            <div className="text-sm text-slate-400">Mes en curso: <span className="text-white font-bold">{new Date().toLocaleDateString('es', { month: 'long', year: 'numeric' })}</span></div>
                        </div>
                        <button
                            onClick={() => setShowMotoModal(true)}
                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                        >
                            + NUEVO MOTORIZADO
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(() => {
                            const thisMonth = new Date().toISOString().slice(0, 7);
                            const monthlyTotals = loans.reduce((acc, loan) => {
                                const monthlyPayments = loan.payments?.filter((p: any) => p.paymentDate?.startsWith(thisMonth)) || [];
                                monthlyPayments.forEach((p: any) => {
                                    const cobrador = p.collectedBy || 'Desconocido';
                                    if (!acc[cobrador]) acc[cobrador] = { amount: 0, uid: p.collectedById || cobrador };
                                    acc[cobrador].amount += Number(p.amountPaid);
                                });
                                return acc;
                            }, {} as Record<string, { amount: number, uid: string }>);

                            const entries = Object.entries(monthlyTotals);
                            if (entries.length === 0) {
                                return <p className="text-slate-500 col-span-2 text-center py-8">No hay cobros registrados este mes aún.</p>;
                            }
                            return entries.map(([moto, data]) => (
                                <div key={moto} className="bg-slate-900 border border-slate-700 p-5 rounded-xl flex justify-between items-center group">
                                    <div>
                                        <h4 className="font-bold text-orange-400 text-lg">{moto}</h4>
                                        <p className="text-sm text-slate-400">Recuperado este mes: <span className="font-mono text-white">${Number(data.amount).toFixed(2)}</span></p>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <div className="text-right">
                                            <p className="text-xs font-bold text-slate-500 uppercase">Comisión (5%)</p>
                                            <p className="text-2xl font-mono font-bold text-emerald-400">${(Number(data.amount) * 0.05).toFixed(2)}</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setDepositData({ collectorId: data.uid, motoName: moto, amount: '', notes: `Depositado por ${moto}` });
                                                setShowDepositModal(true);
                                            }}
                                            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white px-3 py-1 rounded-lg text-xs font-bold transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            RECIBIR EFECTIVO
                                        </button>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </div>
            )}

            {/* TAB: Caja Chica */}
            {activeTab === 'ACCOUNTING' && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                        <h3 className="text-lg font-bold text-white">Caja Chica y Gastos Operativos</h3>
                        <div className="text-sm text-slate-400">Total registrado: <span className="font-mono font-bold text-red-400">${routeExpenses.reduce((acc, e) => acc + Number(e.amount), 0).toFixed(2)}</span></div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/50 text-slate-400 text-sm">
                                <tr>
                                    <th className="p-4 font-medium">Fecha</th>
                                    <th className="p-4 font-medium">Concepto</th>
                                    <th className="p-4 font-medium">Responsable</th>
                                    <th className="p-4 font-medium text-right">Monto</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50 text-sm">
                                {routeExpenses.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-slate-500">No hay gastos registrados.</td></tr>
                                ) : (
                                    routeExpenses.map((expense: any) => (
                                        <tr key={expense.id} className="hover:bg-slate-700/30 transition-colors">
                                            <td className="p-4 text-slate-300 font-mono text-xs">{new Date(expense.date).toLocaleDateString()}</td>
                                            <td className="p-4 text-white">{expense.description}</td>
                                            <td className="p-4 text-slate-400">{expense.collectedBy}</td>
                                            <td className="p-4 text-right font-mono text-red-400 font-bold">-${Number(expense.amount).toFixed(2)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal de Originación de Crédito */}
            {showModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-white">Originación de Capital</h2>
                            <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateLoan} className="p-6 space-y-4">
                            {/* Selector de Modalidad */}
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type: 'INFORMAL_FLAT', frequency: 'DAILY' })}
                                    className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${formData.type === 'INFORMAL_FLAT' ? 'border-nortex-accent bg-emerald-500/10 text-nortex-accent' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                >
                                    <span className="font-bold">GOTA A GOTA</span>
                                    <span className="text-xs text-center">Interés fijo, cobro diario</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type: 'FORMAL_AMORTIZED', frequency: 'MONTHLY' })}
                                    className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${formData.type === 'FORMAL_AMORTIZED' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                >
                                    <span className="font-bold">FINANCIERA</span>
                                    <span className="text-xs text-center">Interés s/saldo, cobro mensual</span>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <input
                                    type="text"
                                    placeholder="Nombre del Cliente"
                                    required
                                    value={formData.clientName}
                                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-nortex-accent outline-none transition-colors"
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        type="number"
                                        placeholder="Monto a Prestar ($)"
                                        required
                                        value={formData.principalAmount}
                                        onChange={(e) => setFormData({ ...formData, principalAmount: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-nortex-accent transition-colors"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Tasa de Interés (%)"
                                        required
                                        value={formData.interestRate}
                                        onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-nortex-accent transition-colors"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        type="number"
                                        placeholder="N° de Cuotas (Plazo)"
                                        required
                                        value={formData.installments}
                                        onChange={(e) => setFormData({ ...formData, installments: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-nortex-accent transition-colors"
                                    />
                                    <select
                                        onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                                        value={formData.frequency}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-nortex-accent transition-colors"
                                    >
                                        <option value="DAILY">Diario</option>
                                        <option value="WEEKLY">Semanal</option>
                                        <option value="BIWEEKLY">Quincenal</option>
                                        <option value="MONTHLY">Mensual</option>
                                    </select>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-nortex-accent hover:bg-emerald-400 text-slate-900 font-bold py-4 rounded-xl mt-6 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'PROCESANDO...' : 'DESEMBOLSAR CAPITAL'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Refinanciamiento */}
            {showRefiModal && refiLoan && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-purple-500/50 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-purple-500/30 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-purple-400">Refinanciar Crédito</h2>
                                <p className="text-sm text-slate-400 mt-1">{refiLoan.clientName} — Saldo: ${Number(refiLoan.balanceRemaining).toFixed(2)}</p>
                            </div>
                            <button onClick={() => { setShowRefiModal(false); setRefiLoan(null); }} className="text-slate-500 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleRefinance} className="p-6 space-y-4">
                            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-sm text-purple-300">
                                El saldo pendiente de <strong>${Number(refiLoan.balanceRemaining).toFixed(2)}</strong> se sumará automáticamente al nuevo capital.
                            </div>

                            <input
                                type="number"
                                placeholder="Capital Nuevo a Inyectar ($)"
                                required
                                value={refiData.newPrincipal}
                                onChange={(e) => setRefiData({ ...refiData, newPrincipal: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-purple-400 outline-none"
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <input
                                    type="number"
                                    placeholder="Tasa (%)"
                                    required
                                    value={refiData.interestRate}
                                    onChange={(e) => setRefiData({ ...refiData, interestRate: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-400"
                                />
                                <input
                                    type="number"
                                    placeholder="N° Cuotas"
                                    required
                                    value={refiData.installments}
                                    onChange={(e) => setRefiData({ ...refiData, installments: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-400"
                                />
                            </div>

                            <select
                                value={refiData.frequency}
                                onChange={(e) => setRefiData({ ...refiData, frequency: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-400"
                            >
                                <option value="DAILY">Diario</option>
                                <option value="WEEKLY">Semanal</option>
                                <option value="BIWEEKLY">Quincenal</option>
                                <option value="MONTHLY">Mensual</option>
                            </select>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-purple-500 hover:bg-purple-400 text-white font-bold py-4 rounded-xl mt-4 transition-all disabled:opacity-50"
                            >
                                {submitting ? 'PROCESANDO...' : `RENOVAR TARJETA (+$${refiData.newPrincipal || '0'})`}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Nuevo Motorizado */}
            {showMotoModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-orange-500/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-orange-500/30 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-orange-400">Reclutar Motorizado</h2>
                            <button onClick={() => setShowMotoModal(false)} className="text-slate-500 hover:text-white">✕</button>
                        </div>

                        <form onSubmit={handleCreateMoto} className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">Nombre del Cobrador (Alias/Moto)</label>
                                <input type="text" required placeholder="Ej: MOTO-01 o Carlos"
                                    value={motoData.name} onChange={(e) => setMotoData({ ...motoData, name: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-400 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">Correo de Acceso (Usuario)</label>
                                <input type="email" required placeholder="moto1@financiera.com"
                                    value={motoData.email} onChange={(e) => setMotoData({ ...motoData, email: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-400 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">Contraseña Temporal</label>
                                <input type="password" required placeholder="123456"
                                    value={motoData.password} onChange={(e) => setMotoData({ ...motoData, password: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-400 outline-none" />
                            </div>

                            <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded-lg mt-4">
                                <p className="text-xs text-orange-300">
                                    Al guardar, el motorizado tendrá acceso <strong>ÚNICAMENTE</strong> a la pantalla de cobranza de calle. No podrá ver la contabilidad ni el directorio de clientes.
                                </p>
                            </div>

                            <button type="submit" disabled={submitting} className="w-full bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 rounded-xl mt-4 transition-all disabled:opacity-50">
                                {submitting ? 'CREANDO...' : 'REGISTRAR COBRADOR'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Ingreso a Bóveda */}
            {showDepositModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-emerald-500/30 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-emerald-400">Ingresar a Bóveda</h2>
                                <p className="text-sm text-slate-400 mt-1">Recibiendo efectivo de: <span className="text-white font-bold">{depositData.motoName}</span></p>
                            </div>
                            <button onClick={() => setShowDepositModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleDeposit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto Físico Recibido ($)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    required
                                    value={depositData.amount}
                                    onChange={(e) => setDepositData({ ...depositData, amount: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-4 text-white font-mono text-2xl focus:border-emerald-400 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Notas / Concepto</label>
                                <input
                                    type="text"
                                    value={depositData.notes}
                                    onChange={(e) => setDepositData({ ...depositData, notes: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-emerald-400 outline-none"
                                    placeholder="Ej. Liquidación ruta martes"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-4 rounded-xl mt-2 transition-all disabled:opacity-50"
                            >
                                {submitting ? 'GUARDANDO EN BÓVEDA...' : 'CONFIRMAR INGRESO'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Penalidad / Multa */}
            {showPenaltyModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-red-500/50 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-red-500/30 flex justify-between items-center bg-red-500/10">
                            <div>
                                <h2 className="text-xl font-bold text-red-400">Penalizar Atraso</h2>
                                <p className="text-sm text-slate-300 mt-1">{penaltyData.clientName}</p>
                            </div>
                            <button onClick={() => setShowPenaltyModal(false)} className="text-red-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handlePenalty} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto de la Multa ($)</label>
                                <input
                                    type="number"
                                    step="1"
                                    required
                                    value={penaltyData.amount}
                                    onChange={(e) => setPenaltyData({ ...penaltyData, amount: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-red-400 outline-none font-mono"
                                    placeholder="Ej: 5.00"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Motivo</label>
                                <input
                                    type="text"
                                    required
                                    value={penaltyData.reason}
                                    onChange={(e) => setPenaltyData({ ...penaltyData, reason: e.target.value })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-red-400 outline-none text-sm"
                                />
                            </div>
                            <div className="bg-red-900/20 border border-red-500/20 p-3 rounded-lg text-xs text-red-200 mt-2">
                                <AlertTriangle size={14} className="inline mr-1 -mt-0.5" />
                                Esta acción sumará el monto al saldo deudor actual y no se puede deshacer de forma sencilla.
                            </div>
                            <button
                                type="submit"
                                disabled={submitting || !penaltyData.amount}
                                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl mt-2 transition-all disabled:opacity-50"
                            >
                                {submitting ? 'CARGANDO...' : 'CARGAR MULTA AL SALDO'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LenderDashboard;
