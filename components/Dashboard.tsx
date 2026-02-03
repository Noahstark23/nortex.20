import React, { useEffect, useState } from 'react';
import { TrendingUp, DollarSign, Activity, AlertCircle, CreditCard, PieChart, Info, ArrowUpRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Pie, PieChart as RechartsPie } from 'recharts';

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        
        // 1. Fetch Session for Name
        const sessionRes = await fetch('http://localhost:3000/api/session', {
            headers: { 'x-tenant-id': tenantId || '' }
        });
        if(sessionRes.ok) {
            const sess = await sessionRes.json();
            setTenantName(sess.tenant.name);
        }

        // 2. Fetch Real Analytics
        const analyticsRes = await fetch('http://localhost:3000/api/analytics/score', {
            headers: { 'x-tenant-id': tenantId || '' }
        });
        
        if (analyticsRes.ok) {
            const analysis = await analyticsRes.json();
            setData(analysis);
        }
      } catch (e) {
        console.error("Error fetching dashboard", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div className="p-6 text-white">Cargando datos financieros...</div>;
  if (!data) return <div className="p-6 text-white">Error cargando datos.</div>;

  // Gauge Chart Data
  const gaugeData = [
    { name: 'Score', value: data.score - 300 }, // Normalizar base 300
    { name: 'Rest', value: 850 - data.score }
  ];
  const COLORS = ['#10b981', '#1e293b']; // Green vs Slate-800

  // Mock graph data for bar chart (would come from API in Phase 5)
  const chartData = [
    { name: 'Activos', val: data.financials.inventoryValue },
    { name: 'Caja', val: data.financials.walletBalance },
    { name: 'Ventas 30d', val: data.financials.monthlySales },
  ];

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 text-slate-800">
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        {/* Wallet Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Saldo en Billetera</p>
              <h3 className="text-2xl font-bold text-slate-900">${data.financials.walletBalance.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-green-100 text-green-600 rounded-lg">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-xs text-green-600 font-medium flex items-center gap-1">
            <ArrowUpRight size={14} /> Líquido disponible
          </div>
        </div>

        {/* Credit Score Card (Main) */}
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
                    <Pie
                    data={gaugeData}
                    cx="50%"
                    cy="100%"
                    startAngle={180}
                    endAngle={0}
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={0}
                    dataKey="value"
                    stroke="none"
                    >
                    {gaugeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                    </Pie>
                </RechartsPie>
             </ResponsiveContainer>
             <div className="absolute bottom-0 left-0 right-0 text-center text-xs text-slate-400 font-mono">
                300 - 850
             </div>
          </div>
        </div>

        {/* Credit Line Card */}
        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-6 rounded-xl shadow-sm border border-nortex-800 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium text-slate-400">Línea Pre-Aprobada</p>
                <CreditCard size={20} className="text-nortex-accent" />
            </div>
            <h3 className="text-3xl font-bold text-white tracking-tight">${data.maxLoanAmount.toLocaleString()}</h3>
            <p className="text-[10px] text-slate-400 mt-1">Calculado s/flujo de caja</p>
          </div>
          <button className="w-full py-2 bg-nortex-accent hover:bg-emerald-400 text-nortex-900 text-sm font-bold rounded transition-colors mt-4">
            SOLICITAR AHORA
          </button>
        </div>

        {/* Risk / Inventory */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Valor Inventario</p>
              <h3 className="text-2xl font-bold text-slate-900">${data.financials.inventoryValue.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <PieChart size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500">Respaldo en activos tangibles.</p>
        </div>
      </div>

      {/* Lower Section: Charts & Tips */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Financial Composition */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Composición Financiera</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                />
                <Bar dataKey="val" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CFO Tips - Dynamic AI Feedback */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Info size={18} className="text-nortex-500" />
            Consejos del CFO
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
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
             
             <div className="mt-4 p-4 bg-slate-900 rounded-lg text-white">
                <h4 className="font-bold text-xs text-nortex-accent mb-1">¿CÓMO MEJORAR?</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                   Nortex premia la constancia. Registra todas tus ventas (incluso las pequeñas) para reducir la volatilidad y aumentar tu Score.
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;