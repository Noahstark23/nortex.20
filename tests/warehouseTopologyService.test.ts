import { describe, expect, it, vi } from 'vitest';
import { assertWarehouseCanDeactivate, setDefaultWarehouseSafely } from '../backend/services/warehouseTopologyService';

const fixture = () => {
    const warehouses = [{ id: 'old', name: 'Anterior', isActive: true, isDefault: true, sellerId: null }, { id: 'new', name: 'Nueva', isActive: true, isDefault: false, sellerId: null }, { id: 'third', name: 'Tercera', isActive: true, isDefault: false, sellerId: null }];
    return {
        $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'p1', stock: 10 }, { id: 'p2', stock: 5 }]).mockResolvedValueOnce(warehouses),
        stockCount: { findFirst: vi.fn().mockResolvedValue(null) },
        productStock: { findMany: vi.fn().mockResolvedValue([{ productId: 'p1', warehouseId: 'third', stock: 3 }, { productId: 'p2', warehouseId: 'old', stock: 5 }]), createMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
        warehouse: { updateMany: vi.fn(), update: vi.fn().mockResolvedValue({ ...warehouses[1], isDefault: true }) },
        auditLog: { create: vi.fn() },
    };
};

describe('topología conserva atribución física', () => {
    it('materializa residual en anterior y cero en nueva sin modificar agregado ni filas explícitas', async () => {
        const tx = fixture();
        await setDefaultWarehouseSafely(tx as any, { tenantId: 'tenant-a', userId: 'owner-a', warehouseId: 'new' });
        expect(tx.productStock.createMany).toHaveBeenCalledWith({ data: [
            { tenantId: 'tenant-a', productId: 'p1', warehouseId: 'old', stock: 7 },
            { tenantId: 'tenant-a', productId: 'p1', warehouseId: 'new', stock: 0 },
            { tenantId: 'tenant-a', productId: 'p2', warehouseId: 'new', stock: 0 },
        ] });
        expect(JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details)).toMatchObject({ before: { warehouseId: 'old' }, after: { warehouseId: 'new' } });
    });
    it('no cambia principal con una toma abierta', async () => {
        const tx = fixture(); tx.stockCount.findFirst.mockResolvedValue({ id: 'count-open' });
        await expect(setDefaultWarehouseSafely(tx as any, { tenantId: 'tenant-a', userId: 'owner-a', warehouseId: 'new' })).rejects.toMatchObject({ statusCode: 409 });
        expect(tx.productStock.createMany).not.toHaveBeenCalled(); expect(tx.warehouse.update).not.toHaveBeenCalled();
    });
    it('rechaza otra ubicación/tenant y carga de vendedor', async () => {
        await expect(setDefaultWarehouseSafely(fixture() as any, { tenantId: 'tenant-a', userId: 'owner-a', warehouseId: 'foreign' })).rejects.toMatchObject({ statusCode: 404 });
    });
    it('bloquea desactivación con cualquier saldo o con conteo abierto', async () => {
        const tx = fixture(); tx.productStock.findFirst.mockResolvedValue({ id: 'negative-stock' });
        await expect(assertWarehouseCanDeactivate(tx as any, { tenantId: 'tenant-a', warehouseId: 'new', isDefault: false })).rejects.toMatchObject({ code: 'WAREHOUSE_HAS_STOCK' });
        expect(tx.productStock.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stock: { not: 0 } }) }));
        tx.stockCount.findFirst.mockResolvedValue({ id: 'count-open' });
        await expect(assertWarehouseCanDeactivate(tx as any, { tenantId: 'tenant-a', warehouseId: 'new', isDefault: false })).rejects.toMatchObject({ code: 'WAREHOUSE_COUNT_OPEN' });
    });
});
