import React, { useEffect, useState } from 'react';
import { TrendingUp, DollarSign, Activity, AlertCircle, CreditCard, PieChart, Info, ArrowUpRight, ShieldCheck, Calendar, X, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Pie, PieChart as RechartsPie } from 'recharts';
import { Loan } from '../types';

interface AnalysisData {
  score: number;
  metrics: {
    liquidity: number;
    consistency: number;
    assets: number;
  };
  financials: {
    walletBalance: number;
    inventoryValue: number;
    monthlySales: number;
  };
  maxLoanAmount: number;
  tips: string[];
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState('');
  
  // Lending State
  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
  const [loanAmount, setLoanAmount] = useState<string>('');
  const [activeLoans, setActiveLoans] = useState<Loan[]>([]);
  const [loanProcessing, setLoanProcessing] = useState(false);

  // Fetch Data Function
  const fetchData = async () => {
    try {
      const tenantId = localStorage.getItem('nortex_tenant_id');
      
      // 1. Fetch Session & Analytics
      const [sessionRes, analyticsRes, loansRes] = await Promise.all([
          fetch('http://localhost:3000/api/session', { headers: { 'x-tenant-id': tenantId || '' } }),
          fetch('http://localhost:3000/api/analytics/score', { headers: { 'x-tenant-id': tenantId || '' } }),
          fetch('http://localhost:3000/api/loans', { headers: { 'x-tenant-id': tenantId || '' } })
      ]);

      if(sessionRes.ok) {
          const sess = await sessionRes.json();
          setTenantName(sess.tenant.name);
      }

      if (analyticsRes.ok) {
          const analysis = await analyticsRes.json();
          setData(analysis);
          // Set default loan amount to max available
          if (analysis.maxLoanAmount > 0) setLoanAmount(analysis.maxLoanAmount.toString());
      }

      if (loansRes.ok) {
          const loansData = await loansRes.json();
          setActiveLoans(loansData);
      }

    } catch (e) {
      console.error("Error fetching dashboard", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRequestLoan = async () => {
    if (!loanAmount || parseFloat(loanAmount) <= 0) return;
    setLoanProcessing(true);

    try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        const res = await fetch('http://localhost:3000/api/loans/request', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId || ''
            },
            body: JSON.stringify({ amount: parseFloat(loanAmount) })
        });

        const result = await res.json();
        
        if (res.ok) {
            alert('¡Desembolso Exitoso! Los fondos están en tu billetera.');
            setIsLoanModalOpen(false);
            fetchData(); // Refresh data to show new balance and debt
        } else {
            alert(result.error || 'Error solicitando préstamo');
        }
    } catch (e) {
        alert('Error de conexión');
    } finally {
        setLoanProcessing(false);
    }
  };

  if (loading) return <div className="p-6 text-white">Cargando datos financieros...</div>;
  if (!data) return <div className="p-6 text-white">Error cargando datos.</div>;

  // Chart Config
  const gaugeData = [
    { name: 'Score', value: Math.max(0, data.score - 300) },
    { name: 'Rest', value: 850 - data.score }
  ];
  const COLORS = ['#10b981', '#1e293b']; 
  const chartData = [
    { name: 'Activos', val: data.financials.inventoryValue },
    { name: 'Caja', val: data.financials.walletBalance },
    { name: 'Ventas 30d', val: data.financials.monthlySales },
  ];

  // Calculations for Modal
  const requestAmt = parseFloat(loanAmount) || 0;
  const interestFee = requestAmt * 0.05;
  const totalRepay = requestAmt + interestFee;

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 text-slate-800 relative">
      
      {/* HEADER */}
      <header className="mb-8 flex justify-between items-end">
        <div>
            <h1 className="text-3xl font-bold text-nortex-900">Panel Financiero</h1>
            <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold uppercase tracking-wider">LIVE DATA</span>
            <span className="text-slate-500">{tenantName}</span>
            </div>
        </div>
        <div className="text-right hidden md:block">
            <p className="text-xs text-slate-400">Última actualización</p>
            <p className="text-sm font-mono font-bold text-slate-600">{new Date().toLocaleTimeString()}</p>
        </div>
      </header>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Wallet */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Saldo en Billetera</p>
              <h3 className="text-2xl font-bold text-slate-900">${data.financials.walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="p-2 bg-green-100 text-green-600 rounded-lg">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-xs text-green-600 font-medium flex items-center gap-1">
            <ArrowUpRight size={14} /> Líquido disponible
          </div>
        </div>

        {/* Score Gauge */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start z-10">
            <div>
              <p className="text-sm font-medium text-slate-500">Nortex Score</p>
              <h3 className={`text-3xl font-bold ${data.score > 700 ? 'text-emerald-600' : 'text-yellow-600'}`}>
                {data.score}
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${data.score > 700 ? 'bg-emerald-100 text-emerald-600' : 'bg-yellow-100 text-yellow-600'}`}>
              <Activity size={20} />
            </div>
          </div>
          <div className="h-16 w-full mt-2 relative">
             <ResponsiveContainer width="100%" height="100%">
                <RechartsPie>
                    <Pie data={gaugeData} cx="50%" cy="100%" startAngle={180} endAngle={0} innerRadius={40} outerRadius={60} paddingAngle={0} dataKey="value" stroke="none">
                    {gaugeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                    </Pie>
                </RechartsPie>
             </ResponsiveContainer>
             <div className="absolute bottom-0 left-0 right-0 text-center text-xs text-slate-400 font-mono">300 - 850</div>
          </div>
        </div>

        {/* Credit Line CTA */}
        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-6 rounded-xl shadow-sm border border-nortex-800 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
              <ShieldCheck size={80} />
          </div>
          <div>
            <div className="flex justify-between items-start mb-2 relative z-10">
                <p className="text-sm font-medium text-slate-400">Línea Pre-Aprobada</p>
                <CreditCard size={20} className="text-nortex-accent" />
            </div>
            <h3 className="text-3xl font-bold text-white tracking-tight relative z-10">${data.maxLoanAmount.toLocaleString()}</h3>
          </div>
          <button 
            onClick={() => setIsLoanModalOpen(true)}
            disabled={data.maxLoanAmount <= 0}
            className="w-full py-2 bg-nortex-accent hover:bg-emerald-400 text-nortex-900 text-sm font-bold rounded transition-colors mt-4 relative z-10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {data.maxLoanAmount > 0 ? 'SOLICITAR DESEMBOLSO' : 'NO ELEGIBLE'}
          </button>
        </div>

        {/* Inventory Value */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Valor Inventario</p>
              <h3 className="text-2xl font-bold text-slate-900">${data.financials.inventoryValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</h3>
            </div>
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <PieChart size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500">Respaldo en activos tangibles.</p>
        </div>
      </div>

      {/* LOWER SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* ACTIVE DEBT SECTION */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 lg:col-span-2">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                <TrendingUp size={20} className="text-slate-400" />
                Deuda Activa & Historial
            </h3>
            {activeLoans.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                    <ShieldCheck size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">No tienes deuda activa.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium">
                            <tr>
                                <th className="p-3 rounded-l-lg">Fecha</th>
                                <th className="p-3">Monto</th>
                                <th className="p-3">Interés</th>
                                <th className="p-3">Total a Pagar</th>
                                <th className="p-3">Vencimiento</th>
                                <th className="p-3 rounded-r-lg">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {activeLoans.map(loan => (
                                <tr key={loan.id} className="hover:bg-slate-50">
                                    <td className="p-3 font-mono text-slate-600">{new Date(loan.createdAt).toLocaleDateString()}</td>
                                    <td className="p-3 font-bold text-slate-800">${parseFloat(loan.amount.toString()).toFixed(2)}</td>
                                    <td className="p-3 text-slate-600">${parseFloat(loan.interest.toString()).toFixed(2)}</td>
                                    <td className="p-3 font-bold text-red-600">${parseFloat(loan.totalDue.toString()).toFixed(2)}</td>
                                    <td className="p-3 text-slate-600 flex items-center gap-1">
                                        <Calendar size={14} />
                                        {new Date(loan.dueDate).toLocaleDateString()}
                                    </td>
                                    <td className="p-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            loan.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 
                                            loan.status === 'PAID' ? 'bg-slate-100 text-slate-600' : 'bg-red-100 text-red-700'
                                        }`}>
                                            {loan.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>

        {/* CFO Tips */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Info size={18} className="text-nortex-500" />
            Consejos del CFO
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar max-h-[300px]">
             {data.tips.length > 0 ? (
                 data.tips.map((tip, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border-l-4 border-nortex-500 text-sm text-slate-600 rounded-r-lg">
                        {tip}
                    </div>
                 ))
             ) : (
                 <div className="p-3 bg-green-50 border-l-4 border-green-500 text-sm text-green-700 rounded-r-lg">
                     Todo parece estar en orden. Sigue vendiendo para aumentar tu línea de crédito.
                 </div>
             )}
          </div>
        </div>
      </div>

      {/* LOAN REQUEST MODAL */}
      {isLoanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 bg-nortex-900 text-white flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <CreditCard className="text-nortex-accent" />
                            Solicitar Capital
                        </h2>
                        <p className="text-slate-400 text-sm mt-1">Línea disponible: <span className="text-white font-mono">${data.maxLoanAmount.toLocaleString()}</span></p>
                    </div>
                    <button onClick={() => setIsLoanModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6">
                    <div className="mb-6">
                        <label className="block text-sm font-bold text-slate-700 mb-2">Monto a Solicitar</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                            <input 
                                type="number" 
                                className="w-full pl-8 pr-4 py-3 text-2xl font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-nortex-500"
                                value={loanAmount}
                                onChange={e => setLoanAmount(e.target.value)}
                                max={data.maxLoanAmount}
                            />
                        </div>
                        {requestAmt > data.maxLoanAmount && (
                            <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1">
                                <AlertCircle size={12} />
                                Excede tu límite disponible
                            </p>
                        )}
                    </div>

                    <div className="bg-slate-50 p-4 rounded-xl space-y-3 mb-6 border border-slate-100">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Recibes hoy:</span>
                            <span className="font-bold text-slate-900">${requestAmt.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Comisión Flat (5%):</span>
                            <span className="font-bold text-slate-900">${interestFee.toFixed(2)}</span>
                        </div>
                        <div className="h-px bg-slate-200 my-2"></div>
                        <div className="flex justify-between text-base font-bold">
                            <span className="text-slate-700">Total a Pagar (30 días):</span>
                            <span className="text-red-600">${totalRepay.toFixed(2)}</span>
                        </div>
                    </div>

                    <button 
                        onClick={handleRequestLoan}
                        disabled={loanProcessing || requestAmt <= 0 || requestAmt > data.maxLoanAmount}
                        className="w-full py-4 bg-nortex-accent text-nortex-900 font-bold rounded-xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loanProcessing ? 'Procesando...' : 'ACEPTAR Y RECIBIR FONDOS'}
                        <ArrowRight size={20} />
                    </button>
                    <p className="text-[10px] text-center text-slate-400 mt-4 px-4">
                        Al hacer click, aceptas los términos de Nortex Financial Services. El incumplimiento afectará tu Credit Score.
                    </p>
                </div>
            </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;