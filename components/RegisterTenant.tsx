import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Mail, Lock, ArrowRight, Loader2, Check, AlertCircle, Phone } from 'lucide-react';
import { trackEvent } from '../utils/analytics';

interface RegisterTenantProps {
  isModal?: boolean;
  initialCart?: any[];
}

// Move PageWrapper OUTSIDE to prevent re-creation
const PageWrapper: React.FC<{ isModal: boolean; children: React.ReactNode }> = React.memo(({ isModal, children }) => {
  if (isModal) return <>{children}</>;
  return (
    <div className="min-h-screen flex items-center justify-center bg-nortex-900 p-4 relative">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-nortex-500 rounded-full blur-[100px] opacity-10"></div>
        <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-nortex-accent rounded-full blur-[100px] opacity-10"></div>
      </div>
      {children}
    </div>
  );
});

PageWrapper.displayName = 'PageWrapper';

// El backend exige mínimo 8 caracteres (RegisterSchema en backend/validation/schemas.ts).
const PASSWORD_MIN = 8;

const RegisterTenant: React.FC<RegisterTenantProps> = ({ isModal = false, initialCart = [] }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  // Errores por campo, mapeados desde `details` (validate() los devuelve como
  // { campo: [mensajes] }). Sin esto el usuario solo veía el genérico y quedaba mudo.
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formData, setFormData] = React.useState({
    companyName: '',
    email: '',
    password: '',
    phone: '',
    type: 'FERRETERIA'
  });

  const updateField = React.useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Al editar un campo con error, limpiamos su marca (feedback en vivo).
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // Validación en vivo de la contraseña (espejo de la regla del backend).
  const passwordLen = formData.password.length;
  const passwordTooShort = passwordLen > 0 && passwordLen < PASSWORD_MIN;
  const passwordValid = passwordLen >= PASSWORD_MIN;

  const handleSubmit = React.useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    // Cortamos antes de ir al server si la contraseña no cumple el mínimo: evita
    // el ida-y-vuelta y le da al usuario el motivo exacto de inmediato.
    if (formData.password.length < PASSWORD_MIN) {
      setFieldErrors({ password: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres` });
      setError('Revisá los campos marcados en rojo.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        // El middleware validate() responde { error, details: { campo: [msgs] } }.
        // Mapeamos ese detalle al campo (y al mensaje general) en vez de mostrar
        // solo el genérico "Datos de entrada inválidos".
        const details = data?.details;
        if (details && typeof details === 'object') {
          const fe: Record<string, string> = {};
          for (const [k, v] of Object.entries(details)) {
            if (Array.isArray(v) && v.length) fe[k] = String(v[0]);
          }
          setFieldErrors(fe);
          const firstDetail = Object.values(fe)[0];
          setError(firstDetail || data.error || 'Revisá los datos e intentá de nuevo.');
        } else {
          setError(data.error || 'Error en el registro');
        }
        return;
      }

      localStorage.setItem('nortex_token', data.token);
      localStorage.setItem('nortex_user', JSON.stringify({ ...data.user, tenant: data.tenant }));
      localStorage.setItem('nortex_tenant_id', data.tenant.id);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));
      localStorage.setItem('nortex_onboarding_pin', '1234');

      // Conversiones GA4: el registro exitoso ES el alta (sign_up) y a la vez el
      // inicio de la prueba gratis (el tenant nace en TRIAL). Se disparan acá, en
      // el callback de ÉXITO — nunca en el submit — para no contar intentos fallidos.
      trackEvent('sign_up', { method: 'email', business_type: formData.type });
      trackEvent('begin_trial', { business_type: formData.type });

      // Navegación DIRECTA al valor (retención R1): el modal-peaje del PIN
      // interrumpía el momento de máximo impulso con un concepto ("apertura de
      // caja") que el usuario nuevo aún no tiene, y si no tocaba "Continuar"
      // perdía la bienvenida para siempre. El PIN 1234 ahora viaja en el email
      // de bienvenida y el POS ya lo muestra como hint al abrir caja.
      if (initialCart && initialCart.length > 0) {
        const persistentCart = initialCart.map(i => ({
          ...i.product,
          quantity: i.quantity,
          costPrice: i.product.price * 0.7,
          stock: 100,
          sku: 'MOCK-SKU'
        }));
        localStorage.setItem('nortex_pending_cart', JSON.stringify(persistentCart));
        // Venía del catálogo con un carrito: lo llevamos directo a cobrar.
        navigate('/app/pos');
      } else {
        // Registro normal: lo recibe el panel con la bienvenida + primeros pasos.
        navigate('/app/dashboard?welcome=1');
      }

    } catch (err: any) {
      setError('No pudimos conectar con el servidor. Revisá tu internet e intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [formData, initialCart]);

  const containerClasses = React.useMemo(() =>
    isModal
      ? "w-full bg-nortex-900 p-6 rounded-2xl relative"
      : "w-full max-w-md bg-nortex-800/80 backdrop-blur-lg border border-nortex-700 p-8 rounded-2xl shadow-2xl relative z-10",
    [isModal]
  );

  return (
    <PageWrapper isModal={isModal}>
      <div className={containerClasses}>

        <div className="text-center mb-6">
          {!isModal && (
            <div className="w-12 h-12 bg-nortex-accent rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="font-bold text-nortex-900 text-xl">N</span>
            </div>
          )}
          <h2 className={`text-2xl font-bold text-white ${isModal ? 'text-lg' : ''}`}>
            {isModal ? '¡Casi listo! Guarda tu venta' : 'Crea tu Cuenta Nortex'}
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            {isModal ? 'Registra tu ferretería gratis para imprimir este ticket.' : 'Empieza a gestionar tu negocio hoy.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">NOMBRE DEL NEGOCIO</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                required
                className={`w-full bg-nortex-800 border text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none transition-colors ${fieldErrors.companyName ? 'border-red-500/70 focus:border-red-500' : 'border-nortex-700 focus:border-nortex-accent'}`}
                placeholder="Ej. Ferretería Los Andes"
                value={formData.companyName}
                onChange={e => updateField('companyName', e.target.value)}
              />
            </div>
            {fieldErrors.companyName && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.companyName}</p>
            )}
          </div>

          {!isModal && (
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">TIPO DE NEGOCIO</label>
              <select
                className="w-full bg-nortex-800 border border-nortex-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                value={formData.type}
                onChange={e => updateField('type', e.target.value)}
              >
                <option value="FERRETERIA">Ferretería / Construcción</option>
                <option value="PULPERIA">Pulpería / Abarrotes</option>
                <option value="FARMACIA">Farmacia</option>
                <option value="DISTRIBUIDORA">Distribuidora / Mayorista</option>
                <option value="MISCELANEA">Miscelánea</option>
                <option value="BOUTIQUE">Boutique / Ropa</option>
                <option value="RETAIL">Retail General</option>
                <option value="LENDER">Financiera / Prestamista</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">EMAIL ADMINISTRADOR</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="email"
                required
                className={`w-full bg-nortex-800 border text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none transition-colors ${fieldErrors.email ? 'border-red-500/70 focus:border-red-500' : 'border-nortex-700 focus:border-nortex-accent'}`}
                placeholder="dueno@empresa.com"
                value={formData.email}
                onChange={e => updateField('email', e.target.value)}
              />
            </div>
            {fieldErrors.email && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.email}</p>
            )}
          </div>

          {/* WhatsApp opcional (retención R1): el canal de rescate. Sin él, un
              email con typo = tenant inalcanzable para siempre. */}
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">WHATSAPP <span className="text-slate-600">(OPCIONAL — PARA AYUDARTE A ARRANCAR)</span></label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="tel"
                inputMode="tel"
                className={`w-full bg-nortex-800 border text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none transition-colors ${fieldErrors.phone ? 'border-red-500/70 focus:border-red-500' : 'border-nortex-700 focus:border-nortex-accent'}`}
                placeholder="8888 8888"
                value={formData.phone}
                onChange={e => updateField('phone', e.target.value)}
              />
            </div>
            {fieldErrors.phone && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.phone}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">CONTRASEÑA</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="password"
                required
                minLength={PASSWORD_MIN}
                aria-describedby="password-hint"
                className={`w-full bg-nortex-800 border text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none transition-colors ${(fieldErrors.password || passwordTooShort) ? 'border-red-500/70 focus:border-red-500' : passwordValid ? 'border-nortex-accent/60 focus:border-nortex-accent' : 'border-nortex-700 focus:border-nortex-accent'}`}
                placeholder="••••••••"
                value={formData.password}
                onChange={e => updateField('password', e.target.value)}
              />
            </div>
            {/* Pista visible del mínimo + feedback en vivo (verde al cumplir, rojo si falta). */}
            <p
              id="password-hint"
              className={`text-xs mt-1 flex items-center gap-1 ${(fieldErrors.password || passwordTooShort) ? 'text-red-400' : passwordValid ? 'text-nortex-accent' : 'text-slate-500'}`}
            >
              {passwordValid && <Check size={13} className="shrink-0" />}
              {fieldErrors.password
                ? fieldErrors.password
                : passwordValid
                  ? 'Contraseña válida'
                  : `Mínimo ${PASSWORD_MIN} caracteres`}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isModal ? 'Registrar y Cobrar' : 'Registrar Empresa')}
            {!loading && <ArrowRight size={18} />}
          </button>

          <p className="text-xs text-slate-500 text-center mt-3">
            Al registrarte, aceptas nuestros{' '}
            <Link to="/terms" className="text-nortex-accent hover:underline">Términos de Servicio</Link>
            {' '}y{' '}
            <Link to="/privacy" className="text-nortex-accent hover:underline">Política de Privacidad</Link>.
          </p>
        </form>

        {!isModal && (
          <div className="mt-6 text-center text-sm text-slate-500">
            ¿Ya tienes cuenta? <Link to="/login" className="text-nortex-accent hover:underline">Inicia Sesión</Link>
          </div>
        )}
      </div>

    </PageWrapper>
  );
};

RegisterTenant.displayName = 'RegisterTenant';

export default React.memo(RegisterTenant);
