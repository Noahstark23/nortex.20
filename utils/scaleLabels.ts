/**
 * NORTEX — Parser declarativo y puro para etiquetas EAN-13 de balanza.
 *
 * No acepta regex, scripts ni callbacks dentro del perfil. Un perfil publicado
 * solo puede describir offsets y límites acotados, por lo que cliente y servidor
 * pueden ejecutar exactamente la misma interpretación.
 */
import Decimal from 'decimal.js';

export type ScaleLabelSymbology = 'EAN_13';
export type ScaleLabelChecksumMode = 'EAN13' | 'NONE';
export type ScaleLabelValueKind = 'WEIGHT' | 'TOTAL_PRICE' | 'COUNT';

export interface ScaleLabelProfile {
    id: string;
    name?: string;
    symbology: ScaleLabelSymbology;
    totalLength: number;
    prefixes: readonly string[];
    itemStart: number;
    itemLength: number;
    valueStart: number;
    valueLength: number;
    valueKind: ScaleLabelValueKind;
    impliedDecimals: number;
    sourceUnit: string;
    checksumMode: ScaleLabelChecksumMode;
    minValue: string;
    maxValue: string;
}

export interface ParsedScaleLabel {
    profileId: string;
    rawCode: string;
    normalizedCode: string;
    plu: string;
    valueDigits: string;
    valueKind: ScaleLabelValueKind;
    /** Decimal serializado; nunca Number binario. */
    value: string;
    sourceUnit: string;
}

export type ScaleLabelRoute =
    | { kind: 'SKU'; normalizedCode: string }
    | { kind: 'SCALE_LABEL'; label: ParsedScaleLabel };

export type ScaleLabelErrorCode =
    | 'INVALID_INPUT'
    | 'INVALID_PROFILE'
    | 'AMBIGUOUS_PROFILES'
    | 'INVALID_LENGTH'
    | 'NON_NUMERIC_CODE'
    | 'INVALID_PREFIX'
    | 'INVALID_CHECKSUM'
    | 'NON_POSITIVE_VALUE'
    | 'VALUE_OUT_OF_RANGE';

export class ScaleLabelError extends Error {
    readonly code: ScaleLabelErrorCode;
    /** true significa que el router jamás debe degradar el código a SKU. */
    readonly recognized: boolean;

    constructor(code: ScaleLabelErrorCode, message: string, recognized = false) {
        super(message);
        this.name = 'ScaleLabelError';
        this.code = code;
        this.recognized = recognized;
    }
}

const EAN13_LENGTH = 13;
const EAN13_DATA_LENGTH = 12;
const MAX_RAW_SCAN_LENGTH = 128;
const MAX_IMPLIED_DECIMALS = 4;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const DIGITS_ONLY = /^\d+$/;

export const normalizeScaleLabelCode = (rawCode: string): string => {
    if (typeof rawCode !== 'string' || rawCode.length > MAX_RAW_SCAN_LENGTH) {
        throw new ScaleLabelError('INVALID_INPUT', 'El código escaneado no es válido');
    }
    // Los lectores suelen terminar con CR/LF, que String#trim admite al borde.
    // Un control dentro del payload se rechaza: borrarlo podría convertir una
    // etiqueta dañada en otra etiqueta EAN válida.
    const normalized = rawCode.trim();
    if (CONTROL_CHARACTERS.test(normalized)) {
        throw new ScaleLabelError('INVALID_INPUT', 'El código escaneado no es válido');
    }
    return normalized;
};

export const ean13CheckDigit = (firstTwelveDigits: string): number => {
    if (firstTwelveDigits.length !== EAN13_DATA_LENGTH || !DIGITS_ONLY.test(firstTwelveDigits)) {
        throw new ScaleLabelError(
            'INVALID_INPUT',
            'El cálculo EAN-13 requiere exactamente 12 dígitos',
        );
    }

    let sum = 0;
    for (let index = 0; index < firstTwelveDigits.length; index += 1) {
        const digit = firstTwelveDigits.charCodeAt(index) - 48;
        sum += digit * (index % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
};

export const isValidEan13 = (code: string): boolean => {
    if (code.length !== EAN13_LENGTH || !DIGITS_ONLY.test(code)) return false;
    return ean13CheckDigit(code.slice(0, EAN13_DATA_LENGTH)) === Number(code[EAN13_DATA_LENGTH]);
};

const failProfile = (profile: ScaleLabelProfile, detail: string): never => {
    throw new ScaleLabelError(
        'INVALID_PROFILE',
        `Perfil de balanza ${profile.id || '(sin id)'} inválido: ${detail}`,
    );
};

const isSafeOffset = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const isSafeLength = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const spanEndsBeforeChecksum = (start: number, length: number): boolean =>
    isSafeOffset(start) && isSafeLength(length) && start <= EAN13_DATA_LENGTH - length;

const spansOverlap = (aStart: number, aLength: number, bStart: number, bLength: number): boolean =>
    aStart < bStart + bLength && bStart < aStart + aLength;

const profileRange = (profile: ScaleLabelProfile): { min: Decimal; max: Decimal } => {
    let min: Decimal;
    let max: Decimal;
    try {
        min = new Decimal(profile.minValue);
        max = new Decimal(profile.maxValue);
    } catch {
        return failProfile(profile, 'los límites min/max no son decimales válidos');
    }

    if (!min.isFinite() || !max.isFinite() || !min.greaterThan(0) || max.lessThan(min)) {
        return failProfile(profile, 'minValue debe ser positivo, finito y no superar maxValue');
    }

    const encodedMax = new Decimal(10)
        .pow(profile.valueLength)
        .minus(1)
        .dividedBy(new Decimal(10).pow(profile.impliedDecimals));
    if (max.greaterThan(encodedMax)) {
        return failProfile(profile, `maxValue excede lo representable (${encodedMax.toString()})`);
    }
    return { min, max };
};

/** Valida un perfil sin ejecutar contenido provisto por el usuario. */
export const validateScaleLabelProfile = (profile: ScaleLabelProfile): void => {
    if (!profile || typeof profile !== 'object') {
        throw new ScaleLabelError('INVALID_PROFILE', 'El perfil de balanza no es válido');
    }
    if (typeof profile.id !== 'string' || profile.id.trim() === '') failProfile(profile, 'falta id');
    if (profile.symbology !== 'EAN_13') failProfile(profile, 'la simbología debe ser EAN_13');
    if (profile.totalLength !== EAN13_LENGTH) failProfile(profile, 'EAN_13 requiere longitud 13');
    if (profile.checksumMode !== 'EAN13' && profile.checksumMode !== 'NONE') {
        failProfile(profile, 'checksumMode no permitido');
    }
    if (!Array.isArray(profile.prefixes) || profile.prefixes.length === 0) {
        failProfile(profile, 'debe declarar al menos un prefijo');
    }

    const seenPrefixes = new Set<string>();
    for (const prefix of profile.prefixes) {
        if (
            typeof prefix !== 'string'
            || prefix.length > EAN13_DATA_LENGTH
            || !DIGITS_ONLY.test(prefix)
        ) {
            failProfile(profile, 'cada prefijo debe contener entre 1 y 12 dígitos');
        }
        if (seenPrefixes.has(prefix)) failProfile(profile, `prefijo duplicado ${prefix}`);
        seenPrefixes.add(prefix);
    }

    if (!spanEndsBeforeChecksum(profile.itemStart, profile.itemLength)) {
        failProfile(profile, 'el offset del PLU sale del payload o invade el checksum');
    }
    if (!spanEndsBeforeChecksum(profile.valueStart, profile.valueLength)) {
        failProfile(profile, 'el offset del valor sale del payload o invade el checksum');
    }
    if (spansOverlap(profile.itemStart, profile.itemLength, profile.valueStart, profile.valueLength)) {
        failProfile(profile, 'los offsets de PLU y valor no pueden solaparse');
    }
    if (
        !Number.isSafeInteger(profile.impliedDecimals)
        || profile.impliedDecimals < 0
        || profile.impliedDecimals > MAX_IMPLIED_DECIMALS
        || profile.impliedDecimals > profile.valueLength
    ) {
        failProfile(profile, `impliedDecimals debe ser entero entre 0 y ${MAX_IMPLIED_DECIMALS}`);
    }
    if (profile.valueKind !== 'WEIGHT' && profile.valueKind !== 'TOTAL_PRICE' && profile.valueKind !== 'COUNT') {
        failProfile(profile, 'valueKind no permitido');
    }
    if (profile.valueKind === 'COUNT' && profile.impliedDecimals !== 0) {
        failProfile(profile, 'COUNT no admite decimales implícitos');
    }
    if (typeof profile.sourceUnit !== 'string' || profile.sourceUnit.trim() === '') {
        failProfile(profile, 'sourceUnit no puede estar vacío');
    }
    profileRange(profile);
};

const prefixesOverlap = (left: readonly string[], right: readonly string[]): boolean =>
    left.some((leftPrefix) => right.some(
        (rightPrefix) => leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix),
    ));

/** Rechaza ids duplicados y espacios de reconocimiento que se solapen. */
export const validateScaleLabelProfiles = (profiles: readonly ScaleLabelProfile[]): void => {
    const ids = new Set<string>();
    profiles.forEach((profile) => {
        validateScaleLabelProfile(profile);
        if (ids.has(profile.id)) {
            throw new ScaleLabelError(
                'AMBIGUOUS_PROFILES',
                `Hay más de un perfil de balanza con id ${profile.id}`,
            );
        }
        ids.add(profile.id);
    });

    for (const [leftIndex, left] of profiles.entries()) {
        for (const right of profiles.slice(leftIndex + 1)) {
            if (prefixesOverlap(left.prefixes, right.prefixes)) {
                throw new ScaleLabelError(
                    'AMBIGUOUS_PROFILES',
                    `Los perfiles ${left.id} y ${right.id} reconocen el mismo espacio de códigos`,
                );
            }
        }
    }
};

const decimalStringFromDigits = (digits: string, impliedDecimals: number): string => {
    return new Decimal(digits)
        .dividedBy(new Decimal(10).pow(impliedDecimals))
        .toFixed(impliedDecimals);
};

/** Parsea contra un perfil ya seleccionado; cualquier error queda reconocido. */
export const parseScaleLabelWithProfile = (
    rawCode: string,
    profile: ScaleLabelProfile,
): ParsedScaleLabel => {
    validateScaleLabelProfile(profile);
    const code = normalizeScaleLabelCode(rawCode);

    if (code.length !== profile.totalLength) {
        throw new ScaleLabelError('INVALID_LENGTH', 'La etiqueta no tiene la longitud esperada', true);
    }
    if (!DIGITS_ONLY.test(code)) {
        throw new ScaleLabelError('NON_NUMERIC_CODE', 'La etiqueta debe contener solo dígitos', true);
    }
    if (!profile.prefixes.some((prefix) => code.startsWith(prefix))) {
        throw new ScaleLabelError('INVALID_PREFIX', 'La etiqueta no coincide con el prefijo configurado', true);
    }
    if (profile.checksumMode === 'EAN13' && !isValidEan13(code)) {
        throw new ScaleLabelError('INVALID_CHECKSUM', 'El checksum EAN-13 de la etiqueta es inválido', true);
    }

    const plu = code.slice(profile.itemStart, profile.itemStart + profile.itemLength);
    const valueDigits = code.slice(profile.valueStart, profile.valueStart + profile.valueLength);
    const value = new Decimal(decimalStringFromDigits(valueDigits, profile.impliedDecimals));
    const { min, max } = profileRange(profile);

    if (!value.greaterThan(0)) {
        throw new ScaleLabelError('NON_POSITIVE_VALUE', 'La etiqueta contiene un valor cero', true);
    }
    if (value.lessThan(min) || value.greaterThan(max)) {
        throw new ScaleLabelError(
            'VALUE_OUT_OF_RANGE',
            `El valor ${value.toString()} cae fuera del rango permitido`,
            true,
        );
    }

    return {
        profileId: profile.id,
        rawCode,
        normalizedCode: code,
        plu,
        valueDigits,
        valueKind: profile.valueKind,
        value: value.toFixed(profile.impliedDecimals),
        sourceUnit: profile.sourceUnit,
    };
};

/**
 * Devuelve null únicamente cuando el código no pertenece a ningún perfil. Si
 * longitud + prefijo lo reconocen, todo error se lanza y nunca cae a SKU.
 */
export const tryParseScaleLabel = (
    rawCode: string,
    profiles: readonly ScaleLabelProfile[],
): ParsedScaleLabel | null => {
    validateScaleLabelProfiles(profiles);
    const code = normalizeScaleLabelCode(rawCode);
    const candidates = profiles.filter((profile) =>
        code.length === profile.totalLength
        && profile.prefixes.some((prefix) => code.startsWith(prefix)),
    );

    if (candidates.length === 0) return null;
    // validateScaleLabelProfiles ya prueba que dos perfiles publicados no
    // pueden reconocer el mismo código; por construcción queda un candidato.
    return parseScaleLabelWithProfile(rawCode, candidates[0]);
};

export const routeScaleLabel = (
    rawCode: string,
    profiles: readonly ScaleLabelProfile[],
): ScaleLabelRoute => {
    const parsed = tryParseScaleLabel(rawCode, profiles);
    if (parsed) return { kind: 'SCALE_LABEL', label: parsed };
    return { kind: 'SKU', normalizedCode: normalizeScaleLabelCode(rawCode) };
};

// Alias corto para consumidores que no necesitan distinguir el router.
export const parseScaleLabel = parseScaleLabelWithProfile;
