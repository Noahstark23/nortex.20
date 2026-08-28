import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const routeStart = server.indexOf("app.post('/api/purchases'");
const routeEnd = server.indexOf('// POST /api/purchases/:id/pay', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error('No se encontró POST /api/purchases');
const purchaseRoute = server.slice(routeStart, routeEnd);

describe('orden global de locks de compra directa', () => {
    it('ordena una copia por producto/lote antes de tocar stock', () => {
        const orderStart = purchaseRoute.indexOf('const inventoryMutationItems = linkedPurchaseOrder');
        const stockLoop = purchaseRoute.indexOf('for (const item of inventoryMutationItems)');
        const stockMutation = purchaseRoute.indexOf('await applyStockDelta', stockLoop);

        expect(orderStart).toBeGreaterThan(0);
        expect(purchaseRoute.slice(orderStart, stockLoop)).toContain('[...processedItems].sort');
        expect(purchaseRoute.slice(orderStart, stockLoop)).toContain('left.productId.localeCompare(right.productId)');
        expect(purchaseRoute.slice(orderStart, stockLoop)).toContain("left.batchNumber ?? ''");
        expect(stockLoop).toBeGreaterThan(orderStart);
        expect(stockMutation).toBeGreaterThan(stockLoop);
        expect(purchaseRoute).not.toContain('for (const item of linkedPurchaseOrder ? [] : processedItems)');
    });

    it('mantiene las líneas persistidas en el orden preparado y omite stock para OC', () => {
        const nestedCreate = purchaseRoute.indexOf('create: processedItems.map');
        const orderStart = purchaseRoute.indexOf('const inventoryMutationItems = linkedPurchaseOrder');
        const skipBranch = purchaseRoute.slice(orderStart, purchaseRoute.indexOf(';', orderStart) + 1);

        expect(nestedCreate).toBeGreaterThan(0);
        expect(nestedCreate).toBeLessThan(orderStart);
        expect(skipBranch).toContain('linkedPurchaseOrder');
        expect(skipBranch).toContain('? []');
    });
});
