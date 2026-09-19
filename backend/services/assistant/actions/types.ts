import type { Prisma } from '@prisma/client';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantActionKind, AssistantActionPreview, AssistantJsonObject } from '../../../../shared/assistantOperations.js';

export type ActionPrincipal = AssistantPrincipal;
export interface ActionAdapterPreview {hash: string; preview: AssistantActionPreview; issues: string[]}
export interface AssistantActionAdapter {
  roles: readonly string[];
  parseDraft(raw: unknown): AssistantJsonObject;
  prepare(principal: ActionPrincipal, draft: AssistantJsonObject, tx: Prisma.TransactionClient): Promise<ActionAdapterPreview>;
  execute(principal: ActionPrincipal, draft: AssistantJsonObject, context: {
    tx: Prisma.TransactionClient; requestKey: string; domainHash: string; proposalId: string;
  }): Promise<{resourceId?: string; message: string}>;
}
export class AssistantActionError extends Error {
  constructor(readonly code: string, readonly httpStatus: number, message: string) {super(message); this.name = 'AssistantActionError';}
}
export const ACTION_KINDS: readonly AssistantActionKind[] = ['PURCHASE_ORDER_DRAFT', 'BATCH_WRITEOFF', 'SUPPLIER_RETURN', 'PROMOTION'];
