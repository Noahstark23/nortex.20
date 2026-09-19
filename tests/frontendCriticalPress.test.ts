import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const cashRegisters = source('components/CashRegisters.tsx');
const sales = source('components/Sales.tsx');
const pendingCorrections = source('components/sales/PendingCorrections.tsx');
const guestPos = source('components/GuestPOS.tsx');
const indexCss = source('index.css');

const buttonContaining = (component: string, marker: string): string => {
    const button = [...component.matchAll(/<button\b[\s\S]*?<\/button>/g)]
        .map(([match]) => match)
        .find((match) => match.includes(marker));

    expect(button, `No se encontró el botón crítico con marcador: ${marker}`).toBeDefined();
    return button!;
};

const expectPressTarget = (component: string, marker: string) => {
    const button = buttonContaining(component, marker);
    expect(button).toContain('nx-fluid-press');
    expect(button).toContain('min-h-tap');
};

const expectOnBrandText = (component: string, marker: string) => {
    const button = buttonContaining(component, marker);
    expect(button).toContain('text-brand-on');
    expect(button).not.toContain('text-white');
};

describe('presión y contraste de acciones operativas críticas', () => {
    it('protege tabs, búsqueda y apertura de ventas como objetivos táctiles', () => {
        for (const marker of [
            'Historial de ventas',
            'Aprobaciones',
            'Pendientes',
            '>Buscar</button>',
            'openSale(sale.id)',
        ]) {
            expectPressTarget(sales, marker);
        }
    });

    it('protege el flujo destructivo de cierre forzado', () => {
        for (const marker of ['Forzar Cierre', 'Confirmar Cierre', 'Cancelar', 'Guardar umbrales']) {
            expectPressTarget(cashRegisters, marker);
        }
    });

    it('protege las resoluciones de correcciones pendientes', () => {
        for (const marker of ['>Guardar</button>', 'Marcar enviado', '>Descartar</button>', 'Liberar a stock']) {
            expectPressTarget(pendingCorrections, marker);
        }
    });

    it('usa el color on-brand en CTAs con fondos sólidos de marca o sus alias', () => {
        for (const marker of ['Historial de ventas', 'Aprobaciones', 'Pendientes', '>Buscar</button>', "'Aprobar'", "'Ejecutar'"]) {
            expectOnBrandText(sales, marker);
        }
        for (const marker of ['>Guardar</button>', 'Liberar a stock']) {
            expectOnBrandText(pendingCorrections, marker);
        }
    });

    it('separa la acción informativa de la acción primaria del producto', () => {
        const informational = buttonContaining(pendingCorrections, 'Marcar enviado');
        expect(informational).toContain('bg-sky-700');
        expect(informational).toContain('text-white');
        expect(informational).not.toContain('text-brand-on');

        const primary = buttonContaining(cashRegisters, 'Guardar umbrales');
        expect(primary).toContain('bg-brand');
        expect(primary).toContain('text-brand-on');
        expect(primary).not.toContain('bg-sky-700');
    });

    it('no conserva utilidades de animación que no compilan en Caja y Arqueos', () => {
        for (const deadUtility of ['animate-in', 'slide-in-from-right', 'fade-in', 'zoom-in-95']) {
            expect(cashRegisters).not.toContain(deadUtility);
        }
        expect(cashRegisters).not.toContain('transition-all');
    });

    it('mantiene limpias las primitives globales de botones para no reintroducir deuda por alias', () => {
        for (const primitive of ['.btn-primary', '.btn-ghost']) {
            const segment = indexCss.slice(indexCss.indexOf(primitive), indexCss.indexOf('}', indexCss.indexOf(primitive)));
            expect(segment).not.toContain('transition-all');
            expect(segment).not.toContain('active:scale');
        }
        expect(indexCss).toMatch(/\.nx-fluid-press,\s*\.btn-primary,\s*\.btn-ghost\s*\{/);
        expect(indexCss).toMatch(/\.btn-primary:active:not\(:disabled\),\s*\.btn-ghost:active:not\(:disabled\)/);
    });

    it('mantiene en 44 px los controles compactos observados en la demo móvil', () => {
        for (const marker of ["setCatalogDensity('cards')", "setCatalogDensity('dense')"]) {
            expectPressTarget(guestPos, marker);
        }

        const clearCart = buttonContaining(guestPos, 'clearCart');
        expect(clearCart).toContain('min-h-tap');
        expect(clearCart).toContain('min-w-tap');
    });

    it('usa una tinta de marca legible sobre las tarjetas blancas del catálogo', () => {
        const addProduct = buttonContaining(guestPos, 'addToCart(product)');
        expect(addProduct).toContain('text-brand-800');
        expect(addProduct).not.toContain('text-brand ');
    });
});
