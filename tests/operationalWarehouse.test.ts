import { describe, expect, it, vi } from 'vitest';
import { resolveOperationalWarehouse } from '../backend/services/stockService';

const warehouse = (overrides: Partial<{ id: string; name: string; isDefault: boolean }> = {}) => ({
    id: 'wh-principal',
    name: 'Principal',
    isDefault: true,
    ...overrides,
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
