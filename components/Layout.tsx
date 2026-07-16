import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutGrid, ShoppingCart, Code2, LogOut, Wallet, ShoppingBag, PieChart, FileText, Users, Truck, Briefcase, Package, ClipboardList, CreditCard, UserPlus, Monitor, Clock, BarChart3, Shield, Zap, Menu, X, Bell, BookOpen, UserCircle, ChevronDown, SlidersHorizontal, Home } from 'lucide-react';
import { PinPadClock } from './PinPadClock';
import OnboardingHub from './OnboardingHub';
import { buildNavigation, resolveUiMode, UI_MODE_KEY, type NavEntry, type UiMode } from '../utils/navigation';

// Mapa iconKey → componente lucide (los íconos viven acá para que
// utils/navigation.ts sea un módulo puro y testeable sin React).
const NAV_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  layoutGrid: LayoutGrid, shoppingCart: ShoppingCart, code2: Code2, wallet: Wallet,
  shoppingBag: ShoppingBag, pieChart: PieChart, fileText: FileText, users: Users,
  truck: Truck, briefcase: Briefcase, package: Package, clipboardList: ClipboardList,
  creditCard: CreditCard, userPlus: UserPlus, monitor: Monitor, barChart3: BarChart3,
  shield: Shield, zap: Zap, bookOpen: BookOpen, userCircle: UserCircle, home: Home,
};
const navIcon = (key: string) => NAV_ICONS[key] ?? Package;

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const [showClock, setShowClock] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ── Toast de notificaciones ──────────────────────────────────────────────
  interface AppToast { id: string; message: string; }
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const knownOrderIds = useRef<Set<string>>(new Set());
  const isFirstPoll = useRef(true);

  const dismissToast = (id: string) =>
    setToasts(prev => prev.filter(t => t.id !== id));

  const pushToast = (message: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => dismissToast(id), 6000);
  };

  const playBeep = () => {
    try {
      const ctx = new AudioContext();
      [0, 0.15].forEach(startOffset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 1046; // C6
        gain.gain.setValueAtTime(0.25, ctx.currentTime + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + 0.18);
        osc.start(ctx.currentTime + startOffset);
        osc.stop(ctx.currentTime + startOffset + 0.18);
      });
    } catch { /* sin permiso de audio — silencio */ }
  };

  // Smart Polling: detecta nuevos pedidos web cada 30 s
  useEffect(() => {
    // Solo para roles de admin/dueño, no para motoristas
    const storedToken = localStorage.getItem('nortex_token');
    if (!storedToken) return;
    let role = '';
    try {
      role = JSON.parse(atob(storedToken.split('.')[1])).role || '';
    } catch { return; }
    if (role === 'COLLECTOR') return;

    const poll = async () => {
      try {
        const res = await fetch('/api/public-orders', {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (!res.ok) return;
        const orders: Array<{ id: string; status: string; customerName: string }> = await res.json();
        const pending = orders.filter(o => o.status === 'PENDING');

        if (isFirstPoll.current) {
          pending.forEach(o => knownOrderIds.current.add(o.id));
          isFirstPoll.current = false;
          return;
        }

        const newOrders = pending.filter(o => !knownOrderIds.current.has(o.id));
        newOrders.forEach(o => {
          knownOrderIds.current.add(o.id);
          pushToast(`¡NUEVO PEDIDO WEB DE ${o.customerName.toUpperCase()}!`);
          playBeep();
        });
      } catch { /* red caída — ignorar */ }
    };

    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('nortex_token');
    localStorage.removeItem('nortex_user');
    localStorage.removeItem('nortex_tenant_id');
    // Purgar el caché de /api/ del SW para que el próximo usuario de una
    // terminal compartida no reciba datos de negocio del usuario anterior.
    if (typeof caches !== 'undefined') {
      caches.delete('nortex-api-cache').catch(() => {});
    }
    navigate('/login');
  };

  // Decode JWT to get user role for sidebar gating
  const token = localStorage.getItem('nortex_token');
  let userRole = '';
  let tenantType = '';
  try {
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userRole = payload.role || '';

      try {
        const userStr = localStorage.getItem('nortex_user');
        if (userStr) {
          const user = JSON.parse(userStr);
          tenantType = user.tenant?.type || '';
          if (tenantType === 'LENDER') {
            userRole = `LENDER_${userRole}`; // Prefix to distinguish in layout
          }
        }
      } catch (e) { }
    }
  } catch (e) { /* ignore decode errors */ }

  // ── Modo simple / completo (Fase A UX) ────────────────────────────────────
  // Simple = menú corto según el giro del negocio + "Más opciones" plegado.
  // Persistido por dispositivo; solo la pulpería arranca en simple por defecto.
  const [uiMode, setUiMode] = useState<UiMode>(() =>
    resolveUiMode(tenantType, localStorage.getItem(UI_MODE_KEY)));
  const [showMore, setShowMore] = useState(false);
  const toggleUiMode = () => {
    const next: UiMode = uiMode === 'simple' ? 'full' : 'simple';
    localStorage.setItem(UI_MODE_KEY, next);
    setShowMore(false);
    setUiMode(next);
  };

  if (userRole === 'LENDER_COLLECTOR' || userRole === 'COLLECTOR') {
    // Retorna ÚNICAMENTE la vista del motorizado sin menú lateral completo
    return (
      <div className="mobile-only-layout min-h-screen bg-slate-900">
        {children}
      </div>
    );
  }

  // Navegación por giro + rol + modo (la lógica vive en utils/navigation.ts,
  // que es un módulo puro con QA propia). primary ∪ more = menú completo del rol.
  const { primary, more } = buildNavigation({ tenantType, role: userRole, simple: uiMode === 'simple' });
  const canToggleMode = !userRole.startsWith('LENDER_') && userRole !== 'ACCOUNTANT';

  return (
    <div className="flex h-screen w-screen bg-surface-950 overflow-hidden">
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden lg:flex w-64 bg-nortex-900 border-r border-white/[0.06] flex-col justify-between transition-all duration-300">
        <div>
          <div className="h-16 flex items-center justify-start px-6 border-b border-white/[0.06]">
            <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center mr-3 shadow-glow shadow-emerald-500/40">
              <span className="font-bold text-surface-950 text-lg">N</span>
            </div>
            <span className="font-bold text-white text-lg tracking-tight">Nortex<span className="text-nortex-accent">.</span></span>
          </div>

          <nav className="p-4 space-y-1 mt-4 overflow-y-auto max-h-[calc(100vh-160px)] custom-scrollbar">
            {primary.map((item) => {
              const Icon = navIcon(item.iconKey);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `
                    w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group active:scale-[0.98]
                    ${isActive
                      ? 'bg-brand text-white shadow-glow shadow-brand/25'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'}
                  `}
                >
                  <Icon size={20} />
                  <span className="font-medium text-sm">{item.label}</span>
                </NavLink>
              );
            })}

            {/* Modo simple: el resto de módulos queda plegado en "Más opciones" */}
            {more.length > 0 && (
              <>
                <button
                  onClick={() => setShowMore(v => !v)}
                  className="w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:bg-white/[0.04] hover:text-slate-300 transition-all"
                >
                  <ChevronDown size={20} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
                  <span className="font-medium text-sm">{showMore ? 'Menos opciones' : 'Más opciones'}</span>
                </button>
                {showMore && more.map((item) => {
                  const Icon = navIcon(item.iconKey);
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) => `
                        w-full flex items-center justify-start gap-3 pl-6 pr-3 py-2 rounded-xl transition-all duration-200 group active:scale-[0.98]
                        ${isActive
                          ? 'bg-brand text-white shadow-glow shadow-brand/25'
                          : 'text-slate-500 hover:bg-white/[0.04] hover:text-white'}
                      `}
                    >
                      <Icon size={18} />
                      <span className="font-medium text-[13px]">{item.label}</span>
                    </NavLink>
                  );
                })}
              </>
            )}
          </nav>
        </div >

        <div className="p-4 border-t border-white/[0.06]">
          {canToggleMode && (
            <button
              onClick={toggleUiMode}
              title={uiMode === 'simple' ? 'Mostrar todos los módulos' : 'Mostrar solo lo esencial de tu negocio'}
              className="w-full flex items-center justify-start gap-3 px-3 mb-2 py-2.5 rounded-xl text-slate-500 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <SlidersHorizontal size={18} />
              <span className="font-medium text-sm">{uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}</span>
            </button>
          )}
          <button
            onClick={() => setShowClock(true)}
            className="w-full flex items-center justify-start gap-3 px-3 mb-2 py-3 rounded-xl bg-brand/10 text-brand-300 hover:bg-brand/20 hover:text-brand-200 transition-all active:scale-[0.98] border border-brand/20 shadow-glow shadow-brand/10"
          >
            <Clock size={20} />
            <span className="font-bold text-sm uppercase tracking-wider">Marcar Entrada/Salida</span>
          </button>
          <button
            onClick={() => navigate('/app/ayuda')}
            className="w-full flex items-center justify-start gap-3 px-3 mb-2 py-3 rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <BookOpen size={20} />
            <span className="font-medium text-sm">¿Cómo hago…? (Ayuda)</span>
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
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface-950/90 backdrop-blur-md border-t border-white/[0.06] flex items-center justify-around z-40 px-1 pb-safe">
        {primary.slice(0, 4).map((item) => {
          const Icon = navIcon(item.iconKey);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setShowMobileMenu(false)}
              className={({ isActive }) => `
                flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-0
                ${isActive ? 'text-nortex-accent bg-slate-800' : 'text-slate-500 hover:text-slate-300'}
              `}
            >
              <Icon size={22} />
              <span className="text-[9px] font-semibold leading-none truncate max-w-[44px] text-center">
                {item.shortLabel}
              </span>
            </NavLink>
          );
        })}

        {/* BOTÓN MENÚ COMPLETO */}
        <button
          onClick={() => setShowMobileMenu(true)}
          className="flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl text-slate-500 hover:text-white transition-all"
        >
          <Menu size={22} />
          <span className="text-[9px] font-semibold leading-none">Menú</span>
        </button>
      </nav>

      {/* FULL MOBILE MENU OVERLAY (El cajón secreto) */}
      {showMobileMenu && (
        <div className="lg:hidden fixed inset-0 bg-slate-900 z-50 flex flex-col animate-in slide-in-from-bottom-full duration-200">
          <div className="flex justify-between items-center p-6 border-b border-slate-800 bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.4)]">
                <span className="font-bold text-nortex-900 text-lg">N</span>
              </div>
              <span className="font-bold text-white tracking-widest text-lg">MENÚ NORTEX</span>
            </div>
            <button
              onClick={() => setShowMobileMenu(false)}
              className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white"
            >
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar pb-24">
            {/* Agrupar items por grupo y renderizar con headers.
                En modo simple: lo esencial arriba ("Tu día a día") y el resto
                agrupado abajo — nada desaparece, solo se ordena por prioridad. */}
            {(() => {
              const groups: Record<string, NavEntry[]> = {};
              if (more.length > 0) groups['Tu día a día'] = primary;
              const rest = more.length > 0 ? more : primary;
              for (const item of rest) {
                if (!groups[item.group]) groups[item.group] = [];
                groups[item.group].push(item);
              }
              return Object.entries(groups).map(([groupName, items]) => (
                <div key={groupName} className="mb-5">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1 mb-2">
                    {groupName}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {items.map((item) => {
                      const Icon = navIcon(item.iconKey);
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setShowMobileMenu(false)}
                          className={({ isActive }) => `
                            flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border transition-all text-center
                            ${isActive
                              ? 'bg-brand/10 border-brand/40 text-white shadow-glow shadow-brand/10'
                              : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06] hover:text-white'}
                          `}
                        >
                          <Icon size={24} className={item.path === '/app/pos' ? 'text-nortex-accent' : ''} />
                          <span className="font-bold text-[10px] leading-tight text-center">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>

          <div className="flex-none p-4 pt-2 border-t border-slate-800 space-y-2">
            {canToggleMode && (
              <button
                onClick={toggleUiMode}
                className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white/[0.04] text-slate-400 font-bold border border-white/[0.08]"
              >
                <SlidersHorizontal size={18} />
                {uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}
              </button>
            )}
            <button
              onClick={() => { setShowMobileMenu(false); setShowClock(true); }}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl bg-indigo-500/10 text-indigo-400 font-bold border border-indigo-500/20"
            >
              <Clock size={18} />
              Marcar Entrada / Salida
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl bg-red-500/10 text-red-500 font-bold border border-red-500/20"
            >
              <LogOut size={18} />
              Cerrar Sesión
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-hidden relative mb-16 lg:mb-0">
        {children}
      </main>

      {showClock && <PinPadClock onClose={() => setShowClock(false)} />}

      {/* 🔔 Toast de pedidos web */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl shadow-emerald-900/40 animate-in slide-in-from-right-full duration-300"
          >
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bell size={16} className="animate-bounce" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-tight">{toast.message}</p>
              <p className="text-emerald-200 text-xs mt-0.5">Ve a Entregas para gestionarlo</p>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-white/60 hover:text-white flex-shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* 🚀 Onboarding guiado (solo Dueño/Admin; se auto-oculta al completar) */}
      <OnboardingHub />
    </div>
  );
};

export default Layout;
