import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import {
    SALES_DOCUMENT_MAX_TRANSACTIONS,
    SALES_EXPORT_MAX_RETURNS,
    SALES_EXPORT_MAX_TRANSACTIONS,
    SALES_REPORT_MAX_PRODUCT_GROUPS,
    SALES_REPORT_MAX_RETURN_LINES_TOTAL,
    SALES_REPORT_MAX_RETURN_RECORDS,
    SalesReportError,
    canReadShiftReport,
    foldSalesReportData,
    parseReturnedItems,
    parseShiftCloseReportPayload,
    saleVatFromSnapshot,
    type ExpenseDailyAggregateInput,
    type ReturnRecordInput,
    type ReturnedItemAuthority,
    type SalesAggregateInput,
    type SalesReportContext,
    type SalesDailyAggregateInput,
    type SalesPaymentAggregateInput,
    type SalesProductAggregateInput,
    type SalesReportData,
    type SalesReportRange,
    type SalesReportScope,
} from '../lib/salesReport.js';
import { hashShiftCloseReport, type ShiftCloseReportPayload } from '../lib/shiftCloseReport.js';

export interface SalesReportPrincipal {
    tenantId: string;
    userId: string;
    role: string;
}

export interface SalesTransactionItemSummary {
    lineCount: number;
    baseQuantity: string;
}

export interface SalesTransactionRow {
    id: string;
    invoice: string;
    createdAt: string;
    businessDate: string;
    customer: { id: string | null; name: string };
    seller: { id: string | null; name: string };
    cashier: { id: string | null; name: string };
    paymentMethod: string;
    total: string;
    vatCollected: string;
    returnedTotal: string;
    netTotal: string;
    status: string;
    items: SalesTransactionItemSummary;
}

export interface PaginatedSalesTransactions {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    items: SalesTransactionRow[];
}

export interface SalesDocumentData {
    report: SalesReportData;
    transactions: SalesTransactionRow[];
}

export interface SalesExportData extends SalesDocumentData {
    returns: SalesReportData['returns'];
}

export interface ShiftReportSnapshotView {
    id: string;
    shiftId: string;
    folio: string;
    businessDate: string;
    version: number;
    contentHash: string;
    createdAt: string;
    documentUrl: string;
    report: ShiftCloseReportPayload;
}

export interface SalesReportService {
    getReport(context: SalesReportContext, range: SalesReportRange): Promise<SalesReportData>;
    getTransactions(
        context: SalesReportContext,
        range: SalesReportRange,
        page: number,
        pageSize: number,
    ): Promise<PaginatedSalesTransactions>;
    getDocumentData(context: SalesReportContext, range: SalesReportRange): Promise<SalesDocumentData>;
    getExportData(context: SalesReportContext, range: SalesReportRange): Promise<SalesExportData>;
    getShiftSnapshot(principal: SalesReportPrincipal, shiftId: string): Promise<ShiftReportSnapshotView>;
}

type ReportDb = Pick<PrismaClient, '$queryRaw'>;

const MAX_RETURN_ITEM_AUTHORITIES = 20_000;

function salesScopeSql(scope: SalesReportScope): Prisma.Sql {
    if (scope.kind === 'seller') return Prisma.sql`AND s.\`soldById\` = ${scope.userId}`;
    if (scope.kind === 'shift-owner') return Prisma.sql`AND sh.\`userId\` = ${scope.userId}`;
    return Prisma.sql``;
}

function returnScopeSql(scope: SalesReportScope): Prisma.Sql {
    // Las devoluciones se atribuyen a la venta original. ProductReturn no
    // duplica vendedor ni dueño de turno; el join mantiene una sola autoridad.
    return salesScopeSql(scope);
}

function dbText(value: unknown, fallback = '0'): string {
    if (value == null) return fallback;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
    if (typeof value === 'object' && 'toString' in value) return String(value);
    return fallback;
}

function dbDate(value: unknown): Date {
    if (value instanceof Date) return value;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        throw new SalesReportError('REPORT_DATA_INVALID', 409, 'El reporte contiene una fecha inválida.');
    }
    return parsed;
}

function dbCount(value: unknown): number {
    const parsed = Number(dbText(value));
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new SalesReportError('REPORT_DATA_INVALID', 409, 'El reporte contiene un conteo inválido.');
    }
    return parsed;
}

function businessDate(value: Date): string {
    return new Date(value.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
}

const taxableGrossSql = Prisma.sql`
    GREATEST(
        s.\`total\` - LEAST(GREATEST(COALESCE(s.\`exemptTotal\`, 0), 0), s.\`total\`),
        0
    )
`;

const saleVatSql = Prisma.sql`
    CASE
        WHEN s.\`fiscalRegimeAtSale\` = 'CUOTA_FIJA' THEN 0
        WHEN s.\`vatAmountAtSale\` IS NOT NULL
            AND s.\`vatAmountAtSale\` >= 0
            AND s.\`vatAmountAtSale\` <= ${taxableGrossSql}
            THEN ROUND(s.\`vatAmountAtSale\`, 4)
        ELSE ROUND(
            ${taxableGrossSql} - ROUND(${taxableGrossSql} / 1.15, 4),
            4
        )
    END
`;

const unitPriceSql = Prisma.sql`COALESCE(si.\`unitPriceExactAtSale\`, si.\`priceAtSale\`)`;
const lineBeforeDiscountSql = Prisma.sql`
    ${unitPriceSql} * CAST(si.\`quantity\` AS DECIMAL(30, 4))
`;
const lineAfterDiscountSql = Prisma.sql`
    ${lineBeforeDiscountSql}
    * (1 - CAST(COALESCE(si.\`discount\`, 0) AS DECIMAL(18, 6)) / 100)
    * (1 - CAST(COALESCE(s.\`globalDiscount\`, 0) AS DECIMAL(18, 6)) / 100)
`;

interface AggregateRow {
    grossSales: unknown;
    grossVat: unknown;
    transactionCount: unknown;
}

interface LineAggregateRow {
    productGrossSales: unknown;
    grossCogs: unknown;
    discountTotal: unknown;
    itemQuantityGross: unknown;
}

interface PaymentRow {
    method: unknown;
    transactionCount: unknown;
    grossSales: unknown;
}

interface ProductRow {
    productId: unknown;
    productName: unknown;
    saleMode: unknown;
    presentation: unknown;
    baseUnit: unknown;
    displayUnit: unknown;
    usedFallbackUnit: unknown;
    quantityGross: unknown;
    baseQuantityGross: unknown;
    grossSales: unknown;
    grossVat: unknown;
    cogs: unknown;
}

interface DailyRow {
    date: unknown;
    grossSales: unknown;
    grossVat: unknown;
    transactionCount: unknown;
}

interface ExpenseRow {
    date: unknown;
    expenses: unknown;
}

interface BusinessRow {
    businessName: unknown;
    taxId: unknown;
    address: unknown;
    phone: unknown;
}

interface ReturnDbRow {
    id: unknown;
    saleId: unknown;
    createdAt: unknown;
    total: unknown;
    items: unknown;
    reason: unknown;
    paymentMethod: unknown;
    fiscalRegimeAtSale: unknown;
    saleTotal: unknown;
    saleExemptTotal: unknown;
    saleVatAmountAtSale: unknown;
}

interface ReturnBudgetRow {
    returnCount: unknown;
    returnLineCount: unknown;
}

interface ReturnAuthorityDbRow {
    saleItemId: unknown;
    productId: unknown;
    productName: unknown;
    unit: unknown;
    usedFallbackUnit: unknown;
    saleMode: unknown;
    presentation: unknown;
    presentationQuantityAtSale: unknown;
    soldQuantityAtSale: unknown;
    costAtSale: unknown;
    ivaExento: unknown;
}

function asReturnRecords(rows: readonly ReturnDbRow[]): ReturnRecordInput[] {
    return rows.map((row) => ({
        id: dbText(row.id, ''),
        saleId: dbText(row.saleId, ''),
        createdAt: dbDate(row.createdAt),
        total: dbText(row.total),
        items: row.items,
        reason: typeof row.reason === 'string' ? row.reason : '',
        paymentMethod: dbText(row.paymentMethod, 'UNKNOWN'),
        fiscalRegimeAtSale: row.fiscalRegimeAtSale,
        saleTotal: dbText(row.saleTotal),
        saleExemptTotal: dbText(row.saleExemptTotal),
        saleVatAmountAtSale: row.saleVatAmountAtSale == null
            ? null
            : dbText(row.saleVatAmountAtSale),
    }));
}

function rawSaleItemIds(records: readonly ReturnRecordInput[]): string[] {
    const ids = new Set<string>();
    for (const record of records) {
        for (const item of parseReturnedItems(record.items).items) {
            if (item.saleItemId) ids.add(item.saleItemId);
        }
    }
    if (ids.size > MAX_RETURN_ITEM_AUTHORITIES) {
        throw new SalesReportError(
            'REPORT_DETAIL_LIMIT_EXCEEDED',
            422,
            'El período contiene demasiadas líneas devueltas. Reducí el rango.',
        );
    }
    return [...ids];
}

function asAuthorities(rows: readonly ReturnAuthorityDbRow[]): Map<string, ReturnedItemAuthority> {
    return new Map(rows.map((row) => {
        const saleItemId = dbText(row.saleItemId, '');
        return [saleItemId, {
            saleItemId,
            productId: dbText(row.productId, 'legacy-product'),
            productName: dbText(row.productName, 'Producto legado'),
            unit: dbText(row.unit, 'unidad'),
            usedFallbackUnit: row.usedFallbackUnit === true
                || row.usedFallbackUnit === 1
                || row.usedFallbackUnit === BigInt(1),
            saleMode: row.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
            presentation: row.presentation === 'PACK' ? 'PACK' : 'BASE',
            presentationQuantityAtSale: row.presentationQuantityAtSale == null
                ? null
                : dbText(row.presentationQuantityAtSale),
            soldQuantityAtSale: dbText(row.soldQuantityAtSale),
            costAtSale: dbText(row.costAtSale),
            ivaExento: row.ivaExento === true || row.ivaExento === 1 || row.ivaExento === BigInt(1),
        } satisfies ReturnedItemAuthority];
    }));
}

async function fetchReturnRecords(
    db: ReportDb,
    context: SalesReportContext,
    range: SalesReportRange,
): Promise<ReturnRecordInput[]> {
    const scope = returnScopeSql(context.scope);
    const limit = SALES_REPORT_MAX_RETURN_RECORDS + 1;
    const budgetRows = await db.$queryRaw<ReturnBudgetRow[]>(Prisma.sql`
        SELECT
            COUNT(*) AS returnCount,
            COALESCE(SUM(
                CASE
                    WHEN JSON_TYPE(pr.\`items\`) = 'ARRAY' THEN JSON_LENGTH(pr.\`items\`)
                    ELSE 1
                END
            ), 0) AS returnLineCount
        FROM \`ProductReturn\` pr
        INNER JOIN \`Sale\` s
            ON s.\`id\` = pr.\`saleId\`
            AND s.\`tenantId\` = pr.\`tenantId\`
        LEFT JOIN \`Shift\` sh
            ON sh.\`id\` = s.\`shiftId\`
            AND sh.\`tenantId\` = s.\`tenantId\`
        WHERE pr.\`tenantId\` = ${context.tenantId}
            AND pr.\`createdAt\` >= ${range.start}
            AND pr.\`createdAt\` < ${range.endExclusive}
            AND s.\`status\` <> 'VOIDED'
            ${scope}
    `);
    const budget = budgetRows[0];
    const returnCount = dbCount(budget?.returnCount ?? 0);
    const returnLineCount = dbCount(budget?.returnLineCount ?? 0);
    if (returnCount > SALES_REPORT_MAX_RETURN_RECORDS) {
        throw new SalesReportError(
            'REPORT_DETAIL_LIMIT_EXCEEDED',
            422,
            `El período supera ${SALES_REPORT_MAX_RETURN_RECORDS} devoluciones. Reducí el rango.`,
        );
    }
    if (returnLineCount > SALES_REPORT_MAX_RETURN_LINES_TOTAL) {
        throw new SalesReportError(
            'REPORT_RETURN_LINE_LIMIT_EXCEEDED',
            422,
            `El período supera ${SALES_REPORT_MAX_RETURN_LINES_TOTAL} líneas devueltas. Reducí el rango.`,
        );
    }
    const rows = await db.$queryRaw<ReturnDbRow[]>(Prisma.sql`
        SELECT
            pr.\`id\` AS id,
            pr.\`saleId\` AS saleId,
            pr.\`createdAt\` AS createdAt,
            pr.\`total\` AS total,
            pr.\`items\` AS items,
            pr.\`reason\` AS reason,
            s.\`paymentMethod\` AS paymentMethod,
            s.\`fiscalRegimeAtSale\` AS fiscalRegimeAtSale,
            s.\`total\` AS saleTotal,
            s.\`exemptTotal\` AS saleExemptTotal,
            s.\`vatAmountAtSale\` AS saleVatAmountAtSale
        FROM \`ProductReturn\` pr
        INNER JOIN \`Sale\` s
            ON s.\`id\` = pr.\`saleId\`
            AND s.\`tenantId\` = pr.\`tenantId\`
        LEFT JOIN \`Shift\` sh
            ON sh.\`id\` = s.\`shiftId\`
            AND sh.\`tenantId\` = s.\`tenantId\`
        WHERE pr.\`tenantId\` = ${context.tenantId}
            AND pr.\`createdAt\` >= ${range.start}
            AND pr.\`createdAt\` < ${range.endExclusive}
            AND s.\`status\` <> 'VOIDED'
            ${scope}
        ORDER BY pr.\`createdAt\` ASC, pr.\`id\` ASC
        LIMIT ${limit}
    `);
    if (rows.length > SALES_REPORT_MAX_RETURN_RECORDS) {
        throw new SalesReportError(
            'REPORT_DETAIL_LIMIT_EXCEEDED',
            422,
            `El período supera ${SALES_REPORT_MAX_RETURN_RECORDS} devoluciones. Reducí el rango.`,
        );
    }
    return asReturnRecords(rows);
}

async function fetchReturnAuthorities(
    db: ReportDb,
    tenantId: string,
    records: readonly ReturnRecordInput[],
): Promise<Map<string, ReturnedItemAuthority>> {
    const ids = rawSaleItemIds(records);
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<ReturnAuthorityDbRow[]>(Prisma.sql`
        SELECT
            si.\`id\` AS saleItemId,
            si.\`productId\` AS productId,
            COALESCE(NULLIF(TRIM(si.\`productNameAtSale\`), ''), si.\`productId\`) AS productName,
            COALESCE(NULLIF(TRIM(si.\`unitAtSale\`), ''), 'unidad') AS unit,
            CASE WHEN NULLIF(TRIM(si.\`unitAtSale\`), '') IS NULL THEN 1 ELSE 0 END AS usedFallbackUnit,
            CASE WHEN si.\`saleModeAtSale\` = 'COUNTED' THEN 'COUNTED' ELSE 'MEASURED' END AS saleMode,
            CASE WHEN si.\`presentationAtSale\` = 'PACK' THEN 'PACK' ELSE 'BASE' END AS presentation,
            si.\`presentationQuantityAtSale\` AS presentationQuantityAtSale,
            CAST(si.\`quantity\` AS DECIMAL(30, 4)) AS soldQuantityAtSale,
            si.\`costAtSale\` AS costAtSale,
            si.\`ivaExento\` AS ivaExento
        FROM \`SaleItem\` si
        INNER JOIN \`Sale\` s ON s.\`id\` = si.\`saleId\`
        WHERE s.\`tenantId\` = ${tenantId}
            AND si.\`id\` IN (${Prisma.join(ids)})
    `);
    return asAuthorities(rows);
}

async function buildReport(
    db: ReportDb,
    context: SalesReportContext,
    range: SalesReportRange,
): Promise<SalesReportData> {
    const scope = salesScopeSql(context.scope);
    const productLimit = SALES_REPORT_MAX_PRODUCT_GROUPS + 1;

    const [
        aggregateRows,
        lineRows,
        paymentRows,
        productRows,
        dailyRows,
        expenseRows,
        returnRecords,
        businessRows,
    ] = await Promise.all([
        db.$queryRaw<AggregateRow[]>(Prisma.sql`
            SELECT
                COALESCE(SUM(s.\`total\`), 0) AS grossSales,
                COALESCE(SUM(${saleVatSql}), 0) AS grossVat,
                COUNT(*) AS transactionCount
            FROM \`Sale\` s
            LEFT JOIN \`Shift\` sh
                ON sh.\`id\` = s.\`shiftId\`
                AND sh.\`tenantId\` = s.\`tenantId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND s.\`createdAt\` >= ${range.start}
                AND s.\`createdAt\` < ${range.endExclusive}
                AND s.\`status\` <> 'VOIDED'
                ${scope}
        `),
        db.$queryRaw<LineAggregateRow[]>(Prisma.sql`
            SELECT
                COALESCE(SUM(${lineAfterDiscountSql}), 0) AS productGrossSales,
                COALESCE(SUM(si.\`costAtSale\` * CAST(si.\`quantity\` AS DECIMAL(30, 4))), 0) AS grossCogs,
                COALESCE(SUM(${lineBeforeDiscountSql} - ${lineAfterDiscountSql}), 0) AS discountTotal,
                COALESCE(SUM(CAST(si.\`quantity\` AS DECIMAL(30, 4))), 0) AS itemQuantityGross
            FROM \`SaleItem\` si
            INNER JOIN \`Sale\` s ON s.\`id\` = si.\`saleId\`
            LEFT JOIN \`Shift\` sh
                ON sh.\`id\` = s.\`shiftId\`
                AND sh.\`tenantId\` = s.\`tenantId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND s.\`createdAt\` >= ${range.start}
                AND s.\`createdAt\` < ${range.endExclusive}
                AND s.\`status\` <> 'VOIDED'
                ${scope}
        `),
        db.$queryRaw<PaymentRow[]>(Prisma.sql`
            SELECT
                s.\`paymentMethod\` AS method,
                COUNT(*) AS transactionCount,
                COALESCE(SUM(s.\`total\`), 0) AS grossSales
            FROM \`Sale\` s
            LEFT JOIN \`Shift\` sh
                ON sh.\`id\` = s.\`shiftId\`
                AND sh.\`tenantId\` = s.\`tenantId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND s.\`createdAt\` >= ${range.start}
                AND s.\`createdAt\` < ${range.endExclusive}
                AND s.\`status\` <> 'VOIDED'
                ${scope}
            GROUP BY s.\`paymentMethod\`
        `),
        db.$queryRaw<ProductRow[]>(Prisma.sql`
            SELECT
                si.\`productId\` AS productId,
                COALESCE(NULLIF(TRIM(si.\`productNameAtSale\`), ''), si.\`productId\`) AS productName,
                CASE WHEN si.\`saleModeAtSale\` = 'COUNTED' THEN 'COUNTED' ELSE 'MEASURED' END AS saleMode,
                CASE WHEN si.\`presentationAtSale\` = 'PACK' THEN 'PACK' ELSE 'BASE' END AS presentation,
                COALESCE(NULLIF(TRIM(si.\`unitAtSale\`), ''), 'unidad') AS baseUnit,
                CASE
                    WHEN si.\`presentationAtSale\` = 'PACK' THEN CONCAT(
                        'empaque(s) · base ',
                        COALESCE(NULLIF(TRIM(si.\`unitAtSale\`), ''), 'unidad')
                    )
                    WHEN NULLIF(TRIM(si.\`unitAtSale\`), '') IS NULL THEN 'unidad (fallback)'
                    ELSE TRIM(si.\`unitAtSale\`)
                END AS displayUnit,
                CASE WHEN NULLIF(TRIM(si.\`unitAtSale\`), '') IS NULL THEN 1 ELSE 0 END AS usedFallbackUnit,
                COALESCE(SUM(
                    CASE
                        WHEN si.\`presentationAtSale\` = 'PACK'
                            AND si.\`presentationQuantityAtSale\` IS NOT NULL
                            THEN si.\`presentationQuantityAtSale\`
                        ELSE CAST(si.\`quantity\` AS DECIMAL(30, 4))
                    END
                ), 0) AS quantityGross,
                COALESCE(SUM(CAST(si.\`quantity\` AS DECIMAL(30, 4))), 0) AS baseQuantityGross,
                COALESCE(SUM(${lineAfterDiscountSql}), 0) AS grossSales,
                COALESCE(SUM(
                    CASE
                        WHEN s.\`fiscalRegimeAtSale\` = 'CUOTA_FIJA' OR si.\`ivaExento\` = 1 THEN 0
                        ELSE ${lineAfterDiscountSql}
                            - ROUND(${lineAfterDiscountSql} / 1.15, 4)
                    END
                ), 0) AS grossVat,
                COALESCE(SUM(si.\`costAtSale\` * CAST(si.\`quantity\` AS DECIMAL(30, 4))), 0) AS cogs
            FROM \`SaleItem\` si
            INNER JOIN \`Sale\` s ON s.\`id\` = si.\`saleId\`
            LEFT JOIN \`Shift\` sh
                ON sh.\`id\` = s.\`shiftId\`
                AND sh.\`tenantId\` = s.\`tenantId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND s.\`createdAt\` >= ${range.start}
                AND s.\`createdAt\` < ${range.endExclusive}
                AND s.\`status\` <> 'VOIDED'
                ${scope}
            GROUP BY
                si.\`productId\`, productName, saleMode, presentation,
                baseUnit, displayUnit, usedFallbackUnit
            ORDER BY grossSales DESC, productName ASC
            LIMIT ${productLimit}
        `),
        db.$queryRaw<DailyRow[]>(Prisma.sql`
            SELECT
                DATE_FORMAT(DATE_SUB(s.\`createdAt\`, INTERVAL 6 HOUR), '%Y-%m-%d') AS date,
                COALESCE(SUM(s.\`total\`), 0) AS grossSales,
                COALESCE(SUM(${saleVatSql}), 0) AS grossVat,
                COUNT(*) AS transactionCount
            FROM \`Sale\` s
            LEFT JOIN \`Shift\` sh
                ON sh.\`id\` = s.\`shiftId\`
                AND sh.\`tenantId\` = s.\`tenantId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND s.\`createdAt\` >= ${range.start}
                AND s.\`createdAt\` < ${range.endExclusive}
                AND s.\`status\` <> 'VOIDED'
                ${scope}
            GROUP BY date
            ORDER BY date ASC
        `),
        context.scope.kind === 'tenant'
            ? db.$queryRaw<ExpenseRow[]>(Prisma.sql`
                SELECT
                    DATE_FORMAT(DATE_SUB(e.\`createdAt\`, INTERVAL 6 HOUR), '%Y-%m-%d') AS date,
                    COALESCE(SUM(e.\`amount\`), 0) AS expenses
                FROM \`Expense\` e
                WHERE e.\`tenantId\` = ${context.tenantId}
                    AND e.\`createdAt\` >= ${range.start}
                    AND e.\`createdAt\` < ${range.endExclusive}
                GROUP BY date
                ORDER BY date ASC
            `)
            : Promise.resolve([]),
        fetchReturnRecords(db, context, range),
        db.$queryRaw<BusinessRow[]>(Prisma.sql`
            SELECT t.\`businessName\` AS businessName, t.\`taxId\` AS taxId,
                t.\`address\` AS address, t.\`phone\` AS phone
            FROM \`Tenant\` t
            WHERE t.\`id\` = ${context.tenantId}
            LIMIT 1
        `),
    ]);

    if (productRows.length > SALES_REPORT_MAX_PRODUCT_GROUPS) {
        throw new SalesReportError(
            'REPORT_DETAIL_LIMIT_EXCEEDED',
            422,
            `El período supera ${SALES_REPORT_MAX_PRODUCT_GROUPS} grupos de producto. Reducí el rango.`,
        );
    }
    const authorities = await fetchReturnAuthorities(db, context.tenantId, returnRecords);
    const business = businessRows[0];
    if (!business) {
        throw new SalesReportError('REPORT_TENANT_NOT_FOUND', 404, 'El negocio no existe.');
    }
    const aggregate = aggregateRows[0] ?? { grossSales: 0, grossVat: 0, transactionCount: 0 };
    const lines = lineRows[0] ?? {
        productGrossSales: 0,
        grossCogs: 0,
        discountTotal: 0,
        itemQuantityGross: 0,
    };
    const sales: SalesAggregateInput = {
        grossSales: dbText(aggregate.grossSales),
        grossVat: dbText(aggregate.grossVat),
        transactionCount: dbText(aggregate.transactionCount),
        productGrossSales: dbText(lines.productGrossSales),
        grossCogs: dbText(lines.grossCogs),
        discountTotal: dbText(lines.discountTotal),
        itemQuantityGross: dbText(lines.itemQuantityGross),
    };
    const payments: SalesPaymentAggregateInput[] = paymentRows.map((row) => ({
        method: dbText(row.method, 'UNKNOWN'),
        transactionCount: dbText(row.transactionCount),
        grossSales: dbText(row.grossSales),
    }));
    const products: SalesProductAggregateInput[] = productRows.map((row) => ({
        productId: dbText(row.productId, 'legacy-product'),
        productName: dbText(row.productName, 'Producto legado'),
        saleMode: dbText(row.saleMode, 'MEASURED'),
        presentation: dbText(row.presentation, 'BASE'),
        baseUnit: dbText(row.baseUnit, 'unidad'),
        displayUnit: dbText(row.displayUnit, 'unidad'),
        usedFallbackUnit: dbText(row.usedFallbackUnit) === '1',
        quantityGross: dbText(row.quantityGross),
        baseQuantityGross: dbText(row.baseQuantityGross),
        grossSales: dbText(row.grossSales),
        grossVat: dbText(row.grossVat),
        cogs: dbText(row.cogs),
    }));
    const daily: SalesDailyAggregateInput[] = dailyRows.map((row) => ({
        date: dbText(row.date, ''),
        grossSales: dbText(row.grossSales),
        grossVat: dbText(row.grossVat),
        transactionCount: dbText(row.transactionCount),
    }));
    const expenses: ExpenseDailyAggregateInput[] = expenseRows.map((row) => ({
        date: dbText(row.date, ''),
        expenses: dbText(row.expenses),
    }));

    return foldSalesReportData({
        range,
        sales,
        paymentRows: payments,
        productRows: products,
        dailyRows: daily,
        expenseRows: expenses,
        returnRecords,
        returnedItemAuthorities: authorities,
        business: {
            name: dbText(business.businessName, 'Nortex'),
            taxId: dbText(business.taxId, ''),
            address: dbText(business.address, ''),
            phone: dbText(business.phone, ''),
        },
    });
}

interface TransactionDbRow {
    id: unknown;
    invoiceNumber: unknown;
    invoiceSeries: unknown;
    createdAt: unknown;
    customerId: unknown;
    customerName: unknown;
    sellerId: unknown;
    sellerName: unknown;
    employeeId: unknown;
    cashierFirstName: unknown;
    cashierLastName: unknown;
    paymentMethod: unknown;
    total: unknown;
    exemptTotal: unknown;
    fiscalRegimeAtSale: unknown;
    vatAmountAtSale: unknown;
    status: unknown;
}

interface TransactionItemDbRow {
    saleId: unknown;
    lineCount: unknown;
    baseQuantity: unknown;
}

interface TransactionReturnDbRow {
    saleId: unknown;
    returnedTotal: unknown;
}

async function fetchTransactions(
    db: ReportDb,
    context: SalesReportContext,
    range: SalesReportRange,
    page: number,
    pageSize: number,
): Promise<PaginatedSalesTransactions> {
    const scope = salesScopeSql(context.scope);
    const countRows = await db.$queryRaw<Array<{ total: unknown }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM \`Sale\` s
        LEFT JOIN \`Shift\` sh
            ON sh.\`id\` = s.\`shiftId\`
            AND sh.\`tenantId\` = s.\`tenantId\`
        WHERE s.\`tenantId\` = ${context.tenantId}
            AND s.\`createdAt\` >= ${range.start}
            AND s.\`createdAt\` < ${range.endExclusive}
            AND s.\`status\` <> 'VOIDED'
            ${scope}
    `);
    const total = dbCount(countRows[0]?.total ?? 0);
    const offset = (page - 1) * pageSize;
    if (offset >= total && total > 0) {
        return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items: [] };
    }
    const rows = await db.$queryRaw<TransactionDbRow[]>(Prisma.sql`
        SELECT
            s.\`id\` AS id,
            s.\`invoiceNumber\` AS invoiceNumber,
            s.\`invoiceSeries\` AS invoiceSeries,
            s.\`createdAt\` AS createdAt,
            s.\`customerId\` AS customerId,
            COALESCE(NULLIF(TRIM(s.\`customerName\`), ''), c.\`name\`, 'Consumidor Final') AS customerName,
            s.\`soldById\` AS sellerId,
            COALESCE(u.\`name\`, 'Sin vendedor') AS sellerName,
            s.\`employeeId\` AS employeeId,
            e.\`firstName\` AS cashierFirstName,
            e.\`lastName\` AS cashierLastName,
            s.\`paymentMethod\` AS paymentMethod,
            s.\`total\` AS total,
            s.\`exemptTotal\` AS exemptTotal,
            s.\`fiscalRegimeAtSale\` AS fiscalRegimeAtSale,
            s.\`vatAmountAtSale\` AS vatAmountAtSale,
            s.\`status\` AS status
        FROM \`Sale\` s
        LEFT JOIN \`Shift\` sh
            ON sh.\`id\` = s.\`shiftId\`
            AND sh.\`tenantId\` = s.\`tenantId\`
        LEFT JOIN \`Customer\` c
            ON c.\`id\` = s.\`customerId\`
            AND c.\`tenantId\` = s.\`tenantId\`
        LEFT JOIN \`User\` u
            ON u.\`id\` = s.\`soldById\`
            AND u.\`tenantId\` = s.\`tenantId\`
        LEFT JOIN \`Employee\` e
            ON e.\`id\` = s.\`employeeId\`
            AND e.\`tenantId\` = s.\`tenantId\`
        WHERE s.\`tenantId\` = ${context.tenantId}
            AND s.\`createdAt\` >= ${range.start}
            AND s.\`createdAt\` < ${range.endExclusive}
            AND s.\`status\` <> 'VOIDED'
            ${scope}
        ORDER BY s.\`createdAt\` DESC, s.\`id\` DESC
        LIMIT ${pageSize} OFFSET ${offset}
    `);
    if (rows.length === 0) {
        return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items: [] };
    }
    const saleIds = rows.map((row) => dbText(row.id, ''));
    const [itemRows, returnRows] = await Promise.all([
        db.$queryRaw<TransactionItemDbRow[]>(Prisma.sql`
            SELECT
                si.\`saleId\` AS saleId,
                COUNT(*) AS lineCount,
                COALESCE(SUM(CAST(si.\`quantity\` AS DECIMAL(30, 4))), 0) AS baseQuantity
            FROM \`SaleItem\` si
            INNER JOIN \`Sale\` s ON s.\`id\` = si.\`saleId\`
            WHERE s.\`tenantId\` = ${context.tenantId}
                AND si.\`saleId\` IN (${Prisma.join(saleIds)})
            GROUP BY si.\`saleId\`
        `),
        db.$queryRaw<TransactionReturnDbRow[]>(Prisma.sql`
            SELECT pr.\`saleId\` AS saleId, COALESCE(SUM(pr.\`total\`), 0) AS returnedTotal
            FROM \`ProductReturn\` pr
            WHERE pr.\`tenantId\` = ${context.tenantId}
                AND pr.\`saleId\` IN (${Prisma.join(saleIds)})
                AND pr.\`createdAt\` >= ${range.start}
                AND pr.\`createdAt\` < ${range.endExclusive}
            GROUP BY pr.\`saleId\`
        `),
    ]);
    const itemBySale = new Map(itemRows.map((row) => [dbText(row.saleId, ''), row]));
    const returnBySale = new Map(returnRows.map((row) => [dbText(row.saleId, ''), dbText(row.returnedTotal)]));
    const items = rows.map((row): SalesTransactionRow => {
        const id = dbText(row.id, '');
        const totalValue = new Decimal(dbText(row.total));
        const returnedTotal = new Decimal(returnBySale.get(id) ?? 0);
        const invoiceNumber = row.invoiceNumber == null ? null : dbCount(row.invoiceNumber);
        const invoiceSeries = dbText(row.invoiceSeries, 'A');
        const employeeName = [dbText(row.cashierFirstName, ''), dbText(row.cashierLastName, '')]
            .filter(Boolean)
            .join(' ')
            || 'Sin cajero';
        const item = itemBySale.get(id);
        const createdAt = dbDate(row.createdAt);
        return {
            id,
            invoice: invoiceNumber == null
                ? 'CF'
                : `${invoiceSeries}-${String(invoiceNumber).padStart(6, '0')}`,
            createdAt: createdAt.toISOString(),
            businessDate: businessDate(createdAt),
            customer: {
                id: row.customerId == null ? null : dbText(row.customerId, ''),
                name: dbText(row.customerName, 'Consumidor Final'),
            },
            seller: {
                id: row.sellerId == null ? null : dbText(row.sellerId, ''),
                name: dbText(row.sellerName, 'Sin vendedor'),
            },
            cashier: {
                id: row.employeeId == null ? null : dbText(row.employeeId, ''),
                name: employeeName,
            },
            paymentMethod: dbText(row.paymentMethod, 'UNKNOWN'),
            total: totalValue.toDecimalPlaces(2).toFixed(2),
            vatCollected: saleVatFromSnapshot({
                total: totalValue,
                exemptTotal: row.exemptTotal == null ? null : dbText(row.exemptTotal),
                fiscalRegimeAtSale: row.fiscalRegimeAtSale,
                vatAmountAtSale: row.vatAmountAtSale == null ? null : dbText(row.vatAmountAtSale),
            }).toDecimalPlaces(2).toFixed(2),
            returnedTotal: returnedTotal.toDecimalPlaces(2).toFixed(2),
            netTotal: totalValue.minus(returnedTotal).toDecimalPlaces(2).toFixed(2),
            status: dbText(row.status, 'UNKNOWN'),
            items: {
                lineCount: item ? dbCount(item.lineCount) : 0,
                baseQuantity: item ? new Decimal(dbText(item.baseQuantity)).toDecimalPlaces(4).toString() : '0',
            },
        };
    });
    return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items };
}

interface ShiftSnapshotDbRow {
    id: unknown;
    shiftId: unknown;
    folio: unknown;
    businessDate: unknown;
    version: unknown;
    report: unknown;
    contentHash: unknown;
    createdAt: unknown;
}

export function createSalesReportService(db: ReportDb = prisma): SalesReportService {
    return {
        getReport: (context, range) => buildReport(db, context, range),

        async getTransactions(context, range, page, pageSize) {
            if (!Number.isInteger(page) || page < 1) {
                throw new SalesReportError('REPORT_PAGE_INVALID', 400, 'page debe ser un entero mayor o igual a 1.');
            }
            if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
                throw new SalesReportError('REPORT_PAGE_SIZE_INVALID', 400, 'pageSize debe estar entre 1 y 100.');
            }
            return fetchTransactions(db, context, range, page, pageSize);
        },

        async getDocumentData(context, range) {
            const first = await fetchTransactions(
                db,
                context,
                range,
                1,
                SALES_DOCUMENT_MAX_TRANSACTIONS + 1,
            );
            if (first.total > SALES_DOCUMENT_MAX_TRANSACTIONS) {
                throw new SalesReportError(
                    'REPORT_DOCUMENT_LIMIT_EXCEEDED',
                    422,
                    `El documento admite hasta ${SALES_DOCUMENT_MAX_TRANSACTIONS} ventas. Reducí el rango.`,
                );
            }
            const report = await buildReport(db, context, range);
            return { report, transactions: first.items };
        },

        async getExportData(context, range) {
            const first = await fetchTransactions(
                db,
                context,
                range,
                1,
                SALES_EXPORT_MAX_TRANSACTIONS + 1,
            );
            if (first.total > SALES_EXPORT_MAX_TRANSACTIONS) {
                throw new SalesReportError(
                    'REPORT_EXPORT_LIMIT_EXCEEDED',
                    422,
                    `La exportación admite hasta ${SALES_EXPORT_MAX_TRANSACTIONS} ventas. Reducí el rango.`,
                );
            }
            const report = await buildReport(db, context, range);
            if (report.returns.length > SALES_EXPORT_MAX_RETURNS) {
                throw new SalesReportError(
                    'REPORT_EXPORT_LIMIT_EXCEEDED',
                    422,
                    `La exportación admite hasta ${SALES_EXPORT_MAX_RETURNS} devoluciones. Reducí el rango.`,
                );
            }
            return { report, transactions: first.items, returns: report.returns };
        },

        async getShiftSnapshot(principal, shiftId) {
            if (!canReadShiftReport(principal.role)) {
                throw new SalesReportError('REPORT_ROLE_FORBIDDEN', 403, 'Tu rol no tiene acceso al reporte de caja.');
            }
            if (!shiftId || shiftId.length > 191) {
                throw new SalesReportError('SHIFT_ID_INVALID', 400, 'El identificador de caja es inválido.');
            }
            const management = new Set([
                'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER',
            ]).has(principal.role);
            const ownership = management
                ? Prisma.sql``
                : Prisma.sql`AND sh.\`userId\` = ${principal.userId}`;
            const rows = await db.$queryRaw<ShiftSnapshotDbRow[]>(Prisma.sql`
                SELECT
                    scr.\`id\` AS id,
                    scr.\`shiftId\` AS shiftId,
                    scr.\`folio\` AS folio,
                    scr.\`businessDate\` AS businessDate,
                    scr.\`version\` AS version,
                    scr.\`report\` AS report,
                    scr.\`contentHash\` AS contentHash,
                    scr.\`createdAt\` AS createdAt
                FROM \`ShiftCloseReport\` scr
                INNER JOIN \`Shift\` sh
                    ON sh.\`id\` = scr.\`shiftId\`
                    AND sh.\`tenantId\` = scr.\`tenantId\`
                WHERE scr.\`tenantId\` = ${principal.tenantId}
                    AND scr.\`shiftId\` = ${shiftId}
                    ${ownership}
                LIMIT 1
            `);
            const row = rows[0];
            if (!row) {
                throw new SalesReportError('SHIFT_REPORT_NOT_FOUND', 404, 'El reporte de cierre no existe.');
            }
            let rawReport = row.report;
            if (typeof rawReport === 'string') {
                try {
                    rawReport = JSON.parse(rawReport);
                } catch {
                    rawReport = null;
                }
            }
            const report = parseShiftCloseReportPayload(rawReport);
            const folio = dbText(row.folio, '');
            const date = dbText(row.businessDate, '');
            const version = dbCount(row.version);
            const contentHash = dbText(row.contentHash, '');
            if (
                !report
                || report.shift.id !== shiftId
                || report.folio !== folio
                || report.businessDate !== date
                || report.version !== version
                || !/^[a-f0-9]{64}$/i.test(contentHash)
                || hashShiftCloseReport(report) !== contentHash
            ) {
                throw new SalesReportError(
                    'SHIFT_REPORT_INTEGRITY_FAILED',
                    409,
                    'El reporte de cierre no superó la verificación de integridad.',
                );
            }
            return {
                id: dbText(row.id, ''),
                shiftId,
                folio,
                businessDate: date,
                version,
                contentHash,
                createdAt: dbDate(row.createdAt).toISOString(),
                documentUrl: `/api/reports/shifts/${encodeURIComponent(shiftId)}/document`,
                report,
            };
        },
    };
}

export const salesReportService = createSalesReportService();
export default salesReportService;
