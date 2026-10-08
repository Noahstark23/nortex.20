/**
 * Campos como dueDate/expiryDate representan un día de calendario, no un instante.
 * Normalizamos cualquier variante admitida del API al mediodía UTC. A diferencia
 * de medianoche UTC, el mediodía conserva el mismo día al mostrarse tanto en las
 * zonas horarias de Nicaragua como en UTC.
 */
export function normalizeCalendarDateInput(value: string): Date {
    const calendarDay = String(value).slice(0, 10);
    return new Date(`${calendarDay}T12:00:00.000Z`);
}
