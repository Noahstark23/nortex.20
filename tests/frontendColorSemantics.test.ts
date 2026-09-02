import { describe, expect, it } from 'vitest';
import tailwindColors from 'tailwindcss/colors.js';
import tailwindConfig from '../tailwind.config.js';

type ColorPalette = Record<string | number, string>;

const theme = tailwindConfig.theme.extend;
const themeColors = theme.colors as unknown as Record<string, ColorPalette>;

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
});
