import { describe, expect, it } from 'vitest';
import {
    ean13CheckDigit,
    isValidEan13,
    parseScaleLabelWithProfile,
    routeScaleLabel,
    ScaleLabelError,
    type ScaleLabelProfile,
    tryParseScaleLabel,
    validateScaleLabelProfile,
    validateScaleLabelProfiles,
} from '../utils/scaleLabels';

const withCheckDigit = (firstTwelveDigits: string): string =>
    `${firstTwelveDigits}${ean13CheckDigit(firstTwelveDigits)}`;

const WEIGHT_PROFILE: ScaleLabelProfile = {
    id: 'carniceria-v1',
    name: 'Carnicería EAN-13 v1',
    symbology: 'EAN_13',
    totalLength: 13,
    prefixes: ['20'],
    itemStart: 2,
    itemLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueKind: 'WEIGHT',
    impliedDecimals: 3,
    sourceUnit: 'lb',
    checksumMode: 'EAN13',
    minValue: '0.001',
    maxValue: '99.999',
};

const expectScaleError = (
    fn: () => unknown,
    code: ScaleLabelError['code'],
    recognized?: boolean,
): void => {
    try {
        fn();
        throw new Error('Se esperaba ScaleLabelError');
    } catch (error) {
        expect(error).toBeInstanceOf(ScaleLabelError);
        expect((error as ScaleLabelError).code).toBe(code);
        if (recognized !== undefined) expect((error as ScaleLabelError).recognized).toBe(recognized);
    }
};

describe('checksum EAN-13', () => {
    it('calcula y valida un checksum conocido', () => {
        expect(ean13CheckDigit('400638133393')).toBe(1);
        expect(isValidEan13('4006381333931')).toBe(true);
        expect(isValidEan13('4006381333932')).toBe(false);
    });

    it.each(['', '123', '12345678901x', '1234567890123'])('rechaza base que no sea de 12 dígitos: %s', (base) => {
        expectScaleError(() => ean13CheckDigit(base), 'INVALID_INPUT');
    });
});

describe('parseScaleLabelWithProfile', () => {
    it('extrae PLU y peso exactos usando offsets y decimales implícitos', () => {
        const code = withCheckDigit('201234501250');
        const parsed = parseScaleLabelWithProfile(`\r${code}\n`, WEIGHT_PROFILE);

        expect(parsed).toEqual({
            profileId: 'carniceria-v1',
            rawCode: `\r${code}\n`,
            normalizedCode: code,
            plu: '12345',
            valueDigits: '01250',
            valueKind: 'WEIGHT',
            value: '1.250',
            sourceUnit: 'lb',
        });
    });

    it('soporta TOTAL_PRICE sin usar Number para el monto', () => {
        const profile: ScaleLabelProfile = {
            ...WEIGHT_PROFILE,
            id: 'precio-v1',
            prefixes: ['21'],
            valueKind: 'TOTAL_PRICE',
            impliedDecimals: 2,
            sourceUnit: 'NIO',
            minValue: '0.01',
            maxValue: '999.99',
        };
        const parsed = parseScaleLabelWithProfile(withCheckDigit('215432112345'), profile);
        expect(parsed.plu).toBe('54321');
        expect(parsed.value).toBe('123.45');
        expect(parsed.valueKind).toBe('TOTAL_PRICE');
    });

    it('soporta COUNT entero', () => {
        const profile: ScaleLabelProfile = {
            ...WEIGHT_PROFILE,
            id: 'conteo-v1',
            prefixes: ['22'],
            valueKind: 'COUNT',
            impliedDecimals: 0,
            sourceUnit: 'unidad',
            minValue: '1',
            maxValue: '99999',
        };
        expect(parseScaleLabelWithProfile(withCheckDigit('220004200007'), profile).value).toBe('7');
    });

    it('un checksum inválido queda reconocido y nunca puede caer a SKU', () => {
        const valid = withCheckDigit('201234501250');
        const invalid = `${valid.slice(0, 12)}${(Number(valid[12]) + 1) % 10}`;
        expectScaleError(() => tryParseScaleLabel(invalid, [WEIGHT_PROFILE]), 'INVALID_CHECKSUM', true);
        expectScaleError(() => routeScaleLabel(invalid, [WEIGHT_PROFILE]), 'INVALID_CHECKSUM', true);
    });

    it('un payload no numérico con longitud/prefijo reconocidos tampoco cae a SKU', () => {
        expectScaleError(
            () => tryParseScaleLabel('2012345A12509', [WEIGHT_PROFILE]),
            'NON_NUMERIC_CODE',
            true,
        );
    });

    it('rechaza cero y valores fuera del min/max', () => {
        expectScaleError(
            () => parseScaleLabelWithProfile(withCheckDigit('201234500000'), WEIGHT_PROFILE),
            'NON_POSITIVE_VALUE',
            true,
        );
        expectScaleError(
            () => parseScaleLabelWithProfile(withCheckDigit('201234599999'), {
                ...WEIGHT_PROFILE,
                maxValue: '50',
            }),
            'VALUE_OUT_OF_RANGE',
            true,
        );
    });

    it('un código fuera de longitud falla al parsear contra perfil', () => {
        expectScaleError(() => parseScaleLabelWithProfile('201234501250', WEIGHT_PROFILE), 'INVALID_LENGTH', true);
    });

    it('un código sin coincidencia conserva el fallback explícito a SKU', () => {
        expect(tryParseScaleLabel('7501234567893', [WEIGHT_PROFILE])).toBeNull();
        expect(routeScaleLabel('SKU-ABC', [WEIGHT_PROFILE])).toEqual({
            kind: 'SKU',
            normalizedCode: 'SKU-ABC',
        });
    });
});

describe('validación declarativa de perfiles', () => {
    it('acepta el perfil EAN-13 base', () => {
        expect(() => validateScaleLabelProfile(WEIGHT_PROFILE)).not.toThrow();
        expect(() => validateScaleLabelProfiles([WEIGHT_PROFILE])).not.toThrow();
    });

    it.each([
        [{ itemStart: 12, itemLength: 1 }, 'offset que invade checksum'],
        [{ valueStart: 11, valueLength: 2 }, 'offset que desborda payload'],
        [{ itemStart: Number.MAX_SAFE_INTEGER, itemLength: 2 }, 'overflow de offset'],
        [{ itemStart: 2, itemLength: 6, valueStart: 7, valueLength: 5 }, 'offsets solapados'],
        [{ prefixes: [] }, 'sin prefijos'],
        [{ prefixes: ['2x'] }, 'prefijo no numérico'],
        [{ prefixes: ['20', '20'] }, 'prefijo duplicado'],
        [{ impliedDecimals: 5 }, 'más de cuatro decimales'],
        [{ valueKind: 'COUNT', impliedDecimals: 2 }, 'COUNT fraccionario'],
        [{ minValue: '0' }, 'mínimo cero'],
        [{ minValue: '10', maxValue: '9' }, 'rango invertido'],
        [{ maxValue: '1000', impliedDecimals: 2, valueLength: 5 }, 'máximo no representable'],
    ] as const)('rechaza %s (%s)', (changes, _description) => {
        expectScaleError(
            () => validateScaleLabelProfile({ ...WEIGHT_PROFILE, ...changes } as ScaleLabelProfile),
            'INVALID_PROFILE',
            false,
        );
    });

    it('detecta perfiles ambiguos con el mismo prefijo', () => {
        expectScaleError(
            () => validateScaleLabelProfiles([
                WEIGHT_PROFILE,
                { ...WEIGHT_PROFILE, id: 'otra-v1' },
            ]),
            'AMBIGUOUS_PROFILES',
        );
    });

    it('detecta ambigüedad aunque un prefijo sea más específico', () => {
        expectScaleError(
            () => validateScaleLabelProfiles([
                WEIGHT_PROFILE,
                { ...WEIGHT_PROFILE, id: 'subprefijo-v1', prefixes: ['201'] },
            ]),
            'AMBIGUOUS_PROFILES',
        );
    });

    it('permite perfiles con espacios de códigos disjuntos', () => {
        expect(() => validateScaleLabelProfiles([
            WEIGHT_PROFILE,
            { ...WEIGHT_PROFILE, id: 'otro-v1', prefixes: ['21'] },
        ])).not.toThrow();
    });
});
