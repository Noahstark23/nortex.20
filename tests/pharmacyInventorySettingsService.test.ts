import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));

import {
    createPharmacyInventorySettingsService,
    PharmacyInventorySettingsError,
} from '../backend/services/pharmacyInventorySettingsService';

const FIXED_NOW = new Date('2026-08-31T20:00:00.000Z');

const cleanReadiness = (overrides: Record<string, unknown> = {}) => ({
    data: {
        mode: 'ENFORCED',
        activatedAt: new Date('2026-08-30T20:00:00.000Z'),
        canEnterShadow: false,
        // El readiness lote-bodega conserva su semántica transicional: una vez
        // ENFORCED, canEnforce es false por MODE_MUST_BE_SHADOW.
        canEnforce: false,
        blockers: [{
            scope: 'ENFORCED',
            code: 'MODE_MUST_BE_SHADOW',
            message: 'ENFORCED solo puede evaluarse desde SHADOW',
        }],
        shadowBlockers: [],
        enforcementBlockers: [{
            scope: 'ENFORCED',
            code: 'MODE_MUST_BE_SHADOW',
            message: 'ENFORCED solo puede evaluarse desde SHADOW',
        }],
        summary: {
            totalBatchCount: 2,
            activeBatchCount: 2,
            mismatchedBatchCount: 0,
            aggregateStock: '4.0000',
            localStock: '4.0000',
            difference: '0.0000',
            mismatchedProductWarehouseCount: 0,
            mismatchedProductWarehouseDelta: '0.0000',
            legacyAllocationCount: 0,
            incompleteTrackedSaleItemCount: 0,
            incompleteTrackedSaleAllocationDelta: '0.0000',
            incompletePedidoBatchReservationCount: 0,
            unresolvedShadowGapCount: 0,
            unresolvedShadowGapQuantityDelta: '0.0000',
            unresolvedShadowGapDeltaRequired: '0.0000',
        },
        batches: [],
        legacyAllocationExamples: [],
        incompleteTrackedSaleExamples: [],
        productWarehouseMismatchExamples: [],
        incompletePedidoBatchReservationExamples: [],
        shadowGapExamples: [],
        ...overrides,
    },
    pageInfo: { limit: 1, nextCursor: null },
});

const makeHarness = (tenantOverrides: Record<string, unknown> = {}) => {
    const lockedTenant = {
        id: 'tenant-pharmacy',
        type: 'FARMACIA',
        batchWarehouseLedgerMode: 'ENFORCED',
        pharmacyInventoryMode: 'OFF',
        pharmacyInventoryActivatedAt: null,
        ...tenantOverrides,
    };
    const tenantFindFirst = vi.fn(async ({ where, select }: any) => {
        if (where.id !== 'tenant-pharmacy') return null;
        if (select.type && !select.pharmacyInventoryMode) {
            return {
                id: lockedTenant.id,
                type: lockedTenant.type,
                batchWarehouseLedgerMode: lockedTenant.batchWarehouseLedgerMode,
            };
        }
        return {
            type: lockedTenant.type,
            pharmacyInventoryMode: lockedTenant.pharmacyInventoryMode,
            pharmacyInventoryActivatedAt: lockedTenant.pharmacyInventoryActivatedAt,
            batchWarehouseLedgerMode: lockedTenant.batchWarehouseLedgerMode,
        };
    });
    const userFindFirst = vi.fn(async ({ where }: any) => (
        where.id === 'user-admin'
        && where.tenantId === 'tenant-pharmacy'
        && where.status === 'ACTIVE'
            ? { id: 'user-admin', role: 'ADMIN' }
            : null
    ));
    const tx = {
        $queryRaw: vi.fn(async (_query: unknown) => [lockedTenant]),
        tenant: { updateMany: vi.fn(async () => ({ count: 1 })) },
        user: { findFirst: userFindFirst },
        productBatchWarehouseStock: { findFirst: vi.fn(async () => null) },
        auditLog: { create: vi.fn(async ({ data }: any) => ({ id: 'audit-1', ...data })) },
    };
    const transaction = vi.fn(async (
        callback: (client: typeof tx) => unknown,
        options?: unknown,
    ) => {
        expect(options).toEqual({
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5_000,
            timeout: 30_000,
        });
        return callback(tx);
    });
    const database = {
        tenant: { findFirst: tenantFindFirst },
        user: { findFirst: userFindFirst },
        $transaction: transaction,
    } as unknown as PrismaClient;
    const readiness = {
        readiness: vi.fn(async () => cleanReadiness()),
        readinessInTransaction: vi.fn(async () => cleanReadiness()),
    };
    const service = createPharmacyInventorySettingsService(
        database,
        readiness as any,
        () => FIXED_NOW,
    );
    return {
        service,
        database,
        readiness,
        tx,
        transaction,
        lockedTenant,
        tenantFindFirst,
        userFindFirst,
    };
};

const expectSettingsError = async (
    promise: Promise<unknown>,
    code: string,
    httpStatus: number,
) => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(PharmacyInventorySettingsError);
        expect(error).toMatchObject({ code, httpStatus });
        return error as PharmacyInventorySettingsError;
    }
    throw new Error('Se esperaba PharmacyInventorySettingsError');
};

describe('PharmacyInventorySettingsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('expone settings tenant-scoped y deriva readiness farmacéutico sin alterar canEnforce', async () => {
        const { service, readiness, tenantFindFirst } = makeHarness();

        const response = await service.getSettings(' tenant-pharmacy ');

        expect(tenantFindFirst).toHaveBeenCalledWith({
            where: { id: 'tenant-pharmacy' },
            select: {
                type: true,
                pharmacyInventoryMode: true,
                pharmacyInventoryActivatedAt: true,
                batchWarehouseLedgerMode: true,
            },
        });
        expect(readiness.readiness).toHaveBeenCalledWith('tenant-pharmacy', { limit: 1 });
        expect(response.data).toMatchObject({
            pharmacyInventoryMode: 'OFF',
            pharmacyInventoryActivatedAt: null,
            batchWarehouseLedgerMode: 'ENFORCED',
            readiness: {
                evaluatedBatchWarehouseLedgerMode: 'ENFORCED',
                tenantTypeEligible: true,
                canEnforce: false,
                canActivatePharmacy: true,
                materialBlockers: [],
            },
        });
    });

    it('no anuncia activación disponible para un tenant que no es FARMACIA', async () => {
        const { service } = makeHarness({ type: 'RETAIL' });

        const response = await service.getSettings('tenant-pharmacy');

        expect(response.data.readiness).toMatchObject({
            tenantTypeEligible: false,
            canActivatePharmacy: false,
            materialBlockers: [],
        });
    });

    it('activa ENFORCED tras el readiness limpio, revalida bajo lock y audita atómicamente', async () => {
        const { service, readiness, tx, userFindFirst } = makeHarness();

        const result = await service.setMode(' tenant-pharmacy ', ' user-admin ', 'ENFORCED');

        expect(readiness.readiness).toHaveBeenCalledOnce();
        expect(readiness.readinessInTransaction).toHaveBeenCalledWith(
            tx,
            'tenant-pharmacy',
            { limit: 1 },
        );
        expect(userFindFirst).toHaveBeenCalledTimes(2);
        expect(userFindFirst).toHaveBeenNthCalledWith(2, {
            where: {
                id: 'user-admin',
                tenantId: 'tenant-pharmacy',
                status: 'ACTIVE',
            },
            select: { id: true, role: true },
        });
        const lockQuery = tx.$queryRaw.mock.calls[0][0] as {
            strings?: readonly string[];
            values?: readonly unknown[];
        };
        expect(lockQuery.strings?.join('?')).toContain('FROM Tenant');
        expect(lockQuery.strings?.join('?')).toContain('FOR UPDATE');
        expect(lockQuery.values).toEqual(['tenant-pharmacy']);
        const readinessBarrierSql = tx.$queryRaw.mock.calls
            .slice(1)
            .map(([query]: any[]) => query.strings?.join('?') ?? '')
            .join('\n');
        for (const table of [
            'Product',
            'ProductBatch',
            'ProductStock',
            'ProductBatchWarehouseStock',
            'ProductBatchLedgerEntry',
            'Sale',
            'SaleItem',
            'SaleItemBatchAllocation',
            'KardexMovement',
        ]) {
            expect(readinessBarrierSql).toContain(table);
        }
        expect(tx.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: 'tenant-pharmacy' },
            data: {
                pharmacyInventoryMode: 'ENFORCED',
                pharmacyInventoryActivatedAt: FIXED_NOW,
            },
        });
        expect(tx.auditLog.create).toHaveBeenCalledOnce();
        const audit = tx.auditLog.create.mock.calls[0][0].data;
        expect(audit).toMatchObject({
            tenantId: 'tenant-pharmacy',
            userId: 'user-admin',
            action: 'PHARMACY_INVENTORY_MODE_SET',
        });
        expect(JSON.parse(audit.details)).toMatchObject({
            before: { mode: 'OFF', activatedAt: null },
            after: { mode: 'ENFORCED', activatedAt: FIXED_NOW.toISOString() },
            changed: true,
            tenantType: 'FARMACIA',
            batchWarehouseLedgerMode: 'ENFORCED',
            activationReadiness: {
                canEnforce: false,
                canActivatePharmacy: true,
                materialBlockers: [],
            },
        });
        expect(result.data).toMatchObject({
            pharmacyInventoryMode: 'ENFORCED',
            pharmacyInventoryActivatedAt: FIXED_NOW,
            batchWarehouseLedgerMode: 'ENFORCED',
            changed: true,
            readiness: { canActivatePharmacy: true },
        });
    });

    it('rechaza cualquier blocker material aunque el único transicional sea ignorable', async () => {
        const { service, readiness, tx } = makeHarness();
        readiness.readiness.mockResolvedValueOnce(cleanReadiness({
            enforcementBlockers: [
                {
                    scope: 'ENFORCED',
                    code: 'MODE_MUST_BE_SHADOW',
                    message: 'Transición ya consumada',
                },
                {
                    scope: 'ENFORCED',
                    code: 'BATCH_BALANCE_MISMATCH',
                    message: 'Saldo inconsistente',
                    count: 1,
                    deltaRequired: '1.0000',
                },
            ],
        }) as any);

        const error = await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            'PHARMACY_INVENTORY_READINESS_BLOCKED',
            409,
        );

        expect(error.details).toEqual({
            blockers: [expect.objectContaining({ code: 'BATCH_BALANCE_MISMATCH' })],
        });
        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('rechaza si el readiness cambia después del preview y antes de escribir bajo lock', async () => {
        const { service, readiness, tx } = makeHarness();
        readiness.readinessInTransaction.mockResolvedValueOnce(cleanReadiness({
            enforcementBlockers: [
                {
                    scope: 'ENFORCED',
                    code: 'MODE_MUST_BE_SHADOW',
                    message: 'Transición ya consumada',
                },
                {
                    scope: 'ENFORCED',
                    code: 'BATCH_BALANCE_MISMATCH',
                    message: 'Saldo cambió concurrentemente',
                    count: 1,
                    deltaRequired: '1.0000',
                },
            ],
        }) as any);

        await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            'PHARMACY_INVENTORY_READINESS_BLOCKED',
            409,
        );

        expect(readiness.readiness).toHaveBeenCalledOnce();
        expect(readiness.readinessInTransaction).toHaveBeenCalledWith(
            tx,
            'tenant-pharmacy',
            { limit: 1 },
        );
        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([
        {
            tenant: { type: 'RETAIL' },
            code: 'PHARMACY_INVENTORY_TENANT_TYPE_REQUIRED',
        },
        {
            tenant: { batchWarehouseLedgerMode: 'SHADOW' },
            code: 'PHARMACY_INVENTORY_BATCH_LEDGER_NOT_ENFORCED',
        },
    ])('bloquea activación antes del readiness cuando la precondición falla: $code', async ({
        tenant,
        code,
    }) => {
        const { service, readiness, tx } = makeHarness(tenant);

        await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            code,
            409,
        );

        expect(readiness.readiness).not.toHaveBeenCalled();
        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('detecta un readiness de otro modo como stale y no escribe', async () => {
        const { service, readiness, tx } = makeHarness();
        readiness.readiness.mockResolvedValueOnce(cleanReadiness({
            mode: 'SHADOW',
            canEnforce: true,
            enforcementBlockers: [],
        }) as any);

        await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            'PHARMACY_INVENTORY_READINESS_STALE',
            409,
        );
        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
    });

    it.each(['P2034', 'P2028'])('mapea %s transaccional a conflicto reintentable', async (code) => {
        const { service, transaction, tx } = makeHarness();
        transaction.mockRejectedValueOnce({ code });

        await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            'PHARMACY_INVENTORY_CONCURRENT_WRITE',
            409,
        );

        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('revalida rol persistido y falla cerrado antes de evaluar readiness', async () => {
        const harness = makeHarness();
        harness.userFindFirst.mockResolvedValue({ id: 'user-admin', role: 'CASHIER' });

        await expectSettingsError(
            harness.service.setMode('tenant-pharmacy', 'user-admin', 'ENFORCED'),
            'PHARMACY_INVENTORY_FORBIDDEN',
            403,
        );
        expect(harness.readiness.readiness).not.toHaveBeenCalled();
        expect(harness.tx.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('permite apagar explícitamente sin tocar batch mode y siempre deja auditoría', async () => {
        const activatedAt = new Date('2026-08-30T20:00:00.000Z');
        const { service, readiness, tx } = makeHarness({
            pharmacyInventoryMode: 'ENFORCED',
            pharmacyInventoryActivatedAt: activatedAt,
        });

        const result = await service.setMode('tenant-pharmacy', 'user-admin', 'OFF');

        expect(readiness.readiness).not.toHaveBeenCalled();
        expect(tx.productBatchWarehouseStock.findFirst).toHaveBeenCalledWith({
            where: {
                tenantId: 'tenant-pharmacy',
                heldStock: { gt: 0 },
            },
            select: { id: true },
        });
        expect(tx.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: 'tenant-pharmacy' },
            data: {
                pharmacyInventoryMode: 'OFF',
                pharmacyInventoryActivatedAt: null,
            },
        });
        const audit = JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details);
        expect(audit).toMatchObject({
            before: { mode: 'ENFORCED', activatedAt: activatedAt.toISOString() },
            after: { mode: 'OFF', activatedAt: null },
            changed: true,
            activationReadiness: null,
        });
        expect(result.data).toEqual({
            pharmacyInventoryMode: 'OFF',
            pharmacyInventoryActivatedAt: null,
            batchWarehouseLedgerMode: 'ENFORCED',
            changed: true,
            readiness: null,
        });
    });

    it('no permite OFF cuando queda stock retenido y consulta solo el tenant autenticado', async () => {
        const { service, tx } = makeHarness({
            pharmacyInventoryMode: 'ENFORCED',
            pharmacyInventoryActivatedAt: new Date('2026-08-30T20:00:00.000Z'),
        });
        tx.productBatchWarehouseStock.findFirst.mockResolvedValueOnce({ id: 'balance-held' });

        await expectSettingsError(
            service.setMode('tenant-pharmacy', 'user-admin', 'OFF'),
            'PHARMACY_INVENTORY_OPEN_HOLDS',
            409,
        );

        expect(tx.productBatchWarehouseStock.findFirst).toHaveBeenCalledWith({
            where: {
                tenantId: 'tenant-pharmacy',
                heldStock: { gt: 0 },
            },
            select: { id: true },
        });
        expect(tx.tenant.updateMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
});
