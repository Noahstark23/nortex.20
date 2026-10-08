import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    BILLING_STATUS_META_CLASS,
    BILLING_STATUS_RENEWAL_CLASS,
    billingStatusSurfaceClass,
    DAY_DARK_SURFACE,
} from '../utils/daySurfaceInk';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../nortex-tokens.css', import.meta.url), 'utf8');
const tailwindConfig = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8');

const bridgeStart = css.indexOf('.nx-apple-light-workspace {');
const solidContractStart = css.indexOf('CONTRATO DE CONTRASTE — RELLENOS SÓLIDOS');
const lightInkBridge = css.slice(bridgeStart, solidContractStart);
const solidContract = css.slice(solidContractStart);
const workspaceBlock = css.slice(bridgeStart, css.indexOf('}', bridgeStart));

function rootToken(name: string): string {
    const root = tokens.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
    return root.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] ?? '';
}

function contrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string) => {
        const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
        const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return (light + 0.05) / (dark + 0.05);
}

function over(foreground: string, background: string, opacity: number): string {
    const channels = (hex: string) => hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16)) ?? [];
    const foregroundChannels = channels(foreground);
    const backgroundChannels = channels(background);
    return `#${foregroundChannels.map((channel, index) => Math.round(channel * opacity + (backgroundChannels[index] ?? 0) * (1 - opacity)).toString(16).padStart(2, '0')).join('')}`;
}

describe('tinta heredada del bridge Día', () => {
    it('traduce blanco heredado sólo desde superficies que Día ya aclara', () => {
        expect(bridgeStart).toBeGreaterThan(0);
        expect(solidContractStart).toBeGreaterThan(bridgeStart);
        expect(workspaceBlock).toContain('--nx-legacy-white-ink: var(--nx-canvas-text);');
        expect(workspaceBlock).toContain('--nx-context-ink: var(--nx-canvas-text);');

        for (const className of [
            'bg-surface-950', 'bg-surface-900', 'bg-surface-800', 'bg-surface-700',
            'bg-slate-900', 'bg-slate-800', 'bg-slate-700', 'bg-white/[0.08]',
        ]) {
            expect(lightInkBridge).toContain(`[class~="${className}"]`);
        }

        expect(lightInkBridge).toContain('--nx-legacy-white-ink: var(--nx-canvas-text);');
        expect(lightInkBridge).toContain('--nx-legacy-white-muted-ink: var(--nx-canvas-muted);');
        expect(lightInkBridge).toContain('--nx-context-ink: var(--nx-canvas-text);');
        expect(lightInkBridge).toContain('--nx-context-muted-ink: var(--nx-canvas-muted);');
        expect(lightInkBridge).toContain('[class~="text-white"]');
        expect(lightInkBridge).toContain('[class~="text-white/60"]');
        expect(lightInkBridge).toContain('[class~="text-white/80"]');
        expect(lightInkBridge).toMatch(
            /:is\(h1, h2, h3, h4, h5, h6\)\[class~="text-white"\]\s*\{\s*color: var\(--nx-legacy-white-ink\);/,
        );
        expect(lightInkBridge).toMatch(
            /\[class~="text-slate-300"\],[\s\S]*?\[class~="text-surface-400"\]\s*\)\s*\{\s*color: var\(--nx-context-muted-ink\);/,
        );
    });

    it('restaura la tinta clara para islas y rellenos realmente oscuros', () => {
        for (const selector of [
            '.nx-ticket-surface', '.nx-ticket-dock', '.nx-code-surface', '.nx-dark-island',
            'bg-nortex-900', 'bg-red-700', 'bg-sky-700', 'bg-amber-700', 'bg-green-800',
        ]) {
            expect(lightInkBridge).toContain(selector);
        }

        expect(lightInkBridge).toContain('--nx-legacy-white-ink: var(--nx-ticket-text);');
        expect(lightInkBridge).toContain('--nx-warning: var(--nx-ticket-warning);');
        expect(lightInkBridge).toContain('--nx-danger: var(--nx-ticket-danger);');
        expect(solidContract).toContain('--nx-legacy-white-ink: var(--nx-on-brand);');
        expect(solidContract).toContain('--nx-legacy-white-ink: var(--nx-on-danger-solid);');
        expect(solidContract).toContain('--nx-legacy-white-ink: var(--nx-on-warning-solid);');
        expect(solidContract).toContain('--nx-legacy-white-ink: var(--nx-on-info-solid);');
    });

    it('marca sólo los gradientes oscuros y da tinta AA a los gradientes mixtos', () => {
        // Las clases viven en una primitive pequeña para que el contrato no lea
        // componentes monolíticos. Tailwind debe escanear esa carpeta o las
        // islas se purgan del CSS de producción.
        expect(tailwindConfig).toContain('"./utils/**/*.{js,ts,jsx,tsx}",');
        expect(DAY_DARK_SURFACE.publicCatalog).toBe('nx-dark-island bg-gradient-to-r from-slate-900 to-slate-800 text-white');
        expect(DAY_DARK_SURFACE.inventoryValue).toBe('nx-dark-island bg-gradient-to-br from-nortex-900 to-nortex-800 text-white');
        expect(DAY_DARK_SURFACE.taxTotal).toBe('nx-dark-island bg-gradient-to-br from-red-800 to-red-900 text-white');

        expect(billingStatusSurfaceClass(true, false)).toBe('bg-gradient-to-br from-emerald-500 to-emerald-700 text-brand-on');
        expect(billingStatusSurfaceClass(false, true)).toBe(DAY_DARK_SURFACE.taxTotal);
        expect(billingStatusSurfaceClass(false, false)).toBe('bg-gradient-to-br from-amber-400 to-amber-600 nx-on-warning-solid');

        expect(BILLING_STATUS_META_CLASS).toBe('text-sm font-mono');
        expect(BILLING_STATUS_RENEWAL_CLASS).toBe('text-right text-sm');

        for (const [foreground, backgrounds] of [
            ['#001B12', ['#16C784', '#0F9461']],
            ['#171A1F', ['#FBBF24', '#D97706']],
            [rootToken('--nx-ticket-text'), ['#991B1B', '#7F1D1D']],
        ] as const) {
            for (const background of backgrounds) {
                expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
            }
        }

        expect(contrastRatio(over('#001B12', '#0F9461', 0.8), '#0F9461')).toBeLessThan(4.5);
        expect(contrastRatio(over('#171A1F', '#D97706', 0.8), '#D97706')).toBeLessThan(4.5);

        const red800 = '#991B1B';
        const ticketText = rootToken('--nx-ticket-text');
        expect(contrastRatio(ticketText, red800)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(over(ticketText, red800, 0.8), red800)).toBeGreaterThanOrEqual(4.5);
    });
});
