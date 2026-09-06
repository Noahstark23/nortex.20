const managuaDay = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit',
});
const storedDayLabel = new Intl.DateTimeFormat('es-NI-u-ca-gregory-nu-latn', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Límite SQL para un vencimiento guardado como día civil en un DateTime UTC.
 * Incluye todo el día vigente en Managua, tanto con medianoche como mediodía
 * UTC históricos. No es un instante de medianoche Managua: representa el día
 * del campo sin reescribirlo. En replay, asOf es la captura original.
 */
export function batchExpiryDayStart(asOf: Date = new Date()): Date {
    const parts = Object.fromEntries(managuaDay.formatToParts(asOf).map(part => [part.type, part.value]));
    return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
}

/** Incluye hoy y todo el último día; el límite superior siempre es exclusivo. */
export function batchExpiryWindow(asOf: Date = new Date(), daysAhead = 30) {
    if (!Number.isSafeInteger(daysAhead) || daysAhead < 0) throw new RangeError('Ventana de vencimiento inválida');
    const today = batchExpiryDayStart(asOf);
    const afterLastDay = new Date(today);
    afterLastDay.setUTCDate(afterLastDay.getUTCDate() + daysAhead + 1);
    if (Number.isNaN(afterLastDay.getTime())) throw new RangeError('Ventana de vencimiento inválida');
    return { today, afterLastDay };
}

/** Vista civil compartida: nunca usa la zona local del navegador para el lote. */
export function batchExpiryPresentation(expiryDate: string, asOf: Date = new Date(), daysAhead = 90): {
    status: 'expired' | 'expiring' | 'current' | 'unknown';
    label: string;
} {
    const storedDate = new Date(expiryDate);
    if (Number.isNaN(storedDate.getTime())) return { status: 'unknown', label: 'Fecha sin verificar' };
    const { today, afterLastDay } = batchExpiryWindow(asOf, daysAhead);
    return {
        status: storedDate < today ? 'expired' : storedDate < afterLastDay ? 'expiring' : 'current',
        label: storedDayLabel.format(storedDate),
    };
}
