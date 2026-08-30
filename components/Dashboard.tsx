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
      <div className="nx-light-context nx-workspace h-full flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-pill border border-slate-200 bg-white shadow-sm">
            <RefreshCw className="animate-spin text-brand" size={20} aria-hidden="true" />
          </div>
          <span className="text-sm text-slate-600 font-medium">Cargando tu negocio…</span>
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
      <div className="nx-light-context nx-workspace h-full flex items-center justify-center bg-slate-50 p-6">
        <div className="nx-canvas-card flex max-w-sm flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-pill bg-slate-100 text-slate-600">
            <RefreshCw size={20} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-slate-950 font-semibold">No pudimos cargar tu panel</h3>
            <p className="text-sm text-slate-600 mt-1">Revisá tu conexión e intentá de nuevo.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="nx-fluid-press h-touch rounded-control bg-brand px-5 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
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
    <div className="nx-light-context nx-workspace h-full overflow-y-auto bg-slate-50 text-slate-950 relative">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="nx-module-header mb-6 flex min-h-0 flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="nx-label mb-1 text-slate-500">Resumen del negocio</p>
            {/* El menú dice "Mi Plata"; si la pantalla dijera otra cosa, el usuario
                cree que se equivocó de link (auditoría D1). */}
            <h1 className="text-display font-bold tracking-[-0.035em] text-slate-950">Mi Plata</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-700">{tenantData.name}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-500">{tenantData.type}</span>
              <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${tenantData.subscriptionStatus === 'ACTIVE' ? 'bg-green-500/10 text-green-700' :
                tenantData.subscriptionStatus === 'PAST_DUE' ? 'bg-red-500/10 text-red-700' : 'bg-yellow-500/10 text-yellow-700'
                }`}>
                {tenantData.subscriptionStatus}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFiscalModal(true)}
            className="nx-fluid-press inline-flex h-touch items-center justify-center gap-2 self-start rounded-control border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring sm:self-auto"
          >
            <Settings size={17} aria-hidden="true" /> Configuración DGI
          </button>
        </header>

        <nav aria-label="Accesos directos" className="nx-list-surface mb-6 grid grid-cols-2 gap-px overflow-hidden bg-slate-200 md:grid-cols-4">
          <button
            type="button"
            onClick={() => navigate('/app/pos')}
            className="nx-fluid-press flex min-h-[72px] items-center gap-3 bg-white px-4 text-left hover:bg-slate-100 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand text-brand-on"><ShoppingCart size={18} aria-hidden="true" /></span>
            <span><span className="block text-sm font-semibold text-slate-900">Nueva venta</span><span className="block text-xs text-slate-500">Abrir el POS</span></span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/inventory')}
            className="nx-fluid-press flex min-h-[72px] items-center gap-3 bg-white px-4 text-left hover:bg-slate-100 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-slate-100 text-slate-700"><FileText size={18} aria-hidden="true" /></span>
            <span><span className="block text-sm font-semibold text-slate-900">Inventario</span><span className="block text-xs text-slate-500">Productos y costos</span></span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/smart-purchases')}
            className="nx-fluid-press flex min-h-[72px] items-center gap-3 bg-white px-4 text-left hover:bg-slate-100 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-slate-100 text-slate-700"><CreditCard size={18} aria-hidden="true" /></span>
            <span><span className="block text-sm font-semibold text-slate-900">Compras</span><span className="block text-xs text-slate-500">Reabastecer</span></span>
          </button>
          <button
            type="button"
            onClick={() => setShowFiscalModal(true)}
            className="nx-fluid-press flex min-h-[72px] items-center gap-3 bg-white px-4 text-left hover:bg-slate-100 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-slate-100 text-slate-700"><Settings size={18} aria-hidden="true" /></span>
            <span><span className="block text-sm font-semibold text-slate-900">Facturación</span><span className="block text-xs text-slate-500">Datos DGI</span></span>
          </button>
        </nav>

      {/* BILLING BANNERS */}
      {/* El estado real es 'TRIAL' (schema.prisma / server.ts), no 'TRIALING':
          con el typo, el contador de días y el CTA "ACTIVAR PLAN PRO" NUNCA se
          renderizaban → el usuario en prueba jamás veía el reloj ni la palanca
          de conversión durante su ventana de máximo valor. */}
      {tenantData.subscriptionStatus === 'TRIAL' && (
        <div role="status" className="nx-list-surface mb-6 flex flex-col gap-4 border-yellow-500/25 bg-yellow-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-yellow-800">
            <Clock size={20} aria-hidden="true" />
            <span className="text-sm font-medium">
              Modo Prueba: Quedan <span className="font-bold">{daysLeftInTrial} días</span> gratis.
            </span>
          </div>
          <button onClick={handleReactivate} className="nx-fluid-press h-touch rounded-control bg-yellow-500 px-4 text-sm font-semibold text-slate-950 shadow-sm hover:bg-yellow-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600">
            Activar plan Pro
          </button>
        </div>
      )}

      {(tenantData.subscriptionStatus === 'PAST_DUE' || tenantData.subscriptionStatus === 'CANCELLED') && (
        <div role="alert" className="nx-list-surface mb-6 flex flex-col gap-4 border-amber-500/30 bg-amber-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Clock size={22} className="shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-slate-950">Tu prueba venció — seguí vendiendo</h3>
              {/* P1: NUNCA se bloquea el POS por billing. Se degrada lo accesorio,
                  no el acto de vender. El texto refleja esa política. */}
              <p className="mt-0.5 text-sm text-slate-600">Podés seguir facturando con normalidad. Activá el plan para recuperar reportes, préstamos y contabilidad.</p>
            </div>
          </div>
          <button
            onClick={handleReactivate}
            className="nx-fluid-press h-touch shrink-0 rounded-control bg-amber-500 px-5 text-sm font-semibold text-slate-950 hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            Activar plan
          </button>
        </div>
      )}

      {/* 🚀 EMPEZÁ ACÁ — arriba de TODO cuando el negocio aún no arrancó. */}
      {starterSteps && !starterSteps.sale && (
        <section aria-labelledby="starter-heading" className="nx-canvas-card mb-6 overflow-hidden border-brand/25 bg-brand-soft p-5 sm:p-6">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand text-brand-on"><ShoppingCart size={19} aria-hidden="true" /></span>
            <div>
              <h2 id="starter-heading" className="text-title font-bold text-slate-950">Empezá acá</h2>
              <p className="mt-1 text-sm text-slate-600">
            {starterSteps.product
              ? 'Ya tenés productos. Te falta lo mejor: cobrar tu primera venta.'
              : 'Dos caminos para ver a Nortex funcionando en menos de 2 minutos:'}
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            {starterSteps.product ? (
              <button
                onClick={() => navigate('/app/pos?tour=pos')}
                className="nx-fluid-press flex h-touch flex-1 items-center justify-center gap-2 rounded-control bg-brand px-6 font-semibold text-brand-on shadow-sm hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                <ShoppingCart size={19} aria-hidden="true" /> Hacer mi primera venta
              </button>
            ) : (
              <>
                <button
                  onClick={seedStarterCatalog}
                  disabled={seedingStarter}
                  className="nx-fluid-press flex h-touch flex-1 items-center justify-center gap-2 rounded-control bg-brand px-6 font-semibold text-brand-on shadow-sm hover:bg-brand-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                  <ShoppingCart size={19} aria-hidden="true" />
                  {seedingStarter ? 'Cargando…' : 'Probar con un catálogo de ejemplo'}
                </button>
                <button
                  onClick={() => navigate('/app/inventory?tour=inv')}
                  className="nx-fluid-press flex h-touch flex-1 items-center justify-center gap-2 rounded-control border border-slate-300 bg-white px-6 font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                  <FileText size={19} aria-hidden="true" /> Cargar mi primer producto
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {(lowStockItems.length > 0 || theftAlerts.length > 0 || expiringBatches.length > 0) && (
        <section aria-labelledby="attention-heading" className="mb-8">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="attention-heading" className="text-title font-bold text-slate-950">Requiere atención</h2>
            <span className="text-xs font-medium text-slate-500">Información de hoy</span>
          </div>
          <div className="nx-list-surface divide-y divide-slate-200 overflow-hidden">
            {/* --- SMART RESTOCK AI WIDGET --- */}
            {lowStockItems.length > 0 && (
              <article className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                    <AlertCircle size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-950">Stock por agotarse</h3>
                    <p className="mt-0.5 text-sm text-slate-600">
                      <span className="font-semibold text-slate-800">{lowStockItems[0].name}</span> podría agotarse en 48 horas.
                      {lowStockItems.length > 1 && ` Hay otros ${lowStockItems.length - 1} productos en nivel crítico.`}
                    </p>
                  </div>
                </div>
                <button
                  // Antes iba a /app/marketplace → "Próximamente": la alerta más
                  // urgente del dashboard creaba urgencia y cerraba la puerta.
                  onClick={() => navigate('/app/smart-purchases')}
                  className="nx-fluid-press inline-flex h-touch shrink-0 items-center justify-center gap-2 rounded-control border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                  Pedir reabastecimiento <ArrowRight size={16} aria-hidden="true" />
                </button>
              </article>
            )}

            {/* 🚨 THEFT ALERT BANNER */}
            {theftAlerts.length > 0 && (
              <article className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-red-500/10 text-red-700">
                    <ShieldAlert size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-950">Alerta de auditoría</h3>
                    <p className="mt-0.5 text-sm text-slate-600">{theftAlerts.length} discrepancia(s) detectada(s) en los últimos 7 días</p>
                    <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                      {theftAlerts.slice(0, 3).map((alert: any) => (
                        <li key={alert.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                          <span className="truncate text-slate-600">{alert.details?.cajero || 'Cajero'}: {alert.details?.tipo}</span>
                          <span className="nx-num shrink-0 font-semibold text-red-700">{formatMoney(Math.abs(alert.details?.diferencia || 0))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            )}

            {/* ⚠️ EXPIRING BATCHES ALERT BANNER */}
            {expiringBatches.length > 0 && (
              <article className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-orange-500/10 text-orange-700">
                    <Timer size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-950">Lotes próximos a vencer</h3>
                    <p className="mt-0.5 text-sm text-slate-600">{expiringBatches.length} lote(s) vencen dentro de los próximos 90 días</p>
                    <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                      {expiringBatches.slice(0, 3).map((batch: any) => {
                        const isExpired = new Date(batch.expiryDate) < new Date();
                        return (
                          <li key={batch.id} className="flex flex-col justify-between gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
                            <span className="truncate text-slate-700">{batch.productName} <span className="text-slate-500">· Lote {batch.batchNumber}</span></span>
                            <span className={`nx-num shrink-0 font-semibold ${isExpired ? 'text-red-700' : 'text-orange-700'}`}>
                              {new Date(batch.expiryDate).toLocaleDateString()} · {batch.stock} uds
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {expiringBatches.length > 3 && (
                      <p className="mt-2 text-xs font-medium text-orange-700">
                        Hay {expiringBatches.length - 3} lotes más en Inventario.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>
      )}

      {/* ── LA RESPUESTA ÚNICA ───────────────────────────────────────────────
          Es el motivo por el que el usuario vuelve mañana: cuánto ganó hoy.
          Antes vivía como la 3.ª tarjeta de una grilla de 3, del mismo tamaño
          que "Ventas Hoy" y con la card entera teñida de verde o rojo. Ahora va
          arriba, en tamaño display y en color de texto principal: el color no
          se usa para decorar la cifra, solo para calificar el resultado. */}
      {todayStats && (
        <section aria-labelledby="profit-heading" className="nx-canvas-card mb-6 overflow-hidden p-5 sm:p-6 lg:p-8">
          <p className="nx-label mb-2 text-slate-500">Resultado de hoy</p>
          <h2 id="profit-heading" className="sr-only">Ganancia de hoy</h2>
          {gananciaBrutaHoy === null ? (
            /* Backend sin el cálculo nuevo: guion. Mostrar acá las ventas como
               si fueran ganancia es el error que costaba la credibilidad. */
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="nx-total text-slate-950">—</span>
              <span className="text-sm text-slate-600">Calculando tu ganancia…</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-slate-600">
                {gananciaBrutaHoy >= 0 ? 'Ganaste' : 'Perdiste'}
              </span>
              <span className="nx-total text-slate-950">{formatMoney(Math.abs(gananciaBrutaHoy))}</span>
              <span className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${gananciaBrutaHoy >= 0 ? 'bg-green-500/10 text-green-700' : 'bg-red-500/10 text-red-700'}`}>
                {gananciaBrutaHoy >= 0 ? 'Positivo' : 'Negativo'}
              </span>
            </div>
          )}
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Lo que vendiste, sin el IVA que es del fisco, menos lo que te costó la mercadería.
          </p>
          {/* Sin costo cargado, la ganancia sale INFLADA. Se avisa y se ofrece
              el camino para arreglarlo, en vez de dar un número que el dueño
              sabe que está mal (NX-01). */}
          {lineasSinCosto > 0 && (
            <button
              onClick={() => navigate('/app/inventory')}
              className="nx-fluid-press mt-2 inline-flex min-h-tap items-center rounded-control text-left text-xs font-medium text-amber-700 underline underline-offset-4 hover:text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
            >
              Ganancia estimada — faltan costos en {lineasSinCosto} producto{lineasSinCosto === 1 ? '' : 's'}
            </button>
          )}
          {/* El desglose queda debajo, en jerarquía menor y sin colorear cifras. */}
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-slate-200 pt-5 lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="nx-label text-slate-500">Ventas</dt>
              <dd className="nx-num mt-1 truncate text-lg font-semibold text-slate-950">{formatMoney(todayStats.totalSales)}</dd>
            </div>
            {costoVendidoHoy !== null && (
              <div className="min-w-0">
                <dt className="nx-label text-slate-500">Costo de lo vendido</dt>
                <dd className="nx-num mt-1 truncate text-lg font-semibold text-slate-950">{formatMoney(costoVendidoHoy)}</dd>
              </div>
            )}
            <div className="min-w-0">
              <dt className="nx-label text-slate-500">Gastos</dt>
              <dd className="nx-num mt-1 truncate text-lg font-semibold text-slate-950">{formatMoney(todayStats.totalExpenses)}</dd>
            </div>
            {/* netProfit solo es utilidad real cuando el backend nuevo está
                arriba (misma señal que gananciaBruta). */}
            {gananciaBrutaHoy !== null && utilidadHoy !== null && (
              <div className="min-w-0">
                <dt className="nx-label text-slate-500">Después de gastos</dt>
                <dd className="nx-num mt-1 truncate text-lg font-semibold text-slate-950">{formatMoney(utilidadHoy)}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Stats Grid */}
      <section aria-label="Indicadores del negocio" className="nx-list-surface mb-8 grid grid-cols-1 gap-px overflow-hidden bg-slate-200 md:grid-cols-2 xl:grid-cols-4">

        {/* Wallet Card */}
        <article className="bg-white p-5 sm:p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="nx-label text-slate-500">Saldo en billetera</p>
              <h3 className="nx-num mt-1 text-kpi font-bold tracking-tight text-slate-950 transition-all duration-500">{formatMoney(tenantData.walletBalance)}</h3>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-green-500/10 text-green-700"><DollarSign size={18} aria-hidden="true" /></span>
          </div>
          <p className="text-xs text-slate-500">Disponible según los movimientos registrados.</p>
        </article>

        {/* Credit Score Card */}
        <article className="relative overflow-hidden bg-white p-5 sm:p-6">
          <button
            type="button"
            onClick={refreshCreditScore}
            aria-label="Recalcular Nortex Score"
            className="nx-fluid-press absolute right-4 top-4 flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
            title="Recalcular Score"
          >
            <RefreshCw size={16} aria-hidden="true" className={refreshingScore ? 'animate-spin' : ''} />
          </button>
          <div className="flex justify-between items-start mb-4">
            <div className="pr-10">
              <p className="nx-label text-slate-500">Nortex Score</p>
              {/* NX-05: sin historial suficiente NO se muestra el número. Un
                  "300/850" tras la primera venta no describe al negocio — es el
                  piso de la escala — y el dueño lo lee como que el sistema ya lo
                  juzgó mal. En su lugar se dice qué falta, en concreto. */}
              {historialInsuficiente ? (
                <h3 className="mt-1 text-lg font-semibold text-slate-800">Todavía no alcanza</h3>
              ) : (
                <h3 className="nx-num mt-1 text-kpi font-bold text-slate-950">{creditScore} <span className="text-sm font-normal text-slate-500">/ 850</span></h3>
              )}
            </div>
          </div>
          {!historialInsuficiente && (
            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-pill bg-slate-100" role="progressbar" aria-label="Nortex Score" aria-valuemin={0} aria-valuemax={850} aria-valuenow={creditScore ?? 0}>
              <div className="h-full rounded-pill bg-brand transition-all duration-1000" style={{ width: `${((creditScore ?? 0) / 850) * 100}%` }}></div>
            </div>
          )}
          {historialInsuficiente ? (
            <p className="text-xs text-slate-600">
              Seguí registrando ventas: tu score se calcula con tu historial.
            </p>
          ) : scoreFactors.length > 0 ? (
            <p className="truncate text-xs text-slate-500" title={scoreFactors.join(', ')}>
              Factores: {scoreFactors[0]} {scoreFactors.length > 1 && `+${scoreFactors.length - 1}`}
            </p>
          ) : (
            <p className="text-xs text-slate-600">Actualizá para calcular tu score</p>
          )}
        </article>

        {/* Credit Line Card */}
        <article className="relative overflow-hidden bg-white p-5 sm:p-6">

          {/* NX-05: una "línea disponible" de C$100 el día 1 no compra nada y se
              lee como cebo; y un botón gris deshabilitado se lee como función
              bloqueada por no pagar. Mientras no haya historial no se muestra
              monto ni botón muerto: se muestra el camino, accionable. */}
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="nx-label text-slate-500">Línea disponible</p>
              {historialInsuficiente ? (
                <h3 className="mt-1 text-lg font-semibold text-slate-800">Se activa con tu historial</h3>
              ) : (
                <h3 className="nx-num mt-1 text-kpi font-bold text-slate-950">{formatMoney(creditLimit)}</h3>
              )}
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-slate-100 text-slate-700"><CreditCard size={18} aria-hidden="true" /></span>
          </div>
          {historialInsuficiente ? (
            <>
              <p className="relative z-10 mb-3 text-xs text-slate-600">
                Nortex calcula tu línea con las ventas y los pagos que vas registrando. Todavía no hay suficiente movimiento.
              </p>
              <button
                onClick={() => navigate('/app/pos')}
                className="nx-fluid-press relative z-10 flex h-touch w-full items-center justify-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                <ShoppingCart size={16} aria-hidden="true" /> Registrar una venta
              </button>
            </>
          ) : puedeSolicitar ? (
            <button
              onClick={() => setShowLoanModal(true)}
              className="nx-fluid-press relative z-10 flex h-touch w-full items-center justify-center gap-2 rounded-control bg-brand px-3 text-sm font-semibold text-brand-on hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
            >
              <Banknote size={16} aria-hidden="true" /> Solicitar desembolso
            </button>
          ) : (
            <p className="relative z-10 flex items-start gap-2 text-xs text-slate-600">
              <Lock size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              Los desembolsos se habilitan a partir de 500 puntos. Seguí vendiendo y pagando en fecha.
            </p>
          )}
        </article>

        {/* Active Debt Card */}
        <article className="bg-white p-5 sm:p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="nx-label text-slate-500">Deuda activa</p>
              <h3 className="nx-num mt-1 text-kpi font-bold text-slate-950">{formatMoney(activeDebt)}</h3>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-red-500/10 text-red-700"><AlertCircle size={18} aria-hidden="true" /></span>
          </div>
          <p className="text-xs text-slate-600">
            {activeLoans.length > 0 ? `${activeLoans.length} préstamos activos` : 'Sin deudas pendientes'}
          </p>
        </article>
      </section>

      {/* 🛡️ DASHBOARD DE SUPERVIVENCIA (NIIF PyMES) */}
      {survivalData && (
        <section aria-labelledby="survival-heading" className="mb-8">
          <div className="mb-4">
            <p className="nx-label mb-1 text-slate-500">Salud financiera</p>
            <h2 id="survival-heading" className="text-title font-bold text-slate-950">Capacidad del negocio</h2>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

            {/* Safe Withdrawal Widget — NX-02.
                Antes decía "Retiro Seguro Permitido: esto puedes sacarlo sin
                quebrar el negocio" sobre `liquidezLibre` (efectivo − proveedores),
                que ignora que hay que RECOMPRAR lo que se vendió: era una promesa
                que empujaba a descapitalizar el negocio. Ahora es una estimación,
                dicha como estimación, sobre `retiroSeguro` (que ya descuenta la
                reposición). La cifra va en color neutro: el color califica el
                resultado, no decora el número. */}
            <article className="nx-canvas-card relative flex flex-col justify-center overflow-hidden p-5 sm:p-6">
              <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-control bg-slate-100 text-slate-700"><Banknote size={19} aria-hidden="true" /></span>
              <h3 className="text-lg font-semibold text-slate-950">Cuánto podrías retirar</h3>
              <p className="mb-6 mt-1 text-sm text-slate-600">
                Tu efectivo, menos lo que le debés a proveedores, menos lo que cuesta reponer lo que vendiste.
              </p>
              {retiroSeguro === null ? (
                <p className="nx-total text-slate-950">—</p>
              ) : (
                <>
                  <p className="nx-total text-slate-950">{formatMoney(Math.max(retiroSeguro, 0))}</p>
                  {retiroSeguro <= 0 && (
                    <p className="mt-3 w-fit rounded-control border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      Hoy no sobra para retirar: primero hay que cubrir proveedores y reponer mercadería.
                    </p>
                  )}
                </>
              )}
              <p className="mt-4 text-xs text-slate-500">Estimación — no es consejo financiero.</p>
            </article>

            {/* Survival Chart */}
            <article className="nx-canvas-card p-5 sm:p-6 lg:col-span-2">
              <h3 className="text-lg font-semibold text-slate-950">Dónde está la plata</h3>
              <p className="mb-6 mt-1 text-sm text-slate-600">Efectivo, cuentas por cobrar, deudas e inventario.</p>
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
            </article>

          </div>
        </section>
      )}

      {/* Charts Section */}
      <section aria-labelledby="activity-heading" className="mb-8">
        <div className="mb-4">
          <p className="nx-label mb-1 text-slate-500">Últimos 7 días</p>
          <h2 id="activity-heading" className="text-title font-bold text-slate-950">Actividad y caja</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <article className="nx-canvas-card p-5 sm:p-6 lg:col-span-2">
          <h3 className="mb-6 text-lg font-semibold text-slate-950">Flujo de caja real</h3>
          <div className="h-64 min-h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 12 }} />
                <Tooltip
                  {...tooltipProps()}
                />
                <Bar dataKey="sales" fill={chartColors.brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="nx-canvas-card overflow-hidden p-5 sm:p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-950">Préstamos activos</h3>
          <div className="h-64 overflow-y-auto custom-scrollbar pr-2">
            {activeLoans.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-500">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-pill bg-slate-100"><PieChart size={21} aria-hidden="true" /></span>
                <p className="text-sm font-medium text-slate-700">No hay préstamos activos</p>
                <p className="mt-1 text-xs text-slate-500">Tu historial aparecerá aquí.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 border-y border-slate-200">
                {activeLoans.map(loan => (
                  <li key={loan.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock size={12} aria-hidden="true" /> Vence: {new Date(loan.dueDate).toLocaleDateString()}
                      </div>
                      <div className="nx-num mt-0.5 font-semibold text-slate-950">{formatMoney(loan.amount)}</div>
                    </div>
                    <span className="rounded-pill bg-green-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-green-700">Activo</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
        </div>
      </section>

      </div>

      {/* LENDING MODAL */}
      {showLoanModal && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-dialog-title"
            aria-describedby="loan-dialog-description"
            className="nx-dark-context w-full max-w-md overflow-hidden rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl"
          >
            <div className="relative overflow-hidden border-b border-white/[0.06] p-6">
              <button
                type="button"
                onClick={() => setShowLoanModal(false)}
                aria-label="Cerrar solicitud de capital"
                className="nx-fluid-press absolute right-4 top-4 flex h-touch w-touch items-center justify-center rounded-control text-slate-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                <X size={19} aria-hidden="true" />
              </button>
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand"><Banknote size={19} aria-hidden="true" /></span>
              <h3 id="loan-dialog-title" className="relative z-10 flex items-center gap-2 text-title font-bold text-white">
                Solicitar capital
              </h3>
              <p id="loan-dialog-description" className="relative z-10 mt-1 text-sm text-slate-400">Revisá el monto y el total antes de confirmar.</p>
            </div>

            <form onSubmit={handleRequestLoan} className="p-6">
              <div className="mb-6">
                <label htmlFor="loan-amount" className="nx-label mb-2 block text-slate-400">Monto a solicitar</label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
                  <input
                    id="loan-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    max={tenantData.creditLimit}
                    required
                    className="nx-num h-[64px] w-full rounded-control border border-white/[0.10] bg-surface-800 pl-12 pr-4 text-3xl font-bold text-white outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand-ring"
                    placeholder="0.00"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="mt-2 flex justify-between gap-4 text-xs">
                  <span className="text-slate-500">Disponible: <span className="nx-num font-semibold text-slate-200">{formatMoney(tenantData.creditLimit)}</span></span>
                  {Number(loanAmount) > tenantData.creditLimit && (
                    <span className="font-semibold text-red-400">Excede el límite</span>
                  )}
                </div>
              </div>

              {/* Loan Breakdown */}
              {Number(loanAmount) > 0 && Number(loanAmount) <= tenantData.creditLimit && (
                <dl className="mb-6 divide-y divide-white/[0.06] rounded-card border border-white/[0.08] bg-surface-800/40 px-4">
                  <div className="flex justify-between text-sm">
                    <dt className="py-3 text-slate-400">Capital</dt>
                    <dd className="nx-num py-3 font-medium text-white">{formatMoney(Number(loanAmount))}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="py-3 text-slate-400">Interés (5% Flat)</dt>
                    <dd className="nx-num py-3 font-medium text-white">{formatMoney(Number(loanAmount) * 0.05)}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="py-3 text-slate-400">Plazo</dt>
                    <dd className="py-3 font-medium text-white">30 días</dd>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <dt className="py-3 font-semibold text-slate-200">Total a pagar</dt>
                    <dd className="nx-num py-3 text-lg font-bold text-white">{formatMoney(Number(loanAmount) * 1.05)}</dd>
                  </div>
                </dl>
              )}

              <button
                type="submit"
                disabled={loadingLoan || !loanAmount || Number(loanAmount) > tenantData.creditLimit}
                className="nx-fluid-press flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-on shadow-sm hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                {loadingLoan ? 'Procesando…' : (
                  <>
                    Confirmar y recibir <Check size={19} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FISCAL SETTINGS MODAL */}
      {showFiscalModal && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fiscal-settings-title"
            aria-describedby="fiscal-settings-description"
            className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-card border border-slate-200 bg-white shadow-2xl"
          >
            <div className="relative overflow-hidden border-b border-slate-200 p-6">
              <button
                type="button"
                onClick={() => setShowFiscalModal(false)}
                aria-label="Cerrar configuración fiscal"
                className="nx-fluid-press absolute right-4 top-4 flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                <X size={19} aria-hidden="true" />
              </button>
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand"><FileText size={19} aria-hidden="true" /></span>
              <h3 id="fiscal-settings-title" className="relative z-10 text-title font-bold text-slate-950">
                Facturación DGI
              </h3>
              <p id="fiscal-settings-description" className="relative z-10 mt-1 text-sm text-slate-600">Configurá los datos fiscales para tus recibos.</p>
            </div>

            <form onSubmit={handleSaveFiscalData} className="p-6 space-y-4">
              <fieldset aria-describedby="fiscal-regime-help" className="space-y-2">
                <legend className="nx-label mb-2 block text-slate-600">
                  Régimen fiscal
                  {guardandoRegimen && <span aria-live="polite" className="ml-2 font-normal normal-case text-slate-500">guardando…</span>}
                </legend>

                <label className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                  fiscalData.fiscalRegime === 'GENERAL'
                    ? 'border-brand bg-brand-soft'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="fiscalRegime"
                    value="GENERAL"
                    checked={fiscalData.fiscalRegime === 'GENERAL'}
                    disabled={guardandoRegimen}
                    onChange={() => elegirRegimenFiscal('GENERAL')}
                    className="mt-1 h-4 w-4 accent-brand disabled:opacity-50"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-950">Régimen general</span>
                    <span className="mt-0.5 block text-xs text-slate-600">La factura calcula y desglosa el IVA.</span>
                  </span>
                </label>

                <label className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                  fiscalData.fiscalRegime === 'CUOTA_FIJA'
                    ? 'border-brand bg-brand-soft'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="fiscalRegime"
                    value="CUOTA_FIJA"
                    checked={fiscalData.fiscalRegime === 'CUOTA_FIJA'}
                    disabled={guardandoRegimen}
                    onChange={() => elegirRegimenFiscal('CUOTA_FIJA')}
                    className="mt-1 h-4 w-4 accent-brand disabled:opacity-50"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-950">Cuota fija</span>
                    <span className="mt-0.5 block text-xs text-slate-600">La factura no calcula ni muestra un desglose de IVA.</span>
                  </span>
                </label>

                <p id="fiscal-regime-help" className="rounded-control border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs text-amber-800">
                  Este cambio aplica solo a ventas nuevas. No modifica ni reescribe facturas anteriores.
                </p>
              </fieldset>

              <div>
                <label htmlFor="fiscal-tax-id" className="nx-label mb-1.5 block text-slate-600">RUC de la empresa</label>
                <input
                  id="fiscal-tax-id"
                  type="text"
                  required
                  className="h-touch w-full rounded-control border border-slate-300 bg-white px-3 text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring"
                  placeholder="Ej. J0310000123456"
                  value={fiscalData.taxId}
                  onChange={e => setFiscalData({ ...fiscalData, taxId: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="fiscal-address" className="nx-label mb-1.5 block text-slate-600">Dirección física</label>
                <input
                  id="fiscal-address"
                  type="text"
                  required
                  className="h-touch w-full rounded-control border border-slate-300 bg-white px-3 text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring"
                  placeholder="Dirección del local para la factura"
                  value={fiscalData.address}
                  onChange={e => setFiscalData({ ...fiscalData, address: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="fiscal-phone" className="nx-label mb-1.5 block text-slate-600">Teléfono</label>
                <input
                  id="fiscal-phone"
                  type="text"
                  className="h-touch w-full rounded-control border border-slate-300 bg-white px-3 text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring"
                  placeholder="Teléfono (Opcional)"
                  value={fiscalData.phone}
                  onChange={e => setFiscalData({ ...fiscalData, phone: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="fiscal-auth-code" className="nx-label mb-1.5 block text-slate-600">Resolución DGI (autorización)</label>
                <input
                  id="fiscal-auth-code"
                  type="text"
                  className="h-touch w-full rounded-control border border-slate-300 bg-white px-3 text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring"
                  placeholder="Ej. Autorización DGI No. 12345"
                  value={fiscalData.dgiAuthCode}
                  onChange={e => setFiscalData({ ...fiscalData, dgiAuthCode: e.target.value })}
                />
                <p className="mt-1.5 text-xs text-slate-500">Este código aparecerá al pie de tus tickets para darle validez fiscal.</p>
              </div>

              <div className="flex gap-3 border-t border-slate-200 pt-5">
                <button
                  type="button"
                  onClick={() => setShowFiscalModal(false)}
                  className="nx-fluid-press h-touch flex-1 rounded-control border border-slate-300 bg-white px-4 font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingFiscal}
                  className="nx-fluid-press h-touch flex-1 rounded-control bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                  {savingFiscal ? 'Guardando…' : 'Guardar datos'}
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
