import { describe, expect, it } from 'vitest';
import { buildInitialInventoryJournalLines } from '../backend/services/initialInventoryJournal';

describe('asiento de existencias iniciales', () => {
    it('abre el activo contra una cuenta por conciliar, con cuatro decimales y partida doble', () => {
        expect(buildInitialInventoryJournalLines('2.5', '3.33333')).toEqual([
            { accountCode: '1.1.4', debit: 8.3333, credit: 0 },
            { accountCode: '3.1.4', debit: 0, credit: 8.3333 },
        ]);
    });

    it('no registra un asiento de importe cero', () => {
        expect(buildInitialInventoryJournalLines('2', '0')).toEqual([]);
    });

    it.each([
        ['0', '3'], ['-1', '3'], ['Infinity', '3'], ['1', '-1'], ['1', 'Infinity'],
    ])('rechaza existencia %s y costo %s inválidos', (quantity, cost) => {
        expect(() => buildInitialInventoryJournalLines(quantity, cost)).toThrow('Existencia o costo inicial inválido');
    });
});
