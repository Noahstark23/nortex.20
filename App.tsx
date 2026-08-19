import React, { Suspense, lazy, useEffect, useRef } from 'react';

// Blog (lazy: el contenido de los artículos NO entra al bundle inicial del SPA).
// Restaurados: el merge de #61/#62 borró estas declaraciones pero dejó las rutas
// que las usan (Blog/BlogPost/ClusterPage), rompiendo la compilación.
const Blog = lazy(() => import('./components/Blog'));
const BlogPost = lazy(() => import('./components/BlogPost'));
const ClusterPage = lazy(() => import('./components/ClusterPage'));
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { VentaEnCursoProvider } from './components/VentaEnCursoContext';
import { trackPageView } from './utils/analytics';
import { homePathFor } from './utils/navigation';
import MiNegocio from './components/MiNegocio';
import POS from './components/POS';
import Dashboard from './components/Dashboard';
import BlueprintViewer from './components/BlueprintViewer';
import LandingPage from './components/LandingPage';
import RegisterTenant from './components/RegisterTenant';
import AccountsReceivable from './components/AccountsReceivable';
import B2BMarketplace from './components/B2BMarketplace';
import Reports from './components/Reports';
import Login from './components/Login';
import QuotationManager from './components/QuotationManager';
import Clients from './components/Clients';
import Suppliers from './components/Suppliers';
import HRM from './components/HRM';
import MiEspacio from './components/MiEspacio';
import SuperAdmin from './components/SuperAdmin';
import DeliveryManager from './components/DeliveryManager';
import DriverView from './components/DriverView';
import RegistroRepartidor from './components/RegistroRepartidor';
import Inventory from './components/Inventory';
import Warehouses from './components/Warehouses';
import CargaVendedor from './components/CargaVendedor';
import PurchaseOrders from './components/PurchaseOrders';
import Serials from './components/Serials';
import StockCount from './components/StockCount';
import SmartPurchases from './components/SmartPurchases';
import CashRegisters from './components/CashRegisters';
import Purchases from './components/Purchases';
import FinancialHealth from './components/FinancialHealth';
import AuditDashboard from './components/AuditDashboard';
import Contabilidad from './components/Contabilidad';
import Billing from './components/Billing';
import TeamManagement from './components/TeamManagement';
import HelpCenter from './components/HelpCenter';
import PublicCatalog from './components/PublicCatalog';
import TrackPedido from './components/TrackPedido';

// SEO Landing Pages
import LandingFerreteria from './components/LandingFerreteria';
import LandingFarmacia from './components/LandingFarmacia';
import LandingNicaragua from './components/LandingNicaragua';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';

// Legal pages
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';

const ProtectedApp = () => {
  const token = localStorage.getItem('nortex_token');
  if (!token) return <Navigate to="/login" replace />;

  // Sesión vencida → expulsión LIMPIA hacia el login con su aviso ("Tu sesión
  // venció, volvé a entrar"). Antes solo se chequeaba que la cadena existiera:
  // con el JWT expirado, cada pantalla fallaba por su lado con "revisá tu
  // conexión" o alerts de "Token inválido" y nadie decía la verdad simple.
  try {
    const exp: number | undefined = JSON.parse(atob(token.split('.')[1])).exp;
    if (exp && exp * 1000 < Date.now()) {
      localStorage.removeItem('nortex_token');
      return <Navigate to="/login?error=session_expired" replace />;
    }
  } catch { /* token ilegible: lo dejará caer el backend con 401 */ }

  // Aterrizaje por rol (NX-07): el cajero empieza en el POS y el contador en
  // Contabilidad. Quien administra aterriza SIEMPRE en "Mi Negocio"
  // (/app/inicio) — saludo por nombre, 4 números comprensibles y 4 acciones
  // grandes — y ya NO en "Mi Plata" (/app/dashboard): el día 1 esa pantalla es
  // Nortex Score, línea de crédito, "Dashboard de Supervivencia" y dos gráficos,
  // todo en cero. Es la peor primera pantalla del producto y ahí se perdía la
  // retención del día 1.
  //
  // El modo del MENÚ (simple/completo) ya no decide el aterrizaje: quien elige
  // ver el menú completo no está pidiendo empezar el día en contabilidad, y
  // "Mi Plata" sigue a un clic desde el menú y desde Mi Negocio.
  // Excepción: el prestamista (LENDER) conserva su panel — "Mi Negocio" es una
  // pantalla de retail (ventas, fiado, productos) que no describe su operación.
  let homePath = '/app/inicio';
  try {
    const role: string = JSON.parse(atob(token.split('.')[1])).role || '';
    let tenantType = '';
    try { tenantType = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || ''; } catch { }
    homePath = tenantType === 'LENDER' ? '/app/dashboard' : homePathFor(role, 'simple');
  } catch { /* token ilegible → Mi Negocio, que degrada sin datos a "—" */ }

  // El registro (RegisterTenant) y el correo de bienvenida mandan a
  // /app/dashboard?welcome=1: justo el primer pantallazo que esta corrección
  // quiere evitar. Se reencamina al aterrizaje del rol CONSERVANDO ?welcome=1,
  // que es lo que dispara la bienvenida del OnboardingHub. Sin ese parámetro
  // (menú, enlaces internos, deep-link ?config=fiscal) "Mi Plata" abre normal.
  const vieneDeLaBienvenida = new URLSearchParams(window.location.search).get('welcome') === '1';
  const reencaminarBienvenida = vieneDeLaBienvenida && homePath !== '/app/dashboard';

  return (
    <VentaEnCursoProvider>
    <Layout>
      <Routes>
        <Route path="inicio" element={<MiNegocio />} />
        <Route
          path="dashboard"
          element={reencaminarBienvenida ? <Navigate to={`${homePath}?welcome=1`} replace /> : <Dashboard />}
        />
        <Route path="pos" element={<POS />} />
        <Route path="clients" element={<Clients />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="hr" element={<HRM />} />
        <Route path="mi-espacio" element={<MiEspacio />} />
        <Route path="quotations" element={<QuotationManager />} />
        <Route path="receivables" element={<AccountsReceivable />} />
        <Route path="reports" element={<Reports />} />
        <Route path="marketplace" element={<B2BMarketplace />} />
        <Route path="blueprint" element={<BlueprintViewer />} />
        <Route path="delivery" element={<DeliveryManager />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="warehouses" element={<Warehouses />} />
        <Route path="mi-carga" element={<CargaVendedor />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="serials" element={<Serials />} />
        <Route path="inventory-count" element={<StockCount />} />
        {/* ── Rutas registradas para evitar redirección silenciosa ── */}
        <Route path="cash-registers" element={<CashRegisters />} />
        <Route path="smart-purchases" element={<SmartPurchases />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="financial-health" element={<FinancialHealth />} />
        <Route path="audit" element={<AuditDashboard />} />
        <Route path="accounting" element={<Contabilidad />} />
        <Route path="billing" element={<Billing />} />
        <Route path="team" element={<TeamManagement />} />
        {/* Rutas del prestamista (Fase 2 H7): cada item del menú LENDER llega a
            su tab real del panel (LenderDashboard vía <Dashboard/>), en vez de
            caer en las pantallas de retail. */}
        <Route path="cartera" element={<Dashboard />} />
        <Route path="cobros" element={<Dashboard />} />
        <Route path="cobradores" element={<Dashboard />} />
        <Route path="ayuda" element={<HelpCenter />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
    </Layout>
    </VentaEnCursoProvider>
  );
};

/**
 * Envía un page_view de GA4 en cada cambio de ruta del SPA. React Router no
 * recarga la página, así que sin esto GA4 solo vería el primer load. Salta el
 * render inicial: ese page_view ya lo mandó gtag('config') en analytics.js, así
 * no se duplica. Debe vivir DENTRO de <BrowserRouter> (usa useLocation).
 */
function RouteAnalytics() {
  const location = useLocation();
  const isInitialLoad = useRef(true);
  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <RouteAnalytics />
      <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center text-slate-400">Cargando…</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/register" element={<RegisterTenant />} />
          <Route path="/login" element={<Login />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/ferreterias" element={<LandingFerreteria />} />
          <Route path="/farmacias" element={<LandingFarmacia />} />
          <Route path="/nicaragua" element={<LandingNicaragua />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/categoria/:slug" element={<ClusterPage />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/admin" element={<SuperAdmin />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/pedidos/:slug" element={<PublicCatalog />} />
          <Route path="/catalog/:slug" element={<PublicCatalog />} />
          {/* App del repartidor: login teléfono+PIN. /driver/:id queda por
              compatibilidad con links viejos — ahora solo muestra el login. */}
          <Route path="/driver" element={<DriverView />} />
          <Route path="/track/:pedidoId" element={<TrackPedido />} />
          <Route path="/driver/:id" element={<DriverView />} />
          <Route path="/repartidor/registro" element={<RegistroRepartidor />} />
          <Route path="/app/*" element={<ProtectedApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
