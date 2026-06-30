import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
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

// SEO Landing Pages & Blog
import LandingFerreteria from './components/LandingFerreteria';
import LandingFarmacia from './components/LandingFarmacia';
import LandingNicaragua from './components/LandingNicaragua';
// Blog: lazy-load — el contenido de marketing crece (cientos de artículos) y no
// debe pesar en el bundle inicial del SPA (límite de precache del PWA).
const Blog = lazy(() => import('./components/Blog'));
const BlogPost = lazy(() => import('./components/BlogPost'));
const ClusterPage = lazy(() => import('./components/ClusterPage'));
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';

// Legal pages
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';

// Fallback liviano mientras se carga el chunk del blog (lazy).
const BlogLoading = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
    Cargando…
  </div>
);

const ProtectedApp = () => {
  const token = localStorage.getItem('nortex_token');
  if (!token) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Routes>
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
        <Route path="ayuda" element={<HelpCenter />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </Layout>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterTenant />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/ferreterias" element={<LandingFerreteria />} />
        <Route path="/farmacias" element={<LandingFarmacia />} />
        <Route path="/nicaragua" element={<LandingNicaragua />} />
        <Route path="/blog" element={<Suspense fallback={<BlogLoading />}><Blog /></Suspense>} />
        <Route path="/blog/categoria/:slug" element={<Suspense fallback={<BlogLoading />}><ClusterPage /></Suspense>} />
        <Route path="/blog/:slug" element={<Suspense fallback={<BlogLoading />}><BlogPost /></Suspense>} />
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
    </BrowserRouter>
  );
}

export default App;
