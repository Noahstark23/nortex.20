import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { evaluateOperationalScenario, assertOperationalExpected, withOperationalEvaluationFlags } from './operations-product.mjs';
const bytes = await readFile('tests/fixtures/assistant/operations/deterministic.json');
const corpus = JSON.parse(bytes);
const report = { version: 1, createdAt: new Date().toISOString(), corpusSha256: createHash('sha256').update(bytes).digest('hex'), humanReview: 'pending', modelEvaluation: 'not_run', pilot: 'not_run', paidCalls: 0, results: [], limitations: ['Evalúa funciones reales con respuestas de repositorio sintéticas; no ejecuta MySQL.', 'Esperados independientes escritos por agente; pendientes de revisión humana.', 'No acredita precisión del modelo, entrega de mensajes, ni reducción de tiempo de tareas.'] };
const sources = ['backend/services/assistant/operations/inventory.ts', 'backend/services/assistant/operations/analytics.ts', 'backend/services/assistant/operations/analyticsPeriod.ts', 'backend/services/assistant/access.ts', 'backend/services/assistant/actions/service.ts', 'backend/services/promotions/management.ts', 'backend/services/promotions/pricing.ts', 'backend/services/promotions/checkout.ts', 'backend/services/promotions/totals.ts', 'scripts/assistant-evaluation/operations-product.mjs'];
report.sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
if (corpus.cases.length !== 120 || new Set(corpus.cases.map(row => row.id)).size !== 120) throw new Error('El corpus debe tener 120 identificadores distintos.');
await withOperationalEvaluationFlags(async () => {
  for (const scenario of corpus.cases) {
    const started = performance.now();
    try { assertOperationalExpected(await evaluateOperationalScenario(scenario), scenario.expected); report.results.push({ id: scenario.id, area: scenario.area, vertical: scenario.vertical, status: 'passed', durationMs: Math.round(performance.now() - started) }); }
    catch (error) { report.results.push({ id: scenario.id, area: scenario.area, vertical: scenario.vertical, status: 'failed', error: error.message }); }
  }
});
report.passed = report.results.filter(row => row.status === 'passed').length;
report.failed = report.results.length - report.passed;
const at = process.argv.indexOf('--report'), output = path.resolve(at >= 0 ? process.argv[at + 1] : 'reports/assistant-evaluation/operations-report.json');
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/120 contratos aprobados; ${report.failed} fallos. IA real y piloto sin ejecutar. Informe: ${output}`);
for (const row of report.results.filter(row => row.status === 'failed')) console.error(`${row.id}: ${row.error}`);
if (report.failed) process.exitCode = 1;
