import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const readSource = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const css = readSource('index.css');
const inventory = readSource('components/Inventory.tsx');
const moduleHeader = readSource('components/ui/ModuleHeader.tsx');
const inventoryTabs = readSource('components/ui/InventoryTabs.tsx');
const emptyState = readSource('components/ui/EmptyState.tsx');
const dashboard = readSource('components/Dashboard.tsx');
const sales = readSource('components/Sales.tsx');
const layout = readSource('components/Layout.tsx');

describe('superficies semánticas de módulo en Día y Noche', () => {
    it('no fuerza colores del modo claro dentro de Inventario', () => {
        expect(inventory).not.toContain('lightEmptyStateClass');
        expect(inventory).not.toMatch(/<ModuleHeader[\s\S]*?className="[^"]*!text-slate/);
        expect(inventory).toContain('className="border-b pb-5"');
    });

    it('el encabezado y sus pestañas consumen tokens del canvas', () => {
        expect(moduleHeader).toContain('nx-module-header-icon');
        expect(moduleHeader).toContain('nx-canvas-text');
        expect(moduleHeader).toContain('nx-canvas-muted');
        expect(moduleHeader).not.toMatch(/text-slate-(?:100|200|300|400|700|950)/);

        expect(inventoryTabs).toContain('nx-module-tab');
        expect(inventoryTabs).toContain('nx-module-tab-active');
        expect(inventoryTabs).not.toMatch(/(?:bg|border|text)-slate-/);

        expect(css).toMatch(/\.nx-module-header-icon,[\s\S]*?background: var\(--nx-canvas-raised\);[\s\S]*?color: var\(--nx-canvas-muted\);/);
        expect(css).toMatch(/\.nx-module-tab-active,[\s\S]*?background: var\(--nx-positive-bg\);[\s\S]*?color: var\(--nx-positive\);/);
    });

    it('el estado vacío es legible y táctil sin importar el tema', () => {
        expect(emptyState).toContain('nx-empty-state');
        expect(emptyState).toContain('nx-empty-action-secondary nx-fluid-press');
        expect(emptyState).toContain('nx-empty-link nx-fluid-press');
        expect(emptyState).not.toMatch(/(?:text|border|bg)-slate-/);
        expect(emptyState.match(/type="button"/g)).toHaveLength(2);

        expect(css).toMatch(/\.nx-empty-action-secondary\s*\{[\s\S]*?color: var\(--nx-canvas-text\);/);
        expect(css).toMatch(/\.nx-pos-workspace\s*\{[\s\S]*?--nx-canvas-text: var\(--nx-ticket-text\);/);
    });

    it('mantiene tinta oscura en los CTA amarillos de suscripción', () => {
        expect(dashboard.match(/nx-warning-cta/g)).toHaveLength(2);
        expect(dashboard).not.toMatch(/Activar plan(?: Pro)?[\s\S]{0,180}text-slate-950/);
        expect(css).toMatch(/\.nx-warning-cta\s*\{[\s\S]*?background: #FEC84B;[\s\S]*?color: #1D2939;/);
    });

    it('usa el tono positivo adaptativo en el antetítulo de Ventas', () => {
        expect(sales).toContain('nx-tone-positive text-xs font-black uppercase');
        expect(sales).not.toContain('tracking-[0.18em] text-brand">Operación');
    });

    it('traduce badges sólidos heredados al cambiar a Noche', () => {
        for (const className of ['bg-emerald-100', 'bg-amber-100', 'bg-yellow-100', 'bg-blue-100', 'bg-red-100']) {
            expect(css).toContain(`[class~="${className}"]`);
        }
        for (const className of ['border-emerald-200', 'border-amber-200', 'border-blue-200', 'border-red-200']) {
            expect(css).toContain(`[class~="${className}"]`);
        }
    });

    it('oscurece la tinta brand pequeña en el canvas Día', () => {
        expect(css).toMatch(/\.nx-apple-light-workspace \[class~="text-brand"\]\s*\{\s*color: var\(--nx-positive\);/);
        expect(css).toMatch(/\.nx-apple-light-workspace \[class~="hover:text-brand"\]:hover\s*\{\s*color: var\(--nx-positive\);/);
    });

    it('mantiene el POS como superficie operativa oscura y legible', () => {
        expect(css).toMatch(/\.nx-pos-workspace\s*\{[\s\S]*?--nx-canvas-text: var\(--nx-ticket-text\);[\s\S]*?--nx-canvas-faint: var\(--nx-ticket-faint\);/);
        expect(css).toMatch(/\.nx-pos-workspace \[class~="text-slate-500"\],[\s\S]*?color: var\(--nx-ticket-faint\);/);
    });

    it('mantiene en 44 px los controles compactos del menú móvil', () => {
        expect(layout).toContain('h-touch min-h-tap w-touch min-w-tap');
        expect(layout).toContain('nx-fluid-press flex min-h-tap w-full items-center justify-center gap-2');
        expect(layout).not.toContain('nx-fluid-press flex min-h-10 w-full items-center justify-center gap-2');
    });
});
