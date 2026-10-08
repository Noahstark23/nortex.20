import { normalizeCalendarDateInput } from './calendarDate';
import { claveDelDiaManagua } from '../services/pulsoPos';

const MS_PER_DAY = 86_400_000;

function civilDayOrdinal(day: string): number {
    const [year, month, date] = day.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

/**
 * Diferencia de dias CIVILES en Managua; no divide instantes locales entre
 * 86 400 000, por lo que la zona horaria del proceso no puede correr el bucket.
 */
export function daysSinceManaguaCivilDate(reference: Date, asOf: Date = new Date()): number {
    return civilDayOrdinal(claveDelDiaManagua(asOf))
        - civilDayOrdinal(claveDelDiaManagua(reference));
}

/**
 * Fecha de negocio serializable sin el salto al dia anterior de `YYYY-MM-DD`
 * al parsearse en el navegador. El mediodia UTC conserva el mismo calendario
 * tanto en Managua como en las zonas donde opera el equipo de soporte.
 */
export function managuaBusinessDate(asOf: Date = new Date()): Date {
    return normalizeCalendarDateInput(claveDelDiaManagua(asOf));
}

/**
 * Limite inferior para comparar campos que representan un dia de calendario.
 *
 * No es el instante en que inicia el dia en Managua (para eso existe
 * `inicioDelDiaManagua`). ProductBatch.expiryDate es un dia civil y existe
 * historial guardado tanto a 00:00Z como a 12:00Z; usar la medianoche UTC de
 * la clave Managua incluye ambas codificaciones durante todo el dia impreso.
 */
export function managuaCalendarDateFloor(asOf: Date = new Date()): Date {
    return new Date(`${claveDelDiaManagua(asOf)}T00:00:00.000Z`);
}

/**
 * Días restantes de un campo calendario frente al día civil de Managua.
 * `expiryDate` no es un instante: leer su YYYY-MM-DD UTC preserva registros
 * históricos guardados tanto a 00:00Z como a 12:00Z.
 */
export function daysUntilManaguaCalendarDate(
    expiryDate: Date,
    asOf: Date = new Date(),
): number {
    if (Number.isNaN(expiryDate.getTime()) || Number.isNaN(asOf.getTime())) {
        throw new RangeError('Fecha calendario inválida');
    }
    return civilDayOrdinal(expiryDate.toISOString().slice(0, 10))
        - civilDayOrdinal(claveDelDiaManagua(asOf));
}

/**
 * Interpreta un valor de `<input type="date">` como dia civil de negocio.
 * Rechaza datetimes, formatos ambiguos y fechas inexistentes en vez de dejar
 * que `new Date('YYYY-MM-DD')` dependa de la zona horaria del proceso.
 */
export function parseManaguaCivilDateInput(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return null;

    const canonicalDay = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = normalizeCalendarDateInput(canonicalDay);
    if (Number.isNaN(parsed.getTime())) return null;
    if (parsed.toISOString().slice(0, 10) !== canonicalDay) return null;

    return parsed;
}
