import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { totalIssues } from '../backend/services/assistant/proposalValidation';
import { purchasePayloadHash } from '../backend/services/purchaseRegistrationAuthority';
import type { InvoiceDraft } from '../shared/assistant';

const draft = (overrides: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
    currency: 'NIO', invoiceNumber: 'FAC-MUTATION', date: '2026-09-05', receivedConfirmed: true,
    paymentConfirmed: false, paymentMethod: 'CREDIT', documentTotal: '23.00', warnings: [],
    items: [], ...overrides,
});

describe('dinero nuevo de NortexGPT — oráculos independientes', () => {
    // Importar dentro del caso también convierte un fallo de inicialización de la
    // reserva en un test fallido; el runner de mutación no cuenta suites sin casos.
    it('inicializa la reserva máxima con el mismo costo exacto de sus límites', async () => {
        const { MAX_EXTRACTION_RESERVATION_USD } = await import('../backend/services/assistant/budget');
        expect(MAX_EXTRACTION_RESERVATION_USD).toBe('0.281920');
    });

    it.each([
        [0, 0, '0.000000'], [1, 0, '0.000001'], [0, 1, '0.000005'],
        [1_000_000, 0, '1.000000'], [0, 1_000_000, '5.000000'],
        [1_000, 1_000, '0.006000'], [200_000, 16_384, '0.281920'],
        [9_007_199_254_740_991, 0, '9007199254.740991'],
    ])('entrada %s y salida %s cuestan USD %s', async (input, output, expected) => {
        const { tokenCostUsd } = await import('../backend/services/assistant/budget');
        expect(tokenCostUsd(input as number, output as number)).toBe(expected);
    });

    it.each([-1, -0.1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])
    ('rechaza consumo inválido %s independientemente en entrada y salida', async value => {
        const { tokenCostUsd } = await import('../backend/services/assistant/budget');
        for (const pair of [[value, 1], [1, value]]) {
            let error: unknown;
            try { tokenCostUsd(pair[0] as number, pair[1] as number); } catch (caught) { error = caught; }
            expect(error).toMatchObject({ code: 'USAGE_INVALID', message: 'El consumo recibido no es válido.', status: 503, statusCode: 503 });
        }
    });

    it('compara centavos sin confundir representación decimal con diferencias', () => {
        expect(totalIssues(draft({ documentSubtotal: '20', documentTax: '3', documentTotal: '23.0' }),
            { subtotal: '20.00', tax: '3.00', total: '23.00' })).toEqual([]);
        expect(totalIssues(draft(), { subtotal: '20.00', tax: '3.00', total: '23.00' })).toEqual([]);
        expect(totalIssues(draft({ documentSubtotal: '', documentTax: '' }),
            { subtotal: '20.00', tax: '3.00', total: '23.00' })).toEqual([]);
    });

    it('detalla por separado subtotal, IVA y total diferentes en el orden de revisión', () => {
        expect(totalIssues(draft({ documentSubtotal: '19.99', documentTax: '2.99', documentTotal: '22.98' }),
            { subtotal: '20.00', tax: '3.00', total: '23.00' })).toEqual([
                'El subtotal del documento (19.99) difiere del cálculo de Nortex (20.00). Revisá los datos.',
                'El IVA del documento (2.99) difiere del cálculo de Nortex (3.00). Revisá los datos.',
                'El total del documento (22.98) difiere del cálculo de Nortex (23.00). Revisá los datos.',
            ]);
    });

    it('cero impreso también exige concordancia y una diferencia de un centavo bloquea', () => {
        expect(totalIssues(draft({ documentSubtotal: '0', documentTax: '0', documentTotal: '0' }),
            { subtotal: '0.00', tax: '0.00', total: '0.01' })).toEqual([
                'El total del documento (0) difiere del cálculo de Nortex (0.01). Revisá los datos.',
            ]);
        expect(totalIssues(draft({ documentTotal: '23.01' }), { subtotal: '20', tax: '3', total: '23.00' })).toEqual([
            'El total del documento (23.01) difiere del cálculo de Nortex (23.00). Revisá los datos.',
        ]);
    });

    it('la concordancia usa Decimal también sobre cantidades mayores que el entero seguro', () => {
        expect(totalIssues(draft({ documentTotal: '9007199254740992.01' }),
            { subtotal: '0', tax: '0', total: '9007199254740992.00' })).toEqual([
                'El total del documento (9007199254740992.01) difiere del cálculo de Nortex (9007199254740992.00). Revisá los datos.',
            ]);
    });
});

describe('identidad canónica de compras — SHA-256 de documentos fijos', () => {
    it.each([
        [null, '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'],
        [false, 'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa'],
        [true, 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b'],
        [0, '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9'],
        [7, '7902699be42c8a8e46fbbb4501726517e86b22c56a189f7625a6da49081b2451'],
        ['C$ 23.00', 'dc94e4bc2831ee3b0427ab3b13a711d3cec1d6c289cf8853aa6306ae6c2f3fe1'],
    ])('conserva el escalar %s sin coerción', (value, hash) => {
        expect(purchasePayloadHash(value)).toBe(hash);
    });

    it('ordena claves y omite ausentes sin alterar el objeto entregado', () => {
        const payload = { z: 2, optional: undefined, a: 1 };
        expect(purchasePayloadHash(payload)).toBe('99168216144c7fed5d4c54916cf98d9c66096280c04a499822a99b6658bd177a');
        expect(purchasePayloadHash(payload)).toBe(purchasePayloadHash({ z: 2, a: 1 }));
        expect(purchasePayloadHash({ a: undefined, nested: { b: undefined, z: 2 } }))
            .toBe(purchasePayloadHash({ nested: { z: 2 } }));
        expect(Object.keys(payload)).toEqual(['z', 'optional', 'a']);
        expect(purchasePayloadHash({ z: 2, a: 2 })).toBe('800990570eb5beee61ae3dab26f990a9fab09bc6c4a8a65f164bdb7b8e9c5d76');
        expect(purchasePayloadHash({ optional: undefined })).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    });

    it('canonicaliza objetos dentro de arrays, fechas y Decimal en snapshots anidados', () => {
        expect(purchasePayloadHash({ b: { y: new Date('2026-09-05T12:00:00.000Z'), x: new Decimal('23.00') },
            a: [{ z: 2, a: 1 }, null, false, 0, ''] }))
            .toBe('72b557156ccf1f43ea15eba5eeaed9b0b755d1e984a04ba1727a6340e6b283c6');
        expect(purchasePayloadHash(new Date('2026-09-05T12:00:00.000Z')))
            .toBe('2e17feb4fa1ef94bdbd535a8c216587ecdf9d83eb60804aa12321931cfef5e01');
    });

    it('el orden de líneas sí forma parte de la identidad', () => {
        expect(purchasePayloadHash([1, 2])).toBe('49a64717d5d4cb19952e6eac2946415cf6879adacf9908e7d872332d32c6e684');
        expect(purchasePayloadHash([2, 1])).toBe('af1a1fc110b6094c48582b0ef83553cb7908d7a4365424eef28e76ef6c88d630');
    });

    it('una fecha inválida no puede adquirir la misma identidad que un null válido', () => {
        expect(() => purchasePayloadHash(new Date('fecha inválida'))).toThrow(RangeError);
        expect(() => purchasePayloadHash({ postedAt: new Date('fecha inválida') })).toThrow(RangeError);
    });

    it('respeta toJSON funcional y conserva propiedades homónimas que son datos', () => {
        expect(purchasePayloadHash({ toJSON: () => 7 })).toBe('7902699be42c8a8e46fbbb4501726517e86b22c56a189f7625a6da49081b2451');
        expect(purchasePayloadHash({ toJSON: null, a: 1 })).toBe('59cdf6933c6fbfd48ca9561b0c25084ff1861f3ded32fb7ae3f303078460923c');
        expect(purchasePayloadHash({ toJSON: 7, a: 1 })).toBe('8b3d0efec75463d6a07c23e6f4ecf7dc9fb7e3db9a5acda3b90822066df59001');
    });
});
