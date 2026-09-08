import { describe, expect, it, vi } from 'vitest';
import { normalizeSaleItems, effectiveSaleModeAndStep } from '../backend/services/saleItemMeasurementService';
import { effectivePosSaleMode, effectivePosQuantityStep } from '../utils/posActivation';
import { resolveQuotationItems } from '../backend/lib/quotationItems';

async function normalize(patch: Record<string, unknown> = {}, quantity = '1.5', extra = {}) {
    const product = {
        id: 'qa-box', name: 'Caja sintética QA', unit: 'caja', price: 100, cost: 60,
        ivaExento: false, saleMode: null, quantityStep: null, wholesalePrice: null,
        wholesaleMinQty: null, packUnit: null, packSize: null, packPrice: null,
        requiresBatchTracking: false, ...patch,
    };
    const db = { product: { findMany: vi.fn(async ({ where }: any) => {
        expect(where.tenantId).toBe('qa-tenant');
        expect(where.id.in).toContain('qa-box');
        return [product];
    }) } };
    return normalizeSaleItems(db as any, {
        tenantId: 'qa-tenant', userId: 'qa-user', wholesaleCustomer: false,
        allowRevokedScaleVersionForReplay: false,
        items: [{ id: 'qa-box', quantity, price: 100, ...extra }],
    });
}

describe('Cajas enteras: contrato compartido del candidato recuperado', () => {
    it('COUNTED explícito prevalece sobre la unidad y se conserva en el snapshot', async () => {
        const [item] = await normalize({ unit: 'kg', saleMode: 'COUNTED', quantityStep: null }, '2');
        expect(item.saleModeAtSale).toBe('COUNTED');
        expect(item.quantityStepAtSale).toBe('1');
        expect(effectivePosSaleMode({ unit: 'kg', saleMode: 'COUNTED' })).toBe('COUNTED');
    });
    it('MEASURED explícito sin paso no se convierte a caja entera', async () => {
        const [item] = await normalize({ saleMode: 'MEASURED', quantityStep: null });
        expect(item.quantity.toString()).toBe('1.5');
        expect(item.saleModeAtSale).toBe('MEASURED');
        expect(effectivePosSaleMode({ unit: 'caja', saleMode: 'MEASURED' })).toBe('MEASURED');
        expect(effectivePosQuantityStep({ unit: 'caja', saleMode: 'MEASURED' })).toBe(0.0001);
    });
    it('unidad ausente no causa excepción ni inventa un modo contado', () => {
        expect(effectivePosSaleMode({})).toBe('MEASURED');
        expect(effectivePosSaleMode({ unit: null })).toBe('MEASURED');
        expect(effectivePosQuantityStep({})).toBe(0.0001);
        expect(effectiveSaleModeAndStep(null, null)).toEqual({ saleMode: 'MEASURED', quantityStep: '0.0001' });
    });
    it('cotizar una caja legacy no permite convertir 1.5 en un snapshot MEASURED', () => {
        const product = { id: 'qa-box', name: 'Caja QA', price: 100, unit: 'caja', ivaExento: false, saleMode: null, quantityStep: null };
        expect(() => resolveQuotationItems([{ id: product.id, quantity: '1.5' }], [product]))
            .toThrow('enteros');
        const [item] = resolveQuotationItems([{ id: product.id, quantity: '2' }], [product]);
        expect(item.saleMode).toBe('COUNTED');
        expect(item.quantityStep).toBe('1');
    });
    it.each(['caja', 'cajas', 'unidad', ' CAJA '])('%s legacy rechaza fracciones', async unit => {
        await expect(normalize({ unit })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
        expect(effectivePosSaleMode({ unit, saleMode: null, quantityStep: null })).toBe('COUNTED');
        expect(effectivePosQuantityStep({ unit, saleMode: null, quantityStep: null })).toBe(1);
    });
    it.each(['kg', 'lb', 'litro', 'metro', 'frasco', 'saco'])('%s legacy conserva fracciones', async unit => {
        const [item] = await normalize({ unit });
        expect(item.quantity.toString()).toBe('1.5');
        expect(item.saleModeAtSale).toBe('MEASURED');
        expect(effectivePosSaleMode({ unit })).toBe('MEASURED');
    });
    it.each(['0.5', '1.5', '1.0001'])('COUNTED rechaza %s', async quantity => {
        await expect(normalize({ saleMode: 'COUNTED', quantityStep: '1' }, quantity))
            .rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });
    it('legacy admite 1 con precio y modo correctos', async () => {
        const [item] = await normalize({}, '1');
        expect(item.quantity.toString()).toBe('1');
        expect(item.unitPrice.toString()).toBe('100');
        expect(item.saleModeAtSale).toBe('COUNTED');
        expect(item.quantityStepAtSale).toBe('1');
    });
    it('respeta una caja configurada explícitamente como medida', async () => {
        const [item] = await normalize({ saleMode: 'MEASURED', quantityStep: '0.5' });
        expect(item.quantity.toString()).toBe('1.5');
        expect(effectivePosSaleMode({ unit: 'caja', saleMode: 'MEASURED', quantityStep: 0.5 })).toBe('MEASURED');
    });
    it('un paso legacy explícito no se sobrescribe', async () => {
        const [item] = await normalize({ quantityStep: '0.5' });
        expect(item.quantity.toString()).toBe('1.5');
        expect(effectivePosQuantityStep({ unit: 'caja', quantityStep: 0.5 })).toBe(0.5);
    });
    it('modo inválido en el catálogo se rechaza, no cae a modo medido', () => {
        expect(() => effectiveSaleModeAndStep('INVALID', null, 'caja'))
            .toThrow('Modo de venta no permitido');
    });
    it('1.5 empaques de 12 se rechazan aunque las piezas sean enteras', async () => {
        await expect(normalize({ unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', packUnit: 'caja', packSize: 12 }, '18', {
            presentation: { quantity: '1.5', unit: 'caja' },
        })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });
    it('18 piezas sueltas son válidas', async () => {
        const [item] = await normalize({ unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', packUnit: 'caja', packSize: 12 }, '18');
        expect(item.quantity.toString()).toBe('18');
        expect(item.presentationAtSale).toBe('BASE');
    });
    it('2 empaques completos son válidos', async () => {
        const [item] = await normalize({ unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', packUnit: 'caja', packSize: 12 }, '24', {
            presentation: { quantity: '2', unit: 'caja' },
        });
        expect(item.quantity.toString()).toBe('24');
        expect(item.presentationQuantityAtSale.toString()).toBe('2');
    });
});
