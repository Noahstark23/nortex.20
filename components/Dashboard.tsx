import React from 'react';
import { MOCK_TENANT } from '../constants';
import { TrendingUp, DollarSign, Activity, AlertCircle, CreditCard, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const data = [
  { name: 'Lun', sales: 4000, risk: 240 },
  { name: 'Mar', sales: 3000, risk: 139 },
  { name: 'Mie', sales: 2000, risk: 980 },
  { name: 'Jue', sales: 2780, risk: 390 },
  { name: 'Vie', sales: 1890, risk: 480 },
  { name: 'Sab', sales: 2390, risk: 380 },
  { name: 'Dom', sales: 3490, risk: 430 },
];

const Dashboard: React.FC = () => {
  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 text-slate-800">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-nortex-900">Panel Financiero</h1>
        <div className="flex items-center gap-2 mt-2">
           <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold uppercase tracking-wider">{MOCK_TENANT.type}</span>
           <span className="text-slate-500">{MOCK_TENANT.name}</span>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        {/* Wallet Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Saldo en Billetera</p>
              <h3 className="text-2xl font-bold text-slate-900">${MOCK_TENANT.walletBalance.toLocaleString()}</h3>
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
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-10 rounded-bl-full"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Nortex Score</p>
              <h3 className="text-2xl font-bold text-blue-600">{MOCK_TENANT.creditScore} <span className="text-sm text-slate-400 font-normal">/ 1000</span></h3>
            </div>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Activity size={20} />
            </div>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div className="bg-blue-500 h-full rounded-full" style={{ width: `${MOCK_TENANT.creditScore / 10}%` }}></div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Excelente capacidad de pago</p>
        </div>

        {/* Credit Line Card */}
        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-6 rounded-xl shadow-sm border border-nortex-800">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-400">Línea Pre-Aprobada</p>
              <h3 className="text-2xl font-bold text-white">${MOCK_TENANT.creditLimit.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-white/10 text-white rounded-lg">
              <CreditCard size={20} />
            </div>
          </div>
          <button className="w-full py-2 bg-nortex-accent hover:bg-emerald-400 text-nortex-900 text-sm font-bold rounded transition-colors">
            SOLICITAR DESEMBOLSO
          </button>
        </div>

        {/* Risk Alert Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Riesgo Calculado</p>
              <h3 className="text-2xl font-bold text-slate-900">Bajo</h3>
            </div>
            <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
              <AlertCircle size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500">Basado en flujo de caja de los últimos 30 días.</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Flujo de Caja Real</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                />
                <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Categorías</h3>
          <div className="h-64 flex items-center justify-center">
             <div className="text-center">
                <PieChart size={48} className="text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Visualización disponible con más data</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;