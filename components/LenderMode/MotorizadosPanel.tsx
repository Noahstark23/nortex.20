import React, { useState, useEffect } from 'react';
import { Banknote, Save, AlertCircle, CheckCircle2, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const MotorizadosPanel: React.FC = () => {
    const [loans, setLoans] = useState<any[]>([]);
    const [selectedLoan, setSelectedLoan] = useState<string | null>(null);
    const [amount, setAmount] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();

    // 1. CARGAR CARTERA REAL DEL BACKEND
    useEffect(() => {
        fetchLoans();
    }, []);

    const fetchLoans = async () => {
        try {
            const token = localStorage.getItem('nortex_token');
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success) {
                // Filtramos solo los préstamos activos
                setLoans(data.data.filter((l: any) => l.status === 'ACTIVE'));
            }
        } catch (error) {
            console.error("Error al cargar la ruta de cobro", error);
        }
    };

    // 2. REGISTRAR COBRO REAL EN LA BÓVEDA
    const handleCobro = async () => {
        if (!selectedLoan || !amount) return;
        setLoading(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const userStr = localStorage.getItem('nortex_user');
            const collectorName = userStr ? JSON.parse(userStr).name : 'MOTO-01';

            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/loans/${selectedLoan}/repayments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    amountPaid: parseFloat(amount),
                    collectedBy: collectorName,
                    notes: 'Cobro de ruta diario'
                })
            });

            const data = await response.json();

            if (data.success) {
                setSuccess(true);
                setAmount('');
                fetchLoans(); // Recargar los saldos actualizados
                setTimeout(() => setSuccess(false), 8000);
            }
        } catch (error) {
            console.error("Error al procesar el pago", error);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('nortex_token');
        localStorage.removeItem('nortex_user');
        localStorage.removeItem('nortex_tenant_id');
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-4 font-sans border-t-4 border-nortex-accent relative">
            <header className="mb-6 border-b border-slate-800 pb-4 flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold text-nortex-accent flex items-center gap-2">
                        <Banknote size={28} />
                        Ruta de Cobro
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Cobrador: {localStorage.getItem('nortex_user') ? JSON.parse(localStorage.getItem('nortex_user')!).name : 'MOTO-01'} (Activo)
                    </p>
                </div>
                <button
                    onClick={handleLogout}
                    className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-colors"
                    title="Cerrar sesión"
                >
                    <LogOut size={20} />
                </button>
            </header>

            {success && (
                <div className="bg-emerald-500/10 border border-emerald-500 p-6 rounded-xl mb-6 flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3 text-emerald-400">
                        <CheckCircle2 size={32} className="animate-bounce" />
                        <span className="text-xl font-bold">¡Billete a la Bóveda!</span>
                    </div>

                    {/* Botón Mágico de WhatsApp */}
                    <button
                        onClick={() => {
                            const clientName = loans.find(l => l.id === selectedLoan)?.clientName || 'Cliente';
                            const userName = JSON.parse(localStorage.getItem('nortex_user') || '{}').name || 'Tu Cobrador';
                            const text = `*NORTEX CAPITAL* 🏦\n\nHola *${clientName}* 👋,\nConfirmamos la recepción de tu pago.\n\n💰 *Monto:* $${parseFloat(amount || '0').toFixed(2)}\n👤 *Cobrador:* ${userName}\n📅 *Fecha:* ${new Date().toLocaleString()}\n\n_Gracias por tu puntualidad. Tu saldo ha sido actualizado._`;
                            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                        }}
                        className="w-full py-4 bg-[#25D366] hover:bg-[#1ebe57] text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-[#25D366]/20 transition-all active:scale-95"
                    >
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
                        ENVIAR RECIBO (WHATSAPP)
                    </button>
                </div>
            )}

            <div className="space-y-6">
                {/* Paso 1: Seleccionar Cliente */}
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">1. Seleccionar Cliente ({loans.length})</label>
                    <div className="grid gap-3">
                        {loans.length === 0 && !loading && (
                            <div className="text-slate-500 text-center py-8 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                                <p>No hay préstamos activos en tu ruta.</p>
                            </div>
                        )}
                        {loans.map((loan) => (
                            <button
                                key={loan.id}
                                onClick={() => setSelectedLoan(loan.id)}
                                className={`p-4 rounded-xl border text-left transition-all ${selectedLoan === loan.id
                                    ? 'bg-nortex-800 border-nortex-accent shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                                    : 'bg-slate-800 border-slate-700 opacity-70'
                                    }`}
                            >
                                <h3 className="text-lg font-bold text-white uppercase">{loan.clientName}</h3>
                                <div className="flex justify-between mt-2 text-sm">
                                    <span className="text-slate-400">Saldo: ${Number(loan.balanceRemaining).toFixed(2)}</span>
                                    <span className="text-nortex-accent font-mono font-bold">Cuota: ${Number(loan.installmentAmount).toFixed(2)}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Paso 2: Ingresar Monto */}
                <div className={!selectedLoan ? 'opacity-30 pointer-events-none' : ''}>
                    <label className="block text-sm font-medium text-slate-400 mb-2">2. Efectivo Recibido</label>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-slate-500">$</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-3xl font-bold text-white focus:outline-none focus:border-nortex-accent"
                        />
                    </div>
                </div>

                {/* Action Button */}
                <button
                    onClick={handleCobro}
                    disabled={!selectedLoan || !amount || loading}
                    className={`w-full py-5 rounded-xl font-bold text-xl flex justify-center items-center gap-2 transition-all shadow-lg active:scale-95 ${!selectedLoan || !amount
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-nortex-accent text-slate-900 hover:bg-emerald-400 shadow-emerald-500/20'
                        }`}
                >
                    {loading ? (
                        <span className="animate-pulse">PROCESANDO...</span>
                    ) : (
                        <>
                            <Save size={24} />
                            REGISTRAR COBRO
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default MotorizadosPanel;
