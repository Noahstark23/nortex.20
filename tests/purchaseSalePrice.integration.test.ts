import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/**
 * QA HTTP real del precio de venta capturado desde compras.
 *
 * Se omite en la suite normal porque requiere un backend aislado y MySQL 8
 * descartable apuntando a la misma DATABASE_URL. Ejecución:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3310 \
 *   DATABASE_URL=mysql://... \
 *   vitest run tests/purchaseSalePrice.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
    status: number;
    body: T;
};

let adminToken = '';
let managerToken = '';
let tenantId = '';
let adminUserId = '';
let supplierId = '';
let warehouseId = '';
let directProductId = '';
let linkedProductId = '';
let rollbackProductId = '';
let linkedRollbackProductId = '';

async function api<T = any>(
    path: string,
    token = adminToken,
    init: RequestInit = {},
): Promise<ApiResult<T>> {
    if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');

    const headers = new Headers(init.headers);
    if (init.body) headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);

    const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    let body: any = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    return { status: response.status, body };
}

function post<T = any>(path: string, body: unknown, token = adminToken): Promise<ApiResult<T>> {
    return api<T>(path, token, { method: 'POST', body: JSON.stringify(body) });
}

function expectStatus(result: ApiResult, expected: number): void {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function createProduct(name: string, sku: string): Promise<string> {
    const result = await post('/api/products', {
        name,
        sku,
        category: 'QA precio de venta en compra',
        price: 25,
        cost: 0,
        stock: 0,
        minStock: 0,
        unit: 'unidad',
        saleMode: 'COUNTED',
        quantityStep: '1',
        isPublished: false,
        requiresBatchTracking: false,
        ivaExento: false,
    });
    expectStatus(result, 200);
    return result.body.id;
}

async function getProduct(productId: string): Promise<any> {
    const result = await api<any[]>('/api/products');
    expectStatus(result, 200);
    const product = result.body.find((candidate) => candidate.id === productId);
    expect(product, `Producto QA ${productId} no encontrado`).toBeTruthy();
    return product;
}

async function priceAudit(productId: string): Promise<any | null> {
    const rows = await prisma.auditLog.findMany({
        where: { tenantId, action: 'PRICE_CHANGED' },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
    return rows.find((row) => {
        try {
            return JSON.parse(row.details ?? '{}').productId === productId;
        } catch {
            return false;
        }
    }) ?? null;
}

async function closeJuneFiscalPeriod(): Promise<void> {
    await prisma.fiscalPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year: 2037, month: 6 } },
        create: {
            tenantId,
            year: 2037,
            month: 6,
            status: 'CLOSED',
            closedBy: adminUserId,
            closedAt: new Date(),
        },
        update: {
            status: 'CLOSED',
            closedBy: adminUserId,
            closedAt: new Date(),
        },
    });
}

qaDescribe('QA integración: precio de venta desde compras', () => {
    beforeAll(async () => {
        const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const registration = await post('/api/auth/register', {
            companyName: `QA Precio Compra ${runId}`,
            email: `qa-precio-compra-${runId}@example.invalid`,
            password: `Qa-${runId}-Admin-Seguro9!`,
            type: 'MISCELANEA',
        }, '');
        expectStatus(registration, 200);
        adminToken = registration.body.token;
        tenantId = registration.body.tenant.id;
        adminUserId = registration.body.user.id;

        const invitation = await post('/api/team/invite', {
            email: `qa-precio-manager-${runId}@example.invalid`,
            role: 'MANAGER',
        });
        expectStatus(invitation, 200);
        const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
            name: 'Gerencia QA Precio Compra',
            password: `Qa-${runId}-Manager-Seguro9!`,
        }, '');
        expectStatus(accepted, 200);
        expect(accepted.body.user.role).toBe('MANAGER');
        managerToken = accepted.body.token;

        const supplier = await post('/api/suppliers', {
            name: `Proveedor QA Precio ${runId}`,
            category: 'QA',
        });
        expectStatus(supplier, 200);
        supplierId = supplier.body.id;

        const warehouses = await api('/api/warehouses');
        expectStatus(warehouses, 200);
        warehouseId = warehouses.body.data.find((warehouse: any) => warehouse.isDefault).id;

        directProductId = await createProduct('QA Precio compra directa', `QA-PRICE-DIRECT-${runId}`);
        linkedProductId = await createProduct('QA Precio factura OC', `QA-PRICE-PO-${runId}`);
        rollbackProductId = await createProduct('QA Precio rollback fiscal', `QA-PRICE-ROLLBACK-${runId}`);
        linkedRollbackProductId = await createProduct(
            'QA Precio rollback factura OC',
            `QA-PRICE-PO-ROLLBACK-${runId}`,
        );
    }, 120_000);

    afterAll(async () => {
        if (tenantId) {
            await prisma.fiscalPeriod.deleteMany({ where: { tenantId, year: 2037, month: 6 } });
        }
    });

    it('actualiza el precio en una compra directa, lo audita y omitirlo preserva el catálogo', async () => {
        const changedInvoice = `QA-DIRECT-PRICE-${Date.now()}`;
        const changed = await post('/api/purchases', {
            supplierId,
            warehouseId,
            invoiceNumber: changedInvoice,
            date: '2037-04-10',
            postingDate: '2037-04-10',
            paymentMethod: 'CREDIT',
            dueDate: '2037-05-10',
            items: [{
                productId: directProductId,
                quantity: '2',
                unitCost: '11.50',
                salePrice: '31.75',
            }],
        });
        expectStatus(changed, 200);
        expect(Number((await getProduct(directProductId)).price)).toBe(31.75);

        const audit = await priceAudit(directProductId);
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({
            productId: directProductId,
            priceBefore: '25',
            priceAfter: '31.75',
            source: 'PURCHASE',
            purchaseId: changed.body.purchase.id,
            purchaseOrderId: null,
            invoiceNumber: changedInvoice,
        });

        const auditCountBeforeOmission = await prisma.auditLog.count({
            where: { tenantId, action: 'PRICE_CHANGED' },
        });
        const omitted = await post('/api/purchases', {
            supplierId,
            warehouseId,
            invoiceNumber: `QA-DIRECT-OMIT-${Date.now()}`,
            date: '2037-04-11',
            postingDate: '2037-04-11',
            paymentMethod: 'CREDIT',
            dueDate: '2037-05-11',
            items: [{ productId: directProductId, quantity: '1', unitCost: '12.00' }],
        });
        expectStatus(omitted, 200);
        expect(Number((await getProduct(directProductId)).price)).toBe(31.75);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'PRICE_CHANGED' } }))
            .toBe(auditCountBeforeOmission);
    }, 120_000);

    it('rechaza a MANAGER antes de mutar compra, inventario o precio', async () => {
        const invoiceNumber = `QA-MANAGER-FORBIDDEN-${Date.now()}`;
        const before = await getProduct(directProductId);
        const denied = await post('/api/purchases', {
            supplierId,
            warehouseId,
            invoiceNumber,
            date: '2037-04-12',
            postingDate: '2037-04-12',
            paymentMethod: 'CREDIT',
            dueDate: '2037-05-12',
            items: [{
                productId: directProductId,
                quantity: '1',
                unitCost: '13.00',
                salePrice: '44.00',
            }],
        }, managerToken);

        expectStatus(denied, 403);
        expect(denied.body.code).toBe('PURCHASE_SALE_PRICE_FORBIDDEN');
        const after = await getProduct(directProductId);
        expect(Number(after.price)).toBe(Number(before.price));
        expect(Number(after.stock)).toBe(Number(before.stock));
        expect(Number(after.cost)).toBe(Number(before.cost));
        expect(await prisma.purchase.count({ where: { tenantId, supplierId, invoiceNumber } })).toBe(0);
    }, 120_000);

    it('actualiza el precio al facturar una OC sin volver a mover el inventario recibido', async () => {
        const order = await post('/api/purchase-orders', {
            supplierId,
            notes: 'QA precio comercial en factura de OC',
            expectedDate: '2037-04-20',
            items: [{ productId: linkedProductId, quantity: '3', unitCost: '10.00' }],
        });
        expectStatus(order, 201);
        const orderId = order.body.data.id;
        const orderItemId = order.body.data.items[0].id;

        const approved = await post(`/api/purchase-orders/${orderId}/approve`, {});
        expectStatus(approved, 200);
        const received = await post(`/api/purchase-orders/${orderId}/receive`, {
            clientEventId: crypto.randomUUID(),
            warehouseId,
            items: [{ itemId: orderItemId, quantityReceived: '3' }],
        });
        expectStatus(received, 200);
        expect(Number((await getProduct(linkedProductId)).stock)).toBe(3);

        const invoiceNumber = `QA-LINKED-PRICE-${Date.now()}`;
        const invoiced = await post('/api/purchases', {
            supplierId,
            purchaseOrderId: orderId,
            invoiceNumber,
            date: '2037-04-20',
            postingDate: '2037-04-20',
            paymentMethod: 'CREDIT',
            dueDate: '2037-05-20',
            items: [{
                productId: linkedProductId,
                purchaseOrderItemId: orderItemId,
                quantity: '3',
                unitCost: '10.00',
                salePrice: '57.25',
            }],
        });
        expectStatus(invoiced, 200);

        const product = await getProduct(linkedProductId);
        expect(Number(product.price)).toBe(57.25);
        expect(Number(product.stock)).toBe(3);
        const audit = await priceAudit(linkedProductId);
        expect(JSON.parse(audit.details)).toMatchObject({
            productId: linkedProductId,
            priceBefore: '25',
            priceAfter: '57.25',
            source: 'PURCHASE',
            purchaseId: invoiced.body.purchase.id,
            purchaseOrderId: orderId,
            invoiceNumber,
        });
    }, 120_000);

    it('revierte precio, stock, costo, compra, asiento y auditoría si el período está cerrado', async () => {
        const invoiceNumber = `QA-ROLLBACK-PRICE-${Date.now()}`;
        await closeJuneFiscalPeriod();

        const before = await getProduct(rollbackProductId);
        const purchaseCountBefore = await prisma.purchase.count({ where: { tenantId } });
        const journalCountBefore = await prisma.journalEntry.count({
            where: { tenantId, referenceType: 'PURCHASE' },
        });
        const auditCountBefore = await prisma.auditLog.count({
            where: { tenantId, action: 'PRICE_CHANGED' },
        });

        const rejected = await post('/api/purchases', {
            supplierId,
            warehouseId,
            invoiceNumber,
            date: '2037-06-15',
            postingDate: '2037-06-15',
            paymentMethod: 'CREDIT',
            dueDate: '2037-07-15',
            items: [{
                productId: rollbackProductId,
                quantity: '4',
                unitCost: '15.00',
                salePrice: '99.00',
            }],
        });
        expectStatus(rejected, 423);
        expect(String(rejected.body.error)).toContain('PERÍODO CERRADO');

        const after = await getProduct(rollbackProductId);
        expect(Number(after.price)).toBe(Number(before.price));
        expect(Number(after.stock)).toBe(Number(before.stock));
        expect(Number(after.cost)).toBe(Number(before.cost));
        expect(await prisma.purchase.count({ where: { tenantId } })).toBe(purchaseCountBefore);
        expect(await prisma.purchase.count({ where: { tenantId, supplierId, invoiceNumber } })).toBe(0);
        expect(await prisma.journalEntry.count({ where: { tenantId, referenceType: 'PURCHASE' } }))
            .toBe(journalCountBefore);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'PRICE_CHANGED' } }))
            .toBe(auditCountBefore);
        expect(await priceAudit(rollbackProductId)).toBeNull();
    }, 120_000);

    it('revierte también el UPDATE CASE de una factura OC si falla la contabilidad posterior', async () => {
        const order = await post('/api/purchase-orders', {
            supplierId,
            notes: 'QA rollback de precio comercial vinculado a OC',
            expectedDate: '2037-06-20',
            items: [{ productId: linkedRollbackProductId, quantity: '2', unitCost: '8.00' }],
        });
        expectStatus(order, 201);
        const orderId = order.body.data.id;
        const orderItemId = order.body.data.items[0].id;
        expectStatus(await post(`/api/purchase-orders/${orderId}/approve`, {}), 200);
        expectStatus(await post(`/api/purchase-orders/${orderId}/receive`, {
            clientEventId: crypto.randomUUID(),
            warehouseId,
            items: [{ itemId: orderItemId, quantityReceived: '2' }],
        }), 200);
        await closeJuneFiscalPeriod();

        const invoiceNumber = `QA-ROLLBACK-PO-PRICE-${Date.now()}`;
        const before = await getProduct(linkedRollbackProductId);
        expect(Number(before.stock)).toBe(2);
        const purchaseCountBefore = await prisma.purchase.count({ where: { tenantId } });
        const journalCountBefore = await prisma.journalEntry.count({
            where: { tenantId, referenceType: 'PURCHASE' },
        });
        const auditCountBefore = await prisma.auditLog.count({
            where: { tenantId, action: 'PRICE_CHANGED' },
        });

        const rejected = await post('/api/purchases', {
            supplierId,
            purchaseOrderId: orderId,
            invoiceNumber,
            date: '2037-06-20',
            postingDate: '2037-06-20',
            paymentMethod: 'CREDIT',
            dueDate: '2037-07-20',
            items: [{
                productId: linkedRollbackProductId,
                purchaseOrderItemId: orderItemId,
                quantity: '2',
                unitCost: '8.00',
                salePrice: '88.00',
            }],
        });
        expectStatus(rejected, 423);
        expect(String(rejected.body.error)).toContain('PERÍODO CERRADO');

        const after = await getProduct(linkedRollbackProductId);
        expect(Number(after.price)).toBe(Number(before.price));
        expect(Number(after.stock)).toBe(Number(before.stock));
        expect(Number(after.cost)).toBe(Number(before.cost));
        expect(await prisma.purchase.count({ where: { tenantId } })).toBe(purchaseCountBefore);
        expect(await prisma.purchase.count({ where: { tenantId, supplierId, invoiceNumber } })).toBe(0);
        expect(await prisma.journalEntry.count({ where: { tenantId, referenceType: 'PURCHASE' } }))
            .toBe(journalCountBefore);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'PRICE_CHANGED' } }))
            .toBe(auditCountBefore);
        expect(await priceAudit(linkedRollbackProductId)).toBeNull();
    }, 120_000);
});
