import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { soleActiveReceiptWarehouseId } from '../components/PurchaseOrders';

const source = readFileSync(resolve(process.cwd(), 'components/PurchaseOrders.tsx'), 'utf8');

describe('recepción de orden de compra por bodega', () => {
    it('preselecciona una sola ubicación y obliga a decidir entre varias', () => {
        expect(soleActiveReceiptWarehouseId([
            { id: 'principal', name: 'Principal', isActive: true, isDefault: true },
        ])).toBe('principal');

        expect(soleActiveReceiptWarehouseId([
            { id: 'principal', name: 'Principal', isActive: true, isDefault: true },
            { id: 'sucursal', name: 'Sucursal', isActive: true, isDefault: false },
        ])).toBe('');
    });

    it('hace visible y obligatorio el destino en el contrato de recepción', () => {
        expect(source).toContain("requestWithTimeout('/api/warehouses'");
        expect(source).toContain('.filter((warehouse: WarehouseOption) => warehouse.isActive)');
        expect(source).toContain('Bodega de destino');
        expect(source).toContain('required');
        expect(source).toContain('JSON.stringify({ warehouseId: receiptWarehouseId, items })');
        expect(source).toContain('receiptWarehousesLoading || !receiptWarehouseId');
        expect(source).toContain('Todo lo recibido en esta operación ingresará a');
    });

    it('mantiene proveedores y creación fuera del flujo BODEGUERO', () => {
        expect(source).toContain('if (!canManagePurchaseOrders) return;');
        expect(source).toContain('{canManagePurchaseOrders && (');
        expect(source).toContain('{canManagePurchaseOrders && showCreate && (');
    });
});
