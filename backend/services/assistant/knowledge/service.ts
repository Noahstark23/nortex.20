import type { PrismaClient } from '@prisma/client';
import type { AssistantCapabilities, AssistantCitation, AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantKnowledgeChannel, AssistantKnowledgePassage, AssistantKnowledgeReference } from '../../../../shared/assistantKnowledge.js';
import { AssistantAccessError, getAssistantCapabilities } from '../access.js';
import { normalizeAssistantText } from '../knowledge.js';
import { knowledgeId, legacyDocument, referenceKey, referenceSchema, type KnowledgePayload } from './model.js';
import { assertRevision, KNOWLEDGE_UNAVAILABLE_TEXT, notFound, readKnowledgeSnapshot, resolveKnowledgeDocuments } from './store.js';
export { KNOWLEDGE_UNAVAILABLE_TEXT } from './store.js';

async function access(principal: AssistantPrincipal, db: PrismaClient, channel: AssistantKnowledgeChannel): Promise<AssistantCapabilities> {
  const caps = await getAssistantCapabilities(principal, db);
  if (!caps.enabled || !caps.help || (channel === 'WHATSAPP_PRIVATE' && !caps.privateWhatsapp) || !['WEB_INTERNAL', 'WHATSAPP_PRIVATE'].includes(channel)) {
    throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu sesión no tiene acceso a esta ayuda.');
  }
  return caps;
}
const visible = (p: KnowledgePayload, principal: AssistantPrincipal, caps: AssistantCapabilities, channel: AssistantKnowledgeChannel) =>
  p.roles.includes(principal.role) && p.channels.includes(channel) && p.requiredCapabilities.every(capability => caps[capability] === true);
const citationFor = (ref: AssistantKnowledgeReference, p: KnowledgePayload): AssistantCitation => ({ id: ref.documentId, title: p.title, section: p.section,
  version: ref.version, sectionId: ref.sectionId, contentHash: ref.contentHash, path: `nortex-help:${ref.documentId}` });
const stopWords = new Set(['como', 'para', 'puedo', 'quiero', 'donde', 'esto', 'esta', 'hacer', 'tengo', 'ayuda', 'sobre', 'una', 'uno', 'los', 'las', 'del', 'con', 'sus', 'mis', 'que']);

export async function retrievePublishedAssistantHelp(principal: AssistantPrincipal, query: string, db: PrismaClient, channel: AssistantKnowledgeChannel = 'WEB_INTERNAL'):
Promise<{ text: string; citations: AssistantCitation[]; knowledgeReferences: AssistantKnowledgeReference[] }> {
  const caps = await access(principal, db, channel);
  try {
    const snapshot = await readKnowledgeSnapshot(db);
    const tokens = [...new Set(normalizeAssistantText(query).match(/[a-z0-9]{3,}/g) || [])].filter(token => !stopWords.has(token)).slice(0, 40);
    // Se conserva el ranking lexical de la base; la mejora de relevancia requiere su evaluación propia.
    const ranked = snapshot.documents.filter(d => visible(d.payload, principal, caps, channel)).map(doc => {
      const words = new Set(normalizeAssistantText(`${doc.payload.section} ${doc.payload.keywords}`).split(/\s+/));
      return { doc, score: tokens.reduce((n, token) => n + (words.has(token) ? 1 : 0), 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || referenceKey(a.doc.reference).localeCompare(referenceKey(b.doc.reference))).slice(0, 2);
    const currentCaps = await access(principal, db, channel);
    if (ranked.some(({ doc }) => !visible(doc.payload, principal, currentCaps, channel))) throw notFound();
    await assertRevision(db, snapshot.revision);
    return { text: ranked.length ? ranked.map(({ doc }) => doc.payload.body).join('\n\n') : 'No encontré una respuesta en la ayuda disponible para tu rol. Podés consultar sobre NortexGPT o una función que tengas habilitada.',
      citations: ranked.map(({ doc }) => citationFor(doc.reference, doc.payload)), knowledgeReferences: ranked.map(({ doc }) => doc.reference) };
  } catch (error) {
    if (error instanceof AssistantAccessError && [401, 403].includes(error.statusCode)) throw error;
    return { text: KNOWLEDGE_UNAVAILABLE_TEXT, citations: [], knowledgeReferences: [] };
  }
}

export async function getAssistantKnowledgePassage(principal: AssistantPrincipal, reference: { documentId: string; version: string; sectionId: string; contentHash?: string }, db: PrismaClient,
  channel: AssistantKnowledgeChannel = 'WEB_INTERNAL'): Promise<AssistantKnowledgePassage> {
  const caps = await access(principal, db, channel);
  if (![reference.documentId, reference.version, reference.sectionId].every(id => knowledgeId.safeParse(id).success) || reference.version.length > 64 || reference.sectionId.length > 64) throw notFound();
  const snapshot = await readKnowledgeSnapshot(db);
  const doc = (await resolveKnowledgeDocuments([reference], snapshot, db)).get(referenceKey(reference));
  if (!doc || (reference.contentHash !== undefined && doc.reference.contentHash !== reference.contentHash) || !visible(doc.payload, principal, caps, channel)) throw notFound();
  const currentCaps = await access(principal, db, channel);
  if (!visible(doc.payload, principal, currentCaps, channel)) throw notFound();
  await assertRevision(db, snapshot.revision);
  return { reference: doc.reference, title: doc.payload.title, section: doc.payload.section, body: doc.payload.body, publication: doc.publication,
    historical: !snapshot.activeReferences.some(ref => referenceKey(ref) === referenceKey(doc.reference)), revision: snapshot.revision };
}

export async function validateAssistantKnowledgeReferences(principal: AssistantPrincipal, refs: AssistantKnowledgeReference[], db: PrismaClient,
  channel: AssistantKnowledgeChannel = 'WEB_INTERNAL'): Promise<boolean> {
  try {
    const caps = await access(principal, db, channel);
    if (!Array.isArray(refs) || refs.length > 64 || refs.some(ref => !referenceSchema.safeParse(ref).success)) return false;
    const unique = [...new Map(refs.map(ref => [referenceKey(ref), ref])).values()];
    if (unique.length !== refs.length && refs.some(ref => unique.find(r => referenceKey(r) === referenceKey(ref))?.contentHash !== ref.contentHash)) return false;
    if (!unique.length) return true;
    const snapshot = await readKnowledgeSnapshot(db);
    const documents = await resolveKnowledgeDocuments(unique, snapshot, db);
    const valid = (current: AssistantCapabilities) => unique.every(ref => {
      const doc = documents.get(referenceKey(ref));
      return !!doc && doc.reference.contentHash === ref.contentHash && visible(doc.payload, principal, current, channel);
    });
    if (!valid(caps) || !valid(await access(principal, db, channel))) return false;
    await assertRevision(db, snapshot.revision);
    return true;
  } catch { return false; }
}

export async function getAssistantKnowledgeRevision(db: PrismaClient): Promise<{ revision: string; available: boolean }> {
  try { return { revision: (await readKnowledgeSnapshot(db)).revision, available: true }; }
  catch { return { revision: 'unavailable', available: false }; }
}

/** Adapta sólo identidades exactas; path/títulos recibidos nunca conceden acceso ni se abren como URL. */
export function referencesFromCitations(citations: AssistantCitation[]): AssistantKnowledgeReference[] | null {
  if (!Array.isArray(citations) || citations.length > 64) return null;
  const result: AssistantKnowledgeReference[] = [];
  for (const cite of citations) {
    if (!cite || typeof cite.id !== 'string' || typeof cite.version !== 'string' || typeof cite.title !== 'string' || typeof cite.section !== 'string') return null;
    if (cite.sectionId && cite.contentHash) {
      const ref = referenceSchema.safeParse({ documentId: cite.id, version: cite.version, sectionId: cite.sectionId, contentHash: cite.contentHash });
      if (!ref.success) return null;
      result.push(ref.data as AssistantKnowledgeReference);
    } else {
      if (cite.sectionId || cite.contentHash) return null;
      const doc = legacyDocument({ documentId: cite.id, version: cite.version, sectionId: 'main' });
      if (!doc || doc.payload.section !== cite.section || doc.payload.title !== cite.title) return null;
      result.push(doc.reference);
    }
  }
  return result;
}
