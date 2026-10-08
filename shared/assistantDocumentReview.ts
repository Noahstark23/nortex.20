import type { InvoiceDraft } from './assistant';

/** El navegador elige una fuente; las fuentes originales sólo las guarda el servidor. */
export type AssistantDocumentDecision = {
  conflictId: string;
  choice: 'DECLARED' | 'DOCUMENT';
  reason: string;
};
export interface AssistantDocumentResolution extends AssistantDocumentDecision {
  resolvedBy: string;
  resolvedAt: string;
  proposalVersion: number;
}
export interface AssistantDocumentConflict {
  id: string;
  kind: 'VALUE' | 'LINE_MATCH';
  path: string;
  label: string;
  declaredValue: string | null;
  documentValue: string | null;
  status: 'PENDING' | 'RESOLVED' | 'BLOCKED';
  resolution?: AssistantDocumentResolution;
}
export interface AssistantDocumentReview {
  version: 1;
  declared: InvoiceDraft | null;
  document: InvoiceDraft;
  conflicts: AssistantDocumentConflict[];
  hasUnresolved: boolean;
}
