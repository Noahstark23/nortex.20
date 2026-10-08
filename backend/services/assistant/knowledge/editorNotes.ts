import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { KnowledgeEditorialNote } from '../../../../shared/assistantKnowledgeEditorial.js';
import { AssistantAccessError } from '../access.js';
import { audit, withEditorialLock } from './editorAccess.js';
import { checkedEditorialManifest } from './editorial.js';
import { knowledgeId } from './model.js';

export const editorialNoteInput = z.object({ requestId: z.uuid(), manifestHash: z.string().regex(/^[a-f0-9]{64}$/), body: z.string().trim().min(10).max(2000) }).strict();
/** Una observación no decide el estado ni atribuye revisión. Su identidad permite recuperar respuesta perdida. */
export async function addKnowledgeEditorialNote(principal: AssistantPrincipal, releaseId: string, input: unknown, db: PrismaClient): Promise<KnowledgeEditorialNote> {
  knowledgeId.parse(releaseId);
  const parsed = editorialNoteInput.parse(input);
  return withEditorialLock(principal, db, async tx => {
    const release = await tx.assistantKnowledgeRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw new AssistantAccessError(404, 'KNOWLEDGE_RELEASE_NOT_FOUND', 'No se encontró esa publicación.');
    checkedEditorialManifest(release);
    if (release.manifestHash !== parsed.manifestHash) throw new AssistantAccessError(409, 'KNOWLEDGE_REVIEW_STALE', 'La observación no coincide con el manifiesto exacto.');
    const existing = await tx.assistantKnowledgeReviewNote.findUnique({ where: { id: parsed.requestId } });
    if (existing) {
      if (existing.releaseId !== releaseId || existing.manifestHash !== parsed.manifestHash || existing.authorId !== principal.userId || existing.tenantId !== principal.tenantId || existing.body !== parsed.body)
        throw new AssistantAccessError(409, 'KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT', 'Esa observación ya tiene otro contenido o autor.');
      return { id: existing.id, body: existing.body, authorId: existing.authorId, createdAt: existing.createdAt.toISOString() };
    }
    const note = await tx.assistantKnowledgeReviewNote.create({ data: { id: parsed.requestId, releaseId, manifestHash: parsed.manifestHash,
      tenantId: principal.tenantId, authorId: principal.userId, body: parsed.body } });
    await audit(tx, principal, 'ASSISTANT_KNOWLEDGE_NOTE_ADDED', { releaseId, manifestHash: parsed.manifestHash, noteId: note.id,
      before: null, after: { noteId: note.id, authorId: principal.userId } });
    return { id: note.id, body: note.body, authorId: note.authorId, createdAt: note.createdAt.toISOString() };
  });
}
