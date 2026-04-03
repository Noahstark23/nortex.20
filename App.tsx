import React from 'react';
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
import SuperAdmin from './components/SuperAdmin';
import DeliveryManager from './components/DeliveryManager';
import DriverView from './components/DriverView';
import Inventory from './components/Inventory';
import CashRegisters from './components/CashRegisters';
import Purchases from './components/Purchases';
import FinancialHealth from './components/FinancialHealth';
import AuditDashboard from './components/AuditDashboard';
import Billing from './components/Billing';
import TeamManagement from './components/TeamManagement';
import PublicCatalog from './components/PublicCatalog';

// SEO Landing Pages & Blog
import LandingFerreteria from './components/LandingFerreteria';
import LandingFarmacia from './components/LandingFarmacia';
import LandingNicaragua from './components/LandingNicaragua';
import Blog from './components/Blog';
import BlogPost from './components/BlogPost';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';

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
        <Route path="quotations" element={<QuotationManager />} />
        <Route path="receivables" element={<AccountsReceivable />} />
        <Route path="reports" element={<Reports />} />
        <Route path="marketplace" element={<B2BMarketplace />} />
        <Route path="blueprint" element={<BlueprintViewer />} />
        <Route path="delivery" element={<DeliveryManager />} />
        <Route path="inventory" element={<Inventory />} />
        {/* ── Rutas registradas para evitar redirección silenciosa ── */}
        <Route path="cash-registers" element={<CashRegisters />} />
        <Route path="smart-purchases" element={<div className="flex items-center justify-center h-full"><div className="text-center"><p className="text-4xl mb-4">🤖</p><h2 className="text-xl font-bold text-white">IA de Compras</h2><p className="text-slate-400 mt-2">Módulo en construcción — próximamente</p></div></div>} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="financial-health" element={<FinancialHealth />} />
        <Route path="audit" element={<AuditDashboard />} />
        <Route path="billing" element={<Billing />} />
        <Route path="team" element={<TeamManagement />} />
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
        <Route path="/ferreterias" element={<LandingFerreteria />} />
        <Route path="/farmacias" element={<LandingFarmacia />} />
        <Route path="/nicaragua" element={<LandingNicaragua />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/admin" element={<SuperAdmin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/catalog/:slug" element={<PublicCatalog />} />
        <Route path="/driver/:id" element={<DriverView />} />
        <Route path="/app/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
