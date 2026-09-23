import type { PrismaClient } from '@prisma/client';
import type { AssistantKnowledgeReference } from '../../../../shared/assistantKnowledge.js';
import { AssistantAccessError } from '../access.js';
import { canonicalManifest, canonicalPayload, digest, KNOWLEDGE_CONTROL_ID, legacyDocument, LEGACY_KNOWLEDGE, payloadHash, referenceKey, type KnowledgeDocument } from './model.js';

export const KNOWLEDGE_UNAVAILABLE_TEXT = 'La ayuda consultada ya no está disponible o cambió tu acceso. Volvé a consultar antes de usar esa respuesta.';
export const unavailable = () => new AssistantAccessError(503, 'ASSISTANT_KNOWLEDGE_UNAVAILABLE', 'La biblioteca de ayuda no está disponible. Intentá de nuevo más tarde.');
export const notFound = () => new AssistantAccessError(404, 'ASSISTANT_KNOWLEDGE_NOT_FOUND', 'Esta fuente no está disponible para tu sesión.');
export type PublishedDocument = KnowledgeDocument & { publication: 'LEGACY' | 'PUBLISHED' };
export interface KnowledgeSnapshot { revision: string; activeReferences: AssistantKnowledgeReference[]; documents: PublishedDocument[] }
export const revisionOf = (control: { activeReleaseId: string | null; generation: number } | null) => `${control?.generation ?? 0}:${control?.activeReleaseId ?? 'legacy'}`;

/** Sólo lecturas. La ausencia de tablas nunca habilita el corpus compilado. */
export async function readKnowledgeSnapshot(db: PrismaClient): Promise<KnowledgeSnapshot> {
  try {
    const control = await db.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID } });
    const revision = revisionOf(control);
    if (!control?.activeReleaseId) {
      const rows = await db.assistantKnowledgeVersion.findMany({ where: { OR: LEGACY_KNOWLEDGE.map(d => ({
        documentId: d.reference.documentId, version: d.reference.version, sectionId: d.reference.sectionId,
      })) }, take: LEGACY_KNOWLEDGE.length });
      const existing = new Map(rows.map(row => [referenceKey(row), row]));
      const documents = LEGACY_KNOWLEDGE.filter(doc => {
        const row = existing.get(referenceKey(doc.reference));
        if (!row) return true;
        if (row.status === 'RETIRED') return false;
        if (!['DRAFT', 'PUBLISHED'].includes(row.status)) throw unavailable();
        if (row.contentHash !== doc.reference.contentHash || payloadHash(row.payload) !== row.contentHash) throw unavailable();
        return true;
      }).map(doc => ({ ...doc, publication: 'LEGACY' as const }));
      await assertRevision(db, revision);
      return { revision, documents, activeReferences: documents.map(doc => doc.reference) };
    }
    const release = await db.assistantKnowledgeRelease.findUnique({ where: { id: control.activeReleaseId } });
    if (!release || release.status !== 'PUBLISHED' || release.formatVersion !== 1 || !release.reviewedById || !release.reviewedAt || !release.publishedAt) throw unavailable();
    const manifest = canonicalManifest(release.manifest);
    if (digest(manifest) !== release.manifestHash) throw unavailable();
    const rows = await db.assistantKnowledgeVersion.findMany({ where: { OR: manifest.references.map(ref => ({ documentId: ref.documentId, version: ref.version, sectionId: ref.sectionId })) }, take: 60 });
    const documents: PublishedDocument[] = [];
    for (const ref of manifest.references) {
      const row = rows.find(candidate => referenceKey(candidate) === referenceKey(ref));
      if (!row || row.contentHash !== ref.contentHash || payloadHash(row.payload) !== ref.contentHash) throw unavailable();
      if (row.status === 'RETIRED') continue;
      if (row.status !== 'PUBLISHED') throw unavailable();
      documents.push({ reference: ref as AssistantKnowledgeReference, payload: canonicalPayload(row.payload), publication: 'PUBLISHED' });
    }
    await assertRevision(db, revision);
    return { revision, documents, activeReferences: documents.map(doc => doc.reference) };
  } catch { throw unavailable(); }
}

export async function assertRevision(db: PrismaClient, revision: string): Promise<void> {
  const current = await db.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID } });
  if (revisionOf(current) !== revision) throw unavailable();
}

/** Una consulta acotada para todas las fuentes históricas; no hace N lecturas por referencia. */
export async function resolveKnowledgeDocuments(refs: Array<Pick<AssistantKnowledgeReference, 'documentId' | 'version' | 'sectionId'>>,
  snapshot: KnowledgeSnapshot, db: PrismaClient): Promise<Map<string, PublishedDocument>> {
  const found = new Map(snapshot.documents.map(doc => [referenceKey(doc.reference), doc]));
  const missing = [...new Map(refs.filter(ref => !found.has(referenceKey(ref))).map(ref => [referenceKey(ref), ref])).values()];
  if (!missing.length) return found;
  try {
    const rows = await db.assistantKnowledgeVersion.findMany({ where: { OR: missing.map(({ documentId, version, sectionId }) => ({ documentId, version, sectionId })) }, take: 64 });
    for (const ref of missing) {
      const row = rows.find(item => referenceKey(item) === referenceKey(ref));
      if (row?.status === 'RETIRED') continue;
      if (row && payloadHash(row.payload) !== row.contentHash) throw unavailable();
      if (row?.status === 'PUBLISHED') {
        found.set(referenceKey(ref), { reference: { documentId: row.documentId, version: row.version, sectionId: row.sectionId, contentHash: row.contentHash },
          payload: canonicalPayload(row.payload), publication: 'PUBLISHED' });
      } else {
        const legacy = legacyDocument(ref);
        if (legacy && (!row || (row.status === 'DRAFT' && row.contentHash === legacy.reference.contentHash))) found.set(referenceKey(ref), { ...legacy, publication: 'LEGACY' });
      }
    }
    return found;
  } catch { throw unavailable(); }
}
