export type CustomerHubSegment = 'active' | 'blocked' | 'inactive' | 'overlimit' | 'wholesale' | 'withDebt';

export interface CustomerHubSignals {
    creditLimit: number;
    currentDebt: number;
    isBlocked: boolean;
    isWholesale?: boolean;
    overdueInvoices?: number;
    openInvoices?: number;
    lastSaleAt?: Date | string | null;
    createdAt?: Date | string | null;
}
const INACTIVE_DAYS = 60;
const MS_DAY = 86400000;
const MANAGUA_CIVIL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: 'America/Managua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toManaguaCivilDayNumber(date: Date): number | null {
    if (Number.isNaN(date.getTime())) return null;

    let year: number | null = null;
    let month: number | null = null;
    let day: number | null = null;

    for (const part of MANAGUA_CIVIL_DATE_FORMATTER.formatToParts(date)) {
        if (part.type === 'year') year = Number(part.value);
        if (part.type === 'month') month = Number(part.value);
        if (part.type === 'day') day = Number(part.value);
    }

    if (year === null || month === null || day === null) return null;
    return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

export function resolveCustomerHubSegment(
    signals: CustomerHubSignals,
    now: Date = new Date(),
): CustomerHubSegment {
    if (signals.isBlocked) return 'blocked';
    if (signals.creditLimit > 0 && signals.currentDebt > signals.creditLimit) return 'overlimit';
    if ((signals.overdueInvoices ?? 0) > 0 || signals.currentDebt > 0 || (signals.openInvoices ?? 0) > 0) return 'withDebt';
    if (signals.isWholesale) return 'wholesale';

    const lastActivity = toDate(signals.lastSaleAt) ?? toDate(signals.createdAt);
    if (lastActivity) {
        const currentCivilDay = toManaguaCivilDayNumber(now);
        const activityCivilDay = toManaguaCivilDayNumber(lastActivity);
        if (
            currentCivilDay !== null
            && activityCivilDay !== null
            && currentCivilDay - activityCivilDay >= INACTIVE_DAYS
        ) return 'inactive';
    }

    return 'active';
}

export function resolveCustomerHubNextAction(
    segment: CustomerHubSegment,
    signals: CustomerHubSignals,
): string {
    if (segment === 'blocked') return 'Revisar bloqueo y confirmar política de crédito';
    if (segment === 'overlimit') return 'Cobrar antes de aprobar una nueva venta a crédito';
    if ((signals.overdueInvoices ?? 0) > 0) return 'Contactar hoy y registrar gestión de cobranza';
    if (segment === 'withDebt') return 'Enviar estado de cuenta o programar recordatorio';
    if (segment === 'inactive') return 'Reactivar con seguimiento comercial';
    if (segment === 'wholesale') return 'Confirmar lista y condiciones de mayoreo';
    return 'Listo para vender o ampliar relación';
}

export function matchesCustomerHubSegment(
    segmentFilter: string,
    segment: CustomerHubSegment,
    signals: CustomerHubSignals,
): boolean {
    if (!segmentFilter || segmentFilter === 'all') return true;
    if (segmentFilter === 'unassigned') return false;
    if (segmentFilter === 'withDebt') {
        return signals.currentDebt > 0 || (signals.openInvoices ?? 0) > 0 || (signals.overdueInvoices ?? 0) > 0;
    }
    return segment === segmentFilter;
}
