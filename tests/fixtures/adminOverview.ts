import type { AdminOverview, AdminTenantRow } from '../../utils/adminMetrics';
export const syntheticAdminTenant: AdminTenantRow = {
    id: 'synthetic-real', businessName: 'Comercio sintético', type: 'FERRETERIA', kind: 'REAL',
    createdAt: '2026-08-01T12:00:00.000Z', recordedSubscriptionStatus: 'ACTIVE', planLabel: null,
    founder: true, benefitStartedAt: null, benefitEndsAt: null, benefitState: 'DATES_UNKNOWN',
    products: 2, confirmedSales: 2, firstSaleAt: '2026-08-02T12:00:00.000Z', lastSaleAt: '2026-09-28T12:00:00.000Z',
    lastLoginAt: null, lastActivityAt: '2026-09-28T12:00:00.000Z', daysToFirstSale: 1,
    sales30d: 2, saleDays30d: 2, importedRows30d: 1, accountingWarnings30d: 0, assistantFailures30d: 1,
    negativeStockProducts: 1, openShiftsOver24h: 1, creditSalesWithBalance: 1,
};
export const syntheticAdminOverview: AdminOverview = {
    asOf: '2026-09-30T12:00:00.000Z', businessTimezone: 'America/Managua',
    metrics: { registered: 5, real: 2, demo: 1, internal: 1, unclassified: 1, catalogReady: 1,
        activated: 1, active30d: 1, selling30d: 1, recurring30d: 1, inactive30d: 1, founders: 1,
        founderDatesUnknown: 1, benefitsEnding30d: 0, importedRows30d: 1, accountingWarnings30d: 0,
        assistantFailures30d: 1, businessesToReview: 1 },
    billing: { reconciledPaymentsThisMonth: [], mrr: null, payingSubscriptions: null, coverage: 'PARTIAL' },
    cohorts: [{ month: '2026-08', registered: 2, founders: 1, activated: 1, active30d: 1, recurring30d: 1 }],
    tenants: [syntheticAdminTenant], pagination: { page: 1, pageSize: 50, total: 1, pages: 1 },
    coverage: {
        classification: 'Sólo negocios reales verificados.', founderBenefit: 'Fechas por verificar.',
        activity: 'Actividad observada; recurrencia por días de Managua.', imports: 'Errores de importación sin cobertura.',
        errors: 'Cobertura parcial de errores.', billing: 'Pagos sólo con recibos conciliados. ACTIVE no acredita cobro.',
    },
};
