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
