import type { WeeklyCashReview } from './assistantWeeklyCashReview.js';

/** Continuidad privada de una lectura de caja; no acepta informes ni modifica la caja. */
export type AssistantWorkItemStatus = 'IN_REVIEW' | 'WAITING' | 'CANCELLED';
export type AssistantWorkItemEventType = 'CREATED' | 'ADD_NOTE' | 'WAIT' | 'RESUME' | 'CANCEL';

export interface AssistantWorkItemSource {
  runId: string;
  evidenceId: string;
  contentHash: string;
  period: WeeklyCashReview['period'];
  checkedAt: string;
  reviewStatus: WeeklyCashReview['status'];
  scope: WeeklyCashReview['scope'];
  truncated: boolean;
  counts: WeeklyCashReview['counts'];
}

export interface AssistantWorkItemSummaryDTO {
  id: string;
  kind: 'W01_CASH_REVIEW';
  status: AssistantWorkItemStatus;
  version: number;
  conversationId: string;
  source: AssistantWorkItemSource;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AssistantWorkItemEventDTO {
  id: string;
  type: AssistantWorkItemEventType;
  note: string | null;
  fromStatus: AssistantWorkItemStatus | null;
  status: AssistantWorkItemStatus;
  version: number;
  createdAt: string;
}

export interface AssistantWorkItemDTO extends AssistantWorkItemSummaryDTO {
  /** Se recupera y revalida desde el run original en cada lectura. */
  review: WeeklyCashReview;
  events: AssistantWorkItemEventDTO[];
  eventsTruncated: boolean;
  /** POST de evento: UUID exacto acreditado, incluso si salió de la ventana de 100 eventos. */
  receiptEventId?: string;
}

export interface AssistantWorkItemListDTO {
  items: AssistantWorkItemSummaryDTO[];
  nextCursor: string | null;
}

export type AssistantWorkItemEventInput = {
  eventId: string;
  version: number;
} & ({ type: 'ADD_NOTE'; note: string } | { type: 'WAIT' | 'RESUME' | 'CANCEL' });
