import { describe, expect, it, vi } from 'vitest';
import {
    applyLinkedPurchaseSalePriceIntents,
    buildPurchaseSalePriceChange,
    canSetPurchaseSalePrice,
    createPurchaseSalePriceAudits,
    hasPurchaseSalePriceIntent,
    PurchaseSalePriceError,
    resolvePurchaseSalePriceIntents,
} from '../backend/services/purchaseSalePriceService';

function fakeTx() {
    return {
        $queryRaw: vi.fn(),
        $executeRaw: vi.fn(),
        auditLog: { createMany: vi.fn() },
    } as any;
}

describe('intención de precio de venta desde compras', () => {
    it('distingue ausencia de intención y restringe el permiso a administración', () => {
        expect(hasPurchaseSalePriceIntent([
            { productId: 'a' },
            { productId: 'b', salePrice: null },
        ])).toBe(false);
        expect(hasPurchaseSalePriceIntent([{ productId: 'a', salePrice: '10' }])).toBe(true);

        expect(canSetPurchaseSalePrice('OWNER')).toBe(true);
        expect(canSetPurchaseSalePrice('ADMIN')).toBe(true);
        expect(canSetPurchaseSalePrice('SUPER_ADMIN')).toBe(true);
        expect(canSetPurchaseSalePrice('MANAGER')).toBe(false);
        expect(canSetPurchaseSalePrice('ACCOUNTANT')).toBe(false);
        expect(canSetPurchaseSalePrice(undefined)).toBe(false);
    });

    it('consolida por SKU con equivalencia Decimal y orden estable', () => {
        expect(resolvePurchaseSalePriceIntents([
            { productId: 'product-b', salePrice: '20.00' },
            { productId: 'product-a' },
            { productId: 'product-b', salePrice: '20' },
            { productId: 'product-a', salePrice: '10.50' },
        ])).toEqual([
            { productId: 'product-a', salePrice: '10.5' },
            { productId: 'product-b', salePrice: '20' },
        ]);
    });

    it('rechaza dos precios distintos para el mismo SKU con error 400 claro', () => {
        expect(() => resolvePurchaseSalePriceIntents([
            { productId: 'product-a', salePrice: '10' },
            { productId: 'product-a', salePrice: '11' },
        ])).toThrowError(expect.objectContaining({
            code: 'CONFLICTING_PURCHASE_SALE_PRICE',
            httpStatus: 400,
        }));
    });

    it.each(['0', '-1', 'Infinity', '1e400', '1e-1000', 'precio'])
        ('rechaza defensivamente un intent no persistible: %s', (salePrice) => {
            expect(() => resolvePurchaseSalePriceIntents([
                { productId: 'product-a', salePrice },
            ])).toThrow(PurchaseSalePriceError);
        });

    it('solo construye cambio cuando el valor bloqueado realmente difiere', () => {
        const intent = { productId: 'product-a', salePrice: '12.5' };
        expect(buildPurchaseSalePriceChange('product-a', 12.5, intent)).toBeNull();
        expect(buildPurchaseSalePriceChange('product-a', 10, intent)).toEqual({
            productId: 'product-a',
            priceBefore: '10',
            priceAfter: '12.5',
        });
        expect(buildPurchaseSalePriceChange('product-a', 10, undefined)).toBeNull();
    });
});

describe('precio de venta en factura vinculada a OC', () => {
    it('bloquea todos los SKU una vez, tenant-scoped y ordenados; actualiza solo cambios en un CASE', async () => {
        const tx = fakeTx();
        tx.$queryRaw.mockResolvedValue([
            { id: 'product-a', price: 10 },
            { id: 'product-b', price: 20 },
        ]);
        tx.$executeRaw.mockResolvedValue(1);

        const changes = await applyLinkedPurchaseSalePriceIntents({
            tx,
            tenantId: 'tenant-a',
            intents: [
                { productId: 'product-b', salePrice: '20.00' },
                { productId: 'product-a', salePrice: '12.50' },
            ],
        });

        expect(changes).toEqual([{
            productId: 'product-a',
            priceBefore: '10',
            priceAfter: '12.5',
        }]);
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

        const lockingQuery = tx.$queryRaw.mock.calls[0][0];
        expect(lockingQuery.sql).toContain('`tenantId` = ?');
        expect(lockingQuery.sql).toContain('ORDER BY id');
        expect(lockingQuery.sql).toContain('FOR UPDATE');
        expect(lockingQuery.values).toEqual(['tenant-a', 'product-a', 'product-b']);

        const updateQuery = tx.$executeRaw.mock.calls[0][0];
        expect(updateQuery.sql).toContain('UPDATE `Product`');
        expect(updateQuery.sql).toContain('CASE id');
        expect(updateQuery.sql).toContain('`tenantId` = ?');
        expect(updateQuery.values).toContain('tenant-a');
        expect(updateQuery.values).toContain('product-a');
        expect(updateQuery.values).not.toContain('product-b');
    });

    it('no escribe cuando todos los precios bloqueados ya coinciden', async () => {
        const tx = fakeTx();
        tx.$queryRaw.mockResolvedValue([{ id: 'product-a', price: 10 }]);

        await expect(applyLinkedPurchaseSalePriceIntents({
            tx,
            tenantId: 'tenant-a',
            intents: [{ productId: 'product-a', salePrice: '10.00' }],
        })).resolves.toEqual([]);
        expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('oculta productos ajenos al tenant y no intenta ninguna escritura parcial', async () => {
        const tx = fakeTx();
        tx.$queryRaw.mockResolvedValue([{ id: 'product-a', price: 10 }]);

        await expect(applyLinkedPurchaseSalePriceIntents({
            tx,
            tenantId: 'tenant-a',
            intents: [
                { productId: 'product-a', salePrice: '11' },
                { productId: 'foreign-product', salePrice: '30' },
            ],
        })).rejects.toMatchObject({
            code: 'PURCHASE_PRODUCT_NOT_FOUND',
            httpStatus: 404,
        });
        expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('aborta si la escritura no confirma exactamente todos los SKU cambiados', async () => {
        const tx = fakeTx();
        tx.$queryRaw.mockResolvedValue([
            { id: 'product-a', price: 10 },
            { id: 'product-b', price: 20 },
        ]);
        tx.$executeRaw.mockResolvedValue(1);

        await expect(applyLinkedPurchaseSalePriceIntents({
            tx,
            tenantId: 'tenant-a',
            intents: [
                { productId: 'product-a', salePrice: '11' },
                { productId: 'product-b', salePrice: '21' },
            ],
        })).rejects.toMatchObject({ code: 'PURCHASE_PRICE_UPDATE_FAILED' });
    });
});

describe('auditoría reconstructible del cambio de precio', () => {
    it('usa createMany con source PURCHASE, compra y before/after por SKU', async () => {
        const tx = fakeTx();
        tx.auditLog.createMany.mockResolvedValue({ count: 2 });

        await createPurchaseSalePriceAudits({
            tx,
            tenantId: 'tenant-a',
            userId: 'user-owner',
            purchaseId: 'purchase-1',
            purchaseOrderId: 'po-1',
            invoiceNumber: 'FAC-100',
            changes: [
                { productId: 'a', priceBefore: '10', priceAfter: '12' },
                { productId: 'b', priceBefore: '20', priceAfter: '25' },
            ],
        });

        expect(tx.auditLog.createMany).toHaveBeenCalledTimes(1);
        const rows = tx.auditLog.createMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            tenantId: 'tenant-a',
            userId: 'user-owner',
            action: 'PRICE_CHANGED',
        });
        expect(JSON.parse(rows[0].details)).toEqual({
            productId: 'a',
            priceBefore: '10',
            priceAfter: '12',
            source: 'PURCHASE',
            purchaseId: 'purchase-1',
            purchaseOrderId: 'po-1',
            invoiceNumber: 'FAC-100',
        });
    });

    it('no crea auditoría cuando no hubo cambio real', async () => {
        const tx = fakeTx();
        await createPurchaseSalePriceAudits({
            tx,
            tenantId: 'tenant-a',
            userId: 'user-owner',
            purchaseId: 'purchase-1',
            purchaseOrderId: null,
            invoiceNumber: 'FAC-100',
            changes: [],
        });
        expect(tx.auditLog.createMany).not.toHaveBeenCalled();
    });
});
