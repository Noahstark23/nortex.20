import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { AssistantPrincipal } from '../../../shared/assistant.js';
import prisma from '../../lib/prisma.js';
import { AssistantAccessError } from './access.js';
import { effectiveAssistantBudget } from './budgetPolicy.js';
import { KNOWLEDGE_CONTROL_ID } from './knowledge/model.js';
import { readAssistantWorkerHeartbeat } from './operations/workerHeartbeat.js';

export const PILOT_MANIFEST_HASH = 'debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c';
const PILOT_RELEASE_ID = 'nortexgpt-primer-corte-20260923';
const MAX_FIRST_CUT_TENANTS = 2;
/** Dos identidades exactas configuradas en el entorno; sin esta lista el panel falla cerrado. */
function allowedTarget(tenantId: string, userId: string) {
  const entries = (process.env.NORTEX_PILOT_TARGETS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (entries.length !== MAX_FIRST_CUT_TENANTS || new Set(entries).size !== MAX_FIRST_CUT_TENANTS
    || entries.some(value => !/^[a-zA-Z0-9_-]{1,191}\/[a-zA-Z0-9_-]{1,191}$/.test(value)))
    fail('PILOT_TARGETS_NOT_CONFIGURED', 'Las dos identidades del piloto no están configuradas.');
  return entries.includes(`${tenantId}/${userId}`);
}
const emailSchema = z.string().trim().toLowerCase().email().max(191);
const identitySchema = z.object({
  email: emailSchema,
  tenantId: z.string().min(1).max(191),
  userId: z.string().min(1).max(191),
  expectedRole: z.literal('ADMIN'),
  manifestHash: z.literal(PILOT_MANIFEST_HASH),
  reason: z.string().trim().min(10).max(500),
  acknowledged: z.literal(true),
}).strict();
type PilotIdentity = z.infer<typeof identitySchema>;
type Database = PrismaClient;
const fail = (code: string, message: string, status = 409): never => {
  throw new AssistantAccessError(status, code, message);
};

async function authorize(principal: AssistantPrincipal, tx: Pick<Prisma.TransactionClient, 'user'>) {
  if (!principal.userId || !principal.tenantId || principal.role !== 'SUPER_ADMIN')
    fail('PILOT_REVIEWER_FORBIDDEN', 'Se requiere una sesión administradora activa.', 403);
  const actor = await tx.user.findFirst({ where: {
    id: principal.userId, tenantId: principal.tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE',
  }, select: { id: true } });
  if (!actor) fail('PILOT_REVIEWER_FORBIDDEN', 'Se requiere una sesión administradora activa.', 403);
  return actor;
}

async function releaseReady(tx: Pick<Prisma.TransactionClient, 'assistantKnowledgeControl' | 'assistantKnowledgeRelease'>) {
  const control = await tx.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID } });
  const release = control?.activeReleaseId === PILOT_RELEASE_ID
    ? await tx.assistantKnowledgeRelease.findUnique({ where: { id: PILOT_RELEASE_ID } }) : null;
  return Boolean(release?.status === 'PUBLISHED' && release.manifestHash === PILOT_MANIFEST_HASH
    && release.reviewedById && release.reviewedAt && release.publishedAt);
}

export async function inspectPilotAccount(principal: AssistantPrincipal, input: unknown, db: Database = prisma) {
  const email = emailSchema.parse(input);
  await authorize(principal, db);
  const user = await db.user.findUnique({ where: { email }, select: {
    id: true, tenantId: true, email: true, role: true, status: true,
  } });
  if (!user || user.email?.toLowerCase() !== email) fail('PILOT_IDENTITY_NOT_FOUND', 'No encontramos esa cuenta.', 404);
  if (!allowedTarget(user.tenantId, user.id)) fail('PILOT_TARGET_NOT_ALLOWED', 'Esta cuenta no pertenece al primer piloto.', 403);
  const [tenant, config, helpReleaseReady] = await Promise.all([
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { id: true, businessName: true } }),
    db.assistantTenantConfig.findUnique({ where: { tenantId: user.tenantId } }),
    releaseReady(db),
  ]);
  await authorize(principal, db);
  if (!tenant) fail('PILOT_TENANT_NOT_FOUND', 'No encontramos el negocio.', 404);
  return { email: user.email, userId: user.id, tenantId: tenant.id, businessName: tenant.businessName,
    role: user.role, userStatus: user.status, eligible: user.role === 'ADMIN' && user.status === 'ACTIVE'
      && principal.userId !== user.id && principal.tenantId !== tenant.id,
    helpReleaseReady, manifestHash: PILOT_MANIFEST_HASH, config: config && {
      enabled: config.enabled, effectiveBudgetUsd: new Decimal(effectiveAssistantBudget(config)).toString(),
      extractionEnabled: config.extractionEnabled, executionEnabled: config.executionEnabled,
      operationsEnabled: config.operationsEnabled, actionsEnabled: config.actionsEnabled,
      promotionsEnabled: config.promotionsEnabled, privateWhatsappEnabled: config.privateWhatsappEnabled,
    } };
}

const guardedFlags = ['extractionEnabled', 'executionEnabled', 'operationsEnabled',
  'actionsEnabled', 'promotionsEnabled', 'privateWhatsappEnabled'] as const;
const firstCut = { enabled: true, extractionEnabled: false, executionEnabled: false,
  operationsEnabled: false, actionsEnabled: false, promotionsEnabled: false,
  privateWhatsappEnabled: false, monthlyBudgetUsd: '2', approvedMonthlyBudgetUsd: '2' } as const;

export async function changePilotAccount(principal: AssistantPrincipal, mode: 'enable' | 'disable', input: unknown, db: Database = prisma) {
  const target: PilotIdentity = identitySchema.parse(input);
  if (!allowedTarget(target.tenantId, target.userId)) fail('PILOT_TARGET_NOT_ALLOWED', 'Esta cuenta no pertenece al primer piloto.', 403);
  await authorize(principal, db);
  if (principal.tenantId === target.tenantId || principal.userId === target.userId)
    fail('PILOT_SELF_APPROVAL_FORBIDDEN', 'La revisión requiere otra cuenta administradora.', 403);
  if (mode === 'enable') {
    if (process.env.NORTEX_ASSISTANT_ENABLED !== 'true' || process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED !== 'true'
      || !process.env.ANTHROPIC_API_KEY)
      fail('PILOT_RUNTIME_NOT_READY', 'El servicio conversacional todavía no está listo.');
    if (['NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED',
      'NORTEX_ASSISTANT_OPERATIONS_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED',
      'NORTEX_PROMOTIONS_ENABLED', 'NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED']
      .some(name => process.env[name] === 'true'))
      fail('PILOT_GLOBAL_CAPABILITIES', 'Hay capacidades globales fuera del primer piloto.');
    const heartbeat = await readAssistantWorkerHeartbeat();
    if (heartbeat.status !== 'ok') fail('PILOT_WORKER_NOT_READY', 'El worker no tiene un latido vigente del mismo SHA.');
  }
  return db.$transaction(async tx => {
    const identities = [{ id: principal.userId, tenantId: principal.tenantId },
      { id: target.userId, tenantId: target.tenantId }].sort((a, b) => a.id.localeCompare(b.id));
    for (const identity of identities) await tx.$queryRaw(Prisma.sql`
      SELECT id FROM User WHERE id = ${identity.id} AND tenantId = ${identity.tenantId} FOR UPDATE`);
    const actor = await authorize(principal, tx);
    const user = await tx.user.findFirst({ where: { id: target.userId, tenantId: target.tenantId,
      email: target.email }, select: { id: true, role: true, status: true } });
    if (!user || user.role !== target.expectedRole || (mode === 'enable' && user.status !== 'ACTIVE'))
      fail('PILOT_IDENTITY_CHANGED', 'La identidad del negocio cambió; volvé a revisarla.');
    const tenant = await tx.tenant.findUnique({ where: { id: target.tenantId }, select: { id: true } });
    if (!tenant) fail('PILOT_TENANT_NOT_FOUND', 'No encontramos el negocio.', 404);
    if (mode === 'enable') {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantKnowledgeControl WHERE id = ${KNOWLEDGE_CONTROL_ID} FOR UPDATE`);
      if (!await releaseReady(tx)) fail('PILOT_HELP_RELEASE_REQUIRED', 'La ayuda aprobada ya no está publicada.');
    }
    await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM AssistantTenantConfig WHERE tenantId = ${target.tenantId} FOR UPDATE`);
    const before = await tx.assistantTenantConfig.findUnique({ where: { tenantId: target.tenantId } });
    if (mode === 'enable') {
      if (before && guardedFlags.some(flag => before[flag])) fail('PILOT_EXISTING_CAPABILITIES', 'El negocio ya tiene capacidades adicionales.');
      if (before?.enabled && new Decimal(before.monthlyBudgetUsd).eq(2)
        && new Decimal(before.approvedMonthlyBudgetUsd).eq(2)) return { changed: false, enabled: true, budgetUsd: '2' };
      if (before?.enabled) fail('PILOT_ALREADY_ENABLED_DIFFERENTLY', 'El negocio ya tiene otra configuración.');
      if (await tx.assistantTenantConfig.count({ where: { enabled: true } }) >= MAX_FIRST_CUT_TENANTS)
        fail('PILOT_CAPACITY_REACHED', 'El primer piloto ya tiene dos negocios activos.');
      await tx.assistantTenantConfig.upsert({ where: { tenantId: target.tenantId },
        create: { tenantId: target.tenantId, ...firstCut }, update: firstCut });
    } else {
      if (!before?.enabled) return { changed: false, enabled: false, budgetUsd: before ? effectiveAssistantBudget(before) : null };
      await tx.assistantTenantConfig.update({ where: { tenantId: target.tenantId }, data: { enabled: false } });
    }
    await tx.auditLog.create({ data: { tenantId: target.tenantId, userId: actor.id,
      action: mode === 'enable' ? 'ASSISTANT_PILOT_ENABLED' : 'ASSISTANT_PILOT_DISABLED',
      details: JSON.stringify({ targetUserId: target.userId, manifestHash: PILOT_MANIFEST_HASH,
        before: before && { enabled: before.enabled, budgetUsd: effectiveAssistantBudget(before) },
        after: { enabled: mode === 'enable', budgetUsd: mode === 'enable' ? '2' : before && effectiveAssistantBudget(before) },
        reason: target.reason }),
    } });
    return { changed: true, enabled: mode === 'enable', budgetUsd: mode === 'enable' ? '2' : before && effectiveAssistantBudget(before) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
