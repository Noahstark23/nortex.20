/** Contratos del asistente operativo; números financieros se conservan como texto decimal. */
export type AssistantJson = null | boolean | number | string | AssistantJson[] | { [key: string]: AssistantJson };
export type AssistantJsonObject = { [key: string]: AssistantJson };
export type AssistantActionKind = 'PURCHASE_ORDER_DRAFT' | 'BATCH_WRITEOFF' | 'SUPPLIER_RETURN' | 'PROMOTION';
export interface AssistantActionPreview {
  summary: string;
  lines: AssistantJsonObject[];
  effects: Array<{ label: string; value: string; unit?: string }>;
  warnings: string[];
  confirmLabel: string;
}
export interface AssistantActionResult {
  id: string; kind: AssistantActionKind; resourceId?: string; message: string; replayed: boolean;
}
export interface AssistantActionProposalDTO {
  id: string; kind: AssistantActionKind; version: number;
  status: 'DRAFT' | 'READY' | 'COMMITTED' | 'CANCELLED' | 'EXPIRED';
  draft: AssistantJsonObject; issues: string[]; preview: AssistantActionPreview | null;
  expiresAt: string; result?: AssistantActionResult;
}
export interface AssistantToolEvidence {
  id: string; tool: string; label: string; data: AssistantJson;
}
export interface AssistantRunStep {
  id: string; tool: string; label: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  evidenceId?: string; errorCode?: string;
}
export interface AssistantRunResult {
  text: string; evidence: AssistantToolEvidence[]; actionProposalIds: string[]; degraded: boolean;
}
export interface AssistantRunDTO {
  id: string; conversationId: string; requestId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  version: number; iterations: number; steps: AssistantRunStep[];
  result?: AssistantRunResult; errorCode?: string; createdAt: string; updatedAt: string;
}
export interface AssistantDailyBriefDTO {
  id: string; localDay: string;
  items: Array<{ id: string; title: string; text: string; area: 'business' | 'inventory' | 'expiry'; evidence: AssistantJson }>;
  dismissedIds: string[];
}
