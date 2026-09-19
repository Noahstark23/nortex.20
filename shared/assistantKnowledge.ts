/** Identidad de ayuda oficial; nunca contiene datos privados del negocio. */
export type AssistantKnowledgeChannel = 'WEB_INTERNAL' | 'WHATSAPP_PRIVATE';
export interface AssistantKnowledgeReference {
  documentId: string;
  version: string;
  sectionId: string;
  contentHash: string;
}
export interface AssistantKnowledgePassage {
  reference: AssistantKnowledgeReference;
  title: string;
  section: string;
  body: string;
  publication: 'LEGACY' | 'PUBLISHED';
  historical: boolean;
  revision: string;
}
export interface AssistantKnowledgeRevision { revision: string; available: boolean }
