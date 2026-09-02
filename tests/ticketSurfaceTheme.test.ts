import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(ROOT, 'index.css'), 'utf8');
const tokens = readFileSync(resolve(ROOT, 'nortex-tokens.css'), 'utf8');
const purchases = readFileSync(resolve(ROOT, 'components/Purchases.tsx'), 'utf8');

const hexRgb = (hex: string): [number, number, number] => {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
};

const luminance = ([red, green, blue]: [number, number, number]): number => {
    const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return (0.2126 * channel(red)) + (0.7152 * channel(green)) + (0.0722 * channel(blue));
};

const contrast = (foreground: string, background: string): number => {
    const foregroundLuminance = luminance(hexRgb(foreground));
    const backgroundLuminance = luminance(hexRgb(background));
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

const tokenHex = (name: string): string => {
    const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!match) throw new Error(`Falta el token --${name}`);
    return match[1];
};

const themedTokenHex = (theme: 'light' | 'dark', name: string): string => {
    const block = tokens.match(new RegExp(`\\[data-nx-theme=['"]${theme}['"]\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!match) throw new Error(`Falta el token --${name} en ${theme}`);
    return match[1];
};

describe('superficie ticket dentro del workspace Día/Noche', () => {
    it('mantiene aliases locales y no hereda el canvas claro', () => {
        const block = css.match(/\.nx-ticket-surface,\s*\.nx-ticket-dock\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

        expect(block).toContain('--nx-canvas-raised: var(--nx-ticket);');
        expect(block).toContain('--nx-canvas-subtle: var(--nx-ticket-raised);');
        expect(block).toContain('--nx-canvas-text: var(--nx-ticket-text);');
        expect(block).toContain('--nx-canvas-muted: var(--nx-ticket-muted);');
        expect(block).toContain('--nx-positive: var(--nx-ticket-positive);');
        expect(block).toContain('background: var(--nx-ticket);');
    });

    it('conserva color-scheme oscuro dentro del workspace Día', () => {
        expect(css).toMatch(
            /\.nx-apple-light-workspace :is\(\.nx-ticket-surface, \.nx-ticket-dock\)\.nx-dark-context\s*\{\s*color-scheme: dark;/,
        );
        expect(css).toMatch(
            /\.nx-apple-light-workspace \.nx-dark-context:not\(\.nx-ticket-surface\):not\(\.nx-ticket-dock\)\s*\{\s*color-scheme: light;/,
        );
    });

    it('conserva contraste AA para texto, texto secundario y estados del ticket', () => {
        const background = tokenHex('nx-ticket');
        for (const token of [
            'nx-ticket-text',
            'nx-ticket-muted',
            'nx-ticket-faint',
            'nx-ticket-positive',
            'nx-ticket-warning',
            'nx-ticket-info',
            'nx-ticket-danger',
        ]) {
            expect(contrast(tokenHex(token), background), token).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('declara los recibos y diálogos de Compras como contexto oscuro intencional', () => {
        const surfaces = [...purchases.matchAll(/className="([^"]*nx-ticket-surface[^"]*)"/g)]
            .map(match => match[1]);

        expect(surfaces).toHaveLength(4);
        for (const className of surfaces) expect(className).toContain('nx-dark-context');
        expect(purchases).toContain('disabled:bg-slate-700 disabled:text-slate-300');
        expect(purchases).not.toContain('disabled:bg-slate-700 disabled:text-slate-500');
    });

    it('traduce todos los escalones de texto semántico en el canvas claro', () => {
        for (const legacyClass of [
            'text-emerald-700',
            'text-green-700',
            'text-amber-700',
            'text-yellow-700',
            'text-sky-700',
            'text-blue-700',
            'text-red-700',
        ]) {
            expect(css).toContain(`[class~="${legacyClass}"]`);
        }

        for (const tone of ['positive', 'warning', 'info', 'danger']) {
            expect(
                contrast(themedTokenHex('light', `nx-${tone}`), themedTokenHex('light', `nx-${tone}-bg`)),
                tone,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('pinta los badges de estado con tokens completos de texto, fondo y borde', () => {
        expect(css).toMatch(/\.badge-soft-success\s*\{[\s\S]*?background: var\(--nx-positive-bg\);[\s\S]*?color: var\(--nx-positive\);[\s\S]*?border-color: var\(--nx-positive-border\);/);
        expect(css).toMatch(/\.badge-soft-warning\s*\{[\s\S]*?background: var\(--nx-warning-bg\);[\s\S]*?color: var\(--nx-warning\);[\s\S]*?border-color: var\(--nx-warning-border\);/);
        expect(css).toMatch(/\.badge-soft-danger\s*\{[\s\S]*?background: var\(--nx-danger-bg\);[\s\S]*?color: var\(--nx-danger\);[\s\S]*?border-color: var\(--nx-danger-border\);/);
    });
});
