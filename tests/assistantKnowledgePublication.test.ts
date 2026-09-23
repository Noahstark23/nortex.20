import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeDb } from './assistantKnowledgeStore.support';
import { ASSISTANT_HELP_ARTICLES } from '../backend/services/assistant/knowledge';
import { LEGACY_KNOWLEDGE, canonicalManifest, digest, payloadHash } from '../backend/services/assistant/knowledge/model';
import { getAssistantKnowledgePassage, getAssistantKnowledgeRevision, KNOWLEDGE_UNAVAILABLE_TEXT, referencesFromCitations,
  retrievePublishedAssistantHelp, validateAssistantKnowledgeReferences } from '../backend/services/assistant/knowledge/service';
import { getAssistantCapabilities, AssistantAccessError } from '../backend/services/assistant/access';

vi.mock('../backend/services/assistant/access', async importOriginal => ({ ...await importOriginal<any>(), getAssistantCapabilities: vi.fn() }));
const principal = { tenantId: 'synthetic', userId: 'reader', role: 'OWNER' };
const capabilities = { enabled: true, help: true, inventory: true, privateWhatsapp: true };
const access = vi.mocked(getAssistantCapabilities);
beforeEach(() => { vi.clearAllMocks(); access.mockResolvedValue(capabilities as any); });

describe('Ayuda publicada: pasajes exactos y retirada durable', () => {
  it('consulta legacy sin sembrar y entrega hash y pasaje exacto', async () => {
    const { db } = knowledgeDb();
    const result = await retrievePublishedAssistantHelp(principal, 'factura proveedor compra', db);
    expect(result.citations[0].id).toBe('compras');
    const passage = await getAssistantKnowledgePassage(principal, result.knowledgeReferences[0], db);
    expect(passage.body).toBe(LEGACY_KNOWLEDGE.find(d => d.reference.documentId === 'compras')!.payload.body);
    expect(passage.publication).toBe('LEGACY');
    expect(passage.historical).toBe(false);
    expect(db.assistantKnowledgeControl.upsert).not.toHaveBeenCalled();
    expect(db.assistantKnowledgeVersion.create).not.toHaveBeenCalled();
  });
  it('sin tablas o lectura completa, falla cerrado sin retornar contenido compilado', async () => {
    const { db } = knowledgeDb();
    db.assistantKnowledgeVersion.findMany.mockRejectedValue(new Error('table unavailable'));
    expect(await retrievePublishedAssistantHelp(principal, 'compras', db)).toEqual({ text: KNOWLEDGE_UNAVAILABLE_TEXT, citations: [], knowledgeReferences: [] });
    await expect(getAssistantKnowledgePassage(principal, LEGACY_KNOWLEDGE[0].reference, db)).rejects.toMatchObject({ statusCode: 503 });
    expect(await getAssistantKnowledgeRevision(db)).toEqual({ revision: 'unavailable', available: false });
  });
  it('tombstone legacy impide búsqueda y pasaje sin exponer título/cuerpo', async () => {
    const { db, state } = knowledgeDb();
    const doc = LEGACY_KNOWLEDGE.find(d => d.reference.documentId === 'compras')!;
    state.versions.push({ ...doc.reference, payload: doc.payload, status: 'RETIRED' });
    const response = await retrievePublishedAssistantHelp(principal, 'compras', db);
    expect(response.citations).toEqual([]);
    await expect(getAssistantKnowledgePassage(principal, doc.reference, db)).rejects.toMatchObject({ statusCode: 404, code: 'ASSISTANT_KNOWLEDGE_NOT_FOUND' });
    expect(await validateAssistantKnowledgeReferences(principal, [doc.reference], db)).toBe(false);
  });
  it('filtra rol/capacidad/canal antes de seleccionar fuentes', async () => {
    const { db } = knowledgeDb();
    const role = { ...principal, role: 'BODEGUERO' };
    expect((await retrievePublishedAssistantHelp(role, 'contabilidad ganancias', db)).citations).toEqual([]);
    const doc = LEGACY_KNOWLEDGE.find(d => d.reference.documentId === 'contabilidad')!;
    await expect(getAssistantKnowledgePassage(role, doc.reference, db)).rejects.toMatchObject({ statusCode: 404 });
    access.mockResolvedValue({ ...capabilities, privateWhatsapp: false } as any);
    await expect(retrievePublishedAssistantHelp(principal, 'compras', db, 'WHATSAPP_PRIVATE')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('revalida identidad al entregar y nunca conserva contenido con sesión revocada', async () => {
    const { db } = knowledgeDb();
    access.mockResolvedValueOnce(capabilities as any).mockRejectedValueOnce(new AssistantAccessError(403, 'SESSION_REVOKED', 'revoked'));
    await expect(retrievePublishedAssistantHelp(principal, 'compras', db)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('un cambio de publicación entre lectura y entrega invalida la respuesta', async () => {
    const { db, state } = knowledgeDb();
    db.assistantKnowledgeVersion.findMany.mockImplementationOnce(async () => { state.control = { generation: 1, activeReleaseId: null }; return []; });
    expect((await retrievePublishedAssistantHelp(principal, 'compras', db)).text).toBe(KNOWLEDGE_UNAVAILABLE_TEXT);
  });
  it('no acepta hash equivocado ni IDs que intentan usar una ruta como fuente', async () => {
    const { db } = knowledgeDb();
    await expect(getAssistantKnowledgePassage(principal, { ...LEGACY_KNOWLEDGE[0].reference, contentHash: '0'.repeat(64) }, db)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getAssistantKnowledgePassage(principal, { ...LEGACY_KNOWLEDGE[0].reference, documentId: '../secret' }, db)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('adapta sólo citas legacy exactas; rutas arbitrarias nunca cambian la identidad', () => {
    expect(referencesFromCitations([])).toEqual([]);
    expect(referencesFromCitations([{ ...ASSISTANT_HELP_ARTICLES[0].citation, path: 'https://not-a-source.invalid' }])).toEqual([LEGACY_KNOWLEDGE[0].reference]);
    expect(referencesFromCitations([{ ...ASSISTANT_HELP_ARTICLES[0].citation, section: 'otra sección' }])).toBeNull();
    expect(referencesFromCitations([{ ...ASSISTANT_HELP_ARTICLES[0].citation, version: 'unknown' }])).toBeNull();
    expect(referencesFromCitations([{ ...ASSISTANT_HELP_ARTICLES[0].citation, contentHash: '0'.repeat(64) }])).toBeNull();
  });
  it('una publicación completa sustituye retrieval pero conserva fuentes históricas autorizadas', async () => {
    const { db, state } = knowledgeDb();
    const payload = { ...LEGACY_KNOWLEDGE[0].payload, body: 'Contenido revisado sintético.', requiredCapabilities: ['inventory'] };
    const ref = { documentId: 'synthetic-article', version: '1', sectionId: 'main', contentHash: payloadHash(payload) };
    const manifest = canonicalManifest({ formatVersion: 1, references: [ref] });
    state.control = { generation: 1, activeReleaseId: 'r1' };
    state.releases.push({ id: 'r1', status: 'PUBLISHED', formatVersion: 1, manifest, manifestHash: digest(manifest), reviewedById: 'editor', reviewedAt: new Date(), publishedAt: new Date() });
    state.versions.push({ ...ref, payload, status: 'PUBLISHED' });
    expect((await retrievePublishedAssistantHelp(principal, 'nortexgpt', db)).knowledgeReferences).toEqual([ref]);
    expect((await getAssistantKnowledgePassage(principal, LEGACY_KNOWLEDGE[0].reference, db)).historical).toBe(true);
    access.mockResolvedValue({ ...capabilities, inventory: false } as any);
    expect((await retrievePublishedAssistantHelp(principal, 'nortexgpt', db)).citations).toEqual([]);
    await expect(getAssistantKnowledgePassage(principal, ref, db)).rejects.toMatchObject({ statusCode: 404 });
    state.versions.length = 0;
    expect((await getAssistantKnowledgeRevision(db)).available).toBe(false);
  });
  it('valida 64 referencias históricas con una lectura bulk, sin multiplicar consultas por pasaje', async () => {
    const { db, state } = knowledgeDb();
    const payload = LEGACY_KNOWLEDGE[0].payload;
    const refs = Array.from({ length: 64 }, (_, i) => ({ documentId: `historical-${i}`, version: '1', sectionId: 'main', contentHash: payloadHash(payload) }));
    state.versions.push(...refs.map(ref => ({ ...ref, payload, status: 'PUBLISHED' })));
    expect(await validateAssistantKnowledgeReferences(principal, refs, db)).toBe(true);
    expect(db.assistantKnowledgeVersion.findMany).toHaveBeenCalledTimes(2);
    expect(access).toHaveBeenCalledTimes(2);
    expect(db.assistantKnowledgeVersion.findUnique).not.toHaveBeenCalled();
    state.versions[63].status = 'RETIRED';
    expect(await validateAssistantKnowledgeReferences(principal, refs, db)).toBe(false);
  });
  it('rechaza referencias contradictorias o payload histórico alterado bajo el mismo hash', async () => {
    const { db, state } = knowledgeDb();
    const ref = LEGACY_KNOWLEDGE[0].reference;
    expect(await validateAssistantKnowledgeReferences(principal, [ref, { ...ref, contentHash: '0'.repeat(64) }], db)).toBe(false);
    const historical = { ...ref, documentId: 'historical-one' };
    state.versions.push({ ...historical, payload: { ...LEGACY_KNOWLEDGE[0].payload, body: 'Contenido sustituido.' }, status: 'PUBLISHED' });
    expect(await validateAssistantKnowledgeReferences(principal, [historical], db)).toBe(false);
  });
  it('una fuente retirada de un manifiesto no vuelve por rollback ni oculta fuentes válidas restantes', async () => {
    const { db, state } = knowledgeDb();
    const docs = LEGACY_KNOWLEDGE.slice(0, 2);
    const manifest = canonicalManifest({ formatVersion: 1, references: docs.map(d => d.reference) });
    state.control = { generation: 5, activeReleaseId: 'old-release' };
    state.releases.push({ id: 'old-release', status: 'PUBLISHED', formatVersion: 1, manifest, manifestHash: digest(manifest), reviewedById: 'editor', reviewedAt: new Date(), publishedAt: new Date() });
    state.versions.push(...docs.map((doc, i) => ({ ...doc.reference, payload: doc.payload, status: i ? 'PUBLISHED' : 'RETIRED' })));
    expect((await retrievePublishedAssistantHelp(principal, 'nortexgpt', db)).citations).toEqual([]);
    expect((await retrievePublishedAssistantHelp(principal, 'vender cobrar', db)).citations[0].id).toBe('ventas');
    await expect(getAssistantKnowledgePassage(principal, docs[0].reference, db)).rejects.toMatchObject({ statusCode: 404 });
  });
});
