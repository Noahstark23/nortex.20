import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/**
 * QA HTTP real de procurement Fase 2B (lote + bodega).
 *
 * Se omite en la suite normal porque requiere MySQL 8 y un backend descartables
 * apuntando a la misma base. Ejecucion:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3100 vitest run tests/procurementPhaseTwoB.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/u, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = { status: number; body: T };

let tenantAToken = '';
let tenantBToken = '';
let viewerToken = '';
let tenantAId = '';
let tenantBId = '';
let tenantAUserId = '';
let tenantASlug = '';
let defaultWarehouseAId = '';
let secondaryWarehouseAId = '';
let defaultWarehouseBId = '';
let secondaryWarehouseBId = '';
let productAId = '';
let productBId = '';
let batchAId = '';
let batchBId = '';

async function api<T = any>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no esta definido');
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

async function post<T = any>(path: string, body: unknown, token = tenantAToken) {
  return api<T>(path, token, { method: 'POST', body: JSON.stringify(body) });
}

async function patch<T = any>(path: string, body: unknown, token = tenantAToken) {
  return api<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) });
}

function expectStatus(result: ApiResult, expected: number) {
  expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

function fixed(value: { toFixed(digits: number): string } | null | undefined, digits = 4) {
  return value?.toFixed(digits) ?? null;
}

async function defaultWarehouse(token: string): Promise<string> {
  const result = await api('/api/warehouses', token);
  expectStatus(result, 200);
  const warehouse = result.body.data.find((candidate: any) => candidate.isDefault);
  expect(warehouse).toBeTruthy();
  return warehouse.id;
}

async function createWarehouse(token: string, name: string): Promise<string> {
  const result = await post('/api/warehouses', { name }, token);
  expectStatus(result, 201);
  return result.body.data.id;
}

async function createProduct(token: string, runId: string, label: string): Promise<string> {
  const result = await post('/api/products', {
    name: `QA 2B ${label}`,
    sku: `QA-2B-${label.toUpperCase()}-${runId}`,
    category: 'QA Procurement Fase 2B',
    price: '10.00',
    cost: '2.00',
    stock: '0',
    minStock: '0',
    unit: 'unidad',
    saleMode: 'COUNTED',
    quantityStep: '1',
    isPublished: false,
    requiresBatchTracking: false,
    ivaExento: true,
  }, token);
  expectStatus(result, 200);
  return result.body.id;
}

async function inventorySnapshot(input: {
  tenantId: string;
  productId: string;
  batchId: string;
}) {
  const [product, batch, warehouseStocks, batchWarehouseStocks] = await Promise.all([
    prisma.product.findFirst({
      where: { id: input.productId, tenantId: input.tenantId },
      select: { stock: true },
    }),
    prisma.productBatch.findFirst({
      where: { id: input.batchId, tenantId: input.tenantId },
      select: { stock: true },
    }),
    prisma.productStock.findMany({
      where: { tenantId: input.tenantId, productId: input.productId },
      orderBy: { warehouseId: 'asc' },
      select: { warehouseId: true, stock: true },
    }),
    prisma.productBatchWarehouseStock.findMany({
      where: { tenantId: input.tenantId, productId: input.productId, batchId: input.batchId },
      orderBy: { warehouseId: 'asc' },
      select: { warehouseId: true, stock: true },
    }),
  ]);
  return {
    product: Number(product?.stock),
    batch: Number(batch?.stock),
    warehouseStocks: Object.fromEntries(
      warehouseStocks.map(row => [row.warehouseId, Number(row.stock)]),
    ),
    batchWarehouseStocks: Object.fromEntries(
      batchWarehouseStocks.map(row => [row.warehouseId, row.stock.toFixed(4)]),
    ),
  };
}

function journalLineSnapshot(entry: any) {
  return Object.fromEntries(entry.lines.map((line: any) => [
    line.account.code,
    { debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) },
  ]));
}

qaDescribe('QA integracion: procurement Fase 2B lote + bodega', () => {
  beforeAll(async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const registrationA = await post('/api/auth/register', {
      companyName: `QA Procurement 2B A ${runId}`,
      email: `qa-procurement-2b-a-${runId}@example.invalid`,
      password: `Qa-${runId}-A-Seguro!`,
      type: 'MISCELANEA',
    }, '');
    expectStatus(registrationA, 200);
    tenantAToken = registrationA.body.token;
    tenantAId = registrationA.body.tenant.id;
    tenantAUserId = registrationA.body.user.id;
    const registeredSlug = registrationA.body.tenant.slug
      ?? (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantAId } })).slug;
    tenantASlug = typeof registeredSlug === 'string' && registeredSlug.trim()
      ? registeredSlug
      : `qa-procurement-2b-${runId}`.toLowerCase();
    if (!registeredSlug) {
      await prisma.tenant.update({
        where: { id: tenantAId },
        data: { slug: tenantASlug },
      });
    }

    const registrationB = await post('/api/auth/register', {
      companyName: `QA Procurement 2B B ${runId}`,
      email: `qa-procurement-2b-b-${runId}@example.invalid`,
      password: `Qa-${runId}-B-Seguro!`,
      type: 'MISCELANEA',
    }, '');
    expectStatus(registrationB, 200);
    tenantBToken = registrationB.body.token;
    tenantBId = registrationB.body.tenant.id;

    defaultWarehouseAId = await defaultWarehouse(tenantAToken);
    defaultWarehouseBId = await defaultWarehouse(tenantBToken);
    secondaryWarehouseAId = await createWarehouse(tenantAToken, `QA Secundaria A ${runId}`);
    secondaryWarehouseBId = await createWarehouse(tenantBToken, `QA Secundaria B ${runId}`);
    productAId = await createProduct(tenantAToken, runId, 'principal-a');
    productBId = await createProduct(tenantBToken, runId, 'shadow-gap-b');

    const invitation = await post('/api/team/invite', {
      email: `qa-procurement-2b-viewer-${runId}@example.invalid`,
      role: 'VIEWER',
    });
    expectStatus(invitation, 200);
    const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
      name: 'QA Viewer 2B',
      password: `Qa-${runId}-Viewer-Seguro!`,
    }, '');
    expectStatus(accepted, 200);
    viewerToken = accepted.body.token;
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('alta manual OFF es tenant-scoped, decimal exacta e idempotente por UUID', async () => {
    const clientEventId = crypto.randomUUID();
    const payload = {
      clientEventId,
      productId: productAId,
      warehouseId: defaultWarehouseAId,
      batchNumber: `LOT-A-${clientEventId.slice(0, 8)}`,
      expiryDate: '2027-12-31',
      quantity: '5.0000',
    };

    const foreign = await post('/api/inventory/batches', payload, tenantBToken);
    expectStatus(foreign, 404);

    const created = await post('/api/inventory/batches', payload);
    expectStatus(created, 200);
    batchAId = created.body.batch.id;
    expect(created.body).toMatchObject({
      warehouseId: defaultWarehouseAId,
      quantity: '5.0000',
      batchWarehouseStatus: 'OFF',
    });

    const replay = await post('/api/inventory/batches', payload);
    expectStatus(replay, 200);
    expect(replay.body).toEqual(created.body);

    const conflict = await post('/api/inventory/batches', {
      ...payload,
      quantity: '6.0000',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('MANUAL_BATCH_IDEMPOTENCY_CONFLICT');

    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual({
        product: 5,
        batch: 5,
        warehouseStocks: { [defaultWarehouseAId]: 5 },
        batchWarehouseStocks: {},
      });
    expect(await prisma.kardexMovement.count({
      where: { tenantId: tenantAId, productId: productAId, batchId: batchAId },
    })).toBe(1);
    expect(await prisma.productBatchLedgerEntry.count({
      where: { tenantId: tenantAId, productId: productAId, batchId: batchAId },
    })).toBe(0);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'MANUAL_BATCH_COMMAND' },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'PRODUCT_BATCH_ADDED' },
    })).toBe(1);
    expect(await prisma.productBatch.count({
      where: { tenantId: tenantBId, id: batchAId },
    })).toBe(0);
  }, 120_000);

  it('readiness y reconcile son admin-only, tenant-scoped e idempotentes', async () => {
    const deniedReadiness = await api('/api/batch-warehouse-ledger/readiness', viewerToken);
    expectStatus(deniedReadiness, 403);
    const deniedManual = await post('/api/inventory/batches', {
      clientEventId: crypto.randomUUID(),
      productId: productAId,
      warehouseId: defaultWarehouseAId,
      batchNumber: 'VIEWER-DENIED',
      expiryDate: '2027-12-31',
      quantity: '1.0000',
    }, viewerToken);
    expectStatus(deniedManual, 403);

    const offReadiness = await api('/api/batch-warehouse-ledger/readiness?limit=50', tenantAToken);
    expectStatus(offReadiness, 200);
    expect(offReadiness.body.data).toMatchObject({
      mode: 'OFF',
      canEnterShadow: true,
      canEnforce: false,
      summary: {
        totalBatchCount: 1,
        mismatchedBatchCount: 1,
        aggregateStock: '5.0000',
        localStock: '0.0000',
        difference: '5.0000',
      },
    });

    const clientEventId = crypto.randomUUID();
    const payload = {
      clientEventId,
      batchId: batchAId,
      reason: 'Distribucion inicial exacta en bodega principal',
      allocations: [{ warehouseId: defaultWarehouseAId, quantity: '5.0000' }],
    };
    const foreign = await post('/api/batch-warehouse-ledger/reconcile', payload, tenantBToken);
    expectStatus(foreign, 404);
    expect(foreign.body.code).toBe('BATCH_READINESS_BATCH_NOT_FOUND');

    const reconciled = await post('/api/batch-warehouse-ledger/reconcile', payload);
    expectStatus(reconciled, 201);
    expect(reconciled.body.replay).toBe(false);
    expect(reconciled.body.data).toMatchObject({
      batchId: batchAId,
      productId: productAId,
      modeObserved: 'OFF',
      aggregateStock: '5.0000',
      allocationTotal: '5.0000',
      allocations: [{
        warehouseId: defaultWarehouseAId,
        before: '0.0000',
        after: '5.0000',
        delta: '5.0000',
        ledgerStatus: 'APPLIED',
      }],
    });

    const replay = await post('/api/batch-warehouse-ledger/reconcile', payload);
    expectStatus(replay, 200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.data).toEqual(reconciled.body.data);

    const conflict = await post('/api/batch-warehouse-ledger/reconcile', {
      ...payload,
      reason: 'Mismo UUID con otra intencion',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('BATCH_READINESS_IDEMPOTENCY_CONFLICT');

    expect(await prisma.productBatchWarehouseStock.count({
      where: { tenantId: tenantAId, batchId: batchAId },
    })).toBe(1);
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        batchId: batchAId,
        movementType: 'RECONCILIATION',
        status: 'APPLIED',
      },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILIATION_COMMAND' },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILED' },
    })).toBe(1);

    await prisma.tenant.update({
      where: { id: tenantAId },
      data: {
        batchWarehouseLedgerMode: 'SHADOW',
        batchWarehouseLedgerActivatedAt: new Date(),
      },
    });
    const shadowReadiness = await api('/api/batch-warehouse-ledger/readiness', tenantAToken);
    expectStatus(shadowReadiness, 200);
    expect(shadowReadiness.body.data).toMatchObject({
      mode: 'SHADOW',
      canEnforce: true,
      summary: {
        mismatchedBatchCount: 0,
        mismatchedProductWarehouseCount: 0,
        aggregateStock: '5.0000',
        localStock: '5.0000',
        unresolvedShadowGapCount: 0,
      },
    });

    // Totales lote/global iguales, pero atribucion fisica imposible:
    // ProductStock tiene 5 en Principal y 0 en Secundaria, mientras el
    // sidecar queda 4/1. Readiness y reconcile deben fallar cerrados.
    await prisma.$transaction([
      prisma.productBatchWarehouseStock.updateMany({
        where: {
          tenantId: tenantAId,
          productId: productAId,
          batchId: batchAId,
          warehouseId: defaultWarehouseAId,
        },
        data: { stock: '4.0000' },
      }),
      prisma.productBatchWarehouseStock.create({
        data: {
          tenantId: tenantAId,
          productId: productAId,
          batchId: batchAId,
          warehouseId: secondaryWarehouseAId,
          stock: '1.0000',
        },
      }),
    ]);
    const distributionReadiness = await api('/api/batch-warehouse-ledger/readiness', tenantAToken);
    expectStatus(distributionReadiness, 200);
    expect(distributionReadiness.body.data).toMatchObject({
      mode: 'SHADOW',
      canEnforce: false,
      summary: {
        mismatchedBatchCount: 0,
        aggregateStock: '5.0000',
        localStock: '5.0000',
        difference: '0.0000',
        mismatchedProductWarehouseCount: 2,
        mismatchedProductWarehouseDelta: '2.0000',
      },
    });
    expect(distributionReadiness.body.data.enforcementBlockers)
      .toContainEqual(expect.objectContaining({
        code: 'PRODUCT_WAREHOUSE_STOCK_MISMATCH',
        count: 2,
        deltaRequired: '2.0000',
      }));

    const beforeRejectedFinal = {
      ledger: await prisma.productBatchLedgerEntry.count({
        where: { tenantId: tenantAId, batchId: batchAId },
      }),
      commands: await prisma.auditLog.count({
        where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILIATION_COMMAND' },
      }),
      results: await prisma.auditLog.count({
        where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILED' },
      }),
      inventory: await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }),
    };
    const rejectedFinal = await post('/api/batch-warehouse-ledger/reconcile', {
      clientEventId: crypto.randomUUID(),
      batchId: batchAId,
      reason: 'Distribucion final incompatible con ProductStock',
      allocations: [
        { warehouseId: defaultWarehouseAId, quantity: '4.0000' },
        { warehouseId: secondaryWarehouseAId, quantity: '1.0000' },
      ],
    });
    expectStatus(rejectedFinal, 409);
    expect(rejectedFinal.body.code).toBe('BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH');
    expect(rejectedFinal.body.details.mismatches).toContainEqual(expect.objectContaining({
      warehouseId: secondaryWarehouseAId,
      productStock: '0.0000',
      projectedLotStock: '1.0000',
      overflow: '1.0000',
    }));
    expect(await prisma.productBatchLedgerEntry.count({
      where: { tenantId: tenantAId, batchId: batchAId },
    })).toBe(beforeRejectedFinal.ledger);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILIATION_COMMAND' },
    })).toBe(beforeRejectedFinal.commands);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'BATCH_WAREHOUSE_RECONCILED' },
    })).toBe(beforeRejectedFinal.results);
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(beforeRejectedFinal.inventory);

    // Restauracion del fixture para continuar los flujos operativos exactos.
    await prisma.$transaction([
      prisma.productBatchWarehouseStock.updateMany({
        where: {
          tenantId: tenantAId,
          productId: productAId,
          batchId: batchAId,
          warehouseId: defaultWarehouseAId,
        },
        data: { stock: '5.0000' },
      }),
      prisma.productBatchWarehouseStock.updateMany({
        where: {
          tenantId: tenantAId,
          productId: productAId,
          batchId: batchAId,
          warehouseId: secondaryWarehouseAId,
        },
        data: { stock: '0.0000' },
      }),
    ]);
    const restoredReadiness = await api('/api/batch-warehouse-ledger/readiness', tenantAToken);
    expectStatus(restoredReadiness, 200);
    expect(restoredReadiness.body.data).toMatchObject({
      canEnforce: true,
      summary: {
        mismatchedBatchCount: 0,
        mismatchedProductWarehouseCount: 0,
      },
    });
  }, 120_000);

  it('merma manual SHADOW mueve subledger, stock, Kardex, asiento y auditoria una vez', async () => {
    const clientEventId = crypto.randomUUID();
    const payload = {
      clientEventId,
      warehouseId: defaultWarehouseAId,
      quantity: '1.0000',
      reason: 'Merma fisica verificada en QA',
    };
    const foreign = await post(
      `/api/inventory/batches/${batchAId}/writeoff`,
      payload,
      tenantBToken,
    );
    expectStatus(foreign, 404);

    const created = await post(`/api/inventory/batches/${batchAId}/writeoff`, payload);
    expectStatus(created, 200);
    expect(created.body).toMatchObject({
      batchId: batchAId,
      warehouseId: defaultWarehouseAId,
      quantity: '1.0000',
      warehouseStock: '4.0000',
      batchStock: '4.0000',
      lossValue: '2.00',
      batchWarehouseStatus: 'APPLIED',
    });

    const replay = await post(`/api/inventory/batches/${batchAId}/writeoff`, payload);
    expectStatus(replay, 200);
    expect(replay.body).toEqual(created.body);
    const conflict = await post(`/api/inventory/batches/${batchAId}/writeoff`, {
      ...payload,
      reason: 'Mismo UUID pero otra merma',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('MANUAL_BATCH_IDEMPOTENCY_CONFLICT');

    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual({
        product: 4,
        batch: 4,
        warehouseStocks: { [defaultWarehouseAId]: 4 },
        batchWarehouseStocks: {
          [defaultWarehouseAId]: '4.0000',
          [secondaryWarehouseAId]: '0.0000',
        },
      });
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        productId: productAId,
        batchId: batchAId,
        movementType: 'WRITEOFF',
        status: 'APPLIED',
      },
    })).toBe(1);
    expect(await prisma.kardexMovement.count({
      where: {
        tenantId: tenantAId,
        productId: productAId,
        batchId: batchAId,
        referenceType: 'BATCH_WRITEOFF',
      },
    })).toBe(1);
    const journal = await prisma.journalEntry.findFirst({
      where: { tenantId: tenantAId, referenceId: batchAId, referenceType: 'BATCH_WRITEOFF' },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(journal).toBeTruthy();
    expect(journalLineSnapshot(journal)).toEqual({
      '5.1.2': { debit: '2.00', credit: '0.00' },
      '1.1.4': { debit: '0.00', credit: '2.00' },
    });
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'BATCH_WRITEOFF' },
    })).toBe(1);
  }, 120_000);

  it('transferencia ENFORCED es exacta y SHADOW registra gap sin inventar stock local', async () => {
    await prisma.tenant.update({
      where: { id: tenantAId },
      data: { batchWarehouseLedgerMode: 'ENFORCED' },
    });
    const clientEventId = crypto.randomUUID();
    const payload = {
      clientEventId,
      fromWarehouseId: defaultWarehouseAId,
      toWarehouseId: secondaryWarehouseAId,
      notes: 'Transferencia exacta Fase 2B',
      items: [{ productId: productAId, quantity: '1.0000' }],
    };
    const foreign = await post('/api/stock-transfers', payload, tenantBToken);
    expectStatus(foreign, 404);

    const transferred = await post('/api/stock-transfers', payload);
    expectStatus(transferred, 201);
    expect(transferred.body.replay).toBe(false);
    expect(transferred.body.data).toMatchObject({
      batchLedgerMode: 'ENFORCED',
      batchTransferStatus: 'APPLIED',
    });
    expect(transferred.body.data.batchSnapshot).toMatchObject({
      mode: 'ENFORCED',
      status: 'APPLIED',
    });
    const replay = await post('/api/stock-transfers', payload);
    expectStatus(replay, 200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.data.id).toBe(transferred.body.data.id);
    const conflict = await post('/api/stock-transfers', { ...payload, notes: 'Intento divergente' });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('STOCK_TRANSFER_IDEMPOTENCY_CONFLICT');

    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual({
        product: 4,
        batch: 4,
        warehouseStocks: {
          [defaultWarehouseAId]: 3,
          [secondaryWarehouseAId]: 1,
        },
        batchWarehouseStocks: {
          [defaultWarehouseAId]: '3.0000',
          [secondaryWarehouseAId]: '1.0000',
        },
      });
    expect(await prisma.stockTransfer.count({
      where: { tenantId: tenantAId, clientEventId },
    })).toBe(1);
    expect(await prisma.kardexMovement.count({
      where: {
        tenantId: tenantAId,
        referenceId: transferred.body.data.id,
        referenceType: 'STOCK_TRANSFER',
      },
    })).toBe(2);
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: transferred.body.data.id,
        movementType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] },
        status: 'APPLIED',
      },
    })).toBe(2);

    const addB = await post('/api/inventory/batches', {
      clientEventId: crypto.randomUUID(),
      productId: productBId,
      warehouseId: defaultWarehouseBId,
      batchNumber: `LOT-B-${crypto.randomUUID().slice(0, 8)}`,
      expiryDate: '2027-11-30',
      quantity: '2.0000',
    }, tenantBToken);
    expectStatus(addB, 200);
    batchBId = addB.body.batch.id;
    await prisma.tenant.update({
      where: { id: tenantBId },
      data: {
        batchWarehouseLedgerMode: 'SHADOW',
        batchWarehouseLedgerActivatedAt: new Date(),
      },
    });
    const gapEventId = crypto.randomUUID();
    const gap = await post('/api/stock-transfers', {
      clientEventId: gapEventId,
      fromWarehouseId: defaultWarehouseBId,
      toWarehouseId: secondaryWarehouseBId,
      notes: 'Observacion SHADOW sin saldo local reconciliado',
      items: [{ productId: productBId, quantity: '1.0000' }],
    }, tenantBToken);
    expectStatus(gap, 201);
    expect(gap.body.data).toMatchObject({
      batchLedgerMode: 'SHADOW',
      batchTransferStatus: 'SHADOW_GAP',
    });
    expect(gap.body.data.batchSnapshot).toMatchObject({
      mode: 'SHADOW',
      status: 'SHADOW_GAP',
    });

    expect(await inventorySnapshot({ tenantId: tenantBId, productId: productBId, batchId: batchBId }))
      .toEqual({
        product: 2,
        batch: 2,
        warehouseStocks: {
          [defaultWarehouseBId]: 1,
          [secondaryWarehouseBId]: 1,
        },
        batchWarehouseStocks: { [defaultWarehouseBId]: '0.0000' },
      });
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantBId,
        batchId: batchBId,
        movementType: 'TRANSFER_OUT',
        status: 'SHADOW_GAP',
      },
    })).toBe(1);

    const readinessB = await api('/api/batch-warehouse-ledger/readiness', tenantBToken);
    expectStatus(readinessB, 200);
    expect(readinessB.body.data.canEnforce).toBe(false);
    expect(readinessB.body.data.summary).toMatchObject({
      mismatchedBatchCount: 1,
      unresolvedShadowGapCount: 1,
    });
    expect(readinessB.body.data.enforcementBlockers.map((blocker: any) => blocker.code))
      .toEqual(expect.arrayContaining(['BATCH_BALANCE_MISMATCH', 'UNRESOLVED_SHADOW_GAPS']));

    expect(await prisma.productBatchLedgerEntry.count({
      where: { tenantId: tenantAId, status: 'SHADOW_GAP' },
    })).toBe(0);
    expect(await prisma.stockTransfer.count({
      where: { tenantId: tenantAId, clientEventId: gapEventId },
    })).toBe(0);
  }, 120_000);

  it('guards de ajuste y stock-count revierten todo delta agregado batch-tracked', async () => {
    const beforeAdjust = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });
    const countsBeforeAdjust = {
      kardex: await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
    };
    const adjustment = await post('/api/inventory/adjust', {
      productId: productAId,
      warehouseId: defaultWarehouseAId,
      quantity: '-1.0000',
      type: 'ADJUST_LOSS',
      reason: 'Ajuste agregado que debe bloquearse',
    });
    expectStatus(adjustment, 409);
    expect(adjustment.body.code).toBe('BATCH_SELECTION_REQUIRED');
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(beforeAdjust);
    expect(await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeAdjust.kardex);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeAdjust.audits);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeAdjust.journals);

    const countCreated = await post('/api/stock-counts', {
      warehouseId: defaultWarehouseAId,
      scope: 'ALL',
      notes: 'QA guard Fase 2B',
    });
    expectStatus(countCreated, 201);
    const countId = countCreated.body.count.id;
    const recorded = await patch(`/api/stock-counts/${countId}/count`, {
      productId: productAId,
      counted: '2.0000',
    });
    expectStatus(recorded, 200);

    const beforeClose = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });
    const effectsBeforeClose = {
      kardex: await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
    };
    const closed = await post(`/api/stock-counts/${countId}/close`, {});
    expectStatus(closed, 409);
    expect(closed.body.code).toBe('BATCH_SELECTION_REQUIRED');
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(beforeClose);
    expect(await prisma.stockCount.findFirst({
      where: { id: countId, tenantId: tenantAId },
      select: { status: true },
    })).toEqual({ status: 'OPEN' });
    expect(await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }))
      .toBe(effectsBeforeClose.kardex);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } }))
      .toBe(effectsBeforeClose.audits);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(effectsBeforeClose.journals);

    const cancelled = await post(`/api/stock-counts/${countId}/cancel`, {});
    expectStatus(cancelled, 200);
  }, 120_000);

  it('Pedido ENFORCED conserva lote+bodega y cruce legacy falla antes de venta', async () => {
    await prisma.product.update({
      where: { id: productAId },
      data: { isPublished: true },
    });
    const exactOrder = await post('/api/v1/pedidos', {
      slug: tenantASlug,
      clienteNombre: 'Cliente QA Exacto',
      clienteTelefono: '88888888',
      direccionEntrega: 'Direccion QA exacta numero 123',
      items: [{ productoId: productAId, cantidad: '1.0000' }],
    }, '');
    expectStatus(exactOrder, 201);
    const exactPedidoId = exactOrder.body.pedidoId;

    const foreign = await patch(
      `/api/v1/pedidos/${exactPedidoId}/estado`,
      { estado: 'preparando' },
      tenantBToken,
    );
    expectStatus(foreign, 404);
    expect(foreign.body.code).toBe('PEDIDO_NOT_FOUND');

    const prepared = await patch(`/api/v1/pedidos/${exactPedidoId}/estado`, {
      estado: 'preparando',
    });
    expectStatus(prepared, 200);
    const reservation = await prisma.kardexMovement.findFirst({
      where: {
        tenantId: tenantAId,
        referenceId: exactPedidoId,
        referenceType: 'PEDIDO_RESERVA',
      },
    });
    expect(reservation).toMatchObject({
      productId: productAId,
      batchId: batchAId,
      warehouseId: defaultWarehouseAId,
      quantity: -1,
    });
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: exactPedidoId,
        movementType: 'PEDIDO_RESERVE',
        status: 'APPLIED',
      },
    })).toBe(1);
    const reservedSnapshot = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });

    const delivered = await patch(`/api/v1/pedidos/${exactPedidoId}/estado`, {
      estado: 'entregado',
    });
    expectStatus(delivered, 200);
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(reservedSnapshot);
    const exactPedido = await prisma.pedido.findFirstOrThrow({
      where: { id: exactPedidoId, tenantId: tenantAId },
      select: { facturaId: true },
    });
    expect(exactPedido.facturaId).toBeTruthy();
    const exactSaleItem = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: exactPedido.facturaId! },
    });
    const exactAllocation = await prisma.saleItemBatchAllocation.findFirstOrThrow({
      where: { tenantId: tenantAId, saleItemId: exactSaleItem.id },
    });
    expect(exactAllocation).toMatchObject({
      batchId: batchAId,
      warehouseId: defaultWarehouseAId,
    });
    expect(fixed(exactAllocation.quantity)).toBe('1.0000');

    const legacyOrder = await post('/api/v1/pedidos', {
      slug: tenantASlug,
      clienteNombre: 'Cliente QA Legacy',
      clienteTelefono: '87777777',
      direccionEntrega: 'Direccion QA legacy numero 456',
      items: [{ productoId: productAId, cantidad: '1.0000' }],
    }, '');
    expectStatus(legacyOrder, 201);
    const legacyPedidoId = legacyOrder.body.pedidoId;
    const localBefore = Number((await prisma.productStock.findFirstOrThrow({
      where: {
        tenantId: tenantAId,
        productId: productAId,
        warehouseId: defaultWarehouseAId,
      },
      select: { stock: true },
    })).stock);
    await prisma.$transaction(async tx => {
      expect((await tx.pedido.updateMany({
        where: { id: legacyPedidoId, tenantId: tenantAId, estado: 'pendiente' },
        data: { estado: 'preparando' },
      })).count).toBe(1);
      expect((await tx.product.updateMany({
        where: { id: productAId, tenantId: tenantAId },
        data: { stock: { decrement: 1 } },
      })).count).toBe(1);
      expect((await tx.productStock.updateMany({
        where: {
          tenantId: tenantAId,
          productId: productAId,
          warehouseId: defaultWarehouseAId,
        },
        data: { stock: { decrement: 1 } },
      })).count).toBe(1);
      expect((await tx.productBatch.updateMany({
        where: { id: batchAId, tenantId: tenantAId, productId: productAId },
        data: { stock: { decrement: 1 } },
      })).count).toBe(1);
      expect((await tx.productBatchWarehouseStock.updateMany({
        where: {
          tenantId: tenantAId,
          productId: productAId,
          batchId: batchAId,
          warehouseId: defaultWarehouseAId,
        },
        data: { stock: { decrement: '1.0000' } },
      })).count).toBe(1);
      await tx.kardexMovement.create({
        data: {
          tenantId: tenantAId,
          productId: productAId,
          type: 'OUT',
          quantity: -1,
          stockBefore: localBefore,
          stockAfter: localBefore - 1,
          referenceId: legacyPedidoId,
          referenceType: 'PEDIDO_RESERVA',
          reason: 'Fixture QA reserva historica sin bodega',
          userId: tenantAUserId,
          batchId: batchAId,
          warehouseId: null,
        },
      });
      await tx.trackingEvento.create({
        data: {
          pedidoId: legacyPedidoId,
          estado: 'preparando',
          nota: 'Fixture QA legacy',
        },
      });
    });

    const legacyBefore = {
      inventory: await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }),
      sales: await prisma.sale.count({ where: { tenantId: tenantAId } }),
      saleItems: await prisma.saleItem.count({ where: { sale: { tenantId: tenantAId } } }),
      payments: await prisma.payment.count({ where: { sale: { tenantId: tenantAId } } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
    };
    const legacyDelivery = await patch(`/api/v1/pedidos/${legacyPedidoId}/estado`, {
      estado: 'entregado',
    });
    expectStatus(legacyDelivery, 409);
    expect(legacyDelivery.body.code).toBe('PEDIDO_BATCH_RECONCILIATION_REQUIRED');
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(legacyBefore.inventory);
    expect(await prisma.sale.count({ where: { tenantId: tenantAId } })).toBe(legacyBefore.sales);
    expect(await prisma.saleItem.count({ where: { sale: { tenantId: tenantAId } } }))
      .toBe(legacyBefore.saleItems);
    expect(await prisma.payment.count({ where: { sale: { tenantId: tenantAId } } }))
      .toBe(legacyBefore.payments);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.journals);
    expect(await prisma.pedido.findFirst({
      where: { id: legacyPedidoId, tenantId: tenantAId },
      select: { estado: true, facturaId: true },
    })).toEqual({ estado: 'preparando', facturaId: null });

    const readiness = await api('/api/batch-warehouse-ledger/readiness', tenantAToken);
    expectStatus(readiness, 200);
    expect(readiness.body.data.summary.incompletePedidoBatchReservationCount).toBe(1);
    expect(readiness.body.data.enforcementBlockers.map((blocker: any) => blocker.code))
      .toContain('INCOMPLETE_PEDIDO_BATCH_RESERVATIONS');
  }, 120_000);

  it('anulacion ENFORCED restaura el lote y la bodega exactos en la misma tx', async () => {
    const opened = await post('/api/shifts/open', { initialCash: '100.00' });
    expectStatus(opened, 200);

    const beforeSale = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });
    const sale = await post('/api/sales', {
      items: [{ id: productAId, quantity: '1.0000' }],
      paymentMethod: 'CARD',
      offlineId: crypto.randomUUID(),
    });
    expectStatus(sale, 200);
    const allocation = await prisma.saleItemBatchAllocation.findFirstOrThrow({
      where: { tenantId: tenantAId, saleItem: { saleId: sale.body.id } },
    });
    expect(allocation).toMatchObject({
      batchId: batchAId,
      warehouseId: defaultWarehouseAId,
    });

    const voided = await post(`/api/sales/${sale.body.id}/cancel`, {
      motivo: 'Anulacion QA con evidencia exacta de lote y bodega',
    });
    expectStatus(voided, 200);
    expect(voided.body).toMatchObject({
      success: true,
      id: sale.body.id,
      status: 'VOIDED',
    });
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(beforeSale);
    expect(await prisma.sale.findFirst({
      where: { id: sale.body.id, tenantId: tenantAId },
      select: { status: true, cancelledAt: true },
    })).toEqual({ status: 'VOIDED', cancelledAt: expect.any(Date) });
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: sale.body.id,
        movementType: 'SALE_RETURN',
        status: 'APPLIED',
      },
    })).toBe(1);
    expect(await prisma.kardexMovement.count({
      where: {
        tenantId: tenantAId,
        referenceId: sale.body.id,
        referenceType: 'SALE_VOIDED',
        type: 'RETURN',
        batchId: batchAId,
        warehouseId: defaultWarehouseAId,
      },
    })).toBe(1);
    expect(await prisma.journalEntry.count({
      where: { tenantId: tenantAId, referenceId: sale.body.id, referenceType: 'SALE_CANCELLED' },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'SALE_VOIDED' },
    })).toBe(1);
  }, 120_000);

  it('ProductReturn exacta restaura una vez y evidencia legacy revierte completa', async () => {

    const sale = await post('/api/sales', {
      items: [{ id: productAId, quantity: '1.0000' }],
      paymentMethod: 'CARD',
      offlineId: crypto.randomUUID(),
    });
    expectStatus(sale, 200);
    const saleItem = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: sale.body.id, productId: productAId },
    });
    const allocation = await prisma.saleItemBatchAllocation.findFirstOrThrow({
      where: { tenantId: tenantAId, saleItemId: saleItem.id },
    });
    expect(allocation).toMatchObject({
      batchId: batchAId,
      warehouseId: defaultWarehouseAId,
    });
    expect(fixed(allocation.quantity)).toBe('1.0000');

    const clientEventId = crypto.randomUUID();
    const payload = {
      clientEventId,
      saleId: sale.body.id,
      items: [{ saleItemId: saleItem.id, quantity: '1.0000' }],
      reason: 'Producto regresado con evidencia exacta',
      refundMethod: 'CARD',
    };
    const foreign = await post('/api/returns', payload, tenantBToken);
    expectStatus(foreign, 404);
    expect(foreign.body.code).toBe('SALE_NOT_FOUND');

    const beforeReturn = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });
    const returned = await post('/api/returns', payload);
    expectStatus(returned, 200);
    expect(returned.body.idempotentReplay).toBe(false);
    const afterReturn = await inventorySnapshot({
      tenantId: tenantAId,
      productId: productAId,
      batchId: batchAId,
    });
    expect(afterReturn.product).toBe(beforeReturn.product + 1);
    expect(afterReturn.batch).toBe(beforeReturn.batch + 1);
    expect(afterReturn.warehouseStocks[defaultWarehouseAId])
      .toBe(beforeReturn.warehouseStocks[defaultWarehouseAId] + 1);
    expect(afterReturn.batchWarehouseStocks[defaultWarehouseAId])
      .toBe((Number(beforeReturn.batchWarehouseStocks[defaultWarehouseAId]) + 1).toFixed(4));

    const replay = await post('/api/returns', payload);
    expectStatus(replay, 200);
    expect(replay.body.id).toBe(returned.body.id);
    expect(replay.body.idempotentReplay).toBe(true);
    const conflict = await post('/api/returns', {
      ...payload,
      reason: 'Mismo UUID con otra devolucion',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('RETURN_IDEMPOTENCY_CONFLICT');
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(afterReturn);

    const persistedReturn = await prisma.productReturn.findFirstOrThrow({
      where: { tenantId: tenantAId, clientEventId },
    });
    const persistedItems = persistedReturn.items as any[];
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0]).toMatchObject({
      saleItemId: saleItem.id,
      productId: productAId,
      batchRestorationMode: 'BATCH_RESTORED',
      batchRestorations: [{
        allocationId: allocation.id,
        batchId: batchAId,
        warehouseId: defaultWarehouseAId,
        quantity: '1',
      }],
    });
    expect(await prisma.productReturn.count({
      where: { tenantId: tenantAId, clientEventId },
    })).toBe(1);
    expect(await prisma.productBatchLedgerEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: returned.body.id,
        movementType: 'SALE_RETURN',
        status: 'APPLIED',
      },
    })).toBe(1);
    expect(await prisma.kardexMovement.count({
      where: {
        tenantId: tenantAId,
        referenceId: returned.body.id,
        referenceType: 'RETURN',
        type: 'RETURN',
      },
    })).toBe(1);
    expect(await prisma.journalEntry.count({
      where: { tenantId: tenantAId, referenceId: returned.body.id, referenceType: 'RETURN' },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'RETURN_CREATED' },
    })).toBe(1);

    const legacySale = await post('/api/sales', {
      items: [{ id: productAId, quantity: '1.0000' }],
      paymentMethod: 'CARD',
      offlineId: crypto.randomUUID(),
    });
    expectStatus(legacySale, 200);
    const legacySaleItem = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: legacySale.body.id, productId: productAId },
    });
    const legacyAllocation = await prisma.saleItemBatchAllocation.findFirstOrThrow({
      where: { tenantId: tenantAId, saleItemId: legacySaleItem.id },
    });
    await prisma.saleItemBatchAllocation.update({
      where: { id: legacyAllocation.id },
      data: { warehouseId: null },
    });

    const legacyEventId = crypto.randomUUID();
    const legacyBefore = {
      inventory: await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }),
      returns: await prisma.productReturn.count({ where: { tenantId: tenantAId } }),
      kardex: await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }),
      ledger: await prisma.productBatchLedgerEntry.count({ where: { tenantId: tenantAId } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
    };
    const legacyReturn = await post('/api/returns', {
      clientEventId: legacyEventId,
      saleId: legacySale.body.id,
      items: [{ saleItemId: legacySaleItem.id, quantity: '1.0000' }],
      reason: 'Venta historica sin bodega exacta',
      refundMethod: 'CARD',
    });
    expectStatus(legacyReturn, 409);
    expect(legacyReturn.body.code).toBe('RECONCILIATION_REQUIRED');
    expect(await inventorySnapshot({ tenantId: tenantAId, productId: productAId, batchId: batchAId }))
      .toEqual(legacyBefore.inventory);
    expect(await prisma.productReturn.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.returns);
    expect(await prisma.productReturn.count({
      where: { tenantId: tenantAId, clientEventId: legacyEventId },
    })).toBe(0);
    expect(await prisma.kardexMovement.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.kardex);
    expect(await prisma.productBatchLedgerEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.ledger);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.journals);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } }))
      .toBe(legacyBefore.audits);

    const readiness = await api('/api/batch-warehouse-ledger/readiness', tenantAToken);
    expectStatus(readiness, 200);
    expect(readiness.body.data.summary.legacyAllocationCount).toBe(1);
    expect(readiness.body.data.enforcementBlockers.map((blocker: any) => blocker.code))
      .toEqual(expect.arrayContaining([
        'LEGACY_ALLOCATIONS_WITHOUT_WAREHOUSE',
        'INCOMPLETE_PEDIDO_BATCH_RESERVATIONS',
      ]));
  }, 120_000);
});
