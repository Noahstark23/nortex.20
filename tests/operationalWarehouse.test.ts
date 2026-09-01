import { describe, expect, it, vi } from 'vitest';
import {
    resolveDefaultWarehouseId,
    resolveOperationalWarehouse,
} from '../backend/services/stockService';

const warehouse = (overrides: Partial<{ id: string; name: string; isDefault: boolean }> = {}) => ({
    id: 'wh-principal',
    name: 'Principal',
    isDefault: true,
    ...overrides,
});

describe('resolveDefaultWarehouseId', () => {
    it('ignora una default inactiva y promueve la bodega activa más antigua', async () => {
        const findFirst = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'wh-activa' });
        const tx = {
            warehouse: {
                findFirst,
                update: vi.fn().mockResolvedValue({ id: 'wh-activa' }),
            },
        } as any;

        await expect(resolveDefaultWarehouseId(tx, 'tenant-1')).resolves.toBe('wh-activa');
        expect(findFirst).toHaveBeenNthCalledWith(1, {
            where: { tenantId: 'tenant-1', isDefault: true, isActive: true },
            select: { id: true },
        });
        expect(findFirst).toHaveBeenNthCalledWith(2, {
            where: { tenantId: 'tenant-1', isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        expect(tx.warehouse.update).toHaveBeenCalledWith({
            where: { id: 'wh-activa' },
            data: { isDefault: true },
        });
    });

    it('falla cerrado cuando solo quedan bodegas inactivas', async () => {
        const tx = {
            warehouse: {
                findFirst: vi.fn()
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({ id: 'wh-inactiva' }),
                update: vi.fn(),
                create: vi.fn(),
            },
        } as any;

        await expect(resolveDefaultWarehouseId(tx, 'tenant-1')).rejects.toMatchObject({
            code: 'WAREHOUSE_NOT_FOUND',
        });
        expect(tx.warehouse.update).not.toHaveBeenCalled();
        expect(tx.warehouse.create).not.toHaveBeenCalled();
    });
});

describe('resolveOperationalWarehouse', () => {
    it('conserva una bodega explícita, activa y perteneciente al tenant', async () => {
        const selected = warehouse({ id: 'wh-sucursal', name: 'Sucursal', isDefault: false });
        const tx = {
            warehouse: {
                findFirst: vi.fn().mockResolvedValue(selected),
                findMany: vi.fn(),
            },
        } as any;

        await expect(resolveOperationalWarehouse(tx, 'tenant-1', 'wh-sucursal')).resolves.toEqual(selected);
        expect(tx.warehouse.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wh-sucursal', tenantId: 'tenant-1', isActive: true },
        }));
        expect(tx.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('rechaza una bodega explícita ajena o inactiva', async () => {
        const tx = {
            warehouse: {
                findFirst: vi.fn().mockResolvedValue(null),
                findMany: vi.fn(),
            },
        } as any;

        await expect(resolveOperationalWarehouse(tx, 'tenant-1', 'wh-ajena')).rejects.toMatchObject({
            code: 'WAREHOUSE_NOT_FOUND',
        });
        expect(tx.warehouse.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wh-ajena', tenantId: 'tenant-1', isActive: true },
        }));
    });

    it('mantiene compatibilidad si solo existe una bodega activa', async () => {
        const principal = warehouse();
        const tx = {
            warehouse: {
                findMany: vi.fn().mockResolvedValue([principal]),
                findFirst: vi.fn(),
            },
        } as any;

        await expect(resolveOperationalWarehouse(tx, 'tenant-1')).resolves.toEqual(principal);
        expect(tx.warehouse.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-1', isActive: true },
            take: 2,
        }));
    });

    it('exige warehouseId cuando hay más de una bodega activa', async () => {
        const tx = {
            warehouse: {
                findMany: vi.fn().mockResolvedValue([
                    warehouse(),
                    warehouse({ id: 'wh-sucursal', name: 'Sucursal', isDefault: false }),
                ]),
                findFirst: vi.fn(),
            },
        } as any;

        await expect(resolveOperationalWarehouse(tx, 'tenant-1')).rejects.toMatchObject({
            code: 'WAREHOUSE_REQUIRED',
        });
    });

    it('falla cerrado si el tenant no tiene ninguna bodega activa', async () => {
        const tx = {
            warehouse: {
                findMany: vi.fn().mockResolvedValue([]),
                findFirst: vi.fn(),
                findFirstOrThrow: vi.fn(),
            },
        } as any;

        await expect(resolveOperationalWarehouse(tx, 'tenant-1')).rejects.toMatchObject({
            code: 'WAREHOUSE_NOT_FOUND',
            message: expect.stringContaining('No hay una bodega activa'),
        });
        expect(tx.warehouse.findFirst).not.toHaveBeenCalled();
        expect(tx.warehouse.findFirstOrThrow).not.toHaveBeenCalled();
    });
});
