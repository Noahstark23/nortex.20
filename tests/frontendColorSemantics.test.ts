import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tailwindColors from 'tailwindcss/colors.js';
import tailwindConfig from '../tailwind.config.js';

type ColorPalette = Record<string | number, string>;

const theme = tailwindConfig.theme.extend;
const themeColors = theme.colors as unknown as Record<string, ColorPalette>;
const tokens = readFileSync(new URL('../nortex-tokens.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const contrastContract = styles.slice(styles.lastIndexOf('CONTRATO DE CONTRASTE — RELLENOS SÓLIDOS'));
const brandAliasBridge = styles.slice(
    styles.indexOf('Tailwind colapsa estos aliases fríos a la marca.'),
    styles.indexOf('.nx-apple-dark-workspace'),
);
const inventoryOracle = readFileSync(new URL('../components/InventoryOracle.tsx', import.meta.url), 'utf8');
const inventory = readFileSync(new URL('../components/Inventory.tsx', import.meta.url), 'utf8');
const quickAddProduct = readFileSync(new URL('../components/QuickAddProduct.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
const operationalNotifications = readFileSync(new URL('../components/notifications/OperationalNotifications.tsx', import.meta.url), 'utf8');
const pinPadClock = readFileSync(new URL('../components/PinPadClock.tsx', import.meta.url), 'utf8');

function rootToken(name: string): string {
    const root = tokens.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
    const value = root.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    if (!value) throw new Error(`No se encontró el token --${name} en :root`);
    return value;
}

function lightToken(name: string): string {
    const light = tokens.match(/\[data-nx-theme=['"]light['"]\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const value = light.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    if (!value) throw new Error(`No se encontró el token --${name} en el tema Día`);
    return value;
}

function contrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string) => {
        const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16)) ?? [];
        const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };

    const [first, second] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (first + 0.05) / (second + 0.05);
}

function over(foreground: string, background: string, opacity: number): string {
    const channels = (hex: string) => hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16)) ?? [];
    const foregroundChannels = channels(foreground);
    const backgroundChannels = channels(background);
    const result = foregroundChannels.map((channel, index) => Math.round(channel * opacity + (backgroundChannels[index] ?? 0) * (1 - opacity)));
    return `#${result.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('contrato semántico del tema frontend', () => {
    it.each(['red', 'amber', 'sky'] as const)(
        'restaura la rampa canónica y con contraste de %s',
        (name) => {
            const palette = themeColors[name];
            const canonical = tailwindColors[name];

            expect(palette[50]).toBe(canonical[50]);
            expect(palette[700]).toBe(canonical[700]);
            expect(palette[50]).not.toBe(palette[700]);
        },
    );

    it('mantiene aliases propios para la marca y los estados de producto', () => {
        expect(themeColors.brand).toBeDefined();
        expect(themeColors.danger.DEFAULT).toContain('--nx-danger-rgb');
        expect(themeColors.danger.soft).toBe('var(--nx-danger-soft)');
        expect(themeColors.warning.DEFAULT).toContain('--nx-warning-rgb');
        expect(themeColors.warning.soft).toBe('var(--nx-warning-soft)');
        expect(themeColors.info.DEFAULT).toBe(tailwindColors.sky[600]);
        expect(themeColors.info.soft).toBe(tailwindColors.sky[50]);

        expect(themeColors.danger).not.toBe(themeColors.red);
        expect(themeColors.warning).not.toBe(themeColors.amber);
        expect(themeColors.info).not.toBe(themeColors.sky);

        for (const alias of [
            'blue',
            'indigo',
            'cyan',
            'violet',
            'purple',
            'fuchsia',
            'teal',
            'emerald',
            'green',
            'lime',
        ]) {
            expect(themeColors[alias]).toBe(themeColors.brand);
        }
    });

    it('expone el puente de movimiento sin reemplazar el alias nx', () => {
        expect(theme.transitionTimingFunction).toMatchObject({
            nx: 'cubic-bezier(0.2, 0, 0, 1)',
            fluid: 'cubic-bezier(.2,0,0,1)',
            'fluid-in': 'cubic-bezier(1,0,.8,1)',
        });
        expect(theme.transitionDuration).toMatchObject({
            fast: '120ms',
            slow: '180ms',
            spring: '380ms',
        });
        expect(theme.scale).toMatchObject({ press: '.985' });
    });

    it('mantiene tinta AA sobre cada relleno sólido heredado', () => {
        const coverage = [
            [rootToken('nx-on-brand'), ['#16C784', '#13B476', '#0F9461', '#25D366', '#1EBE57']],
            [rootToken('nx-on-danger-solid'), ['#F0483E', '#EF4444']],
            [rootToken('nx-on-warning-solid'), ['#F5A524', '#D97706']],
            [rootToken('nx-on-info-solid'), ['#0284C7']],
        ] as const;

        for (const [foreground, backgrounds] of coverage) {
            for (const background of backgrounds) {
                expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('traduce tintas semánticas claras sobre avisos suaves de Día', () => {
        const semanticPairs = [
            ['nx-positive', 'nx-positive-bg'],
            ['nx-warning', 'nx-warning-bg'],
            ['nx-info', 'nx-info-bg'],
            ['nx-danger', 'nx-danger-bg'],
        ] as const;

        for (const [ink, background] of semanticPairs) {
            expect(
                contrastRatio(lightToken(ink), lightToken(background)),
                `${ink} sobre ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
        }

        const canvas = lightToken('nx-canvas');
        const orangeSoft = over('#F5A524', canvas, 0.05);
        const amberSoft = over(tailwindColors.amber[500], canvas, 0.1);
        expect(contrastRatio(lightToken('nx-warning'), orangeSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(lightToken('nx-warning'), amberSoft)).toBeGreaterThanOrEqual(4.5);

        for (const className of [
            'text-emerald-100/80',
            'text-amber-100', 'text-amber-200/80', 'text-amber-400/90',
            'text-orange-100', 'text-orange-300/70',
            'text-blue-200', 'text-blue-300/80',
            'text-red-100', 'text-red-100/80', 'text-red-400/70',
            'text-rose-500',
        ]) {
            expect(styles).toContain(`[class~="${className}"]`);
        }
    });

    it('traduce aliases de marca a una tinta accesible en Día', () => {
        expect(brandAliasBridge).toContain('color: var(--nx-positive);');
        for (const className of [
            'text-brand-200',
            'text-nortex-accent',
            'text-blue-400', 'text-blue-300/80',
            'text-indigo-400', 'text-cyan-300',
            'text-violet-700', 'text-purple-300',
            'hover:text-brand-800', 'hover:text-blue-300',
            'group-hover:text-nortex-accent',
        ]) {
            expect(brandAliasBridge).toContain(`[class~="${className}"]`);
        }

        const canvas = lightToken('nx-canvas');
        const brandSoft = over('#16C784', canvas, 0.15);
        expect(contrastRatio(lightToken('nx-positive'), brandSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(lightToken('nx-positive'), '#E6FAF2')).toBeGreaterThanOrEqual(4.5);
    });

    it('protege sólo los rellenos sólidos y sus cambios hover conocidos', () => {
        for (const className of [
            'bg-brand', 'bg-emerald-500', 'bg-blue-600', 'bg-nortex-accent', 'bg-whatsapp',
            'bg-danger', 'bg-red-500', 'bg-warning', 'bg-amber-600', 'bg-sky-600',
            'hover:bg-brand-700', 'hover:bg-whatsapp-hover', 'hover:bg-red-500', 'hover:bg-amber-600', 'hover:bg-sky-700',
        ]) {
            expect(contrastContract).toContain(`[class~="${className}"]`);
        }

        expect(contrastContract).toContain('color: var(--nx-on-brand) !important;');
        expect(contrastContract).toContain('color: var(--nx-on-danger-solid) !important;');
        expect(contrastContract).toContain('color: var(--nx-on-warning-solid) !important;');
        expect(contrastContract).toContain('color: var(--nx-on-info-solid) !important;');
        expect(contrastContract).toContain('.nx-on-warning-solid');
        expect(inventoryOracle).toMatch(/bg-amber-500[\s\S]{0,500}nx-on-warning-solid/);
        expect(contrastContract).not.toMatch(/\[class~="(?:bg|hover:bg)-[^"]+\/[0-9]+"\]/);
        expect(contrastContract).not.toContain('[class*=');
    });

    it('mantiene tinta semántica en iconos descendientes de rellenos sólidos', () => {
        expect(quickAddProduct).not.toContain('<Zap size={20}'); // El alta simplificada retiró ese icono.

        // Los toasts de pedidos se sustituyeron por el panel operativo: no se
        // debe mantener una aserción sobre UI eliminada, pero sí conservar que
        // Layout lo compone y que su cierre usa el control semántico del shell.
        expect(layout).toContain("import { OperationalNotifications } from './notifications/OperationalNotifications';");
        expect(operationalNotifications).toContain('aria-label="Cerrar avisos"');
        expect(operationalNotifications).toContain('nx-shell-control nx-fluid-press');
        expect(operationalNotifications).not.toContain('text-white/60 hover:bg-white/10 hover:text-white');
    });

    it('no rebaja una tinta de control peligrosa por opacidad en el reloj', () => {
        const dangerInk = rootToken('nx-on-danger-solid');
        expect(contrastRatio(dangerInk, '#F0483E')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(over(dangerInk, '#F0483E', 0.8), '#F0483E')).toBeLessThan(4.5);

        expect(pinPadClock).toMatch(/bg-emerald-500[\s\S]{0,500}text-sm text-brand-on uppercase tracking-wider[\s\S]{0,240}Entrada/);
        expect(pinPadClock).toMatch(/bg-rose-500[\s\S]{0,500}text-sm nx-on-danger-solid uppercase tracking-wider[\s\S]{0,240}Salida/);
    });

    it('mantiene la pérdida de Kardex legible en la isla ticket bajo ambos modos', () => {
        const lossBadge = inventory.slice(
            inventory.indexOf("'ADJUST_LOSS':"),
            inventory.indexOf("'ADJUST_GAIN':"),
        );

        expect(lossBadge).toContain('bg-[var(--nx-ticket-raised)]');
        expect(lossBadge).toContain('text-[var(--nx-ticket-warning)]');
        expect(lossBadge).toContain('border-[color:var(--nx-ticket-warning)]');
        expect(lossBadge).not.toContain('bg-orange-900/60');
        expect(lossBadge).not.toContain('text-orange-300');

        // Los tokens ticket son invariantes: la misma isla oscura se muestra
        // dentro del workspace Día y del workspace Noche.
        for (const workspaceTheme of ['light', 'dark']) {
            expect(
                contrastRatio(rootToken('nx-ticket-warning'), rootToken('nx-ticket-raised')),
                `pérdida Kardex sobre ticket ${workspaceTheme}`,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });
});
