import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(resolve(process.cwd(), 'components/TeamManagement.tsx'), 'utf8');

const buttonContaining = (marker: string): string => {
    const button = [...component.matchAll(/<button\b[\s\S]*?<\/button>/g)]
        .map(([match]) => match)
        .find((match) => match.includes(marker));

    expect(button, `No se encontró el control de Team: ${marker}`).toBeDefined();
    return button!;
};

describe('semántica visual de Mi Equipo', () => {
    it('mantiene toda la ruta dentro del canvas adaptable y legible', () => {
        expect(component).toMatch(/nx-workspace[^"\n]*h-full[^"\n]*overflow-y-auto/);
        expect(component).toContain('nx-canvas-card');
        expect(component).toContain('nx-canvas-text');
        expect(component).toContain('nx-canvas-muted');
        expect(component).not.toMatch(/\btext-white\b|\bbg-slate-|\btext-slate-/);
    });

    it('expresa roles con tonos semánticos en lugar de colores decorativos fijos', () => {
        for (const tone of ['positive', 'warning', 'info', 'neutral']) {
            expect(component).toContain(`nx-tone-${tone}`);
            expect(component).toContain(`nx-tone-${tone}-bg`);
        }

        expect(component).not.toMatch(
            /(?:text|bg|border)-(?:blue|purple|violet|indigo|cyan|teal|amber|emerald)-/,
        );
    });

    it('protege controles tocados con presión fluida y objetivos de 44 px', () => {
        for (const marker of [
            'Invitar Miembro',
            'Copiar Link',
            'Crear Invitación',
            'Guardar catálogo',
        ]) {
            const button = buttonContaining(marker);
            expect(button).toContain('nx-fluid-press');
            expect(button).toMatch(/\b(?:min-h-tap|h-touch)\b/);
        }

        expect(component).not.toContain('transition-all');
    });
});
