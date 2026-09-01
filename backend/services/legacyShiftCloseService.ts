import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import { calcularEfectivoTurno } from '../../utils/margen';
import { canonicalizeCloseShiftPayload } from '../validation/schemas';
import { ESTADO_ANULADA } from './saleCancellation';

type FindArgs = Record<string, unknown>;

interface ShiftStore {
    findFirst(args: FindArgs): Promise<any>;
    updateMany(args: FindArgs): Promise<{ count: number }>;
}

interface TenantStore {
    findFirst(args: FindArgs): Promise<any>;
}

interface AuditStore {
    create(args: FindArgs): Promise<any>;
}

export interface ShiftCloseTransaction {
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
    shift: ShiftStore;
    tenant: TenantStore;
    auditLog: AuditStore;
}

/**
 * Contrato estructural deliberadamente pequeño: el servicio no crea otro
 * PrismaClient y las pruebas pueden inyectar una BD determinista.
 */
export interface ShiftCloseDatabase {
    $transaction<T>(operation: (tx: ShiftCloseTransaction) => Promise<T>): Promise<T>;
    shift: Pick<ShiftStore, 'findFirst'>;
    tenant: TenantStore;
}

export interface LegacyShiftCloseInput {
    shiftId: string;
    declaredCash: string;
    declaredCashUsd?: string;
    auditNotes?: string;
    clientEventId?: string;
}

export interface LegacyShiftCloseContext {
    tenantId: string;
    userId: string;
    role?: string;
}

export interface ShiftCloseWarning {
    alertType: 'THEFT_ALERT' | 'SURPLUS_ALERT';
    difference: string;
    threshold: string;
    cashierName: string;
}

export interface LegacyShiftCloseResult {
    body: Record<string, unknown>;
    warning?: ShiftCloseWarning;
}

export class ShiftCloseError extends Error {
    constructor(
        public readonly code: string,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'ShiftCloseError';
    }
}

const SHIFT_CLOSE_INCLUDE = {
    // La factura anulada sigue existiendo para DGI, pero ya no representa
    // efectivo cobrado y por eso no entra al arqueo.
    sales: {
        where: { status: { not: ESTADO_ANULADA }, cancelledAt: null },
        select: { total: true, storeCreditApplied: true, paymentMethod: true, status: true, cancelledAt: true },
    },
    cashMovements: {
        where: { isVoided: false },
        select: { type: true, amount: true, currency: true, category: true },
    },
    employee: { select: { id: true, firstName: true, lastName: true, role: true } },
} as const;

const isP2002 = (error: unknown): boolean =>
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';

export const buildLegacyShiftCloseIdentity = (
    context: Pick<LegacyShiftCloseContext, 'tenantId'>,
    input: LegacyShiftCloseInput,
): { closeEventId: string; closePayloadHash: string } => ({
    closeEventId: input.clientEventId ?? `legacy:${crypto.createHash('sha256')
        .update(`${context.tenantId}\u0000${input.shiftId}`)
        .digest('hex')}`,
    closePayloadHash: crypto.createHash('sha256')
        .update(canonicalizeCloseShiftPayload(input))
        .digest('hex'),
});

const actorCanClose = (shift: any, context: LegacyShiftCloseContext): boolean =>
    shift.userId === context.userId
    || ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(context.role ?? '');

const calculateCloseMetrics = (shift: any, input: LegacyShiftCloseInput) => {
    // Defensa doble: Prisma ya filtra estas filas, pero el cálculo puro no
    // confía en que un adapter/test haya aplicado correctamente el include.
    const validSales = (shift.sales ?? []).filter(
        (sale: any) => sale.status !== ESTADO_ANULADA && sale.cancelledAt == null,
    );
    const cashSalesD = validSales
        .filter((sale: any) => sale.paymentMethod === 'CASH')
        .reduce(
            (sum: Decimal, sale: any) => sum.plus(
                new Decimal(sale.total.toString()).minus(sale.storeCreditApplied?.toString() ?? 0),
            ),
            new Decimal(0),
        );
    const cardSalesD = validSales
        .filter((sale: any) => sale.paymentMethod !== 'CASH' && sale.paymentMethod !== 'CREDIT')
        .reduce(
            (sum: Decimal, sale: any) => sum.plus(
                new Decimal(sale.total.toString()).minus(sale.storeCreditApplied?.toString() ?? 0),
            ),
            new Decimal(0),
        );

    const efectivoArqueo = calcularEfectivoTurno({
        initialCash: shift.initialCash.toString(),
        initialCashUsd: shift.initialCashUsd == null ? 0 : shift.initialCashUsd.toString(),
        cashSales: cashSalesD,
        movimientos: (shift.cashMovements ?? []).map((movement: any) => ({
            type: movement.type,
            amount: movement.amount.toString(),
            currency: movement.currency,
            category: movement.category,
        })),
    });

    const declaredCashD = new Decimal(input.declaredCash);
    const expectedCashD = efectivoArqueo.efectivoNIO.toDecimalPlaces(2);
    const differenceD = declaredCashD.minus(expectedCashD).toDecimalPlaces(2);
    const declaredUsdD = new Decimal(input.declaredCashUsd ?? 0);
    const expectedUsdD = efectivoArqueo.efectivoUSD.toDecimalPlaces(4);
    const differenceUsdD = declaredUsdD.minus(expectedUsdD).toDecimalPlaces(4);
    const huboUsd = !expectedUsdD.isZero()
        || !declaredUsdD.isZero()
        || !new Decimal(shift.initialCashUsd?.toString() ?? 0).isZero();

    return {
        cashSalesD,
        cardSalesD,
        salesCount: validSales.length,
        manualINsD: efectivoArqueo.desglose.manualINs,
        manualOUTsD: efectivoArqueo.desglose.manualOUTs,
        agentINsD: efectivoArqueo.desglose.agentINs,
        agentOUTsD: efectivoArqueo.desglose.agentOUTs,
        declaredCashD,
        expectedCashD,
        differenceD,
        declaredUsdD,
        expectedUsdD,
        differenceUsdD,
        huboUsd,
    };
};

const responseForClose = (
    closedShift: any,
    metrics: ReturnType<typeof calculateCloseMetrics>,
    theftAlert: boolean,
    idempotentReplay: boolean,
): Record<string, unknown> => {
    const responseShift = { ...closedShift };
    delete responseShift.sales;
    delete responseShift.cashMovements;
    return {
        ...responseShift,
        manualINs: metrics.manualINsD.toNumber(),
        manualOUTs: metrics.manualOUTsD.toNumber(),
        agentINs: metrics.agentINsD.toNumber(),
        agentOUTs: metrics.agentOUTsD.toNumber(),
        theftAlert,
        idempotentReplay,
    };
};

const thresholdForTenant = async (
    store: TenantStore,
    tenantId: string,
): Promise<Decimal> => {
    const tenant = await store.findFirst({ where: { id: tenantId } });
    return new Decimal(tenant?.theftAlertThreshold?.toString() ?? 500);
};

const replayResult = async (
    shift: any,
    tenantStore: TenantStore,
    context: LegacyShiftCloseContext,
    input: LegacyShiftCloseInput,
): Promise<LegacyShiftCloseResult> => {
    const metrics = calculateCloseMetrics(shift, input);
    const threshold = await thresholdForTenant(tenantStore, context.tenantId);
    const theftAlert = new Decimal(shift.difference?.toString() ?? 0)
        .abs()
        .greaterThan(threshold);
    return { body: responseForClose(shift, metrics, theftAlert, true) };
};

const isExactReplay = (
    shift: any,
    input: LegacyShiftCloseInput,
    identity: ReturnType<typeof buildLegacyShiftCloseIdentity>,
): boolean => shift.id === input.shiftId
    && shift.status === 'CLOSED'
    && shift.closeEventId === identity.closeEventId
    && shift.closePayloadHash === identity.closePayloadHash;

/**
 * Cierra el turno legacy una sola vez. El claim OPEN→CLOSED, los importes y
 * ambos AuditLog viven en una transacción. Un perdedor de carrera se relee en
 * un snapshot fresco fuera de la transacción abortada.
 */
export async function closeLegacyShift(
    db: ShiftCloseDatabase,
    context: LegacyShiftCloseContext,
    input: LegacyShiftCloseInput,
): Promise<LegacyShiftCloseResult> {
    const identity = buildLegacyShiftCloseIdentity(context, input);

    try {
        return await db.$transaction(async (tx) => {
            const lockedShiftRows: Array<{ id: string }> = await tx.$queryRaw`
                SELECT \`id\`
                  FROM \`Shift\`
                 WHERE \`id\` = ${input.shiftId}
                   AND \`tenantId\` = ${context.tenantId}
                 LIMIT 1
                 FOR UPDATE
            `;
            if (lockedShiftRows.length !== 1) {
                throw new ShiftCloseError(
                    'CLOSE_SHIFT_NOT_FOUND',
                    404,
                    'Turno no encontrado o no pertenece a tu empresa',
                );
            }

            const shift = await tx.shift.findFirst({
                where: { id: input.shiftId, tenantId: context.tenantId },
                include: SHIFT_CLOSE_INCLUDE,
            });
            if (!shift) throw new Error('El turno bloqueado no pudo releerse');
            if (!actorCanClose(shift, context)) {
                throw new ShiftCloseError(
                    'CLOSE_SHIFT_FORBIDDEN',
                    403,
                    'No autorizado a cerrar este turno.',
                );
            }

            if (shift.status !== 'OPEN') {
                if (isExactReplay(shift, input, identity)) {
                    return replayResult(shift, tx.tenant, context, input);
                }
                throw new ShiftCloseError(
                    'CLOSE_SHIFT_CONFLICT',
                    409,
                    'El turno ya fue cerrado con otra solicitud',
                );
            }

            const closedAt = new Date();
            const claim = await tx.shift.updateMany({
                where: {
                    id: input.shiftId,
                    tenantId: context.tenantId,
                    status: 'OPEN',
                },
                data: {
                    status: 'CLOSED',
                    endTime: closedAt,
                    closeEventId: identity.closeEventId,
                    closePayloadHash: identity.closePayloadHash,
                },
            });
            if (claim.count !== 1) {
                // No usar la snapshot REPEATABLE READ previa al ganador.
                throw new ShiftCloseError(
                    'CLOSE_SHIFT_CLAIM_LOST',
                    409,
                    'Otra solicitud cerró el turno simultáneamente',
                );
            }

            const closedShift = await tx.shift.findFirst({
                where: { id: input.shiftId, tenantId: context.tenantId },
                include: SHIFT_CLOSE_INCLUDE,
            });
            if (!closedShift) throw new Error('El turno cerrado no pudo releerse');

            const metrics = calculateCloseMetrics(closedShift, input);
            const theftThresholdD = await thresholdForTenant(tx.tenant, context.tenantId);
            const theftAlert = metrics.differenceD.abs().greaterThan(theftThresholdD);

            const finalized = await tx.shift.updateMany({
                where: {
                    id: input.shiftId,
                    tenantId: context.tenantId,
                    status: 'CLOSED',
                    closeEventId: identity.closeEventId,
                    closePayloadHash: identity.closePayloadHash,
                },
                data: {
                    finalCashDeclared: metrics.declaredCashD.toFixed(2),
                    systemExpectedCash: metrics.expectedCashD.toFixed(2),
                    difference: metrics.differenceD.toFixed(2),
                    ...(metrics.huboUsd ? {
                        finalCashDeclaredUsd: metrics.declaredUsdD.toFixed(4),
                        systemExpectedUsd: metrics.expectedUsdD.toFixed(4),
                        differenceUsd: metrics.differenceUsdD.toFixed(4),
                    } : {}),
                },
            });
            if (finalized.count !== 1) {
                throw new Error('No se pudo completar el claim del cierre de caja');
            }

            const cashierName = closedShift.employee
                ? `${closedShift.employee.firstName} ${closedShift.employee.lastName}`
                : 'Sin asignar';

            await tx.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    userId: context.userId,
                    action: 'SHIFT_CLOSED',
                    details: JSON.stringify({
                        closeEventId: identity.closeEventId,
                        closePayloadHash: identity.closePayloadHash,
                        esperado: metrics.expectedCashD.toFixed(2),
                        declarado: metrics.declaredCashD.toFixed(2),
                        diferencia: metrics.differenceD.toFixed(2),
                        cajero: cashierName,
                        totalEfectivo: metrics.cashSalesD.toFixed(2),
                        totalTarjeta: metrics.cardSalesD.toFixed(2),
                        entradasManuales: metrics.manualINsD.toFixed(2),
                        salidasManuales: metrics.manualOUTsD.toFixed(2),
                        fondoInicial: new Decimal(closedShift.initialCash.toString()).toFixed(2),
                        ...(metrics.huboUsd ? {
                            usd: {
                                esperado: metrics.expectedUsdD.toFixed(4),
                                declarado: metrics.declaredUsdD.toFixed(4),
                                diferencia: metrics.differenceUsdD.toFixed(4),
                                fondoInicial: new Decimal(closedShift.initialCashUsd?.toString() ?? 0).toFixed(4),
                            },
                        } : {}),
                        totalVentas: metrics.salesCount,
                        totalMovimientos: (closedShift.cashMovements ?? []).length,
                        notasRevisor: input.auditNotes || 'Sin notas.',
                    }),
                },
            });

            let warning: ShiftCloseWarning | undefined;
            if (theftAlert) {
                const alertType = metrics.differenceD.isNegative() ? 'THEFT_ALERT' : 'SURPLUS_ALERT';
                await tx.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        userId: context.userId,
                        action: alertType,
                        details: JSON.stringify({
                            tipo: metrics.differenceD.isNegative()
                                ? '⚠️ FALTANTE EN CAJA'
                                : '⚠️ SOBRANTE EN CAJA',
                            diferencia: metrics.differenceD.toFixed(2),
                            esperado: metrics.expectedCashD.toFixed(2),
                            declarado: metrics.declaredCashD.toFixed(2),
                            cajero: cashierName,
                            umbral: theftThresholdD.toFixed(2),
                            turnoId: input.shiftId,
                            fecha: closedAt.toISOString(),
                        }),
                    },
                });
                warning = {
                    alertType,
                    difference: metrics.differenceD.abs().toFixed(2),
                    threshold: theftThresholdD.toFixed(2),
                    cashierName,
                };
            }
            const finalizedShift = await tx.shift.findFirst({
                where: { id: input.shiftId, tenantId: context.tenantId },
                include: SHIFT_CLOSE_INCLUDE,
            });
            if (!finalizedShift) throw new Error('El turno cerrado no pudo releerse');
            return {
                body: responseForClose(finalizedShift, metrics, theftAlert, false),
                warning,
            };
        });
    } catch (error: unknown) {
        if (
            !(error instanceof ShiftCloseError && error.code === 'CLOSE_SHIFT_CLAIM_LOST')
            && !isP2002(error)
        ) {
            throw error;
        }

        // Snapshot fresco después de abortar: el update condicional o UNIQUE
        // ya esperaron el commit del ganador en MySQL.
        const targetShift = await db.shift.findFirst({
            where: { id: input.shiftId, tenantId: context.tenantId },
            include: SHIFT_CLOSE_INCLUDE,
        });
        if (!targetShift) {
            throw new ShiftCloseError(
                'CLOSE_SHIFT_NOT_FOUND',
                404,
                'Turno no encontrado o no pertenece a tu empresa',
            );
        }
        if (!actorCanClose(targetShift, context)) {
            throw new ShiftCloseError(
                'CLOSE_SHIFT_FORBIDDEN',
                403,
                'No autorizado a cerrar este turno.',
            );
        }
        if (isExactReplay(targetShift, input, identity)) {
            return replayResult(targetShift, db.tenant, context, input);
        }

        if (targetShift.status === 'OPEN' && isP2002(error)) {
            const eventOwner = await db.shift.findFirst({
                where: { tenantId: context.tenantId, closeEventId: identity.closeEventId },
                select: { id: true },
            });
            // No disfrazar un P2002 ajeno como conflicto de cierre.
            if (!eventOwner) throw error;
        }
        throw new ShiftCloseError(
            'CLOSE_SHIFT_CONFLICT',
            409,
            'El turno ya fue cerrado con otra solicitud',
        );
    }
}
