import { normalizeCalendarDateInput } from './calendarDate';
import { claveDelDiaManagua } from '../services/pulsoPos';

const MS_PER_DAY = 86_400_000;

function civilDayOrdinal(day: string): number {
    const [year, month, date] = day.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

/**
 * Diferencia de días CIVILES en Managua; no divide instantes locales entre
 * 86 400 000, por lo que la zona horaria del proceso no puede correr el bucket.
 */
export function daysSinceManaguaCivilDate(reference: Date, asOf: Date = new Date()): number {
    return civilDayOrdinal(claveDelDiaManagua(asOf))
        - civilDayOrdinal(claveDelDiaManagua(reference));
}

/**
 * Fecha de negocio serializable sin el salto al día anterior de `YYYY-MM-DD`
 * al parsearse en el navegador. El mediodía UTC conserva el mismo calendario
 * tanto en Managua como en las zonas donde opera el equipo de soporte.
 */
export function managuaBusinessDate(asOf: Date = new Date()): Date {
    return normalizeCalendarDateInput(claveDelDiaManagua(asOf));
}

/**
 * Interpreta un valor de `<input type="date">` como día civil de negocio.
 * Rechaza datetimes, formatos ambiguos y fechas inexistentes en vez de dejar
 * que `new Date('YYYY-MM-DD')` dependa de la zona horaria del proceso.
 */
export function parseManaguaCivilDateInput(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const parsed = normalizeCalendarDateInput(value);
    if (Number.isNaN(parsed.getTime())) return null;

    const [year, month, day] = value.split('-').map(Number);
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() + 1 !== month
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return parsed;
}
