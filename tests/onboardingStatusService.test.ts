import { describe, expect, it, vi } from 'vitest';
import { createOnboardingStatusService, type OnboardingDatabase } from '../backend/services/onboardingStatusService';

vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));

type Shop = {
    type?: string; businessName?: string; taxId?: string; capabilities?: string[];
    products?: number; measured?: number; packed?: number; batches?: number;
    customers?: number; employees?: number; loans?: number;
};
type Sale = { id?: string; tenantId: string; status: string; createdAt: Date };

function database(shops: Record<string, Shop>, sales: Sale[] = []) {
    const matchingSales = ({ where }: { where: { tenantId: string; status?: { notIn: string[] } } }) =>
        sales.filter(sale => sale.tenantId === where.tenantId && !where.status?.notIn.includes(sale.status));
    const db = {
        tenant: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
            const shop = shops[where.id];
            return shop ? { type: shop.type ?? 'FERRETERIA', businessName: shop.businessName ?? 'Ferretería Norte', taxId: shop.taxId ?? 'TAX-1234567890' } : null;
        }) },
        tenantCapability: { findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) =>
            (shops[where.tenantId]?.capabilities ?? []).map(code => ({ code }))) },
        product: { count: vi.fn(async ({ where }: { where: { tenantId: string; saleMode?: string; packUnit?: unknown } }) => {
            const shop = shops[where.tenantId];
            return (where.saleMode ? shop?.measured : where.packUnit ? shop?.packed : shop?.products) ?? 0;
        }) },
        sale: {
            count: vi.fn(async (args: Parameters<typeof matchingSales>[0]) => matchingSales(args).length),
            findFirst: vi.fn(async (args: Parameters<typeof matchingSales>[0] & { orderBy: Array<{ createdAt?: string; id?: string }> }) => {
                const direction = args.orderBy[0].createdAt === 'asc' ? 1 : -1;
                const latest = matchingSales(args).sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime() || (a.id ?? '').localeCompare(b.id ?? '')))[0];
                return latest ? { id: latest.id ?? 'fixture-sale', createdAt: latest.createdAt } : null;
            }),
        },
        customer: { count: vi.fn(async ({ where }: { where: { tenantId: string } }) => shops[where.tenantId]?.customers ?? 0) },
        employee: { count: vi.fn(async ({ where }: { where: { tenantId: string } }) => shops[where.tenantId]?.employees ?? 0) },
        loan: { count: vi.fn(async ({ where }: { where: { lenderId: string } }) => shops[where.lenderId]?.loans ?? 0) },
        productBatch: { count: vi.fn(async ({ where }: { where: { tenantId: string } }) => shops[where.tenantId]?.batches ?? 0) },
    };
    return { db, service: createOnboardingStatusService(db as unknown as OnboardingDatabase) };
}

describe('onboarding: progreso derivado y aislado por negocio', () => {
    it('excluye borradores y no confunde otro día UTC con retorno en otro día Managua', async () => {
        const { service } = database({ a: {} }, [
            { id: 'draft', tenantId: 'a', status: 'DRAFT', createdAt: new Date('2026-08-01T12:00:00Z') },
            { id: 'first', tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-04T23:30:00Z') },
            { id: 'last', tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-05T05:59:59Z') },
        ]);
        expect((await service.getStatus('a'))?.salesProgress).toMatchObject({
            confirmedSales: 2, firstSaleId: 'first', lastSaleId: 'last',
            firstSaleBusinessDate: '2026-09-04', lastSaleBusinessDate: '2026-09-04',
            returnedOnAnotherBusinessDate: false,
        });
    });

    it('repetir lectura no duplica hitos y ordena empates por id; retorno comienza a medianoche Managua', async () => {
        const { service } = database({ a: {} }, [
            { id: 'sale-b', tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-04T15:00:00Z') },
            { id: 'sale-a', tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-04T15:00:00Z') },
            { id: 'sale-c', tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-05T06:00:00Z') },
            { id: 'other', tenantId: 'b', status: 'COMPLETED', createdAt: new Date('2026-08-01T12:00:00Z') },
        ]);
        const first = (await service.getStatus('a'))?.salesProgress;
        expect(first).toMatchObject({ confirmedSales: 3, firstSaleId: 'sale-a', lastSaleId: 'sale-c',
            firstSaleBusinessDate: '2026-09-04', lastSaleBusinessDate: '2026-09-05', returnedOnAnotherBusinessDate: true });
        expect((await service.getStatus('a'))?.salesProgress).toEqual(first);
    });

    it('conserva los tres pasos retail y representa cero ventas sin inventar fechas', async () => {
        const { service } = database({ a: {} });
        expect(await service.getStatus('a')).toEqual({
            type: 'FERRETERIA', businessName: 'Ferretería Norte', completed: 0, total: 3, allDone: false,
            steps: [
                { key: 'product', label: 'Agregá tu primer producto', done: false, href: '/app/inventory', cta: 'Configurar' },
                { key: 'sale', label: 'Hacé tu primera venta', done: false, href: '/app/pos?first_sale=1', cta: 'Vender' },
                { key: 'customer', label: 'Registrá un cliente', done: false, href: '/app/clients', cta: 'Agregar' },
            ],
            salesProgress: { confirmedSales: 0, lastSaleAt: null, firstSaleId: null, lastSaleId: null, firstSaleAt: null, firstSaleBusinessDate: null, lastSaleBusinessDate: null, returnedOnAnotherBusinessDate: false },
        });
    });

    it('excluye CANCELLED y VOIDED del conteo y última fecha, conservando ventas a crédito', async () => {
        const { service, db } = database({ a: { products: 2, customers: 1 } }, [
            { tenantId: 'a', status: 'COMPLETED', createdAt: new Date('2026-09-01T15:00:00Z') },
            { tenantId: 'a', status: 'CREDIT_PENDING', createdAt: new Date('2026-09-02T15:00:00Z') },
            { tenantId: 'a', status: 'CANCELLED', createdAt: new Date('2026-09-03T15:00:00Z') },
            { tenantId: 'a', status: 'VOIDED', createdAt: new Date('2026-09-04T15:00:00Z') },
        ]);
        const result = await service.getStatus('a');
        expect(result).toMatchObject({ completed: 3, allDone: true, salesProgress: { confirmedSales: 2, lastSaleAt: '2026-09-02T15:00:00.000Z' } });
        expect(result?.steps.find(step => step.key === 'sale')?.done).toBe(true);
        expect(db.sale.findFirst).toHaveBeenCalledWith({
            where: { tenantId: 'a', status: { notIn: ['VOIDED', 'CANCELLED', 'DRAFT'] } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, createdAt: true },
        });
    });

    it('un negocio con solo anulaciones no completa la primera venta', async () => {
        const { service } = database({ a: {} }, [
            { tenantId: 'a', status: 'VOIDED', createdAt: new Date('2026-09-01T15:00:00Z') },
            { tenantId: 'a', status: 'CANCELLED', createdAt: new Date('2026-09-02T15:00:00Z') },
        ]);
        const result = await service.getStatus('a');
        expect(result?.steps.find(step => step.key === 'sale')?.done).toBe(false);
        expect(result?.salesProgress).toMatchObject({ confirmedSales: 0, lastSaleAt: null, firstSaleAt: null, returnedOnAnotherBusinessDate: false });
    });

    it('separa conteos y última venta entre dos tenants', async () => {
        const { service, db } = database({ a: { customers: 1 }, b: { products: 8, customers: 9 } }, [
            { tenantId: 'b', status: 'COMPLETED', createdAt: new Date('2026-09-04T15:00:00Z') },
        ]);
        const [a, b] = await Promise.all([service.getStatus('a'), service.getStatus('b')]);
        expect(a).toMatchObject({ completed: 1, salesProgress: { confirmedSales: 0, lastSaleAt: null } });
        expect(b).toMatchObject({ completed: 3, salesProgress: { confirmedSales: 1, lastSaleAt: '2026-09-04T15:00:00.000Z' } });
        expect(db.product.count).toHaveBeenCalledWith({ where: { tenantId: 'a' } });
        expect(db.customer.count).toHaveBeenCalledWith({ where: { tenantId: 'b' } });
    });

    it('conserva pasos por capacidades y no sustituye producto medido por un producto común', async () => {
        const { service, db } = database({ a: { capabilities: ['ALIMENTO_ANIMAL', 'PERECEDEROS'], products: 5, measured: 0, packed: 1, batches: 2 } });
        const result = await service.getStatus('a');
        expect(result?.steps.map(step => [step.key, step.done])).toEqual([
            ['product', false], ['pack', true], ['batch', true], ['sale', false], ['customer', false],
        ]);
        expect(db.product.count).toHaveBeenCalledWith({ where: { tenantId: 'a', saleMode: 'MEASURED' } });
        expect(db.product.count).toHaveBeenCalledWith({ where: { tenantId: 'a', packUnit: { not: null }, packSize: { gt: 0 } } });
        expect(db.productBatch.count).toHaveBeenCalledWith({ where: { tenantId: 'a' } });
    });

    it.each([
        ['CARNICERIA_POLLERIA', ['product', 'sale', 'customer']],
        ['AGROPECUARIA', ['product', 'pack', 'sale', 'customer']],
    ])('preserva los pasos por giro %s sin inventar capacidades', async (type, keys) => {
        const { service } = database({ a: { type } });
        expect((await service.getStatus('a'))?.steps.map(step => step.key)).toEqual(keys);
    });

    it('LENDER conserva fiscal/cliente/préstamo/equipo y no consulta ventas retail', async () => {
        const { service, db } = database({ a: { type: 'LENDER', taxId: 'J0310000000001', customers: 1, loans: 2, employees: 2 } });
        const result = await service.getStatus('a');
        expect(result?.steps.map(step => [step.key, step.done])).toEqual([
            ['fiscal', true], ['customer', true], ['loan', true], ['team', true],
        ]);
        expect(result).toMatchObject({ total: 4, completed: 4, allDone: true });
        expect(result).not.toHaveProperty('salesProgress');
        expect(db.loan.count).toHaveBeenCalledWith({ where: { lenderId: 'a' } });
        expect(db.sale.count).not.toHaveBeenCalled();
        expect(db.sale.findFirst).not.toHaveBeenCalled();
        expect(db.tenantCapability.findMany).not.toHaveBeenCalled();
    });

    it('el RUC placeholder y el empleado del dueño no completan fiscal/equipo', async () => {
        const { service } = database({ a: { type: 'LENDER', employees: 1 } });
        const result = await service.getStatus('a');
        expect(result?.steps.find(step => step.key === 'fiscal')?.done).toBe(false);
        expect(result?.steps.find(step => step.key === 'team')?.done).toBe(false);
    });

    it('tenant inexistente o contexto vacío no dispara conteos sin alcance', async () => {
        const { service, db } = database({});
        expect(await service.getStatus('')).toBeNull();
        expect(await service.getStatus('   ')).toBeNull();
        expect(db.tenant.findUnique).not.toHaveBeenCalled();
        expect(await service.getStatus('missing')).toBeNull();
        expect(db.product.count).not.toHaveBeenCalled();
        expect(db.sale.count).not.toHaveBeenCalled();
    });
});
