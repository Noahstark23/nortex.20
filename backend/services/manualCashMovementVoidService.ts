import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { fiscalCivilDate } from '../lib/fiscalAccess';
import { buildJournalPayloadHash, JournalPostingError, reverseJournalOnce, type JournalPostingDatabase } from './journalPosting';

const allowedRoles = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER']);
const allowedCategories = {
    IN: new Set(['INYECCION_CAPITAL', 'CAMBIO', 'AJUSTE']),
    OUT: new Set(['GASTO_OPERATIVO', 'RETIRO_PERSONAL', 'CAMBIO', 'AJUSTE']),
};
const commandSchema = z.object({
    movementId: z.string().trim().min(1).max(191),
    reason: z.string().trim().min(3, 'Razón de anulación requerida (mínimo 3 caracteres).').max(500),
});

export class ManualCashMovementVoidError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
        super(message);
        this.name = 'ManualCashMovementVoidError';
    }
}

type Command = {
    tenantId: string;
    userId: string;
    role?: string;
    movementId: unknown;
    reason: unknown;
};
type Database = Pick<PrismaClient, '$transaction' | 'cashMovement'>;
const conflict = (code: string, message: string): never => { throw new ManualCashMovementVoidError(code, 409, message); };

/** El reverso usa la transacción de caja. Nunca abre otra conexión ni confirma
 * un asiento antes de que se confirme su movimiento, gasto y auditoría. */
function journalDatabase(tx: Prisma.TransactionClient): JournalPostingDatabase {
    return {
        user: tx.user,
        journalEntry: tx.journalEntry,
        $transaction: async operation => operation(tx),
    };
}

async function lockOpenPeriods(tx: Prisma.TransactionClient, tenantId: string, dates: Date[]) {
    const periods = [...new Set(dates.map(date => fiscalCivilDate(date).period))].sort();
    for (const period of periods) {
        const [year, month] = period.split('-').map(Number);
        const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
            SELECT status FROM FiscalPeriod
            WHERE tenantId = ${tenantId} AND year = ${year} AND month = ${month}
            FOR UPDATE
        `);
        if (rows.some(row => row.status === 'CLOSED')) {
            throw new ManualCashMovementVoidError('CASH_VOID_PERIOD_LOCKED', 423, `El período ${period} está cerrado.`);
        }
    }
}

export async function voidManualCashMovement(command: Command, db: Database = prisma, now = () => new Date()) {
    if (!command.tenantId || !command.userId) throw new ManualCashMovementVoidError('CASH_VOID_IDENTITY_REQUIRED', 401, 'Sesión inválida.');
    if (!allowedRoles.has(command.role || '')) throw new ManualCashMovementVoidError('CASH_VOID_FORBIDDEN', 403, 'Solo el dueño o gerente puede anular movimientos.');
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) throw new ManualCashMovementVoidError('CASH_VOID_INVALID_INPUT', 400, parsed.error.issues[0].message);
    const { movementId, reason } = parsed.data;
    const { tenantId, userId } = command;
    const preview = await db.cashMovement.findFirst({ where: { id: movementId, tenantId }, select: { shiftId: true } });
    if (!preview) throw new ManualCashMovementVoidError('CASH_MOVEMENT_NOT_FOUND', 404, 'Movimiento no encontrado.');
    const identity = createHash('sha256').update(`${tenantId}\u0000${movementId}`).digest('hex');
    const auditId = `mcv-audit-${identity}`;

    try {
        return await db.$transaction(async tx => {
            // Mismo orden que creación/venta/cierre: turno primero. La lectura
            // inicial solo localiza la fila; toda decisión usa la relectura bajo lock.
            const shifts = await tx.$queryRaw<Array<{ status: string; initialCash: Prisma.Decimal; initialCashUsd: Prisma.Decimal }>>(Prisma.sql`
                SELECT status, initialCash, initialCashUsd FROM Shift
                WHERE id = ${preview.shiftId} AND tenantId = ${tenantId} LIMIT 1 FOR UPDATE
            `);
            const shift = shifts[0];
            const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id FROM CashMovement WHERE id = ${movementId} AND tenantId = ${tenantId} LIMIT 1 FOR UPDATE
            `);
            if (!shift || locked.length !== 1) throw new ManualCashMovementVoidError('CASH_MOVEMENT_NOT_FOUND', 404, 'Movimiento no encontrado.');
            const movement = await tx.cashMovement.findFirstOrThrow({ where: { id: movementId, tenantId, shiftId: preview.shiftId } });
            if (movement.category === 'COBRO_CREDITO') {
                conflict('CREDIT_PAYMENT_CASH_MOVEMENT_IMMUTABLE', 'Este movimiento pertenece a un abono. Revertí el abono desde cobranza.');
            }
            if (!allowedCategories[movement.type as keyof typeof allowedCategories]?.has(movement.category)) {
                conflict('DERIVED_CASH_MOVEMENT_IMMUTABLE', 'Este movimiento pertenece a otro flujo. Revertí el documento que lo originó.');
            }
            const actor = await tx.user.findFirst({ where: { id: userId, tenantId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new ManualCashMovementVoidError('CASH_VOID_FORBIDDEN', 403, 'Usuario no autorizado.');

            if (movement.isVoided) {
                const audit = await tx.auditLog.findFirst({ where: { id: auditId, tenantId, action: 'CASH_MOVEMENT_VOIDED' } });
                let saved: any;
                try { saved = audit ? JSON.parse(audit.details) : null; } catch { saved = null; }
                if (!saved || saved.version !== 1 || saved.movementId !== movementId || saved.reason !== reason || movement.voidReason !== reason) {
                    conflict('CASH_VOID_REPLAY_CONFLICT', 'El movimiento ya fue anulado con otra solicitud o requiere conciliación histórica.');
                }
                return { ...movement, reversalJournalId: saved.reversalJournalId, compensatingExpenseId: saved.compensatingExpenseId, idempotentReplay: true };
            }
            if (shift.status !== 'OPEN') conflict('CASH_VOID_SHIFT_CLOSED', 'La caja está cerrada. No se puede alterar su arqueo.');
            if (!['NIO', 'USD'].includes(movement.currency)) conflict('CASH_VOID_UNKNOWN_CURRENCY', 'La moneda del movimiento requiere conciliación.');
            const reversedAt = now();
            const originals = await tx.journalEntry.findMany({
                where: { tenantId, referenceId: movementId, referenceType: movement.type === 'IN' ? 'CASH_IN' : 'CASH_OUT', entryKind: 'ORIGINAL' },
                include: { lines: { orderBy: { id: 'asc' }, take: 501 } }, take: 2,
            });
            const requiresJournal = !['CAMBIO', 'AJUSTE'].includes(movement.category);
            if (originals.length > 1 || (requiresJournal && originals.length !== 1)) {
                conflict('CASH_VOID_JOURNAL_RECONCILIATION_REQUIRED', 'No hay un asiento original inequívoco. Conciliá este movimiento antes de anularlo.');
            }
            const original = originals[0];
            if (original && await tx.journalEntry.findFirst({ where: { tenantId, reversalOfId: original.id }, select: { id: true } })) {
                conflict('CASH_VOID_JOURNAL_RECONCILIATION_REQUIRED', 'El asiento ya tiene un reverso. Conciliá el movimiento antes de anularlo.');
            }
            const expense = movement.expenseId
                ? await tx.expense.findFirst({ where: { id: movement.expenseId, tenantId } })
                : null;
            const needsExpense = movement.type === 'OUT' && movement.category === 'GASTO_OPERATIVO';
            if (needsExpense !== Boolean(expense) || (expense && !new Decimal(expense.amount.toString()).equals(movement.amount.toString()))) {
                conflict('CASH_VOID_EXPENSE_RECONCILIATION_REQUIRED', 'El gasto enlazado no coincide con el movimiento. Requiere conciliación.');
            }
            await lockOpenPeriods(tx, tenantId, [
                movement.createdAt, reversedAt,
                ...(original ? [original.date, original.economicDate ?? original.date] : []),
                ...(expense ? [expense.createdAt] : []),
            ]);

            // Quitar una entrada consumida no puede dejar efectivo negativo.
            if (movement.type === 'IN') {
                const cashSales = await tx.sale.aggregate({
                    where: { tenantId, shiftId: movement.shiftId, paymentMethod: 'CASH', status: { not: 'VOIDED' }, cancelledAt: null },
                    _sum: { total: true, storeCreditApplied: true },
                });
                const groups = await tx.cashMovement.groupBy({
                    by: ['type'], where: { tenantId, shiftId: movement.shiftId, currency: movement.currency, isVoided: false }, _sum: { amount: true },
                });
                let available = new Decimal((movement.currency === 'USD' ? shift.initialCashUsd : shift.initialCash).toString());
                if (movement.currency === 'NIO') available = available.plus(cashSales._sum.total?.toString() ?? 0).minus(cashSales._sum.storeCreditApplied?.toString() ?? 0);
                for (const group of groups) {
                    const amount = new Decimal(group._sum.amount?.toString() ?? 0);
                    available = group.type === 'IN' ? available.plus(amount) : available.minus(amount);
                }
                if (available.lessThan(movement.amount.toString())) conflict('CASH_VOID_INSUFFICIENT_BALANCE', 'La entrada ya fue consumida; anularla dejaría la caja con saldo negativo.');
            }

            const claimed = await tx.cashMovement.updateMany({
                where: { id: movementId, tenantId, shiftId: preview.shiftId, isVoided: false },
                data: { isVoided: true, voidReason: reason, voidedBy: userId, voidedAt: reversedAt },
            });
            if (claimed.count !== 1) conflict('CASH_VOID_CONCURRENT_WRITE', 'El movimiento cambió; intentá nuevamente.');

            let reversalJournalId: string | null = null;
            if (original) {
                const description = `Anulación de movimiento de caja ${movementId}: ${reason}`;
                const economicDate = original.economicDate ?? original.date;
                const payloadHash = buildJournalPayloadHash({
                    tenantId, economicDate, postingDate: reversedAt, description,
                    referenceId: original.id, referenceType: 'JOURNAL_REVERSAL', isAutomatic: true,
                    entryKind: 'REVERSAL', reversalOfId: original.id,
                    lines: original.lines.map(line => ({ accountId: line.accountId, debit: line.credit.toString(), credit: line.debit.toString() })),
                });
                const reversal = await reverseJournalOnce({
                    db: journalDatabase(tx), tenantId, userId, originalEntryId: original.id,
                    postingKey: `mcv-journal-${identity}`, payloadHash, economicDate,
                    postingDate: reversedAt, postedAt: reversedAt, description,
                });
                if (reversal.idempotentReplay) conflict('CASH_VOID_JOURNAL_RECONCILIATION_REQUIRED', 'El asiento ya fue revertido por otra operación.');
                reversalJournalId = reversal.entry.id;
            }
            let compensatingExpenseId: string | null = null;
            if (expense) {
                const compensation = await tx.expense.create({ data: {
                    id: `mcv-exp-${identity}`, tenantId,
                    amount: new Decimal(expense.amount.toString()).negated().toFixed(2),
                    category: expense.category, createdAt: reversedAt,
                    description: `[ANULACIÓN CAJA ${movementId}] ${reason}`,
                } });
                compensatingExpenseId = compensation.id;
            }
            await tx.auditLog.create({ data: {
                id: auditId, tenantId, userId, action: 'CASH_MOVEMENT_VOIDED', createdAt: reversedAt,
                details: JSON.stringify({
                    version: 1, movementId, reason, originalJournalId: original?.id ?? null,
                    reversalJournalId, originalExpenseId: expense?.id ?? null, compensatingExpenseId,
                    before: { isVoided: false, amount: movement.amount.toFixed(2), currency: movement.currency, category: movement.category, shiftId: movement.shiftId },
                    after: { isVoided: true, voidedAt: reversedAt.toISOString(), voidedBy: userId },
                }),
            } });
            const updated = await tx.cashMovement.findFirstOrThrow({ where: { id: movementId, tenantId } });
            return { ...updated, reversalJournalId, compensatingExpenseId, idempotentReplay: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof JournalPostingError) throw new ManualCashMovementVoidError(error.code, error.httpStatus, error.message);
        if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) {
            conflict('CASH_VOID_CONCURRENT_WRITE', 'Otra operación está procesando este movimiento. Reintentá con el mismo motivo.');
        }
        throw error;
    }
}
