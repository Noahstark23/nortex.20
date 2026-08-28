import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    openPurchaseOrderQuantityForItem,
    soleActiveReceiptWarehouseId,
} from '../components/PurchaseOrders';

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
        expect(source).toContain('clientEventId: receiptClientEventId');
        expect(source).toContain('warehouseId: receiptWarehouseId');
        expect(source).toContain('supplierDeliveryRef: supplierDeliveryRef.trim() || undefined');
        expect(source).toContain('items,');
        expect(source).toContain('receiptWarehousesLoading || !receiptWarehouseId');
        expect(source).toContain('Todo lo aceptado en esta operación ingresará a');
        expect(source).toContain('receiptItem.quantityRejected = rejected.toString()');
        expect(source).toContain('rejectionReasonCode = draft.rejectionReasonCode');
        expect(source).toContain("draft.supplierFault === 'true'");
    });

    it('mantiene rechazado como métrica reentregable y descuenta solo aceptado/cierre', () => {
        const item = {
            id: 'line-1',
            productId: 'product-1',
            productName: 'Carne',
            quantityOrdered: '10',
            quantityReceived: '4',
            quantityOrderedExact: '10.0000',
            quantityReceivedExact: '4.0000',
            quantityRejectedExact: '7.0000',
            quantityClosedShortExact: '1.5000',
            unitCost: '20.00',
        };

        expect(openPurchaseOrderQuantityForItem(item).toString()).toBe('4.5');
    });

    it('guarda UUID estable y cantidades string a 4 decimales para cierre corto', () => {
        expect(source).toContain("requestWithTimeout(`/api/purchase-orders/${closingShort.id}/close-short`");
        expect(source).toContain('clientEventId: closeShortClientEventId');
        expect(source).toContain('quantity: remaining.toFixed(4)');
        expect(source).toContain('canManagePurchaseOrders && closingShort');
        expect(source).toContain("po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED'");
        expect(source).toContain("CLOSED_SHORT: 'CERRADA CON FALTANTE'");
    });

    it('mantiene proveedores y creación fuera del flujo BODEGUERO', () => {
        expect(source).toContain('if (!canManagePurchaseOrders) return;');
        expect(source).toContain('{canManagePurchaseOrders && (');
        expect(source).toContain('{canManagePurchaseOrders && showCreate && (');
    });
});
