/**
 * NORTEX - Motor Fiscal Nicaragüense
 * Ley de Concertación Tributaria (LCT 822)
 * 
 * Impuestos calculados:
 * - IVA Neto (15%): IVA Ventas - IVA Compras (crédito fiscal)
 * - Anticipo IR (1%): Sobre ingresos brutos mensuales
 * - IMI Alcaldía (1%): Impuesto Municipal sobre Ingresos
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IVA_RATE = 0.15;
const ANTICIPO_IR_RATE = 0.01;  // 1% anticipo mensual
const IMI_RATE = 0.01;          // 1% impuesto municipal (Alcaldía)

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

/**
 * Genera el reporte fiscal mensual para un tenant.
 * Calcula IVA, Anticipo IR y Cuota Alcaldía según LCT 822.
 */
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
            date: { gte: startDate, lte: endDate },
        },
        _sum: { total: true },
        _count: true,
    });
    
    const totalSalesRaw = Number(salesResult._sum.total || 0);
    
    // Separar IVA de las ventas (total incluye IVA)
    const salesNetasSinIVA = Math.round((totalSalesRaw / (1 + IVA_RATE)) * 100) / 100;
    const totalIVACollected = Math.round((totalSalesRaw - salesNetasSinIVA) * 100) / 100;

    // 2. Obtener compras del mes (IVA pagado = crédito fiscal)
    const purchasesResult = await prisma.purchase.aggregate({
        where: {
            tenantId,
            date: { gte: startDate, lte: endDate },
            status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
        },
        _sum: { total: true, tax: true },
    });

    const totalPurchases = Number(purchasesResult._sum.total || 0);
    const totalIVAPaid = Number(purchasesResult._sum.tax || 0);

    // 3. Calcular IVA Neto
    const ivaRaw = totalIVACollected - totalIVAPaid;
    const ivaNeto = Math.max(0, Math.round(ivaRaw * 100) / 100);
    const ivaCredito = ivaRaw < 0 ? Math.round(Math.abs(ivaRaw) * 100) / 100 : 0;

    // 4. Anticipo IR (1% sobre ventas netas sin IVA)
    const anticipoIR = Math.round(salesNetasSinIVA * ANTICIPO_IR_RATE * 100) / 100;

    // 5. IMI Alcaldía (1% sobre ventas netas sin IVA)
    const imiAlcaldia = Math.round(salesNetasSinIVA * IMI_RATE * 100) / 100;

    // 6. Total a pagar
    const totalToPay = Math.round((ivaNeto + anticipoIR + imiAlcaldia) * 100) / 100;

    // 7. Generar resumen para VET
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
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
   IVA Neto (Ventas - Compras): C$ ${ivaNeto.toFixed(2)}${ivaCredito > 0 ? `\n   ⚠️ Crédito Fiscal a Favor: C$ ${ivaCredito.toFixed(2)}` : ''}
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
        totalSales: totalSalesRaw,
        salesNetasSinIVA,
        totalIVACollected,
        totalPurchases,
        totalIVAPaid,
        ivaNeto,
        ivaCredito,
        anticipoIR,
        imiAlcaldia,
        totalToPay,
        vetSummary,
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
