import { describe, expect, it } from 'vitest';
import { PurchaseItemSchema } from '../backend/validation/schemas';
import {
    purchaseQuantityInputStep,
    resolvePurchaseLine,
} from '../utils/purchasePackaging';
import { QuantityValidationError } from '../utils/quantity';

const sackProduct = {
    unit: 'lb',
    saleMode: 'COUNTED',
    quantityStep: '1',
    packUnit: 'saco',
    packSize: '100',
};

describe('compra por empaque — conversión autoritativa', () => {
    it('convierte 2 sacos × 100 lb a 200 unidades base y costo por lb', () => {
        const line = resolvePurchaseLine({
            quantity: '2',
            unitCost: '1250',
            purchaseUnit: 'PACK',
        }, sackProduct);

        expect(line.visibleQuantity.toString()).toBe('2');
        expect(line.authoritativeFactor.toString()).toBe('100');
        expect(line.baseQuantity.toString()).toBe('200');
        expect(line.baseUnitCost.toString()).toBe('12.5');
        expect(line.lineTotal.toFixed(2)).toBe('2500.00');
    });

    it('ignora un packSize manipulado por el cliente y usa el del producto', () => {
        const parsed = PurchaseItemSchema.parse({
            productId: 'concentrado-cerdo',
            quantity: 2,
            unitCost: 1250,
            purchaseUnit: 'PACK',
            // No pertenece al contrato y Zod lo elimina.
            packSize: 1,
        });

        expect('packSize' in parsed).toBe(false);
        const line = resolvePurchaseLine({
            quantity: parsed.quantity!,
            unitCost: parsed.unitCost!,
            purchaseUnit: parsed.purchaseUnit,
        }, sackProduct);
        expect(line.baseQuantity.toString()).toBe('200');
        expect(line.baseUnitCost.toString()).toBe('12.5');
    });

    it('mantiene clientes legacy en BASE sin reinterpretar cantidad ni costo', () => {
        const parsed = PurchaseItemSchema.parse({
            productId: 'pollo-libra',
            quantity: '37.50',
            unitCost: '18.40',
        });
        const line = resolvePurchaseLine({
            quantity: parsed.quantity!,
            unitCost: parsed.unitCost!,
            purchaseUnit: parsed.purchaseUnit,
        }, {
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            packUnit: 'saco',
            packSize: 100,
        });

        expect(parsed.purchaseUnit).toBe('BASE');
        expect(line.baseQuantity.toString()).toBe('37.5');
        expect(line.baseUnitCost.toString()).toBe('18.4');
        expect(line.lineTotal.toFixed(2)).toBe('690.00');
    });

    it('valida el step del producto después de convertir un empaque decimal', () => {
        const valid = resolvePurchaseLine({
            quantity: '1.25',
            unitCost: '1000',
            purchaseUnit: 'PACK',
        }, {
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            packUnit: 'saco',
            packSize: '100',
        });
        expect(valid.baseQuantity.toString()).toBe('125');

        expect(() => resolvePurchaseLine({
            quantity: '2',
            unitCost: '10',
            purchaseUnit: 'PACK',
        }, {
            unit: 'kg',
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            packUnit: 'bolsa',
            packSize: '0.3',
        })).toThrowError(expect.objectContaining<Partial<QuantityValidationError>>({
            code: 'STEP_MISMATCH',
        }));
    });

    it('rechaza PACK si el producto no tiene nombre y factor autoritativos', () => {
        expect(() => resolvePurchaseLine({
            quantity: 2,
            unitCost: 100,
            purchaseUnit: 'PACK',
        }, {
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            packUnit: null,
            packSize: 100,
        })).toThrow('no tiene un empaque completo configurado');
    });

    it('calcula un paso visible representable sin relajar la validación final', () => {
        expect(purchaseQuantityInputStep({
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            packSize: 100,
        }, 'PACK')).toBe('0.0025');
        expect(purchaseQuantityInputStep({
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
            packSize: 100,
        }, 'PACK')).toBe('1');
    });

    it('conserva el total del empaque cuando el costo base es periódico', () => {
        const line = resolvePurchaseLine({
            quantity: 2,
            unitCost: 100,
            purchaseUnit: 'PACK',
        }, {
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: 1,
            packUnit: 'caja',
            packSize: 12,
        });

        expect(line.baseQuantity.toString()).toBe('24');
        expect(line.baseUnitCost.toDecimalPlaces(4).toString()).toBe('8.3333');
        expect(line.lineTotal.toFixed(2)).toBe('200.00');
    });
});
