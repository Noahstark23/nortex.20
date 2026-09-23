import { Prisma, type AssistantBudgetRequest } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../shared/assistant.js';
import { AssistantAccessError } from './access.js';
import { AssistantDocumentError } from './attachments.js';
import { budgetMonth, GLOBAL_BUDGET_USD, MAX_EXTRACTION_RESERVATION_USD } from './budget.js';
import { effectiveAssistantBudget, MAX_APPROVED_TENANT_BUDGET_USD } from './budgetPolicy.js';
import { canManageAssistantBudget } from './budgetAuthority.js';

const reason = z.string().trim().min(10).max(500);
const requestInput = z.object({
  idempotencyKey: z.string().uuid(),
  requestedUsd: z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/),
  reason,
}).strict();
const decisionInput = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason }).strict();
type Dependencies = { db?: typeof prisma; now?: () => Date };
type Reader = Pick<Prisma.TransactionClient, 'user'>;
const fail = (code: string, message: string, status = 409): never => { throw new AssistantDocumentError(code, message, status); };

async function authorize(principal: AssistantPrincipal, role: 'OWNER' | 'SUPER_ADMIN', db: Reader) {
  if (role === 'OWNER' && await canManageAssistantBudget(principal, db)) return;
  const user = await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, role, status: 'ACTIVE' }, select: { id: true } });
  if (!user || principal.role !== role) throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu sesión no tiene permiso para gestionar este presupuesto.');
}

async function lockActor(tx: Prisma.TransactionClient, principal: AssistantPrincipal, role: 'OWNER' | 'SUPER_ADMIN') {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`);
  await authorize(principal, role, tx);
}

async function lockConfig(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM AssistantTenantConfig WHERE tenantId = ${tenantId} FOR UPDATE`);
  const config = await tx.assistantTenantConfig.findUnique({ where: { tenantId } });
  if (!config) fail('BUDGET_NOT_CONFIGURED', 'NortexGPT todavía no tiene presupuesto configurado para este negocio.', 404);
  return config;
}

function view(row: AssistantBudgetRequest) {
  return { id: row.id, requestedUsd: row.requestedUsd.toFixed(2), reason: row.reason, status: row.status,
    createdAt: row.createdAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason };
}

export async function getAssistantBudget(principal: AssistantPrincipal, deps: Dependencies = {}) {
  const db = deps.db ?? prisma, month = budgetMonth(deps.now?.() ?? new Date());
  return db.$transaction(async tx => {
    await authorize(principal, 'OWNER', tx);
    const config = await tx.assistantTenantConfig.findUnique({ where: { tenantId: principal.tenantId } });
    const limitUsd = effectiveAssistantBudget(config);
    const bucket = await tx.assistantBudget.findUnique({ where: { id: `tenant:${principal.tenantId}:${month}` } });
    const global = await tx.assistantBudget.findUnique({ where: { id: `global:${month}` } });
    const requests = await tx.assistantBudgetRequest.findMany({ where: { tenantId: principal.tenantId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const pending = await tx.assistantBudgetRequest.count({ where: { tenantId: principal.tenantId, status: 'PENDING' } });
    const spentUsd = bucket?.spentUsd.toFixed(6) ?? '0.000000', reservedUsd = bucket?.reservedUsd.toFixed(6) ?? '0.000000';
    const remainingUsd = Decimal.max(0, new Decimal(limitUsd).sub(spentUsd).sub(reservedUsd)).toFixed(6);
    // Exponer la causa, nunca saldos/consumo de otros negocios. Cada llamada vuelve a reservar.
    const platformAvailable = !global?.blocked && new Decimal(GLOBAL_BUDGET_USD)
      .sub(global?.spentUsd.toString() ?? '0').sub(global?.reservedUsd.toString() ?? '0').gte(MAX_EXTRACTION_RESERVATION_USD);
    const availabilityReason = !config?.enabled ? 'NOT_ENABLED' : !platformAvailable ? 'PLATFORM_LIMIT'
      : bucket?.blocked ? 'REVIEW_REQUIRED' : new Decimal(remainingUsd).lt(MAX_EXTRACTION_RESERVATION_USD) ? 'TENANT_LIMIT' : null;
    await authorize(principal, 'OWNER', tx);
    return { month, limitUsd, spentUsd, reservedUsd, remainingUsd, blocked: bucket?.blocked ?? false,
      platformAvailable, availabilityReason,
      canRequest: !!config?.enabled && pending === 0 && new Decimal(limitUsd).lt(MAX_APPROVED_TENANT_BUDGET_USD),
      maxLimitUsd: MAX_APPROVED_TENANT_BUDGET_USD, requests: requests.map(view) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function requestAssistantBudget(principal: AssistantPrincipal, input: unknown, deps: Dependencies = {}) {
  const parsed = requestInput.parse(input), amount = new Decimal(parsed.requestedUsd), db = deps.db ?? prisma;
  if (amount.lte(2) || amount.gt(MAX_APPROVED_TENANT_BUDGET_USD)) fail('BUDGET_AMOUNT', 'Solicitá un límite mensual mayor a US$2 y de hasta US$10.', 400);
  return db.$transaction(async tx => {
    await lockActor(tx, principal, 'OWNER');
    const config = await lockConfig(tx, principal.tenantId);
    const existing = await tx.assistantBudgetRequest.findUnique({ where: { tenantId_requestKey: { tenantId: principal.tenantId, requestKey: parsed.idempotencyKey } } });
    if (existing) {
      if (existing.requestedBy !== principal.userId || !existing.requestedUsd.equals(amount.toString()) || existing.reason !== parsed.reason) fail('BUDGET_REPLAY_CONFLICT', 'La referencia ya corresponde a otra solicitud.');
      return view(existing);
    }
    if (!config.enabled) fail('BUDGET_DISABLED', 'NortexGPT está desactivado para este negocio.', 403);
    if (amount.lte(effectiveAssistantBudget(config))) fail('BUDGET_NOT_INCREASE', 'El monto debe superar tu límite actual.', 400);
    const pending = await tx.assistantBudgetRequest.findFirst({ where: { tenantId: principal.tenantId, status: 'PENDING' }, select: { id: true } });
    if (pending) fail('BUDGET_REQUEST_PENDING', 'Ya hay una solicitud pendiente de revisión por Nortex.');
    const row = await tx.assistantBudgetRequest.create({ data: { tenantId: principal.tenantId, requestedBy: principal.userId, requestKey: parsed.idempotencyKey, requestedUsd: amount.toFixed(2), reason: parsed.reason } });
    await tx.auditLog.create({ data: { tenantId: principal.tenantId, userId: principal.userId, action: 'ASSISTANT_BUDGET_REQUESTED', details: JSON.stringify({ requestId: row.id, before: { limitUsd: effectiveAssistantBudget(config) }, after: { requestedUsd: amount.toFixed(2), status: 'PENDING' } }) } });
    return view(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function listAssistantBudgetRequests(principal: AssistantPrincipal, input: unknown, deps: Dependencies = {}) {
  const query = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'), cursor: z.string().min(1).max(191).optional() }).strict().parse(input);
  const db = deps.db ?? prisma;
  await authorize(principal, 'SUPER_ADMIN', db);
  const rows = await db.assistantBudgetRequest.findMany({ where: { status: query.status }, include: { tenant: { select: { businessName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  await authorize(principal, 'SUPER_ADMIN', db);
  return { requests: rows.slice(0, 50).map(row => ({ ...view(row), tenantId: row.tenantId, businessName: row.tenant.businessName })), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function decideAssistantBudget(principal: AssistantPrincipal, id: string, input: unknown, deps: Dependencies = {}) {
  const parsed = decisionInput.parse(input), db = deps.db ?? prisma;
  return db.$transaction(async tx => {
    await lockActor(tx, principal, 'SUPER_ADMIN');
    // Identificador global únicamente dentro de la operación administrativa autorizada.
    const first = await tx.assistantBudgetRequest.findUnique({ where: { id } });
    if (!first) fail('BUDGET_REQUEST_NOT_FOUND', 'No encontramos esa solicitud.', 404);
    if (first.requestedBy === principal.userId || first.tenantId === principal.tenantId) fail('BUDGET_SELF_APPROVAL', 'La solicitud requiere revisión desde la cuenta de Nortex.', 403);
    const config = await lockConfig(tx, first.tenantId);
    const row = await tx.assistantBudgetRequest.findUniqueOrThrow({ where: { id } });
    if (row.status !== 'PENDING') {
      if (row.status !== parsed.decision || row.decisionReason !== parsed.reason) fail('BUDGET_DECIDED', 'La solicitud ya fue resuelta con otra decisión.');
      return view(row);
    }
    const before = effectiveAssistantBudget(config);
    if (parsed.decision === 'APPROVED') {
      if (!config.enabled || row.requestedUsd.lte(before) || row.requestedUsd.gt(MAX_APPROVED_TENANT_BUDGET_USD)) fail('BUDGET_REVIEW_STALE', 'Las condiciones cambiaron. Rechazá esta solicitud y pedí una revisión nueva.');
      await tx.assistantTenantConfig.update({ where: { tenantId: row.tenantId }, data: { monthlyBudgetUsd: row.requestedUsd, approvedMonthlyBudgetUsd: row.requestedUsd } });
    }
    const updated = await tx.assistantBudgetRequest.update({ where: { id }, data: { status: parsed.decision, decidedBy: principal.userId, decidedAt: deps.now?.() ?? new Date(), decisionReason: parsed.reason } });
    await tx.auditLog.create({ data: { tenantId: row.tenantId, userId: principal.userId, action: 'ASSISTANT_BUDGET_DECIDED', details: JSON.stringify({ requestId: id, before: { limitUsd: before, status: 'PENDING' }, after: { limitUsd: parsed.decision === 'APPROVED' ? row.requestedUsd.toFixed(6) : before, status: parsed.decision }, reason: parsed.reason }) } });
    return view(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
