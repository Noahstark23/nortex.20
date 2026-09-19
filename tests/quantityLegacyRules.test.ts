import { describe, expect, it, vi } from 'vitest';
import { resolvePurchaseLine, purchaseQuantityInputStep } from '../utils/purchasePackaging';
import { validateStockTransferQuantity } from '../utils/stockTransferQuantity';
import { normalizeSaleItems } from '../backend/services/saleItemMeasurementService';
import { effectivePosSaleMode, effectivePosQuantityStep } from '../utils/posActivation';
import { exactPedidoItemQuantity, resolvePublicOrderItems } from '../backend/services/publicOrderItemService';
import { CreateProductSchema } from '../backend/validation/schemas';

const product = (patch: Record<string, unknown> = {}) => ({
    id: 'product-a', name: 'Producto sintético', unit: 'unidad',
    saleMode: null, quantityStep: null, price: 12, cost: 8, ivaExento: false,
    wholesalePrice: null, wholesaleMinQty: null,
    packUnit: null, packSize: null, packPrice: null, requiresBatchTracking: false,
    ...patch,
});

const normalize = (authority: ReturnType<typeof product>, quantity: string, quote?: Record<string, unknown>) => {
    const db = {
        product: { findMany: vi.fn(async () => [authority]) },
        quotationItem: { findMany: vi.fn(async () => quote ? [quote] : []) },
    } as any;
    return normalizeSaleItems(db, {
        tenantId: 'tenant-a', userId: 'user-a', wholesaleCustomer: false,
        allowRevokedScaleVersionForReplay: false,
        items: [{ id: authority.id, quantity, ...(quote ? { quotationItemId: 'quote-item-a' } : {}) }],
    });
};

describe('cantidades heredadas coherentes entre compra, traslado y venta', () => {
    it.each(['stock', 'minStock', 'reorderPoint', 'maxStock', 'wholesaleMinQty', 'packSize'])(
        'alta de caja sin reglas rechaza %s fraccionario con error del campo', (field) => {
            const result = CreateProductSchema.safeParse({
                name: 'Caja', sku: 'CAJA-1', price: '12', unit: 'caja',
                ...(field === 'packSize' ? { packUnit: 'fardo' } : {}),
                [field]: '1.5',
            });
            expect(result.success).toBe(false);
            if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: [field], message: 'Los productos contables requieren cantidades y pasos enteros' }),
            ]));
        },
    );

    it('el alta sin unidad aplica el default unidad antes de validar stock', () => {
        expect(CreateProductSchema.safeParse({ name: 'Pieza', sku: 'P-1', price: '12', stock: '1.5' }).success).toBe(false);
    });

    it.each([
        { unit: 'kg' },
        { unit: 'caja', saleMode: 'MEASURED' },
        { unit: 'caja', quantityStep: '0.25' },
        { unit: 'unidad especial' },
    ])('el alta conserva fracción con contrato medido: %o', (config) => {
        expect(CreateProductSchema.safeParse({ name: 'Medido', sku: 'M-1', price: '12', stock: '1.5', ...config }).success).toBe(true);
    });

    it.each(['unidad', 'unidades', 'caja', 'cajas'])('POS y pedido público comparten enteros para %s', (unit) => {
        const authority = { ...product({ unit }), tenantId: 'tenant-a', isPublished: true };
        expect.soft(effectivePosSaleMode(authority)).toBe('COUNTED');
        expect.soft(effectivePosQuantityStep(authority)).toBe(1);
        expect(() => resolvePublicOrderItems('tenant-a', [{ productId: authority.id, quantity: '1.5' }], [authority]))
            .toThrow(/contables/);
        const [line] = resolvePublicOrderItems('tenant-a', [{ productId: authority.id, quantity: '2' }], [authority]);
        expect(line.quantityExact.toString()).toBe('2');
        expect(line.saleMode).toBe('COUNTED');
        expect(line.quantityStep).toBe('1');
    });

    it.each([
        { unit: 'kg', saleMode: null, quantityStep: null },
        { unit: 'caja', saleMode: 'MEASURED', quantityStep: null },
        { unit: 'cajas', saleMode: null, quantityStep: 0.25 },
    ] as const)('POS/pedido respetan medidos y paso explícito: %o', (config) => {
        const authority = { ...product(), ...config, tenantId: 'tenant-a', isPublished: true };
        expect(effectivePosSaleMode(authority)).toBe('MEASURED');
        expect(effectivePosQuantityStep(authority)).toBe(config.quantityStep ?? 0.0001);
        const [line] = resolvePublicOrderItems('tenant-a', [{ productId: authority.id, quantity: '1.25' }], [authority]);
        expect(line.quantityExact.toString()).toBe('1.25');
        expect(line.saleMode).toBe('MEASURED');
    });

    it('el lector de un pedido histórico conserva una fracción ya aceptada', () => {
        expect(exactPedidoItemQuantity({ cantidad: 2, cantidadExact: '1.5' }).toString()).toBe('1.5');
    });

    it.each(['unidad', 'unidades', 'caja', 'cajas', ' CAJAS '])(
        '%s sin configuración acepta enteros y rechaza fracciones en todos los flujos nuevos', async (unit) => {
            const authority = product({ unit });
            expect.soft(() => resolvePurchaseLine({ quantity: '1.5', unitCost: '8' }, authority))
                .toThrow(/contables/);
            expect.soft(() => validateStockTransferQuantity('1.5', authority)).toThrow(/contables/);
            await expect.soft(normalize(authority, '1.5')).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
            expect(resolvePurchaseLine({ quantity: '2', unitCost: '8' }, authority).baseQuantity.toString()).toBe('2');
            expect(validateStockTransferQuantity('2', authority).toString()).toBe('2');
            const [sale] = await normalize(authority, '2');
            expect(sale.quantity.toString()).toBe('2');
            expect(sale.saleModeAtSale).toBe('COUNTED');
            expect(sale.quantityStepAtSale).toBe('1');
            expect(purchaseQuantityInputStep(authority, 'BASE')).toBe('1');
        },
    );

    it.each(['kg', 'lb', 'litro', 'metro', 'unidad personalizada', '', null])(
        '%s conserva el fallback fraccionario de compra/traslado si no es una unidad contable conocida', (unit) => {
            const authority = { unit, saleMode: null, quantityStep: null };
            expect(resolvePurchaseLine({ quantity: '1.2345', unitCost: '8' }, authority).baseQuantity.toString()).toBe('1.2345');
            expect(validateStockTransferQuantity('1.2345', authority).toString()).toBe('1.2345');
            expect(purchaseQuantityInputStep(authority, 'BASE')).toBe('0.0001');
        },
    );

    it.each(['kg', 'litro', 'metro', 'unidad personalizada'])(
        '%s conserva venta fraccionaria y snapshot MEASURED', async (unit) => {
            const [sale] = await normalize(product({ unit }), '1.2345');
            expect(sale.quantity.toString()).toBe('1.2345');
            expect(sale.saleModeAtSale).toBe('MEASURED');
            expect(sale.quantityStepAtSale).toBe('0.0001');
        },
    );

    it.each([
        { saleMode: 'MEASURED', quantityStep: null },
        { saleMode: 'MEASURED', quantityStep: '0.25' },
        { saleMode: null, quantityStep: '0.25' },
    ])('respeta configuración explícita aunque la unidad sea cajas: %o', async (config) => {
        const authority = product({ unit: 'cajas', ...config });
        expect(resolvePurchaseLine({ quantity: '1.25', unitCost: '8' }, authority).baseQuantity.toString()).toBe('1.25');
        expect(validateStockTransferQuantity('1.25', authority).toString()).toBe('1.25');
        const [sale] = await normalize(authority, '1.25');
        expect(sale.quantity.toString()).toBe('1.25');
        expect(sale.saleModeAtSale).toBe('MEASURED');
        expect(sale.quantityStepAtSale).toBe(config.quantityStep ?? '0.0001');
    });

    it('rechaza un paso incompatible sin redondear ni reemplazar la cantidad', async () => {
        const authority = product({ unit: 'cajas', quantityStep: '0.25' });
        expect(() => resolvePurchaseLine({ quantity: '1.2', unitCost: '8' }, authority)).toThrow(/múltiplo exacto/);
        expect(() => validateStockTransferQuantity('1.2', authority)).toThrow(/múltiplo exacto/);
        await expect(normalize(authority, '1.2')).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('convierte medio empaque a seis unidades base sin confundir empaque con unidad base', async () => {
        const authority = product({ packUnit: 'caja', packSize: 12 });
        const line = resolvePurchaseLine({ quantity: '0.5', unitCost: '96', purchaseUnit: 'PACK' }, authority);
        expect(line.baseQuantity.toString()).toBe('6');
        expect(line.baseUnitCost.toString()).toBe('8');
        expect(line.lineTotal.toFixed(2)).toBe('48.00');
    });

    it('conserva una cotización heredada fraccionaria ya emitida aunque la unidad sea caja', async () => {
        const quote = {
            id: 'quote-item-a', quotationId: 'quote-a', productId: 'product-a',
            quantity: 1.5, quantityExact: null, price: 12, unitPriceExact: null,
            name: 'Caja cotizada', unitAtQuote: 'caja', saleModeAtQuote: null,
            quantityStepAtQuote: null, presentationAtQuote: null,
            presentationQuantityAtQuote: null, ivaExentoAtQuote: null,
            quotation: { status: 'SENT', expiresAt: new Date('2099-01-01') },
        };
        const [sale] = await normalize(product({ unit: 'caja' }), '1.5', quote);
        expect(sale.quantity.toString()).toBe('1.5');
        expect(sale.saleModeAtSale).toBe('MEASURED');
        expect(sale.quantityStepAtSale).toBe('0.0001');
        expect(sale.unitAtSale).toBe('caja');
        expect(sale.quotationItemId).toBe('quote-item-a');
    });
});
