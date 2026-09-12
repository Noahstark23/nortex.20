import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { canReadShiftReport, resolveSalesReportScope, SalesReportError } from '../../../lib/salesReport.js';
import { parseManaguaCivilDateInput } from '../../../lib/managuaBusinessDate.js';
import { claveDelDiaManagua } from '../../pulsoPos.js';
import { validateShiftSnapshot, type ShiftSnapshotDbRow } from '../../shiftSnapshotValidation.js';
import { assertAssistantAccess } from '../access.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { WeeklyCashReview, WeeklyCashReviewRow } from '../../../../shared/assistantWeeklyCashReview.js';
import { AssistantRunError } from './contracts.js';
import { checkedSnapshotCash, emptyCashReviewTotals, summarizeCashReviewRows } from './weeklyCashReviewSummary.js';

const MAX_CLOSED = 20, MAX_OPEN = 10, MAX_REPORT_BYTES = 256 * 1024, MAX_OUTPUT_CHARS = 18_000, DAY_MS = 86_400_000;
const civilDate = z.string().refine(value => parseManaguaCivilDateInput(value) !== null, 'Usá una fecha civil válida YYYY-MM-DD.');
export const weeklyCashReviewQuerySchema = z.object({ startDate: civilDate.optional(), endDate: civilDate.optional() }).strict()
    .refine(value => Boolean(value.startDate) === Boolean(value.endDate), 'Indicá ambas fechas o ninguna.');
type Dependencies = { db?: PrismaClient; now?: () => Date };
interface ClosedRow extends ShiftSnapshotDbRow { closedAt: unknown; reportBytes: unknown }
interface OpenRow { shiftId: string }

function reviewPeriod(input: unknown, now: Date): WeeklyCashReview['period'] & { from: Date; until: Date } {
    const parsed = weeklyCashReviewQuerySchema.safeParse(input);
    if (!parsed.success || Number.isNaN(now.getTime())) throw new AssistantRunError(400, 'CASH_REVIEW_PERIOD_INVALID', 'Indicá un período válido de 1 a 7 días en Managua.');
    const today = claveDelDiaManagua(now), todayOrdinal = Date.parse(`${today}T00:00:00.000Z`);
    const day = (offset: number) => new Date(todayOrdinal + offset * DAY_MS).toISOString().slice(0, 10);
    const startDate = parsed.data.startDate ?? day(-7), endDate = parsed.data.endDate ?? day(-1);
    const length = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS + 1;
    if (length < 1 || length > 7 || endDate > today) throw new AssistantRunError(400, 'CASH_REVIEW_PERIOD_INVALID', 'El período admite de 1 a 7 días, sin fechas futuras.');
    const from = new Date(`${startDate}T06:00:00.000Z`), completeDays = endDate < today;
    const until = completeDays ? new Date(Date.parse(`${endDate}T06:00:00.000Z`) + DAY_MS) : now;
    return { startDate, endDate, cutoff: until.toISOString(), timeZone: 'America/Managua', completeDays, from, until };
}

function reviewedRow(row: ClosedRow): WeeklyCashReviewRow {
    const closedAt = row.closedAt instanceof Date ? row.closedAt : new Date(String(row.closedAt));
    const validDate = !Number.isNaN(closedAt.getTime());
    const result: WeeklyCashReviewRow = { shiftId: String(row.shiftId), status: 'INVALID_REPORT', closedAt: validDate ? closedAt.toISOString() : null,
        businessDate: validDate ? claveDelDiaManagua(closedAt) : null, folio: null, source: null, cash: null,
        message: 'El reporte requiere revisión de integridad; no se usan sus importes.' };
    if (row.id == null) return { ...result, status: 'MISSING_REPORT', message: 'Cierre sin snapshot verificable. No se reconstruye con ventas actuales.' };
    if (!validDate || !Number.isSafeInteger(Number(row.reportBytes)) || Number(row.reportBytes) <= 0 || Number(row.reportBytes) > MAX_REPORT_BYTES) return result;
    try {
        const snapshot = validateShiftSnapshot(row, result.shiftId);
        const cash = checkedSnapshotCash(snapshot, closedAt);
        const difference = cash.differenceNio !== '0.00' || cash.differenceUsd !== '0.0000';
        return { ...result, status: difference ? 'DIFFERENCE' : 'BALANCED', folio: snapshot.folio, cash,
            source: { id: snapshot.id, version: snapshot.version, contentHash: snapshot.contentHash, documentUrl: snapshot.documentUrl },
            message: difference ? 'Diferencia registrada al cerrar; su causa requiere evidencia adicional.' : 'Conteo y esperado coinciden en el cierre registrado.' };
    } catch { return result; }
}

/** Dos consultas de lectura, sin reconstruir cierres ni ejecutar correcciones. */
export async function reviewWeeklyCash(principal: AssistantPrincipal, input: unknown = {}, deps: Dependencies = {}): Promise<WeeklyCashReview> {
    const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
    await assertAssistantAccess(principal, 'operations', db);
    if (!canReadShiftReport(principal.role)) throw new SalesReportError('REPORT_ROLE_FORBIDDEN', 403, 'Tu rol no tiene acceso a la revisión de caja.');
    const period = reviewPeriod(input, now);
    const scope = resolveSalesReportScope(principal.role, principal.userId).kind === 'tenant' ? 'business' : 'own-shifts';
    const ownership = scope === 'business' ? Prisma.sql`` : Prisma.sql`AND sh.\`userId\` = ${principal.userId}`;
    let closed: ClosedRow[], opened: OpenRow[];
    try {
        [closed, opened] = await db.$transaction(async tx => Promise.all([
            tx.$queryRaw<ClosedRow[]>(Prisma.sql`
                SELECT sh.\`id\` AS shiftId, sh.\`endTime\` AS closedAt,
                    scr.\`id\` AS id, scr.\`folio\` AS folio, scr.\`businessDate\` AS businessDate,
                    scr.\`version\` AS version, scr.\`contentHash\` AS contentHash, scr.\`createdAt\` AS createdAt,
                    OCTET_LENGTH(scr.\`report\`) AS reportBytes,
                    CASE WHEN OCTET_LENGTH(scr.\`report\`) <= ${MAX_REPORT_BYTES} THEN scr.\`report\` ELSE NULL END AS report
                FROM \`Shift\` sh LEFT JOIN \`ShiftCloseReport\` scr
                    ON scr.\`shiftId\` = sh.\`id\` AND scr.\`tenantId\` = sh.\`tenantId\`
                WHERE sh.\`tenantId\` = ${principal.tenantId} AND sh.\`status\` = 'CLOSED'
                    AND sh.\`endTime\` >= ${period.from} AND sh.\`endTime\` < ${period.until} ${ownership}
                ORDER BY sh.\`endTime\` ASC, sh.\`id\` ASC LIMIT ${MAX_CLOSED + 1}`),
            tx.$queryRaw<OpenRow[]>(Prisma.sql`
                SELECT sh.\`id\` AS shiftId FROM \`Shift\` sh
                WHERE sh.\`tenantId\` = ${principal.tenantId} AND sh.\`status\` = 'OPEN'
                    AND sh.\`startTime\` < ${period.until} ${ownership}
                ORDER BY sh.\`startTime\` ASC, sh.\`id\` ASC LIMIT ${MAX_OPEN + 1}`),
        ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch {
        await assertAssistantAccess(principal, 'operations', db);
        throw new AssistantRunError(503, 'CASH_REVIEW_UNAVAILABLE', 'No pudimos verificar los cierres. La falta de respuesta no significa que no existan.');
    }
    await assertAssistantAccess(principal, 'operations', db);
    let truncated = closed.length > MAX_CLOSED || opened.length > MAX_OPEN;
    const rows = closed.slice(0, MAX_CLOSED).map(reviewedRow);
    rows.push(...opened.slice(0, MAX_OPEN).map(row => ({ shiftId: row.shiftId, status: 'OPEN' as const, closedAt: null, businessDate: null, folio: null, source: null, cash: null,
        message: 'Turno actualmente abierto que inició antes del corte; no reconstruye su estado histórico.' })));
    const { from: _from, until: _until, ...publicPeriod } = period;
    const warnings = [
        'Incluye turnos cerrados por fecha de cierre en Managua. Los abiertos reflejan su estado actual, no el histórico.',
        'Los snapshots son fotografías de cada cierre, no el saldo de caja actual. No se suman fondos entre turnos.',
        'Un hash coherente no acredita conciliación contable, conteo físico correcto ni la causa de una diferencia.',
        'Correcciones posteriores se verifican por separado; no cambian esta revisión del snapshot original.',
    ];
    if (truncated) warnings.push('Se excedió el límite de 20 cierres o 10 turnos abiertos. Los conteos son mínimos observados; reducí el rango.');
    if (rows.some(row => row.status === 'MISSING_REPORT' || row.status === 'INVALID_REPORT')) warnings.push('Hay cierres sin evidencia íntegra. No se presenta una suma parcial como total.');
    if (closed.length === 0) warnings.push('No hay cierres verificables en el período; esto no acredita caja en cero.');
    const result: WeeklyCashReview = { kind: 'WEEKLY_CASH_REVIEW', ...summarizeCashReviewRows(rows, closed.length, opened.length, truncated), truncated,
        period: publicPeriod, checkedAt: now.toISOString(), scope, rows, warnings,
        evidence: ['Shift: tenant, estado y fecha de cierre; turnos abiertos actuales antes del corte.', 'ShiftCloseReport: versión, fecha, hash SHA-256 y ecuación contado menos esperado, separados por moneda.'] };
    if (JSON.stringify(result).length > MAX_OUTPUT_CHARS) {
        truncated = true; result.truncated = true; result.status = 'unavailable'; result.rows = []; result.totals = emptyCashReviewTotals();
        result.warnings.push('La evidencia excede el tamaño seguro de respuesta. Reducí el rango; no se muestran importes parciales.');
    }
    return result;
}
