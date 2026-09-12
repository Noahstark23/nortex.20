import { SalesReportError, parseShiftCloseReportPayload } from '../lib/salesReport.js';
import { hashShiftCloseReport, type ShiftCloseReportPayload } from '../lib/shiftCloseReport.js';

export interface ShiftReportSnapshotView {
    id: string;
    shiftId: string;
    folio: string;
    businessDate: string;
    version: number;
    contentHash: string;
    createdAt: string;
    documentUrl: string;
    report: ShiftCloseReportPayload;
}

export interface ShiftSnapshotDbRow {
    id: unknown;
    shiftId: unknown;
    folio: unknown;
    businessDate: unknown;
    version: unknown;
    report: unknown;
    contentHash: unknown;
    createdAt: unknown;
}

function dbText(value: unknown, fallback = '0'): string {
    if (value == null) return fallback;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
    if (typeof value === 'object' && 'toString' in value) return String(value);
    return fallback;
}

function dbDate(value: unknown): Date {
    if (value instanceof Date) return value;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        throw new SalesReportError('REPORT_DATA_INVALID', 409, 'El reporte contiene una fecha inválida.');
    }
    return parsed;
}

function dbCount(value: unknown): number {
    const parsed = Number(dbText(value));
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new SalesReportError('REPORT_DATA_INVALID', 409, 'El reporte contiene un conteo inválido.');
    }
    return parsed;
}


/** Verificador compartido: conserva el contrato del documento Z existente. */
export function validateShiftSnapshot(row: ShiftSnapshotDbRow, shiftId: string): ShiftReportSnapshotView {
    let rawReport = row.report;
    if (typeof rawReport === 'string') {
        try {
            rawReport = JSON.parse(rawReport);
        } catch {
            rawReport = null;
        }
    }
    const report = parseShiftCloseReportPayload(rawReport);
    const folio = dbText(row.folio, '');
    const date = dbText(row.businessDate, '');
    const version = dbCount(row.version);
    const contentHash = dbText(row.contentHash, '');
    if (
        !report
        || report.shift.id !== shiftId
        || report.folio !== folio
        || report.businessDate !== date
        || report.version !== version
        || !/^[a-f0-9]{64}$/i.test(contentHash)
        || hashShiftCloseReport(report) !== contentHash
    ) {
        throw new SalesReportError(
            'SHIFT_REPORT_INTEGRITY_FAILED',
            409,
            'El reporte de cierre no superó la verificación de integridad.',
        );
    }
    return {
        id: dbText(row.id, ''),
        shiftId,
        folio,
        businessDate: date,
        version,
        contentHash,
        createdAt: dbDate(row.createdAt).toISOString(),
        documentUrl: `/api/reports/shifts/${encodeURIComponent(shiftId)}/document`,
        report,
    };
}
