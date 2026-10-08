import { beforeEach, describe, expect, it, vi } from 'vitest';

const saleFindFirst = vi.hoisted(() => vi.fn());
const shiftFindFirst = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock('../backend/lib/prisma.js', () => {
    const mockedPrisma = {
        sale: { findFirst: saleFindFirst },
        shift: { findFirst: shiftFindFirst },
        $transaction: transaction,
    };
    return { default: mockedPrisma, prisma: mockedPrisma };
});

import {
    canonicalOfflineReplayPayload,
    offlineReplayPayloadHash,
    type OfflineReplaySaleInput,
} from '../backend/lib/offlineSaleReplay';
import {
    assertOfflineFiscalRegimeVersion,
    CreateSaleSchema,
    executeSaleWithResult,
} from '../backend/services/salesService';

const rawSale = (patch: Record<string, unknown> = {}) => ({
    offlineId: 'offline-evt-1',
    paymentMethod: 'CASH',
    customerId: null,
    customerName: 'Cliente General',
    employeeId: null,
    globalDiscount: '0',
    source: 'OFFLINE_SYNC',
    items: [{
        id: 'product-1',
        quantity: '1.2500',
        price: '48.00',
        discount: '0',
        presentation: { quantity: '1.2500', unit: 'lb' },
    }],
    ...patch,
});

const fingerprint = (raw: ReturnType<typeof rawSale>): string => {
    const input = CreateSaleSchema.parse(raw);
    return offlineReplayPayloadHash({
        tenantId: 'tenant-a',
        userId: 'user-a',
        shiftId: 'shift-a',
        input: input as unknown as OfflineReplaySaleInput,
    });
};

describe('idempotencia fuerte de ventas offline', () => {
    beforeEach(() => {
        saleFindFirst.mockReset();
        shiftFindFirst.mockReset();
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: null });
        transaction.mockReset();
    });

    it('valida una versión fiscal positiva y entera cuando el cliente la observa', () => {
        expect(CreateSaleSchema.parse(rawSale({ fiscalRegimeVersion: 3 })).fiscalRegimeVersion).toBe(3);
        for (const fiscalRegimeVersion of [0, -1, 1.5, '3']) {
            expect(CreateSaleSchema.safeParse(rawSale({ fiscalRegimeVersion })).success).toBe(false);
        }
    });

    it('manda a conciliación solo el sync offline con versión fiscal divergente', () => {
        expect(() => assertOfflineFiscalRegimeVersion(true, 2, 2)).not.toThrow();
        expect(() => assertOfflineFiscalRegimeVersion(true, undefined, 1)).not.toThrow();
        expect(() => assertOfflineFiscalRegimeVersion(false, 1, 2)).not.toThrow();
        for (const observedVersion of [undefined, 1]) {
            expect(() => assertOfflineFiscalRegimeVersion(true, observedVersion, 2)).toThrowError(
                expect.objectContaining({
                    code: 'RECONCILIATION_REQUIRED',
                    httpStatus: 409,
                }),
            );
        }
    });

    it('misma tenant, offlineId y payload devuelve la venta como replay omitido', async () => {
        const payload = rawSale();
        const existing = {
            id: 'sale-existing',
            tenantId: 'tenant-a',
            offlineId: 'event:opaque',
            offlinePayloadHash: fingerprint(payload),
        };
        saleFindFirst.mockResolvedValue(existing);

        const result = await executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            payload,
            { offlineSync: true, createdAt: '2026-08-22T12:00:00.000Z' },
        );

        expect(result).toEqual({ sale: existing, idempotentReplay: true });
        expect(saleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: 'tenant-a' }),
        }));
        expect(shiftFindFirst).toHaveBeenCalledWith({
            where: { id: 'shift-a', tenantId: 'tenant-a', userId: 'user-a' },
            select: { id: true, employeeId: true },
        });
    });

    it('rechaza una fila sin turno antes de declararla replay idempotente', async () => {
        const payload = rawSale();
        saleFindFirst.mockResolvedValue({
            id: 'sale-existing',
            offlinePayloadHash: fingerprint(payload),
        });

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            null,
            payload,
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
        expect(saleFindFirst).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('rechaza turno ajeno o reasignado antes de tocar idempotencia', async () => {
        shiftFindFirst.mockResolvedValue(null);

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-atacante',
            'shift-a',
            rawSale(),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
        expect(shiftFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'shift-a', tenantId: 'tenant-a', userId: 'user-atacante' },
        }));
        expect(saleFindFirst).not.toHaveBeenCalled();
    });

    it('acepta un turno legítimo cerrado y completa employeeId desde el turno', async () => {
        shiftFindFirst.mockResolvedValue({
            id: 'shift-a',
            employeeId: 'employee-authoritative',
            status: 'CLOSED',
        });
        // Simula la venta online aceptada cuya respuesta se perdió: el endpoint
        // online ya había fijado employeeId desde el turno y source POS.
        const authoritativePayload = rawSale({
            employeeId: 'employee-authoritative',
            source: 'POS',
        });
        const existing = {
            id: 'sale-existing',
            offlinePayloadHash: fingerprint(authoritativePayload),
        };
        saleFindFirst.mockResolvedValue(existing);

        const result = await executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale({ employeeId: null }),
            { offlineSync: true },
        );

        expect(result).toEqual({ sale: existing, idempotentReplay: true });
        const lookup = shiftFindFirst.mock.calls[0]?.[0];
        expect(lookup.where).toEqual({ id: 'shift-a', tenantId: 'tenant-a', userId: 'user-a' });
        expect(lookup.where).not.toHaveProperty('status');
    });

    it('manda a conciliación un employeeId cliente divergente del turno', async () => {
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: 'employee-authoritative' });

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale({ employeeId: 'employee-forged' }),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
        expect(saleFindFirst).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('conserva compatibilidad cuando employeeId explícito coincide con el turno', async () => {
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: 'employee-authoritative' });
        const payload = rawSale({ employeeId: 'employee-authoritative' });
        const existing = {
            id: 'sale-existing',
            offlinePayloadHash: fingerprint(payload),
        };
        saleFindFirst.mockResolvedValue(existing);

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            payload,
            { offlineSync: true },
        )).resolves.toEqual({ sale: existing, idempotentReplay: true });
    });

    it('omite el replay tras respuesta online perdida cuando coincide la foto fiscal persistida', async () => {
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: 'employee-authoritative' });
        const onlineAccepted = rawSale({
            source: 'POS',
            employeeId: 'employee-authoritative',
            // El POST online actual no manda este campo.
            fiscalRegimeVersion: undefined,
        });
        const deferredReplay = rawSale({
            source: 'OFFLINE_SYNC',
            employeeId: 'employee-authoritative',
            fiscalRegimeVersion: 7,
        });
        const existing = {
            id: 'sale-online-existing',
            offlinePayloadHash: fingerprint(onlineAccepted),
            fiscalRegimeVersionAtSale: 7,
        };
        saleFindFirst.mockResolvedValue(existing);

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            deferredReplay,
            { offlineSync: true },
        )).resolves.toEqual({ sale: existing, idempotentReplay: true });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('no usa la compatibilidad online si la foto fiscal persistida diverge', async () => {
        shiftFindFirst.mockResolvedValue({ id: 'shift-a', employeeId: 'employee-authoritative' });
        const onlineAccepted = rawSale({
            source: 'POS',
            employeeId: 'employee-authoritative',
            fiscalRegimeVersion: undefined,
        });
        saleFindFirst.mockResolvedValue({
            id: 'sale-online-existing',
            offlinePayloadHash: fingerprint(onlineAccepted),
            fiscalRegimeVersionAtSale: 8,
        });

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale({
                source: 'OFFLINE_SYNC',
                employeeId: 'employee-authoritative',
                fiscalRegimeVersion: 7,
            }),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'OFFLINE_PAYLOAD_MISMATCH',
            httpStatus: 409,
        });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('el camino online también deduplica antes de tocar stock, caja o contabilidad', async () => {
        const payload = rawSale({ source: 'POS' });
        const existing = {
            id: 'sale-online-existing',
            tenantId: 'tenant-a',
            offlineId: 'event:opaque',
            offlinePayloadHash: fingerprint(payload),
        };
        saleFindFirst.mockResolvedValue(existing);

        const result = await executeSaleWithResult('tenant-a', 'user-a', 'shift-a', payload);

        expect(result).toEqual({ sale: existing, idempotentReplay: true });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('misma offlineId con cantidad divergente falla 409 y nunca se omite', async () => {
        const original = rawSale();
        saleFindFirst.mockResolvedValue({
            id: 'sale-existing',
            offlinePayloadHash: fingerprint(original),
        });

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale({
                items: [{
                    id: 'product-1',
                    quantity: '2.0000',
                    price: '48.00',
                    discount: '0',
                    presentation: { quantity: '2.0000', unit: 'lb' },
                }],
            }),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'OFFLINE_PAYLOAD_MISMATCH',
            httpStatus: 409,
        });
    });

    it('una fila histórica sin hash queda visible para conciliación', async () => {
        saleFindFirst.mockResolvedValue({
            id: 'sale-legacy',
            offlinePayloadHash: null,
        });

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            rawSale(),
            { offlineSync: true },
        )).rejects.toMatchObject({
            code: 'OFFLINE_PAYLOAD_MISMATCH',
            httpStatus: 409,
            message: expect.stringContaining('conciliacion'),
        });
    });

    it('canoniza decimales y transporte online/offline sin almacenar el barcode crudo', () => {
        const barcode = '2012345125008';
        const online = CreateSaleSchema.parse({
            ...rawSale(),
            source: 'POS',
            items: [{
                id: 'product-1',
                quantity: 1.25,
                price: 48,
                presentation: { quantity: 1.25, unit: 'lb' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-123',
                    capturedAt: '2026-08-22T12:00:00-06:00',
                    rawCode: barcode,
                    profileVersionId: 'version-1',
                },
            }],
        });
        const deferred = CreateSaleSchema.parse({
            ...rawSale(),
            source: 'OFFLINE_SYNC',
            items: [{
                id: 'product-1',
                quantity: '1.2500',
                price: '48.0000',
                discount: '0.0',
                presentation: { quantity: '1.2500', unit: 'lb' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-123',
                    capturedAt: '2026-08-22T18:00:00.000Z',
                    rawCode: `\r${barcode}\n`,
                    profileVersionId: 'version-1',
                },
            }],
        });
        const onlineContext = {
            tenantId: 'tenant-a', userId: 'user-a', shiftId: 'shift-a',
            input: online as unknown as OfflineReplaySaleInput,
        };
        const deferredContext = {
            ...onlineContext,
            input: deferred as unknown as OfflineReplaySaleInput,
        };
        const canonical = canonicalOfflineReplayPayload(onlineContext);
        const canonicalJson = JSON.stringify(canonical);

        expect(offlineReplayPayloadHash(onlineContext)).toBe(offlineReplayPayloadHash(deferredContext));
        expect(canonical).toMatchObject({
            version: 1,
            tenantId: 'tenant-a',
            soldById: 'user-a',
            shiftId: 'shift-a',
            offlineId: 'offline-evt-1',
            source: 'POS',
            paymentMethod: 'CASH',
            globalDiscount: '0',
            items: [{
                productId: 'product-1',
                quantity: '1.25',
                price: '48',
                discount: '0',
                presentation: { quantity: '1.25', unit: 'lb' },
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-123',
                    capturedAt: '2026-08-22T18:00:00.000Z',
                    profileVersionId: 'version-1',
                    managerOverride: false,
                },
            }],
        });
        expect(canonicalJson).not.toContain(barcode);
        expect(canonicalJson).toMatch(/"rawCodeHash":"[a-f0-9]{64}"/);
    });

    it('cambia la huella ante cada dato relevante y ante el orden de las líneas', () => {
        const measuredItem = {
            id: 'product-1',
            quotationItemId: 'quote-line-1',
            quantity: '1.25',
            price: '48',
            discount: '2',
            presentation: { quantity: '1.25', unit: 'lb' },
            measurement: {
                source: 'SCALE_LABEL' as const,
                clientEventId: 'event-123',
                capturedAt: '2026-08-22T18:00:00.000Z',
                rawCode: '2012345125008',
                profileVersionId: 'version-1',
                managerOverride: false,
            },
        };
        const input: OfflineReplaySaleInput = {
            offlineId: 'offline-evt-1',
            paymentMethod: 'CASH',
            customerId: 'customer-1',
            customerName: 'Cliente Uno',
            employeeId: 'employee-1',
            globalDiscount: '3',
            source: 'POS',
            items: [measuredItem, { id: 'product-2', quantity: '2', price: '10' }],
        };
        const context = { tenantId: 'tenant-a', userId: 'user-a', shiftId: 'shift-a', input };
        const original = offlineReplayPayloadHash(context);
        const changedContexts = [
            { ...context, tenantId: 'tenant-b' },
            { ...context, userId: 'user-b' },
            { ...context, shiftId: 'shift-b' },
            { ...context, input: { ...input, offlineId: 'offline-evt-2' } },
            { ...context, input: { ...input, source: 'WHATSAPP' as const } },
            { ...context, input: { ...input, paymentMethod: 'CARD' as const } },
            { ...context, input: { ...input, customerId: 'customer-2' } },
            { ...context, input: { ...input, customerName: 'Cliente Dos' } },
            { ...context, input: { ...input, employeeId: 'employee-2' } },
            { ...context, input: { ...input, fiscalRegimeVersion: 2 } },
            { ...context, input: { ...input, globalDiscount: '4' } },
            { ...context, input: { ...input, items: [{ ...measuredItem, id: 'product-x' }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, quotationItemId: 'quote-line-2' }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, quantity: '1.5' }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, price: '49' }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, discount: '5' }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, presentation: { quantity: '1.25', unit: 'kg' } }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, measurement: { ...measuredItem.measurement, clientEventId: 'event-999' } }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, measurement: { ...measuredItem.measurement, capturedAt: '2026-08-22T18:00:01.000Z' } }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, measurement: { ...measuredItem.measurement, profileVersionId: 'version-2' } }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, measurement: { ...measuredItem.measurement, rawCode: '2012345125009' } }, input.items[1]] } },
            { ...context, input: { ...input, items: [{ ...measuredItem, measurement: { ...measuredItem.measurement, managerOverride: true } }, input.items[1]] } },
            { ...context, input: { ...input, items: [...input.items].reverse() } },
        ];

        for (const changed of changedContexts) {
            expect(offlineReplayPayloadHash(changed)).not.toBe(original);
        }
    });

    it('normaliza aliases de presentación/medición y representa ausencias como null', () => {
        const aliasedInput: OfflineReplaySaleInput = {
            offlineId: 'offline-alias',
            paymentMethod: 'CASH',
            globalDiscount: 0,
            source: 'OFFLINE_SYNC',
            items: [{
                id: 'product-1',
                quantity: 3,
                displayQuantity: 1,
                displayUnit: 'saco',
                measurement: {
                    source: 'SCALE_LABEL',
                    clientEventId: 'event-alias',
                    scaleLabelCode: '2012345125008',
                    scaleProfileVersionId: 'version-alias',
                },
            }, {
                id: 'product-2',
                quantity: 1,
            }],
        };
        const canonical = canonicalOfflineReplayPayload({
            tenantId: 'tenant-a', userId: 'user-a', shiftId: null, input: aliasedInput,
        });

        expect(canonical).toMatchObject({
            source: 'POS',
            customerId: null,
            customerName: '',
            employeeId: null,
            items: [{
                price: null,
                discount: '0',
                presentation: { quantity: '1', unit: 'saco' },
                measurement: {
                    profileVersionId: 'version-alias',
                    capturedAt: null,
                    managerOverride: false,
                },
            }, {
                price: null,
                presentation: null,
                measurement: null,
            }],
        });
        expect(JSON.stringify(canonical)).not.toContain('2012345125008');
    });
});
