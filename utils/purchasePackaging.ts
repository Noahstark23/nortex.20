/**
 * Conversión pura de una línea de compra a la unidad base del inventario.
 *
 * El navegador solo elige BASE o PACK y envía la cantidad/costo visibles. El
 * factor siempre proviene del producto consultado por el servidor; este
 * contrato deliberadamente no contiene ningún campo de factor del cliente.
 */
import Decimal from 'decimal.js';
import {
    parseQuantity,
    validateQuantity,
    QuantityValidationError,
    type SaleMode,
} from './quantity.js';

export type PurchaseUnit = 'BASE' | 'PACK';

export interface PurchaseLineInput {
    quantity: unknown;
    unitCost: unknown;
    purchaseUnit?: PurchaseUnit | null;
}

export interface PurchaseProductAuthority {
    unit?: string | null;
    saleMode?: string | null;
    quantityStep?: Decimal.Value | null;
    packUnit?: string | null;
    packSize?: Decimal.Value | null;
}

export interface ResolvedPurchaseLine {
    purchaseUnit: PurchaseUnit;
    /** Cantidad digitada por la persona: lb/unidades o número de empaques. */
    visibleQuantity: Decimal;
    /** Costo digitado: por unidad base o por empaque según purchaseUnit. */
    visibleUnitCost: Decimal;
    /** Cantidad que mueve stock, lote, Kardex y quantityExact. */
    baseQuantity: Decimal;
    /** Costo autoritativo por unidad base para costo promedio. */
    baseUnitCost: Decimal;
    /** Total económico de la línea antes de IVA. */
    lineTotal: Decimal;
    /** Factor leído del producto; siempre 1 para BASE. */
    authoritativeFactor: Decimal;
}

const quantityRules = (product: PurchaseProductAuthority): { saleMode: SaleMode; quantityStep: Decimal.Value } => ({
    // D6: solo COUNTED explícito exige enteros; null legado conserva fracciones.
    saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
    quantityStep: product.quantityStep?.toString()
        || (product.saleMode === 'COUNTED' ? '1' : '0.0001'),
});

const positiveCost = (input: unknown): Decimal => {
    if (typeof input !== 'string' && typeof input !== 'number' && !(input instanceof Decimal)) {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El costo debe ser un decimal válido');
    }
    if (typeof input === 'string' && input.trim() === '') {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El costo es obligatorio');
    }

    let cost: Decimal;
    try {
        cost = new Decimal(input as Decimal.Value);
    } catch {
        throw new QuantityValidationError('INVALID_QUANTITY', 'El costo debe ser un decimal válido');
    }
    if (!cost.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'El costo debe ser finito');
    }
    if (!cost.greaterThan(0)) {
        throw new QuantityValidationError('NON_POSITIVE_QUANTITY', 'El costo debe ser mayor que cero');
    }
    return cost;
};

/**
 * Resuelve una compra usando únicamente la configuración autoritativa del
 * producto. Un campo extra `packSize` inyectado en `line` es ignorado por
 * diseño: JavaScript puede recibirlo, pero nunca participa del cálculo.
 */
export const resolvePurchaseLine = (
    line: PurchaseLineInput,
    product: PurchaseProductAuthority,
): ResolvedPurchaseLine => {
    const purchaseUnit: PurchaseUnit = line.purchaseUnit === 'PACK' ? 'PACK' : 'BASE';
    const visibleQuantity = parseQuantity(line.quantity);
    const visibleUnitCost = positiveCost(line.unitCost);

    let authoritativeFactor = new Decimal(1);
    if (purchaseUnit === 'PACK') {
        if (!product.packUnit?.trim() || product.packSize === null || product.packSize === undefined) {
            throw new QuantityValidationError(
                'INVALID_QUANTITY',
                'El producto no tiene un empaque completo configurado',
            );
        }
        try {
            authoritativeFactor = parseQuantity(product.packSize);
        } catch (error) {
            // parseQuantity convierte todas sus salidas fallidas a este error.
            const validationError = error as QuantityValidationError;
            throw new QuantityValidationError(
                'INVALID_QUANTITY',
                `El tamaño de empaque configurado no es válido: ${validationError.message}`,
            );
        }
    }

    const baseQuantity = validateQuantity(
        visibleQuantity.mul(authoritativeFactor).toString(),
        quantityRules(product),
    );
    const baseUnitCost = visibleUnitCost.div(authoritativeFactor);

    return {
        purchaseUnit,
        visibleQuantity,
        visibleUnitCost,
        baseQuantity,
        baseUnitCost,
        // Calcular desde lo visible conserva exactamente una factura de, por
        // ejemplo, 1 caja a C$100 aunque el costo base sea periódico (100/12).
        lineTotal: visibleQuantity.mul(visibleUnitCost).toDecimalPlaces(2),
        authoritativeFactor,
    };
};

/** Paso sugerido para el input visible. El servidor siempre revalida al final. */
export const purchaseQuantityInputStep = (
    product: PurchaseProductAuthority,
    purchaseUnit: PurchaseUnit,
): string => {
    const baseStep = new Decimal(quantityRules(product).quantityStep);
    if (purchaseUnit !== 'PACK' || product.packSize === null || product.packSize === undefined) {
        return baseStep.toString();
    }
    try {
        const factor = parseQuantity(product.packSize);
        const visibleStep = baseStep.div(factor);
        // La frontera de cantidades admite hasta 4 decimales. Si el cociente no
        // es representable, 1 empaque sigue siendo el incremento seguro/intuitivo.
        return visibleStep.decimalPlaces() <= 4 ? visibleStep.toString() : '1';
    } catch {
        return '1';
    }
};
