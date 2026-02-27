import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, ShoppingCart, Code2, LogOut, Wallet, ShoppingBag, PieChart, FileText, Users, Truck, Briefcase, Package, ClipboardList, CreditCard, UserPlus, Monitor, Clock } from 'lucide-react';
import { PinPadClock } from './PinPadClock';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const [showClock, setShowClock] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('nortex_token');
    localStorage.removeItem('nortex_user');
    localStorage.removeItem('nortex_tenant_id');
    navigate('/login');
  };

  // Decode JWT to get user role for sidebar gating
  const token = localStorage.getItem('nortex_token');
  let userRole = '';
  try {
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userRole = payload.role || '';
    }
  } catch (e) { /* ignore decode errors */ }

  const navItems = [
    { path: '/app/pos', label: 'Punto de Venta', icon: ShoppingCart },
    // Cajas y Arqueos: only for OWNER/ADMIN/MANAGER
    ...(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(userRole)
      ? [{ path: '/app/cash-registers', label: 'Cajas y Arqueos', icon: Monitor }]
      : []),
    { path: '/app/inventory', label: 'Inventario', icon: Package },
    { path: '/app/clients', label: 'Clientes (CRM)', icon: Users },
    { path: '/app/purchases', label: 'Compras', icon: Truck },
    { path: '/app/suppliers', label: 'Proveedores', icon: ClipboardList },
    { path: '/app/hr', label: 'Recursos Humanos', icon: Briefcase }, // NEW
    { path: '/app/quotations', label: 'Cotizaciones', icon: FileText },
    { path: '/app/receivables', label: 'Cobranza', icon: Wallet },
    { path: '/app/dashboard', label: 'Finanzas', icon: LayoutGrid },
    { path: '/app/marketplace', label: 'Mercado B2B', icon: ShoppingBag },
    { path: '/app/reports', label: 'Reportes', icon: PieChart },
    { path: '/app/billing', label: 'Facturación', icon: CreditCard },
    { path: '/app/team', label: 'Mi Equipo', icon: UserPlus },
    { path: '/app/blueprint', label: 'Modo Dios', icon: Code2 },
  ];

  return (
    <div className="flex h-screen w-screen bg-slate-900 overflow-hidden">
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden lg:flex w-64 bg-nortex-900 border-r border-nortex-800 flex-col justify-between transition-all duration-300">
        <div>
          <div className="h-16 flex items-center justify-start px-6 border-b border-nortex-800">
            <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center mr-3 shadow-[0_0_15px_rgba(16,185,129,0.4)]">
              <span className="font-bold text-nortex-900 text-lg">N</span>
            </div>
            <span className="font-mono font-bold text-white tracking-widest">NORTEX</span>
          </div>

          <nav className="p-4 space-y-1 mt-4 overflow-y-auto max-h-[calc(100vh-160px)] custom-scrollbar">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `
                    w-full flex items-center justify-start gap-3 px-3 py-3 rounded-xl transition-all duration-200 group
                    ${isActive
                      ? 'bg-nortex-500 text-white shadow-lg shadow-blue-900/20'
                      : 'text-slate-400 hover:bg-nortex-800 hover:text-white'}
                  `}
                >
                  <Icon size={20} />
                  <span className="font-medium text-sm">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-nortex-800">
          <button
            onClick={() => setShowClock(true)}
            className="w-full flex items-center justify-start gap-3 px-3 mb-2 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
          >
            <Clock size={20} />
            <span className="font-bold text-sm uppercase tracking-wider">Clock In/Out</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-start gap-3 px-3 py-3 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={20} />
            <span className="font-medium text-sm">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-nortex-900 border-t border-nortex-800 flex items-center justify-around z-50 px-2 pb-safe">
        {navItems.slice(0, 5).map((item) => { // Show first 5 items on mobile to avoid crowding
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `
                 flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all
                 ${isActive ? 'text-nortex-accent bg-nortex-800' : 'text-slate-500'}
               `}
            >
              <Icon size={24} />
            </NavLink>
          );
        })}
        <button onClick={handleLogout} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl text-red-500">
          <LogOut size={24} />
        </button>
      </nav>

      <main className="flex-1 overflow-hidden relative mb-16 lg:mb-0">
        {children}
      </main>

      {showClock && <PinPadClock onClose={() => setShowClock(false)} />}
    </div>
  );
};

export default Layout;
