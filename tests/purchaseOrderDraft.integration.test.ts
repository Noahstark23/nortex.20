import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../backend/lib/prisma';
import { executePurchaseOrderDraft, executePurchaseOrderDraftInTransaction, preparePurchaseOrderDraft } from '../backend/services/purchaseOrderDraftService';
import { assertDisposableDatabase, type PurchaseFixture, type TestActor } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
let owner: PurchaseFixture;
async function roleActor(actor: TestActor, role: string): Promise<TestActor> {
    const user = await prisma.user.create({ data: { tenantId: actor.tenantId, name: `QA ${role}`, password: 'no-login-synthetic-fixture', role } });
    return { tenantId: actor.tenantId, userId: user.id, role, token: '' };
}
async function fixture(): Promise<PurchaseFixture> {
    assertDisposableDatabase();
    const tenant = await prisma.tenant.create({ data: { businessName: 'QA OC aislada', taxId: randomUUID() } });
    const actor = await roleActor({ tenantId: tenant.id, userId: '', role: 'OWNER', token: '' }, 'OWNER');
    const supplier = await prisma.supplier.create({ data: { tenantId: tenant.id, name: 'Proveedor sintético' } });
    const product = await prisma.product.create({ data: { tenantId: tenant.id, createdBy: actor.userId, name: 'Producto sintético', sku: randomUUID(), price: 20, cost: 0, stock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } });
    return { ...actor, supplierId: supplier.id, productId: product.id, warehouseId: '' };
}
const input = (actor = owner) => ({ supplierId: actor.supplierId, items: [{ productId: actor.productId, quantity: '2', unitCost: '7.123456' }] });
async function effects() {
    const where = { tenantId: owner.tenantId };
    const [orders, purchases, journals, kardex, cash, product] = await Promise.all([
        prisma.purchaseOrder.count({ where }), prisma.purchase.count({ where }), prisma.journalEntry.count({ where }),
        prisma.kardexMovement.count({ where }), prisma.cashMovement.count({ where }),
        prisma.product.findFirstOrThrow({ where: { ...where, id: owner.productId }, select: { stock: true, cost: true } }),
    ]);
    return { orders, purchases, journals, kardex, cash, product };
}
qa('OC DRAFT: correlativos y transacción real MySQL', () => {
    beforeAll(async () => { owner = await fixture(); }, 120_000);

    it('dos solicitudes concurrentes y respuesta perdida conservan un borrador y ningún movimiento', async () => {
        const before = await effects(); const requestKey = randomUUID(); const body = input();
        const settled = await Promise.allSettled([1, 2].map(() => executePurchaseOrderDraft({ principal: owner, input: body, requestKey })));
        for (const entry of settled) if (entry.status === 'rejected') throw entry.reason;
        const responses = settled.map(entry => (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof executePurchaseOrderDraft>>>).value);
        const id = responses[0].purchaseOrder.id;
        expect(responses[1].purchaseOrder.id).toBe(id);
        const replay = await executePurchaseOrderDraft({ principal: owner, input: body, requestKey });
        expect(replay.purchaseOrder.id).toBe(id);
        expect(replay.purchaseOrder).toMatchObject({ status: 'DRAFT', items: [{ quantityOrderedExact: '2', unitCostExact: '7.123456', quantityReceivedExact: '0' }] });
        const after = await effects(); expect(after).toEqual({ ...before, orders: before.orders + 1 });
        expect(await prisma.purchaseOrderDraftCommand.count({ where: { tenantId: owner.tenantId, requestKey, purchaseOrderId: id } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'PO_CREATED', details: { contains: id } } })).toBe(1);
    });

    it('usuarios y proveedores distintos reciben correlativos únicos incluso con snapshots REPEATABLE READ previos', async () => {
        const manager = await roleActor(owner, 'MANAGER');
        const supplier = await prisma.supplier.create({ data: { tenantId: owner.tenantId, name: 'Segundo proveedor sintético' } });
        const product = await prisma.product.create({ data: { tenantId: owner.tenantId, createdBy: owner.userId, name: 'Segundo producto', sku: randomUUID(), price: 10, cost: 0, stock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } });
        let arrived = 0; let release!: () => void;
        const ready = new Promise<void>(resolve => { release = resolve; });
        const actors = [owner, { ...owner, ...manager, supplierId: supplier.id, productId: product.id }];
        const settled = await Promise.allSettled(actors.map(actor => prisma.$transaction(async tx => {
            // Ambos crean el snapshot antes de competir por el lock del tenant.
            await tx.purchaseOrder.count({ where: { tenantId: owner.tenantId } });
            if (++arrived === 2) release();
            await ready;
            return executePurchaseOrderDraftInTransaction({ principal: actor, input: input(actor), requestKey: randomUUID() }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })));
        for (const entry of settled) if (entry.status === 'rejected') throw entry.reason;
        const results = settled.map(entry => (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof executePurchaseOrderDraft>>>).value);
        expect(new Set(results.map(result => result.purchaseOrder.orderNumber)).size).toBe(2);
        expect(new Set(results.map(result => result.purchaseOrder.id)).size).toBe(2);
        expect(results.every(result => result.purchaseOrder.status === 'DRAFT')).toBe(true);
    }, 20_000);

    it('aborta OC, auditoría y comando con el callback del integrador y permite reintentar', async () => {
        const before = await effects(); const requestKey = randomUUID();
        const auditBefore = await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'PO_CREATED' } });
        await expect(executePurchaseOrderDraft({ principal: owner, input: input(), requestKey, beforeCommit: async () => { throw new Error('abortar propuesta sintética'); } })).rejects.toThrow('abortar propuesta sintética');
        expect(await effects()).toEqual(before);
        expect(await prisma.purchaseOrderDraftCommand.count({ where: { tenantId: owner.tenantId, requestKey } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'PO_CREATED' } })).toBe(auditBefore);
        const result = await executePurchaseOrderDraft({ principal: owner, input: input(), requestKey });
        expect(result.replayed).toBe(false); expect((await effects()).orders).toBe(before.orders + 1);
    });

    it('siembra una sola secuencia en la primera carrera entre usuarios/proveedores distintos', async () => {
        const first = await fixture(); const manager = await roleActor(first, 'MANAGER');
        const supplier = await prisma.supplier.create({ data: { tenantId: first.tenantId, name: 'Proveedor de carrera' } });
        const product = await prisma.product.create({ data: { tenantId: first.tenantId, createdBy: first.userId, name: 'Producto de carrera', sku: randomUUID(), price: 10, cost: 0, stock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } });
        const actors = [first, { ...first, ...manager, supplierId: supplier.id, productId: product.id }];
        const settled = await Promise.allSettled(actors.map(actor => executePurchaseOrderDraft({ principal: actor, input: input(actor), requestKey: randomUUID() })));
        for (const entry of settled) if (entry.status === 'rejected') throw entry.reason;
        const results = settled.map(entry => (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof executePurchaseOrderDraft>>>).value);
        expect(results.map(result => result.purchaseOrder.orderNumber).sort()).toEqual(['OC-0001', 'OC-0002']);
        expect(await prisma.purchaseOrderDraftSequence.count({ where: { tenantId: first.tenantId } })).toBe(1);
        expect((await prisma.purchaseOrderDraftSequence.findUniqueOrThrow({ where: { tenantId: first.tenantId } })).lastNumber).toBe(2n);
    });

    it('precio de catálogo modificado invalida la revisión antes de crear el borrador', async () => {
        const preview = await preparePurchaseOrderDraft(owner, input()); const before = await effects(); const requestKey = randomUUID();
        await prisma.product.updateMany({ where: { id: owner.productId, tenantId: owner.tenantId }, data: { price: 23 } });
        await expect(executePurchaseOrderDraft({ principal: owner, input: input(), requestKey, expectedPreviewHash: preview.previewHash })).rejects.toMatchObject({ code: 'PO_PREVIEW_CHANGED' });
        expect(await effects()).toEqual(before);
        expect(await prisma.purchaseOrderDraftCommand.count({ where: { tenantId: owner.tenantId, requestKey } })).toBe(0);
    });

    it('usuario revocado y clave con otro contenido no recuperan ni duplican la OC', async () => {
        const manager = await roleActor(owner, 'MANAGER'); const requestKey = randomUUID(); const body = input();
        const original = await executePurchaseOrderDraft({ principal: manager, input: body, requestKey });
        await expect(executePurchaseOrderDraft({ principal: manager, input: { ...body, notes: 'otro contenido' }, requestKey })).rejects.toMatchObject({ code: 'PO_IDEMPOTENCY_CONFLICT' });
        await prisma.user.updateMany({ where: { id: manager.userId, tenantId: owner.tenantId }, data: { status: 'DISABLED' } });
        await expect(executePurchaseOrderDraft({ principal: manager, input: body, requestKey })).rejects.toMatchObject({ code: 'PO_FORBIDDEN' });
        expect(await prisma.purchaseOrder.count({ where: { tenantId: owner.tenantId, id: original.purchaseOrder.id } })).toBe(1);
    });

    it('una transacción con snapshot antiguo rechaza referencias modificadas después de la revisión', async () => {
        const preview = await preparePurchaseOrderDraft(owner, input()); const before = await effects();
        await expect(prisma.$transaction(async tx => {
            await tx.product.findFirstOrThrow({ where: { id: owner.productId, tenantId: owner.tenantId } });
            await prisma.product.updateMany({ where: { id: owner.productId, tenantId: owner.tenantId }, data: { price: 41 } });
            return executePurchaseOrderDraftInTransaction({ principal: owner, input: input(), requestKey: randomUUID(), expectedPreviewHash: preview.previewHash }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })).rejects.toMatchObject({ code: 'PO_PREVIEW_CHANGED' });
        expect(await effects()).toEqual(before);
    });
});
