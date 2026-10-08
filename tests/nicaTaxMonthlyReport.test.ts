/**
 * Reporte fiscal mensual por régimen.
 *
 * Estas pruebas fijan tanto los números como la forma de consultar: ventas y
 * retenciones se agregan en MySQL, sin descargar filas de negocio en memoria.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    saleGroupBy: vi.fn(),
    saleAggregate: vi.fn(),
    purchaseAggregate: vi.fn(),
    supplierCreditNoteAggregate: vi.fn(),
    supplierCreditNoteFindMany: vi.fn(),
    taxConfigFindUnique: vi.fn(),
    retencionGroupBy: vi.fn(),
    tenantFindUnique: vi.fn(),
}));

vi.mock('../backend/lib/prisma', () => ({
    default: {
        sale: {
            groupBy: db.saleGroupBy,
            aggregate: db.saleAggregate,
        },
        purchase: { aggregate: db.purchaseAggregate },
        supplierCreditNote: {
            aggregate: db.supplierCreditNoteAggregate,
            findMany: db.supplierCreditNoteFindMany,
        },
        taxConfig: { findUnique: db.taxConfigFindUnique },
        retencionSufrida: { groupBy: db.retencionGroupBy },
        tenant: { findUnique: db.tenantFindUnique },
    },
}));

import {
    calculateMonthlyPurchaseTaxTotals,
    generateDMIReport,
    generateMonthlyReport,
    listSupplierCreditNotesForFiscalPeriod,
} from '../backend/services/nicaTax';

const TENANT_ID = 'tenant-fiscal-a';

function resetDatabaseMocks() {
    for (const mock of Object.values(db)) mock.mockReset();
    db.taxConfigFindUnique.mockResolvedValue(null);
    db.retencionGroupBy.mockResolvedValue([]);
    db.supplierCreditNoteAggregate.mockResolvedValue({
        _sum: { total: null, creditableTax: null },
    });
    db.supplierCreditNoteFindMany.mockResolvedValue([]);
    db.tenantFindUnique.mockResolvedValue({
        businessName: 'Negocio QA',
        taxId: 'J0310000000000',
        dgiAuthCode: 'AIMS-QA',
    });
}

describe('generateMonthlyReport — separación por régimen fiscal', () => {
    beforeEach(resetDatabaseMocks);

    it('mezcla GENERAL nuevo+legacy con CUOTA_FIJA sin gravar la cuota fija', async () => {
        db.saleGroupBy.mockResolvedValue([
            {
                fiscalRegimeAtSale: 'GENERAL',
                _sum: { total: '230', exemptTotal: '50', vatAmountAtSale: '8.4783' },
            },
            {
                fiscalRegimeAtSale: 'CUOTA_FIJA',
                // El IVA corrupto prueba que el reporte no confía en él para cuota fija.
                _sum: { total: '300', exemptTotal: '0', vatAmountAtSale: '999' },
            },
        ]);
        // De los C$230 GENERAL, C$115 son legacy y no tienen snapshot de IVA.
        db.saleAggregate.mockResolvedValue({
            _sum: { total: '115', exemptTotal: null },
        });
        db.purchaseAggregate
            .mockResolvedValueOnce({ _sum: { total: '500', creditableTax: '15' } })
            .mockResolvedValueOnce({ _sum: { tax: '30' } });
        db.taxConfigFindUnique.mockResolvedValue({
            anticipoIrRate: '0.0200',
            imiRate: '0.0300',
        });
        db.retencionGroupBy.mockResolvedValue([
            { tipo: 'IR_2', _sum: { amount: '1' } },
            { tipo: 'IMI_1', _sum: { amount: '10' } },
        ]);

        const report = await generateMonthlyReport(TENANT_ID, 3, 2026);

        expect(report).toMatchObject({
            totalSales: 530,
            ventasCuotaFija: 300,
            ventasExentas: 50,
            ventasGravadas: 180,
            // Snapshot: 115 - 8.4783; legacy: 115 / 1.15 = 100.
            salesNetasSinIVA: 206.5217,
            totalIVACollected: 23.4783,
            purchaseTotal: 500,
            purchaseCreditableTax: 45,
            supplierCreditNoteTotal: 0,
            supplierCreditTaxReversal: 0,
            totalPurchases: 500,
            // C$15 snapshot + C$30 del fallback estrictamente legacy.
            totalIVAPaid: 45,
            ivaNeto: 0,
            ivaCredito: 21.5217,
            anticipoIR: 4.1304,
            imiAlcaldia: 6.1957,
            anticipoIRaPagar: 3.1304,
            imiAPagar: 0,
            totalToPay: 3.1304,
        });
        expect(report.vetSummary).toContain('Ventas de Cuota Fija:           C$ 300.00');
        expect(report.vetSummary).toContain('Cuota Fija no alimenta IVA, Anticipo IR ni IMI');

        const start = new Date('2026-03-01T06:00:00.000Z');
        const end = new Date('2026-04-01T06:00:00.000Z');
        expect(db.saleGroupBy).toHaveBeenCalledWith({
            by: ['fiscalRegimeAtSale'],
            where: {
                tenantId: TENANT_ID,
                createdAt: { gte: start, lt: end },
                status: { not: 'VOIDED' },
            },
            _sum: { total: true, exemptTotal: true, vatAmountAtSale: true },
        });
        expect(db.saleAggregate).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                createdAt: { gte: start, lt: end },
                status: { not: 'VOIDED' },
                fiscalRegimeAtSale: { not: 'CUOTA_FIJA' },
                vatAmountAtSale: null,
            },
            _sum: { total: true, exemptTotal: true },
        });
        expect(db.purchaseAggregate).toHaveBeenNthCalledWith(2, {
            where: {
                tenantId: TENANT_ID,
                date: { gte: start, lt: end },
                documentStatus: 'POSTED',
                status: { in: ['COMPLETED', 'PENDING_PAYMENT', 'PARTIALLY_PAID'] },
                creditableTax: null,
            },
            _sum: { tax: true },
        });
        expect(db.retencionGroupBy).toHaveBeenCalledWith({
            by: ['tipo'],
            where: { tenantId: TENANT_ID, fecha: { gte: start, lt: end } },
            _sum: { amount: true },
        });
        expect(db.supplierCreditNoteAggregate).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                status: 'POSTED',
                type: 'RETURN',
                devolutionDate: { gte: start, lt: end },
            },
            _sum: { total: true, creditableTax: true },
        });
    });

    it('un período solo CUOTA_FIJA deja en cero IVA, Anticipo IR e IMI generales', async () => {
        db.saleGroupBy.mockResolvedValue([
            {
                fiscalRegimeAtSale: 'CUOTA_FIJA',
                _sum: { total: '500', exemptTotal: '0', vatAmountAtSale: '65.2174' },
            },
        ]);
        db.saleAggregate.mockResolvedValue({ _sum: { total: null, exemptTotal: null } });
        db.purchaseAggregate
            // creditableTax=0 es explícito; el IVA bruto de la compra no se usa.
            .mockResolvedValueOnce({ _sum: { total: '230', creditableTax: '0' } })
            .mockResolvedValueOnce({ _sum: { tax: null } });
        db.supplierCreditNoteAggregate.mockResolvedValue({
            // La reversa de cuota fija reduce compras, pero nunca inventa IVA.
            _sum: { total: '50', creditableTax: '0' },
        });

        const report = await generateMonthlyReport(TENANT_ID, 4, 2026);

        expect(report).toMatchObject({
            totalSales: 500,
            ventasCuotaFija: 500,
            ventasExentas: 0,
            ventasGravadas: 0,
            salesNetasSinIVA: 0,
            totalIVACollected: 0,
            purchaseTotal: 230,
            purchaseCreditableTax: 0,
            supplierCreditNoteTotal: 50,
            supplierCreditTaxReversal: 0,
            totalPurchases: 180,
            totalIVAPaid: 0,
            ivaNeto: 0,
            ivaCredito: 0,
            anticipoIR: 0,
            imiAlcaldia: 0,
            totalToPay: 0,
        });
        expect(report.vetSummary).toContain('exclusivamente por ventas de Cuota Fija');
        expect(report.vetSummary).not.toContain('Presentar en VET (');
    });

    it('preserva ventas y compras legacy usando fallback solo cuando el snapshot es null', async () => {
        db.saleGroupBy.mockResolvedValue([
            {
                fiscalRegimeAtSale: 'GENERAL',
                _sum: { total: '115', exemptTotal: null, vatAmountAtSale: null },
            },
        ]);
        db.saleAggregate.mockResolvedValue({
            _sum: { total: '115', exemptTotal: null },
        });
        db.purchaseAggregate
            .mockResolvedValueOnce({ _sum: { total: '230', creditableTax: null } })
            .mockResolvedValueOnce({ _sum: { tax: '30' } });
        db.supplierCreditNoteAggregate.mockResolvedValue({
            _sum: { total: '23', creditableTax: '3' },
        });

        const report = await generateMonthlyReport(TENANT_ID, 5, 2026);

        expect(report).toMatchObject({
            totalSales: 115,
            ventasCuotaFija: 0,
            ventasGravadas: 115,
            salesNetasSinIVA: 100,
            totalIVACollected: 15,
            purchaseTotal: 230,
            purchaseCreditableTax: 30,
            supplierCreditNoteTotal: 23,
            supplierCreditTaxReversal: 3,
            totalPurchases: 207,
            totalIVAPaid: 27,
            ivaNeto: 0,
            ivaCredito: 12,
            anticipoIR: 1,
            imiAlcaldia: 1,
            totalToPay: 2,
        });
    });

    it('resta en el mes de devolución una NC de una compra de otro período', async () => {
        db.saleGroupBy.mockResolvedValue([{
            fiscalRegimeAtSale: 'GENERAL',
            _sum: { total: '115', exemptTotal: '0', vatAmountAtSale: '15' },
        }]);
        db.saleAggregate.mockResolvedValue({ _sum: { total: null, exemptTotal: null } });
        db.purchaseAggregate
            // No hay compras en julio: la NC corresponde a una factura previa.
            .mockResolvedValueOnce({ _sum: { total: null, creditableTax: null } })
            .mockResolvedValueOnce({ _sum: { tax: null } });
        db.supplierCreditNoteAggregate.mockResolvedValue({
            _sum: { total: '150', creditableTax: '20' },
        });

        const report = await generateMonthlyReport(TENANT_ID, 7, 2026);

        expect(report).toMatchObject({
            purchaseTotal: 0,
            purchaseCreditableTax: 0,
            supplierCreditNoteTotal: 150,
            supplierCreditTaxReversal: 20,
            totalPurchases: -150,
            totalIVAPaid: -20,
            totalIVACollected: 15,
            ivaNeto: 35,
            ivaCredito: 0,
        });
        expect(report.vetSummary).toContain('Compras Brutas (con IVA):  C$ 0.00');
        expect(report.vetSummary).toContain('(−) Notas de crédito prov.: C$ 150.00');
        expect(report.vetSummary).toContain('= Compras Netas Fiscales:   C$ -150.00');
        expect(report.vetSummary).toContain('= IVA Crédito Neto:         C$ -20.00');

        const { start, end } = {
            start: new Date('2026-07-01T06:00:00.000Z'),
            end: new Date('2026-08-01T06:00:00.000Z'),
        };
        expect(db.supplierCreditNoteAggregate).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                status: 'POSTED',
                type: 'RETURN',
                devolutionDate: { gte: start, lt: end },
            },
            _sum: { total: true, creditableTax: true },
        });
    });

    it('calcula netos fiscales como strings Decimal sin clamp', () => {
        expect(calculateMonthlyPurchaseTaxTotals({
            purchaseTotal: '0.1000',
            purchaseCreditableTax: '0.0200',
            supplierCreditNoteTotal: '0.3000',
            supplierCreditTaxReversal: '0.0500',
        })).toEqual({
            purchaseTotal: '0.1000',
            purchaseCreditableTax: '0.0200',
            supplierCreditNoteTotal: '0.3000',
            supplierCreditTaxReversal: '0.0500',
            totalPurchases: '-0.2000',
            totalIVAPaid: '-0.0300',
        });
    });
});

describe('listSupplierCreditNotesForFiscalPeriod', () => {
    beforeEach(resetDatabaseMocks);

    it('pagina NC POSTED por devolutionDate y serializa todos los montos Decimal', async () => {
        const first = {
            id: 'credit-note-1',
            supplierId: 'supplier-a',
            supplier: { id: 'supplier-a', name: 'Proveedor A', ruc: 'J0001' },
            creditNoteNumber: 'NC-1',
            creditNoteDate: new Date('2026-07-15T12:00:00.000Z'),
            devolutionDate: new Date('2026-07-14T12:00:00.000Z'),
            postingDate: new Date('2026-07-15T12:00:00.000Z'),
            fiscalRegimeAtCredit: 'GENERAL',
            subtotal: '10',
            tax: '1.5',
            creditableTax: '1.5',
            total: '11.5',
        };
        const second = {
            ...first,
            id: 'credit-note-2',
            creditNoteNumber: 'NC-2',
            subtotal: '20.1234',
            tax: '3.0185',
            creditableTax: '3.0185',
            total: '23.1419',
        };
        db.supplierCreditNoteFindMany
            .mockResolvedValueOnce([first, second])
            .mockResolvedValueOnce([second]);

        const rows = await listSupplierCreditNotesForFiscalPeriod(
            TENANT_ID,
            7,
            2026,
            { pageSize: 1 },
        );

        expect(rows).toEqual([
            expect.objectContaining({
                id: 'credit-note-1',
                supplier: { id: 'supplier-a', name: 'Proveedor A', ruc: 'J0001' },
                creditNoteNumber: 'NC-1',
                fiscalRegimeAtCredit: 'GENERAL',
                subtotal: '10.0000',
                tax: '1.5000',
                creditableTax: '1.5000',
                total: '11.5000',
            }),
            expect.objectContaining({
                id: 'credit-note-2',
                subtotal: '20.1234',
                tax: '3.0185',
                creditableTax: '3.0185',
                total: '23.1419',
            }),
        ]);
        const start = new Date('2026-07-01T06:00:00.000Z');
        const end = new Date('2026-08-01T06:00:00.000Z');
        expect(db.supplierCreditNoteFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: {
                tenantId: TENANT_ID,
                status: 'POSTED',
                type: 'RETURN',
                devolutionDate: { gte: start, lt: end },
            },
            orderBy: [{ devolutionDate: 'asc' }, { id: 'asc' }],
            take: 2,
        }));
        expect(db.supplierCreditNoteFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            cursor: { id: 'credit-note-1' },
            skip: 1,
            take: 2,
        }));
    });
});

describe('generateDMIReport — alcance del régimen general', () => {
    beforeEach(resetDatabaseMocks);

    it('excluye facturas de CUOTA_FIJA del rango DMI y las muestra por separado', async () => {
        db.saleAggregate
            .mockResolvedValueOnce({
                _min: { invoiceNumber: 10 },
                _max: { invoiceNumber: 12 },
                _count: 3,
            })
            .mockResolvedValueOnce({ _sum: { total: null, exemptTotal: null } });
        db.saleGroupBy.mockResolvedValue([
            {
                fiscalRegimeAtSale: 'CUOTA_FIJA',
                _sum: { total: '400', exemptTotal: '0', vatAmountAtSale: '0' },
            },
        ]);
        db.purchaseAggregate
            .mockResolvedValueOnce({ _sum: { total: null, creditableTax: null } })
            .mockResolvedValueOnce({ _sum: { tax: null } });
        db.taxConfigFindUnique.mockResolvedValue({
            anticipoIrRate: '0.0200',
            imiRate: '0.0300',
        });

        const report = await generateDMIReport(TENANT_ID, 6, 2026);

        expect(db.saleAggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                fiscalRegimeAtSale: { not: 'CUOTA_FIJA' },
            }),
        }));
        expect(report.totalInvoices).toBe(3);
        expect(report.dmiReport).toContain('Facturas de Régimen General: 3');
        expect(report.dmiReport).toContain('Total Régimen General:        C$ 0.00');
        expect(report.dmiReport).toContain('Ventas Cuota Fija (fuera de DMI): C$ 400.00');
        expect(report.dmiReport).toContain('Compras Brutas (con IVA):    C$ 0.00');
        expect(report.dmiReport).toContain('(−) Notas crédito proveedor: C$ 0.00');
        expect(report.dmiReport).toContain('IVA Crédito Fiscal Neto:     C$ 0.00');
        expect(report.dmiReport).toContain('Anticipo IR (2.00%)');
        expect(report.dmiReport).toContain('IMI Alcaldía (3.00%)');
        expect(report.dmiReport).not.toContain('Anticipo IR (1%)');
    });
});
