import { describe, expect, it, vi } from 'vitest';
vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));
import {
    createOperationalAlertsService, operationalExpiryWindow,
    type OperationalAlertsDatabase,
} from '../backend/services/operationalAlertsService';

const AS_OF = new Date('2026-09-04T18:00:00Z');
const MIN_STOCK = { modelName: 'Product', name: 'minStock' };
const products = [
    { id: 'negative', tenantId: 'a', name: 'A', stock: -1, minStock: 0 },
    { id: 'zero', tenantId: 'a', name: 'B', stock: 0, minStock: 5 },
    { id: 'fraction', tenantId: 'a', name: 'C', stock: 0.25, minStock: 0.5 },
    { id: 'equal', tenantId: 'a', name: 'D', stock: 3, minStock: 3 },
    { id: 'healthy', tenantId: 'a', name: 'E', stock: 4, minStock: 3 },
    { id: 'no-minimum', tenantId: 'a', name: 'F', stock: 1, minStock: 0 },
    { id: 'other', tenantId: 'b', name: 'G', stock: 0, minStock: 9 },
];
const batches = [
    ['expired', 'a', '2026-09-03T12:00:00Z', 1],
    ['today-legacy', 'a', '2026-09-04T00:00:00Z', 1],
    ['today', 'a', '2026-09-04T12:00:00Z', 1],
    ['day30', 'a', '2026-10-04T12:00:00Z', 0.25],
    ['day31', 'a', '2026-10-05T00:00:00Z', 1],
    ['empty', 'a', '2026-09-02T12:00:00Z', 0],
    ['other', 'b', '2026-09-03T12:00:00Z', 1],
].map(([id, tenantId, expiryDate, stock]) => ({
    id: String(id), tenantId, expiryDate: new Date(String(expiryDate)), stock: Number(stock),
    batchNumber: `B-${id}`, product: { name: 'Medicamento', cost: 999 },
}));

function harness(type = 'FARMACIA') {
    const productRows = (where: any) => products.filter(row => row.tenantId === where.tenantId
        && (where.stock.gt === undefined || row.stock > where.stock.gt)
        && row.stock <= (where.stock.lte === MIN_STOCK ? row.minStock : where.stock.lte));
    const batchRows = (where: any) => batches.filter(row => row.tenantId === where.tenantId
        && row.stock > where.stock.gt
        && (where.expiryDate.gte === undefined || row.expiryDate >= where.expiryDate.gte)
        && row.expiryDate < where.expiryDate.lt);
    const db = {
        tenant: { findUnique: vi.fn().mockResolvedValue({ type }) },
        product: {
            fields: { minStock: MIN_STOCK },
            count: vi.fn(async ({ where }) => productRows(where).length),
            findMany: vi.fn(async ({ where, take }) => productRows(where).slice(0, take)),
        },
        productBatch: {
            count: vi.fn(async ({ where }) => batchRows(where).length),
            findMany: vi.fn(async ({ where, take }) => batchRows(where).slice(0, take)),
        },
        publicOrder: { count: vi.fn(async ({ where }) => where.tenantId === 'a' && where.status === 'PENDING' ? 137 : 0) },
    };
    const service = createOperationalAlertsService(db as unknown as OperationalAlertsDatabase, () => AS_OF);
    const businessQueries = () => [db.product.count, db.product.findMany, db.productBatch.count, db.productBatch.findMany, db.publicOrder.count];
    return { db, service, businessQueries };
}

describe('resumen operativo: conteos exactos, autorización y ejemplos acotados', () => {
    it('separa cero/negativo de mínimos positivos, no solapa vencidos/hoy y no limita pedidos a 100', async () => {
        const { service, db } = harness();
        const result = await service.getSummary('a', 'OWNER');
        expect(result?.checkedAt).toBe(AS_OF.toISOString());
        expect(result?.sections.map(({ id, status, count }) => ({ id, status, count }))).toEqual([
            { id: 'out_of_stock', status: 'ok', count: 2 },
            { id: 'low_stock', status: 'ok', count: 2 },
            { id: 'expired_batches', status: 'ok', count: 1 },
            { id: 'expiring_batches', status: 'ok', count: 3 },
            { id: 'pending_orders', status: 'ok', count: 137 },
        ]);
        expect(db.product.count).toHaveBeenNthCalledWith(2, { where: { tenantId: 'a', stock: { gt: 0, lte: MIN_STOCK } } });
        expect(db.publicOrder.count).toHaveBeenCalledExactlyOnceWith({ where: { tenantId: 'a', status: 'PENDING' } });
    });

    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN'])('%s conserva todas las secciones', async role => {
        const { service } = harness();
        expect((await service.getSummary('a', role))?.sections).toHaveLength(5);
    });

    it.each(['MANAGER', 'CASHIER', 'VIEWER'])('%s solo consulta lotes y pedidos; no stock administrativo', async role => {
        const { service, db } = harness();
        expect((await service.getSummary('a', role))?.sections.map(section => section.id)).toEqual(['expired_batches', 'expiring_batches', 'pending_orders']);
        expect(db.product.count).not.toHaveBeenCalled();
        expect(db.product.findMany).not.toHaveBeenCalled();
    });

    it.each(['EMPLOYEE', 'VENDEDOR', 'ACCOUNTANT', 'COLLECTOR'])('%s conserva únicamente lectura de vencimientos', async role => {
        const { service, db } = harness();
        expect((await service.getSummary('a', role))?.sections.map(section => section.id)).toEqual(['expired_batches', 'expiring_batches']);
        expect(db.product.count).not.toHaveBeenCalled();
        expect(db.publicOrder.count).not.toHaveBeenCalled();
    });

    it.each(['BODEGUERO', 'UNKNOWN', '', 'owner'])('rol %s denegado no consulta ni tenant ni negocio', async role => {
        const { service, db, businessQueries } = harness();
        await expect(service.getSummary('a', role)).rejects.toMatchObject({ status: 403 });
        expect(db.tenant.findUnique).not.toHaveBeenCalled();
        businessQueries().forEach(query => expect(query).not.toHaveBeenCalled());
    });

    it.each(['', '  ', undefined])('tenant ausente %s no dispara consultas', async tenantId => {
        const { service, db, businessQueries } = harness();
        await expect(service.getSummary(tenantId!, 'OWNER')).rejects.toMatchObject({ status: 401 });
        expect(db.tenant.findUnique).not.toHaveBeenCalled();
        businessQueries().forEach(query => expect(query).not.toHaveBeenCalled());
    });

    it('LENDER no consulta datos de retail; negocio inexistente tampoco', async () => {
        const { service, db, businessQueries } = harness('LENDER');
        expect(await service.getSummary('a', 'OWNER')).toEqual({ checkedAt: AS_OF.toISOString(), sections: [] });
        db.tenant.findUnique.mockResolvedValue(null);
        expect(await service.getSummary('a', 'OWNER')).toBeNull();
        businessQueries().forEach(query => expect(query).not.toHaveBeenCalled());
    });

    it('dos tenants producen conteos propios y todas las lecturas usan ese scope', async () => {
        const { service, db, businessQueries } = harness();
        await service.getSummary('a', 'OWNER');
        businessQueries().forEach(query => query.mockClear());
        expect((await service.getSummary('b', 'OWNER'))?.sections.map(section => section.count)).toEqual([1, 0, 1, 0, 0]);
        businessQueries().forEach(query => query.mock.calls.forEach(([args]) => expect(args.where.tenantId).toBe('b')));
        expect(db.tenant.findUnique).toHaveBeenLastCalledWith({ where: { id: 'b' }, select: { type: true } });
    });

    it('un fallo es parcial y nunca se presenta como cero', async () => {
        const { service, db } = harness();
        db.publicOrder.count.mockRejectedValue(new Error('DB details must stay private'));
        const result = await service.getSummary('a', 'OWNER');
        expect(result?.sections.at(-1)).toEqual({ id: 'pending_orders', status: 'error', count: null });
        expect(result?.sections.slice(0, 4).every(section => section.status === 'ok')).toBe(true);
        expect(JSON.stringify(result)).not.toContain('DB details');
    });

    it('si fallan muestras, no publica una sección falsamente verificada', async () => {
        const { service, db } = harness();
        db.product.findMany.mockRejectedValue(new Error('unavailable'));
        const result = await service.getSummary('a', 'OWNER');
        expect(result?.sections.slice(0, 2)).toEqual([
            { id: 'out_of_stock', status: 'error', count: null },
            { id: 'low_stock', status: 'error', count: null },
        ]);
        expect(result?.sections[2].status).toBe('ok');
    });

    it('con cero omite consultas de ejemplos', async () => {
        const { service, db } = harness();
        db.product.count.mockResolvedValue(0);
        db.productBatch.count.mockResolvedValue(0);
        const result = await service.getSummary('a', 'OWNER');
        expect(db.product.findMany).not.toHaveBeenCalled();
        expect(db.productBatch.findMany).not.toHaveBeenCalled();
        expect(result?.sections.every(section => !('samples' in section))).toBe(true);
    });

    it('ejemplos usan mismo filtro, take 3, desempate estable y selects sin costos ni clientes', async () => {
        const { service, db } = harness();
        const result = await service.getSummary('a', 'OWNER');
        for (const model of [db.product, db.productBatch]) {
            model.findMany.mock.calls.forEach(([args], index) => {
                expect(args.where).toEqual(model.count.mock.calls[index][0].where);
                expect(args.take).toBe(3);
                expect(args.orderBy.at(-1)).toEqual({ id: 'asc' });
            });
        }
        expect(db.product.findMany.mock.calls[0][0].select).toEqual({ id: true, name: true, stock: true });
        expect(db.productBatch.findMany.mock.calls[0][0].select).toEqual({ id: true, batchNumber: true, expiryDate: true, product: { select: { name: true } } });
        expect(result?.sections[2]).toMatchObject({ samples: [{ id: 'expired', name: 'Medicamento', detail: 'Lote B-expired · Vence 2026-09-03' }] });
        expect(result?.sections.at(-1)).not.toHaveProperty('samples');
        expect(JSON.stringify(result)).not.toMatch(/cost|customer|tenantId/);
    });
});

describe('ventana civil de vencimiento: Managua con registros a medianoche o mediodía UTC', () => {
    it.each([
        ['2026-01-02T05:59:59Z', '2026-01-01', '2026-02-01'],
        ['2026-01-02T06:00:00Z', '2026-01-02', '2026-02-02'],
        ['2028-02-28T18:00:00Z', '2028-02-28', '2028-03-30'],
        ['2026-12-31T18:00:00Z', '2026-12-31', '2027-01-31'],
    ])('%s usa hoy %s y excluye desde %s', (asOf, today, after) => {
        expect(operationalExpiryWindow(new Date(asOf))).toEqual({
            today: new Date(`${today}T00:00:00Z`), afterThirtyDays: new Date(`${after}T00:00:00Z`),
        });
    });
});
