import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { PURCHASE_READ_ROLES } from '../../middleware/accessPolicies.js';
import { batchExpiryWindow } from '../../../utils/batchExpiry.js';
import type { AssistantMetric, AssistantOverview, AssistantPrincipal } from '../../../shared/assistant.js';
import {
    assertAssistantAccess, AssistantAccessError, ASSISTANT_BUSINESS_SALES_ROLES,
    ASSISTANT_OWN_SALES_ROLES, ASSISTANT_FINANCIAL_ROLES, ASSISTANT_INVENTORY_ROLES,
} from './access.js';

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha civil inválida');

export const assistantPeriodSchema = z.object({ startDate: civilDate.optional(), endDate: civilDate.optional() }).strict();

export function getAssistantPeriod(input: unknown = {}, now = new Date()) {
    const parsed = assistantPeriodSchema.parse(input);
    const { today } = batchExpiryWindow(now, 0);
    const endDate = parsed.endDate || today.toISOString().slice(0, 10);
    const startDate = parsed.startDate || `${endDate.slice(0, 7)}-01`;
    // Managua no aplica horario de verano: su día operacional inicia a 06:00 UTC.
    const start = new Date(`${startDate}T06:00:00.000Z`);
    const endExclusive = new Date(`${endDate}T06:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const days = (endExclusive.getTime() - start.getTime()) / 86_400_000;
    if (days <= 0 || days > 366) throw new AssistantAccessError(400, 'ASSISTANT_INVALID_PERIOD', 'Elegí un período ordenado de hasta 366 días.');
    return { startDate, endDate, start, endExclusive };
}

type AggregateRow = Record<string, Prisma.Decimal | bigint | string | number | null>;
type MetricSpec = Pick<AssistantMetric, 'key' | 'label' | 'unit' | 'source'> & { field: string; unknownField?: string };

/** SQL devuelve agregados, nunca filas de documentos para sumarlas en memoria. */
async function queryMetrics(db: PrismaClient, sql: Prisma.Sql, specs: MetricSpec[]): Promise<AssistantMetric[]> {
    let row: AggregateRow | undefined;
    try { row = (await db.$queryRaw<AggregateRow[]>(sql))[0]; } catch { /* Sin valor verificable: unavailable. */ }
    return specs.map(({ field, unknownField, ...spec }) => {
        try {
            if (!row || row[field] === null || row[field] === undefined
                || (unknownField && (row[unknownField] === undefined || new Decimal(String(row[unknownField])).gt(0)))) {
                return { ...spec, value: null, status: 'unavailable' };
            }
            const value = new Decimal(String(row[field]));
            if (!value.isFinite()) return { ...spec, value: null, status: 'unavailable' };
            return { ...spec, value: value.toFixed(), status: 'ok' };
        } catch { return { ...spec, value: null, status: 'unavailable' }; }
    });
}

export type AssistantOverviewTopic = 'all' | 'sales' | 'inventory' | 'expenses' | 'balances';

export async function getAssistantOverview(
    principal: AssistantPrincipal,
    periodInput: unknown = {},
    db: PrismaClient = prisma,
    topic: AssistantOverviewTopic = 'all',
    now = new Date(),
): Promise<AssistantOverview> {
    await assertAssistantAccess(principal, topic === 'inventory' ? 'inventory' : 'overview', db);
    const { startDate, endDate, start, endExclusive } = getAssistantPeriod(periodInput, now);
    const financial = ASSISTANT_FINANCIAL_ROLES.includes(principal.role);
    const businessSales = ASSISTANT_BUSINESS_SALES_ROLES.includes(principal.role);
    const ownSales = ASSISTANT_OWN_SALES_ROLES.includes(principal.role);
    const inventory = ASSISTANT_INVENTORY_ROLES.includes(principal.role);
    if (((topic === 'balances' || topic === 'expenses') && !financial) || (topic === 'sales' && !businessSales && !ownSales)) {
        throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu rol no puede consultar estos datos.');
    }
    const jobs: Promise<AssistantMetric[]>[] = [];
    const seller = ownSales ? Prisma.sql`AND s.soldById = ${principal.userId}` : Prisma.empty;
    const activeSale = Prisma.sql`s.tenantId = ${principal.tenantId} AND s.cancelledAt IS NULL AND s.status NOT IN ('VOIDED', 'CANCELLED', 'CANCELED') ${seller}`;
    if ((topic === 'all' || topic === 'sales') && (businessSales || ownSales)) {
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS total,
                COALESCE(SUM(s.vatAmountAtSale), 0) AS vat,
                COALESCE(SUM(s.vatAmountAtSale IS NULL), 0) AS unknownVat
            FROM Sale s WHERE ${activeSale} AND s.createdAt >= ${start} AND s.createdAt < ${endExclusive}
        `, [
            { key: 'salesTotal', field: 'total', label: ownSales ? 'Tus ventas emitidas (incluyen impuestos)' : 'Ventas emitidas (incluyen impuestos)', unit: 'money', source: 'Ventas del período; excluye anulaciones. Total antes de devoluciones; no es utilidad ni cobro.' },
            { key: 'salesCount', field: 'count', label: 'Ventas emitidas', unit: 'count', source: 'Ventas del período; excluye anulaciones.' },
            { key: 'salesVat', field: 'vat', unknownField: 'unknownVat', label: 'IVA documentado en ventas', unit: 'money', source: 'Foto fiscal de cada venta del período. No disponible si falta el IVA histórico de alguna venta.' },
        ]));
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(r.total), 0) AS total FROM ProductReturn r
            JOIN Sale s ON s.id = r.saleId AND s.tenantId = r.tenantId
            WHERE r.tenantId = ${principal.tenantId} AND ${activeSale}
                AND r.createdAt >= ${start} AND r.createdAt < ${endExclusive}
        `, [{ key: 'returnsTotal', field: 'total', label: 'Devoluciones registradas en el período', unit: 'money', source: 'Devoluciones del período, incluso de ventas anteriores; incluye resoluciones sin efectivo. Se muestra separado de ventas.' }]));
    }
    if (topic === 'all' && PURCHASE_READ_ROLES.includes(principal.role)) {
        // Facturas son días civiles (históricos a medianoche; nuevas al mediodía UTC).
        const invoiceStart = new Date(`${startDate}T00:00:00.000Z`);
        const invoiceEnd = new Date(`${endDate}T00:00:00.000Z`);
        invoiceEnd.setUTCDate(invoiceEnd.getUTCDate() + 1);
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(total), 0) AS total FROM Purchase
            WHERE tenantId = ${principal.tenantId} AND documentStatus = 'POSTED'
                AND date >= ${invoiceStart} AND date < ${invoiceEnd}
        `, [{ key: 'purchasesTotal', field: 'total', label: 'Compras documentadas (incluyen impuestos)', unit: 'money', source: 'Compras vigentes según fecha de factura en el período. No equivale a pagos ni a recepciones del período.' }]));
    }
    if (financial && (topic === 'all' || topic === 'expenses')) {
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(amount), 0) AS total FROM Expense
            WHERE tenantId = ${principal.tenantId} AND createdAt >= ${start} AND createdAt < ${endExclusive}
        `, [{ key: 'expensesTotal', field: 'total', label: 'Gastos registrados', unit: 'money', source: 'Registro de gastos del período. No representa todos los egresos ni el costo de ventas.' }]));
    }
    if (financial && (topic === 'all' || topic === 'balances')) {
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(s.balance), 0) AS total FROM Sale s WHERE ${activeSale} AND s.balance > 0
        `, [{ key: 'receivables', field: 'total', label: 'Por cobrar ahora (todos los períodos)', unit: 'money', source: 'Saldo actual de ventas vigentes; no es un saldo histórico al cierre del período consultado.' }]));
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(balanceDue), 0) AS total,
                COALESCE(SUM(balanceDue IS NULL), 0) AS unknownBalance FROM Purchase
            WHERE tenantId = ${principal.tenantId} AND documentStatus = 'POSTED' AND paymentMethod = 'CREDIT'
        `, [{ key: 'payables', field: 'total', unknownField: 'unknownBalance', label: 'Por pagar ahora (todos los períodos)', unit: 'money', source: 'Saldo actual documentado en compras a crédito. No disponible si falta un saldo histórico; no se reconstruye ni siembra al consultar.' }]));
    }
    if (inventory && (topic === 'all' || topic === 'inventory')) {
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COUNT(*) AS count, COALESCE(SUM(stock <= 0), 0) AS outOfStock,
                COALESCE(SUM(stock <= minStock), 0) AS low FROM Product WHERE tenantId = ${principal.tenantId}
        `, [
            { key: 'productCount', field: 'count', label: 'Productos en catálogo ahora', unit: 'count', source: 'Catálogo actual del negocio; no incluye precios ni costos.' },
            { key: 'outOfStockCount', field: 'outOfStock', label: 'Productos sin existencias físicas positivas', unit: 'count', source: 'Stock físico actual. La disponibilidad vendible requiere revisar reservas, retenciones y lotes.' },
            { key: 'lowStockCount', field: 'low', label: 'Productos en o bajo su mínimo configurado', unit: 'count', source: 'Stock físico actual comparado con el mínimo de cada producto.' },
        ]));
        const { today, afterLastDay } = batchExpiryWindow(now, 30);
        jobs.push(queryMetrics(db, Prisma.sql`
            SELECT COALESCE(SUM(expiryDate < ${today}), 0) AS expired,
                COALESCE(SUM(expiryDate >= ${today} AND expiryDate < ${afterLastDay}), 0) AS expiring
            FROM ProductBatch WHERE tenantId = ${principal.tenantId} AND stock > 0
        `, [
            { key: 'expiredBatches', field: 'expired', label: 'Lotes vencidos con stock físico', unit: 'count', source: 'Lotes actuales; vencimiento civil anterior al día vigente en Managua.' },
            { key: 'expiringBatches', field: 'expiring', label: 'Lotes con stock que vencen desde hoy hasta 30 días', unit: 'count', source: 'Lotes actuales; incluye hoy y el último día, según calendario de Managua.' },
        ]));
    }
    const metrics = (await Promise.all(jobs)).flat();
    // Evitar entregar resultados si se revocó el acceso durante las consultas.
    await assertAssistantAccess(principal, topic === 'inventory' ? 'inventory' : 'overview', db);
    return {
        checkedAt: now.toISOString(), startDate, endDate,
        scope: ownSales ? 'Tus ventas; vendedor registrado en cada documento. Horario de Managua.'
            : principal.role === 'BODEGUERO' ? 'Inventario físico actual de tu negocio, sin importes. Horario de Managua.'
                : 'Datos de tu negocio autorizados para tu rol. Horario de Managua.',
        metrics,
    };
}
