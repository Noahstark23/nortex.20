/** Una revisión de snapshots de cierre; nunca representa saldo bancario ni conciliación contable. */
export interface WeeklyCashReviewRow {
  shiftId: string;
  status: 'BALANCED' | 'DIFFERENCE' | 'MISSING_REPORT' | 'INVALID_REPORT' | 'OPEN';
  closedAt: string | null;
  businessDate: string | null;
  folio: string | null;
  source: { id: string; version: number; contentHash: string; documentUrl: string } | null;
  cash: {
    expectedNio: string; countedNio: string; differenceNio: string;
    expectedUsd: string; countedUsd: string; differenceUsd: string;
  } | null;
  message: string;
}

export interface WeeklyCashReview {
  kind: 'WEEKLY_CASH_REVIEW';
  status: 'ok' | 'partial' | 'unavailable';
  period: {
    startDate: string; endDate: string; cutoff: string;
    timeZone: 'America/Managua'; completeDays: boolean;
  };
  checkedAt: string;
  scope: 'business' | 'own-shifts';
  truncated: boolean;
  rows: WeeklyCashReviewRow[];
  counts: {
    closed: number; verified: number; differences: number;
    missingReports: number; invalidReports: number; open: number;
  };
  totals: {
    shortageNio: string | null; surplusNio: string | null;
    shortageUsd: string | null; surplusUsd: string | null;
  };
  warnings: string[];
  evidence: string[];
}
