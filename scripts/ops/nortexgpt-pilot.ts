/** Activación puntual del primer corte. Nunca infiere un tenant desde el correo. */
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../backend/lib/prisma.js';
import { ASSISTANT_KNOWN_ROLES } from '../../backend/services/assistant/access.js';
import { effectiveAssistantBudget } from '../../backend/services/assistant/budgetPolicy.js';
import { KNOWLEDGE_CONTROL_ID } from '../../backend/services/assistant/knowledge/model.js';

type Mode = 'inspect' | 'enable' | 'disable';
const mode = process.argv[2] as Mode;
if (!['inspect', 'enable', 'disable'].includes(mode) || process.argv.length !== 3)
  throw new Error('Uso: nortexgpt-pilot.ts inspect|enable|disable (identidad por variables de entorno).');

const email = process.env.NORTEX_PILOT_EMAIL?.trim().toLowerCase();
if (!email || email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('NORTEX_PILOT_EMAIL inválido.');

const firstCut = {
  enabled: true, extractionEnabled: false, executionEnabled: false,
  operationsEnabled: false, actionsEnabled: false, promotionsEnabled: false,
  privateWhatsappEnabled: false, monthlyBudgetUsd: '2', approvedMonthlyBudgetUsd: '2',
} as const;
const guardedFlags = ['extractionEnabled', 'executionEnabled', 'operationsEnabled',
  'actionsEnabled', 'promotionsEnabled', 'privateWhatsappEnabled'] as const;
// El primer piloto no debe abrir el corpus LEGACY ni una edición distinta.
const firstCutHelp = {
  releaseId: 'nortexgpt-primer-corte-20260923',
  manifestHash: '3d18a116746db968c3e808daf406c1edb70350f706e8111752f80673907f1126',
} as const;
const budgetOf = (config: NonNullable<Awaited<ReturnType<typeof prisma.assistantTenantConfig.findUnique>>>) =>
  new Decimal(effectiveAssistantBudget(config)).toString();

async function inspect() {
  const user = await prisma.user.findUnique({ where: { email }, select: {
    id: true, tenantId: true, email: true, role: true, status: true,
  } });
  if (!user || user.email?.toLowerCase() !== email) throw new Error('PILOT_IDENTITY_NOT_FOUND');
  const [tenant, config, helpControl] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { id: true, businessName: true, type: true } }),
    prisma.assistantTenantConfig.findUnique({ where: { tenantId: user.tenantId } }),
    prisma.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID } }),
  ]);
  if (!tenant) throw new Error('PILOT_TENANT_NOT_FOUND');
  const helpRelease = helpControl?.activeReleaseId === firstCutHelp.releaseId
    ? await prisma.assistantKnowledgeRelease.findUnique({ where: { id: firstCutHelp.releaseId } }) : null;
  return { userId: user.id, tenantId: tenant.id, businessName: tenant.businessName,
    vertical: tenant.type, role: user.role, userStatus: user.status,
    roleEligible: ASSISTANT_KNOWN_ROLES.includes(user.role),
    helpReleaseReady: Boolean(helpRelease?.status === 'PUBLISHED'
      && helpRelease.manifestHash === firstCutHelp.manifestHash
      && helpRelease.reviewedById && helpRelease.reviewedAt && helpRelease.publishedAt),
    config: config && { enabled: config.enabled,
      effectiveBudgetUsd: budgetOf(config),
      extractionEnabled: config.extractionEnabled, executionEnabled: config.executionEnabled,
      operationsEnabled: config.operationsEnabled, actionsEnabled: config.actionsEnabled,
      promotionsEnabled: config.promotionsEnabled, privateWhatsappEnabled: config.privateWhatsappEnabled },
  };
}

async function change() {
  const targetTenantId = process.env.NORTEX_PILOT_TENANT_ID;
  const targetUserId = process.env.NORTEX_PILOT_USER_ID;
  const expectedRole = process.env.NORTEX_PILOT_EXPECTED_ROLE;
  const reason = process.env.NORTEX_PILOT_REASON?.trim();
  if (![targetTenantId, targetUserId, expectedRole].every(v => v && v.length <= 191)
    || !reason || reason.length < 10 || reason.length > 500)
    throw new Error('PILOT_CHANGE_INPUT_REQUIRED');
  if (process.env.NORTEX_PILOT_CHANGE_ACK !== 'explicit-pilot-change'
    || process.env.NORTEX_PILOT_CONFIRM !== `${mode}:${targetTenantId}:${targetUserId}:${expectedRole}:USD2`)
    throw new Error('PILOT_CHANGE_NOT_CONFIRMED');
  if (mode === 'enable' && process.env.NORTEX_PILOT_REVIEW_ACK !== 'content-and-expected-reviewed')
    throw new Error('PILOT_CONTENT_REVIEW_REQUIRED');
  const token = process.env.NORTEX_PILOT_ADMIN_JWT;
  if (!token) throw new Error('PILOT_REVIEWER_SESSION_REQUIRED');
  const { verifyAuthToken } = await import('../../backend/services/secrets.js');
  const reviewer = verifyAuthToken(token);
  if (reviewer.role !== 'SUPER_ADMIN' || !reviewer.userId || !reviewer.tenantId)
    throw new Error('PILOT_REVIEWER_FORBIDDEN');
  if (reviewer.tenantId === targetTenantId || reviewer.userId === targetUserId)
    throw new Error('PILOT_SELF_APPROVAL_FORBIDDEN');

  return prisma.$transaction(async tx => {
    const identities = [
      { id: reviewer.userId, tenantId: reviewer.tenantId },
      { id: targetUserId!, tenantId: targetTenantId! },
    ].sort((a, b) => a.id.localeCompare(b.id));
    for (const identity of identities) await tx.$queryRaw(Prisma.sql`
      SELECT id FROM User WHERE id = ${identity.id} AND tenantId = ${identity.tenantId} FOR UPDATE`);
    const actor = await tx.user.findFirst({ where: {
      id: reviewer.userId, tenantId: reviewer.tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE',
    }, select: { id: true } });
    const target = await tx.user.findFirst({ where: {
      id: targetUserId, tenantId: targetTenantId, email,
    }, select: { id: true, role: true, status: true } });
    if (!actor || !target || target.role !== expectedRole ||
      (mode === 'enable' && (target.status !== 'ACTIVE' || !ASSISTANT_KNOWN_ROLES.includes(target.role))))
      throw new Error('PILOT_IDENTITY_CHANGED');
    const tenant = await tx.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
    if (!tenant) throw new Error('PILOT_TENANT_NOT_FOUND');
    if (mode === 'enable') {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM AssistantKnowledgeControl WHERE id = ${KNOWLEDGE_CONTROL_ID} FOR UPDATE`);
      const control = await tx.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID } });
      const release = control?.activeReleaseId === firstCutHelp.releaseId
        ? await tx.assistantKnowledgeRelease.findUnique({ where: { id: firstCutHelp.releaseId } }) : null;
      if (!release || release.status !== 'PUBLISHED' || release.manifestHash !== firstCutHelp.manifestHash
        || !release.reviewedById || !release.reviewedAt || !release.publishedAt)
        throw new Error('PILOT_HELP_RELEASE_REQUIRED');
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT tenantId FROM AssistantTenantConfig WHERE tenantId = ${targetTenantId} FOR UPDATE`);
    const before = await tx.assistantTenantConfig.findUnique({ where: { tenantId: targetTenantId! } });
    if (mode === 'enable') {
      if (before && guardedFlags.some(flag => before[flag])) throw new Error('PILOT_EXISTING_CAPABILITIES');
      if (before?.enabled && new Decimal(before.monthlyBudgetUsd).eq(2)
        && new Decimal(before.approvedMonthlyBudgetUsd).eq(2))
        return { changed: false, enabled: true, budgetUsd: '2' };
      if (before?.enabled) throw new Error('PILOT_ALREADY_ENABLED_DIFFERENTLY');
      await tx.assistantTenantConfig.upsert({ where: { tenantId: targetTenantId! },
        create: { tenantId: targetTenantId!, ...firstCut }, update: firstCut });
    } else {
      if (!before?.enabled) return { changed: false, enabled: false, budgetUsd: before ? budgetOf(before) : null };
      await tx.assistantTenantConfig.update({ where: { tenantId: targetTenantId! }, data: { enabled: false } });
    }
    await tx.auditLog.create({ data: {
      tenantId: targetTenantId!, userId: actor.id,
      action: mode === 'enable' ? 'ASSISTANT_PILOT_ENABLED' : 'ASSISTANT_PILOT_DISABLED',
      details: JSON.stringify({ targetUserId, before: before && {
        enabled: before.enabled, budgetUsd: budgetOf(before),
      }, after: { enabled: mode === 'enable', budgetUsd: mode === 'enable' ? '2' : before && budgetOf(before) }, reason }),
    } });
    return { changed: true, enabled: mode === 'enable', budgetUsd: mode === 'enable' ? '2' : before && budgetOf(before) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

try {
  const result = mode === 'inspect' ? await inspect() : await change();
  console.log(JSON.stringify({ mode, result }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PILOT_CHANGE_FAILED');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
