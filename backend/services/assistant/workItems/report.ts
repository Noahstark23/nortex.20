import { createHash } from 'node:crypto';
import type { WeeklyCashReview } from '../../../../shared/assistantWeeklyCashReview.js';
import type { AssistantWorkItemSource } from '../../../../shared/assistantWorkItems.js';
import type { AssistantWorkReport } from '../../../../shared/assistantWorkReport.js';

type ReportInput = {
  id: string;
  version: number;
  assignedUserId: string;
  source: AssistantWorkItemSource;
  review: WeeklyCashReview;
  events: Array<{ id: string; type: string; note?: string | null }>;
  eventsTruncated: boolean;
};

const noTotals = () => ({ shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null });

/** Vista previa sin IA ni lecturas nuevas de caja. Cada causa sin prueba sigue pendiente. */
export function buildW01Report(input: ReportInput): AssistantWorkReport {
  const { review, source } = input;
  const observed = {
    closed: review.rows.filter(row => row.status !== 'OPEN').length,
    verified: review.rows.filter(row => row.status === 'BALANCED' || row.status === 'DIFFERENCE').length,
    differences: review.rows.filter(row => row.status === 'DIFFERENCE').length,
    missingReports: review.rows.filter(row => row.status === 'MISSING_REPORT').length,
    invalidReports: review.rows.filter(row => row.status === 'INVALID_REPORT').length,
    open: review.rows.filter(row => row.status === 'OPEN').length,
  };
  const countsMatch = Object.entries(observed).every(([key, value]) => review.counts[key as keyof typeof observed] === value);
  const uniqueShifts = new Set(review.rows.map(row => row.shiftId)).size === review.rows.length;
  const complete = review.status === 'ok' && !review.truncated && review.period.completeDays
    && countsMatch && uniqueShifts && review.warnings.length === 0;
  const rows = review.rows.map(row => ({ shiftId: row.shiftId, status: row.status, source: row.source, cash: row.cash }));
  const exceptions: AssistantWorkReport['exceptions'] = review.rows.flatMap((row, index) => row.status === 'BALANCED' ? [] : [{
    id: `shift:${row.shiftId}:${index}`, shiftId: row.shiftId, status: 'PENDING' as const, assignedUserId: input.assignedUserId,
    reason: row.message || 'Este turno requiere evidencia o revisión.', source: row.source,
  }]);
  if (!complete) exceptions.push({
    id: 'coverage', shiftId: null, status: 'PENDING', assignedUserId: input.assignedUserId,
    reason: review.truncated ? 'La lista de turnos está truncada.'
      : review.status === 'unavailable' ? 'La fuente de revisión no estuvo disponible.'
        : !review.period.completeDays ? 'El período todavía está en curso.'
          : !countsMatch || !uniqueShifts ? 'Los turnos visibles no coinciden con los conteos de la fuente.'
            : review.warnings.length ? 'La fuente conserva advertencias pendientes.' : 'La revisión es parcial.',
    source: null,
  });
  const notes = input.events.filter(event => event.type === 'ADD_NOTE').map(event => ({ id: event.id, note: event.note ?? null }));
  const body = {
    kind: 'W01_CASH_REPORT' as const,
    workItemId: input.id, workItemVersion: input.version, sourceHash: source.contentHash,
    period: review.period, checkedAt: review.checkedAt, scope: review.scope,
    completeness: review.status, truncated: review.truncated,
    counts: complete ? review.counts : null,
    totals: complete ? review.totals : noTotals(),
    rows, exceptions,
    noteEventIds: notes.map(event => event.id),
    notesHash: createHash('sha256').update(JSON.stringify(notes)).digest('hex'),
    notesTruncated: input.eventsTruncated,
    warnings: review.warnings, evidence: review.evidence,
  };
  const reportHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, reportHash };
}
