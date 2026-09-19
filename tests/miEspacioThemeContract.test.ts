import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/MiEspacio.tsx'), 'utf8');

describe('MiEspacio: contrato visual Día/Noche', () => {
    it('usa el workspace, encabezado y superficies semánticas en todos sus estados', () => {
        expect(source).toContain("import ModuleHeader from './ui/ModuleHeader'");
        expect(source).toContain('<ModuleHeader');
        expect(source.match(/className="nx-workspace/g)?.length).toBeGreaterThanOrEqual(3);

        for (const primitive of [
            'nx-canvas-card',
            'nx-canvas-text',
            'nx-canvas-muted',
            'nx-canvas-faint',
            'nx-tone-positive',
            'nx-tone-positive-bg',
            'nx-tone-warning',
            'nx-tone-warning-bg',
            'nx-tone-danger',
            'nx-tone-danger-bg',
        ]) {
            expect(source).toContain(primitive);
        }
    });

    it('no reintroduce superficies oscuras fijas ni transiciones indiscriminadas', () => {
        for (const legacyClass of [
            'bg-surface-',
            'text-slate-',
            'border-white/',
            'panel-premium',
            'transition-all',
        ]) {
            expect(source).not.toContain(legacyClass);
        }
    });

    it('mantiene formularios legibles, etiquetados y con objetivos táctiles', () => {
        expect(source).toMatch(/const inputCls = ['"][^'"]*nx-canvas-text[^'"]*min-h-tap[^'"]*bg-\[var\(--nx-canvas-raised\)\][^'"]*/);

        for (const [label, control] of [
            ['leave-type', 'select'],
            ['leave-start', 'input'],
            ['leave-end', 'input'],
            ['leave-reason', 'input'],
            ['advance-amount', 'input'],
        ] as const) {
            expect(source).toContain(`htmlFor="${label}"`);
            expect(source).toMatch(new RegExp(`<${control}[^>]*id="${label}"`));
        }

        expect(source).toContain('id="advance-help"');
        expect(source).toContain('aria-describedby="advance-help"');
        expect(source).toContain("timeZone: 'UTC'");
        expect(source).toContain('sanitizeAdvanceAmount(e.target.value)');

        const submitButtons = [...source.matchAll(/<button\s+type="submit"[\s\S]*?<\/button>/g)]
            .map(([button]) => button);
        expect(submitButtons).toHaveLength(2);
        for (const button of submitButtons) {
            expect(button).toContain('nx-fluid-press');
            expect(button).toContain('min-h-tap');
        }
    });

    it('ofrece impresión accesible con área táctil en móvil y escritorio', () => {
        const printButtons = [...source.matchAll(/<button\b[\s\S]*?onClick=\{\(\) => printColilla\(p\)\}[\s\S]*?<\/button>/g)]
            .map(([button]) => button);

        expect(printButtons).toHaveLength(2);
        for (const button of printButtons) {
            expect(button).toContain('type="button"');
            expect(button).toContain('nx-fluid-press');
            expect(button).toContain('h-touch');
            expect(button).toContain('w-touch');
            expect(button).toContain('aria-label={`Imprimir colilla de ${period}`}');
        }
    });

    it('preserva endpoints, handlers y carga autenticada del espacio personal', () => {
        for (const endpoint of [
            '/api/me/profile',
            '/api/me/payrolls',
            '/api/me/requests',
            '/api/me/leave',
            '/api/me/advance',
        ]) {
            expect(source).toContain(`fetch('${endpoint}'`);
        }

        expect(source).toContain('const submitLeave = async (e: React.FormEvent) =>');
        expect(source).toContain('const submitAdvance = async (e: React.FormEvent) =>');
        expect(source).toContain('<form onSubmit={submitLeave}');
        expect(source).toContain('<form onSubmit={submitAdvance}');
        expect(source).toContain("method: 'POST'");
        expect(source).toContain('body: JSON.stringify(leaveForm)');
        expect(source).toContain("body: JSON.stringify({ amount: advAmount })");
        expect(source).toContain("Authorization: `Bearer ${token}`");
    });

    it('conserva el documento y la secuencia de impresión de la colilla', () => {
        for (const printMarker of [
            '<!DOCTYPE html>',
            'COLILLA DE PAGO',
            'Ingresos',
            'Deducciones',
            'Neto a recibir',
            'Generado por NORTEX ERP · Ley 185 Código del Trabajo de Nicaragua',
        ]) {
            expect(source).toContain(printMarker);
        }

        expect(source).toContain("const w = window.open('', '_blank')");
        expect(source).toContain('w.document.write(html)');
        expect(source).toContain('w.document.close()');
        expect(source).toContain('setTimeout(() => w.print(), 400)');
    });
});
