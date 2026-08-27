import { describe, expect, it, vi } from 'vitest';
import { generateRetentions, PeriodLockedError } from '../backend/services/accounting';

function retentionDb(purchases: any[], persistedRows: any[] = []) {
    let persisted = [...persistedRows];
    const queryRaw = vi.fn(async (_query: TemplateStringsArray, tenantId: string) => (
        tenantId === 'tenant-1' ? [{ id: tenantId }] : []
    ));
    const findMany = vi.fn(async ({ where }: any) => purchases.filter((purchase) => (
        purchase.tenantId === where.tenantId
        && purchase.date >= where.date.gte
        && purchase.date < where.date.lt
        && where.status.in.includes(purchase.status)
    )));
    const deleteMany = vi.fn(async ({ where }: any) => {
        const before = persisted.length;
        persisted = persisted.filter((row) => (
            row.tenantId !== where.tenantId || row.period !== where.period
        ));
        return { count: before - persisted.length };
    });
    const createMany = vi.fn(async ({ data }: any) => {
        persisted.push(...data);
        return { count: data.length };
    });
    const db = {
        $queryRaw: queryRaw,
        fiscalRetention: { deleteMany, createMany },
        fiscalPeriod: { findUnique: vi.fn(async () => null) },
        purchase: { findMany },
    };
    return {
        db,
        queryRaw,
        findMany,
        deleteMany,
        createMany,
        persisted: () => persisted,
    };
}

describe('generateRetentions — periodo fiscal de Managua', () => {
    it('incluye el cierre civil de julio y excluye exactamente el inicio de agosto', async () => {
        const purchases = [
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
                status: 'COMPLETED',
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
                status: 'COMPLETED',
            },
        ];
        const harness = retentionDb(purchases);

        const result = await generateRetentions('tenant-1', 7, 2026, harness.db as any);

        const query = harness.findMany.mock.calls[0][0];
        expect(query.where.date.gte.toISOString()).toBe('2026-07-01T06:00:00.000Z');
        expect(query.where.date.lt.toISOString()).toBe('2026-08-01T06:00:00.000Z');
        expect(query.where.date).not.toHaveProperty('lte');
        expect(query.where.status).toEqual({ in: ['COMPLETED', 'PENDING_PAYMENT'] });
        expect(result.purchasesProcessed).toBe(1);
        expect(result.retentions.ir2pct.total).toBe(2);
        expect(result.retentions.imi1pct.total).toBe(1);
        expect(result.retentions.ivaRetenido.total).toBe(15);

        const rows = harness.createMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(3);
        expect(rows.every((row: any) => row.purchaseId === 'compra-julio-managua')).toBe(true);
    });

    it('incluye solo compras COMPLETED y PENDING_PAYMENT del periodo fiscal', async () => {
        const purchase = (id: string, status: string) => ({
            id,
            tenantId: 'tenant-1',
            supplierId: `supplier-${id}`,
            supplier: { id: `supplier-${id}`, name: `Proveedor ${id}` },
            date: new Date('2026-07-15T18:00:00.000Z'),
            subtotal: 100,
            tax: 15,
            total: 115,
            status,
        });
        const harness = retentionDb([
            purchase('completada', 'COMPLETED'),
            purchase('credito-pendiente', 'PENDING_PAYMENT'),
            purchase('anulada', 'CANCELLED'),
            purchase('borrador', 'DRAFT'),
        ]);

        const result = await generateRetentions('tenant-1', 7, 2026, harness.db as any);

        expect(result.purchasesProcessed).toBe(2);
        expect(result.retentions.ir2pct).toEqual({ count: 2, total: 4 });
        expect(result.retentions.imi1pct).toEqual({ count: 2, total: 2 });
        expect(result.retentions.ivaRetenido).toEqual({ count: 2, total: 30 });
        const purchaseIds = new Set(
            harness.createMany.mock.calls[0][0].data.map((row: any) => row.purchaseId),
        );
        expect(purchaseIds).toEqual(new Set(['completada', 'credito-pendiente']));
    });

    it('reemplaza un estado parcial y una segunda ejecución no deja duplicados', async () => {
        const purchases = [{
            id: 'compra-completa',
            tenantId: 'tenant-1',
            supplierId: 'supplier-1',
            supplier: { id: 'supplier-1', name: 'Proveedor completo' },
            date: new Date('2026-07-15T18:00:00.000Z'),
            subtotal: 100,
            tax: 15,
            total: 115,
            status: 'COMPLETED',
        }];
        const harness = retentionDb(purchases, [{
            tenantId: 'tenant-1',
            period: '2026-07',
            purchaseId: 'compra-completa',
            type: 'IR_2PCT',
            amount: 2,
        }]);

        const first = await generateRetentions('tenant-1', 7, 2026, harness.db as any);

        expect(first.replacedRetentions).toBe(1);
        expect(harness.persisted()).toHaveLength(3);
        expect(harness.persisted().map((row) => row.type).sort()).toEqual([
            'IMI_1PCT',
            'IR_2PCT',
            'IVA_RETENIDO',
        ]);

        const second = await generateRetentions('tenant-1', 7, 2026, harness.db as any);

        expect(second.replacedRetentions).toBe(3);
        expect(harness.persisted()).toHaveLength(3);
        expect(new Set(harness.persisted().map((row) => `${row.purchaseId}:${row.type}`)).size).toBe(3);
        expect(harness.deleteMany).toHaveBeenCalledTimes(2);
        expect(harness.createMany).toHaveBeenCalledTimes(2);

        const [queryParts, boundTenantId] = harness.queryRaw.mock.calls[0];
        expect(queryParts.join('?')).toContain('WHERE id = ?');
        expect(queryParts.join('?')).toContain('FOR UPDATE');
        expect(boundTenantId).toBe('tenant-1');
    });

    it('bloquea la regeneración de un período cerrado antes de leer o reemplazar filas', async () => {
        const findMany = vi.fn();
        const deleteMany = vi.fn();
        const createMany = vi.fn();
        const db = {
            $queryRaw: vi.fn(async () => [{ id: 'tenant-1' }]),
            fiscalPeriod: {
                findUnique: vi.fn(async ({ where }: any) => ({
                    tenantId: where.tenantId_year_month.tenantId,
                    year: where.tenantId_year_month.year,
                    month: where.tenantId_year_month.month,
                    status: 'CLOSED',
                })),
            },
            purchase: { findMany },
            fiscalRetention: { deleteMany, createMany },
        };

        await expect(generateRetentions('tenant-1', 7, 2026, db as any))
            .rejects.toBeInstanceOf(PeriodLockedError);

        expect(db.fiscalPeriod.findUnique).toHaveBeenCalledWith({
            where: { tenantId_year_month: { tenantId: 'tenant-1', year: 2026, month: 7 } },
        });
        expect(findMany).not.toHaveBeenCalled();
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });
});
