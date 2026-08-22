import React from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Building2, Mail, Lock, ArrowRight, Loader2, Check, AlertCircle, Phone } from 'lucide-react';
import { trackEvent } from '../utils/analytics';
import { UI_MODE_KEY } from '../utils/navigation';
import {
  suggestedCapabilitiesForBusinessType,
  type TenantCapabilityCode,
} from '../utils/tenantCapabilities';

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

const BUSINESS_TYPES = [
  { value: 'FERRETERIA', label: 'Ferretería / Construcción' },
  { value: 'PULPERIA', label: 'Pulpería / Abarrotes' },
  { value: 'FARMACIA', label: 'Farmacia' },
  { value: 'DISTRIBUIDORA', label: 'Distribuidora / Mayorista' },
  { value: 'MISCELANEA', label: 'Miscelánea' },
  { value: 'CARNICERIA_POLLERIA', label: 'Carnicería / Pollería' },
  { value: 'AGROPECUARIA', label: 'Agropecuaria' },
  { value: 'BOUTIQUE', label: 'Boutique / Ropa' },
  { value: 'RETAIL', label: 'Retail General' },
  { value: 'LENDER', label: 'Financiera / Prestamista' },
] as const;

const BUSINESS_TYPE_ALIASES: Record<string, string> = {
  FERRETERIA: 'FERRETERIA',
  FERRETERIAS: 'FERRETERIA',
  CONSTRUCCION: 'FERRETERIA',
  PULPERIA: 'PULPERIA',
  ABARROTES: 'PULPERIA',
  FARMACIA: 'FARMACIA',
  FARMACIAS: 'FARMACIA',
  DISTRIBUIDORA: 'DISTRIBUIDORA',
  MAYORISTA: 'DISTRIBUIDORA',
  MISCELANEA: 'MISCELANEA',
  CARNICERIA: 'CARNICERIA_POLLERIA',
  POLLERIA: 'CARNICERIA_POLLERIA',
  CARNICERIA_POLLERIA: 'CARNICERIA_POLLERIA',
  AGROPECUARIA: 'AGROPECUARIA',
  BOUTIQUE: 'BOUTIQUE',
  ROPA: 'BOUTIQUE',
  RETAIL: 'RETAIL',
  COMERCIO: 'RETAIL',
  LENDER: 'LENDER',
  FINANCIERA: 'LENDER',
  PRESTAMISTA: 'LENDER',
};

const normalizeBusinessType = (value: string | null): string => {
  if (!value) return '';
  const normalized = value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  return BUSINESS_TYPE_ALIASES[normalized] || '';
};

const RegisterTenant: React.FC<RegisterTenantProps> = ({ isModal = false, initialCart = [] }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const registrationContext = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    const type = [params.get('type'), params.get('giro')]
      .map(normalizeBusinessType)
      .find(Boolean) || '';

    return {
      email: params.get('email')?.trim() || '',
      type,
    };
  }, [location.search]);
  const registrationSource = React.useMemo(() => {
    if (isModal) return 'demo_modal';
    return new URLSearchParams(location.search).get('source') || 'direct';
  }, [isModal, location.search]);
  const startedAtRef = React.useRef(Date.now());
  const trackedStartRef = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  // Errores por campo, mapeados desde `details` (validate() los devuelve como
  // { campo: [mensajes] }). Sin esto el usuario solo veía el genérico y quedaba mudo.
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formData, setFormData] = React.useState({
    companyName: '',
    email: registrationContext.email,
    password: '',
    phone: '',
    // Sin contexto explícito, pedimos el giro. El backend conserva FERRETERIA
    // como fallback legado, pero el alta pública ya no debe clasificar negocios
    // distintos silenciosamente.
    type: registrationContext.type,
    capabilities: suggestedCapabilitiesForBusinessType(registrationContext.type),
  });

  React.useEffect(() => {
    if (trackedStartRef.current) return;
    trackedStartRef.current = true;
    trackEvent('register_started', {
      source: registrationSource,
      has_demo_cart: initialCart.length > 0,
    });
  }, [initialCart.length, registrationSource]);

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

  const updateBusinessType = React.useCallback((value: string) => {
    setFormData(prev => ({
      ...prev,
      type: value,
      capabilities: suggestedCapabilitiesForBusinessType(value),
    }));
    setFieldErrors(prev => {
      if (!prev.type) return prev;
      const next = { ...prev };
      delete next.type;
      return next;
    });
  }, []);

  const updateCapability = React.useCallback((code: TenantCapabilityCode, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      capabilities: checked
        ? [...new Set([...prev.capabilities, code])]
        : prev.capabilities.filter(item => item !== code),
    }));
  }, []);

  // Validación en vivo de la contraseña (espejo de la regla del backend).
  const passwordLen = formData.password.length;
  const passwordTooShort = passwordLen > 0 && passwordLen < PASSWORD_MIN;
  const passwordValid = passwordLen >= PASSWORD_MIN;

  const handleSubmit = React.useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    // Cortamos antes de ir al server si falta contexto o la contraseña no cumple:
    // evita el ida-y-vuelta y muestra todos los ajustes en un solo intento.
    const clientErrors: Record<string, string> = {};
    if (formData.password.length < PASSWORD_MIN) {
      clientErrors.password = `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
    }
    if (!formData.type) {
      clientErrors.type = 'Seleccioná el tipo de negocio para continuar';
    }
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
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
      // La preferencia era global al navegador: al crear una empresa nueva podía
      // heredar el modo completo de otra cuenta usada antes en el mismo equipo.
      // Cada alta empieza en la experiencia calmada; el prestamista conserva su
      // panel dedicado, que ya es reducido.
      localStorage.setItem(UI_MODE_KEY, formData.type === 'LENDER' ? 'full' : 'simple');

      // Conversiones GA4: el registro exitoso ES el alta (sign_up) y a la vez el
      // inicio de la prueba gratis (el tenant nace en TRIAL). Se disparan acá, en
      // el callback de ÉXITO — nunca en el submit — para no contar intentos fallidos.
      trackEvent('sign_up', {
        method: 'email',
        business_type: formData.type,
        source: registrationSource,
        seconds_to_signup: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      });
      trackEvent('begin_trial', { business_type: formData.type, source: registrationSource });

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
  }, [formData, initialCart, navigate, registrationSource]);

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
            {isModal ? 'Registra tu negocio gratis para imprimir este ticket.' : 'Empieza a gestionar tu negocio hoy.'}
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
                name="organization"
                autoComplete="organization"
                required
                className={`w-full bg-nortex-800 border text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none transition-colors ${fieldErrors.companyName ? 'border-red-500/70 focus:border-red-500' : 'border-nortex-700 focus:border-nortex-accent'}`}
                placeholder="Ej. Mi Negocio"
                value={formData.companyName}
                onChange={e => updateField('companyName', e.target.value)}
              />
            </div>
            {fieldErrors.companyName && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.companyName}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">TIPO DE NEGOCIO</label>
            <select
              name="businessType"
              required
              aria-invalid={Boolean(fieldErrors.type)}
              className={`w-full bg-nortex-800 border text-white px-4 py-3 rounded-lg focus:outline-none transition-colors ${fieldErrors.type ? 'border-red-500/70 focus:border-red-500' : 'border-nortex-700 focus:border-nortex-accent'}`}
              value={formData.type}
              onChange={e => updateBusinessType(e.target.value)}
            >
              <option value="" disabled>Seleccioná tu tipo de negocio</option>
              {BUSINESS_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {fieldErrors.type && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.type}</p>
            )}
          </div>

          <fieldset className="rounded-lg border border-nortex-700 bg-nortex-800/50 p-3">
            <legend className="px-1 text-xs font-mono text-slate-400">TAMBIÉN VENDO</legend>
            <p className="mb-2 text-xs text-slate-500">Podés combinar opciones; no cambian tus impuestos automáticamente.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['CARNES_AVES', 'Carne o pollo por peso'],
                ['ALIMENTO_ANIMAL', 'Alimento para animales'],
                ['AGROINSUMOS', 'Insumos agropecuarios'],
                ['PERECEDEROS', 'Productos con lote/vencimiento'],
                ['MAYOREO', 'Venta por mayor o sacos'],
              ] as const).map(([code, label]) => (
                <label key={code} className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-nortex-600 bg-nortex-900 text-nortex-accent"
                    checked={formData.capabilities.includes(code)}
                    onChange={event => updateCapability(code, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">EMAIL ADMINISTRADOR</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="email"
                name="email"
                autoComplete="email"
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
                name="tel"
                autoComplete="tel"
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
                name="new-password"
                autoComplete="new-password"
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
