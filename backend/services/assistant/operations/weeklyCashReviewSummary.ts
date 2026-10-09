import Decimal from 'decimal.js';
import type { WeeklyCashReview, WeeklyCashReviewRow } from '../../../../shared/assistantWeeklyCashReview.js';
import type { ShiftReportSnapshotView } from '../../shiftSnapshotValidation.js';
import { claveDelDiaManagua } from '../../pulsoPos.js';

export const emptyCashReviewTotals = (): WeeklyCashReview['totals'] => ({ shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null });

/** El hash acredita correspondencia interna, no las ecuaciones ni el dinero físico. */
export function checkedSnapshotCash(snapshot: ShiftReportSnapshotView, closedAt: Date): NonNullable<WeeklyCashReviewRow['cash']> {
    const report = snapshot.report;
    if (new Date(report.shift.closedAt).getTime() !== closedAt.getTime()
        || new Date(report.generatedAt).getTime() !== closedAt.getTime()
        || new Date(report.shift.openedAt).getTime() > closedAt.getTime()
        || snapshot.businessDate !== claveDelDiaManagua(closedAt)) throw new Error('CASH_REVIEW_SNAPSHOT_DATE');
    const cash = report.cash;
    for (const [expected, counted, difference, decimals] of [
        [cash.expectedNio, cash.countedNio, cash.differenceNio, 2],
        [cash.expectedUsd, cash.countedUsd, cash.differenceUsd, 4],
    ] as const) {
        const values = [expected, counted, difference].map(value => new Decimal(value));
        if (values.some(value => !value.isFinite() || value.decimalPlaces() > decimals)
            || values[1].isNegative()
            || !values[1].minus(values[0]).equals(values[2])) throw new Error('CASH_REVIEW_SNAPSHOT_CASH');
    }
    return {
        expectedNio: new Decimal(cash.expectedNio).toFixed(2), countedNio: new Decimal(cash.countedNio).toFixed(2), differenceNio: new Decimal(cash.differenceNio).toFixed(2),
        expectedUsd: new Decimal(cash.expectedUsd).toFixed(4), countedUsd: new Decimal(cash.countedUsd).toFixed(4), differenceUsd: new Decimal(cash.differenceUsd).toFixed(4),
    };
}

export function summarizeCashReviewRows(rows: WeeklyCashReviewRow[], closed: number, open: number, truncated: boolean): Pick<WeeklyCashReview, 'status' | 'counts' | 'totals'> {
    const verified = rows.filter(row => row.status === 'BALANCED' || row.status === 'DIFFERENCE');
    const counts = { closed, verified: verified.length, differences: rows.filter(row => row.status === 'DIFFERENCE').length,
        missingReports: rows.filter(row => row.status === 'MISSING_REPORT').length, invalidReports: rows.filter(row => row.status === 'INVALID_REPORT').length, open };
    if (truncated || verified.length === 0) return { status: 'unavailable', counts, totals: emptyCashReviewTotals() };
    if (verified.length !== closed) return { status: 'partial', counts, totals: emptyCashReviewTotals() };
    let shortageNio = new Decimal(0), surplusNio = new Decimal(0), shortageUsd = new Decimal(0), surplusUsd = new Decimal(0);
    for (const row of verified) {
        const nio = new Decimal(row.cash!.differenceNio), usd = new Decimal(row.cash!.differenceUsd);
        if (nio.isNegative()) shortageNio = shortageNio.plus(nio.abs()); else surplusNio = surplusNio.plus(nio);
        if (usd.isNegative()) shortageUsd = shortageUsd.plus(usd.abs()); else surplusUsd = surplusUsd.plus(usd);
    }
    return { status: 'ok', counts, totals: { shortageNio: shortageNio.toFixed(2), surplusNio: surplusNio.toFixed(2), shortageUsd: shortageUsd.toFixed(4), surplusUsd: surplusUsd.toFixed(4) } };
}
