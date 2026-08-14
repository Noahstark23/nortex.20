import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, ShoppingCart, LogOut, Wallet, PieChart, FileText, Users, Truck, Briefcase, Package, ClipboardList, CreditCard, UserPlus, Monitor, Clock, BarChart3, Shield, Zap, Menu, X, Bell, BookOpen, UserCircle, Home, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { PinPadClock } from './PinPadClock';
import OnboardingHub from './OnboardingHub';
import { buildNavigation, groupBySection, resolveUiMode, UI_MODE_KEY, type UiMode, type NavEntry, type NavSection } from '../utils/navigation';

// El módulo de navegación es puro (sin React): mapa iconKey → componente lucide.
const NAV_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  home: Home, shoppingCart: ShoppingCart, monitor: Monitor, package: Package,
  clipboardList: ClipboardList, truck: Truck, fileText: FileText, users: Users,
  zap: Zap, layoutGrid: LayoutGrid, wallet: Wallet, creditCard: CreditCard,
  bookOpen: BookOpen, pieChart: PieChart, barChart3: BarChart3, shield: Shield,
  userCircle: UserCircle, briefcase: Briefcase, userPlus: UserPlus,
};

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showClock, setShowClock] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ── Modo de menú (simple | full) — persistido; lo guardado siempre gana ──
  const [uiMode, setUiMode] = useState<UiMode>(() => {
    let type = '';
    try { type = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || ''; } catch { /* sin tenant → simple */ }
    return resolveUiMode(type, localStorage.getItem(UI_MODE_KEY));
  });
  const toggleUiMode = () => setUiMode(prev => {
    const next: UiMode = prev === 'simple' ? 'full' : 'simple';
    localStorage.setItem(UI_MODE_KEY, next);
    return next;
  });
  // "Más opciones" del sidebar: abierto si la ruta actual vive ahí adentro.
  const [showMore, setShowMore] = useState(false);
  // Secciones del menú abiertas/cerradas. Sin entrada = se decide por la ruta
  // activa (la sección donde estás parado arranca abierta).
  const [openSections, setOpenSections] = useState<Partial<Record<NavSection, boolean>>>({});

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

  if (userRole === 'LENDER_COLLECTOR' || userRole === 'COLLECTOR') {
    // Retorna ÚNICAMENTE la vista del motorizado sin menú lateral completo
    return (
      <div className="mobile-only-layout min-h-screen bg-slate-900 [color-scheme:dark]">
        {children}
      </div>
    );
  }

  type NavItem = {
    path: string;
    label: string;
    shortLabel: string;
    group: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  };

  // R2.6 (auditoría D1): el menú lo decide utils/navigation.ts — módulo puro y
  // testeado que estaba escrito y desconectado. buildNavigation conserva el
  // gating por rol y los menús reducidos de LENDER/CONTADOR; en modo simple
  // devuelve el set corto por giro (el orden ES la jerarquía: la barra móvil
  // toma los primeros 4) y pliega el resto en "Más opciones".
  const nav = buildNavigation({ tenantType, role: userRole, simple: uiMode === 'simple' });
  const toNavItem = (e: NavEntry): NavItem => ({ ...e, icon: NAV_ICONS[e.iconKey] ?? Package });
  const navItems: NavItem[] = nav.primary.map(toNavItem);
  const moreItems: NavItem[] = nav.more.map(toNavItem);
  // El overlay móvil muestra TODO (primary ∪ more) agrupado — nada se pierde.
  const allItems: NavItem[] = [...navItems, ...moreItems];
  // LENDER y CONTADOR no tienen modo simple: ocultar el toggle.
  const canToggleMode = !userRole.startsWith('LENDER_') && userRole !== 'ACCOUNTANT';
  const isMoreActive = moreItems.some(it => location.pathname.startsWith(it.path));

  // ── Navegación en 5 secciones (rediseño Fase 2) ───────────────────────────
  const { sections: sectionGroups, loose: looseItems } = groupBySection(navItems);
  const sectionHasActive = (items: NavItem[]) => items.some(it => location.pathname.startsWith(it.path));

  /** Item de nav: fondo suave + barra izquierda. Nunca un bloque sólido de color. */
  const navItemClass = ({ isActive }: { isActive: boolean }) => `
    w-full flex items-center justify-start gap-3 px-3 h-touch rounded-control transition-colors duration-150 group active:scale-[0.98]
    ${isActive
      ? 'bg-brand/10 text-white shadow-nav-active'
      : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'}
  `;

  return (
    // h-dvh (no h-screen): 100vh en Chrome Android no descuenta la barra de
    // direcciones y con overflow-hidden el contenido quedaba recortado sin scroll.
    // w-full (no w-screen): w-screen provoca overflow horizontal.
    <div className="flex h-dvh w-full bg-surface-950 overflow-hidden [color-scheme:dark]">
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
            {/* Items sueltos (Mi Negocio, y los menús propios de LENDER/CONTADOR
                que traen sus propias etiquetas de grupo). */}
            {looseItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.path} to={item.path} className={navItemClass}>
                  <Icon size={20} />
                  <span className="font-medium text-sm">{item.label}</span>
                </NavLink>
              );
            })}

            {/* ── 5 secciones colapsables ──────────────────────────────────
                Antes: 22 items planos con el mismo peso visual. La sección
                que contiene la ruta activa se abre sola, así el usuario nunca
                queda mirando un menú cerrado sin saber dónde está parado. */}
            {sectionGroups.map(({ section, items }) => {
              const isOpen = openSections[section] ?? sectionHasActive(items);
              return (
                <div key={section} className="pt-1">
                  <button
                    onClick={() => setOpenSections(prev => ({ ...prev, [section]: !isOpen }))}
                    className="w-full flex items-center gap-2 px-3 pt-3 pb-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                    aria-expanded={isOpen}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{section}</span>
                    <ChevronDown size={14} className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="space-y-1">
                      {items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <NavLink key={item.path} to={item.path} className={navItemClass}>
                            <Icon size={20} />
                            <span className="font-medium text-sm">{item.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* "Más opciones" (modo simple): el resto del menú, plegado pero a un clic */}
            {moreItems.length > 0 && (
              <>
                <button
                  onClick={() => setShowMore(v => !v)}
                  className={`w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-xl transition-colors mt-2 border-t border-white/[0.06] pt-3
                    ${(showMore || isMoreActive) ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <ChevronDown size={20} className={`transition-transform ${(showMore || isMoreActive) ? 'rotate-180' : ''}`} />
                  <span className="font-medium text-sm">Más opciones</span>
                </button>
                {(showMore || isMoreActive) && moreItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) => `
                        w-full flex items-center justify-start gap-3 px-3 py-2 rounded-xl transition-all duration-200
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

            {/* Toggle de modo: visible siempre para retail, cambia y persiste */}
            {canToggleMode && (
              <button
                onClick={toggleUiMode}
                className="w-full flex items-center justify-start gap-3 px-3 py-2 rounded-xl text-slate-600 hover:text-slate-300 transition-colors mt-1"
              >
                <SlidersHorizontal size={16} />
                <span className="font-medium text-xs">
                  {uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}
                </span>
              </button>
            )}
          </nav>
        </div >

        <div className="p-4 border-t border-white/[0.06]">
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
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
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
            {/* Agrupar items por grupo y renderizar con headers (primary ∪ more: nada se pierde) */}
            {(() => {
              const groups = allItems.reduce<Record<string, NavItem[]>>((acc, item) => {
                if (!acc[item.group]) acc[item.group] = [];
                acc[item.group].push(item);
                return acc;
              }, {});
              return Object.entries(groups).map(([groupName, items]) => (
                <div key={groupName} className="mb-5">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1 mb-2">
                    {groupName}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {items.map((item) => {
                      const Icon = item.icon;
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
            {/* La Ayuda solo existía en el sidebar de escritorio (hidden lg:flex):
                el usuario que más la necesita —el del Android— no la tenía. */}
            <button
              onClick={() => { setShowMobileMenu(false); navigate('/app/ayuda'); }}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl bg-white/[0.04] text-slate-300 font-bold border border-white/[0.08]"
            >
              <BookOpen size={18} />
              ¿Cómo hago…? (Ayuda)
            </button>
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
            {canToggleMode && (
              <button
                onClick={toggleUiMode}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-slate-500 text-xs font-semibold"
              >
                <SlidersHorizontal size={14} />
                {uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}
              </button>
            )}
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
