import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { DollarSign, TrendingUp, TrendingDown, Calendar, PieChart, ShieldCheck } from 'lucide-react';
import { Sale } from '../types';
import { MOCK_DEBTORS, MOCK_PRODUCTS } from '../constants'; // Using mocks for frontend demo

const Reports: React.FC = () => {
  const [metrics, setMetrics] = useState({
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    margin: 0
  });

  // Simulate Data Fetching
  useEffect(() => {
    // In real app: fetch('/api/reports/profit?start=...&end=...')
    // Simulating aggregation from Mock Data
    // We'll create some fake historical sales based on MOCK_PRODUCTS
    const simulatedSales = Array.from({ length: 50 }).map((_, i) => {
      const product = MOCK_PRODUCTS[Math.floor(Math.random() * MOCK_PRODUCTS.length)];
      const qty = Math.floor(Math.random() * 5) + 1;
      return {
        id: `s_${i}`,
        revenue: product.price * qty,
        cost: product.costPrice * qty,
        date: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
      };
    });

    const revenue = simulatedSales.reduce((acc, s) => acc + s.revenue, 0);
    const cogs = simulatedSales.reduce((acc, s) => acc + s.cost, 0);
    const grossProfit = revenue - cogs;
    const margin = (grossProfit / revenue) * 100;

    setMetrics({ revenue, cogs, grossProfit, margin });
  }, []);

  // Mock Chart Data
  const chartData = [
    { name: 'Sem 1', ventas: 4000, costo: 2800, utilidad: 1200 },
    { name: 'Sem 2', ventas: 3000, costo: 2100, utilidad: 900 },
    { name: 'Sem 3', ventas: 5000, costo: 3200, utilidad: 1800 },
    { name: 'Sem 4', ventas: 4500, costo: 2900, utilidad: 1600 },
  ];

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-nortex-900 flex items-center gap-2">
           <ShieldCheck className="text-nortex-500" /> Inteligencia Financiera
        </h1>
        <p className="text-slate-500">Reporte de Utilidad Real (Revenue - COGS)</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <div className="text-xs font-mono text-slate-500 mb-1">VENTAS TOTALES (REVENUE)</div>
           <div className="text-2xl font-bold text-slate-800">${metrics.revenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <div className="text-xs font-mono text-slate-500 mb-1">COSTO MERCADERÍA (COGS)</div>
           <div className="text-2xl font-bold text-red-500">-${metrics.cogs.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
           <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full"></div>
           <div className="text-xs font-mono text-slate-500 mb-1">UTILIDAD BRUTA REAL</div>
           <div className="text-2xl font-bold text-emerald-600">${metrics.grossProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
        </div>
        <div className="bg-nortex-900 text-white p-6 rounded-xl shadow-lg">
           <div className="text-xs font-mono text-slate-400 mb-1">MARGEN DE GANANCIA</div>
           <div className="text-3xl font-bold text-nortex-accent">{metrics.margin.toFixed(1)}%</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <h3 className="font-bold text-slate-800 mb-6">Tendencia de Rentabilidad</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={chartData}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                 <XAxis dataKey="name" axisLine={false} tickLine={false} />
                 <YAxis axisLine={false} tickLine={false} />
                 <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}} />
                 <Legend />
                 <Bar dataKey="ventas" fill="#94a3b8" name="Ventas" radius={[4, 4, 0, 0]} />
                 <Bar dataKey="costo" fill="#ef4444" name="Costo" radius={[4, 4, 0, 0]} />
                 <Bar dataKey="utilidad" fill="#10b981" name="Utilidad Neta" radius={[4, 4, 0, 0]} />
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center items-center text-center">
           <div className="w-48 h-48 rounded-full border-[16px] border-slate-100 flex items-center justify-center relative mb-4">
              <div className="absolute inset-0 rounded-full border-[16px] border-nortex-accent border-t-transparent rotate-45"></div>
              <div>
                  <div className="text-3xl font-bold text-slate-800">OK</div>
                  <div className="text-xs text-slate-400">Salud Financiera</div>
              </div>
           </div>
           <p className="text-sm text-slate-500 max-w-xs">
              Tu margen del <span className="font-bold text-slate-800">{metrics.margin.toFixed(1)}%</span> es saludable para el sector Ferretería (Promedio: 25-30%).
           </p>
        </div>
      </div>
    </div>
  );
};

export default Reports;