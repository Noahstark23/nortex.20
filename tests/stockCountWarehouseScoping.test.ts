import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const server = read('backend/server.ts');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260822_stock_counts_by_warehouse/migration.sql');
const component = read('components/StockCount.tsx');

const between = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque ${start}`);
    return source.slice(from, to);
};

const createRoute = between(server, "app.post('/api/stock-counts'", "app.get('/api/stock-counts'");
const countRoute = between(server, "app.patch('/api/stock-counts/:id/count'", "app.post('/api/stock-counts/:id/close'");
const closeRoute = between(server, "app.post('/api/stock-counts/:id/close'", "app.post('/api/stock-counts/:id/cancel'");
const cancelRoute = between(server, "app.post('/api/stock-counts/:id/cancel'", "app.post('/api/kardex/record'");

describe('conteos físicos por bodega', () => {
    it('mantiene historial nullable, pero agrega guard único para conteos OPEN nuevos', () => {
        const model = between(schema, 'model StockCount {', 'model StockCountItem {');
        expect(model).toMatch(/warehouseId\s+String\?/);
        expect(model).toMatch(/openWarehouseKey\s+String\?\s+@unique/);
        expect(model).toMatch(/warehouse\s+Warehouse\?\s+@relation/);
        expect(model).toContain('onDelete: Restrict');
        expect(model).toContain('@@index([tenantId, warehouseId, status])');
    });

    it('solo atribuye historial finalizado cuando el tenant tenía una única bodega', () => {
        expect(migration).toContain('HAVING COUNT(*) = 1');
        expect(migration).toContain("WHERE `sc`.`status` IN ('CLOSED', 'CANCELLED')");
        expect(migration).not.toMatch(/ALTER COLUMN `warehouseId`[^;]*NOT NULL/i);
        expect(migration).toContain('ON DELETE RESTRICT');
    });

    it('crea el snapshot desde ProductStock y persiste la ubicación explícita', () => {
        expect(createRoute).toContain('resolveOperationalWarehouse');
        expect(createRoute).toContain('tx.productStock.findMany');
        expect(createRoute).toContain('warehouse.isDefault');
        expect(createRoute).toContain('warehouseId: warehouse.id');
        expect(createRoute).toContain('openWarehouseKey: warehouse.id');
        expect(createRoute).toContain("isolationLevel: 'RepeatableRead'");
        expect(createRoute).toContain("error?.code === 'P2002'");
    });

    it('serializa captura y cierre sobre la misma fila StockCount', () => {
        expect(countRoute).toMatch(/FROM \\`StockCount\\`[\s\S]*FOR UPDATE/);
        expect(closeRoute).toMatch(/status: 'OPEN'[\s\S]*status: 'CLOSING'/);
        expect(closeRoute).toContain("error?.code === 'P2034'");
    });

    it('cierra contra la fila de la bodega y registra Kardex con warehouseId', () => {
        const productLock = closeRoute.indexOf('FROM \\`Product\\`');
        const warehouseLock = closeRoute.indexOf('FROM \\`ProductStock\\`');
        expect(productLock).toBeGreaterThan(-1);
        expect(warehouseLock).toBeGreaterThan(productLock);
        expect(closeRoute).toContain('warehouseId: count.warehouseId');
        expect(closeRoute).toContain('stockBefore: currentBook.toNumber()');
        expect(closeRoute).toContain('stockAfter: counted.toNumber()');
        expect(closeRoute).toContain('openWarehouseKey: null');
    });

    it('libera el guard al cancelar', () => {
        expect(cancelRoute).toContain("status: 'CANCELLED'");
        expect(cancelRoute).toContain('openWarehouseKey: null');
    });

    it('obliga a elegir bodega en la UI y explica el caso histórico', () => {
        expect(component).toContain('warehouseId: createWarehouseId');
        expect(component).toContain('creating || !createFormValid');
        expect(component).toContain('Bodega a contar');
        expect(component).toContain('Ubicación histórica/no especificada');
        expect(component).toContain('Esa bodega ya tiene una toma abierta');
        expect(component).toContain("CLOSING: { label: 'Cerrando'");
    });
});
