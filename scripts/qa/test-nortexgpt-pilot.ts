/** Ejercicio MySQL real de identidad, límite, auditoría y revocación del piloto. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import prisma from '../../backend/lib/prisma.js';
import { createAssistantConversation, sendAssistantMessage } from '../../backend/services/assistant/conversations.js';
import { stageAssistantKnowledgeRelease, reviewAssistantKnowledgeRelease,
  publishAssistantKnowledgeRelease } from '../../backend/services/assistant/knowledge/lifecycle.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
const script = resolve(process.cwd(), 'scripts/ops/nortexgpt-pilot.ts');
const email = `pilot-${randomUUID()}@example.invalid`;
const reason = 'Piloto sintético revisado con límite de dos dólares.';

function run(mode: 'inspect' | 'enable' | 'disable', variables: Record<string, string>, success: boolean) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', script, mode], {
    cwd: process.cwd(), env: {
      PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'test', ...variables,
    }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status === 0, success, 'resultado de operación piloto inesperado');
  return success ? JSON.parse(child.stdout).result : child.stderr;
}

async function main() {
  const adminTenant = await prisma.tenant.create({ data: {
    businessName: 'QA plataforma', taxId: `qa-platform-${randomUUID()}`,
  } });
  const actor = await prisma.user.create({ data: {
    tenantId: adminTenant.id, email: `reviewer-${randomUUID()}@example.invalid`,
    password: 'synthetic-no-login', name: 'QA Revisor', role: 'SUPER_ADMIN',
  } });
  const jwtSecret = randomBytes(32).toString('hex');
  const reviewerToken = jwt.sign({ userId: actor.id, tenantId: adminTenant.id, role: 'SUPER_ADMIN' },
    jwtSecret, { expiresIn: '5m' });
  const tenant = await prisma.tenant.create({ data: {
    businessName: 'QA piloto ferretería', taxId: `qa-pilot-${randomUUID()}`,
  } });
  const target = await prisma.user.create({ data: {
    tenantId: tenant.id, email, password: 'synthetic-no-login', name: 'QA Dueño', role: 'OWNER',
  } });
  const customerTenant = await prisma.tenant.create({ data: {
    businessName: 'QA cliente ferretería', taxId: `qa-customer-${randomUUID()}`,
  } });
  const customerEmail = `customer-${randomUUID()}@example.invalid`;
  const customer = await prisma.user.create({ data: {
    tenantId: customerTenant.id, email: customerEmail, password: 'synthetic-no-login',
    name: 'QA Cliente', role: 'OWNER',
  } });
  const base = {
    NORTEX_PILOT_EMAIL: email, NORTEX_PILOT_TENANT_ID: tenant.id,
    NORTEX_PILOT_USER_ID: target.id, NORTEX_PILOT_EXPECTED_ROLE: 'OWNER',
    JWT_SECRET: jwtSecret, NORTEX_PILOT_ADMIN_JWT: reviewerToken,
    NORTEX_PILOT_REASON: reason, NORTEX_PILOT_CHANGE_ACK: 'explicit-pilot-change',
    NORTEX_PILOT_REVIEW_ACK: 'content-and-expected-reviewed',
  };
  const inspect = run('inspect', { NORTEX_PILOT_EMAIL: email }, true);
  assert.equal(inspect.userId, target.id);
  assert.equal(inspect.tenantId, tenant.id);
  assert.equal(inspect.roleEligible, true);
  assert.equal(inspect.helpReleaseReady, false);
  assert.equal(inspect.config, null);

  const confirm = (mode: 'enable' | 'disable') => `${mode}:${tenant.id}:${target.id}:OWNER:USD2`;
  run('enable', { ...base, NORTEX_PILOT_REVIEW_ACK: '', NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  run('enable', { ...base, NORTEX_PILOT_ADMIN_JWT: 'invalid', NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  const selfToken = jwt.sign({ userId: target.id, tenantId: tenant.id, role: 'OWNER' }, jwtSecret, { expiresIn: '5m' });
  run('enable', { ...base, NORTEX_PILOT_ADMIN_JWT: selfToken, NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  run('enable', { ...base, NORTEX_PILOT_USER_ID: actor.id, NORTEX_PILOT_CONFIRM: `enable:${tenant.id}:${actor.id}:OWNER:USD2` }, false);
  assert.equal(await prisma.assistantTenantConfig.findUnique({ where: { tenantId: tenant.id } }), null);

  await prisma.user.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
  run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  await prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'DISABLED' } });
  run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'ACTIVE' } });

  assert.match(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false),
    /PILOT_HELP_RELEASE_REQUIRED/);
  assert.equal(await prisma.assistantTenantConfig.findUnique({ where: { tenantId: tenant.id } }), null);
  const draft = JSON.parse(await readFile('docs/evidence/nortexgpt/help-first-cut-20260923/release-draft.json', 'utf8'));
  const principal = { tenantId: adminTenant.id, userId: actor.id, role: 'SUPER_ADMIN' };
  const staged = await stageAssistantKnowledgeRelease(principal, draft, prisma);
  const decision = { releaseId: staged.id, manifestHash: staged.manifestHash };
  assert.equal(staged.manifestHash, 'f3fd57932a02205f49fd93fa957346b6a71c1705b0001114d44ff3bfe1ea1cfb');
  assert.match(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false),
    /PILOT_HELP_RELEASE_REQUIRED/);
  await reviewAssistantKnowledgeRelease(principal, decision, prisma);
  assert.match(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false),
    /PILOT_HELP_RELEASE_REQUIRED/);
  await publishAssistantKnowledgeRelease(principal, decision, prisma);
  assert.equal(run('inspect', { NORTEX_PILOT_EMAIL: email }, true).helpReleaseReady, true);

  assert.deepEqual(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, true),
    { changed: true, enabled: true, budgetUsd: '2' });
  const enabled = await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: tenant.id } });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.monthlyBudgetUsd.toString(), '2');
  assert.equal(enabled.approvedMonthlyBudgetUsd.toString(), '2');
  for (const flag of ['operationsEnabled', 'actionsEnabled', 'extractionEnabled', 'executionEnabled',
    'promotionsEnabled', 'privateWhatsappEnabled'] as const) assert.equal(enabled[flag], false);
  process.env.NORTEX_ASSISTANT_ENABLED = 'true';
  process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED = 'false';
  process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED = 'false';
  const ownerPrincipal = { tenantId: tenant.id, userId: target.id, role: 'OWNER' };
  const ownerConversation = await createAssistantConversation(ownerPrincipal, prisma);
  const helpAnswer = await sendAssistantMessage(ownerPrincipal, ownerConversation.id,
    { requestId: randomUUID(), text: '¿Cómo vender y cobrar?' }, prisma);
  assert.equal(helpAnswer.citations?.some(citation => citation.id === 'ventas'), true);
  const inventoryAnswer = await sendAssistantMessage(ownerPrincipal, ownerConversation.id,
    { requestId: randomUUID(), text: 'Inventario' }, prisma);
  assert.equal(typeof inventoryAnswer.overview?.scope, 'string');
  assert.equal((inventoryAnswer.overview?.metrics.length ?? 0) > 0, true);
  assert.equal(inventoryAnswer.operationalRunId, undefined);
  assert.equal(await prisma.assistantRun.count({ where: { tenantId: tenant.id } }), 0);
  assert.equal(await prisma.assistantUsage.count({ where: { tenantId: tenant.id } }), 0);
  assert.deepEqual(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, true),
    { changed: false, enabled: true, budgetUsd: '2' });
  await prisma.assistantTenantConfig.update({ where: { tenantId: tenant.id },
    data: { monthlyBudgetUsd: '10' } });
  assert.match(run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false),
    /PILOT_ALREADY_ENABLED_DIFFERENTLY/);
  await prisma.assistantTenantConfig.update({ where: { tenantId: tenant.id },
    data: { monthlyBudgetUsd: '2' } });
  const enableAudits = await prisma.auditLog.findMany({ where: {
    tenantId: tenant.id, action: 'ASSISTANT_PILOT_ENABLED',
  }, take: 10 });
  assert.equal(enableAudits.length, 1);
  assert.equal(enableAudits[0].userId, actor.id);

  const customerBase = { ...base, NORTEX_PILOT_EMAIL: customerEmail,
    NORTEX_PILOT_TENANT_ID: customerTenant.id, NORTEX_PILOT_USER_ID: customer.id };
  const customerConfirm = (mode: 'enable' | 'disable') =>
    `${mode}:${customerTenant.id}:${customer.id}:OWNER:USD2`;
  assert.deepEqual(run('enable', { ...customerBase, NORTEX_PILOT_CONFIRM: customerConfirm('enable') }, true),
    { changed: true, enabled: true, budgetUsd: '2' });
  assert.equal((await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: customerTenant.id } })).enabled, true);
  const customerPrincipal = { tenantId: customerTenant.id, userId: customer.id, role: 'OWNER' };
  const customerConversation = await createAssistantConversation(customerPrincipal, prisma);
  assert.notEqual(customerConversation.id, ownerConversation.id);
  assert.equal((await sendAssistantMessage(customerPrincipal, customerConversation.id,
    { requestId: randomUUID(), text: '¿Cómo vender y cobrar?' }, prisma)).citations?.some(citation => citation.id === 'ventas'), true);
  assert.equal(await prisma.assistantMessage.count({ where: { tenantId: customerTenant.id } }), 2);
  assert.equal(await prisma.assistantMessage.count({ where: { tenantId: tenant.id } }), 4);

  assert.deepEqual(run('disable', { ...base, NORTEX_PILOT_CONFIRM: confirm('disable') }, true),
    { changed: true, enabled: false, budgetUsd: '2' });
  assert.equal((await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: tenant.id } })).enabled, false);
  assert.equal((await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: customerTenant.id } })).enabled, true);
  await assert.rejects(createAssistantConversation(ownerPrincipal, prisma), { code: 'ASSISTANT_DISABLED' });
  await assert.rejects(sendAssistantMessage(ownerPrincipal, ownerConversation.id,
    { requestId: randomUUID(), text: 'Inventario' }, prisma), { code: 'ASSISTANT_DISABLED' });
  assert.equal((await sendAssistantMessage(customerPrincipal, customerConversation.id,
    { requestId: randomUUID(), text: '¿Cómo vender y cobrar?' }, prisma)).citations?.some(citation => citation.id === 'ventas'), true);
  assert.deepEqual(run('disable', { ...base, NORTEX_PILOT_CONFIRM: confirm('disable') }, true),
    { changed: false, enabled: false, budgetUsd: '2' });
  assert.equal(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'ASSISTANT_PILOT_DISABLED' } }), 1);
  await prisma.assistantTenantConfig.update({ where: { tenantId: tenant.id }, data: { operationsEnabled: true } });
  run('enable', { ...base, NORTEX_PILOT_CONFIRM: confirm('enable') }, false);
  assert.equal((await prisma.assistantTenantConfig.findUniqueOrThrow({ where: { tenantId: tenant.id } })).enabled, false);
  assert.deepEqual(run('disable', { ...customerBase, NORTEX_PILOT_CONFIRM: customerConfirm('disable') }, true),
    { changed: true, enabled: false, budgetUsd: '2' });
  console.log('QA piloto: dos negocios aislados, ayuda web, consulta determinista, cero runs/costo, identidad, límite, auditoría y revocación OK.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Falló el ensayo sintético del piloto.'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
