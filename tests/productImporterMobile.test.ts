import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard de fuente sobre el importador, en el mismo estilo que
 * `mobilePwaAuditGuards.test.ts`.
 *
 * No sustituye una prueba de conducta: la lógica real de la vista previa vive en
 * `utils/importPreview.ts` y se prueba renderizando datos, no texto. Esto fija
 * las decisiones de layout que NO se pueden expresar en un módulo puro y que ya
 * se rompieron una vez — el `vh` de iOS, el tooltip de hover inalcanzable en
 * touch, y la tabla de ocho columnas como única vista en un teléfono.
 */
const importer = readFileSync(join(__dirname, '..', 'components/ProductImporter.tsx'), 'utf8');

describe('importador de productos en móvil', () => {
    it('mide el alto con dvh, no con vh', () => {
        // En iOS la barra dinámica achica el viewport: 90vh se pasaba de largo y
        // recortaba la cabecera del modal.
        expect(importer).not.toMatch(/\d+vh\]/);
        expect(importer).toContain('100dvh');
        expect(importer).toContain('90dvh');
    });

    it('no vuelve a depender de una altura de cabecera hardcodeada', () => {
        // `calc(90vh-180px)` asumía una cabecera de una línea; en un teléfono el
        // título envuelve y la cuenta dejaba de cerrar. Ahora reparte con flex.
        // Se asevera el constructo, no la cadena suelta: el comentario que explica
        // por qué se fue puede (y debe) seguir nombrándolo.
        expect(importer).not.toMatch(/calc\([^)]*-\s*180px\)/);
        expect(importer).toContain('flex-1 min-h-0');
    });

    it('nunca esconde el motivo del error detrás de un hover', () => {
        // En touch no existe hover: la fila rota quedaba sin explicación posible.
        expect(importer).not.toContain('group-hover:block');
        expect(importer).not.toContain('cursor-help');
        expect(importer).not.toContain('Pasa el mouse');
    });

    it('ofrece una vista apilada en angosto y la tabla solo en pantalla ancha', () => {
        expect(importer).toContain('sm:hidden space-y-2');
        expect(importer).toContain('hidden sm:block bg-surface-900/60');
    });

    it('deja que la tabla tome su ancho natural en vez de aplastar columnas', () => {
        // `w-full` dentro de overflow-x-auto aplasta Y desborda a la vez.
        expect(importer).not.toContain('<table className="w-full text-sm">');
        expect(importer).toContain('<table className="min-w-full text-sm">');
    });

    it('respeta el área segura inferior del teléfono', () => {
        expect(importer).toContain('env(safe-area-inset-bottom)');
    });

    it('usa la regla compartida de vista previa en vez de recontar a mano', () => {
        expect(importer).toContain("from '../utils/importPreview'");
        expect(importer).toContain('selectPreviewRows');
        expect(importer).toContain('summarizePreviewIssues');
        expect(importer).not.toContain('rows.filter(r => r.valid).length');
    });

    it('adapta densidad y superficies táctiles', () => {
        expect(importer).toContain('p-4 sm:p-6');
        expect(importer).toContain('p-6 sm:p-12');
        expect(importer).toContain('Cerrar importador');
        expect(importer).toContain('min-h-11');
    });
});
