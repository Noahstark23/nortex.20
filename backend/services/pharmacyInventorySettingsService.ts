import { Prisma, type PrismaClient } from '@prisma/client';
import {
    createBatchWarehouseReadinessService,
    type BatchWarehouseReadinessService,
} from './batchWarehouseReadinessService.js';
import prisma from '../lib/prisma.js';

export const PHARMACY_INVENTORY_MODES = ['OFF', 'ENFORCED'] as const;
export type PharmacyInventoryMode = typeof PHARMACY_INVENTORY_MODES[number];

export type PharmacyInventorySettingsErrorCode =
    | 'PHARMACY_INVENTORY_INVALID_INPUT'
    | 'PHARMACY_INVENTORY_TENANT_NOT_FOUND'
    | 'PHARMACY_INVENTORY_FORBIDDEN'
    | 'PHARMACY_INVENTORY_TENANT_TYPE_REQUIRED'
    | 'PHARMACY_INVENTORY_BATCH_LEDGER_NOT_ENFORCED'
    | 'PHARMACY_INVENTORY_READINESS_BLOCKED'
    | 'PHARMACY_INVENTORY_READINESS_STALE'
    | 'PHARMACY_INVENTORY_OPEN_HOLDS'
    | 'PHARMACY_INVENTORY_CONFIGURATION_INVALID'
    | 'PHARMACY_INVENTORY_CONCURRENT_WRITE';

export class PharmacyInventorySettingsError extends Error {
    constructor(
        readonly code: PharmacyInventorySettingsErrorCode,
        readonly httpStatus: number,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'PharmacyInventorySettingsError';
    }
}

type Database = PrismaClient;
type PrismaTx = Prisma.TransactionClient;
type ReadinessReport = Awaited<ReturnType<BatchWarehouseReadinessService['readiness']>>;
type ReadinessBlocker = ReadinessReport['data']['enforcementBlockers'][number];

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const BATCH_WAREHOUSE_MODES = new Set(['OFF', 'SHADOW', 'ENFORCED']);
const TRANSITION_ONLY_BLOCKER = 'MODE_MUST_BE_SHADOW';

interface LockedTenantRow {
    id: string;
    type: string;
    batchWarehouseLedgerMode: string;
    pharmacyInventoryMode: string;
    pharmacyInventoryActivatedAt: Date | null;
}

export interface PharmacyInventoryReadiness {
    evaluatedBatchWarehouseLedgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
    tenantTypeEligible: boolean;
    canEnforce: boolean;
    canActivatePharmacy: boolean;
    materialBlockers: ReadinessBlocker[];
    summary: ReadinessReport['data']['summary'];
}

export interface PharmacyInventorySettingsData {
    pharmacyInventoryMode: PharmacyInventoryMode;
    pharmacyInventoryActivatedAt: Date | null;
    batchWarehouseLedgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
}

export interface PharmacyInventorySettingsResponse {
    data: PharmacyInventorySettingsData & {
        readiness: PharmacyInventoryReadiness;
    };
}

export interface SetPharmacyInventoryModeResponse {
    data: PharmacyInventorySettingsData & {
        changed: boolean;
        readiness: PharmacyInventoryReadiness | null;
    };
}

const normalizeAuthenticatedId = (value: string, field: 'tenantId' | 'userId'): string => {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 191) {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_INVALID_INPUT',
            400,
            `${field} autenticado no es válido`,
        );
    }
    return normalized;
};

const normalizePharmacyMode = (value: unknown): PharmacyInventoryMode => {
    if (value === 'OFF' || value === 'ENFORCED') return value;
    throw new PharmacyInventorySettingsError(
        'PHARMACY_INVENTORY_CONFIGURATION_INVALID',
        500,
        'La configuración farmacéutica guardada no es válida',
    );
};

const normalizeRequestedMode = (value: unknown): PharmacyInventoryMode => {
    if (value === 'OFF' || value === 'ENFORCED') return value;
    throw new PharmacyInventorySettingsError(
        'PHARMACY_INVENTORY_INVALID_INPUT',
        400,
        'mode debe ser OFF o ENFORCED',
    );
};

const normalizeBatchMode = (value: unknown): 'OFF' | 'SHADOW' | 'ENFORCED' => {
    if (typeof value === 'string' && BATCH_WAREHOUSE_MODES.has(value)) {
        return value as 'OFF' | 'SHADOW' | 'ENFORCED';
    }
    throw new PharmacyInventorySettingsError(
        'PHARMACY_INVENTORY_CONFIGURATION_INVALID',
        500,
        'La configuración lote-bodega guardada no es válida',
    );
};

const assertPharmacyTenant = (type: string): void => {
    if (type !== 'FARMACIA') {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_TENANT_TYPE_REQUIRED',
            409,
            'La seguridad de vencimientos solo puede activarse en un negocio tipo FARMACIA',
        );
    }
};

const assertBatchLedgerEnforced = (mode: string): void => {
    if (normalizeBatchMode(mode) !== 'ENFORCED') {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_BATCH_LEDGER_NOT_ENFORCED',
            409,
            'Primero debés activar ENFORCED en el subledger lote-bodega',
        );
    }
};

const assertAdministrativeActor = async (
    database: Pick<Database, 'user'> | Pick<PrismaTx, 'user'>,
    tenantId: string,
    userId: string,
): Promise<void> => {
    const actor = await database.user.findFirst({
        where: { id: userId, tenantId, status: 'ACTIVE' },
        select: { id: true, role: true },
    });
    if (!actor || !ADMIN_ROLES.has(actor.role)) {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_FORBIDDEN',
            403,
            'Solo OWNER, ADMIN o SUPER_ADMIN pueden cambiar esta configuración',
        );
    }
};

const materialEnforcementBlockers = (report: ReadinessReport): ReadinessBlocker[] =>
    report.data.enforcementBlockers.filter(blocker => blocker.code !== TRANSITION_ONLY_BLOCKER);

const summarizeReadiness = (
    report: ReadinessReport,
    configuredBatchMode: string,
    configuredTenantType: string,
): PharmacyInventoryReadiness => {
    const evaluatedBatchWarehouseLedgerMode = normalizeBatchMode(report.data.mode);
    const batchWarehouseLedgerMode = normalizeBatchMode(configuredBatchMode);
    const materialBlockers = materialEnforcementBlockers(report);
    return {
        evaluatedBatchWarehouseLedgerMode,
        tenantTypeEligible: configuredTenantType === 'FARMACIA',
        canEnforce: report.data.canEnforce,
        canActivatePharmacy:
            configuredTenantType === 'FARMACIA'
            && batchWarehouseLedgerMode === 'ENFORCED'
            && evaluatedBatchWarehouseLedgerMode === 'ENFORCED'
            && materialBlockers.length === 0,
        materialBlockers,
        summary: report.data.summary,
    };
};

const assertActivationReadiness = (
    readiness: PharmacyInventoryReadiness,
    configuredBatchMode: string,
): void => {
    const batchWarehouseLedgerMode = normalizeBatchMode(configuredBatchMode);
    if (readiness.evaluatedBatchWarehouseLedgerMode !== batchWarehouseLedgerMode) {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_READINESS_STALE',
            409,
            'El modo lote-bodega cambió durante la evaluación; volvé a intentarlo',
        );
    }
    if (!readiness.canActivatePharmacy) {
        throw new PharmacyInventorySettingsError(
            'PHARMACY_INVENTORY_READINESS_BLOCKED',
            409,
            'El inventario lote-bodega todavía tiene bloqueos para activar farmacia',
            { blockers: readiness.materialBlockers },
        );
    }
};

const isPrismaCode = (error: unknown, code: string): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === code
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === code;

/**
 * Barrera de activación para MySQL/InnoDB.
 *
 * La transacción que llama este helper usa SERIALIZABLE: cada SELECT simple se
 * convierte en un locking read compartido y el scan tenant-scoped toma
 * next-key locks. Los COUNT devuelven una sola fila al proceso, pero reservan
 * todos los rangos que alimentan readiness, incluidos gaps para nuevos inserts.
 */
const lockActivationReadinessSources = async (
    tx: PrismaTx,
    tenantId: string,
): Promise<void> => {
    const sourceScans = [
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM Product WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM ProductBatch WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM ProductStock WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM ProductBatchWarehouseStock WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM ProductBatchLedgerEntry WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM Sale WHERE tenantId = ${tenantId}`,
        Prisma.sql`
            SELECT COUNT(si.id) AS rowCount
            FROM SaleItem si
            INNER JOIN Sale s ON s.id = si.saleId
            WHERE s.tenantId = ${tenantId}
        `,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM SaleItemBatchAllocation WHERE tenantId = ${tenantId}`,
        Prisma.sql`SELECT COUNT(id) AS rowCount FROM KardexMovement WHERE tenantId = ${tenantId}`,
    ];
    for (const query of sourceScans) await tx.$queryRaw(query);
};

export function createPharmacyInventorySettingsService(
    database: Database = prisma,
    readinessService: Pick<
        BatchWarehouseReadinessService,
        'readiness' | 'readinessInTransaction'
    > =
        createBatchWarehouseReadinessService(database),
    now: () => Date = () => new Date(),
) {
    return {
        async getSettings(tenantId: string): Promise<PharmacyInventorySettingsResponse> {
            const scopedTenantId = normalizeAuthenticatedId(tenantId, 'tenantId');
            const [tenant, report] = await Promise.all([
                database.tenant.findFirst({
                    where: { id: scopedTenantId },
                    select: {
                        type: true,
                        pharmacyInventoryMode: true,
                        pharmacyInventoryActivatedAt: true,
                        batchWarehouseLedgerMode: true,
                    },
                }),
                readinessService.readiness(scopedTenantId, { limit: 1 }),
            ]);
            if (!tenant) {
                throw new PharmacyInventorySettingsError(
                    'PHARMACY_INVENTORY_TENANT_NOT_FOUND',
                    404,
                    'El negocio autenticado no existe',
                );
            }

            return {
                data: {
                    pharmacyInventoryMode: normalizePharmacyMode(tenant.pharmacyInventoryMode),
                    pharmacyInventoryActivatedAt: tenant.pharmacyInventoryActivatedAt,
                    batchWarehouseLedgerMode: normalizeBatchMode(tenant.batchWarehouseLedgerMode),
                    readiness: summarizeReadiness(
                        report,
                        tenant.batchWarehouseLedgerMode,
                        tenant.type,
                    ),
                },
            };
        },

        async setMode(
            tenantId: string,
            userId: string,
            requestedMode: unknown,
        ): Promise<SetPharmacyInventoryModeResponse> {
            const scopedTenantId = normalizeAuthenticatedId(tenantId, 'tenantId');
            const scopedUserId = normalizeAuthenticatedId(userId, 'userId');
            const mode = normalizeRequestedMode(requestedMode);
            let readiness: PharmacyInventoryReadiness | null = null;

            if (mode === 'ENFORCED') {
                const [previewTenant] = await Promise.all([
                    database.tenant.findFirst({
                        where: { id: scopedTenantId },
                        select: { id: true, type: true, batchWarehouseLedgerMode: true },
                    }),
                    assertAdministrativeActor(database, scopedTenantId, scopedUserId),
                ]);
                if (!previewTenant) {
                    throw new PharmacyInventorySettingsError(
                        'PHARMACY_INVENTORY_TENANT_NOT_FOUND',
                        404,
                        'El negocio autenticado no existe',
                    );
                }
                assertPharmacyTenant(previewTenant.type);
                assertBatchLedgerEnforced(previewTenant.batchWarehouseLedgerMode);

                const report = await readinessService.readiness(scopedTenantId, { limit: 1 });
                readiness = summarizeReadiness(
                    report,
                    previewTenant.batchWarehouseLedgerMode,
                    previewTenant.type,
                );
                assertActivationReadiness(readiness, previewTenant.batchWarehouseLedgerMode);
            }

            try {
                return await database.$transaction(async tx => {
                    const lockedRows = await tx.$queryRaw<LockedTenantRow[]>(Prisma.sql`
                        SELECT
                            id,
                            type,
                            batchWarehouseLedgerMode,
                            pharmacyInventoryMode,
                            pharmacyInventoryActivatedAt
                        FROM Tenant
                        WHERE id = ${scopedTenantId}
                        FOR UPDATE
                    `);
                    const lockedTenant = lockedRows[0];
                    if (!lockedTenant) {
                        throw new PharmacyInventorySettingsError(
                            'PHARMACY_INVENTORY_TENANT_NOT_FOUND',
                            404,
                            'El negocio autenticado no existe',
                        );
                    }
                    await assertAdministrativeActor(tx, scopedTenantId, scopedUserId);

                    const previousMode = normalizePharmacyMode(lockedTenant.pharmacyInventoryMode);
                    const batchWarehouseLedgerMode = normalizeBatchMode(
                        lockedTenant.batchWarehouseLedgerMode,
                    );
                    if (mode === 'ENFORCED') {
                        assertPharmacyTenant(lockedTenant.type);
                        assertBatchLedgerEnforced(batchWarehouseLedgerMode);
                        await lockActivationReadinessSources(tx, scopedTenantId);
                        const lockedReport = await readinessService.readinessInTransaction(
                            tx,
                            scopedTenantId,
                            { limit: 1 },
                        );
                        readiness = summarizeReadiness(
                            lockedReport,
                            batchWarehouseLedgerMode,
                            lockedTenant.type,
                        );
                        // La evaluación que autoriza la escritura ocurre DESPUÉS
                        // del lock de Tenant y dentro de esta misma transacción.
                        assertActivationReadiness(readiness, batchWarehouseLedgerMode);
                    }
                    if (mode === 'OFF') {
                        const openHeldStock = await tx.productBatchWarehouseStock.findFirst({
                            where: {
                                tenantId: scopedTenantId,
                                heldStock: { gt: 0 },
                            },
                            select: { id: true },
                        });
                        if (openHeldStock) {
                            throw new PharmacyInventorySettingsError(
                                'PHARMACY_INVENTORY_OPEN_HOLDS',
                                409,
                                'No podés apagar farmacia mientras exista stock retenido',
                            );
                        }
                    }

                    const changed = previousMode !== mode;
                    const activatedAt = mode === 'ENFORCED'
                        ? lockedTenant.pharmacyInventoryActivatedAt ?? now()
                        : null;
                    const update = await tx.tenant.updateMany({
                        where: { id: scopedTenantId },
                        data: {
                            pharmacyInventoryMode: mode,
                            pharmacyInventoryActivatedAt: activatedAt,
                        },
                    });
                    if (update.count !== 1) {
                        throw new PharmacyInventorySettingsError(
                            'PHARMACY_INVENTORY_CONCURRENT_WRITE',
                            409,
                            'La configuración cambió al mismo tiempo; volvé a intentarlo',
                        );
                    }

                    await tx.auditLog.create({
                        data: {
                            tenantId: scopedTenantId,
                            userId: scopedUserId,
                            action: 'PHARMACY_INVENTORY_MODE_SET',
                            details: JSON.stringify({
                                version: 1,
                                before: {
                                    mode: previousMode,
                                    activatedAt: lockedTenant.pharmacyInventoryActivatedAt,
                                },
                                after: { mode, activatedAt },
                                changed,
                                tenantType: lockedTenant.type,
                                batchWarehouseLedgerMode,
                                activationReadiness: readiness && mode === 'ENFORCED'
                                    ? {
                                        canEnforce: readiness.canEnforce,
                                        canActivatePharmacy: readiness.canActivatePharmacy,
                                        materialBlockers: readiness.materialBlockers,
                                    }
                                    : null,
                            }),
                        },
                    });

                    return {
                        data: {
                            pharmacyInventoryMode: mode,
                            pharmacyInventoryActivatedAt: activatedAt,
                            batchWarehouseLedgerMode,
                            changed,
                            readiness: mode === 'ENFORCED' ? readiness : null,
                        },
                    };
                }, {
                    // La activación lee y decide sobre múltiples tablas del
                    // readiness; SERIALIZABLE hace que esas lecturas bloqueen a
                    // writers concurrentes hasta que el flip del Tenant cierre.
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                    maxWait: 5_000,
                    timeout: 30_000,
                });
            } catch (error) {
                if (isPrismaCode(error, 'P2034') || isPrismaCode(error, 'P2028')) {
                    throw new PharmacyInventorySettingsError(
                        'PHARMACY_INVENTORY_CONCURRENT_WRITE',
                        409,
                        'La configuración cambió al mismo tiempo; volvé a intentarlo',
                    );
                }
                throw error;
            }
        },
    };
}

export type PharmacyInventorySettingsService = ReturnType<
    typeof createPharmacyInventorySettingsService
>;
