import { describe, expect, it } from 'vitest';
import { cashMovementJournalLines } from '../backend/services/accounting';

describe('movimientos manuales: contrapartidas contables y efectivo', () => {
    it.each([0.01, 125.75])('registra capital aportado sin inventar ingreso por ventas: %s', (amount) => {
        expect(cashMovementJournalLines('IN', 'INYECCION_CAPITAL', amount)).toEqual([
            { accountCode: '1.1.1', debit: amount, credit: 0 },
            { accountCode: '3.1.1', debit: 0, credit: amount },
        ]);
    });

    it.each([
        ['GASTO_OPERATIVO', '5.2.1'],
        ['PAGO_PROVEEDOR', '2.1.1'],
        ['RETIRO_PERSONAL', '3.1.1'],
    ])('clasifica %s y acredita solo Caja', (category, debitAccount) => {
        expect(cashMovementJournalLines('OUT', category, 72.35)).toEqual([
            { accountCode: debitAccount, debit: 72.35, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 72.35 },
        ]);
    });

    it.each(['GASTO_OPERATIVO', 'PAGO_PROVEEDOR', 'RETIRO_PERSONAL'])
        ('no convierte una entrada %s en gasto o pago', (category) => {
            expect(cashMovementJournalLines('IN', category, 72.35)).toBeNull();
        });

    it('no convierte una salida de capital en aporte', () => {
        expect(cashMovementJournalLines('OUT', 'INYECCION_CAPITAL', 72.35)).toBeNull();
    });

    it.each(['CAMBIO', 'AJUSTE', 'AGENTE_BANCARIO', 'DESCONOCIDA', ''])
        ('no duplica ni inventa contrapartidas para %s', (category) => {
            expect(cashMovementJournalLines('IN', category, 72.35)).toBeNull();
            expect(cashMovementJournalLines('OUT', category, 72.35)).toBeNull();
        });
});
