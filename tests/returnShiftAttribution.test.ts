import { describe, expect, it } from 'vitest';
import {
    resolveReturnShiftAttribution,
    ReturnShiftAttributionError,
} from '../backend/lib/returnShiftAttribution';

type Shift = {
    id: string;
    initialCash: string;
    initialCashUsd: string;
};

const shift = (id: string): Shift => ({
    id,
    initialCash: '100.00',
    initialCashUsd: '0.00',
});

const captureError = (operation: () => unknown): ReturnShiftAttributionError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(ReturnShiftAttributionError);
        return error as ReturnShiftAttributionError;
    }
    throw new Error('Se esperaba ReturnShiftAttributionError');
};

describe('atribución de devoluciones al cierre Z', () => {
    it('atribuye una devolución no efectiva solo al turno propio', () => {
        const own = shift('shift-own');
        const result = resolveReturnShiftAttribution({
            ownOpenShifts: [own],
            tenantOpenShifts: [shift('shift-other-user')],
            requiresCashDrawer: false,
        });

        expect(result).toEqual({
            processingShift: own,
            processedShiftId: 'shift-own',
            refundShiftId: null,
            source: 'OWN',
        });
    });

    it('rechaza atribuir una devolución no efectiva al único turno de otro usuario', () => {
        const error = captureError(() => resolveReturnShiftAttribution({
            ownOpenShifts: [],
            tenantOpenShifts: [shift('shift-other-user')],
            requiresCashDrawer: false,
        }));

        expect(error).toMatchObject({
            code: 'RETURN_OPEN_SHIFT_REQUIRED',
            httpStatus: 409,
        });
    });

    it('rechaza múltiples turnos propios en vez de elegir el más reciente', () => {
        const error = captureError(() => resolveReturnShiftAttribution({
            ownOpenShifts: [shift('shift-own-a'), shift('shift-own-b')],
            tenantOpenShifts: [],
            requiresCashDrawer: false,
        }));

        expect(error).toMatchObject({
            code: 'RETURN_OPEN_SHIFT_AMBIGUOUS',
            httpStatus: 409,
        });
    });

    it('prefiere el turno propio para CASH y alinea processedShiftId con refundShiftId', () => {
        const own = shift('shift-own');
        const result = resolveReturnShiftAttribution({
            ownOpenShifts: [own],
            tenantOpenShifts: [shift('shift-other-a'), shift('shift-other-b')],
            requiresCashDrawer: true,
        });

        expect(result.processedShiftId).toBe('shift-own');
        expect(result.refundShiftId).toBe('shift-own');
        expect(result.source).toBe('OWN');
    });

    it('permite CASH en el único cajón abierto del tenant cuando no hay turno propio', () => {
        const fallback = shift('shift-only-drawer');
        const result = resolveReturnShiftAttribution({
            ownOpenShifts: [],
            tenantOpenShifts: [fallback],
            requiresCashDrawer: true,
        });

        expect(result).toEqual({
            processingShift: fallback,
            processedShiftId: 'shift-only-drawer',
            refundShiftId: 'shift-only-drawer',
            source: 'TENANT_FALLBACK',
        });
    });

    it('rechaza CASH cuando el fallback físico es cero o ambiguo', () => {
        const missing = captureError(() => resolveReturnShiftAttribution({
            ownOpenShifts: [],
            tenantOpenShifts: [],
            requiresCashDrawer: true,
        }));
        const ambiguous = captureError(() => resolveReturnShiftAttribution({
            ownOpenShifts: [],
            tenantOpenShifts: [shift('shift-a'), shift('shift-b')],
            requiresCashDrawer: true,
        }));

        expect(missing.code).toBe('RETURN_OPEN_SHIFT_REQUIRED');
        expect(ambiguous.code).toBe('RETURN_OPEN_SHIFT_AMBIGUOUS');
    });
});
