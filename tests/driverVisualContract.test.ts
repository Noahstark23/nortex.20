import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const driver = readFileSync(resolve(ROOT, 'components/DriverView.tsx'), 'utf8');
const css = readFileSync(resolve(ROOT, 'index.css'), 'utf8');

const elementContaining = (tag: 'a' | 'button', marker: string): string => {
    const element = [...driver.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'g'))]
        .map(([match]) => match)
        .find(match => match.includes(marker));

    expect(element, `No se encontró <${tag}> con marcador: ${marker}`).toBeDefined();
    return element!;
};

describe('contrato visual y táctil de la app de repartidor', () => {
    it('comparte el vocabulario Apple Día/Noche sin adoptar el scope del ERP', () => {
        expect(driver).toContain('data-nx-theme={theme}');
        expect(driver).toContain('nx-apple-light-workspace');
        expect(driver).toContain('nx-apple-dark-workspace');
        expect(driver).toContain('readPreAuthDriverTheme');
        expect(driver).toContain('bindDriverTheme(data.driver.id');
        expect(driver).toContain('persistDriverTheme(driver.id, nextTheme)');
        expect(driver).toContain('clearDriverThemeScope()');
        expect(driver).not.toContain('WORKSPACE_THEME_KEY');

        for (const primitive of [
            '.nx-driver-workspace',
            '.nx-driver-card',
            '.nx-driver-chrome',
            '.nx-driver-primary:disabled',
        ]) {
            expect(css).toContain(primitive);
        }
    });

    it('no conserva deuda de viewport, press o movimiento aislado', () => {
        expect(driver).not.toContain('min-h-screen');
        expect(driver).not.toContain('max-h-[85vh]');
        expect(driver).not.toContain('transition-all');
        expect(driver).not.toMatch(/\bactive:scale(?:-|\[)/);
        expect(driver).toContain('min-h-dvh');
        expect(driver).toContain('nx-bottom-bar nx-driver-dock');
        expect(driver).toContain('env(safe-area-inset-top)');
        expect(css).toContain('env(safe-area-inset-bottom)');
    });

    it('mantiene legible la liquidación móvil sin comprimir sus montos', () => {
        expect(driver).toContain('nx-driver-dock-grid grid items-center gap-2 sm:gap-3');
        expect(driver).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
        expect(driver).toContain("grid-cols-[auto_minmax(0,1fr)]");
        expect(driver).toContain('text-[clamp(.875rem,3.8vw,1.25rem)]');
        expect(driver).toContain('text-[clamp(.85rem,3.7vw,1.25rem)]');
        expect(driver).toContain('pb-[calc(8rem+env(safe-area-inset-bottom))]');
        expect(driver).not.toContain('flex items-center justify-between gap-4');
    });

    it('protege contraste y 44 px en las acciones operativas', () => {
        for (const marker of ["{loggingIn ? 'Entrando...' : 'Entrar'}", 'Sí, cobré', 'Entregar y Cobrar']) {
            const button = elementContaining('button', marker);
            expect(button).toContain('nx-fluid-press');
            expect(button).toContain('min-h-tap');
            expect(button).toContain('text-brand-on');
            expect(button).not.toContain('text-white');
        }

        for (const marker of ['openWallet', 'Cerrar sesión']) {
            const button = elementContaining('button', marker);
            expect(button).toContain('nx-fluid-press');
            expect(button).toContain('h-touch');
            expect(button).toContain('w-touch');
        }

        for (const marker of ['wazeUrl(', 'mapsUrl(']) {
            const link = elementContaining('a', marker);
            expect(link).toContain('nx-fluid-press');
            expect(link).toContain('min-h-tap');
        }

        expect(elementContaining('a', 'tel:${order.clienteTelefono}')).toContain('bg-sky-700 text-white');
        expect(elementContaining('a', 'waLink(order.clienteTelefono)')).toContain('bg-green-800 text-white');
    });

    it('anuncia credenciales, errores y superficies modales', () => {
        expect(driver).toContain('htmlFor="driver-phone"');
        expect(driver).toContain('htmlFor="driver-pin"');
        expect(driver).toContain('role="alert"');
        expect(driver).toContain('role="alertdialog"');
        expect(driver).toContain('role="dialog"');
        expect(driver).toContain('aria-modal="true"');
        expect(driver).toContain('aria-label="Cerrar billetera"');
    });
});
