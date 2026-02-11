import React, { useState, useEffect } from 'react';
import { Users, Plus, Search, AlertCircle, CheckCircle, Shield, X, Save, Ban } from 'lucide-react';
import { authFetch } from '../utils/auth';

interface Customer {
    id: string;
    name: string;
    taxId: string;
    phone: string;
    creditLimit: number;
    currentDebt: number;
    isBlocked: boolean;
}

const Clients: React.FC = () => {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        taxId: '',
        phone: '',
        email: '',
        address: '',
        creditLimit: ''
    });

    const fetchCustomers = async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/customers');
            const data = await res.json();
            if (res.ok) setCustomers(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    ...formData,
                    creditLimit: parseFloat(formData.creditLimit) || 0
                })
            });

            if (res.ok) {
                setShowModal(false);
                setFormData({ name: '', taxId: '', phone: '', email: '', address: '', creditLimit: '' });
                fetchCustomers();
                alert("✅ Cliente registrado exitosamente.");
            }
        } catch (e) {
            alert("Error creando cliente");
        }
    };

    const toggleBlock = async (id: string, currentStatus: boolean) => {
        if (!confirm(`¿${currentStatus ? 'Desbloquear' : 'BLOQUEAR'} crédito para este cliente?`)) return;
        try {
            const token = localStorage.getItem('nortex_token');
            await fetch(`/api/customers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ isBlocked: !currentStatus })
            });
            setCustomers(prev => prev.map(c => c.id === id ? { ...c, isBlocked: !currentStatus } : c));
        } catch (e) { alert("Error"); }
    };

    const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.taxId?.includes(searchTerm)
    );

    return (
        <div className="p-6 h-full bg-slate-100 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                        <Users className="text-nortex-500" /> Cartera de Clientes
                    </h1>
                    <p className="text-slate-500 text-sm">Gestión de Riesgo y Perfiles</p>
                </div>
                <button onClick={() => setShowModal(true)} className="bg-nortex-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-nortex-800">
                    <Plus size={18} /> Nuevo Cliente
                </button>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o DNI/RUC..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-nortex-500"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                        <tr>
                            <th className="p-4">Cliente</th>
                            <th className="p-4">DNI / RUC</th>
                            <th className="p-4">Contacto</th>
                            <th className="p-4">Estado Financiero</th>
                            <th className="p-4">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={5} className="p-8 text-center text-slate-400">Cargando...</td></tr>
                        ) : filtered.map(c => {
                            const usage = c.creditLimit > 0 ? (c.currentDebt / c.creditLimit) * 100 : 0;
                            const isOverLimit = c.currentDebt > c.creditLimit;
                            return (
                                <tr key={c.id} className={`hover:bg-slate-50 ${isOverLimit ? 'bg-red-50' : ''}`}>
                                    <td className="p-4">
                                        <div className="font-bold text-slate-800">{c.name}</div>
                                        {c.isBlocked && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">BLOQUEADO</span>}
                                    </td>
                                    <td className="p-4 font-mono text-slate-600">{c.taxId || '-'}</td>
                                    <td className="p-4 text-sm text-slate-600">{c.phone || '-'}</td>
                                    <td className="p-4">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-slate-500">Deuda: ${Number(c.currentDebt).toFixed(2)}</span>
                                            <span className="text-slate-500">Límite: ${Number(c.creditLimit).toFixed(2)}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${usage > 90 ? 'bg-red-500' : 'bg-green-500'}`}
                                                style={{ width: `${Math.min(usage, 100)}%` }}
                                            ></div>
                                        </div>
                                        {isOverLimit && <div className="text-[10px] text-red-600 font-bold mt-1 flex items-center gap-1"><AlertCircle size={10} /> Excede Límite</div>}
                                    </td>
                                    <td className="p-4">
                                        <button
                                            onClick={() => toggleBlock(c.id, c.isBlocked)}
                                            className={`p-2 rounded-lg transition-colors ${c.isBlocked ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                            title={c.isBlocked ? "Desbloquear Crédito" : "Bloquear Crédito"}
                                        >
                                            {c.isBlocked ? <CheckCircle size={16} /> : <Ban size={16} />}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 text-lg">Nuevo Cliente</h3>
                            <button onClick={() => setShowModal(false)}><X size={20} className="text-slate-400 hover:text-red-500" /></button>
                        </div>
                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div>
                                <label className="text-xs font-mono font-bold text-slate-500">NOMBRE / RAZÓN SOCIAL</label>
                                <input required className="w-full border border-slate-300 rounded p-2 mt-1 text-slate-800" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-mono font-bold text-slate-500">DNI / RUC</label>
                                    <input className="w-full border border-slate-300 rounded p-2 mt-1 text-slate-800" value={formData.taxId} onChange={e => setFormData({ ...formData, taxId: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-mono font-bold text-slate-500">TELÉFONO</label>
                                    <input className="w-full border border-slate-300 rounded p-2 mt-1 text-slate-800" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-mono font-bold text-slate-500">DIRECCIÓN</label>
                                <input className="w-full border border-slate-300 rounded p-2 mt-1 text-slate-800" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                            </div>
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                <label className="text-xs font-mono font-bold text-blue-800 flex items-center gap-2"><Shield size={14} /> LÍMITE DE CRÉDITO INICIAL ($)</label>
                                <input type="number" min="0" className="w-full border border-blue-200 rounded p-2 mt-1 font-bold text-lg text-slate-800" value={formData.creditLimit} onChange={e => setFormData({ ...formData, creditLimit: e.target.value })} placeholder="0.00" />
                                <p className="text-[10px] text-blue-600 mt-1">Este monto define cuánto puede comprar a crédito antes de bloquearse.</p>
                            </div>
                            <button type="submit" className="w-full py-3 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800 flex items-center justify-center gap-2">
                                <Save size={18} /> Guardar Ficha
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Clients;