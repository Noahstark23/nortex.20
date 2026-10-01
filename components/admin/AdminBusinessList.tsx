import React from 'react';
import type { AdminBenefitState, AdminBusinessKind, AdminTenantRow } from '../../utils/adminMetrics';

export const kindLabels: Record<AdminBusinessKind, string> = { REAL: 'Negocio real', DEMO: 'Demo', INTERNAL: 'Interno', UNKNOWN: 'Sin clasificar' };
const benefitLabels: Record<AdminBenefitState, string> = {
    UNKNOWN: 'Fundador por confirmar', NOT_FOUNDER: 'No fundador verificado', DATES_UNKNOWN: 'Fundador · fechas por confirmar',
    SCHEDULED: 'Beneficio futuro documentado', CURRENT: 'Año gratis vigente', ENDING_SOON: 'Año gratis vence en 30 días', ENDED: 'Fin documentado del beneficio',
};
export const adminDate = (value: string | null): string => value
    ? new Intl.DateTimeFormat('es-NI', { timeZone: 'America/Managua', dateStyle: 'medium' }).format(new Date(value))
    : 'Sin dato';

export default function AdminBusinessList({ rows }: { rows: AdminTenantRow[] }) {
    if (!rows.length) return <p className="p-6 text-slate-400">No hay cuentas en esta página con esos filtros.</p>;
    return <div className="divide-y divide-nortex-border">
        {rows.map(row => <article key={row.id} className="p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-semibold break-words">{row.businessName}</h3>
                    <p className="text-sm text-slate-400">{kindLabels[row.kind]} · {row.type} · alta {adminDate(row.createdAt)}</p></div>
                <span className="text-sm text-slate-400">{benefitLabels[row.benefitState]}</span>
            </div>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div><dt className="text-slate-400">Catálogo</dt><dd>{row.products ? `${row.products} productos` : 'Sin productos'}</dd></div>
                <div><dt className="text-slate-400">Primera venta</dt><dd>{row.firstSaleAt ? adminDate(row.firstSaleAt) : 'Sin venta confirmada'}</dd></div>
                <div><dt className="text-slate-400">Última actividad observada</dt><dd>{adminDate(row.lastActivityAt)}</dd></div>
                <div><dt className="text-slate-400">Uso de ventas · 30 días</dt><dd>{row.sales30d} ventas · {row.saleDays30d} días</dd></div>
            </dl>
            {(row.negativeStockProducts > 0 || row.openShiftsOver24h > 0 || row.creditSalesWithBalance > 0) &&
                <p className="text-sm text-slate-400">Para revisar en el comercio: {row.negativeStockProducts} productos con stock negativo · {row.openShiftsOver24h} turnos abiertos hace 24 h · {row.creditSalesWithBalance} facturas de fiado con saldo. Son señales, no fallos demostrados.</p>}
            <details className="text-sm">
                <summary className="cursor-pointer py-2 text-nortex-accent">Ver evidencia de {row.businessName}</summary>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-slate-400">
                    <div><dt>Última venta confirmada</dt><dd>{adminDate(row.lastSaleAt)}</dd></div>
                    <div><dt>Último login del comercio</dt><dd>{adminDate(row.lastLoginAt)}</dd></div>
                    <div><dt>Días entre alta y primera venta</dt><dd>{row.daysToFirstSale ?? 'Sin dato'}</dd></div>
                    <div><dt>Plan documentado</dt><dd>{row.planLabel ?? 'Por confirmar'}</dd></div>
                    <div><dt>Inicio del año gratis documentado</dt><dd>{adminDate(row.benefitStartedAt)}</dd></div>
                    <div><dt>Fin del año gratis documentado</dt><dd>{adminDate(row.benefitEndsAt)}</dd></div>
                    <div><dt>Filas importadas confirmadas · 30 días</dt><dd>{row.importedRows30d}</dd></div>
                    <div><dt>Incidencias observadas · 30 días</dt><dd>{row.accountingWarnings30d} asientos omitidos · {row.assistantFailures30d} trabajos fallidos</dd></div>
                    <div><dt>Estado legacy registrado</dt><dd>{row.recordedSubscriptionStatus} · no acredita pago ni mora</dd></div>
                </dl>
            </details>
        </article>)}
    </div>;
}
