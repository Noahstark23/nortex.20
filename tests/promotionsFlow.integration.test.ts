import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, baseUrl, fixture, roleActor, status, type PurchaseFixture } from './fixtures/assistant/integrationHelpers';
import { approveQaCorrection, inviteQaMember } from './helpers/saleCorrectionQa';

const qa = baseUrl ? describe.sequential : describe.skip;
async function setup(vertical: 'FERRETERIA' | 'FARMACIA' = 'FERRETERIA') {
    const actor = await fixture(vertical);
    await prisma.assistantTenantConfig.update({ where: { tenantId: actor.tenantId }, data: { promotionsEnabled: true, actionsEnabled: true } });
    const opened = await api('/api/shifts/open', actor, 'POST', { initialCash: 500, employeePin: '1234' }); status(opened, 200);
    const shift = await prisma.shift.findFirstOrThrow({ where: { tenantId: actor.tenantId, userId: actor.userId, status: 'OPEN' } });
    const product = await api('/api/products', actor, 'POST', { name: 'Producto promocional sintético', sku: randomUUID(), category: 'QA',
        price: 100, cost: 1, stock: 50, minStock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1,
        packUnit: 'caja', packSize: 3, packPrice: 10, isPublished: false, ivaExento: vertical === 'FARMACIA', requiresBatchTracking: false });
    status(product, 200);
    return { actor, shiftId: shift.id, productId: product.body.id as string };
}
async function publish(f: Awaited<ReturnType<typeof setup>>, percent = '17') {
    const draft = { operation: 'PUBLISH', name: 'Promoción revisada', percent, productIds: [f.productId], startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() };
    const prepared = await api('/api/assistant/action-proposals', f.actor, 'POST', { kind: 'PROMOTION', draft, requestKey: randomUUID() }); status(prepared, 201);
    const reviewed = await api(`/api/assistant/action-proposals/${prepared.body.id}/preview`, f.actor, 'POST', { version: prepared.body.version }); status(reviewed, 200);
    expect(reviewed.body.status, JSON.stringify(reviewed.body.issues)).toBe('READY');
    const target = `/api/assistant/action-proposals/${prepared.body.id}/confirm`;
    status(await api(target, f.actor, 'POST', { version: reviewed.body.version, requestKey: randomUUID(), percent: '99' }), 400);
    const result = await api(target, f.actor, 'POST', { version: reviewed.body.version, requestKey: randomUUID() }); status(result, 200);
    return result.body;
}
async function quote(f: Awaited<ReturnType<typeof setup>>, pack = false) {
    const input = { offlineId: randomUUID(), paymentMethod: 'CASH', items: [{ id: f.productId, quantity: pack ? '3' : '2',
        ...(pack ? { presentation: { quantity: '1', unit: 'caja' } } : {}) }] };
    const reviewed = await api('/api/promotions/checkout/quote', f.actor, 'POST', { shiftId: f.shiftId, sale: input }); status(reviewed, 200);
    expect(reviewed.body.enabled).toBe(true);
    return { quote: reviewed.body.quote, input: { ...input, promotionQuote: { id: reviewed.body.quote.id, version: reviewed.body.quote.version } } };
}
const postFor = (actor: PurchaseFixture) => (path: string, body: unknown) => api(path, actor, 'POST', body);
async function journal(actor: PurchaseFixture, referenceId: string, referenceType: string) {
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId: actor.tenantId, referenceId, referenceType }, include: { lines: { include: { account: true } } } });
    return entry.lines.map(line => ({ code: line.account.code, debit: line.debit.toFixed(4), credit: line.credit.toFixed(4) })).sort((a, b) => a.code.localeCompare(b.code));
}

qa('Promociones HTTP: revisión, cobro, devolución y anulación reales', () => {
    it('PUT precio 100 → 120 → 100 mantiene suspensión visible y cobra precio normal revisado', async () => {
        const f = await setup(); await publish(f, '10');
        for (const price of [120, 100]) status(await api(`/api/products/${f.productId}`, f.actor, 'PUT', { price }), 200);
        const listed = await api('/api/promotions', f.actor); status(listed, 200);
        expect(listed.body.data[0].effectiveStatus).toBe('SUSPENDED');
        const reviewed = await quote(f); expect(reviewed.quote.total).toBe('200.00'); expect(reviewed.quote.hasPromotions).toBe(false);
        expect(reviewed.quote.warnings).toHaveLength(1);
        const sold = await api('/api/sales', f.actor, 'POST', reviewed.input); status(sold, 200); expect(Number(sold.body.total)).toBe(200);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.actor.tenantId } })).promotionPriceVersion).toBe(3);
    }, 120000);

    it.each(['FERRETERIA', 'FARMACIA'] as const)('%s devuelve PACK al precio vendido y anula con IVA histórico, aunque cambie catálogo', async vertical => {
        const f = await setup(vertical); const post = postFor(f.actor); const approver = await inviteQaMember(post, 'MANAGER'); await publish(f);
        const sales = [];
        for (let index = 0; index < 2; index++) {
            const reviewed = await quote(f, true); expect(reviewed.quote.total).toBe('8.30');
            const sold = await post('/api/sales', reviewed.input); status(sold, 200);
            const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sold.body.id } });
            expect(item.unitPriceExactAtSale?.toFixed(4)).toBe('2.7666');
            const receipt = await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}`, f.actor); status(receipt, 200);
            expect(receipt.cacheControl).toBe('private, no-store');
            expect(receipt.body.sale.items[0]).toMatchObject({ presentationAtSale: 'PACK', presentationQuantityAtSale: '1', unitAtSale: 'unidad', quantity: 3 });
            expect(Number(receipt.body.sale.vatAmountAtSale)).toBe(vertical === 'FARMACIA' ? 0 : 1.0826);
            expect(receipt.body.sale.fiscalRegimeAtSale).toBe('GENERAL');
            sales.push({ id: sold.body.id as string, item });
        }
        status(await api(`/api/products/${f.productId}`, f.actor, 'PUT', { price: 500, packPrice: 600, ivaExento: vertical !== 'FARMACIA' }), 200);
        await prisma.tenant.update({ where: { id: f.actor.tenantId }, data: { fiscalRegime: 'CUOTA_FIJA', fiscalRegimeVersion: { increment: 1 } } });
        const reason = 'Devolución sintética aprobada';
        const correctionRequestId = await approveQaCorrection(post, approver, { saleId: sales[0].id, kind: 'RETURN', reason, resolution: 'REFUND', refundMethod: 'CASH',
            lines: [{ saleItemId: sales[0].item.id, quantity: '1', disposition: 'RESTOCK' }] });
        const payload = { correctionRequestId, clientEventId: randomUUID(), saleId: sales[0].id, items: [{ saleItemId: sales[0].item.id, quantity: 1 }], reason, refundMethod: 'CASH' };
        const responses = await Promise.all([post('/api/returns', payload), post('/api/returns', payload)]);
        for (const response of responses) status(response, 200);
        expect(responses[0].body.id).toBe(responses[1].body.id);
        const returned = await prisma.productReturn.findFirstOrThrow({ where: { id: responses[0].body.id, tenantId: f.actor.tenantId }, include: { normalizedItems: true, refunds: true } });
        expect(returned.total.toFixed(2)).toBe('2.77'); expect(returned.normalizedItems[0].refundUnitPrice.toFixed(4)).toBe('2.7666');
        expect(returned.refunds).toHaveLength(1); expect(returned.refunds[0].amount.toFixed(2)).toBe('2.77');
        expect(returned.refunds[0].status).toBe('COMPLETED');
        const returnJournal = await journal(f.actor, returned.id, 'RETURN');
        expect(returnJournal.find(line => line.code === '2.1.2')?.debit ?? '0.0000').toBe(vertical === 'FARMACIA' ? '0.0000' : '0.3613');
        const cash = await prisma.cashMovement.findMany({ where: { tenantId: f.actor.tenantId, category: 'DEVOLUCION' } });
        expect(cash).toHaveLength(1); expect(cash[0].type).toBe('OUT'); expect(cash[0].amount.toFixed(2)).toBe('2.77');
        const beforeVoid = await journal(f.actor, sales[1].id, 'SALE');
        const voidReason = 'Anulación sintética aprobada';
        const voidRequestId = await approveQaCorrection(post, approver, { saleId: sales[1].id, kind: 'VOID', reason: voidReason });
        status(await post(`/api/sales/${sales[1].id}/cancel`, { correctionRequestId: voidRequestId, motivo: voidReason }), 200);
        expect(await journal(f.actor, sales[1].id, 'SALE_CANCELLED')).toEqual(beforeVoid.map(line => ({ code: line.code, debit: line.credit, credit: line.debit })));
        expect((await prisma.sale.findFirstOrThrow({ where: { id: sales[1].id, tenantId: f.actor.tenantId } })).status).toBe('VOIDED');
        expect(await prisma.cashMovement.count({ where: { tenantId: f.actor.tenantId, category: 'DEVOLUCION' } })).toBe(1);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.actor.tenantId } })).stock).toBe(48);
    }, 120000);

    it('cancelar intento invalida revisiones; la carrera con POST devuelve comprobante o impide vender', async () => {
        const f = await setup(); await publish(f);
        const old = await quote(f);
        const cancelPath = `/api/promotions/checkout/operations/${old.input.offlineId}/cancel`;
        const cancelled = await api(cancelPath, f.actor, 'POST', {}); status(cancelled, 200); expect(cancelled.body.status).toBe('CANCELLED');
        expect((await api(cancelPath, f.actor, 'POST', {})).body.status).toBe('CANCELLED');
        status(await api('/api/sales', f.actor, 'POST', old.input), 409);
        const next = await quote(f);
        const [sold, cancelledNext] = await Promise.all([api('/api/sales', f.actor, 'POST', next.input), api(`/api/promotions/checkout/operations/${next.input.offlineId}/cancel`, f.actor, 'POST', {})]);
        status(cancelledNext, 200);
        if (cancelledNext.body.status === 'COMMITTED') { status(sold, 200); expect(cancelledNext.body.sale.id).toBe(sold.body.id); }
        else { expect(cancelledNext.body.status).toBe('CANCELLED'); status(sold, 409); }
        expect(await prisma.sale.count({ where: { tenantId: f.actor.tenantId } })).toBe(cancelledNext.body.status === 'COMMITTED' ? 1 : 0);
    }, 120000);
    it('otro negocio no cobra ni recupera revisiones ajenas; gerente no publica promociones', async () => {
        const f = await setup(); const other = await setup(); await publish(f); const reviewed = await quote(f);
        const manager = await roleActor(f.actor, 'MANAGER');
        status(await api('/api/assistant/action-proposals', manager, 'POST', { kind: 'PROMOTION', draft: { name: 'No autorizada' }, requestKey: randomUUID() }), 403);
        status(await api('/api/promotions', manager), 403);
        status(await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}`, other.actor), 404);
        status(await api('/api/sales', other.actor, 'POST', reviewed.input), 409);
        const unrelated = await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}/cancel`, other.actor, 'POST', {}); status(unrelated, 200);
        const sold = await api('/api/sales', f.actor, 'POST', reviewed.input); status(sold, 200);
        status(await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}`, manager), 404);
        expect(await prisma.sale.count({ where: { tenantId: other.actor.tenantId } })).toBe(0);
        expect((await prisma.product.findFirstOrThrow({ where: { id: other.productId, tenantId: other.actor.tenantId } })).stock).toBe(50);
    }, 120000);
    it('respuesta de venta perdida seguida de cancelar recupera COMMITTED sin liberar un cobro registrado', async () => {
        const f = await setup(); await publish(f); const reviewed = await quote(f);
        const sold = await api('/api/sales', f.actor, 'POST', reviewed.input); status(sold, 200);
        const cancelled = await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}/cancel`, f.actor, 'POST', {}); status(cancelled, 200);
        expect(cancelled.body).toMatchObject({ status: 'COMMITTED', sale: { id: sold.body.id } });
        expect(cancelled.body.sale).toEqual((await api(`/api/promotions/checkout/operations/${reviewed.input.offlineId}`, f.actor)).body.sale);
        expect(await prisma.auditLog.count({ where: { tenantId: f.actor.tenantId, action: 'PROMOTION_CHECKOUT_CANCELLED' } })).toBe(0);
        expect((await prisma.promotionCheckout.findFirstOrThrow({ where: { tenantId: f.actor.tenantId, id: reviewed.quote.id } })).version).toBe(1);
    }, 120000);
});
