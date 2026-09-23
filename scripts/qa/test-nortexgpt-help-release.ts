/** Recorre el borrador editorial exacto en MySQL descartable; la revisión es sintética. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import prisma from '../../backend/lib/prisma.js';
import { readKnowledgeSnapshot } from '../../backend/services/assistant/knowledge/store.js';
import { createAssistantConversation, sendAssistantMessage } from '../../backend/services/assistant/conversations.js';
import { getAssistantKnowledgePassage, retrievePublishedAssistantHelp } from '../../backend/services/assistant/knowledge/service.js';
import { stageAssistantKnowledgeRelease, reviewAssistantKnowledgeRelease,
  publishAssistantKnowledgeRelease } from '../../backend/services/assistant/knowledge/lifecycle.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
const expectedHash = '3d18a116746db968c3e808daf406c1edb70350f706e8111752f80673907f1126';
const expectedIds = ['asistente', 'ventas', 'offline', 'compras', 'lotes', 'contabilidad',
  'reposicion', 'salida-proveedor', 'merma', 'comparacion'];

async function main() {
  const draft = JSON.parse(await readFile('docs/evidence/nortexgpt/help-first-cut-20260923/release-draft.json', 'utf8'));
  const before = await readKnowledgeSnapshot(prisma);
  assert.equal(before.documents.length, 12);
  assert.equal(before.revision, '0:legacy');

  const editorialTenant = await prisma.tenant.create({ data: {
    businessName: 'QA editorial', taxId: `qa-editorial-${randomUUID()}`,
  } });
  const editor = await prisma.user.create({ data: {
    tenantId: editorialTenant.id, email: `qa-editor-${randomUUID()}@example.invalid`,
    password: 'synthetic-no-login', name: 'QA editor', role: 'SUPER_ADMIN',
  } });
  const principal = { tenantId: editorialTenant.id, userId: editor.id, role: 'SUPER_ADMIN' };
  const tenant = await prisma.tenant.create({ data: {
    businessName: 'QA lectura del corpus', taxId: `qa-help-${randomUUID()}`,
  } });
  const reader = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `qa-reader-${randomUUID()}@example.invalid`,
    password: 'synthetic-no-login', name: 'QA lector', role: 'OWNER',
  } });
  await prisma.assistantTenantConfig.create({ data: {
    tenantId: tenant.id, enabled: true, monthlyBudgetUsd: '2', approvedMonthlyBudgetUsd: '2',
  } });
  process.env.NORTEX_ASSISTANT_ENABLED = 'true';

  const staged = await stageAssistantKnowledgeRelease(principal, draft, prisma);
  assert.equal(staged.status, 'DRAFT');
  assert.equal(staged.manifestHash, expectedHash);
  assert.equal((await readKnowledgeSnapshot(prisma)).documents.length, 12);
  const decision = { releaseId: staged.id, manifestHash: staged.manifestHash };
  await assert.rejects(publishAssistantKnowledgeRelease(principal, decision, prisma),
    { code: 'KNOWLEDGE_HUMAN_REVIEW_REQUIRED' });
  await assert.rejects(reviewAssistantKnowledgeRelease(principal,
    { releaseId: staged.id, manifestHash: '0'.repeat(64) }, prisma), { code: 'KNOWLEDGE_REVIEW_STALE' });

  // Sólo simula la transición técnica; no representa aprobación de una persona.
  assert.equal((await reviewAssistantKnowledgeRelease(principal, decision, prisma)).status, 'REVIEWED');
  assert.equal((await publishAssistantKnowledgeRelease(principal, decision, prisma)).status, 'PUBLISHED');
  const active = await readKnowledgeSnapshot(prisma);
  assert.equal(active.documents.length, 10);
  assert.equal(active.documents.every(doc => doc.payload.channels.length === 1
    && doc.payload.channels[0] === 'WEB_INTERNAL'), true);
  assert.deepEqual(active.documents.map(doc => doc.reference.documentId).sort(), expectedIds.sort());
  assert.equal(active.documents.every(doc => doc.publication === 'PUBLISHED'), true);
  assert.equal(active.documents.some(doc => ['promociones', 'canal-privado'].includes(doc.reference.documentId)), false);
  const readerPrincipal = { tenantId: tenant.id, userId: reader.id, role: 'OWNER' };
  const help = await retrievePublishedAssistantHelp(readerPrincipal, 'ventas', prisma);
  assert.equal(help.citations.some(citation => citation.id === 'ventas'), true);
  assert.equal((await getAssistantKnowledgePassage(readerPrincipal, help.knowledgeReferences[0], prisma)).publication, 'PUBLISHED');
  process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED = 'false';
  process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED = 'false';
  const conversation = await createAssistantConversation(readerPrincipal, prisma);
  const comparison = await sendAssistantMessage(readerPrincipal, conversation.id,
    { requestId: randomUUID(), text: '¿Cómo comparar ventas?' }, prisma);
  assert.equal(comparison.citations?.some(citation => citation.id === 'comparacion'), true);
  assert.match(comparison.text, /no realiza la comparación automática/);
  assert.equal(comparison.operationalRunId, undefined);
  const replenishment = await sendAssistantMessage(readerPrincipal, conversation.id,
    { requestId: randomUUID(), text: '¿Cómo reponer productos?' }, prisma);
  assert.equal(replenishment.citations?.some(citation => citation.id === 'reposicion'), true);
  assert.match(replenishment.text, /aún no está habilitada en este piloto/);
  assert.equal(replenishment.operationalRunId, undefined);
  assert.equal(await prisma.assistantRun.count({ where: { tenantId: tenant.id } }), 0);
  assert.deepEqual((await retrievePublishedAssistantHelp(readerPrincipal, 'whatsapp privado', prisma)).citations, []);
  await prisma.assistantTenantConfig.update({ where: { tenantId: tenant.id },
    data: { privateWhatsappEnabled: true } });
  process.env.NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED = 'true';
  assert.deepEqual((await retrievePublishedAssistantHelp(readerPrincipal, 'ventas', prisma, 'WHATSAPP_PRIVATE')).citations, []);
  delete process.env.NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED;

  assert.equal((await stageAssistantKnowledgeRelease(principal, draft, prisma)).status, 'PUBLISHED');
  assert.equal((await publishAssistantKnowledgeRelease(principal, decision, prisma)).status, 'PUBLISHED');
  const control = await prisma.assistantKnowledgeControl.findUniqueOrThrow({ where: { id: 'official' } });
  assert.equal(control.generation, 1);
  assert.equal(control.activeReleaseId, staged.id);
  const actions = await prisma.auditLog.findMany({ where: { tenantId: editorialTenant.id,
    action: { startsWith: 'ASSISTANT_KNOWLEDGE_' } }, take: 10 });
  assert.deepEqual(actions.map(row => row.action).sort(),
    ['ASSISTANT_KNOWLEDGE_STAGED', 'ASSISTANT_KNOWLEDGE_REVIEWED', 'ASSISTANT_KNOWLEDGE_PUBLISHED'].sort());
  console.log('QA ayuda: borrador exacto, revisión exigida, 10 fuentes web, dos respuestas de piloto sin runs, canal privado vacío, 2 excluidas e idempotencia OK.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Falló QA editorial.'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
