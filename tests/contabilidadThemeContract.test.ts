import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/Contabilidad.tsx'), 'utf8');
const styles = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');

describe('Contabilidad: contrato visual Apple Día/Noche', () => {
    it('usa el workspace, encabezado y superficies semánticas en todos sus estados', () => {
        expect(source).toContain("import ModuleHeader from './ui/ModuleHeader'");
        expect(source).toContain('<ModuleHeader');
        expect(source.match(/className="nx-workspace/g)?.length).toBeGreaterThanOrEqual(2);

        for (const primitive of [
            'nx-canvas-card',
            'nx-canvas-text',
            'nx-canvas-muted',
            'nx-canvas-faint',
            'nx-tone-positive',
            'nx-tone-warning',
            'nx-tone-danger',
            'nx-overlay-backdrop',
            'nx-overlay-dialog',
        ]) {
            expect(source).toContain(primitive);
        }
    });

    it('no reintroduce el puente oscuro heredado ni transiciones indiscriminadas', () => {
        for (const legacyClass of [
            'bg-surface-',
            'panel-premium',
            'text-slate-',
            'bg-white/[',
            'border-white',
            'bg-black/20',
            'bg-black/80',
            'transition-all',
        ]) {
            expect(source).not.toContain(legacyClass);
        }
    });

    it('mantiene texto, formularios y navegación táctiles en ambos temas', () => {
        expect(source).toMatch(/const inputCls = ['"][^'"]*nx-canvas-text[^'"]*min-h-tap[^'"]*bg-\[var\(--nx-canvas-raised\)\][^'"]*/);
        const monthButtonClass = source.match(/const monthButtonCls = ['"]([^'"]*)['"]/)?.[1] ?? '';
        const tabButtonClass = source.match(/className=\{`(nx-module-tab[^`]+)`\}/)?.[1] ?? '';

        expect(monthButtonClass).toMatch(/nx-fluid-press.*h-touch.*w-touch/);
        expect(monthButtonClass).not.toContain('focus-visible:outline-none');
        expect(source).toContain('nx-module-tab nx-fluid-press flex min-h-tap');
        expect(tabButtonClass).not.toContain('focus-visible:outline-none');
        expect(styles).toMatch(/\.nx-fluid-press:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--nx-brand-ring\)/s);
        expect(source).toContain('grid grid-cols-2 gap-2 sm:flex sm:flex-wrap');
        expect(source).toContain('grid grid-cols-2 items-end gap-2');
        expect(source).toContain('sm:grid-cols-[minmax(0,1fr)_120px_120px_44px]');
        expect(source).toContain('aria-label={`Cuenta de la línea ${i + 1}`}');
        expect(source).toContain('aria-label={`Debe de la línea ${i + 1}`}');
        expect(source).toContain('aria-label={`Haber de la línea ${i + 1}`}');
        expect(source).toContain('aria-label={`Quitar línea ${i + 1}`}');
    });

    it('deja el único selector Día/Noche en el shell global', () => {
        expect(source).not.toContain('ThemeToggle');
        expect(source).not.toContain('workspaceTheme');
        expect(source).not.toContain('Cambiar a modo');
    });

    it('preserva las compuertas de rol y la carga perezosa por pestaña', () => {
        expect(source).toContain("new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'])");
        expect(source).toContain("new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN'])");
        expect(source).toContain('if (!canAccessAccounting) return');

        for (const tab of [
            'diario',
            'balanza',
            'cierre',
            'aging',
            'flujo',
            'periodos',
            'fiscal',
            'activos',
            'renta',
        ]) {
            expect(source).toContain(`if (tab === '${tab}')`);
        }
        expect(source).toContain("if (tab !== 'retenciones') return");
    });

    it('preserva endpoints y salvaguardas de las mutaciones contables', () => {
        for (const endpoint of [
            '/api/accounting/chart',
            '/api/accounting/journal',
            '/api/accounting/cierre-mensual/',
            '/api/accounting/aging',
            '/api/accounting/flujo-efectivo/',
            '/api/accounting/periods',
            '/api/accounting/fiscal-close',
            '/api/accounting/tax-config',
            '/api/accounting/exchange-rate',
            '/api/accounting/retenciones-sufridas',
            '/api/accounting/fixed-assets',
            '/api/accounting/depreciacion/run',
            '/api/fiscal/renta-anual/',
        ]) {
            expect(source).toContain(endpoint);
        }

        expect(source).toContain('role="alertdialog"');
        expect(source).toContain('decisionReturnFocusRef');
        expect(source).toContain("event.key === 'Escape'");
        expect(source).toContain('clientEventId');
        expect(source).toContain("timeZone: 'America/Managua'");
    });
});
