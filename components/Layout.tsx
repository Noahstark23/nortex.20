import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { AlertTriangle, LayoutGrid, ShoppingCart, LogOut, Wallet, PieChart, FileText, Users, Truck, Briefcase, Package, ClipboardList, CreditCard, UserPlus, Monitor, Clock, BarChart3, Shield, Zap, Menu, X, Bell, BookOpen, UserCircle, Home, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { formatMoney } from '../utils/money';
import { PinPadClock } from './PinPadClock';
import { useVentaEnCurso } from './VentaEnCursoContext';
import OnboardingHub from './OnboardingHub';
import InstallPrompt from './InstallPrompt';
import { buildNavigation, groupBySection, resolveUiMode, navPathForRoute, esRutaDe, UI_MODE_KEY, type UiMode, type NavEntry, type NavSection } from '../utils/navigation';

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
    if (role === 'COLLECTOR' || role === 'BODEGUERO') return;

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
  // Roles con menú dedicado no tienen modo simple/completo: el toggle no haría
  // nada y prometería una personalización inexistente.
  const canToggleMode = !userRole.startsWith('LENDER_') && !['ACCOUNTANT', 'BODEGUERO'].includes(userRole);
  // El terminal usa un PIN compartido por empleado y no tiene lockout propio.
  // El rol operativo de bodega no necesita esa superficie: RRHH queda cerrado
  // en backend y tampoco mostramos un control que el servidor va a rechazar.
  const canUseAttendanceClock = userRole !== 'BODEGUERO';
  const isMoreActive = moreItems.some(it => location.pathname.startsWith(it.path));
  // En móvil la caja conserva su superficie dedicada. En escritorio comparte
  // el rail persistente del ERP para que cambiar de contexto sea predecible; la
  // salida sigue protegida por VentaEnCursoContext + su persistencia local.
  const isPosSurface = location.pathname === '/app/pos';

  // ── Navegación en 5 secciones (rediseño Fase 2) ───────────────────────────
  const { sections: sectionGroups, loose: looseItems } = groupBySection(navItems);
  // P0-3 — Bodegas y Series no tienen ítem propio en el menú: se atribuyen a
  // "Mis Productos" (utils/navigation.ts). Sin esto, entrar ahí dejaba el
  // sidebar sin NINGÚN ítem marcado y con todas las secciones plegadas: el
  // usuario no sabía dónde estaba ni cómo volver.
  const rutaDelMenu = navPathForRoute(location.pathname, userRole);
  const sectionHasActive = (items: NavItem[]) => items.some(it => esRutaDe(it.path, rutaDelMenu));
  /** Activo real del ítem, contemplando sus pantallas satélite. */
  const itemActivo = (item: NavItem, isActive: boolean) => isActive || esRutaDe(item.path, rutaDelMenu);

  // Contexto visual del shell. Se deriva únicamente de la sesión local que la
  // app ya usa para pintar datos no sensibles; autorización y navegación siguen
  // dependiendo del JWT y de buildNavigation, respectivamente.
  let sessionName = 'Tu cuenta';
  let businessName = 'Nortex';
  try {
    const session = JSON.parse(localStorage.getItem('nortex_user') || '{}');
    sessionName = session.name || session.email || session.firstName || sessionName;
    businessName = session.tenant?.businessName || session.tenant?.name || businessName;
  } catch { /* sesión ilegible: el shell degrada a etiquetas neutrales */ }
  const sessionInitial = sessionName.trim().charAt(0).toUpperCase() || 'N';
  const activeNavItem = allItems.find(item => esRutaDe(item.path, rutaDelMenu));
  const pageTitle = isPosSurface ? 'Nueva venta' : (activeNavItem?.label || 'Nortex');
  const pageGroup = isPosSurface ? 'VENDER' : (activeNavItem?.group || 'ESPACIO DE TRABAJO');

  /** Item de nav: selección inequívoca, compacta y con respuesta inmediata. */
  /* ── Guarda de navegación con venta en curso (P0-1) ──────────────────
     El sidebar está montado ALREDEDOR del POS, así que un clic acá desmonta la
     caja. El carrito ya sobrevive (utils/cartPersistence.ts), pero verlo
     desaparecer asusta igual: se avisa ANTES de salir y se dice la verdad —
     la venta queda esperando, no se pierde.
     No se usa `useBlocker` porque exige un data router y la app monta
     <BrowserRouter>; el menú es el camino de salida que importa y está acá. */
  const ventaEnCurso = useVentaEnCurso();
  const [destinoPendiente, setDestinoPendiente] = useState<string | null>(null);

  const guardarSalida = (e: React.MouseEvent, destino: string): boolean => {
    // Navegar DENTRO del POS no interrumpe nada.
    if (!ventaEnCurso.hayVenta || destino === location.pathname) return true;
    e.preventDefault();
    setDestinoPendiente(destino);
    return false;
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) => `
    nx-fluid-press group flex min-h-10 w-full items-center justify-start gap-2.5 rounded-control border px-2.5 py-2 text-left
    ${isActive
      ? 'border-emerald-400/25 bg-emerald-500/90 text-white shadow-sm shadow-emerald-950/20'
      : 'border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.055] hover:text-white'}
  `;

  return (
    // h-dvh (no h-screen): 100vh en Chrome Android no descuenta la barra de
    // direcciones y con overflow-hidden el contenido quedaba recortado sin scroll.
    // w-full (no w-screen): w-screen provoca overflow horizontal.
    <div className="nx-app-shell flex h-dvh w-full overflow-hidden [color-scheme:dark]">
      {/* DESKTOP SIDEBAR */}
      <aside className="nx-sidebar hidden w-[12rem] shrink-0 flex-col justify-between border-r border-white/[0.07] lg:flex xl:w-[12.5rem]">
        <div className="min-h-0">
          <div className="flex h-[4.5rem] items-center border-b border-white/[0.07] px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-emerald-300/20 bg-emerald-400/10">
                <span className="text-[13px] font-black tracking-[-0.04em] text-emerald-300">N</span>
              </div>
              <span className="truncate text-[17px] font-semibold tracking-[-0.03em] text-white">nortex<span className="text-emerald-400">.</span></span>
            </div>
          </div>

          <nav className="custom-scrollbar max-h-[calc(100dvh-15.5rem)] space-y-1 overflow-y-auto px-2.5 py-3" aria-label="Navegación principal">
            {/* Items sueltos (Mi Negocio, y los menús propios de LENDER/CONTADOR
                que traen sus propias etiquetas de grupo). */}
            {looseItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.path} to={item.path} onClick={e => guardarSalida(e, item.path)} className={({ isActive }) => navItemClass({ isActive: itemActivo(item, isActive) })}>
                  <Icon size={17} className="shrink-0" aria-hidden="true" />
                  <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{item.label}</span>
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
                <div key={section} className="pt-1.5">
                  <button
                    onClick={() => setOpenSections(prev => ({ ...prev, [section]: !isOpen }))}
                    className="nx-fluid-press flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1 text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300"
                    aria-expanded={isOpen}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em]">{section}</span>
                    <ChevronDown size={12} className={`ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div className="mt-0.5 space-y-1">
                      {items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <NavLink key={item.path} to={item.path} onClick={e => guardarSalida(e, item.path)} className={({ isActive }) => navItemClass({ isActive: itemActivo(item, isActive) })}>
                            <Icon size={17} className="shrink-0" aria-hidden="true" />
                            <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{item.label}</span>
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
                  className={`nx-fluid-press mt-2 flex min-h-10 w-full items-center justify-start gap-2.5 border-t border-white/[0.07] px-2.5 pt-3 text-left transition-colors
                    ${(showMore || isMoreActive) ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'}`}
                  aria-expanded={showMore || isMoreActive}
                >
                  <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${(showMore || isMoreActive) ? 'rotate-180' : ''}`} aria-hidden="true" />
                  <span className="truncate text-[12px] font-medium">Más opciones</span>
                </button>
                {(showMore || isMoreActive) && moreItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={e => guardarSalida(e, item.path)}
                      className={({ isActive }) => navItemClass({ isActive: itemActivo(item, isActive) })}
                    >
                      <Icon size={16} className="shrink-0" aria-hidden="true" />
                      <span className="truncate text-[12px] font-medium">{item.label}</span>
                    </NavLink>
                  );
                })}
              </>
            )}

            {/* Toggle de modo: visible siempre para retail, cambia y persiste */}
            {canToggleMode && (
              <button
                onClick={toggleUiMode}
                className="nx-fluid-press mt-1 flex min-h-9 w-full items-center justify-start gap-2.5 rounded-control px-2.5 py-2 text-left text-slate-600 transition-colors hover:bg-white/[0.035] hover:text-slate-300"
              >
                <SlidersHorizontal size={15} className="shrink-0" aria-hidden="true" />
                <span className="truncate text-[11px] font-medium">
                  {uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}
                </span>
              </button>
            )}
          </nav>
        </div>

        <div className="space-y-1 border-t border-white/[0.07] p-2.5">
          {canUseAttendanceClock && (
            <button
              onClick={() => setShowClock(true)}
              className="nx-fluid-press flex min-h-10 w-full items-center justify-start gap-2.5 rounded-control border border-emerald-400/15 bg-emerald-400/[0.07] px-2.5 py-2 text-left text-emerald-300 transition-colors hover:border-emerald-400/25 hover:bg-emerald-400/[0.12]"
            >
              <Clock size={16} className="shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold leading-tight">Marcar entrada / salida</span>
            </button>
          )}
          <button
            onClick={e => { if (guardarSalida(e, '/app/ayuda')) navigate('/app/ayuda'); }}
            className="nx-fluid-press flex min-h-10 w-full items-center justify-start gap-2.5 rounded-control px-2.5 py-2 text-left text-slate-400 transition-colors hover:bg-white/[0.055] hover:text-white"
          >
            <BookOpen size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate text-[11px] font-medium">Ayuda</span>
          </button>
          <button
            onClick={handleLogout}
            className="nx-fluid-press flex min-h-10 w-full items-center justify-start gap-2.5 rounded-control px-2.5 py-2 text-left text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate text-[11px] font-medium">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <nav className={`${isPosSurface ? 'hidden' : 'flex lg:hidden'} nx-dark-chrome fixed inset-x-0 bottom-0 z-40 h-16 items-center justify-around border-t border-white/[0.08] px-1 pb-safe shadow-xl`} aria-label="Navegación móvil">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={e => { setShowMobileMenu(false); guardarSalida(e, item.path); }}
              className={({ isActive }) => `
                nx-fluid-press flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 transition-colors
                ${isActive ? 'bg-emerald-400/12 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}
              `}
            >
              <Icon size={21} aria-hidden="true" />
              <span className="text-[9px] font-semibold leading-none truncate max-w-[44px] text-center">
                {item.shortLabel}
              </span>
            </NavLink>
          );
        })}

        {/* BOTÓN MENÚ COMPLETO */}
        <button
          onClick={() => setShowMobileMenu(true)}
          className="nx-fluid-press flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-white"
          aria-label="Abrir menú completo"
        >
          <Menu size={21} aria-hidden="true" />
          <span className="text-[9px] font-semibold leading-none">Menú</span>
        </button>
      </nav>

      {/* FULL MOBILE MENU OVERLAY (El cajón secreto) */}
      {showMobileMenu && !isPosSurface && (
        <div className="nx-app-shell fixed inset-0 z-50 flex flex-col animate-in slide-in-from-bottom-full duration-200 lg:hidden">
          <div className="nx-dark-chrome flex items-center justify-between border-b border-white/[0.08] p-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-emerald-300/20 bg-emerald-400/10">
                <span className="text-sm font-black text-emerald-300">N</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-[-0.02em] text-white">nortex<span className="text-emerald-400">.</span></p>
                <p className="truncate text-[11px] text-slate-500">{businessName}</p>
              </div>
            </div>
            <button
              onClick={() => setShowMobileMenu(false)}
              className="nx-fluid-press flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label="Cerrar menú"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-4 pb-24">
            {/* Agrupar items por grupo y renderizar con headers (primary ∪ more: nada se pierde) */}
            {(() => {
              const groups = allItems.reduce<Record<string, NavItem[]>>((acc, item) => {
                if (!acc[item.group]) acc[item.group] = [];
                acc[item.group].push(item);
                return acc;
              }, {});
              return Object.entries(groups).map(([groupName, items]) => (
                <div key={groupName} className="mb-5">
                  <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {groupName}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={e => { setShowMobileMenu(false); guardarSalida(e, item.path); }}
                          className={({ isActive }) => `
                            nx-fluid-press flex min-h-[5.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition-colors
                            ${itemActivo(item, isActive)
                              ? 'border-emerald-400/30 bg-emerald-500/90 text-white shadow-lg shadow-emerald-950/20'
                              : 'border-white/[0.07] bg-white/[0.035] text-slate-400 hover:bg-white/[0.07] hover:text-white'}
                          `}
                        >
                          <Icon size={23} aria-hidden="true" />
                          <span className="text-center text-[10px] font-semibold leading-tight">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>

          <div className="nx-dark-chrome flex-none space-y-2 border-t border-white/[0.08] p-4 pt-3">
            {/* La Ayuda solo existía en el sidebar de escritorio (hidden lg:flex):
                el usuario que más la necesita —el del Android— no la tenía. */}
            <button
              onClick={e => {
                setShowMobileMenu(false);
                if (guardarSalida(e, '/app/ayuda')) navigate('/app/ayuda');
              }}
              className="nx-fluid-press flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.07]"
            >
              <BookOpen size={18} aria-hidden="true" />
              ¿Cómo hago…? (Ayuda)
            </button>
            {canUseAttendanceClock && (
              <button
                onClick={() => { setShowMobileMenu(false); setShowClock(true); }}
                className="nx-fluid-press flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/[0.13]"
              >
                <Clock size={18} aria-hidden="true" />
                Marcar Entrada / Salida
              </button>
            )}
            <button
              onClick={handleLogout}
              className="nx-fluid-press flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-red-400/15 bg-red-400/[0.07] px-3 text-sm font-semibold text-red-300 transition-colors hover:bg-red-400/[0.12]"
            >
              <LogOut size={18} aria-hidden="true" />
              Cerrar sesión
            </button>
            {canToggleMode && (
              <button
                onClick={toggleUiMode}
                className="nx-fluid-press flex min-h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300"
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                {uiMode === 'simple' ? 'Ver menú completo' : 'Ver menú simple'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* El chrome permanece oscuro; el contexto claro empieza recién en el
            workspace para no invertir sidebar, diálogos ni superficies POS. */}
        <header className={`${isPosSurface ? 'hidden' : 'hidden lg:flex'} nx-dark-chrome h-[4.5rem] shrink-0 items-center justify-between border-b border-white/[0.07] px-5 text-white shadow-lg xl:px-6`}>
          <div className="flex min-w-0 items-center gap-4">
            <div className="min-w-0" aria-label="Ubicación actual">
              <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-500">{pageGroup}</p>
              <p className="truncate text-[18px] font-semibold tracking-[-0.025em] text-slate-100">{pageTitle}</p>
            </div>
            {canToggleMode && (
              <button
                type="button"
                onClick={toggleUiMode}
                className="nx-fluid-press hidden min-h-8 items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-3 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/[0.12] xl:inline-flex"
                aria-label={`Cambiar a menú ${uiMode === 'simple' ? 'completo' : 'simple'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-300/60" aria-hidden="true" />
                Menú {uiMode === 'simple' ? 'simple' : 'completo'}
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.035] text-slate-400" role="status" aria-label={toasts.length > 0 ? `${toasts.length} notificaciones nuevas` : 'Sin notificaciones nuevas'}>
              <Bell size={17} aria-hidden="true" />
              {toasts.length > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-surface-950" />}
            </div>
            <div className="h-7 w-px bg-white/[0.08]" aria-hidden="true" />
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-500 text-sm font-bold text-emerald-950 shadow-md shadow-emerald-950/20" aria-hidden="true">
                {sessionInitial}
              </div>
              <div className="hidden min-w-0 max-w-44 xl:block">
                <p className="truncate text-[12px] font-semibold text-slate-200">{sessionName}</p>
                <p className="truncate text-[10px] text-slate-500">{businessName}</p>
              </div>
            </div>
          </div>
        </header>

        <main className={`nx-light-context nx-workspace relative min-h-0 flex-1 overflow-hidden bg-slate-50 [color-scheme:light] ${isPosSurface ? 'mb-0' : 'mb-16 lg:mb-0'}`}>
          {children}
        </main>
      </div>

      {/* Aviso de salida con venta en curso (P0-1). El texto dice la VERDAD:
          la venta queda guardada. Antes esto no existía y salir la borraba; si
          ahora avisáramos "vas a perder la venta" estaríamos mintiendo al revés
          y el cajero aprendería a temerle al menú sin motivo. */}
      {destinoPendiente && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-modal p-4" onClick={() => setDestinoPendiente(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-salida-venta"
            className="bg-surface-900 border border-white/10 rounded-card p-6 w-full max-w-sm text-slate-100"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="titulo-salida-venta" className="text-lg font-extrabold flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-400" /> Tenés una venta abierta
            </h3>
            <p className="text-sm text-slate-300 mt-2">
              {ventaEnCurso.lineas} producto{ventaEnCurso.lineas === 1 ? '' : 's'} por {formatMoney(ventaEnCurso.total)}.
              Si salís se guarda y te espera en la caja.
            </p>
            <div className="mt-5 space-y-2">
              <button
                onClick={() => setDestinoPendiente(null)}
                className="w-full h-11 rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover transition-colors"
              >
                Seguir vendiendo
              </button>
              <button
                onClick={() => { const d = destinoPendiente; setDestinoPendiente(null); navigate(d); }}
                className="w-full h-11 rounded-control bg-white/[0.06] text-slate-100 font-bold hover:bg-white/[0.12] transition-colors"
              >
                Salir igual
              </button>
            </div>
          </div>
        </div>
      )}

      {canUseAttendanceClock && showClock && <PinPadClock onClose={() => setShowClock(false)} />}

      {/* 🔔 Toast de pedidos web */}
      <div className={`pointer-events-none fixed right-4 z-toast flex w-[calc(100%-2rem)] max-w-xs flex-col gap-2 ${isPosSurface ? 'top-4' : 'top-4 lg:top-20'}`} aria-live="polite" aria-atomic="false">
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
              <p className="text-emerald-200 text-xs mt-0.5">Andá a Entregas para gestionarlo</p>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="nx-fluid-press mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Cerrar notificación"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      {/* 🚀 Onboarding guiado: el flujo crea catálogo y configura el negocio,
          por eso ni siquiera se monta en la sesión operativa de bodega. */}
      {userRole !== 'BODEGUERO' && !isPosSurface && <OnboardingHub />}

      {/* 📲 Aviso de instalación de la PWA (solo si el navegador la ofrece) */}
      {!isPosSurface && <InstallPrompt />}
    </div>
  );
};

export default Layout;
