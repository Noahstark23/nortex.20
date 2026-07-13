/**
 * NORTEX — tests de la regla de precios (detalle → mayoreo → empaque).
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
    it('12 und → caja (90/12)', () => expect(effectiveTier(P, 12, false)).toEqual({ unitPrice: 7.5, kind: 'EMPAQUE' }));
    it('24 und → caja', () => expect(effectiveUnitPrice(P, 24, false)).toBe(7.5));
});

describe('cliente mayorista', () => {
    it('1 und → mayoreo desde la unidad 1', () => expect(effectiveTier(P, 1, true)).toEqual({ unitPrice: 8.5, kind: 'MAYOREO' }));
    it('12 und → caja (umbral mayor gana)', () => expect(effectiveTier(P, 12, true).kind).toBe('EMPAQUE'));
});

describe('empates y precedencia', () => {
    it('minQty == packSize → caja explícita manda', () => {
        const E = { basePrice: 10, wholesalePrice: 8, wholesaleMinQty: 12, packSize: 12, packPrice: 90 };
        expect(effectiveTier(E, 12, false)).toEqual({ unitPrice: 7.5, kind: 'EMPAQUE' });
    });
    it('caja MÁS CARA que mayoreo → determinista por umbral, no por precio', () => {
        const C = { basePrice: 10, wholesalePrice: 7, wholesaleMinQty: 6, packSize: 12, packPrice: 96 };
        expect(effectiveTier(C, 12, false)).toEqual({ unitPrice: 8, kind: 'EMPAQUE' });
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
});

describe('ida y vuelta por la escalera', () => {
    it('12→7.5, baja a 11→8.5, baja a 5→10', () => {
        expect(effectiveUnitPrice(P, 12, false)).toBe(7.5);
        expect(effectiveUnitPrice(P, 11, false)).toBe(8.5);
        expect(effectiveUnitPrice(P, 5, false)).toBe(10);
    });
    it('fraccionables: 12.5 lbs ≥ 12 → caja', () => expect(effectiveUnitPrice(P, 12.5, false)).toBe(7.5));
});
