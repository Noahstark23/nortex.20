import { describe, expect, it, vi } from 'vitest';
import {
    publicOrderItemsForQuotation,
    resolvePublicOrderItems,
} from '../backend/services/publicOrderItemService';
import { serializeQuotationItemsForClient } from '../backend/lib/quotationItems';
import { normalizeSaleItems } from '../backend/services/saleItemMeasurementService';
import { authoritativeQuotationId } from '../backend/services/salesService';

describe('PublicOrder → Quotation → POS → motor de venta', () => {
    it('preserva PACK C$10/3, snapshots y autoridad aunque Product cambie', async () => {
        const publicProduct = {
            id: 'product-a',
            tenantId: 'tenant-a',
            isPublished: true,
            name: 'Pack de tres',
            unit: 'unidad',
            price: 5,
            cost: 2,
            ivaExento: true,
            saleMode: 'COUNTED',
            quantityStep: { toString: () => '1' },
            wholesalePrice: null,
            wholesaleMinQty: null,
            packUnit: 'paquete',
            packSize: 3,
            packPrice: 10,
            requiresBatchTracking: false,
        };
        const [ordered] = resolvePublicOrderItems(
            'tenant-a',
            [{ productId: 'product-a', quantity: '1', presentation: 'PACK' }],
            [publicProduct],
        );
        const [quoted] = publicOrderItemsForQuotation([{
            productId: ordered.productId,
            name: ordered.productName,
            quantity: ordered.quantityExact.toString(),
            quantityExact: ordered.quantityExact.toFixed(4),
            price: ordered.unitPrice.toFixed(2),
            unitPriceExact: ordered.unitPrice.toFixed(4),
            unit: ordered.unit,
            saleMode: ordered.saleMode,
            quantityStep: ordered.quantityStep,
            presentationAtSale: ordered.presentationAtSale,
            presentationQuantityAtSale: ordered.presentationQuantityAtSale.toFixed(4),
            ivaExento: ordered.ivaExento,
        }]);
        const quoteItem = {
            id: 'quote-item-a',
            quotationId: 'quote-a',
            productId: quoted.productId,
            quantity: quoted.quantityLegacy,
            quantityExact: quoted.quantityExact.toFixed(4),
            price: quoted.priceLegacy.toFixed(2),
            unitPriceExact: quoted.unitPriceExact.toFixed(4),
            unitAtQuote: quoted.unit,
            saleModeAtQuote: quoted.saleMode,
            quantityStepAtQuote: quoted.quantityStep.toFixed(4),
            presentationAtQuote: quoted.presentationAtQuote,
            presentationQuantityAtQuote: quoted.presentationQuantityAtQuote.toFixed(4),
            ivaExentoAtQuote: quoted.ivaExento,
            name: quoted.name,
        };
        const [posLine] = serializeQuotationItemsForClient([quoteItem], [{
            id: 'product-a',
            name: 'Nombre actual cambiado',
            price: '999.00',
            unit: 'kg',
            ivaExento: false,
            saleMode: 'MEASURED',
            quantityStep: '0.5',
        }]);

        const db = {
            quotationItem: {
                findMany: vi.fn().mockResolvedValue([{
                    ...quoteItem,
                    quantityStepAtQuote: { toString: () => quoted.quantityStep.toString() },
                    quotation: {
                        status: 'SENT',
                        expiresAt: new Date('2035-01-01T00:00:00.000Z'),
                    },
                }]),
            },
            product: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'product-a',
                    name: 'Nombre actual cambiado',
                    unit: 'kg',
                    price: 999,
                    cost: 50,
                    ivaExento: false,
                    saleMode: 'MEASURED',
                    quantityStep: { toString: () => '0.5' },
                    wholesalePrice: null,
                    wholesaleMinQty: null,
                    packUnit: null,
                    packSize: null,
                    packPrice: null,
                    requiresBatchTracking: false,
                }]),
            },
        } as any;
        const normalized = await normalizeSaleItems(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            wholesaleCustomer: false,
            allowRevokedScaleVersionForReplay: false,
            quotedAt: new Date('2030-01-01T00:00:00.000Z'),
            items: [{
                id: posLine.id,
                quotationItemId: posLine.quotationItemId,
                quantity: posLine.quantityExact,
                price: '0.01',
                discount: '0',
                presentation: posLine.presentation,
            }],
        });

        expect(authoritativeQuotationId(normalized, '0')).toBe('quote-a');
        expect(normalized[0]).toMatchObject({
            productId: 'product-a',
            quotationItemId: 'quote-item-a',
            productNameAtSale: 'Pack de tres',
            unitAtSale: 'unidad',
            saleModeAtSale: 'COUNTED',
            quantityStepAtSale: '1',
            presentationAtSale: 'PACK',
            ivaExento: true,
        });
        expect(normalized[0].quantity.toFixed(4)).toBe('3.0000');
        expect(normalized[0].presentationQuantityAtSale.toFixed(4)).toBe('1.0000');
        expect(normalized[0].unitPrice.toFixed(4)).toBe('3.3333');
        expect(normalized[0].unitPrice.mul(normalized[0].quantity).toDecimalPlaces(2).toFixed(2)).toBe('10.00');
    });
});
