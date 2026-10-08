import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../components/Warehouses.tsx', import.meta.url), 'utf8');

describe('existencias de bodega en móvil', () => {
    it('usa tarjetas bajo sm y conserva la tabla desde sm', () => {
        expect(component).toContain('className="sm:hidden" aria-busy={loading}');
        expect(component).toContain('className="hidden overflow-x-auto sm:block"');
        expect(component).toContain('aria-label={`Existencias en ${selected?.name');
    });

    it('mantiene producto, SKU, stock y una acción táctil visibles en cada tarjeta', () => {
        expect(component).toContain('<dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SKU</dt>');
        expect(component).toContain('<dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Stock</dt>');
        expect(component).toContain('? `Transferir ${it.name} no disponible: ${transferTitle}`');
        expect(component).toContain(': `Transferir ${it.name} a otra bodega`}');
        expect(component).toContain('className="mt-4 min-h-tap w-full inline-flex');
    });
});
