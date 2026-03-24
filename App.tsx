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

// SEO Landing Pages & Blog
import LandingFerreteria from './components/LandingFerreteria';
import LandingFarmacia from './components/LandingFarmacia';
import LandingNicaragua from './components/LandingNicaragua';
import Blog from './components/Blog';
import BlogPost from './components/BlogPost';

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
        <Route path="/app/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
