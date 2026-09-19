import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advancePurchaseIntake } from '../backend/services/assistant/purchaseIntake';

// El servicio y su autorización son reales; sólo el límite de persistencia es sintético.
vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));

const principal = { tenantId: 'catalog-tenant', userId: 'catalog-user', role: 'OWNER' };
function harness() {
    const products = [
        { id: 'product-1', tenantId: principal.tenantId, name: 'Cemento Alfa', sku: 'CEM-A', unit: 'bolsa', packUnit: null, packSize: null, requiresBatchTracking: false },
        { id: 'product-2', tenantId: principal.tenantId, name: 'Cemento Beta', sku: 'CEM-B', unit: 'bolsa', packUnit: 'pallet', packSize: 20, requiresBatchTracking: false },
    ];
    const suppliers = [
        { id: 'supplier-1', tenantId: principal.tenantId, name: 'Cementos Alfa', ruc: 'RUC-SINTETICO-A', address: 'Dirección sintética norte', status: 'ACTIVE', deletedAt: null },
        { id: 'supplier-2', tenantId: principal.tenantId, name: 'Cementos Alfa', ruc: 'RUC-SINTETICO-B', address: 'Dirección sintética sur', status: 'ACTIVE', deletedAt: null },
    ];
    const scoped = <T extends { id: string; tenantId: string; name: string }>(rows: T[], where: {
        id?: string; tenantId: string; name?: string | { contains: string };
    }) => rows.filter(row => row.tenantId === where.tenantId && (!where.id || row.id === where.id)
        && (!where.name || (typeof where.name === 'string' ? row.name === where.name
            : row.name.toLowerCase().includes(where.name.contains.toLowerCase()))));
    const visibleText = (value: string) => value.replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mocks = {
        // Sólo devuelve pares sintéticos de identidad; no ejecuta ni acredita el SQL/MySQL.
        $queryRaw: vi.fn(async (query: Prisma.Sql) => {
            const [tenantId, , name, , discriminator, , address] = query.values;
            if (query.sql.includes('FROM Product p')) return products.filter(row => row.tenantId === tenantId
                && visibleText(row.name) === name && visibleText(row.sku) === discriminator);
            if (query.sql.includes('FROM Supplier p')) return suppliers.filter(row => row.tenantId === tenantId
                && row.status === 'ACTIVE' && row.deletedAt === null && visibleText(row.name) === name
                && visibleText(row.ruc) === discriminator && visibleText(row.address) === address);
            throw new Error('Consulta sintética inesperada');
        }),
        user: { findFirst: vi.fn(async ({ where }) => where.id === principal.userId && where.tenantId === principal.tenantId
            ? { id: principal.userId, role: principal.role, status: 'ACTIVE' } : null) },
        assistantTenantConfig: { findUnique: vi.fn(async ({ where }) => where.tenantId === principal.tenantId ? { enabled: true } : null) },
        product: {
            findMany: vi.fn(async ({ where }) => scoped(products, where)),
            findFirst: vi.fn(async ({ where }) => scoped(products, where)[0] ?? null),
        },
        supplier: {
            findMany: vi.fn(async ({ where }) => scoped(suppliers, where).filter(row => row.status === 'ACTIVE' && row.deletedAt === null)),
            findFirst: vi.fn(async ({ where }) => scoped(suppliers, where).find(row => row.status === where.status && row.deletedAt === null) ?? null),
        },
        warehouse: { findMany: vi.fn(async () => []) },
    };
    let metadata: unknown = null;
    const say = async (text: string) => {
        const turn = await advancePurchaseIntake({ principal, text, requestId: randomUUID(), metadata }, mocks as unknown as PrismaClient);
        metadata = structuredClone(turn.metadata);
        return turn;
    };
    return { mocks, products, suppliers, say };
}

async function supplierQuestion(h: ReturnType<typeof harness>) {
    await h.say('Compré 50 bolsas de cemento');
    await h.say('Completar por aquí');
    const product = await h.say('opción 2');
    expect(product.state?.facts.items[0]).toMatchObject({ productId: 'product-2', productName: 'Cemento Beta', quantity: '50' });
    expect(product.state?.facts.items[0].purchaseUnit).toBeUndefined();
    expect(product.state?.facts.items[0].unitCost).toBeUndefined();
    await h.say('1');
    await h.say('C$ 230');
    return h.say('Cementos Alfa');
}

beforeEach(() => {
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No se permite red en esta reproducción'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('H01-1: identidad elegida en captura real, sin registrar compras', () => {
    it('un nombre homónimo no elige el primer proveedor sin aclaración', async () => {
        const h = harness();
        const offered = await supplierQuestion(h);
        expect(offered.state?.pendingQuestion?.candidates?.map(item => item.id)).toEqual(['supplier-1', 'supplier-2']);
        const answer = await h.say('Cementos Alfa');
        expect(answer.state?.facts.supplierId).toBeUndefined();
        expect(answer.state?.pendingQuestion?.field).toBe('supplierId');
        expect(answer.state?.pendingQuestion?.candidates?.map(item => item.id)).toEqual(['supplier-1', 'supplier-2']);
        expect(h.mocks.supplier.findFirst).not.toHaveBeenCalled();
        expect(answer.draft).toBeUndefined();
        expect(answer.state?.facts.items[0].quantity).toBe('50');
    });

    it('opción 2 de producto y opción 1 de proveedor conservan sus IDs y los faltantes', async () => {
        const h = harness(); await supplierQuestion(h);
        const answer = await h.say('opción 1');
        expect(answer.state?.facts).toMatchObject({ supplierId: 'supplier-1', supplierName: 'Cementos Alfa',
            items: [{ productId: 'product-2', productName: 'Cemento Beta', quantity: '50', purchaseUnit: 'BASE', unitCost: '230' }] });
        expect(h.mocks.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'product-2', tenantId: principal.tenantId } }));
        expect(h.mocks.supplier.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'supplier-1', tenantId: principal.tenantId, status: 'ACTIVE', deletedAt: null } }));
        for (const key of ['invoiceNumber', 'date', 'documentTotal', 'paymentMethod', 'receivedConfirmed', 'paymentConfirmed'] as const) {
            expect(answer.state?.facts[key]).toBeUndefined();
        }
        expect(answer.draft).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('una opción de proveedor que dejó de estar activa no se reemplaza por su homónimo', async () => {
        const h = harness(); await supplierQuestion(h);
        h.suppliers[0].status = 'INACTIVE';
        const answer = await h.say('opción 1');
        expect(answer.state?.facts.supplierId).toBeUndefined();
        expect(answer.state?.pendingQuestion?.field).toBe('supplierId');
        expect(answer.state?.facts.items[0]).toMatchObject({ productId: 'product-2', quantity: '50', unitCost: '230' });
        expect(answer.draft).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });
});
