import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertMatchingSupplierPaymentReplay,
    buildSupplierPaymentPayloadHash,
    createLegacySupplierPaymentEventId,
    normalizeSupplierPaymentRequest,
    resolveEffectiveSupplierBalance,
    resolveSupplierPaymentPlan,
    SupplierPaymentError,
    type SupplierPaymentMethod,
    type SupplierPaymentRequest,
} from '../lib/supplierPayments';
import { recordSupplierPayment } from './accounting';
import {
    MENSAJE_SIN_CAJA_ABIERTA,
    registrarSalidaDeCajaPorAbonoProveedor,
    type DebitoDeGaveta,
    type PagoProveedorDeps,
} from './supplierPayment';

type PrismaTx = Prisma.TransactionClient;
type SupplierPaymentReader = Pick<PrismaTx, 'supplierPayment'>;

interface LockedPurchase {
    id: string;
    tenantId: string;
    supplierId: string;
    invoiceNumber: string;
    total: Decimal.Value;
    balanceDue: Decimal.Value | null;
    status: string;
    paymentMethod: string;
    documentStatus: string;
    paymentHold: boolean | number;
    paidAt: Date | null;
    settledAt: Date | null;
}

interface ExistingSupplierPayment {
    id: string;
    tenantId: string;
    purchaseId: string;
    supplierId: string;
    clientEventId: string;
    payloadHash: string;
    amount: Decimal.Value;
    method: string;
    reference: string | null;
    notes: string | null;
    paidAt: Date;
    createdBy: string;
    createdAt: Date;
    purchase: {
        id: string;
        supplierId: string;
        total: Decimal.Value;
        balanceDue: Decimal.Value | null;
        status: string;
        paymentMethod: string;
        paidAt: Date | null;
        settledAt: Date | null;
    };
}

export interface SupplierPaymentResult {
    purchase: {
        id: string;
        supplierId: string;
        total: string;
        balanceDue: string;
        status: string;
        paymentMethod: string;
        paidAt: string | null;
        settledAt: string | null;
    };
    payment: {
        id: string;
        purchaseId: string;
        supplierId: string;
        clientEventId: string;
        amount: string;
        method: SupplierPaymentMethod;
        reference: string | null;
        notes: string | null;
        paidAt: string;
        createdBy: string;
        createdAt: string;
    };
    replay: boolean;
}

export interface ExecuteSupplierPaymentInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    purchaseId: string;
    request?: SupplierPaymentRequest;
    /**
     * Turno abierto del que sale el efectivo cuando el abono es en CASH. Lo
     * resuelve el caller ANTES de abrir la transacción (mismo turno que ve la
     * píldora del POS) y acá se re-lee bajo row-lock. `null` con method CASH
     * es un 409 explícito: falta abrir caja, no "falta saldo".
     */
    shiftId?: string | null;
    /** Solo para pruebas deterministas; producción usa el reloj del proceso. */
    now?: Date;
    /** Inyectables solo para pruebas: la salida de gaveta firmada. */
    cajaDeps?: PagoProveedorDeps;
}

export interface ExecuteSupplierPaymentTransactionInput
    extends Omit<ExecuteSupplierPaymentInput, 'tx'> {
    /** Cliente compartido del proceso; el wrapper nunca instancia PrismaClient. */
    db: PrismaClient;
}

const asIsoString = (value: Date): string => value.toISOString();

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const findPaymentByClientEvent = async (
    tx: SupplierPaymentReader,
    tenantId: string,
    clientEventId: string,
): Promise<ExistingSupplierPayment | null> => tx.supplierPayment.findFirst({
    where: { tenantId, clientEventId },
    include: {
        purchase: {
            select: {
                id: true,
                supplierId: true,
                total: true,
                balanceDue: true,
                status: true,
                paymentMethod: true,
                paidAt: true,
                settledAt: true,
            },
        },
    },
}) as Promise<ExistingSupplierPayment | null>;

const serializeExistingPayment = (
    existing: ExistingSupplierPayment,
    replay: boolean,
): SupplierPaymentResult => {
    const purchaseBalance = resolveEffectiveSupplierBalance(existing.purchase);
    return {
        purchase: {
            id: existing.purchase.id,
            supplierId: existing.purchase.supplierId,
            total: new Decimal(existing.purchase.total).toString(),
            balanceDue: purchaseBalance.toString(),
            status: existing.purchase.status,
            paymentMethod: existing.purchase.paymentMethod,
            paidAt: existing.purchase.paidAt ? asIsoString(existing.purchase.paidAt) : null,
            settledAt: existing.purchase.settledAt ? asIsoString(existing.purchase.settledAt) : null,
        },
        payment: {
            id: existing.id,
            purchaseId: existing.purchaseId,
            supplierId: existing.supplierId,
            clientEventId: existing.clientEventId,
            amount: new Decimal(existing.amount).toString(),
            method: existing.method as SupplierPaymentMethod,
            reference: existing.reference,
            notes: existing.notes,
            paidAt: asIsoString(existing.paidAt),
            createdBy: existing.createdBy,
            createdAt: asIsoString(existing.createdAt),
        },
        replay,
    };
};

const assertReplayOrThrow = (
    existing: ExistingSupplierPayment,
    expectedPayloadHash: string,
): SupplierPaymentResult => {
    assertMatchingSupplierPaymentReplay(existing, expectedPayloadHash);
    return serializeExistingPayment(existing, true);
};

/**
 * Registra un abono a proveedor dentro de la transacción entregada por el
 * caller. El lock, subledger, billetera, asiento, saldo y auditoría viven en
 * esa misma transacción; este servicio nunca crea Expense.
 */
export async function executeSupplierPayment({
    tx,
    tenantId,
    userId,
    purchaseId,
    request = {},
    shiftId = null,
    now = new Date(),
    cajaDeps,
}: ExecuteSupplierPaymentInput): Promise<SupplierPaymentResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedPurchaseId = purchaseId.trim();
    const scopedShiftId = shiftId?.trim() || null;
    if (!scopedTenantId || !scopedUserId || !scopedPurchaseId) {
        throw new SupplierPaymentError(
            'INVALID_PAYMENT_CONTEXT',
            400,
            'tenantId, userId y purchaseId son obligatorios',
        );
    }
    if (Number.isNaN(now.getTime())) {
        throw new SupplierPaymentError('INVALID_PAYMENT_DATE', 400, 'La fecha del pago no es válida');
    }

    const normalizedRequest = normalizeSupplierPaymentRequest(request);
    const payloadHash = buildSupplierPaymentPayloadHash(scopedPurchaseId, request);
    const suppliedClientEventId = normalizedRequest.clientEventId;

    // Replay rápido: permite reintentar aun después de que el primer request
    // dejó la compra COMPLETED. La llave y la lectura siguen aisladas por tenant.
    if (suppliedClientEventId) {
        const existing = await findPaymentByClientEvent(tx, scopedTenantId, suppliedClientEventId);
        if (existing) return assertReplayOrThrow(existing, payloadHash);
    }

    // SQL parametrizado: el tenant viene del contexto autenticado del caller y
    // forma parte del mismo predicado que toma el lock de la compra.
    const rows = await tx.$queryRaw<LockedPurchase[]>(Prisma.sql`
        SELECT
            \`id\`,
            \`tenantId\`,
            \`supplierId\`,
            \`invoiceNumber\`,
            \`total\`,
            \`balanceDue\`,
            \`status\`,
            \`paymentMethod\`,
            \`documentStatus\`,
            \`paymentHold\`,
            \`paidAt\`,
            \`settledAt\`
        FROM \`Purchase\`
        WHERE \`id\` = ${scopedPurchaseId}
          AND \`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new SupplierPaymentError('PURCHASE_NOT_FOUND', 404, 'Compra no encontrada');
    }
    const purchase = rows[0];
    if (purchase.documentStatus !== 'POSTED') {
        throw new SupplierPaymentError(
            'PURCHASE_DOCUMENT_NOT_POSTED',
            409,
            'La factura no está posteada y no admite pagos',
        );
    }
    if (purchase.paymentHold === true || purchase.paymentHold === 1) {
        throw new SupplierPaymentError(
            'PURCHASE_PAYMENT_ON_HOLD',
            409,
            'La factura tiene una conciliación pendiente y no admite pagos todavía',
        );
    }
    if (purchase.paymentMethod.trim().toUpperCase() === 'NORTEX_CAPITAL') {
        throw new SupplierPaymentError(
            'CAPITAL_PURCHASE_NOT_PAYABLE',
            409,
            'Esta compra se liquida mediante su préstamo de Nortex Capital',
        );
    }

    // La segunda lectura cierra la ventana entre el replay rápido y el lock.
    if (suppliedClientEventId) {
        const existing = await findPaymentByClientEvent(tx, scopedTenantId, suppliedClientEventId);
        if (existing) return assertReplayOrThrow(existing, payloadHash);
    }

    const plan = resolveSupplierPaymentPlan(
        purchase,
        normalizedRequest.amount,
        suppliedClientEventId !== null,
    );
    const persistedClientEventId = suppliedClientEventId ?? createLegacySupplierPaymentEventId();

    let createdPayment: Awaited<ReturnType<PrismaTx['supplierPayment']['create']>>;
    try {
        // Crear primero asegura que un P2002 nunca ocurre después de mover
        // billetera, mayor o saldo de la compra.
        createdPayment = await tx.supplierPayment.create({
            data: {
                tenantId: scopedTenantId,
                purchaseId: purchase.id,
                supplierId: purchase.supplierId,
                clientEventId: persistedClientEventId,
                payloadHash,
                amount: plan.amount,
                method: normalizedRequest.method,
                reference: normalizedRequest.reference,
                notes: normalizedRequest.notes,
                paidAt: now,
                createdBy: scopedUserId,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error) || !suppliedClientEventId) throw error;
        const existing = await findPaymentByClientEvent(tx, scopedTenantId, suppliedClientEventId);
        if (!existing) throw error;
        return assertReplayOrThrow(existing, payloadHash);
    }

    // EL EFECTIVO SALE DE LA GAVETA, NO DE LA BILLETERA FINTECH.
    //
    // Hasta acá este bloque debitaba `Tenant.walletBalance` — el saldo de
    // Nortex Capital, que se fondea con /api/loans/request y que ninguna
    // ferretería tiene en cero coma algo. Resultado: TODO abono en efectivo a
    // un proveedor moría con "No hay suficiente efectivo disponible" aunque la
    // gaveta estuviera llena, y la CxP quedaba abierta para siempre.
    //
    // ORDEN DE BLOQUEO: Purchase (el FOR UPDATE de arriba) → Shift. El turno
    // siempre se toma ÚLTIMO, igual que en /api/purchases (Supplier → Product
    // → Shift) y en /api/returns (Sale → Product → Shift). Adelantarlo
    // invertiría el orden y abriría un deadlock con esas dos transacciones.
    let debitoDeGaveta: DebitoDeGaveta | null = null;
    if (normalizedRequest.method === 'CASH') {
        if (!scopedShiftId) {
            throw new SupplierPaymentError('NO_OPEN_SHIFT', 409, MENSAJE_SIN_CAJA_ABIERTA);
        }
        debitoDeGaveta = await registrarSalidaDeCajaPorAbonoProveedor(
            tx,
            {
                tenantId: scopedTenantId,
                userId: scopedUserId,
                shiftId: scopedShiftId,
                invoiceNumber: purchase.invoiceNumber,
                monto: plan.amount,
            },
            cajaDeps,
        );
    }

    await recordSupplierPayment(
        tx,
        scopedTenantId,
        scopedUserId,
        createdPayment.id,
        plan.amount,
        normalizedRequest.method,
        now,
    );

    const purchaseUpdate = await tx.purchase.updateMany({
        where: { id: purchase.id, tenantId: scopedTenantId },
        data: {
            balanceDue: plan.remainingBalance,
            status: plan.nextStatus,
            paidAt: plan.paidInFull ? now : null,
            settledAt: plan.paidInFull ? now : null,
        },
    });
    if (purchaseUpdate.count !== 1) {
        throw new SupplierPaymentError(
            'PURCHASE_CONCURRENT_UPDATE_FAILED',
            409,
            'No se pudo actualizar el saldo bloqueado de la compra',
        );
    }

    await tx.auditLog.create({
        data: {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            action: 'SUPPLIER_PAYMENT_CREATED',
            details: JSON.stringify({
                purchaseId: purchase.id,
                supplierId: purchase.supplierId,
                paymentId: createdPayment.id,
                before: {
                    status: purchase.status,
                    balanceDue: plan.previousBalance.toFixed(4),
                    paidAt: purchase.paidAt?.toISOString() ?? null,
                    settledAt: purchase.settledAt?.toISOString() ?? null,
                    balanceWasMaterialized: purchase.balanceDue !== null,
                },
                after: {
                    status: plan.nextStatus,
                    balanceDue: plan.remainingBalance.toFixed(4),
                    paidAt: plan.paidInFull ? now.toISOString() : null,
                    settledAt: plan.paidInFull ? now.toISOString() : null,
                },
                payment: {
                    amount: plan.amount.toFixed(4),
                    method: normalizedRequest.method,
                    hasReference: normalizedRequest.reference !== null,
                    idempotencySource: suppliedClientEventId ? 'CLIENT' : 'LEGACY_BODYLESS',
                },
                caja: debitoDeGaveta
                    ? {
                        shiftId: scopedShiftId,
                        cashMovementId: debitoDeGaveta.movimientoId,
                        expenseId: debitoDeGaveta.expenseId,
                        efectivoAntes: debitoDeGaveta.efectivoAntes.toFixed(2),
                        efectivoDespues: debitoDeGaveta.efectivoDespues.toFixed(2),
                    }
                    : null,
            }),
        },
    });

    const created = createdPayment as typeof createdPayment & {
        amount: Decimal.Value;
        method: string;
        reference: string | null;
        notes: string | null;
        paidAt: Date;
        createdAt: Date;
    };
    return {
        purchase: {
            id: purchase.id,
            supplierId: purchase.supplierId,
            total: new Decimal(purchase.total).toString(),
            balanceDue: plan.remainingBalance.toString(),
            status: plan.nextStatus,
            paymentMethod: purchase.paymentMethod,
            paidAt: plan.paidInFull ? now.toISOString() : null,
            settledAt: plan.paidInFull ? now.toISOString() : null,
        },
        payment: {
            id: created.id,
            purchaseId: created.purchaseId,
            supplierId: created.supplierId,
            clientEventId: created.clientEventId,
            amount: new Decimal(created.amount).toString(),
            method: created.method as SupplierPaymentMethod,
            reference: created.reference,
            notes: created.notes,
            paidAt: asIsoString(created.paidAt),
            createdBy: created.createdBy,
            createdAt: asIsoString(created.createdAt),
        },
        replay: false,
    };
}

/**
 * Frontera recomendada para rutas HTTP. Un P2002 por clientEventId puede no ser
 * visible dentro del snapshot REPEATABLE READ que perdió la carrera; por eso la
 * relectura final ocurre después del rollback, usando un snapshot fresco.
 */
export async function executeSupplierPaymentTransaction({
    db,
    tenantId,
    userId,
    purchaseId,
    request = {},
    shiftId = null,
    now,
    cajaDeps,
}: ExecuteSupplierPaymentTransactionInput): Promise<SupplierPaymentResult> {
    try {
        return await db.$transaction(
            (tx) => executeSupplierPayment({
                tx,
                tenantId,
                userId,
                purchaseId,
                request,
                shiftId,
                now,
                cajaDeps,
            }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        const normalizedRequest = normalizeSupplierPaymentRequest(request);
        const concurrentStateError = error instanceof SupplierPaymentError
            && ['PURCHASE_ALREADY_PAID', 'PAYMENT_EXCEEDS_BALANCE'].includes(error.code);
        if (
            (!isUniqueConstraintError(error) && !concurrentStateError)
            || !normalizedRequest.clientEventId
        ) throw error;

        const existing = await findPaymentByClientEvent(
            db,
            tenantId.trim(),
            normalizedRequest.clientEventId,
        );
        if (!existing) throw error;
        return assertReplayOrThrow(
            existing,
            buildSupplierPaymentPayloadHash(purchaseId.trim(), request),
        );
    }
}
