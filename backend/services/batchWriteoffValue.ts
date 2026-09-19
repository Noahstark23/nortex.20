import Decimal from 'decimal.js';

/** Valor libro compartido por la revisión y el asiento de la misma merma. */
export function calculateBatchWriteoffValue(quantity: Decimal.Value, unitCost: Decimal.Value): Decimal {
  const units = new Decimal(quantity), cost = new Decimal(unitCost);
  if (!units.isFinite() || !units.gt(0) || !cost.isFinite() || cost.lt(0)) {
    throw new RangeError('La cantidad y el costo de la merma deben ser finitos y válidos.');
  }
  return units.mul(cost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
