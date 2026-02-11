import React, { useState, useEffect } from 'react';
import { Truck, Plus, Search, Phone, Mail, User, X, Save } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  category: string;
}

const Suppliers: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({ name: '', contactName: '', phone: '', email: '', category: '' });

  const fetchSuppliers = async () => {
      try {
          const token = localStorage.getItem('nortex_token');
          const res = await fetch('/api/suppliers', {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if(res.ok) setSuppliers(data);
      } catch(e) { console.error(e); } 
      finally { setLoading(false); }
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          const token = localStorage.getItem('nortex_token');
          const res = await fetch('/api/suppliers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify(formData)
          });
          if(res.ok) {
              setShowModal(false);
              setFormData({ name: '', contactName: '', phone: '', email: '', category: '' });
              fetchSuppliers();
              alert("✅ Proveedor agregado.");
          }
      } catch(e) { alert("Error"); }
  };

  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="p-6 h-full bg-slate-100 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
            <div>
                <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                    <Truck className="text-nortex-500" /> Proveedores (SRM)
                </h1>
                <p className="text-slate-500 text-sm">Directorio de Cadena de Suministro</p>
            </div>
            <button onClick={() => setShowModal(true)} className="bg-nortex-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-nortex-800">
                <Plus size={18} /> Agregar Proveedor
            </button>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 text-slate-800">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input 
                    type="text" 
                    placeholder="Buscar proveedor..." 
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-nortex-500"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? <p>Cargando...</p> : filtered.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all text-slate-800">
                    <div className="flex justify-between items-start mb-4">
                        <h3 className="font-bold text-lg text-slate-800">{s.name}</h3>
                        <span className="text-[10px] bg-slate-100 px-2 py-1 rounded font-bold uppercase text-slate-500">{s.category || 'General'}</span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-600">
                        <div className="flex items-center gap-2"><User size={14} className="text-slate-400"/> {s.contactName || 'Sin contacto'}</div>
                        <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400"/> {s.phone || '-'}</div>
                        <div className="flex items-center gap-2"><Mail size={14} className="text-slate-400"/> {s.email || '-'}</div>
                    </div>
                </div>
            ))}
        </div>

        {/* MODAL */}
        {showModal && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg">Nuevo Proveedor</h3>
                        <button onClick={() => setShowModal(false)}><X size={20}/></button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <input required className="w-full border p-2 rounded text-slate-800" placeholder="Nombre Empresa" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                        <input className="w-full border p-2 rounded text-slate-800" placeholder="Persona de Contacto" value={formData.contactName} onChange={e => setFormData({...formData, contactName: e.target.value})} />
                        <input className="w-full border p-2 rounded text-slate-800" placeholder="Categoría (Ej. Cementos)" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
                        <div className="grid grid-cols-2 gap-4">
                            <input className="w-full border p-2 rounded text-slate-800" placeholder="Teléfono" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                            <input className="w-full border p-2 rounded text-slate-800" placeholder="Email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                        </div>
                        <button type="submit" className="w-full bg-nortex-900 text-white py-3 rounded font-bold">Guardar</button>
                    </form>
                </div>
            </div>
        )}
    </div>
  );
};

export default Suppliers;