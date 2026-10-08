/**
 * Roles de negocio autorizados para generar y descargar documentos fiscales.
 *
 * Mantener esta lista centralizada evita que la UI muestre una herramienta al
 * contador que luego una ruta individual rechaza con 403.
 */
export const FISCAL_REPORT_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT'] as const;

export type FiscalReportRole = (typeof FISCAL_REPORT_ROLES)[number];

export function isFiscalReportRole(role: unknown): role is FiscalReportRole {
    return typeof role === 'string'
        && (FISCAL_REPORT_ROLES as readonly string[]).includes(role);
}

export interface FiscalPeriod {
    month: number;
    year: number;
}

export interface FiscalCivilDate {
    isoDay: string;
    period: string;
    compact: string;
    shortLabel: string;
    longLabel: string;
}

const FISCAL_MONTH = /^(?:0?[1-9]|1[0-2])$/;
const FISCAL_YEAR = /^\d{4}$/;

/**
 * Parsea períodos recibidos desde params/query sin coerciones parciales ni
 * defaults silenciosos. Rechaza arrays, espacios, decimales y sufijos que
 * `parseInt` aceptaría (por ejemplo `8foo`).
 */
export function parseFiscalPeriod(monthValue: unknown, yearValue: unknown): FiscalPeriod | null {
    if (
        typeof monthValue !== 'string'
        || typeof yearValue !== 'string'
        || !FISCAL_MONTH.test(monthValue)
        || !FISCAL_YEAR.test(yearValue)
    ) {
        return null;
    }

    const month = Number(monthValue);
    const year = Number(yearValue);
    if (year < 2020 || year > 2100) return null;

    return { month, year };
}

/**
 * Proyecta un instante fiscal como día civil de Managua, la misma zona que usa
 * `fiscalMonthRange`. Así un instante anterior a las 06:00 UTC del día 1 todavía
 * pertenece al último día del mes fiscal nicaragüense.
 */
export function fiscalCivilDate(value: Date | string): FiscalCivilDate {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError('Fecha civil fiscal inválida.');
    }

    const timeZone = 'America/Managua';
    const calendarParts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        calendarParts.find(candidate => candidate.type === type)?.value ?? '';
    const isoDay = `${part('year')}-${part('month')}-${part('day')}`;
    return {
        isoDay,
        period: isoDay.slice(0, 7),
        compact: isoDay.replace(/-/g, ''),
        shortLabel: date.toLocaleDateString('es-NI', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone,
        }),
        longLabel: date.toLocaleDateString('es-NI', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            timeZone,
        }),
    };
}

/**
 * Alcances puros usados por la constancia. Al devolver siempre ambos
 * identificadores, una compra o retencion de otro tenant no puede resolverse
 * solo por conocer su id.
 */
export function fiscalPurchaseScope(tenantId: string, purchaseId: string) {
    return { id: purchaseId, tenantId };
}

export function fiscalRetentionScope(tenantId: string, purchaseId: string) {
    return { purchaseId, tenantId };
}
