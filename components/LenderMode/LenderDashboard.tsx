import React, { useState, useEffect } from 'react';
import { DollarSign, Activity, AlertTriangle, Plus, Users, Wallet, X, Banknote } from 'lucide-react';

const LenderDashboard: React.FC = () => {
    const [loans, setLoans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
    const [routeExpenses, setRouteExpenses] = useState<any[]>([]);
    const [showRefiModal, setShowRefiModal] = useState(false);
    const [refiLoan, setRefiLoan] = useState<any>(null);
    const [refiData, setRefiData] = useState({ newPrincipal: '', interestRate: '', installments: '', frequency: 'DAILY', type: 'INFORMAL_FLAT' });
    const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'CLIENTS' | 'REPORTS'>('DASHBOARD');
    const [clientSearch, setClientSearch] = useState('');
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
    }, []);

    const fetchPortfolio = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans`, {
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
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans`, {
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
            }
        } catch (error) {
            console.error("Error originando crédito", error);
        } finally {
            setSubmitting(false);
        }
    };

    const fetchRouteExpenses = async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans/route-expenses`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nortex_token')}` }
            });
            const data = await response.json();
            if (data.success) setRouteExpenses(data.data);
        } catch (error) {
            console.error('Error cargando gastos de ruta:', error);
        }
    };

    const handleRefinance = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!refiLoan) return;
        setSubmitting(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans/${refiLoan.id}/refinance`, {
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
                <button onClick={() => setActiveTab('REPORTS')} className={`pb-4 font-bold text-sm transition-all border-b-2 ${activeTab === 'REPORTS' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>REPORTES Y RENDIMIENTO</button>
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
                                    <th className="p-4 font-medium text-right">Prestado</th>
                                    <th className="p-4 font-medium text-right">Cuota</th>
                                    <th className="p-4 font-medium text-right">Saldo Deudor</th>
                                    <th className="p-4 font-medium text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-slate-500 animate-pulse">Cargando bóveda...</td></tr>
                                ) : loans.length === 0 ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-slate-500">No hay capital en la calle.</td></tr>
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

                                                                    {/* Botón de Refinanciamiento */}
                                                                    <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between items-center">
                                                                        <div className="text-sm text-slate-400">
                                                                            Saldo actual: <span className="font-bold text-white">${Number(loan.balanceRemaining).toFixed(2)}</span>
                                                                        </div>
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
                                                                            REFINANCIAR / RENOVAR
                                                                        </button>
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

            {/* TAB: Directorio de Clientes */}
            {activeTab === 'CLIENTS' && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Users size={20} /> Cartera Histórica de Clientes</h3>
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 outline-none"
                        />
                    </div>
                    <div className="p-0">
                        {Array.from(new Set(loans.map(l => l.clientName)))
                            .filter(name => name.toLowerCase().includes(clientSearch.toLowerCase()))
                            .map(clientName => {
                                const clientLoans = loans.filter(l => l.clientName === clientName);
                                const totalDebt = clientLoans.reduce((acc, l) => acc + Number(l.balanceRemaining), 0);
                                const isMoroso = clientLoans.some(l => l.status === 'ACTIVE' && new Date(l.dueDate) < new Date());

                                return (
                                    <div key={clientName} className="border-b border-slate-700/50 p-6 hover:bg-slate-700/20 transition-colors">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="text-xl font-bold text-white flex items-center gap-2">
                                                    {clientName}
                                                    {isMoroso && <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded-full font-bold">MOROSO</span>}
                                                </h4>
                                                <p className="text-sm text-slate-400 mt-1">Créditos Históricos: {clientLoans.length}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm text-slate-400">Deuda Global Actual</p>
                                                <p className="text-2xl font-mono font-bold text-nortex-accent">${totalDebt.toFixed(2)}</p>
                                            </div>
                                        </div>

                                        <div className="bg-slate-900/50 rounded-lg p-4">
                                            <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Expediente de Créditos</h5>
                                            <div className="space-y-2">
                                                {clientLoans.map(loan => (
                                                    <div key={loan.id} className="flex justify-between items-center text-sm border-l-2 border-slate-600 pl-3 py-1">
                                                        <span className="text-slate-300 font-mono text-xs">{new Date(loan.createdAt).toLocaleDateString()}</span>
                                                        <span className="text-slate-400">{loan.type === 'INFORMAL_FLAT' ? 'Gota a Gota' : 'Financiera'}</span>
                                                        <span className="text-slate-300">Prestó: ${Number(loan.principalAmount).toFixed(2)}</span>
                                                        <span className={`font-bold ${loan.status === 'PAID_OFF' ? 'text-blue-400' : 'text-orange-400'}`}>{loan.status}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        {loans.length === 0 && <p className="p-8 text-center text-slate-500">No hay clientes en el directorio aún.</p>}
                    </div>
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
        </div>
    );
};

export default LenderDashboard;
