/** Integración editorial dedicada. El lanzador crea y destruye su propio MySQL 8. */
import assert from 'node:assert/strict';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { assertKnowledgeMysqlTarget } from '../../../../scripts/qa/knowledge-mysql.mjs';

const marker = process.env.NORTEX_KNOWLEDGE_MYSQL_MARKER;
assertKnowledgeMysqlTarget(process.env.DATABASE_URL, marker);
const { default: db } = await import('../../../../backend/lib/prisma.js');
const lifecycle = await import('../../../../backend/services/assistant/knowledge/lifecycle.js');
const { addKnowledgeEditorialNote: addNote } = await import('../../../../backend/services/assistant/knowledge/editorNotes.js');
const { LEGACY_KNOWLEDGE, payloadHash } = await import('../../../../backend/services/assistant/knowledge/model.js');
const { readKnowledgeSnapshot } = await import('../../../../backend/services/assistant/knowledge/store.js');
const { stageAssistantKnowledgeRelease: stage, reviewAssistantKnowledgeRelease: review,
  publishAssistantKnowledgeRelease: publish, retireAssistantKnowledgeVersion: retire } = lifecycle;
const editor: AssistantPrincipal = { tenantId: 'qa-editorial', userId: 'qa-editor-a', role: 'SUPER_ADMIN' };
const other: AssistantPrincipal = { ...editor, userId: 'qa-editor-b' };
const otherTenant: AssistantPrincipal = { tenantId: 'qa-other-editorial', userId: 'qa-editor-c', role: 'SUPER_ADMIN' };
const noteRequestId = '17b9b78e-70a1-4a3c-825a-923aa44b0cb6';
const noteInput = (manifestHash: string) => ({ requestId: noteRequestId, manifestHash, body: 'Observación sintética que todavía requiere decisión humana.' });
const planned = 21;
const results: { name: string; status: 'PASSED'; durationMs: number }[] = [];
let activeScenario = 'fixture ownership';
const payload = { title: 'Ayuda sintética', section: 'Ejemplo de QA', body: 'Contenido sintético exclusivo de integración editorial.',
  roles: ['OWNER'], requiredCapabilities: ['help'], channels: ['WEB_INTERNAL'], keywords: 'ayuda sintética ejemplo' };
const input = (id = 'qa-release', documentId = 'qa-document') => ({ id, formatVersion: 1,
  documents: [{ documentId, version: '1.0', sectionId: 'main', payload }] });
const decision = (release: { id: string; manifestHash: string }) => ({ releaseId: release.id, manifestHash: release.manifestHash });
const reference = (documentId = 'qa-document') => ({ documentId, version: '1.0', sectionId: 'main', contentHash: payloadHash(payload) });
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === expected);
const auditFailure = (error: unknown) => error instanceof Error &&
  `${error.message} ${JSON.stringify(error)}`.includes('synthetic editorial audit failure');

async function assertOwned() {
  const rows = await db.$queryRaw<{ marker: string }[]>`SELECT marker FROM KnowledgeQaFixture WHERE id = 'owned'`;
  assert.equal(rows.length, 1); assert.equal(rows[0].marker, marker);
  const tables = await db.$queryRaw<{ tableName: string }[]>`SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`;
  assert.deepEqual(tables.map(row => row.tableName).sort(), ['AssistantKnowledgeControl', 'AssistantKnowledgeRelease',
    'AssistantKnowledgeVersion', 'AssistantKnowledgeReviewNote', 'AssistantRun', 'AssistantWaOutbox', 'AuditLog', 'KnowledgeQaFixture', 'User'].sort());
}
async function reset() {
  await assertOwned();
  await db.$executeRaw`UPDATE KnowledgeQaFixture SET marker = 'off' WHERE id = 'audit-failure'`;
  await db.assistantKnowledgeReviewNote.deleteMany();
  await db.assistantKnowledgeRelease.deleteMany();
  await db.assistantKnowledgeVersion.deleteMany();
  await db.assistantKnowledgeControl.deleteMany();
  await db.auditLog.deleteMany();
  await db.$executeRaw`UPDATE User SET status = 'ACTIVE', role = 'SUPER_ADMIN'`;
}
async function failAudit() {
  await db.$executeRaw`UPDATE KnowledgeQaFixture SET marker = 'fail' WHERE id = 'audit-failure'`;
}
async function ready() { const release = await stage(editor, input(), db); await review(editor, decision(release), db); return release; }
async function state() {
  return {
    control: await db.assistantKnowledgeControl.findUnique({ where: { id: 'official' } }),
    release: await db.assistantKnowledgeRelease.findUnique({ where: { id: 'qa-release' } }),
    versions: await db.assistantKnowledgeVersion.findMany({ take: 60, orderBy: { documentId: 'asc' } }),
    auditCount: await db.auditLog.count(),
  };
}
async function scenario(name: string, fn: () => Promise<void>) {
  activeScenario = name; await reset(); const started = Date.now(); await fn(); results.push({ name, status: 'PASSED', durationMs: Date.now() - started });
}

try {
  await assertOwned();
  const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
  assert.match(version, /^8\.0\./);
  await scenario('exact additive migration preserves old outbox rows and nullable provenance', async () => {
    const rows = await db.$queryRaw<{ id: string; knowledgeReferences: unknown }[]>`SELECT id, knowledgeReferences FROM AssistantWaOutbox`;
    assert.deepEqual(rows, [{ id: 'fixture-existing-outbox', knowledgeReferences: null }]);
    const runs = await db.$queryRaw<{ id: string; knowledgeChannel: string | null }[]>`SELECT id, knowledgeChannel FROM AssistantRun`;
    assert.deepEqual(runs, [{ id: 'fixture-existing-run', knowledgeChannel: null }]);
    const engines = await db.$queryRaw<{ engine: string }[]>`SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`;
    assert(engines.every(row => row.engine === 'InnoDB'));
    const indexes = await db.$queryRaw<{ tableName: string; indexName: string }[]>`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`;
    assert(indexes.some(row => row.indexName === 'AssistantKnowledgeRelease_status_createdAt_idx'));
    assert(indexes.some(row => row.indexName === 'AssistantKnowledgeVersion_status_documentId_idx'));
    assert(indexes.some(row => row.indexName === 'AssistantKnowledgeRelease_status_createdAt_id_idx'));
    assert(indexes.some(row => row.indexName === 'AssistantKnowledgeReviewNote_releaseId_createdAt_id_idx'));
    assert.equal((await readKnowledgeSnapshot(db)).documents.length, LEGACY_KNOWLEDGE.length);
    assert.equal(await db.assistantKnowledgeControl.count(), 0); assert.equal(await db.assistantKnowledgeRelease.count(), 0);
    assert.equal(await db.assistantKnowledgeVersion.count(), 0); assert.equal(await db.auditLog.count(), 0);
  });
  await scenario('draft persists without publication; identical staging returns one operation', async () => {
    const first = await stage(editor, input(), db), second = await stage(other, input(), db);
    assert.deepEqual(first, second); assert.equal(first.status, 'DRAFT');
    const current = await state(); assert.equal(current.auditCount, 1); assert.equal(current.versions.length, 1);
    assert.equal(current.control?.activeReleaseId, null); assert.equal(current.control?.generation, 0);
    assert.equal(current.release?.reviewedById, null); assert.equal(current.release?.publishedAt, null);
    assert.equal(current.versions[0].status, 'DRAFT');
  });
  await scenario('publishing requires exact reviewed manifest and preserves state on rejection', async () => {
    const release = await stage(editor, input(), db), before = await state();
    await assert.rejects(publish(editor, decision(release), db), code('KNOWLEDGE_HUMAN_REVIEW_REQUIRED'));
    await assert.rejects(review(editor, { releaseId: release.id, manifestHash: '0'.repeat(64) }, db), code('KNOWLEDGE_REVIEW_STALE'));
    assert.deepEqual(await state(), before);
  });
  await scenario('review and publish persist actor, exact hash, snapshot and single activation', async () => {
    const release = await ready(); const result = await publish(other, decision(release), db);
    assert.equal(result.status, 'PUBLISHED');
    const current = await state(); assert.equal(current.release?.reviewedById, editor.userId);
    assert(current.release?.reviewedAt instanceof Date); assert(current.release?.publishedAt instanceof Date);
    assert.equal(current.release?.manifestHash, release.manifestHash); assert.equal(current.control?.generation, 1);
    assert.equal(current.control?.activeReleaseId, release.id); assert.equal(current.versions[0].status, 'PUBLISHED');
    assert.equal(current.auditCount, 3);
    const snapshot = await readKnowledgeSnapshot(db);
    assert.equal(snapshot.documents.length, 1); assert.equal(snapshot.documents[0].payload.body, payload.body);
    assert.deepEqual(snapshot.activeReferences, [reference()]); assert.equal(snapshot.documents[0].publication, 'PUBLISHED');
    await publish(editor, decision(release), db); assert.deepEqual(await state(), current);
  });
  await scenario('concurrent same identity staging commits one release, version and audit', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => stage(index % 2 ? editor : other, input(), db)));
    const failed = attempts.find(attempt => attempt.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const results = attempts.map(attempt => { assert.equal(attempt.status, 'fulfilled'); return (attempt as PromiseFulfilledResult<{ id: string; manifestHash: string }>).value; });
    assert(results.every(result => result.id === results[0].id && result.manifestHash === results[0].manifestHash));
    assert.equal(await db.assistantKnowledgeRelease.count(), 1); assert.equal(await db.assistantKnowledgeVersion.count(), 1);
    assert.equal(await db.auditLog.count(), 1);
  });
  await scenario('fixed release identity and document version reject changed content atomically', async () => {
    await stage(editor, input(), db); const before = await state();
    const changed = input(); changed.documents[0].payload = { ...payload, body: 'Otro contenido sintético.' };
    await assert.rejects(stage(other, changed, db), code('KNOWLEDGE_RELEASE_IMMUTABLE'));
    await assert.rejects(stage(other, { ...changed, id: 'qa-second-release' }, db), code('KNOWLEDGE_VERSION_IMMUTABLE'));
    assert.deepEqual(await state(), before); assert.equal(await db.assistantKnowledgeRelease.count(), 1);
  });
  await scenario('audit failure rolls back initial control, draft and versions together', async () => {
    await failAudit(); await assert.rejects(stage(editor, input(), db), auditFailure);
    assert.equal(await db.assistantKnowledgeControl.count(), 0); assert.equal(await db.assistantKnowledgeRelease.count(), 0);
    assert.equal(await db.assistantKnowledgeVersion.count(), 0); assert.equal(await db.auditLog.count(), 0);
  });
  await scenario('audit failure rolls back review metadata', async () => {
    const release = await stage(editor, input(), db), before = await state(); await failAudit();
    await assert.rejects(review(other, decision(release), db), auditFailure); assert.deepEqual(await state(), before);
  });
  await scenario('audit failure rolls back publication, generation and version status', async () => {
    const release = await ready(), before = await state(); await failAudit();
    await assert.rejects(publish(other, decision(release), db), auditFailure); assert.deepEqual(await state(), before);
  });
  await scenario('audit failure rolls back retirement and snapshot stays valid', async () => {
    const release = await ready(); await publish(editor, decision(release), db); const before = await state(); await failAudit();
    await assert.rejects(retire(other, { reference: reference(), reason: 'Retirada sintética de QA editorial.' }, db), auditFailure);
    assert.deepEqual(await state(), before); assert.equal((await readKnowledgeSnapshot(db)).documents.length, 1);
  });
  await scenario('retired published version cannot revive through replay or another manifest', async () => {
    const release = await ready(); await publish(editor, decision(release), db);
    await retire(other, { reference: reference(), reason: 'Retirada sintética comprobada.' }, db);
    assert.equal((await readKnowledgeSnapshot(db)).documents.length, 0);
    const before = await state(); assert.equal(before.versions[0].status, 'RETIRED');
    await assert.rejects(publish(editor, decision(release), db), code('KNOWLEDGE_REVIEW_STALE'));
    await assert.rejects(stage(editor, input('qa-rollback'), db), code('KNOWLEDGE_RETIRED'));
    await retire(editor, { reference: reference(), reason: 'Reintento sintético de la retirada.' }, db);
    assert.deepEqual(await state(), before);
  });
  await scenario('legacy tombstone survives compiled old help and rejects rollback publication', async () => {
    const legacy = LEGACY_KNOWLEDGE[0]; assert((await readKnowledgeSnapshot(db)).activeReferences.some(ref => ref.documentId === legacy.reference.documentId));
    await retire(editor, { reference: legacy.reference, reason: 'Retirada de texto legacy en fixture sintética.' }, db);
    const snapshot = await readKnowledgeSnapshot(db);
    assert(!snapshot.activeReferences.some(ref => ref.documentId === legacy.reference.documentId));
    assert.equal(snapshot.documents.length, LEGACY_KNOWLEDGE.length - 1);
    await assert.rejects(stage(other, { id: 'qa-old-corpus', formatVersion: 1,
      documents: [{ documentId: legacy.reference.documentId, version: legacy.reference.version,
        sectionId: legacy.reference.sectionId, payload: legacy.payload }] }, db), code('KNOWLEDGE_RETIRED'));
    assert.equal(await db.assistantKnowledgeRelease.count(), 0);
  });
  await scenario('concurrent review and publish serialize to a reviewed publication or explicit retry', async () => {
    const release = await stage(editor, input(), db);
    const [reviewed, published] = await Promise.allSettled([review(editor, decision(release), db), publish(other, decision(release), db)]);
    assert.equal(reviewed.status, 'fulfilled');
    if (published.status === 'rejected') { assert(code('KNOWLEDGE_HUMAN_REVIEW_REQUIRED')(published.reason)); await publish(other, decision(release), db); }
    const current = await state(); assert.equal(current.release?.status, 'PUBLISHED'); assert.equal(current.control?.generation, 1);
    assert.equal(current.auditCount, 3);
  });
  await scenario('concurrent publish and retirement never expose a retired version afterward', async () => {
    const release = await ready();
    const [published, retired] = await Promise.allSettled([publish(editor, decision(release), db),
      retire(other, { reference: reference(), reason: 'Retirada editorial concurrente sintética.' }, db)]);
    assert.equal(retired.status, 'fulfilled');
    if (published.status === 'rejected') assert(code('KNOWLEDGE_REVIEW_STALE')(published.reason));
    const current = await state(); assert.equal(current.versions[0].status, 'RETIRED');
    assert(!(await readKnowledgeSnapshot(db)).activeReferences.some(ref => ref.documentId === 'qa-document'));
    assert.equal(current.control?.generation, published.status === 'fulfilled' ? 2 : 1);
    assert.equal(current.auditCount, published.status === 'fulfilled' ? 4 : 3);
  });
  await scenario('editorial note persists server actor and exact manifest without review or publication', async () => {
    const release = await stage(editor, input(), db), before = await state();
    const note = await addNote(other, release.id, noteInput(release.manifestHash), db);
    assert.equal(note.authorId, other.userId); assert.equal(note.id, noteRequestId);
    assert.equal(note.body, noteInput(release.manifestHash).body); assert(Number.isFinite(Date.parse(note.createdAt)));
    const row = await db.assistantKnowledgeReviewNote.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(row.tenantId, other.tenantId); assert.equal(row.authorId, other.userId);
    assert.equal(row.releaseId, release.id); assert.equal(row.manifestHash, release.manifestHash);
    const after = await state(); assert.deepEqual({ ...after, auditCount: before.auditCount }, before);
    assert.equal(after.release?.status, 'DRAFT'); assert.equal(after.release?.reviewedAt, null);
    assert.equal(after.release?.publishedAt, null); assert.equal(after.control?.activeReleaseId, null);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'ASSISTANT_KNOWLEDGE_NOTE_ADDED' } });
    assert.equal(audit.tenantId, other.tenantId); assert.equal(audit.userId, other.userId);
    const details = JSON.parse(audit.details!);
    assert.equal(details.releaseId, release.id); assert.equal(details.manifestHash, release.manifestHash);
    assert.equal(details.noteId, note.id); assert.equal(details.after.authorId, other.userId);
    assert(!audit.details!.includes(note.body)); assert.equal(after.auditCount, before.auditCount + 1);
  });
  await scenario('same note request replays once before and after later explicit publication', async () => {
    const release = await stage(editor, input(), db), request = noteInput(release.manifestHash);
    const first = await addNote(editor, release.id, request, db);
    assert.deepEqual(await addNote(editor, release.id, { ...request, body: `  ${request.body}  ` }, db), first);
    assert.equal(await db.assistantKnowledgeReviewNote.count(), 1);
    assert.equal(await db.auditLog.count({ where: { action: 'ASSISTANT_KNOWLEDGE_NOTE_ADDED' } }), 1);
    await review(editor, decision(release), db); await publish(other, decision(release), db);
    const before = await state(); assert.deepEqual(await addNote(editor, release.id, request, db), first);
    assert.deepEqual(await state(), before); assert.equal(await db.assistantKnowledgeReviewNote.count(), 1);
  });
  await scenario('note identity rejects changed body, actor, tenant, release or manifest without writes', async () => {
    const release = await stage(editor, input(), db), second = await stage(editor, input('qa-second-release'), db);
    const request = noteInput(release.manifestHash); await addNote(editor, release.id, request, db);
    const before = await state();
    await assert.rejects(addNote(editor, release.id, { ...request, body: 'Otra observación sintética incompatible.' }, db), code('KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT'));
    await assert.rejects(addNote(other, release.id, request, db), code('KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT'));
    await assert.rejects(addNote(otherTenant, release.id, request, db), code('KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT'));
    await assert.rejects(addNote(editor, second.id, { ...request, manifestHash: second.manifestHash }, db), code('KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT'));
    await assert.rejects(addNote(editor, release.id, { ...request, manifestHash: '0'.repeat(64) }, db), code('KNOWLEDGE_REVIEW_STALE'));
    assert.deepEqual(await state(), before); assert.equal(await db.assistantKnowledgeReviewNote.count(), 1);
  });
  await scenario('note audit trigger failure rolls back the note and preserves editorial state', async () => {
    const release = await stage(editor, input(), db), before = await state(); await failAudit();
    await assert.rejects(addNote(other, release.id, noteInput(release.manifestHash), db), auditFailure);
    assert.equal(await db.assistantKnowledgeReviewNote.count(), 0); assert.deepEqual(await state(), before);
  });
  await scenario('two concurrent identical note requests persist one note and one audit', async () => {
    const release = await stage(editor, input(), db), request = noteInput(release.manifestHash);
    const attempts = await Promise.allSettled([addNote(editor, release.id, request, db), addNote(editor, release.id, request, db)]);
    const failed = attempts.find(attempt => attempt.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
    assert.equal(attempts[0].status, 'fulfilled'); assert.equal(attempts[1].status, 'fulfilled');
    assert.deepEqual((attempts[0] as PromiseFulfilledResult<unknown>).value, (attempts[1] as PromiseFulfilledResult<unknown>).value);
    assert.equal(await db.assistantKnowledgeReviewNote.count(), 1);
    assert.equal(await db.auditLog.count({ where: { action: 'ASSISTANT_KNOWLEDGE_NOTE_ADDED' } }), 1);
    assert.equal((await state()).release?.status, 'DRAFT');
  });
  await scenario('review note foreign key rejects missing releases and preserves referenced release', async () => {
    const release = await stage(editor, input(), db); await addNote(editor, release.id, noteInput(release.manifestHash), db);
    await assert.rejects(db.assistantKnowledgeRelease.delete({ where: { id: release.id } }), code('P2003'));
    await assert.rejects(db.assistantKnowledgeReviewNote.create({ data: { id: '8cb04cb3-42bf-4ba1-aae7-605aef4655f8', releaseId: 'qa-missing-release',
      manifestHash: release.manifestHash, tenantId: editor.tenantId, authorId: editor.userId, body: 'Nota huérfana sintética.' } }), code('P2003'));
    assert.equal(await db.assistantKnowledgeRelease.count(), 1); assert.equal(await db.assistantKnowledgeReviewNote.count(), 1);
    const indexes = await db.$queryRaw<{ columnName: string }[]>`SELECT COLUMN_NAME AS columnName FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AssistantKnowledgeReviewNote'
      AND INDEX_NAME = 'AssistantKnowledgeReviewNote_releaseId_createdAt_id_idx' ORDER BY SEQ_IN_INDEX`;
    assert.deepEqual(indexes.map(row => row.columnName), ['releaseId', 'createdAt', 'id']);
  });
  await scenario('editorial note checks current actor and rejects supplied author fields', async () => {
    const release = await stage(editor, input(), db), request = noteInput(release.manifestHash), before = await state();
    await assert.rejects(addNote(editor, release.id, { ...request, authorId: other.userId }, db), error => error instanceof Error && error.name === 'ZodError');
    await db.$executeRaw`UPDATE User SET status = 'DISABLED' WHERE id = ${editor.userId}`;
    await assert.rejects(addNote(editor, release.id, request, db), code('KNOWLEDGE_EDITOR_REQUIRED'));
    await db.$executeRaw`UPDATE User SET status = 'ACTIVE', role = 'ADMIN' WHERE id = ${editor.userId}`;
    await assert.rejects(addNote(editor, release.id, request, db), code('KNOWLEDGE_EDITOR_REQUIRED'));
    assert.equal(await db.assistantKnowledgeReviewNote.count(), 0); assert.deepEqual(await state(), before);
  });
  await assertOwned();
  process.stdout.write(JSON.stringify({ status: 'PASSED', testRunner: 'dedicated-tsx-assert', total: results.length, passed: results.length, failed: 0,
    skipped: 0, cases: results, realProviderCalls: 0, financialDomainTables: 0 }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'FAILED', testRunner: 'dedicated-tsx-assert', planned, executed: results.length + 1,
    passed: results.length, failed: 1, notExecuted: planned - results.length - 1, failedScenario: activeScenario, cases: results,
    scenarioError: { name: error?.name, code: error?.code, message: String(error?.message ?? error).slice(-2500) },
    realProviderCalls: 0, financialDomainTables: 0 }) + '\n');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
