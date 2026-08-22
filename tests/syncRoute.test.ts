import { describe, expect, it } from 'vitest';
import {
    normalizeOfflineSalePayload,
    offlineSyncFailureStatus,
    syncBodySchema,
} from '../backend/routes/syncPayload';

describe('normalizeOfflineSalePayload', () => {
    it('envía divergencias y filas históricas no verificables a conciliación durable', () => {
        expect(offlineSyncFailureStatus('OFFLINE_PAYLOAD_MISMATCH')).toBe('reconciliation_required');
        expect(offlineSyncFailureStatus('RECONCILIATION_REQUIRED')).toBe('reconciliation_required');
        expect(offlineSyncFailureStatus('INVALID_INPUT')).toBe('failed');
    });

    it('acepta la fila real de IndexedDB con synced y no propaga ese metadato al dominio', () => {
        const parsed = syncBodySchema.parse({
            sales: [{
                offlineId: 'offline-indexeddb',
                synced: 0,
                tenantId: 'tenant-a',
                userId: 'user-a',
                shiftId: null,
                employeeId: null,
                customerName: 'Cliente General',
                customerId: null,
                paymentMethod: 'CASH',
                total: '10.00',
                globalDiscount: '0',
                createdAt: '2026-08-22T12:00:00.000Z',
                items: [{
                    id: 'product-1',
                    name: 'Pollo por libra',
                    cartLineId: 'line-1',
                    quotationItemId: 'quote-item-1',
                    quantity: '1',
                    price: 10,
                    costPrice: 7,
                }],
            }],
        });

        const payload = normalizeOfflineSalePayload(parsed.sales[0]);

        expect(payload).not.toHaveProperty('synced');
        expect(payload).toMatchObject({
            offlineId: 'offline-indexeddb',
            source: 'OFFLINE_SYNC',
            items: [{ quotationItemId: 'quote-item-1' }],
        });
    });

    it('preserva el contrato v3 de medicion offline para reparseo server-side', () => {
        const payload = normalizeOfflineSalePayload({
            offlineId: 'offline-1',
            tenantId: 'tenant-a',
            userId: 'user-a',
            shiftId: 'shift-a',
            employeeId: null,
            customerName: 'Cliente General',
            customerId: null,
            paymentMethod: 'CASH',
            total: '125.50',
            globalDiscount: '0',
            createdAt: '2026-08-22T12:00:00.000Z',
            items: [{
                id: 'product-1',
                quantity: '1.25',
                price: '95.5',
                discount: '0',
                presentation: { quantity: '1.25', unit: 'lb' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-123',
                    capturedAt: '2026-08-22T11:59:00.000Z',
                    rawCode: '2012345125008',
                    profileVersionId: 'version-7',
                    previewBaseQuantity: '1.25',
                    sourceValue: '1.25',
                    sourceUnit: 'lb',
                    encodedPrice: '125.50',
                    pricingPolicy: 'RECALCULATE',
                },
            }],
        });

        expect(payload).toMatchObject({
            offlineId: 'offline-1',
            source: 'OFFLINE_SYNC',
            items: [{
                id: 'product-1',
                quantity: '1.25',
                presentation: { quantity: '1.25', unit: 'lb' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-123',
                    rawCode: '2012345125008',
                    profileVersionId: 'version-7',
                    previewBaseQuantity: '1.25',
                    value: '1.25',
                    unit: 'lb',
                    encodedPrice: '125.50',
                    pricePolicy: 'RECALCULATE',
                },
            }],
        });
    });

    it('migra los aliases legacy de balanza y sintetiza clientEventId estable', () => {
        const payload = normalizeOfflineSalePayload({
            offlineId: 'offline-legacy',
            tenantId: 'tenant-a',
            userId: 'user-a',
            shiftId: null,
            employeeId: null,
            customerName: 'Cliente General',
            customerId: null,
            paymentMethod: 'CASH',
            total: 12.5,
            globalDiscount: 0,
            createdAt: '2026-08-22T12:00:00.000Z',
            items: [{
                id: 'product-2',
                quantity: 0.5,
                price: 25,
                measurementSource: 'SCALE_LABEL',
                measurementCode: '2012345005003',
                scaleProfileVersionId: 'version-9',
                measuredValue: 0.5,
                measuredUnit: 'kg',
                measurementPricePolicy: 'REQUIRE_MATCH',
            }],
        });

        expect(payload.items[0]).toMatchObject({
            id: 'product-2',
            quantity: '0.5',
            measurement: {
                source: 'SCALE_LABEL',
                clientEventId: expect.stringMatching(/^offline:[a-f0-9]{64}$/),
                rawCode: '2012345005003',
                profileVersionId: 'version-9',
                value: '0.5',
                unit: 'kg',
                pricePolicy: 'REQUIRE_MATCH',
                capturedAt: '2026-08-22T12:00:00.000Z',
            },
        });
    });
});
