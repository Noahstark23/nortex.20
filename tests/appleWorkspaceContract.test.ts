import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

type DirectWorkspace = {
    component: string;
    file: string;
};

type AuthenticatedWorkspaceMode = 'apple-themed' | 'pos';

/**
 * Inventario deliberado de destinos autenticados. Este mapa es una compuerta:
 * agregar un <Route> en ProtectedApp obliga a decidir explícitamente si hereda
 * el workspace Apple tematizable o si es la única superficie operativa POS.
 */
const AUTHENTICATED_ROUTE_WORKSPACES = {
    inicio: 'apple-themed',
    dashboard: 'apple-themed',
    pos: 'pos',
    sales: 'apple-themed',
    clients: 'apple-themed',
    suppliers: 'apple-themed',
    hr: 'apple-themed',
    'mi-espacio': 'apple-themed',
    quotations: 'apple-themed',
    receivables: 'apple-themed',
    reports: 'apple-themed',
    marketplace: 'apple-themed',
    blueprint: 'apple-themed',
    delivery: 'apple-themed',
    inventory: 'apple-themed',
    warehouses: 'apple-themed',
    'mi-carga': 'apple-themed',
    'purchase-orders': 'apple-themed',
    serials: 'apple-themed',
    scales: 'apple-themed',
    'inventory-count': 'apple-themed',
    'cash-registers': 'apple-themed',
    'smart-purchases': 'apple-themed',
    purchases: 'apple-themed',
    'financial-health': 'apple-themed',
    audit: 'apple-themed',
    accounting: 'apple-themed',
    billing: 'apple-themed',
    team: 'apple-themed',
    cartera: 'apple-themed',
    cobros: 'apple-themed',
    cobradores: 'apple-themed',
    ayuda: 'apple-themed',
} as const satisfies Record<string, AuthenticatedWorkspaceMode>;

const DIRECT_WORKSPACES: DirectWorkspace[] = [
    { component: 'AccountsReceivable', file: 'components/AccountsReceivable.tsx' },
    { component: 'DeliveryManager', file: 'components/DeliveryManager.tsx' },
    { component: 'CashRegisters', file: 'components/CashRegisters.tsx' },
    { component: 'RetailDashboard', file: 'components/Dashboard.tsx' },
    { component: 'Inventory', file: 'components/Inventory.tsx' },
    { component: 'Purchases', file: 'components/Purchases.tsx' },
    { component: 'Clients', file: 'components/Clients.tsx' },
    { component: 'Suppliers', file: 'components/Suppliers.tsx' },
    { component: 'HRM', file: 'components/HRM.tsx' },
    { component: 'BlueprintViewer', file: 'components/BlueprintViewer.tsx' },
];

const readSource = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const isNestedFunction = (node: ts.Node): boolean => (
    ts.isArrowFunction(node)
    || ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
);

const findComponent = (tree: ts.SourceFile, name: string): ts.FunctionLikeDeclaration => {
    let component: ts.FunctionLikeDeclaration | undefined;

    const visit = (node: ts.Node) => {
        if (component) return;

        if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
            component = node;
            return;
        }

        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === name
            && node.initializer
            && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            component = node.initializer;
            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(tree);
    if (!component) throw new Error(`No se encontró el componente ${name}`);
    return component;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
};

const firstRootElement = (expression: ts.Expression): ts.JsxOpeningLikeElement | undefined => {
    const current = unwrapExpression(expression);
    if (ts.isJsxElement(current)) return current.openingElement;
    if (ts.isJsxSelfClosingElement(current)) return current;
    if (ts.isJsxFragment(current)) {
        for (const child of current.children) {
            if (ts.isJsxElement(child)) return child.openingElement;
            if (ts.isJsxSelfClosingElement(child)) return child;
        }
    }
    return undefined;
};

const classNameText = (tree: ts.SourceFile, element: ts.JsxOpeningLikeElement): string => {
    const attribute = element.attributes.properties.find((property): property is ts.JsxAttribute => (
        ts.isJsxAttribute(property) && property.name.getText(tree) === 'className'
    ));

    if (!attribute?.initializer) return '';
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
        return attribute.initializer.expression.getText(tree);
    }
    return attribute.initializer.getText(tree);
};

type RouteDeclaration = {
    path: string;
    element: string;
    isInsideLayout: boolean;
};

const jsxAttributeText = (
    tree: ts.SourceFile,
    element: ts.JsxOpeningLikeElement,
    name: string,
): string => {
    const attribute = element.attributes.properties.find((property): property is ts.JsxAttribute => (
        ts.isJsxAttribute(property) && property.name.getText(tree) === name
    ));

    if (!attribute?.initializer) return '';
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
        return attribute.initializer.expression.getText(tree);
    }
    return attribute.initializer.getText(tree);
};

const isInsideJsxElement = (
    tree: ts.SourceFile,
    node: ts.Node,
    component: ts.FunctionLikeDeclaration,
    tagName: string,
): boolean => {
    let current: ts.Node | undefined = node.parent;
    while (current && current !== component) {
        if (
            ts.isJsxElement(current)
            && current.openingElement.tagName.getText(tree) === tagName
        ) return true;
        current = current.parent;
    }
    return false;
};

const componentRoutes = (componentName: string): RouteDeclaration[] => {
    const file = 'App.tsx';
    const tree = ts.createSourceFile(
        file,
        readSource(file),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const component = findComponent(tree, componentName);
    const routes: RouteDeclaration[] = [];

    const visit = (node: ts.Node) => {
        if (node !== component && isNestedFunction(node)) return;
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
            && node.tagName.getText(tree) === 'Route'
        ) {
            const path = jsxAttributeText(tree, node, 'path');
            if (!path) throw new Error(`${componentName} declara un <Route> sin path literal.`);
            routes.push({
                path,
                element: jsxAttributeText(tree, node, 'element'),
                isInsideLayout: isInsideJsxElement(tree, node, component, 'Layout'),
            });
            return;
        }
        ts.forEachChild(node, visit);
    };

    visit(component);
    return routes;
};

/**
 * Extrae solo las superficies devueltas directamente por el componente de ruta.
 * Ignora returns de callbacks, effects y subcomponentes para no confundir un
 * modal oscuro permitido con el fondo de todo el módulo.
 */
const routeRootClasses = (file: string, componentName: string): string[] => {
    const source = readSource(file);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = findComponent(tree, componentName);
    const classes: string[] = [];

    const visit = (node: ts.Node) => {
        if (node !== component && isNestedFunction(node)) return;
        if (ts.isReturnStatement(node) && node.expression) {
            const element = firstRootElement(node.expression);
            if (element) classes.push(classNameText(tree, element));
            return;
        }
        ts.forEachChild(node, visit);
    };

    visit(component);
    return classes;
};

describe('contrato Apple/HIG del workspace autenticado', () => {
    it('clasifica todas las rutas autenticadas de App.tsx y las mantiene dentro de Layout', () => {
        const protectedRoutes = componentRoutes('ProtectedApp');
        const declaredDestinations = [...new Set(
            protectedRoutes
                .map(({ path }) => path)
                .filter((path) => path !== '*'),
        )].sort();
        const consideredDestinations = Object.keys(AUTHENTICATED_ROUTE_WORKSPACES).sort();

        expect(declaredDestinations).toEqual(consideredDestinations);
        expect(protectedRoutes.some(({ path }) => path === '*'), 'ProtectedApp debe conservar su fallback autenticado.')
            .toBe(true);
        for (const route of protectedRoutes) {
            expect(
                route.isInsideLayout,
                `La ruta autenticada "${route.path}" debe permanecer dentro de <Layout> para heredar el workspace.`,
            ).toBe(true);
        }

        const appRoutes = componentRoutes('App');
        const absoluteAppRoutes = appRoutes.filter(({ path }) => path === '/app' || path.startsWith('/app/'));
        expect(absoluteAppRoutes).toEqual([
            expect.objectContaining({ path: '/app/*', element: '<ProtectedApp />' }),
        ]);
    });

    it('reserva POS como única excepción funcional y manda lo demás al bridge tematizable', () => {
        const exceptions = Object.entries(AUTHENTICATED_ROUTE_WORKSPACES)
            .filter(([, mode]) => mode === 'pos');
        const themedDestinations = Object.entries(AUTHENTICATED_ROUTE_WORKSPACES)
            .filter(([, mode]) => mode === 'apple-themed');
        const layout = readSource('components/Layout.tsx');

        expect(exceptions).toEqual([['pos', 'pos']]);
        expect(themedDestinations).toHaveLength(Object.keys(AUTHENTICATED_ROUTE_WORKSPACES).length - 1);
        expect(layout).toContain("const isPosSurface = location.pathname === '/app/pos';");
        expect(layout).toContain("? 'nx-pos-workspace nx-dark-context");
        expect(layout).toContain("? 'nx-apple-dark-workspace nx-dark-context");
        expect(layout).toContain(": 'nx-apple-light-workspace nx-light-context");
    });

    it('expone el tema en el shell y entrega el contenido en el workspace correspondiente', () => {
        const layout = readSource('components/Layout.tsx');

        expect(layout).toContain('data-nx-theme={workspaceTheme}');
        expect(layout).toContain('<main className={`nx-workspace ${workspaceModeClass}');
        expect(layout).toContain('<main className={`nx-workspace ${collectorWorkspaceModeClass}');
        expect(layout).not.toContain('data-nx-theme="dark"');
        expect(layout).not.toContain('mobile-only-layout');
        expect(layout).toContain('readWorkspaceTheme()');
        expect(layout).toContain('persistWorkspaceTheme(workspaceTheme)');
        expect(layout).toContain("document.documentElement.setAttribute('data-nx-theme', workspaceTheme)");
        expect(layout).toContain("document.body.setAttribute('data-nx-theme', workspaceTheme)");
        expect(layout).toContain('nx-overlay-backdrop');
        expect(layout).toContain('nx-overlay-dialog');
        expect(layout).not.toContain('bg-surface-900 border border-white/10 rounded-card p-6 w-full max-w-sm text-slate-100');
        expect(layout).toContain('nx-shell-nav-item-active');
        expect(layout).toContain('nx-shell-text');
        expect(layout).toContain('nx-shell-muted');
    });

    it('ofrece un único control conceptual Día/Noche en desktop y menú móvil', () => {
        const layout = readSource('components/Layout.tsx');

        expect(layout.match(/<ThemeToggle\s/g)).toHaveLength(3);
        expect(layout).toContain("const currentModeLabel = isDark ? 'modo noche' : 'modo día';");
        expect(layout).toContain("const actionLabel = isDark ? 'Modo día' : 'Modo noche';");
        expect(layout).toContain('aria-pressed={isDark}');
        expect(layout).toContain('aria-label={`${currentModeLabel} activo. Cambiar a ${actionLabel.toLowerCase()}`}');
        expect(layout).toContain('<span className="nx-theme-toggle-label">{actionLabel}</span>');
        expect(layout).toMatch(/\bMoon\b/);
        expect(layout).toMatch(/\bSun\b/);
    });

    it('cierra el menú móvil si el viewport cruza al layout de escritorio', () => {
        const layout = readSource('components/Layout.tsx');

        expect(layout).toContain("globalThis.matchMedia('(min-width: 1024px)')");
        expect(layout).toContain('if (desktopQuery.matches) setShowMobileMenu(false);');
        expect(layout).toContain("desktopQuery.addEventListener('change', closeMobileMenuOnDesktop)");
    });

    it('mantiene legible el paso de efectivo del cobrador aunque todavía no haya cliente seleccionado', () => {
        const collector = readSource('components/LenderMode/MotorizadosPanel.tsx');

        expect(collector).toContain('disabled={!selectedLoan}');
        expect(collector).toContain('disabled:opacity-60');
        expect(collector).not.toContain("'opacity-30 pointer-events-none'");
    });

    it('centraliza ambos temas autenticados sin tocar POS ni las páginas públicas', () => {
        const styles = readSource('index.css');

        expect(styles).toMatch(/\.nx-apple-light-workspace\s*\{[\s\S]*?background:\s*var\(--nx-canvas\)/);
        expect(styles).toMatch(/\.nx-apple-dark-workspace\s*\{/);
        expect(styles).toMatch(/\.nx-apple-light-workspace[\s\S]*?bg-surface-950[\s\S]*?var\(--nx-canvas\)/);
        expect(styles).toMatch(/\.nx-apple-light-workspace[\s\S]*?bg-surface-900[\s\S]*?var\(--nx-canvas-raised\)/);
        expect(styles).toMatch(/\.nx-apple-dark-workspace[\s\S]*?bg-white\/60[\s\S]*?bg-white\/80[\s\S]*?var\(--nx-canvas-raised\)/);
        expect(styles).toMatch(/\[data-nx-theme='light'\]\s+:is\(\.nx-sidebar,\s+\.nx-dark-chrome\):not\(\.nx-pos-workspace \*\)/);
        expect(styles).not.toMatch(/\.nx-pos-workspace\s*:is\(/);
    });

    it.each(DIRECT_WORKSPACES)(
        '$file expone cada estado de ruta como workspace claro',
        ({ component, file }) => {
            const roots = routeRootClasses(file, component);

            expect(roots.length, `${component} debe devolver al menos una superficie de ruta.`).toBeGreaterThan(0);
            for (const root of roots) {
                expect(root, `${component} debe declarar nx-light-context en su raíz de ruta.`)
                    .toMatch(/\bnx-light-context\b/);
                expect(root, `${component} debe declarar nx-workspace en su raíz de ruta.`)
                    .toMatch(/\bnx-workspace\b/);
                expect(root, `${component} no puede convertir toda la ruta en contexto oscuro.`)
                    .not.toMatch(/\bnx-dark-context\b/);
                expect(root, `${component} no puede usar surface-950 como fondo de toda la ruta.`)
                    .not.toMatch(/\bbg-surface-950(?:\b|\/)/);
            }
        },
    );

    it('mantiene el dashboard retail como destino del router para comercios', () => {
        const dashboard = readSource('components/Dashboard.tsx');

        expect(dashboard).toMatch(/return\s*<RetailDashboard\s*\/>\s*;/);
    });

    it('centraliza tipografía, canvas, tarjeta elevada y colores semánticos en tokens', () => {
        const tokens = readSource('nortex-tokens.css');

        expect(tokens).toMatch(/--nx-font:\s*-apple-system,\s*BlinkMacSystemFont/);
        expect(tokens).toMatch(/--nx-font-display:\s*-apple-system,\s*BlinkMacSystemFont/);
        expect(tokens).toMatch(/--nx-canvas:\s*#[0-9A-Fa-f]{6}/);
        expect(tokens).toMatch(/--nx-canvas-raised:\s*#FFFFFF/i);
        expect(tokens).toMatch(/--nx-brand:\s*#16C784/i);
        expect(tokens).toMatch(/--nx-danger:\s*#[0-9A-Fa-f]{6}/);
        expect(tokens).toMatch(/--nx-warning:\s*#[0-9A-Fa-f]{6}/);
    });
});
