/**
 * Numeración DGI de comprobantes de venta (H3/H4/H6).
 *
 * Contrato:
 *  - Cada tenant emite ventas en UNA serie activa, A o B (configurable por
 *    `PUT /api/invoice-series`). El manual promete A/B; antes la serie estaba
 *    fija en 'A' dentro de salesService.
 *  - El consecutivo respeta el inicio del rango autorizado:
 *    siguiente = max(último + 1, rangeStart). Antes `rangeStart` se ignoraba y
 *    el contador arrancaba en 1 aunque la DGI autorizara desde 501.
 *  - Nunca se reutiliza un número: bajar `rangeStart` no retrocede el contador.
 *  - El fin del rango se valida bajo el lock de la fila (FOR UPDATE).
 *  - `@@unique([tenantId, invoiceSeries, invoiceNumber])` en Sale es la última
 *    defensa: dos series no colisionan y una misma serie no repite número.
 *  - Las notas de crédito por anulación usan su propio correlativo 'NC',
 *    separado de las series de venta.
 */
import { z } from 'zod';
import prisma from '../lib/prisma';

export const SALE_INVOICE_SERIES = ['A', 'B'] as const;
export type SaleInvoiceSeries = typeof SALE_INVOICE_SERIES[number];
export const DEFAULT_SALE_INVOICE_SERIES: SaleInvoiceSeries = 'A';
export const SALE_CREDIT_NOTE_SERIES = 'NC';
export const MAX_INVOICE_NUMBER = 2_147_483_647;

export class InvoiceNumberingError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
        super(message);
        this.name = 'InvoiceNumberingError';
    }
}

/** Regla pura: próximo consecutivo dentro del rango autorizado. */
export function nextInvoiceNumber(counter: { lastNumber: number; rangeStart: number; rangeEnd: number }): number {
    const next = Math.max(counter.lastNumber + 1, counter.rangeStart);
    if (next > counter.rangeEnd) {
        throw new InvoiceNumberingError('INVOICE_RANGE_EXHAUSTED', 422, 'Rango de facturacion DGI agotado');
    }
    return next;
}

/** Configuración de la serie activa (PUT /api/invoice-series). */
export const InvoiceSeriesConfigSchema = z.object({
    series: z.enum(SALE_INVOICE_SERIES),
    rangeStart: z.number().int().min(1).max(MAX_INVOICE_NUMBER).optional(),
    rangeEnd: z.number().int().min(1).max(MAX_INVOICE_NUMBER).optional(),
}).strict();

export class InvoiceSeriesConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvoiceSeriesConfigError';
    }
}

/** Regla pura: rango resultante válido para el contador actual. */
export function resolveInvoiceSeriesRange(
    current: { lastNumber: number; rangeStart: number; rangeEnd: number } | null,
    input: { rangeStart?: number; rangeEnd?: number },
): { rangeStart: number; rangeEnd: number } {
    const rangeStart = input.rangeStart ?? current?.rangeStart ?? 1;
    const rangeEnd = input.rangeEnd ?? current?.rangeEnd ?? 999999;
    if (rangeEnd < rangeStart) {
        throw new InvoiceSeriesConfigError('El fin del rango autorizado no puede ser menor que su inicio.');
    }
    const lastNumber = current?.lastNumber ?? 0;
    if (rangeEnd <= lastNumber) {
        throw new InvoiceSeriesConfigError(`La serie ya emitió hasta el ${lastNumber}; el rango debe terminar después.`);
    }
    return { rangeStart, rangeEnd };
}

export function isSaleInvoiceSeries(value: unknown): value is SaleInvoiceSeries {
    return typeof value === 'string' && (SALE_INVOICE_SERIES as readonly string[]).includes(value);
}

type CounterRow = { id: string; series: string; lastNumber: number; rangeStart: number; rangeEnd: number };
type Tx = any;

/**
 * Siembra perezosa de la serie A cuando el tenant todavía no tiene ninguna
 * serie de venta. Se llama FUERA de la transacción de venta (como antes) para
 * evitar carreras de primer uso; un tenant que ya eligió B no recibe una A activa.
 */
export async function ensureDefaultSaleInvoiceSeries(db: Pick<typeof prisma, 'invoiceSeries'>, tenantId: string): Promise<void> {
    const existing = await db.invoiceSeries.findFirst({
        where: { tenantId, series: { in: [...SALE_INVOICE_SERIES] } },
        select: { id: true },
    });
    if (existing) return;
    await db.invoiceSeries.createMany({
        data: [{ tenantId, series: DEFAULT_SALE_INVOICE_SERIES, lastNumber: 0 }],
        skipDuplicates: true,
    });
}

async function lockCounter(tx: Tx, tenantId: string, series: readonly string[], onlyActive: boolean): Promise<CounterRow | null> {
    const rows: CounterRow[] = onlyActive
        ? await tx.$queryRaw`
            SELECT id, series, lastNumber, rangeStart, rangeEnd FROM \`InvoiceSeries\`
            WHERE tenantId = ${tenantId} AND isActive = true AND series IN (${series[0]}, ${series[1] ?? series[0]})
            ORDER BY series ASC LIMIT 1 FOR UPDATE`
        : await tx.$queryRaw`
            SELECT id, series, lastNumber, rangeStart, rangeEnd FROM \`InvoiceSeries\`
            WHERE tenantId = ${tenantId} AND series = ${series[0]}
            LIMIT 1 FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        series: row.series,
        lastNumber: Number(row.lastNumber),
        rangeStart: Number(row.rangeStart),
        rangeEnd: Number(row.rangeEnd),
    };
}

async function consume(tx: Tx, counter: CounterRow): Promise<{ series: string; number: number }> {
    const number = nextInvoiceNumber(counter);
    await tx.invoiceSeries.update({ where: { id: counter.id }, data: { lastNumber: number } });
    return { series: counter.series, number };
}

/** Asigna serie + número a una venta DENTRO de su transacción. */
export async function allocateSaleInvoiceNumber(tx: Tx, tenantId: string): Promise<{ series: SaleInvoiceSeries; number: number }> {
    let counter = await lockCounter(tx, tenantId, SALE_INVOICE_SERIES, true);
    if (!counter) {
        // Tenant sin ninguna serie (primer uso desde un flujo sin siembra previa).
        await ensureDefaultSaleInvoiceSeries(tx, tenantId);
        counter = await lockCounter(tx, tenantId, SALE_INVOICE_SERIES, true);
    }
    if (!counter || !isSaleInvoiceSeries(counter.series)) {
        throw new InvoiceNumberingError('INVOICE_SERIES_NOT_CONFIGURED', 409, 'No hay una serie de facturación activa (A o B)');
    }
    const assigned = await consume(tx, counter);
    return { series: counter.series as SaleInvoiceSeries, number: assigned.number };
}

/** Número propio de la nota de crédito por anulación (serie 'NC'). */
export async function allocateSaleCreditNoteNumber(tx: Tx, tenantId: string): Promise<{ series: string; number: number }> {
    let counter = await lockCounter(tx, tenantId, [SALE_CREDIT_NOTE_SERIES], false);
    if (!counter) {
        await tx.invoiceSeries.createMany({
            data: [{ tenantId, series: SALE_CREDIT_NOTE_SERIES, lastNumber: 0, isActive: false }],
            skipDuplicates: true,
        });
        counter = await lockCounter(tx, tenantId, [SALE_CREDIT_NOTE_SERIES], false);
    }
    if (!counter) {
        throw new InvoiceNumberingError('CREDIT_NOTE_SERIES_UNAVAILABLE', 500, 'No se pudo reservar el correlativo de notas de crédito');
    }
    return consume(tx, counter);
}
