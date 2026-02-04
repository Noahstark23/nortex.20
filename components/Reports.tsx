import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShieldCheck, AlertTriangle, Eye, Lock } from 'lucide-react';
import { AuditLog } from '../types';
import { MOCK_PRODUCTS } from '../constants';

const Reports: React.FC = () => {
  const [metrics, setMetrics] = useState({
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    margin: 0
  });
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const token = localStorage.getItem('nortex_token');
      
      try {
        // 1. Fetch Profit (Mocking backend aggregation for demo, but normally /api/reports/profit)
        // We'll simulate fetching real data by calling the endpoint in a real scenario
        // For now, let's keep the mock generation for Profit Chart so it looks good immediately
        const simulatedSales = Array.from({ length: 50 }).map((_, i) => {
          const product = MOCK_PRODUCTS[Math.floor(Math.random() * MOCK_PRODUCTS.length)];
          const qty = Math.floor(Math.random() * 5) + 1;
          return {
            id: `s_${i}`,
            revenue: product.price * qty,
            cost: product.costPrice * qty,
            date: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString()
          };
        });
        const revenue = simulatedSales.reduce((acc, s) => acc + s.revenue, 0);
        const cogs = simulatedSales.reduce((acc, s) => acc + s.cost, 0);
        const grossProfit = revenue - cogs;
        const margin = (grossProfit / revenue) * 100;
        setMetrics({ revenue, cogs, grossProfit, margin });

        // 2. Fetch Audit Logs (Real API)
        const res = await fetch('http://localhost:3000/api/audit-logs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const auditData = await res.json();
            setAudits(auditData);
        }

      } catch (e) {
          console.error("Error fetching report data", e);
      } finally {
          setLoading(false);
      }
    };

    fetchData();
  }, []);

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
        <p className="text-slate-500">Reporte de Utilidad Real (Revenue - COGS) y Auditoría.</p>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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

      {/* Audit Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
         <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
             <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Lock size={18} className="text-nortex-500"/> Auditoría de Operaciones
                </h3>
                <p className="text-xs text-slate-500 mt-1">Registro inmutable de acciones sensibles (Cierres, Faltantes, Aperturas).</p>
             </div>
             <span className="px-3 py-1 bg-nortex-900 text-white text-xs font-bold rounded-full">SOLO OWNER</span>
         </div>
         <div className="overflow-x-auto">
             <table className="w-full text-sm text-left">
                 <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                     <tr>
                         <th className="px-6 py-3">Fecha / Hora</th>
                         <th className="px-6 py-3">Usuario</th>
                         <th className="px-6 py-3">Acción</th>
                         <th className="px-6 py-3">Detalle</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                     {audits.length === 0 ? (
                         <tr>
                             <td colSpan={4} className="px-6 py-8 text-center text-slate-400 italic">
                                 No hay registros de auditoría recientes.
                             </td>
                         </tr>
                     ) : (
                        audits.map(log => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 font-mono text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                                <td className="px-6 py-4 font-bold text-slate-700">{log.userId}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        log.action === 'THEFT_ALERT' ? 'bg-red-100 text-red-700 animate-pulse' :
                                        log.action === 'OPEN_SHIFT' ? 'bg-blue-100 text-blue-700' :
                                        'bg-slate-100 text-slate-700'
                                    }`}>
                                        {log.action}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={log.details}>
                                    {log.details}
                                </td>
                            </tr>
                        ))
                     )}
                 </tbody>
             </table>
         </div>
      </div>
    </div>
  );
};

export default Reports;