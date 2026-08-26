import React from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Building2, Mail, Lock, ArrowRight, Loader2, Check, AlertCircle, Phone, Eye, EyeOff } from 'lucide-react';
import { trackEvent } from '../utils/analytics';
import { UI_MODE_KEY } from '../utils/navigation';
import { postRegistrationDestination, uiModeForNewTenant } from '../utils/releaseRouting';
import {
  firstPublicRegistrationError,
  normalizePublicAcquisitionSource,
  normalizeRegistrationIntent,
  validatePublicRegistration,
  type PublicRegistrationErrors,
  type PublicRegistrationField,
} from '../utils/publicActivation';
import {
  suggestedCapabilitiesForBusinessType,
  type TenantCapabilityCode,
} from '../utils/tenantCapabilities';

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

const RegisterTenant: React.FC = () => {
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
      source: normalizePublicAcquisitionSource(params.get('source')),
      intent: normalizeRegistrationIntent(params.get('intent')),
    };
  }, [location.search]);
  const startedAtRef = React.useRef(Date.now());
  const trackedStartRef = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  // Errores por campo, mapeados desde `details` (validate() los devuelve como
  // { campo: [mensajes] }). Sin esto el usuario solo veía el genérico y quedaba mudo.
  const [fieldErrors, setFieldErrors] = React.useState<PublicRegistrationErrors>({});
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
      source: registrationContext.source,
      from_demo: Boolean(registrationContext.intent),
    });
  }, [registrationContext.intent, registrationContext.source]);

  const updateField = React.useCallback((field: PublicRegistrationField, value: string) => {
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

    const clientErrors = validatePublicRegistration(formData);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setError('Revisá los campos indicados para continuar.');
      const firstInvalidField = firstPublicRegistrationError(clientErrors);
      if (firstInvalidField) {
        requestAnimationFrame(() => document.getElementById(`register-${firstInvalidField}`)?.focus());
      }
      return;
    }

    setLoading(true);

    try {
      const payload = {
        ...formData,
        companyName: formData.companyName.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
      };
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // El middleware validate() responde { error, details: { campo: [msgs] } }.
        // Mapeamos ese detalle al campo (y al mensaje general) en vez de mostrar
        // solo el genérico "Datos de entrada inválidos".
        const details = data?.details;
        if (details && typeof details === 'object') {
          const fe: PublicRegistrationErrors = {};
          for (const [k, v] of Object.entries(details)) {
            if (Array.isArray(v) && v.length && ['companyName', 'email', 'password', 'phone', 'type'].includes(k)) {
              fe[k as PublicRegistrationField] = String(v[0]);
            }
          }
          setFieldErrors(fe);
          const firstDetail = Object.values(fe)[0];
          setError(firstDetail || data?.error || 'Revisá los datos e intentá de nuevo.');
          const firstInvalidField = firstPublicRegistrationError(fe);
          if (firstInvalidField) {
            requestAnimationFrame(() => document.getElementById(`register-${firstInvalidField}`)?.focus());
          }
        } else {
          setError(data?.error || 'No pudimos completar el registro. Intentá de nuevo.');
        }
        return;
      }

      if (!data?.token || !data?.user || !data?.tenant?.id) {
        setError('La cuenta se creó, pero no pudimos iniciar tu sesión. Entrá con tu correo para continuar.');
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
      const uiMode = uiModeForNewTenant(formData.type);
      localStorage.setItem(UI_MODE_KEY, uiMode);

      // Conversiones GA4: el registro exitoso ES el alta (sign_up) y a la vez el
      // inicio de la prueba gratis (el tenant nace en TRIAL). Se disparan acá, en
      // el callback de ÉXITO — nunca en el submit — para no contar intentos fallidos.
      trackEvent('sign_up', {
        method: 'email',
        business_type: formData.type,
        source: registrationContext.source,
        seconds_to_signup: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      });
      trackEvent('begin_trial', { business_type: formData.type, source: registrationContext.source });

      // Navegación DIRECTA al valor (retención R1): el modal-peaje del PIN
      // interrumpía el momento de máximo impulso con un concepto ("apertura de
      // caja") que el usuario nuevo aún no tiene, y si no tocaba "Continuar"
      // perdía la bienvenida para siempre. El PIN 1234 ahora viaja en el email
      // de bienvenida y el POS ya lo muestra como hint al abrir caja.
      navigate(postRegistrationDestination({
        role: data.user.role,
        tenantType: formData.type,
        intent: registrationContext.intent,
      }));

    } catch {
      setError('No pudimos conectar con el servidor. Revisá tu internet e intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [formData, navigate, registrationContext.intent, registrationContext.source]);

  const controlClass = (invalid: boolean, valid = false) => [
    'w-full rounded-control border bg-white/[0.03] py-3 text-white outline-none transition-colors',
    invalid
      ? 'border-red-500/70 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
      : valid
        ? 'border-brand/50 focus:border-brand focus:ring-2 focus:ring-brand/20'
        : 'border-white/[0.10] focus:border-brand focus:ring-2 focus:ring-brand/20',
  ].join(' ');

  return (
    <main className="min-h-[100dvh] bg-surface-950 px-4 py-8 text-slate-100 sm:py-12">
      <section className="panel-premium relative mx-auto w-full max-w-md bg-surface-900/90 p-6 sm:p-8" aria-labelledby="register-title">
        <header className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-control bg-brand text-lg font-bold text-surface-950">
            N
          </div>
          <h1 id="register-title" className="text-2xl font-bold tracking-tight text-white">Creá tu cuenta Nortex</h1>
          <p className="mt-2 text-sm text-slate-400">30 días gratis. Sin tarjeta. Empezá con tu primera venta.</p>
        </header>

        {error && (
          <div role="alert" aria-live="assertive" className="mb-5 flex items-start gap-2 rounded-control border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-busy={loading}>
          <div>
            <label htmlFor="register-companyName" className="mb-1.5 block text-sm font-medium text-slate-300">Nombre del negocio</label>
            <div className="relative">
              <Building2 aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                id="register-companyName"
                type="text"
                name="companyName"
                autoComplete="organization"
                required
                maxLength={120}
                aria-invalid={Boolean(fieldErrors.companyName)}
                aria-describedby={fieldErrors.companyName ? 'register-companyName-error' : undefined}
                className={`${controlClass(Boolean(fieldErrors.companyName))} pl-10 pr-4`}
                placeholder="Ej. Ferretería San José"
                value={formData.companyName}
                onChange={e => updateField('companyName', e.target.value)}
              />
            </div>
            {fieldErrors.companyName && <p id="register-companyName-error" className="mt-1 text-xs text-red-400">{fieldErrors.companyName}</p>}
          </div>

          <div>
            <label htmlFor="register-type" className="mb-1.5 block text-sm font-medium text-slate-300">Tipo de negocio</label>
            <select
              id="register-type"
              name="type"
              required
              aria-invalid={Boolean(fieldErrors.type)}
              aria-describedby={fieldErrors.type ? 'register-type-error' : undefined}
              className={`${controlClass(Boolean(fieldErrors.type))} px-4`}
              value={formData.type}
              onChange={e => updateBusinessType(e.target.value)}
            >
              <option value="" disabled>Seleccioná tu tipo de negocio</option>
              {BUSINESS_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            {fieldErrors.type && <p id="register-type-error" className="mt-1 text-xs text-red-400">{fieldErrors.type}</p>}
          </div>

          <details className="rounded-control border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              Opciones de inventario (opcional)
              {formData.capabilities.length > 0 ? ` · ${formData.capabilities.length} activas` : ''}
            </summary>
            <fieldset className="mt-3 border-t border-white/[0.08] pt-3">
              <legend className="sr-only">Opciones de inventario</legend>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">Elegí solo si vendés por peso, lote o mayoreo. Podés cambiarlo después.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['CARNES_AVES', 'Carne o pollo por peso'],
                  ['ALIMENTO_ANIMAL', 'Alimento para animales'],
                  ['AGROINSUMOS', 'Insumos agropecuarios'],
                  ['PERECEDEROS', 'Productos con lote o vencimiento'],
                  ['MAYOREO', 'Venta por mayor o sacos'],
                ] as const).map(([code, label]) => (
                  <label key={code} className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-surface-950 text-brand focus:ring-brand/40"
                      checked={formData.capabilities.includes(code)}
                      onChange={event => updateCapability(code, event.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </details>

          <div>
            <label htmlFor="register-email" className="mb-1.5 block text-sm font-medium text-slate-300">Correo del administrador</label>
            <div className="relative">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                id="register-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
                className={`${controlClass(Boolean(fieldErrors.email))} pl-10 pr-4`}
                placeholder="dueno@empresa.com"
                value={formData.email}
                onChange={e => updateField('email', e.target.value)}
              />
            </div>
            {fieldErrors.email && <p id="register-email-error" className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
          </div>

          <div>
            <label htmlFor="register-phone" className="mb-1.5 block text-sm font-medium text-slate-300">
              WhatsApp <span className="font-normal text-slate-500">(opcional)</span>
            </label>
            <div className="relative">
              <Phone aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                id="register-phone"
                type="tel"
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                maxLength={20}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'register-phone-error' : 'register-phone-hint'}
                className={`${controlClass(Boolean(fieldErrors.phone))} pl-10 pr-4`}
                placeholder="8888 8888"
                value={formData.phone}
                onChange={e => updateField('phone', e.target.value)}
              />
            </div>
            {fieldErrors.phone
              ? <p id="register-phone-error" className="mt-1 text-xs text-red-400">{fieldErrors.phone}</p>
              : <p id="register-phone-hint" className="mt-1 text-xs text-slate-500">Solo para ayudarte a arrancar; no compartimos tu número.</p>}
          </div>

          <div>
            <label htmlFor="register-password" className="mb-1.5 block text-sm font-medium text-slate-300">Contraseña</label>
            <div className="relative">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={200}
                aria-invalid={Boolean(fieldErrors.password || passwordTooShort)}
                aria-describedby="register-password-hint"
                className={`${controlClass(Boolean(fieldErrors.password || passwordTooShort), passwordValid)} pl-10 pr-12`}
                placeholder="••••••••"
                value={formData.password}
                onChange={e => updateField('password', e.target.value)}
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
            <p id="register-password-hint" className={`mt-1 flex items-center gap-1 text-xs ${(fieldErrors.password || passwordTooShort) ? 'text-red-400' : passwordValid ? 'text-brand' : 'text-slate-500'}`}>
              {passwordValid && <Check aria-hidden="true" size={13} className="shrink-0" />}
              {fieldErrors.password || (passwordValid ? 'Contraseña lista' : `Mínimo ${PASSWORD_MIN} caracteres`)}
            </p>
          </div>

          <button type="submit" disabled={loading} className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100">
            {loading ? <><Loader2 aria-hidden="true" className="animate-spin" size={19} /> Creando tu negocio…</> : <>Crear mi negocio <ArrowRight aria-hidden="true" size={18} /></>}
          </button>

          <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
            Al registrarte, aceptás nuestros <Link to="/terms" className="text-brand hover:underline">Términos</Link> y <Link to="/privacy" className="text-brand hover:underline">Privacidad</Link>.
          </p>
        </form>

        <div className="mt-6 border-t border-white/[0.06] pt-5 text-center text-sm text-slate-500">
          ¿Ya tenés cuenta? <Link to="/login" className="font-medium text-brand hover:text-brand-hover">Entrá aquí</Link>
        </div>
      </section>
    </main>
  );
};

RegisterTenant.displayName = 'RegisterTenant';

export default React.memo(RegisterTenant);
