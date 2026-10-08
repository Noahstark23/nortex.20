import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Decimal from 'decimal.js';
import { inventoryBurnRateRow } from '../../backend/services/assistant/operations/inventory.ts';
import { withEvaluationReport } from './evaluation-report.mjs';

const DAY = 86_400_000;
const fields = ['soldQuantity', 'returnedQuantity', 'restockedQuantity', 'quarantinedQuantity', 'lostQuantity'];
const iso = ms => new Date(ms).toISOString();
const number = value => { if (typeof value !== 'string' || !/^\d+(\.\d{1,4})?$/.test(value)) throw new Error('Cantidades BASE deben ser decimales no negativos con hasta cuatro posiciones.'); return new Decimal(value); };
const instant = value => { const time = Date.parse(value); if (!Number.isFinite(time) || iso(time) !== value) throw new Error('Usá instantes ISO UTC completos.'); return time; };
const sum = (rows, field) => rows.reduce((total, row) => total.plus(number(row[field])), new Decimal(0));
const consumption = rows => sum(rows, 'soldQuantity').minus(sum(rows, 'restockedQuantity'));
function validateDays(rows, start, length, knownAt, label) {
  if (!Array.isArray(rows) || rows.length !== length || new Set(rows.map(row => row.day)).size !== length) throw new Error(`${label}: faltan días únicos; las ausencias requieren filas incompletas explícitas.`);
  return Array.from({ length }, (_, index) => {
    const beginning = start + index * DAY, day = iso(beginning).slice(0, 10), row = rows.find(entry => entry.day === day);
    if (!row || typeof row.complete !== 'boolean' || typeof row.stockout !== 'boolean') throw new Error(`${label}: calendario o disponibilidad inválida.`);
    const recorded = instant(row.recordedAt);
    if (recorded > knownAt || recorded < beginning + DAY) throw new Error(`${label}: registro fuera de su corte de conocimiento o anterior al cierre diario.`);
    if (row.complete) {
      fields.forEach(field => number(row[field]));
      if (!number(row.restockedQuantity).plus(number(row.quarantinedQuantity)).plus(number(row.lostQuantity)).eq(number(row.returnedQuantity))) throw new Error(`${label}: disposición de devoluciones no conciliada.`);
    } else if (fields.some(field => row[field] !== null)) throw new Error(`${label}: un día incompleto usa null, nunca cantidades estimadas.`);
    return row;
  });
}
export function backtestForecast(input) {
  if (input.version !== 1 || typeof input.synthetic !== 'boolean' || !Array.isArray(input.cases) || !input.cases.length) throw new Error('Se necesitan fotografías congeladas versión 1 con origen explícito.');
  const observations = [], ids = new Set(), cuts = new Set();
  for (const sample of input.cases) {
    if (typeof sample.id !== 'string' || !sample.id || ids.has(sample.id)) throw new Error('Caso duplicado o sin identidad.'); ids.add(sample.id);
    const cutoff = instant(sample.cutoff), snapshot = sample.snapshot;
    if (!['ferreteria', 'farmacia'].includes(sample.vertical) || !sample.productId || !sample.businessRef) throw new Error('Identificá vertical, negocio anonimizado y producto.');
    const key = JSON.stringify([sample.businessRef, sample.productId, sample.cutoff]);
    if (cuts.has(key)) throw new Error('No se permite puntuar dos veces el mismo producto y corte.'); cuts.add(key);
    if (!sample.cutoff.endsWith('T06:00:00.000Z') || !snapshot || snapshot.asOf !== sample.cutoff || instant(snapshot.recordedAt) > cutoff
      || !Array.isArray(snapshot.evidence) || !snapshot.evidence.length || snapshot.evidence.some(ref => typeof ref !== 'string' || !ref.trim())) throw new Error('El snapshot debe ser conocido y congelado a las 00:00 Managua con evidencia.');
    const productCreatedAt = instant(snapshot.productCreatedAt);
    if (productCreatedAt > cutoff || snapshot.row?.productId !== sample.productId) throw new Error('Catálogo incompatible con el corte.');
    const observedAt = instant(sample.observedAt);
    if (observedAt < cutoff + 14 * DAY) throw new Error('Todavía no termina el horizonte observado de 14 días.');
    const history = validateDays(sample.history, cutoff - 90 * DAY, 90, cutoff, 'Historia');
    const future = validateDays(sample.outcomes, cutoff, 14, observedAt, 'Resultado');
    const training = history.slice(-30), complete = training.every(row => row.complete);
    const totals = Object.fromEntries(fields.map(field => [field, complete ? sum(training, field).toFixed() : null]));
    // Only pre-cutoff observations can enter the actual product calculator. No live database/current stock.
    const row = inventoryBurnRateRow({ ...snapshot.row, ...totals, unknownRows: complete ? '0' : '1',
      historyAvailableDays: complete ? Math.max(0, Math.min(30, Math.floor((cutoff - productCreatedAt) / DAY))) : 0 }, {}, 30, false);
    const manual = sample.manual;
    if (manual && (instant(manual.recordedAt) > cutoff || !manual.evidence?.trim())) throw new Error('La estimación manual debe guardarse antes del corte con evidencia.');
    for (const horizon of [7, 14]) {
      const actualDays = future.slice(0, horizon), reasons = [];
      if (!complete || row.historyStatus !== 'SUFFICIENT') reasons.push('insufficient_history');
      if (row.dailyAverage === null || row.status === 'unavailable') reasons.push('product_estimate_unavailable');
      if (!actualDays.every(day => day.complete)) reasons.push('incomplete_outcome');
      if ([...training, ...actualDays].some(day => day.stockout)) reasons.push('stockout_censored');
      const actual = actualDays.every(day => day.complete) ? consumption(actualDays) : null;
      if (actual?.lt(0)) reasons.push('negative_net_outcome');
      const baselines = { product30: row.dailyAverage === null ? null : new Decimal(row.dailyAverage).mul(horizon).toFixed(),
        average7: complete ? consumption(training.slice(-7)).div(7).mul(horizon).toFixed() : null,
        // Four observations of each weekday before the cutoff; no realized future enters this reference.
        weekday4: complete ? consumption(training.slice(-28)).div(28).mul(horizon).toFixed() : null,
        manual: manual?.[String(horizon)] == null ? null : number(manual[String(horizon)]).toFixed() };
      if (Object.values(baselines).some(value => value !== null && new Decimal(value).lt(0))) reasons.push('negative_baseline');
      observations.push({ id: sample.id, vertical: sample.vertical, productId: sample.productId, businessRef: sample.businessRef,
        cutoff: sample.cutoff, horizon, reasons, status: reasons.length ? 'excluded' : 'scored', actual: actual?.toFixed() ?? null,
        estimates: baselines, historyStatus: row.historyStatus, suggestedQuantity: row.suggestedQuantity,
        interpretation: 'Salidas por venta menos RESTOCK; no mide demanda perdida ni prueba que la compra sugerida sea óptima.' });
    }
  }
  const groups = ['ferreteria', 'farmacia'].flatMap(vertical => [7, 14].flatMap(horizon => ['product30', 'average7', 'weekday4', 'manual'].map(model => {
    const available = observations.filter(row => row.vertical === vertical && row.horizon === horizon);
    const scored = available.filter(row => row.status === 'scored' && row.estimates[model] !== null);
    const errors = scored.map(row => new Decimal(row.estimates[model]).minus(row.actual));
    const totalActual = scored.reduce((total, row) => total.plus(row.actual), new Decimal(0));
    const absolute = errors.reduce((total, error) => total.plus(error.abs()), new Decimal(0));
    const signed = errors.reduce((total, error) => total.plus(error), new Decimal(0));
    return { vertical, horizon, model, scored: scored.length, excluded: available.length - scored.length,
      mae: scored.length ? absolute.div(scored.length).toFixed() : null, bias: scored.length ? signed.div(scored.length).toFixed() : null,
      wapePercent: totalActual.gt(0) ? absolute.div(totalActual).mul(100).toFixed() : null };
  })));
  return { version: 1, status: input.synthetic ? 'simulation_only' : 'pending_human_review', observations, groups,
    limitations: ['Validar procedencia de cada snapshot y cancelaciones conocidas entonces requiere revisión humana; las fechas declaradas no lo demuestran.',
      'Los ceros no acreditan demanda cero; faltantes de stock e historia incompleta se excluyen explícitamente.',
      'MAE y sesgo se expresan en unidades BASE; no mezclar grupos heterogéneos como un KPI de negocio.',
      'Los cortes solapados no son muestras independientes. La tasa pública del producto conserva su redondeo a cuatro decimales.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--input') || !args.includes('--report')) throw new Error('Indicá --input y --report; nunca se consulta la base de datos.');
  const bytes = await readFile(value('--input')), source = await readFile('backend/services/assistant/operations/inventory.ts');
  const report = { ...backtestForecast(JSON.parse(bytes.toString())), inputSha256: createHash('sha256').update(bytes).digest('hex'), productSourceSha256: createHash('sha256').update(source).digest('hex') };
  await withEvaluationReport(path.resolve(value('--report')), false, async (_old, save) => save(report));
  console.log(`Backtest: ${report.status}; ${report.observations.filter(row => row.status === 'scored').length} observaciones puntuadas. Validación humana pendiente.`);
}
