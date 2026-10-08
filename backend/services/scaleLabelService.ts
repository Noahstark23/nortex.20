/**
 * Dominio persistido de etiquetas de balanza.
 *
 * Las reglas de interpretación viven en utils/scaleLabels.ts. Este módulo solo
 * agrega aislamiento por tenant, versionado inmutable, mapeos PLU y auditoría.
 * El código crudo de una etiqueta nunca se guarda ni se incluye en el contrato
 * de salida: únicamente se conserva/retorna su hash SHA-256.
 */
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { Prisma, PrismaClient } from '@prisma/client';
import {
    parseScaleLabelWithProfile,
    tryParseScaleLabel,
    validateScaleLabelProfile,
    validateScaleLabelProfiles,
    ScaleLabelError,
    type ScaleLabelProfile as ParserProfile,
    type ScaleLabelValueKind,
} from '../../utils/scaleLabels';
import {
    convertQuantity,
    validateQuantity,
    type QuantityUnit,
} from '../../utils/quantity';

export type ScaleLabelPricePolicy =
    | 'RECALCULATE'
    | 'REQUIRE_MATCH'
    | 'ACCEPT_LABEL_TOTAL';

export type ScaleLabelVersionStatus = 'DRAFT' | 'PUBLISHED' | 'REVOKED';

export const SCALE_DEVICE_TRANSPORTS = [
    'WEB_SERIAL',
    'SIMULATOR',
    'CAPACITOR',
    'LOCAL_BRIDGE',
] as const;

export const SCALE_DEVICE_PROTOCOLS = [
    'SIMULATOR_V1',
    'GENERIC_ASCII_WEIGHT_V1',
    'NORTEX_LOCAL_BRIDGE_V1',
] as const;

export const SCALE_ADAPTER_VERSIONS = ['1.0.0'] as const;

export type ScaleDeviceTransport = typeof SCALE_DEVICE_TRANSPORTS[number];
export type ScaleDeviceProtocol = typeof SCALE_DEVICE_PROTOCOLS[number];
export type ScaleAdapterVersion = typeof SCALE_ADAPTER_VERSIONS[number];

export interface ScaleDeviceInput {
    name: string;
    manufacturer?: string | null;
    model?: string | null;
    transport: ScaleDeviceTransport;
    protocolKey: ScaleDeviceProtocol;
    adapterVersion: ScaleAdapterVersion;
    status?: 'ACTIVE' | 'INACTIVE' | 'UNSUPPORTED';
}

export interface ScaleProductMappingInput {
    plu: string;
    productId: string;
    sourceUnit: string;
}

export interface ScaleLabelRulesInput {
    symbology: 'EAN_13';
    totalLength: 13;
    prefixes: string[];
    itemStart: number;
    itemLength: number;
    valueStart: number;
    valueLength: number;
    valueKind: ScaleLabelValueKind;
    impliedDecimals: number;
    sourceUnit: string;
    checksumMode: 'EAN13' | 'NONE';
    pricePolicy: ScaleLabelPricePolicy;
    roundingTolerance: string;
    minValue: string;
    maxValue: string;
}

export interface ScaleLabelDraftInput extends ScaleLabelRulesInput {
    mappings?: ScaleProductMappingInput[];
}

export interface CreateScaleLabelProfileInput extends ScaleLabelDraftInput {
    name: string;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type ProductSummary = {
    id: string;
    tenantId?: string;
    name: string;
    unit: string;
    price: number;
    saleMode: string | null;
    quantityStep: Decimal | null;
    updatedAt?: Date;
};

type MappingRecord = {
    id: string;
    tenantId: string;
    profileVersionId: string;
    plu: string;
    productId: string;
    sourceUnit: string;
    createdAt: Date;
    product: ProductSummary;
};

type VersionRecord = {
    id: string;
    tenantId: string;
    profileId: string;
    version: number;
    status: string;
    symbology: string;
    totalLength: number;
    prefixes: Prisma.JsonValue;
    itemStart: number;
    itemLength: number;
    valueStart: number;
    valueLength: number;
    valueKind: string;
    impliedDecimals: number;
    sourceUnit: string;
    checksumMode: string;
    pricePolicy: string;
    roundingTolerance: Decimal;
    minValue: Decimal;
    maxValue: Decimal;
    publishedAt: Date | null;
    revokedAt: Date | null;
    createdBy: string;
    createdAt: Date;
    profile: {
        id: string;
        tenantId: string;
        name: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    };
    mappings: MappingRecord[];
};

export class ScaleLabelServiceError extends Error {
    constructor(
        public readonly code:
            | 'NOT_FOUND'
            | 'INVALID_STATE'
            | 'INVALID_PROFILE'
            | 'INVALID_MAPPING'
            | 'AMBIGUOUS_PROFILE'
            | 'LABEL_NOT_RECOGNIZED'
            | 'PRODUCT_NOT_MEASURED'
            | 'INVALID_DEVICE'
            | 'TOTAL_PRICE_REQUIRES_WEIGHT'
            | 'PRICE_POLICY_REQUIRES_ENCODED_TOTAL'
            | 'REVOKED_RECONCILIATION_REQUIRED'
            | 'DUPLICATE',
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'ScaleLabelServiceError';
    }
}

const VERSION_INCLUDE = {
    profile: true,
    mappings: {
        include: {
            product: {
                select: {
                    id: true,
                    tenantId: true,
                    name: true,
                    unit: true,
                    price: true,
                    saleMode: true,
                    quantityStep: true,
                    updatedAt: true,
                },
            },
        },
        orderBy: { plu: 'asc' as const },
    },
} as const;

const lockTenantConfiguration = async (
    tx: Prisma.TransactionClient,
    tenantId: string,
): Promise<void> => {
    // Serializa publish/reactivate y asignación del siguiente número de versión
    // por tenant. Sin este lock dos administradores podrían publicar perfiles
    // solapados entre el SELECT de validación y el COMMIT.
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`;
};

const assertVersionTenantIntegrity = (version: VersionRecord, tenantId: string): void => {
    const invalid = version.tenantId !== tenantId
        || version.profile.tenantId !== tenantId
        || version.mappings.some((mapping) => (
            mapping.tenantId !== tenantId
            || mapping.product.tenantId !== tenantId
        ));
    if (invalid) {
        throw new ScaleLabelServiceError(
            'INVALID_MAPPING',
            500,
            'La configuración de balanza tiene referencias inconsistentes',
        );
    }
};

const profileSetError = (error: unknown, fallback: string): ScaleLabelServiceError => {
    if (error instanceof ScaleLabelServiceError) return error;
    const ambiguous = error instanceof ScaleLabelError && error.code === 'AMBIGUOUS_PROFILES';
    return new ScaleLabelServiceError(
        ambiguous ? 'AMBIGUOUS_PROFILE' : 'INVALID_PROFILE',
        ambiguous ? 409 : 500,
        error instanceof Error ? error.message : fallback,
    );
};

const asPrefixes = (value: Prisma.JsonValue): string[] => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new ScaleLabelServiceError(
            'INVALID_PROFILE',
            500,
            'El perfil publicado contiene prefijos inválidos',
        );
    }
    return [...value] as string[];
};

const assertKnownPolicy = (value: string): ScaleLabelPricePolicy => {
    if (value === 'RECALCULATE' || value === 'REQUIRE_MATCH' || value === 'ACCEPT_LABEL_TOTAL') {
        return value;
    }
    throw new ScaleLabelServiceError(
        'INVALID_PROFILE',
        500,
        'El perfil contiene una política de precio no permitida',
    );
};

const decimal18_4 = (
    value: Decimal.Value,
    field: string,
    options: { positive?: boolean; allowZero?: boolean } = {},
): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new ScaleLabelServiceError('INVALID_PROFILE', 400, `${field} no es un decimal válido`);
    }
    const minimumOk = options.positive
        ? parsed.greaterThan(0)
        : options.allowZero
            ? parsed.greaterThanOrEqualTo(0)
            : true;
    if (
        !parsed.isFinite()
        || !minimumOk
        || parsed.decimalPlaces() > 4
        || parsed.abs().greaterThan('99999999999999.9999')
    ) {
        throw new ScaleLabelServiceError(
            'INVALID_PROFILE',
            400,
            `${field} debe ser finito y caber en Decimal(18,4)`,
        );
    }
    return parsed;
};

const parserProfileFromRules = (
    id: string,
    name: string | undefined,
    rules: ScaleLabelRulesInput,
): ParserProfile => ({
    id,
    name,
    symbology: rules.symbology,
    totalLength: rules.totalLength,
    prefixes: rules.prefixes,
    itemStart: rules.itemStart,
    itemLength: rules.itemLength,
    valueStart: rules.valueStart,
    valueLength: rules.valueLength,
    valueKind: rules.valueKind,
    impliedDecimals: rules.impliedDecimals,
    sourceUnit: rules.sourceUnit,
    checksumMode: rules.checksumMode,
    minValue: rules.minValue,
    maxValue: rules.maxValue,
});

export const buildScaleLabelParserProfile = (version: VersionRecord): ParserProfile => ({
    id: version.id,
    name: version.profile.name,
    symbology: version.symbology as 'EAN_13',
    totalLength: version.totalLength,
    prefixes: asPrefixes(version.prefixes),
    itemStart: version.itemStart,
    itemLength: version.itemLength,
    valueStart: version.valueStart,
    valueLength: version.valueLength,
    valueKind: version.valueKind as ScaleLabelValueKind,
    impliedDecimals: version.impliedDecimals,
    sourceUnit: version.sourceUnit,
    checksumMode: version.checksumMode as 'EAN13' | 'NONE',
    minValue: version.minValue.toString(),
    maxValue: version.maxValue.toString(),
});

const normalizeRules = (rules: ScaleLabelRulesInput): ScaleLabelRulesInput => {
    const roundingTolerance = decimal18_4(
        rules.roundingTolerance,
        'roundingTolerance',
        { allowZero: true },
    );
    const minValue = decimal18_4(rules.minValue, 'minValue', { positive: true });
    const maxValue = decimal18_4(rules.maxValue, 'maxValue', { positive: true });
    assertKnownPolicy(rules.pricePolicy);

    const normalized: ScaleLabelRulesInput = {
        ...rules,
        prefixes: rules.prefixes.map((prefix) => prefix.trim()),
        sourceUnit: rules.sourceUnit.trim(),
        roundingTolerance: roundingTolerance.toFixed(roundingTolerance.decimalPlaces()),
        minValue: minValue.toFixed(minValue.decimalPlaces()),
        maxValue: maxValue.toFixed(maxValue.decimalPlaces()),
    };
    try {
        validateScaleLabelProfile(parserProfileFromRules('draft-validation', undefined, normalized));
    } catch (error) {
        throw new ScaleLabelServiceError(
            'INVALID_PROFILE',
            400,
            error instanceof Error ? error.message : 'Las reglas del perfil no son válidas',
        );
    }
    return normalized;
};

const rulesFromVersion = (version: VersionRecord): ScaleLabelRulesInput => ({
    symbology: version.symbology as 'EAN_13',
    totalLength: version.totalLength as 13,
    prefixes: asPrefixes(version.prefixes),
    itemStart: version.itemStart,
    itemLength: version.itemLength,
    valueStart: version.valueStart,
    valueLength: version.valueLength,
    valueKind: version.valueKind as ScaleLabelValueKind,
    impliedDecimals: version.impliedDecimals,
    sourceUnit: version.sourceUnit,
    checksumMode: version.checksumMode as 'EAN13' | 'NONE',
    pricePolicy: assertKnownPolicy(version.pricePolicy),
    roundingTolerance: version.roundingTolerance.toString(),
    minValue: version.minValue.toString(),
    maxValue: version.maxValue.toString(),
});

/**
 * Un layout que solo codifica dinero no contiene evidencia independiente de
 * la cantidad. Dividir por el precio maestro actual inventaría un peso y haría
 * tautológica cualquier comparación de total. Se mantiene parseable en draft
 * para diagnóstico, pero no publicable hasta soportar un layout que incluya
 * peso/cantidad en el mismo payload o una conciliación manual explícita.
 * REQUIRE_MATCH y ACCEPT_LABEL_TOTAL permanecen en el contrato para ese layout
 * combinado futuro; los perfiles WEIGHT/COUNT actuales no codifican total.
 */
export const assertScaleLabelVersionPublishable = (rules: ScaleLabelRulesInput): void => {
    if (rules.valueKind === 'TOTAL_PRICE') {
        throw new ScaleLabelServiceError(
            'TOTAL_PRICE_REQUIRES_WEIGHT',
            422,
            'La etiqueta solo contiene precio total y no permite recuperar un peso fiable. Reimprimí con peso/cantidad o facturá el peso manualmente.',
        );
    }
    if (rules.pricePolicy !== 'RECALCULATE') {
        throw new ScaleLabelServiceError(
            'PRICE_POLICY_REQUIRES_ENCODED_TOTAL',
            422,
            `La política ${rules.pricePolicy} exige un total impreso, pero el layout ${rules.valueKind} actual solo codifica peso/cantidad. Usá RECALCULATE hasta configurar un layout que incluya ambos valores.`,
        );
    }
};

const serializeProduct = (product: ProductSummary) => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    price: product.price,
    saleMode: product.saleMode,
    quantityStep: product.quantityStep?.toString() ?? null,
});

export const serializeScaleLabelVersion = (version: VersionRecord) => ({
    id: version.id,
    profileId: version.profileId,
    profileVersionId: version.id,
    version: version.version,
    name: version.profile.name,
    status: version.status,
    ...rulesFromVersion(version),
    publishedAt: version.publishedAt?.toISOString() ?? null,
    revokedAt: version.revokedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    mappings: version.mappings.map((mapping) => ({
        id: mapping.id,
        plu: mapping.plu,
        productId: mapping.productId,
        sourceUnit: mapping.sourceUnit,
        product: serializeProduct(mapping.product),
    })),
});

const mappingData = (
    tenantId: string,
    profileVersionId: string,
    mappings: ScaleProductMappingInput[],
) => mappings.map((mapping) => ({
    tenantId,
    profileVersionId,
    plu: mapping.plu.trim(),
    productId: mapping.productId,
    sourceUnit: mapping.sourceUnit.trim(),
}));

const assertMappings = async (
    db: PrismaLike,
    tenantId: string,
    rules: ScaleLabelRulesInput,
    mappings: ScaleProductMappingInput[],
    options: { requireAtLeastOne: boolean },
): Promise<void> => {
    if (options.requireAtLeastOne && mappings.length === 0) {
        throw new ScaleLabelServiceError(
            'INVALID_MAPPING',
            400,
            'Una versión publicada requiere al menos un mapeo PLU',
        );
    }

    const seenPlus = new Set<string>();
    for (const mapping of mappings) {
        const plu = mapping.plu.trim();
        if (!new RegExp(`^\\d{${rules.itemLength}}$`).test(plu)) {
            throw new ScaleLabelServiceError(
                'INVALID_MAPPING',
                400,
                `El PLU ${plu || '(vacío)'} debe tener exactamente ${rules.itemLength} dígitos`,
            );
        }
        if (seenPlus.has(plu)) {
            throw new ScaleLabelServiceError('INVALID_MAPPING', 400, `El PLU ${plu} está duplicado`);
        }
        seenPlus.add(plu);
        if (!mapping.sourceUnit.trim()) {
            throw new ScaleLabelServiceError('INVALID_MAPPING', 400, `El PLU ${plu} no tiene unidad fuente`);
        }
    }

    const productIds = [...new Set(mappings.map((mapping) => mapping.productId))];
    const products = await db.product.findMany({
        where: { tenantId, id: { in: productIds } },
        select: {
            id: true,
            name: true,
            unit: true,
            saleMode: true,
        },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));

    for (const mapping of mappings) {
        const product = productsById.get(mapping.productId);
        if (!product) {
            throw new ScaleLabelServiceError(
                'INVALID_MAPPING',
                400,
                `El producto ${mapping.productId} no pertenece a este negocio`,
            );
        }
        if (product.saleMode !== 'MEASURED') {
            throw new ScaleLabelServiceError(
                'PRODUCT_NOT_MEASURED',
                409,
                `El producto ${product.name} debe configurarse como MEASURED antes de mapearlo`,
            );
        }
        if (rules.valueKind !== 'TOTAL_PRICE') {
            try {
                convertQuantity('1', mapping.sourceUnit as QuantityUnit, product.unit as QuantityUnit);
            } catch (error) {
                throw new ScaleLabelServiceError(
                    'INVALID_MAPPING',
                    400,
                    error instanceof Error
                        ? `PLU ${mapping.plu}: ${error.message}`
                        : `PLU ${mapping.plu}: unidades incompatibles`,
                );
            }
        } else if (mapping.sourceUnit.trim().toLowerCase() !== product.unit.trim().toLowerCase()) {
            throw new ScaleLabelServiceError(
                'INVALID_MAPPING',
                400,
                `PLU ${mapping.plu}: en TOTAL_PRICE la unidad del mapping debe ser ${product.unit}`,
            );
        }
    }
};

const audit = (
    db: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    action: string,
    details: Record<string, unknown>,
) => db.auditLog.create({
    data: {
        tenantId,
        userId,
        action,
        details: JSON.stringify(details),
    },
});

const createVersionData = (
    tenantId: string,
    profileId: string,
    version: number,
    userId: string,
    rules: ScaleLabelRulesInput,
) => ({
    tenantId,
    profileId,
    version,
    status: 'DRAFT',
    symbology: rules.symbology,
    totalLength: rules.totalLength,
    prefixes: rules.prefixes,
    itemStart: rules.itemStart,
    itemLength: rules.itemLength,
    valueStart: rules.valueStart,
    valueLength: rules.valueLength,
    valueKind: rules.valueKind,
    impliedDecimals: rules.impliedDecimals,
    sourceUnit: rules.sourceUnit,
    checksumMode: rules.checksumMode,
    pricePolicy: rules.pricePolicy,
    roundingTolerance: new Decimal(rules.roundingTolerance),
    minValue: new Decimal(rules.minValue),
    maxValue: new Decimal(rules.maxValue),
    createdBy: userId,
});

export async function getActiveScaleLabelContext(db: PrismaLike, tenantId: string) {
    const versions = await db.scaleLabelProfileVersion.findMany({
        where: {
            tenantId,
            status: 'PUBLISHED',
            revokedAt: null,
            profile: { tenantId, status: 'ACTIVE' },
        },
        include: VERSION_INCLUDE,
        orderBy: [{ profileId: 'asc' }, { version: 'desc' }],
    }) as unknown as VersionRecord[];

    versions.forEach((version) => assertVersionTenantIntegrity(version, tenantId));

    try {
        validateScaleLabelProfiles(versions.map(buildScaleLabelParserProfile));
    } catch (error) {
        throw profileSetError(error, 'Los perfiles publicados no son válidos');
    }

    const profiles = versions.map(serializeScaleLabelVersion);
    const cacheMaterial = profiles.map((profile) => ({
        ...profile,
        createdAt: undefined,
        publishedAt: undefined,
        revokedAt: undefined,
    }));
    const cacheVersion = createHash('sha256')
        .update(JSON.stringify(cacheMaterial))
        .digest('hex');

    return {
        schemaVersion: 1 as const,
        cacheVersion,
        generatedAt: new Date().toISOString(),
        profiles,
    };
}

export async function listScaleLabelProfiles(db: PrismaLike, tenantId: string) {
    const profiles = await db.scaleLabelProfile.findMany({
        where: { tenantId },
        include: {
            versions: {
                include: VERSION_INCLUDE,
                orderBy: { version: 'desc' },
            },
        },
        orderBy: { name: 'asc' },
    });

    return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        status: profile.status,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
        versions: (profile.versions as unknown as VersionRecord[]).map((version) => {
            assertVersionTenantIntegrity(version, tenantId);
            return serializeScaleLabelVersion(version);
        }),
    }));
}

export async function listScaleLabelProfileVersions(
    db: PrismaLike,
    tenantId: string,
    profileId: string,
) {
    const profile = await db.scaleLabelProfile.findFirst({ where: { id: profileId, tenantId } });
    if (!profile) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Perfil de balanza no encontrado');

    const versions = await db.scaleLabelProfileVersion.findMany({
        where: { tenantId, profileId },
        include: VERSION_INCLUDE,
        orderBy: { version: 'desc' },
    }) as unknown as VersionRecord[];
    versions.forEach((version) => assertVersionTenantIntegrity(version, tenantId));
    return versions.map(serializeScaleLabelVersion);
}

export async function createScaleLabelProfile(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    input: CreateScaleLabelProfileInput,
) {
    const rules = normalizeRules(input);
    const mappings = input.mappings ?? [];

    return db.$transaction(async (tx) => {
        await assertMappings(tx, tenantId, rules, mappings, { requireAtLeastOne: false });
        const profile = await tx.scaleLabelProfile.create({
            data: { tenantId, name: input.name.trim(), status: 'ACTIVE' },
        });
        const version = await tx.scaleLabelProfileVersion.create({
            data: createVersionData(tenantId, profile.id, 1, userId, rules),
        });
        if (mappings.length > 0) {
            await tx.scaleProductMapping.createMany({
                data: mappingData(tenantId, version.id, mappings),
            });
        }
        await audit(tx, tenantId, userId, 'SCALE_LABEL_PROFILE_CREATED', {
            profileId: profile.id,
            profileVersionId: version.id,
            version: version.version,
            mappingCount: mappings.length,
        });
        const saved = await tx.scaleLabelProfileVersion.findFirstOrThrow({
            where: { id: version.id, tenantId },
            include: VERSION_INCLUDE,
        });
        return {
            id: profile.id,
            name: profile.name,
            status: profile.status,
            createdAt: profile.createdAt.toISOString(),
            updatedAt: profile.updatedAt.toISOString(),
            versions: [serializeScaleLabelVersion(saved as unknown as VersionRecord)],
        };
    });
}

export async function createScaleLabelDraftVersion(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    profileId: string,
    input: ScaleLabelDraftInput,
) {
    const rules = normalizeRules(input);
    const mappings = input.mappings ?? [];

    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const profile = await tx.scaleLabelProfile.findFirst({ where: { id: profileId, tenantId } });
        if (!profile) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Perfil de balanza no encontrado');
        await assertMappings(tx, tenantId, rules, mappings, { requireAtLeastOne: false });
        const latest = await tx.scaleLabelProfileVersion.findFirst({
            where: { tenantId, profileId },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        const version = await tx.scaleLabelProfileVersion.create({
            data: createVersionData(tenantId, profileId, (latest?.version ?? 0) + 1, userId, rules),
        });
        if (mappings.length > 0) {
            await tx.scaleProductMapping.createMany({
                data: mappingData(tenantId, version.id, mappings),
            });
        }
        await audit(tx, tenantId, userId, 'SCALE_LABEL_DRAFT_CREATED', {
            profileId,
            profileVersionId: version.id,
            version: version.version,
            mappingCount: mappings.length,
        });
        const saved = await tx.scaleLabelProfileVersion.findFirstOrThrow({
            where: { id: version.id, tenantId },
            include: VERSION_INCLUDE,
        });
        return serializeScaleLabelVersion(saved as unknown as VersionRecord);
    });
}

export async function updateScaleLabelDraftVersion(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    versionId: string,
    input: ScaleLabelDraftInput,
) {
    const rules = normalizeRules(input);

    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const existing = await tx.scaleLabelProfileVersion.findFirst({
            where: { id: versionId, tenantId, status: 'DRAFT' },
            include: VERSION_INCLUDE,
        }) as unknown as VersionRecord | null;
        if (!existing) {
            throw new ScaleLabelServiceError(
                'INVALID_STATE',
                409,
                'Solo se pueden editar versiones en borrador',
            );
        }
        assertVersionTenantIntegrity(existing, tenantId);

        if (input.mappings !== undefined) {
            await assertMappings(tx, tenantId, rules, input.mappings, { requireAtLeastOne: false });
        } else {
            await assertMappings(
                tx,
                tenantId,
                rules,
                existing.mappings.map((mapping) => ({
                    plu: mapping.plu,
                    productId: mapping.productId,
                    sourceUnit: mapping.sourceUnit,
                })),
                { requireAtLeastOne: false },
            );
        }

        await tx.scaleLabelProfileVersion.update({
            where: { id: existing.id },
            data: {
                symbology: rules.symbology,
                totalLength: rules.totalLength,
                prefixes: rules.prefixes,
                itemStart: rules.itemStart,
                itemLength: rules.itemLength,
                valueStart: rules.valueStart,
                valueLength: rules.valueLength,
                valueKind: rules.valueKind,
                impliedDecimals: rules.impliedDecimals,
                sourceUnit: rules.sourceUnit,
                checksumMode: rules.checksumMode,
                pricePolicy: rules.pricePolicy,
                roundingTolerance: new Decimal(rules.roundingTolerance),
                minValue: new Decimal(rules.minValue),
                maxValue: new Decimal(rules.maxValue),
            },
        });
        if (input.mappings !== undefined) {
            await tx.scaleProductMapping.deleteMany({ where: { tenantId, profileVersionId: existing.id } });
            if (input.mappings.length > 0) {
                await tx.scaleProductMapping.createMany({
                    data: mappingData(tenantId, existing.id, input.mappings),
                });
            }
        }
        await audit(tx, tenantId, userId, 'SCALE_LABEL_DRAFT_UPDATED', {
            profileId: existing.profileId,
            profileVersionId: existing.id,
            version: existing.version,
            mappingsReplaced: input.mappings !== undefined,
        });
        const saved = await tx.scaleLabelProfileVersion.findFirstOrThrow({
            where: { id: existing.id, tenantId },
            include: VERSION_INCLUDE,
        });
        return serializeScaleLabelVersion(saved as unknown as VersionRecord);
    });
}

export async function replaceScaleProductMappings(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    versionId: string,
    mappings: ScaleProductMappingInput[],
) {
    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const version = await tx.scaleLabelProfileVersion.findFirst({
            where: { id: versionId, tenantId, status: 'DRAFT' },
            include: VERSION_INCLUDE,
        }) as unknown as VersionRecord | null;
        if (!version) {
            throw new ScaleLabelServiceError('INVALID_STATE', 409, 'Los mapeos solo se editan en un borrador');
        }
        assertVersionTenantIntegrity(version, tenantId);
        const rules = normalizeRules(rulesFromVersion(version));
        await assertMappings(tx, tenantId, rules, mappings, { requireAtLeastOne: false });
        await tx.scaleProductMapping.deleteMany({ where: { tenantId, profileVersionId: version.id } });
        if (mappings.length > 0) {
            await tx.scaleProductMapping.createMany({
                data: mappingData(tenantId, version.id, mappings),
            });
        }
        await audit(tx, tenantId, userId, 'SCALE_LABEL_MAPPINGS_REPLACED', {
            profileId: version.profileId,
            profileVersionId: version.id,
            mappingCount: mappings.length,
        });
        const saved = await tx.scaleLabelProfileVersion.findFirstOrThrow({
            where: { id: version.id, tenantId },
            include: VERSION_INCLUDE,
        });
        return serializeScaleLabelVersion(saved as unknown as VersionRecord);
    });
}

export async function deleteScaleLabelDraftVersion(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    versionId: string,
) {
    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const version = await tx.scaleLabelProfileVersion.findFirst({
            where: { id: versionId, tenantId, status: 'DRAFT' },
            select: { id: true, profileId: true, version: true },
        });
        if (!version) {
            throw new ScaleLabelServiceError('INVALID_STATE', 409, 'Solo se puede eliminar un borrador');
        }
        await tx.scaleProductMapping.deleteMany({ where: { tenantId, profileVersionId: version.id } });
        await tx.scaleLabelProfileVersion.delete({ where: { id: version.id } });
        await audit(tx, tenantId, userId, 'SCALE_LABEL_DRAFT_DELETED', {
            profileId: version.profileId,
            profileVersionId: version.id,
            version: version.version,
        });
        return { deleted: true as const };
    });
}

export async function publishScaleLabelVersion(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    versionId: string,
) {
    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const target = await tx.scaleLabelProfileVersion.findFirst({
            where: {
                id: versionId,
                tenantId,
                status: 'DRAFT',
                profile: { tenantId, status: 'ACTIVE' },
            },
            include: VERSION_INCLUDE,
        }) as unknown as VersionRecord | null;
        if (!target) {
            throw new ScaleLabelServiceError(
                'INVALID_STATE',
                409,
                'La versión debe ser un borrador de un perfil activo',
            );
        }
        assertVersionTenantIntegrity(target, tenantId);

        const rules = normalizeRules(rulesFromVersion(target));
        assertScaleLabelVersionPublishable(rules);
        const mappings = target.mappings.map((mapping) => ({
            plu: mapping.plu,
            productId: mapping.productId,
            sourceUnit: mapping.sourceUnit,
        }));
        await assertMappings(tx, tenantId, rules, mappings, { requireAtLeastOne: true });

        const otherPublished = await tx.scaleLabelProfileVersion.findMany({
            where: {
                tenantId,
                status: 'PUBLISHED',
                revokedAt: null,
                profileId: { not: target.profileId },
                profile: { tenantId, status: 'ACTIVE' },
            },
            include: VERSION_INCLUDE,
        }) as unknown as VersionRecord[];
        otherPublished.forEach((version) => assertVersionTenantIntegrity(version, tenantId));
        try {
            validateScaleLabelProfiles([
                ...otherPublished.map(buildScaleLabelParserProfile),
                buildScaleLabelParserProfile(target),
            ]);
        } catch (error) {
            throw profileSetError(error, 'El perfil no puede publicarse');
        }

        const previous = await tx.scaleLabelProfileVersion.findMany({
            where: {
                tenantId,
                profileId: target.profileId,
                status: 'PUBLISHED',
                revokedAt: null,
            },
            select: { id: true, version: true },
        });
        const now = new Date();
        await tx.scaleLabelProfileVersion.updateMany({
            where: {
                tenantId,
                profileId: target.profileId,
                status: 'PUBLISHED',
                revokedAt: null,
            },
            data: { status: 'REVOKED', revokedAt: now },
        });
        await tx.scaleLabelProfileVersion.update({
            where: { id: target.id },
            data: { status: 'PUBLISHED', publishedAt: now, revokedAt: null },
        });
        await audit(tx, tenantId, userId, 'SCALE_LABEL_VERSION_PUBLISHED', {
            profileId: target.profileId,
            profileVersionId: target.id,
            version: target.version,
            replacedVersions: previous,
            mappingCount: mappings.length,
        });
        const saved = await tx.scaleLabelProfileVersion.findFirstOrThrow({
            where: { id: target.id, tenantId },
            include: VERSION_INCLUDE,
        });
        return serializeScaleLabelVersion(saved as unknown as VersionRecord);
    });
}

export async function revokeScaleLabelVersion(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    versionId: string,
) {
    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const version = await tx.scaleLabelProfileVersion.findFirst({
            where: { id: versionId, tenantId, status: 'PUBLISHED', revokedAt: null },
            select: { id: true, profileId: true, version: true },
        });
        if (!version) {
            throw new ScaleLabelServiceError('INVALID_STATE', 409, 'La versión no está publicada');
        }
        const revokedAt = new Date();
        await tx.scaleLabelProfileVersion.update({
            where: { id: version.id },
            data: { status: 'REVOKED', revokedAt },
        });
        await audit(tx, tenantId, userId, 'SCALE_LABEL_VERSION_REVOKED', {
            profileId: version.profileId,
            profileVersionId: version.id,
            version: version.version,
            revokedAt: revokedAt.toISOString(),
        });
        return { revoked: true as const, revokedAt: revokedAt.toISOString() };
    });
}

export async function updateScaleLabelProfile(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    profileId: string,
    patch: { name?: string; status?: 'ACTIVE' | 'INACTIVE' },
) {
    return db.$transaction(async (tx) => {
        await lockTenantConfiguration(tx, tenantId);
        const existing = await tx.scaleLabelProfile.findFirst({ where: { id: profileId, tenantId } });
        if (!existing) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Perfil de balanza no encontrado');

        if (patch.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
            const becomingActive = await tx.scaleLabelProfileVersion.findMany({
                where: { tenantId, profileId, status: 'PUBLISHED', revokedAt: null },
                include: VERSION_INCLUDE,
            }) as unknown as VersionRecord[];
            const currentlyActive = await tx.scaleLabelProfileVersion.findMany({
                where: {
                    tenantId,
                    profileId: { not: profileId },
                    status: 'PUBLISHED',
                    revokedAt: null,
                    profile: { tenantId, status: 'ACTIVE' },
                },
                include: VERSION_INCLUDE,
            }) as unknown as VersionRecord[];
            [...becomingActive, ...currentlyActive]
                .forEach((version) => assertVersionTenantIntegrity(version, tenantId));
            try {
                validateScaleLabelProfiles(
                    [...currentlyActive, ...becomingActive].map(buildScaleLabelParserProfile),
                );
            } catch (error) {
                throw profileSetError(error, 'El perfil no puede activarse');
            }
        }

        const updated = await tx.scaleLabelProfile.update({
            where: { id: existing.id },
            data: {
                ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                ...(patch.status !== undefined ? { status: patch.status } : {}),
            },
        });
        await audit(tx, tenantId, userId, 'SCALE_LABEL_PROFILE_UPDATED', {
            profileId,
            before: { name: existing.name, status: existing.status },
            after: { name: updated.name, status: updated.status },
        });
        return {
            id: updated.id,
            name: updated.name,
            status: updated.status,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

export interface ResolveScaleLabelInput {
    db: PrismaLike;
    tenantId: string;
    profileVersionId: string;
    rawCode: string;
    allowRevokedForReplay?: boolean;
}

const resolveScaleLabelInternal = async (
    input: ResolveScaleLabelInput,
    mode: 'SALE' | 'PREVIEW',
) => {
    const version = await input.db.scaleLabelProfileVersion.findFirst({
        where: { id: input.profileVersionId, tenantId: input.tenantId },
        include: VERSION_INCLUDE,
    }) as unknown as VersionRecord | null;
    if (!version) {
        throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Versión de perfil no encontrada');
    }
    assertVersionTenantIntegrity(version, input.tenantId);
    // Sync identifica la versión exacta almacenada offline, pero una revocación
    // es un gate humano: debe ganar sobre checksum, mapping, TOTAL_PRICE o
    // cualquier otro error del payload para que nunca se reinterprete/acepte.
    if (
        mode === 'SALE'
        && version.status === 'REVOKED'
        && input.allowRevokedForReplay === true
    ) {
        throw new ScaleLabelServiceError(
            'REVOKED_RECONCILIATION_REQUIRED',
            409,
            'La etiqueta usa una versión revocada y requiere conciliación antes de facturar.',
        );
    }
    const canParse = mode === 'PREVIEW'
        ? version.status === 'DRAFT'
            || version.status === 'PUBLISHED'
            || version.status === 'REVOKED'
        : version.status === 'PUBLISHED'
            ? version.profile.status === 'ACTIVE' || input.allowRevokedForReplay === true
            : version.status === 'REVOKED' && input.allowRevokedForReplay === true;
    if (!canParse) {
        throw new ScaleLabelServiceError(
            'INVALID_STATE',
            409,
            version.status === 'DRAFT'
                ? 'Una venta nunca puede usar un perfil en borrador'
                : 'La versión del perfil ya no acepta lecturas nuevas',
        );
    }

    const parsed = parseScaleLabelWithProfile(input.rawCode, buildScaleLabelParserProfile(version));
    const mapping = version.mappings.find((candidate) => candidate.plu === parsed.plu);
    if (!mapping || mapping.tenantId !== input.tenantId || mapping.product.tenantId !== input.tenantId) {
        throw new ScaleLabelServiceError(
            'INVALID_MAPPING',
            422,
            `No existe un producto mapeado para el PLU ${parsed.plu}`,
        );
    }
    if (mapping.product.saleMode !== 'MEASURED') {
        throw new ScaleLabelServiceError(
            'PRODUCT_NOT_MEASURED',
            409,
            'El producto mapeado ya no está configurado como medido',
        );
    }

    const sourceValue = new Decimal(parsed.value);
    const unitPrice = new Decimal(mapping.product.price);
    const codeHash = createHash('sha256').update(parsed.normalizedCode).digest('hex');
    let baseQuantity: Decimal | null;
    let encodedPrice: Decimal | null = null;
    if (parsed.valueKind === 'TOTAL_PRICE') {
        encodedPrice = sourceValue;
        baseQuantity = null;
        if (mode === 'SALE' || version.status !== 'DRAFT') {
            throw new ScaleLabelServiceError(
                'TOTAL_PRICE_REQUIRES_WEIGHT',
                422,
                'La etiqueta solo contiene precio total; Nortex no inferirá el peso usando el precio vigente. Reimprimí una etiqueta con peso o capturá el peso manualmente.',
            );
        }
    } else {
        baseQuantity = convertQuantity(
            sourceValue.toString(),
            mapping.sourceUnit as QuantityUnit,
            mapping.product.unit as QuantityUnit,
        );
    }

    if (baseQuantity !== null) {
        const step = mapping.product.quantityStep?.toString() ?? '0.0001';
        baseQuantity = validateQuantity(baseQuantity.toString(), {
            saleMode: 'MEASURED',
            quantityStep: step,
        });
    }

    const calculatedTotal = baseQuantity === null
        ? null
        : baseQuantity.mul(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
        profileVersion: {
            id: version.id,
            profileId: version.profileId,
            version: version.version,
            status: version.status as ScaleLabelVersionStatus,
            pricePolicy: assertKnownPolicy(version.pricePolicy),
            roundingTolerance: version.roundingTolerance.toString(),
        },
        mapping: {
            id: mapping.id,
            plu: mapping.plu,
            productId: mapping.productId,
            sourceUnit: mapping.sourceUnit,
        },
        product: serializeProduct(mapping.product),
        parsed: {
            plu: parsed.plu,
            value: parsed.value,
            valueKind: parsed.valueKind,
            // En TOTAL_PRICE el valor fuente es moneda (p. ej. NIO), no la
            // unidad de inventario declarada por el mapping.
            sourceUnit: parsed.valueKind === 'TOTAL_PRICE'
                ? parsed.sourceUnit
                : mapping.sourceUnit,
        },
        baseQuantity: baseQuantity?.toFixed(baseQuantity.decimalPlaces()) ?? null,
        encodedPrice: encodedPrice?.toFixed(encodedPrice.decimalPlaces()) ?? null,
        calculatedTotal: calculatedTotal?.toFixed(2) ?? null,
        quantityResolution: baseQuantity === null
            ? 'MANUAL_REQUIRED' as const
            : 'FROM_LABEL_VALUE' as const,
        requiresManualQuantity: baseQuantity === null,
        codeHash,
    };
};

/** Resolución autoritativa para ventas: jamás admite un draft. */
export const resolveScaleLabel = (input: ResolveScaleLabelInput) =>
    resolveScaleLabelInternal(input, 'SALE');

/** Resolución transitoria para la pantalla de configuración; no persiste nada. */
export const previewScaleLabelVersion = (
    input: Omit<ResolveScaleLabelInput, 'allowRevokedForReplay'>,
) => resolveScaleLabelInternal(input, 'PREVIEW');

export async function resolveActiveScaleLabel(
    db: PrismaLike,
    tenantId: string,
    rawCode: string,
) {
    const versions = await db.scaleLabelProfileVersion.findMany({
        where: {
            tenantId,
            status: 'PUBLISHED',
            revokedAt: null,
            profile: { tenantId, status: 'ACTIVE' },
        },
        include: VERSION_INCLUDE,
    }) as unknown as VersionRecord[];
    versions.forEach((version) => assertVersionTenantIntegrity(version, tenantId));
    const parsed = tryParseScaleLabel(rawCode, versions.map(buildScaleLabelParserProfile));
    if (!parsed) return null;
    return resolveScaleLabel({
        db,
        tenantId,
        profileVersionId: parsed.profileId,
        rawCode,
    });
}

export async function getScaleProductMappings(
    db: PrismaLike,
    tenantId: string,
    versionId: string,
) {
    const version = await db.scaleLabelProfileVersion.findFirst({
        where: { id: versionId, tenantId },
        include: VERSION_INCLUDE,
    }) as unknown as VersionRecord | null;
    if (!version) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Versión de perfil no encontrada');
    assertVersionTenantIntegrity(version, tenantId);
    return version.mappings.map((mapping) => ({
        id: mapping.id,
        plu: mapping.plu,
        productId: mapping.productId,
        sourceUnit: mapping.sourceUnit,
        product: serializeProduct(mapping.product),
    }));
}

const serializeScaleDevice = (device: {
    id: string;
    name: string;
    manufacturer: string | null;
    model: string | null;
    transport: string;
    protocolKey: string;
    adapterVersion: string;
    status: string;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) => ({
    id: device.id,
    name: device.name,
    manufacturer: device.manufacturer,
    model: device.model,
    transport: device.transport,
    protocolKey: device.protocolKey,
    adapterVersion: device.adapterVersion,
    status: device.status,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
});

export const validateScaleDeviceConfiguration = (input: ScaleDeviceInput): void => {
    if (!(SCALE_DEVICE_TRANSPORTS as readonly string[]).includes(input.transport)) {
        throw new ScaleLabelServiceError('INVALID_DEVICE', 400, 'Transporte de balanza no permitido');
    }
    if (!(SCALE_DEVICE_PROTOCOLS as readonly string[]).includes(input.protocolKey)) {
        throw new ScaleLabelServiceError('INVALID_DEVICE', 400, 'Protocolo de balanza no permitido');
    }
    if (!(SCALE_ADAPTER_VERSIONS as readonly string[]).includes(input.adapterVersion)) {
        throw new ScaleLabelServiceError('INVALID_DEVICE', 400, 'Versión de adaptador no permitida');
    }
    const expectedProtocol = input.transport === 'SIMULATOR'
        ? 'SIMULATOR_V1'
        : input.transport === 'LOCAL_BRIDGE'
            ? 'NORTEX_LOCAL_BRIDGE_V1'
            : 'GENERIC_ASCII_WEIGHT_V1';
    if (input.protocolKey !== expectedProtocol) {
        throw new ScaleLabelServiceError(
            'INVALID_DEVICE',
            400,
            `El transporte ${input.transport} requiere el protocolo ${expectedProtocol}`,
        );
    }
    if (!input.name.trim()) {
        throw new ScaleLabelServiceError('INVALID_DEVICE', 400, 'El nombre de la balanza es requerido');
    }
};

export async function listScaleDevices(db: PrismaLike, tenantId: string) {
    const devices = await db.scaleDevice.findMany({
        where: { tenantId },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return devices.map(serializeScaleDevice);
}

export async function getScaleDevice(db: PrismaLike, tenantId: string, deviceId: string) {
    const device = await db.scaleDevice.findFirst({ where: { id: deviceId, tenantId } });
    if (!device) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Balanza no encontrada');
    return serializeScaleDevice(device);
}

export async function createScaleDevice(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    input: ScaleDeviceInput,
) {
    validateScaleDeviceConfiguration(input);
    return db.$transaction(async (tx) => {
        const device = await tx.scaleDevice.create({
            data: {
                tenantId,
                name: input.name.trim(),
                manufacturer: input.manufacturer?.trim() || null,
                model: input.model?.trim() || null,
                transport: input.transport,
                protocolKey: input.protocolKey,
                adapterVersion: input.adapterVersion,
                status: input.status ?? 'ACTIVE',
                config: Prisma.JsonNull,
                createdBy: userId,
            },
        });
        await audit(tx, tenantId, userId, 'SCALE_DEVICE_CREATED', {
            deviceId: device.id,
            name: device.name,
            transport: device.transport,
            protocolKey: device.protocolKey,
            adapterVersion: device.adapterVersion,
            status: device.status,
        });
        return serializeScaleDevice(device);
    });
}

export async function updateScaleDevice(
    db: PrismaClient,
    tenantId: string,
    userId: string,
    deviceId: string,
    patch: Partial<ScaleDeviceInput>,
) {
    return db.$transaction(async (tx) => {
        const existing = await tx.scaleDevice.findFirst({ where: { id: deviceId, tenantId } });
        if (!existing) throw new ScaleLabelServiceError('NOT_FOUND', 404, 'Balanza no encontrada');
        const nextConfiguration: ScaleDeviceInput = {
            name: patch.name ?? existing.name,
            manufacturer: patch.manufacturer === undefined ? existing.manufacturer : patch.manufacturer,
            model: patch.model === undefined ? existing.model : patch.model,
            transport: (patch.transport ?? existing.transport) as ScaleDeviceTransport,
            protocolKey: (patch.protocolKey ?? existing.protocolKey) as ScaleDeviceProtocol,
            adapterVersion: (patch.adapterVersion ?? existing.adapterVersion) as ScaleAdapterVersion,
            status: (patch.status ?? existing.status) as ScaleDeviceInput['status'],
        };
        validateScaleDeviceConfiguration(nextConfiguration);
        const updated = await tx.scaleDevice.update({
            where: { id: existing.id },
            data: {
                ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                ...(patch.manufacturer !== undefined
                    ? { manufacturer: patch.manufacturer?.trim() || null }
                    : {}),
                ...(patch.model !== undefined ? { model: patch.model?.trim() || null } : {}),
                ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
                ...(patch.protocolKey !== undefined ? { protocolKey: patch.protocolKey } : {}),
                ...(patch.adapterVersion !== undefined ? { adapterVersion: patch.adapterVersion } : {}),
                ...(patch.status !== undefined ? { status: patch.status } : {}),
            },
        });
        await audit(tx, tenantId, userId, 'SCALE_DEVICE_UPDATED', {
            deviceId: existing.id,
            before: {
                name: existing.name,
                manufacturer: existing.manufacturer,
                model: existing.model,
                transport: existing.transport,
                protocolKey: existing.protocolKey,
                adapterVersion: existing.adapterVersion,
                status: existing.status,
            },
            after: {
                name: updated.name,
                manufacturer: updated.manufacturer,
                model: updated.model,
                transport: updated.transport,
                protocolKey: updated.protocolKey,
                adapterVersion: updated.adapterVersion,
                status: updated.status,
            },
        });
        return serializeScaleDevice(updated);
    });
}
