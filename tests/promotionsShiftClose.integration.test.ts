import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { executeSaleWithResult } from '../backend/services/salesService';
import { closeLegacyShift } from '../backend/services/shiftCloseService';
import { preparePromotion, executePromotionInTransaction } from '../backend/services/promotions/management';
import { createCheckoutQuote } from '../backend/services/promotions/checkout';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

qa('Caja y promociones: orden real de locks MySQL', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
    it.each([false, true])('promociones=%s: cierre esperando al actor no retiene Shift y contabiliza la venta', async enabled => {
        assertDisposableDatabase(); vi.stubEnv('NORTEX_PROMOTIONS_ENABLED', 'true');
        const tenant = await prisma.tenant.create({ data: { businessName: 'QA carrera caja', taxId: randomUUID() } });
        const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'QA caja', role: 'OWNER', password: 'no-login-fixture' } });
        // Esta regresión también afectaba negocios que nunca habilitaron promociones.
        const shift = await prisma.shift.create({ data: { tenantId: tenant.id, userId: user.id, initialCash: '500', status: 'OPEN' } });
        const product = await prisma.product.create({ data: { tenantId: tenant.id, createdBy: user.id, name: 'QA producto', sku: randomUUID(), price: 100, cost: 40,
            stock: 1, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } });
        let input: any = { offlineId: randomUUID(), paymentMethod: 'CASH', items: [{ id: product.id, quantity: 1 }] };
        if (enabled) {
            const principal = { tenantId: tenant.id, userId: user.id, role: 'OWNER' };
            await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, promotionsEnabled: true } });
            const draft = { name: 'QA oferta', percent: '10', productIds: [product.id], startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() };
            const prepared = await preparePromotion(principal, draft);
            await prisma.$transaction(tx => executePromotionInTransaction(principal, draft, { tx, requestKey: randomUUID(), domainHash: prepared.hash }));
            const reviewed = await createCheckoutQuote(principal, { shiftId: shift.id, sale: input });
            input = { ...input, employeeId: null, promotionQuote: { id: reviewed.quote!.id, version: reviewed.quote!.version } };
        }
        const held = signal(), release = signal(); const transaction = prisma.$transaction.bind(prisma);
        const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: any, options: any) => transaction(async tx => operation(new Proxy(tx, {
            get(target, property) {
                if (property !== '$queryRaw') return Reflect.get(target, property);
                return async (query: any, ...args: any[]) => {
                    const result = await (target.$queryRaw as any)(query, ...args);
                    const sql = Array.isArray(query) ? query.join(' ') : query.sql;
                    if (sql.includes('FROM `User`') && sql.includes('FOR UPDATE')) { held.resolve(); await release.promise; }
                    return result;
                };
            },
        })), options)) as any);
        const sold = executeSaleWithResult(tenant.id, user.id, shift.id, input);
        await held.promise;
        const db = { $transaction: (work: any) => transaction(work), shift: prisma.shift, tenant: prisma.tenant };
        const closed = closeLegacyShift(db as any, { tenantId: tenant.id, userId: user.id, role: 'OWNER' }, { shiftId: shift.id, declaredCash: '600', clientEventId: randomUUID() });
        // Barrera del motor: el cierre está realmente esperando User; no depende de dormir un tiempo supuesto.
        let waiting = false;
        try {
            for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
                const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID WHERE r.OBJECT_SCHEMA = DATABASE() AND r.OBJECT_NAME = 'User' AND r.LOCK_DATA LIKE ${`%${user.id}%`}`;
                waiting = Number(row.count) > 0;
                if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
        } finally { release.resolve(); }
        const outcomes = await Promise.allSettled([sold, closed]); spy.mockRestore();
        for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
        const saved = await prisma.shift.findFirstOrThrow({ where: { id: shift.id, tenantId: tenant.id } });
        expect(saved.status).toBe('CLOSED'); expect(saved.systemExpectedCash?.toFixed(2)).toBe(enabled ? '590.00' : '600.00');
        expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(1);
        expect((await prisma.product.findFirstOrThrow({ where: { id: product.id, tenantId: tenant.id } })).stock).toBe(0);
    }, 20000);
    it.each(['DISABLED', 'VIEWER'])('sesión cambiada a %s no cierra aun sin claim de rol en el contexto', async state => {
        assertDisposableDatabase();
        const tenant = await prisma.tenant.create({ data: { businessName: 'QA autorización caja', taxId: randomUUID() } });
        const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'QA operador', password: 'no-login-fixture', role: state === 'VIEWER' ? 'VIEWER' : 'OWNER', status: state === 'DISABLED' ? 'DISABLED' : 'ACTIVE' } });
        const shift = await prisma.shift.create({ data: { tenantId: tenant.id, userId: user.id, initialCash: '100', status: 'OPEN' } });
        await expect(closeLegacyShift(prisma as any, { tenantId: tenant.id, userId: user.id }, { shiftId: shift.id, declaredCash: '100' })).rejects.toMatchObject({ code: 'CLOSE_SHIFT_FORBIDDEN', httpStatus: 403 });
        expect((await prisma.shift.findFirstOrThrow({ where: { id: shift.id, tenantId: tenant.id } })).status).toBe('OPEN');
        expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
    });
});
