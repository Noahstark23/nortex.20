import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, LogIn, Loader2, ArrowRight } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Credenciales incorrectas');
      }

      // SECURE STORAGE
      localStorage.setItem('nortex_token', data.token);
      localStorage.setItem('nortex_user', JSON.stringify({ ...data.user, tenant: data.tenant }));
      localStorage.setItem('nortex_tenant_id', data.tenant.id);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));

      // SUPER_ADMIN redirect
      const SUPER_ADMIN_EMAILS = ['noelpinedaa96@gmail.com'];
      if (data.user.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(data.user.email)) {
        navigate('/admin');
      } else {
        navigate('/app/dashboard');
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-500/[0.07] rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-sm panel-premium bg-surface-900/70 backdrop-blur-xl p-8 relative z-10 animate-fade-in-up">

        <div className="text-center mb-8">
          <div className="w-10 h-10 bg-nortex-accent rounded flex items-center justify-center mx-auto mb-4 shadow-[0_0_15px_rgba(16,185,129,0.4)]">
            <span className="font-bold text-nortex-900 text-lg">N</span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Bienvenido a Nortex</h2>
          <p className="text-slate-400 text-xs mt-2 uppercase tracking-widest">Sistema Operativo Financiero</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center flex items-center justify-center gap-2">
            <Lock size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1.5 ml-1">CORREO ELECTRÓNICO</label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-nortex-accent transition-colors" size={18} />
              <input
                type="email"
                required
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 transition-all placeholder:text-slate-600"
                placeholder="usuario@empresa.com"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1.5 ml-1">CONTRASEÑA</label>
            <div className="relative group">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-nortex-accent transition-colors" size={18} />
              <input
                type="password"
                required
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 transition-all placeholder:text-slate-600"
                placeholder="••••••••"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="text-xs text-slate-400 hover:text-nortex-accent transition-colors">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2 py-3.5 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (
              <>
                <LogIn size={20} /> Iniciar Sesión
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/[0.06] text-center">
          <p className="text-slate-500 text-sm mb-3">¿Aún no tienes cuenta?</p>
          <Link to="/register" className="inline-flex items-center gap-1 text-nortex-accent hover:text-emerald-400 font-medium text-sm transition-colors">
            Registrar Empresa <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;