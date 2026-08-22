import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adjustmentTypesForRole, localStockForProduct, soleActiveWarehouseId } from '../components/Inventory';

const source = readFileSync(resolve(process.cwd(), 'components/Inventory.tsx'), 'utf8');

describe('ajuste de inventario por bodega', () => {
    it('preselecciona únicamente cuando existe una sola bodega activa', () => {
        expect(soleActiveWarehouseId([
            { id: 'principal', name: 'Principal', isActive: true, isDefault: true },
        ])).toBe('principal');

        expect(soleActiveWarehouseId([
            { id: 'principal', name: 'Principal', isActive: true, isDefault: true },
            { id: 'norte', name: 'Norte', isActive: true, isDefault: false },
        ])).toBe('');

        expect(soleActiveWarehouseId([
            { id: 'principal', name: 'Principal', isActive: false, isDefault: true },
            { id: 'norte', name: 'Norte', isActive: true, isDefault: false },
        ])).toBe('norte');
    });

    it('calcula el stock local y trata una fila ausente como cero', () => {
        const items = [
            { productId: 'martillo', stock: 8 },
            { productId: 'clavos', stock: 120 },
        ];
        expect(localStockForProduct(items, 'martillo')).toBe(8);
        expect(localStockForProduct(items, 'pintura')).toBe(0);
    });

    it('carga el stock de la bodega y envía el destino explícito', () => {
        expect(source).toContain("fetch('/api/warehouses', { headers })");
        expect(source).toContain('fetch(`/api/warehouses/${adjustWarehouseId}/stock`');
        expect(source).toContain('warehouseId: adjustWarehouseId');
        expect(source).toContain('Bodega del ajuste');
        expect(source).toContain('Stock en <strong');
        expect(source).toContain('adjustWarehouseStock - adjustmentQuantity');
        expect(source).toContain('!adjustmentFormReady');
        expect(source).toContain('inputMode="numeric"');
        expect(source).toContain('pattern="[0-9]*"');
        expect(source).toContain('sanitizeWholeNumberInput(e.target.value)');
        expect(source).toContain("title: 'Existencias ajustadas'");
        expect(source).not.toContain('alert(`Ajuste registrado:');
    });

    it('no ofrece compras ni devoluciones dentro del ajuste BODEGUERO', () => {
        expect(adjustmentTypesForRole(true)).toEqual(['ADJUST_LOSS', 'ADJUST_GAIN']);
        expect(adjustmentTypesForRole(false)).toEqual([
            'ADJUST_LOSS', 'ADJUST_GAIN', 'IN_PURCHASE', 'RETURN',
        ]);
        expect(source).toContain('.filter(opt => adjustmentTypesForRole(isBodeguero).includes(opt.value))');
    });
});
