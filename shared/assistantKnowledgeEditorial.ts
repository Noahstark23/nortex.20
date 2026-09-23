import type { AssistantKnowledgeChannel, AssistantKnowledgeReference } from './assistantKnowledge';

export type KnowledgeReleaseStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'RETIRED';
export interface KnowledgeEditorialPayload {
  title: string; section: string; body: string; keywords: string;
  roles: string[]; requiredCapabilities: string[]; channels: AssistantKnowledgeChannel[];
}
export interface KnowledgeEditorialDocument {
  reference: AssistantKnowledgeReference;
  payload: KnowledgeEditorialPayload;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | 'LEGACY';
}
export interface KnowledgeEditorialReleaseSummary {
  id: string; formatVersion: number; status: KnowledgeReleaseStatus; manifestHash: string;
  createdAt: string; createdById: string; reviewedById: string | null; reviewedAt: string | null;
  publishedAt: string | null; retiredAt: string | null; documentsCount: number; active: boolean;
}
export interface KnowledgeEditorialNote {
  id: string; body: string; authorId: string; createdAt: string;
}
export interface KnowledgeEditorialReleaseDetail extends KnowledgeEditorialReleaseSummary {
  documents: KnowledgeEditorialDocument[];
  notes: KnowledgeEditorialNote[];
  nextNotesCursor: string | null;
}
export interface KnowledgeEditorialList {
  releases: KnowledgeEditorialReleaseSummary[]; nextCursor: string | null;
}
export interface KnowledgeEditorialCapabilities { canEdit: true; actor: { id: string; name: string } }
export interface KnowledgeEditorialDecision { id: string; status: string; manifestHash: string }
