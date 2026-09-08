import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { calculateProductBulkEditPrice } from '../backend/services/productBulkEditPrice';

describe('precio masivo: resultados monetarios independientes', () => {
  it.each([
    ['set', '999', '2.345', '2.35'], ['set', '999', '2.3449', '2.34'],
    ['set', '10', '0', '0.00'], ['set', '10', '10.005', '10.01'],
    ['set', '10', '10.0049', '10.00'], ['set', '10', '0.005', '0.01'],
    ['pct', '100', '10', '110.00'], ['pct', '110', '10', '121.00'],
    ['pct', '10.05', '10', '11.06'], ['pct', '100', '-99.99', '0.01'],
    ['pct', '1', '-50', '0.50'], ['pct', '9.99', '0', '9.99'],
    ['pct', '0.01', '-50', '0.01'], ['pct', '0.01', '-50.01', '0.00'],
    ['pct', '-1', '10', '0.00'], ['pct', '0', '1000', '0.00'],
    ['pct', '0.1', '100', '0.20'], ['pct', '999999.99', '10', '1099999.99'],
  ] as const)('%s: precio %s, valor %s produce %s', (mode, current, value, expected) => {
    expect(calculateProductBulkEditPrice(current, mode, value).toFixed(2)).toBe(expected);
  });

  it('mantiene half-up aunque otro cálculo cambie el redondeo global de Decimal', () => {
    const previous = Decimal.rounding;
    try {
      Decimal.set({rounding: Decimal.ROUND_DOWN});
      expect(calculateProductBulkEditPrice('10.05', 'pct', '10').toFixed(2)).toBe('11.06');
      expect(calculateProductBulkEditPrice('100', 'set', '2.345').toFixed(2)).toBe('2.35');
    } finally {Decimal.set({rounding: previous});}
  });
});
