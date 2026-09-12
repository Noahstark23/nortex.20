import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { weeklyCashReviewRequest } from '../backend/services/assistant/operations/weeklyCashReviewRequest';
import { deterministicRunFallback } from '../backend/services/assistant/operations/fallback';
import type { OperationTool, RunCheckpoint } from '../backend/services/assistant/operations/contracts';

const now = new Date('2026-09-09T05:59:00Z'); // Martes 8 en Managua; miércoles UTC.
describe('interpretación acotada de revisión de caja sin proveedor', () => {
  it.each(['revisá los cierres de hoy y la semana pasada', 'cierres de esta semana y ayer', 'cierres desde hoy hasta ayer'])('no reduce una mezcla de períodos a un solo día: %s', text => {
    expect(weeklyCashReviewRequest(text, now)).toBeNull();
  });
  it.each([
    ['Revisá mis cierres de la última semana', {}],
    ['Mi semana con cuentas claras', {}],
    ['Mi caja hoy', { startDate: '2026-09-08', endDate: '2026-09-08' }],
    ['Revisá caja: cierre de ayer', { startDate: '2026-09-07', endDate: '2026-09-07' }],
    ['Los cierres de esta semana', { startDate: '2026-09-07', endDate: '2026-09-08' }],
    ['Los cierres de la semana pasada', { startDate: '2026-08-31', endDate: '2026-09-06' }],
    ['Cierres 2026-09-01 2026-09-07', { startDate: '2026-09-01', endDate: '2026-09-07' }],
    ['Cierre 2026-09-01', { startDate: '2026-09-01', endDate: '2026-09-01' }],
    ['Revisá el cierre de ayer y hoy', { startDate: '2026-09-07', endDate: '2026-09-08' }],
  ])('selecciona el período declarado: %s', (text, expected) => {
    expect(weeklyCashReviewRequest(text as string, now)).toEqual(expected);
  });
  it.each(['cierres de enero','cierre mensual','mi caja mañana','cierres últimos 30 días','cierre 31/08/2026','cierres 2026-02-30','cierres 2026-09-01 2026-09-02 2026-09-03','cierre del lunes','cierre de anteayer','revisá cierres desde 2026-09-01 hasta ayer','cierres desde 2026-09-01','cierres de hace cinco días','cierres semana antepasada','cierres de la semana pasada y esta semana'])('pide fechas ante período no representado: %s', text => {
    expect(weeklyCashReviewRequest(text, now)).toBeNull();
  });
  it.each(['son 60 cajas','el precio de caja es 500','son las cajas grandes','cuánto stock queda de cajas','Buscá cemento','Cómo va mi negocio'])('preserva otros flujos: %s', text => {
    expect(weeklyCashReviewRequest(text, now)).toBeUndefined();
  });
  it('el fallback ejecuta sólo revisión READ y conserva evidencia para recuperar', async () => {
    const checkpoint: RunCheckpoint = { iterations: 0, messages: [], steps: [], evidence: [], actionProposalIds: [] };
    const data = { kind: 'WEEKLY_CASH_REVIEW', status: 'partial', warnings: ['Falta un reporte de cierre.'] };
    const execute = vi.fn(async () => ({ data }));
    const read: OperationTool = { name: 'review_weekly_cash', label: 'Cierres', kind: 'READ', description: 'Revisión', schema: z.object({}).strict(), execute };
    const result = await deterministicRunFallback('Revisá los cierres semanales', now, checkpoint, new Map([[read.name, read]]), {
      execute, assertActive: async () => {}, onCheckpoint: async () => {},
    });
    expect(result.evidence).toEqual([{ id: 'e1', tool: read.name, label: 'Cierres', data }]);
    expect(result.actionProposalIds).toEqual([]);
    expect(checkpoint.steps[0].status).toBe('SUCCEEDED');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('fallo de consulta no se convierte en evidencia de caja vacía', async () => {
    const checkpoint: RunCheckpoint = { iterations: 0, messages: [], steps: [], evidence: [], actionProposalIds: [] };
    const execute = vi.fn(async () => { throw new Error('database offline'); });
    const read: OperationTool = { name: 'review_weekly_cash', label: 'Cierres', kind: 'READ', description: 'Revisión', schema: z.object({}).strict(), execute };
    const result = await deterministicRunFallback('Revisá mis cierres', now, checkpoint, new Map([[read.name, read]]), { execute, assertActive: async () => {}, onCheckpoint: async () => {} });
    expect(result.evidence).toEqual([]);
    expect(checkpoint.steps[0].status).toBe('FAILED');
    expect(result.text).toContain('no pude obtener fuentes');
  });
});
