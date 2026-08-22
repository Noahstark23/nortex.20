/**
 * Pertenencia de rutas al menú (P0-3).
 *
 * Lo que se protege: entrar a Bodegas o Series dejaba el sidebar sin ningún ítem
 * activo y con las secciones plegadas — un callejón sin salida. La regla de qué
 * ítem "posee" cada ruta vive en el módulo puro, así que se testea sin React.
 */
import { describe, it, expect } from 'vitest';
import { buildNavigation, homePathFor, navPathForRoute, esRutaDe, RUTAS_SATELITE } from '../utils/navigation';

describe('esRutaDe', () => {
    it('la ruta exacta pertenece a su propio ítem', () => {
        expect(esRutaDe('/app/inventory', '/app/inventory')).toBe(true);
    });

    it('una pantalla por debajo pertenece al ítem padre', () => {
        expect(esRutaDe('/app/inventory', '/app/inventory/123')).toBe(true);
    });

    it('NO confunde un hermano con prefijo compartido', () => {
        // Sin el borde de '/', estar en Contar Productos marcaría Mis Productos.
        expect(esRutaDe('/app/inventory', '/app/inventory-count')).toBe(false);
    });

    it('no marca rutas ajenas', () => {
        expect(esRutaDe('/app/inventory', '/app/pos')).toBe(false);
    });
});

describe('navPathForRoute', () => {
    it('Bodegas se atribuye a Mis Productos', () => {
        expect(navPathForRoute('/app/warehouses')).toBe('/app/inventory');
    });

    it('Series se atribuye a Mis Productos', () => {
        expect(navPathForRoute('/app/serials')).toBe('/app/inventory');
    });

    it('una subruta del satélite también se atribuye', () => {
        expect(navPathForRoute('/app/warehouses/abc')).toBe('/app/inventory');
    });

    it('una ruta normal se devuelve tal cual', () => {
        expect(navPathForRoute('/app/pos')).toBe('/app/pos');
        expect(navPathForRoute('/app/inventory-count')).toBe('/app/inventory-count');
    });

    it('todo satélite apunta a un ítem distinto de sí mismo', () => {
        // Un satélite que se apunte a sí mismo dejaría el bug intacto sin avisar.
        for (const [satelite, dueño] of Object.entries(RUTAS_SATELITE)) {
            expect(dueño).not.toBe(satelite);
            expect(dueño.startsWith('/app/')).toBe(true);
        }
    });

    it('atribuye Inventario a Bodegas para el menú dedicado del bodeguero', () => {
        expect(navPathForRoute('/app/inventory', 'BODEGUERO')).toBe('/app/warehouses');
        expect(navPathForRoute('/app/warehouses', 'BODEGUERO')).toBe('/app/warehouses');
        expect(navPathForRoute('/app/inventory-count', 'BODEGUERO')).toBe('/app/inventory-count');
    });
});

describe('navegación de BODEGUERO', () => {
    it('ofrece solo los tres flujos operativos y aterriza en Bodegas', () => {
        const nav = buildNavigation({ tenantType: 'RETAIL', role: 'BODEGUERO', simple: true });

        expect(nav.homePath).toBe('/app/warehouses');
        expect(nav.more).toEqual([]);
        expect(nav.primary.map(item => item.path)).toEqual([
            '/app/warehouses',
            '/app/inventory-count',
            '/app/purchase-orders',
        ]);
        expect(nav.primary.map(item => item.label)).toEqual([
            'Bodegas y existencias',
            'Conteo físico',
            'Recibir mercadería',
        ]);
    });

    it('no cambia con el modo del menú ni expone ventas, dinero o administración', () => {
        const simple = buildNavigation({ tenantType: 'FERRETERIA', role: 'BODEGUERO', simple: true });
        const full = buildNavigation({ tenantType: 'FERRETERIA', role: 'BODEGUERO', simple: false });
        const paths = full.primary.map(item => item.path);

        expect(full).toEqual(simple);
        expect(paths).not.toContain('/app/pos');
        expect(paths).not.toContain('/app/purchases');
        expect(paths).not.toContain('/app/dashboard');
        expect(paths).not.toContain('/app/team');
        expect(homePathFor('BODEGUERO')).toBe('/app/warehouses');
    });
});
