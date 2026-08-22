import express from 'express';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { ScaleLabelError } from '../../utils/scaleLabels';
import { QuantityValidationError } from '../../utils/quantity';
import { buildScaleLabelRejectionTelemetry } from '../lib/scaleLabelTelemetry';
import {
    SCALE_ADAPTER_VERSIONS,
    SCALE_DEVICE_PROTOCOLS,
    SCALE_DEVICE_TRANSPORTS,
    ScaleLabelServiceError,
    createScaleDevice,
    createScaleLabelDraftVersion,
    createScaleLabelProfile,
    deleteScaleLabelDraftVersion,
    getActiveScaleLabelContext,
    getScaleDevice,
    getScaleProductMappings,
    listScaleDevices,
    listScaleLabelProfileVersions,
    listScaleLabelProfiles,
    publishScaleLabelVersion,
    previewScaleLabelVersion,
    replaceScaleProductMappings,
    resolveActiveScaleLabel,
    resolveScaleLabel,
    revokeScaleLabelVersion,
    updateScaleDevice,
    updateScaleLabelDraftVersion,
    updateScaleLabelProfile,
    type CreateScaleLabelProfileInput,
    type ScaleLabelDraftInput,
} from '../services/scaleLabelService';

const router = express.Router();
export const scaleDevicesRouter = express.Router();

const CONFIG_READ_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const CONFIG_WRITE_ROLES = ['OWNER', 'ADMIN'];

const decimalSchema = z.union([
    z.string().trim().min(1).max(40).regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/, 'Decimal inválido'),
    z.number().finite(),
]).transform((value) => String(value));

const nonNegativeDecimalSchema = decimalSchema.refine(
    (value) => new Decimal(value).greaterThanOrEqualTo(0),
    'Debe ser mayor o igual a cero',
);

const positiveDecimalSchema = decimalSchema.refine(
    (value) => new Decimal(value).greaterThan(0),
    'Debe ser mayor que cero',
);

const mappingSchema = z.object({
    plu: z.string().trim().min(1).max(32),
    productId: z.string().trim().min(1).max(191),
    sourceUnit: z.string().trim().min(1).max(20),
}).strict();

const rulesShape = {
    symbology: z.literal('EAN_13'),
    totalLength: z.literal(13),
    prefixes: z.array(z.string().trim().regex(/^\d{1,12}$/)).min(1).max(10),
    itemStart: z.number().int().min(0).max(11),
    itemLength: z.number().int().min(1).max(10),
    valueStart: z.number().int().min(0).max(11),
    valueLength: z.number().int().min(1).max(10),
    valueKind: z.enum(['WEIGHT', 'TOTAL_PRICE', 'COUNT']),
    impliedDecimals: z.number().int().min(0).max(4),
    sourceUnit: z.string().trim().min(1).max(20),
    checksumMode: z.enum(['EAN13', 'NONE']),
    pricePolicy: z.enum(['RECALCULATE', 'REQUIRE_MATCH', 'ACCEPT_LABEL_TOTAL']),
    roundingTolerance: nonNegativeDecimalSchema,
    minValue: positiveDecimalSchema,
    maxValue: positiveDecimalSchema,
};

const draftSchema = z.object({
    ...rulesShape,
    mappings: z.array(mappingSchema).max(500).optional(),
}).strict();

const createProfileSchema = z.object({
    name: z.string().trim().min(1).max(120),
    ...rulesShape,
    mappings: z.array(mappingSchema).max(500).optional(),
}).strict();

const profilePatchSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict().refine(
    (value) => value.name !== undefined || value.status !== undefined,
    'Debe indicar al menos un cambio',
);

const mappingsSchema = z.object({
    mappings: z.array(mappingSchema).max(500),
}).strict();

const previewSchema = z.object({
    rawCode: z.string().min(1).max(128),
    profileVersionId: z.string().trim().min(1).max(191).optional(),
}).strict();

const idParam = z.string().trim().min(1).max(191);

const issuesMessage = (error: z.ZodError): string => error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join(' | ');

const parseBody = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw new ScaleLabelServiceError('INVALID_PROFILE', 400, issuesMessage(parsed.error));
    }
    return parsed.data;
};

const parseParam = (value: unknown, label: string): string => {
    const parsed = idParam.safeParse(value);
    if (!parsed.success) {
        throw new ScaleLabelServiceError('INVALID_PROFILE', 400, `${label} inválido`);
    }
    return parsed.data;
};

const handleError = (res: express.Response, error: unknown, operation: string) => {
    if (error instanceof ScaleLabelServiceError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
    }
    if (error instanceof ScaleLabelError) {
        return res.status(422).json({ error: error.message, code: error.code });
    }
    if (error instanceof QuantityValidationError) {
        return res.status(422).json({ error: error.message, code: error.code });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({
            error: 'Ya existe un perfil, versión o mapeo con esos datos',
            code: 'DUPLICATE',
        });
    }
    console.error(`Error ${operation}:`, error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'No pudimos completar la operación de balanza' });
};

const previewResponse = (resolved: Awaited<ReturnType<typeof resolveScaleLabel>>) => ({
    classification: 'SCALE_LABEL' as const,
    profileVersionId: resolved.profileVersion.id,
    profileVersion: resolved.profileVersion.version,
    product: resolved.product,
    plu: resolved.parsed.plu,
    sourceValue: resolved.parsed.value,
    sourceUnit: resolved.parsed.sourceUnit,
    baseQuantity: resolved.baseQuantity,
    ...(resolved.encodedPrice !== null ? { encodedPrice: resolved.encodedPrice } : {}),
    calculatedTotal: resolved.calculatedTotal,
    pricingPolicy: resolved.profileVersion.pricePolicy,
    quantityResolution: resolved.quantityResolution,
    requiresManualQuantity: resolved.requiresManualQuantity,
    codeHash: resolved.codeHash,
    warnings: resolved.requiresManualQuantity
        ? ['La etiqueta no contiene peso/cantidad; se requiere reimpresión o captura manual.']
        : [] as string[],
});

const auditPreviewRejection = async (req: any, error: unknown): Promise<void> => {
    const errorCode = error instanceof ScaleLabelServiceError
        || error instanceof ScaleLabelError
        || error instanceof QuantityValidationError
        ? error.code
        : null;
    if (!errorCode) return;

    const details = buildScaleLabelRejectionTelemetry({
        rawCode: req.body?.rawCode,
        profileVersionId: req.body?.profileVersionId,
        errorCode,
        recognized: error instanceof ScaleLabelError ? error.recognized : true,
    });
    try {
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                userId: req.userId,
                action: 'SCALE_LABEL_REJECTED',
                details: JSON.stringify(details),
            },
        });
    } catch {
        // La observabilidad no debe convertir un rechazo de dominio en 500 ni
        // revelar el payload dentro de logs de infraestructura.
        console.warn('No se pudo registrar telemetría de etiqueta rechazada');
    }
};

router.get('/active-context', authenticate, async (req: any, res) => {
    try {
        const data = await getActiveScaleLabelContext(prisma, req.tenantId);
        const etag = `"${data.cacheVersion}"`;
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        return res.json({ data });
    } catch (error) {
        return handleError(res, error, 'cargando contexto activo de etiquetas');
    }
});

// Previsualiza y resuelve contra configuración server-side. No crea ventas,
// movimientos de stock, lecturas ni bitácoras con el barcode crudo.
router.post('/preview', authenticate, async (req: any, res) => {
    try {
        const input = parseBody(previewSchema, req.body);
        const resolved = input.profileVersionId
            ? await previewScaleLabelVersion({
                db: prisma,
                tenantId: req.tenantId,
                profileVersionId: input.profileVersionId,
                rawCode: input.rawCode,
            })
            : await resolveActiveScaleLabel(prisma, req.tenantId, input.rawCode);
        if (!resolved) return res.json({ data: { classification: 'SKU' as const } });
        return res.json({ data: previewResponse(resolved) });
    } catch (error) {
        await auditPreviewRejection(req, error);
        return handleError(res, error, 'previsualizando etiqueta');
    }
});

router.get('/profiles', authenticate, checkRole(CONFIG_READ_ROLES), async (req: any, res) => {
    try {
        return res.json({ data: await listScaleLabelProfiles(prisma, req.tenantId) });
    } catch (error) {
        return handleError(res, error, 'listando perfiles');
    }
});

router.post('/profiles', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const input = parseBody(createProfileSchema, req.body);
        const data = await createScaleLabelProfile(
            prisma,
            req.tenantId,
            req.userId,
            input as CreateScaleLabelProfileInput,
        );
        return res.status(201).json({ data });
    } catch (error) {
        return handleError(res, error, 'creando perfil');
    }
});

router.patch('/profiles/:profileId', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const profileId = parseParam(req.params.profileId, 'profileId');
        const patch = parseBody(profilePatchSchema, req.body);
        return res.json({
            data: await updateScaleLabelProfile(prisma, req.tenantId, req.userId, profileId, patch),
        });
    } catch (error) {
        return handleError(res, error, 'actualizando perfil');
    }
});

router.get(
    '/profiles/:profileId/versions',
    authenticate,
    checkRole(CONFIG_READ_ROLES),
    async (req: any, res) => {
        try {
            const profileId = parseParam(req.params.profileId, 'profileId');
            return res.json({
                data: await listScaleLabelProfileVersions(prisma, req.tenantId, profileId),
            });
        } catch (error) {
            return handleError(res, error, 'listando versiones');
        }
    },
);

router.post(
    '/profiles/:profileId/versions',
    authenticate,
    checkRole(CONFIG_WRITE_ROLES),
    async (req: any, res) => {
        try {
            const profileId = parseParam(req.params.profileId, 'profileId');
            const input = parseBody(draftSchema, req.body);
            const data = await createScaleLabelDraftVersion(
                prisma,
                req.tenantId,
                req.userId,
                profileId,
                input as ScaleLabelDraftInput,
            );
            return res.status(201).json({ data });
        } catch (error) {
            return handleError(res, error, 'creando versión');
        }
    },
);

router.patch('/versions/:versionId', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const versionId = parseParam(req.params.versionId, 'versionId');
        const input = parseBody(draftSchema, req.body);
        return res.json({
            data: await updateScaleLabelDraftVersion(
                prisma,
                req.tenantId,
                req.userId,
                versionId,
                input as ScaleLabelDraftInput,
            ),
        });
    } catch (error) {
        return handleError(res, error, 'actualizando versión');
    }
});

router.delete('/versions/:versionId', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const versionId = parseParam(req.params.versionId, 'versionId');
        return res.json({
            data: await deleteScaleLabelDraftVersion(prisma, req.tenantId, req.userId, versionId),
        });
    } catch (error) {
        return handleError(res, error, 'eliminando borrador');
    }
});

router.get(
    '/versions/:versionId/mappings',
    authenticate,
    checkRole(CONFIG_READ_ROLES),
    async (req: any, res) => {
        try {
            const versionId = parseParam(req.params.versionId, 'versionId');
            return res.json({ data: await getScaleProductMappings(prisma, req.tenantId, versionId) });
        } catch (error) {
            return handleError(res, error, 'listando mapeos');
        }
    },
);

router.put(
    '/versions/:versionId/mappings',
    authenticate,
    checkRole(CONFIG_WRITE_ROLES),
    async (req: any, res) => {
        try {
            const versionId = parseParam(req.params.versionId, 'versionId');
            const { mappings } = parseBody(mappingsSchema, req.body);
            return res.json({
                data: await replaceScaleProductMappings(
                    prisma,
                    req.tenantId,
                    req.userId,
                    versionId,
                    mappings,
                ),
            });
        } catch (error) {
            return handleError(res, error, 'reemplazando mapeos');
        }
    },
);

router.post(
    '/versions/:versionId/publish',
    authenticate,
    checkRole(CONFIG_WRITE_ROLES),
    async (req: any, res) => {
        try {
            const versionId = parseParam(req.params.versionId, 'versionId');
            return res.json({
                data: await publishScaleLabelVersion(prisma, req.tenantId, req.userId, versionId),
            });
        } catch (error) {
            return handleError(res, error, 'publicando versión');
        }
    },
);

router.post(
    '/versions/:versionId/revoke',
    authenticate,
    checkRole(CONFIG_WRITE_ROLES),
    async (req: any, res) => {
        try {
            const versionId = parseParam(req.params.versionId, 'versionId');
            return res.json({
                data: await revokeScaleLabelVersion(prisma, req.tenantId, req.userId, versionId),
            });
        } catch (error) {
            return handleError(res, error, 'revocando versión');
        }
    },
);

const deviceBaseShape = {
    name: z.string().trim().min(1).max(120),
    manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    transport: z.enum(SCALE_DEVICE_TRANSPORTS),
    protocolKey: z.enum(SCALE_DEVICE_PROTOCOLS),
    adapterVersion: z.enum(SCALE_ADAPTER_VERSIONS),
    status: z.enum(['ACTIVE', 'INACTIVE', 'UNSUPPORTED']).optional(),
};

const assertDeviceCombination = (
    value: { transport?: string; protocolKey?: string },
    context: z.RefinementCtx,
) => {
    if (!value.transport || !value.protocolKey) return;
    const expected = value.transport === 'SIMULATOR'
        ? 'SIMULATOR_V1'
        : value.transport === 'LOCAL_BRIDGE'
            ? 'NORTEX_LOCAL_BRIDGE_V1'
            : 'GENERIC_ASCII_WEIGHT_V1';
    if (value.protocolKey !== expected) {
        context.addIssue({
            code: 'custom',
            path: ['protocolKey'],
            message: `El transporte ${value.transport} requiere el protocolo ${expected}`,
        });
    }
};

const createDeviceSchema = z.object(deviceBaseShape).strict().superRefine(assertDeviceCombination);
const patchDeviceSchema = z.object({
    name: deviceBaseShape.name.optional(),
    manufacturer: deviceBaseShape.manufacturer,
    model: deviceBaseShape.model,
    transport: deviceBaseShape.transport.optional(),
    protocolKey: deviceBaseShape.protocolKey.optional(),
    adapterVersion: deviceBaseShape.adapterVersion.optional(),
    status: deviceBaseShape.status,
}).strict().refine(
    (value) => Object.keys(value).length > 0,
    'Debe indicar al menos un cambio',
);

const testReadingSchema = z.object({
    state: z.enum(['STABLE', 'UNSTABLE', 'NEGATIVE', 'OVERLOAD', 'DISCONNECTED']),
    value: decimalSchema.optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    capturedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((reading, context) => {
    if (reading.state === 'STABLE') {
        if (reading.value === undefined || !new Decimal(reading.value).greaterThan(0)) {
            context.addIssue({ code: 'custom', path: ['value'], message: 'Una lectura estable requiere valor positivo' });
        }
        if (!reading.unit) {
            context.addIssue({ code: 'custom', path: ['unit'], message: 'Una lectura estable requiere unidad' });
        }
    }
});

scaleDevicesRouter.get('/', authenticate, async (req: any, res) => {
    try {
        return res.json({ data: await listScaleDevices(prisma, req.tenantId) });
    } catch (error) {
        return handleError(res, error, 'listando balanzas');
    }
});

scaleDevicesRouter.get('/:deviceId', authenticate, async (req: any, res) => {
    try {
        const deviceId = parseParam(req.params.deviceId, 'deviceId');
        return res.json({ data: await getScaleDevice(prisma, req.tenantId, deviceId) });
    } catch (error) {
        return handleError(res, error, 'obteniendo balanza');
    }
});

scaleDevicesRouter.post('/', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const input = parseBody(createDeviceSchema, req.body);
        const data = await createScaleDevice(prisma, req.tenantId, req.userId, input);
        return res.status(201).json({ data });
    } catch (error) {
        return handleError(res, error, 'creando balanza');
    }
});

scaleDevicesRouter.patch('/:deviceId', authenticate, checkRole(CONFIG_WRITE_ROLES), async (req: any, res) => {
    try {
        const deviceId = parseParam(req.params.deviceId, 'deviceId');
        const patch = parseBody(patchDeviceSchema, req.body);
        return res.json({
            data: await updateScaleDevice(prisma, req.tenantId, req.userId, deviceId, patch),
        });
    } catch (error) {
        return handleError(res, error, 'actualizando balanza');
    }
});

scaleDevicesRouter.post(
    '/:deviceId/test-reading',
    authenticate,
    checkRole(CONFIG_READ_ROLES),
    async (req: any, res) => {
        try {
            const deviceId = parseParam(req.params.deviceId, 'deviceId');
            const device = await getScaleDevice(prisma, req.tenantId, deviceId);
            const reading = parseBody(testReadingSchema, req.body);
            const value = reading.value === undefined ? null : new Decimal(reading.value);
            if (value && (!value.isFinite() || value.abs().greaterThan('99999999999999.9999'))) {
                throw new ScaleLabelServiceError('INVALID_PROFILE', 400, 'La lectura excede el rango permitido');
            }
            return res.json({
                data: {
                    classification: 'LIVE_SCALE_READING' as const,
                    device,
                    state: reading.state,
                    value: value?.toFixed(value.decimalPlaces()) ?? null,
                    unit: reading.unit ?? null,
                    capturedAt: reading.capturedAt ?? new Date().toISOString(),
                    sellable: reading.state === 'STABLE',
                    warnings: reading.state === 'STABLE'
                        ? []
                        : ['La lectura no es estable y no puede agregarse a una venta'],
                },
            });
        } catch (error) {
            return handleError(res, error, 'validando lectura de prueba');
        }
    },
);

export default router;
