/**
 * NORTEX — Ledger Integrity (tamper-proofing del dinero)
 *
 * PRINCIPIO: nunca se firma un saldo mutable (walletBalance, corte de caja).
 * Los saldos son PROYECCIONES; lo que se firma es el LIBRO inmutable que los
 * genera (CashMovement, CapitalLoan al originarse). La verificación recorre
 * la cadena y recomputa: un UPDATE manual de `amount` en la DB rompe la firma;
 * un DELETE o INSERT manual rompe la continuidad de `seq`/`prevHash`.
 *
 * Cadena por tenant:
 *   LedgerHead(tenantId) ── UPDATE … lastSeq+1 (row-lock InnoDB) ──► serializa
 *   los appends del tenant. Cada movimiento guarda:
 *     seq       = posición monotónica
 *     prevHash  = firma del movimiento anterior ("GENESIS" para el primero)
 *     signature = HMAC(campos inmutables + seq + prevHash)
 *   y la cabeza avanza: lastHash = signature.
 *
 * La anulación (isVoided/voidReason/voidedAt/voidedBy) NO entra en la firma:
 * el hecho económico es inmutable, el void es una anotación posterior. Un
 * void fraudulento queda cubierto por el AuditLog, no por la cadena.
 *
 * Rollout: si NORTEX_LEDGER_KEYS no está configurada, los movimientos se crean
 * sin firmar (seq/prevHash/signature = null) y verifyTenantLedger los reporta
 * como `unsigned` — activación por entorno, sin migración big-bang.
 */

import { Prisma, PrismaClient, CashMovement, CapitalLoan } from '@prisma/client';
import { isLedgerSigningEnabled, signLedgerRecord, verifyLedgerRecord, LedgerFields } from './crypto';

export interface CashMovementInput {
    tenantId: string;
    shiftId: string;
    userId: string;
    type: string;
    amount: number;
    currency: string;
    category: string;
    description: string;
    expenseId: string | null;
}

/** Campos inmutables que entran en la firma de un CashMovement. */
function cashMovementSignedFields(
    m: Pick<CashMovement, 'id' | 'tenantId' | 'shiftId' | 'userId' | 'type' | 'currency' | 'category' | 'createdAt'> & {
        amount: { toFixed(n: number): string };
        seq: number;
        prevHash: string;
    }
): LedgerFields {
    return {
        id: m.id,
        tenantId: m.tenantId,
        shiftId: m.shiftId,
        userId: m.userId,
        type: m.type,
        amount: m.amount.toFixed(2),
        currency: m.currency,
        category: m.category,
        createdAt: m.createdAt.toISOString(),
        seq: m.seq,
        prevHash: m.prevHash,
    };
}

/**
 * Crea un CashMovement encadenado y firmado (o plano si la firma está
 * desactivada). DEBE llamarse dentro de una transacción interactiva.
 */
export async function appendSignedCashMovement(
    tx: Prisma.TransactionClient,
    data: CashMovementInput
): Promise<CashMovement> {
    if (!isLedgerSigningEnabled()) {
        return tx.cashMovement.create({ data });
    }

    // Asegurar la cabeza (primera vez del tenant). El upsert de Prisma no es
    // atómico en MySQL: si dos primeras-veces corren a la par, una recibe
    // P2002 — la tragamos y seguimos al UPDATE, que ya encuentra la fila.
    try {
        await tx.ledgerHead.upsert({
            where: { tenantId: data.tenantId },
            create: { tenantId: data.tenantId },
            update: {},
        });
    } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }

    // Row-lock: serializa los appends del tenant y entrega el seq sin carrera.
    const head = await tx.ledgerHead.update({
        where: { tenantId: data.tenantId },
        data: { lastSeq: { increment: 1 } },
    });
    const seq = head.lastSeq;
    const prevHash = head.lastHash;

    const created = await tx.cashMovement.create({
        data: { ...data, seq, prevHash },
    });

    const signature = signLedgerRecord(
        cashMovementSignedFields({ ...created, amount: created.amount, seq, prevHash })
    );

    const [signed] = await Promise.all([
        tx.cashMovement.update({ where: { id: created.id }, data: { signature } }),
        tx.ledgerHead.update({ where: { tenantId: data.tenantId }, data: { lastHash: signature } }),
    ]);

    return signed;
}

/** Firma los términos de origen de un CapitalLoan (post-create, misma tx). */
export async function signCapitalLoan(tx: Prisma.TransactionClient, loan: CapitalLoan): Promise<void> {
    if (!isLedgerSigningEnabled()) return;
    const signature = signLedgerRecord({
        id: loan.id,
        tenantId: loan.tenantId,
        amount: loan.amount.toFixed(2),
        interestRate: loan.interestRate.toFixed(4),
        totalDue: loan.totalDue.toFixed(2),
        dueDate: loan.dueDate.toISOString(),
        linkedPurchaseId: loan.linkedPurchaseId,
        createdAt: loan.createdAt.toISOString(),
    });
    await tx.capitalLoan.update({ where: { id: loan.id }, data: { signature } });
}

export interface LedgerVerification {
    ok: boolean;
    checked: number;
    unsigned: number;
    headSeq: number | null;
    brokenAtSeq: number | null;
    reason: string | null;
}

/**
 * Recorre la cadena del tenant: firma de cada movimiento + continuidad
 * seq/prevHash + coherencia con la cabeza. O(n) — pensado para cron nocturno
 * o verificación bajo demanda del SUPER_ADMIN.
 */
export async function verifyTenantLedger(
    prisma: PrismaClient | Prisma.TransactionClient,
    tenantId: string
): Promise<LedgerVerification> {
    const unsigned = await prisma.cashMovement.count({ where: { tenantId, seq: null } });
    const movements = await prisma.cashMovement.findMany({
        where: { tenantId, seq: { not: null } },
        orderBy: { seq: 'asc' },
    });
    const head = await prisma.ledgerHead.findUnique({ where: { tenantId } });

    let prevHash = 'GENESIS';
    let expectedSeq = 1;
    for (const m of movements) {
        if (m.seq !== expectedSeq) {
            return { ok: false, checked: movements.length, unsigned, headSeq: head?.lastSeq ?? null, brokenAtSeq: expectedSeq, reason: `Hueco en la cadena: se esperaba seq=${expectedSeq}, se encontró seq=${m.seq} (¿fila borrada?)` };
        }
        if (m.prevHash !== prevHash) {
            return { ok: false, checked: movements.length, unsigned, headSeq: head?.lastSeq ?? null, brokenAtSeq: m.seq, reason: `prevHash no coincide en seq=${m.seq} (cadena re-escrita)` };
        }
        if (!m.signature || !verifyLedgerRecord(
            cashMovementSignedFields({ ...m, amount: m.amount, seq: m.seq, prevHash: m.prevHash ?? 'GENESIS' }),
            m.signature
        )) {
            return { ok: false, checked: movements.length, unsigned, headSeq: head?.lastSeq ?? null, brokenAtSeq: m.seq, reason: `Firma inválida en seq=${m.seq} (campos alterados en DB)` };
        }
        prevHash = m.signature;
        expectedSeq += 1;
    }

    if (head && movements.length > 0 && head.lastHash !== prevHash) {
        return { ok: false, checked: movements.length, unsigned, headSeq: head.lastSeq, brokenAtSeq: movements[movements.length - 1].seq, reason: 'La cabeza (LedgerHead.lastHash) no coincide con el último movimiento (¿truncado de cola?)' };
    }

    return { ok: true, checked: movements.length, unsigned, headSeq: head?.lastSeq ?? null, brokenAtSeq: null, reason: null };
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 3 — Wallet del repartidor (Red Nortex / Real Money Protocol)
//
// Mismo principio que el libro de caja: el saldo (Motorizado.walletBalance)
// es una PROYECCIÓN; la verdad es la cadena firmada de DriverWalletMovement.
// Cada entrega acredita la comisión con un movimiento inmutable; el pago de
// Nortex al repartidor la debita. verifyDriverLedger recomputa el saldo y
// detecta cualquier manipulación directa en la DB.
// ════════════════════════════════════════════════════════════════════════════

import type { DriverWalletMovement } from '@prisma/client';

export interface DriverMovementInput {
    motorizadoId: string;
    tenantId: string | null;
    pedidoId: string | null;
    type: 'COMISION_ENTREGA' | 'PAGO_NORTEX' | 'AJUSTE';
    /** + acredita (comisión), − debita (pago al driver) */
    amount: number;
    descripcion: string;
}

/** Campos inmutables que entran en la firma de un movimiento de wallet. */
function driverMovementSignedFields(
    m: Pick<DriverWalletMovement, 'id' | 'motorizadoId' | 'type' | 'createdAt'> & {
        tenantId: string | null;
        pedidoId: string | null;
        amount: { toFixed(n: number): string };
        seq: number;
        prevHash: string;
    }
): LedgerFields {
    return {
        id: m.id,
        motorizadoId: m.motorizadoId,
        tenantId: m.tenantId,
        pedidoId: m.pedidoId,
        type: m.type,
        amount: m.amount.toFixed(2),
        createdAt: m.createdAt.toISOString(),
        seq: m.seq,
        prevHash: m.prevHash,
    };
}

/**
 * Acredita/debita el wallet del repartidor con un movimiento encadenado y
 * firmado, y actualiza la proyección (walletBalance) de forma atómica.
 * DEBE llamarse dentro de una transacción interactiva.
 *
 * Idempotencia: pedidoId @unique — si dos entregas concurrentes intentan
 * acreditar el mismo pedido, la segunda recibe P2002 y su tx aborta entera.
 */
export async function appendDriverWalletMovement(
    tx: Prisma.TransactionClient,
    input: DriverMovementInput
): Promise<DriverWalletMovement> {
    const baseData = {
        motorizadoId: input.motorizadoId,
        tenantId: input.tenantId,
        pedidoId: input.pedidoId,
        type: input.type,
        amount: input.amount,
        descripcion: input.descripcion,
    };

    let created: DriverWalletMovement;

    if (!isLedgerSigningEnabled()) {
        created = await tx.driverWalletMovement.create({ data: baseData });
    } else {
        // Asegurar la cabeza (primera vez del driver); P2002 en carrera se traga.
        try {
            await tx.driverLedgerHead.upsert({
                where: { motorizadoId: input.motorizadoId },
                create: { motorizadoId: input.motorizadoId },
                update: {},
            });
        } catch (err) {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        }

        // Row-lock: serializa los appends del driver y entrega el seq sin carrera.
        const head = await tx.driverLedgerHead.update({
            where: { motorizadoId: input.motorizadoId },
            data: { lastSeq: { increment: 1 } },
        });
        const seq = head.lastSeq;
        const prevHash = head.lastHash;

        created = await tx.driverWalletMovement.create({ data: { ...baseData, seq, prevHash } });

        const signature = signLedgerRecord(
            driverMovementSignedFields({ ...created, amount: created.amount, seq, prevHash })
        );

        const [signed] = await Promise.all([
            tx.driverWalletMovement.update({ where: { id: created.id }, data: { signature } }),
            tx.driverLedgerHead.update({ where: { motorizadoId: input.motorizadoId }, data: { lastHash: signature } }),
        ]);
        created = signed;
    }

    // Proyección del saldo — atómica, en la misma transacción que el movimiento.
    await tx.motorizado.update({
        where: { id: input.motorizadoId },
        data: { walletBalance: { increment: input.amount } },
    });

    return created;
}

export interface DriverLedgerVerification extends LedgerVerification {
    /** Saldo recomputado desde el libro vs proyección almacenada. */
    computedBalance: string;
    storedBalance: string;
    balanceMatches: boolean;
}

/**
 * Verifica la cadena del wallet del repartidor Y recomputa el saldo desde el
 * libro completo (firmados + legacy) contra la proyección walletBalance.
 */
export async function verifyDriverLedger(
    prisma: PrismaClient | Prisma.TransactionClient,
    motorizadoId: string
): Promise<DriverLedgerVerification> {
    const all = await prisma.driverWalletMovement.findMany({
        where: { motorizadoId },
        orderBy: { createdAt: 'asc' },
    });
    const head = await prisma.driverLedgerHead.findUnique({ where: { motorizadoId } });
    const motorizado = await prisma.motorizado.findUnique({
        where: { id: motorizadoId },
        select: { walletBalance: true },
    });

    // Recomputo del saldo: suma de TODO el libro (la proyección debe coincidir).
    let computed = 0;
    for (const m of all) computed += Number(m.amount);
    const computedBalance = computed.toFixed(2);
    const storedBalance = Number(motorizado?.walletBalance ?? 0).toFixed(2);
    const balanceMatches = computedBalance === storedBalance;

    const chained = all.filter((m): m is typeof m & { seq: number } => m.seq !== null)
        .sort((a, b) => a.seq - b.seq);
    const unsigned = all.length - chained.length;

    const fail = (brokenAtSeq: number, reason: string): DriverLedgerVerification => ({
        ok: false, checked: chained.length, unsigned, headSeq: head?.lastSeq ?? null,
        brokenAtSeq, reason, computedBalance, storedBalance, balanceMatches,
    });

    let prevHash = 'GENESIS';
    let expectedSeq = 1;
    for (const m of chained) {
        if (m.seq !== expectedSeq) {
            return fail(expectedSeq, `Hueco en la cadena: se esperaba seq=${expectedSeq}, se encontró seq=${m.seq} (¿fila borrada?)`);
        }
        if (m.prevHash !== prevHash) {
            return fail(m.seq, `prevHash no coincide en seq=${m.seq} (cadena re-escrita)`);
        }
        if (!m.signature || !verifyLedgerRecord(
            driverMovementSignedFields({ ...m, amount: m.amount, seq: m.seq, prevHash: m.prevHash ?? 'GENESIS' }),
            m.signature
        )) {
            return fail(m.seq, `Firma inválida en seq=${m.seq} (campos alterados en DB)`);
        }
        prevHash = m.signature;
        expectedSeq += 1;
    }

    if (head && chained.length > 0 && head.lastHash !== prevHash) {
        return fail(chained[chained.length - 1].seq, 'La cabeza (DriverLedgerHead.lastHash) no coincide con el último movimiento (¿truncado de cola?)');
    }

    return {
        ok: balanceMatches,
        checked: chained.length,
        unsigned,
        headSeq: head?.lastSeq ?? null,
        brokenAtSeq: null,
        reason: balanceMatches ? null : `Saldo proyectado (${storedBalance}) no coincide con el libro (${computedBalance}) — proyección manipulada o write fuera del helper`,
        computedBalance,
        storedBalance,
        balanceMatches,
    };
}
