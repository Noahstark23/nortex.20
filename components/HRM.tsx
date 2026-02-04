import React, { useState, useEffect } from 'react';
import { Users, Briefcase, DollarSign, Plus, UserPlus, CheckCircle, Clock } from 'lucide-react';
import { Employee, Payroll } from '../types';

const HRM: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TEAM' | 'PAYROLL'>('TEAM');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // New Employee Form
  const [formData, setFormData] = useState({
      firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: ''
  });

  const fetchEmployees = async () => {
      setLoading(true);
      try {
          const token = localStorage.getItem('nortex_token');
          const res = await fetch('http://localhost:3000/api/employees', {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (res.ok) setEmployees(data);
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
  };

  useEffect(() => { fetchEmployees(); }, []);

  const handleCreateEmployee = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          const token = localStorage.getItem('nortex_token');
          const res = await fetch('http://localhost:3000/api/employees', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({
                  ...formData,
                  baseSalary: parseFloat(formData.baseSalary),
                  commissionRate: parseFloat(formData.commissionRate) / 100 // Convert percentage to decimal
              })
          });
          if (res.ok) {
              setShowModal(false);
              setFormData({ firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: '' });
              fetchEmployees();
              alert("✅ Colaborador añadido exitosamente.");
          }
      } catch(e) { alert("Error"); }
  };

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden">
        {/* Sidebar Navigation */}
        <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-6 border-b border-slate-200">
                <h2 className="text-xl font-bold text-nortex-900 flex items-center gap-2">
                    <Briefcase className="text-nortex-500" /> Recursos Humanos
                </h2>
                <p className="text-xs text-slate-400 mt-1">Gestión de Talento & Nómina</p>
            </div>
            <nav className="p-4 space-y-2">
                <button 
                    onClick={() => setActiveTab('TEAM')}
                    className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'TEAM' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <Users size={18} /> Mi Equipo (Wolfpack)
                </button>
                <button 
                    onClick={() => setActiveTab('PAYROLL')}
                    className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'PAYROLL' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <DollarSign size={18} /> Nómina & Comisiones
                </button>
            </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8 overflow-y-auto">
            {activeTab === 'TEAM' ? (
                <div>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-bold text-slate-800">Directorio de Personal</h3>
                        <button onClick={() => setShowModal(true)} className="bg-nortex-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-nortex-800">
                            <UserPlus size={18} /> Nuevo Colaborador
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {employees.map(emp => (
                            <div key={emp.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold text-xl">
                                        {emp.firstName[0]}{emp.lastName[0]}
                                    </div>
                                    <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded uppercase">{emp.role}</span>
                                </div>
                                <h4 className="text-lg font-bold text-slate-800">{emp.firstName} {emp.lastName}</h4>
                                <div className="mt-4 space-y-2 text-sm text-slate-600">
                                    <div className="flex justify-between">
                                        <span>Salario Base:</span>
                                        <span className="font-mono font-bold">${emp.baseSalary}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Comisión:</span>
                                        <span className="font-mono font-bold">{(emp.commissionRate * 100).toFixed(1)}%</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div>
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-2xl font-bold text-slate-800">Cálculo de Nómina</h3>
                            <p className="text-slate-500">Periodo Actual: Octubre 2023</p>
                        </div>
                        <button className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-green-700 shadow-lg shadow-green-600/20">
                            <CheckCircle size={18} /> Cerrar Nómina y Pagar
                        </button>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                <tr>
                                    <th className="p-4">Colaborador</th>
                                    <th className="p-4 text-right">Salario Base</th>
                                    <th className="p-4 text-right">Ventas Mes</th>
                                    <th className="p-4 text-right">% Com.</th>
                                    <th className="p-4 text-right">Comisión Ganada</th>
                                    <th className="p-4 text-right">Total a Pagar</th>
                                    <th className="p-4 text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {employees.map(emp => {
                                    const commissionAmount = emp.salesMonthToDate * emp.commissionRate;
                                    const totalPay = emp.baseSalary + commissionAmount;
                                    return (
                                        <tr key={emp.id} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{emp.firstName} {emp.lastName}</td>
                                            <td className="p-4 text-right font-mono text-slate-600">${emp.baseSalary.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono text-blue-600 font-bold">${emp.salesMonthToDate.toFixed(2)}</td>
                                            <td className="p-4 text-right text-slate-500">{(emp.commissionRate * 100)}%</td>
                                            <td className="p-4 text-right font-mono text-green-600">+${commissionAmount.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono font-bold text-slate-900 text-lg">${totalPay.toFixed(2)}</td>
                                            <td className="p-4 text-center">
                                                <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold flex items-center justify-center gap-1 w-fit mx-auto">
                                                    <Clock size={12}/> PENDIENTE
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>

        {/* Create Modal */}
        {showModal && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in duration-200">
                    <h3 className="font-bold text-lg mb-4 text-slate-800">Registrar Colaborador</h3>
                    <form onSubmit={handleCreateEmployee} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <input required className="border p-2 rounded" placeholder="Nombre" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} />
                            <input required className="border p-2 rounded" placeholder="Apellido" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} />
                        </div>
                        <select className="w-full border p-2 rounded" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                            <option value="VENDEDOR">Vendedor</option>
                            <option value="MANAGER">Gerente</option>
                            <option value="BODEGA">Bodeguero</option>
                        </select>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500">Salario Base ($)</label>
                                <input type="number" required className="w-full border p-2 rounded" placeholder="0.00" value={formData.baseSalary} onChange={e => setFormData({...formData, baseSalary: e.target.value})} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Comisión (%)</label>
                                <input type="number" required className="w-full border p-2 rounded" placeholder="Ej: 5" value={formData.commissionRate} onChange={e => setFormData({...formData, commissionRate: e.target.value})} />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-nortex-900 text-white py-3 rounded-lg font-bold hover:bg-nortex-800">Guardar</button>
                        <button type="button" onClick={() => setShowModal(false)} className="w-full text-slate-500 py-2 hover:text-slate-700">Cancelar</button>
                    </form>
                </div>
            </div>
        )}
    </div>
  );
};

export default HRM;
