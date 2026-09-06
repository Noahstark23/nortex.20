import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    assertAggregateBatchMutationAllowed,
    assertBatchTrackingTransitionAllowed,
    assertManualBatchReplay,
    buildManualBatchCommandId,
    buildManualBatchPayloadHash,
    buildManualBatchRelatedId,
    ManualBatchMovementError,
    parseManualBatchCommandClaim,
} from '../backend/lib/manualBatchMovements';
import { CreateBatchSchema, WriteoffBatchSchema } from '../backend/validation/schemas';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

const between = (source: string, start: string, end: string): string => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque ${start}`);
    return source.slice(from, to);
};

const createBatchRoute = between(
    server,
    "app.post('/api/inventory/batches'",
    "app.post('/api/inventory/batches/:batchId/writeoff'",
);
const writeoffRoute = between(
    server,
    "app.post('/api/inventory/batches/:batchId/writeoff'",
    "app.get('/api/inventory/expiring-soon'",
);
const adjustRoute = between(
    server,
    "app.post('/api/inventory/adjust'",
    "app.get('/api/inventory/batches/:productId'",
);
const updateProductRoute = between(
    server,
    "app.put('/api/products/:id'",
    "app.patch('/api/products/publish-bulk'",
);
const closeCountRoute = between(
    server,
    "app.post('/api/stock-counts/:id/close'",
    "app.post('/api/stock-counts/:id/cancel'",
);
const kardexRecordRoute = between(
    server,
    "app.post('/api/kardex/record'",
    '// ==========================================\n// 📊 REPORTES EMPRESARIALES',
);
const seedCatalogRoute = between(
    server,
    "app.post('/api/onboarding/seed-catalog'",
    "app.use('/api/onboarding'",
);
const createProductRoute = between(
    server,
    "app.post('/api/products'",
    "app.post('/api/products/bulk'",
);
const bulkProductRoute = between(
    server,
    "app.post('/api/products/bulk'",
    "app.put('/api/products/:id'",
);

const eventId = '123e4567-e89b-42d3-a456-426614174000';

describe('contrato de comandos manuales lote+bodega', () => {
    it('acepta solo UUID, bodega y cantidades físicas en texto exacto', () => {
        expect(CreateBatchSchema.safeParse({
            clientEventId: eventId,
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchNumber: 'L-001',
            expiryDate: '2027-01-31',
            quantity: '0.0001',
        }).success).toBe(true);
        expect(CreateBatchSchema.safeParse({
            clientEventId: eventId,
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchNumber: 'L-001',
            expiryDate: '2027-01-31',
            quantity: 0.0001,
        }).success).toBe(false);
        expect(WriteoffBatchSchema.safeParse({
            clientEventId: eventId,
            warehouseId: 'warehouse-1',
            quantity: '1.2500',
            reason: 'Producto vencido',
        }).success).toBe(true);
        expect(WriteoffBatchSchema.safeParse({
            clientEventId: eventId,
            warehouseId: 'warehouse-1',
            quantity: '1',
            reason: 'ok',
            tenantId: 'attacker-tenant',
        }).success).toBe(false);
    });

    it('deriva un claim SHA-256 estable por tenant+evento+tipo y separa el payload', () => {
        const createId = buildManualBatchCommandId({
            tenantId: 'tenant-1', clientEventId: eventId, commandType: 'MANUAL_BATCH_CREATE',
        });
        const repeated = buildManualBatchCommandId({
            tenantId: 'tenant-1', clientEventId: eventId, commandType: 'MANUAL_BATCH_CREATE',
        });
        const writeoffId = buildManualBatchCommandId({
            tenantId: 'tenant-1', clientEventId: eventId, commandType: 'MANUAL_BATCH_WRITEOFF',
        });
        expect(createId).toMatch(/^[a-f0-9]{64}$/u);
        expect(createId).toBe(repeated);
        expect(createId).not.toBe(writeoffId);
        expect(buildManualBatchPayloadHash('MANUAL_BATCH_CREATE', ['1.0000']))
            .not.toBe(buildManualBatchPayloadHash('MANUAL_BATCH_CREATE', ['2.0000']));
        expect(buildManualBatchRelatedId(createId, 'RESULT')).not.toBe(buildManualBatchRelatedId(createId, 'MOVEMENT'));
    });

    it('valida replay exacto y falla cerrado ante conflicto/corrupción', () => {
        const commandId = buildManualBatchCommandId({
            tenantId: 'tenant-1', clientEventId: eventId, commandType: 'MANUAL_BATCH_CREATE',
        });
        const payloadHash = buildManualBatchPayloadHash('MANUAL_BATCH_CREATE', ['1.0000']);
        const claim = parseManualBatchCommandClaim(JSON.stringify({
            version: 1,
            commandType: 'MANUAL_BATCH_CREATE',
            payloadHash,
            resultAuditId: buildManualBatchRelatedId(commandId, 'RESULT'),
            movementId: buildManualBatchRelatedId(commandId, 'MOVEMENT'),
            resourceId: 'batch-1',
        }));
        expect(() => assertManualBatchReplay(claim, {
            commandType: 'MANUAL_BATCH_CREATE', payloadHash,
        })).not.toThrow();
        expect(() => assertManualBatchReplay(claim, {
            commandType: 'MANUAL_BATCH_CREATE',
            payloadHash: buildManualBatchPayloadHash('MANUAL_BATCH_CREATE', ['2.0000']),
        })).toThrowError(expect.objectContaining({ code: 'MANUAL_BATCH_IDEMPOTENCY_CONFLICT' }));
        expect(() => parseManualBatchCommandClaim('{malformed')).toThrowError(
            expect.objectContaining({ code: 'MANUAL_BATCH_COMMAND_CORRUPT' }),
        );
    });

    it('OFF conserva agregado; SHADOW/ENFORCED exigen lote para cualquier delta', () => {
        expect(() => assertAggregateBatchMutationAllowed({
            mode: 'OFF', requiresBatchTracking: true, delta: '-2.0000',
        })).not.toThrow();
        expect(() => assertAggregateBatchMutationAllowed({
            mode: 'SHADOW', requiresBatchTracking: true, delta: '0',
        })).not.toThrow();
        for (const mode of ['SHADOW', 'ENFORCED'] as const) {
            expect(() => assertAggregateBatchMutationAllowed({
                mode, requiresBatchTracking: true, delta: '0.0001',
            })).toThrowError(expect.objectContaining({ code: 'BATCH_SELECTION_REQUIRED', httpStatus: 409 }));
        }
    });

    it('las transiciones de tracking fallan cerradas con stock o historial en modo activo', () => {
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'SHADOW',
            currentRequiresBatchTracking: false,
            nextRequiresBatchTracking: true,
            currentStock: '1.0000',
            hasBatchHistory: false,
        })).toThrowError(expect.objectContaining({ code: 'BATCH_SELECTION_REQUIRED' }));
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'ENFORCED',
            currentRequiresBatchTracking: true,
            nextRequiresBatchTracking: false,
            currentStock: '0',
            hasBatchHistory: true,
        })).toThrowError(expect.objectContaining({ code: 'BATCH_TRACKING_DISABLE_FORBIDDEN' }));
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'OFF',
            currentRequiresBatchTracking: true,
            nextRequiresBatchTracking: false,
            currentStock: '5',
            hasBatchHistory: true,
        })).not.toThrow();
        expect(() => assertBatchTrackingTransitionAllowed({
            mode: 'SHADOW',
            currentRequiresBatchTracking: false,
            nextRequiresBatchTracking: true,
            currentStock: '0',
            hasBatchHistory: false,
        })).not.toThrow();
    });
});

describe('integridad transaccional de alta y merma manual', () => {
    it('alta resuelve modo/actor/bodega una vez, reclama antes de efectos y enlaza sidecar exacto', () => {
        expect(createBatchRoute.match(/resolveBatchWarehouseLedgerMode\(/gu)).toHaveLength(1);
        expect(createBatchRoute).toContain("status: 'ACTIVE'");
        expect(createBatchRoute).toContain('resolveOperationalWarehouse(');
        expect(createBatchRoute).toContain('SELECT id, name, unit, stock, saleMode, quantityStep, requiresBatchTracking');
        expect(createBatchRoute.indexOf('assertBatchTrackingTransitionAllowed({'))
            .toBeLessThan(createBatchRoute.indexOf("action: 'MANUAL_BATCH_COMMAND'"));
        expect(createBatchRoute).toContain('id: commandId');
        expect(createBatchRoute.indexOf("action: 'MANUAL_BATCH_COMMAND'"))
            .toBeLessThan(createBatchRoute.indexOf('applyStockDelta(tx'));
        expect(createBatchRoute.indexOf('applyStockDelta(tx'))
            .toBeLessThan(createBatchRoute.indexOf('productBatch.upsert'));
        expect(createBatchRoute).toContain("movementType: 'ADJUSTMENT_IN'");
        expect(createBatchRoute).toContain('delta: exactDelta');
        expect(createBatchRoute).toContain('warehouseId: stockResult.warehouseId');
        expect(createBatchRoute).toContain('sourceKey: `manual-batch-create:${clientEventId}`');
        expect(createBatchRoute).toContain("action: 'PRODUCT_BATCH_ADDED'");
        expect(createBatchRoute).toContain("isolationLevel: 'ReadCommitted'");
    });

    it('reintento/conflicto se resuelve por claim único y relectura externa', () => {
        expect(createBatchRoute).toContain('loadManualBatchReplay({');
        expect(createBatchRoute).toContain('isUniqueConstraintFailure(error)');
        expect(createBatchRoute).toContain('payloadHash');
        expect(createBatchRoute).toContain('resultAuditId');
        expect(createBatchRoute).toContain('movementId');
        expect(createBatchRoute).not.toMatch(/findMany[\s\S]*MANUAL_BATCH_COMMAND/u);
        expect(writeoffRoute).toContain('loadManualBatchReplay({');
        expect(writeoffRoute).toContain('isUniqueConstraintFailure(error)');
    });

    it('merma exige ubicación/cantidad, descuenta local y agregado sin poner el lote en cero', () => {
        expect(writeoffRoute).toContain('validate(WriteoffBatchSchema)');
        expect(writeoffRoute.match(/resolveBatchWarehouseLedgerMode\(/gu)).toHaveLength(1);
        expect(writeoffRoute).toContain("status: 'ACTIVE'");
        expect(writeoffRoute).toContain("movementType: 'WRITEOFF'");
        expect(writeoffRoute).toContain('warehouseId: operationWarehouse.id');
        expect(writeoffRoute).toContain('enforceSufficient: true');
        expect(writeoffRoute).toContain('stock: { decrement: writeoffQuantity.toNumber() }');
        expect(writeoffRoute).not.toContain('data: { stock: 0 }');
        expect(writeoffRoute).not.toContain('Number(batch.stock)');
        expect(writeoffRoute).toContain('stockBefore: localStockBefore.toNumber()');
        expect(writeoffRoute).toContain('batchWarehouseStatus: batchLedger.status');
    });

    it('valúa la merma con Decimal 2dp y mantiene asiento/auditoría en la misma tx', () => {
        expect(writeoffRoute).toContain('.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)');
        expect(writeoffRoute).toContain('const journalValue = lossValue.toNumber()');
        expect(writeoffRoute).toContain("{ accountCode: '5.1.2', debit: journalValue, credit: 0 }");
        expect(writeoffRoute).toContain("{ accountCode: '1.1.4', debit: 0, credit: journalValue }");
        expect(writeoffRoute).toContain("action: 'BATCH_WRITEOFF'");
        expect(writeoffRoute.indexOf('createJournalEntry(')).toBeLessThan(writeoffRoute.indexOf("action: 'BATCH_WRITEOFF'"));
    });
});

describe('guard de mutaciones agregadas batch-tracked', () => {
    it('protege ajuste, edición de stock y kardex antes de applyStockDelta', () => {
        for (const route of [adjustRoute, updateProductRoute, kardexRecordRoute]) {
            expect(route).toContain('assertAggregateBatchMutationAllowed({');
            expect(route.indexOf('assertAggregateBatchMutationAllowed({'))
                .toBeLessThan(route.indexOf('applyStockDelta(tx'));
        }
        expect(adjustRoute).toContain('requiresBatchTracking');
        expect(updateProductRoute).toContain('lockedRequiresBatchTracking || nextRequiresBatchTracking');
        expect(kardexRecordRoute).toContain('requiresBatchTracking: product.requiresBatchTracking');
    });

    it('PUT y bulk validan ambas transiciones bajo tx y tenant antes del update', () => {
        expect(updateProductRoute).toContain('const batchTrackingChanges = nextRequiresBatchTracking !== lockedRequiresBatchTracking');
        expect(updateProductRoute).toContain('SELECT stock, requiresBatchTracking FROM');
        expect(updateProductRoute).toContain('where: { tenantId: authReq.tenantId!, productId: id }');
        expect(updateProductRoute.indexOf('assertBatchTrackingTransitionAllowed({'))
            .toBeLessThan(updateProductRoute.indexOf('const result = await tx.product.update'));
        expect(bulkProductRoute).toContain('SELECT stock, requiresBatchTracking FROM');
        expect(bulkProductRoute).toContain('lockedRequiresBatchTracking !== nextRequiresBatchTracking');
        expect(bulkProductRoute).toContain('where: { tenantId: authReq.tenantId!, productId: existing.id }');
        expect(bulkProductRoute.indexOf('assertBatchTrackingTransitionAllowed({'))
            .toBeLessThan(bulkProductRoute.indexOf('await tx.product.update({'));
    });

    it('PUT y bulk no deciden tracking con el snapshot previo al FOR UPDATE', () => {
        const putLockedDecision = between(
            updateProductRoute,
            'SELECT stock, requiresBatchTracking FROM',
            'const result = await tx.product.update',
        );
        const bulkLockedDecision = between(
            bulkProductRoute,
            'SELECT stock, requiresBatchTracking FROM',
            'await tx.product.update({',
        );

        for (const decision of [putLockedDecision, bulkLockedDecision]) {
            expect(decision).toContain('lockedRequiresBatchTracking');
            expect(decision).not.toContain('currentRequiresBatchTracking: existing.requiresBatchTracking');
            expect(decision).not.toContain('requiresBatchTracking: Boolean(existing.requiresBatchTracking');
        }
    });

    it('stock-count preflightea todas las líneas antes de aplicar una sola', () => {
        expect(closeCountRoute).toContain('const preparedItems: Array<');
        expect(closeCountRoute).toContain('for (const prepared of preparedItems) {\n                assertAggregateBatchMutationAllowed({');
        const guard = closeCountRoute.indexOf('assertAggregateBatchMutationAllowed({');
        const apply = closeCountRoute.indexOf('applyStockDelta(tx');
        const materialize = closeCountRoute.indexOf('materializeWarehouseRow(tx');
        expect(guard).toBeGreaterThan(-1);
        expect(materialize).toBeGreaterThan(guard);
        expect(apply).toBeGreaterThan(guard);
        expect(closeCountRoute.match(/resolveBatchWarehouseLedgerMode\(/gu)).toHaveLength(1);
    });

    it('stock inicial y catálogo batch-tracked quedan OFF-only, incluido bulk', () => {
        expect(seedCatalogRoute).toContain('const authoritativeBatchMode = await resolveBatchWarehouseLedgerMode(tx, tenantId)');
        expect(seedCatalogRoute.indexOf('assertAggregateBatchMutationAllowed({'))
            .toBeLessThan(seedCatalogRoute.indexOf('applyStockDelta(tx'));
        expect(createProductRoute).toContain('const authoritativeBatchMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!)');
        expect(createProductRoute.indexOf('assertAggregateBatchMutationAllowed({'))
            .toBeLessThan(createProductRoute.indexOf('applyStockDelta(tx'));
        expect(bulkProductRoute).toContain('const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!)');
        expect(bulkProductRoute).toContain('lockedRequiresBatchTracking || nextRequiresBatchTracking');
        expect(bulkProductRoute).toContain('requiresBatchTracking: nextRequiresBatchTracking');
        expect(bulkProductRoute).toContain('requiresBatchTracking: Boolean(normalized.requiresBatchTracking)');
    });
});

// Verifica la clase por separado para que los callers puedan mapear siempre 409.
expect(new ManualBatchMovementError('BATCH_SELECTION_REQUIRED', 409, 'x').httpStatus).toBe(409);

// Ronda HTTP contra MySQL descartable. La suite normal la omite; la compuerta
// test:integration:required exige estos dos casos con NORTEX_QA_BASE_URL.
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/u, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = { status: number; body: T };
let qaToken = '';
let qaDefaultWarehouseId = '';
let qaSecondaryWarehouseId = '';
let qaProductId = '';
let qaBatchId = '';
let qaRunId = '';

async function qaApi<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (qaToken) headers.set('authorization', `Bearer ${qaToken}`);
    const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    let body: any = null;
    if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: response.status, body };
}

const qaPost = <T = any>(path: string, body: unknown) =>
    qaApi<T>(path, { method: 'POST', body: JSON.stringify(body) });

const expectQaStatus = (result: ApiResult, expected: number) =>
    expect(result.status, JSON.stringify(result.body)).toBe(expected);

qaDescribe('QA HTTP: comandos manuales de lote', () => {
    beforeAll(async () => {
        qaRunId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const registration = await qaPost('/api/auth/register', {
            companyName: `QA Lotes ${qaRunId}`,
            email: `qa-lotes-${qaRunId}@example.invalid`,
            password: `Qa-${qaRunId}-Seguro!`,
            type: 'FARMACIA',
        });
        expectQaStatus(registration, 200);
        qaToken = registration.body.token;

        const warehouses = await qaApi('/api/warehouses');
        expectQaStatus(warehouses, 200);
        qaDefaultWarehouseId = warehouses.body.data.find((warehouse: any) => warehouse.isDefault).id;
        const secondary = await qaPost('/api/warehouses', { name: `Sucursal Lotes ${qaRunId}` });
        expectQaStatus(secondary, 201);
        qaSecondaryWarehouseId = secondary.body.data.id;

        const product = await qaPost('/api/products', {
            name: `QA Carne ${qaRunId}`,
            sku: `QA-BATCH-${qaRunId}`,
            category: 'QA Lotes',
            price: '20.00',
            cost: '8.00',
            stock: '0',
            minStock: '0',
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
            requiresBatchTracking: true,
            ivaExento: false,
        });
        expectQaStatus(product, 200);
        qaProductId = product.body.id;
    }, 120_000);

    it('replay exacto no duplica stock y payload distinto devuelve conflicto', async () => {
        const clientEventId = crypto.randomUUID();
        const payload = {
            clientEventId,
            productId: qaProductId,
            warehouseId: qaDefaultWarehouseId,
            batchNumber: `LOTE-${qaRunId}`,
            expiryDate: '2027-12-31',
            quantity: '2.0000',
        };
        const created = await qaPost('/api/inventory/batches', payload);
        expectQaStatus(created, 200);
        qaBatchId = created.body.batch.id;

        const replay = await qaPost('/api/inventory/batches', payload);
        expectQaStatus(replay, 200);
        expect(replay.body).toEqual(created.body);

        const conflict = await qaPost('/api/inventory/batches', { ...payload, quantity: '3.0000' });
        expectQaStatus(conflict, 409);
        expect(conflict.body.code).toBe('MANUAL_BATCH_IDEMPOTENCY_CONFLICT');

        const batches = await qaApi(`/api/inventory/batches/${qaProductId}`);
        expectQaStatus(batches, 200);
        expect(Number(batches.body.find((batch: any) => batch.id === qaBatchId).stock)).toBe(2);
    }, 120_000);

    it('merma es local, replayable y no pone en cero el saldo de otras bodegas', async () => {
        const secondaryEntry = await qaPost('/api/inventory/batches', {
            clientEventId: crypto.randomUUID(),
            productId: qaProductId,
            warehouseId: qaSecondaryWarehouseId,
            batchNumber: `LOTE-${qaRunId}`,
            expiryDate: '2027-12-31',
            quantity: '3.0000',
        });
        expectQaStatus(secondaryEntry, 200);

        const writeoffPayload = {
            clientEventId: crypto.randomUUID(),
            warehouseId: qaDefaultWarehouseId,
            quantity: '1.0000',
            reason: 'Merma QA controlada',
        };
        const writeoff = await qaPost(`/api/inventory/batches/${qaBatchId}/writeoff`, writeoffPayload);
        expectQaStatus(writeoff, 200);
        expect(writeoff.body.batchStock).toBe('4.0000');
        expect(writeoff.body.warehouseStock).toBe('1.0000');

        const replay = await qaPost(`/api/inventory/batches/${qaBatchId}/writeoff`, writeoffPayload);
        expectQaStatus(replay, 200);
        expect(replay.body).toEqual(writeoff.body);

        const rejected = await qaPost(`/api/inventory/batches/${qaBatchId}/writeoff`, {
            clientEventId: crypto.randomUUID(),
            warehouseId: qaDefaultWarehouseId,
            quantity: '2.0000',
            reason: 'Intento superior al saldo local',
        });
        expectQaStatus(rejected, 409);
        expect(rejected.body.code).toBe('INSUFFICIENT_STOCK');

        const batches = await qaApi(`/api/inventory/batches/${qaProductId}`);
        expectQaStatus(batches, 200);
        expect(Number(batches.body.find((batch: any) => batch.id === qaBatchId).stock)).toBe(4);
    }, 120_000);
});
