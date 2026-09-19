import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const tokens = readFileSync(resolve(ROOT, 'nortex-tokens.css'), 'utf8');
const css = readFileSync(resolve(ROOT, 'index.css'), 'utf8');

type Rgb = [number, number, number];

const lightToken = (name: string): string => {
    const block = tokens.match(/\[data-nx-theme=['"]light['"]\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!match) throw new Error(`Falta el token --${name} en el modo Día`);
    return match[1];
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

describe('legibilidad de formularios en el modo Día', () => {
    it('normaliza texto, borde y cursor de controles heredados', () => {
        expect(css).toMatch(
            /\.nx-apple-light-workspace :is\(input, textarea, select, \.input-premium\)\s*\{[\s\S]*?border-color: var\(--nx-canvas-border\);[\s\S]*?color: var\(--nx-canvas-text\);[\s\S]*?caret-color: var\(--nx-canvas-text\);[\s\S]*?\}/,
        );
    });

    it('mantiene placeholder y autocompletado legibles', () => {
        expect(css).toMatch(
            /\.nx-apple-light-workspace :is\(input, textarea, select\)::placeholder,[\s\S]*?color: var\(--nx-canvas-faint\);[\s\S]*?opacity: 1;/,
        );
        expect(css).toMatch(
            /\.nx-apple-light-workspace :is\(input, textarea, select\):-webkit-autofill\s*\{[\s\S]*?-webkit-text-fill-color: var\(--nx-canvas-text\);[\s\S]*?box-shadow: 0 0 0 1000px var\(--nx-canvas-raised\) inset;/,
        );
    });

    it('supera WCAG AA sobre las superficies claras usadas por los textbox', () => {
        for (const background of ['nx-canvas-raised', 'nx-canvas-subtle']) {
            expect(
                contrast(lightToken('nx-canvas-text'), lightToken(background)),
                `texto sobre ${background}`,
            ).toBeGreaterThanOrEqual(4.5);

            expect(
                contrast(lightToken('nx-canvas-faint'), lightToken(background)),
                `placeholder sobre ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });
});
