import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { KnowledgeEditorialCapabilities, KnowledgeEditorialDocument, KnowledgeEditorialList,
  KnowledgeEditorialNote, KnowledgeEditorialReleaseDetail, KnowledgeEditorialReleaseSummary } from '../../../../shared/assistantKnowledgeEditorial.js';
import { AssistantAccessError } from '../access.js';
import { authorizeEditor } from './editorAccess.js';
import { canonicalManifest, canonicalPayload, digest, KNOWLEDGE_CONTROL_ID, knowledgeId,
  LEGACY_KNOWLEDGE, payloadHash, referenceKey } from './model.js';

const PAGE_SIZE = 20;
export const releaseStatus = z.enum(['DRAFT', 'REVIEWED', 'PUBLISHED', 'RETIRED']);
const cursorBase = z.object({ createdAt: z.iso.datetime(), id: knowledgeId });
const releaseCursor = cursorBase.extend({ status: releaseStatus }).strict();
const notesCursor = cursorBase.extend({ releaseId: knowledgeId }).strict();
export const editorialListQuery = z.object({ status: releaseStatus.default('DRAFT'), cursor: z.string().max(600).optional() }).strict();
export const editorialNotesQuery = z.object({ cursor: z.string().max(600).optional() }).strict();
const releaseSelect = { id: true, formatVersion: true, status: true, manifest: true, manifestHash: true, createdAt: true,
  createdById: true, reviewedById: true, reviewedAt: true, publishedAt: true, retiredAt: true } as const;
const noteSelect = { id: true, body: true, authorId: true, createdAt: true } as const;
type ReleaseRow = Prisma.AssistantKnowledgeReleaseGetPayload<{ select: typeof releaseSelect }>;
const unavailable = (): never => { throw new AssistantAccessError(503, 'KNOWLEDGE_EDITORIAL_UNAVAILABLE', 'No se pudo comprobar el contenido editorial.'); };
const encodeCursor = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
function decodeCursor<T extends z.ZodType>(raw: string | undefined, schema: T): z.infer<T> | undefined {
  if (raw === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    return schema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch { throw new AssistantAccessError(400, 'KNOWLEDGE_CURSOR_INVALID', 'El cursor de la lista no es válido.'); }
}
export function checkedEditorialManifest(row: Pick<ReleaseRow, 'manifest' | 'manifestHash' | 'formatVersion'>) {
  try {
    const manifest = canonicalManifest(row.manifest);
    if (row.formatVersion !== 1 || digest(manifest) !== row.manifestHash) return unavailable();
    return manifest;
  } catch { return unavailable(); }
}
function summary(row: ReleaseRow, activeReleaseId: string | null): KnowledgeEditorialReleaseSummary {
  const manifest = checkedEditorialManifest(row);
  const status = releaseStatus.safeParse(row.status);
  if (!status.success) return unavailable();
  return { id: row.id, formatVersion: row.formatVersion, status: status.data, manifestHash: row.manifestHash,
    createdAt: row.createdAt.toISOString(), createdById: row.createdById, reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, publishedAt: row.publishedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null, documentsCount: manifest.references.length,
    active: activeReleaseId === row.id };
}
const toNote = (row: Prisma.AssistantKnowledgeReviewNoteGetPayload<{ select: typeof noteSelect }>): KnowledgeEditorialNote =>
  ({ id: row.id, body: row.body, authorId: row.authorId, createdAt: row.createdAt.toISOString() });

export async function getKnowledgeEditorialCapabilities(principal: AssistantPrincipal, db: PrismaClient): Promise<KnowledgeEditorialCapabilities> {
  await authorizeEditor(principal, db);
  const actor = await authorizeEditor(principal, db);
  return { canEdit: true, actor: { id: actor.id, name: actor.name } };
}
/** Corpus oficial global: ninguna lectura siembra o publica datos. */
export async function listKnowledgeEditorialReleases(principal: AssistantPrincipal, input: unknown, db: PrismaClient): Promise<KnowledgeEditorialList> {
  await authorizeEditor(principal, db);
  const query = editorialListQuery.parse(input), cursor = decodeCursor(query.cursor, releaseCursor);
  if (cursor && cursor.status !== query.status) throw new AssistantAccessError(400, 'KNOWLEDGE_CURSOR_INVALID', 'El cursor pertenece a otra lista.');
  const rows = await db.assistantKnowledgeRelease.findMany({ where: { status: query.status,
    ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1, select: releaseSelect });
  const control = await db.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID }, select: { activeReleaseId: true } });
  const page = rows.slice(0, PAGE_SIZE), last = page.at(-1);
  const result = { releases: page.map(row => summary(row, control?.activeReleaseId ?? null)),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, status: query.status }) : null };
  await authorizeEditor(principal, db);
  return result;
}

async function readNotePage(releaseId: string, input: unknown, db: PrismaClient) {
  const query = editorialNotesQuery.parse(input), cursor = decodeCursor(query.cursor, notesCursor);
  if (cursor && cursor.releaseId !== releaseId) throw new AssistantAccessError(400, 'KNOWLEDGE_CURSOR_INVALID', 'El cursor pertenece a otra publicación.');
  const rows = await db.assistantKnowledgeReviewNote.findMany({ where: { releaseId,
    ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1, select: noteSelect });
  const page = rows.slice(0, PAGE_SIZE), last = page.at(-1);
  return { notes: page.map(toNote), nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, releaseId }) : null };
}
async function releaseOr404(id: string, db: PrismaClient) {
  const row = await db.assistantKnowledgeRelease.findUnique({ where: { id: knowledgeId.parse(id) }, select: releaseSelect });
  if (!row) throw new AssistantAccessError(404, 'KNOWLEDGE_RELEASE_NOT_FOUND', 'No se encontró esa publicación.');
  checkedEditorialManifest(row);
  return row;
}
export async function listKnowledgeEditorialNotes(principal: AssistantPrincipal, id: string, input: unknown, db: PrismaClient) {
  await authorizeEditor(principal, db);
  await releaseOr404(id, db);
  const result = await readNotePage(id, input, db);
  await authorizeEditor(principal, db);
  return result;
}
export async function getKnowledgeEditorialRelease(principal: AssistantPrincipal, id: string, db: PrismaClient): Promise<KnowledgeEditorialReleaseDetail> {
  await authorizeEditor(principal, db);
  const row = await releaseOr404(id, db), manifest = checkedEditorialManifest(row);
  const versions = await db.assistantKnowledgeVersion.findMany({ where: { OR: manifest.references.map(({ documentId, version, sectionId }) => ({ documentId, version, sectionId })) },
    take: 60, select: { documentId: true, version: true, sectionId: true, contentHash: true, payload: true, status: true } });
  const documents: KnowledgeEditorialDocument[] = manifest.references.map(reference => {
    const version = versions.find(item => referenceKey(item) === referenceKey(reference));
    try {
      if (!version || version.contentHash !== reference.contentHash || payloadHash(version.payload) !== reference.contentHash) return unavailable();
      const status = z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']).parse(version.status);
      return { reference, payload: canonicalPayload(version.payload), status };
    } catch { return unavailable(); }
  });
  const control = await db.assistantKnowledgeControl.findUnique({ where: { id: KNOWLEDGE_CONTROL_ID }, select: { activeReleaseId: true } });
  const notes = await readNotePage(id, {}, db);
  const result = { ...summary(row, control?.activeReleaseId ?? null), documents, notes: notes.notes, nextNotesCursor: notes.nextCursor };
  await authorizeEditor(principal, db);
  return result;
}
/** LEGACY no acredita revisión humana, y conserva los tombstones de versiones retiradas. */
export async function listKnowledgeEditorialLegacy(principal: AssistantPrincipal, db: PrismaClient): Promise<{ documents: KnowledgeEditorialDocument[] }> {
  await authorizeEditor(principal, db);
  const rows = await db.assistantKnowledgeVersion.findMany({ where: { OR: LEGACY_KNOWLEDGE.map(({ reference: { documentId, version, sectionId } }) => ({ documentId, version, sectionId })) },
    take: LEGACY_KNOWLEDGE.length, select: { documentId: true, version: true, sectionId: true, contentHash: true, status: true, payload: true } });
  const documents: KnowledgeEditorialDocument[] = LEGACY_KNOWLEDGE.map(document => {
    const row = rows.find(item => referenceKey(item) === referenceKey(document.reference));
    if (row) {
      try { if (row.contentHash !== document.reference.contentHash || payloadHash(row.payload) !== document.reference.contentHash || !['DRAFT', 'PUBLISHED', 'RETIRED'].includes(row.status)) return unavailable(); }
      catch { return unavailable(); }
    }
    return { ...document, status: row?.status === 'RETIRED' ? 'RETIRED' : 'LEGACY' };
  });
  await authorizeEditor(principal, db);
  return { documents };
}
