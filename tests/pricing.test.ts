/**
 * NORTEX — tests de precio BASE/mayoreo y empaque explícito.
 * Son los casos de las rondas de QA del mayoreo (Fases A y B), convertidos en
 * suite permanente: si alguien rompe la escalera, CI lo atrapa.
 */
import { describe, it, expect } from 'vitest';
import { effectiveTier, effectiveUnitPrice } from '../utils/pricing';

// Producto completo: detalle 10, mayoreo 8.5 desde 6, caja de 12 a C$90 (7.5/und)
const P = { basePrice: 10, wholesalePrice: 8.5, wholesaleMinQty: 6, packSize: 12, packPrice: 90 };

describe('escalera completa (cliente normal)', () => {
    it('1 und → detalle', () => expect(effectiveTier(P, 1, false)).toEqual({ unitPrice: 10, kind: 'DETALLE' }));
    it('5 und → detalle', () => expect(effectiveUnitPrice(P, 5, false)).toBe(10));
    it('5.99 und → detalle (borde)', () => expect(effectiveUnitPrice(P, 5.99, false)).toBe(10));
    it('6 und → mayoreo', () => expect(effectiveTier(P, 6, false)).toEqual({ unitPrice: 8.5, kind: 'MAYOREO' }));
    it('11 und → mayoreo', () => expect(effectiveUnitPrice(P, 11, false)).toBe(8.5));
    it('12 und sueltas siguen en mayoreo', () => expect(effectiveTier(P, 12, false)).toEqual({ unitPrice: 8.5, kind: 'MAYOREO' }));
    it('24 und sueltas no se reinterpretan como cajas', () => expect(effectiveUnitPrice(P, 24, false)).toBe(8.5));
    it('PACK explícito usa caja (90/12)', () => expect(effectiveTier(P, 12, false, 'PACK')).toEqual({ unitPrice: 7.5, kind: 'EMPAQUE' }));
});

describe('cliente mayorista', () => {
    it('1 und → mayoreo desde la unidad 1', () => expect(effectiveTier(P, 1, true)).toEqual({ unitPrice: 8.5, kind: 'MAYOREO' }));
    it('12 und BASE siguen en mayoreo', () => expect(effectiveTier(P, 12, true).kind).toBe('MAYOREO'));
    it('12 und PACK usan empaque explícito', () => expect(effectiveTier(P, 12, true, 'PACK').kind).toBe('EMPAQUE'));
});

describe('empates y precedencia', () => {
    it('minQty == packSize → caja explícita manda', () => {
        const E = { basePrice: 10, wholesalePrice: 8, wholesaleMinQty: 12, packSize: 12, packPrice: 90 };
        expect(effectiveTier(E, 12, false, 'PACK')).toEqual({ unitPrice: 7.5, kind: 'EMPAQUE' });
    });
    it('caja MÁS CARA que mayoreo → determinista por umbral, no por precio', () => {
        const C = { basePrice: 10, wholesalePrice: 7, wholesaleMinQty: 6, packSize: 12, packPrice: 96 };
        expect(effectiveTier(C, 12, false, 'PACK')).toEqual({ unitPrice: 8, kind: 'EMPAQUE' });
    });
});

describe('degradaciones (campos ausentes o inválidos)', () => {
    it('sin wholesalePrice → siempre detalle', () => expect(effectiveUnitPrice({ basePrice: 10 }, 99, false)).toBe(10));
    it('mayorista sin wholesalePrice → detalle', () => expect(effectiveUnitPrice({ basePrice: 10 }, 1, true)).toBe(10));
    it('mayoreo sin minQty → nunca por cantidad', () => expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: 8 }, 50, false)).toBe(10));
    it('mayoreo sin minQty + mayorista → sí aplica', () => expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: 8 }, 1, true)).toBe(8));
    it('wholesalePrice 0 → detalle (guard)', () => expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: 0, wholesaleMinQty: 6 }, 20, false)).toBe(10));
    it('packSize SIN packPrice → solo atajo, precio por Fase A', () => expect(effectiveTier({ basePrice: 10, packSize: 12 }, 12, false).kind).toBe('DETALLE'));
    it('minQty 0 → no aplica por cantidad', () => expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: 8, wholesaleMinQty: 0 }, 20, false)).toBe(10));

    // ── Guardas contra datos malformados ─────────────────────────────────────
    // Hallazgo de las pruebas de mutación: las guardas `!= null` y `> 0` del
    // empaque podían relajarse (a `true` o `>= 0`) sin que ningún test fallara.
    // Un packSize 0 divide por cero (precio Infinity) y un packPrice 0 regala el
    // producto: son datos que un catálogo mal cargado produce de verdad.
    it('packSize 0 → detalle (no divide por cero)', () => {
        const r = effectiveTier({ basePrice: 10, packPrice: 90, packSize: 0 }, 20, false, 'PACK');
        expect(r.kind).toBe('DETALLE');
        expect(r.unitPrice).toBe(10);
        expect(Number.isFinite(r.unitPrice)).toBe(true);
    });
    it('packPrice 0 → detalle (no regala el producto)', () => {
        expect(effectiveUnitPrice({ basePrice: 10, packPrice: 0, packSize: 12 }, 20, false, 'PACK')).toBe(10);
    });
    it('packPrice negativo → detalle', () => {
        expect(effectiveUnitPrice({ basePrice: 10, packPrice: -90, packSize: 12 }, 20, false, 'PACK')).toBe(10);
    });
    it('wholesalePrice negativo → detalle', () => {
        expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: -8, wholesaleMinQty: 6 }, 20, false)).toBe(10);
    });
    it('minQty negativo → no aplica por cantidad', () => {
        expect(effectiveUnitPrice({ basePrice: 10, wholesalePrice: 8, wholesaleMinQty: -5 }, 20, false)).toBe(10);
    });
    it('packSize negativo → detalle', () => {
        expect(effectiveUnitPrice({ basePrice: 10, packPrice: 90, packSize: -12 }, 20, false, 'PACK')).toBe(10);
    });
});

describe('BASE nunca muta a PACK por cantidad', () => {
    it('12→8.5, baja a 11→8.5, baja a 5→10', () => {
        expect(effectiveUnitPrice(P, 12, false)).toBe(8.5);
        expect(effectiveUnitPrice(P, 11, false)).toBe(8.5);
        expect(effectiveUnitPrice(P, 5, false)).toBe(10);
    });
    it('103.5 lb BASE jamás toma precio de saco', () => expect(effectiveUnitPrice(P, 103.5, false, 'BASE')).toBe(8.5));
    it('un saco PACK sí usa packPrice/packSize', () => expect(effectiveUnitPrice(P, 12, false, 'PACK')).toBe(7.5));
});
