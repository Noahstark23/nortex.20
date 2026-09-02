import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/MiNegocio.tsx'), 'utf8');

describe('contrato visual de Inicio en tema claro y oscuro', () => {
    it('construye la pantalla con superficies y tintas semánticas', () => {
        for (const primitive of [
            'nx-workspace',
            'nx-canvas-card',
            'nx-canvas-text',
            'nx-canvas-muted',
            'nx-canvas-faint',
            'nx-tone-positive',
            'nx-tone-warning',
            'nx-tone-info',
        ]) {
            expect(source).toContain(primitive);
        }
    });

    it('mantiene visibles los iconos de acciones con fondos semánticos', () => {
        expect(source).toContain("positive: 'nx-tone-positive-bg nx-tone-positive'");
        expect(source).toContain("warning: 'nx-tone-warning-bg nx-tone-warning'");
        expect(source).toContain("neutral: 'nx-tone-neutral-bg nx-tone-neutral'");
        expect(source).toContain("info: 'nx-tone-info-bg nx-tone-info'");
    });

    it('no depende de fondos oscuros ni de texto blanco heredado', () => {
        for (const legacyClass of [
            'bg-surface-950',
            'bg-surface-900',
            'bg-white/[0.03]',
            'bg-white/[0.06]',
            'text-white',
            'text-slate-',
            'transition-all',
            'active:scale',
        ]) {
            expect(source).not.toContain(legacyClass);
        }
    });

    it('da presión fluida y tipo explícito a todos los botones de Inicio', () => {
        const buttons = [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([button]) => button);

        expect(buttons).toHaveLength(5);
        for (const button of buttons) {
            expect(button).toContain('type="button"');
            expect(button).toContain('nx-fluid-press');
        }
    });
});
