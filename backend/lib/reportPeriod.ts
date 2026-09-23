import { parseManaguaCivilDateInput } from './managuaBusinessDate';
import { claveDelDiaManagua } from '../services/pulsoPos';

const DAY_MS = 86_400_000;

/** Rango de días civiles del negocio; fin exclusivo evita perder la tarde del último día. */
export function resolveReportPeriod(startInput: unknown, endInput: unknown, now = new Date()) {
    const today = claveDelDiaManagua(now);
    const endDate = endInput === undefined ? today : String(endInput);
    const startDate = startInput === undefined
        ? new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 30 * DAY_MS).toISOString().slice(0, 10)
        : String(startInput);
    if (!parseManaguaCivilDateInput(startDate) || !parseManaguaCivilDateInput(endDate)) return null;
    const start = new Date(`${startDate}T06:00:00Z`);
    const endExclusive = new Date(new Date(`${endDate}T06:00:00Z`).getTime() + DAY_MS);
    const days = (endExclusive.getTime() - start.getTime()) / DAY_MS;
    if (days < 1 || days > 366) return null;
    return { startDate, endDate, start, endExclusive };
}
