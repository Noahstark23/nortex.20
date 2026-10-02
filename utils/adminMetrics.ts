/** Contrato de lectura del admin. Ausencia de evidencia nunca equivale a cero. */
export type AdminBusinessKind = 'REAL' | 'DEMO' | 'INTERNAL' | 'UNKNOWN';
export type AdminFocus = 'NO_CATALOG' | 'NO_SALE' | 'INACTIVE' | 'ERRORS' | 'FOUNDER_DATES' | 'OPERATIONS';
export type AdminBenefitState = 'UNKNOWN' | 'NOT_FOUNDER' | 'DATES_UNKNOWN' | 'SCHEDULED' | 'CURRENT' | 'ENDING_SOON' | 'ENDED';

export interface AdminTenantRow {
    id: string;
    businessName: string;
    type: string;
    kind: AdminBusinessKind;
    createdAt: string;
    recordedSubscriptionStatus: string;
    planLabel: string | null;
    founder: boolean | null;
    benefitStartedAt: string | null;
    benefitEndsAt: string | null;
    benefitState: AdminBenefitState;
    products: number;
    confirmedSales: number;
    firstSaleAt: string | null;
    lastSaleAt: string | null;
    lastLoginAt: string | null;
    lastActivityAt: string | null;
    daysToFirstSale: number | null;
    sales30d: number;
    saleDays30d: number;
    importedRows30d: number;
    accountingWarnings30d: number;
    assistantFailures30d: number;
    negativeStockProducts: number;
    openShiftsOver24h: number;
    creditSalesWithBalance: number;
}

export interface AdminOverview {
    asOf: string;
    businessTimezone: 'America/Managua';
    metrics: {
        registered: number;
        real: number;
        demo: number;
        internal: number;
        unclassified: number;
        catalogReady: number;
        activated: number;
        active30d: number;
        selling30d: number;
        recurring30d: number;
        inactive30d: number;
        founders: number;
        founderDatesUnknown: number;
        benefitsEnding30d: number;
        importedRows30d: number;
        accountingWarnings30d: number;
        assistantFailures30d: number;
        businessesToReview: number;
    };
    billing: {
        reconciledPaymentsThisMonth: { currency: string; count: number; amount: string }[];
        mrr: null;
        payingSubscriptions: null;
        coverage: 'PARTIAL';
    };
    cohorts: { month: string; registered: number; founders: number; activated: number; active30d: number; recurring30d: number }[];
    tenants: AdminTenantRow[];
    pagination: { page: number; pageSize: number; total: number; pages: number };
    coverage: {
        classification: string;
        founderBenefit: string;
        activity: string;
        imports: string;
        errors: string;
        billing: string;
    };
}
