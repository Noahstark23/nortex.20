import Decimal from 'decimal.js';
import { prisma } from '../lib/prisma';
import { getBalanceGeneral, getEstadoResultados, seedChartOfAccounts } from './accounting';
import { ESTADO_ANULADA } from './saleCancellation';

interface ScoreResult {
    // NULL = sin datos suficientes: no se inventa un número, no hay historial real.
    score: number | null;
    creditLimit: number;
    rating: 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D' | null;
    factors: string[];
    financialRatios?: {
        liquidityRatio: number;
        debtToEquity: number;
        netMargin: number;
        ebitda: number;
    };
}

export const calculateTenantScore = async (tenantId: string): Promise<ScoreResult> => {
    // 1. OBTENER DATA HISTÓRICA
    // `take` SIN `orderBy` deja que MySQL elija 30 turnos cualesquiera: el score
    // cambiaba de valor entre corridas sobre los mismos datos. Y solo se usa
    // `difference`, así que no se traen filas completas.
    const shifts = await prisma.shift.findMany({
        where: { tenantId, status: 'CLOSED' },
        select: { difference: true },
        orderBy: { startTime: 'desc' },
        take: 30, // Últimos 30 turnos
    });

    // AGREGACIÓN EN LA BD, no filas en JS (guardrail de escalado #2): de este
    // findMany solo salían un conteo y una suma. Un tenant con 40k ventas al mes
    // traía 40k filas a memoria por cada recálculo de score.
    const ventasDelMes = await prisma.sale.aggregate({
        where: {
            tenantId,
            // Una factura ANULADA no es actividad comercial: si contara, un
            // negocio podría inflar su propio score facturando y anulando.
            status: { not: ESTADO_ANULADA },
            createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) }
        },
        _count: { _all: true },
        _sum: { total: true },
    });
    const cantidadDeVentas = ventasDelMes._count._all;

    // Gate de historial real: sin NINGÚN cierre de caja ni venta, no hay con qué
    // calcular. Devolvemos score NULL ("sin datos") y línea 0 — nada fantasma.
    if (shifts.length === 0 && cantidadDeVentas === 0) {
        return {
            score: null,
            creditLimit: 0,
            rating: null,
            factors: ['Sin historial operativo suficiente para calcular un score'],
        };
    }

    // 2. VARIABLES DEL ALGORITMO
    let baseScore = 300;
    const factors: string[] = [];

    // 3. ANÁLISIS DE FIABILIDAD OPERATIVA (Cierres de Caja)
    const perfectShifts = shifts.filter((s: any) => Number(s.difference) === 0).length;
    const reliabilityBonus = perfectShifts * 15;

    if (perfectShifts > 5) factors.push(`Operación Impecable: ${perfectShifts} cierres perfectos`);
    baseScore += reliabilityBonus;

    // 4. ANÁLISIS DE VOLUMEN TRANSACCIONAL (Decimal: es dinero)
    const volumenDeVentas = new Decimal(ventasDelMes._sum.total?.toString() ?? 0);
    const totalSalesVol = volumenDeVentas.toNumber();

    if (totalSalesVol > 10000) {
        baseScore += 100;
        factors.push('Alto Volumen de Ventas (>10k/mes)');
    } else if (totalSalesVol > 5000) {
        baseScore += 50;
    }

    // 5. PENALIZACIONES (Riesgo)
    const badShifts = shifts.filter((s: any) => Math.abs(Number(s.difference)) > 10).length;
    if (badShifts > 0) {
        baseScore -= (badShifts * 20);
        factors.push(`RIESGO: ${badShifts} Descuadres de caja detectados`);
    }

    // 6. 📊 ANÁLISIS FINANCIERO (desde el Motor Contable)
    let financialRatios = undefined;
    try {
        await seedChartOfAccounts(tenantId);
        const balance = await getBalanceGeneral(tenantId);
        const estado = await getEstadoResultados(tenantId);

        const totalAssets = balance.totals.assets;
        const totalLiabilities = balance.totals.liabilities;
        const totalEquity = balance.totals.equity + balance.totals.netIncome;
        const netIncome = balance.totals.netIncome;
        const revenue = estado.revenue.total;

        // Current assets (1.1.x) / Current liabilities (2.1.x)
        const currentAssets = balance.assets.filter(a => a.code.startsWith('1.1')).reduce((s, a) => s + a.balance, 0);
        const currentLiabilities = balance.liabilities.filter(a => a.code.startsWith('2.1')).reduce((s, a) => s + Math.abs(a.balance), 0);

        const liquidityRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 999;
        const debtToEquity = totalEquity > 0 ? totalLiabilities / totalEquity : 999;
        const netMargin = revenue > 0 ? (netIncome / revenue) * 100 : 0;
        const ebitda = estado.grossProfit - estado.operatingExpenses.total; // Without depreciation

        financialRatios = { liquidityRatio, debtToEquity, netMargin, ebitda };

        // Bonus por liquidez
        if (liquidityRatio >= 2) {
            baseScore += 80;
            factors.push(`Liquidez Sólida: Ratio ${liquidityRatio.toFixed(1)}x`);
        } else if (liquidityRatio >= 1.5) {
            baseScore += 50;
            factors.push(`Liquidez Saludable: Ratio ${liquidityRatio.toFixed(1)}x`);
        } else if (liquidityRatio < 1 && currentLiabilities > 0) {
            baseScore -= 60;
            factors.push(`⚠️ Liquidez Peligrosa: Ratio ${liquidityRatio.toFixed(1)}x`);
        }

        // Bonus por margen neto
        if (netMargin > 20) {
            baseScore += 60;
            factors.push(`Margen Neto Excelente: ${netMargin.toFixed(1)}%`);
        } else if (netMargin > 10) {
            baseScore += 30;
        } else if (netMargin < 0) {
            baseScore -= 40;
            factors.push(`⚠️ Operación con Pérdida: Margen ${netMargin.toFixed(1)}%`);
        }

        // Penalización por sobre-endeudamiento
        if (debtToEquity > 3) {
            baseScore -= 50;
            factors.push(`⚠️ Alto Endeudamiento: D/E ${debtToEquity.toFixed(1)}x`);
        }

        // EBITDA positivo = negocio rentable
        if (ebitda > 5000) {
            baseScore += 40;
            factors.push(`EBITDA Fuerte: C$ ${ebitda.toFixed(0)}`);
        }
    } catch (err) {
        // Accounting not available yet — skip financial analysis
        factors.push('Datos contables insuficientes para análisis financiero');
    }

    // 7. NORMALIZACIÓN (300 - 850)
    let finalScore = Math.max(300, Math.min(850, baseScore));

    // 8. CÁLCULO DE LÍNEA DE CRÉDITO
    const finalLimit = volumenDeVentas
        .mul('0.30')
        .mul(new Decimal(finalScore).div(850))
        .div(100)
        .ceil()
        .mul(100)
        .toNumber();

    // 9. RATING
    let rating: ScoreResult['rating'] = 'D';
    if (finalScore >= 800) rating = 'AAA';
    else if (finalScore >= 740) rating = 'AA';
    else if (finalScore >= 670) rating = 'A';
    else if (finalScore >= 580) rating = 'B';
    else if (finalScore >= 500) rating = 'C';

    return {
        score: Math.floor(finalScore),
        creditLimit: finalLimit,
        rating,
        factors,
        financialRatios,
    };
};