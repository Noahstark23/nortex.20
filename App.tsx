import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { VentaEnCursoProvider } from './components/VentaEnCursoContext';
import { trackPageView } from './utils/analytics';
import { homePathFor } from './utils/navigation';
import { currentSessionRole } from './utils/roleCapabilities';
import PwaUpdateNotice from './components/PwaUpdateNotice';

// ── Camino crítico EAGER: login, registro y la primera pantalla post-login.
// Solo esto entra al bundle inicial — es lo que un usuario NUEVO necesita
// para llegar a valor en su primera visita, con la red que tenga.
import Login from './components/Login';
import RegisterTenant from './components/RegisterTenant';
import MiNegocio from './components/MiNegocio';

// ── Todo lo demás LAZY por ruta (UX-2). Antes era UN archivo de 2.2 MB
// (616 KB gzip): 12–20 s hasta interactivo en el Android de gama baja del
// cliente real — el asesino #1 de la retención del día 1. Cada ruta baja su
// chunk al visitarse, y el SW los precachea tras el primer load, así que la
// PWA instalada sigue abriendo todo offline.
const Blog = lazy(() => import('./components/Blog'));
const BlogPost = lazy(() => import('./components/BlogPost'));
const ClusterPage = lazy(() => import('./components/ClusterPage'));
const GuestPOS = lazy(() => import('./components/GuestPOS'));
const POS = lazy(() => import('./components/POS'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const BlueprintViewer = lazy(() => import('./components/BlueprintViewer'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const AccountsReceivable = lazy(() => import('./components/AccountsReceivable'));
const B2BMarketplace = lazy(() => import('./components/B2BMarketplace'));
const Reports = lazy(() => import('./components/Reports'));
const QuotationManager = lazy(() => import('./components/QuotationManager'));
const Clients = lazy(() => import('./components/Clients'));
const Suppliers = lazy(() => import('./components/Suppliers'));
const HRM = lazy(() => import('./components/HRM'));
const MiEspacio = lazy(() => import('./components/MiEspacio'));
const SuperAdmin = lazy(() => import('./components/SuperAdmin'));
const DeliveryManager = lazy(() => import('./components/DeliveryManager'));
const DriverView = lazy(() => import('./components/DriverView'));
const RegistroRepartidor = lazy(() => import('./components/RegistroRepartidor'));
const Inventory = lazy(() => import('./components/Inventory'));
const Warehouses = lazy(() => import('./components/Warehouses'));
const CargaVendedor = lazy(() => import('./components/CargaVendedor'));
const PurchaseOrders = lazy(() => import('./components/PurchaseOrders'));
const Serials = lazy(() => import('./components/Serials'));
const ScaleSettings = lazy(() => import('./components/ScaleSettings'));
const StockCount = lazy(() => import('./components/StockCount'));
const SmartPurchases = lazy(() => import('./components/SmartPurchases'));
const CashRegisters = lazy(() => import('./components/CashRegisters'));
const Purchases = lazy(() => import('./components/Purchases'));
const FinancialHealth = lazy(() => import('./components/FinancialHealth'));
const AuditDashboard = lazy(() => import('./components/AuditDashboard'));
const Contabilidad = lazy(() => import('./components/Contabilidad'));
const Billing = lazy(() => import('./components/Billing'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const HelpCenter = lazy(() => import('./components/HelpCenter'));
const PublicCatalog = lazy(() => import('./components/PublicCatalog'));
const TrackPedido = lazy(() => import('./components/TrackPedido'));

// SEO Landing Pages (en prod las sirve el prerender estático; el chunk solo
// baja si alguien navega a ellas DENTRO del SPA)
const LandingFerreteria = lazy(() => import('./components/LandingFerreteria'));
const LandingFarmacia = lazy(() => import('./components/LandingFarmacia'));
const LandingNicaragua = lazy(() => import('./components/LandingNicaragua'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));

// Legal pages
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./components/TermsOfService'));

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
  const authRole = currentSessionRole();
  try {
    let tenantType = '';
    try { tenantType = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || ''; } catch { }
    homePath = tenantType === 'LENDER' ? '/app/dashboard' : homePathFor(authRole, 'simple');
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
      {/* Suspense INTERNO: al cargar el chunk de una ruta, el shell (menú,
          bottom-nav) queda en su lugar y solo el contenido muestra "Cargando…".
          Sin esto, el Suspense raíz blanquearía la app entera en cada primera
          visita a una pantalla. */}
      <Suspense fallback={<div className="min-h-[40vh] flex items-center justify-center text-slate-400">Cargando…</div>}>
      <Routes>
        {authRole === 'BODEGUERO' ? (
          <>
            {/* El menú orienta; esta guarda evita que una URL guardada abra
                pantallas administrativas antes de que responda el backend. La
                autorización real sigue siendo server-side. */}
            <Route path="inventory" element={<Inventory />} />
            <Route path="warehouses" element={<Warehouses />} />
            <Route path="inventory-count" element={<StockCount />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="ayuda" element={<HelpCenter />} />
            <Route path="*" element={<Navigate to={homePath} replace />} />
          </>
        ) : (
          <>
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
        <Route path="scales" element={<ScaleSettings />} />
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
          </>
        )}
      </Routes>
      </Suspense>
    </Layout>
    </VentaEnCursoProvider>
  );
};

type LocalAuthPayload = {
  userId?: string;
  tenantId?: string;
  role?: string;
  exp?: number;
  nbf?: number;
};

/**
 * Decodifica solo el payload local del JWT para decidir la navegación inicial.
 * La autorización real sigue perteneciendo al backend; aquí únicamente evitamos
 * tratar como visitante a quien acaba de volver con una sesión local coherente.
 */
function decodeLocalAuthPayload(token: string): LocalAuthPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as LocalAuthPayload;
  } catch {
    return null;
  }
}

/**
 * Devuelve el inicio correcto solo si token y usuario guardado describen la
 * misma sesión y el JWT todavía está dentro de su ventana de validez.
 * Un dato incompleto o contradictorio degrada a la landing pública, nunca a un
 * destino privilegiado. El backend vuelve a verificar firma, usuario y tenant
 * al cargar cualquier dato protegido.
 */
function returningUserHomePath(): string | null {
  try {
    const token = localStorage.getItem('nortex_token');
    const storedUser = localStorage.getItem('nortex_user');
    if (!token || !storedUser) return null;

    const payload = decodeLocalAuthPayload(token);
    const user = JSON.parse(storedUser) as {
      id?: string;
      role?: string;
      tenant?: { id?: string; type?: string };
    };
    if (!payload?.userId || !payload.tenantId || !payload.role || !user.id || !user.role) return null;

    const now = Date.now();
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) return null;
    if (payload.userId !== user.id || payload.role !== user.role) return null;

    const storedTenantId = localStorage.getItem('nortex_tenant_id');
    if (storedTenantId && storedTenantId !== payload.tenantId) return null;
    if (user.tenant?.id && user.tenant.id !== payload.tenantId) return null;

    if (payload.role === 'SUPER_ADMIN') return '/admin';

    let tenantType = user.tenant?.type || '';
    if (!tenantType) {
      try {
        tenantType = JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}')?.type || '';
      } catch { /* el tipo es opcional; el rol sigue definiendo un home seguro */ }
    }
    // Debe coincidir con ProtectedApp: el modo del menú no altera el lugar al
    // que la persona vuelve. El dueño/admin retoma en Mi Negocio, mientras los
    // roles operativos aterrizan directamente en su tarea diaria.
    return tenantType === 'LENDER' ? '/app/dashboard' : homePathFor(payload.role, 'simple');
  } catch {
    return null;
  }
}

const PublicLanding = () => {
  const homePath = returningUserHomePath();
  return homePath ? <Navigate to={homePath} replace /> : <LandingPage />;
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

/**
 * Mantiene el mismo contexto visual mientras baja el chunk lazy del blog.
 * El fallback global oscuro hacía que una navegación editorial mostrara un
 * fogonazo Obsidian antes de aterrizar en la superficie clara del artículo.
 */
function RouteFallback() {
  const { pathname } = useLocation();

  if (pathname === '/blog' || pathname.startsWith('/blog/')) {
    return (
      <div className="nx-public-loading" role="status" aria-live="polite">
        <img src="/icon-192.svg" alt="" className="h-8 w-8 rounded-control" aria-hidden="true" />
        <span>Cargando recursos…</span>
      </div>
    );
  }

  return <div className="min-h-[60vh] flex items-center justify-center text-slate-400">Cargando…</div>;
}

function App() {
  return (
    <BrowserRouter>
      <RouteAnalytics />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<PublicLanding />} />
          <Route path="/register" element={<RegisterTenant />} />
          <Route path="/demo" element={<GuestPOS />} />
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
      <PwaUpdateNotice />
    </BrowserRouter>
  );
}

export default App;
