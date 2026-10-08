import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { ean13CheckDigit } from '../utils/scaleLabels';
import {
    ScaleLabelServiceError,
    assertScaleLabelVersionPublishable,
    getActiveScaleLabelContext,
    previewScaleLabelVersion,
    resolveScaleLabel,
    validateScaleDeviceConfiguration,
} from '../backend/services/scaleLabelService';

const withCheckDigit = (firstTwelveDigits: string): string =>
    `${firstTwelveDigits}${ean13CheckDigit(firstTwelveDigits)}`;

const versionRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'version-1',
    tenantId: 'tenant-a',
    profileId: 'profile-1',
    version: 1,
    status: 'PUBLISHED',
    symbology: 'EAN_13',
    totalLength: 13,
    prefixes: ['20'],
    itemStart: 2,
    itemLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueKind: 'WEIGHT',
    impliedDecimals: 3,
    sourceUnit: 'g',
    checksumMode: 'EAN13',
    pricePolicy: 'RECALCULATE',
    roundingTolerance: new Decimal('0.01'),
    minValue: new Decimal('0.001'),
    maxValue: new Decimal('99.999'),
    publishedAt: new Date('2026-08-22T00:00:00.000Z'),
    revokedAt: null,
    createdBy: 'user-a',
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    profile: {
        id: 'profile-1',
        tenantId: 'tenant-a',
        name: 'Carnicería',
        status: 'ACTIVE',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
    mappings: [{
        id: 'mapping-1',
        tenantId: 'tenant-a',
        profileVersionId: 'version-1',
        plu: '12345',
        productId: 'product-1',
        sourceUnit: 'g',
        createdAt: new Date('2026-08-21T00:00:00.000Z'),
        product: {
            id: 'product-1',
            tenantId: 'tenant-a',
            name: 'Pollo pesado',
            unit: 'kg',
            price: 100,
            saleMode: 'MEASURED',
            quantityStep: new Decimal('0.001'),
            updatedAt: new Date('2026-08-21T00:00:00.000Z'),
        },
    }],
    ...overrides,
});

const dbForVersion = (version: ReturnType<typeof versionRecord>) => ({
    scaleLabelProfileVersion: {
        findFirst: vi.fn(({ where }: any) => (
            where.id === version.id && where.tenantId === version.tenantId ? version : null
        )),
        findMany: vi.fn(() => [version]),
    },
});

describe('scaleLabelService.resolveScaleLabel', () => {
    it('reparsea server-side, resuelve PLU tenant-scoped y no propaga el barcode crudo', async () => {
        const version = versionRecord();
        const db = dbForVersion(version);
        const rawCode = `\r${withCheckDigit('201234512000')}\n`;

        const resolved = await resolveScaleLabel({
            db: db as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode,
        });

        expect(resolved.mapping).toMatchObject({ plu: '12345', productId: 'product-1' });
        expect(resolved.parsed).toEqual({
            plu: '12345',
            value: '12.000',
            valueKind: 'WEIGHT',
            sourceUnit: 'g',
        });
        expect(resolved.baseQuantity).toBe('0.012');
        expect(resolved.calculatedTotal).toBe('1.20');
        expect(resolved.codeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(resolved)).not.toContain(rawCode.trim());
    });

    it('no permite usar un draft para vender, pero sí para preview sin persistencia', async () => {
        const draft = versionRecord({ status: 'DRAFT', publishedAt: null });
        const db = dbForVersion(draft);
        const rawCode = withCheckDigit('201234501000');

        await expect(resolveScaleLabel({
            db: db as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode,
        })).rejects.toMatchObject({ code: 'INVALID_STATE' });

        await expect(previewScaleLabelVersion({
            db: db as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode,
        })).resolves.toMatchObject({ baseQuantity: '0.001' });
    });

    it('envía una versión revocada a conciliación antes de reinterpretar el replay offline', async () => {
        const revoked = versionRecord({
            status: 'REVOKED',
            revokedAt: new Date('2026-08-22T01:00:00.000Z'),
        });
        const db = dbForVersion(revoked);
        const rawCode = withCheckDigit('201234501000');

        await expect(resolveScaleLabel({
            db: db as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode,
        })).rejects.toMatchObject({ code: 'INVALID_STATE' });

        await expect(resolveScaleLabel({
            db: db as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode,
            allowRevokedForReplay: true,
        })).rejects.toMatchObject({
            code: 'REVOKED_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
    });

    it('prioriza conciliación revocada sobre TOTAL_PRICE y payload inválido', async () => {
        const base = versionRecord();
        const revokedTotal = versionRecord({
            status: 'REVOKED',
            revokedAt: new Date('2026-08-22T01:00:00.000Z'),
            valueKind: 'TOTAL_PRICE',
            sourceUnit: 'NIO',
            mappings: [{
                ...base.mappings[0],
                sourceUnit: 'kg',
                product: { ...base.mappings[0].product, unit: 'kg' },
            }],
        });

        await expect(resolveScaleLabel({
            db: dbForVersion(revokedTotal) as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode: 'payload-inválido',
            allowRevokedForReplay: true,
        })).rejects.toMatchObject({ code: 'REVOKED_RECONCILIATION_REQUIRED' });
    });

    it('parsea TOTAL_PRICE en draft sin inventar cantidad a partir del precio actual', async () => {
        const base = versionRecord();
        const totalPrice = versionRecord({
            status: 'DRAFT',
            publishedAt: null,
            valueKind: 'TOTAL_PRICE',
            impliedDecimals: 2,
            sourceUnit: 'NIO',
            minValue: new Decimal('0.01'),
            maxValue: new Decimal('999.99'),
            mappings: [{
                ...base.mappings[0],
                sourceUnit: 'kg',
                product: { ...base.mappings[0].product, unit: 'kg', price: 100 },
            }],
        });
        const resolved = await previewScaleLabelVersion({
            db: dbForVersion(totalPrice) as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode: withCheckDigit('201234512500'),
        });

        expect(resolved.parsed.sourceUnit).toBe('NIO');
        expect(resolved.encodedPrice).toBe('125');
        expect(resolved.baseQuantity).toBeNull();
        expect(resolved.calculatedTotal).toBeNull();
        expect(resolved.quantityResolution).toBe('MANUAL_REQUIRED');
        expect(resolved.requiresManualQuantity).toBe(true);
    });

    it('rechaza una venta TOTAL_PRICE publicada aunque el precio actual permita una división exacta', async () => {
        const base = versionRecord();
        const published = versionRecord({
            valueKind: 'TOTAL_PRICE',
            impliedDecimals: 2,
            sourceUnit: 'NIO',
            minValue: new Decimal('0.01'),
            maxValue: new Decimal('999.99'),
            mappings: [{
                ...base.mappings[0],
                sourceUnit: 'kg',
                product: { ...base.mappings[0].product, unit: 'kg', price: 125 },
            }],
        });

        await expect(resolveScaleLabel({
            db: dbForVersion(published) as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode: withCheckDigit('201234512500'),
        })).rejects.toMatchObject({
            code: 'TOTAL_PRICE_REQUIRES_WEIGHT',
            httpStatus: 422,
        });

        await expect(previewScaleLabelVersion({
            db: dbForVersion(published) as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode: withCheckDigit('201234512500'),
        })).rejects.toMatchObject({ code: 'TOTAL_PRICE_REQUIRES_WEIGHT' });
    });

    it('falla cerrado si el lookup exacto no pertenece al tenant JWT', async () => {
        const version = versionRecord();
        await expect(resolveScaleLabel({
            db: dbForVersion(version) as any,
            tenantId: 'tenant-b',
            profileVersionId: 'version-1',
            rawCode: withCheckDigit('201234501000'),
        })).rejects.toBeInstanceOf(ScaleLabelServiceError);
    });

    it('falla cerrado ante una relación producto/mapping cross-tenant aunque la BD esté corrupta', async () => {
        const base = versionRecord();
        const corrupted = versionRecord({
            mappings: [{
                ...base.mappings[0],
                product: { ...base.mappings[0].product, tenantId: 'tenant-b' },
            }],
        });
        await expect(resolveScaleLabel({
            db: dbForVersion(corrupted) as any,
            tenantId: 'tenant-a',
            profileVersionId: 'version-1',
            rawCode: withCheckDigit('201234501000'),
        })).rejects.toMatchObject({ code: 'INVALID_MAPPING', httpStatus: 500 });
    });
});

describe('getActiveScaleLabelContext', () => {
    it('produce un cacheVersion estable y snapshots con mappings/producto', async () => {
        const version = versionRecord();
        const db = dbForVersion(version);
        const first = await getActiveScaleLabelContext(db as any, 'tenant-a');
        const second = await getActiveScaleLabelContext(db as any, 'tenant-a');

        expect(first.cacheVersion).toBe(second.cacheVersion);
        expect(first.profiles[0]).toMatchObject({
            profileVersionId: 'version-1',
            pricePolicy: 'RECALCULATE',
            mappings: [{ plu: '12345', productId: 'product-1' }],
        });
    });

    it('rechaza perfiles publicados cuyo espacio de prefijos es ambiguo', async () => {
        const first = versionRecord();
        const second = versionRecord({
            id: 'version-2',
            profileId: 'profile-2',
            prefixes: ['20'],
            profile: { ...first.profile, id: 'profile-2', name: 'Otra balanza' },
            mappings: [],
        });
        const db = {
            scaleLabelProfileVersion: { findMany: vi.fn(() => [first, second]) },
        };

        await expect(getActiveScaleLabelContext(db as any, 'tenant-a'))
            .rejects.toMatchObject({ code: 'AMBIGUOUS_PROFILE' });
    });
});

describe('validateScaleDeviceConfiguration', () => {
    it('acepta solamente combinaciones de transporte/protocolo conocidas y read-only', () => {
        expect(() => validateScaleDeviceConfiguration({
            name: 'Balanza de caja',
            transport: 'WEB_SERIAL',
            protocolKey: 'GENERIC_ASCII_WEIGHT_V1',
            adapterVersion: '1.0.0',
        })).not.toThrow();

        expect(() => validateScaleDeviceConfiguration({
            name: 'Simulador QA',
            transport: 'SIMULATOR',
            protocolKey: 'NORTEX_LOCAL_BRIDGE_V1',
            adapterVersion: '1.0.0',
        })).toThrowError(/requiere el protocolo SIMULATOR_V1/);
    });
});

describe('assertScaleLabelVersionPublishable', () => {
    it('bloquea publicar un layout que solo codifica total, sin importar la política', () => {
        const baseRules = {
            symbology: 'EAN_13' as const,
            totalLength: 13 as const,
            prefixes: ['20'],
            itemStart: 2,
            itemLength: 5,
            valueStart: 7,
            valueLength: 5,
            valueKind: 'TOTAL_PRICE' as const,
            impliedDecimals: 2,
            sourceUnit: 'NIO',
            checksumMode: 'EAN13' as const,
            roundingTolerance: '0.01',
            minValue: '0.01',
            maxValue: '999.99',
        };

        for (const pricePolicy of ['RECALCULATE', 'REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL'] as const) {
            try {
                assertScaleLabelVersionPublishable({ ...baseRules, pricePolicy });
                throw new Error('Se esperaba rechazo de TOTAL_PRICE');
            } catch (error) {
                expect(error).toMatchObject({
                    code: 'TOTAL_PRICE_REQUIRES_WEIGHT',
                    httpStatus: 422,
                });
            }
        }
    });

    it.each(['WEIGHT', 'COUNT'] as const)(
        'solo permite RECALCULATE para %s mientras el layout no codifique total',
        (valueKind) => {
            const baseRules = {
                symbology: 'EAN_13' as const,
                totalLength: 13 as const,
                prefixes: ['20'],
                itemStart: 2,
                itemLength: 5,
                valueStart: 7,
                valueLength: 5,
                valueKind,
                impliedDecimals: valueKind === 'COUNT' ? 0 : 3,
                sourceUnit: valueKind === 'COUNT' ? 'unidad' : 'kg',
                checksumMode: 'EAN13' as const,
                roundingTolerance: '0.01',
                minValue: valueKind === 'COUNT' ? '1' : '0.001',
                maxValue: valueKind === 'COUNT' ? '99999' : '99.999',
            };

            expect(() => assertScaleLabelVersionPublishable({
                ...baseRules,
                pricePolicy: 'RECALCULATE',
            })).not.toThrow();

            for (const pricePolicy of ['REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL'] as const) {
                try {
                    assertScaleLabelVersionPublishable({ ...baseRules, pricePolicy });
                    throw new Error('Se esperaba rechazo de política sin total codificado');
                } catch (error) {
                    expect(error).toMatchObject({
                        code: 'PRICE_POLICY_REQUIRES_ENCODED_TOTAL',
                        httpStatus: 422,
                    });
                }
            }
        },
    );
});
