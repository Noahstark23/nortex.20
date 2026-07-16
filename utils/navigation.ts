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
 *   - El default de modo solo cambia para PULPERIA (simple); el resto sigue
 *     viendo el menú completo salvo que elija "Ver menos".
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

const LENDER_ITEMS: NavEntry[] = [
    { path: '/app/dashboard', label: 'Dashboard Financiero', shortLabel: 'Finanzas', group: 'Finanzas', iconKey: 'wallet' },
    { path: '/app/clients', label: 'Cartera de Clientes', shortLabel: 'Clientes', group: 'Clientes', iconKey: 'users' },
    { path: '/app/reports', label: 'Reportes de Cobro', shortLabel: 'Reportes', group: 'Reportes', iconKey: 'pieChart' },
    { path: '/app/team', label: 'Cobradores', shortLabel: 'Equipo', group: 'Administración', iconKey: 'userPlus' },
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

const RETAIL_CATALOG: CatalogEntry[] = [
    // ── INICIO ── (Fase B: home de acciones para quien administra)
    { path: '/app/inicio', label: 'Mi Negocio', shortLabel: 'Inicio', group: 'Inicio', iconKey: 'home', roles: GATE_MANAGER },
    // ── VENTAS ──
    { path: '/app/pos', label: 'Vender', shortLabel: 'Vender', group: 'Ventas', iconKey: 'shoppingCart' },
    { path: '/app/cash-registers', label: 'Caja y Arqueos', shortLabel: 'Caja', group: 'Ventas', iconKey: 'monitor', roles: GATE_MANAGER },
    { path: '/app/inventory', label: 'Mis Productos', shortLabel: 'Productos', group: 'Ventas', iconKey: 'package' },
    { path: '/app/inventory-count', label: 'Contar Productos', shortLabel: 'Conteo', group: 'Ventas', iconKey: 'clipboardList', roles: GATE_ADMIN },
    { path: '/app/delivery', label: 'Entregas', shortLabel: 'Entregas', group: 'Ventas', iconKey: 'truck' },
    { path: '/app/quotations', label: 'Proformas', shortLabel: 'Proformas', group: 'Ventas', iconKey: 'fileText' },
    { path: '/app/clients', label: 'Clientes', shortLabel: 'Clientes', group: 'Ventas', iconKey: 'users' },
    // ── COMPRAS ──
    { path: '/app/purchases', label: 'Compras', shortLabel: 'Compras', group: 'Compras', iconKey: 'truck' },
    { path: '/app/suppliers', label: 'Proveedores', shortLabel: 'Proveed.', group: 'Compras', iconKey: 'clipboardList' },
    { path: '/app/smart-purchases', label: 'Compras Inteligentes', shortLabel: 'Smart', group: 'Compras', iconKey: 'zap', roles: GATE_ADMIN },
    // Mercado B2B oculto del nav hasta tener catálogo real (no mock que debite
    // el wallet). La ruta sigue existiendo con un placeholder "próximamente".
    // ── FINANZAS ──
    { path: '/app/dashboard', label: 'Mi Plata', shortLabel: 'Mi Plata', group: 'Finanzas', iconKey: 'layoutGrid' },
    { path: '/app/receivables', label: 'Fiado y Cobros', shortLabel: 'Fiado', group: 'Finanzas', iconKey: 'wallet' },
    { path: '/app/billing', label: 'Facturación', shortLabel: 'Facturas', group: 'Finanzas', iconKey: 'creditCard' },
    { path: '/app/accounting', label: 'Contabilidad', shortLabel: 'Contab.', group: 'Finanzas', iconKey: 'bookOpen', roles: GATE_ADMIN },
    { path: '/app/reports', label: 'Reportes', shortLabel: 'Reportes', group: 'Finanzas', iconKey: 'pieChart' },
    { path: '/app/financial-health', label: 'Salud Financiera', shortLabel: 'Salud', group: 'Finanzas', iconKey: 'barChart3', roles: GATE_ADMIN },
    { path: '/app/audit', label: 'Auditoría', shortLabel: 'Auditoría', group: 'Finanzas', iconKey: 'shield', roles: GATE_ADMIN },
    // ── PERSONAL ──
    { path: '/app/mi-espacio', label: 'Mi Espacio', shortLabel: 'Mi Espacio', group: 'Personal', iconKey: 'userCircle' },
    // ── ADMINISTRACIÓN ──
    { path: '/app/hr', label: 'Mi Personal', shortLabel: 'Personal', group: 'Administración', iconKey: 'briefcase' },
    { path: '/app/team', label: 'Mi Equipo', shortLabel: 'Equipo', group: 'Administración', iconKey: 'userPlus' },
    { path: '/app/blueprint', label: 'Panel Admin', shortLabel: 'Admin', group: 'Administración', iconKey: 'code2' },
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
 * Ruta de aterrizaje al entrar a /app: cada rol empieza en SU pantalla.
 * En modo simple, quien administra aterriza en "Mi Negocio" (/app/inicio);
 * en modo completo se conserva el dashboard de siempre (sin cambio de conducta).
 */
export function homePathFor(role: string, uiMode: UiMode = 'full'): string {
    if (role === 'CASHIER') return '/app/pos';
    if (role === 'ACCOUNTANT') return '/app/accounting';
    if (uiMode === 'simple' && GATE_MANAGER.includes(role)) return '/app/inicio';
    return '/app/dashboard';
}

// ── Persistencia del modo (la maneja el Layout; acá solo la política) ───────

export const UI_MODE_KEY = 'nortex_ui_mode';

/**
 * Modo por defecto: lo guardado gana; si no hay nada guardado, SOLO la
 * pulpería arranca en simple — el resto conserva el menú completo de siempre.
 */
export function resolveUiMode(tenantType: string, stored: string | null): UiMode {
    if (stored === 'simple' || stored === 'full') return stored;
    return tenantType === 'PULPERIA' ? 'simple' : 'full';
}
