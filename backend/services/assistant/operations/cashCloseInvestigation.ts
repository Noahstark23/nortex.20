import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { canReadShiftReport, resolveSalesReportScope, SalesReportError } from '../../../lib/salesReport.js';
import { validateShiftSnapshot, type ShiftSnapshotDbRow } from '../../shiftSnapshotValidation.js';
import { assertAssistantAccess } from '../access.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { CashCloseInvestigation } from '../../../../shared/assistantCashCloseInvestigation.js';
import { AssistantRunError } from './contracts.js';
import { checkedSnapshotCash } from './weeklyCashReviewSummary.js';

const MAX_BYTES = 262144, MAX_MOVEMENTS = 30;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const cashCloseInvestigationQuerySchema = z.object({ shiftId: identifier, reportHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const categories = new Set(['GASTO_OPERATIVO', 'PAGO_PROVEEDOR', 'RETIRO_PERSONAL', 'CAMBIO', 'INYECCION_CAPITAL', 'AJUSTE', 'AGENTE_BANCARIO', 'DEVOLUCION', 'COMPRA_CONTADO', 'COBRO_CREDITO', 'NOMINA', 'VENTA_EFECTIVO', 'SIN_CATEGORIA']);
const methods = new Set(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']);
type Dependencies = { db?: PrismaClient; now?: () => Date };
interface CloseRow extends ShiftSnapshotDbRow { status: string; openedAt: unknown; closedAt: unknown; reportBytes: unknown }
interface MovementRow { id: unknown; type: unknown; currency: unknown; category: unknown; amount: unknown; createdAt: unknown; isVoided: unknown; voidedAt: unknown; expenseId: unknown }
const category = (value: unknown): string => typeof value === 'string' && categories.has(value) ? value : 'OTRA_CATEGORIA';
function date(value: unknown): string {
    if (value == null) throw new Error('CASH_CLOSE_DATE_INVALID');
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(parsed.getTime())) throw new Error('CASH_CLOSE_DATE_INVALID');
    return parsed.toISOString();
}
function money(value: unknown, precision: number): string {
    if (typeof value !== 'string' && !Decimal.isDecimal(value)) throw new Error();
    const text = String(value);
    if (!/^-?\d{1,24}(?:\.\d+)?$/.test(text)) throw new Error();
    const amount = new Decimal(text);
    if (!amount.isFinite() || amount.decimalPlaces() > precision) throw new Error();
    return amount.toFixed(precision);
}
function count(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('CASH_CLOSE_COUNT_INVALID');
    return value;
}
function direction(value: unknown): string {
    if (value !== 'IN' && value !== 'OUT') throw new Error('CASH_CLOSE_DIRECTION_INVALID');
    return value;
}
function currency(value: unknown): string {
    if (value !== 'NIO' && value !== 'USD') throw new Error('CASH_CLOSE_CURRENCY_INVALID');
    return value;
}
function projectSnapshot(row: CloseRow, shiftId: string): CashCloseInvestigation['snapshot'] {
    if (row.status !== 'CLOSED' || row.id == null || !Number.isSafeInteger(Number(row.reportBytes)) || Number(row.reportBytes) <= 0 || Number(row.reportBytes) > MAX_BYTES) return null;
    try {
        const source = validateShiftSnapshot(row, shiftId), report = source.report;
        if (date(report.shift.openedAt) !== date(row.openedAt) || report.paymentMethods.length > 10 || report.movementBreakdown.length > 20) return null;
        const cash = checkedSnapshotCash(source, new Date(date(row.closedAt)));
        // El reporte v1 guarda CASH bruto; no permite reconstruir el efectivo recibido.
        for (const [key, value] of Object.entries(report.cash)) money(value, key.endsWith('Usd') ? 4 : 2);
        return {
            source: { id: source.id, version: source.version, contentHash: source.contentHash, documentUrl: source.documentUrl },
            cash: { ...cash, openingNio: money(report.cash.openingNio, 2), grossCashSalesNio: money(report.cash.cashSalesNio, 2),
                cashRefundsNio: money(report.cash.cashRefundsNio, 2), paidInNio: money(report.cash.paidInNio, 2), paidOutNio: money(report.cash.paidOutNio, 2),
                openingUsd: money(report.cash.openingUsd, 4), paidInUsd: money(report.cash.paidInUsd, 4), paidOutUsd: money(report.cash.paidOutUsd, 4) },
            payments: report.paymentMethods.map(item => ({ method: methods.has(item.method) ? item.method : 'OTRO', transactionCount: count(item.transactionCount), grossSalesNio: money(item.grossSales, 2) })),
            movements: report.movementBreakdown.map(item => ({ type: direction(item.type), currency: currency(item.currency), category: category(item.category), count: count(item.count), amount: money(item.amount, item.currency === 'USD' ? 4 : 2) })),
        };
    } catch { return null; }
}
function projectMovement(row: MovementRow): CashCloseInvestigation['currentMovements']['rows'][number] {
    const id = identifier.parse(row.id), unit = currency(row.currency);
    if (![true, false, 0, 1].includes(row.isVoided as boolean)) throw new Error('CASH_CLOSE_VOID_INVALID');
    return { id, type: direction(row.type), currency: unit, category: category(row.category), amount: money(row.amount, unit === 'USD' ? 4 : 2),
        createdAt: date(row.createdAt), isVoided: row.isVoided === true || row.isVoided === 1, voidedAt: row.voidedAt == null ? null : date(row.voidedAt),
        expenseId: row.expenseId == null ? null : identifier.parse(row.expenseId) };
}

/** Sólo SELECTs: los movimientos actuales nunca reemplazan ni recalculan el cierre. */
export async function inspectCashClose(principal: AssistantPrincipal, input: unknown, deps: Dependencies = {}): Promise<CashCloseInvestigation> {
    const db = deps.db ?? prisma;
    await assertAssistantAccess(principal, 'operations', db);
    if (!canReadShiftReport(principal.role)) throw new SalesReportError('REPORT_ROLE_FORBIDDEN', 403, 'Tu rol no tiene acceso a la revisión de caja.');
    const parsed = cashCloseInvestigationQuerySchema.safeParse(input), now = deps.now?.() ?? new Date();
    if (!parsed.success || !Number.isFinite(now.getTime())) throw new AssistantRunError(400, 'CASH_CLOSE_QUERY_INVALID', 'Indicá una referencia válida del cierre.');
    const { shiftId, reportHash } = parsed.data;
    const scope = resolveSalesReportScope(principal.role, principal.userId).kind === 'tenant' ? 'business' : 'own-shifts';
    const ownership = scope === 'business' ? Prisma.sql`` : Prisma.sql`AND sh.\`userId\` = ${principal.userId}`;
    let row: CloseRow | undefined, movements: MovementRow[];
    try {
        [row, movements] = await db.$transaction(async tx => {
            const rows = await tx.$queryRaw<CloseRow[]>(Prisma.sql`
                SELECT sh.\`id\` AS shiftId, sh.\`status\` AS status, sh.\`startTime\` AS openedAt, sh.\`endTime\` AS closedAt,
                    scr.\`id\` AS id, scr.\`folio\` AS folio, scr.\`businessDate\` AS businessDate, scr.\`version\` AS version,
                    scr.\`contentHash\` AS contentHash, scr.\`createdAt\` AS createdAt, OCTET_LENGTH(scr.\`report\`) AS reportBytes,
                    CASE WHEN OCTET_LENGTH(scr.\`report\`) <= ${MAX_BYTES} THEN scr.\`report\` ELSE NULL END AS report
                FROM \`Shift\` sh LEFT JOIN \`ShiftCloseReport\` scr ON scr.\`shiftId\` = sh.\`id\` AND scr.\`tenantId\` = sh.\`tenantId\`
                WHERE sh.\`tenantId\` = ${principal.tenantId} AND sh.\`id\` = ${shiftId} ${ownership} LIMIT 1`);
            if (!rows[0]) return [undefined, []] as const;
            const current = await tx.$queryRaw<MovementRow[]>(Prisma.sql`
                SELECT cm.\`id\`, cm.\`type\`, cm.\`currency\`, cm.\`category\`, cm.\`amount\`, cm.\`createdAt\`, cm.\`isVoided\`, cm.\`voidedAt\`, e.\`id\` AS expenseId
                FROM \`CashMovement\` cm LEFT JOIN \`Expense\` e ON e.\`id\` = cm.\`expenseId\` AND e.\`tenantId\` = cm.\`tenantId\`
                WHERE cm.\`tenantId\` = ${principal.tenantId} AND cm.\`shiftId\` = ${shiftId}
                ORDER BY cm.\`createdAt\` ASC, cm.\`id\` ASC LIMIT ${MAX_MOVEMENTS + 1}`);
            return [rows[0], current] as const;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch {
        await assertAssistantAccess(principal, 'operations', db);
        throw new AssistantRunError(503, 'CASH_CLOSE_UNAVAILABLE', 'No pudimos consultar la evidencia del cierre.');
    }
    await assertAssistantAccess(principal, 'operations', db);
    if (!row) throw new AssistantRunError(404, 'CASH_CLOSE_NOT_FOUND', 'No encontramos un cierre accesible con esa referencia.');
    if (reportHash && row.contentHash !== reportHash) throw new AssistantRunError(409, 'CASH_CLOSE_SOURCE_CHANGED', 'La referencia del cierre cambió. Volvé a consultar el reporte.');
    let openedAt: string, closedAt: string | null;
    try { openedAt = date(row.openedAt); closedAt = row.closedAt == null ? null : date(row.closedAt); }
    catch { throw new AssistantRunError(503, 'CASH_CLOSE_UNAVAILABLE', 'El turno contiene fechas que requieren revisión.'); }
    const snapshot = projectSnapshot(row, shiftId);
    let currentMovements: CashCloseInvestigation['currentMovements'];
    try { currentMovements = { status: movements.length > MAX_MOVEMENTS ? 'truncated' : 'available', rows: movements.slice(0, MAX_MOVEMENTS).map(projectMovement) }; }
    catch { currentMovements = { status: 'unavailable', rows: [] }; }
    const pendingChecks: CashCloseInvestigation['pendingChecks'] = [
        { code: 'PHYSICAL_COUNT_REVIEW', message: 'Compará el conteo documentado con su evidencia física; no se acredita su causa.', references: [shiftId] },
        { code: 'HISTORICAL_TENDER_UNAVAILABLE', message: 'CASH bruto puede incluir crédito de tienda aplicado. El snapshot no acredita el efectivo recibido por venta.', references: [shiftId] },
        { code: 'LEDGER_AT_CLOSE_UNAVAILABLE', message: 'El snapshot no contiene la cabeza del libro firmado ni conciliación de asientos al cierre.', references: [shiftId] },
        { code: 'LATER_CHANGES_REVIEW', message: 'Revisá movimientos y anulaciones posteriores por separado; no modifican este snapshot.', references: [shiftId] },
    ];
    if (!snapshot) pendingChecks.push({ code: 'SNAPSHOT_UNAVAILABLE', message: 'Reporte ausente, inválido, abierto o demasiado extenso. No se reconstruye con datos actuales.', references: [shiftId] });
    if (currentMovements.status !== 'available') pendingChecks.push({ code: 'CURRENT_MOVEMENTS_INCOMPLETE', message: 'La lista actual está incompleta o no es verificable; revisá el módulo de caja.', references: [shiftId] });
    const result: CashCloseInvestigation = { kind: 'CASH_CLOSE_INVESTIGATION', status: !snapshot ? 'unavailable' : currentMovements.status === 'available' ? 'ok' : 'partial',
        checkedAt: now.toISOString(), scope, shift: { id: shiftId, openedAt, closedAt, folio: snapshot ? String(row.folio) : null, businessDate: snapshot ? String(row.businessDate) : null },
        snapshot, currentMovements, pendingChecks,
        warnings: ['El snapshot es la fotografía del cierre; los movimientos son su estado observado hoy, no una reconstrucción histórica.',
            'CASH se muestra bruto. paidOutNio excluye DEVOLUCION, mostrada por separado en cashRefundsNio; no sumar otra vez esos reembolsos.',
            'La lista actual incluye sólo CashMovement, no el listado de ventas; una lista vacía no acredita ausencia de ventas.',
            'Categorías y referencias orientan la revisión; no demuestran una causa, pago efectivo ni conciliación aceptada. No se recalcula el esperado.',
            'Hash coherente significa consistencia interna, no firma del libro, comprobación física ni ausencia de correcciones posteriores.'],
        evidence: ['Shift y ShiftCloseReport: tenant, propiedad, fechas, versión, hash y contado menos esperado por moneda.', 'CashMovement actual: tenant y turno; referencia Expense sólo con el mismo tenant. Sin descripciones ni nombres.'] };
    if (JSON.stringify(result).length > 18000) {
        result.status = 'unavailable'; result.snapshot = null; result.currentMovements = { status: 'unavailable', rows: [] };
        result.shift.folio = null; result.shift.businessDate = null;
        result.pendingChecks.push({ code: 'OUTPUT_LIMIT', message: 'La evidencia excede el tamaño seguro. Consultá el documento de cierre.', references: [shiftId] });
    }
    return result;
}
