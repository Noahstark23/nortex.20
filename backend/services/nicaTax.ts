/**
 * NORTEX - Motor Fiscal Nicaragüense
 * Ley de Concertación Tributaria (LCT 822)
 *
 * Impuestos calculados:
 * - IVA Neto (15%): IVA Ventas - IVA Compras (crédito fiscal)
 * - Anticipo IR (1%): Sobre ingresos brutos mensuales
 * - IMI Alcaldía (1%): Impuesto Municipal sobre Ingresos
 *
 * Precisión: Decimal.js con ROUND_HALF_UP (norma DGI Nicaragua)
 */

import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();

const IVA_RATE = new Decimal('0.15');
const ANTICIPO_IR_RATE = new Decimal('0.01');  // 1% anticipo mensual
const IMI_RATE = new Decimal('0.01');           // 1% impuesto municipal (Alcaldía)

export interface MonthlyTaxReport {
    month: number;
    year: number;

    // Ventas
    totalSales: number;           // Ventas brutas (con IVA)
    salesNetasSinIVA: number;     // Ventas sin IVA
    totalIVACollected: number;    // IVA cobrado en ventas

    // Compras
    totalPurchases: number;       // Compras brutas (con IVA)
    totalIVAPaid: number;         // IVA pagado en compras (crédito fiscal)

    // Impuestos a pagar
    ivaNeto: number;              // IVA Ventas - IVA Compras (min 0)
    ivaCredito: number;           // Crédito fiscal a favor (si IVA Compras > IVA Ventas)
    anticipoIR: number;           // 1% sobre ventas netas
    imiAlcaldia: number;          // 1% sobre ventas netas (Alcaldía)
    totalToPay: number;           // Total a pagar al fisco

    // Desglose para VET (Ventanilla Electrónica Tributaria)
    vetSummary: string;
}

export async function generateMonthlyReport(
    tenantId: string,
    month: number,
    year: number
): Promise<MonthlyTaxReport> {
    // Rango de fechas del mes
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // 1. Obtener ventas del mes
    const salesResult = await prisma.sale.aggregate({
        where: {
            tenantId,
            createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { total: true },
        _count: true,
    });

    const totalSalesRaw = new Decimal(salesResult._sum.total?.toString() ?? '0');

    // Separar IVA de las ventas: total incluye IVA → neto = total / (1 + 0.15)
    const salesNetasSinIVA = totalSalesRaw.dividedBy(IVA_RATE.plus(1)).toDecimalPlaces(4);
    const totalIVACollected = totalSalesRaw.minus(salesNetasSinIVA).toDecimalPlaces(4);

    // 2. Obtener compras del mes (IVA pagado = crédito fiscal)
    const purchasesResult = await prisma.purchase.aggregate({
        where: {
            tenantId,
            date: { gte: startDate, lte: endDate },
            status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
        },
        _sum: { total: true, tax: true },
    });

    const totalPurchases = new Decimal(purchasesResult._sum.total?.toString() ?? '0');
    const totalIVAPaid = new Decimal(purchasesResult._sum.tax?.toString() ?? '0');

    // 3. Calcular IVA Neto
    const ivaRaw = totalIVACollected.minus(totalIVAPaid);
    const ivaNeto = Decimal.max(0, ivaRaw).toDecimalPlaces(4);
    const ivaCredito = ivaRaw.lessThan(0) ? ivaRaw.abs().toDecimalPlaces(4) : new Decimal(0);

    // 4. Anticipo IR (1% sobre ventas netas sin IVA)
    const anticipoIR = salesNetasSinIVA.mul(ANTICIPO_IR_RATE).toDecimalPlaces(4);

    // 5. IMI Alcaldía (1% sobre ventas netas sin IVA)
    const imiAlcaldia = salesNetasSinIVA.mul(IMI_RATE).toDecimalPlaces(4);

    // 6. Total a pagar
    const totalToPay = ivaNeto.plus(anticipoIR).plus(imiAlcaldia).toDecimalPlaces(4);

    // 7. Generar resumen para VET
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const vetSummary = `
=== DECLARACIÓN MENSUAL ${monthNames[month - 1].toUpperCase()} ${year} ===
Preparado por: NORTEX ERP

📊 VENTAS DEL PERÍODO
   Ventas Brutas (con IVA): C$ ${totalSalesRaw.toFixed(2)}
   Ventas Netas (sin IVA):  C$ ${salesNetasSinIVA.toFixed(2)}
   IVA Cobrado (15%):       C$ ${totalIVACollected.toFixed(2)}

🛒 COMPRAS DEL PERÍODO
   Compras Brutas (con IVA): C$ ${totalPurchases.toFixed(2)}
   IVA Pagado (Crédito):     C$ ${totalIVAPaid.toFixed(2)}

💰 IMPUESTOS A PAGAR
   IVA Neto (Ventas - Compras): C$ ${ivaNeto.toFixed(2)}${ivaCredito.greaterThan(0) ? `\n   ⚠️ Crédito Fiscal a Favor: C$ ${ivaCredito.toFixed(2)}` : ''}
   Anticipo IR (1%):            C$ ${anticipoIR.toFixed(2)}
   IMI Alcaldía (1%):           C$ ${imiAlcaldia.toFixed(2)}
   ────────────────────────────────
   TOTAL A PAGAR:               C$ ${totalToPay.toFixed(2)}

📋 Presentar en VET (ventanilla.dgi.gob.ni)
   antes del 15 de ${monthNames[month] || monthNames[0]} ${month === 12 ? year + 1 : year}
`.trim();

    return {
        month,
        year,
        totalSales: totalSalesRaw.toNumber(),
        salesNetasSinIVA: salesNetasSinIVA.toNumber(),
        totalIVACollected: totalIVACollected.toNumber(),
        totalPurchases: totalPurchases.toNumber(),
        totalIVAPaid: totalIVAPaid.toNumber(),
        ivaNeto: ivaNeto.toNumber(),
        ivaCredito: ivaCredito.toNumber(),
        anticipoIR: anticipoIR.toNumber(),
        imiAlcaldia: imiAlcaldia.toNumber(),
        totalToPay: totalToPay.toNumber(),
        vetSummary,
    };
}

/**
 * Genera el reporte DMI-V2.1 con rangos de facturas para la DGI
 */
export async function generateDMIReport(tenantId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Obtener rango de facturas emitidas en el período
    const invoiceRange = await prisma.sale.aggregate({
        where: {
            tenantId,
            createdAt: { gte: startDate, lte: endDate },
            invoiceNumber: { not: null },
        },
        _min: { invoiceNumber: true },
        _max: { invoiceNumber: true },
        _count: true,
    });

    // Obtener tenant info
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { businessName: true, taxId: true, dgiAuthCode: true },
    });

    // Generar reporte fiscal base
    const taxReport = await generateMonthlyReport(tenantId, month, year);

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const pad = (n: number | null, len = 6) => n ? String(n).padStart(len, '0') : '------';

    const dmiReport = `
══════════════════════════════════════════════
   DECLARACIÓN MENSUAL DE IMPUESTOS - DMI V2.1
══════════════════════════════════════════════
Contribuyente: ${tenant?.businessName || 'N/A'}
RUC: ${tenant?.taxId || 'N/A'}
Aut. DGI: ${tenant?.dgiAuthCode || 'Pendiente'}
Período: ${monthNames[month - 1].toUpperCase()} ${year}
══════════════════════════════════════════════

🧾 RANGO DE FACTURAS UTILIZADAS
   Serie A: ${pad(invoiceRange._min.invoiceNumber)} — ${pad(invoiceRange._max.invoiceNumber)}
   Total Facturas Emitidas: ${invoiceRange._count}

📊 RESUMEN DE VENTAS
   Ventas Gravadas (sin IVA):  C$ ${taxReport.salesNetasSinIVA.toFixed(2)}
   IVA 15%:                     C$ ${taxReport.totalIVACollected.toFixed(2)}
   Ventas Exentas:              C$ 0.00
   Total Ventas (con IVA):      C$ ${taxReport.totalSales.toFixed(2)}

🛒 COMPRAS Y CRÉDITO FISCAL
   Compras (con IVA):           C$ ${taxReport.totalPurchases.toFixed(2)}
   IVA Crédito Fiscal:          C$ ${taxReport.totalIVAPaid.toFixed(2)}

💰 IMPUESTOS A PAGAR
   IVA Neto:                    C$ ${taxReport.ivaNeto.toFixed(2)}${taxReport.ivaCredito > 0 ? `\n   Crédito a Favor:              C$ ${taxReport.ivaCredito.toFixed(2)}` : ''}
   Anticipo IR (1%):             C$ ${taxReport.anticipoIR.toFixed(2)}
   IMI Alcaldía (1%):            C$ ${taxReport.imiAlcaldia.toFixed(2)}
   ──────────────────────────────────────
   TOTAL A PAGAR:                C$ ${taxReport.totalToPay.toFixed(2)}

══════════════════════════════════════════════
   Generado por: NORTEX ERP - Motor Fiscal
   Sistema autorizado de Facturación Computarizada
══════════════════════════════════════════════
`.trim();

    return {
        ...taxReport,
        invoiceRangeStart: invoiceRange._min.invoiceNumber,
        invoiceRangeEnd: invoiceRange._max.invoiceNumber,
        totalInvoices: invoiceRange._count,
        dmiReport,
        tenantName: tenant?.businessName,
        tenantRuc: tenant?.taxId,
    };
}

/**
 * Guarda o actualiza el reporte fiscal en la base de datos.
 */
export async function saveMonthlyReport(tenantId: string, report: MonthlyTaxReport) {
    return prisma.taxReport.upsert({
        where: {
            tenantId_month_year: {
                tenantId,
                month: report.month,
                year: report.year,
            },
        },
        update: {
            totalSales: report.totalSales,
            totalIVACollected: report.totalIVACollected,
            totalIVAPaid: report.totalIVAPaid,
            ivaNeto: report.ivaNeto,
            anticipoIR: report.anticipoIR,
            imiAlcaldia: report.imiAlcaldia,
            totalToPay: report.totalToPay,
        },
        create: {
            tenantId,
            month: report.month,
            year: report.year,
            totalSales: report.totalSales,
            totalIVACollected: report.totalIVACollected,
            totalIVAPaid: report.totalIVAPaid,
            ivaNeto: report.ivaNeto,
            anticipoIR: report.anticipoIR,
            imiAlcaldia: report.imiAlcaldia,
            totalToPay: report.totalToPay,
        },
    });
}
