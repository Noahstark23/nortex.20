import Decimal from 'decimal.js';

/** Fórmula del formulario: porcentaje sobre precio vigente, redondeo half-up y piso cero. */
export function calculateProductBulkEditPrice(currentPrice: Decimal.Value, mode: 'set' | 'pct', value: Decimal.Value): Decimal {
  const amount = mode === 'set' ? new Decimal(value)
    : new Decimal(currentPrice).mul(new Decimal(1).plus(new Decimal(value).div(100)));
  const rounded = amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isNegative() ? new Decimal(0) : rounded;
}
