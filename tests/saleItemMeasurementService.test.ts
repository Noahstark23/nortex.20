import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveScaleLabelMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/scaleLabelService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/scaleLabelService.js')>()),
    resolveScaleLabel: resolveScaleLabelMock,
}));

import {
    calculateAuthoritativeUnitPrice,
    effectiveSaleModeAndStep,
    normalizeSaleItems,
    SaleItemNormalizationError,
} from '../backend/services/saleItemMeasurementService';
import {
    authoritativeQuotationId,
    CreateSaleSchema,
    isCompleteMeasurementReplay,
} from '../backend/services/salesService';
import { ScaleLabelServiceError } from '../backend/services/scaleLabelService';

const product = (patch: Record<string, unknown> = {}) => ({
    id: 'product-a',
    name: 'Pollo por libra',
    unit: 'lb',
    price: 48,
    cost: 30,
    ivaExento: false,
    saleMode: 'MEASURED',
    quantityStep: { toString: () => '0.0001' },
    wholesalePrice: null,
    wholesaleMinQty: null,
    packUnit: null,
    packSize: null,
    packPrice: null,
    requiresBatchTracking: false,
    ...patch,
});

const fakeDb = (products = [product()], role = 'CASHIER') => ({
    product: {
        findMany: vi.fn(async ({ where }: any) => products.filter(
            (candidate: any) => where.tenantId === 'tenant-a' && where.id.in.includes(candidate.id),
        )),
    },
    user: {
        findFirst: vi.fn(async ({ where }: any) => (
            where.tenantId === 'tenant-a' && where.id === 'user-a'
                ? { role }
                : null
        )),
    },
}) as any;

const quoteRow = (patch: Record<string, unknown> = {}) => ({
    id: 'quote-item-a',
    quotationId: 'quote-a',
    productId: 'product-a',
    quantity: 1,
    quantityExact: { toString: () => '0.75' },
    price: { toString: () => '1.00' },
    unitPriceExact: { toString: () => '47.1234' },
    name: 'Pollo cotizado',
    unitAtQuote: 'lb',
    saleModeAtQuote: 'MEASURED',
    quantityStepAtQuote: { toString: () => '0.01' },
    presentationAtQuote: 'BASE',
    presentationQuantityAtQuote: { toString: () => '0.75' },
    ivaExentoAtQuote: true,
    quotation: {
        status: 'SENT',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
    ...patch,
});

const fakeQuoteDb = (quotes = [quoteRow()]) => {
    const db = fakeDb([product({
        name: 'Nombre actual cambiado',
        unit: 'kg',
        price: 999,
        ivaExento: false,
        saleMode: 'COUNTED',
        quantityStep: { toString: () => '1' },
    })]);
    db.quotationItem = {
        findMany: vi.fn(async ({ where }: any) => quotes.filter(
            (candidate: any) => where.id.in.includes(candidate.id),
        )),
    };
    return db;
};

const labelResolution = (patch: Record<string, unknown> = {}) => ({
    profileVersion: {
        id: 'version-a',
        profileId: 'profile-a',
        version: 3,
        status: 'PUBLISHED',
        pricePolicy: 'RECALCULATE',
        roundingTolerance: '0.01',
    },
    mapping: {
        id: 'mapping-a',
        plu: '12345',
        productId: 'product-a',
        sourceUnit: 'lb',
    },
    product: {
        id: 'product-a',
        name: 'Pollo por libra',
        unit: 'lb',
        price: 48,
        saleMode: 'MEASURED',
        quantityStep: '0.0001',
    },
    parsed: {
        plu: '12345',
        value: '1.2500',
        valueKind: 'WEIGHT',
        sourceUnit: 'lb',
    },
    baseQuantity: '1.25',
    encodedPrice: null,
    calculatedTotal: '60.00',
    codeHash: 'a'.repeat(64),
    ...patch,
});

describe('contrato de cantidad de venta', () => {
    it('D6 conserva fracciones en productos legados nullable', async () => {
        expect(effectiveSaleModeAndStep(null, null)).toEqual({
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
        });
        const result = await normalizeSaleItems(fakeDb([product({ saleMode: null, quantityStep: null })]), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{ id: 'product-a', quantity: '1.2345', price: '0.01' }],
        });
        expect(result[0].quantity.toString()).toBe('1.2345');
    });

    it('solo COUNTED explicito exige entero y su step', async () => {
        const db = fakeDb([product({ saleMode: 'COUNTED', quantityStep: { toString: () => '1' } })]);
        await expect(normalizeSaleItems(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{ id: 'product-a', quantity: '1.5', price: 48 }],
        })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('Zod rechaza NaN, Infinity y mas de cuatro decimales', () => {
        const base = { paymentMethod: 'CASH', items: [{ id: 'p', quantity: 1, price: 1 }] };
        expect(CreateSaleSchema.safeParse({ ...base, items: [{ id: 'p', quantity: Number.NaN }] }).success).toBe(false);
        expect(CreateSaleSchema.safeParse({ ...base, items: [{ id: 'p', quantity: Infinity }] }).success).toBe(false);
        expect(CreateSaleSchema.safeParse({ ...base, items: [{ id: 'p', quantity: '1.00001' }] }).success).toBe(false);
        expect(CreateSaleSchema.safeParse({ ...base, items: [{ id: 'p', quantity: '1.0001' }] }).success).toBe(true);
    });
});

describe('autoridad server-side', () => {
    it('ignora precio y costo manipulados y usa Product', async () => {
        const result = await normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{ id: 'product-a', quantity: '1.25', price: '-999' }],
        });
        expect(result[0].unitPrice.toFixed(2)).toBe('48.00');
        expect(result[0].cost.toFixed(2)).toBe('30.00');
        expect(result[0].unitAtSale).toBe('lb');
        expect(result[0].saleModeAtSale).toBe('MEASURED');
    });

    it('aplica mayoreo/empaque con Decimal desde configuracion persistida', () => {
        const configured = {
            price: 10,
            wholesalePrice: 8.5,
            wholesaleMinQty: 6,
            packPrice: 90,
            packSize: 12,
        };
        expect(calculateAuthoritativeUnitPrice(configured, '6', false).toFixed(2)).toBe('8.50');
        expect(calculateAuthoritativeUnitPrice(configured, '12', false).toFixed(2)).toBe('8.50');
        expect(calculateAuthoritativeUnitPrice(configured, '12', false, 'PACK').toFixed(2)).toBe('7.50');
        expect(calculateAuthoritativeUnitPrice(configured, '1', true).toFixed(2)).toBe('8.50');
    });

    it('conserva precision de empaque y redondea el total una sola vez', () => {
        const unitPrice = calculateAuthoritativeUnitPrice({
            price: 5,
            wholesalePrice: null,
            wholesaleMinQty: null,
            packPrice: 10,
            packSize: 3,
        }, '3', false, 'PACK');

        expect(unitPrice.toFixed(4)).toBe('3.3333');
        expect(unitPrice.mul(3).toDecimalPlaces(2).toFixed(2)).toBe('10.00');
    });

    it('no aplica precio de empaque a una cantidad suelta que supera packSize', async () => {
        const configured = product({
            price: 10,
            wholesalePrice: null,
            wholesaleMinQty: null,
            packUnit: 'saco',
            packPrice: 90,
            packSize: 12,
        });
        const [loose, pack] = await Promise.all([
            normalizeSaleItems(fakeDb([configured]), {
                tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
                allowRevokedScaleVersionForReplay: false,
                items: [{
                    id: 'product-a', quantity: '12.5',
                    presentation: { quantity: '12.5', unit: 'lb' },
                }],
            }),
            normalizeSaleItems(fakeDb([configured]), {
                tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
                allowRevokedScaleVersionForReplay: false,
                items: [{
                    id: 'product-a', quantity: '12',
                    presentation: { quantity: '1', unit: 'saco' },
                }],
            }),
        ]);

        expect(loose[0].presentationAtSale).toBe('BASE');
        expect(loose[0].unitPrice.toFixed(2)).toBe('10.00');
        expect(pack[0].presentationAtSale).toBe('PACK');
        expect(pack[0].unitPrice.toFixed(2)).toBe('7.50');
    });
});

describe('cotización autoritativa', () => {
    it('congela precio, cantidad, unidad, modo, paso e IVA aunque cambie Product', async () => {
        const result = await normalizeSaleItems(fakeQuoteDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            quotedAt: new Date('2029-01-01T00:00:00.000Z'),
            items: [{
                id: 'product-a',
                quotationItemId: 'quote-item-a',
                quantity: '0.75',
                price: '0.01',
            }],
        });

        expect(result[0]).toMatchObject({
            quotationId: 'quote-a',
            quotationItemId: 'quote-item-a',
            productId: 'product-a',
            productNameAtSale: 'Pollo cotizado',
            unitAtSale: 'lb',
            saleModeAtSale: 'MEASURED',
            quantityStepAtSale: '0.01',
            ivaExento: true,
        });
        expect(result[0].quantity.toString()).toBe('0.75');
        expect(result[0].unitPrice.toFixed(4)).toBe('47.1234');
    });

    it('rechaza cantidad y descuento de línea manipulados', async () => {
        const params = {
            tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            quotedAt: new Date('2029-01-01T00:00:00.000Z'),
        };
        await expect(normalizeSaleItems(fakeQuoteDb(), {
            ...params,
            items: [{ id: 'product-a', quotationItemId: 'quote-item-a', quantity: '0.76' }],
        })).rejects.toMatchObject({ code: 'QUOTATION_INVALID' });
        await expect(normalizeSaleItems(fakeQuoteDb(), {
            ...params,
            items: [{
                id: 'product-a', quotationItemId: 'quote-item-a', quantity: '0.75', discount: '1',
            }],
        })).rejects.toMatchObject({ code: 'QUOTATION_INVALID' });
    });

    it('rechaza quotationItem cross-tenant/no encontrado', async () => {
        await expect(normalizeSaleItems(fakeQuoteDb([]), {
            tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{ id: 'product-a', quotationItemId: 'foreign-item', quantity: '0.75' }],
        })).rejects.toMatchObject({ code: 'QUOTATION_INVALID', httpStatus: 404 });
    });

    it('rechaza descuento global y mezcla con líneas libres en una conversión', () => {
        const quoted = [{ quotationId: 'quote-a' }];
        expect(() => authoritativeQuotationId(quoted as any, '0.01')).toThrowError(
            expect.objectContaining({ code: 'QUOTATION_INVALID' }),
        );
        expect(() => authoritativeQuotationId([
            ...quoted,
            { quotationId: null },
        ] as any, '0')).toThrowError(expect.objectContaining({ code: 'QUOTATION_INVALID' }));
        expect(authoritativeQuotationId(quoted as any, '0')).toBe('quote-a');
    });
});

describe('idempotencia de eventos medidos', () => {
    it('solo considera replay si todos los eventos apuntan a una venta y el hash de etiqueta coincide', () => {
        const rows = [{ clientEventId: 'event-1', payloadHash: 'hash-a', saleId: 'sale-a' }];
        expect(isCompleteMeasurementReplay(rows, ['event-1'], new Map([['event-1', 'hash-a']]))).toBe(true);
        expect(isCompleteMeasurementReplay(rows, ['event-1'], new Map([['event-1', 'hash-b']]))).toBe(false);
        expect(isCompleteMeasurementReplay(rows, ['event-1', 'event-2'], new Map())).toBe(false);
        expect(isCompleteMeasurementReplay([
            ...rows,
            { clientEventId: 'event-2', payloadHash: 'hash-b', saleId: 'sale-b' },
        ], ['event-1', 'event-2'], new Map())).toBe(false);
    });
});

describe('etiqueta de balanza', () => {
    beforeEach(() => {
        resolveScaleLabelMock.mockReset();
        resolveScaleLabelMock.mockResolvedValue(labelResolution());
    });

    it('reparsea con tenant/version exactos y no confia en id, quantity ni price del cliente', async () => {
        const db = fakeDb();
        const result = await normalizeSaleItems(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{
                id: 'producto-manipulado',
                quantity: '999',
                price: '0.01',
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-label-0001',
                    rawCode: '2012345012509',
                    profileVersionId: 'version-a',
                },
            }],
        });

        expect(resolveScaleLabelMock).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 'tenant-a',
            profileVersionId: 'version-a',
            allowRevokedForReplay: false,
        }));
        expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-a', id: { in: ['product-a'] } },
        }));
        expect(result[0].productId).toBe('product-a');
        expect(result[0].quantity.toString()).toBe('1.25');
        expect(result[0].unitPrice.toFixed(2)).toBe('48.00');
        expect(result[0].measurement?.payloadHash).toBe('a'.repeat(64));
        expect(JSON.stringify(result[0])).not.toContain('2012345012509');
    });

    it('vuelve a scopear el producto del mapping y rechaza uno cross-tenant', async () => {
        resolveScaleLabelMock.mockResolvedValue(labelResolution({
            mapping: {
                id: 'mapping-foreign',
                plu: '12345',
                productId: 'foreign-product',
                sourceUnit: 'lb',
            },
        }));
        await expect(normalizeSaleItems(fakeDb([]), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{
                id: 'foreign-product',
                quantity: '1',
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-label-0002',
                    rawCode: '2012345012509',
                    profileVersionId: 'version-a',
                },
            }],
        })).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    });

    it('TOTAL_PRICE exige peso verificable y nunca deriva inventario como total/precio', async () => {
        resolveScaleLabelMock.mockResolvedValue(labelResolution({
            profileVersion: {
                id: 'version-a',
                profileId: 'profile-a',
                version: 3,
                status: 'PUBLISHED',
                pricePolicy: 'REQUIRE_MATCH',
                roundingTolerance: '0.0001',
            },
            parsed: { plu: '12345', value: '61.00', valueKind: 'TOTAL_PRICE', sourceUnit: 'NIO' },
            encodedPrice: '61.00',
            baseQuantity: '1.25',
        }));
        await expect(normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{
                id: 'product-a', quantity: '999',
                measurement: {
                    source: 'SCALE_LABEL', clientEventId: 'event-label-0003',
                    rawCode: '2012345012509', profileVersionId: 'version-a',
                },
            }],
        })).rejects.toMatchObject({ code: 'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT' });
    });

    it('conserva el codigo estable cuando el servicio rechaza TOTAL_PRICE antes de retornar', async () => {
        resolveScaleLabelMock.mockRejectedValue(new ScaleLabelServiceError(
            'TOTAL_PRICE_REQUIRES_WEIGHT',
            422,
            'La etiqueta solo codifica total',
        ));
        await expect(normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{
                id: 'product-a', quantity: '1',
                measurement: {
                    source: 'SCALE_LABEL', clientEventId: 'event-total-early',
                    rawCode: '2012345060008', profileVersionId: 'version-a',
                },
            }],
        })).rejects.toMatchObject({ code: 'SCALE_TOTAL_PRICE_REQUIRES_WEIGHT' });
    });

    it('rechaza eventos de medicion duplicados dentro de la misma venta', async () => {
        await expect(normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [1, 2].map(() => ({
                id: 'product-a', quantity: '1',
                measurement: {
                    source: 'MANUAL' as const,
                    clientEventId: 'same-event-0001',
                },
            })),
        })).rejects.toMatchObject({ code: 'DUPLICATE_MEASUREMENT_EVENT' });
    });

    it('marca una version revocada offline para conciliacion sin reinterpretarla', async () => {
        resolveScaleLabelMock.mockResolvedValue(labelResolution({
            profileVersion: {
                id: 'version-a', profileId: 'profile-a', version: 3,
                status: 'REVOKED', pricePolicy: 'RECALCULATE', roundingTolerance: '0.01',
            },
        }));
        await expect(normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: true,
            items: [{
                id: 'product-a', quantity: '1.25',
                measurement: {
                    source: 'SCALE_LABEL', clientEventId: 'event-revoked-001',
                    rawCode: '2012345012509', profileVersionId: 'version-a',
                },
            }],
        })).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
        expect(resolveScaleLabelMock).toHaveBeenCalledWith(expect.objectContaining({
            profileVersionId: 'version-a',
            allowRevokedForReplay: true,
        }));
    });

    it('preserva conciliacion cuando el parser rechaza primero una version revocada', async () => {
        resolveScaleLabelMock.mockRejectedValue(new ScaleLabelServiceError(
            'REVOKED_RECONCILIATION_REQUIRED',
            409,
            'La etiqueta usa una versión revocada y requiere conciliación antes de facturar.',
        ));
        await expect(normalizeSaleItems(fakeDb(), {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: true,
            items: [{
                id: 'product-a',
                quantity: '1.25',
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-revoked-early-001',
                    rawCode: '2012345012509',
                    profileVersionId: 'version-a',
                },
            }],
        })).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    });

    it('ACCEPT_LABEL_TOTAL exige confirmacion y rol persistido de gerencia', async () => {
        resolveScaleLabelMock.mockResolvedValue(labelResolution({
            profileVersion: {
                id: 'version-a', profileId: 'profile-a', version: 3,
                status: 'PUBLISHED', pricePolicy: 'ACCEPT_LABEL_TOTAL', roundingTolerance: '0.01',
            },
            // Simula el futuro layout peso+total: el peso viene parseado y el
            // total codificado por separado en el mismo raw verificado.
            parsed: { plu: '12345', value: '1.25', valueKind: 'WEIGHT', sourceUnit: 'lb' },
            encodedPrice: '60.00',
            baseQuantity: '1.25',
        }));
        const input = {
            tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            items: [{
                id: 'product-a', quantity: '1.25',
                measurement: {
                    source: 'SCALE_LABEL' as const, clientEventId: 'event-override-01',
                    rawCode: '2012345012509', profileVersionId: 'version-a', managerOverride: true,
                },
            }],
        };
        await expect(normalizeSaleItems(fakeDb(), input)).rejects.toMatchObject({
            code: 'MANAGER_AUTH_REQUIRED',
        });
        const accepted = await normalizeSaleItems(fakeDb([product()], 'OWNER'), input);
        expect(accepted[0].acceptedLabelPriceOverride).toMatchObject({
            labelTotal: '60.00', acceptedUnitPrice: '48.00',
        });
    });
});
