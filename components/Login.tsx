import React, { useState } from 'react';
import { useNavigate, Navigate, Link, useSearchParams } from 'react-router-dom';
import { Mail, Lock, LogIn, Loader2, ArrowRight, Clock, Eye, EyeOff } from 'lucide-react';
import { homePathFor, resolveUiMode, UI_MODE_KEY } from '../utils/navigation';

const Login: React.FC = () => {
  const navigate = useNavigate();
  // utils/auth.ts redirige acá con ?error=session_expired cuando el token vence;
  // sin este aviso el usuario aterrizaba en un login mudo sin saber por qué.
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('error') === 'session_expired';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  // ── La trampa del botón atrás (reporte real desde móvil) ──────────────────
  // Con sesión viva, /login mostraba el formulario vacío otra vez. Como el
  // navigate() post-login no reemplazaba el historial, el flujo era: entrás →
  // app → botón atrás → formulario de login de nuevo → volvés a entrar → atrás
  // → formulario… En el teléfono eso se siente como "la app me atrapa y no me
  // deja salir". Con token presente acá no hay nada que preguntar: derecho al
  // app, con replace para no apilar otro /login en el historial.
  // Sin riesgo de loop: utils/auth.ts BORRA el token antes de redirigir con
  // ?error=session_expired, así que un token presente es una sesión viva — y
  // ante ese parámetro igual se muestra el formulario, por si acaso.
  const tokenVivo = localStorage.getItem('nortex_token');
  if (tokenVivo && !sessionExpired) {
    try {
      const u = JSON.parse(localStorage.getItem('nortex_user') || '{}');
      if (u.role === 'SUPER_ADMIN') return <Navigate to="/admin" replace />;
      const uiMode = resolveUiMode(u.tenant?.type || '', localStorage.getItem(UI_MODE_KEY));
      return <Navigate to={homePathFor(u.role || '', uiMode)} replace />;
    } catch { /* nortex_user ilegible → dejar el formulario; el 401 limpiará */ }
  }

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

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'No pudimos iniciar sesión. Revisá tus datos.');
      }
      if (!data?.token || !data?.user || !data?.tenant?.id) {
        throw new Error('El servidor respondió de forma incompleta. Intentá de nuevo.');
      }

      // SECURE STORAGE
      localStorage.setItem('nortex_token', data.token);
      localStorage.setItem('nortex_user', JSON.stringify({ ...data.user, tenant: data.tenant }));
      localStorage.setItem('nortex_tenant_id', data.tenant.id);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));

      // SUPER_ADMIN redirect — basado en el rol devuelto por el backend, nunca en un
      // email hardcodeado en el bundle. El privilegio real lo valida el servidor.
      if (data.user.role === 'SUPER_ADMIN') {
        navigate('/admin', { replace: true });
      } else {
        // Aterrizaje por rol y modo (auditoría F4): antes TODOS caían en
        // /app/dashboard — el cajero pagaba la cascada del panel financiero
        // para recién ahí tocar "Vender". App.tsx ya calculaba homePathFor
        // para la ruta *; el login lo ignoraba.
        const uiMode = resolveUiMode(data.tenant?.type || '', localStorage.getItem(UI_MODE_KEY));
        navigate(homePathFor(data.user.role, uiMode), { replace: true });
      }

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No pudimos conectar con el servidor. Intentá de nuevo.');
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Bienvenido a Nortex</h1>
          <p className="mt-2 text-sm text-slate-400">Entrá y seguí donde quedaste.</p>
        </div>

        {sessionExpired && !error && (
          <div role="status" className="mb-6 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300 text-sm text-center flex items-center justify-center gap-2">
            <Clock size={14} /> Tu sesión venció. Volvé a entrar y seguís donde quedaste.
          </div>
        )}

        {error && (
          <div role="alert" aria-live="assertive" className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm text-center flex items-center justify-center gap-2">
            <Lock size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="mb-1.5 ml-1 block text-sm font-medium text-slate-300">Correo electrónico</label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-nortex-accent transition-colors" size={18} />
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 transition-all placeholder:text-slate-600"
                placeholder="usuario@empresa.com"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 ml-1 block text-sm font-medium text-slate-300">Contraseña</label>
            <div className="relative group">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-nortex-accent transition-colors" size={18} />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-12 py-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 transition-all placeholder:text-slate-600"
                placeholder="••••••••"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(current => !current)}
                className="absolute right-1 top-1/2 flex h-touch w-touch -translate-y-1/2 items-center justify-center rounded-control text-slate-400 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
              </button>
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
