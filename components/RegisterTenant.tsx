import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';

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

const RegisterTenant: React.FC<RegisterTenantProps> = ({ isModal = false, initialCart = [] }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [formData, setFormData] = React.useState({
    companyName: '',
    email: '',
    password: '',
    type: 'FERRETERIA'
  });

  const updateField = React.useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = React.useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en el registro');
      }

      localStorage.setItem('nortex_token', data.token);
      localStorage.setItem('nortex_user', JSON.stringify(data.user));
      localStorage.setItem('nortex_tenant_id', data.tenant.id);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));

      if (initialCart && initialCart.length > 0) {
        const persistentCart = initialCart.map(i => ({
          ...i.product,
          quantity: i.quantity,
          costPrice: i.product.price * 0.7,
          stock: 100,
          sku: 'MOCK-SKU'
        }));
        localStorage.setItem('nortex_pending_cart', JSON.stringify(persistentCart));
        navigate('/app/pos');
      } else {
        navigate('/app/dashboard');
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [formData, initialCart, navigate]);

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
                className="w-full bg-nortex-800 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="Ej. Ferretería Los Andes"
                value={formData.companyName}
                onChange={e => updateField('companyName', e.target.value)}
              />
            </div>
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
                <option value="BOUTIQUE">Boutique / Ropa</option>
                <option value="RETAIL">Retail General</option>
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
                className="w-full bg-nortex-800 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="dueno@empresa.com"
                value={formData.email}
                onChange={e => updateField('email', e.target.value)}
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
                className="w-full bg-nortex-800 border border-nortex-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:border-nortex-accent transition-colors"
                placeholder="••••••••"
                value={formData.password}
                onChange={e => updateField('password', e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isModal ? 'Registrar y Cobrar' : 'Registrar Empresa')}
            {!loading && <ArrowRight size={18} />}
          </button>
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