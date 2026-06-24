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
    anticipoIR: number;           // tasa * ventas netas (bruto del período)
    imiAlcaldia: number;          // tasa * ventas netas (Alcaldía)

    // B1 — Retenciones SUFRIDAS (crédito que reduce lo que se paga)
    retencionIRSufrida: number;   // IR 2% que clientes le retuvieron al negocio
    retencionIMISufrida: number;  // IMI 1% retenido
    anticipoIRaPagar: number;     // max(0, anticipoIR - retencionIRSufrida)
    imiAPagar: number;            // max(0, imiAlcaldia - retencionIMISufrida)
    saldoIRaFavor: number;        // exceso de retenciones IR sobre el anticipo

    totalToPay: number;           // Total a pagar al fisco (neto de retenciones)

    // Tasas efectivas usadas (de TaxConfig)
    anticipoIrRate: number;
    imiRate: number;

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

    // B4 — Tasas desde TaxConfig del tenant (fallback a las constantes legales).
    const cfg = await prisma.taxConfig.findUnique({ where: { tenantId } });
    const anticipoRate = cfg ? new Decimal(cfg.anticipoIrRate.toString()) : ANTICIPO_IR_RATE;
    const imiRateCfg = cfg ? new Decimal(cfg.imiRate.toString()) : IMI_RATE;

    // 4. Anticipo IR (tasa * ventas netas sin IVA)
    const anticipoIR = salesNetasSinIVA.mul(anticipoRate).toDecimalPlaces(4);

    // 5. IMI Alcaldía (tasa * ventas netas sin IVA)
    const imiAlcaldia = salesNetasSinIVA.mul(imiRateCfg).toDecimalPlaces(4);

    // B1 — Retenciones SUFRIDAS del mes (crédito contra anticipo IR / IMI).
    const retenciones = await prisma.retencionSufrida.findMany({
        where: { tenantId, fecha: { gte: startDate, lte: endDate } },
        select: { tipo: true, amount: true },
    });
    let retIR = new Decimal(0);
    let retIMI = new Decimal(0);
    for (const r of retenciones) {
        if (r.tipo === 'IR_2') retIR = retIR.plus(r.amount.toString());
        else if (r.tipo === 'IMI_1') retIMI = retIMI.plus(r.amount.toString());
    }
    retIR = retIR.toDecimalPlaces(4);
    retIMI = retIMI.toDecimalPlaces(4);

    const anticipoIRaPagar = Decimal.max(0, anticipoIR.minus(retIR)).toDecimalPlaces(4);
    const saldoIRaFavor = Decimal.max(0, retIR.minus(anticipoIR)).toDecimalPlaces(4);
    const imiAPagar = Decimal.max(0, imiAlcaldia.minus(retIMI)).toDecimalPlaces(4);

    // 6. Total a pagar (IVA neto + anticipo NETO de retenciones + IMI neto)
    const totalToPay = ivaNeto.plus(anticipoIRaPagar).plus(imiAPagar).toDecimalPlaces(4);

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
   Anticipo IR (${anticipoRate.mul(100).toFixed(2)}%):          C$ ${anticipoIR.toFixed(2)}${retIR.greaterThan(0) ? `\n   (−) Retenciones IR sufridas:  C$ ${retIR.toFixed(2)}\n   = Anticipo IR a pagar:        C$ ${anticipoIRaPagar.toFixed(2)}${saldoIRaFavor.greaterThan(0) ? `\n   ⚠️ Saldo IR a favor:          C$ ${saldoIRaFavor.toFixed(2)}` : ''}` : ''}
   IMI Alcaldía (${imiRateCfg.mul(100).toFixed(2)}%):         C$ ${imiAlcaldia.toFixed(2)}${retIMI.greaterThan(0) ? `\n   (−) Retenciones IMI sufridas: C$ ${retIMI.toFixed(2)}\n   = IMI a pagar:                C$ ${imiAPagar.toFixed(2)}` : ''}
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
        retencionIRSufrida: retIR.toNumber(),
        retencionIMISufrida: retIMI.toNumber(),
        anticipoIRaPagar: anticipoIRaPagar.toNumber(),
        imiAPagar: imiAPagar.toNumber(),
        saldoIRaFavor: saldoIRaFavor.toNumber(),
        totalToPay: totalToPay.toNumber(),
        anticipoIrRate: anticipoRate.toNumber(),
        imiRate: imiRateCfg.toNumber(),
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

// ══════════════════════════════════════════════════════════════════════════
// B3 — Declaración ANUAL de IR (IR 30% sociedades vs Pago Mínimo Definitivo)
// ══════════════════════════════════════════════════════════════════════════
const IR_SOCIEDADES_RATE = new Decimal('0.30'); // IR sobre la renta neta

export interface AnnualIRReport {
    year: number;
    ingresosNetos: number;      // Ventas netas (sin IVA, neto de devoluciones)
    costoVentas: number;
    gastos: number;             // Operativos + nómina + depreciación, etc.
    utilidadFiscal: number;     // ingresos - costos - gastos
    irSobreRenta: number;       // 30% de la utilidad
    pmdRate: number;            // tasa PMD del tenant (1-3%)
    pagoMinimoDefinitivo: number; // pmdRate * ingresos
    impuestoDelEjercicio: number; // max(IR30, PMD)
    anticiposEnterados: number; // anticipos IR pagados en cash durante el año
    retencionesSufridasIR: number; // IR 2% retenido por terceros
    creditosTotales: number;    // anticipos + retenciones
    saldoAPagar: number;
    saldoAFavor: number;
    resumen: string;
}

export async function generateAnnualIR(tenantId: string, year: number): Promise<AnnualIRReport> {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);

    // Agregación del ejercicio desde el libro (mismo criterio que el Estado de
    // Resultados): ingresos, costo de ventas (5.1.1) y gastos (resto de 5.x).
    const lines = await prisma.journalLine.findMany({
        where: { entry: { tenantId, date: { gte: start, lte: end } } },
        include: { account: { select: { type: true, code: true } } },
    });

    let revenue = new Decimal(0), cogs = new Decimal(0), gastos = new Decimal(0);
    for (const l of lines) {
        const debit = new Decimal(l.debit.toString());
        const credit = new Decimal(l.credit.toString());
        if (l.account.type === 'REVENUE') {
            revenue = revenue.plus(credit.minus(debit)); // devoluciones (debit) restan
        } else if (l.account.type === 'EXPENSE') {
            const monto = debit.minus(credit);
            if (l.account.code === '5.1.1') cogs = cogs.plus(monto);
            else gastos = gastos.plus(monto);
        }
    }
    revenue = revenue.toDecimalPlaces(2);
    cogs = cogs.toDecimalPlaces(2);
    gastos = gastos.toDecimalPlaces(2);

    const utilidad = revenue.minus(cogs).minus(gastos).toDecimalPlaces(2);
    const irRenta = Decimal.max(0, utilidad).mul(IR_SOCIEDADES_RATE).toDecimalPlaces(2);

    const cfg = await prisma.taxConfig.findUnique({ where: { tenantId } });
    const pmdRate = cfg ? new Decimal(cfg.anticipoIrRate.toString()) : ANTICIPO_IR_RATE;
    const pmd = revenue.mul(pmdRate).toDecimalPlaces(2);

    const impuestoEjercicio = Decimal.max(irRenta, pmd).toDecimalPlaces(2);

    // Retenciones IR sufridas del año (crédito) + anticipos enterados en cash.
    const retAgg = await prisma.retencionSufrida.aggregate({
        where: { tenantId, tipo: 'IR_2', fecha: { gte: start, lte: end } },
        _sum: { amount: true },
    });
    const retencionesIR = new Decimal(retAgg._sum.amount?.toString() ?? '0').toDecimalPlaces(2);
    // Anticipos mensuales pagados en efectivo = PMD del año neto de retenciones.
    const anticiposEnterados = Decimal.max(0, pmd.minus(retencionesIR)).toDecimalPlaces(2);
    const creditos = anticiposEnterados.plus(retencionesIR).toDecimalPlaces(2);

    const saldoAPagar = Decimal.max(0, impuestoEjercicio.minus(creditos)).toDecimalPlaces(2);
    const saldoAFavor = Decimal.max(0, creditos.minus(impuestoEjercicio)).toDecimalPlaces(2);

    const mayor = irRenta.greaterThanOrEqualTo(pmd) ? 'IR sobre renta (30%)' : 'Pago Mínimo Definitivo';
    const resumen = `
=== DECLARACIÓN ANUAL DE IR ${year} ===
Preparado por: NORTEX ERP

📊 RESULTADO DEL EJERCICIO
   Ingresos netos (sin IVA):  C$ ${revenue.toFixed(2)}
   (−) Costo de ventas:       C$ ${cogs.toFixed(2)}
   (−) Gastos del período:    C$ ${gastos.toFixed(2)}
   = Utilidad fiscal:         C$ ${utilidad.toFixed(2)}

💰 CÁLCULO DEL IMPUESTO (se paga el MAYOR)
   IR sobre renta (30%):      C$ ${irRenta.toFixed(2)}
   Pago Mínimo Def. (${pmdRate.mul(100).toFixed(2)}%):    C$ ${pmd.toFixed(2)}
   → Impuesto del ejercicio:  C$ ${impuestoEjercicio.toFixed(2)}  (${mayor})

🧾 CRÉDITOS DEL AÑO
   Anticipos IR enterados:    C$ ${anticiposEnterados.toFixed(2)}
   Retenciones IR sufridas:   C$ ${retencionesIR.toFixed(2)}
   = Créditos totales:        C$ ${creditos.toFixed(2)}
   ────────────────────────────────
   ${saldoAPagar.greaterThan(0) ? `SALDO A PAGAR:             C$ ${saldoAPagar.toFixed(2)}` : `SALDO A FAVOR:             C$ ${saldoAFavor.toFixed(2)}`}

📋 Declaración anual de IR (IR-1) — vence el 31 de marzo de ${year + 1}.
   Revisar con el contador antes de presentar en la VET.
`.trim();

    return {
        year,
        ingresosNetos: revenue.toNumber(),
        costoVentas: cogs.toNumber(),
        gastos: gastos.toNumber(),
        utilidadFiscal: utilidad.toNumber(),
        irSobreRenta: irRenta.toNumber(),
        pmdRate: pmdRate.toNumber(),
        pagoMinimoDefinitivo: pmd.toNumber(),
        impuestoDelEjercicio: impuestoEjercicio.toNumber(),
        anticiposEnterados: anticiposEnterados.toNumber(),
        retencionesSufridasIR: retencionesIR.toNumber(),
        creditosTotales: creditos.toNumber(),
        saldoAPagar: saldoAPagar.toNumber(),
        saldoAFavor: saldoAFavor.toNumber(),
        resumen,
    };
}
