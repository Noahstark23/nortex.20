/** Integración MySQL: el panel sólo puede activar las dos identidades permitidas. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prisma from '../../backend/lib/prisma.js';
import { changePilotAccount, inspectPilotAccount, PILOT_MANIFEST_HASH } from '../../backend/services/assistant/pilotActivation.js';
import { recordAssistantWorkerHeartbeat } from '../../backend/services/assistant/operations/workerHeartbeat.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
const reason = 'Ensayo sintético de activación con consentimiento y límite US$2.';
const storage = await mkdtemp(join(tmpdir(), 'nortex-pilot-admin-'));
process.env.NORTEX_ASSISTANT_STORAGE_DIR = join(storage, 'originals');
process.env.SOURCE_COMMIT = 'a'.repeat(40);
process.env.NORTEX_ASSISTANT_ENABLED = 'true';
process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED = 'true';
process.env.ANTHROPIC_API_KEY = 'synthetic-never-call-provider';

async function main() {
  assert.equal(await recordAssistantWorkerHeartbeat('idle'), true);
  const adminTenant = await prisma.tenant.create({ data: { businessName: 'QA plataforma piloto', taxId: `qa-platform-${randomUUID()}` } });
  const admin = await prisma.user.create({ data: { tenantId: adminTenant.id, email: `qa-admin-${randomUUID()}@example.invalid`,
    password: 'synthetic-no-login', name: 'QA Administrador', role: 'SUPER_ADMIN' } });
  const principal = { tenantId: adminTenant.id, userId: admin.id, role: 'SUPER_ADMIN' };
  const targets = await Promise.all(['QA ferretería uno', 'QA ferretería dos', 'QA no autorizada'].map(async businessName => {
    const tenant = await prisma.tenant.create({ data: { businessName, taxId: `qa-target-${randomUUID()}` } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, email: `qa-target-${randomUUID()}@example.invalid`,
      password: 'synthetic-no-login', name: businessName, role: 'ADMIN' } });
    return { tenant, user };
  }));
  process.env.NORTEX_PILOT_TARGETS = targets.slice(0, 2).map(({ tenant, user }) => `${tenant.id}/${user.id}`).join(',');
  const input = ({ tenant, user }: typeof targets[number]) => ({ email: user.email!, tenantId: tenant.id, userId: user.id,
    expectedRole: 'ADMIN', manifestHash: PILOT_MANIFEST_HASH, reason, acknowledged: true });
  const [first, second, excluded] = targets;
  assert.equal((await inspectPilotAccount(principal, first.user.email, prisma)).eligible, true);
  await assert.rejects(inspectPilotAccount(principal, excluded.user.email, prisma), { code: 'PILOT_TARGET_NOT_ALLOWED' });
  await assert.rejects(changePilotAccount(principal, 'enable', input(excluded), prisma), { code: 'PILOT_TARGET_NOT_ALLOWED' });
  await assert.rejects(changePilotAccount({ ...principal, role: 'ADMIN' }, 'enable', input(first), prisma), { code: 'PILOT_REVIEWER_FORBIDDEN' });
  await assert.rejects(changePilotAccount(principal, 'enable', { ...input(first), userId: second.user.id }, prisma), { code: 'PILOT_TARGET_NOT_ALLOWED' });
  process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED = 'true';
  await assert.rejects(changePilotAccount(principal, 'enable', input(first), prisma), { code: 'PILOT_GLOBAL_CAPABILITIES' });
  process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED = 'false';
  assert.deepEqual(await changePilotAccount(principal, 'enable', input(first), prisma), { changed: true, enabled: true, budgetUsd: '2' });
  assert.deepEqual(await changePilotAccount(principal, 'enable', input(second), prisma), { changed: true, enabled: true, budgetUsd: '2' });
  assert.deepEqual(await changePilotAccount(principal, 'enable', input(first), prisma), { changed: false, enabled: true, budgetUsd: '2' });
  for (const { tenant } of targets.slice(0, 2)) {
    const config = await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    assert.equal(config.enabled, true);
    assert.equal(config.monthlyBudgetUsd.toString(), '2');
    for (const flag of ['extractionEnabled', 'executionEnabled', 'operationsEnabled', 'actionsEnabled',
      'promotionsEnabled', 'privateWhatsappEnabled'] as const) assert.equal(config[flag], false);
    const audits = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: 'ASSISTANT_PILOT_ENABLED' } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].userId, admin.id);
  }
  assert.equal(await prisma.assistantTenantConfig.findUnique({ where: { tenantId: excluded.tenant.id } }), null);
  assert.deepEqual(await changePilotAccount(principal, 'disable', input(first), prisma), { changed: true, enabled: false, budgetUsd: '2' });
  assert.equal((await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: second.tenant.id } })).enabled, true);
  console.log('QA panel piloto: sólo dos identidades, sesión independiente, límite US$2, flags cerrados, auditoría y revocación OK.');
}

try { await main(); }
finally { await prisma.$disconnect(); await rm(storage, { recursive: true, force: true }); }
