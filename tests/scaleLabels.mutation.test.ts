import { describe, expect, it } from 'vitest';
import {
    ean13CheckDigit,
    isValidEan13,
    normalizeScaleLabelCode,
    parseScaleLabelWithProfile,
    routeScaleLabel,
    ScaleLabelError,
    tryParseScaleLabel,
    validateScaleLabelProfile,
    validateScaleLabelProfiles,
    type ScaleLabelProfile,
} from '../utils/scaleLabels';

const profile = (overrides: Partial<ScaleLabelProfile> = {}): ScaleLabelProfile => ({
    id: 'peso-v1',
    name: 'Peso v1',
    symbology: 'EAN_13',
    totalLength: 13,
    prefixes: ['20'],
    itemStart: 2,
    itemLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueKind: 'WEIGHT',
    impliedDecimals: 3,
    sourceUnit: 'kg',
    checksumMode: 'EAN13',
    minValue: '0.001',
    maxValue: '99.999',
    ...overrides,
});

const ean = (data: string): string => `${data}${ean13CheckDigit(data)}`;

const capture = (run: () => unknown): ScaleLabelError => {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(ScaleLabelError);
        return error as ScaleLabelError;
    }
    throw new Error('Se esperaba ScaleLabelError');
};

const expectError = (
    run: () => unknown,
    code: ScaleLabelError['code'],
    message: string,
    recognized = false,
): void => {
    const error = capture(run);
    expect(error.name).toBe('ScaleLabelError');
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.recognized).toBe(recognized);
};

describe('normalizeScaleLabelCode — frontera del escáner', () => {
    it('tolera espacios y terminadores únicamente en los bordes', () => {
        const code = ean('201234500001');
        expect(normalizeScaleLabelCode(` \t\r\n${code}\r\n `)).toBe(code);
    });

    it.each(['\u0001', '\n', '\u007f', '\u0085'])(
        'rechaza el control interno %j en vez de reparar el payload',
        (control) => {
            const damaged = `20${control}12345000010`;
            expectError(
                () => normalizeScaleLabelCode(damaged),
                'INVALID_INPUT',
                'El código escaneado no es válido',
            );
            expectError(
                () => routeScaleLabel(damaged, [profile()]),
                'INVALID_INPUT',
                'El código escaneado no es válido',
            );
        },
    );

    it('acepta exactamente 128 caracteres y rechaza 129', () => {
        expect(normalizeScaleLabelCode('x'.repeat(128))).toBe('x'.repeat(128));
        expectError(
            () => normalizeScaleLabelCode('x'.repeat(129)),
            'INVALID_INPUT',
            'El código escaneado no es válido',
        );
    });

    it('rechaza entradas no string antes de leer length', () => {
        expectError(
            () => normalizeScaleLabelCode(null as unknown as string),
            'INVALID_INPUT',
            'El código escaneado no es válido',
        );
        expectError(
            () => normalizeScaleLabelCode(123 as unknown as string),
            'INVALID_INPUT',
            'El código escaneado no es válido',
        );
    });
});

describe('EAN-13 — algoritmo y forma', () => {
    it.each([
        ['000000000000', 0],
        ['400638133393', 1],
        ['123456789012', 8],
        ['999999999999', 4],
    ] as const)('calcula el dígito de %s', (data, expected) => {
        expect(ean13CheckDigit(data)).toBe(expected);
        expect(isValidEan13(`${data}${expected}`)).toBe(true);
        expect(isValidEan13(`${data}${(expected + 1) % 10}`)).toBe(false);
    });

    it.each(['12345678901', '1234567890123', '12345678901x'])('rechaza una base inválida %s', (data) => {
        expectError(
            () => ean13CheckDigit(data),
            'INVALID_INPUT',
            'El cálculo EAN-13 requiere exactamente 12 dígitos',
        );
    });

    it.each(['', '123456789012', '12345678901234', '123456789012x'])('%s no es un EAN-13 válido', (code) => {
        expect(isValidEan13(code)).toBe(false);
    });

    it('no valida longitudes extras aunque el dígito 13 sea el checksum correcto', () => {
        expect(isValidEan13(`${ean('123456789012')}0`)).toBe(false);
        expect(isValidEan13('12345678901x8')).toBe(false);
    });
});

describe('validateScaleLabelProfile — esquema declarativo estricto', () => {
    it('acepta fronteras representables, checksum NONE y los tres valueKind', () => {
        for (const valueKind of ['WEIGHT', 'TOTAL_PRICE'] as const) {
            expect(() => validateScaleLabelProfile(profile({
                valueKind,
                checksumMode: 'NONE',
                prefixes: ['2', '123456789012'],
                itemStart: 7,
                itemLength: 5,
                valueStart: 2,
                valueLength: 5,
                impliedDecimals: 4,
                minValue: '0.0001',
                maxValue: '9.9999',
            }))).not.toThrow();
        }
        expect(() => validateScaleLabelProfile(profile({
            valueKind: 'COUNT',
            impliedDecimals: 0,
            minValue: '1',
            maxValue: '99999',
        }))).not.toThrow();
    });

    it('rechaza un valor que no sea objeto con el mensaje base', () => {
        for (const invalid of [null, undefined, false, 'perfil']) {
            expectError(
                () => validateScaleLabelProfile(invalid as unknown as ScaleLabelProfile),
                'INVALID_PROFILE',
                'El perfil de balanza no es válido',
            );
        }
    });

    it.each([
        [{ id: '' }, 'Perfil de balanza (sin id) inválido: falta id'],
        [{ id: '   ' }, 'Perfil de balanza     inválido: falta id'],
        [{ id: 7 as unknown as string }, 'Perfil de balanza 7 inválido: falta id'],
        [{ symbology: 'UPC' as ScaleLabelProfile['symbology'] }, 'Perfil de balanza peso-v1 inválido: la simbología debe ser EAN_13'],
        [{ totalLength: 12 }, 'Perfil de balanza peso-v1 inválido: EAN_13 requiere longitud 13'],
        [{ checksumMode: 'CRC' as ScaleLabelProfile['checksumMode'] }, 'Perfil de balanza peso-v1 inválido: checksumMode no permitido'],
        [{ prefixes: [] }, 'Perfil de balanza peso-v1 inválido: debe declarar al menos un prefijo'],
        [{ prefixes: '20' as unknown as string[] }, 'Perfil de balanza peso-v1 inválido: debe declarar al menos un prefijo'],
        [{ prefixes: [7 as unknown as string] }, 'Perfil de balanza peso-v1 inválido: cada prefijo debe contener entre 1 y 12 dígitos'],
        [{ prefixes: [''] }, 'Perfil de balanza peso-v1 inválido: cada prefijo debe contener entre 1 y 12 dígitos'],
        [{ prefixes: ['1234567890123'] }, 'Perfil de balanza peso-v1 inválido: cada prefijo debe contener entre 1 y 12 dígitos'],
        [{ prefixes: ['2x'] }, 'Perfil de balanza peso-v1 inválido: cada prefijo debe contener entre 1 y 12 dígitos'],
        [{ prefixes: ['20', '20'] }, 'Perfil de balanza peso-v1 inválido: prefijo duplicado 20'],
        [{ itemStart: -1 }, 'Perfil de balanza peso-v1 inválido: el offset del PLU sale del payload o invade el checksum'],
        [{ itemStart: 1.5 }, 'Perfil de balanza peso-v1 inválido: el offset del PLU sale del payload o invade el checksum'],
        [{ itemStart: 12, itemLength: 1 }, 'Perfil de balanza peso-v1 inválido: el offset del PLU sale del payload o invade el checksum'],
        [{ itemLength: 0 }, 'Perfil de balanza peso-v1 inválido: el offset del PLU sale del payload o invade el checksum'],
        [{ itemLength: 1.5 }, 'Perfil de balanza peso-v1 inválido: el offset del PLU sale del payload o invade el checksum'],
        [{ valueStart: -1 }, 'Perfil de balanza peso-v1 inválido: el offset del valor sale del payload o invade el checksum'],
        [{ valueStart: 1.5 }, 'Perfil de balanza peso-v1 inválido: el offset del valor sale del payload o invade el checksum'],
        [{ valueStart: 12, valueLength: 1 }, 'Perfil de balanza peso-v1 inválido: el offset del valor sale del payload o invade el checksum'],
        [{ valueLength: 0 }, 'Perfil de balanza peso-v1 inválido: el offset del valor sale del payload o invade el checksum'],
        [{ valueLength: 1.5 }, 'Perfil de balanza peso-v1 inválido: el offset del valor sale del payload o invade el checksum'],
        [{ itemStart: 7, itemLength: 2 }, 'Perfil de balanza peso-v1 inválido: los offsets de PLU y valor no pueden solaparse'],
        [{ valueStart: 2, valueLength: 2 }, 'Perfil de balanza peso-v1 inválido: los offsets de PLU y valor no pueden solaparse'],
        [{ impliedDecimals: -1 }, 'Perfil de balanza peso-v1 inválido: impliedDecimals debe ser entero entre 0 y 4'],
        [{ impliedDecimals: 1.5 }, 'Perfil de balanza peso-v1 inválido: impliedDecimals debe ser entero entre 0 y 4'],
        [{ impliedDecimals: 5 }, 'Perfil de balanza peso-v1 inválido: impliedDecimals debe ser entero entre 0 y 4'],
        [{ impliedDecimals: 4, valueLength: 3 }, 'Perfil de balanza peso-v1 inválido: impliedDecimals debe ser entero entre 0 y 4'],
        [{ valueKind: 'VOLUME' as ScaleLabelProfile['valueKind'] }, 'Perfil de balanza peso-v1 inválido: valueKind no permitido'],
        [{ valueKind: 'COUNT', impliedDecimals: 1 }, 'Perfil de balanza peso-v1 inválido: COUNT no admite decimales implícitos'],
        [{ sourceUnit: '' }, 'Perfil de balanza peso-v1 inválido: sourceUnit no puede estar vacío'],
        [{ sourceUnit: '   ' }, 'Perfil de balanza peso-v1 inválido: sourceUnit no puede estar vacío'],
        [{ sourceUnit: 7 as unknown as string }, 'Perfil de balanza peso-v1 inválido: sourceUnit no puede estar vacío'],
        [{ minValue: 'abc' }, 'Perfil de balanza peso-v1 inválido: los límites min/max no son decimales válidos'],
        [{ maxValue: 'abc' }, 'Perfil de balanza peso-v1 inválido: los límites min/max no son decimales válidos'],
        [{ minValue: 'Infinity' }, 'Perfil de balanza peso-v1 inválido: minValue debe ser positivo, finito y no superar maxValue'],
        [{ maxValue: 'Infinity' }, 'Perfil de balanza peso-v1 inválido: minValue debe ser positivo, finito y no superar maxValue'],
        [{ minValue: '0' }, 'Perfil de balanza peso-v1 inválido: minValue debe ser positivo, finito y no superar maxValue'],
        [{ minValue: '-1' }, 'Perfil de balanza peso-v1 inválido: minValue debe ser positivo, finito y no superar maxValue'],
        [{ minValue: '2', maxValue: '1' }, 'Perfil de balanza peso-v1 inválido: minValue debe ser positivo, finito y no superar maxValue'],
        [{ maxValue: '100' }, 'Perfil de balanza peso-v1 inválido: maxValue excede lo representable (99.999)'],
    ] as Array<[Partial<ScaleLabelProfile>, string]>)('rechaza %o', (changes, message) => {
        expectError(
            () => validateScaleLabelProfile(profile(changes)),
            'INVALID_PROFILE',
            message,
        );
    });

    it('admite offsets adyacentes en ambos órdenes y min=max', () => {
        expect(() => validateScaleLabelProfile(profile({ minValue: '1.25', maxValue: '1.25' }))).not.toThrow();
        expect(() => validateScaleLabelProfile(profile({ itemStart: 0, itemLength: 2 }))).not.toThrow();
        expect(() => validateScaleLabelProfile(profile({
            itemStart: 7,
            itemLength: 5,
            valueStart: 2,
            valueLength: 5,
        }))).not.toThrow();
    });
});

describe('validateScaleLabelProfiles — espacios de reconocimiento', () => {
    it('admite cero o varios perfiles realmente disjuntos', () => {
        expect(() => validateScaleLabelProfiles([])).not.toThrow();
        expect(() => validateScaleLabelProfiles([
            profile({ id: 'a', prefixes: ['20', '21'] }),
            profile({ id: 'b', prefixes: ['22', '23'] }),
            profile({ id: 'c', prefixes: ['24'] }),
        ])).not.toThrow();
    });

    it('rechaza ids duplicados aunque los prefijos sean disjuntos', () => {
        expectError(
            () => validateScaleLabelProfiles([
                profile({ id: 'duplicado', prefixes: ['20'] }),
                profile({ id: 'duplicado', prefixes: ['21'] }),
            ]),
            'AMBIGUOUS_PROFILES',
            'Hay más de un perfil de balanza con id duplicado',
        );
    });

    it.each([
        [['20'], ['201']],
        [['201'], ['20']],
        [['19', '20'], ['201', '30']],
    ])('rechaza prefijos que se contienen: %j / %j', (left, right) => {
        expectError(
            () => validateScaleLabelProfiles([
                profile({ id: 'izquierda', prefixes: left }),
                profile({ id: 'derecha', prefixes: right }),
            ]),
            'AMBIGUOUS_PROFILES',
            'Los perfiles izquierda y derecha reconocen el mismo espacio de códigos',
        );
    });
});

describe('parse/route — reconocimiento sin degradación a SKU', () => {
    it('acepta checksum NONE, conserva raw y extrae offsets exactos', () => {
        const raw = '\r\n2012345000019\n';
        expect(parseScaleLabelWithProfile(raw, profile({ checksumMode: 'NONE' }))).toEqual({
            profileId: 'peso-v1',
            rawCode: raw,
            normalizedCode: '2012345000019',
            plu: '12345',
            valueDigits: '00001',
            valueKind: 'WEIGHT',
            value: '0.001',
            sourceUnit: 'kg',
        });
    });

    it('respeta límites inclusivos y el padding cuando decimales igualan longitud', () => {
        const min = parseScaleLabelWithProfile(ean('201234500001'), profile());
        const max = parseScaleLabelWithProfile(ean('201234599999'), profile());
        expect([min.value, max.value]).toEqual(['0.001', '99.999']);

        const tiny = parseScaleLabelWithProfile(ean('201234500010'), profile({
            valueLength: 4,
            impliedDecimals: 4,
            minValue: '0.0001',
            maxValue: '0.9999',
        }));
        expect(tiny.valueDigits).toBe('0001');
        expect(tiny.value).toBe('0.0001');
    });

    it('COUNT serializa entero sin punto decimal', () => {
        const parsed = parseScaleLabelWithProfile(ean('201234500007'), profile({
            valueKind: 'COUNT',
            impliedDecimals: 0,
            sourceUnit: 'unidad',
            minValue: '1',
            maxValue: '99999',
        }));
        expect(parsed.value).toBe('7');
        expect(parsed.valueKind).toBe('COUNT');
        expect(parsed.sourceUnit).toBe('unidad');
    });

    it.each([
        ['201234500001', 'INVALID_LENGTH', 'La etiqueta no tiene la longitud esperada'],
        ['20123450000x0', 'NON_NUMERIC_CODE', 'La etiqueta debe contener solo dígitos'],
        [ean('211234500001'), 'INVALID_PREFIX', 'La etiqueta no coincide con el prefijo configurado'],
    ] as const)('rechaza %s con %s reconocido', (code, errorCode, message) => {
        expectError(
            () => parseScaleLabelWithProfile(code, profile()),
            errorCode,
            message,
            true,
        );
    });

    it('distingue checksum inválido de checksum desactivado', () => {
        const valid = ean('201234500001');
        const invalid = `${valid.slice(0, 12)}${(Number(valid[12]) + 1) % 10}`;
        expectError(
            () => parseScaleLabelWithProfile(invalid, profile()),
            'INVALID_CHECKSUM',
            'El checksum EAN-13 de la etiqueta es inválido',
            true,
        );
        expect(parseScaleLabelWithProfile(invalid, profile({ checksumMode: 'NONE' })).value).toBe('0.001');
    });

    it('un perfil con varios prefijos reconoce cualquiera de ellos, no todos', () => {
        const multiPrefix = profile({ prefixes: ['19', '20'] });
        const code = ean('201234500001');
        expect(parseScaleLabelWithProfile(code, multiPrefix).profileId).toBe('peso-v1');
        expect(tryParseScaleLabel(code, [multiPrefix])?.plu).toBe('12345');
    });

    it.each([
        ['201234500000', { minValue: '0.001' }, 'NON_POSITIVE_VALUE', 'La etiqueta contiene un valor cero'],
        ['201234500001', { minValue: '0.002' }, 'VALUE_OUT_OF_RANGE', 'El valor 0.001 cae fuera del rango permitido'],
        ['201234501001', { maxValue: '1' }, 'VALUE_OUT_OF_RANGE', 'El valor 1.001 cae fuera del rango permitido'],
    ] as const)('rechaza el valor de %s fuera de contrato', (data, changes, code, message) => {
        expectError(
            () => parseScaleLabelWithProfile(ean(data), profile(changes)),
            code,
            message,
            true,
        );
    });

    it('tryParse retorna null solo sin candidato y route normaliza el SKU', () => {
        expect(tryParseScaleLabel('201234500001', [profile()])).toBeNull();
        expect(tryParseScaleLabel(ean('211234500001'), [profile()])).toBeNull();
        expect(routeScaleLabel('  SKU-001\r\n', [profile()])).toEqual({
            kind: 'SKU',
            normalizedCode: 'SKU-001',
        });
    });

    it('tryParse y route devuelven la etiqueta seleccionada', () => {
        const code = ean('211234500125');
        const selected = profile({ id: 'precio', prefixes: ['21'], valueKind: 'TOTAL_PRICE', impliedDecimals: 2, sourceUnit: 'NIO', minValue: '0.01', maxValue: '999.99' });
        expect(tryParseScaleLabel(code, [profile(), selected])).toMatchObject({
            profileId: 'precio',
            plu: '12345',
            value: '1.25',
        });
        expect(routeScaleLabel(code, [profile(), selected])).toMatchObject({
            kind: 'SCALE_LABEL',
            label: { profileId: 'precio', value: '1.25' },
        });
    });
});
