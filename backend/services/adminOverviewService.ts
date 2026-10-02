import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import type { AdminBenefitState, AdminBusinessKind, AdminFocus, AdminOverview, AdminTenantRow } from '../../utils/adminMetrics.js';
import { claveDelDiaManagua, inicioDelDiaManagua } from './pulsoPos.js';

export interface AdminOverviewQuery { page: number; kind?: AdminBusinessKind; search?: string; focus?: AdminFocus }
type RawRow = Record<string, string | number | bigint | Date | null>;
const PAGE_SIZE = 50;
const DAY = 86_400_000;
const count = (value: RawRow[string]): number => {
    const result = Number(value ?? 0);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('ADMIN_COUNT_INVALID');
    return result;
};
const iso = (value: RawRow[string]): string | null => {
    if (value instanceof Date) return value.toISOString();
    // MySQL date expressions (GREATEST/COALESCE) have a VARCHAR wire type.
    // Treat only the exact DB UTC format as a date, never a local browser date.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
        return new Date(value.replace(' ', 'T') + 'Z').toISOString();
    }
    return null;
};

/** Fechas sólo de evidencia explícita; no calcula un año a partir del alta/trial. */
export function adminBenefitState(founder: boolean | null, start: string | null, end: string | null, now: Date): AdminBenefitState {
    if (founder === null) return 'UNKNOWN';
    if (!founder) return 'NOT_FOUNDER';
    if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
        || Date.parse(end) <= Date.parse(start)) return 'DATES_UNKNOWN';
    if (Date.parse(start) > now.getTime()) return 'SCHEDULED';
    if (Date.parse(end) <= now.getTime()) return 'ENDED';
    return Date.parse(end) <= now.getTime() + 30 * DAY ? 'ENDING_SOON' : 'CURRENT';
}

// Únicamente usado detrás de authenticate + requireSuperAdmin. El alcance global
// es deliberado: no es una API de tenant ni acepta tenantId del cliente.
function operationalSnapshot(now: Date): Prisma.Sql {
    const since = new Date(now.getTime() - 30 * DAY);
    return Prisma.sql`WITH
      sale_usage AS (
        SELECT tenantId, COUNT(*) AS confirmedSales, SUM(status = 'CREDIT_PENDING' AND balance > 0) AS creditSalesWithBalance, MIN(createdAt) AS firstSaleAt, MAX(createdAt) AS lastSaleAt,
          SUM(createdAt >= ${since}) AS sales30d,
          COUNT(DISTINCT CASE WHEN createdAt >= ${since} THEN DATE(DATE_SUB(createdAt, INTERVAL 6 HOUR)) END) AS saleDays30d
        FROM Sale WHERE status IN ('COMPLETED', 'CREDIT_PENDING') AND cancelledAt IS NULL AND createdAt <= ${now}
        GROUP BY tenantId
      ), catalog AS (SELECT tenantId, COUNT(*) AS products, SUM(stock < 0) AS negativeStockProducts FROM Product GROUP BY tenantId),
      shifts AS (SELECT tenantId, COUNT(*) AS openShiftsOver24h FROM Shift WHERE status = 'OPEN' AND startTime <= ${new Date(now.getTime() - DAY)} GROUP BY tenantId),
      logins AS (
        SELECT tenantId, MAX(lastLogin) AS lastLoginAt FROM User
        WHERE role <> 'SUPER_ADMIN' AND lastLogin <= ${now} GROUP BY tenantId
      ), audits AS (
        SELECT a.tenantId, MAX(a.createdAt) AS lastOperationAt,
          SUM(a.createdAt >= ${since} AND (a.action = 'PRODUCT_BULK_UPDATED' OR
            (a.action = 'PRODUCT_CREATED' AND JSON_UNQUOTE(JSON_EXTRACT(
              CASE WHEN JSON_VALID(a.details) THEN a.details ELSE '{}' END, '$.source')) = 'BULK_IMPORT'))) AS importedRows30d,
          SUM(a.createdAt >= ${since} AND a.action = 'PAYROLL_JOURNAL_SKIPPED') AS accountingWarnings30d
        FROM AuditLog a JOIN User u ON u.id = a.userId AND u.tenantId = a.tenantId
        WHERE u.role <> 'SUPER_ADMIN' AND a.createdAt <= ${now} GROUP BY a.tenantId
      ), failures AS (
        SELECT tenantId, COUNT(*) AS assistantFailures30d FROM AssistantJob
        WHERE status = 'FAILED' AND updatedAt >= ${since} AND updatedAt <= ${now} GROUP BY tenantId
      ), snapshot AS (
        SELECT t.id, t.businessName, t.type, t.createdAt, t.subscriptionStatus AS recordedSubscriptionStatus,
          CASE WHEN e.businessKind IN ('REAL', 'DEMO', 'INTERNAL') THEN e.businessKind ELSE 'UNKNOWN' END AS kind,
          e.founder, e.benefitStartedAt, e.benefitEndsAt, e.planLabel,
          COALESCE(c.products, 0) AS products, COALESCE(c.negativeStockProducts, 0) AS negativeStockProducts,
          COALESCE(h.openShiftsOver24h, 0) AS openShiftsOver24h, COALESCE(s.creditSalesWithBalance, 0) AS creditSalesWithBalance, COALESCE(s.confirmedSales, 0) AS confirmedSales,
          s.firstSaleAt, s.lastSaleAt, l.lastLoginAt,
          NULLIF(GREATEST(COALESCE(s.lastSaleAt, '1000-01-01'), COALESCE(l.lastLoginAt, '1000-01-01'),
            COALESCE(a.lastOperationAt, '1000-01-01')), '1000-01-01') AS lastActivityAt,
          COALESCE(s.sales30d, 0) AS sales30d, COALESCE(s.saleDays30d, 0) AS saleDays30d,
          COALESCE(a.importedRows30d, 0) AS importedRows30d,
          COALESCE(a.accountingWarnings30d, 0) AS accountingWarnings30d,
          COALESCE(f.assistantFailures30d, 0) AS assistantFailures30d
        FROM Tenant t LEFT JOIN PlatformAccountEvidence e ON e.tenantId = t.id
          AND e.verifiedAt <= ${now} AND TRIM(e.evidenceReference) <> ''
        LEFT JOIN sale_usage s ON s.tenantId = t.id LEFT JOIN catalog c ON c.tenantId = t.id
        LEFT JOIN shifts h ON h.tenantId = t.id LEFT JOIN logins l ON l.tenantId = t.id LEFT JOIN audits a ON a.tenantId = t.id
        LEFT JOIN failures f ON f.tenantId = t.id WHERE t.createdAt <= ${now}
      )`;
}

export function createAdminOverviewService(db: Pick<PrismaClient, '$transaction'> = prisma, clock = () => new Date()) {
    return {
        async getOverview(query: AdminOverviewQuery): Promise<AdminOverview> {
            const now = clock();
            const since = new Date(now.getTime() - 30 * DAY);
            const ending = new Date(now.getTime() + 30 * DAY);
            const monthStart = inicioDelDiaManagua(new Date(`${claveDelDiaManagua(now).slice(0, 7)}-01T06:00:00.000Z`));
            const cte = operationalSnapshot(now);
            const focus = {
                NO_CATALOG: Prisma.sql`products = 0`, NO_SALE: Prisma.sql`confirmedSales = 0`,
                INACTIVE: Prisma.sql`createdAt <= ${since} AND (lastActivityAt IS NULL OR lastActivityAt < ${since})`,
                ERRORS: Prisma.sql`accountingWarnings30d > 0 OR assistantFailures30d > 0`,
                FOUNDER_DATES: Prisma.sql`founder = 1 AND (benefitStartedAt IS NULL OR benefitEndsAt IS NULL OR benefitEndsAt <= benefitStartedAt)`,
                OPERATIONS: Prisma.sql`negativeStockProducts > 0 OR openShiftsOver24h > 0 OR creditSalesWithBalance > 0`,
            };
            const focusWhere = query.focus ? focus[query.focus] : Prisma.sql`1 = 1`;
            const match = Prisma.sql`(${focusWhere}) AND (${query.kind ?? null} IS NULL OR kind = ${query.kind ?? null})
              AND (${query.search ?? ''} = '' OR INSTR(LOWER(businessName), LOWER(${query.search ?? ''})) > 0)`;

            // Una vista consistente, sólo lecturas agregadas en SQL y página limitada.
            return db.$transaction(async tx => {
                const [summary] = await tx.$queryRaw<RawRow[]>(Prisma.sql`${cte} SELECT
                  COUNT(*) AS registered, SUM(kind = 'REAL') AS realCount, SUM(kind = 'DEMO') AS demo,
                  SUM(kind = 'INTERNAL') AS internal, SUM(kind = 'UNKNOWN') AS unclassified,
                  SUM(kind = 'REAL' AND products > 0) AS catalogReady,
                  SUM(kind = 'REAL' AND confirmedSales > 0) AS activated,
                  SUM(kind = 'REAL' AND lastActivityAt >= ${since}) AS active30d,
                  SUM(kind = 'REAL' AND sales30d > 0) AS selling30d,
                  SUM(kind = 'REAL' AND saleDays30d >= 2) AS recurring30d,
                  SUM(kind = 'REAL' AND createdAt <= ${since} AND (lastActivityAt IS NULL OR lastActivityAt < ${since})) AS inactive30d,
                  SUM(kind = 'REAL' AND founder = 1) AS founders,
                  SUM(kind = 'REAL' AND founder = 1 AND (benefitStartedAt IS NULL OR benefitEndsAt IS NULL OR benefitEndsAt <= benefitStartedAt)) AS founderDatesUnknown,
                  SUM(kind = 'REAL' AND founder = 1 AND benefitStartedAt <= ${now} AND benefitEndsAt > benefitStartedAt
                    AND benefitEndsAt > ${now} AND benefitEndsAt <= ${ending}) AS benefitsEnding30d,
                  SUM(IF(kind = 'REAL', importedRows30d, 0)) AS importedRows30d,
                  SUM(IF(kind = 'REAL', accountingWarnings30d, 0)) AS accountingWarnings30d,
                  SUM(IF(kind = 'REAL', assistantFailures30d, 0)) AS assistantFailures30d,
                  SUM(kind = 'REAL' AND (negativeStockProducts > 0 OR openShiftsOver24h > 0 OR creditSalesWithBalance > 0)) AS businessesToReview FROM snapshot`);
                const [matched] = await tx.$queryRaw<RawRow[]>(Prisma.sql`${cte} SELECT COUNT(*) AS total FROM snapshot WHERE ${match}`);
                const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`${cte} SELECT * FROM snapshot WHERE ${match}
                  ORDER BY createdAt DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ${(query.page - 1) * PAGE_SIZE}`);
                const cohorts = await tx.$queryRaw<RawRow[]>(Prisma.sql`${cte}
                  SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL 6 HOUR), '%Y-%m') AS month,
                    COUNT(*) AS registered, SUM(founder = 1) AS founders,
                    SUM(confirmedSales > 0) AS activated, SUM(lastActivityAt >= ${since}) AS active30d,
                    SUM(saleDays30d >= 2) AS recurring30d
                  FROM snapshot WHERE kind = 'REAL' GROUP BY month ORDER BY month DESC LIMIT 12`);
                // Sólo recibos conciliados. Ni ventas POS, wallets, aprobación de
                // vouchers legacy, ni subscriptionStatus prueban un ingreso SaaS.
                const payments = await tx.$queryRaw<RawRow[]>(Prisma.sql`
                  SELECT UPPER(p.currency) AS currency, COUNT(*) AS count, SUM(p.amount) AS amount
                  FROM PlatformPaymentEvidence p JOIN PlatformAccountEvidence e ON e.tenantId = p.tenantId
                  WHERE e.businessKind = 'REAL' AND e.verifiedAt <= ${now} AND TRIM(e.evidenceReference) <> ''
                    AND p.paidAt >= ${monthStart} AND p.paidAt <= ${now} AND p.reconciledAt <= ${now}
                    AND TRIM(p.evidenceReference) <> '' AND p.amount > 0 AND UPPER(p.currency) IN ('USD', 'NIO')
                  GROUP BY UPPER(p.currency)`);
                const metrics = Object.fromEntries([
                    'registered', 'real', 'demo', 'internal', 'unclassified', 'catalogReady', 'activated', 'active30d',
                    'selling30d', 'recurring30d', 'inactive30d', 'founders', 'founderDatesUnknown', 'benefitsEnding30d',
                    'importedRows30d', 'accountingWarnings30d', 'assistantFailures30d', 'businessesToReview',
                ].map(key => [key, count(summary?.[key === 'real' ? 'realCount' : key])])) as AdminOverview['metrics'];
                const tenants: AdminTenantRow[] = rows.map(row => {
                    const founder = row.founder === null ? null : Boolean(Number(row.founder));
                    const start = iso(row.benefitStartedAt), end = iso(row.benefitEndsAt);
                    const created = iso(row.createdAt)!;
                    const first = iso(row.firstSaleAt);
                    return {
                        id: String(row.id), businessName: String(row.businessName), type: String(row.type),
                        kind: row.kind as AdminBusinessKind, createdAt: created,
                        recordedSubscriptionStatus: String(row.recordedSubscriptionStatus), planLabel: row.planLabel ? String(row.planLabel) : null,
                        founder, benefitStartedAt: start, benefitEndsAt: end, benefitState: adminBenefitState(founder, start, end, now),
                        products: count(row.products), confirmedSales: count(row.confirmedSales), firstSaleAt: first,
                        lastSaleAt: iso(row.lastSaleAt), lastLoginAt: iso(row.lastLoginAt), lastActivityAt: iso(row.lastActivityAt),
                        daysToFirstSale: first && first >= created ? Math.floor((Date.parse(first) - Date.parse(created)) / DAY) : null,
                        sales30d: count(row.sales30d), saleDays30d: count(row.saleDays30d), importedRows30d: count(row.importedRows30d),
                        accountingWarnings30d: count(row.accountingWarnings30d), assistantFailures30d: count(row.assistantFailures30d),
                        negativeStockProducts: count(row.negativeStockProducts), openShiftsOver24h: count(row.openShiftsOver24h), creditSalesWithBalance: count(row.creditSalesWithBalance),
                    };
                });
                const total = count(matched?.total);
                return {
                    asOf: now.toISOString(), businessTimezone: 'America/Managua', metrics,
                    billing: {
                        reconciledPaymentsThisMonth: payments.map(row => ({ currency: String(row.currency), count: count(row.count),
                            amount: new Prisma.Decimal(String(row.amount)).toFixed(4) })),
                        mrr: null, payingSubscriptions: null, coverage: 'PARTIAL',
                    },
                    cohorts: cohorts.map(row => ({ month: String(row.month), registered: count(row.registered), founders: count(row.founders),
                        activated: count(row.activated), active30d: count(row.active30d), recurring30d: count(row.recurring30d) })),
                    tenants, pagination: { page: query.page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
                    coverage: {
                        classification: 'Sólo REAL verificado entra en KPIs operativos y cohortes. Demos, internos y cuentas sin clasificación quedan separados.',
                        founderBenefit: 'Noel confirmó el 30/09/2026 un año gratis para los fundadores y ningún pago hasta esa fecha. La pertenencia y las fechas por cuenta requieren evidencia; alta y trial legacy no la sustituyen.',
                        activity: 'Actividad observada: ventas confirmadas, último login y auditoría del comercio. Recurrencia: ventas en al menos dos días de Managua en los últimos 30 días. No hay historial completo de sesiones.',
                        imports: 'Filas confirmadas por auditoría de carga masiva en 30 días; no cuenta archivos ni errores de importación, que no están persistidos.',
                        errors: 'Cobertura parcial: omisiones de asiento de nómina y trabajos de asistente fallidos en 30 días. No representa todos los errores HTTP, offline o de importación. Existencias negativas, turnos OPEN de 24 horas y facturas de fiado con saldo son señales para revisar, no errores demostrados.',
                        billing: 'Recibos de Nortex conciliados del mes, separados por moneda; cobertura histórica parcial. MRR y suscripciones pagadas desconocidos. ACTIVE, trial y vouchers APPROVED no prueban cobro.',
                    },
                };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
        },
    };
}
