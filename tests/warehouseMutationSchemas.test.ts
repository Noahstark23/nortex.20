import { describe, expect, it } from 'vitest';
import {
    CreateStockCountSchema,
    InventoryAdjustSchema,
} from '../backend/validation/schemas';

describe('contratos multi-bodega de inventario', () => {
    it('InventoryAdjustSchema preserva el warehouseId elegido', () => {
        const parsed = InventoryAdjustSchema.safeParse({
            productId: 'product-1',
            warehouseId: 'warehouse-2',
            quantity: -2,
            type: 'ADJUST_LOSS',
            reason: 'Merma de prueba',
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.warehouseId).toBe('warehouse-2');
        }
    });

    it('CreateStockCountSchema preserva el warehouseId elegido', () => {
        const parsed = CreateStockCountSchema.safeParse({
            scope: 'CATEGORY',
            warehouseId: 'warehouse-2',
            category: 'Bebidas',
            notes: 'Conteo de cierre',
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.warehouseId).toBe('warehouse-2');
        }
    });

    it.each([
        ['InventoryAdjustSchema', InventoryAdjustSchema, {
            productId: 'product-1', warehouseId: '   ', quantity: 1, reason: 'Alta manual',
        }],
        ['CreateStockCountSchema', CreateStockCountSchema, {
            scope: 'ALL', warehouseId: '   ',
        }],
    ])('%s rechaza una ubicación vacía en lugar de convertirla en fallback', (_name, schema, input) => {
        expect(schema.safeParse(input).success).toBe(false);
    });

    it('mantiene compatibilidad de contrato para tenants con una sola bodega', () => {
        expect(InventoryAdjustSchema.safeParse({
            productId: 'product-1', quantity: 1, reason: 'Alta manual',
        }).success).toBe(true);
        expect(CreateStockCountSchema.safeParse({ scope: 'ALL' }).success).toBe(true);
    });
});
