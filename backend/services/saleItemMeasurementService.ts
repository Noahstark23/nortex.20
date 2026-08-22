import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { Prisma, PrismaClient } from '@prisma/client';
import {
    convertQuantity,
    validateQuantity,
    type QuantityUnit,
    type SaleMode,
} from '../../utils/quantity.js';
import {
    resolveScaleLabel,
    ScaleLabelServiceError,
    type ScaleLabelPricePolicy,
} from './scaleLabelService.js';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type MeasurementSource = 'MANUAL' | 'SCALE_LABEL' | 'LIVE_SCALE';

export interface SaleMeasurementInput {
    source: MeasurementSource;
    clientEventId: string;
    capturedAt?: string;
    rawCode?: string;
    /** Alias temporal de la primera iteracion del POS. */
    scaleLabelCode?: string;
    profileVersionId?: string;
    /** Alias temporal de la primera iteracion del POS. */
    scaleProfileVersionId?: string;
    previewBaseQuantity?: string | number;
    value?: string | number;
    measuredValue?: string | number;
    unit?: string;
    measuredUnit?: string;
    deviceId?: string;
    stable?: boolean;
    /** Confirmacion explicita; el rol se vuelve a leer de la BD. */
    managerOverride?: boolean;
    pricePolicy?: ScaleLabelPricePolicy;
}

export interface SaleItemInputLike {
    id: string;
    /** Referencia opaca a un snapshot de cotización; nunca trae precio cliente. */
    quotationItemId?: string;
    quantity: string | number;
    price?: string | number;
    discount?: string | number;
    presentation?: {
        quantity: string | number;
        unit: string;
    };
    displayQuantity?: string | number;
    displayUnit?: string;
    measurement?: SaleMeasurementInput;
}

export interface NormalizedMeasurement {
    source: MeasurementSource;
    profileVersionId: string | null;
    deviceId: string | null;
    sourceValue: Decimal;
    sourceUnit: string;
    baseQuantity: Decimal;
    encodedPrice: Decimal | null;
    pricingPolicy: ScaleLabelPricePolicy;
    stable: boolean | null;
    clientEventId: string;
    payloadHash: string;
    capturedAt: Date;
}

export interface AcceptedLabelPriceOverride {
    profileVersionId: string;
    clientEventId: string;
    serverTotal: string;
    labelTotal: string;
    acceptedUnitPrice: string;
    tolerance: string;
}

export interface NormalizedSaleItem {
    productId: string;
    quantity: Decimal;
    unitPrice: Decimal;
    cost: Decimal;
    discountPct: Decimal;
    ivaExento: boolean;
    productNameAtSale: string;
    unitAtSale: string;
    saleModeAtSale: SaleMode;
    quantityStepAtSale: string;
    presentationAtSale: 'BASE' | 'PACK';
    presentationQuantityAtSale: Decimal;
    requiresBatchTracking: boolean;
    measurement: NormalizedMeasurement | null;
    acceptedLabelPriceOverride: AcceptedLabelPriceOverride | null;
    quotationId: string | null;
    quotationItemId: string | null;
}

export type SaleItemNormalizationCode =
    | 'PRODUCT_NOT_FOUND'
    | 'INVALID_PRODUCT_CONFIGURATION'
    | 'INVALID_QUANTITY'
    | 'INVALID_MEASUREMENT'
    | 'SCALE_LABEL_INVALID'
    | 'LABEL_PRICE_MISMATCH'
    | 'MANAGER_AUTH_REQUIRED'
    | 'LIVE_SCALE_NOT_ENABLED'
    | 'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT'
    | 'RECONCILIATION_REQUIRED'
    | 'DUPLICATE_MEASUREMENT_EVENT'
    | 'QUOTATION_INVALID';

export class SaleItemNormalizationError extends Error {
    constructor(
        public readonly code: SaleItemNormalizationCode,
        message: string,
        public readonly httpStatus = 400,
    ) {
        super(message);
        this.name = 'SaleItemNormalizationError';
    }
}

const PRODUCT_SELECT = {
    id: true,
    name: true,
    unit: true,
    price: true,
    cost: true,
    ivaExento: true,
    saleMode: true,
    quantityStep: true,
    wholesalePrice: true,
    wholesaleMinQty: true,
    packUnit: true,
    packSize: true,
    packPrice: true,
    requiresBatchTracking: true,
} as const;

type ProductAuthority = {
    id: string;
    name: string;
    unit: string;
    price: number;
    cost: number;
    ivaExento: boolean;
    saleMode: string | null;
    quantityStep: { toString(): string } | null;
    wholesalePrice: number | null;
    wholesaleMinQty: number | null;
    packUnit: string | null;
    packSize: number | null;
    packPrice: number | null;
    requiresBatchTracking: boolean;
};

const decimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new SaleItemNormalizationError('INVALID_QUANTITY', `${field} no es un decimal valido`);
    }
    if (!parsed.isFinite()) {
        throw new SaleItemNormalizationError('INVALID_QUANTITY', `${field} debe ser finito`);
    }
    return parsed;
};

const decimalPositive = (value: Decimal.Value, field: string): Decimal => {
    const parsed = decimal(value, field);
    if (!parsed.greaterThan(0)) {
        throw new SaleItemNormalizationError('INVALID_QUANTITY', `${field} debe ser mayor que cero`);
    }
    return parsed;
};

const sameUnit = (left: string, right: string): boolean =>
    left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

const convertToBaseUnit = (
    quantity: Decimal,
    sourceUnit: string,
    baseUnit: string,
): Decimal => {
    if (sameUnit(sourceUnit, baseUnit)) return quantity;
    try {
        return convertQuantity(
            quantity.toString(),
            sourceUnit.trim().toLocaleLowerCase() as QuantityUnit,
            baseUnit.trim().toLocaleLowerCase() as QuantityUnit,
        );
    } catch (error) {
        throw new SaleItemNormalizationError(
            'INVALID_QUANTITY',
            error instanceof Error ? error.message : 'Las unidades no son compatibles',
        );
    }
};

/** D6: legado nullable conserva fracciones; solo COUNTED explicito exige enteros. */
export const effectiveSaleModeAndStep = (
    saleMode: string | null,
    quantityStep: { toString(): string } | string | null,
): { saleMode: SaleMode; quantityStep: string } => {
    if (saleMode !== null && saleMode !== 'COUNTED' && saleMode !== 'MEASURED') {
        throw new SaleItemNormalizationError(
            'INVALID_PRODUCT_CONFIGURATION',
            `Modo de venta no permitido: ${saleMode}`,
            409,
        );
    }
    const effectiveMode: SaleMode = saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';
    return {
        saleMode: effectiveMode,
        quantityStep: quantityStep?.toString() ?? (effectiveMode === 'COUNTED' ? '1' : '0.0001'),
    };
};

const validatedProductQuantity = (product: ProductAuthority, value: Decimal): Decimal => {
    const rules = effectiveSaleModeAndStep(product.saleMode, product.quantityStep);
    try {
        return validateQuantity(value.toString(), rules);
    } catch (error) {
        throw new SaleItemNormalizationError(
            'INVALID_QUANTITY',
            error instanceof Error ? `${product.name}: ${error.message}` : `Cantidad invalida para ${product.name}`,
        );
    }
};

const validPositiveMoney = (value: number | null, field: string): Decimal | null => {
    if (value === null) return null;
    const parsed = decimal(value, field);
    return parsed.greaterThan(0) ? parsed : null;
};

/** Replica la escalera detalle/mayoreo/empaque, usando Decimal para el dinero. */
export const calculateAuthoritativeUnitPrice = (
    product: Pick<ProductAuthority, 'price' | 'wholesalePrice' | 'wholesaleMinQty' | 'packPrice' | 'packSize'>,
    quantity: Decimal.Value,
    wholesaleCustomer: boolean,
    presentation: 'BASE' | 'PACK' = 'BASE',
): Decimal => {
    const qty = decimalPositive(quantity, 'quantity');
    const base = decimal(product.price, 'Product.price');
    if (!base.greaterThan(0)) {
        throw new SaleItemNormalizationError(
            'INVALID_PRODUCT_CONFIGURATION',
            'El producto no tiene un precio de venta positivo',
            409,
        );
    }

    let chosen = base;
    let threshold = new Decimal(0);
    const wholesale = validPositiveMoney(product.wholesalePrice, 'Product.wholesalePrice');
    if (wholesale) {
        const configuredThreshold = product.wholesaleMinQty === null
            ? null
            : decimal(product.wholesaleMinQty, 'Product.wholesaleMinQty');
        const candidateThreshold = wholesaleCustomer
            ? new Decimal(0)
            : configuredThreshold?.greaterThan(0)
                ? configuredThreshold
                : null;
        if (candidateThreshold && qty.greaterThanOrEqualTo(candidateThreshold)) {
            chosen = wholesale;
            threshold = candidateThreshold;
        }
    }

    if (presentation === 'PACK') {
        const packPrice = validPositiveMoney(product.packPrice, 'Product.packPrice');
        const packSize = product.packSize === null ? null : decimal(product.packSize, 'Product.packSize');
        if (packPrice && packSize?.greaterThan(0)) {
            chosen = packPrice.dividedBy(packSize);
        }
    }

    // El total monetario se redondea al final de la línea. Conservar 4dp evita
    // que un empaque de C$10 / 3 unidades se convierta prematuramente en
    // C$3.33 x 3 = C$9.99. priceAtSale sigue siendo un shadow legado a 2dp.
    return chosen.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
};

const parseDiscount = (value: string | number | undefined): Decimal => {
    if (value === undefined) return new Decimal(0);
    const parsed = decimal(value, 'discount');
    if (parsed.isNegative() || parsed.greaterThan(100)) {
        throw new SaleItemNormalizationError('INVALID_QUANTITY', 'El descuento debe estar entre 0 y 100');
    }
    return parsed;
};

const captureDate = (value: string | undefined): Date => {
    if (!value) return new Date();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new SaleItemNormalizationError('INVALID_MEASUREMENT', 'capturedAt no es una fecha valida');
    }
    if (parsed.getTime() > Date.now() + 10 * 60 * 1000) {
        throw new SaleItemNormalizationError('INVALID_MEASUREMENT', 'capturedAt no puede estar en el futuro');
    }
    return parsed;
};

const stablePayloadHash = (payload: Record<string, unknown>): string =>
    createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const directQuantity = (
    item: SaleItemInputLike,
    product: ProductAuthority,
): {
    baseQuantity: Decimal;
    sourceValue: Decimal;
    sourceUnit: string;
    presentationAtSale: 'BASE' | 'PACK';
    presentationQuantityAtSale: Decimal;
} => {
    const clientBaseQuantity = decimalPositive(item.quantity, 'quantity');
    const legacyDisplay = item.displayQuantity === undefined
        ? null
        : {
            quantity: item.displayQuantity,
            unit: item.displayUnit ?? product.unit,
        };
    const presentation = item.presentation ?? legacyDisplay;
    if (!presentation) {
        const baseQuantity = validatedProductQuantity(product, clientBaseQuantity);
        return {
            baseQuantity,
            sourceValue: baseQuantity,
            sourceUnit: product.unit,
            presentationAtSale: 'BASE',
            presentationQuantityAtSale: baseQuantity,
        };
    }

    const sourceValue = decimalPositive(presentation.quantity, 'presentation.quantity');
    const sourceUnit = presentation.unit.trim();
    if (!sourceUnit) {
        throw new SaleItemNormalizationError('INVALID_QUANTITY', 'presentation.unit es requerida');
    }

    let derived: Decimal;
    let presentationAtSale: 'BASE' | 'PACK' = 'BASE';
    if (product.packUnit && sameUnit(sourceUnit, product.packUnit)) {
        const packSize = product.packSize === null ? null : decimalPositive(product.packSize, 'Product.packSize');
        if (!packSize) {
            throw new SaleItemNormalizationError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${product.name} no tiene tamano de empaque configurado`,
                409,
            );
        }
        derived = sourceValue.mul(packSize);
        presentationAtSale = 'PACK';
    } else {
        derived = convertToBaseUnit(sourceValue, sourceUnit, product.unit);
    }

    const baseQuantity = validatedProductQuantity(product, derived);
    if (!baseQuantity.equals(clientBaseQuantity)) {
        throw new SaleItemNormalizationError(
            'INVALID_QUANTITY',
            `La presentacion de ${product.name} no coincide con la cantidad base enviada`,
        );
    }
    return {
        baseQuantity,
        sourceValue,
        sourceUnit,
        presentationAtSale,
        presentationQuantityAtSale: presentationAtSale === 'PACK' ? sourceValue : baseQuantity,
    };
};

const requireManagerRole = async (
    db: PrismaLike,
    tenantId: string,
    userId: string,
): Promise<void> => {
    const actor = await db.user.findFirst({
        where: { id: userId, tenantId, status: 'ACTIVE' },
        select: { role: true },
    });
    if (!actor || !['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(actor.role)) {
        throw new SaleItemNormalizationError(
            'MANAGER_AUTH_REQUIRED',
            'Aceptar el total de una etiqueta requiere autorizacion de gerencia',
            403,
        );
    }
};

export async function normalizeSaleItems(
    db: PrismaLike,
    params: {
        tenantId: string;
        userId: string;
        items: SaleItemInputLike[];
        wholesaleCustomer: boolean;
        allowRevokedScaleVersionForReplay: boolean;
        quotedAt?: Date;
    },
): Promise<NormalizedSaleItem[]> {
    const labelResolutions = new Map<number, Awaited<ReturnType<typeof resolveScaleLabel>>>();
    const productIds = new Set<string>();
    const seenClientEvents = new Set<string>();
    const requestedQuotationItemIds = params.items
        .map((item) => item.quotationItemId?.trim())
        .filter((id): id is string => Boolean(id));
    if (new Set(requestedQuotationItemIds).size !== requestedQuotationItemIds.length) {
        throw new SaleItemNormalizationError(
            'QUOTATION_INVALID',
            'Una línea de cotización aparece más de una vez',
            409,
        );
    }
    const quoteRows = requestedQuotationItemIds.length === 0
        ? []
        : await db.quotationItem.findMany({
            where: {
                id: { in: requestedQuotationItemIds },
                quotation: { tenantId: params.tenantId },
            },
            select: {
                id: true,
                quotationId: true,
                productId: true,
                quantity: true,
                quantityExact: true,
                price: true,
                unitPriceExact: true,
                name: true,
                unitAtQuote: true,
                saleModeAtQuote: true,
                quantityStepAtQuote: true,
                presentationAtQuote: true,
                presentationQuantityAtQuote: true,
                ivaExentoAtQuote: true,
                quotation: {
                    select: { status: true, expiresAt: true },
                },
            },
        });
    if (quoteRows.length !== requestedQuotationItemIds.length) {
        throw new SaleItemNormalizationError(
            'QUOTATION_INVALID',
            'La cotización no existe en este negocio',
            404,
        );
    }
    const quoteById = new Map(quoteRows.map((row) => [row.id, row]));
    const quotedAt = params.quotedAt ?? new Date();
    for (const quote of quoteRows) {
        if (quote.quotation.status !== 'SENT' || quote.quotation.expiresAt.getTime() < quotedAt.getTime()) {
            throw new SaleItemNormalizationError(
                'QUOTATION_INVALID',
                'La cotización ya fue procesada o está vencida',
                409,
            );
        }
    }

    for (let index = 0; index < params.items.length; index += 1) {
        const item = params.items[index];
        const measurement = item.measurement;
        const quotedItem = item.quotationItemId
            ? quoteById.get(item.quotationItemId.trim())
            : undefined;
        if (quotedItem && measurement) {
            throw new SaleItemNormalizationError(
                'QUOTATION_INVALID',
                'Una línea cotizada no puede reemplazarse con una nueva medición',
                409,
            );
        }
        if (quotedItem && quotedItem.productId !== item.id) {
            throw new SaleItemNormalizationError(
                'QUOTATION_INVALID',
                'La línea cotizada no coincide con el producto enviado',
                409,
            );
        }
        if (measurement) {
            if (seenClientEvents.has(measurement.clientEventId)) {
                throw new SaleItemNormalizationError(
                    'DUPLICATE_MEASUREMENT_EVENT',
                    'La misma captura de balanza aparece mas de una vez en la venta',
                    409,
                );
            }
            seenClientEvents.add(measurement.clientEventId);
        }

        if (measurement?.source === 'LIVE_SCALE') {
            throw new SaleItemNormalizationError(
                'LIVE_SCALE_NOT_ENABLED',
                'La lectura directa requiere un adaptador de balanza aprobado; use captura manual o etiqueta',
                422,
            );
        }
        if (measurement?.source === 'SCALE_LABEL') {
            const profileVersionId = measurement.profileVersionId ?? measurement.scaleProfileVersionId;
            const rawCode = measurement.rawCode ?? measurement.scaleLabelCode;
            if (!profileVersionId || !rawCode) {
                throw new SaleItemNormalizationError(
                    'INVALID_MEASUREMENT',
                    'La etiqueta requiere rawCode y profileVersionId',
                );
            }
            try {
                const resolved = await resolveScaleLabel({
                    db,
                    tenantId: params.tenantId,
                    profileVersionId,
                    rawCode,
                    allowRevokedForReplay: params.allowRevokedScaleVersionForReplay,
                });
                // El parser exacto permanece disponible para explicar la cola,
                // pero una version revocada nunca se autoacepta ni se cambia por
                // la version vigente: pasa a conciliacion humana.
                if (resolved.profileVersion.status === 'REVOKED') {
                    throw new SaleItemNormalizationError(
                        'RECONCILIATION_REQUIRED',
                        'La etiqueta usa una version revocada y requiere conciliacion',
                        409,
                    );
                }
                // Un total impreso no demuestra el peso. Derivar total/precio
                // descontaria inventario distinto si el precio cambio. Hasta
                // soportar un layout que codifique AMBOS valores, se exige
                // reimpresion por peso o captura manual.
                if (resolved.parsed.valueKind === 'TOTAL_PRICE' || resolved.baseQuantity === null) {
                    throw new SaleItemNormalizationError(
                        'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT',
                        'La etiqueta solo contiene precio total; capture tambien el peso para facturar',
                        422,
                    );
                }
                labelResolutions.set(index, resolved);
                productIds.add(resolved.mapping.productId);
            } catch (error) {
                if (error instanceof ScaleLabelServiceError) {
                    if (error.code === 'REVOKED_RECONCILIATION_REQUIRED') {
                        throw new SaleItemNormalizationError(
                            'RECONCILIATION_REQUIRED',
                            error.message,
                            error.httpStatus,
                        );
                    }
                    if (error.code === 'TOTAL_PRICE_REQUIRES_WEIGHT') {
                        throw new SaleItemNormalizationError(
                            'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT',
                            error.message,
                            error.httpStatus,
                        );
                    }
                    throw new SaleItemNormalizationError(
                        'SCALE_LABEL_INVALID',
                        error.message,
                        error.httpStatus,
                    );
                }
                throw error;
            }
        } else {
            productIds.add(quotedItem?.productId ?? item.id);
        }
    }

    const products = await db.product.findMany({
        where: { tenantId: params.tenantId, id: { in: [...productIds] } },
        select: PRODUCT_SELECT,
    }) as unknown as ProductAuthority[];
    const productById = new Map(products.map((product) => [product.id, product]));
    const normalized: NormalizedSaleItem[] = [];

    for (let index = 0; index < params.items.length; index += 1) {
        const item = params.items[index];
        const resolvedLabel = labelResolutions.get(index);
        const quotedItem = item.quotationItemId
            ? quoteById.get(item.quotationItemId.trim())
            : undefined;
        const productId = resolvedLabel?.mapping.productId ?? quotedItem?.productId ?? item.id;
        const product = productById.get(productId);
        if (!product) {
            throw new SaleItemNormalizationError(
                'PRODUCT_NOT_FOUND',
                `Producto ${productId} no encontrado en este negocio`,
                404,
            );
        }
        if (!product.unit.trim()) {
            throw new SaleItemNormalizationError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${product.name} no tiene unidad base configurada`,
                409,
            );
        }
        const cost = decimal(product.cost, 'Product.cost');
        if (cost.isNegative()) {
            throw new SaleItemNormalizationError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${product.name} tiene costo negativo`,
                409,
            );
        }
        const discountPct = parseDiscount(item.discount);

        if (!resolvedLabel) {
            if (quotedItem) {
                if (!discountPct.isZero()) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        'No se puede alterar el descuento de una línea cotizada',
                        409,
                    );
                }
                if (
                    quotedItem.saleModeAtQuote !== null
                    && quotedItem.saleModeAtQuote !== 'COUNTED'
                    && quotedItem.saleModeAtQuote !== 'MEASURED'
                ) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        'La cotización contiene un modo de venta inválido',
                        409,
                    );
                }
                const currentRules = effectiveSaleModeAndStep(product.saleMode, product.quantityStep);
                const saleModeAtSale = quotedItem.saleModeAtQuote ?? currentRules.saleMode;
                const quantityStepAtSale = quotedItem.quantityStepAtQuote?.toString()
                    ?? (quotedItem.saleModeAtQuote === null
                        ? currentRules.quantityStep
                        : saleModeAtSale === 'COUNTED' ? '1' : '0.0001');
                let baseQuantity: Decimal;
                let clientQuantity: Decimal;
                try {
                    const rules = { saleMode: saleModeAtSale as SaleMode, quantityStep: quantityStepAtSale };
                    baseQuantity = validateQuantity(
                        quotedItem.quantityExact?.toString() ?? quotedItem.quantity,
                        rules,
                    );
                    clientQuantity = validateQuantity(item.quantity, rules);
                } catch (error) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        error instanceof Error ? error.message : 'La cotización contiene una cantidad inválida',
                        409,
                    );
                }
                if (!clientQuantity.equals(baseQuantity)) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        'La cantidad enviada no coincide con la cotización',
                        409,
                    );
                }
                const unitPrice = decimalPositive(
                    quotedItem.unitPriceExact?.toString() ?? quotedItem.price.toString(),
                    'QuotationItem.unitPriceExact',
                ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
                const unitAtSale = quotedItem.unitAtQuote?.trim() || product.unit;
                if (!unitAtSale) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        'La cotización no conserva una unidad válida',
                        409,
                    );
                }
                if (
                    quotedItem.presentationAtQuote !== null
                    && quotedItem.presentationAtQuote !== 'BASE'
                    && quotedItem.presentationAtQuote !== 'PACK'
                ) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        'La cotización contiene una presentación inválida',
                        409,
                    );
                }
                const presentationAtSale = quotedItem.presentationAtQuote === 'PACK' ? 'PACK' : 'BASE';
                let presentationQuantityAtSale: Decimal;
                try {
                    presentationQuantityAtSale = validateQuantity(
                        quotedItem.presentationQuantityAtQuote?.toString() ?? baseQuantity,
                        { saleMode: 'MEASURED', quantityStep: '0.0001' },
                    );
                } catch (error) {
                    throw new SaleItemNormalizationError(
                        'QUOTATION_INVALID',
                        error instanceof Error ? error.message : 'La presentación cotizada es inválida',
                        409,
                    );
                }
                normalized.push({
                    productId: product.id,
                    quantity: baseQuantity,
                    unitPrice,
                    cost,
                    discountPct,
                    ivaExento: quotedItem.ivaExentoAtQuote ?? product.ivaExento === true,
                    productNameAtSale: quotedItem.name,
                    unitAtSale,
                    saleModeAtSale: saleModeAtSale as SaleMode,
                    quantityStepAtSale,
                    presentationAtSale,
                    presentationQuantityAtSale,
                    requiresBatchTracking: product.requiresBatchTracking,
                    measurement: null,
                    acceptedLabelPriceOverride: null,
                    quotationId: quotedItem.quotationId,
                    quotationItemId: quotedItem.id,
                });
                continue;
            }
            const direct = directQuantity(item, product);
            const unitPrice = calculateAuthoritativeUnitPrice(
                product,
                direct.baseQuantity,
                params.wholesaleCustomer,
                direct.presentationAtSale,
            );
            const measurement = item.measurement?.source === 'MANUAL'
                ? {
                    source: 'MANUAL' as const,
                    profileVersionId: null,
                    deviceId: null,
                    sourceValue: direct.sourceValue,
                    sourceUnit: direct.sourceUnit,
                    baseQuantity: direct.baseQuantity,
                    encodedPrice: null,
                    pricingPolicy: 'RECALCULATE' as const,
                    stable: null,
                    clientEventId: item.measurement.clientEventId,
                    payloadHash: stablePayloadHash({
                        source: 'MANUAL',
                        productId: product.id,
                        sourceValue: direct.sourceValue.toString(),
                        sourceUnit: direct.sourceUnit,
                        baseQuantity: direct.baseQuantity.toString(),
                    }),
                    capturedAt: captureDate(item.measurement.capturedAt),
                }
                : null;
            normalized.push({
                productId: product.id,
                quantity: direct.baseQuantity,
                unitPrice,
                cost,
                discountPct,
                ivaExento: product.ivaExento === true,
                productNameAtSale: product.name,
                unitAtSale: product.unit,
                saleModeAtSale: effectiveSaleModeAndStep(product.saleMode, product.quantityStep).saleMode,
                quantityStepAtSale: effectiveSaleModeAndStep(product.saleMode, product.quantityStep).quantityStep,
                presentationAtSale: direct.presentationAtSale,
                presentationQuantityAtSale: direct.presentationQuantityAtSale,
                requiresBatchTracking: product.requiresBatchTracking,
                measurement,
                acceptedLabelPriceOverride: null,
                quotationId: null,
                quotationItemId: null,
            });
            continue;
        }

        const measurementInput = item.measurement!;
        const sourceValue = decimalPositive(resolvedLabel.parsed.value, 'valor de etiqueta');
        const encodedPrice = resolvedLabel.encodedPrice === null
            ? null
            : decimalPositive(resolvedLabel.encodedPrice, 'total de etiqueta');
        let baseQuantity = validatedProductQuantity(
            product,
            decimalPositive(resolvedLabel.baseQuantity, 'cantidad base de etiqueta'),
        );
        let unitPrice = calculateAuthoritativeUnitPrice(product, baseQuantity, params.wholesaleCustomer, 'BASE');

        const pricingPolicy = resolvedLabel.profileVersion.pricePolicy;
        const tolerance = decimal(resolvedLabel.profileVersion.roundingTolerance, 'roundingTolerance');
        // La tolerancia del perfil es Decimal(18,4): se compara contra el total
        // exacto a 4dp antes de redondearlo a moneda. Comparar dos valores ya
        // redondeados a centavos volveria REQUIRE_MATCH casi tautologico.
        const serverTotalExact = baseQuantity.mul(unitPrice).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const serverTotal = serverTotalExact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        let acceptedLabelPriceOverride: AcceptedLabelPriceOverride | null = null;

        if (pricingPolicy === 'REQUIRE_MATCH' || pricingPolicy === 'ACCEPT_LABEL_TOTAL') {
            if (!encodedPrice) {
                throw new SaleItemNormalizationError(
                    'INVALID_MEASUREMENT',
                    `La politica ${pricingPolicy} requiere una etiqueta que codifique precio total`,
                    422,
                );
            }
            const difference = serverTotalExact.minus(encodedPrice).abs();
            if (pricingPolicy === 'REQUIRE_MATCH' && difference.greaterThan(tolerance)) {
                throw new SaleItemNormalizationError(
                    'LABEL_PRICE_MISMATCH',
                    `El total de la etiqueta no coincide con el precio vigente (diferencia ${difference.toFixed(2)})`,
                    409,
                );
            }
            if (pricingPolicy === 'ACCEPT_LABEL_TOTAL') {
                if (measurementInput.managerOverride !== true) {
                    throw new SaleItemNormalizationError(
                        'MANAGER_AUTH_REQUIRED',
                        'Debe confirmar explicitamente la excepcion de precio de etiqueta',
                        403,
                    );
                }
                await requireManagerRole(db, params.tenantId, params.userId);
                const overrideUnitPrice = encodedPrice
                    .dividedBy(baseQuantity)
                    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
                const representableTotal = overrideUnitPrice
                    .mul(baseQuantity)
                    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
                if (representableTotal.minus(encodedPrice).abs().greaterThan(tolerance)) {
                    throw new SaleItemNormalizationError(
                        'LABEL_PRICE_MISMATCH',
                        'El total de etiqueta no cabe en la precision monetaria permitida',
                        422,
                    );
                }
                acceptedLabelPriceOverride = {
                    profileVersionId: resolvedLabel.profileVersion.id,
                    clientEventId: measurementInput.clientEventId,
                    serverTotal: serverTotal.toFixed(2),
                    labelTotal: encodedPrice.toFixed(2),
                    acceptedUnitPrice: overrideUnitPrice.toFixed(2),
                    tolerance: tolerance.toString(),
                };
                unitPrice = overrideUnitPrice;
            }
        }

        const capturedAt = captureDate(measurementInput.capturedAt);
        const measurement: NormalizedMeasurement = {
            source: 'SCALE_LABEL',
            profileVersionId: resolvedLabel.profileVersion.id,
            deviceId: null,
            sourceValue,
            sourceUnit: resolvedLabel.parsed.sourceUnit,
            baseQuantity,
            encodedPrice,
            pricingPolicy,
            stable: null,
            clientEventId: measurementInput.clientEventId,
            payloadHash: resolvedLabel.codeHash,
            capturedAt,
        };
        normalized.push({
            productId: product.id,
            quantity: baseQuantity,
            unitPrice,
            cost,
            discountPct,
            ivaExento: product.ivaExento === true,
            productNameAtSale: product.name,
            unitAtSale: product.unit,
            saleModeAtSale: effectiveSaleModeAndStep(product.saleMode, product.quantityStep).saleMode,
            quantityStepAtSale: effectiveSaleModeAndStep(product.saleMode, product.quantityStep).quantityStep,
            presentationAtSale: 'BASE',
            presentationQuantityAtSale: baseQuantity,
            requiresBatchTracking: product.requiresBatchTracking,
            measurement,
            acceptedLabelPriceOverride,
            quotationId: null,
            quotationItemId: null,
        });
    }

    return normalized;
}
