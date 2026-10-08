import { z } from 'zod';
import { AssistantAccessError } from '../access.js';
import type { OperationsPeriod } from './analyticsTypes.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Fecha civil inválida');
export const operationsQuerySchema = z.object({
  startDate: day.optional(), endDate: day.optional(),
  comparison: z.object({ startDate: day, endDate: day }).strict().optional(),
  cutoff: z.iso.datetime({ offset: true }).optional(),
  warehouseId: z.string().trim().min(1).max(191).optional(),
  productIds: z.array(z.string().trim().min(1).max(191)).min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export type OperationsQuery = z.infer<typeof operationsQuerySchema>;
export interface ResolvedOperationsPeriod extends OperationsPeriod { start: Date; endExclusive: Date; days: number }
export const managuaDay = (date: Date) => new Date(date.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
export const shiftCivilDay = (date: string, offset: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + offset * 86400_000).toISOString().slice(0, 10);
export const managuaDayStart = (date: string) => new Date(`${date}T06:00:00Z`);
const invalid = (message: string): never => { throw new AssistantAccessError(400, 'ASSISTANT_INVALID_PERIOD', message); };

export function resolveOperationsPeriods(input: unknown = {}, now = new Date(), mode: 'health' | 'inventory' = 'health') {
  const query = operationsQuerySchema.parse(input);
  const cutoff = query.cutoff ? new Date(query.cutoff) : now;
  if (cutoff > now) invalid('El corte no puede estar en el futuro.');
  const today = managuaDay(cutoff);
  const endDate = query.endDate ?? (mode === 'inventory' ? shiftCivilDay(today, -1) : today);
  const startDate = query.startDate ?? (mode === 'inventory' ? shiftCivilDay(endDate, -29) : endDate);
  const start = managuaDayStart(startDate), naturalEnd = managuaDayStart(shiftCivilDay(endDate, 1));
  const civilDays = (naturalEnd.getTime() - start.getTime()) / 86400_000;
  if (civilDays <= 0 || civilDays > 366 || endDate > today) invalid('Elegí un período ordenado de hasta 366 días, sin fechas futuras.');
  const endExclusive = new Date(Math.min(naturalEnd.getTime(), cutoff.getTime()));
  if (endExclusive < start) invalid('El corte no puede ser anterior al inicio del período.');
  if (mode === 'inventory' && naturalEnd > cutoff) invalid('La velocidad de salida requiere días completos de Managua.');
  const completeDays = endExclusive.getTime() === naturalEnd.getTime();
  const period: ResolvedOperationsPeriod = { startDate, endDate, cutoff: endExclusive.toISOString(), timeZone: 'America/Managua', completeDays,
    start, endExclusive, days: civilDays };
  const offset = civilDays === 1 ? -7 : -civilDays;
  const comparisonStart = query.comparison?.startDate ?? shiftCivilDay(startDate, offset);
  const comparisonEnd = query.comparison?.endDate ?? shiftCivilDay(endDate, offset);
  const comparisonBegin = managuaDayStart(comparisonStart), comparisonNaturalEnd = managuaDayStart(shiftCivilDay(comparisonEnd, 1));
  if ((comparisonNaturalEnd.getTime() - comparisonBegin.getTime()) / 86400_000 !== civilDays || comparisonEnd >= startDate) {
    invalid('La comparación debe ser anterior y contener la misma cantidad de días civiles.');
  }
  const comparisonCutoff = new Date(comparisonBegin.getTime() + endExclusive.getTime() - start.getTime());
  const comparison: ResolvedOperationsPeriod = { startDate: comparisonStart, endDate: comparisonEnd, cutoff: comparisonCutoff.toISOString(),
    timeZone: 'America/Managua', completeDays, start: comparisonBegin, endExclusive: comparisonCutoff, days: civilDays };
  return { query, period, comparison, asOf: cutoff };
}
export function periodDTO(period: ResolvedOperationsPeriod): OperationsPeriod {
  const { startDate, endDate, cutoff, timeZone, completeDays } = period;
  return { startDate, endDate, cutoff, timeZone, completeDays };
}
