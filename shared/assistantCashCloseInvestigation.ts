import type { WeeklyCashReviewRow } from './assistantWeeklyCashReview';

/** Hechos de dos cortes distintos; nunca una causa acreditada ni conciliación aceptada. */
export interface CashCloseInvestigation {
    kind: 'CASH_CLOSE_INVESTIGATION';
    status: 'ok' | 'partial' | 'unavailable';
    checkedAt: string;
    scope: 'business' | 'own-shifts';
    shift: { id: string; openedAt: string; closedAt: string | null; folio: string | null; businessDate: string | null };
    snapshot: {
        source: NonNullable<WeeklyCashReviewRow['source']>;
        cash: NonNullable<WeeklyCashReviewRow['cash']> & {
            openingNio: string; grossCashSalesNio: string; cashRefundsNio: string; paidInNio: string; paidOutNio: string;
            openingUsd: string; paidInUsd: string; paidOutUsd: string;
        };
        payments: Array<{ method: string; transactionCount: number; grossSalesNio: string }>;
        movements: Array<{ type: string; currency: string; category: string; count: number; amount: string }>;
    } | null;
    currentMovements: {
        status: 'available' | 'truncated' | 'unavailable';
        rows: Array<{
            id: string; type: string; currency: string; category: string; amount: string;
            createdAt: string; isVoided: boolean; voidedAt: string | null; expenseId: string | null;
        }>;
    };
    pendingChecks: Array<{ code: string; message: string; references: string[] }>;
    warnings: string[];
    evidence: string[];
}

/** Sólo transporta una referencia; el servidor vuelve a autorizar y leer los datos. */
export function cashCloseInvestigationMessage(shiftId: string, reportHash?: string): string {
    return `Investigá el cierre ${shiftId}${reportHash ? ` referencia ${reportHash}` : ''}`;
}
