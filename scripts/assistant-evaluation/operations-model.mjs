import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Decimal from 'decimal.js';
import { withEvaluationReport } from './evaluation-report.mjs';
import { MAX_EXTRACTION_RESERVATION_USD, GLOBAL_BUDGET_USD } from '../../backend/services/assistant/budget.ts';
import { MAX_OPERATION_ITERATIONS } from '../../backend/services/assistant/operations/orchestrator.ts';

/** A run goes through the authenticated server and its existing reserve/settle adapter. The CLI never reserves twice. */
export const MAX_OPERATION_RESERVATION_USD = new Decimal(MAX_EXTRACTION_RESERVATION_USD).mul(MAX_OPERATION_ITERATIONS).toFixed(6);
export function selectPaidOperationCases(cases, options) {
  const { vertical, role, limit = 1, maxReservedUsd = '2', review } = options;
  if (!['ferreteria', 'farmacia'].includes(vertical) || !['OWNER', 'MANAGER', 'CASHIER'].includes(role)) throw new Error('Elegí vertical y rol del ensayo.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Cada lote admite de 1 a 5 consultas.');
  const maximum = new Decimal(maxReservedUsd);
  if (!maximum.isFinite() || maximum.lte(0) || maximum.gt(GLOBAL_BUDGET_USD)) throw new Error('El tope del ensayo debe ser positivo y no superar el presupuesto global.');
  if (!review || review.synthetic !== true || review.expectedOutcomesReviewed !== true || typeof review.reviewer !== 'string' || !review.reviewer.trim()
    || !Number.isFinite(Date.parse(review.reviewedAt)) || review.vertical !== vertical || review.role !== role || !Array.isArray(review.scenarioIds)) throw new Error('Falta revisión humana del montaje sintético y de los resultados esperados para este rol y vertical.');
  const selected = cases.filter(row => row.vertical === vertical && row.role === role && review.scenarioIds.includes(row.id)).slice(0, limit);
  if (selected.length !== limit) throw new Error('No hay suficientes consultas revisadas para ese lote.');
  const worstCaseUsd = new Decimal(MAX_OPERATION_RESERVATION_USD).mul(selected.length);
  if (worstCaseUsd.gt(maximum)) throw new Error('El máximo conservador de este lote supera el tope solicitado. Reducí el lote.');
  return { selected, worstCaseUsd: worstCaseUsd.toFixed(6) };
}
export async function runOperationsModelEvaluation(args = process.argv.slice(2)) {
  const value = key => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const corpus = JSON.parse(await readFile('tests/fixtures/assistant/operations/model-reserved.json', 'utf8'));
  const output = path.resolve(value('--report') ?? 'reports/assistant-evaluation/operations-model-report.json');
  const initialReport = { version: 2, createdAt: new Date().toISOString(), reservedQuestions: corpus.cases.length, status: 'not_run', paidCalls: 0, humanReview: 'pending', results: [], maxReservationPerRunUsd: MAX_OPERATION_RESERVATION_USD, costAuthority: 'AssistantUsage + AssistantBudget del backend; recolección pendiente' };
  const resume = args.includes('--resume');
  if (!args.includes('--allow-paid-model')) {
    if (resume) throw new Error('Para recuperar un ensayo usá sus mismos argumentos y --resume; no se repetirán llamadas pagadas.');
    return withEvaluationReport(output, false, async (_existing, save) => { await save(initialReport); return initialReport; });
  }
  if (!args.includes('--synthetic-tenant')) throw new Error('La evaluación sólo puede usar un negocio sintético local.');
  const base = new URL(value('--base-url') ?? 'invalid:');
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Usá exclusivamente la raíz del backend local de QA.');
  const reviewPath = value('--review-file');
  if (!reviewPath) throw new Error('Indicá el archivo de revisión humana; el corpus entregado sigue pendiente.');
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  const selection = selectPaidOperationCases(corpus.cases, { vertical: value('--vertical'), role: value('--role'), limit: Number(value('--limit') ?? 1), maxReservedUsd: value('--max-reserved-usd') ?? '2', review });
  const tokenPath = value('--session-token-file');
  if (!tokenPath) throw new Error('Indicá el archivo privado de sesión QA; nunca una clave del proveedor.');
  const tokenStat = await stat(tokenPath);
  if (!tokenStat.isFile() || (tokenStat.mode & 0o077) !== 0 || tokenStat.size > 16_384) throw new Error('El archivo de sesión debe ser privado (0600) y acotado.');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  const api = async (endpoint, body) => {
    if (!/^\/api\/assistant\/(?:capabilities|conversations|conversations\/[a-zA-Z0-9_-]+\/runs|runs\/[a-zA-Z0-9_-]+)$/.test(endpoint)) throw new Error('El ensayo no admite endpoints de ejecución ni confirmación.');
    const response = await fetch(new URL(endpoint, base), { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: OPERATIONS_REQUEST_FAILED`);
    return data;
  };
  // Fingerprints bind this journal to the exact local session and reviewed questions.
  // They are not authorization: every recovery still traverses authenticated backend reads.
  const digest = value => createHash('sha256').update(value).digest('hex');
  const binding = digest(JSON.stringify({ base: base.href, session: digest(token), review,
    selection: selection.selected, ceiling: selection.worstCaseUsd, maxReservation: MAX_OPERATION_RESERVATION_USD }));
  return withEvaluationReport(output, resume, async (existing, persist) => {
    if (existing && (existing.version !== 2 || existing.binding !== binding || !Array.isArray(existing.results))) throw new Error('Cambió la identidad o el montaje del ensayo; no se puede reanudar este informe.');
    const caps = await api('/api/assistant/capabilities');
    if (!caps.operations || caps.accessScope !== value('--role')) throw new Error('La sesión no corresponde al rol y capacidad operativa del ensayo.');
    const report = existing ?? { ...initialReport, binding };
    const save = () => persist(report);
    report.status = 'running'; report.paidCalls = null; report.conservativeReservationCeilingUsd = selection.worstCaseUsd;
    report.review = { reviewer: review.reviewer, reviewedAt: review.reviewedAt, vertical: review.vertical, role: review.role };
    if (resume) report.lastRecoveryAt = new Date().toISOString();
    await save();
    for (const scenario of selection.selected) {
      let result = report.results.find(row => row.id === scenario.id);
      // Resume is strictly read-only, including scenarios not yet submitted.
      if (resume && !result) continue;
      const started = performance.now();
      if (!result) {
        result = { id: scenario.id, status: 'not_run', humanReview: 'pending', judgements: null };
        report.results.push(result);
      }
      try {
        let run;
        if (resume) {
          if (!result.conversationId || !result.requestId) throw new Error('No hay identidad durable suficiente para recuperar; no se creó otra consulta.');
          if (result.runId) run = await api(`/api/assistant/runs/${encodeURIComponent(result.runId)}`);
          else {
            const response = await api(`/api/assistant/conversations/${encodeURIComponent(result.conversationId)}/runs`);
            run = response.runs?.find(row => row.requestId === result.requestId);
          }
          if (!run) throw new Error('La ejecución no está visible; se conserva como incierta sin reenviar.');
        } else {
          const conversation = await api('/api/assistant/conversations', {});
          result.conversationId = conversation.id; result.requestId = randomUUID();
          await save(); // Identity must reach disk before submitting the paid run.
          run = await api(`/api/assistant/conversations/${encodeURIComponent(conversation.id)}/runs`, { requestId: result.requestId, text: scenario.question });
        }
        const assertIdentity = () => {
          if (run.requestId !== result.requestId || run.conversationId !== result.conversationId || typeof run.id !== 'string' || (result.runId && run.id !== result.runId)) throw new Error('La respuesta no corresponde a la identidad guardada.');
        };
        assertIdentity(); result.runId = run.id; await save();
        const deadline = Date.now() + 75_000;
        while (['PENDING', 'RUNNING'].includes(run.status) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          run = await api(`/api/assistant/runs/${encodeURIComponent(run.id)}`); assertIdentity();
        }
        result.status = run.status === 'SUCCEEDED' && !run.result?.degraded ? 'executed_pending_human_review' : 'incomplete';
        result[resume ? 'recoveryDurationMs' : 'durationMs'] = Math.round(performance.now() - started);
        result.result = run.result ?? null; result.steps = run.steps ?? []; delete result.error;
        await save();
        if (result.status === 'incomplete') break;
      } catch (error) {
        result.status = 'uncertain';
        // Provider/transport errors can contain private request data; do not persist their message.
        result.error = 'No se pudo verificar el resultado. Conservar identidad y recuperar mediante lecturas.';
        await save(); break;
      }
    }
    report.status = report.results.length === selection.selected.length && report.results.every(row => row.status === 'executed_pending_human_review') ? 'executed_pending_human_review' : 'incomplete';
    await save(); return report;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await runOperationsModelEvaluation();
  console.log(`Consultas reservadas: ${report.reservedQuestions}; proveedor: ${report.status}; revisión humana pendiente.`);
  if (report.status === 'incomplete') process.exitCode = 1;
}
