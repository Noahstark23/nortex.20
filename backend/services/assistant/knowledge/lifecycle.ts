import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { audit, withEditorialLock } from './editorAccess.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { AssistantAccessError } from '../access.js';
import { canonicalManifest, canonicalPayload, digest, KNOWLEDGE_CONTROL_ID, knowledgeId, legacyDocument, payloadHash,
  payloadSchema, referenceKey, referenceSchema } from './model.js';

export const stageInput = z.object({ id: knowledgeId, formatVersion: z.literal(1), documents: z.array(z.object({
  documentId: knowledgeId, version: knowledgeId.max(64), sectionId: knowledgeId.max(64), payload: payloadSchema,
}).strict()).min(1).max(60) }).strict();
const decisionInput = z.object({ releaseId: knowledgeId, manifestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const retirementInput = z.object({ reference: referenceSchema, reason: z.string().trim().min(10).max(500) }).strict();
const fail = (code: string, message: string, status = 409): never => { throw new AssistantAccessError(status, code, message); };
type Tx = Prisma.TransactionClient;

function releaseView(row: { id: string; status: string; manifestHash: string }) { return { id: row.id, status: row.status, manifestHash: row.manifestHash }; }

/** Alta explícita, inmutable e idempotente. Nunca publica ni declara revisado un texto. */
export async function stageAssistantKnowledgeRelease(principal: AssistantPrincipal, input: unknown, db: PrismaClient) {
  const parsed = stageInput.parse(input);
  const documents = parsed.documents.map(doc => ({ documentId: doc.documentId, version: doc.version, sectionId: doc.sectionId,
    payload: canonicalPayload(doc.payload), contentHash: payloadHash(doc.payload) }));
  if (new Set(documents.map(doc => `${doc.documentId}/${doc.sectionId}`)).size !== documents.length) fail('KNOWLEDGE_AMBIGUOUS_MANIFEST', 'Cada sección necesita una sola versión en la publicación.', 400);
  if (Buffer.byteLength(JSON.stringify(documents)) > 512_000) fail('KNOWLEDGE_MANIFEST_TOO_LARGE', 'La publicación supera el tamaño permitido.', 400);
  const manifest = canonicalManifest({ formatVersion: 1, references: documents.map(({ payload: _payload, ...reference }) => reference) });
  const manifestHash = digest(manifest);
  return withEditorialLock(principal, db, async tx => {
    const existing = await tx.assistantKnowledgeRelease.findUnique({ where: { id: parsed.id } });
    if (existing) {
      if (existing.manifestHash !== manifestHash || digest(canonicalManifest(existing.manifest)) !== manifestHash) fail('KNOWLEDGE_RELEASE_IMMUTABLE', 'Esa publicación ya tiene otro contenido. Creá una identidad nueva.');
      if (existing.status === 'RETIRED') fail('KNOWLEDGE_RETIRED', 'Una publicación retirada no se puede reactivar.');
      return releaseView(existing);
    }
    const rows = await tx.assistantKnowledgeVersion.findMany({ where: { OR: documents.map(({ documentId, version, sectionId }) => ({ documentId, version, sectionId })) }, take: 60 });
    const missing: typeof documents = [];
    for (const doc of documents) {
      const row = rows.find(value => referenceKey(value) === referenceKey(doc));
      const legacy = legacyDocument(doc);
      if (legacy && legacy.reference.contentHash !== doc.contentHash) fail('KNOWLEDGE_VERSION_IMMUTABLE', 'No se puede reemplazar el contenido de una versión legacy.');
      if (row?.status === 'RETIRED') fail('KNOWLEDGE_RETIRED', 'Una versión retirada no se puede reactivar.');
      if (row && (row.contentHash !== doc.contentHash || payloadHash(row.payload) !== doc.contentHash)) fail('KNOWLEDGE_VERSION_IMMUTABLE', 'El contenido de esa versión ya está fijado. Usá una versión nueva.');
      if (!row) missing.push(doc);
    }
    if (missing.length) await tx.assistantKnowledgeVersion.createMany({ data: missing.map(doc => ({ ...doc, payload: doc.payload as Prisma.InputJsonValue, status: 'DRAFT' })) });
    const row = await tx.assistantKnowledgeRelease.create({ data: { id: parsed.id, formatVersion: 1, manifest: manifest as Prisma.InputJsonValue,
      manifestHash, createdById: principal.userId, status: 'DRAFT' } });
    await audit(tx, principal, 'ASSISTANT_KNOWLEDGE_STAGED', { releaseId: row.id, manifestHash, count: documents.length, before: null, after: { status: 'DRAFT' } });
    return releaseView(row);
  });
}

async function releaseForDecision(tx: Tx, input: z.infer<typeof decisionInput>) {
  const row = await tx.assistantKnowledgeRelease.findUnique({ where: { id: input.releaseId } });
  if (!row) fail('KNOWLEDGE_RELEASE_NOT_FOUND', 'No se encontró esa publicación.', 404);
  if (row.formatVersion !== 1 || row.manifestHash !== input.manifestHash || digest(canonicalManifest(row.manifest)) !== input.manifestHash) fail('KNOWLEDGE_REVIEW_STALE', 'La revisión no coincide con el manifiesto exacto.');
  const manifest = canonicalManifest(row.manifest);
  const versions = await tx.assistantKnowledgeVersion.findMany({ where: { OR: manifest.references.map(({ documentId, version, sectionId }) => ({ documentId, version, sectionId })) }, take: 60 });
  for (const ref of manifest.references) {
    const version = versions.find(item => referenceKey(item) === referenceKey(ref));
    if (!version || !['DRAFT', 'PUBLISHED'].includes(version.status) || version.contentHash !== ref.contentHash || payloadHash(version.payload) !== ref.contentHash) fail('KNOWLEDGE_REVIEW_STALE', 'Una fuente fue retirada o ya no coincide con el manifiesto.');
  }
  return { row, manifest };
}

/** Sólo llamar tras revisión humana explícita del hash; no forma parte de herramientas del modelo. */
export async function reviewAssistantKnowledgeRelease(principal: AssistantPrincipal, input: unknown, db: PrismaClient) {
  const parsed = decisionInput.parse(input);
  return withEditorialLock(principal, db, async tx => {
    const { row } = await releaseForDecision(tx, parsed);
    if (row.status === 'REVIEWED' && row.reviewedById === principal.userId) return releaseView(row);
    if (row.status !== 'DRAFT') fail('KNOWLEDGE_REVIEW_STATE', 'La publicación ya no está en borrador.');
    const updated = await tx.assistantKnowledgeRelease.update({ where: { id: row.id }, data: { status: 'REVIEWED', reviewedById: principal.userId, reviewedAt: new Date() } });
    await audit(tx, principal, 'ASSISTANT_KNOWLEDGE_REVIEWED', { releaseId: row.id, manifestHash: row.manifestHash, before: { status: row.status }, after: { status: 'REVIEWED' } });
    return releaseView(updated);
  });
}

export async function publishAssistantKnowledgeRelease(principal: AssistantPrincipal, input: unknown, db: PrismaClient) {
  const parsed = decisionInput.parse(input);
  return withEditorialLock(principal, db, async tx => {
    const { row, manifest } = await releaseForDecision(tx, parsed);
    if (!['REVIEWED', 'PUBLISHED'].includes(row.status) || !row.reviewedById || !row.reviewedAt) fail('KNOWLEDGE_HUMAN_REVIEW_REQUIRED', 'La publicación requiere revisión humana del manifiesto exacto.');
    const reviewer = await tx.user.findFirst({ where: { id: row.reviewedById, role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true } });
    if (!reviewer) fail('KNOWLEDGE_REVIEWER_REVOKED', 'La revisión necesita una cuenta editorial vigente.');
    const before = await tx.assistantKnowledgeControl.findUniqueOrThrow({ where: { id: KNOWLEDGE_CONTROL_ID } });
    if (before.activeReleaseId === row.id && row.status === 'PUBLISHED') return releaseView(row);
    await tx.assistantKnowledgeVersion.updateMany({ where: { OR: manifest.references.map(({ documentId, version, sectionId }) => ({ documentId, version, sectionId })), status: 'DRAFT' }, data: { status: 'PUBLISHED' } });
    const updated = await tx.assistantKnowledgeRelease.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: row.publishedAt ?? new Date() } });
    await tx.assistantKnowledgeControl.update({ where: { id: KNOWLEDGE_CONTROL_ID }, data: { activeReleaseId: row.id, generation: { increment: 1 } } });
    await audit(tx, principal, 'ASSISTANT_KNOWLEDGE_PUBLISHED', { releaseId: row.id, manifestHash: row.manifestHash,
      before: { activeReleaseId: before.activeReleaseId, generation: before.generation }, after: { activeReleaseId: row.id, generation: before.generation + 1 } });
    return releaseView(updated);
  });
}

/** Tombstone permanente: un rollback de archivos o de manifiesto no devuelve una versión retirada. */
export async function retireAssistantKnowledgeVersion(principal: AssistantPrincipal, input: unknown, db: PrismaClient) {
  const parsed = retirementInput.parse(input), ref = parsed.reference;
  return withEditorialLock(principal, db, async tx => {
    const where = { documentId_version_sectionId: { documentId: ref.documentId, version: ref.version, sectionId: ref.sectionId } };
    const row = await tx.assistantKnowledgeVersion.findUnique({ where });
    const legacy = legacyDocument(ref);
    if (!row && (!legacy || legacy.reference.contentHash !== ref.contentHash)) fail('KNOWLEDGE_VERSION_NOT_FOUND', 'No se encontró esa versión exacta.', 404);
    if (row && row.contentHash !== ref.contentHash) fail('KNOWLEDGE_REVIEW_STALE', 'La referencia no coincide con esa versión.');
    if (row?.status === 'RETIRED') return { reference: ref, status: 'RETIRED' as const };
    if (row) await tx.assistantKnowledgeVersion.update({ where, data: { status: 'RETIRED', retiredAt: new Date() } });
    else await tx.assistantKnowledgeVersion.create({ data: { documentId: ref.documentId, version: ref.version, sectionId: ref.sectionId,
      contentHash: ref.contentHash, payload: legacy.payload as Prisma.InputJsonValue, status: 'RETIRED', retiredAt: new Date() } });
    const control = await tx.assistantKnowledgeControl.update({ where: { id: KNOWLEDGE_CONTROL_ID }, data: { generation: { increment: 1 } } });
    await audit(tx, principal, 'ASSISTANT_KNOWLEDGE_RETIRED', { reference: ref, reason: parsed.reason, generation: control.generation,
      before: { status: row?.status ?? 'LEGACY' }, after: { status: 'RETIRED' } });
    return { reference: ref, status: 'RETIRED' as const };
  });
}
