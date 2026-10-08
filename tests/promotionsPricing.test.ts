import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { normalizeSaleItems } from '../backend/services/saleItemMeasurementService';
import { applyPromotionsToItems, discountedPromotionPrice } from '../backend/services/promotions/pricing';
import { promotionConfig, promotionHash } from '../backend/services/promotions/authority';
import { promotionDate, promotionPercent, parsePromotionDraft } from '../backend/services/promotions/management';
import { calculateSaleTotals } from '../backend/services/promotions/totals';
import { withPromotionPriceVersion } from '../backend/services/promotions/productVersion';
import { assertCheckoutMatches, checkoutPriceHash, promotionReplayHash } from '../backend/services/promotions/checkout';

const fiscal = { fiscalRegime: 'GENERAL', fiscalRegimeVersion: 1 };
const at = new Date('2030-02-01T18:00:00Z');
const product = () => ({ id: 'product-a', name: 'Clavos', unit: 'unidad', price: 100, cost: 50, ivaExento: false,
    saleMode: 'COUNTED', quantityStep: new Decimal(1), wholesalePrice: 80, wholesaleMinQty: 10,
    packUnit: 'caja', packSize: 10, packPrice: 600, requiresBatchTracking: false });
const context = { ...fiscal, at, globalDiscount: '0' };
function fixture() {
    const row = product();
    const promo = { id: 'promo-a', productId: row.id, name: 'Semana ferretera', version: 1, percent: new Decimal(10),
        configHash: promotionHash(promotionConfig(row as any, fiscal)), startsAt: new Date('2030-01-01'), endsAt: new Date('2031-01-01') };
    const db = { $queryRaw: vi.fn(async (query: any) => query.sql.includes('FROM `Product`') ? [row] : [promo]) } as any;
    const normalize = (items: any[], override = {}) => normalizeSaleItems(db, { tenantId: 'tenant-a', userId: 'cashier-a', items,
        wholesaleCustomer: false, allowRevokedScaleVersionForReplay: false, promotionContext: context, ...override });
    return { row, promo, db, normalize };
}
describe('promociones: autoridad de precios y revisión', () => {
    it.each([
        { quantity: '1', price: '90.0000', total: '90.00' },
        { quantity: '10', price: '72.0000', total: '720.00' },
        { quantity: '10', presentation: { quantity: '1', unit: 'caja' }, price: '54.0000', total: '540.00' },
    ])('aplica al nivel autoritativo: $price por unidad', async scenario => {
        const f = fixture(); const items = await f.normalize([{ id: f.row.id, quantity: scenario.quantity, presentation: scenario.presentation }]);
        expect(items[0].unitPrice.toFixed(4)).toBe(scenario.price);
        expect(items[0].discountPct.toString()).toBe('0');
        expect(items[0].promotionSnapshot).toMatchObject({ id: 'promo-a', percent: '10', unitPrice: scenario.price });
        expect(calculateSaleTotals(items, '0', 'GENERAL').finalTotal.toFixed(2)).toBe(scenario.total);
        expect(f.row.price).toBe(100);
    });
    it('mayorista conserva el nivel aunque compre una sola unidad', async () => {
        const f = fixture(); const items = await f.normalize([{ id: f.row.id, quantity: '1' }], { wholesaleCustomer: true });
        expect(items[0].unitPrice.toFixed(4)).toBe('72.0000');
    });
    it.each(['price', 'packSize', 'wholesaleMinQty'])('cambio de %s suspende aplicación sin cambiar el catálogo', async field => {
        const f = fixture(); f.row[field] = 120;
        const items = await f.normalize([{ id: f.row.id, quantity: '1' }]);
        expect(items[0].promotionSnapshot).toBeUndefined();
        expect(items[0].unitPrice.toString()).toBe(field === 'price' ? '120' : '100');
    });
    it.each(['line', 'global'])('impide acumular descuento %s', async kind => {
        const f = fixture();
        await expect(f.normalize([{ id: f.row.id, quantity: '1', discount: kind === 'line' ? '1' : '0' }],
            { promotionContext: { ...context, globalDiscount: kind === 'global' ? '1' : '0' } })).rejects.toMatchObject({ code: 'PROMOTION_DISCOUNT_CONFLICT' });
    });
    it('no cambia el precio congelado de una cotización', async () => {
        const f = fixture(); const [line] = await f.normalize([{ id: f.row.id, quantity: '1' }]);
        const quoted = { ...line, unitPrice: new Decimal(37), quotationId: 'quotation-a', promotionSnapshot: undefined };
        const [result] = await applyPromotionsToItems(f.db, 'tenant-a', [quoted], [f.row as any], context);
        expect(result.unitPrice.toString()).toBe('37'); expect(result.promotionSnapshot).toBeUndefined();
    });
    it('requiere revisión y detecta caducidad, cantidad o precio distinto', async () => {
        const f = fixture(); const items = await f.normalize([{ id: f.row.id, quantity: '1' }]);
        const totals = calculateSaleTotals(items, '0', 'GENERAL');
        expect(() => assertCheckoutMatches(null, items, fiscal, totals, at)).toThrow(/Revisá y aceptá/);
        const quote = { expiresAt: new Date(at.getTime() + 60_000), priceHash: checkoutPriceHash(items, fiscal, totals) } as any;
        expect(() => assertCheckoutMatches(quote, items, fiscal, totals, at)).not.toThrow();
        expect(() => assertCheckoutMatches(quote, items, fiscal, totals, quote.expiresAt)).toThrow(/Cambió/);
        items[0].quantity = new Decimal(2);
        expect(() => assertCheckoutMatches(quote, items, fiscal, calculateSaleTotals(items, '0', 'GENERAL'), at)).toThrow(/Cambió/);
    });
    it('el identificador de revisión forma parte de la huella del replay', () => {
        const base = 'base-hash';
        expect(promotionReplayHash(base, {})).toBe(base);
        expect(promotionReplayHash(base, { promotionQuote: { id: 'a', version: 1 } })).not.toBe(promotionReplayHash(base, { promotionQuote: { id: 'a', version: 2 } }));
    });
    it('conserva precisión antes del redondeo del total y calcula IVA con la misma función de venta', async () => {
        expect(discountedPromotionPrice('3.3333', '10').toFixed(4)).toBe('3.0000');
        expect(discountedPromotionPrice('1.2999', '5').toFixed(4)).toBe('1.2349');
        expect(discountedPromotionPrice('0.011', '50').toFixed(4)).toBe('0.0055');
        const f = fixture(); const items = await f.normalize([{ id: f.row.id, quantity: '1' }]);
        const totals = calculateSaleTotals(items, '0', 'GENERAL');
        expect(totals.finalTotal.toFixed(2)).toBe('90.00'); expect(totals.fiscalAmounts.vatAmount.toFixed(2)).toBe('11.74');
        expect(calculateSaleTotals(items, '0', 'CUOTA_FIJA').fiscalAmounts.vatAmount.toString()).toBe('0');
    });
    it('fechas locales se interpretan en Managua y los drafts incompletos pueden conservarse', () => {
        expect(promotionDate('2030-02-01T12:15').toISOString()).toBe('2030-02-01T18:15:00.000Z');
        expect(parsePromotionDraft({ name: 'Idea parcial' })).toEqual({ operation: 'PUBLISH', name: 'Idea parcial' });
        expect(() => parsePromotionDraft({ lotId: 'no-autorizado' })).toThrow();
        expect(() => promotionDate('2030-02-30T12:00')).toThrow();
        expect(() => promotionDate('2030-02-01T24:00')).toThrow();
    });
    it('conserva total y exención con fracciones y descuentos de tickets sin promoción', () => {
        const items = [
            { unitPrice: new Decimal('123.4567'), quantity: new Decimal('1.25'), discountPct: new Decimal('7.5'), ivaExento: false },
            { unitPrice: new Decimal('20'), quantity: new Decimal('2'), discountPct: new Decimal('10'), ivaExento: true },
        ] as any;
        const totals = calculateSaleTotals(items, '5', 'GENERAL');
        expect(totals.finalTotal.toString()).toBe('169.81'); expect(totals.exemptTotal.toFixed(2)).toBe('34.20');
        expect(totals.fiscalAmounts.vatAmount.toFixed(4)).toBe('17.6883');
        expect(calculateSaleTotals(items, '5', 'CUOTA_FIJA').fiscalAmounts.netRevenue.toFixed(2)).toBe('169.81');
        const halfCent = calculateSaleTotals([{ unitPrice: new Decimal('0.005'), quantity: new Decimal(1), discountPct: new Decimal(0), ivaExento: true }] as any, '0', 'GENERAL');
        expect(halfCent.finalTotal.toString()).toBe('0.01'); expect(halfCent.exemptTotal.toString()).toBe('0.01');
    });
    it('versiona sólo cambios comerciales reales con lectura corriente; stock y costo no consultan ni invalidan', async () => {
        const db = { $queryRaw: vi.fn(async () => [{ price: new Decimal(100), packPrice: null, ivaExento: 0 }]) } as any;
        expect(await withPromotionPriceVersion(db, 'tenant', 'product', { stock: 1, cost: 55 })).toEqual({ stock: 1, cost: 55 });
        expect(db.$queryRaw).not.toHaveBeenCalled();
        expect(await withPromotionPriceVersion(db, 'tenant', 'product', { price: '100.00', ivaExento: false, packPrice: null })).not.toHaveProperty('promotionPriceVersion');
        expect(await withPromotionPriceVersion(db, 'tenant', 'product', { price: '120' })).toMatchObject({ promotionPriceVersion: { increment: 1 } });
        expect(db.$queryRaw.mock.calls[0][0].sql).toContain('FOR UPDATE');
    });
    it.each(['0', '-1', '100', '0.001', 'NaN', 'Infinity'])('rechaza porcentaje incompatible %s', value => {
        expect(() => promotionPercent(value)).toThrow();
    });
});
