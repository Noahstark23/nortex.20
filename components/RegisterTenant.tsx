import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';

const RegisterTenant: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    companyName: '',
    email: '',
    password: '',
    type: 'FERRETERIA'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en el registro');
      }

      // Simulación de Login Automático: Guardamos el tenantId (En prod usar JWT)
      // Verified: Tenant ID is stored for session isolation.
      localStorage.setItem('nortex_tenant_id', data.tenantId);
      
      // Redirect
      navigate('/app/dashboard');

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-nortex-900 p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-nortex-500 rounded-full blur-[100px] opacity-10"></div>
        <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-nortex-accent rounded-full blur-[100px] opacity-10"></div>
      </div>

      <div className="w-full max-w-md bg-nortex-800/80 backdrop-blur-lg border border-nortex-700 p-8 rounded-2xl shadow-2xl relative z-10">
        
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-nortex-accent rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="font-bold text-nortex-900 text-xl">N</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Crea tu Cuenta Nortex</h2>
          <p className="text-slate-400 text-sm mt-2">Empieza a gestionar tu negocio y generar historial crediticio hoy.</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">NOMBRE DEL NEGOCIO</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                required
                className="w-full bg-nortex-900 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="Ej. Ferretería Los Andes"
                value={formData.companyName}
                onChange={e => setFormData({...formData, companyName: e.target.value})}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">TIPO DE NEGOCIO</label>
            <select
              className="w-full bg-nortex-900 border border-nortex-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
              value={formData.type}
              onChange={e => setFormData({...formData, type: e.target.value})}
            >
              <option value="FERRETERIA">Ferretería / Construcción</option>
              <option value="FARMACIA">Farmacia</option>
              <option value="RETAIL">Retail General</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">EMAIL ADMINISTRADOR</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="email"
                required
                className="w-full bg-nortex-900 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="dueno@empresa.com"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">CONTRASEÑA</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="password"
                required
                className="w-full bg-nortex-900 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="••••••••"
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'Registrar Empresa'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tienes cuenta? <Link to="/login" className="text-nortex-accent hover:underline">Inicia Sesión</Link>
        </div>
      </div>
    </div>
  );
};

export default RegisterTenant;