import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildPostSalePrintCash } from '../utils/postSalePrintCash';

describe('buildPostSalePrintCash', () => {
    it('conserva el recibido en efectivo aunque no haya vuelto', () => {
        expect(buildPostSalePrintCash({
            paymentMethod: 'CASH',
            cashReceived: new Decimal('140.10'),
            change: new Decimal('0'),
        })).toEqual({ cashReceived: 140.1 });
    });

    it('incluye el vuelto cuando existe de verdad', () => {
        expect(buildPostSalePrintCash({
            paymentMethod: 'CASH',
            cashReceived: '200',
            change: '59.9',
        })).toEqual({ cashReceived: 200, change: 59.9 });
    });

    it('redondea recibido y vuelto a centavos para la impresión', () => {
        expect(buildPostSalePrintCash({
            paymentMethod: 'CASH',
            cashReceived: '100.125',
            change: '0.125',
        })).toEqual({ cashReceived: 100.13, change: 0.13 });
    });

    it('conserva el recibido cuando el vuelto falta o no es positivo', () => {
        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: '100' })).toEqual({ cashReceived: 100 });
        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: '100', change: '-1' })).toEqual({ cashReceived: 100 });
        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: '100', change: 'invalido' })).toEqual({ cashReceived: 100 });
    });

    it('omite datos de efectivo en pagos no efectivos o inválidos', () => {
        expect(buildPostSalePrintCash({
            paymentMethod: 'CARD',
            cashReceived: '200',
            change: '59.9',
        })).toEqual({});

        expect(buildPostSalePrintCash({
            paymentMethod: 'CASH',
            cashReceived: '',
            change: '10',
        })).toEqual({});

        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: '0', change: '0' })).toEqual({});
        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: '-1', change: '0' })).toEqual({});
        expect(buildPostSalePrintCash({ paymentMethod: 'CASH', cashReceived: null, change: '0' })).toEqual({});
    });
});
