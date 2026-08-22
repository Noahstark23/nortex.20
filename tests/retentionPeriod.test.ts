import { describe, expect, it, vi } from 'vitest';
import { generateRetentions } from '../backend/services/accounting';

describe('generateRetentions — periodo fiscal de Managua', () => {
    it('incluye el cierre civil de julio y excluye exactamente el inicio de agosto', async () => {
        const compras = [
            {
                id: 'compra-julio-managua',
                tenantId: 'tenant-1',
                supplierId: 'supplier-1',
                supplier: { id: 'supplier-1', name: 'Proveedor julio' },
                // 31-jul 19:00 en Managua: todavía pertenece a julio fiscal.
                date: new Date('2026-08-01T01:00:00.000Z'),
                subtotal: 100,
                tax: 15,
                total: 115,
            },
            {
                id: 'compra-agosto-managua',
                tenantId: 'tenant-1',
                supplierId: 'supplier-2',
                supplier: { id: 'supplier-2', name: 'Proveedor agosto' },
                // 01-ago 00:00 en Managua: es el fin exclusivo de julio.
                date: new Date('2026-08-01T06:00:00.000Z'),
                subtotal: 200,
                tax: 30,
                total: 230,
            },
        ];

        const findMany = vi.fn(async ({ where }: any) => compras.filter((compra) => (
            compra.tenantId === where.tenantId
            && compra.date >= where.date.gte
            && compra.date < where.date.lt
        )));
        const createMany = vi.fn(async (_args: any) => ({ count: 3 }));
        const db = {
            fiscalRetention: {
                count: vi.fn(async () => 0),
                createMany,
            },
            purchase: { findMany },
        };

        const result = await generateRetentions('tenant-1', 7, 2026, db as any);

        const query = findMany.mock.calls[0][0];
        expect(query.where.date.gte.toISOString()).toBe('2026-07-01T06:00:00.000Z');
        expect(query.where.date.lt.toISOString()).toBe('2026-08-01T06:00:00.000Z');
        expect(query.where.date).not.toHaveProperty('lte');
        expect(result.purchasesProcessed).toBe(1);
        expect(result.retentions.ir2pct.total).toBe(2);
        expect(result.retentions.imi1pct.total).toBe(1);
        expect(result.retentions.ivaRetenido.total).toBe(15);

        const rows = createMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(3);
        expect(rows.every((row: any) => row.purchaseId === 'compra-julio-managua')).toBe(true);
    });
});
