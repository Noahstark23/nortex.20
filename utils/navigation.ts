/**
 * NORTEX — navegación por tipo de negocio y rol (Fase A del plan UX Simple).
 *
 * PROBLEMA: el menú era "talla única" — una pulpería veía ~17 módulos
 * (Contabilidad NIIF, Auditoría, B2B...) aunque su día son 4 acciones.
 *
 * DISEÑO: módulo PURO (sin React ni íconos — el Layout mapea `iconKey` a
 * lucide). `buildNavigation` decide qué va al menú principal (`primary`) y qué
 * queda plegado en "Más opciones" (`more`) según:
 *   - tenant.type  → set simple por giro (pulpería ≠ ferretería ≠ farmacia)
 *   - rol          → el gating existente se conserva tal cual
 *   - modo         → 'simple' | 'full' (persistido en localStorage por el Layout)
 *
 * INVARIANTES (verificados en QA):
 *   - primary ∪ more = exactamente el menú actual para ese rol (nada se pierde).
 *   - modo 'full' → primary = menú completo de siempre, more = [].
 *   - LENDER y ACCOUNTANT conservan sus menús reducidos actuales sin cambios.
 *   - Default (R2.6): TODO giro retail arranca en simple — la auditoría UX
 *     mostró que 12 de 22 etiquetas no pasan la prueba del pulpero y que
 *     ferretería/farmacia (los nichos con landing propia) seguían viendo el
 *     menú completo. Lo guardado en localStorage siempre gana, y el Layout
 *     ahora expone el toggle "Ver menú completo/simple".
 */

export type UiMode = 'simple' | 'full';

export interface NavEntry {
    path: string;
    label: string;
    shortLabel: string;
    group: string;
    /** Clave que el Layout mapea a su ícono de lucide-react. */
    iconKey: string;
}

export interface Navigation {
    /** Items visibles de entrada. */
    primary: NavEntry[];
    /** Items plegados bajo "Más opciones" (vacío en modo full). */
    more: NavEntry[];
    /** Ruta de aterrizaje al entrar a /app. */
    homePath: string;
}

export interface NavContext {
    /** Tenant.type: FERRETERIA | PULPERIA | FARMACIA | DISTRIBUIDORA | BOUTIQUE | RETAIL | MISCELANEA | LENDER */
    tenantType: string;
    /** Rol del JWT; para tenants LENDER el Layout lo prefija LENDER_. */
    role: string;
    /** true = modo simple (menú corto + "Más opciones"). */
    simple: boolean;
}

// ── Catálogo completo (labels de mostrador; mismas rutas de siempre) ─────────

// Rutas propias del prestamista (Fase 2 H7): antes 3 de 4 items apuntaban a
// /app/clients · /app/reports · /app/team → pantallas de RETAIL (endpoints de
// ventas, no /api/loans/*). Ahora cada item llega a su tab real del panel del
// prestamista (LenderDashboard), vía rutas dedicadas que no chocan con retail.
const LENDER_ITEMS: NavEntry[] = [
    { path: '/app/dashboard', label: 'Dashboard Financiero', shortLabel: 'Finanzas', group: 'Finanzas', iconKey: 'wallet' },
    { path: '/app/cartera', label: 'Cartera de Clientes', shortLabel: 'Cartera', group: 'Clientes', iconKey: 'users' },
    { path: '/app/cobros', label: 'Reportes de Cobro', shortLabel: 'Cobros', group: 'Reportes', iconKey: 'pieChart' },
    { path: '/app/cobradores', label: 'Cobradores', shortLabel: 'Cobradores', group: 'Administración', iconKey: 'userPlus' },
];

// Vendedor de ruta: menú corto DEDICADO (como el del contador). El gating del
// catálogo retail es por INCLUSIÓN (roles?: en cada entry): un rol desconocido
// vería todo lo no-gated — Compras, Proveedores, Mi Equipo… Un branch propio
// evita sembrar `roles` en ~10 entries y deja el menú del vendedor explícito.
const VENDEDOR_ITEMS: NavEntry[] = [
    { path: '/app/pos', label: 'Vender', shortLabel: 'Vender', group: 'Ventas', iconKey: 'shoppingCart' },
    { path: '/app/mi-carga', label: 'Mi Carga', shortLabel: 'Carga', group: 'Ventas', iconKey: 'truck' },
    { path: '/app/clients', label: 'Mis Clientes', shortLabel: 'Clientes', group: 'Clientes', iconKey: 'users' },
    { path: '/app/receivables', label: 'Fiado / Cobros', shortLabel: 'Fiado', group: 'Clientes', iconKey: 'creditCard' },
    { path: '/app/reports', label: 'Mi Reporte', shortLabel: 'Reporte', group: 'Reportes', iconKey: 'pieChart' },
];

const ACCOUNTANT_ITEMS: NavEntry[] = [
    { path: '/app/accounting', label: 'Contabilidad', shortLabel: 'Contab.', group: 'Fiscal', iconKey: 'bookOpen' },
    { path: '/app/reports', label: 'Reportes / Fiscal', shortLabel: 'Fiscal', group: 'Fiscal', iconKey: 'pieChart' },
    { path: '/app/purchases', label: 'Compras', shortLabel: 'Compras', group: 'Fiscal', iconKey: 'truck' },
    { path: '/app/audit', label: 'Auditoría', shortLabel: 'Auditoría', group: 'Fiscal', iconKey: 'shield' },
];

/** Roles con acceso a cada item gated (mismo gating que existía en Layout). */
const GATE_MANAGER = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'];
const GATE_ADMIN = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

interface CatalogEntry extends NavEntry {
    /** Si está presente, solo estos roles ven el item (igual que antes). */
    roles?: string[];
}

// ── 5 secciones (rediseño Fase 2) ───────────────────────────────────────────
// Antes eran 8 grupos con solapamiento que el usuario no podía resolver solo:
// Finanzas / Salud Financiera / Contabilidad / Reportes vivían mezcladas, y
// Compras / Compras Inteligentes / Proveedores estaban repartidas. Ahora el
// menú responde a una pregunta por sección: qué vendo, qué tengo, a quién le
// vendo, cuánta plata hay, cómo se administra el negocio.
export const NAV_SECTIONS = ['VENDER', 'STOCK', 'CLIENTES', 'DINERO', 'NEGOCIO'] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

const RETAIL_CATALOG: CatalogEntry[] = [
    // ── INICIO ── (home de acciones para quien administra; fuera de sección)
    { path: '/app/inicio', label: 'Mi Negocio', shortLabel: 'Inicio', group: 'Inicio', iconKey: 'home', roles: GATE_MANAGER },
    // ── VENDER ──
    { path: '/app/pos', label: 'Vender', shortLabel: 'Vender', group: 'VENDER', iconKey: 'shoppingCart' },
    { path: '/app/cash-registers', label: 'Caja y Arqueos', shortLabel: 'Caja', group: 'VENDER', iconKey: 'monitor', roles: GATE_MANAGER },
    { path: '/app/quotations', label: 'Proformas', shortLabel: 'Proformas', group: 'VENDER', iconKey: 'fileText' },
    { path: '/app/delivery', label: 'Entregas', shortLabel: 'Entregas', group: 'VENDER', iconKey: 'truck' },
    // ── STOCK ──
    { path: '/app/inventory', label: 'Mis Productos', shortLabel: 'Productos', group: 'STOCK', iconKey: 'package' },
    { path: '/app/inventory-count', label: 'Contar Productos', shortLabel: 'Conteo', group: 'STOCK', iconKey: 'clipboardList', roles: GATE_ADMIN },
    { path: '/app/purchases', label: 'Compras', shortLabel: 'Compras', group: 'STOCK', iconKey: 'truck' },
    { path: '/app/smart-purchases', label: 'Compras Inteligentes', shortLabel: 'Smart', group: 'STOCK', iconKey: 'zap', roles: GATE_ADMIN },
    { path: '/app/suppliers', label: 'Proveedores', shortLabel: 'Proveed.', group: 'STOCK', iconKey: 'clipboardList' },
    // Mercado B2B oculto del nav hasta tener catálogo real (no mock que debite
    // el wallet). La ruta sigue existiendo con un placeholder "próximamente".
    // ── CLIENTES ──
    { path: '/app/clients', label: 'Clientes', shortLabel: 'Clientes', group: 'CLIENTES', iconKey: 'users' },
    { path: '/app/receivables', label: 'Fiado y Cobros', shortLabel: 'Fiado', group: 'CLIENTES', iconKey: 'wallet' },
    // ── DINERO ──
    { path: '/app/dashboard', label: 'Mi Plata', shortLabel: 'Mi Plata', group: 'DINERO', iconKey: 'layoutGrid' },
    { path: '/app/financial-health', label: 'Salud Financiera', shortLabel: 'Salud', group: 'DINERO', iconKey: 'barChart3', roles: GATE_ADMIN },
    { path: '/app/accounting', label: 'Contabilidad', shortLabel: 'Contab.', group: 'DINERO', iconKey: 'bookOpen', roles: GATE_ADMIN },
    { path: '/app/reports', label: 'Reportes', shortLabel: 'Reportes', group: 'DINERO', iconKey: 'pieChart' },
    // ── NEGOCIO ──
    { path: '/app/mi-espacio', label: 'Mi Espacio', shortLabel: 'Mi Espacio', group: 'NEGOCIO', iconKey: 'userCircle' },
    { path: '/app/team', label: 'Mi Equipo', shortLabel: 'Equipo', group: 'NEGOCIO', iconKey: 'userPlus' },
    { path: '/app/hr', label: 'Mi Personal', shortLabel: 'Personal', group: 'NEGOCIO', iconKey: 'briefcase' },
    { path: '/app/audit', label: 'Auditoría', shortLabel: 'Auditoría', group: 'NEGOCIO', iconKey: 'shield', roles: GATE_ADMIN },
    // "Facturación" era el peor label del sistema: no es facturarle a clientes,
    // es pagarle la suscripción a Nortex. Ahora dice lo que es.
    { path: '/app/billing', label: 'Mi Plan de Nortex', shortLabel: 'Mi Plan', group: 'NEGOCIO', iconKey: 'creditCard' },
    // "Panel Admin" (/app/blueprint) fuera del catálogo (R2.5 D4): es el
    // BlueprintViewer, una pantalla de desarrollador. La ruta sigue por URL.
];

// ── Sets simples por giro (rutas; el orden ES el orden del menú) ─────────────
// La 1.ª posición es la acción principal del día; en móvil se ven las primeras 4.

// "Mi Negocio" (/app/inicio) va primero para roles administradores; para roles
// sin acceso (p. ej. CASHIER) simplemente se filtra por el gating del catálogo.
const SIMPLE_SETS: Record<string, string[]> = {
    PULPERIA: ['/app/inicio', '/app/pos', '/app/receivables', '/app/inventory', '/app/dashboard'],
    FERRETERIA: ['/app/inicio', '/app/pos', '/app/receivables', '/app/inventory', '/app/quotations', '/app/purchases', '/app/dashboard'],
    FARMACIA: ['/app/inicio', '/app/pos', '/app/inventory', '/app/purchases', '/app/receivables', '/app/dashboard'],
    DISTRIBUIDORA: ['/app/inicio', '/app/pos', '/app/quotations', '/app/inventory', '/app/purchases', '/app/receivables', '/app/delivery', '/app/dashboard'],
};

/** Set simple por defecto para giros sin set propio (RETAIL, BOUTIQUE, MISCELANEA…). */
const SIMPLE_DEFAULT: string[] = ['/app/inicio', '/app/pos', '/app/receivables', '/app/inventory', '/app/purchases', '/app/dashboard'];

// ── API ──────────────────────────────────────────────────────────────────────

const stripRoles = ({ roles: _roles, ...entry }: CatalogEntry): NavEntry => entry;

/** Menú completo del catálogo retail para un rol (mismo resultado que el Layout viejo). */
function retailItemsForRole(role: string): NavEntry[] {
    return RETAIL_CATALOG.filter(it => !it.roles || it.roles.includes(role)).map(stripRoles);
}

/**
 * Construye la navegación para el contexto dado.
 * Pura: mismo input → mismo output (testeable sin DOM).
 */
export function buildNavigation(ctx: NavContext): Navigation {
    const { tenantType, role, simple } = ctx;

    // LENDER y CONTADOR conservan sus menús reducidos actuales, sin modo simple.
    if (role.startsWith('LENDER_')) {
        return { primary: [...LENDER_ITEMS], more: [], homePath: '/app/dashboard' };
    }
    if (role === 'ACCOUNTANT') {
        return { primary: [...ACCOUNTANT_ITEMS], more: [], homePath: '/app/accounting' };
    }
    if (role === 'VENDEDOR') {
        return { primary: [...VENDEDOR_ITEMS], more: [], homePath: '/app/pos' };
    }

    const all = retailItemsForRole(role);
    const homePath = homePathFor(role, simple ? 'simple' : 'full');

    if (!simple) {
        return { primary: all, more: [], homePath };
    }

    const wanted = SIMPLE_SETS[tenantType] ?? SIMPLE_DEFAULT;
    // primary respeta el ORDEN del set simple; more conserva el orden del catálogo.
    const primary = wanted
        .map(path => all.find(it => it.path === path))
        .filter((it): it is NavEntry => Boolean(it));
    const primaryPaths = new Set(primary.map(it => it.path));
    const more = all.filter(it => !primaryPaths.has(it.path));

    return { primary, more, homePath };
}

/**
 * Agrupa entradas en las 5 secciones del menú, en el orden canónico de
 * NAV_SECTIONS. Pura y sin React: el Layout solo la pinta.
 *
 * - Devuelve únicamente las secciones que quedaron con items (un CASHIER no ve
 *   una sección DINERO vacía).
 * - Lo que no cae en ninguna sección (p. ej. "Mi Negocio", o los menús de
 *   LENDER/CONTADOR que traen sus propios grupos) sale en `loose`, para
 *   renderizarse suelto arriba. Así ninguna entrada se pierde, que es la
 *   invariante del módulo.
 */
// Genérica sobre `{ group }`: el Layout enriquece las entradas con el componente
// de ícono antes de agrupar, así que el tipo que entra no es NavEntry exacto.
export function groupBySection<T extends { group: string }>(entries: T[]): {
    sections: { section: NavSection; items: T[] }[];
    loose: T[];
} {
    const known = new Set<string>(NAV_SECTIONS);
    const sections = NAV_SECTIONS
        .map(section => ({ section, items: entries.filter(e => e.group === section) }))
        .filter(s => s.items.length > 0);
    const loose = entries.filter(e => !known.has(e.group));
    return { sections, loose };
}

/**
 * Ruta de aterrizaje al entrar a /app: cada rol empieza en SU pantalla.
 * En modo simple, quien administra aterriza en "Mi Negocio" (/app/inicio);
 * en modo completo se conserva el dashboard de siempre (sin cambio de conducta).
 */
export function homePathFor(role: string, uiMode: UiMode = 'full'): string {
    if (role === 'CASHIER') return '/app/pos';
    if (role === 'VENDEDOR') return '/app/pos';
    if (role === 'ACCOUNTANT') return '/app/accounting';
    if (uiMode === 'simple' && GATE_MANAGER.includes(role)) return '/app/inicio';
    return '/app/dashboard';
}

// ── Persistencia del modo (la maneja el Layout; acá solo la política) ───────

export const UI_MODE_KEY = 'nortex_ui_mode';

/**
 * Modo por defecto: lo guardado gana; si no hay nada guardado, todo giro
 * retail arranca en simple (R2.6 — antes solo la pulpería, y ferretería/
 * farmacia quedaban con las 22 etiquetas de ERP). LENDER no tiene modo
 * simple: su menú ya es reducido y su home no es /app/inicio.
 */
export function resolveUiMode(tenantType: string, stored: string | null): UiMode {
    if (stored === 'simple' || stored === 'full') return stored;
    return tenantType === 'LENDER' ? 'full' : 'simple';
}

/**
 * Modo simple del POS — desacoplado del menú (QA R2.6): el POS simple esconde
 * tiquetera, parqueo, devoluciones e importación. Que el MENÚ de una ferretería
 * arranque simple está bien; esconderle Devoluciones y la tiquetera al
 * mostrador sería una regresión real. Por eso el POS solo se simplifica por
 * defecto en PULPERIA (el comportamiento de siempre); la elección explícita
 * del usuario (mismo UI_MODE_KEY) sí aplica en todos lados.
 */
export function resolvePosSimple(tenantType: string, stored: string | null): boolean {
    if (stored === 'simple' || stored === 'full') return stored === 'simple';
    return tenantType === 'PULPERIA';
}
