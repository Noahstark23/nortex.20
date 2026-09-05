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

function rootToken(name: string): string {
    const root = tokens.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
    const value = root.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    if (!value) throw new Error(`No se encontró el token --${name} en :root`);
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
        expect(contrastContract).not.toMatch(/\[class~="(?:bg|hover:bg)-[^"]+\/[0-9]+"\]/);
        expect(contrastContract).not.toContain('[class*=');
    });
});
