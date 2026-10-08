/**
 * NORTEX — Dominio puro de cantidades y unidades.
 *
 * Esta utilidad es isomórfica: no depende de React, del navegador, de Prisma ni
 * de APIs de Node. Cliente y servidor deben usar las mismas reglas para evitar
 * que una cantidad aceptada en el POS sea reinterpretada al facturar.
 */
import Decimal from 'decimal.js';

export type SaleMode = 'COUNTED' | 'MEASURED';

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type QuantityUnit =
    | MassUnit
    | 'unidad'
    | 'litro'
    | 'ml'
    | 'metro'
    | 'saco'
    | 'frasco'
    | 'caja'
    | (string & {});

export type QuantityErrorCode =
    | 'INVALID_QUANTITY'
    | 'NON_FINITE_QUANTITY'
    | 'NON_POSITIVE_QUANTITY'
    | 'TOO_MANY_DECIMALS'
    | 'QUANTITY_OVERFLOW'
    | 'INVALID_STEP'
    | 'STEP_MISMATCH'
    | 'COUNTED_REQUIRES_INTEGER'
    | 'INCOMPATIBLE_UNITS'
    | 'UNIT_CHANGE_REQUIRES_CONVERSION';

export class QuantityValidationError extends Error {
    readonly code: QuantityErrorCode;

    constructor(code: QuantityErrorCode, message: string) {
        super(message);
        this.name = 'QuantityValidationError';
        this.code = code;
    }
}

export interface QuantityRules {
    saleMode: SaleMode;
    quantityStep: Decimal.Value;
    /**
     * Tope adicional del caso de uso. Nunca puede ampliar el límite físico de
     * Decimal(18,4), solo reducirlo.
     */
    maxQuantity?: Decimal.Value;
}

export const QUANTITY_DECIMAL_PLACES = 4;
export const MAX_QUANTITY = new Decimal('99999999999999.9999');

const decimalFromUnknown = (
    input: unknown,
    invalidCode: QuantityErrorCode,
    invalidMessage: string,
): Decimal => {
    if (input instanceof Decimal) return new Decimal(input);

    if (typeof input !== 'string' && typeof input !== 'number') {
        throw new QuantityValidationError(invalidCode, invalidMessage);
    }

    try {
        // toString() hace explícito que un Number ya contaminado (por ejemplo,
        // 0.1 + 0.2) no se redondea en silencio antes de validarlo. El trim
        // conserva el contrato de aceptar espacios periféricos en strings.
        return new Decimal(input.toString().trim());
    } catch {
        throw new QuantityValidationError(invalidCode, invalidMessage);
    }
};

const assertFinitePositiveDecimal = (
    input: unknown,
    invalidCode: QuantityErrorCode,
    invalidMessage: string,
): Decimal => {
    const value = decimalFromUnknown(input, invalidCode, invalidMessage);
    if (!value.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'La cantidad debe ser finita');
    }
    if (!value.greaterThan(0)) {
        throw new QuantityValidationError('NON_POSITIVE_QUANTITY', 'La cantidad debe ser mayor que cero');
    }
    return value;
};

/**
 * Parsea una cantidad persistible como Decimal(18,4), sin cuantizar ni corregir
 * silenciosamente la entrada.
 */
export const parseQuantity = (input: unknown): Decimal => {
    const quantity = assertFinitePositiveDecimal(
        input,
        'INVALID_QUANTITY',
        'La cantidad no tiene un formato decimal válido',
    );

    if (quantity.decimalPlaces() > QUANTITY_DECIMAL_PLACES) {
        throw new QuantityValidationError(
            'TOO_MANY_DECIMALS',
            `La cantidad admite como máximo ${QUANTITY_DECIMAL_PLACES} decimales`,
        );
    }
    if (quantity.greaterThan(MAX_QUANTITY)) {
        throw new QuantityValidationError(
            'QUANTITY_OVERFLOW',
            'La cantidad excede el máximo permitido',
        );
    }
    return quantity;
};

const parseStep = (input: Decimal.Value): Decimal => {
    let step: Decimal;
    try {
        step = new Decimal(input);
    } catch {
        throw new QuantityValidationError('INVALID_STEP', 'El paso de cantidad no es válido');
    }

    if (
        !step.isFinite()
        || !step.greaterThan(0)
        || step.decimalPlaces() > QUANTITY_DECIMAL_PLACES
        || step.greaterThan(MAX_QUANTITY)
    ) {
        throw new QuantityValidationError(
            'INVALID_STEP',
            `El paso debe ser positivo, finito y tener hasta ${QUANTITY_DECIMAL_PLACES} decimales`,
        );
    }
    return step;
};

/** Valida modo, escala, tope y múltiplo exacto del paso configurado. */
export const validateQuantity = (input: unknown, rules: QuantityRules): Decimal => {
    if (rules.saleMode !== 'COUNTED' && rules.saleMode !== 'MEASURED') {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El modo de venta no es válido');
    }

    const quantity = parseQuantity(input);
    const step = parseStep(rules.quantityStep);

    if (rules.saleMode === 'COUNTED' && (!quantity.isInteger() || !step.isInteger())) {
        throw new QuantityValidationError(
            'COUNTED_REQUIRES_INTEGER',
            'Los productos contables requieren cantidades y pasos enteros',
        );
    }

    if (!quantity.modulo(step).isZero()) {
        throw new QuantityValidationError(
            'STEP_MISMATCH',
            `La cantidad debe ser múltiplo exacto de ${step.toString()}`,
        );
    }

    if (rules.maxQuantity !== undefined) {
        let configuredMax: Decimal;
        try {
            configuredMax = parseQuantity(rules.maxQuantity);
        } catch (error) {
            // parseQuantity traduce todos sus fallos a QuantityValidationError.
            const validationError = error as QuantityValidationError;
            throw new QuantityValidationError(
                'INVALID_QUANTITY',
                `El máximo configurado no es válido: ${validationError.message}`,
            );
        }
        if (quantity.greaterThan(configuredMax)) {
            throw new QuantityValidationError(
                'QUANTITY_OVERFLOW',
                `La cantidad excede el máximo configurado de ${configuredMax.toString()}`,
            );
        }
    }

    return quantity;
};

/**
 * Variante para existencias iniciales/conteos: comparte límite, escala y step
 * con una venta, pero admite cero. Evita el patrón `parseInt(stock)` que
 * truncaba 37.50 lb a 37 antes de llegar al servidor.
 */
export const validateNonNegativeQuantity = (input: unknown, rules: QuantityRules): Decimal => {
    if (rules.saleMode !== 'COUNTED' && rules.saleMode !== 'MEASURED') {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El modo de venta no es válido');
    }
    const quantity = decimalFromUnknown(
        input,
        'INVALID_QUANTITY',
        'La cantidad no tiene un formato decimal válido',
    );
    if (!quantity.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'La cantidad debe ser finita');
    }
    if (quantity.isNegative()) {
        throw new QuantityValidationError('NON_POSITIVE_QUANTITY', 'La cantidad no puede ser negativa');
    }
    if (!quantity.isZero()) return validateQuantity(quantity, rules);

    const zeroStep = parseStep(rules.quantityStep);
    if (rules.saleMode === 'COUNTED' && !zeroStep.isInteger()) {
        throw new QuantityValidationError(
            'COUNTED_REQUIRES_INTEGER',
            'Los productos contables requieren cantidades y pasos enteros',
        );
    }
    return quantity;
};

const massConversionFactor = (from: string, to: string): Decimal.Value | undefined => {
    const key = `${from}:${to}`;
    if (key === 'g:kg') return '0.001';
    if (key === 'kg:g') return '1000';
    if (key === 'oz:lb') return '0.0625';
    if (key === 'lb:oz') return '16';
    return undefined;
};

/**
 * Convierte solo pares exactos aprobados. No mezcla sistemas ni intenta inferir
 * densidad, volumen o unidades comerciales.
 */
export const convertQuantity = (
    input: unknown,
    fromUnit: QuantityUnit,
    toUnit: QuantityUnit,
): Decimal => {
    const quantity = parseQuantity(input);
    const from = fromUnit.trim().toLowerCase();
    const to = toUnit.trim().toLowerCase();

    if (from === '' || to === '') {
        throw new QuantityValidationError('INCOMPATIBLE_UNITS', 'La unidad no puede estar vacía');
    }
    if (from === to) return quantity;
    const factor = massConversionFactor(from, to);
    if (factor === undefined) {
        throw new QuantityValidationError(
            'INCOMPATIBLE_UNITS',
            `No existe una conversión exacta permitida de ${fromUnit} a ${toUnit}`,
        );
    }
    return quantity.times(factor);
};

/** Formato decimal estable para tickets/API: hasta 4 decimales, sin ceros finales. */
export const formatQuantityValue = (input: Decimal.Value): string => {
    let value: Decimal;
    try {
        value = new Decimal(input);
    } catch {
        throw new QuantityValidationError('INVALID_QUANTITY', 'La cantidad no tiene un formato decimal válido');
    }
    if (!value.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'La cantidad debe ser finita');
    }
    return value.toDecimalPlaces(QUANTITY_DECIMAL_PLACES).toFixed();
};

/** Une valor y unidad sin pluralizaciones que puedan alterar abreviaturas legales. */
export const formatQuantity = (input: Decimal.Value, unit: QuantityUnit): string => {
    const normalizedUnit = unit.trim();
    if (!normalizedUnit) {
        throw new QuantityValidationError('INCOMPATIBLE_UNITS', 'La unidad no puede estar vacía');
    }
    return `${formatQuantityValue(input)} ${normalizedUnit}`;
};

/**
 * La unidad base define el significado de todo el stock y Kardex histórico.
 * Cambiarla solo es seguro antes del primer movimiento y con existencia cero;
 * cualquier otro caso necesita un asistente transaccional de conversión.
 */
export const assertBaseUnitChangeAllowed = (input: {
    currentUnit: string;
    nextUnit: string;
    stock: Decimal.Value;
    hasMovements: boolean;
    hasOpenCommitments?: boolean;
}): void => {
    const currentUnit = input.currentUnit.trim().toLowerCase();
    const nextUnit = input.nextUnit.trim().toLowerCase();
    if (!currentUnit || !nextUnit) {
        throw new QuantityValidationError('INCOMPATIBLE_UNITS', 'La unidad no puede estar vacía');
    }
    if (currentUnit === nextUnit) return;

    let stock: Decimal;
    try {
        stock = new Decimal(input.stock);
    } catch {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El stock actual no es un decimal válido');
    }
    if (!stock.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'El stock actual debe ser finito');
    }
    if (!stock.isZero() || input.hasMovements || input.hasOpenCommitments === true) {
        throw new QuantityValidationError(
            'UNIT_CHANGE_REQUIRES_CONVERSION',
            'La unidad base no se puede cambiar cuando el producto tiene stock, movimientos u órdenes abiertas; usá una conversión auditada',
        );
    }
};
