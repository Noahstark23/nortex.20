import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditBusinessHealth, businessHealthMetrics } from '../backend/services/assistant/operations/analytics';
import { resolveOperationsPeriods } from '../backend/services/assistant/operations/analyticsPeriod';

const now = new Date('2026-09-05T18:25:00Z');
const complete = { salesCount: '4', salesTotal: '460', salesVat: '60', unknownVat: 0,
  soldCost: '240', unknownCost: 0, returnsTotal: '57.5', returnedCost: '30', returnedVat: '7.5',
  ambiguousReturns: 0, unknownReturnVat: 0, unknownReturnCost: 0, expensesTotal: '15' };
const values = (row: any = complete, financial = true) => Object.fromEntries(businessHealthMetrics(row, financial).map(m => [m.key, m.value]));
function harness(role = 'OWNER') {
  const principal = { tenantId: 'business-a', userId: 'actor-a', role };
  const mocks = {
    user: { findFirst: vi.fn().mockResolvedValue({ id: principal.userId, role, status: 'ACTIVE' }) },
    assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
    $queryRaw: vi.fn().mockResolvedValue([complete]),
  };
  return { principal, mocks, deps: { db: mocks as unknown as PrismaClient, now: () => now } };
}
beforeEach(() => vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('Analítica: períodos comparables de Managua', () => {
  it('hoy conserva el corte horario y compara con el mismo día de semana anterior', () => {
    const value = resolveOperationsPeriods({}, now);
    expect(value.period).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-05', cutoff: '2026-09-05T18:25:00.000Z', completeDays: false });
    expect(value.comparison).toMatchObject({ startDate: '2026-08-29', cutoff: '2026-08-29T18:25:00.000Z' });
  });
  it('antes de medianoche UTC usa todavía el día anterior de Managua', () => {
    const value = resolveOperationsPeriods({}, new Date('2026-09-01T03:00:00Z'));
    expect(value.period.startDate).toBe('2026-08-31'); expect(value.comparison.startDate).toBe('2026-08-24');
  });
  it('varios días completos comparan igual longitud y no el mes completo anterior', () => {
    const value = resolveOperationsPeriods({ startDate: '2026-09-01', endDate: '2026-09-04' }, now);
    expect(value.period.completeDays).toBe(true);
    expect(value.comparison).toMatchObject({ startDate: '2026-08-28', endDate: '2026-08-31', cutoff: '2026-09-01T06:00:00.000Z' });
  });
  it('la ventana de salida son treinta días completos, incluyendo cambio de mes', () => {
    const value = resolveOperationsPeriods({}, now, 'inventory');
    expect(value.period).toMatchObject({ startDate: '2026-08-06', endDate: '2026-09-04', days: 30, completeDays: true });
  });
  it('febrero bisiesto y corte explícito conservan una ventana comparable', () => {
    const value = resolveOperationsPeriods({ startDate: '2024-02-29', endDate: '2024-02-29', cutoff: '2024-02-29T15:00:00-06:00' }, now);
    expect(value.period.cutoff).toBe('2024-02-29T21:00:00.000Z'); expect(value.comparison.startDate).toBe('2024-02-22');
  });
  it.each([
    { startDate: '2026-02-30' }, { endDate: '2026-13-01' }, { startDate: '2026-09-04', endDate: '2026-09-02' },
    { startDate: '2024-01-01', endDate: '2026-09-01' }, { endDate: '2026-09-06' },
    { cutoff: '2026-09-06T00:00:00Z' }, { comparison: { startDate: '2026-08-01', endDate: '2026-08-02' } },
    { comparison: { startDate: '2026-09-05', endDate: '2026-09-05' } }, { tenantId: 'business-b' },
  ])('rechaza fechas/contexto inválidos %j', input => expect(() => resolveOperationsPeriods(input, now)).toThrow());
  it('rechaza incluir un día incompleto como velocidad diaria', () => {
    expect(() => resolveOperationsPeriods({ endDate: '2026-09-05' }, now, 'inventory')).toThrow(/completos/);
  });
});

describe('Analítica: importes esperados revisables e incertidumbre', () => {
  it('separa ventas, devoluciones, IVA, costo, margen y ticket', () => {
    expect(values()).toMatchObject({ salesTotal: '460', returnsTotal: '57.5', netSalesTotal: '402.5', netSalesExVat: '350',
      netCostOfGoods: '210', grossMargin: '140', grossMarginPercent: '40', averageTicket: '115', expensesTotal: '15' });
  });
  it('no resta gastos al margen bruto ni confunde ticket con ventas netas', () => {
    expect(values({ ...complete, expensesTotal: '1000' }).grossMargin).toBe('140');
    expect(values({ ...complete, returnsTotal: '460' }).averageTicket).toBe('115');
  });
  it('las devoluciones de ventas previas permiten un flujo neto negativo', () => {
    expect(values({ ...complete, returnsTotal: '575', returnedVat: '75', returnedCost: '300' })).toMatchObject({ netSalesTotal: '-115', netSalesExVat: '-100', grossMargin: '-40', grossMarginPercent: null });
  });
  it('sin actividad: sumas verificadas cero; porcentajes y ticket no definidos', () => {
    const row = Object.fromEntries(Object.keys(complete).map(key => [key, '0']));
    expect(values(row)).toMatchObject({ salesTotal: '0', netSalesExVat: '0', grossMargin: '0', averageTicket: null, grossMarginPercent: null });
  });
  it.each(['unknownVat', 'unknownReturnVat', 'ambiguousReturns'])('bloquea derivados fiscales si %s está incompleto', field => {
    expect(values({ ...complete, [field]: 1 })).toMatchObject({ salesTotal: '460', returnsTotal: '57.5', netSalesExVat: null, grossMargin: null });
  });
  it('una línea de costo ausente no bloquea ventas pero sí el margen', () => {
    expect(values({ ...complete, unknownCost: 1 })).toMatchObject({ netSalesExVat: '350', netCostOfGoods: null, grossMargin: null });
  });
  it('costo histórico cero es un valor documentado, no precio actual supuesto', () => {
    expect(values({ ...complete, soldCost: '0', returnedCost: '0' }).grossMargin).toBe('350');
  });
  it('no pierde precisión en montos superiores al entero seguro de JavaScript', () => {
    expect(values({ ...complete, salesTotal: '9007199254740993.0001', returnsTotal: '0.0001' }).netSalesTotal).toBe('9007199254740993');
  });
  it.each([null, {}, { ...complete, salesTotal: 'NaN' }, { ...complete, salesTotal: 'Infinity' }])('no convierte entradas indisponibles en cero', row => {
    expect(values(row).salesTotal).toBeNull();
  });
});

describe('Analítica: servicios reales con fronteras de base simuladas', () => {
  it('parametriza tenant y fechas, usa agregados y sólo lee', async () => {
    const h = harness(); const result = await auditBusinessHealth(h.principal, {}, h.deps);
    expect(result.kind).toBe('BUSINESS_HEALTH'); expect(h.mocks.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [sql] of h.mocks.$queryRaw.mock.calls as [Prisma.Sql][]) {
      expect(sql.values).toContain('business-a'); expect(sql.sql).not.toContain('business-a');
      expect(sql.sql).toContain('costAtSale'); expect(sql.sql).toContain('ProductReturnItem');
      expect(sql.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/); expect(sql.sql).not.toContain('JOIN Product ');
    }
  });
  it.each(['CASHIER', 'EMPLOYEE', 'VENDEDOR'])('%s recibe sus documentos y ningún costo ni gasto', async role => {
    const h = harness(role); const result = await auditBusinessHealth(h.principal, {}, h.deps);
    expect(result.metrics.some(m => /margin|Cost|expenses/i.test(m.key))).toBe(false);
    for (const [sql] of h.mocks.$queryRaw.mock.calls as [Prisma.Sql][]) {
      expect(sql.values).toContain('actor-a'); expect(sql.sql).toContain('s.soldById = ?');
      expect(sql.sql).not.toContain('i.costAtSale'); expect(sql.sql).not.toContain('ri.costTotal'); expect(sql.sql).not.toContain('FROM Expense');
    }
  });
  it.each(['BODEGUERO', 'VIEWER', 'DRIVER'])('%s no consulta datos financieros', async role => {
    const h = harness(role); await expect(auditBusinessHealth(h.principal, {}, h.deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.mocks.$queryRaw).not.toHaveBeenCalled();
  });
  it('revalida revocación antes de entregar datos', async () => {
    const h = harness(); h.mocks.user.findFirst.mockResolvedValueOnce({ id: 'actor-a', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue(null);
    await expect(auditBusinessHealth(h.principal, {}, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
  it('falla de consulta produce unavailable y contexto, nunca ceros', async () => {
    const h = harness(); h.mocks.$queryRaw.mockRejectedValue(new Error('database down'));
    const result = await auditBusinessHealth(h.principal, {}, h.deps);
    expect(result.status).toBe('unavailable'); expect(result.metrics.every(m => m.value === null)).toBe(true); expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('comparación con base cero no inventa un porcentaje de crecimiento', async () => {
    const h = harness(); h.mocks.$queryRaw.mockResolvedValueOnce([complete]).mockResolvedValueOnce([Object.fromEntries(Object.keys(complete).map(key => [key, '0']))]);
    const result = await auditBusinessHealth(h.principal, {}, h.deps);
    expect(result.comparison.changes.find(m => m.key === 'salesTotalChange')?.value).toBeNull();
  });
});
