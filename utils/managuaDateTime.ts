const MANAGUA_TIME_ZONE = 'America/Managua';

/** Instantes UTC mostrados en el reloj civil del negocio nicaragüense. */
export function formatManaguaDateTime(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-NI', { timeZone: MANAGUA_TIME_ZONE, ...options });
}
