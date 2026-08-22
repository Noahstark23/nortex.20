import { describe, expect, it } from 'vitest';
import {
    assertMatchingReturnReplay,
    buildReturnPayloadHash,
    ReturnResolutionError,
    type ReturnIdempotencyPayload,
} from '../backend/services/returnService';

const payload = (
    overrides: Partial<ReturnIdempotencyPayload> = {},
): ReturnIdempotencyPayload => ({
    saleId: 'sale-001',
    items: [
        { saleItemId: 'line-b', quantity: '0.5000' },
        { saleItemId: 'line-a', productId: 'product-a', quantity: '1.2500' },
    ],
    reason: 'Empaque dañado',
    refundMethod: 'CARD',
    ...overrides,
});

const captureResolutionError = (operation: () => unknown): ReturnResolutionError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(ReturnResolutionError);
        return error as ReturnResolutionError;
    }
    throw new Error('Se esperaba ReturnResolutionError');
};

describe('contrato mutacional de la idempotencia de devoluciones', () => {
    it('congela la huella v1 persistida y sus normalizaciones canónicas', () => {
        const actual = buildReturnPayloadHash(payload({
            saleId: '  sale-001  ',
            items: [
                { saleItemId: ' line-b ', quantity: 0.5 },
                { saleItemId: ' line-a ', productId: ' product-a ', quantity: '1.25' },
            ],
            reason: '  Empaque dañado  ',
        }));

        // Esta huella se persiste. El literal protege compatibilidad entre una
        // solicitud original y su retry después de desplegar otra versión.
        expect(actual).toBe('79ec8111ea53000bbe7448628d4ed74bb16014f46968a5963eb20b00892e2c60');
    });

    it('conserva la huella v1 cuando las líneas llegan en el orden canónico', () => {
        const actual = buildReturnPayloadHash(payload({
            items: [
                { saleItemId: 'line-a', productId: 'product-a', quantity: '1.25' },
                { saleItemId: 'line-b', quantity: '0.5' },
            ],
        }));

        expect(actual).toBe('79ec8111ea53000bbe7448628d4ed74bb16014f46968a5963eb20b00892e2c60');
    });

    it('normaliza identidades vacías como ausentes sin confundir identidades reales', () => {
        const withoutIdentities = buildReturnPayloadHash(payload({
            items: [{ quantity: '1.0000' }],
        }));
        const blankIdentities = buildReturnPayloadHash(payload({
            items: [{ saleItemId: '   ', productId: '   ', quantity: 1 }],
        }));

        expect(blankIdentities).toBe(withoutIdentities);
        expect(buildReturnPayloadHash(payload({
            items: [{ saleItemId: 'line-real', quantity: 1 }],
        }))).not.toBe(withoutIdentities);
        expect(buildReturnPayloadHash(payload({
            items: [{ productId: 'product-real', quantity: 1 }],
        }))).not.toBe(withoutIdentities);
    });

    it.each([
        ['saleItemId', { saleItemId: 'line-other', productId: 'product-a', quantity: '1.25' }],
        ['productId', { saleItemId: 'line-a', productId: 'product-other', quantity: '1.25' }],
    ])('incluye %s en la intención idempotente', (_field, changedLine) => {
        const original = buildReturnPayloadHash(payload({
            items: [{ saleItemId: 'line-a', productId: 'product-a', quantity: '1.25' }],
        }));

        expect(buildReturnPayloadHash(payload({ items: [changedLine] }))).not.toBe(original);
    });

    it.each([
        ['texto inválido', 'no-es-decimal', 'items.quantity no es un decimal válido'],
        ['NaN', Number.NaN, 'items.quantity debe ser finito'],
        ['infinito', Number.POSITIVE_INFINITY, 'items.quantity debe ser finito'],
    ])('rechaza cantidad %s antes de producir una huella', (_case, quantity, message) => {
        const error = captureResolutionError(() => buildReturnPayloadHash(payload({
            items: [{ saleItemId: 'line-a', quantity }],
        })));

        expect(error).toMatchObject({
            name: 'ReturnResolutionError',
            code: 'RETURN_DATA_INVALID',
            httpStatus: 409,
            message,
        });
    });

    it('expone un conflicto estable y diagnosticable para una llave reutilizada', () => {
        const error = captureResolutionError(() => assertMatchingReturnReplay(
            { payloadHash: null },
            buildReturnPayloadHash(payload()),
        ));

        expect(error).toMatchObject({
            name: 'ReturnResolutionError',
            code: 'RETURN_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
            message: 'La clave de idempotencia ya fue usada con otra devolución',
        });
    });

    it('acepta como replay únicamente la misma huella persistida', () => {
        const expectedPayloadHash = buildReturnPayloadHash(payload());

        expect(() => assertMatchingReturnReplay(
            { payloadHash: expectedPayloadHash },
            expectedPayloadHash,
        )).not.toThrow();
    });
});
