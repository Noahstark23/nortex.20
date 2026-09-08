import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Decimal from 'decimal.js';
import { buildPilotTasks } from './operations-corpus.mjs';
import { withEvaluationReport } from './evaluation-report.mjs';

const areas = ['reposicion', 'vencimientos', 'ventas-promociones'];
const verticals = ['ferreteria', 'farmacia'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const median = values => {
  const sorted = values.map(value => new Decimal(value)).sort((a, b) => a.cmp(b)), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1].plus(sorted[middle]).div(2);
};
export function createPilotWorksheet() {
  return { version: 2, synthetic: null, candidateSha: null, reviewer: null, reviewedAt: null,
    humanReview: 'pending', improvementTargetPercent: 20,
    tasks: buildPilotTasks().map((row, index) => ({ ...row, order: index % 2 ? 'assistant-first' : 'manual-first',
      baselineCorrections: null, assistantCorrections: null, criticalIncidents: null, recordedAt: null })) };
}
export function analyzePilot(input) {
  if (input.version !== 2 || input.improvementTargetPercent !== 20 || !Array.isArray(input.tasks)) throw new Error('Usá la planilla versión 2 con objetivo del 20%.');
  const expected = createPilotWorksheet().tasks;
  if (input.tasks.length !== expected.length || new Set(input.tasks.map(row => row.id)).size !== expected.length) throw new Error('Deben conservarse las 60 tareas únicas, incluidas las pendientes y fallidas.');
  const rows = expected.map(template => {
    const row = input.tasks.find(item => item.id === template.id);
    if (!row || row.area !== template.area || row.vertical !== template.vertical || row.task !== template.task || row.order !== template.order) throw new Error('Cambió la tarea o su orden alternado; el ensayo ya no es comparable.');
    if (!['not_run', 'completed'].includes(row.status)) throw new Error('Estado de tarea desconocido.');
    if (row.status === 'completed') {
      if (![row.baselineSeconds, row.assistantSeconds].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
        || ![row.baselineErrors, row.assistantErrors, row.baselineCorrections, row.assistantCorrections, row.criticalIncidents].every(count)
        || typeof row.success !== 'boolean' || typeof row.operator !== 'string' || !row.operator.trim()
        || !Array.isArray(row.evidence) || !row.evidence.length || row.evidence.some(value => typeof value !== 'string' || !value.trim())
        || !Number.isFinite(Date.parse(row.recordedAt))) throw new Error(`Medición incompleta: ${row.id}. No se admite ausencia como cero.`);
    } else if ([row.baselineSeconds, row.assistantSeconds, row.baselineErrors, row.assistantErrors, row.baselineCorrections,
      row.assistantCorrections, row.criticalIncidents, row.success, row.recordedAt, row.operator].some(value => value !== null) || row.evidence.length) {
      throw new Error('Una tarea con observaciones no puede ocultarse como pendiente.');
    }
    return row;
  });
  const completed = rows.filter(row => row.status === 'completed');
  if (completed.length && (typeof input.synthetic !== 'boolean' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.candidateSha ?? ''))) throw new Error('Identificá candidato y origen sintético o real antes de medir.');
  const groups = areas.flatMap(area => verticals.map(vertical => {
    const samples = completed.filter(row => row.area === area && row.vertical === vertical);
    const baselineMedian = samples.length ? median(samples.map(row => row.baselineSeconds)) : null;
    const assistantMedian = samples.length ? median(samples.map(row => row.assistantSeconds)) : null;
    const improvement = baselineMedian ? baselineMedian.minus(assistantMedian).div(baselineMedian).mul(100) : null;
    const sum = field => samples.reduce((total, row) => total.plus(row[field]), new Decimal(0));
    const counts = Object.fromEntries(['baselineErrors', 'assistantErrors', 'baselineCorrections', 'assistantCorrections', 'criticalIncidents'].map(field => [field, sum(field).toFixed()]));
    return { area, vertical, completed: samples.length, required: 10,
      baselineMedianSeconds: baselineMedian?.toFixed() ?? null, assistantMedianSeconds: assistantMedian?.toFixed() ?? null,
      improvementPercent: improvement?.toDecimalPlaces(4).toFixed() ?? null, ...counts,
      criteriaMet: samples.length >= 10 && improvement.gte(20) && sum('assistantErrors').lte(sum('baselineErrors'))
        && sum('assistantCorrections').lte(sum('baselineCorrections')) && sum('criticalIncidents').isZero() && samples.every(row => row.success),
    };
  }));
  const criteriaMet = groups.every(group => group.criteriaMet);
  const reviewed = input.humanReview === 'approved' && typeof input.reviewer === 'string' && input.reviewer.trim() && Number.isFinite(Date.parse(input.reviewedAt))
    && completed.every(row => Date.parse(row.recordedAt) <= Date.parse(input.reviewedAt));
  const status = completed.length === 0 ? 'not_run' : input.synthetic ? 'simulation_only' : !criteriaMet ? 'criteria_not_met' : !reviewed ? 'pending_human_review' : 'criteria_met';
  return { version: 1, status, candidateSha: input.candidateSha, completed: completed.length, required: 60, criteriaMet, groups,
    humanReview: reviewed ? 'declared_approved' : 'pending',
    limitations: ['La planilla y su revisión son declaraciones del operador; requieren evidencia externa consultable.', 'Una simulación valida el instrumento, no utilidad real. Este informe no autoriza ampliar el piloto ni desplegar.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--report') || (!args.includes('--template') && !args.includes('--input'))) throw new Error('Indicá --report y --template o --input.');
  let result;
  if (args.includes('--template')) result = createPilotWorksheet();
  else {
    const bytes = await readFile(value('--input'));
    result = { ...analyzePilot(JSON.parse(bytes.toString())), inputSha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await withEvaluationReport(path.resolve(value('--report')), false, async (_old, save) => save(result));
  console.log(`Piloto: ${result.status ?? 'planilla pendiente'}; no se ejecutaron operaciones ni llamadas de IA.`);
}
