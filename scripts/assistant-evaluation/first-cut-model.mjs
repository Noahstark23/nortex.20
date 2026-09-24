/** Una consulta pagada del chat web inicial; nunca reenvía al recuperar. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Decimal from 'decimal.js';
import prisma from '../../backend/lib/prisma.js';
import { assistantMessageUsageKey } from '../../backend/services/assistant/language.js';
import { MAX_EXTRACTION_RESERVATION_USD, USAGE_SUPPORTS_RUN_LINK } from '../../backend/services/assistant/budget.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';
import { withEvaluationReport } from './evaluation-report.mjs';

export const FIRST_CUT_MANIFEST_HASH = 'debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c';
const digest = value => createHash('sha256').update(value).digest('hex');
const value = (args, key) => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
const qaTenant = id => /^operativo-demo-20260905-(ferreteria|farmacia)$/.test(id ?? '');

export function validateFirstCutReview(review) {
  if (!review || review.synthetic !== true || review.expectedOutcomesReviewed !== true
    || typeof review.reviewer !== 'string' || !review.reviewer.trim()
    || !Number.isFinite(Date.parse(review.reviewedAt))
    || !qaTenant(review.tenantId) || review.role !== 'OWNER'
    || review.manifestHash !== FIRST_CUT_MANIFEST_HASH
    || typeof review.question !== 'string' || !review.question.trim() || review.question.length > 4000
    || review.questionSha256 !== digest(review.question)
    || review.expectedCitationId !== 'reposicion'
    || review.expectedCitationVersion !== '2026-09-23.web3'
    || review.expectedCitationHash !== 'ffdec72beef292a69ca8da89887e5841b15b634ac062c361bbe707773cdd71ee'
    || review.expectedMode !== 'help_without_operations')
    throw new Error('Falta revisión humana de la pregunta, resultado esperado o hash editorial exacto del primer corte.');
  return review;
}

// Captura acotada del negocio sintético. Las filas y saldos se comparan, no sólo
// los conteos: una escritura sobre un documento existente también invalida el ensayo.
const BUSINESS_STATE = {
  assistantProposal: ['id', 'status', 'version', 'updatedAt'],
  assistantActionProposal: ['id', 'status', 'version', 'updatedAt'],
  assistantActionCommand: ['id', 'createdAt'],
  purchaseOrderDraftCommand: ['id', 'createdAt'],
  purchaseCommand: ['id', 'createdAt'],
  purchaseOrder: ['id', 'status', 'updatedAt'],
  purchase: ['id', 'status', 'total', 'balanceDue', 'paidAt'],
  goodsReceipt: ['id', 'status', 'createdAt'],
  supplierReturn: ['id', 'status', 'createdAt'],
  productReturn: ['id', 'total', 'createdAt'],
  stockTransfer: ['id', 'createdAt'],
  kardexMovement: ['id', 'date'],
  productBatchLedgerEntry: ['id', 'quantityDelta', 'stockAfter'],
  product: ['id', 'stock'],
  productStock: ['id', 'stock'],
  productBatch: ['id', 'stock'],
  productBatchWarehouseStock: ['id', 'stock', 'heldStock'],
  journalEntry: ['id', 'createdAt'],
  sale: ['id', 'total', 'status'],
  cashMovement: ['id', 'amount', 'isVoided'],
  expense: ['id', 'amount'],
  account: ['id', 'balance'],
};

async function captureBusinessState(db, tenantId) {
  const state = {};
  for (const [model, fields] of Object.entries(BUSINESS_STATE)) {
    const rows = await db[model].findMany({ where: { tenantId },
      select: Object.fromEntries(fields.map(field => [field, true])),
      orderBy: { id: 'asc' }, take: 501 });
    if (rows.length > 500) throw new Error(`La muestra sintética supera 500 filas en ${model}.`);
    state[model] = rows.map(row => Object.fromEntries(fields.map(field => [field,
      row[field] instanceof Date ? row[field].toISOString() : row[field]?.toString() ?? null])));
  }
  const payments = await db.payment.findMany({ where: { sale: { tenantId } },
    select: { id: true, amount: true }, orderBy: { id: 'asc' }, take: 501 });
  if (payments.length > 500) throw new Error('La muestra sintética supera 500 pagos.');
  state.payment = payments.map(row => ({ id: row.id, amount: row.amount.toString() }));
  return state;
}

function businessStateChanges(before, after) {
  return Object.keys(before).filter(model => JSON.stringify(before[model]) !== JSON.stringify(after[model]));
}

function qaBase(raw) {
  const base = new URL(raw ?? 'invalid:');
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash)
    throw new Error('Usá exclusivamente la raíz del backend local de QA.');
  return base;
}

async function privateToken(tokenPath) {
  if (!tokenPath) throw new Error('Indicá el archivo privado de sesión QA.');
  const entry = await stat(tokenPath);
  if (!entry.isFile() || (entry.mode & 0o077) !== 0 || entry.size > 16_384)
    throw new Error('La sesión QA debe ser un archivo privado 0600 y acotado.');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('La sesión QA está vacía.');
  return token;
}

/** Sólo comprueba coincidencia; la firma y vigencia se verifican en cada GET del backend. */
function sessionClaims(token, review) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('shape');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.tenantId !== review.tenantId || claims.role !== review.role
      || typeof claims.userId !== 'string' || !claims.userId) throw new Error('identity');
    return { userId: claims.userId };
  } catch { throw new Error('La sesión QA no declara el negocio y rol sintéticos revisados.'); }
}

function apiRequest(base, token, transport) {
  return async (endpoint, body) => {
    if (!/^\/api\/assistant\/(?:capabilities|status|conversations|conversations\/[a-zA-Z0-9_-]+|conversations\/[a-zA-Z0-9_-]+\/messages)$/.test(endpoint))
      throw new Error('El ensayo no admite rutas de ejecución ni confirmación.');
    const response = await transport(new URL(endpoint, base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`La ruta de QA respondió HTTP ${response.status}.`);
    return response.json();
  };
}

async function preflight(db, api, review, claims) {
  const [caps, status, config, control, user] = await Promise.all([
    api('/api/assistant/capabilities'), api('/api/assistant/status'),
    db.assistantTenantConfig.findUnique({ where: { tenantId: review.tenantId } }),
    db.assistantKnowledgeControl.findUnique({ where: { id: 'official' } }),
    db.user.findFirst({ where: { id: claims.userId, tenantId: review.tenantId,
      role: review.role, status: 'ACTIVE' }, select: { id: true } }),
    // Falla antes del POST si la columna aún no existe en MySQL.
    db.assistantUsage.findFirst({ where: { runId: 'nortexgpt-preflight-no-match' }, select: { id: true } }),
  ]);
  if (!user) throw new Error('La sesión QA no corresponde a un dueño activo del negocio sintético.');
  if (!caps.enabled || !caps.help || caps.operations || !String(caps.accessScope).startsWith('OWNER:'))
    throw new Error('La sesión no tiene las capacidades exactas del dueño en el primer corte.');
  const flags = status.switches;
  if (!flags?.enabled || !flags.languageEnabled || flags.operationsEnabled || flags.actionsEnabled
    || flags.executionEnabled || flags.extractionEnabled || flags.promotionsEnabled || flags.privateWhatsappEnabled)
    throw new Error('Los flags efectivos del backend no corresponden al primer corte.');
  if (!config?.enabled || config.operationsEnabled || config.actionsEnabled || config.executionEnabled
    || config.extractionEnabled || config.promotionsEnabled || config.privateWhatsappEnabled
    || !new Decimal(config.monthlyBudgetUsd.toString()).eq(2)
    || !new Decimal(config.approvedMonthlyBudgetUsd.toString()).eq(2))
    throw new Error('El negocio sintético no tiene el límite US$2 y las capacidades del piloto.');
  const release = control?.activeReleaseId
    ? await db.assistantKnowledgeRelease.findUnique({ where: { id: control.activeReleaseId } }) : null;
  if (!release || release.status !== 'PUBLISHED' || release.manifestHash !== FIRST_CUT_MANIFEST_HASH
    || !release.reviewedById || !release.reviewedAt || !release.publishedAt)
    throw new Error('La ayuda sintética no está publicada con el hash exacto de este ensayo.');
}

async function observe(db, api, report, review, claims) {
  const conversation = await db.assistantConversation.findUnique({ where: { id: report.conversationId } });
  if (!conversation || conversation.tenantId !== review.tenantId || conversation.roleAtCreation !== review.role
    || conversation.userId !== claims.userId)
    throw new Error('La conversación no corresponde al negocio y rol sintéticos revisados.');
  const current = await api(`/api/assistant/conversations/${encodeURIComponent(conversation.id)}`);
  const stored = await db.assistantMessage.findMany({ where: {
    tenantId: review.tenantId, userId: conversation.userId, conversationId: conversation.id,
    requestId: report.requestId,
  } });
  const question = stored.find(row => row.role === 'user');
  if (question && question.content?.text !== review.question)
    throw new Error('El identificador durable corresponde a otra pregunta.');
  const answer = stored.find(row => row.role === 'assistant');
  const visible = answer && current.messages?.find(row => row.id === answer.id && row.role === 'assistant');
  const usage = await db.assistantUsage.findMany({ where: {
    tenantId: review.tenantId, userId: conversation.userId, runId: report.usageKey,
  }, orderBy: { createdAt: 'asc' } });
  const operationalRuns = await db.assistantRun.count({ where: {
    tenantId: review.tenantId, conversationId: conversation.id,
  } });
  const spent = usage.filter(row => row.status === 'SETTLED' && row.actualUsd !== null)
    .reduce((sum, row) => sum.add(row.actualUsd.toString()), new Decimal(0));
  const citation = visible?.citations?.find(row => row.id === review.expectedCitationId
    && row.version === review.expectedCitationVersion && row.contentHash === review.expectedCitationHash);
  return {
    response: visible ? { id: visible.id, text: visible.text, citations: visible.citations ?? [],
      knowledgeUnavailable: visible.knowledgeUnavailable ?? false, operationalRunId: visible.operationalRunId ?? null } : null,
    expectedCitationPresent: Boolean(citation),
    operationalRuns,
    usage: usage.map(row => ({ id: row.id, status: row.status, reservedUsd: row.reservedUsd.toString(),
      actualUsd: row.actualUsd?.toString() ?? null, providerRequestIdPresent: Boolean(row.providerRequestId) })),
    settledUsdForMessage: spent.toFixed(6),
    modelPlanApplied: null,
    modelContactCredited: usage.length === 1 && usage[0].status === 'SETTLED'
      && usage[0].actualUsd !== null && new Decimal(usage[0].actualUsd.toString()).gt(0)
      && Boolean(usage[0].providerRequestId),
  };
}

export async function runFirstCutModelEvaluation(args = process.argv.slice(2), deps = {}) {
  const output = path.resolve(value(args, '--report') ?? 'reports/assistant-evaluation/first-cut-model-report.json');
  const initial = { version: 2, status: 'not_run', paidCalls: 0, humanReview: 'pending',
    manifestHash: FIRST_CUT_MANIFEST_HASH, maximumReservationUsd: MAX_EXTRACTION_RESERVATION_USD };
  const resume = args.includes('--resume');
  if (!args.includes('--allow-paid-model')) {
    if (resume) throw new Error('La recuperación exige --allow-paid-model y conserva sólo lecturas.');
    return withEvaluationReport(output, false, async (_existing, save) => { await save(initial); return initial; });
  }
  if (!args.includes('--synthetic-tenant')) throw new Error('Sólo se admite un negocio sintético local.');
  validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
  if (!USAGE_SUPPORTS_RUN_LINK) throw new Error('El cliente Prisma no conoce AssistantUsage.runId; regeneralo antes de una llamada pagada.');
  const base = qaBase(value(args, '--base-url'));
  const reviewPath = value(args, '--review-file');
  if (!reviewPath) throw new Error('Indicá un formulario de revisión humana del primer corte.');
  const review = validateFirstCutReview(JSON.parse(await readFile(reviewPath, 'utf8')));
  const max = new Decimal(value(args, '--max-reserved-usd') ?? '2');
  if (!max.isFinite() || max.lte(0) || max.gt(2) || new Decimal(MAX_EXTRACTION_RESERVATION_USD).gt(max))
    throw new Error('El tope solicitado no admite la reserva conservadora de una consulta.');
  const token = await privateToken(value(args, '--session-token-file'));
  const claims = sessionClaims(token, review);
  const db = deps.db ?? prisma, api = apiRequest(base, token, deps.fetch ?? fetch);
  const binding = digest(JSON.stringify({ base: base.href, token: digest(token), review,
    max: max.toFixed(6), reservation: MAX_EXTRACTION_RESERVATION_USD }));
  return withEvaluationReport(output, resume, async (existing, save) => {
    if (existing && (existing.version !== 2 || existing.binding !== binding || !existing.businessStateBefore
      || !existing.conversationId || !existing.requestId
      || existing.usageKey !== assistantMessageUsageKey(existing.conversationId, existing.requestId)))
      throw new Error('Cambió la identidad del ensayo; no se puede reanudar.');
    await preflight(db, api, review, claims);
    const report = existing ?? { ...initial, binding, review: { reviewer: review.reviewer, reviewedAt: review.reviewedAt,
      tenantId: review.tenantId, questionSha256: review.questionSha256 }, paidCalls: null };
    if (!resume) {
      report.businessStateBefore = await captureBusinessState(db, review.tenantId);
      const conversation = await api('/api/assistant/conversations', {});
      if (!/^[a-zA-Z0-9_-]+$/.test(conversation.id ?? '')) throw new Error('Identidad de conversación no válida.');
      report.conversationId = conversation.id;
      report.requestId = randomUUID();
      report.usageKey = assistantMessageUsageKey(conversation.id, report.requestId);
      report.status = 'submission_uncertain';
      await save(report); // Identidad durable antes de un único POST pagado.
      try {
        await api(`/api/assistant/conversations/${encodeURIComponent(conversation.id)}/messages`,
          { requestId: report.requestId, text: review.question });
      } catch {
        // Una respuesta HTTP perdida nunca autoriza repetir el POST.
        report.error = 'Respuesta incierta; recuperá con --resume mediante lecturas.';
      }
    }
    const observed = await observe(db, api, report, review, claims);
    const businessStateAfter = await captureBusinessState(db, review.tenantId);
    report.businessStateComparison = { before: report.businessStateBefore, after: businessStateAfter,
      changedModels: businessStateChanges(report.businessStateBefore, businessStateAfter) };
    Object.assign(report, observed);
    report.status = observed.response && observed.expectedCitationPresent && observed.modelContactCredited
      && observed.operationalRuns === 0 && report.businessStateComparison.changedModels.length === 0
      && !observed.response.knowledgeUnavailable && !observed.response.operationalRunId
      ? 'executed_pending_human_review' : 'incomplete';
    if (report.status === 'executed_pending_human_review') delete report.error;
    if (resume) report.lastRecoveryAt = new Date().toISOString();
    await save(report);
    return report;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runFirstCutModelEvaluation().then(report => {
    console.log(`Primer corte: ${report.status}; consumo vinculado: ${report.modelContactCredited === true}; revisión humana pendiente.`);
    if (report.status === 'incomplete') process.exitCode = 1;
  }).catch(error => { console.error(error instanceof Error ? error.message : 'Ensayo no disponible.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
