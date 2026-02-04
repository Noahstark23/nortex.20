// @ts-ignore
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ScoreResult {
    score: number;
    creditLimit: number;
    rating: 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D';
    factors: string[];
}

export const calculateTenantScore = async (tenantId: string): Promise<ScoreResult> => {
    // 1. OBTENER DATA HISTÓRICA
    const shifts = await prisma.shift.findMany({
        where: { tenantId, status: 'CLOSED' },
        take: 30 // Últimos 30 turnos
    });

    const sales = await prisma.sale.findMany({
        where: { 
            tenantId,
            createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } // Ventas último mes
        }
    });

    // 2. VARIABLES DEL ALGORITMO
    let baseScore = 300; // Inicio FICO Score bajo
    const factors: string[] = [];

    // 3. ANÁLISIS DE FIABILIDAD OPERATIVA (Cierres de Caja)
    // Si la diferencia es 0 (cierre perfecto), suma puntos.
    const perfectShifts = shifts.filter((s: any) => Number(s.difference) === 0).length;
    const reliabilityBonus = perfectShifts * 15; // 15 puntos por cada cierre perfecto
    
    if (perfectShifts > 5) factors.push(`Operación Impecable: ${perfectShifts} cierres perfectos`);
    
    baseScore += reliabilityBonus;

    // 4. ANÁLISIS DE VOLUMEN TRANSACCIONAL
    const totalSalesVol = sales.reduce((acc: number, s: any) => acc + Number(s.total), 0);
    const avgTicket = sales.length > 0 ? totalSalesVol / sales.length : 0;
    
    // Puntos por volumen (Scalable)
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

    // 6. NORMALIZACIÓN (300 - 850)
    let finalScore = Math.max(300, Math.min(850, baseScore));

    // 7. CÁLCULO DE LÍNEA DE CRÉDITO (CAPACIDAD DE PAGO)
    // Regla: 30% del volumen de ventas mensual ajustado por el Score
    const scoreMultiplier = finalScore / 850; // % de confianza
    const calculatedLimit = (totalSalesVol * 0.30) * scoreMultiplier;
    
    // Round to nearest 100
    const finalLimit = Math.ceil(calculatedLimit / 100) * 100;

    // 8. RATING
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
        factors
    };
};