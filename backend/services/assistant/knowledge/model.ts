import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AssistantKnowledgeReference } from '../../../../shared/assistantKnowledge.js';
import { ASSISTANT_HELP_ARTICLES } from '../knowledge.js';
import { ASSISTANT_KNOWN_ROLES } from '../access.js';

export const KNOWLEDGE_CONTROL_ID = 'official';
export const knowledgeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const referenceSchema = z.object({
  documentId: knowledgeId, version: knowledgeId.max(64), sectionId: knowledgeId.max(64),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const capabilities = ['help', 'overview', 'inventory', 'invoiceRead', 'invoicePrepare', 'invoiceConfirm',
  'extractionEnabled', 'executionEnabled', 'purchasePrepare', 'operations', 'dailyBrief',
  'actionPrepare', 'actionConfirm', 'promotionManage', 'privateWhatsapp', 'budgetManage', 'cashReview'] as const;
export const payloadSchema = z.object({
  title: z.string().trim().min(1).max(160), section: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(16000),
  roles: z.array(z.string().refine(role => ASSISTANT_KNOWN_ROLES.includes(role))).min(1).max(24),
  requiredCapabilities: z.array(z.enum(capabilities)).min(1).max(20),
  channels: z.array(z.enum(['WEB_INTERNAL', 'WHATSAPP_PRIVATE'])).min(1).max(2),
  keywords: z.string().trim().min(1).max(2000),
}).strict();
export type KnowledgePayload = z.infer<typeof payloadSchema>;
export interface KnowledgeDocument { reference: AssistantKnowledgeReference; payload: KnowledgePayload }
export const manifestSchema = z.object({ formatVersion: z.literal(1), references: z.array(referenceSchema).min(1).max(60) }).strict();
export type KnowledgeManifest = z.infer<typeof manifestSchema>;

export function canonicalPayload(input: unknown): KnowledgePayload {
  const p = payloadSchema.parse(input);
  return { title: p.title, section: p.section, body: p.body, roles: [...new Set(p.roles)].sort(),
    requiredCapabilities: [...new Set(p.requiredCapabilities)].sort(), channels: [...new Set(p.channels)].sort(), keywords: p.keywords };
}
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const payloadHash = (input: unknown): string => digest(canonicalPayload(input));
export const referenceKey = (ref: Pick<AssistantKnowledgeReference, 'documentId' | 'version' | 'sectionId'>): string => `${ref.documentId}/${ref.version}/${ref.sectionId}`;
export function canonicalManifest(input: unknown): KnowledgeManifest {
  const parsed = manifestSchema.parse(input);
  const references = parsed.references.map(r => ({ documentId: r.documentId, version: r.version, sectionId: r.sectionId, contentHash: r.contentHash }))
    .sort((a, b) => referenceKey(a).localeCompare(referenceKey(b), 'en'));
  if (new Set(references.map(referenceKey)).size !== references.length) throw new Error('KNOWLEDGE_DUPLICATE_REFERENCE');
  if (new Set(references.map(ref => `${ref.documentId}/${ref.sectionId}`)).size !== references.length) throw new Error('KNOWLEDGE_AMBIGUOUS_MANIFEST');
  return { formatVersion: 1, references };
}

/** Compatibilidad explícita: estos doce textos no reciben una aprobación editorial ficticia. */
export const LEGACY_KNOWLEDGE: readonly KnowledgeDocument[] = ASSISTANT_HELP_ARTICLES.map(article => {
  const payload = canonicalPayload({ title: article.citation.title, section: article.citation.section,
    body: article.answer, roles: article.roles, requiredCapabilities: ['help'],
    channels: ['WEB_INTERNAL', 'WHATSAPP_PRIVATE'], keywords: article.keywords });
  return { reference: { documentId: article.citation.id, version: article.citation.version, sectionId: 'main', contentHash: payloadHash(payload) }, payload };
});

export function legacyDocument(reference: Pick<AssistantKnowledgeReference, 'documentId' | 'version' | 'sectionId'>): KnowledgeDocument | undefined {
  return LEGACY_KNOWLEDGE.find(document => referenceKey(document.reference) === referenceKey(reference));
}
