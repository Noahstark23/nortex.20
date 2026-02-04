import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShieldCheck, AlertTriangle, Eye, Lock, TrendingUp, TrendingDown, Package, Award } from 'lucide-react';
import { AuditLog, Product } from '../types';
import { MOCK_PRODUCTS } from '../constants';

const Reports: React.FC = () => {
  const [metrics, setMetrics] = useState({
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    margin: 0,
    avgTicket: 0
  });
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New State for Advanced Reports
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [criticalStock, setCriticalStock] = useState<Product[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const token = localStorage.getItem('nortex_token');
      
      try {
        // 1. Generate Advanced Mock Data for Analytics
        const simulatedSales = Array.from({ length: 50 }).map((_, i) => {
          const product = MOCK_PRODUCTS[Math.floor(Math.random() * MOCK_PRODUCTS.length)];
          const qty = Math.floor(Math.random() * 5) + 1;
          return {
            id: `s_${i}`,
            productId: product.id,
            productName: product.name,
            revenue: product.price * qty,
            cost: product.costPrice * qty,
            price: product.price,
            costPrice: product.costPrice,
            qty
          };
        });

        const revenue = simulatedSales.reduce((acc, s) => acc + s.revenue, 0);
        const cogs = simulatedSales.reduce((acc, s) => acc + s.cost, 0);
        const grossProfit = revenue - cogs;
        const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const avgTicket = revenue / simulatedSales.length;

        setMetrics({ revenue, cogs, grossProfit, margin, avgTicket });

        // Calculate Top Products (By Margin & Volume)
        const productStats: Record<string, any> = {};
        simulatedSales.forEach(s => {
            if (!productStats[s.productId]) {
                productStats[s.productId] = { 
                    name: s.productName, 
                    sold: 0, 
                    revenue: 0, 
                    margin: ((s.price - s.costPrice) / s.price) * 100 
                };
            }
            productStats[s.productId].sold += s.qty;
            productStats[s.productId].revenue += s.revenue;
        });

        const sortedProducts = Object.values(productStats).sort((a, b) => b.sold - a.sold).slice(0, 5);
        setTopProducts(sortedProducts);

        // Identify Critical Stock
        // For simulation, we randomly drop stock of mock products to < 10 for display purposes if all are high
        const stockAlerts = MOCK_PRODUCTS.map(p => ({
            ...p,
            stock: Math.random() > 0.7 ? Math.floor(Math.random() * 8) : p.stock // Randomly simulate low stock
        })).filter(p => p.stock < 10);
        
        setCriticalStock(stockAlerts);

        // 2. Fetch Audit Logs
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
        <p className="text-slate-500">Reporte de Utilidad Real, Inventario Crítico y Auditoría.</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <div className="text-xs font-mono text-slate-500 mb-1">VENTAS TOTALES (REVENUE)</div>
           <div className="text-2xl font-bold text-slate-800">${metrics.revenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
           <div className="text-xs text-green-600 flex items-center mt-2"><TrendingUp size={12} className="mr-1"/> +15% vs mes anterior</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <div className="text-xs font-mono text-slate-500 mb-1">TICKET PROMEDIO</div>
           <div className="text-2xl font-bold text-slate-800">${metrics.avgTicket.toFixed(2)}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
           <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full"></div>
           <div className="text-xs font-mono text-slate-500 mb-1">UTILIDAD BRUTA REAL</div>
           <div className="text-2xl font-bold text-emerald-600">${metrics.grossProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
        </div>
        <div className="bg-nortex-900 text-white p-6 rounded-xl shadow-lg">
           <div className="text-xs font-mono text-slate-400 mb-1">MARGEN DE GANANCIA</div>
           <div className="text-3xl font-bold text-nortex-accent">{metrics.margin.toFixed(1)}%</div>
           <div className="text-xs text-slate-400 mt-1">Target: >25%</div>
        </div>
      </div>

      {/* New Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Top Products */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Award className="text-yellow-500" size={20} /> Top Productos (Volumen)
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-100">
                  <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 font-mono text-xs">
                          <tr>
                              <th className="px-4 py-2 text-left">Producto</th>
                              <th className="px-4 py-2 text-right">Vendidos</th>
                              <th className="px-4 py-2 text-right">Margen</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {topProducts.map((p, i) => (
                              <tr key={i}>
                                  <td className="px-4 py-3 font-medium text-slate-700">{p.name}</td>
                                  <td className="px-4 py-3 text-right text-slate-600">{p.sold} u.</td>
                                  <td className="px-4 py-3 text-right font-bold text-emerald-600">{p.margin.toFixed(1)}%</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>

          {/* Critical Inventory */}
          <div className="bg-white p-6 rounded-xl border border-red-100 shadow-sm relative">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                  <AlertTriangle size={64} className="text-red-500" />
              </div>
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Package className="text-red-500" size={20} /> Alerta de Stock Crítico
              </h3>
              <div className="space-y-3">
                  {criticalStock.length === 0 ? (
                      <div className="text-center py-8 text-slate-400">Inventario Saludable.</div>
                  ) : (
                      criticalStock.map(p => (
                          <div key={p.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100">
                              <div>
                                  <div className="font-bold text-slate-800">{p.name}</div>
                                  <div className="text-xs text-red-500 font-mono">SKU: {p.sku}</div>
                              </div>
                              <div className="text-right">
                                  <span className="text-2xl font-bold text-red-600">{p.stock}</span>
                                  <div className="text-xs text-red-400">Unidades</div>
                              </div>
                          </div>
                      ))
                  )}
              </div>
          </div>
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <h3 className="font-bold text-slate-800 mb-6">Tendencia de Rentabilidad (Último Mes)</h3>
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
