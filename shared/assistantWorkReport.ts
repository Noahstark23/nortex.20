import type { WeeklyCashReview, WeeklyCashReviewRow } from './assistantWeeklyCashReview.js';

/** Vista previa derivada de una fuente W01 guardada; no acredita aceptación. */
export interface AssistantWorkReport {
  kind: 'W01_CASH_REPORT';
  workItemId: string;
  workItemVersion: number;
  sourceHash: string;
  period: WeeklyCashReview['period'];
  checkedAt: string;
  scope: WeeklyCashReview['scope'];
  completeness: WeeklyCashReview['status'];
  truncated: boolean;
  counts: WeeklyCashReview['counts'] | null;
  totals: WeeklyCashReview['totals'];
  rows: Array<Pick<WeeklyCashReviewRow, 'shiftId' | 'status' | 'source' | 'cash'>>;
  exceptions: Array<{
    id: string;
    shiftId: string | null;
    status: 'PENDING';
    assignedUserId: string;
    reason: string;
    source: WeeklyCashReviewRow['source'];
  }>;
  noteEventIds: string[];
  notesHash: string;
  notesTruncated: boolean;
  warnings: string[];
  evidence: string[];
  reportHash: string;
}
