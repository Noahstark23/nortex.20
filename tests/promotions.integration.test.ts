import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';
import { preparePromotion, executePromotionInTransaction } from '../backend/services/promotions/management';
import { createCheckoutQuote, getCheckoutOperation } from '../backend/services/promotions/checkout';
import { executeSaleWithResult } from '../backend/services/salesService';
import { buildReturnAvailability } from '../backend/services/returnService';
import { withPromotionPriceVersion } from '../backend/services/promotions/productVersion';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
async function ddl(sql: string) {
    assertDisposableDatabase();
    await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'], { stdio: ['pipe', 'ignore', 'pipe'] });
        child.stderr.resume(); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Falló DDL de QA descartable.'))); child.stdin.end(sql);
    });
}
async function fixture(vertical = 'FERRETERIA') {
    assertDisposableDatabase(); const nonce = randomUUID();
    const tenant = await prisma.tenant.create({ data: { businessName: `QA Promociones ${nonce}`, taxId: nonce, type: vertical } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Propietario sintético', role: 'OWNER', password: 'no-login-fixture' } });
    const principal = { tenantId: tenant.id, userId: user.id, role: user.role };
    await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, promotionsEnabled: true } });
    const shift = await prisma.shift.create({ data: { tenantId: tenant.id, userId: user.id, status: 'OPEN', initialCash: '100' } });
    const product = await prisma.product.create({ data: { tenantId: tenant.id, createdBy: user.id, name: 'Producto de promoción', sku: nonce, price: 100, cost: 40,
        stock: 50, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', wholesalePrice: 80, wholesaleMinQty: 10, packSize: 10, packPrice: 600, packUnit: 'caja', ivaExento: vertical === 'FARMACIA' } });
    const draft = { operation: 'PUBLISH', name: 'Semana de ofertas', percent: '10', productIds: [product.id], startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() };
    const body = () => ({ offlineId: randomUUID(), employeeId: null, paymentMethod: 'CASH', items: [{ id: product.id, quantity: '2' }] });
    return { principal, shift, product, draft, body };
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
    const draft = { ...f.draft, ...overrides }; const review = await preparePromotion(f.principal, draft);
    const requestKey = randomUUID();
    const result = await prisma.$transaction(tx => executePromotionInTransaction(f.principal, draft, { tx, requestKey, domainHash: review.hash }), { isolationLevel: 'ReadCommitted' });
    return { result, draft, review, requestKey };
}
async function quoted(f: Awaited<ReturnType<typeof fixture>>, body = f.body()) {
    const response = await createCheckoutQuote(f.principal, { shiftId: f.shift.id, sale: body });
    expect(response.enabled).toBe(true); expect(response.quote).not.toBeNull();
    return { quote: response.quote!, input: { ...body, promotionQuote: { id: response.quote!.id, version: response.quote!.version } } };
}
const sale = (f: Awaited<ReturnType<typeof fixture>>, input: unknown) => executeSaleWithResult(f.principal.tenantId, f.principal.userId, f.shift.id, input);

qa('Promociones: precios, carreras y cobro real MySQL', () => {
    beforeAll(() => vi.stubEnv('NORTEX_PROMOTIONS_ENABLED', 'true'));
    afterAll(() => vi.unstubAllEnvs());
    it.each(['FERRETERIA', 'FARMACIA'])('%s publica sin mover stock ni dinero y cobra una sola vez', async vertical => {
        const f = await fixture(vertical), publication = await publish(f);
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.product.id, tenantId: f.principal.tenantId } })).stock).toBe(50);
        const prepared = await quoted(f); expect(prepared.quote.total).toBe('180.00');
        expect(prepared.quote.hasPromotions).toBe(true);
        // C$180 incluyen IVA: 180 × 15 / 115 = 23.478260..., snapshot a 4dp.
        expect(prepared.quote.vatAmount).toBe(vertical === 'FARMACIA' ? '0.0000' : '23.4783');
        const settled = await Promise.allSettled([1, 2].map(() => sale(f, prepared.input)));
        for (const result of settled) if (result.status === 'rejected') throw result.reason;
        const results = settled.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof sale>>>).value);
        expect(results[0].sale.id).toBe(results[1].sale.id);
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(1);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.principal.tenantId, referenceId: results[0].sale.id } })).toBe(1);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.product.id, tenantId: f.principal.tenantId } })).stock).toBe(48);
        const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: results[0].sale.id } });
        expect(line.unitPriceExactAtSale?.toFixed(4)).toBe('90.0000'); expect(line.discount).toBe(0);
        expect(line.promotionSnapshot).toMatchObject({ id: publication.result.promotionId, normalUnitPrice: '100.0000', unitPrice: '90.0000' });
        await prisma.promotionCheckout.updateMany({ where: { id: prepared.quote.id, tenantId: f.principal.tenantId }, data: { expiresAt: new Date(0) } });
        await prisma.assistantTenantConfig.update({ where: { tenantId: f.principal.tenantId }, data: { promotionsEnabled: false } });
        expect((await sale(f, prepared.input)).idempotentReplay).toBe(true);
        const receipt = await getCheckoutOperation(f.principal, prepared.quote.offlineId);
        expect(receipt).toMatchObject({ status: 'COMMITTED', sale: { id: results[0].sale.id, total: '180' } });
        expect(JSON.stringify(receipt)).not.toContain('costAtSale');
    });

    it('publicaciones concurrentes del mismo producto rechazan el solapamiento', async () => {
        const f = await fixture(); const admin = await prisma.user.create({ data: { tenantId: f.principal.tenantId, name: 'Administración', role: 'ADMIN', password: 'no-login-fixture' } });
        const principals = [f.principal, { tenantId: f.principal.tenantId, userId: admin.id, role: 'ADMIN' }];
        const reviews = await Promise.all(principals.map(principal => preparePromotion(principal, f.draft)));
        const outcomes = await Promise.allSettled(principals.map((principal, i) => prisma.$transaction(tx => executePromotionInTransaction(principal, f.draft, { tx, requestKey: randomUUID(), domainHash: reviews[i].hash }), { isolationLevel: 'ReadCommitted' })));
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'PROMOTION_OVERLAP' });
        expect(await prisma.promotion.count({ where: { tenantId: f.principal.tenantId } })).toBe(1);
    });

    it('una cancelación invalida el cobro pendiente y el reembolso usa el precio vendido', async () => {
        const f = await fixture(); const publication = await publish(f); const paid = await quoted(f); const original = await sale(f, paid.input);
        const pending = await quoted(f);
        const draft = { operation: 'CANCEL', promotionId: publication.result.promotionId, version: 1 };
        const review = await preparePromotion(f.principal, draft);
        await prisma.$transaction(tx => executePromotionInTransaction(f.principal, draft, { tx, requestKey: randomUUID(), domainHash: review.hash }), { isolationLevel: 'ReadCommitted' });
        await expect(sale(f, pending.input)).rejects.toMatchObject({ code: 'PROMOTION_QUOTE_CHANGED' });
        await prisma.product.updateMany({ where: { id: f.product.id, tenantId: f.principal.tenantId }, data: { price: 500 } });
        const lines = await prisma.saleItem.findMany({ where: { saleId: original.sale.id }, take: 500 });
        const availability = buildReturnAvailability({ saleItems: lines as any, previousReturns: [], productsById: new Map([[f.product.id, f.product]]), globalDiscount: original.sale.globalDiscount });
        expect(availability[0].refundUnitPrice.toFixed(4)).toBe('90.0000');
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(1);
    });

    it.each(['quantity', 'payment', 'quote', 'price', 'fiscal', 'expiry'])('cambio de %s exige nueva revisión y no mueve stock', async changed => {
        const f = await fixture(); await publish(f); const prepared = await quoted(f);
        if (changed === 'quantity') prepared.input.items[0].quantity = '3';
        if (changed === 'payment') prepared.input.paymentMethod = 'CARD';
        if (changed === 'quote') prepared.input.promotionQuote.version = 2;
        if (changed === 'price') await prisma.product.updateMany({ where: { id: f.product.id, tenantId: f.principal.tenantId }, data: { wholesaleMinQty: 20 } });
        if (changed === 'fiscal') await prisma.tenant.update({ where: { id: f.principal.tenantId }, data: { fiscalRegimeVersion: { increment: 1 } } });
        if (changed === 'expiry') await prisma.promotionCheckout.updateMany({ where: { id: prepared.quote.id, tenantId: f.principal.tenantId }, data: { expiresAt: new Date(0) } });
        await expect(sale(f, prepared.input)).rejects.toMatchObject({ code: 'PROMOTION_QUOTE_CHANGED' });
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.product.id, tenantId: f.principal.tenantId } })).stock).toBe(50);
    });

    it('sin revisión rechaza promoción, sin conexión la prohíbe, usuario revocado no recupera', async () => {
        const f = await fixture(); await publish(f);
        await expect(sale(f, f.body())).rejects.toMatchObject({ code: 'PROMOTION_QUOTE_REQUIRED' });
        const prepared = await quoted(f);
        await expect(executeSaleWithResult(f.principal.tenantId, f.principal.userId, f.shift.id, prepared.input, { offlineSync: true })).rejects.toMatchObject({ code: 'PROMOTION_OFFLINE_FORBIDDEN' });
        const original = await sale(f, prepared.input);
        await expect(sale(f, { ...prepared.input, promotionQuote: { ...prepared.input.promotionQuote, version: 2 } })).rejects.toMatchObject({ code: 'OFFLINE_PAYLOAD_MISMATCH' });
        await prisma.user.updateMany({ where: { id: f.principal.userId, tenantId: f.principal.tenantId }, data: { status: 'DISABLED' } });
        await expect(sale(f, prepared.input)).rejects.toMatchObject({ code: 'PROMOTION_FORBIDDEN' });
        await expect(getCheckoutOperation(f.principal, prepared.quote.offlineId)).rejects.toMatchObject({ code: 'PROMOTION_FORBIDDEN' });
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId, id: original.sale.id } })).toBe(1);
    });
    it('100 → 120 → 100 no revive una promoción sin nueva revisión', async () => {
        const f = await fixture(); await publish(f);
        for (const price of [120, 100]) await prisma.$transaction(async tx => {
            const updates = await withPromotionPriceVersion(tx, f.principal.tenantId, f.product.id, { price });
            await tx.product.updateMany({ where: { tenantId: f.principal.tenantId, id: f.product.id }, data: updates });
        });
        const preview = await quoted(f);
        expect(preview.quote.hasPromotions).toBe(false);
        expect(preview.quote.total).toBe('200.00');
        expect(preview.quote.warnings).toHaveLength(1);
    });
    it('cancelar promoción y cobrar simultáneamente conserva un orden único sin duplicar efectos', async () => {
        const f = await fixture(); const publication = await publish(f); const prepared = await quoted(f);
        const admin = await prisma.user.create({ data: { tenantId: f.principal.tenantId, name: 'Administración', role: 'ADMIN', password: 'no-login-fixture' } });
        const principal = { tenantId: f.principal.tenantId, userId: admin.id, role: 'ADMIN' };
        const draft = { operation: 'CANCEL', promotionId: publication.result.promotionId, version: 1 };
        const review = await preparePromotion(principal, draft);
        const [sold, cancelled] = await Promise.allSettled([
            sale(f, prepared.input),
            prisma.$transaction(tx => executePromotionInTransaction(principal, draft, { tx, requestKey: randomUUID(), domainHash: review.hash }), { isolationLevel: 'ReadCommitted' }),
        ]);
        if (cancelled.status === 'rejected') throw cancelled.reason;
        expect(cancelled.value.status).toBe('CANCELLED');
        if (sold.status === 'rejected') expect(sold.reason).toMatchObject({ code: 'PROMOTION_QUOTE_CHANGED' });
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(sold.status === 'fulfilled' ? 1 : 0);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.product.id, tenantId: f.principal.tenantId } })).stock).toBe(sold.status === 'fulfilled' ? 48 : 50);
    });
    it('farmacia rechaza lotes vencidos y revierte toda la venta aunque tenga promoción', async () => {
        const f = await fixture('FARMACIA');
        await prisma.product.updateMany({ where: { tenantId: f.principal.tenantId, id: f.product.id }, data: { requiresBatchTracking: true } });
        await prisma.productBatch.create({ data: { tenantId: f.principal.tenantId, productId: f.product.id, batchNumber: 'VENCIDO', expiryDate: new Date('2000-01-01'), stock: 50 } });
        await publish(f); const prepared = await quoted(f);
        await expect(sale(f, prepared.input)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
        expect(await prisma.sale.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect(await prisma.journalEntry.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect(await prisma.kardexMovement.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        expect((await prisma.product.findFirstOrThrow({ where: { id: f.product.id, tenantId: f.principal.tenantId } })).stock).toBe(50);
    });
    it('fallo real de auditoría revierte publicación, items y comprobante; reintento publica una vez', async () => {
        const f = await fixture(); const review = await preparePromotion(f.principal, f.draft); const requestKey = randomUUID();
        const trigger = `qa_promo_audit_${randomUUID().replaceAll('-', '')}`;
        await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW BEGIN IF NEW.tenantId = '${f.principal.tenantId}' AND NEW.action = 'PROMOTION_PUBLISHED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA promotion audit failure'; END IF; END`);
        const execute = () => prisma.$transaction(tx => executePromotionInTransaction(f.principal, f.draft, { tx, requestKey, domainHash: review.hash }), { isolationLevel: 'ReadCommitted' });
        try {
            await expect(execute()).rejects.toThrow();
            expect(await prisma.promotion.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
            expect(await prisma.promotionItem.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
            expect(await prisma.promotionCommand.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
            expect(await prisma.auditLog.count({ where: { tenantId: f.principal.tenantId } })).toBe(0);
        } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
        const first = await execute(), second = await execute();
        expect(first.promotionId).toBe(second.promotionId); expect(second.replayed).toBe(true);
        expect(await prisma.promotion.count({ where: { tenantId: f.principal.tenantId } })).toBe(1);
    });
});
