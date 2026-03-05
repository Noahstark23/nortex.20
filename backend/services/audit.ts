/**
 * NORTEX — Motor de Auditoría Forense
 * 
 * Detecta anomalías en inventario, anulaciones y descuentos
 * usando KardexMovement, CashMovement, AuditLog y Sale data.
 */

// @ts-ignore
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ==========================================
// INTERFACES
// ==========================================

export interface AuditAlert {
    id: string;
    type: 'KARDEX_SUSPICIOUS' | 'VOID_PATTERN' | 'DISCOUNT_ABUSE' | 'CASH_DISCREPANCY' | 'MANUAL_ADJUSTMENT';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
    userId?: string;
    userName?: string;
    amount?: number;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface KardexSuspicion {
    movementId: string;
    productId: string;
    productName: string;
    type: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    reason: string | null;
    userId: string;
    userName: string;
    date: Date;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskReason: string;
}

export interface VoidAnalysis {
    userId: string;
    userName: string;
    totalVoids: number;
    totalAmountVoided: number;
    voids: {
        id: string;
        amount: number;
        reason: string | null;
        category: string;
        voidedAt: Date;
    }[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface DiscountAnalysis {
    userId: string;
    userName: string;
    totalSales: number;
    salesWithDiscount: number;
    totalDiscountGiven: number;
    avgDiscountPercent: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

// ==========================================
// DETECCIÓN DE ANOMALÍAS EN KARDEX
// ==========================================

/**
 * Detecta movimientos de inventario sospechosos:
 * - Ajustes manuales sin referencia de venta/compra
 * - Reducciones de stock grandes sin razón
 * - Ajustes frecuentes del mismo usuario
 */
export async function detectSuspiciousKardex(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
): Promise<KardexSuspicion[]> {
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    const movements = await prisma.kardexMovement.findMany({
        where: {
            tenantId,
            type: { in: ['ADJUSTMENT', 'OUT'] },
            // Sin referencia a venta o compra = sospechoso
            OR: [
                { referenceId: null },
                { referenceType: 'ADJUSTMENT' },
            ],
            ...(startDate || endDate ? { date: dateFilter } : {}),
        },
        include: {
            product: { select: { name: true } },
            user: { select: { name: true, email: true } },
        },
        orderBy: { date: 'desc' },
        take: 200,
    });

    return movements.map((m: any) => {
        const absQty = Math.abs(Number(m.quantity));
        let severity: KardexSuspicion['severity'] = 'LOW';
        let riskReason = 'Ajuste manual registrado';

        if (absQty >= 50) {
            severity = 'CRITICAL';
            riskReason = `Ajuste masivo: ${absQty} unidades movidas sin referencia de venta`;
        } else if (absQty >= 20) {
            severity = 'HIGH';
            riskReason = `Ajuste grande: ${absQty} unidades sin documento soporte`;
        } else if (absQty >= 5) {
            severity = 'MEDIUM';
            riskReason = `Ajuste moderado sin referencia de transacción`;
        }

        // Si no tiene razón documentada, aumentar severidad
        if (!m.reason && severity !== 'CRITICAL') {
            const severityMap: Record<string, KardexSuspicion['severity']> = {
                'LOW': 'MEDIUM', 'MEDIUM': 'HIGH', 'HIGH': 'CRITICAL'
            };
            severity = severityMap[severity] || severity;
            riskReason += ' — SIN RAZÓN DOCUMENTADA';
        }

        return {
            movementId: m.id,
            productId: m.productId,
            productName: m.product?.name || 'Desconocido',
            type: m.type,
            quantity: Number(m.quantity),
            stockBefore: Number(m.stockBefore),
            stockAfter: Number(m.stockAfter),
            reason: m.reason,
            userId: m.userId,
            userName: m.user?.name || m.user?.email || 'Desconocido',
            date: m.date,
            severity,
            riskReason,
        };
    });
}

// ==========================================
// ANÁLISIS DE ANULACIONES (VOID PATTERN)
// ==========================================

/**
 * Analiza CashMovement anulados por usuario.
 * Detecta patrones de anulación excesiva.
 */
export async function analyzeVoidedMovements(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
): Promise<VoidAnalysis[]> {
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    const voidedMovements = await prisma.cashMovement.findMany({
        where: {
            tenantId,
            isVoided: true,
            ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Agrupar por usuario
    const byUser = new Map<string, VoidAnalysis>();

    for (const mov of voidedMovements as any[]) {
        const userId = mov.userId;
        if (!byUser.has(userId)) {
            byUser.set(userId, {
                userId,
                userName: mov.user?.name || mov.user?.email || 'Desconocido',
                totalVoids: 0,
                totalAmountVoided: 0,
                voids: [],
                riskLevel: 'LOW',
            });
        }
        const entry = byUser.get(userId)!;
        entry.totalVoids++;
        entry.totalAmountVoided += Math.abs(Number(mov.amount));
        entry.voids.push({
            id: mov.id,
            amount: Math.abs(Number(mov.amount)),
            reason: mov.voidReason,
            category: mov.category,
            voidedAt: mov.voidedAt || mov.createdAt,
        });
    }

    // Calcular riesgo por usuario
    for (const entry of byUser.values()) {
        if (entry.totalVoids >= 10 || entry.totalAmountVoided >= 5000) {
            entry.riskLevel = 'HIGH';
        } else if (entry.totalVoids >= 5 || entry.totalAmountVoided >= 2000) {
            entry.riskLevel = 'MEDIUM';
        }
        // Truncar lista a los últimos 20
        entry.voids = entry.voids.slice(0, 20);
    }

    return Array.from(byUser.values()).sort((a, b) => b.totalAmountVoided - a.totalAmountVoided);
}

// ==========================================
// ANÁLISIS DE DESCUENTOS POR CAJERO
// ==========================================

/**
 * Analiza descuentos aplicados en POS por cajero.
 * Detecta abuso: cajeros que aplican demasiados descuentos.
 */
export async function analyzeDiscounts(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
): Promise<DiscountAnalysis[]> {
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    // Obtener ventas con descuento (discount > 0)
    const sales = await prisma.sale.findMany({
        where: {
            tenantId,
            discount: { gt: 0 },
            ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        select: {
            id: true,
            userId: true,
            total: true,
            subtotal: true,
            discount: true,
            createdAt: true,
        },
    });

    // Total de ventas por usuario (para calcular %)
    const allSalesCount = await prisma.sale.groupBy({
        by: ['userId'],
        where: {
            tenantId,
            ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        _count: true,
    });

    const salesCountMap = new Map(allSalesCount.map((s: any) => [s.userId, s._count]));

    // Obtener nombres de usuarios
    const userIds = [...new Set(sales.map((s: any) => s.userId))];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u: any) => [u.id, u.name || u.email || 'Desconocido']));

    // Agrupar por usuario
    const byUser = new Map<string, DiscountAnalysis>();

    for (const sale of sales as any[]) {
        const userId = sale.userId;
        if (!byUser.has(userId)) {
            byUser.set(userId, {
                userId,
                userName: userMap.get(userId) || 'Desconocido',
                totalSales: salesCountMap.get(userId) || 0,
                salesWithDiscount: 0,
                totalDiscountGiven: 0,
                avgDiscountPercent: 0,
                riskLevel: 'LOW',
            });
        }
        const entry = byUser.get(userId)!;
        entry.salesWithDiscount++;
        entry.totalDiscountGiven += Number(sale.discount);
    }

    // Calcular promedios y riesgo
    for (const entry of byUser.values()) {
        const discountRate = entry.totalSales > 0 ? (entry.salesWithDiscount / entry.totalSales) * 100 : 0;
        entry.avgDiscountPercent = Math.round(discountRate * 100) / 100;

        if (discountRate > 30 || entry.totalDiscountGiven > 10000) {
            entry.riskLevel = 'HIGH';
        } else if (discountRate > 15 || entry.totalDiscountGiven > 3000) {
            entry.riskLevel = 'MEDIUM';
        }
    }

    return Array.from(byUser.values()).sort((a, b) => b.totalDiscountGiven - a.totalDiscountGiven);
}

// ==========================================
// FEED UNIFICADO DE ALERTAS
// ==========================================

/**
 * Genera un feed unificado de alertas forenses para el dashboard del dueño.
 */
export async function getAuditFeed(tenantId: string, limit: number = 50): Promise<AuditAlert[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const alerts: AuditAlert[] = [];

    // 1. Descuadres de caja (Shift.difference ≠ 0)
    const badShifts = await prisma.shift.findMany({
        where: {
            tenantId,
            status: 'CLOSED',
            NOT: { difference: 0 },
            closedAt: { gte: thirtyDaysAgo },
        },
        include: {
            user: { select: { name: true, email: true } },
        },
        orderBy: { closedAt: 'desc' },
        take: 20,
    });

    for (const shift of badShifts as any[]) {
        const diff = Number(shift.difference);
        const absDiff = Math.abs(diff);
        alerts.push({
            id: `shift-${shift.id}`,
            type: 'CASH_DISCREPANCY',
            severity: absDiff > 100 ? 'HIGH' : absDiff > 20 ? 'MEDIUM' : 'LOW',
            title: `Descuadre de caja: ${diff > 0 ? '+' : ''}C$${diff.toFixed(2)}`,
            description: `${shift.user?.name || shift.user?.email} cerró turno con diferencia de C$${diff.toFixed(2)}`,
            userId: shift.userId,
            userName: shift.user?.name || shift.user?.email,
            amount: diff,
            timestamp: shift.closedAt || shift.createdAt,
        });
    }

    // 2. Ajustes manuales de inventario sin venta
    const suspiciousKardex = await detectSuspiciousKardex(tenantId, thirtyDaysAgo);
    for (const k of suspiciousKardex.slice(0, 15)) {
        alerts.push({
            id: `kardex-${k.movementId}`,
            type: 'KARDEX_SUSPICIOUS',
            severity: k.severity,
            title: `Ajuste de inventario: ${k.productName}`,
            description: `${k.userName} movió ${k.quantity} unidades (${k.stockBefore} → ${k.stockAfter}). ${k.riskReason}`,
            userId: k.userId,
            userName: k.userName,
            amount: k.quantity,
            timestamp: k.date,
            metadata: { productId: k.productId },
        });
    }

    // 3. Anulaciones de cash
    const voidedMovements = await prisma.cashMovement.findMany({
        where: {
            tenantId,
            isVoided: true,
            voidedAt: { gte: thirtyDaysAgo },
        },
        include: {
            user: { select: { name: true, email: true } },
        },
        orderBy: { voidedAt: 'desc' },
        take: 15,
    });

    for (const v of voidedMovements as any[]) {
        alerts.push({
            id: `void-${v.id}`,
            type: 'VOID_PATTERN',
            severity: Math.abs(Number(v.amount)) > 500 ? 'HIGH' : 'MEDIUM',
            title: `Movimiento anulado: C$${Math.abs(Number(v.amount)).toFixed(2)}`,
            description: `${v.user?.name || v.user?.email} anuló ${v.category}. Razón: ${v.voidReason || 'SIN RAZÓN'}`,
            userId: v.userId,
            userName: v.user?.name || v.user?.email,
            amount: Math.abs(Number(v.amount)),
            timestamp: v.voidedAt || v.createdAt,
        });
    }

    // Ordenar por timestamp descendente y limitar
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return alerts.slice(0, limit);
}
