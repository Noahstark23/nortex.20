import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, AlertCircle, CreditCard, PieChart, Banknote, X, Check, Clock, Lock, RefreshCw, ShoppingCart, ArrowRight, ShieldAlert, FileText, Settings, Timer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loan, Tenant } from '../types';
import { formatMoney } from '../utils/money';
import { chartColors, gridProps, axisProps, tooltipProps } from '../utils/chartTheme';
import { useNavigate } from 'react-router-dom';
import LenderDashboard from './LenderMode/LenderDashboard';
import MotorizadosPanel from './LenderMode/MotorizadosPanel';
import { fetchOnboardingStatus } from '../utils/onboardingStatus';
import {
  FISCAL_REGIME_GENERAL,
  type FiscalRegime,
  normalizeFiscalRegime,
} from '../utils/fiscalRegime';

interface FiscalData {
  taxId: string;
  address: string;
  phone: string;
  dgiAuthCode: string;
  fiscalRegime: FiscalRegime;
}

const EMPTY_FISCAL_DATA: FiscalData = {
  taxId: '',
  address: '',
  phone: '',
  dgiAuthCode: '',
  fiscalRegime: FISCAL_REGIME_GENERAL,
};

/** Lee el tipo de tenant del usuario guardado (LENDER = prestamista). */
function getTenantType(): string {
  try {
    const u = localStorage.getItem('nortex_user');
    if (u) return JSON.parse(u)?.tenant?.type || '';
  } catch { /* ignore */ }
  return '';
}

/**
 * Número finito que MANDÓ el backend, o null si el campo no vino.
 *
 * Los campos de ganancia y retiro seguro son NUEVOS en /api/dashboard/stats.
 * Si el SPA corre contra un backend que todavía no los manda, la pantalla
 * muestra "—": jamás un número inventado ni el ingreso bruto haciéndose pasar
 * por ganancia, que es exactamente el error que esta pantalla venía cometiendo.
 */
function numeroDelBackend(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Lee el rol del JWT (fuente autoritativa; el backend lo re-verifica). */
function getUserRole(): string {
  try {
    const t = localStorage.getItem('nortex_token');
    if (t) return JSON.parse(atob(t.split('.')[1]))?.role || '';
  } catch { /* ignore */ }
  return '';
}

const RetailDashboard: React.FC = () => {
  const navigate = useNavigate();
  // State for Lending
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loadingLoan, setLoadingLoan] = useState(false);
  const [tenantData, setTenantData] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeLoans, setActiveLoans] = useState<Loan[]>([]);
  const [refreshingScore, setRefreshingScore] = useState(false);
  const [scoreFactors, setScoreFactors] = useState<string[]>([]);

  // Real Chart Data
  const [chartData, setChartData] = useState<any[]>([]);

  // Smart Restock State
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);

  // Fiscal Settings State
  const [showFiscalModal, setShowFiscalModal] = useState(false);
  const [fiscalData, setFiscalData] = useState<FiscalData>(EMPTY_FISCAL_DATA);
  const [savingFiscal, setSavingFiscal] = useState(false);
  // Va acá arriba con el resto de los hooks a propósito: más abajo el componente
  // tiene dos returns tempranos (spinner de carga y estado de error), y un
  // useState después de ellos rompe el orden de hooks —pantalla en blanco con
  // "Minified React error #310"—. Lo usa `elegirRegimenFiscal`.
  const [guardandoRegimen, setGuardandoRegimen] = useState(false);

  // Deep-link del onboarding: el paso fiscal apunta a /app/dashboard?config=fiscal
  // para abrir directo el modal de Configuración DGI (la pantalla real del paso).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('config') === 'fiscal') setShowFiscalModal(true);
  }, []);

  // 📊 Today Stats & Alerts
  // Los campos nuevos (NX-01) van OPCIONALES a propósito: el SPA se despliega
  // por separado del backend y no puede asumir que ya existen.
  const [todayStats, setTodayStats] = useState<{
    totalSales: number;
    totalExpenses: number;
    netProfit: number;
    gananciaBruta?: number;
    ingresoNeto?: number;
    costoVendido?: number;
    lineasSinCosto?: number;
  } | null>(null);
  const [theftAlerts, setTheftAlerts] = useState<any[]>([]);

  // 🛡️ Survival Data (NIIF PyMES)
  const [survivalData, setSurvivalData] = useState<any>(null);

  // ⚠️ Expiring Batches
  const [expiringBatches, setExpiringBatches] = useState<any[]>([]);

  // 🚀 "Empezá acá" (retención R2): con CERO productos y CERO ventas, el panel
  // financiero era puros ceros sin un solo CTA hacia vender (auditoría C9).
  // Los conteos salen de GET /api/onboarding (ya deriva de datos reales).
  const [starterSteps, setStarterSteps] = useState<{ product: boolean; sale: boolean } | null>(null);
  const [seedingStarter, setSeedingStarter] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('nortex_token');
    if (!token) return;
    fetchOnboardingStatus(token)
      .then(d => {
        if (!d?.steps) return;
        const product = d.steps.find((s: any) => s.key === 'product');
        const sale = d.steps.find((s: any) => s.key === 'sale');
        // Solo giros que venden productos (LENDER no trae estos pasos).
        if (product && sale) setStarterSteps({ product: product.done, sale: sale.done });
      })
      .catch(() => { /* el bloque de arranque nunca rompe el panel */ });
  }, []);
  const seedStarterCatalog = async () => {
    setSeedingStarter(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/onboarding/seed-catalog', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('nortex:data-changed'));
        navigate('/app/pos?tour=pos'); // directo a probar la primera venta
      }
    } catch { /* silencioso */ } finally {
      setSeedingStarter(false);
    }
  };

  // FETCH REAL DATA
  useEffect(() => {
    const initDashboard = async () => {
      const token = localStorage.getItem('nortex_token');

      try {
        // 1. Get Dashboard Stats (Real Data)
        const res = await fetch('/api/dashboard/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setTenantData(data.tenant);
          setFiscalData({
            taxId: data.tenant.taxId || '',
            address: data.tenant.address || '',
            phone: data.tenant.phone || '',
            dgiAuthCode: data.tenant.dgiAuthCode || '',
            fiscalRegime: normalizeFiscalRegime(data.tenant.fiscalRegime),
          });
          setChartData(data.chartData);
          if (data.todayStats) setTodayStats(data.todayStats);
          if (data.alerts) setTheftAlerts(data.alerts);
          if (data.survivalData) setSurvivalData(data.survivalData);
          localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));
        }

        // 2. Refresh Credit Score (Algorithm)
        await refreshCreditScore();

        // 3. Low Stock Items (Real API)
        const lowStockRes = await fetch('/api/inventory/low-stock', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (lowStockRes.ok) {
          const critical = await lowStockRes.json();
          setLowStockItems(critical);
        }

        // 4. Expiring Batches
        const expiringRes = await fetch('/api/inventory/expiring-soon', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (expiringRes.ok) {
          const expiring = await expiringRes.json();
          setExpiringBatches(expiring);
        }

      } catch (e) {
        console.error("Dashboard Sync Failed", e);
      } finally {
        setIsLoading(false);
      }
    };
    initDashboard();
  }, []);

  const refreshCreditScore = async () => {
    setRefreshingScore(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/fintech/score', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTenantData(data.tenant);
        localStorage.setItem('nortex_tenant_data', JSON.stringify(data.tenant));
        if (data.analysis && data.analysis.factors) {
          setScoreFactors(data.analysis.factors);
        }
      }
    } catch (e) {
      console.error("Failed to refresh score", e);
    } finally {
      setRefreshingScore(false);
    }
  };

  const activeDebt = activeLoans.reduce((acc, loan) => acc + Number(loan.totalDue), 0);

  // Loading spinner
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-800/40">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-slate-400" size={32} />
          <span className="text-sm text-slate-500 font-medium">Cargando panel financiero...</span>
        </div>
      </div>
    );
  }

  // Estado de error con reintento: si la carga TERMINÓ pero no hay datos del
  // tenant, la primera llamada (/api/dashboard/stats) falló (red inestable, 500,
  // timeout — común en 3G nica). Antes el guard `!tenantData` dejaba el spinner
  // colgado PARA SIEMPRE, y este es el primer pantallazo tras registrarse
  // (rompe-primer-uso). Mostramos un reintento en vez de un spinner eterno.
  if (!tenantData) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-800/40 p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <RefreshCw className="text-slate-500" size={32} />
          <div>
            <h3 className="text-white font-semibold">No pudimos cargar tu panel</h3>
            <p className="text-sm text-slate-400 mt-1">Revisá tu conexión e intentá de nuevo.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-nortex-accent text-surface-950 text-sm font-bold rounded shadow-sm hover:opacity-90 transition-opacity"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // PAYWALL LOGIC
  const daysLeftInTrial = tenantData.trialEndsAt
    ? Math.ceil((new Date(tenantData.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  // Los CTAs de pago llevan a la pantalla de pago real. Antes esto hacía
  // POST /api/billing/subscribe — una ruta que NUNCA existió en el backend
  // (404 → "Error al procesar la suscripción"): los dos únicos botones de
  // conversión del producto estaban rotos, y encima marcaban el tenant como
  // ACTIVE en localStorage sin que hubiera pago alguno.
  const handleReactivate = () => navigate('/app/billing');

  const handleRequestLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(loanAmount);

    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto válido");
      return;
    }

    if (amount > tenantData.creditLimit) {
      alert("El monto excede su línea de crédito disponible");
      return;
    }

    setLoadingLoan(true);

    try {
      const token = localStorage.getItem('nortex_token');
      // REAL API CALL
      const res = await fetch('/api/loans/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          alert("BLOQUEADO: Suscripción vencida. Pague para continuar.");
          return;
        }
        throw new Error(data.error);
      }

      // Verdad del server: el endpoint devuelve el tenant ya actualizado
      // (wallet acreditado + línea decrementada, atómico y auditado). NO
      // recalculamos el saldo en el cliente — eso era el número fantasma.
      setTenantData(data);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(data));

      setShowLoanModal(false);
      setLoanAmount('');
      alert("¡Fondos desembolsados exitosamente!");

    } catch (error: any) {
      alert(error.message || "Error al procesar el préstamo");
    } finally {
      setLoadingLoan(false);
    }
  };

  // El RÉGIMEN se guarda solo, al elegirlo, sin pasar por "GUARDAR DATOS".
  //
  // EL PORQUÉ (medido en la pantalla real, no leído en el JSX): el formulario
  // marca RUC y DIRECCIÓN FÍSICA como `required`, así que el submit se bloquea
  // en silencio si están vacíos —el navegador muestra "Please fill out this
  // field." sobre la dirección y el modal se queda abierto—. Y el negocio de
  // CUOTA FIJA es justamente el que no tiene esos datos cargados: elegía su
  // régimen, apretaba GUARDAR y no pasaba nada. Guardar al instante es además
  // como se comportan las otras políticas del negocio (PIN de caja, stock
  // negativo), y no afloja los datos que la factura sí necesita.
  const elegirRegimenFiscal = async (fiscalRegime: FiscalRegime) => {
    if (fiscalRegime === fiscalData.fiscalRegime) return;
    const previo = fiscalData.fiscalRegime;
    setFiscalData(prev => ({ ...prev, fiscalRegime }));  // optimista: el radio responde ya
    setGuardandoRegimen(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/tenant/fiscal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ fiscalRegime }),
      });
      if (!res.ok) throw new Error('No se pudo cambiar el régimen fiscal. Reintentá.');
      const updatedTenant = await res.json();
      setTenantData(updatedTenant);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant));
      setFiscalData(prev => ({ ...prev, fiscalRegime: normalizeFiscalRegime(updatedTenant.fiscalRegime) }));
    } catch (error: any) {
      // Volver atrás: dejar el radio marcado en algo que no se guardó le diría
      // al dueño que ya no cobra IVA mientras el sistema lo sigue cobrando.
      setFiscalData(prev => ({ ...prev, fiscalRegime: previo }));
      alert(error.message);
    } finally {
      setGuardandoRegimen(false);
    }
  };

  const handleSaveFiscalData = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFiscal(true);
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/tenant/fiscal', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(fiscalData)
      });

      if (!res.ok) throw new Error('Error al guardar datos fiscales');

      const updatedTenant = await res.json();
      setTenantData(updatedTenant);
      localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant));
      setFiscalData({
        taxId: updatedTenant.taxId || '',
        address: updatedTenant.address || '',
        phone: updatedTenant.phone || '',
        dgiAuthCode: updatedTenant.dgiAuthCode || '',
        fiscalRegime: normalizeFiscalRegime(updatedTenant.fiscalRegime),
      });
      setShowFiscalModal(false);
      alert('Configuración Fiscal (DGI) actualizada correctamente.');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setSavingFiscal(false);
    }
  };

  // ── NX-01 · La ganancia del día ────────────────────────────────────────────
  // Product.price es precio de GÓNDOLA: trae el IVA (15%) adentro, y ese IVA es
  // del fisco, no del dueño. Por eso la ganancia es ingreso NETO menos costo, y
  // la calcula el backend (gananciaBruta). Acá solo se lee, defensivamente.
  const gananciaBrutaHoy = numeroDelBackend(todayStats?.gananciaBruta);
  const costoVendidoHoy = numeroDelBackend(todayStats?.costoVendido);
  const utilidadHoy = numeroDelBackend(todayStats?.netProfit);
  const lineasSinCostoRaw = numeroDelBackend(todayStats?.lineasSinCosto);
  const lineasSinCosto = lineasSinCostoRaw !== null && lineasSinCostoRaw > 0 ? Math.trunc(lineasSinCostoRaw) : 0;

  // ── NX-02 · Retiro seguro ──────────────────────────────────────────────────
  // Efectivo − cuentas por pagar − costo de reponer lo vendido. NO es
  // `liquidezLibre` (que ignora la reposición y le decía al dueño que se
  // llevara el capital de trabajo).
  const retiroSeguro = numeroDelBackend(survivalData?.retiroSeguro);

  // ── NX-05 · Score y línea de crédito ───────────────────────────────────────
  // Con una sola venta, "300/850" y una línea de C$100 no son información: son
  // cebo. Mientras no haya historial suficiente no se muestra ningún número.
  const creditScore = numeroDelBackend(tenantData.creditScore);
  const creditLimit = numeroDelBackend(tenantData.creditLimit) ?? 0;
  const historialInsuficiente = creditScore === null || creditScore <= 300 || creditLimit < 5000;
  const puedeSolicitar = !historialInsuficiente && creditScore !== null && creditScore >= 500 && creditLimit > 100;

  return (
    <div className="p-6 h-full overflow-y-auto bg-surface-800/40 text-slate-100 relative">

      {/* BILLING BANNERS */}
      {/* El estado real es 'TRIAL' (schema.prisma / server.ts), no 'TRIALING':
          con el typo, el contador de días y el CTA "ACTIVAR PLAN PRO" NUNCA se
          renderizaban → el usuario en prueba jamás veía el reloj ni la palanca
          de conversión durante su ventana de máximo valor. */}
      {tenantData.subscriptionStatus === 'TRIAL' && (
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3 text-yellow-400">
            <Clock size={20} />
            <span className="font-medium">
              Modo Prueba: Quedan <span className="font-bold">{daysLeftInTrial} días</span> gratis.
            </span>
          </div>
          <button onClick={handleReactivate} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-bold rounded shadow-sm transition-colors">
            ACTIVAR PLAN PRO
          </button>
        </div>
      )}

      {(tenantData.subscriptionStatus === 'PAST_DUE' || tenantData.subscriptionStatus === 'CANCELLED') && (
        <div className="mb-6 p-4 bg-amber-500/15 border border-amber-500/40 text-amber-100 rounded-lg shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={24} className="text-amber-400" />
            <div>
              <h3 className="font-bold text-lg text-amber-300">Tu prueba venció — seguí vendiendo</h3>
              {/* P1: NUNCA se bloquea el POS por billing. Se degrada lo accesorio,
                  no el acto de vender. El texto refleja esa política. */}
              <p className="text-amber-100/80 text-sm">Podés seguir facturando con normalidad. Activá el plan para recuperar reportes, préstamos y contabilidad.</p>
            </div>
          </div>
          <button
            onClick={handleReactivate}
            className="px-6 py-3 bg-amber-500 text-surface-950 font-bold rounded shadow-lg hover:bg-amber-400 transition-colors"
          >
            Activar plan
          </button>
        </div>
      )}

      {/* 🚀 EMPEZÁ ACÁ — arriba de TODO cuando el negocio aún no arrancó. */}
      {starterSteps && !starterSteps.sale && (
        <div className="mb-6 p-5 bg-nortex-900 border border-brand/30 rounded-xl">
          <h2 className="text-xl font-bold text-white mb-1">Empezá acá 👇</h2>
          <p className="text-slate-400 text-sm mb-4">
            {starterSteps.product
              ? 'Ya tenés productos. Te falta lo mejor: cobrar tu primera venta.'
              : 'Dos caminos para ver a Nortex funcionando en menos de 2 minutos:'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {starterSteps.product ? (
              <button
                onClick={() => navigate('/app/pos?tour=pos')}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-brand hover:bg-brand-hover text-white font-bold rounded-xl transition-all shadow-glow shadow-brand/30"
              >
                <ShoppingCart size={20} /> Hacer mi primera venta
              </button>
            ) : (
              <>
                <button
                  onClick={seedStarterCatalog}
                  disabled={seedingStarter}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-brand hover:bg-brand-hover text-white font-bold rounded-xl transition-all shadow-glow shadow-brand/30 disabled:opacity-60"
                >
                  <ShoppingCart size={20} />
                  {seedingStarter ? 'Cargando…' : 'Probar con un catálogo de ejemplo'}
                </button>
                <button
                  onClick={() => navigate('/app/inventory?tour=inv')}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-surface-800 hover:bg-surface-700 border border-white/[0.08] text-white font-bold rounded-xl transition-colors"
                >
                  <FileText size={20} /> Cargar mi primer producto
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <header className="mb-8 flex justify-between items-start">
        <div>
          {/* El menú dice "Mi Plata"; si la pantalla dijera otra cosa, el usuario
              cree que se equivocó de link (auditoría D1). */}
          <h1 className="text-3xl font-bold text-slate-100">Mi Plata</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-1 bg-blue-500/15 text-blue-400 rounded text-xs font-bold uppercase tracking-wider">{tenantData.type}</span>
            <span className="text-slate-500">{tenantData.name}</span>
            <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${tenantData.subscriptionStatus === 'ACTIVE' ? 'bg-green-500/15 text-green-400' :
              tenantData.subscriptionStatus === 'PAST_DUE' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
              }`}>
              {tenantData.subscriptionStatus}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowFiscalModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-surface-900 border border-white/[0.06] text-sm font-bold text-slate-200 rounded-lg hover:bg-surface-800/40 shadow-sm transition-colors"
        >
          <Settings size={16} /> Configuración DGI
        </button>
      </header>

      {/* --- SMART RESTOCK AI WIDGET --- */}
      {lowStockItems.length > 0 && (
        <div className="mb-8 bg-brand-soft rounded-card p-6 border border-brand/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-nortex-accent blur-[100px] opacity-10"></div>
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-brand/15 text-brand rounded-control">
                <AlertCircle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-1">Nortex AI: Alerta de Quiebre de Stock</h3>
                <p className="text-slate-400 text-sm max-w-xl">
                  Tus ventas proyectan que <span className="text-white font-bold">{lowStockItems[0].name}</span> se agotará en <span className="text-red-400 font-bold">48 horas</span>.
                  {lowStockItems.length > 1 && ` Además, otros ${lowStockItems.length - 1} productos están en nivel crítico.`}
                </p>
              </div>
            </div>
            <button
              // Antes iba a /app/marketplace → "Próximamente": la alerta más
              // urgente del dashboard creaba urgencia y cerraba la puerta.
              onClick={() => navigate('/app/smart-purchases')}
              className="h-touch px-5 bg-brand text-brand-on font-semibold rounded-control hover:bg-brand-hover transition-colors flex items-center gap-2"
            >
              <ShoppingCart size={18} /> Pedir Reabastecimiento <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* 🚨 THEFT ALERT BANNER */}
      {theftAlerts.length > 0 && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-500/15 text-red-400 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="font-bold text-red-400">Alerta de Auditoría</h3>
              <p className="text-xs text-red-500">{theftAlerts.length} discrepancia(s) detectada(s) en los últimos 7 días</p>
            </div>
          </div>
          <div className="space-y-1">
            {theftAlerts.slice(0, 3).map((alert: any) => (
              <div key={alert.id} className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg flex justify-between">
                <span>{alert.details?.cajero || 'Cajero'}: {alert.details?.tipo}</span>
                <span className="font-bold">{formatMoney(Math.abs(alert.details?.diferencia || 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ⚠️ EXPIRING BATCHES ALERT BANNER */}
      {expiringBatches.length > 0 && (
        <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-500/15 text-orange-400 rounded-lg">
              <Timer size={20} />
            </div>
            <div>
              <h3 className="font-bold text-orange-400">Alerta de Vencimiento</h3>
              <p className="text-xs text-orange-500">{expiringBatches.length} lote(s) próximo(s) a vencer (≤ 90 días)</p>
            </div>
          </div>
          <div className="space-y-1">
            {expiringBatches.slice(0, 3).map((batch: any) => {
              const isExpired = new Date(batch.expiryDate) < new Date();
              return (
                <div key={batch.id} className={`text-xs px-3 py-1.5 rounded-lg flex justify-between ${isExpired ? 'bg-red-500/15 text-red-400' : 'bg-orange-500/15 text-orange-400'}`}>
                  <span>{batch.productName} (Lote: {batch.batchNumber})</span>
                  <span className="font-bold">{new Date(batch.expiryDate).toLocaleDateString()} • {batch.stock} uds</span>
                </div>
              );
            })}
            {expiringBatches.length > 3 && (
              <div className="text-xs text-orange-400 font-semibold px-3 py-1">
                + {expiringBatches.length - 3} lotes más... Ve al Inventario para más detalles.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LA RESPUESTA ÚNICA ───────────────────────────────────────────────
          Es el motivo por el que el usuario vuelve mañana: cuánto ganó hoy.
          Antes vivía como la 3.ª tarjeta de una grilla de 3, del mismo tamaño
          que "Ventas Hoy" y con la card entera teñida de verde o rojo. Ahora va
          arriba, en tamaño display y en color de texto principal: el color no
          se usa para decorar la cifra, solo para calificar el resultado. */}
      {todayStats && (
        <div className="mb-6 bg-surface-900 border border-white/[0.06] rounded-card p-6">
          <p className="nx-label mb-1">Ganancia de hoy</p>
          {gananciaBrutaHoy === null ? (
            /* Backend sin el cálculo nuevo: guion. Mostrar acá las ventas como
               si fueran ganancia es el error que costaba la credibilidad. */
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="nx-total">—</span>
              <span className="text-sm text-slate-400">Calculando tu ganancia…</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-slate-400">
                {gananciaBrutaHoy >= 0 ? 'Ganaste' : 'Perdiste'}
              </span>
              <span className="nx-total">{formatMoney(Math.abs(gananciaBrutaHoy))}</span>
              <span className={`text-sm font-semibold ${gananciaBrutaHoy >= 0 ? 'nx-delta-up' : 'nx-delta-down'}`}>
                {gananciaBrutaHoy >= 0 ? 'en verde' : 'en rojo'}
              </span>
            </div>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Lo que vendiste, sin el IVA que es del fisco, menos lo que te costó la mercadería.
          </p>
          {/* Sin costo cargado, la ganancia sale INFLADA. Se avisa y se ofrece
              el camino para arreglarlo, en vez de dar un número que el dueño
              sabe que está mal (NX-01). */}
          {lineasSinCosto > 0 && (
            <button
              onClick={() => navigate('/app/inventory')}
              className="mt-2 text-left text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
            >
              Ganancia estimada — faltan costos en {lineasSinCosto} producto{lineasSinCosto === 1 ? '' : 's'}
            </button>
          )}
          {/* El desglose queda debajo, en jerarquía menor y sin colorear cifras. */}
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-4 pt-4 border-t border-white/[0.06]">
            <div>
              <p className="nx-label">Ventas</p>
              <p className="text-lg font-bold text-slate-100 nx-num">{formatMoney(todayStats.totalSales)}</p>
            </div>
            {costoVendidoHoy !== null && (
              <div>
                <p className="nx-label">Costo de lo vendido</p>
                <p className="text-lg font-bold text-slate-100 nx-num">{formatMoney(costoVendidoHoy)}</p>
              </div>
            )}
            <div>
              <p className="nx-label">Gastos</p>
              <p className="text-lg font-bold text-slate-100 nx-num">{formatMoney(todayStats.totalExpenses)}</p>
            </div>
            {/* netProfit solo es utilidad real cuando el backend nuevo está
                arriba (misma señal que gananciaBruta). */}
            {gananciaBrutaHoy !== null && utilidadHoy !== null && (
              <div>
                <p className="nx-label">Después de gastos</p>
                <p className="text-lg font-bold text-slate-100 nx-num">{formatMoney(utilidadHoy)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">

        {/* Wallet Card */}
        <div className="bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Saldo en Billetera</p>
              <h3 className="text-2xl font-bold text-white transition-all duration-500">{formatMoney(tenantData.walletBalance)}</h3>
            </div>
            <div className="p-2 bg-green-500/15 text-green-400 rounded-lg">
              <DollarSign size={20} />
            </div>
          </div>
        </div>

        {/* Credit Score Card */}
        <div className="bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06] relative overflow-hidden group">
          <button
            onClick={refreshCreditScore}
            className={`absolute top-2 right-2 p-1.5 rounded-full hover:bg-white/[0.06] text-slate-400 ${refreshingScore ? 'animate-spin' : ''}`}
            title="Recalcular Score"
          >
            <RefreshCw size={14} />
          </button>
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-10 rounded-bl-full"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Nortex Score</p>
              {/* NX-05: sin historial suficiente NO se muestra el número. Un
                  "300/850" tras la primera venta no describe al negocio — es el
                  piso de la escala — y el dueño lo lee como que el sistema ya lo
                  juzgó mal. En su lugar se dice qué falta, en concreto. */}
              {historialInsuficiente ? (
                <h3 className="text-lg font-bold text-slate-300">Todavía no alcanza</h3>
              ) : (
                <h3 className="text-2xl font-bold text-blue-400">{creditScore} <span className="text-sm text-slate-400 font-normal">/ 850</span></h3>
              )}
            </div>
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
              <Activity size={20} />
            </div>
          </div>
          {!historialInsuficiente && (
            <div className="w-full bg-white/[0.04] h-2 rounded-full overflow-hidden mb-2">
              <div className="bg-blue-500 h-full rounded-full transition-all duration-1000" style={{ width: `${((creditScore ?? 0) / 850) * 100}%` }}></div>
            </div>
          )}
          {historialInsuficiente ? (
            <p className="text-xs text-slate-400">
              Seguí registrando ventas: tu score se calcula con tu historial.
            </p>
          ) : scoreFactors.length > 0 ? (
            <p className="text-[10px] text-slate-500 truncate" title={scoreFactors.join(', ')}>
              Factores: {scoreFactors[0]} {scoreFactors.length > 1 && `+${scoreFactors.length - 1}`}
            </p>
          ) : (
            <p className="text-xs text-slate-400">Actualizá para calcular tu score</p>
          )}
        </div>

        {/* Credit Line Card */}
        <div className="bg-gradient-to-br from-nortex-900 to-nortex-800 text-white p-6 rounded-xl shadow-sm border border-nortex-800 ring-1 ring-white/10 relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-nortex-accent blur-[50px] opacity-20 group-hover:opacity-30 transition-opacity"></div>

          {/* NX-05: una "línea disponible" de C$100 el día 1 no compra nada y se
              lee como cebo; y un botón gris deshabilitado se lee como función
              bloqueada por no pagar. Mientras no haya historial no se muestra
              monto ni botón muerto: se muestra el camino, accionable. */}
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-sm font-medium text-slate-400">Línea Disponible</p>
              {historialInsuficiente ? (
                <h3 className="text-lg font-bold text-slate-300">Se activa con tu historial</h3>
              ) : (
                <h3 className="text-2xl font-bold text-white">{formatMoney(creditLimit)}</h3>
              )}
            </div>
            <div className="p-2 bg-white/10 text-white rounded-lg">
              <CreditCard size={20} />
            </div>
          </div>
          {historialInsuficiente ? (
            <>
              <p className="relative z-10 text-xs text-slate-400 mb-3">
                Nortex calcula tu línea con las ventas y los pagos que vas registrando. Todavía no hay suficiente movimiento.
              </p>
              <button
                onClick={() => navigate('/app/pos')}
                className="relative z-10 w-full py-2 bg-white/10 hover:bg-white/[0.16] text-white text-sm font-bold rounded transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart size={16} /> REGISTRAR UNA VENTA
              </button>
            </>
          ) : puedeSolicitar ? (
            <button
              onClick={() => setShowLoanModal(true)}
              className="relative z-10 w-full py-2 bg-nortex-accent hover:bg-emerald-400 text-slate-100 text-sm font-bold rounded transition-colors flex items-center justify-center gap-2"
            >
              <Banknote size={16} /> SOLICITAR DESEMBOLSO
            </button>
          ) : (
            <p className="relative z-10 text-xs text-slate-400 flex items-start gap-2">
              <Lock size={14} className="mt-0.5 flex-shrink-0" />
              Los desembolsos se habilitan a partir de 500 puntos. Seguí vendiendo y pagando en fecha.
            </p>
          )}
        </div>

        {/* Active Debt Card */}
        <div className="bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Deuda Activa</p>
              <h3 className="text-2xl font-bold text-red-400">{formatMoney(activeDebt)}</h3>
            </div>
            <div className="p-2 bg-red-500/15 text-red-400 rounded-lg">
              <AlertCircle size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {activeLoans.length > 0 ? `${activeLoans.length} préstamos activos` : 'Sin deudas pendientes'}
          </p>
        </div>
      </div>

      {/* 🛡️ DASHBOARD DE SUPERVIVENCIA (NIIF PyMES) */}
      {survivalData && (
        <div className="mb-8 border-t border-white/[0.06] pt-8">
          <h2 className="text-2xl font-bold text-slate-100 mb-6 flex items-center gap-2">
            <ShieldAlert className="text-emerald-400" /> Dashboard de Supervivencia
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Safe Withdrawal Widget — NX-02.
                Antes decía "Retiro Seguro Permitido: esto puedes sacarlo sin
                quebrar el negocio" sobre `liquidezLibre` (efectivo − proveedores),
                que ignora que hay que RECOMPRAR lo que se vendió: era una promesa
                que empujaba a descapitalizar el negocio. Ahora es una estimación,
                dicha como estimación, sobre `retiroSeguro` (que ya descuenta la
                reposición). La cifra va en color neutro: el color califica el
                resultado, no decora el número. */}
            <div className="p-6 rounded-card bg-surface-900 border border-white/[0.06] relative overflow-hidden flex flex-col justify-center">
              <h3 className="text-lg font-bold text-slate-100 mb-1 flex items-center gap-2">
                <Banknote size={18} className="text-slate-400" /> Cuánto podrías retirar
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                Tu efectivo, menos lo que le debés a proveedores, menos lo que cuesta reponer lo que vendiste.
              </p>
              {retiroSeguro === null ? (
                <p className="nx-total text-slate-100">—</p>
              ) : (
                <>
                  <p className="nx-total text-slate-100">{formatMoney(Math.max(retiroSeguro, 0))}</p>
                  {retiroSeguro <= 0 && (
                    <p className="text-sm text-slate-300 bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 rounded-control w-fit mt-3">
                      Hoy no sobra para retirar: primero hay que cubrir proveedores y reponer mercadería.
                    </p>
                  )}
                </>
              )}
              <p className="text-xs text-slate-500 mt-4">Estimación — no es consejo financiero.</p>
            </div>

            {/* Survival Chart */}
            <div className="lg:col-span-2 bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06]">
              <h3 className="text-lg font-bold text-slate-100 mb-1">Efectivo vs Créditos vs Deudas</h3>
              <p className="text-xs text-slate-500 mb-6">Muestra dónde está la plata (NIIF PyMES)</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: 'Efectivo Físico', monto: survivalData.efectivoTotal, fill: chartColors.brand },
                    { name: 'Cuentas x Cobrar', monto: survivalData.cuentasPorCobrar, fill: chartColors.warning },
                    { name: 'Deuda Proveedor (CxP)', monto: survivalData.cuentasPorPagar, fill: chartColors.danger },
                    { name: 'Inventario (Valor)', monto: survivalData.inventario, fill: chartColors.warning }
                  ]}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 13, fontWeight: 500 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 12 }} />
                    <Tooltip
                      {...tooltipProps()}
                      formatter={(value: number) => [formatMoney(value), 'Total']}
                    />
                    <Bar dataKey="monto" radius={[6, 6, 0, 0]} barSize={50} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06]">
          <h3 className="text-lg font-bold text-slate-100 mb-6">Flujo de Caja Real (Últimos 7 días)</h3>
          <div className="h-64 min-h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 12 }} />
                <Tooltip
                  {...tooltipProps()}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="sales" fill={chartColors.brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface-900 p-6 rounded-xl shadow-sm border border-white/[0.06]">
          <h3 className="text-lg font-bold text-slate-100 mb-6">Préstamos Activos</h3>
          <div className="h-64 overflow-y-auto custom-scrollbar pr-2">
            {activeLoans.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <PieChart size={48} className="mb-2 opacity-20" />
                <p className="text-sm">No hay actividad reciente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeLoans.map(loan => (
                  <div key={loan.id} className="p-3 bg-surface-800/40 border border-white/[0.04] rounded-lg flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock size={10} /> Vence: {new Date(loan.dueDate).toLocaleDateString()}
                      </div>
                      <div className="font-bold text-slate-200">{formatMoney(loan.amount)}</div>
                    </div>
                    <span className="text-xs font-bold bg-green-500/15 text-green-400 px-2 py-1 rounded-full">ACTIVE</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LENDING MODAL */}
      {showLoanModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/[0.06]">
            <div className="bg-nortex-900 p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-nortex-accent blur-[60px] opacity-20"></div>
              <button
                onClick={() => setShowLoanModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
              <h3 className="text-xl font-bold text-white flex items-center gap-2 relative z-10">
                <Banknote size={24} className="text-nortex-accent" /> Solicitar Capital
              </h3>
              <p className="text-slate-400 text-sm mt-1 relative z-10">Inyección de liquidez inmediata</p>
            </div>

            <form onSubmit={handleRequestLoan} className="p-6">
              <div className="mb-6">
                <label className="block text-xs font-mono text-slate-500 mb-2 font-bold">MONTO A SOLICITAR</label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    max={tenantData.creditLimit}
                    required
                    className="w-full pl-12 pr-4 py-4 text-3xl font-bold text-white border border-white/[0.06] rounded-xl focus:ring-2 focus:ring-nortex-500 focus:border-nortex-500 outline-none transition-all"
                    placeholder="0.00"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-slate-500">Disponible: <span className="font-bold text-slate-200">{formatMoney(tenantData.creditLimit)}</span></span>
                  {Number(loanAmount) > tenantData.creditLimit && (
                    <span className="text-red-500 font-bold">Excede el límite</span>
                  )}
                </div>
              </div>

              {/* Loan Breakdown */}
              {Number(loanAmount) > 0 && Number(loanAmount) <= tenantData.creditLimit && (
                <div className="bg-surface-800/40 p-4 rounded-xl border border-white/[0.06] mb-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Capital</span>
                    <span className="font-medium text-white">{formatMoney(Number(loanAmount))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Interés (5% Flat)</span>
                    <span className="font-medium text-white">{formatMoney(Number(loanAmount) * 0.05)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Plazo</span>
                    <span className="font-medium text-white">30 Días</span>
                  </div>
                  <div className="border-t border-white/[0.06] pt-2 mt-2 flex justify-between items-center">
                    <span className="font-bold text-slate-200">Total a Pagar</span>
                    <span className="font-bold text-slate-100 text-lg">{formatMoney(Number(loanAmount) * 1.05)}</span>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loadingLoan || !loanAmount || Number(loanAmount) > tenantData.creditLimit}
                className="w-full py-4 bg-nortex-900 hover:bg-nortex-800 text-white font-bold rounded-xl shadow-lg shadow-nortex-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex justify-center items-center gap-2"
              >
                {loadingLoan ? 'PROCESANDO...' : (
                  <>
                    CONFIRMAR Y RECIBIR <Check size={20} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FISCAL SETTINGS MODAL */}
      {showFiscalModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fiscal-settings-title"
            aria-describedby="fiscal-settings-description"
            className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border border-white/[0.06]"
          >
            <div className="bg-slate-800 p-6 relative overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFiscalModal(false)}
                aria-label="Cerrar configuración fiscal"
                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                <X size={20} />
              </button>
              <h3 id="fiscal-settings-title" className="text-xl font-bold text-white flex items-center gap-2 relative z-10">
                <FileText size={24} className="text-blue-400" /> Facturación DGI
              </h3>
              <p id="fiscal-settings-description" className="text-slate-300 text-sm mt-1 relative z-10">Configurá los datos fiscales para tus recibos.</p>
            </div>

            <form onSubmit={handleSaveFiscalData} className="p-6 space-y-4">
              <fieldset aria-describedby="fiscal-regime-help" className="space-y-2">
                <legend className="block text-xs font-bold text-slate-300 mb-2">RÉGIMEN FISCAL</legend>

                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  fiscalData.fiscalRegime === 'GENERAL'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 hover:border-white/20'
                }`}>
                  <input
                    type="radio"
                    name="fiscalRegime"
                    value="GENERAL"
                    checked={fiscalData.fiscalRegime === 'GENERAL'}
                    onChange={() => elegirRegimenFiscal('GENERAL')}
                    disabled={guardandoRegimen}
                    className="mt-1 h-4 w-4 accent-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-bold text-white">Régimen general</span>
                    <span className="block text-xs text-slate-400 mt-0.5">La factura calcula y desglosa el IVA.</span>
                  </span>
                </label>

                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  fiscalData.fiscalRegime === 'CUOTA_FIJA'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 hover:border-white/20'
                }`}>
                  <input
                    type="radio"
                    name="fiscalRegime"
                    value="CUOTA_FIJA"
                    checked={fiscalData.fiscalRegime === 'CUOTA_FIJA'}
                    onChange={() => elegirRegimenFiscal('CUOTA_FIJA')}
                    disabled={guardandoRegimen}
                    className="mt-1 h-4 w-4 accent-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-bold text-white">Cuota fija</span>
                    <span className="block text-xs text-slate-400 mt-0.5">La factura no calcula ni muestra un desglose de IVA.</span>
                  </span>
                </label>

                <p id="fiscal-regime-help" className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  Este cambio aplica solo a ventas nuevas. No modifica ni reescribe facturas anteriores.
                </p>
              </fieldset>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">RUC DE LA EMPRESA</label>
                <input
                  type="text"
                  required
                  className="w-full p-3 border border-white/10 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej. J0310000123456"
                  value={fiscalData.taxId}
                  onChange={e => setFiscalData({ ...fiscalData, taxId: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">DIRECCIÓN FÍSICA</label>
                <input
                  type="text"
                  required
                  className="w-full p-3 border border-white/10 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Dirección del local para la factura"
                  value={fiscalData.address}
                  onChange={e => setFiscalData({ ...fiscalData, address: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">TELÉFONO</label>
                <input
                  type="text"
                  className="w-full p-3 border border-white/10 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Teléfono (Opcional)"
                  value={fiscalData.phone}
                  onChange={e => setFiscalData({ ...fiscalData, phone: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">RESOLUCIÓN DGI (AUTORIZACIÓN)</label>
                <input
                  type="text"
                  className="w-full p-3 border border-white/10 rounded focus:ring-2 focus:ring-blue-500 outline-none bg-yellow-500/10"
                  placeholder="Ej. Autorización DGI No. 12345"
                  value={fiscalData.dgiAuthCode}
                  onChange={e => setFiscalData({ ...fiscalData, dgiAuthCode: e.target.value })}
                />
                <p className="text-xs text-slate-500 mt-1">Este código aparecerá al pie de tus tickets para darle validez fiscal.</p>
              </div>

              <div className="pt-4 border-t border-white/[0.04] flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFiscalModal(false)}
                  className="flex-1 py-3 text-slate-300 font-bold hover:bg-white/[0.06] rounded transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  disabled={savingFiscal}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded transition-colors"
                >
                  {savingFiscal ? 'GUARDANDO...' : 'GUARDAR DATOS'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Enrutador del dashboard.
 *  - Tenant LENDER + rol COLLECTOR (motorizado) → SOLO su pantalla de ruta de
 *    cobro (MotorizadosPanel). Nunca ve capital, CRM ni bóveda del inversor
 *    (Fase 0 blindaje H1). El backend además le niega esos endpoints (H2).
 *  - Tenant LENDER (dueño/admin) → cartera de préstamos (LenderDashboard).
 *  - Resto → dashboard retail.
 * Wrapper sin hooks → no rompe las Reglas de Hooks. [Cobranza A3]
 */
const Dashboard: React.FC = () => {
  if (getTenantType() === 'LENDER') {
    return getUserRole() === 'COLLECTOR' ? <MotorizadosPanel /> : <LenderDashboard />;
  }
  return <RetailDashboard />;
};

export default Dashboard;
