import { describe, expect, it } from 'vitest';
import {
    canonicalOfflineReplayPayload,
    offlineReplayPayloadHash,
    type OfflineReplaySaleInput,
} from '../backend/lib/offlineSaleReplay';

describe('huella canónica de replay offline (red de mutación)', () => {
    it('incluye la versión fiscal observada sin invalidar huellas legacy ausentes', () => {
        const base: OfflineReplaySaleInput = {
            offlineId: 'offline-fiscal',
            paymentMethod: 'CASH',
            globalDiscount: 0,
            source: 'OFFLINE_SYNC',
            items: [{ id: 'product-1', quantity: 1 }],
        };
        const context = { tenantId: 'tenant-1', userId: 'user-1', shiftId: 'shift-1', input: base };
        const legacy = canonicalOfflineReplayPayload(context);
        const observed = canonicalOfflineReplayPayload({
            ...context,
            input: { ...base, fiscalRegimeVersion: 7 },
        });

        expect(legacy).not.toHaveProperty('fiscalRegimeVersion');
        expect(observed).toHaveProperty('fiscalRegimeVersion', 7);
        expect(offlineReplayPayloadHash(context)).not.toBe(offlineReplayPayloadHash({
            ...context,
            input: { ...base, fiscalRegimeVersion: 7 },
        }));
        expect(offlineReplayPayloadHash({
            ...context,
            input: { ...base, fiscalRegimeVersion: 7 },
        })).not.toBe(offlineReplayPayloadHash({
            ...context,
            input: { ...base, fiscalRegimeVersion: 8 },
        }));
    });

    it('fija literalmente todos los campos económicos y la identidad de una medición', () => {
        const input: OfflineReplaySaleInput = {
            offlineId: 'offline-1',
            paymentMethod: 'CARD',
            customerId: 'customer-1',
            customerName: 'Cliente Uno',
            employeeId: 'employee-1',
            globalDiscount: '3.5000',
            source: 'WHATSAPP',
            items: [{
                id: 'product-1',
                quotationItemId: 'quote-line-1',
                quantity: '1.2500',
                price: 48,
                discount: '2.00',
                presentation: { quantity: '0.5000', unit: 'kg' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'measurement-1',
                    capturedAt: '2026-08-22T12:00:00-06:00',
                    rawCode: '\r2012345125008\n',
                    profileVersionId: 'profile-version-1',
                    managerOverride: false,
                },
            }],
        };
        const context = {
            tenantId: 'tenant-1',
            userId: 'user-1',
            shiftId: 'shift-1',
            input,
        };

        expect(canonicalOfflineReplayPayload(context)).toEqual({
            version: 1,
            tenantId: 'tenant-1',
            soldById: 'user-1',
            shiftId: 'shift-1',
            offlineId: 'offline-1',
            source: 'WHATSAPP',
            paymentMethod: 'CARD',
            customerId: 'customer-1',
            customerName: 'Cliente Uno',
            employeeId: 'employee-1',
            globalDiscount: '3.5',
            items: [{
                productId: 'product-1',
                quotationItemId: 'quote-line-1',
                quantity: '1.25',
                price: '48',
                discount: '2',
                presentation: { quantity: '0.5', unit: 'kg' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'measurement-1',
                    capturedAt: '2026-08-22T18:00:00.000Z',
                    profileVersionId: 'profile-version-1',
                    rawCodeHash: '480dbc55ba76d2e0c12e40f6f4af8a6a42b7e1a2fbad53f9307619af33c3661d',
                    managerOverride: false,
                },
            }],
        });
        expect(offlineReplayPayloadHash(context)).toBe(
            '62da49ee771212d1550f8ec33da34871a82995d85dd2f7a559df0af6d7380506',
        );
    });

    it('normaliza aliases y ausencias sin confundir null, undefined o booleanos', () => {
        const input = {
            paymentMethod: 'CASH',
            customerId: null,
            employeeId: null,
            globalDiscount: 0,
            source: 'OFFLINE_SYNC',
            items: [{
                id: 'product-alias',
                quantity: 3,
                displayQuantity: 1,
                measurement: {
                    source: 'MANUAL',
                    clientEventId: 'measurement-manual',
                    capturedAt: 'not-a-date',
                    scaleLabelCode: '  manual\u0001code  ',
                    managerOverride: true,
                },
            }, {
                id: 'product-null',
                quantity: 1,
                price: null,
                discount: null,
            }, {
                id: 'product-empty-measurement',
                quantity: 2,
                measurement: {
                    source: 'LIVE_SCALE',
                    clientEventId: 'measurement-live',
                    capturedAt: '',
                    scaleProfileVersionId: 'profile-alias',
                },
            }],
        } as unknown as OfflineReplaySaleInput;

        expect(canonicalOfflineReplayPayload({
            tenantId: 'tenant-2',
            userId: 'user-2',
            shiftId: null,
            input,
        })).toEqual({
            version: 1,
            tenantId: 'tenant-2',
            soldById: 'user-2',
            shiftId: null,
            offlineId: null,
            source: 'POS',
            paymentMethod: 'CASH',
            customerId: null,
            customerName: '',
            employeeId: null,
            globalDiscount: '0',
            items: [{
                productId: 'product-alias',
                quotationItemId: null,
                quantity: '3',
                price: null,
                discount: '0',
                presentation: { quantity: '1', unit: '' },
                measurement: {
                    source: 'MANUAL',
                    clientEventId: 'measurement-manual',
                    capturedAt: 'not-a-date',
                    profileVersionId: null,
                    rawCodeHash: 'fa9acf46cd4f47d91305f91ad430cfa01a4412b72438dd32af14b5755314be7e',
                    managerOverride: true,
                },
            }, {
                productId: 'product-null',
                quotationItemId: null,
                quantity: '1',
                price: null,
                discount: '0',
                presentation: null,
                measurement: null,
            }, {
                productId: 'product-empty-measurement',
                quotationItemId: null,
                quantity: '2',
                price: null,
                discount: '0',
                presentation: null,
                measurement: {
                    source: 'LIVE_SCALE',
                    clientEventId: 'measurement-live',
                    capturedAt: null,
                    profileVersionId: 'profile-alias',
                    rawCodeHash: null,
                    managerOverride: false,
                },
            }],
        });
    });

    it('no incluye nunca el código crudo y lo liga a la huella aun si es inválido', () => {
        const contextFor = (rawCode: string) => ({
            tenantId: 'tenant-private',
            userId: 'user-private',
            shiftId: null,
            input: {
                paymentMethod: 'CASH' as const,
                globalDiscount: '0',
                source: 'POS' as const,
                items: [{
                    id: 'product-private',
                    quantity: '1',
                    measurement: {
                        source: 'SCALE_LABEL' as const,
                        clientEventId: 'measurement-private',
                        rawCode,
                    },
                }],
            },
        });
        const first = canonicalOfflineReplayPayload(contextFor('20\u000112345'));
        const second = canonicalOfflineReplayPayload(contextFor('20\u000212345'));

        expect(JSON.stringify(first)).not.toContain('20\\u000112345');
        expect(first).not.toEqual(second);
        expect(offlineReplayPayloadHash(contextFor('20\u000112345'))).not.toBe(
            offlineReplayPayloadHash(contextFor('20\u000212345')),
        );
    });
});
