import { describe, expect, it } from 'vitest';
import {
    CreateProductSchema,
    CreatePurchaseSchema,
    InventoryAdjustSchema,
    RegisterSchema,
    positiveQuantity,
} from '../backend/validation/schemas';

const baseProduct = {
    sku: 'RES-KG',
    name: 'Posta de res',
    price: 145,
    cost: 112,
};

describe('esquemas de cantidades físicas', () => {
    it.each(['Infinity', '-Infinity', 'NaN', '1.00001', 0, -1])('rechaza %s', (quantity) => {
        expect(positiveQuantity.safeParse(quantity).success).toBe(false);
    });

    it('conserva la cantidad decimal como texto Decimal-safe', () => {
        const result = positiveQuantity.safeParse(37.5);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe('37.5');
    });

    it('D6: producto legado null conserva fracciones', () => {
        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            saleMode: null,
            quantityStep: null,
            stock: 37.5,
            minStock: 2.25,
            unit: 'lb',
        }).success).toBe(true);
    });

    it('solo COUNTED explícito exige enteros', () => {
        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            saleMode: 'COUNTED',
            quantityStep: 1,
            stock: 1.5,
        }).success).toBe(false);
    });

    it('acepta carne medida a 0.001 y compra de 37.50 lb sin truncar', () => {
        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            saleMode: 'MEASURED',
            quantityStep: 0.001,
            stock: 37.5,
            unit: 'lb',
            productFamily: 'MEAT',
        }).success).toBe(true);

        const purchase = CreatePurchaseSchema.safeParse({
            supplierId: 'supplier-1',
            invoiceNumber: 'FAC-37-50',
            date: '2026-08-22',
            paymentMethod: 'CASH',
            items: [{ productId: 'product-meat', quantity: 37.5, unitCost: 80 }],
        });
        expect(purchase.success).toBe(true);
        if (purchase.success) expect(purchase.data.items[0].quantity).toBe('37.5');
    });

    it('acepta deltas fraccionarios con signo, pero no cero', () => {
        expect(InventoryAdjustSchema.safeParse({ productId: 'p', quantity: '-0.125', reason: 'merma' }).success).toBe(true);
        expect(InventoryAdjustSchema.safeParse({ productId: 'p', quantity: 0, reason: 'merma' }).success).toBe(false);
    });

    it('valida empaque completo y su factor contra el step del producto', () => {
        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            saleMode: 'MEASURED',
            quantityStep: 0.25,
            unit: 'lb',
            packUnit: 'saco',
            packSize: 100,
            packPrice: 1500,
        }).success).toBe(true);

        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            saleMode: 'MEASURED',
            quantityStep: 0.25,
            unit: 'kg',
            packUnit: 'bolsa',
            packSize: 0.3,
        }).success).toBe(false);

        expect(CreateProductSchema.safeParse({
            ...baseProduct,
            packUnit: 'caja',
        }).success).toBe(false);
    });

    it('acepta giros y capacidades nuevas en registro', () => {
        expect(RegisterSchema.safeParse({
            companyName: 'Carnes del Norte',
            email: 'dueno@example.com',
            password: 'segura-123',
            type: 'CARNICERIA_POLLERIA',
            capabilities: ['CARNES_AVES', 'PERECEDEROS', 'MAYOREO'],
        }).success).toBe(true);
    });
});
