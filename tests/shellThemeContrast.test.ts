import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const tokens = readFileSync(resolve(ROOT, 'nortex-tokens.css'), 'utf8');
const css = readFileSync(resolve(ROOT, 'index.css'), 'utf8');

type Theme = 'light' | 'dark';
type Rgb = [number, number, number];
type Rgba = { rgb: Rgb; alpha: number };

const themeBlock = (theme: Theme): string => (
    tokens.match(new RegExp(`\\[data-nx-theme=['"]${theme}['"]\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
);

const themedHex = (theme: Theme, name: string): string => {
    const match = themeBlock(theme).match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!match) throw new Error(`Falta el token --${name} en ${theme}`);
    return match[1];
};

const themedRgba = (theme: Theme, name: string): Rgba => {
    const match = themeBlock(theme).match(
        new RegExp(`--${name}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d*\\.?\\d+)\\s*\\)`),
    );
    if (!match) throw new Error(`Falta el token rgba --${name} en ${theme}`);
    return {
        rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
        alpha: Number(match[4]),
    };
};

const hexRgb = (hex: string): Rgb => {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
};

const luminance = ([red, green, blue]: Rgb): number => {
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

const rgbHex = (rgb: Rgb): string => (
    `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
);

const composite = ({ rgb, alpha }: Rgba, background: string): string => {
    const backgroundRgb = hexRgb(background);
    return rgbHex(rgb.map((channel, index) => (
        (channel * alpha) + (backgroundRgb[index] * (1 - alpha))
    )) as Rgb);
};

describe('contraste del shell Apple en Día y Noche', () => {
    it.each(['light', 'dark'] as const)(
        'mantiene letras e iconos del menú legibles en %s',
        (theme) => {
            const shellBackground = themedHex(theme, 'nx-shell-solid');
            const renderedShell = composite(
                themedRgba(theme, 'nx-shell'),
                themedHex(theme, 'nx-canvas'),
            );
            const itemBackground = composite(themedRgba(theme, 'nx-shell-item'), renderedShell);

            for (const token of [
                'nx-shell-text',
                'nx-shell-muted',
                'nx-shell-faint',
            ]) {
                for (const background of [shellBackground, renderedShell, itemBackground]) {
                    expect(
                        contrast(themedHex(theme, token), background),
                        `${theme}:${token}:${background}`,
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }

            const activeBackground = composite(
                themedRgba(theme, 'nx-shell-active'),
                renderedShell,
            );
            expect(
                contrast(themedHex(theme, 'nx-positive'), activeBackground),
                `${theme}:nx-positive:active`,
            ).toBeGreaterThanOrEqual(4.5);

            expect(
                contrast(themedHex(theme, 'nx-canvas-text'), themedHex(theme, 'nx-canvas-raised')),
                `${theme}:mobile-menu-item`,
            ).toBeGreaterThanOrEqual(4.5);
        },
    );

    it.each(['light', 'dark'] as const)(
        'evita texto claro sobre tarjetas claras y texto oscuro sobre tarjetas oscuras en %s',
        (theme) => {
            const cardBackground = themedHex(theme, 'nx-canvas-raised');

            for (const token of [
                'nx-canvas-text',
                'nx-canvas-muted',
                'nx-canvas-faint',
            ]) {
                expect(
                    contrast(themedHex(theme, token), cardBackground),
                    `${theme}:${token}`,
                ).toBeGreaterThanOrEqual(4.5);
            }
        },
    );

    it('mantiene el modo noche lejos del negro puro para que el menú siga sintiéndose Nortex', () => {
        expect(luminance(hexRgb(themedHex('dark', 'nx-shell-solid')))).toBeGreaterThanOrEqual(0.03);
        expect(luminance(hexRgb(themedHex('dark', 'nx-shell-solid')))).toBeLessThan(
            luminance(hexRgb(themedHex('light', 'nx-shell-solid'))),
        );
    });

    it('hace que iconos y etiquetas hereden la misma tinta visible del control', () => {
        expect(css).toMatch(/\.nx-shell-nav-item :is\(svg, span\),[\s\S]*?\.nx-theme-toggle > svg\s*\{\s*color: inherit;/);
        expect(css).toMatch(/\.nx-mobile-menu-item:not\(\.nx-shell-nav-item-active\)\s*\{\s*color: var\(--nx-canvas-text\);/);
        expect(css).toMatch(/\[data-nx-theme='light'\]\s+:is\(\.nx-sidebar,\s+\.nx-dark-chrome\):not\(\.nx-pos-workspace \*\)\s*\{[\s\S]*?rgb\(var\(--nx-canvas-raised-rgb\) \/ \.92\)/);
        expect(css).toContain('radial-gradient(circle at 88% -12%, rgb(var(--nx-brand-rgb) / .14), transparent 28%)');
    });
});
