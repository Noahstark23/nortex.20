import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const server = read('backend/server.ts');
const purchaseOrders = read('backend/routes/purchaseOrders.ts');

function between(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque ${start}`);
    return source.slice(from, to);
}

const inventoryAdjustRoute = between(
    server,
    "app.post('/api/inventory/adjust'",
    "app.get('/api/inventory/batches/:productId'",
);
const createStockCountRoute = between(
    server,
    "app.post('/api/stock-counts'",
    "app.get('/api/stock-counts'",
);
const closeStockCountRoute = between(
    server,
    "app.post('/api/stock-counts/:id/close'",
    "app.post('/api/stock-counts/:id/cancel'",
);
const applyGoodsReceipt = between(
    purchaseOrders,
    'async function applyGoodsReceipt(',
    '// ── GET /',
);
const receivePurchaseOrderRoute = between(
    purchaseOrders,
    "router.post('/:id/receive'",
    '\nexport default router;',
);

describe('aislamiento de mutaciones por bodega', () => {
    it('el ajuste resuelve la ubicación y usa esa fila en stock, Kardex y auditoría', () => {
        expect(inventoryAdjustRoute).toContain('resolveOperationalWarehouse(');
        expect(inventoryAdjustRoute).toContain('warehouseId: operationWarehouse.id');
        expect(inventoryAdjustRoute).toMatch(/FROM \\`ProductStock\\`[\s\S]*warehouseId = \$\{operationWarehouse\.id\}/);
        expect(inventoryAdjustRoute).toMatch(/applyStockDelta\([\s\S]*warehouseId: operationWarehouse\.id/);
        expect(inventoryAdjustRoute).toMatch(/kardexMovement\.create\([\s\S]*warehouseId,/);
        expect(inventoryAdjustRoute).toMatch(/action: 'INVENTORY_ADJUSTMENT'[\s\S]*warehouseId: operationWarehouse\.id/);
        expect(inventoryAdjustRoute).toContain('BODEGUERO_ADJUSTMENT_TYPE_FORBIDDEN');
    });

    it('el snapshot del conteo se toma de ProductStock y queda ligado a una bodega', () => {
        expect(createStockCountRoute).toContain('resolveOperationalWarehouse(');
        expect(createStockCountRoute).toContain("warehouseId: null, status: 'OPEN'");
        expect(createStockCountRoute).toContain("'LEGACY_STOCK_COUNT_WITHOUT_WAREHOUSE'");
        expect(createStockCountRoute).toContain('tx.productStock.findMany');
        expect(createStockCountRoute).toContain('row.warehouseId === warehouse.id');
        expect(createStockCountRoute).toContain('warehouseId: warehouse.id');
        expect(createStockCountRoute).toContain('openWarehouseKey: warehouse.id');
    });

    it('el cierre compara, muta y audita únicamente la fila de la bodega del conteo', () => {
        expect(closeStockCountRoute).toMatch(/FROM \\`ProductStock\\`[\s\S]*warehouseId = \$\{count\.warehouseId\}/);
        expect(closeStockCountRoute).toMatch(/applyStockDelta\([\s\S]*warehouseId: count\.warehouseId/);
        expect(closeStockCountRoute).toMatch(/referenceType: 'STOCK_COUNT'[\s\S]*warehouseId: count\.warehouseId/);
        expect(closeStockCountRoute).toMatch(/action: 'STOCK_COUNT_CLOSED'[\s\S]*warehouseId: count\.warehouseId/);
    });

    it('la recepción de OC usa el destino resuelto al incrementar inventario', () => {
        expect(receivePurchaseOrderRoute).toContain('resolveOperationalWarehouse(');
        expect(receivePurchaseOrderRoute).toContain('destinationWarehouse.id,');
        expect(applyGoodsReceipt).toMatch(/applyStockDelta\([\s\S]*warehouseId: destinationWarehouseId/);
    });

    it('la recepción persiste el destino y devuelve errores de selección al cliente', () => {
        expect(receivePurchaseOrderRoute).toMatch(/action: 'PO_RECEIVED'[\s\S]*warehouseId: destinationWarehouse\.id/);
        expect(receivePurchaseOrderRoute).toContain("e.code === 'WAREHOUSE_REQUIRED'");
        expect(receivePurchaseOrderRoute).toContain("e.code === 'WAREHOUSE_NOT_FOUND'");
        expect(receivePurchaseOrderRoute).toContain('code: e.code');
    });
});
