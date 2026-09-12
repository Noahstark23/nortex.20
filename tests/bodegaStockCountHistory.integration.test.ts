import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, baseUrl, fixture, status, type PurchaseFixture } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;

qa('Bodega: pendientes visibles sobre más de cien conteos históricos', () => {
    let owner: PurchaseFixture;
    let other: PurchaseFixture;
    let secondaryWarehouseId: string;
    let pendingId: string;
    let historicalIds: string[];

    beforeAll(async () => {
        owner = await fixture();
        other = await fixture();
        const secondary = await api('/api/warehouses', owner, 'POST', { name: `Bodega pendiente QA ${randomUUID()}` });
        status(secondary, 201);
        secondaryWarehouseId = secondary.body.data.id;
        const historicalStart = Date.now() - 3_600_000;
        historicalIds = Array.from({ length: 101 }, () => randomUUID());
        await prisma.stockCount.createMany({ data: historicalIds.map((id, index) => ({
            id, tenantId: owner.tenantId, warehouseId: owner.warehouseId,
            createdBy: owner.userId, status: index % 2 === 0 ? 'CLOSED' : 'CANCELLED',
            createdAt: new Date(historicalStart + index * 1000),
            closedAt: new Date(historicalStart + index * 1000 + 500),
        })) });
        pendingId = randomUUID();
        await prisma.stockCount.create({ data: {
            id: pendingId, tenantId: owner.tenantId, warehouseId: secondaryWarehouseId,
            openWarehouseKey: secondaryWarehouseId, createdBy: owner.userId, status: 'OPEN',
            createdAt: new Date(historicalStart - 86_400_000),
        } });
        await prisma.stockCount.createMany({ data: ['OPEN', 'CLOSED'].map((countStatus) => ({
            id: randomUUID(), tenantId: other.tenantId, warehouseId: other.warehouseId,
            createdBy: other.userId, status: countStatus, createdAt: new Date(),
        })) });
    }, 120_000);

    it.each(['OPEN', 'CLOSING'])('conserva el pendiente antiguo %s, los cien históricos recientes y el tenant', async (pendingStatus) => {
        // La transición es preparación de fixture; se verifica el contrato HTTP de lectura.
        if (pendingStatus === 'CLOSING') {
            await prisma.stockCount.update({ where: { id: pendingId }, data: { status: 'CLOSING', openWarehouseKey: null } });
        }
        const response = await api('/api/stock-counts', owner);
        status(response, 200);
        expect(response.body).toHaveLength(101);
        expect(response.body.every((row: any) => row.tenantId === owner.tenantId)).toBe(true);
        expect(response.body.find((row: any) => row.id === pendingId)).toMatchObject({
            status: pendingStatus, warehouseId: secondaryWarehouseId,
            warehouse: { id: secondaryWarehouseId },
        });
        const returnedHistory = response.body.filter((row: any) => !['OPEN', 'CLOSING'].includes(row.status));
        expect(returnedHistory.map((row: any) => row.id)).toEqual(historicalIds.slice(1).reverse());
        expect(response.body.some((row: any) => row.id === historicalIds[0])).toBe(false);
        expect(await prisma.stockCount.count({ where: { tenantId: owner.tenantId } })).toBe(102);
        expect(await prisma.stockCount.count({ where: { tenantId: other.tenantId } })).toBe(2);
    });
});
