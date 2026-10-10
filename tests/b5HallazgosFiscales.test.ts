/**
 * B5 — Regresión de los hallazgos fiscales H1–H8 y de los 10 casos de B2
 * (F1–F4, P1–P2, K1, C1–C2, R1) contra el código modificado.
 *
 * Todo es aritmética pura o transacciones simuladas en memoria: no se toca
 * MySQL ni HTTP. Lo que requiere una base real queda declarado en el PR.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    journalLine: { findMany: vi.fn() },
    taxConfig: { findUnique: vi.fn() },
    retencionSufrida: { aggregate: vi.fn() },
    obligationStatus: { findMany: vi.fn() },
}));
vi.mock('../backend/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

import { desglosarIvaIncluido, desglosarVentaConExoneracion, generateAnnualIR } from '../backend/services/nicaTax';
import { buildSaleJournalLines, assertPeriodOpen, createJournalEntry, PeriodLockedError } from '../backend/services/accounting';
import { resolveSaleFiscalAmounts } from '../utils/fiscalRegime';
import { calculatePayroll, calculateSettlement, calculateLaborLiability, computeAguinaldoAnual } from '../backend/services/nicaLabor';
import {
    allocateSaleCreditNoteNumber,
    allocateSaleInvoiceNumber,
    ensureDefaultSaleInvoiceSeries,
    InvoiceNumberingError,
    nextInvoiceNumber,
    resolveInvoiceSeriesRange,
    InvoiceSeriesConfigError,
    InvoiceSeriesConfigSchema,
} from '../backend/services/invoiceNumberingService';
import { issueSaleVoidCreditNote, voidKardexReason, SaleVoidCreditNoteError } from '../backend/services/saleVoidCreditNoteService';
import { mergeTaxConfigUpdate, TaxConfigValidationError, updateTaxConfig } from '../backend/services/taxConfigService';
import { runAguinaldoForYear } from '../backend/services/aguinaldoRunService';
import {
    applySaleInvoiceSchemaPreflight,
    SALE_INVOICE_UNIQUE_INDEX,
    UnsafeSchemaStateError,
} from '../scripts/deploy-schema-preflight';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

const sumLines = (lines: { debit: number; credit: number }[], key: 'debit' | 'credit') =>
    lines.reduce((sum, line) => sum.plus(line[key]), new Decimal(0));
const line = (lines: { accountCode: string; debit: number; credit: number }[], code: string) =>
    lines.find(l => l.accountCode === code);

// ── Base de datos simulada de InvoiceSeries ─────────────────────────────────
type SeriesRow = { id: string; tenantId: string; series: string; lastNumber: number; rangeStart: number; rangeEnd: number; isActive: boolean };
function seriesTx(rows: SeriesRow[]) {
    let seq = rows.length;
    return {
        rows,
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const text = strings.join('?');
            const tenantId = values[0];
            if (text.includes('isActive = true')) {
                const allowed = values.slice(1);
                return rows
                    .filter(r => r.tenantId === tenantId && r.isActive && allowed.includes(r.series))
                    .sort((a, b) => a.series.localeCompare(b.series))
                    .slice(0, 1)
                    .map(r => ({ ...r }));
            }
            return rows.filter(r => r.tenantId === tenantId && r.series === values[1]).slice(0, 1).map(r => ({ ...r }));
        }),
        invoiceSeries: {
            findFirst: vi.fn(async ({ where }: any) => rows.find(r => r.tenantId === where.tenantId && where.series.in.includes(r.series)) ?? null),
            createMany: vi.fn(async ({ data }: any) => {
                for (const d of data) {
                    if (rows.some(r => r.tenantId === d.tenantId && r.series === d.series)) continue;
                    rows.push({ id: `s${++seq}`, rangeStart: 1, rangeEnd: 999999, isActive: true, ...d });
                }
                return { count: 1 };
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const row = rows.find(r => r.id === where.id)!;
                Object.assign(row, data);
                return row;
            }),
        },
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// H1 — IVA a centavos en guardado y asientos
// ════════════════════════════════════════════════════════════════════════════
describe('H1 — IVA a 2 decimales en snapshot y asiento', () => {
    it('venta C$18 → guardado 15.65 / 2.35 / 18.00', () => {
        const d = desglosarVentaConExoneracion(18, 0);
        expect(d.netoGravado.toFixed(2)).toBe('15.65');
        expect(d.iva.toFixed(2)).toBe('2.35');
        const fiscal = resolveSaleFiscalAmounts(18, d.iva, 'GENERAL');
        // Lo que salesService persiste en vatAmountAtSale (toFixed(4)) ya es un centavo exacto.
        expect(fiscal.vatAmount.toFixed(4)).toBe('2.3500');
        expect(fiscal.netRevenue.toFixed(4)).toBe('15.6500');
        expect(fiscal.netRevenue.plus(fiscal.vatAmount).toFixed(2)).toBe('18.00');
        const lines = buildSaleJournalLines(18, 0, 'CASH', 0);
        expect(line(lines, '4.1.1')?.credit).toBe(15.65);
        expect(line(lines, '2.1.2')?.credit).toBe(2.35);
    });

    it('1,000 ventas de C$18 → el libro suma IVA 2,350.00, igual que los tickets', () => {
        let ticketIva = new Decimal(0);
        let libroIva = new Decimal(0);
        for (let i = 0; i < 1000; i++) {
            ticketIva = ticketIva.plus(desglosarIvaIncluido(18).iva);
            libroIva = libroIva.plus(line(buildSaleJournalLines(18, 0, 'CASH', 0), '2.1.2')!.credit);
        }
        expect(ticketIva.toFixed(2)).toBe('2350.00');
        expect(libroIva.toFixed(2)).toBe('2350.00');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H2 retirado — contrato de main preservado (tres funciones)
// ════════════════════════════════════════════════════════════════════════════
describe('H2 retirado — aguinaldo vigente / 360', () => {
    it('P2: C$12,000 con 180 días → 6,000.00 en la corrida anual', () => {
        // 1-dic-2025 + 179 días = 29-may-2026 → 180 días.
        const r = computeAguinaldoAnual(12000, new Date(2020, 0, 1), 2026, new Date(2026, 4, 29, 12));
        expect(r.dias).toBe(180);
        expect(r.monto).toBe(6000);
    });

    it('P2: la liquidación usa la regla vigente (180 días → 6,000.00)', () => {
        const r = calculateSettlement({
            hireDate: new Date('2020-01-01T12:00:00Z'),
            terminationDate: new Date('2026-05-29T12:00:00Z'),
            reason: 'RESIGNATION',
            salarioMensual: 12000,
            vacationDaysBalance: 0,
        });
        expect(r.diasAguinaldo).toBe(180);
        expect(r.aguinaldo).toBe(6000);
    });

    it('P2: el pasivo laboral usa la regla vigente (180 días → 6,000.0000)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
        const r = calculateLaborLiability('e1', 'Ana', new Date('2020-01-01T12:00:00Z'), 12000, 0);
        expect(r.aguinaldoAcumulado).toBe(6000);
    });

    it('período completo se topa en 360 días = un salario', () => {
        const r = computeAguinaldoAnual(12000, new Date(2020, 0, 1), 2026, new Date(2027, 0, 5));
        expect(r.dias).toBe(360);
        expect(r.monto).toBe(12000);
    });

    it('ingreso posterior al fin del período → 0', () => {
        expect(computeAguinaldoAnual(12000, new Date(2027, 0, 1), 2026, new Date(2027, 0, 5))).toEqual({ dias: 0, monto: 0 });
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H3 — Serie configurable, rango respetado, sin colisiones
// ════════════════════════════════════════════════════════════════════════════
describe('H3 — numeración DGI', () => {
    it('regla pura: respeta el inicio del rango y nunca retrocede', () => {
        expect(nextInvoiceNumber({ lastNumber: 0, rangeStart: 501, rangeEnd: 1000 })).toBe(501);
        expect(nextInvoiceNumber({ lastNumber: 501, rangeStart: 501, rangeEnd: 1000 })).toBe(502);
        expect(nextInvoiceNumber({ lastNumber: 700, rangeStart: 501, rangeEnd: 1000 })).toBe(701);
        expect(nextInvoiceNumber({ lastNumber: 999, rangeStart: 1, rangeEnd: 1000 })).toBe(1000);
        expect(() => nextInvoiceNumber({ lastNumber: 1000, rangeStart: 1, rangeEnd: 1000 })).toThrow(InvoiceNumberingError);
        try { nextInvoiceNumber({ lastNumber: 5, rangeStart: 1, rangeEnd: 5 }); } catch (e: any) {
            expect(e.code).toBe('INVOICE_RANGE_EXHAUSTED');
            expect(e.httpStatus).toBe(422);
        }
    });

    it('el contador arranca en el inicio autorizado (501) y usa la serie activa B', async () => {
        const tx = seriesTx([
            { id: 'a', tenantId: 't1', series: 'A', lastNumber: 40, rangeStart: 1, rangeEnd: 999999, isActive: false },
            { id: 'b', tenantId: 't1', series: 'B', lastNumber: 0, rangeStart: 501, rangeEnd: 999999, isActive: true },
        ]);
        expect(await allocateSaleInvoiceNumber(tx, 't1')).toEqual({ series: 'B', number: 501 });
        expect(await allocateSaleInvoiceNumber(tx, 't1')).toEqual({ series: 'B', number: 502 });
        // La serie A inactiva no se mueve.
        expect(tx.rows.find(r => r.id === 'a')!.lastNumber).toBe(40);
    });

    it('dos series no colisionan: A-1 y B-1 son números distintos (clave serie+número)', async () => {
        const tx = seriesTx([
            { id: 'a', tenantId: 't1', series: 'A', lastNumber: 0, rangeStart: 1, rangeEnd: 999999, isActive: true },
        ]);
        const first = await allocateSaleInvoiceNumber(tx, 't1');
        tx.rows[0].isActive = false;
        tx.rows.push({ id: 'b', tenantId: 't1', series: 'B', lastNumber: 0, rangeStart: 1, rangeEnd: 999999, isActive: true });
        const second = await allocateSaleInvoiceNumber(tx, 't1');
        expect(first).toEqual({ series: 'A', number: 1 });
        expect(second).toEqual({ series: 'B', number: 1 });
        expect(`${first.series}-${first.number}`).not.toBe(`${second.series}-${second.number}`);
        const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
        expect(schema).toContain('@@unique([tenantId, invoiceSeries, invoiceNumber])');
    });

    it('tenant sin series: siembra A una sola vez; un tenant con B no recibe A', async () => {
        const empty = seriesTx([]);
        expect(await allocateSaleInvoiceNumber(empty, 't1')).toEqual({ series: 'A', number: 1 });
        const onlyB = seriesTx([{ id: 'b', tenantId: 't2', series: 'B', lastNumber: 9, rangeStart: 1, rangeEnd: 99, isActive: true }]);
        await ensureDefaultSaleInvoiceSeries(onlyB as any, 't2');
        expect(onlyB.rows.map(r => r.series)).toEqual(['B']);
    });

    it('sin serie activa → error explícito, no número inventado', async () => {
        const tx = seriesTx([{ id: 'a', tenantId: 't1', series: 'A', lastNumber: 3, rangeStart: 1, rangeEnd: 9, isActive: false }]);
        await expect(allocateSaleInvoiceNumber(tx, 't1')).rejects.toMatchObject({ code: 'INVOICE_SERIES_NOT_CONFIGURED', httpStatus: 409 });
    });

    it('configuración: solo A/B, rango coherente y nunca por debajo de lo emitido', () => {
        expect(InvoiceSeriesConfigSchema.safeParse({ series: 'C' }).success).toBe(false);
        expect(InvoiceSeriesConfigSchema.safeParse({ series: 'B', rangeStart: 501, rangeEnd: 1000 }).success).toBe(true);
        expect(resolveInvoiceSeriesRange(null, { rangeStart: 501 })).toEqual({ rangeStart: 501, rangeEnd: 999999 });
        expect(() => resolveInvoiceSeriesRange(null, { rangeStart: 10, rangeEnd: 5 })).toThrow(InvoiceSeriesConfigError);
        expect(() => resolveInvoiceSeriesRange({ lastNumber: 700, rangeStart: 1, rangeEnd: 999 }, { rangeEnd: 700 })).toThrow(InvoiceSeriesConfigError);
    });

    it('preflight: con duplicados se detiene sin crear el índice ni tocar datos', async () => {
        const execute = vi.fn();
        const db = {
            query: vi.fn(async (sql: any) => {
                const text: string = sql.sql;
                if (text.includes('information_schema.TABLES')) return [{ tableName: 'Sale' }];
                if (text.includes('HAVING COUNT')) return [{ tenantId: 't1', invoiceSeries: 'A', invoiceNumber: 7, duplicateCount: 2 }];
                return [];
            }),
            execute,
        };
        await expect(applySaleInvoiceSchemaPreflight(db as any, { info: vi.fn(), warn: vi.fn() })).rejects.toThrow(UnsafeSchemaStateError);
        expect(execute).not.toHaveBeenCalled();
    });

    it('preflight: sin duplicados crea el UNIQUE y verifica su definición', async () => {
        let created = false;
        const indexRows = () => ['tenantId', 'invoiceSeries', 'invoiceNumber'].map((columnName, i) => ({
            indexName: SALE_INVOICE_UNIQUE_INDEX, nonUnique: 0, seqInIndex: i + 1, columnName,
            subPart: null, indexType: 'BTREE', isVisible: 'YES', collation: 'A', expression: null,
        }));
        const execute = vi.fn(async (sql: any) => {
            expect(sql.sql).toContain(`CREATE UNIQUE INDEX \`${SALE_INVOICE_UNIQUE_INDEX}\``);
            created = true;
            return 0;
        });
        const db = {
            query: vi.fn(async (sql: any) => {
                const text: string = sql.sql;
                if (text.includes('information_schema.TABLES')) return [{ tableName: 'Sale' }];
                if (text.includes('information_schema.STATISTICS')) return created ? indexRows() : [];
                return [];
            }),
            execute,
        };
        await applySaleInvoiceSchemaPreflight(db as any, { info: vi.fn(), warn: vi.fn() });
        expect(execute).toHaveBeenCalledTimes(1);
        // Re-ejecución idempotente: ya existe → no vuelve a crear.
        await applySaleInvoiceSchemaPreflight(db as any, { info: vi.fn(), warn: vi.fn() });
        expect(execute).toHaveBeenCalledTimes(1);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H4 — Ventas desde pedidos con número DGI
// ════════════════════════════════════════════════════════════════════════════
describe('H4 — toda venta registrada asigna número DGI', () => {
    it('los dos únicos sale.create del backend numeran por el mismo servicio', () => {
        const pedido = readFileSync(resolve(process.cwd(), 'backend/services/pedidoFulfillmentService.ts'), 'utf8');
        const sales = readFileSync(resolve(process.cwd(), 'backend/services/salesService.ts'), 'utf8');
        for (const source of [pedido, sales]) {
            const create = source.indexOf('tx.sale.create(');
            const alloc = source.indexOf('allocateSaleInvoiceNumber(tx,');
            expect(alloc).toBeGreaterThan(0);
            expect(alloc).toBeLessThan(create);
            expect(source.slice(create, create + 1400)).toMatch(/invoiceNumber: invoice\.number/);
            expect(source.slice(create, create + 1400)).toMatch(/invoiceSeries: invoice\.series/);
        }
        expect(sales).not.toContain("invoiceSeries: 'A'");
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H5 — Sin línea 2.1.2 en cero en cuota fija
// ════════════════════════════════════════════════════════════════════════════
describe('H5 / F3 — cuota fija', () => {
    it('F3: C$18 en cuota fija → 18.00 de ingreso, sin IVA y sin línea 2.1.2', () => {
        const lines = buildSaleJournalLines(18, 5, 'CASH', 0, { fiscalRegime: 'CUOTA_FIJA', vatAmount: 0 });
        expect(line(lines, '2.1.2')).toBeUndefined();
        expect(line(lines, '4.1.1')?.credit).toBe(18);
        expect(sumLines(lines, 'debit').equals(sumLines(lines, 'credit'))).toBe(true);
    });
    it('GENERAL gravado conserva su línea de IVA', () => {
        expect(line(buildSaleJournalLines(18, 0, 'CASH', 0), '2.1.2')?.credit).toBe(2.35);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H6 / F4 — Nota de crédito propia, original intacta
// ════════════════════════════════════════════════════════════════════════════
describe('H6 / F4 — anulación con nota de crédito numerada', () => {
    const sale = { id: 'sale-1', total: '18.0000', exemptTotal: '0', fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: '2.3500' };

    it('emite NC-1, NC-2… con total/IVA del snapshot, autorizador y ejecutor', async () => {
        const tx: any = seriesTx([]);
        tx.saleCreditNote = { create: vi.fn(async ({ data }: any) => ({ id: `nc-${data.number}`, ...data })) };
        const note = await issueSaleVoidCreditNote(tx, {
            tenantId: 't1', issuedById: 'cajero', motivo: 'Error de digitación', sale,
            correctionRequest: { id: 'req-1', approvedBy: 'gerente' },
        });
        expect(note).toMatchObject({ series: 'NC', number: 1, total: '18.0000', vatAmount: '2.3500', authorizedById: 'gerente', issuedById: 'cajero', saleId: 'sale-1', correctionRequestId: 'req-1' });
        const second = await allocateSaleCreditNoteNumber(tx, 't1');
        expect(second).toEqual({ series: 'NC', number: 2 });
        // El correlativo NC nunca es una serie de venta activa.
        expect(tx.rows.find((r: SeriesRow) => r.series === 'NC').isActive).toBe(false);
        expect(voidKardexReason('Error de digitación', note)).toBe('Anulación de factura: Error de digitación · NC NC-000001 · autorizó gerente');
    });

    it('sin aprobador registrado no emite la nota', async () => {
        await expect(issueSaleVoidCreditNote({}, { tenantId: 't1', issuedById: 'u', motivo: 'x', sale, correctionRequest: { id: 'r', approvedBy: null } }))
            .rejects.toBeInstanceOf(SaleVoidCreditNoteError);
    });

    it('la anulación no toca los datos fiscales de la original y ya no omite stock en silencio', () => {
        const start = server.indexOf("app.post('/api/sales/:id/cancel'");
        const route = server.slice(start, server.indexOf('// 💸 PAGOS', start));
        const mark = route.slice(route.indexOf('const marcada = await tx.sale.updateMany'), route.indexOf('if (marcada.count === 0)'));
        for (const field of ['total', 'vatAmountAtSale', 'invoiceNumber', 'invoiceSeries', 'exemptTotal']) {
            expect(mark).not.toMatch(new RegExp(`\\b${field}:`));
        }
        expect(route.indexOf('issueSaleVoidCreditNote(tx')).toBeGreaterThan(route.indexOf('if (marcada.count === 0)'));
        expect(route).not.toMatch(/PRODUCT_NOT_FOUND'\) continue/);
        expect(route).toContain("throw new ReturnResolutionError('RETURN_PRODUCT_NOT_FOUND', 409");
        expect(route.match(/reason: (motivoKardex|`\$\{motivoKardex\})/g)).toHaveLength(3);
        expect(route).toContain('creditNote: notaCredito');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H7 — Configuración fiscal validada
// ════════════════════════════════════════════════════════════════════════════
describe('H7 — PUT /api/accounting/tax-config', () => {
    const stored = { inssPatronalRate: '0.2150', anticipoIrRate: '0.0200', imiRate: '0.0100', salarioMinimo: '9500.00' };

    it('tasa patronal 99% → rechazo (400)', () => {
        expect(() => mergeTaxConfigUpdate(stored, { inssPatronalRate: 0.99 })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { anticipoIrRate: 0.99 })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { anticipoIrRate: 0.015 })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { imiRate: 1.5 })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { salarioMinimo: -1 })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { inssPatronalRate: 'abc' })).toThrow(TaxConfigValidationError);
        expect(() => mergeTaxConfigUpdate(stored, { otraCosa: 1 })).toThrow(TaxConfigValidationError);
    });

    it('acepta exactamente 21.5/22.5% y 1/2/3%', () => {
        for (const rate of [0.215, 0.225, '0.225']) expect(mergeTaxConfigUpdate(stored, { inssPatronalRate: rate }).after.inssPatronalRate).toBe(new Decimal(rate).toFixed(4));
        for (const rate of [0.01, 0.02, 0.03]) expect(mergeTaxConfigUpdate(stored, { anticipoIrRate: rate }).after.anticipoIrRate).toBe(new Decimal(rate).toFixed(4));
    });

    it('PUT parcial no altera los demás campos', () => {
        const { before, after } = mergeTaxConfigUpdate(stored, { anticipoIrRate: 0.03 });
        expect(after).toEqual({ ...before, anticipoIrRate: '0.0300' });
        expect(after.inssPatronalRate).toBe('0.2150');
        expect(after.salarioMinimo).toBe('9500.00');
    });

    it('guarda y deja AuditLog before/after en la misma transacción', async () => {
        const tx = {
            $queryRaw: vi.fn().mockResolvedValue([]),
            taxConfig: { findUnique: vi.fn().mockResolvedValue(stored), upsert: vi.fn(async ({ update }: any) => update) },
            auditLog: { create: vi.fn() },
        };
        const db = { $transaction: vi.fn(async (cb: any) => cb(tx)) };
        await updateTaxConfig({ tenantId: 't1', userId: 'u1', body: { imiRate: 0.02 }, db: db as any });
        expect(tx.taxConfig.upsert.mock.calls[0][0].update).toEqual({ inssPatronalRate: '0.2150', anticipoIrRate: '0.0200', imiRate: '0.0200', salarioMinimo: '9500.00' });
        const audit = tx.auditLog.create.mock.calls[0][0].data;
        expect(audit).toMatchObject({ tenantId: 't1', userId: 'u1', action: 'TAX_CONFIG_UPDATED' });
        expect(JSON.parse(audit.details).before.imiRate).toBe('0.0100');
        expect(JSON.parse(audit.details).after.imiRate).toBe('0.0200');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// H8 / C2 — Mes cerrado bloquea; aguinaldo sin asiento no queda pagado
// ════════════════════════════════════════════════════════════════════════════
describe('H8 / C2 — período cerrado', () => {
    const closedTx = () => ({ fiscalPeriod: { findUnique: vi.fn().mockResolvedValue({ status: 'CLOSED' }) } });

    it('C2: un mes cerrado bloquea cualquier asiento', async () => {
        await expect(assertPeriodOpen(closedTx() as any, 't1', new Date(2026, 4, 10))).rejects.toBeInstanceOf(PeriodLockedError);
        await expect(createJournalEntry(closedTx() as any, 't1', 'x', 'r', 'T', 'u', [{ accountCode: '1.1.1', debit: 1, credit: 0 }, { accountCode: '4.1.1', debit: 0, credit: 1 }]))
            .rejects.toBeInstanceOf(PeriodLockedError);
    });

    it('H8: con el mes cerrado no quedan pagos de aguinaldo huérfanos', async () => {
        const committed: { aguinaldo: any[]; audit: any[] } = { aguinaldo: [], audit: [] };
        const db = {
            employee: { findMany: vi.fn().mockResolvedValue([
                { id: 'e1', baseSalary: '12000', hireDate: new Date(2020, 0, 1) },
                { id: 'e2', baseSalary: '9000', hireDate: new Date(2020, 0, 1) },
            ]) },
            aguinaldo: { findMany: vi.fn().mockResolvedValue([]) },
            $transaction: vi.fn(async (cb: any) => {
                const staged: { aguinaldo: any[]; audit: any[] } = { aguinaldo: [], audit: [] };
                const tx = {
                    aguinaldo: { create: vi.fn(async ({ data }: any) => { const row = { id: `ag-${data.employeeId}`, ...data }; staged.aguinaldo.push(row); return row; }) },
                    auditLog: { create: vi.fn(async ({ data }: any) => staged.audit.push(data)) },
                };
                const result = await cb(tx); // si lanza, nada de lo staged se confirma
                committed.aguinaldo.push(...staged.aguinaldo);
                committed.audit.push(...staged.audit);
                return result;
            }),
        };
        const postPayment = vi.fn(async () => { throw new PeriodLockedError('2026-05'); });
        const r = await runAguinaldoForYear({ tenantId: 't1', userId: 'u1', year: 2026, today: new Date(2026, 4, 29, 12), db: db as any, postPayment });
        expect(postPayment).toHaveBeenCalledTimes(2);
        expect(committed.aguinaldo).toEqual([]);
        expect(committed.audit).toEqual([]);
        expect(r).toEqual({ pagados: 0, total: 0, fallidos: [
            { employeeId: 'e1', code: 'PERIOD_LOCKED', error: expect.stringContaining('2026-05') },
            { employeeId: 'e2', code: 'PERIOD_LOCKED', error: expect.stringContaining('2026-05') },
        ] });
    });

    it('H8: con el mes abierto paga con asiento y suma en Decimal', async () => {
        const db = {
            employee: { findMany: vi.fn().mockResolvedValue([{ id: 'e1', baseSalary: '12000', hireDate: new Date(2020, 0, 1) }]) },
            aguinaldo: { findMany: vi.fn().mockResolvedValue([]) },
            $transaction: vi.fn(async (cb: any) => cb({ aguinaldo: { create: vi.fn(async ({ data }: any) => ({ id: 'ag1', ...data })) }, auditLog: { create: vi.fn() } })),
        };
        const postPayment = vi.fn(async () => undefined);
        const r = await runAguinaldoForYear({ tenantId: 't1', userId: 'u1', year: 2026, today: new Date(2026, 4, 29, 12), db: db as any, postPayment });
        expect(postPayment).toHaveBeenCalledWith(expect.anything(), 't1', 'u1', 'ag1', 6000);
        expect(r).toEqual({ pagados: 1, total: 6000, fallidos: [] });
    });

    it('server.ts ya no captura el error del asiento del aguinaldo', () => {
        expect(server).not.toContain('Asiento de aguinaldo omitido');
        expect(server).toContain('runAguinaldoForYear(');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// Regresión B2 — los 10 casos
// ════════════════════════════════════════════════════════════════════════════
describe('Regresión B2', () => {
    it('F1: C$18 → 15.65 / 2.35 / 18.00', () => {
        const d = desglosarIvaIncluido(18);
        expect([d.neto.toFixed(2), d.iva.toFixed(2), d.neto.plus(d.iva).toFixed(2)]).toEqual(['15.65', '2.35', '18.00']);
    });

    it('F2: total 180.00 (IVA incluido, descuento antes de IVA) → IVA 23.48, base 156.52', () => {
        // 2 × C$100 de góndola con 10% de descuento: el descuento baja el precio
        // con IVA incluido y el IVA se separa del total ya descontado.
        const total = new Decimal(2).times(100).times(new Decimal(1).minus('0.10'));
        expect(total.toFixed(2)).toBe('180.00');
        const d = desglosarVentaConExoneracion(total, 0);
        expect(d.iva.toFixed(2)).toBe('23.48');
        expect(d.netoGravado.toFixed(2)).toBe('156.52');
        const lines = buildSaleJournalLines(total, 0, 'CASH', 0);
        expect(line(lines, '2.1.2')?.credit).toBe(23.48);
        expect(line(lines, '4.1.1')?.credit).toBe(156.52);
    });

    it('F3: cuota fija C$18.00 sin IVA visible', () => {
        const fiscal = resolveSaleFiscalAmounts(18, desglosarVentaConExoneracion(18, 0).iva, 'CUOTA_FIJA');
        expect(fiscal.vatAmount.toFixed(2)).toBe('0.00');
        expect(fiscal.netRevenue.toFixed(2)).toBe('18.00');
    });

    it('P1: C$12,000 → INSS 840, base IR 11,160, patronal 2,700 (22.5%) o 2,580 (21.5%), INATEC 240', () => {
        const p = calculatePayroll(12000);
        expect(p.inssLaboral).toBe(840);
        expect(new Decimal(p.totalIncome).minus(p.inssLaboral).toNumber()).toBe(11160);
        expect(p.inssPatronal).toBe(2700);
        expect(p.inatec).toBe(240);
        expect(calculatePayroll(12000, 0, { inssPatronalRate: 0.215 }).inssPatronal).toBe(2580);
    });

    it('C1: el asiento de venta cuadra a centavos (con exento, crédito y saldo a favor)', () => {
        for (const [total, exempt, method, credit] of [[18, 0, 'CASH', 0], [180, 0, 'CARD', 0], [115, 50, 'CREDIT', 0], [99.99, 33.33, 'CASH', 10], [0.01, 0, 'CASH', 0]] as const) {
            const lines = buildSaleJournalLines(total, 7.5, method, exempt, { storeCreditApplied: credit });
            expect(sumLines(lines, 'debit').toFixed(2)).toBe(sumLines(lines, 'credit').toFixed(2));
            for (const l of lines) {
                expect(new Decimal(l.debit).decimalPlaces()).toBeLessThanOrEqual(2);
                expect(new Decimal(l.credit).decimalPlaces()).toBeLessThanOrEqual(2);
            }
        }
    });

    it('R1: impuesto anual = max(30% de la utilidad, PMD)', async () => {
        prismaMock.retencionSufrida.aggregate.mockResolvedValue({ _sum: { amount: null } });
        prismaMock.obligationStatus.findMany.mockResolvedValue([]);
        prismaMock.taxConfig.findUnique.mockResolvedValue({ anticipoIrRate: '0.02' });
        // Ingresos 100,000; costo 60,000; gastos 10,000 → utilidad 30,000 → IR 9,000 > PMD 2,000.
        prismaMock.journalLine.findMany.mockResolvedValue([
            { debit: '0', credit: '100000', account: { type: 'REVENUE', code: '4.1.1' } },
            { debit: '60000', credit: '0', account: { type: 'EXPENSE', code: '5.1.1' } },
            { debit: '10000', credit: '0', account: { type: 'EXPENSE', code: '5.2.1' } },
        ]);
        const alto = await generateAnnualIR('t1', 2025);
        expect(alto.impuestoDelEjercicio).toBe(9000);
        // Pérdida → IR 0 → manda el PMD 2% de 100,000 = 2,000.
        prismaMock.journalLine.findMany.mockResolvedValue([
            { debit: '0', credit: '100000', account: { type: 'REVENUE', code: '4.1.1' } },
            { debit: '120000', credit: '0', account: { type: 'EXPENSE', code: '5.1.1' } },
        ]);
        const pmd = await generateAnnualIR('t1', 2025);
        expect(pmd.impuestoDelEjercicio).toBe(2000);
        expect(pmd.pagoMinimoDefinitivo).toBe(2000);
    });
});
