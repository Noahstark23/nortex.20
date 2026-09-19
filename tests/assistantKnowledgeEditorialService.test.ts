import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeDb } from './assistantKnowledgeStore.support';
import { LEGACY_KNOWLEDGE } from '../backend/services/assistant/knowledge/model';
import { stageAssistantKnowledgeRelease } from '../backend/services/assistant/knowledge/lifecycle';
import { addKnowledgeEditorialNote } from '../backend/services/assistant/knowledge/editorNotes';
import { getKnowledgeEditorialCapabilities, getKnowledgeEditorialRelease, listKnowledgeEditorialLegacy,
  listKnowledgeEditorialNotes, listKnowledgeEditorialReleases } from '../backend/services/assistant/knowledge/editorial';

const editor = { tenantId: 'synthetic-editor-tenant', userId: 'editor', role: 'SUPER_ADMIN' };
const time = new Date('2026-09-19T12:00:00.000Z');
const input = { id: 'release-synthetic', formatVersion: 1, documents: [{ documentId: 'synthetic-help', version: '1', sectionId: 'main', payload: LEGACY_KNOWLEDGE[0].payload }] };
const requestId = '9e5d7db4-26e7-4e4e-adfb-85eedc1b83ce';
function fixture() {
  const result = knowledgeDb(), state: any = result.state, db = result.db;
  state.notes = [];
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (value instanceof Date) return row[key].getTime() === value.getTime();
    if (value && typeof value === 'object' && 'lt' in value) return row[key] < value.lt;
    return row[key] === value;
  });
  const findMany = (key: string) => vi.fn(async ({ where, take }: any) => state[key].filter((row: any) => matches(row, where))
    .sort((a: any, b: any) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, take));
  db.user.findFirst.mockImplementation(async () => state.active ? { id: editor.userId, name: 'Revisor sintético' } : null);
  const originalCreate = db.assistantKnowledgeRelease.create.getMockImplementation();
  db.assistantKnowledgeRelease.create.mockImplementation(async ({ data }: any) => originalCreate({ data: { createdAt: time, reviewedById: null, reviewedAt: null, publishedAt: null, retiredAt: null, ...data } }));
  db.assistantKnowledgeRelease.findMany = findMany('releases');
  db.assistantKnowledgeReviewNote = {
    findMany: findMany('notes'),
    findUnique: vi.fn(async ({ where }: any) => state.notes.find((note: any) => note.id === where.id) ?? null),
    create: vi.fn(async ({ data }: any) => { const note = { ...data, createdAt: time }; state.notes.push(note); return note; }),
  };
  return { db, state };
}
async function staged() {
  const h = fixture();
  const release = await stageAssistantKnowledgeRelease(editor, input, h.db);
  h.state.audits.length = 0;
  return { ...h, release, note: { requestId, manifestHash: release.manifestHash, body: 'Revisar la unidad del producto antes de publicar.' } };
}
beforeEach(() => vi.restoreAllMocks());

describe('Consulta editorial global autorizada y acotada', () => {
  it('capabilities usa identidad y nombre vigentes sin depender de flags IA', async () => {
    const { db } = fixture();
    expect(await getKnowledgeEditorialCapabilities(editor, db)).toEqual({ canEdit: true, actor: { id: editor.userId, name: 'Revisor sintético' } });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: editor.userId, tenantId: editor.tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true, name: true } });
  });
  it('rol ordinario o revocado no recupera corpus global', async () => {
    const { db, state } = fixture();
    await expect(listKnowledgeEditorialLegacy({ ...editor, role: 'OWNER' }, db)).rejects.toMatchObject({ statusCode: 403 });
    state.active = false;
    await expect(listKnowledgeEditorialReleases(editor, {}, db)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.assistantKnowledgeVersion.findMany).not.toHaveBeenCalled();
    expect(db.assistantKnowledgeRelease.findMany).not.toHaveBeenCalled();
  });
  it('lista usa 20 + 1 y cursor estable por fecha e identidad sin duplicar página', async () => {
    const h = await staged();
    const baseline = h.state.releases[0];
    h.state.releases = Array.from({ length: 22 }, (_, i) => ({ ...baseline, id: `release-${String(i).padStart(2, '0')}` }));
    const first = await listKnowledgeEditorialReleases(editor, {}, h.db);
    expect(first.releases).toHaveLength(20);
    expect(first.releases[0]).toMatchObject({ id: 'release-21', status: 'DRAFT', documentsCount: 1, active: false });
    const second = await listKnowledgeEditorialReleases(editor, { cursor: first.nextCursor }, h.db);
    expect(second.releases.map(row => row.id)).toEqual(['release-01', 'release-00']);
    expect(second.nextCursor).toBeNull();
    expect(h.db.assistantKnowledgeRelease.findMany.mock.calls.every(([query]: any) => query.take === 21)).toBe(true);
    expect(h.state.audits).toHaveLength(0);
  });
  it('rechaza cursor de otro estado y query de autoridad enviada por cliente', async () => {
    const h = await staged();
    const cursor = Buffer.from(JSON.stringify({ createdAt: time.toISOString(), id: input.id, status: 'PUBLISHED' })).toString('base64url');
    await expect(listKnowledgeEditorialReleases(editor, { cursor }, h.db)).rejects.toMatchObject({ code: 'KNOWLEDGE_CURSOR_INVALID' });
    await expect(listKnowledgeEditorialReleases(editor, { tenantId: 'forged' }, h.db)).rejects.toThrow();
  });
  it('detalle entrega el hash y pasaje exactos incluso para revisar una versión retirada', async () => {
    const h = await staged();
    h.state.versions[0].status = 'RETIRED';
    const result = await getKnowledgeEditorialRelease(editor, input.id, h.db);
    expect(result).toMatchObject({ manifestHash: h.release.manifestHash, status: 'DRAFT', documents: [{ status: 'RETIRED', payload: LEGACY_KNOWLEDGE[0].payload }], notes: [], nextNotesCursor: null });
    expect(h.state.audits).toHaveLength(0);
    expect(h.db.assistantKnowledgeVersion.createMany).toHaveBeenCalledTimes(1); // Sólo el stage explícito del fixture.
  });
  it.each(['manifest', 'payload', 'missing'] as const)('integridad %s falla cerrada sin entregar datos parciales', async fault => {
    const h = await staged();
    if (fault === 'manifest') h.state.releases[0].manifestHash = 'a'.repeat(64);
    if (fault === 'payload') h.state.versions[0].payload = { ...h.state.versions[0].payload, body: 'Contenido alterado.' };
    if (fault === 'missing') h.state.versions.length = 0;
    await expect(getKnowledgeEditorialRelease(editor, input.id, h.db)).rejects.toMatchObject({ statusCode: 503, code: 'KNOWLEDGE_EDITORIAL_UNAVAILABLE' });
  });
  it('revalida el permiso después de recuperar contenido', async () => {
    const h = await staged();
    h.db.assistantKnowledgeReviewNote.findMany.mockImplementation(async () => { h.state.active = false; return []; });
    await expect(getKnowledgeEditorialRelease(editor, input.id, h.db)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('LEGACY muestra doce textos y tombstone sin crear control ni filas', async () => {
    const h = fixture(), legacy = LEGACY_KNOWLEDGE[0];
    h.state.versions.push({ ...legacy.reference, payload: legacy.payload, status: 'RETIRED' });
    const result = await listKnowledgeEditorialLegacy(editor, h.db);
    expect(result.documents).toHaveLength(12);
    expect(result.documents[0].status).toBe('RETIRED');
    expect(result.documents[1].status).toBe('LEGACY');
    expect(h.state.control).toBeNull();
    expect(h.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('un fallo de registro legacy nunca supone que la ayuda sigue vigente', async () => {
    const h = fixture();
    h.db.assistantKnowledgeVersion.findMany.mockRejectedValue(new Error('synthetic storage failure'));
    await expect(listKnowledgeEditorialLegacy(editor, h.db)).rejects.toThrow();
  });
  it('notas tienen página acotada y cursor ligado a publicación', async () => {
    const h = await staged();
    h.state.notes = Array.from({ length: 22 }, (_, i) => ({ id: `note-${String(i).padStart(2, '0')}`, releaseId: input.id, body: 'Observación editorial sintética.', authorId: editor.userId, createdAt: time }));
    const first = await listKnowledgeEditorialNotes(editor, input.id, {}, h.db);
    expect(first.notes).toHaveLength(20);
    expect((await listKnowledgeEditorialNotes(editor, input.id, { cursor: first.nextCursor }, h.db)).notes).toHaveLength(2);
    const cursor = Buffer.from(JSON.stringify({ createdAt: time.toISOString(), id: 'note-01', releaseId: 'other-release' })).toString('base64url');
    await expect(listKnowledgeEditorialNotes(editor, input.id, { cursor }, h.db)).rejects.toMatchObject({ code: 'KNOWLEDGE_CURSOR_INVALID' });
  });
});

describe('Observaciones idempotentes con auditoría atómica (doble transaccional)', () => {
  it('nota atribuye actor del servidor y no marca revisado ni publica', async () => {
    const h = await staged();
    const note = await addKnowledgeEditorialNote(editor, input.id, h.note, h.db);
    expect(note).toMatchObject({ id: requestId, authorId: editor.userId, body: h.note.body });
    expect(h.state.notes[0]).toMatchObject({ tenantId: editor.tenantId, manifestHash: h.release.manifestHash });
    expect(h.state.releases[0]).toMatchObject({ status: 'DRAFT', reviewedById: null });
    expect(h.state.control.activeReleaseId).toBeNull();
    expect(h.state.audits[0]).toMatchObject({ action: 'ASSISTANT_KNOWLEDGE_NOTE_ADDED', tenantId: editor.tenantId, userId: editor.userId });
    expect(h.state.audits[0].details).not.toContain(h.note.body);
  });
  it('replay exacto devuelve la nota incluso con estado posterior sin duplicar auditoría', async () => {
    const h = await staged();
    const first = await addKnowledgeEditorialNote(editor, input.id, h.note, h.db);
    h.state.releases[0].status = 'PUBLISHED';
    expect(await addKnowledgeEditorialNote(editor, input.id, { ...h.note, body: ` ${h.note.body} ` }, h.db)).toEqual(first);
    expect(h.state.notes).toHaveLength(1);
    expect(h.state.audits).toHaveLength(1);
  });
  it.each(['body', 'actor', 'tenant', 'release'] as const)('identidad reutilizada con %s distinto se rechaza', async changed => {
    const h = await staged();
    await addKnowledgeEditorialNote(editor, input.id, h.note, h.db);
    let principal = editor, releaseId = input.id, note = h.note;
    if (changed === 'body') note = { ...note, body: 'Esta es otra observación editorial.' };
    if (changed === 'actor') principal = { ...editor, userId: 'another-editor' };
    if (changed === 'tenant') principal = { ...editor, tenantId: 'another-tenant' };
    if (changed === 'release') { releaseId = 'another-release'; h.state.releases.push({ ...h.state.releases[0], id: releaseId }); }
    await expect(addKnowledgeEditorialNote(principal, releaseId, note, h.db)).rejects.toMatchObject({ code: 'KNOWLEDGE_NOTE_IDEMPOTENCY_CONFLICT', statusCode: 409 });
    expect(h.state.notes).toHaveLength(1);
  });
  it('hash obsoleto y autor externo no crean nota', async () => {
    const h = await staged();
    await expect(addKnowledgeEditorialNote(editor, input.id, { ...h.note, manifestHash: 'f'.repeat(64) }, h.db)).rejects.toMatchObject({ code: 'KNOWLEDGE_REVIEW_STALE' });
    await expect(addKnowledgeEditorialNote(editor, input.id, { ...h.note, authorId: 'forged' }, h.db)).rejects.toThrow();
    expect(h.state.notes).toHaveLength(0);
  });
  it('fallo de auditoría revierte la nota; revocación durante lock impide crearlo', async () => {
    const h = await staged();
    h.state.auditFails = true;
    await expect(addKnowledgeEditorialNote(editor, input.id, h.note, h.db)).rejects.toThrow('synthetic audit failure');
    expect(h.state.notes).toHaveLength(0);
    h.state.auditFails = false;
    h.db.$queryRaw.mockImplementationOnce(async () => { h.state.active = false; return []; });
    await expect(addKnowledgeEditorialNote(editor, input.id, h.note, h.db)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.state.notes).toHaveLength(0);
  });
});
