import { describe, expect, it } from 'vitest';
import { backtestForecast } from '../scripts/assistant-evaluation/forecast-backtest.mjs';
const DAY = 86_400_000, cutoff = Date.parse('2026-08-01T06:00:00.000Z');
function input() {
  const day = (at: number, sold: string) => ({ day: new Date(at).toISOString().slice(0, 10), recordedAt: new Date(at + DAY).toISOString(), complete: true, stockout: false,
    soldQuantity: sold, returnedQuantity: '3', restockedQuantity: '2', quarantinedQuantity: '1', lostQuantity: '0' });
  return { version: 1, synthetic: true, cases: [{ id: 'cement-august', businessRef: 'synthetic-hardware', vertical: 'ferreteria', productId: 'cement', cutoff: new Date(cutoff).toISOString(),
    observedAt: new Date(cutoff + 14 * DAY).toISOString(), snapshot: { asOf: new Date(cutoff).toISOString(), recordedAt: new Date(cutoff).toISOString(), evidence: ['synthetic snapshot'], productCreatedAt: new Date(cutoff - 100 * DAY).toISOString(),
      row: { productId: 'cement', name: 'Synthetic cement', unit: 'bag', quantityStep: '1', saleMode: 'COUNTED', physicalStock: '40', requiresBatchTracking: false, pendingQuantity: '0', reorderPoint: '10', maxStock: '0' } },
    history: Array.from({ length: 90 }, (_, index) => day(cutoff + (index - 90) * DAY, '10')),
    outcomes: Array.from({ length: 14 }, (_, index) => day(cutoff + index * DAY, '12')),
    manual: { recordedAt: new Date(cutoff).toISOString(), evidence: 'synthetic manual estimate', '7': '63', '14': '126' } }] };
}
describe('backtest con snapshots: calculador real, conocimiento previo y resultados posteriores separados', () => {
  it('calcula errores independientes usando ventas menos RESTOCK, sin restar cuarentena', () => {
    const result = backtestForecast(input());
    expect(result.status).toBe('simulation_only');
    expect(result.observations[0]).toMatchObject({ actual: '70', suggestedQuantity: '80', estimates: { product30: '56', average7: '56', weekday4: '56', manual: '63' } });
    expect(result.groups.find((row: any) => row.vertical === 'ferreteria' && row.horizon === 7 && row.model === 'product30')).toMatchObject({ scored: 1, mae: '14', bias: '-14', wapePercent: '20' });
  });
  it('cambiar resultados futuros no cambia estimaciones ni sugerencia del corte', () => {
    const data = input(), before = backtestForecast(data);
    data.cases[0].outcomes.forEach(row => { row.soldQuantity = '50'; });
    const after = backtestForecast(data);
    expect(after.observations[0].estimates).toEqual(before.observations[0].estimates);
    expect(after.observations[0].suggestedQuantity).toBe(before.observations[0].suggestedQuantity);
    expect(after.observations[0].actual).not.toBe(before.observations[0].actual);
  });
  it.each(['history', 'snapshot', 'manual'])('rechaza conocimiento futuro en %s', target => {
    const data = input(), future = new Date(cutoff + 1).toISOString();
    if (target === 'history') data.cases[0].history[89].recordedAt = future;
    else data.cases[0][target].recordedAt = future;
    expect(() => backtestForecast(data)).toThrow(/corte|snapshot/);
  });
  it('rechaza otro corte horario y calendarios duplicados o incompletos', () => {
    const data = input(); data.cases[0].cutoff = '2026-08-01T00:00:00.000Z'; expect(() => backtestForecast(data)).toThrow('Managua');
    const duplicate = input(); duplicate.cases[0].history[0] = duplicate.cases[0].history[1]; expect(() => backtestForecast(duplicate)).toThrow('días únicos');
    const short = input(); short.cases[0].history.pop(); expect(() => backtestForecast(short)).toThrow('días únicos');
  });
  it('excluye faltantes de stock e historia incompleta sin declararlos aciertos', () => {
    const data = input(); data.cases[0].outcomes[0].stockout = true;
    expect(backtestForecast(data).observations[0]).toMatchObject({ status: 'excluded', reasons: ['stockout_censored'] });
    const missing: any = input(); const day = missing.cases[0].history[89]; day.complete = false;
    ['soldQuantity', 'returnedQuantity', 'restockedQuantity', 'quarantinedQuantity', 'lostQuantity'].forEach(field => { day[field] = null; });
    expect(backtestForecast(missing).observations[0]).toMatchObject({ status: 'excluded', historyStatus: 'INSUFFICIENT', estimates: { product30: null } });
  });
  it('no calcula WAPE con cero observado y no inventa un error porcentual', () => {
    const data = input(); data.cases[0].outcomes.forEach(row => { row.soldQuantity = '2'; });
    const group = backtestForecast(data).groups.find((row: any) => row.vertical === 'ferreteria' && row.horizon === 7 && row.model === 'product30');
    expect(group).toMatchObject({ scored: 1, mae: '56', bias: '56', wapePercent: null });
  });
  it('conserva mínimos para productos nuevos y bloquea disposiciones inválidas', () => {
    const data = input(); data.cases[0].snapshot.productCreatedAt = new Date(cutoff - 5 * DAY).toISOString();
    expect(backtestForecast(data).observations[0]).toMatchObject({ historyStatus: 'INSUFFICIENT', suggestedQuantity: '0', status: 'excluded' });
    data.cases[0].history[89].restockedQuantity = '3'; expect(() => backtestForecast(data)).toThrow('no conciliada');
  });
  it('no puntúa dos veces un corte con distintos identificadores', () => {
    const data = input(); data.cases.push({ ...data.cases[0], id: 'duplicate-cut' });
    expect(() => backtestForecast(data)).toThrow('dos veces');
  });
});
