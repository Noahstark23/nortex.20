import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import POS from './components/POS';
import Dashboard from './components/Dashboard';
import BlueprintViewer from './components/BlueprintViewer';
import LandingPage from './components/LandingPage';
import RegisterTenant from './components/RegisterTenant';

// Protected Route Wrapper
const ProtectedApp = () => {
  // Simple auth check simulation
  const isAuthenticated = !!localStorage.getItem('nortex_tenant_id');
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="pos" element={<POS />} />
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
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterTenant />} />
        <Route path="/login" element={<div className="h-screen flex items-center justify-center text-white bg-nortex-900">Login Placeholder (Use Register)</div>} />
        
        {/* Protected Routes */}
        <Route path="/app/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;