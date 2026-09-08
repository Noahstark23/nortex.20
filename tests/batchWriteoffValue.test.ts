import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { calculateBatchWriteoffValue } from '../backend/services/batchWriteoffValue';

describe('valor exacto de merma compartido por preview y registro', () => {
  it.each([
    ['1.25', '12.34', '15.43'],
    ['0.0001', '50', '0.01'],
    ['0.0001', '49', '0.00'],
    ['2', '1.234567', '2.47'],
    ['1', '0', '0.00'],
    ['5', '3', '15.00'],
    ['1000000', '1234.567890', '1234567890.00'],
  ])('%s por %s conserva %s', (quantity, cost, expected) => {
    const actual = calculateBatchWriteoffValue(quantity, cost);
    expect(actual).toBeInstanceOf(Decimal);
    expect(actual.toFixed(2)).toBe(expected);
  });
  it.each([
    ['0', '1'], ['-1', '1'], ['Infinity', '1'], ['-Infinity', '1'], ['NaN', '1'],
    ['1', '-0.01'], ['1', 'Infinity'], ['1', '-Infinity'], ['1', 'NaN'],
  ])('rechaza cantidad %s o costo %s inválidos', (quantity, cost) => {
    expect(() => calculateBatchWriteoffValue(quantity, cost)).toThrow(new RangeError('La cantidad y el costo de la merma deben ser finitos y válidos.'));
  });
});
