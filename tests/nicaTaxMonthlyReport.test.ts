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
        taxConfig: { findUnique: db.taxConfigFindUnique },
        retencionSufrida: { groupBy: db.retencionGroupBy },
        tenant: { findUnique: db.tenantFindUnique },
    },
}));

import { generateDMIReport, generateMonthlyReport } from '../backend/services/nicaTax';

const TENANT_ID = 'tenant-fiscal-a';

function resetDatabaseMocks() {
    for (const mock of Object.values(db)) mock.mockReset();
    db.taxConfigFindUnique.mockResolvedValue(null);
    db.retencionGroupBy.mockResolvedValue([]);
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
            // Otros tipos no reducen IR/IMI y un agregado nulo equivale a cero.
            { tipo: 'IR_10', _sum: { amount: '99' } },
            { tipo: 'OTRO', _sum: { amount: null } },
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
            totalPurchases: 500,
            // C$15 snapshot + C$30 del fallback estrictamente legacy.
            totalIVAPaid: 45,
            ivaNeto: 0,
            ivaCredito: 21.5217,
            anticipoIR: 4.1304,
            imiAlcaldia: 6.1957,
            retencionIMISufrida: 10,
            anticipoIRaPagar: 3.1304,
            imiAPagar: 0,
            saldoIRaFavor: 0,
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
                status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
                creditableTax: null,
            },
            _sum: { tax: true },
        });
        expect(db.retencionGroupBy).toHaveBeenCalledWith({
            by: ['tipo'],
            where: { tenantId: TENANT_ID, fecha: { gte: start, lt: end } },
            _sum: { amount: true },
        });
    });

    it('un período solo CUOTA_FIJA deja en cero IVA, Anticipo IR e IMI generales', async () => {
        db.saleGroupBy.mockResolvedValue([
            {
                fiscalRegimeAtSale: 'CUOTA_FIJA',
                _sum: { total: '500', exemptTotal: '0', vatAmountAtSale: '65.2174' },
            },
            // Defensa ante un agregado nulo inesperado: no inventa venta GENERAL.
            {
                fiscalRegimeAtSale: 'GENERAL',
                _sum: { total: null, exemptTotal: null, vatAmountAtSale: null },
            },
        ]);
        db.saleAggregate.mockResolvedValue({ _sum: { total: null, exemptTotal: null } });
        db.purchaseAggregate
            // creditableTax=0 es explícito; el IVA bruto de la compra no se usa.
            .mockResolvedValueOnce({ _sum: { total: '230', creditableTax: '0' } })
            .mockResolvedValueOnce({ _sum: { tax: null } });

        const report = await generateMonthlyReport(TENANT_ID, 4, 2026);

        expect(report).toMatchObject({
            totalSales: 500,
            ventasCuotaFija: 500,
            ventasExentas: 0,
            ventasGravadas: 0,
            salesNetasSinIVA: 0,
            totalIVACollected: 0,
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
                _sum: { total: '315', exemptTotal: '200', vatAmountAtSale: null },
            },
        ]);
        db.saleAggregate.mockResolvedValue({
            _sum: { total: '315', exemptTotal: '200' },
        });
        db.purchaseAggregate
            .mockResolvedValueOnce({ _sum: { total: '230', creditableTax: null } })
            .mockResolvedValueOnce({ _sum: { tax: '30' } });

        const report = await generateMonthlyReport(TENANT_ID, 5, 2026);

        expect(report).toMatchObject({
            totalSales: 315,
            ventasCuotaFija: 0,
            ventasExentas: 200,
            ventasGravadas: 115,
            salesNetasSinIVA: 300,
            totalIVACollected: 15,
            totalIVAPaid: 30,
            ivaNeto: 0,
            ivaCredito: 15,
            anticipoIR: 3,
            imiAlcaldia: 3,
            saldoIRaFavor: 0,
            totalToPay: 6,
        });
    });

    it('expone el saldo IR a favor cuando las retenciones superan el anticipo', async () => {
        db.saleGroupBy.mockResolvedValue([{
            fiscalRegimeAtSale: 'GENERAL',
            _sum: { total: '115', exemptTotal: '0', vatAmountAtSale: '15' },
        }]);
        db.saleAggregate.mockResolvedValue({ _sum: { total: null, exemptTotal: null } });
        db.purchaseAggregate
            .mockResolvedValueOnce({ _sum: { total: null, creditableTax: null } })
            .mockResolvedValueOnce({ _sum: { tax: null } });
        db.retencionGroupBy.mockResolvedValue([
            { tipo: 'IR_2', _sum: { amount: '2.50' } },
        ]);

        const report = await generateMonthlyReport(TENANT_ID, 5, 2026);

        expect(report).toMatchObject({
            anticipoIR: 1,
            retencionIRSufrida: 2.5,
            anticipoIRaPagar: 0,
            saldoIRaFavor: 1.5,
            imiAPagar: 1,
            totalToPay: 16,
        });
        expect(report.vetSummary).toContain('Saldo IR a favor:          C$ 1.50');
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
    });
});
