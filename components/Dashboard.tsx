import React, { useState, useEffect } from 'react';
import { MOCK_TENANT, MOCK_PRODUCTS } from '../constants';
import { TrendingUp, DollarSign, Activity, AlertCircle, CreditCard, PieChart, Banknote, X, Check, Clock, Lock, RefreshCw, ShoppingCart, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loan, Tenant } from '../types';
import { useNavigate } from 'react-router-dom';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  // State for Lending
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loadingLoan, setLoadingLoan] = useState(false);
  const [tenantData, setTenantData] = useState<Tenant>(MOCK_TENANT);
  const [activeLoans, setActiveLoans] = useState<Loan[]>([]);
  const [processingSub, setProcessingSub] = useState(false);
  const [refreshingScore, setRefreshingScore] = useState(false);
  const [scoreFactors, setScoreFactors] = useState<string[]>([]);

  // Real Chart Data
  const [chartData, setChartData] = useState<any[]>([]);

  // Smart Restock State
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);

  // FETCH REAL DATA
  useEffect(() => {
    const initDashboard = async () => {
      const token = localStorage.getItem('nortex_token');

      try {
        // 1. Get Dashboard Stats (Real Data)
        const res = await fetch('/api/dashboard/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setTenantData(data.tenant);
          setChartData(data.chartData);
          localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));
        }

        // 2. Refresh Credit Score (Algorithm)
        await refreshCreditScore();

        // 3. AI Prediction Simulation (Still simulated as we don't have stock history yet in DB fully populated)
        const critical = MOCK_PRODUCTS.filter(p => p.stock < 10);
        setLowStockItems(critical);

      } catch (e) {
        console.error("Dashboard Sync Failed", e);
      }
    };
    initDashboard();
  }, []);

  const refreshCreditScore = async () => {
    setRefreshingScore(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/fintech/score', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTenantData(data.tenant);
        localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));
        if (data.analysis && data.analysis.factors) {
          setScoreFactors(data.analysis.factors);
        }
      }
    } catch (e) {
      console.error("Failed to refresh score", e);
    } finally {
      setRefreshingScore(false);
    }
  };

  const activeDebt = activeLoans.reduce((acc, loan) => acc + Number(loan.totalDue), 0);

  // PAYWALL LOGIC
  const daysLeftInTrial = tenantData.trialEndsAt
    ? Math.ceil((new Date(tenantData.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  const handleReactivate = async () => {
    setProcessingSub(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ planId: 'PRO_MONTHLY' })
      });

      if (!res.ok) throw new Error('Falló el pago simulado');

      // Update Local State immediately
      const updatedTenant = {
        ...tenantData,
        subscriptionStatus: 'ACTIVE' as const,
        trialEndsAt: '' // Clear trial
      };
      setTenantData(updatedTenant);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant));

      alert("✅ ¡Cuenta Reactivada! El sistema está operativo.");

    } catch (e) {
      alert("Error al procesar la suscripción.");
    } finally {
      setProcessingSub(false);
    }
  };

  const handleRequestLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(loanAmount);

    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto válido");
      return;
    }

    if (amount > tenantData.creditLimit) {
      alert("El monto excede su línea de crédito disponible");
      return;
    }

    setLoadingLoan(true);

    try {
      const token = localStorage.getItem('nortex_token');
      // REAL API CALL
      const res = await fetch('/api/loans/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          alert("⛔ BLOQUEADO: Suscripción vencida. Pague para continuar.");
          return;
        }
        throw new Error(data.error);
      }

      // Optimistic Update
      const interest = amount * 0.05;
      const totalDue = amount + interest;

      const newLoan: Loan = {
        id: `loan_${Date.now()}`,
        amount,
        interest,
        totalDue,
        status: 'ACTIVE',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      };

      const updatedTenant = {
        ...tenantData,
        walletBalance: tenantData.walletBalance + amount,
        creditLimit: tenantData.creditLimit - amount
      };

      setTenantData(updatedTenant);
      setActiveLoans(prev => [newLoan, ...prev]);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant));

      setShowLoanModal(false);
      setLoanAmount('');
      alert("🚀 ¡Fondos desembolsados exitosamente!");

    } catch (error: any) {
      alert(error.message || "Error al procesar el préstamo");
    } finally {
      setLoadingLoan(false);
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 text-slate-800 relative">

      {/* BILLING BANNERS */}
      {tenantData.subscriptionStatus === 'TRIALING' && (
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3 text-yellow-700">
            <Clock size={20} />
            <span className="font-medium">
              Modo Prueba: Quedan <span className="font-bold">{daysLeftInTrial} días</span> gratis.
            </span>
          </div>
          <button onClick={handleReactivate} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-bold rounded shadow-sm transition-colors">
            ACTIVAR PLAN PRO
          </button>
        </div>
      )}

      {(tenantData.subscriptionStatus === 'PAST_DUE' || tenantData.subscriptionStatus === 'CANCELLED') && (
        <div className="mb-6 p-4 bg-red-600 text-white rounded-lg shadow-lg flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <Lock size={24} />
            <div>
              <h3 className="font-bold text-lg">SERVICIO SUSPENDIDO</h3>
              <p className="text-red-100 text-sm">No puedes registrar nuevas ventas ni solicitar préstamos.</p>
            </div>
          </div>
          <button
            onClick={handleReactivate}
            disabled={processingSub}
            className="px-6 py-3 bg-white text-red-600 font-bold rounded shadow-lg hover:bg-slate-100 transition-colors"
          >
            {processingSub ? 'PROCESANDO...' : 'REACTIVAR SERVICIO ($50)'}
          </button>
        </div>
      )}

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-nortex-900">Panel Financiero</h1>
        <div className="flex items-center gap-2 mt-2">
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold uppercase tracking-wider">{tenantData.type}</span>
          <span className="text-slate-500">{tenantData.name}</span>
          <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${tenantData.subscriptionStatus === 'ACTIVE' ? 'bg-green-100 text-green-700' :
              tenantData.subscriptionStatus === 'PAST_DUE' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
            }`}>
            {tenantData.subscriptionStatus}
          </span>
        </div>
      </header>

      {/* --- SMART RESTOCK AI WIDGET --- */}
      {lowStockItems.length > 0 && (
        <div className="mb-8 bg-nortex-900 rounded-xl p-6 shadow-xl border border-nortex-800 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-nortex-accent blur-[100px] opacity-10"></div>
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/20 text-red-400 rounded-lg animate-pulse">
                <AlertCircle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-1">Nortex AI: Alerta de Quiebre de Stock</h3>
                <p className="text-slate-400 text-sm max-w-xl">
                  Tus ventas proyectan que <span className="text-white font-bold">{lowStockItems[0].name}</span> se agotará en <span className="text-red-400 font-bold">48 horas</span>.
                  {lowStockItems.length > 1 && ` Además, otros ${lowStockItems.length - 1} productos están en nivel crítico.`}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/app/marketplace')}
              className="px-6 py-3 bg-white text-nortex-900 font-bold rounded-lg hover:bg-nortex-accent transition-colors flex items-center gap-2 shadow-lg"
            >
              <ShoppingCart size={18} /> Pedir Reabastecimiento <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">

        {/* Wallet Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Saldo en Billetera</p>
              <h3 className="text-2xl font-bold text-slate-900 transition-all duration-500">${tenantData.walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="p-2 bg-green-100 text-green-600 rounded-lg">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-xs text-green-600 font-medium flex items-center gap-1">
            <TrendingUp size={14} /> +12.5% vs mes anterior
          </div>
        </div>

        {/* Credit Score Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden group">
          <button
            onClick={refreshCreditScore}
            className={`absolute top-2 right-2 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 ${refreshingScore ? 'animate-spin' : ''}`}
            title="Recalcular Score"
          >
            <RefreshCw size={14} />
          </button>
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-10 rounded-bl-full"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Nortex Score</p>
              <h3 className="text-2xl font-bold text-blue-600">{tenantData.creditScore} <span className="text-sm text-slate-400 font-normal">/ 850</span></h3>
            </div>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Activity size={20} />
            </div>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-2">
            <div className="bg-blue-500 h-full rounded-full transition-all duration-1000" style={{ width: `${(tenantData.creditScore / 850) * 100}%` }}></div>
          </div>
          {scoreFactors.length > 0 ? (
            <p className="text-[10px] text-slate-500 truncate" title={scoreFactors.join(', ')}>
              Factores: {scoreFactors[0]} {scoreFactors.length > 1 && `+${scoreFactors.length - 1}`}
            </p>
          ) : (
            <p className="text-xs text-slate-400">Sin historial suficiente</p>
          )}
        </div>

        {/* Credit Line Card */}
        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-6 rounded-xl shadow-sm border border-nortex-800 ring-1 ring-white/10 relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-nortex-accent blur-[50px] opacity-20 group-hover:opacity-30 transition-opacity"></div>

          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-sm font-medium text-slate-400">Línea Disponible</p>
              <h3 className="text-2xl font-bold text-white">${tenantData.creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="p-2 bg-white/10 text-white rounded-lg">
              <CreditCard size={20} />
            </div>
          </div>
          <button
            onClick={() => setShowLoanModal(true)}
            disabled={tenantData.creditLimit <= 100 || tenantData.creditScore < 500}
            className="relative z-10 w-full py-2 bg-nortex-accent hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 text-nortex-900 text-sm font-bold rounded transition-colors flex items-center justify-center gap-2"
          >
            {tenantData.creditScore < 500 ? <Lock size={16} /> : <Banknote size={16} />}
            {tenantData.creditScore < 500 ? 'MEJORA TU SCORE' : 'SOLICITAR DESEMBOLSO'}
          </button>
        </div>

        {/* Active Debt Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Deuda Activa</p>
              <h3 className="text-2xl font-bold text-red-600">${activeDebt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="p-2 bg-red-100 text-red-600 rounded-lg">
              <AlertCircle size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {activeLoans.length > 0 ? `${activeLoans.length} préstamos activos` : 'Sin deudas pendientes'}
          </p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Flujo de Caja Real (Últimos 7 días)</h3>
          <div className="h-64 min-h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Préstamos Activos</h3>
          <div className="h-64 overflow-y-auto custom-scrollbar pr-2">
            {activeLoans.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <PieChart size={48} className="mb-2 opacity-20" />
                <p className="text-sm">No hay actividad reciente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeLoans.map(loan => (
                  <div key={loan.id} className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock size={10} /> Vence: {new Date(loan.dueDate).toLocaleDateString()}
                      </div>
                      <div className="font-bold text-slate-700">${loan.amount.toFixed(2)}</div>
                    </div>
                    <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">ACTIVE</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LENDING MODAL */}
      {showLoanModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="bg-nortex-900 p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-nortex-accent blur-[60px] opacity-20"></div>
              <button
                onClick={() => setShowLoanModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
              <h3 className="text-xl font-bold text-white flex items-center gap-2 relative z-10">
                <Banknote size={24} className="text-nortex-accent" /> Solicitar Capital
              </h3>
              <p className="text-slate-400 text-sm mt-1 relative z-10">Inyección de liquidez inmediata</p>
            </div>

            <form onSubmit={handleRequestLoan} className="p-6">
              <div className="mb-6">
                <label className="block text-xs font-mono text-slate-500 mb-2 font-bold">MONTO A SOLICITAR</label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    max={tenantData.creditLimit}
                    required
                    className="w-full pl-12 pr-4 py-4 text-3xl font-bold text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-nortex-500 focus:border-nortex-500 outline-none transition-all"
                    placeholder="0.00"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-slate-500">Disponible: <span className="font-bold text-slate-700">${tenantData.creditLimit.toFixed(2)}</span></span>
                  {Number(loanAmount) > tenantData.creditLimit && (
                    <span className="text-red-500 font-bold">Excede el límite</span>
                  )}
                </div>
              </div>

              {/* Loan Breakdown */}
              {Number(loanAmount) > 0 && Number(loanAmount) <= tenantData.creditLimit && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Capital</span>
                    <span className="font-medium text-slate-900">${Number(loanAmount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Interés (5% Flat)</span>
                    <span className="font-medium text-slate-900">${(Number(loanAmount) * 0.05).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Plazo</span>
                    <span className="font-medium text-slate-900">30 Días</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-center">
                    <span className="font-bold text-slate-700">Total a Pagar</span>
                    <span className="font-bold text-nortex-900 text-lg">${(Number(loanAmount) * 1.05).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loadingLoan || !loanAmount || Number(loanAmount) > tenantData.creditLimit}
                className="w-full py-4 bg-nortex-900 hover:bg-nortex-800 text-white font-bold rounded-xl shadow-lg shadow-nortex-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex justify-center items-center gap-2"
              >
                {loadingLoan ? 'PROCESANDO...' : (
                  <>
                    CONFIRMAR Y RECIBIR <Check size={20} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;