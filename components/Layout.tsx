import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, ShoppingCart, Code2, LogOut } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('nortex_tenant_id');
    navigate('/');
  };

  const navItems = [
    { path: '/app/pos', label: 'Punto de Venta', icon: ShoppingCart },
    { path: '/app/dashboard', label: 'Panel Financiero', icon: LayoutGrid },
    { path: '/app/blueprint', label: 'Modo Dios (CTO)', icon: Code2 },
  ];

  return (
    <div className="flex h-screen w-screen bg-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-nortex-900 border-r border-nortex-800 flex flex-col justify-between transition-all duration-300">
        <div>
          <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-nortex-800">
            <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center mr-0 lg:mr-3 shadow-[0_0_15px_rgba(16,185,129,0.4)]">
              <span className="font-bold text-nortex-900 text-lg">N</span>
            </div>
            <span className="font-mono font-bold text-white hidden lg:block tracking-widest">NORTEX</span>
          </div>

          <nav className="p-2 lg:p-4 space-y-2 mt-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `
                    w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 rounded-xl transition-all duration-200 group
                    ${isActive 
                      ? 'bg-nortex-500 text-white shadow-lg shadow-blue-900/20' 
                      : 'text-slate-400 hover:bg-nortex-800 hover:text-white'}
                  `}
                >
                  <Icon size={20} />
                  <span className="hidden lg:block font-medium text-sm">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="p-2 lg:p-4 border-t border-nortex-800">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={20} />
            <span className="hidden lg:block font-medium text-sm">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
};

export default Layout;