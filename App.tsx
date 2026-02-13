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
import Inventory from './components/Inventory';
import Purchases from './components/Purchases';
import Billing from './components/Billing';
import SuperAdmin from './components/SuperAdmin';
import TermsOfService from './components/TermsOfService';
import PrivacyPolicy from './components/PrivacyPolicy';
import TeamManagement from './components/TeamManagement';
import AcceptInvitation from './components/AcceptInvitation';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';

// Emails autorizados como SUPER_ADMIN
const SUPER_ADMIN_EMAILS = ['noelpinedaa96@gmail.com'];

const ProtectedApp = () => {
  const token = localStorage.getItem('nortex_token');
  if (!token) return <Navigate to="/login" replace />;

  // Detectar si es Super Admin y redirigir
  try {
    const userStr = localStorage.getItem('nortex_user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(user.email)) {
        return <Navigate to="/admin" replace />;
      }
    }
  } catch (e) { }

  return (
    <Layout>
      <Routes>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="pos" element={<POS />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="clients" element={<Clients />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="hr" element={<HRM />} />
        <Route path="quotations" element={<QuotationManager />} />
        <Route path="receivables" element={<AccountsReceivable />} />
        <Route path="reports" element={<Reports />} />
        <Route path="marketplace" element={<B2BMarketplace />} />
        <Route path="billing" element={<Billing />} />
        <Route path="team" element={<TeamManagement />} />
        <Route path="blueprint" element={<BlueprintViewer />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </Layout>
  );
};

const ProtectedAdmin = () => {
  const token = localStorage.getItem('nortex_token');
  if (!token) return <Navigate to="/login" replace />;

  // Verificar que sea Super Admin
  try {
    const userStr = localStorage.getItem('nortex_user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(user.email)) {
        return <SuperAdmin />;
      }
    }
  } catch (e) { }

  return <Navigate to="/app/dashboard" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterTenant />} />
        <Route path="/login" element={<Login />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/invite/:token" element={<AcceptInvitation />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/admin" element={<ProtectedAdmin />} />
        <Route path="/app/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
