import React, { useState, useEffect } from 'react';
import { DollarSign, Activity, AlertTriangle, Plus, Users, Wallet, X } from 'lucide-react';

const LenderDashboard: React.FC = () => {
    const [loans, setLoans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
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

    // Cálculos financieros en tiempo real
    const totalDeployed = loans.reduce((acc, loan) => acc + Number(loan.principalAmount), 0);
    const expectedReturn = loans.reduce((acc, loan) => acc + Number(loan.totalToRepay), 0);
    const totalCollected = loans.reduce((acc, loan) => acc + (Number(loan.totalToRepay) - Number(loan.balanceRemaining)), 0);
    const activeClients = loans.filter(l => l.status === 'ACTIVE').length;

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

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
                                    <tr key={loan.id} className="hover:bg-slate-700/30 transition-colors">
                                        <td className="p-4 font-medium text-white">{loan.clientName}</td>
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
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

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
        </div>
    );
};

export default LenderDashboard;
