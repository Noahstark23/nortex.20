import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';
import { claveDelDiaManagua } from './pulsoPos';
import { CATEGORIA_AGENTE, calcularEfectivoTurno } from '../../utils/margen';
import {
    buildShiftCloseReport,
    hashShiftCloseReport,
    type ShiftCloseMovementInput,
    type ShiftCloseProductInput,
    type ShiftCloseReportPayload,
} from '../lib/shiftCloseReport';
import {
    SALES_REPORT_MAX_RETURN_LINES_TOTAL,
    SALES_REPORT_MAX_RETURN_RECORDS,
    SalesReportError,
    foldReturnRecords,
    parseReturnedItems,
    parseShiftCloseReportPayload,
    type ReturnRecordInput,
    type ReturnedItemAuthority,
} from '../lib/salesReport';

const ESTADO_ANULADA = 'VOIDED';
const CLOSE_ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER']);

type CloseClient = Pick<PrismaClient, '$transaction'>;

type LockedShiftRow = {
    id: string;
    tenantId: string;
    userId: string;
    employeeId: string | null;
    initialCash: Prisma.Decimal;
    initialCashUsd: Prisma.Decimal;
    status: string;
    startTime: Date;
    endTime: Date | null;
    finalCashDeclared: Prisma.Decimal | null;
    systemExpectedCash: Prisma.Decimal | null;
    difference: Prisma.Decimal | null;
    finalCashDeclaredUsd: Prisma.Decimal | null;
    systemExpectedUsd: Prisma.Decimal | null;
    differenceUsd: Prisma.Decimal | null;
};

type SoldProductRow = {
    productId: string;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    displayUnit: string;
    quantity: Prisma.Decimal;
    amount: Prisma.Decimal;
    cogs: Prisma.Decimal;
    vat: Prisma.Decimal;
    listGross: Prisma.Decimal;
};

type ReturnedProductRow = {
    productId: string;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    displayUnit: string;
    quantity: Decimal;
    amount: Decimal;
    cogs: Decimal;
    vat: Decimal;
};

type VatRow = { vatCollected: Prisma.Decimal };
type ReturnRecordRow = {
    id: string;
    saleId: string;
    createdAt: Date;
    total: Prisma.Decimal;
    items: unknown;
    reason: string | null;
    paymentMethod: string;
    fiscalRegimeAtSale: string | null;
    saleTotal: Prisma.Decimal;
    saleExemptTotal: Prisma.Decimal | null;
    saleVatAmountAtSale: Prisma.Decimal | null;
};
type ReturnAuthorityRow = {
    saleItemId: string;
    productId: string;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    presentationQuantityAtSale: Prisma.Decimal | null;
    soldQuantityAtSale: Prisma.Decimal;
    costAtSale: Prisma.Decimal;
    ivaExento: boolean | number | bigint | null;
};
type ReturnSummary = {
    count: number;
    total: Decimal;
    vat: Decimal;
    cogs: Decimal;
};
type ReturnBudgetRow = {
    returnCount: unknown;
    returnLineCount: unknown;
};
type CloseReportRuntimeMeta = {
    manualINs: number;
    manualOUTs: number;
    agentINs: number;
    agentOUTs: number;
    theftAlert: boolean;
};
type StoredShiftCloseReportPayload = ShiftCloseReportPayload & {
    closeMeta?: CloseReportRuntimeMeta;
};

export type CloseShiftCommand = {
    tenantId: string;
    userId: string;
    role: string | undefined;
    shiftId: string;
    declaredCash: Decimal.Value;
    declaredCashUsd?: Decimal.Value;
    auditNotes?: string | null;
};

export class ShiftCloseError extends Error {
    constructor(
        public readonly code: string,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'ShiftCloseError';
    }
}

function decimal(value: Decimal.Value, field: string): Decimal {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative()) {
        throw new ShiftCloseError('INVALID_CASH_COUNT', 400, `${field} debe ser un monto válido y no negativo`);
    }
    return parsed.toDecimalPlaces(2);
}

function toProductInput(row: SoldProductRow | ReturnedProductRow): ShiftCloseProductInput {
    return {
        productId: String(row.productId || 'legacy-product'),
        productName: String(row.productName || 'Producto legado'),
        unit: String(row.unit || 'unidad'),
        saleMode: row.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
        presentation: row.presentation === 'PACK' ? 'PACK' : 'BASE',
        displayUnit: String(row.displayUnit || row.unit || 'unidad'),
        quantity: row.quantity?.toString() ?? '0',
        amount: row.amount?.toString() ?? '0',
        cogs: row.cogs?.toString() ?? '0',
        vat: row.vat?.toString() ?? '0',
    };
}

function publicCloseReport(row: {
    id: string;
    folio: string;
    businessDate: string;
    contentHash: string;
    report: unknown;
}) {
    const payload = row.report as StoredShiftCloseReportPayload;
    return {
        id: row.id,
        shiftId: payload.shift.id,
        folio: row.folio,
        businessDate: row.businessDate,
        version: payload.version,
        contentHash: row.contentHash,
        createdAt: payload.generatedAt,
        documentUrl: `/api/reports/shifts/${encodeURIComponent(payload.shift.id)}/document`,
        report: payload,
    };
}

function verifiedReplayReport(row: {
    id: string;
    shiftId: string;
    folio: string;
    businessDate: string;
    version: number;
    contentHash: string;
    report: unknown;
}) {
    let rawReport = row.report;
    if (typeof rawReport === 'string') {
        try {
            rawReport = JSON.parse(rawReport);
        } catch {
            rawReport = null;
        }
    }
    const payload = parseShiftCloseReportPayload(rawReport);
    if (
        !payload
        || payload.shift.id !== row.shiftId
        || payload.folio !== row.folio
        || payload.businessDate !== row.businessDate
        || payload.version !== row.version
        || !/^[a-f0-9]{64}$/i.test(row.contentHash)
        || hashShiftCloseReport(payload) !== row.contentHash
    ) {
        throw new ShiftCloseError(
            'SHIFT_REPORT_INTEGRITY_FAILED',
            409,
            'El reporte de cierre no superó la verificación de integridad.',
        );
    }
    return { ...row, report: payload };
}

function safeDecimal(value: unknown, fallback = '0'): Decimal {
    try {
        return new Decimal(value == null ? fallback : String(value));
    } catch {
        return new Decimal(fallback);
    }
}

function readStoredCloseMeta(value: unknown): CloseReportRuntimeMeta | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const manualINs = safeDecimal(record.manualINs, 'NaN');
    const manualOUTs = safeDecimal(record.manualOUTs, 'NaN');
    const agentINs = safeDecimal(record.agentINs, 'NaN');
    const agentOUTs = safeDecimal(record.agentOUTs, 'NaN');
    if (!manualINs.isFinite() || !manualOUTs.isFinite() || !agentINs.isFinite() || !agentOUTs.isFinite()) {
        return null;
    }
    return {
        manualINs: manualINs.toNumber(),
        manualOUTs: manualOUTs.toNumber(),
        agentINs: agentINs.toNumber(),
        agentOUTs: agentOUTs.toNumber(),
        theftAlert: record.theftAlert === true,
    };
}

function closeMetaFromStoredReport(
    report: unknown,
    theftThreshold: Decimal,
): CloseReportRuntimeMeta {
    const payload = report as StoredShiftCloseReportPayload | null;
    const fromSnapshot = readStoredCloseMeta(payload?.closeMeta);
    if (fromSnapshot) return fromSnapshot;

    let manualINs = new Decimal(0);
    let manualOUTs = new Decimal(0);
    let agentINs = new Decimal(0);
    let agentOUTs = new Decimal(0);
    const movementBreakdown = Array.isArray((payload as { movementBreakdown?: unknown[] } | null)?.movementBreakdown)
        ? (payload as { movementBreakdown: unknown[] }).movementBreakdown
        : [];

    for (const rawMovement of movementBreakdown) {
        if (!rawMovement || typeof rawMovement !== 'object') continue;
        const movement = rawMovement as Record<string, unknown>;
        if ((typeof movement.currency === 'string' ? movement.currency : 'NIO') !== 'NIO') continue;
        const amount = safeDecimal(movement.amount, 'NaN');
        if (!amount.isFinite()) continue;
        const isAgent = movement.category === CATEGORIA_AGENTE;
        if (movement.type === 'IN') {
            if (isAgent) agentINs = agentINs.plus(amount);
            else manualINs = manualINs.plus(amount);
        } else if (movement.type === 'OUT') {
            if (isAgent) agentOUTs = agentOUTs.plus(amount);
            else manualOUTs = manualOUTs.plus(amount);
        }
    }

    return {
        manualINs: manualINs.toNumber(),
        manualOUTs: manualOUTs.toNumber(),
        agentINs: agentINs.toNumber(),
        agentOUTs: agentOUTs.toNumber(),
        theftAlert: safeDecimal((payload as { cash?: { differenceNio?: unknown } } | null)?.cash?.differenceNio)
            .abs()
            .greaterThan(theftThreshold),
    };
}

function displayUnitForReturnProduct(unit: string, presentation: string): string {
    return presentation === 'PACK' ? `empaque(s) · base ${unit}` : unit;
}

function returnProductKey(row: {
    productId: string;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    displayUnit: string;
}): string {
    return [
        row.productId,
        row.productName,
        row.unit,
        row.saleMode,
        row.presentation,
        row.displayUnit,
    ].join('\u001f');
}

function asReturnRecords(rows: readonly ReturnRecordRow[]): ReturnRecordInput[] {
    return rows.map((row) => ({
        id: row.id,
        saleId: row.saleId,
        createdAt: row.createdAt,
        total: row.total.toString(),
        items: row.items,
        reason: row.reason,
        paymentMethod: row.paymentMethod,
        fiscalRegimeAtSale: row.fiscalRegimeAtSale,
        saleTotal: row.saleTotal.toString(),
        saleExemptTotal: row.saleExemptTotal?.toString() ?? null,
        saleVatAmountAtSale: row.saleVatAmountAtSale?.toString() ?? null,
    }));
}

function saleItemIdsFromReturnRecords(records: readonly ReturnRecordInput[]): string[] {
    const ids = new Set<string>();
    for (const record of records) {
        for (const item of parseReturnedItems(record.items).items) {
            if (item.saleItemId) ids.add(item.saleItemId);
        }
    }
    return [...ids];
}

async function returnAuthoritiesForRecords(
    tx: Prisma.TransactionClient,
    tenantId: string,
    records: readonly ReturnRecordInput[],
): Promise<Map<string, ReturnedItemAuthority>> {
    const saleItemIds = saleItemIdsFromReturnRecords(records);
    if (saleItemIds.length === 0) return new Map();

    const rows = await tx.$queryRaw<ReturnAuthorityRow[]>(Prisma.sql`
        SELECT
            si.\`id\` AS saleItemId,
            si.\`productId\` AS productId,
            COALESCE(NULLIF(TRIM(si.\`productNameAtSale\`), ''), si.\`productId\`) AS productName,
            COALESCE(NULLIF(TRIM(si.\`unitAtSale\`), ''), 'unidad') AS unit,
            CASE WHEN si.\`saleModeAtSale\` = 'COUNTED' THEN 'COUNTED' ELSE 'MEASURED' END AS saleMode,
            CASE WHEN si.\`presentationAtSale\` = 'PACK' THEN 'PACK' ELSE 'BASE' END AS presentation,
            si.\`presentationQuantityAtSale\` AS presentationQuantityAtSale,
            CAST(si.\`quantity\` AS DECIMAL(30, 4)) AS soldQuantityAtSale,
            si.\`costAtSale\` AS costAtSale,
            si.\`ivaExento\` AS ivaExento
        FROM \`SaleItem\` si
        INNER JOIN \`Sale\` s
            ON s.\`id\` = si.\`saleId\`
            AND s.\`tenantId\` = ${tenantId}
        WHERE si.\`id\` IN (${Prisma.join(saleItemIds)})
    `);

    return new Map(rows.map((row) => [row.saleItemId, {
        saleItemId: row.saleItemId,
        productId: row.productId || 'legacy-product',
        productName: row.productName || 'Producto legado',
        unit: row.unit || 'unidad',
        saleMode: row.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
        presentation: row.presentation === 'PACK' ? 'PACK' : 'BASE',
        presentationQuantityAtSale: row.presentationQuantityAtSale?.toString() ?? null,
        soldQuantityAtSale: row.soldQuantityAtSale?.toString() ?? '0',
        costAtSale: row.costAtSale?.toString() ?? '0',
        ivaExento: row.ivaExento === true || row.ivaExento === 1 || row.ivaExento === BigInt(1),
    } satisfies ReturnedItemAuthority]));
}

async function lockShift(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shiftId: string,
): Promise<LockedShiftRow> {
    const rows = await tx.$queryRaw<LockedShiftRow[]>(Prisma.sql`
        SELECT
            id, tenantId, userId, employeeId, initialCash, initialCashUsd,
            status, startTime, endTime, finalCashDeclared, systemExpectedCash,
            difference, finalCashDeclaredUsd, systemExpectedUsd, differenceUsd
        FROM \`Shift\`
        WHERE id = ${shiftId} AND tenantId = ${tenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new ShiftCloseError('SHIFT_NOT_FOUND', 404, 'Turno no encontrado o no pertenece a tu empresa');
    }
    return rows[0];
}

async function soldProductsForShift(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shiftId: string,
): Promise<SoldProductRow[]> {
    return tx.$queryRaw<SoldProductRow[]>(Prisma.sql`
        SELECT
            si.productId AS productId,
            COALESCE(NULLIF(si.productNameAtSale, ''), NULLIF(p.name, ''), si.productId) AS productName,
            COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad') AS unit,
            CASE WHEN si.saleModeAtSale = 'COUNTED' THEN 'COUNTED' ELSE 'MEASURED' END AS saleMode,
            CASE WHEN si.presentationAtSale = 'PACK' THEN 'PACK' ELSE 'BASE' END AS presentation,
            CASE
                WHEN si.presentationAtSale = 'PACK'
                    THEN CONCAT('empaque(s) · base ', COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad'))
                ELSE COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad')
            END AS displayUnit,
            COALESCE(SUM(
                CASE
                    WHEN si.presentationAtSale = 'PACK' AND si.presentationQuantityAtSale IS NOT NULL
                        THEN si.presentationQuantityAtSale
                    ELSE si.quantity
                END
            ), 0) AS quantity,
            COALESCE(SUM(
                COALESCE(si.unitPriceExactAtSale, si.priceAtSale)
                * si.quantity
                * (1 - COALESCE(si.discount, 0) / 100)
                * (1 - COALESCE(s.globalDiscount, 0) / 100)
            ), 0) AS amount,
            COALESCE(SUM(si.costAtSale * si.quantity), 0) AS cogs,
            COALESCE(SUM(
                CASE
                    WHEN s.fiscalRegimeAtSale = 'CUOTA_FIJA' OR si.ivaExento = 1 THEN 0
                    ELSE (
                        COALESCE(si.unitPriceExactAtSale, si.priceAtSale)
                        * si.quantity
                        * (1 - COALESCE(si.discount, 0) / 100)
                        * (1 - COALESCE(s.globalDiscount, 0) / 100)
                    ) - (
                        COALESCE(si.unitPriceExactAtSale, si.priceAtSale)
                        * si.quantity
                        * (1 - COALESCE(si.discount, 0) / 100)
                        * (1 - COALESCE(s.globalDiscount, 0) / 100)
                    ) / 1.15
                END
            ), 0) AS vat,
            COALESCE(SUM(COALESCE(si.unitPriceExactAtSale, si.priceAtSale) * si.quantity), 0) AS listGross
        FROM \`SaleItem\` si
        INNER JOIN \`Sale\` s ON s.id = si.saleId
        LEFT JOIN \`Product\` p ON p.id = si.productId AND p.tenantId = s.tenantId
        WHERE s.tenantId = ${tenantId}
          AND s.shiftId = ${shiftId}
          AND s.status <> ${ESTADO_ANULADA}
        GROUP BY
            si.productId,
            COALESCE(NULLIF(si.productNameAtSale, ''), NULLIF(p.name, ''), si.productId),
            COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad'),
            CASE WHEN si.saleModeAtSale = 'COUNTED' THEN 'COUNTED' ELSE 'MEASURED' END,
            CASE WHEN si.presentationAtSale = 'PACK' THEN 'PACK' ELSE 'BASE' END,
            CASE
                WHEN si.presentationAtSale = 'PACK'
                    THEN CONCAT('empaque(s) · base ', COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad'))
                ELSE COALESCE(NULLIF(si.unitAtSale, ''), NULLIF(p.unit, ''), 'unidad')
            END
        ORDER BY productName ASC, displayUnit ASC
    `);
}

async function returnedProductsDuringShift(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shiftId: string,
    startTime: Date,
    closedAt: Date,
): Promise<{ products: ReturnedProductRow[]; summary: ReturnSummary }> {
    const budgetRows = await tx.$queryRaw<ReturnBudgetRow[]>(Prisma.sql`
        SELECT
            COUNT(*) AS returnCount,
            COALESCE(SUM(
                CASE
                    WHEN JSON_TYPE(pr.\`items\`) = 'ARRAY' THEN JSON_LENGTH(pr.\`items\`)
                    ELSE 1
                END
            ), 0) AS returnLineCount
        FROM \`ProductReturn\` pr
        WHERE pr.\`tenantId\` = ${tenantId}
          AND pr.\`processedShiftId\` = ${shiftId}
          AND pr.\`createdAt\` >= ${startTime}
          AND pr.\`createdAt\` <= ${closedAt}
    `);
    const returnCount = Number(budgetRows[0]?.returnCount ?? 0);
    const returnLineCount = Number(budgetRows[0]?.returnLineCount ?? 0);
    if (!Number.isSafeInteger(returnCount) || returnCount < 0
        || !Number.isSafeInteger(returnLineCount) || returnLineCount < 0) {
        throw new ShiftCloseError('SHIFT_REPORT_DATA_INVALID', 409, 'El cierre contiene conteos inválidos');
    }
    if (returnCount > SALES_REPORT_MAX_RETURN_RECORDS
        || returnLineCount > SALES_REPORT_MAX_RETURN_LINES_TOTAL) {
        throw new ShiftCloseError(
            'SHIFT_REPORT_DETAIL_LIMIT_EXCEEDED',
            422,
            'El turno contiene demasiadas líneas devueltas para generar un cierre seguro.',
        );
    }
    const rows = await tx.$queryRaw<ReturnRecordRow[]>(Prisma.sql`
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
        WHERE pr.\`tenantId\` = ${tenantId}
          AND pr.\`processedShiftId\` = ${shiftId}
          AND pr.\`createdAt\` >= ${startTime}
          AND pr.\`createdAt\` <= ${closedAt}
        ORDER BY pr.\`createdAt\` ASC, pr.\`id\` ASC
    `);
    const records = asReturnRecords(rows);
    const authorities = await returnAuthoritiesForRecords(tx, tenantId, records);
    let foldedReturns;
    try {
        foldedReturns = foldReturnRecords(records, authorities);
    } catch (error) {
        if (error instanceof SalesReportError) {
            throw new ShiftCloseError('SHIFT_REPORT_DETAIL_LIMIT_EXCEEDED', error.httpStatus, error.message);
        }
        throw error;
    }
    const groups = new Map<string, ReturnedProductRow>();
    let total = new Decimal(0);
    let vat = new Decimal(0);
    let cogs = new Decimal(0);

    const appendRow = (row: ReturnedProductRow) => {
        const key = returnProductKey(row);
        const existing = groups.get(key);
        if (existing) {
            existing.quantity = existing.quantity.plus(row.quantity);
            existing.amount = existing.amount.plus(row.amount);
            existing.cogs = existing.cogs.plus(row.cogs);
            existing.vat = existing.vat.plus(row.vat);
            return;
        }
        groups.set(key, row);
    };

    for (const record of foldedReturns) {
        const recordTotal = safeDecimal(record.total);
        const recordVat = safeDecimal(record.vat);
        const recordCogs = safeDecimal(record.cogs);
        total = total.plus(recordTotal);
        vat = vat.plus(recordVat);
        cogs = cogs.plus(recordCogs);

        let allocatedVat = new Decimal(0);
        let allocatedCogs = new Decimal(0);
        for (const line of record.lines) {
            const unit = line.unit || 'unidad';
            const presentation = line.presentation === 'PACK' ? 'PACK' : 'BASE';
            appendRow({
                productId: line.productId || 'legacy-product',
                productName: line.productName || 'Producto legado',
                unit,
                saleMode: line.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
                presentation,
                displayUnit: displayUnitForReturnProduct(unit, presentation),
                quantity: safeDecimal(line.displayQuantity),
                amount: safeDecimal(line.allocatedTotal),
                cogs: safeDecimal(line.returnedCogs),
                vat: safeDecimal(line.returnedVat),
            });
            allocatedVat = allocatedVat.plus(line.returnedVat);
            allocatedCogs = allocatedCogs.plus(line.returnedCogs);
        }

        const unallocatedTotal = safeDecimal(record.unallocatedTotal);
        const unallocatedVat = Decimal.max(recordVat.minus(allocatedVat), 0);
        const unallocatedCogs = Decimal.max(recordCogs.minus(allocatedCogs), 0);
        if (unallocatedTotal.greaterThan(0) || unallocatedVat.greaterThan(0) || unallocatedCogs.greaterThan(0)) {
            appendRow({
                productId: 'return-unallocated',
                productName: 'Devolucion no asignable',
                unit: 'unidad',
                saleMode: 'COUNTED',
                presentation: 'BASE',
                displayUnit: 'sin linea exacta',
                quantity: new Decimal(0),
                amount: unallocatedTotal,
                cogs: unallocatedCogs,
                vat: unallocatedVat,
            });
        }
    }

    return {
        products: [...groups.values()].sort((left, right) => left.productName.localeCompare(right.productName, 'es')
            || left.displayUnit.localeCompare(right.displayUnit, 'es')),
        summary: {
            count: foldedReturns.length,
            total,
            vat,
            cogs,
        },
    };
}

async function vatForShift(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shiftId: string,
): Promise<Decimal> {
    const rows = await tx.$queryRaw<VatRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(
            CASE
                WHEN fiscalRegimeAtSale = 'CUOTA_FIJA' THEN 0
                WHEN vatAmountAtSale IS NOT NULL THEN vatAmountAtSale
                ELSE
                    GREATEST(total - LEAST(GREATEST(COALESCE(exemptTotal, 0), 0), total), 0)
                    - GREATEST(total - LEAST(GREATEST(COALESCE(exemptTotal, 0), 0), total), 0) / 1.15
            END
        ), 0) AS vatCollected
        FROM \`Sale\`
        WHERE tenantId = ${tenantId}
          AND shiftId = ${shiftId}
          AND status <> ${ESTADO_ANULADA}
    `);
    return new Decimal(rows[0]?.vatCollected?.toString() ?? '0');
}

async function readShiftForResponse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shiftId: string,
) {
    return tx.shift.findFirst({
        where: { id: shiftId, tenantId },
        include: {
            employee: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
    });
}

export async function closeShiftWithReport(
    command: CloseShiftCommand,
    client: CloseClient = prisma,
    now: () => Date = () => new Date(),
) {
    if (!command.tenantId || !command.userId || !command.shiftId) {
        throw new ShiftCloseError('SHIFT_IDENTITY_REQUIRED', 401, 'Identidad de cierre incompleta');
    }
    const declaredNio = decimal(command.declaredCash, 'El efectivo declarado');
    const declaredUsd = command.declaredCashUsd == null
        ? new Decimal(0)
        : decimal(command.declaredCashUsd, 'El efectivo USD declarado');

    return client.$transaction(async (tx) => {
        const locked = await lockShift(tx, command.tenantId, command.shiftId);
        if (locked.userId !== command.userId && !CLOSE_ADMIN_ROLES.has(command.role || '')) {
            throw new ShiftCloseError('SHIFT_CLOSE_FORBIDDEN', 403, 'No autorizado a cerrar este turno.');
        }

        if (locked.status !== 'OPEN') {
            const existing = await tx.shiftCloseReport.findUnique({
                where: { shiftId: locked.id },
                select: {
                    id: true,
                    shiftId: true,
                    folio: true,
                    businessDate: true,
                    version: true,
                    contentHash: true,
                    report: true,
                },
            });
            const sameCount = locked.finalCashDeclared != null
                && new Decimal(locked.finalCashDeclared.toString()).equals(declaredNio)
                && new Decimal(locked.finalCashDeclaredUsd?.toString() ?? '0').equals(declaredUsd);
            if (existing && sameCount) {
                const verifiedExisting = verifiedReplayReport(existing);
                const tenant = await tx.tenant.findUnique({
                    where: { id: command.tenantId },
                    select: { theftAlertThreshold: true },
                });
                const replayShift = await readShiftForResponse(tx, command.tenantId, locked.id);
                if (!replayShift) {
                    throw new ShiftCloseError('SHIFT_NOT_FOUND', 404, 'No se pudo leer el turno cerrado');
                }
                const closeMeta = closeMetaFromStoredReport(
                    verifiedExisting.report,
                    new Decimal(tenant?.theftAlertThreshold?.toString() ?? '500'),
                );
                return {
                    shift: replayShift,
                    closeReport: publicCloseReport(verifiedExisting),
                    manualINs: closeMeta.manualINs,
                    manualOUTs: closeMeta.manualOUTs,
                    agentINs: closeMeta.agentINs,
                    agentOUTs: closeMeta.agentOUTs,
                    theftAlert: closeMeta.theftAlert,
                    idempotentReplay: true,
                };
            }
            throw new ShiftCloseError('SHIFT_ALREADY_CLOSED', 409, 'El turno ya está cerrado');
        }

        const closedAt = now();
        const meta = await tx.shift.findFirst({
            where: { id: locked.id, tenantId: command.tenantId },
            select: {
                user: { select: { name: true, email: true } },
                employee: { select: { firstName: true, lastName: true } },
                tenant: {
                    select: {
                        businessName: true,
                        taxId: true,
                        address: true,
                        phone: true,
                        theftAlertThreshold: true,
                    },
                },
            },
        });
        if (!meta) {
            throw new ShiftCloseError('SHIFT_NOT_FOUND', 404, 'Turno no encontrado o no pertenece a tu empresa');
        }
        const closedBy = await tx.user.findFirst({
            where: { id: command.userId, tenantId: command.tenantId },
            select: { name: true, email: true },
        });

        const [payments, movementGroups, soldProducts, shiftReturns, vatBeforeReturns] = await Promise.all([
            tx.sale.groupBy({
                by: ['paymentMethod'],
                where: { tenantId: command.tenantId, shiftId: locked.id, status: { not: ESTADO_ANULADA } },
                _sum: { total: true },
                _count: { _all: true },
                orderBy: { paymentMethod: 'asc' },
            }),
            tx.cashMovement.groupBy({
                by: ['type', 'currency', 'category'],
                where: { tenantId: command.tenantId, shiftId: locked.id, isVoided: false },
                _sum: { amount: true },
                _count: { _all: true },
                orderBy: [{ currency: 'asc' }, { type: 'asc' }, { category: 'asc' }],
            }),
            soldProductsForShift(tx, command.tenantId, locked.id),
            returnedProductsDuringShift(tx, command.tenantId, locked.id, locked.startTime, closedAt),
            vatForShift(tx, command.tenantId, locked.id),
        ]);
        const returnedProducts = shiftReturns.products;

        const paymentInputs = payments.map((payment) => ({
            method: payment.paymentMethod,
            transactionCount: payment._count._all,
            grossSales: payment._sum.total?.toString() ?? '0',
        }));
        const cashSales = paymentInputs
            .filter((payment) => payment.method === 'CASH')
            .reduce((sum, payment) => sum.plus(payment.grossSales), new Decimal(0));
        const movements: ShiftCloseMovementInput[] = movementGroups.map((movement) => ({
            type: movement.type,
            currency: movement.currency || 'NIO',
            category: movement.category,
            count: movement._count._all,
            amount: movement._sum.amount?.toString() ?? '0',
        }));
        const drawer = calcularEfectivoTurno({
            initialCash: locked.initialCash.toString(),
            initialCashUsd: locked.initialCashUsd.toString(),
            cashSales,
            movimientos: movements.map((movement) => ({
                type: movement.type,
                amount: movement.amount,
                currency: movement.currency,
                category: movement.category,
            })),
        });
        const differenceNio = declaredNio.minus(drawer.efectivoNIO).toDecimalPlaces(2);
        const differenceUsd = declaredUsd.minus(drawer.efectivoUSD).toDecimalPlaces(2);
        const huboUsd = !drawer.efectivoUSD.isZero()
            || !declaredUsd.isZero()
            || !new Decimal(locked.initialCashUsd.toString()).isZero();
        const cashRefunds = movements
            .filter((movement) => movement.currency === 'NIO' && movement.type === 'OUT' && movement.category === 'DEVOLUCION')
            .reduce((sum, movement) => sum.plus(movement.amount), new Decimal(0));
        const returnedVat = shiftReturns.summary.vat;
        const returnedCogs = shiftReturns.summary.cogs;
        const returnCount = shiftReturns.summary.count;
        const returnTotal = shiftReturns.summary.total;
        const grossSales = paymentInputs.reduce((sum, payment) => sum.plus(payment.grossSales), new Decimal(0));
        const listGross = soldProducts.reduce(
            (sum, product) => sum.plus(product.listGross?.toString() ?? '0'),
            new Decimal(0),
        );
        const discountTotal = Decimal.max(listGross.minus(grossSales), 0);
        const businessDate = claveDelDiaManagua(closedAt);
        const folio = `Z-${businessDate.replace(/-/g, '')}-${locked.id}`;
        const cashierName = meta.employee
            ? `${meta.employee.firstName} ${meta.employee.lastName}`.trim()
            : 'Sin asignar';
        const theftThreshold = new Decimal(meta.tenant.theftAlertThreshold.toString());
        const closeMeta: CloseReportRuntimeMeta = {
            manualINs: drawer.desglose.manualINs.toNumber(),
            manualOUTs: drawer.desglose.manualOUTs.toNumber(),
            agentINs: drawer.desglose.agentINs.toNumber(),
            agentOUTs: drawer.desglose.agentOUTs.toNumber(),
            theftAlert: differenceNio.abs().greaterThan(theftThreshold),
        };

        const payload = buildShiftCloseReport({
            folio,
            businessDate,
            generatedAt: closedAt,
            business: {
                name: meta.tenant.businessName,
                taxId: meta.tenant.taxId,
                address: meta.tenant.address,
                phone: meta.tenant.phone,
            },
            shift: {
                id: locked.id,
                openedAt: locked.startTime,
                closedAt,
                openedBy: meta.user.name || meta.user.email || locked.userId,
                cashierName,
                closedBy: closedBy?.name || closedBy?.email || command.userId,
                auditNotes: command.auditNotes ?? null,
            },
            payments: paymentInputs,
            soldProducts: soldProducts.map(toProductInput),
            returnedProducts: returnedProducts.map(toProductInput),
            returns: {
                count: returnCount,
                total: returnTotal,
                vat: returnedVat,
                cogs: returnedCogs,
            },
            fiscal: {
                vatCollectedBeforeReturns: vatBeforeReturns,
                discountTotal,
            },
            cash: {
                openingNio: locked.initialCash.toString(),
                expectedNio: drawer.efectivoNIO,
                countedNio: declaredNio,
                differenceNio,
                openingUsd: locked.initialCashUsd.toString(),
                expectedUsd: drawer.efectivoUSD,
                countedUsd: declaredUsd,
                differenceUsd,
                cashRefundsNio: cashRefunds,
            },
            movements,
        });
        const storedReport: StoredShiftCloseReportPayload = {
            ...payload,
            closeMeta,
        };
        const contentHash = hashShiftCloseReport(storedReport);

        const updatedCount = await tx.shift.updateMany({
            where: { id: locked.id, tenantId: command.tenantId, status: 'OPEN' },
            data: {
                endTime: closedAt,
                status: 'CLOSED',
                finalCashDeclared: declaredNio.toFixed(2),
                systemExpectedCash: drawer.efectivoNIO.toFixed(2),
                difference: differenceNio.toFixed(2),
                ...(huboUsd ? {
                    finalCashDeclaredUsd: declaredUsd.toFixed(2),
                    systemExpectedUsd: drawer.efectivoUSD.toFixed(2),
                    differenceUsd: differenceUsd.toFixed(2),
                } : {}),
            },
        });
        if (updatedCount.count !== 1) {
            throw new ShiftCloseError('SHIFT_ALREADY_CLOSED', 409, 'El turno cambió de estado mientras se cerraba');
        }

        const reportRow = await tx.shiftCloseReport.create({
            data: {
                tenantId: command.tenantId,
                shiftId: locked.id,
                folio,
                businessDate,
                version: payload.version,
                report: storedReport as unknown as Prisma.InputJsonValue,
                contentHash,
                createdBy: command.userId,
                createdAt: closedAt,
            },
            select: {
                id: true,
                folio: true,
                businessDate: true,
                contentHash: true,
                report: true,
            },
        });

        await tx.auditLog.create({
            data: {
                tenantId: command.tenantId,
                userId: command.userId,
                action: 'SHIFT_CLOSED',
                details: JSON.stringify({
                    shiftId: locked.id,
                    reportId: reportRow.id,
                    folio,
                    contentHash,
                    expectedNio: drawer.efectivoNIO.toFixed(2),
                    countedNio: declaredNio.toFixed(2),
                    differenceNio: differenceNio.toFixed(2),
                    expectedUsd: drawer.efectivoUSD.toFixed(2),
                    countedUsd: declaredUsd.toFixed(2),
                    differenceUsd: differenceUsd.toFixed(2),
                    grossSales: payload.summary.grossSales,
                    returnsTotal: payload.summary.returnsTotal,
                    netSales: payload.summary.netSales,
                    transactionCount: payload.summary.transactionCount,
                    returnCount: payload.summary.returnCount,
                    auditNotes: command.auditNotes?.trim() || null,
                }),
            },
        });
        if (closeMeta.theftAlert) {
            await tx.auditLog.create({
                data: {
                    tenantId: command.tenantId,
                    userId: command.userId,
                    action: differenceNio.isNegative() ? 'THEFT_ALERT' : 'SURPLUS_ALERT',
                    details: JSON.stringify({
                        shiftId: locked.id,
                        reportId: reportRow.id,
                        folio,
                        difference: differenceNio.toFixed(2),
                        expected: drawer.efectivoNIO.toFixed(2),
                        declared: declaredNio.toFixed(2),
                        cashier: cashierName,
                        threshold: theftThreshold.toFixed(2),
                        closedAt: closedAt.toISOString(),
                    }),
                },
            });
        }

        const updatedShift = await readShiftForResponse(tx, command.tenantId, locked.id);
        if (!updatedShift) {
            throw new ShiftCloseError('SHIFT_NOT_FOUND', 404, 'No se pudo leer el turno cerrado');
        }

        return {
            shift: updatedShift,
            closeReport: publicCloseReport(reportRow),
            manualINs: closeMeta.manualINs,
            manualOUTs: closeMeta.manualOUTs,
            agentINs: closeMeta.agentINs,
            agentOUTs: closeMeta.agentOUTs,
            theftAlert: closeMeta.theftAlert,
            idempotentReplay: false,
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
