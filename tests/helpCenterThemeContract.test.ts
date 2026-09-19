import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/HelpCenter.tsx'), 'utf8');

describe('HelpCenter: contrato visual Día/Noche', () => {
    it('consume las primitivas semánticas del workspace autenticado', () => {
        expect(source).toContain("import ModuleHeader from './ui/ModuleHeader'");
        expect(source).toContain('className="nx-workspace');
        expect(source).toContain('<ModuleHeader');

        for (const primitive of [
            'nx-canvas-card',
            'nx-canvas-text',
            'nx-canvas-muted',
            'nx-canvas-faint',
            'nx-tone-positive',
            'nx-tone-neutral',
        ]) {
            expect(source).toContain(primitive);
        }
    });

    it('no reintroduce colores oscuros fijos ni transiciones indiscriminadas', () => {
        for (const legacyClass of [
            'bg-surface-',
            'border-white/',
            'text-slate-',
            'bg-white/',
            'transition-all',
        ]) {
            expect(source).not.toContain(legacyClass);
        }
    });

    it('conserva destinos locales y declara controles táctiles accesibles', () => {
        for (const destination of [
            '/app/pos?tour=pos',
            '/app/inventory?tour=inv',
            '/app/receivables?tour=fiado',
            '/app/purchases?tour=compras',
        ]) {
            expect(source).toContain(`destination: '${destination}'`);
        }

        expect(source).toContain('type="button"');
        expect(source).toContain('nx-fluid-press');
        expect(source).toContain('min-h-tap');
        expect(source).toContain('aria-labelledby="help-center-tutorials-title"');
        expect(source).toContain('aria-labelledby="help-center-guides-title"');
    });

    it('preserva el checklist scoped y el regreso al inicio del rol', () => {
        expect(source).toContain('onClick={reshowChecklist}');
        expect(source).toContain('clearOnboardingFlags(localStorage, currentOnboardingStorageKeys())');
        expect(source).toContain('homePathFor(role, resolveUiMode(type, localStorage.getItem(UI_MODE_KEY)))');
        expect(source).toContain('window.location.assign(`${home}?welcome=1`)');
    });
});
