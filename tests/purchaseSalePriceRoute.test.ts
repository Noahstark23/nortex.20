import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const server = fs.readFileSync(path.resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const routeStart = server.indexOf("app.post('/api/purchases'");
const routeEnd = server.indexOf('// POST /api/purchases/:id/pay', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error('No se encontró POST /api/purchases');
const route = server.slice(routeStart, routeEnd);

describe('POST /api/purchases — autoridad y atomicidad de salePrice', () => {
    it('rechaza el cambio sin rol privilegiado antes de abrir la transacción', () => {
        const guard = route.indexOf('hasPurchaseSalePriceIntent(items)');
        const forbidden = route.indexOf("code: 'PURCHASE_SALE_PRICE_FORBIDDEN'", guard);
        const transaction = route.indexOf('prisma.$transaction');

        expect(guard).toBeGreaterThan(-1);
        expect(route.slice(guard, forbidden)).toContain('!canSetPurchaseSalePrice(authReq.role)');
        expect(forbidden).toBeGreaterThan(guard);
        expect(forbidden).toBeLessThan(transaction);
    });

    it('resuelve duplicados dentro de la tx y valida el catálogo por tenant', () => {
        const transaction = route.indexOf('prisma.$transaction');
        const resolve = route.indexOf('resolvePurchaseSalePriceIntents(items)');
        const products = route.indexOf('const ownedProducts');
        const tenantScope = route.indexOf('tenantId: authReq.tenantId!', products);

        expect(resolve).toBeGreaterThan(transaction);
        expect(products).toBeGreaterThan(resolve);
        expect(tenantScope).toBeGreaterThan(products);
    });

    it('en compra directa reutiliza Product lock antes de actualizar costo/precio', () => {
        const inventoryLoop = route.indexOf('for (const item of inventoryMutationItems)');
        const stockLock = route.indexOf('await applyStockDelta(tx', inventoryLoop);
        const lockedSnapshot = route.indexOf('SELECT cost, price FROM \\`Product\\`', stockLock);
        const change = route.indexOf('buildPurchaseSalePriceChange(', lockedSnapshot);
        const update = route.indexOf('await tx.product.update({', change);
        const updateEnd = route.indexOf('directSalePriceProductsProcessed.add', update);

        expect(inventoryLoop).toBeGreaterThan(-1);
        expect(stockLock).toBeGreaterThan(inventoryLoop);
        expect(lockedSnapshot).toBeGreaterThan(stockLock);
        expect(change).toBeGreaterThan(lockedSnapshot);
        expect(update).toBeGreaterThan(change);
        expect(route.slice(update, updateEnd)).toContain('tenantId: authReq.tenantId!');
        expect(route.slice(update, updateEnd)).toContain('...(priceChange');
    });

    it('aplica también la intención de una OC antes de cualquier lock de caja', () => {
        const linked = route.indexOf('applyLinkedPurchaseSalePriceIntents({');
        const shift = route.indexOf('registrarSalidaDeCajaPorCompra(tx');

        expect(linked).toBeGreaterThan(-1);
        expect(shift).toBeGreaterThan(linked);
    });

    it('audita before/after y resumen PURCHASE_CREATED en la misma callback ACID', () => {
        const transaction = route.indexOf('prisma.$transaction');
        const priceAudit = route.indexOf('createPurchaseSalePriceAudits({');
        const purchaseAudit = route.indexOf("action: 'PURCHASE_CREATED'", priceAudit);
        const transactionClose = route.indexOf('res.json({', purchaseAudit);

        expect(priceAudit).toBeGreaterThan(transaction);
        expect(route.slice(priceAudit, purchaseAudit)).toContain('purchaseId: purchase.id');
        expect(purchaseAudit).toBeGreaterThan(priceAudit);
        expect(route.slice(purchaseAudit, transactionClose)).toContain('priceChanges');
        expect(transactionClose).toBeGreaterThan(purchaseAudit);
    });

    it('mapea conflictos y fallos de precio a su HTTP tipado', () => {
        expect(route).toContain('error instanceof PurchaseSalePriceError');
        expect(route).toContain('res.status(error.httpStatus).json({ error: error.message, code: error.code })');
    });
});
