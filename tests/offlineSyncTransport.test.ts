import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, getPendingSales, recordOfflineSyncResults, saveSaleOffline, type OfflineSale } from '../lib/db';
import { normalizeOfflineSalePayload, offlineTransportIdentityIssue, syncBodySchema } from '../backend/routes/syncPayload';
import { offlineReplayPayloadHash, type OfflineReplaySaleInput } from '../backend/lib/offlineSaleReplay';
import { OfflineSyncTransportError, toOfflineSyncTransport } from '../utils/offlineSyncTransport';

const scope = { tenantId: 'tenant-a', userId: 'cashier-a' };
const draft = (overrides: Partial<Omit<OfflineSale, 'synced'>> = {}) => ({
    offlineId: 'attempt-a', ...scope, shiftId: 'shift-a', employeeId: 'employee-a',
    customerName: 'Cliente QA', customerId: 'customer-a', paymentMethod: 'CASH',
    total: 25, globalDiscount: 0, fiscalRegimeVersion: 7,
    createdAt: '2026-09-04T14:00:00.000Z',
    items: [{ id: 'product-a', name: 'Arroz', quantity: '1', price: 25, costPrice: 10 }],
    ...overrides,
});
const wire = (sale: OfflineSale) => JSON.parse(JSON.stringify(toOfflineSyncTransport(sale)));

beforeEach(async () => { await db.offline_sales.clear(); });
afterEach(async () => { await db.offline_sales.clear(); });

describe('transporte de ventas guardadas en IndexedDB', () => {
    it('reproduce el 400 potencial de una fila POS y prepara el DTO aceptado sin perder identidad ni snapshot', async () => {
        const posDraft = { ...draft(), storeCreditAmount: '0.00' };
        await saveSaleOffline(posDraft);
        const [stored] = await getPendingSales(scope);
        const original = structuredClone(stored);

        const raw = syncBodySchema.safeParse({ sales: [stored] });
        expect(raw.success).toBe(false);
        if (!raw.success) {
            expect(raw.error.issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'unrecognized_keys', keys: expect.arrayContaining(['syncState', 'storeCreditAmount']) }),
            ]));
        }

        const serialized = wire(stored);
        expect(syncBodySchema.parse({ sales: [serialized] }).sales[0]).toEqual(draft());
        expect(serialized).not.toHaveProperty('synced');
        expect(serialized).not.toHaveProperty('syncState');
        expect(serialized).not.toHaveProperty('storeCreditAmount');
        expect(stored).toEqual(original);
        expect(await getPendingSales(scope)).toEqual([original]);
        expect(wire(stored)).toEqual(serialized);
    });

    it.each(['failed', 'reconciliation_required'] as const)('omite metadatos durables de %s sin borrar ni mutar la fila', async status => {
        await saveSaleOffline(draft());
        await recordOfflineSyncResults([{ offlineId: 'attempt-a', status, code: 'RECONCILIATION_REQUIRED', error: 'Revisar con soporte' }]);
        const [stored] = await getPendingSales(scope);
        expect(stored.syncState).toBe(status === 'failed' ? 'FAILED' : 'RECONCILIATION_REQUIRED');
        expect(stored.lastSyncAt).toBeTruthy();
        const dto = wire(stored);
        expect(syncBodySchema.safeParse({ sales: [dto] }).success).toBe(true);
        expect(Object.keys(dto).filter(key => key.startsWith('sync') || key === 'lastSyncAt')).toEqual([]);
        expect(await getPendingSales(scope)).toEqual([stored]);
    });

    it('preserva la cotización, cantidad medida y todos los datos de la etiqueta para revalidación autoritativa', async () => {
        const labelItem = {
            id: 'measured-product', name: 'Cable', quotationItemId: 'quote-line-a', cartLineId: 'line-a',
            quantity: '1.2500', price: 40, costPrice: 20, discount: 2,
            presentation: { quantity: '125', unit: 'cm' },
            measurement: {
                source: 'SCALE_LABEL' as const, clientEventId: 'measurement-a', capturedAt: '2026-09-04T13:59:00.000Z',
                rawCode: '2012345125008', profileVersionId: 'profile-version-7', previewBaseQuantity: '1.2500',
                sourceValue: '125', sourceUnit: 'cm', encodedPrice: '50.00', pricingPolicy: 'REQUIRE_MATCH' as const,
                managerOverride: false, deviceId: 'scale-a', stable: true,
            },
        };
        await saveSaleOffline(draft({ total: 50, items: [labelItem] }));
        const [stored] = await getPendingSales(scope);
        const dto = wire(stored);
        expect(dto.items).toEqual([labelItem]);
        const parsed = syncBodySchema.parse({ sales: [dto] }).sales[0];
        const normalized = normalizeOfflineSalePayload(parsed);
        expect(normalized.items[0]).toMatchObject({
            quotationItemId: 'quote-line-a', quantity: '1.2500', presentation: { quantity: '125', unit: 'cm' },
            measurement: { source: 'SCALE_LABEL', clientEventId: 'measurement-a', rawCode: labelItem.measurement.rawCode,
                profileVersionId: 'profile-version-7', value: '125', unit: 'cm', pricePolicy: 'REQUIRE_MATCH' },
        });
        const context = { ...scope, shiftId: stored.shiftId };
        const onlineInput: OfflineReplaySaleInput = { ...draft({ items: [labelItem] }), paymentMethod: 'CASH', source: 'POS' };
        const replayInput = { ...normalized, items: normalized.items.map((item): OfflineReplaySaleInput['items'][number] => {
            const measurement = item.measurement;
            if (measurement?.source !== 'SCALE_LABEL' || typeof measurement.clientEventId !== 'string') {
                throw new Error('La medición normalizada perdió su identidad');
            }
            return { ...item, measurement: { ...measurement, source: measurement.source, clientEventId: measurement.clientEventId } };
        }) };
        expect(offlineReplayPayloadHash({ ...context, input: replayInput })).toBe(
            offlineReplayPayloadHash({ ...context, input: onlineInput }),
        );
        expect(await getPendingSales(scope)).toEqual([stored]);
    });

    it.each(['MANUAL', 'LIVE_SCALE'] as const)('conserva medición %s, presentación y cero explícito de sus banderas', async source => {
        const item = { ...draft().items[0], quantity: '0.125',
            presentation: { quantity: '125', unit: 'g' },
            measurement: { source, clientEventId: `event-${source}`, capturedAt: '2026-09-04T14:00:00.000Z',
                sourceValue: '125', sourceUnit: 'g', managerOverride: false, stable: false, deviceId: 'device-a' },
        };
        await saveSaleOffline(draft({ items: [item] }));
        const [stored] = await getPendingSales(scope);
        const dto = wire(stored);
        expect(dto.items).toEqual([item]);
        expect(syncBodySchema.safeParse({ sales: [dto] }).success).toBe(true);
    });

    it('conserva aliases legacy sin convertir cantidades, versiones o IDs', () => {
        const stored: OfflineSale = { ...draft(), synced: 0, items: [{ ...draft().items[0],
            quantity: 0.5, displayQuantity: 500, displayUnit: 'g', measurementSource: 'SCALE_LABEL',
            measurementCode: '2012345005003', scaleProfileVersionId: 'legacy-v1', scalePlu: '12345',
            measuredValue: 500, measuredUnit: 'g', measurementPricePolicy: 'RECALCULATE',
        }] };
        const parsed = syncBodySchema.parse({ sales: [wire(stored)] });
        expect(parsed.sales[0].items).toEqual(stored.items);
        expect(parsed.sales[0].offlineId).toBe(stored.offlineId);
    });

    it('excluye propiedades locales extra en todos los niveles, sin convertir el mapper en autoridad de datos', async () => {
        const base = draft();
        const item = { ...base.items[0], uiSelected: true,
            presentation: { quantity: '1', unit: 'unidad', formatted: '1 unidad' },
            measurement: { source: 'MANUAL' as const, clientEventId: 'manual-a', capturedAt: base.createdAt,
                sourceValue: '1', sourceUnit: 'unidad', debugDevice: 'local-only' },
        };
        await saveSaleOffline({ ...base, items: [item], localNote: 'local-only' } as typeof base);
        const [stored] = await getPendingSales(scope);
        const dto = wire(stored);
        expect(dto).not.toHaveProperty('localNote');
        expect(dto.items[0]).not.toHaveProperty('uiSelected');
        expect(dto.items[0].presentation).toEqual({ quantity: '1', unit: 'unidad' });
        expect(dto.items[0].measurement).not.toHaveProperty('debugDevice');
        expect(syncBodySchema.safeParse({ sales: [dto] }).success).toBe(true);
    });

    it('mantiene cada identidad almacenada: el scope selecciona y el servidor decide; nunca reatribuye al usuario actual', async () => {
        await saveSaleOffline(draft());
        await saveSaleOffline(draft({ offlineId: 'other-user', userId: 'cashier-b' }));
        await saveSaleOffline(draft({ offlineId: 'other-tenant', tenantId: 'tenant-b' }));
        expect((await getPendingSales(scope)).map(sale => sale.offlineId)).toEqual(['attempt-a']);
        const rows = await getPendingSales();
        const mapped = rows.map(toOfflineSyncTransport);
        expect(mapped.map(sale => [sale.offlineId, sale.tenantId, sale.userId])).toEqual(
            rows.map(sale => [sale.offlineId, sale.tenantId, sale.userId]),
        );
        expect(offlineTransportIdentityIssue(mapped.find(sale => sale.offlineId === 'other-user')!, scope)?.status).toBe('reconciliation_required');
        expect(offlineTransportIdentityIssue(mapped.find(sale => sale.offlineId === 'other-tenant')!, scope)?.code).toBe('TENANT_MISMATCH');
        expect(await getPendingSales()).toEqual(rows);
    });

    it.each([undefined, 0, '0', '0.00', '-0.00', '0e3'])('omite saldo a favor ausente o cero explícito %s, sin cambiar el payload de venta', async amount => {
        await saveSaleOffline({ ...draft(), ...(amount === undefined ? {} : { storeCreditAmount: amount }) });
        const [stored] = await getPendingSales(scope);
        expect(syncBodySchema.parse({ sales: [wire(stored)] }).sales[0]).toEqual(draft());
    });

    it('omite una referencia inactiva solo cuando el importe demuestra que no se aplicó saldo', () => {
        const stored = { ...draft(), synced: 0 as const, storeCreditAmount: '0.00', storeCreditSourceReturnId: 'return-a' };
        const dto = toOfflineSyncTransport(stored);
        expect(dto).not.toHaveProperty('storeCreditSourceReturnId');
        expect(dto).not.toHaveProperty('storeCreditAmount');
        expect(stored.storeCreditSourceReturnId).toBe('return-a');
    });

    it.each(['10.00', '0.000000000000000001', '1e-999999999999999999', -1, null, '', ' ', 'invalid', Number.NaN, Number.POSITIVE_INFINITY])(
        'rechaza saldo a favor no cero o incierto %s sin alterar la evidencia guardada', async amount => {
            const candidate = { ...draft(), storeCreditAmount: amount, storeCreditSourceReturnId: 'return-a' };
            await saveSaleOffline(candidate);
            const [stored] = await getPendingSales(scope);
            expect(() => toOfflineSyncTransport(stored)).toThrow(OfflineSyncTransportError);
            try { toOfflineSyncTransport(stored); } catch (error) {
                expect(error).toMatchObject({ offlineId: 'attempt-a', code: 'OFFLINE_STORE_CREDIT_REVIEW_REQUIRED' });
            }
            expect(await getPendingSales(scope)).toEqual([stored]);
        },
    );

    it('rechaza una referencia sin importe, en lugar de asumir que el saldo fue cero', () => {
        expect(() => toOfflineSyncTransport({ ...draft(), synced: 0, storeCreditSourceReturnId: 'return-a' }))
            .toThrow(OfflineSyncTransportError);
    });
});
