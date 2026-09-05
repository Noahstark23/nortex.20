import { describe, expect, it, vi } from 'vitest';
import { voidManualCashMovement } from '../backend/services/manualCashMovementVoidService';

const command = { tenantId: 'tenant-a', userId: 'owner-a', role: 'ADMIN', movementId: 'movement-a', reason: 'Error de captura' };

describe('anulación manual: validación y límites del dominio', () => {
    it.each(['CASHIER', 'VIEWER', undefined])('no accede al movimiento con rol %s', async role => {
        const db: any = { cashMovement: { findFirst: vi.fn() }, $transaction: vi.fn() };
        await expect(voidManualCashMovement({ ...command, role }, db)).rejects.toMatchObject({ httpStatus: 403 });
        expect(db.cashMovement.findFirst).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each([null, [], 7, '  ', 'ab', 'x'.repeat(501)])('un motivo inválido no inicia operaciones: %j', async reason => {
        const db: any = { cashMovement: { findFirst: vi.fn() }, $transaction: vi.fn() };
        await expect(voidManualCashMovement({ ...command, reason }, db)).rejects.toMatchObject({ httpStatus: 400 });
        expect(db.cashMovement.findFirst).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('no interpreta la ausencia en el tenant como permiso para buscar globalmente', async () => {
        const db: any = { cashMovement: { findFirst: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn() };
        await expect(voidManualCashMovement(command, db)).rejects.toMatchObject({ httpStatus: 404 });
        expect(db.cashMovement.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: 'movement-a', tenantId: 'tenant-a' }, select: { shiftId: true } });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each([
        ['COBRO_CREDITO', 'CREDIT_PAYMENT_CASH_MOVEMENT_IMMUTABLE'],
        ['DEVOLUCION', 'DERIVED_CASH_MOVEMENT_IMMUTABLE'],
        ['PAGO_PROVEEDOR', 'DERIVED_CASH_MOVEMENT_IMMUTABLE'],
        ['AGENTE_BANCARIO', 'DERIVED_CASH_MOVEMENT_IMMUTABLE'],
        ['VENTA_EFECTIVO', 'DERIVED_CASH_MOVEMENT_IMMUTABLE'],
    ])('%s debe revertirse desde su documento, sin tocar caja ni mayor', async (category, code) => {
        const tx: any = {
            $queryRaw: vi.fn().mockResolvedValueOnce([{ status: 'OPEN' }]).mockResolvedValueOnce([{ id: 'movement-a' }]),
            cashMovement: {
                findFirstOrThrow: vi.fn().mockResolvedValue({ type: 'IN', category }),
                updateMany: vi.fn(),
            },
            journalEntry: { findMany: vi.fn() },
            auditLog: { create: vi.fn() },
        };
        const db: any = {
            cashMovement: { findFirst: vi.fn().mockResolvedValue({ shiftId: 'shift-a' }) },
            $transaction: vi.fn(async operation => operation(tx)),
        };
        await expect(voidManualCashMovement(command, db)).rejects.toMatchObject({ httpStatus: 409, code });
        expect(tx.cashMovement.updateMany).not.toHaveBeenCalled();
        expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
});
