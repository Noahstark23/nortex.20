import { describe, expect, it } from 'vitest';
import { StockTransferSchema } from '../backend/validation/schemas';
import { validateStockTransferQuantity } from '../utils/stockTransferQuantity';

describe('transferencias medidas entre bodegas', () => {
    it('conserva el decimal textual en la frontera HTTP', () => {
        const parsed = StockTransferSchema.parse({
            clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            fromWarehouseId: 'origen',
            toWarehouseId: 'destino',
            items: [{ productId: 'pollo', quantity: '37.5000' }],
        });

        expect(parsed.items[0].quantity).toBe('37.5000');
    });

    it('aplica el paso autoritativo del producto medido', () => {
        expect(validateStockTransferQuantity('1.25', {
            saleMode: 'MEASURED',
            quantityStep: '0.05',
        }).toString()).toBe('1.25');

        expect(() => validateStockTransferQuantity('1.23', {
            saleMode: 'MEASURED',
            quantityStep: '0.05',
        })).toThrow(/múltiplo exacto/);
    });

    it('rechaza fracciones para COUNTED y conserva legado fraccionario', () => {
        expect(() => validateStockTransferQuantity('1.5', {
            saleMode: 'COUNTED',
            quantityStep: '1',
        })).toThrow(/contables/);

        expect(validateStockTransferQuantity('0.0001', {
            saleMode: null,
            quantityStep: null,
        }).toString()).toBe('0.0001');
    });

    it('rechaza precisión y valores no finitos antes de la transacción', () => {
        const base = {
            clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            fromWarehouseId: 'origen',
            toWarehouseId: 'destino',
        };
        expect(StockTransferSchema.safeParse({
            ...base,
            items: [{ productId: 'pollo', quantity: '1.00001' }],
        }).success).toBe(false);
        expect(StockTransferSchema.safeParse({
            ...base,
            items: [{ productId: 'pollo', quantity: 'Infinity' }],
        }).success).toBe(false);
        expect(StockTransferSchema.safeParse({
            ...base,
            items: [{ productId: 'pollo', quantity: 1.25 }],
        }).success).toBe(false);
    });
});
