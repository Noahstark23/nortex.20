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

import Decimal from 'decimal.js';
import prisma from '../lib/prisma';
import { ESTADO_ANULADA } from './saleCancellation';

// Cliente compartido: este motor no abre un pool Prisma adicional.
// Mantener este bloque también conserva el rango fiscal de mutación (26-76).
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const IVA_RATE = new Decimal('0.15');
const ANTICIPO_IR_RATE = new Decimal('0.01');  // 1% anticipo mensual
const IMI_RATE = new Decimal('0.01');           // 1% impuesto municipal (Alcaldía)

/** Factor para desglosar un precio que YA trae IVA incluido: neto = total / 1.15 */
const IVA_FACTOR = IVA_RATE.plus(1);           // 1.15

/**
 * T1 — Desglose de IVA sobre un precio que YA LO INCLUYE.
 *
 * En Nortex el `Product.price` es precio de GÓNDOLA: ya trae el IVA adentro.
 * Así lo trata la venta autoritativa (`recordSale`: neto = total / 1.15), y así
 * debe tratarlo cualquier documento que use precios de venta (cotizaciones).
 * Sumar 15% ENCIMA de un precio inclusivo cobra el IVA dos veces: un producto
 * de góndola de C$115 se vendía a C$115 pero se cotizaba a C$132.25.
 *
 * `iva` se deriva por RESTA (no por multiplicación) para garantizar la
 * identidad exacta `neto + iva === totalConIva`, sin descuadre de centavos.
 */
export function desglosarIvaIncluido(totalConIva: Decimal.Value): { neto: Decimal; iva: Decimal } {
    const total = new Decimal(totalConIva).toDecimalPlaces(2);
    const neto = total.dividedBy(IVA_FACTOR).toDecimalPlaces(2);
    return { neto, iva: total.minus(neto) };
}

/**
 * T2 — Desglose de IVA de una venta con parte EXONERADA.
 *
 * Fuente única de verdad del cálculo: la usan el asiento contable (`recordSale`)
 * y la declaración mensual, para que el mayor y el VET nunca discrepen.
 *
 * Reglas:
 *  - `exento` se acota a [0, total] (defensa ante datos inconsistentes: un exento
 *    mayor que el total daría IVA negativo).
 *  - El IVA solo grava `total − exento`, y ese gravado YA trae el IVA incluido
 *    (precio de góndola) → `neto = gravado / 1.15`, `iva = gravado − neto`.
 *  - El ingreso neto es `netoGravado + exonerado`: lo exonerado SÍ es ingreso,
 *    solo que sin IVA que separar.
 */
export function desglosarVentaConExoneracion(total: Decimal.Value, exento: Decimal.Value = 0) {
    const dTotal = new Decimal(total);
    const dExento = Decimal.min(
        Decimal.max(new Decimal(exento ?? 0), new Decimal(0)),
        dTotal
    );
    const gravado = dTotal.minus(dExento);
    const netoGravado = gravado.dividedBy(IVA_FACTOR).toDecimalPlaces(4);
    const iva = gravado.minus(netoGravado).toDecimalPlaces(4);
    return {
        exonerado: dExento.toDecimalPlaces(4),
        gravado: gravado.toDecimalPlaces(4),
        netoGravado,
        iva,
        ingresoNeto: netoGravado.plus(dExento).toDecimalPlaces(4),
    };
}

export interface MonthlyTaxReport {
    month: number;
    year: number;

    // Ventas
    totalSales: number;           // Ventas brutas de todos los regímenes
    ventasCuotaFija: number;      // Ventas sin IVA/Anticipo IR/IMI del régimen general
    ventasExentas: number;        // T2 — ventas GENERAL exoneradas (canasta básica, medicinas)
    ventasGravadas: number;       // T2 — ventas GENERAL gravadas brutas (total − exentas)
    salesNetasSinIVA: number;     // Base GENERAL (neto gravado + exentas); excluye cuota fija
    totalIVACollected: number;    // IVA cobrado en GENERAL (snapshot + fallback legacy)

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
    // Rango fiscal anclado a Managua, el MISMO que usan el Libro de Ventas y el
    // resumen VET. Antes acá se usaba `new Date(year, month-1, 1)` —la zona del
    // proceso—, así que los tres documentos del mismo mes podían recortar ventas
    // distintas en el borde. Ojo: `end` es EXCLUSIVO (`lt`, no `lte`).
    const { start: startDate, end: endDate } = fiscalMonthRange(month, year);

    const saleWhere = {
        tenantId,
        createdAt: { gte: startDate, lt: endDate },
        status: { not: ESTADO_ANULADA },
    };
    const purchaseWhere = {
        tenantId,
        date: { gte: startDate, lt: endDate },
        status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
    };

    // Los snapshots fiscales hacen que un cambio posterior de configuración no
    // reescriba la historia. Todo se agrega en MySQL: nunca cargamos las ventas
    // del período en memoria. Las filas previas al snapshot conservan IVA NULL
    // y se recalculan con el comportamiento histórico, exclusivamente en GENERAL.
    const [
        salesByRegime,
        legacyGeneralSales,
        purchasesResult,
        legacyPurchasesResult,
        cfg,
        retenciones,
    ] = await Promise.all([
        prisma.sale.groupBy({
            by: ['fiscalRegimeAtSale'],
            where: saleWhere,
            _sum: { total: true, exemptTotal: true, vatAmountAtSale: true },
        }),
        prisma.sale.aggregate({
            where: {
                ...saleWhere,
                fiscalRegimeAtSale: { not: 'CUOTA_FIJA' },
                vatAmountAtSale: null,
            },
            _sum: { total: true, exemptTotal: true },
        }),
        prisma.purchase.aggregate({
            where: purchaseWhere,
            _sum: { total: true, creditableTax: true },
        }),
        prisma.purchase.aggregate({
            where: { ...purchaseWhere, creditableTax: null },
            _sum: { tax: true },
        }),
        // B4 — Tasas desde TaxConfig del tenant (fallback legal).
        prisma.taxConfig.findUnique({ where: { tenantId } }),
        // B1 — Agrupar en BD evita un findMany sin límite sobre datos fiscales.
        prisma.retencionSufrida.groupBy({
            by: ['tipo'],
            where: { tenantId, fecha: { gte: startDate, lt: endDate } },
            _sum: { amount: true },
        }),
    ]);

    let totalGeneral = new Decimal(0);
    let ventasCuotaFija = new Decimal(0);
    let ventasExentas = new Decimal(0);
    let snapshotIVA = new Decimal(0);
    for (const row of salesByRegime) {
        const total = new Decimal(row._sum.total?.toString() ?? 0);
        if (row.fiscalRegimeAtSale === 'CUOTA_FIJA') {
            // Aun si una fila corrupta trajera vatAmountAtSale > 0, cuota fija no
            // alimenta ningún impuesto del régimen general.
            ventasCuotaFija = ventasCuotaFija.plus(total);
            continue;
        }
        // GENERAL y valores legacy/desconocidos preservan el tratamiento previo.
        totalGeneral = totalGeneral.plus(total);
        ventasExentas = ventasExentas.plus(row._sum.exemptTotal?.toString() ?? 0);
        snapshotIVA = snapshotIVA.plus(row._sum.vatAmountAtSale?.toString() ?? 0);
    }

    totalGeneral = totalGeneral.toDecimalPlaces(4);
    ventasCuotaFija = ventasCuotaFija.toDecimalPlaces(4);
    ventasExentas = Decimal.min(
        Decimal.max(ventasExentas, new Decimal(0)),
        totalGeneral
    ).toDecimalPlaces(4);
    snapshotIVA = snapshotIVA.toDecimalPlaces(4);

    const legacyGeneralTotal = new Decimal(
        legacyGeneralSales._sum.total?.toString() ?? 0
    ).toDecimalPlaces(4);
    const legacyDesglose = desglosarVentaConExoneracion(
        legacyGeneralTotal,
        legacyGeneralSales._sum.exemptTotal?.toString() ?? 0
    );
    const snapshotGeneralTotal = totalGeneral.minus(legacyGeneralTotal);
    const snapshotGeneralNet = snapshotGeneralTotal.minus(snapshotIVA);

    const totalSalesRaw = totalGeneral.plus(ventasCuotaFija).toDecimalPlaces(4);
    const ventasGravadas = totalGeneral.minus(ventasExentas).toDecimalPlaces(4);
    const totalIVACollected = snapshotIVA.plus(legacyDesglose.iva).toDecimalPlaces(4);
    // Base del Anticipo IR / IMI GENERAL. Cuota fija queda explícitamente fuera.
    const salesNetasSinIVA = snapshotGeneralNet
        .plus(legacyDesglose.ingresoNeto)
        .toDecimalPlaces(4);

    // `creditableTax = 0` es un snapshot explícito (p. ej. cuota fija), no debe
    // caer al IVA bruto. Solo NULL identifica compras legacy sin snapshot.
    const totalPurchases = new Decimal(purchasesResult._sum.total?.toString() ?? 0);
    const snapshottedCreditableTax = new Decimal(
        purchasesResult._sum.creditableTax?.toString() ?? 0
    );
    const legacyCreditableTax = new Decimal(
        legacyPurchasesResult._sum.tax?.toString() ?? 0
    );
    const totalIVAPaid = snapshottedCreditableTax
        .plus(legacyCreditableTax)
        .toDecimalPlaces(4);

    // 3. Calcular IVA Neto
    const ivaRaw = totalIVACollected.minus(totalIVAPaid);
    const ivaNeto = Decimal.max(0, ivaRaw).toDecimalPlaces(4);
    const ivaCredito = ivaRaw.lessThan(0) ? ivaRaw.abs().toDecimalPlaces(4) : new Decimal(0);

    const anticipoRate = cfg ? new Decimal(cfg.anticipoIrRate.toString()) : ANTICIPO_IR_RATE;
    const imiRateCfg = cfg ? new Decimal(cfg.imiRate.toString()) : IMI_RATE;

    // 4. Anticipo IR (tasa * ventas netas sin IVA)
    const anticipoIR = salesNetasSinIVA.mul(anticipoRate).toDecimalPlaces(4);

    // 5. IMI Alcaldía (tasa * ventas netas sin IVA)
    const imiAlcaldia = salesNetasSinIVA.mul(imiRateCfg).toDecimalPlaces(4);

    // B1 — Retenciones SUFRIDAS del mes (crédito contra anticipo IR / IMI).
    let retIR = new Decimal(0);
    let retIMI = new Decimal(0);
    for (const r of retenciones) {
        const amount = r._sum.amount?.toString() ?? 0;
        if (r.tipo === 'IR_2') retIR = retIR.plus(amount);
        else if (r.tipo === 'IMI_1') retIMI = retIMI.plus(amount);
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
   Ventas Brutas (todos los regímenes): C$ ${totalSalesRaw.toFixed(2)}${ventasCuotaFija.greaterThan(0) ? `
   (−) Ventas de Cuota Fija:           C$ ${ventasCuotaFija.toFixed(2)}
   = Ventas de Régimen General:         C$ ${totalGeneral.toFixed(2)}` : ''}${ventasExentas.greaterThan(0) ? `
   (−) Ventas Exoneradas:   C$ ${ventasExentas.toFixed(2)}
   = Ventas Gravadas:       C$ ${ventasGravadas.toFixed(2)}` : ''}
   Base General (sin IVA):  C$ ${salesNetasSinIVA.toFixed(2)}
   IVA Cobrado General:     C$ ${totalIVACollected.toFixed(2)}${ventasCuotaFija.greaterThan(0) ? `
   Nota: Cuota Fija no alimenta IVA, Anticipo IR ni IMI del régimen general.` : ''}

🛒 COMPRAS DEL PERÍODO
   Compras Brutas (con IVA): C$ ${totalPurchases.toFixed(2)}
   IVA Crédito Acreditable:  C$ ${totalIVAPaid.toFixed(2)}

💰 IMPUESTOS A PAGAR
   IVA Neto (Ventas - Compras): C$ ${ivaNeto.toFixed(2)}${ivaCredito.greaterThan(0) ? `\n   ⚠️ Crédito Fiscal a Favor: C$ ${ivaCredito.toFixed(2)}` : ''}
   Anticipo IR (${anticipoRate.mul(100).toFixed(2)}%):          C$ ${anticipoIR.toFixed(2)}${retIR.greaterThan(0) ? `\n   (−) Retenciones IR sufridas:  C$ ${retIR.toFixed(2)}\n   = Anticipo IR a pagar:        C$ ${anticipoIRaPagar.toFixed(2)}${saldoIRaFavor.greaterThan(0) ? `\n   ⚠️ Saldo IR a favor:          C$ ${saldoIRaFavor.toFixed(2)}` : ''}` : ''}
   IMI Alcaldía (${imiRateCfg.mul(100).toFixed(2)}%):         C$ ${imiAlcaldia.toFixed(2)}${retIMI.greaterThan(0) ? `\n   (−) Retenciones IMI sufridas: C$ ${retIMI.toFixed(2)}\n   = IMI a pagar:                C$ ${imiAPagar.toFixed(2)}` : ''}
   ────────────────────────────────
   TOTAL A PAGAR:               C$ ${totalToPay.toFixed(2)}

${totalGeneral.isZero() && ventasCuotaFija.greaterThan(0)
        ? '📋 Período compuesto exclusivamente por ventas de Cuota Fija.\n   No usar este resumen como declaración del régimen general sin revisión contable.'
        : `📋 Presentar en VET (ventanilla.dgi.gob.ni)\n   antes del 15 de ${monthNames[month] || monthNames[0]} ${month === 12 ? year + 1 : year}`}
`.trim();

    return {
        month,
        year,
        totalSales: totalSalesRaw.toNumber(),
        ventasCuotaFija: ventasCuotaFija.toNumber(),
        ventasExentas: ventasExentas.toNumber(),
        ventasGravadas: ventasGravadas.toNumber(),
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
    // Mismo rango fiscal anclado a Managua que la declaración y los libros.
    const { start: startDate, end: endDate } = fiscalMonthRange(month, year);

    // El DMI pertenece al régimen general. Las facturas de cuota fija conservan
    // su correlativo histórico, pero no se mezclan en el rango declarado acá.
    const invoiceRange = await prisma.sale.aggregate({
        where: {
            tenantId,
            createdAt: { gte: startDate, lt: endDate },
            invoiceNumber: { not: null },
            status: { not: ESTADO_ANULADA },
            fiscalRegimeAtSale: { not: 'CUOTA_FIJA' },
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
    const ventasGeneralBrutas = new Decimal(taxReport.totalSales.toString())
        .minus(taxReport.ventasCuotaFija.toString());
    const ventasGravadasNetas = new Decimal(taxReport.salesNetasSinIVA.toString())
        .minus(taxReport.ventasExentas.toString());

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
   Facturas de Régimen General: ${invoiceRange._count}

📊 RESUMEN DE VENTAS
   Ventas Gravadas (sin IVA):  C$ ${ventasGravadasNetas.toFixed(2)}
   IVA 15%:                     C$ ${taxReport.totalIVACollected.toFixed(2)}
   Ventas Exentas:              C$ ${taxReport.ventasExentas.toFixed(2)}
   Total Régimen General:        C$ ${ventasGeneralBrutas.toFixed(2)}${taxReport.ventasCuotaFija > 0 ? `
   Ventas Cuota Fija (fuera de DMI): C$ ${new Decimal(taxReport.ventasCuotaFija.toString()).toFixed(2)}` : ''}

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
    // E4: se EXCLUYE el asiento de CIERRE ANUAL (fechado 31-dic): salda todos
    // los ingresos/gastos del año, así que incluirlo dejaría la utilidad fiscal
    // en 0 para un ejercicio ya cerrado. (Prisma incluye referenceType NULL en
    // el filtro `not` → los asientos manuales sin tipo se conservan.)
    const lines = await prisma.journalLine.findMany({
        where: { entry: { tenantId, date: { gte: start, lte: end }, referenceType: { not: 'ANNUAL_CLOSE' } } },
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

    // Retenciones IR sufridas del año (crédito). Siempre son crédito real: un
    // tercero ya le retuvo el 2% al negocio, esté o no declarado el mes.
    const retAgg = await prisma.retencionSufrida.aggregate({
        where: { tenantId, tipo: 'IR_2', fecha: { gte: start, lte: end } },
        _sum: { amount: true },
    });
    const retencionesIR = new Decimal(retAgg._sum.amount?.toString() ?? '0').toDecimalPlaces(2);

    // Anticipos IR realmente enterados en efectivo: se acreditan SOLO los meses
    // cuyo Anticipo IR quedó marcado como declarado (ObligationStatus, el mismo
    // marcador que usa el panel de cierre mensual) y por el monto real pagado en
    // cash de ese mes (anticipoIRaPagar = anticipo neto de retenciones). NO se
    // deriva del PMD, para no inflar el crédito con pagos que no ocurrieron.
    const mesesDeclarados = await prisma.obligationStatus.findMany({
        where: { tenantId, year, key: 'ANTICIPO_IR', declarado: true },
        select: { month: true },
    });
    let anticiposEnterados = new Decimal(0);
    for (const { month } of mesesDeclarados) {
        const mensual = await generateMonthlyReport(tenantId, month, year);
        anticiposEnterados = anticiposEnterados.plus(mensual.anticipoIRaPagar.toString());
    }
    anticiposEnterados = anticiposEnterados.toDecimalPlaces(2);
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

// ── Rango fiscal del mes (fuente única) ──────────────────────────────────────
/**
 * Nicaragua no aplica horario de verano, así que el mes fiscal va de medianoche
 * de Managua a medianoche de Managua: UTC-6 fijo.
 *
 * Vive acá y no en server.ts porque los TRES documentos del mismo período —el
 * Libro de Ventas, el resumen VET y la declaración mensual— tienen que recortar
 * exactamente las mismas ventas. Antes no lo hacían: los exports usaban este
 * rango anclado a Managua y `generateMonthlyReport` usaba
 * `new Date(year, month-1, 1)`, o sea la zona horaria del PROCESO. Con el
 * contenedor en UTC eso corría el borde seis horas, y las ventas de la tarde del
 * último día del mes (18:00–24:00 de Managua) caían en un mes distinto según qué
 * documento se mirara.
 *
 * El fin es EXCLUSIVO: usar siempre `{ gte: start, lt: end }`, nunca `lte`.
 */
export const MANAGUA_UTC_OFFSET_HOURS = 6;

export function fiscalMonthRange(month: number, year: number): { start: Date; end: Date } {
    const start = new Date(Date.UTC(year, month - 1, 1, MANAGUA_UTC_OFFSET_HOURS, 0, 0));
    const end   = new Date(Date.UTC(year, month, 1, MANAGUA_UTC_OFFSET_HOURS, 0, 0));
    return { start, end };
}
