import { describe, expect, it } from 'vitest';
import { knowledgeDb } from './assistantKnowledgeStore.support';
import { LEGACY_KNOWLEDGE } from '../backend/services/assistant/knowledge/model';
import { stageAssistantKnowledgeRelease, reviewAssistantKnowledgeRelease, publishAssistantKnowledgeRelease, retireAssistantKnowledgeVersion } from '../backend/services/assistant/knowledge/lifecycle';

const editor = { tenantId: 'synthetic-editor-tenant', userId: 'editor', role: 'SUPER_ADMIN' };
const input = { id: 'release-synthetic', formatVersion: 1, documents: [{ documentId: 'synthetic-help', version: '1', sectionId: 'main', payload: LEGACY_KNOWLEDGE[0].payload }] };
const decision = (row: { id: string; manifestHash: string }) => ({ releaseId: row.id, manifestHash: row.manifestHash });
describe('Ciclo editorial de ayuda oficial (doble transaccional)', () => {
  it('stage no publica ni inventa revisor; publish exige revisión exacta', async () => {
    const { db, state } = knowledgeDb();
    const draft = await stageAssistantKnowledgeRelease(editor, input, db);
    expect(draft.status).toBe('DRAFT');
    expect(state.control.activeReleaseId).toBeNull();
    expect(state.releases[0].reviewedById).toBeUndefined();
    await expect(publishAssistantKnowledgeRelease(editor, decision(draft), db)).rejects.toMatchObject({ code: 'KNOWLEDGE_HUMAN_REVIEW_REQUIRED' });
    await expect(reviewAssistantKnowledgeRelease(editor, { ...decision(draft), manifestHash: '0'.repeat(64) }, db)).rejects.toMatchObject({ code: 'KNOWLEDGE_REVIEW_STALE' });
    await reviewAssistantKnowledgeRelease(editor, decision(draft), db);
    expect(state.releases[0].reviewedById).toBe(editor.userId);
    await publishAssistantKnowledgeRelease(editor, decision(draft), db);
    expect(state.control).toMatchObject({ activeReleaseId: draft.id, generation: 1 });
    expect(state.versions[0].status).toBe('PUBLISHED');
    expect(state.audits.map(a => a.action)).toEqual(['ASSISTANT_KNOWLEDGE_STAGED', 'ASSISTANT_KNOWLEDGE_REVIEWED', 'ASSISTANT_KNOWLEDGE_PUBLISHED']);
  });
  it('repetir stage y publish conserva una publicación y una generación', async () => {
    const { db, state } = knowledgeDb();
    const row = await stageAssistantKnowledgeRelease(editor, input, db);
    await stageAssistantKnowledgeRelease(editor, input, db);
    await reviewAssistantKnowledgeRelease(editor, decision(row), db);
    await publishAssistantKnowledgeRelease(editor, decision(row), db);
    await publishAssistantKnowledgeRelease(editor, decision(row), db);
    expect(state.releases).toHaveLength(1);
    expect(state.versions).toHaveLength(1);
    expect(state.control.generation).toBe(1);
    expect(state.audits).toHaveLength(3);
  });
  it('edición exige identidades nuevas; versión publicada nunca se reemplaza', async () => {
    const { db } = knowledgeDb();
    await stageAssistantKnowledgeRelease(editor, input, db);
    const changed = { ...input, documents: [{ ...input.documents[0], payload: { ...input.documents[0].payload, body: 'Otra instrucción.' } }] };
    await expect(stageAssistantKnowledgeRelease(editor, changed, db)).rejects.toMatchObject({ code: 'KNOWLEDGE_RELEASE_IMMUTABLE' });
    await expect(stageAssistantKnowledgeRelease(editor, { ...changed, id: 'new-release' }, db)).rejects.toMatchObject({ code: 'KNOWLEDGE_VERSION_IMMUTABLE' });
  });
  it('retirada legacy queda durable y un rollback no la republica', async () => {
    const { db, state } = knowledgeDb();
    const legacy = LEGACY_KNOWLEDGE[0];
    await retireAssistantKnowledgeVersion(editor, { reference: legacy.reference, reason: 'Fuente sintética retirada para prueba.' }, db);
    expect(state.versions[0].status).toBe('RETIRED');
    expect(state.control.generation).toBe(1);
    await retireAssistantKnowledgeVersion(editor, { reference: legacy.reference, reason: 'Fuente sintética retirada para prueba.' }, db);
    expect(state.control.generation).toBe(1);
    await expect(stageAssistantKnowledgeRelease(editor, { ...input, documents: [{ ...legacy.reference, contentHash: undefined, payload: legacy.payload }] }, db)).rejects.toThrow();
    const { contentHash: _, ...identity } = legacy.reference;
    await expect(stageAssistantKnowledgeRelease(editor, { ...input, documents: [{ ...identity, payload: legacy.payload }] }, db)).rejects.toMatchObject({ code: 'KNOWLEDGE_RETIRED' });
  });
  it('retirada posterior a revisión bloquea publicación aunque el hash siga igual', async () => {
    const { db, state } = knowledgeDb();
    const row = await stageAssistantKnowledgeRelease(editor, input, db);
    await reviewAssistantKnowledgeRelease(editor, decision(row), db);
    const { documentId, version, sectionId, contentHash } = state.versions[0];
    await retireAssistantKnowledgeVersion(editor, { reference: { documentId, version, sectionId, contentHash }, reason: 'Retirada de una fuente revisada.' }, db);
    await expect(publishAssistantKnowledgeRelease(editor, decision(row), db)).rejects.toMatchObject({ code: 'KNOWLEDGE_REVIEW_STALE' });
    expect(state.control.activeReleaseId).toBeNull();
  });
  it('sin editor vigente no crea control ni cambia contenido', async () => {
    const { db, state } = knowledgeDb();
    await expect(stageAssistantKnowledgeRelease({ ...editor, role: 'OWNER' }, input, db)).rejects.toMatchObject({ statusCode: 403 });
    state.active = false;
    await expect(stageAssistantKnowledgeRelease(editor, input, db)).rejects.toMatchObject({ statusCode: 403 });
    expect(state.control).toBeNull();
    expect(state.releases).toHaveLength(0);
  });
  it('revocación durante espera del lock impide mutación', async () => {
    const { db, state } = knowledgeDb();
    db.$queryRaw.mockImplementationOnce(async () => { state.active = false; return []; });
    await expect(stageAssistantKnowledgeRelease(editor, input, db)).rejects.toMatchObject({ statusCode: 403 });
    expect(state.releases).toHaveLength(0);
  });
  it('fallo de auditoría revierte publicación y generación junto a sus estados', async () => {
    const { db, state } = knowledgeDb();
    const row = await stageAssistantKnowledgeRelease(editor, input, db);
    await reviewAssistantKnowledgeRelease(editor, decision(row), db);
    state.auditFails = true;
    await expect(publishAssistantKnowledgeRelease(editor, decision(row), db)).rejects.toThrow('synthetic audit failure');
    expect(state.control).toMatchObject({ activeReleaseId: null, generation: 0 });
    expect(state.releases[0].status).toBe('REVIEWED');
    expect(state.versions[0].status).toBe('DRAFT');
  });
});
