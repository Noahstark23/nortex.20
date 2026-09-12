/**
 * Verifica si una consulta de evaluación la respondió Haiku y si su consumo puede
 * acreditarse a esa ejecución concreta.
 *
 *   DATABASE_URL=... NORTEX_QA_DATABASE_ACK=disposable-database \
 *     node --import tsx scripts/qa/nortexgpt-verify-run.ts --report reports/assistant-evaluation/<lote>.json
 *
 * Dos preguntas SEPARADAS, con evidencias distintas:
 *
 * 1. ¿Respondió el modelo? `degraded:false` en SUCCEEDED acredita una respuesta.
 *    `iterations` se incrementa ANTES de reservar: no acredita una llamada.
 *    Una respuesta o un requestId explícitamente enlazado acredita contacto;
 *    con iteraciones sin esa evidencia, el intento queda desconocido.
 *
 * 2. ¿Cuánto consumió ESA ejecución? Sólo se afirma con una correlación inequívoca:
 *    el campo `runId` de la fila de consumo, escrito al CREAR la reserva —antes de
 *    llamar al proveedor—, de modo que también quedan vinculados los fallos, los
 *    reinicios y los costos inciertos. Si ese campo no está en el cliente Prisma
 *    generado, la consulta no lo pide y la respuesta es
 *    `consumo_por_ejecucion_no_acreditado`. Correlacionar por usuario y fecha
 *    atribuiría mal el consumo con dos consultas del mismo usuario, con concurrencia
 *    o al cruzar el borde del mes; este script NO lo hace.
 *
 * No imprime el texto de la respuesta, la pregunta ni datos del negocio.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import prisma from '../../backend/lib/prisma.js';
import { DEFAULT_TENANT_BUDGET_USD, MAX_APPROVED_TENANT_BUDGET_USD } from '../../backend/services/assistant/budgetPolicy.js';
import { budgetMonth, GLOBAL_BUDGET_USD } from '../../backend/services/assistant/budget.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

/** Campo que acredita el consumo, escrito en la reserva. */
export const USAGE_RUN_LINK_FIELD = 'runId';
export const CLASS_MODEL_ANSWERED = 'respuesta_del_modelo';
export const CLASS_INCOMPLETE_WITH_CALLS = 'incompleta_con_llamadas_al_proveedor';
export const CLASS_CALLS_UNKNOWN = 'llamadas_al_proveedor_no_acreditadas';
export const CLASS_FALLBACK_NO_CALLS = 'respaldo_determinista_sin_llamadas';
export const COST_ATTRIBUTED = 'consumo_por_ejecucion_acreditado';
export const COST_PARTIAL = 'consumo_por_ejecucion_incompleto';
export const COST_NOT_ATTRIBUTED = 'consumo_por_ejecucion_no_acreditado';
export const NO_LINK_REASON = 'Ninguna fila de consumo trae el vínculo con esta ejecución (AssistantUsage.runId ausente o vacío): puede faltar la migración y `prisma generate`, o ser consumo anterior al vínculo. Correlacionar por usuario y fecha atribuiría mal el consumo con dos consultas del mismo usuario, con concurrencia o al cruzar el borde del mes.';

export interface VerifiableRun { id: string; tenantId: string; userId: string; status: string; iterations?: number; result?: unknown; errorCode?: string | null; createdAt: Date }
export interface VerifiableUsage { id: string; tenantId: string; userId: string; month: string; status: string; reservedUsd: unknown; actualUsd?: unknown; providerRequestId?: string | null; createdAt: Date; [key: string]: unknown }

/** Mes de presupuesto de la ejecución, tomado de SU fecha: un lote de un mes anterior no se evalúa contra el mes corriente. */
export function usageMonthForRun(run: VerifiableRun): string {
  return budgetMonth(run.createdAt);
}

/** `degraded:false` en una ejecución SUCCEEDED es prueba de que hubo respuesta del proveedor. */
export function runAnsweredByModel(run: VerifiableRun): boolean {
  const result = (run.result ?? {}) as { degraded?: boolean };
  return run.status === 'SUCCEEDED' && result.degraded === false;
}

/** ¿El cliente Prisma generado conoce el campo de enlace? Sin él la consulta no puede pedirlo. */
export function modelHasField(models: ReadonlyArray<{ name: string; fields: ReadonlyArray<{ name: string }> }>, modelName: string, fieldName: string): boolean {
  return Boolean(models.find(model => model.name === modelName)?.fields.some(field => field.name === fieldName));
}
export function assistantUsageHasRunLink(): boolean {
  return modelHasField(Prisma.dmmf.datamodel.models as never, 'AssistantUsage', USAGE_RUN_LINK_FIELD);
}

/** Meses vecinos al de la ejecución: una consulta puede reservar de un lado del borde y liquidar del otro. */
export function monthWindowForRun(run: VerifiableRun): string[] {
  const [year, month] = usageMonthForRun(run).split('-').map(Number);
  const at = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return [at(-1), at(0), at(1)];
}

/** Una iteración puede detenerse antes de llamar; una reserva tampoco prueba envío. */
export function providerCallAttempted(run: VerifiableRun, usageRows: VerifiableUsage[] = []): boolean | null {
  if (runAnsweredByModel(run)) return true;
  const cost = attributeUsageToRun(run, usageRows);
  if (cost.attributable && cost.providerRequests.length > 0) return true;
  if (run.status === 'SUCCEEDED' && run.iterations === 0 && !usageRows.some(row => row?.[USAGE_RUN_LINK_FIELD] === run.id)) return false;
  return null;
}

export function classifyRun(run: VerifiableRun, usageRows: VerifiableUsage[] = []): string {
  if (runAnsweredByModel(run)) return CLASS_MODEL_ANSWERED;
  const attempted = providerCallAttempted(run, usageRows);
  return attempted === true ? CLASS_INCOMPLETE_WITH_CALLS : attempted === false ? CLASS_FALLBACK_NO_CALLS : CLASS_CALLS_UNKNOWN;
}

/**
 * Atribuye consumo a UNA ejecución sólo con una correlación inequívoca.
 * Nunca usa ventanas de tiempo, usuario ni proximidad: ante la duda no acredita.
 */
export function attributeUsageToRun(run: VerifiableRun, usageRows: VerifiableUsage[]) {
  if (!run || typeof run.id !== 'string' || !run.id) throw new Error('Se requiere una ejecución con identificador para acreditar consumo.');
  if (!Array.isArray(usageRows)) throw new Error('Se requiere la lista de filas de consumo candidatas.');

  const linked = usageRows.filter(row => typeof row?.[USAGE_RUN_LINK_FIELD] === 'string' && row[USAGE_RUN_LINK_FIELD] === run.id);
  if (!linked.length) {
    return { attributable: false, basis: 'ninguno', status: COST_NOT_ATTRIBUTED, reason: NO_LINK_REASON, rows: [], observedUsd: null, reservedUsd: null, providerRequests: [] };
  }
  // Una fila enlazada que no pertenece al mismo tenant/usuario es incoherente: no se acredita.
  const foreign = linked.filter(row => row.tenantId !== run.tenantId || row.userId !== run.userId);
  if (foreign.length) {
    return { attributable: false, basis: USAGE_RUN_LINK_FIELD, status: COST_NOT_ATTRIBUTED, reason: `El enlace de consumo apunta a ${foreign.length} fila(s) de otro tenant o usuario; la correlación es incoherente y no se acredita.`, rows: [], observedUsd: null, reservedUsd: null, providerRequests: [] };
  }
  const invalid = linked.some(row => {
    try {
      const reserved = new Decimal(String(row.reservedUsd));
      if (!reserved.isFinite() || reserved.isNegative()) return true;
      if (row.status !== 'SETTLED') return false;
      if (row.actualUsd == null) return true;
      const actual = new Decimal(String(row.actualUsd));
      return !actual.isFinite() || actual.isNegative();
    } catch { return true; }
  });
  if (invalid) return { attributable: false, basis: USAGE_RUN_LINK_FIELD, status: COST_NOT_ATTRIBUTED, reason: 'Importes de consumo ausentes o inválidos; no se sustituyen por cero.', rows: [], observedUsd: null, reservedUsd: null, providerRequests: [] };
  const settled = linked.filter(row => row.status === 'SETTLED');
  const pending = linked.filter(row => row.status !== 'SETTLED');
  const sum = (rows: VerifiableUsage[], field: 'actualUsd' | 'reservedUsd') => rows.reduce((total, row) => total.add(new Decimal((row[field] ?? 0)?.toString() ?? '0')), new Decimal(0));
  return {
    attributable: true, basis: USAGE_RUN_LINK_FIELD,
    // Una reserva sin liquidar o marcada UNKNOWN deja el consumo incompleto, no cero.
    status: pending.length ? COST_PARTIAL : COST_ATTRIBUTED,
    reason: pending.length ? `Hay ${pending.length} fila(s) sin liquidar (${[...new Set(pending.map(row => row.status))].join(', ')}); el consumo de esta ejecución queda incompleto.` : null,
    rows: linked.map(row => ({ status: row.status, reservedUsd: row.reservedUsd?.toString() ?? null, actualUsd: row.actualUsd?.toString() ?? null })),
    observedUsd: sum(settled, 'actualUsd').toFixed(6),
    reservedUsd: sum(linked, 'reservedUsd').toFixed(6),
    providerRequests: settled.map(row => row.providerRequestId).filter((value): value is string => typeof value === 'string' && value.length > 0),
  };
}

export function buildRunFinding({ run, usageRows }: { run: VerifiableRun; usageRows: VerifiableUsage[] }) {
  const result = (run.result ?? {}) as { degraded?: boolean; evidence?: Array<{ id: string; tool: string }>; actionProposalIds?: string[]; text?: string };
  const modelAnswered = runAnsweredByModel(run);
  const attempted = providerCallAttempted(run, usageRows);
  const cost = attributeUsageToRun(run, usageRows);
  return {
    runId: run.id, tenantId: run.tenantId, month: usageMonthForRun(run),
    modelAnswered,
    verdict: classifyRun(run, usageRows),
    providerCallAttempted: attempted,
    verdictBasis: 'respuesta validada o requestId enlazado; iterations por sí solo no acredita llamadas',
    runStatus: run.status, errorCode: run.errorCode ?? null,
    degraded: result.degraded ?? null, iterations: run.iterations ?? null,
    // Fuentes: sólo nombre de herramienta e identificador de evidencia, sin contenido.
    evidenceSources: (result.evidence ?? []).map(item => ({ id: item.id, tool: item.tool })),
    actionProposals: (result.actionProposalIds ?? []).length,
    answerLength: typeof result.text === 'string' ? result.text.length : null,
    costAttribution: cost.status,
    costAttributionBasis: cost.basis,
    costAttributionReason: cost.reason,
    observedUsdForThisRun: cost.observedUsd,
    reservedUsdForThisRun: cost.reservedUsd,
    providerRequestsForThisRun: cost.providerRequests,
    note: modelAnswered
      ? 'La ejecución no quedó degradada: hubo respuesta validada del proveedor. No acredita calidad; la revisión humana sigue pendiente.'
      : attempted === true
        ? 'Hay evidencia de contacto con el proveedor, pero la respuesta quedó incompleta. El costo se informa por separado y puede seguir incierto.'
        : attempted === false
          ? 'Respaldo determinista sin iteraciones del proveedor. La ausencia de filas enlazadas no acredita un importe por consulta.'
          : 'No se puede acreditar si se llamó al proveedor: las iteraciones incluyen intentos detenidos antes del envío. No se presume gasto cero ni liquidación completa.',
  };
}

export async function verifyEvaluationReport(reportPath: string, deps: { db?: typeof prisma } = {}) {
  const db = deps.db ?? prisma;
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const hasLink = assistantUsageHasRunLink();
  const findings = [];
  const months = new Set<string>();
  for (const row of report.results ?? []) {
    if (!row.runId) { findings.push({ id: row.id, verdict: 'sin_identidad_durable', costAttribution: COST_NOT_ATTRIBUTED, detail: 'El informe no guarda runId; no se puede contrastar ni acreditar consumo.' }); continue; }
    const run = await db.assistantRun.findUnique({ where: { id: row.runId }, select: { id: true, tenantId: true, userId: true, status: true, iterations: true, result: true, errorCode: true, createdAt: true } });
    if (!run) { findings.push({ id: row.id, runId: row.runId, verdict: 'ejecucion_no_encontrada', costAttribution: COST_NOT_ATTRIBUTED, detail: 'El backend de QA no conserva esa ejecución.' }); continue; }
    const month = usageMonthForRun(run as VerifiableRun);
    months.add(month);
    // El cliente Prisma puede ser anterior al campo de enlace: se pide sólo si existe.
    const select: Record<string, boolean> = { id: true, tenantId: true, userId: true, month: true, status: true, reservedUsd: true, actualUsd: true, providerRequestId: true, createdAt: true };
    if (hasLink) select[USAGE_RUN_LINK_FIELD] = true;
    // El cliente tipado se generó sin el campo; la consulta se arma sin depender de esos tipos.
    const usageDelegate = db.assistantUsage as unknown as { findMany(args: unknown): Promise<VerifiableUsage[]> };
    // Con enlace se consulta POR la ejecución y sin filtro de mes: una consulta puede
    // reservar de un lado del borde del mes y liquidar del otro. Sin enlace se traen
    // candidatas de los meses vecinos sólo como contexto, nunca como atribución.
    const candidates = hasLink
      ? await usageDelegate.findMany({ where: { [USAGE_RUN_LINK_FIELD]: run.id }, select, orderBy: { createdAt: 'asc' } })
      : await usageDelegate.findMany({ where: { tenantId: run.tenantId, userId: run.userId, month: { in: monthWindowForRun(run as VerifiableRun) } }, select, orderBy: { createdAt: 'asc' } });
    for (const candidate of candidates) months.add(candidate.month);
    findings.push({
      id: row.id, ...buildRunFinding({ run: run as VerifiableRun, usageRows: candidates }),
      linkFieldPresent: hasLink,
      candidateRows: candidates.length,
      candidateScope: hasLink ? 'filas enlazadas a esta ejecución, sin filtro de mes' : `contexto del usuario en ${monthWindowForRun(run as VerifiableRun).join(', ')}`,
    });
  }
  const budgets = await db.assistantBudget.findMany({ where: { month: { in: [...months] } }, select: { scope: true, month: true, limitUsd: true, reservedUsd: true, spentUsd: true, blocked: true }, orderBy: [{ month: 'asc' }, { scope: 'asc' }] });
  return {
    reportPath, expectedModel: 'claude-haiku-4-5-20251001',
    linkFieldPresent: hasLink,
    linkFieldNote: hasLink
      ? 'AssistantUsage.runId está disponible: el consumo se acredita por ejecución.'
      : 'AssistantUsage.runId no está en el cliente Prisma generado. Aplicá la migración y corré `prisma generate`; sin eso el consumo por ejecución no se acredita.',
    monthsInspected: [...months],
    serverLimits: { globalUsd: GLOBAL_BUDGET_USD, defaultTenantUsd: DEFAULT_TENANT_BUDGET_USD, maximumApprovedTenantUsd: MAX_APPROVED_TENANT_BUDGET_USD },
    monthlyTotals: { scope: 'mes_completo_no_por_ejecucion', rows: budgets.map(row => ({ scope: row.scope, month: row.month, limitUsd: row.limitUsd.toString(), reservedUsd: row.reservedUsd.toString(), spentUsd: row.spentUsd.toString(), blocked: row.blocked })) },
    findings, humanReview: 'pending',
    disclaimer: 'Los totales son del mes completo, no de una ejecución. La reserva máxima es un techo, no un gasto. Sin enlace explícito el consumo por ejecución no se acredita.',
  };
}

async function main() {
  validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
  const at = process.argv.indexOf('--report');
  const reportPath = at < 0 ? undefined : process.argv[at + 1];
  if (!reportPath) throw new Error('Indicá --report con el informe del lote.');
  const output = await verifyEvaluationReport(reportPath);
  console.log(JSON.stringify(output, null, 2));
  const unanswered = output.findings.filter(item => item.verdict !== CLASS_MODEL_ANSWERED);
  const paidButIncomplete = output.findings.filter(item => item.verdict === CLASS_INCOMPLETE_WITH_CALLS);
  if (paidButIncomplete.length) console.error(`AVISO: ${paidButIncomplete.length} ejecución(es) quedaron incompletas DESPUÉS de llamar al proveedor. El consumo se verifica por separado; puede quedar incompleto.`);
  const unattributed = output.findings.filter(item => item.costAttribution !== COST_ATTRIBUTED);
  if (unattributed.length) console.error(`AVISO: ${unattributed.length} ejecución(es) con ${COST_NOT_ATTRIBUTED} o incompleto. No informar un gasto por consulta a partir de estos datos.`);
  if (unanswered.length) process.exitCode = 1;
  if (process.argv.includes('--require-cost-attribution') && unattributed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`No se pudo verificar: ${error instanceof Error ? error.message : 'error desconocido'}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
