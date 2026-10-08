export const PRODUCT_BATCH_EXPIRY_CONFLICT_CODE = 'BATCH_EXPIRY_CONFLICT' as const;

export type ProductBatchExpiryValue = Date | string;

const expiryCivilDay = (value: ProductBatchExpiryValue): string => {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new RangeError('La fecha de vencimiento del lote es invalida');
        }
        // expiryDate es un campo calendario. Los registros historicos pueden
        // estar normalizados a 00:00Z o 12:00Z, pero ambos conservan aqui el
        // mismo YYYY-MM-DD impreso.
        return value.toISOString().slice(0, 10);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) {
        throw new RangeError('La fecha de vencimiento del lote debe usar YYYY-MM-DD');
    }
    const canonicalDay = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${canonicalDay}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== canonicalDay) {
        throw new RangeError('La fecha de vencimiento del lote es invalida');
    }
    return canonicalDay;
};

export class ProductBatchIdentityError extends Error {
    readonly code = PRODUCT_BATCH_EXPIRY_CONFLICT_CODE;
    readonly httpStatus = 409;

    constructor(
        message: string,
        readonly details: {
            productId: string;
            batchNumber: string;
            existingExpiryDate: string;
            incomingExpiryDate: string;
        },
    ) {
        super(message);
        this.name = 'ProductBatchIdentityError';
    }
}

/**
 * Impide que la identidad unica producto+lote acumule existencias con dos
 * vencimientos civiles distintos. Es puro para reutilizarlo en compras
 * directas, altas manuales y recepciones de orden de compra.
 */
export function assertProductBatchExpiryIdentity(params: {
    productId: string;
    batchNumber: string;
    existingExpiryDate: ProductBatchExpiryValue;
    incomingExpiryDate: ProductBatchExpiryValue;
    productName?: string;
}): void {
    const existingExpiryDate = expiryCivilDay(params.existingExpiryDate);
    const incomingExpiryDate = expiryCivilDay(params.incomingExpiryDate);
    if (existingExpiryDate === incomingExpiryDate) return;

    const productLabel = params.productName ? ` de ${params.productName}` : '';
    throw new ProductBatchIdentityError(
        `El lote ${params.batchNumber}${productLabel} ya tiene otro vencimiento`,
        {
            productId: params.productId,
            batchNumber: params.batchNumber,
            existingExpiryDate,
            incomingExpiryDate,
        },
    );
}
