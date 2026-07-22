import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { homePathFor, resolveUiMode, UI_MODE_KEY } from './utils/navigation';
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

  // Aterrizaje por rol (Fase A UX): el cajero empieza en el POS y el contador
  // en Contabilidad. En modo simple (Fase B), quien administra aterriza en
  // "Mi Negocio"; en modo completo se conserva el dashboard de siempre.
  let homePath = '/app/dashboard';
  try {
    const role: string = JSON.parse(atob(token.split('.')[1])).role || '';
    let tenantType = '';
    try { tenantType = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || ''; } catch { }
    const uiMode = resolveUiMode(tenantType, localStorage.getItem(UI_MODE_KEY));
    homePath = homePathFor(role, uiMode);
  } catch { /* token ilegible → dashboard */ }

  return (
    <Layout>
      <Routes>
        <Route path="inicio" element={<MiNegocio />} />
        <Route path="dashboard" element={<Dashboard />} />
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
  );
};

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Cargando…</div>}>
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
