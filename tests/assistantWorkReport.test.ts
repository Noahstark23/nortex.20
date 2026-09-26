import { describe, expect, it } from 'vitest';
import type { WeeklyCashReview } from '../shared/assistantWeeklyCashReview';
import { buildW01Report } from '../backend/services/assistant/workItems/report';

const source = {
  runId: 'run-1', evidenceId: 'evidence-1', contentHash: 'a'.repeat(64),
  period: { startDate: '2026-09-12', endDate: '2026-09-18', cutoff: '2026-09-19T06:00:00.000Z', timeZone: 'America/Managua' as const, completeDays: true },
  checkedAt: '2026-09-19T18:00:00.000Z', reviewStatus: 'partial' as const, scope: 'business' as const, truncated: false,
  counts: { closed: 2, verified: 1, differences: 1, missingReports: 1, invalidReports: 0, open: 0 },
};
const review = (): WeeklyCashReview => ({
  kind: 'WEEKLY_CASH_REVIEW', status: 'partial', period: source.period, checkedAt: source.checkedAt,
  scope: 'business', truncated: false, counts: source.counts,
  totals: { shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null },
  rows: [
    { shiftId: 'shift-1', status: 'DIFFERENCE', closedAt: '2026-09-18T16:00:00.000Z', businessDate: '2026-09-18', folio: 'Z-1',
      source: { id: 'report-1', version: 1, contentHash: 'b'.repeat(64), documentUrl: '/api/reports/shifts/shift-1/document' },
      cash: { expectedNio: '100.00', countedNio: '99.00', differenceNio: '-1.00', expectedUsd: '0.0000', countedUsd: '0.0000', differenceUsd: '0.0000' },
      message: 'Hay una diferencia de C$1; la causa no está acreditada.' },
    { shiftId: 'shift-2', status: 'MISSING_REPORT', closedAt: '2026-09-18T17:00:00.000Z', businessDate: '2026-09-18', folio: null,
      source: null, cash: null, message: 'Falta el reporte de cierre.' },
  ], warnings: ['Revisión parcial.'], evidence: ['Reporte de cierre histórico.'],
});

describe('informe preliminar W01', () => {
  const input = () => ({ id: 'work-1', version: 2, assignedUserId: 'owner-1', source, review: review(),
    events: [{ id: 'event-note', type: 'ADD_NOTE' as const, note: 'Falta evidencia' }], eventsTruncated: false });

  it('conserva importes desconocidos y excepciones asignadas sin inventar causas', () => {
    const report = buildW01Report(input());
    expect(report).toMatchObject({ kind: 'W01_CASH_REPORT', workItemVersion: 2, sourceHash: source.contentHash,
      totals: { shortageNio: null }, noteEventIds: ['event-note'], completeness: 'partial' });
    expect(report.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ shiftId: 'shift-1', status: 'PENDING', assignedUserId: 'owner-1', source: expect.objectContaining({ id: 'report-1' }) }),
      expect.objectContaining({ shiftId: 'shift-2', status: 'PENDING', assignedUserId: 'owner-1', source: null }),
      expect.objectContaining({ shiftId: null, status: 'PENDING', assignedUserId: 'owner-1' }),
    ]));
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.evidence).toEqual(['Reporte de cierre histórico.']);
    expect(JSON.stringify(report)).not.toContain('conciliado');
  });

  it('mantiene el hash entre lecturas y lo cambia con versión, nota o fuente', () => {
    const first = buildW01Report(input());
    expect(buildW01Report(input()).reportHash).toBe(first.reportHash);
    expect(buildW01Report({ ...input(), version: 3 }).reportHash).not.toBe(first.reportHash);
    expect(buildW01Report({ ...input(), events: [] }).reportHash).not.toBe(first.reportHash);
    expect(buildW01Report({ ...input(), events: [{ ...input().events[0], note: 'Nota cambiada' }] }).reportHash).not.toBe(first.reportHash);
    expect(buildW01Report({ ...input(), source: { ...source, contentHash: 'c'.repeat(64) } }).reportHash).not.toBe(first.reportHash);
  });

  it('suprime acumulados parciales o truncados y deja pendiente su cobertura', () => {
    const item = input(); item.review.truncated = true; item.review.totals.shortageNio = '99999.00';
    const report = buildW01Report(item);
    expect(report.counts).toBeNull();
    expect(report.totals.shortageNio).toBeNull();
    expect(report.exceptions.some(exception => exception.shiftId === null)).toBe(true);
  });

  it('no da por completo un corte cuyos conteos no corresponden a los turnos visibles', () => {
    const item = input(); item.review.status = 'ok'; item.review.counts.closed = 3;
    item.review.totals.shortageNio = '1.00';
    const report = buildW01Report(item);
    expect(report.counts).toBeNull();
    expect(report.totals.shortageNio).toBeNull();
    expect(report.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'coverage', status: 'PENDING' })]));
  });
});
