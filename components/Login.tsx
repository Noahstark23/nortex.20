import React, { useState } from 'react';
import { useNavigate, Navigate, Link, useSearchParams } from 'react-router-dom';
import { Mail, Lock, LogIn, Loader2, ArrowRight, Clock, Eye, EyeOff } from 'lucide-react';
import { homePathFor, resolveUiMode, UI_MODE_KEY } from '../utils/navigation';
import AuthShell, { persistAuthenticatedTheme, useAuthTheme } from './auth/AuthShell';

const Login: React.FC = () => {
  const navigate = useNavigate();
  // utils/auth.ts redirige acá con ?error=session_expired cuando el token vence;
  // sin este aviso el usuario aterrizaba en un login mudo sin saber por qué.
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('error') === 'session_expired';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { theme, toggleTheme } = useAuthTheme();
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
      persistAuthenticatedTheme(theme);

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
    <AuthShell
      title="Bienvenido a Nortex"
      subtitle="Entrá y seguí donde quedaste."
      theme={theme}
      onToggleTheme={toggleTheme}
      headingId="login-title"
    >
      {sessionExpired && !error && (
        <div role="status" className="nx-auth-alert nx-auth-alert-warning">
          <Clock aria-hidden="true" size={16} />
          <span>Tu sesión venció. Volvé a entrar y seguís donde quedaste.</span>
        </div>
      )}

      {error && (
        <div role="alert" aria-live="assertive" className="nx-auth-alert nx-auth-alert-danger">
          <Lock aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="nx-auth-form" aria-busy={loading}>
        <div className="nx-auth-field-group">
          <label htmlFor="login-email">Correo electrónico</label>
          <div className="nx-auth-control-wrap">
            <Mail aria-hidden="true" className="nx-auth-control-icon" size={18} />
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              className="nx-auth-control nx-auth-control-with-icon"
              placeholder="usuario@empresa.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
        </div>

        <div className="nx-auth-field-group">
          <label htmlFor="login-password">Contraseña</label>
          <div className="nx-auth-control-wrap">
            <Lock aria-hidden="true" className="nx-auth-control-icon" size={18} />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              className="nx-auth-control nx-auth-control-with-icon nx-auth-control-with-action"
              placeholder="••••••••"
              value={formData.password}
              onChange={e => setFormData({ ...formData, password: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setShowPassword(current => !current)}
              className="nx-auth-control-action"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
            </button>
          </div>
        </div>

        <div className="nx-auth-form-link-row">
          <Link to="/forgot-password" className="nx-auth-link">¿Olvidaste tu contraseña?</Link>
        </div>

        <button type="submit" disabled={loading} className="nx-auth-primary">
          {loading ? <Loader2 aria-hidden="true" className="animate-spin" size={20} /> : (
            <><LogIn aria-hidden="true" size={19} /> Iniciar sesión</>
          )}
        </button>
      </form>

      <div className="nx-auth-footer">
        <p>¿Aún no tenés cuenta?</p>
        <Link to="/register" className="nx-auth-link nx-auth-link-prominent">
          Registrar empresa <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </AuthShell>
  );
};

export default Login;
