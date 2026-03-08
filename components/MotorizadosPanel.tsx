import React, { useState, useEffect } from 'react';
import { Bike, Plus, Edit, ShieldAlert, CheckCircle, Search, MapPin, Phone, User } from 'lucide-react';

interface Motorizado {
    id: string;
    nombre: string;
    telefono: string;
    zonaCobertura: string;
    activo: boolean;
    tipoFlota: string; // 'PROPIA' | 'NORTEX'
}

const MotorizadosPanel: React.FC = () => {
    const [motorizados, setMotorizados] = useState<Motorizado[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ nombre: '', telefono: '', zonaCobertura: '' });
    const [submitting, setSubmitting] = useState(false);

    const token = localStorage.getItem('nortex_token');

    useEffect(() => {
        fetchMotorizados();
    }, []);

    const fetchMotorizados = async () => {
        try {
            const res = await fetch('/api/v1/motorizados', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setMotorizados(data.motorizados);
            }
        } catch (error) {
            console.error('Error fetching motorizados:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await fetch('/api/v1/motorizados', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setShowModal(false);
                setFormData({ nombre: '', telefono: '', zonaCobertura: '' });
                fetchMotorizados();
            } else {
                const data = await res.json();
                alert(data.error || 'Error al registrar.');
            }
        } catch (error) {
            console.error('Error creating:', error);
        } finally {
            setSubmitting(false);
        }
    };

    const toggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            const res = await fetch(`/api/v1/motorizados/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ activo: !currentStatus })
            });
            if (res.ok) {
                fetchMotorizados();
            }
        } catch (error) {
            console.error('Error toggling status:', error);
        }
    };

    const filteredMotorizados = motorizados.filter(m =>
        m.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.telefono.includes(searchTerm)
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Bike className="text-blue-600" /> Flota de Motorizados
                    </h2>
                    <p className="text-slate-500">Gestiona tus repartidores y la flota freelance de Nortex</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <Plus size={18} /> Registrar Nuevo
                </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o teléfono..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                                <th className="p-4 font-semibold text-center w-12">Flota</th>
                                <th className="p-4 font-semibold">Motorizado</th>
                                <th className="p-4 font-semibold">Contacto</th>
                                <th className="p-4 font-semibold">Zona de Cobertura</th>
                                <th className="p-4 font-semibold">Estado</th>
                                <th className="p-4 font-semibold">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {loading ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-400">Cargando flota...</td></tr>
                            ) : filteredMotorizados.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-400">No hay motorizados registrados.</td></tr>
                            ) : (
                                filteredMotorizados.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4 text-center">
                                            {m.tipoFlota === 'PROPIA' ? (
                                                <span className="inline-flex items-center justify-center p-1.5 rounded-lg bg-blue-100 text-blue-700 tooltip-trigger" title="Flota Propia">
                                                    <User size={16} />
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center justify-center p-1.5 rounded-lg bg-emerald-100 text-emerald-700 tooltip-trigger" title="Freelance NORTEX">
                                                    <Bike size={16} />
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <p className="font-semibold text-slate-800">{m.nombre}</p>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-1.5 text-slate-600">
                                                <Phone size={14} className="text-slate-400" />
                                                {m.telefono}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-1.5 text-slate-600">
                                                <MapPin size={14} className="text-slate-400" />
                                                {m.zonaCobertura}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                {m.activo ? <CheckCircle size={12} /> : <ShieldAlert size={12} />}
                                                {m.activo ? 'Activo' : 'Inactivo'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            {m.tipoFlota === 'PROPIA' && (
                                                <button
                                                    onClick={() => toggleStatus(m.id, m.activo)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${m.activo
                                                            ? 'border-red-200 text-red-600 hover:bg-red-50'
                                                            : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                                        }`}
                                                >
                                                    {m.activo ? 'Desactivar' : 'Activar'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal de Registro */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md relative z-10 overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h3 className="text-xl font-bold text-slate-800">Registrar Motorizado</h3>
                            <p className="text-sm text-slate-500 mt-1">Añade un nuevo repartidor a tu flota propia.</p>
                        </div>
                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre Completo *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.nombre}
                                    onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="Ej: Mario Mendoza"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono (WhatsApp) *</label>
                                <input
                                    type="tel"
                                    required
                                    value={formData.telefono}
                                    onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="8888-0000"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Zonas de Cobertura *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.zonaCobertura}
                                    onChange={e => setFormData({ ...formData, zonaCobertura: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="Ej: Managua Centro, Carretera Masaya"
                                />
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                                >
                                    {submitting ? 'Guardando...' : 'Guardar Motorizado'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MotorizadosPanel;
