import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { createJournalEntry } from '../backend/services/accounting';

/**
 * QA HTTP real de procurement Fase 2A.
 *
 * Se omite en la suite normal porque requiere un MySQL 8 descartable y un
 * backend aislado apuntando a esa misma base. Ejecucion:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3100 vitest run tests/procurementPhaseTwo.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
  status: number;
  body: T;
};

type ApprovedOrder = {
  id: string;
  items: Array<{ id: string; productId: string }>;
};

let tenantAToken = '';
let tenantBToken = '';
let tenantAId = '';
let tenantBId = '';
let tenantAUserId = '';
let supplierId = '';
let warehouseId = '';
let sameSkuProductId = '';
let priceProductId = '';
let cashProductId = '';
let legacyProductId = '';
let roundingProductId = '';

let formalOrderId = '';
let formalOrderItemAId = '';
let formalOrderItemBId = '';
let formalReceiptId = '';
let formalInvoiceId = '';
let priceExceptionPurchaseId = '';
let legacyExceptionPurchaseId = '';

const formalReceiptEventId = crypto.randomUUID();
const resolutionEventId = crypto.randomUUID();

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

function expectStatus(result: ApiResult, expected: number) {
  expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

function decimal(value: { toFixed(digits: number): string } | null | undefined, digits: number) {
  return value?.toFixed(digits) ?? null;
}

function journalLineSnapshot(entry: any) {
  return Object.fromEntries(entry.lines.map((line: any) => [
    line.account.code,
    {
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
    },
  ]));
}

async function createProduct(
  runId: string,
  label: string,
  ivaExento: boolean,
): Promise<string> {
  const result = await post('/api/products', {
    name: `QA ${label}`,
    sku: `QA-P2-${label.toUpperCase()}-${runId}`,
    category: 'QA Procurement Fase 2',
    price: 20,
    cost: 0,
    stock: 0,
    minStock: 0,
    unit: 'unidad',
    saleMode: 'COUNTED',
    quantityStep: '1',
    isPublished: false,
    requiresBatchTracking: false,
    ivaExento,
  });
  expectStatus(result, 200);
  return result.body.id;
}

async function createApprovedOrder(
  productId: string,
  quantity: string,
  unitCost: string,
): Promise<ApprovedOrder> {
  const created = await post('/api/purchase-orders', {
    supplierId,
    notes: 'QA Procurement Fase 2',
    expectedDate: '2026-09-30',
    items: [{ productId, quantity, unitCost }],
  });
  expectStatus(created, 201);
  const approved = await post(`/api/purchase-orders/${created.body.data.id}/approve`, {});
  expectStatus(approved, 200);
  return created.body.data;
}

async function receiveOrder(
  orderId: string,
  items: Array<{ itemId: string; quantityReceived: string }>,
  label: string,
) {
  const result = await post(`/api/purchase-orders/${orderId}/receive`, {
    clientEventId: crypto.randomUUID(),
    warehouseId,
    supplierDeliveryRef: label,
    items,
  });
  expectStatus(result, 200);
  expect(result.body.replay).toBe(false);
  return result.body;
}

async function postLinkedInvoice(input: {
  invoiceNumber: string;
  orderId: string;
  productId: string;
  orderItemId: string;
  quantity?: string;
  unitCost: string;
  paymentMethod: 'CASH' | 'CREDIT';
}) {
  return post('/api/purchases', {
    supplierId,
    purchaseOrderId: input.orderId,
    invoiceNumber: input.invoiceNumber,
    date: '2026-08-27',
    postingDate: '2026-08-27',
    ...(input.paymentMethod === 'CREDIT' ? { dueDate: '2026-09-26' } : {}),
    paymentMethod: input.paymentMethod,
    items: [{
      productId: input.productId,
      purchaseOrderItemId: input.orderItemId,
      quantity: input.quantity ?? '1',
      unitCost: input.unitCost,
    }],
  });
}

qaDescribe('QA integracion: procurement Fase 2A', () => {
  beforeAll(async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const registrationA = await post('/api/auth/register', {
      companyName: `QA Procurement 2A ${runId}`,
      email: `qa-procurement-2a-${runId}@example.invalid`,
      password: `Qa-${runId}-A-Seguro!`,
      type: 'RETAIL',
    }, '');
    expectStatus(registrationA, 200);
    tenantAToken = registrationA.body.token;
    tenantAId = registrationA.body.tenant.id;
    tenantAUserId = registrationA.body.user.id;

    const registrationB = await post('/api/auth/register', {
      companyName: `QA Procurement 2B ${runId}`,
      email: `qa-procurement-2b-${runId}@example.invalid`,
      password: `Qa-${runId}-B-Seguro!`,
      type: 'RETAIL',
    }, '');
    expectStatus(registrationB, 200);
    tenantBToken = registrationB.body.token;
    tenantBId = registrationB.body.tenant.id;

    const supplier = await post('/api/suppliers', {
      name: `Proveedor QA Procurement ${runId}`,
      category: 'QA',
    });
    expectStatus(supplier, 200);
    supplierId = supplier.body.id;

    const warehouses = await api('/api/warehouses', tenantAToken);
    expectStatus(warehouses, 200);
    warehouseId = warehouses.body.data.find((warehouse: any) => warehouse.isDefault).id;

    sameSkuProductId = await createProduct(runId, 'mismo-sku', true);
    priceProductId = await createProduct(runId, 'variacion-precio', true);
    cashProductId = await createProduct(runId, 'rollback-cash', true);
    legacyProductId = await createProduct(runId, 'legacy', true);
    roundingProductId = await createProduct(runId, 'redondeo', false);

    await prisma.procurementPolicy.upsert({
      where: { tenantId: tenantAId },
      create: {
        tenantId: tenantAId,
        priceTolerancePct: '2.5000',
        autoHold: true,
        updatedBy: tenantAUserId,
      },
      update: {
        priceTolerancePct: '2.5000',
        autoHold: true,
        updatedBy: tenantAUserId,
      },
    });

    const order = await post('/api/purchase-orders', {
      supplierId,
      notes: 'Dos lineas de la misma referencia',
      items: [{ productId: sameSkuProductId, quantity: '1', unitCost: '10.00' }],
    });
    expectStatus(order, 201);
    formalOrderId = order.body.data.id;
    formalOrderItemAId = order.body.data.items[0].id;

    const secondLine = await prisma.purchaseOrderItem.create({
      data: {
        purchaseOrderId: formalOrderId,
        productId: sameSkuProductId,
        productName: 'QA mismo-sku',
        quantityOrdered: 2,
        quantityReceived: 0,
        quantityOrderedExact: '2.0000',
        quantityReceivedExact: '0.0000',
        unitAtOrder: 'unidad',
        saleModeAtOrder: 'COUNTED',
        quantityStepAtOrder: '1.0000',
        unitCost: '10.00',
        unitCostExact: '10.000000',
      },
    });
    formalOrderItemBId = secondLine.id;

    const approved = await post(`/api/purchase-orders/${formalOrderId}/approve`, {});
    expectStatus(approved, 200);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registra una sola recepcion formal ante concurrencia, replay y conflicto UUID', async () => {
    const payload = {
      clientEventId: formalReceiptEventId,
      warehouseId,
      supplierDeliveryRef: 'REMISION-FORMAL-001',
      items: [
        { itemId: formalOrderItemBId, quantityReceived: '2.0000' },
        { itemId: formalOrderItemAId, quantityReceived: '1' },
      ],
    };

    const foreignAttempt = await post(
      `/api/purchase-orders/${formalOrderId}/receive`,
      payload,
      tenantBToken,
    );
    expectStatus(foreignAttempt, 404);
    expect(foreignAttempt.body.code).toBe('PURCHASE_ORDER_NOT_FOUND');

    const concurrent = await Promise.all([
      post(`/api/purchase-orders/${formalOrderId}/receive`, payload),
      post(`/api/purchase-orders/${formalOrderId}/receive`, payload),
    ]);
    expect(concurrent.map((result) => result.status)).toEqual([200, 200]);
    expect(concurrent.map((result) => result.body.replay).sort())
      .toEqual([false, true]);
    expect(new Set(concurrent.map((result) => result.body.receipt.id)).size).toBe(1);

    const created = concurrent.find((result) => result.body.replay === false)!;
    formalReceiptId = created.body.receipt.id;
    expect(created.body.data.status).toBe('RECEIVED');
    expect(created.body.receipt.status).toBe('POSTED');
    expect(created.body.receipt.items).toHaveLength(2);
    expect(created.body.receipt.items.map((item: any) => item.productId))
      .toEqual([sameSkuProductId, sameSkuProductId]);
    expect(Object.fromEntries(created.body.receipt.items.map((item: any) => [
      item.purchaseOrderItemId,
      item.quantityExact,
    ]))).toEqual({
      [formalOrderItemAId]: '1',
      [formalOrderItemBId]: '2',
    });

    const retry = await post(`/api/purchase-orders/${formalOrderId}/receive`, {
      ...payload,
      items: [...payload.items].reverse(),
    });
    expectStatus(retry, 200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.receipt.id).toBe(formalReceiptId);

    const conflict = await post(`/api/purchase-orders/${formalOrderId}/receive`, {
      ...payload,
      supplierDeliveryRef: 'REMISION-DISTINTA',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('RECEIPT_IDEMPOTENCY_CONFLICT');

    const receipts = await prisma.goodsReceipt.findMany({
      where: { tenantId: tenantAId, purchaseOrderId: formalOrderId },
      include: { items: true },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].items).toHaveLength(2);
    expect(await prisma.goodsReceipt.count({
      where: { tenantId: tenantBId, clientEventId: formalReceiptEventId },
    })).toBe(0);

    const product = await prisma.product.findFirst({
      where: { id: sameSkuProductId, tenantId: tenantAId },
    });
    expect(product?.stock).toBe(3);
    const kardex = await prisma.kardexMovement.findMany({
      where: {
        tenantId: tenantAId,
        productId: sameSkuProductId,
        referenceId: formalReceiptId,
        referenceType: 'GOODS_RECEIPT',
      },
      orderBy: { date: 'asc' },
    });
    expect(kardex).toHaveLength(2);
    expect(kardex.reduce((sum, movement) => sum + Number(movement.quantity), 0)).toBe(3);
    expect(kardex.map((movement) => Number(movement.quantity)).sort((a, b) => a - b))
      .toEqual([1, 2]);
    expect(kardex[0].stockBefore).toBe(0);
    expect(kardex[1].stockBefore).toBe(kardex[0].stockAfter);
    expect(kardex[1].stockAfter).toBe(3);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'GOODS_RECEIPT_POSTED' },
    })).toBe(1);

    const orderItems = await prisma.purchaseOrderItem.findMany({
      where: { purchaseOrderId: formalOrderId },
      orderBy: { id: 'asc' },
    });
    expect(Object.fromEntries(orderItems.map((item) => [
      item.id,
      decimal(item.quantityReceivedExact, 4),
    ]))).toEqual({
      [formalOrderItemAId]: '1.0000',
      [formalOrderItemBId]: '2.0000',
    });
  }, 120_000);

  it('concilia exactamente una factura con dos lineas del mismo SKU por purchaseOrderItemId', async () => {
    const invoiceNumber = `FAC-MATCH-${crypto.randomUUID()}`;
    const result = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: formalOrderId,
      invoiceNumber,
      date: '2026-08-27',
      postingDate: '2026-08-28',
      dueDate: '2026-09-26',
      paymentMethod: 'CREDIT',
      items: [
        {
          productId: sameSkuProductId,
          purchaseOrderItemId: formalOrderItemBId,
          quantity: '2',
          unitCost: '10.00',
        },
        {
          productId: sameSkuProductId,
          purchaseOrderItemId: formalOrderItemAId,
          quantity: '1',
          unitCost: '10.00',
        },
      ],
    });
    expectStatus(result, 200);
    formalInvoiceId = result.body.purchase.id;
    expect(result.body.purchase.matchStatus).toBe('MATCHED');
    expect(result.body.purchase.paymentHold).toBe(false);
    expect(Number(result.body.purchase.total)).toBe(30);

    const persisted = await prisma.purchase.findFirst({
      where: { id: formalInvoiceId, tenantId: tenantAId },
      include: { items: true },
    });
    expect(persisted?.matchStatus).toBe('MATCHED');
    expect(persisted?.paymentHold).toBe(false);
    expect(persisted?.postingDate?.toISOString()).toBe('2026-08-28T12:00:00.000Z');
    expect(new Set(persisted?.items.map((item) => item.purchaseOrderItemId)))
      .toEqual(new Set([formalOrderItemAId, formalOrderItemBId]));

    const allocations = await prisma.purchaseMatchAllocation.findMany({
      where: {
        tenantId: tenantAId,
        purchaseItemId: { in: persisted?.items.map((item) => item.id) ?? [] },
      },
    });
    expect(allocations).toHaveLength(2);
    expect(allocations.every((allocation) => allocation.source === 'FORMAL_RECEIPT'))
      .toBe(true);
    expect(allocations.every((allocation) => allocation.goodsReceiptItemId !== null))
      .toBe(true);
    expect(allocations.reduce(
      (sum, allocation) => sum + Number(allocation.quantityExact),
      0,
    )).toBe(3);

    const detail = await api(`/api/procurement/matches/${formalInvoiceId}`, tenantAToken);
    expectStatus(detail, 200);
    expect(detail.body.data.purchase.matchStatus).toBe('MATCHED');
    expect(detail.body.data.lines).toHaveLength(2);
    expect(detail.body.data.totals).toEqual({
      expectedAmount: '30.00',
      invoiceAmount: '30.00',
      varianceAmount: '0.00',
    });

    const foreignDetail = await api(
      `/api/procurement/matches/${formalInvoiceId}`,
      tenantBToken,
    );
    expectStatus(foreignDetail, 404);
    expect(foreignDetail.body.code).toBe('PURCHASE_NOT_FOUND');

    const product = await prisma.product.findFirst({
      where: { id: sameSkuProductId, tenantId: tenantAId },
    });
    expect(product?.stock).toBe(3);
    expect(await prisma.kardexMovement.count({
      where: { tenantId: tenantAId, productId: sameSkuProductId },
    })).toBe(2);
  }, 120_000);

  it('suma redondeo por línea y no crea PPV cuando precio OC y factura coinciden', async () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const secondProductId = await createProduct(runId, 'redondeo-linea-b', false);
    const created = await post('/api/purchase-orders', {
      supplierId,
      notes: 'QA redondeo por línea a centavos',
      items: [
        { productId: roundingProductId, quantity: '1', unitCost: '1.005000' },
        { productId: secondProductId, quantity: '1', unitCost: '1.005000' },
      ],
    });
    expectStatus(created, 201);
    const approved = await post(`/api/purchase-orders/${created.body.data.id}/approve`, {});
    expectStatus(approved, 200);
    await receiveOrder(
      created.body.data.id,
      created.body.data.items.map((item: any) => ({
        itemId: item.id,
        quantityReceived: '1',
      })),
      'REMISION-REDONDEO-LINEA',
    );

    const invoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: created.body.data.id,
      invoiceNumber: `FAC-MATCH-ROUND-${crypto.randomUUID()}`,
      date: '2026-08-27',
      postingDate: '2026-08-27',
      dueDate: '2026-09-26',
      paymentMethod: 'CREDIT',
      items: created.body.data.items.map((item: any) => ({
        productId: item.productId,
        purchaseOrderItemId: item.id,
        quantity: '1',
        unitCost: '1.005000',
      })),
    });
    expectStatus(invoice, 200);
    expect(invoice.body.purchase).toMatchObject({
      matchStatus: 'MATCHED',
      paymentHold: false,
    });
    expect(Number(invoice.body.purchase.subtotal).toFixed(2)).toBe('2.02');
    expect(Number(invoice.body.purchase.tax).toFixed(2)).toBe('0.30');
    expect(Number(invoice.body.purchase.total).toFixed(2)).toBe('2.32');

    const detail = await api(
      `/api/procurement/matches/${invoice.body.purchase.id}`,
      tenantAToken,
    );
    expectStatus(detail, 200);
    expect(detail.body.data.totals).toEqual({
      expectedAmount: '2.02',
      invoiceAmount: '2.02',
      varianceAmount: '0.00',
    });

    const entry = await prisma.journalEntry.findFirst({
      where: {
        tenantId: tenantAId,
        referenceId: invoice.body.purchase.id,
        referenceType: 'PURCHASE',
      },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(journalLineSnapshot(entry)).toEqual({
      '1.1.4': { debit: '2.02', credit: '0.00' },
      '1.1.5': { debit: '0.30', credit: '0.00' },
      '2.1.1': { debit: '0.00', credit: '2.32' },
    });
  }, 120_000);

  it('retiene una variacion de precio a CREDIT y bloquea su pago', async () => {
    const order = await createApprovedOrder(priceProductId, '1', '10.00');
    await receiveOrder(
      order.id,
      [{ itemId: order.items[0].id, quantityReceived: '1' }],
      'REMISION-PRECIO',
    );

    const result = await postLinkedInvoice({
      invoiceNumber: `FAC-EXCEPTION-${crypto.randomUUID()}`,
      orderId: order.id,
      productId: priceProductId,
      orderItemId: order.items[0].id,
      unitCost: '10.26',
      paymentMethod: 'CREDIT',
    });
    expectStatus(result, 200);
    priceExceptionPurchaseId = result.body.purchase.id;
    expect(result.body.purchase.matchStatus).toBe('EXCEPTION');
    expect(result.body.purchase.paymentHold).toBe(true);

    const exception = await prisma.purchaseMatchException.findFirst({
      where: {
        tenantId: tenantAId,
        purchaseId: priceExceptionPurchaseId,
        type: 'PRICE_VARIANCE',
      },
    });
    expect(exception?.status).toBe('OPEN');
    expect(decimal(exception?.expectedValueExact, 6)).toBe('10.000000');
    expect(decimal(exception?.actualValueExact, 6)).toBe('10.260000');
    expect(decimal(exception?.varianceExact, 6)).toBe('0.260000');
    expect(decimal(exception?.toleranceExact, 6)).toBe('0.250000');

    const blocked = await post(`/api/purchases/${priceExceptionPurchaseId}/pay`, {
      amount: '10.26',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    });
    expectStatus(blocked, 409);
    expect(blocked.body.code).toBe('PURCHASE_PAYMENT_ON_HOLD');
    expect(await prisma.supplierPayment.count({
      where: { tenantId: tenantAId, purchaseId: priceExceptionPurchaseId },
    })).toBe(0);
    expect(await prisma.journalEntry.count({
      where: {
        tenantId: tenantAId,
        referenceType: 'SUPPLIER_PAYMENT',
        referenceId: priceExceptionPurchaseId,
      },
    })).toBe(0);
  }, 120_000);

  it('resuelve con UUID idempotente y habilita el pago retenido', async () => {
    const request = {
      clientEventId: resolutionEventId,
      reason: 'Gerencia aprobo la variacion contra cotizacion vigente',
    };

    const foreign = await post(
      `/api/procurement/matches/${priceExceptionPurchaseId}/resolve`,
      request,
      tenantBToken,
    );
    expectStatus(foreign, 404);
    expect(foreign.body.code).toBe('PURCHASE_NOT_FOUND');

    const resolved = await post(
      `/api/procurement/matches/${priceExceptionPurchaseId}/resolve`,
      request,
    );
    expectStatus(resolved, 200);
    expect(resolved.body.replay).toBe(false);
    expect(resolved.body.data).toEqual(expect.objectContaining({
      purchaseId: priceExceptionPurchaseId,
      matchStatus: 'RESOLVED',
      paymentHold: false,
      matchResolutionNote: request.reason,
    }));

    const retry = await post(
      `/api/procurement/matches/${priceExceptionPurchaseId}/resolve`,
      request,
    );
    expectStatus(retry, 200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.data.matchResolvedAt).toBe(resolved.body.data.matchResolvedAt);

    const conflict = await post(
      `/api/procurement/matches/${priceExceptionPurchaseId}/resolve`,
      { ...request, reason: 'Una intencion distinta con el mismo UUID' },
    );
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('MATCH_RESOLUTION_IDEMPOTENCY_CONFLICT');

    const persisted = await prisma.purchase.findFirst({
      where: { id: priceExceptionPurchaseId, tenantId: tenantAId },
    });
    expect(persisted?.matchStatus).toBe('RESOLVED');
    expect(persisted?.paymentHold).toBe(false);
    expect(persisted?.matchResolutionClientEventId).toBe(resolutionEventId);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'PURCHASE_MATCH_RESOLVED' },
    })).toBe(1);
    expect(await prisma.purchaseMatchException.count({
      where: {
        tenantId: tenantAId,
        purchaseId: priceExceptionPurchaseId,
        status: 'RESOLVED',
      },
    })).toBe(1);

    const payment = await post(`/api/purchases/${priceExceptionPurchaseId}/pay`, {
      amount: '10.26',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
      reference: 'TRX-P2-RESOLVED',
    });
    expectStatus(payment, 200);
    expect(payment.body.purchase.status).toBe('COMPLETED');
    expect(payment.body.purchase.balanceDue).toBe('0');
    expect(payment.body.replay).toBe(false);
    expect(await prisma.supplierPayment.count({
      where: { tenantId: tenantAId, purchaseId: priceExceptionPurchaseId },
    })).toBe(1);
    expect(await prisma.journalEntry.count({
      where: {
        tenantId: tenantAId,
        referenceType: 'SUPPLIER_PAYMENT',
        referenceId: payment.body.payment.id,
      },
    })).toBe(1);
  }, 120_000);

  it('revierte por completo una factura CASH fuera de tolerancia', async () => {
    const order = await createApprovedOrder(cashProductId, '1', '10.00');
    await receiveOrder(
      order.id,
      [{ itemId: order.items[0].id, quantityReceived: '1' }],
      'REMISION-CASH',
    );
    await prisma.tenant.update({
      where: { id: tenantAId },
      data: { walletBalance: '1000.00' },
    });

    const invoiceNumber = `FAC-CASH-ROLLBACK-${crypto.randomUUID()}`;
    const before = {
      purchases: await prisma.purchase.count({ where: { tenantId: tenantAId } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
      expenses: await prisma.expense.count({ where: { tenantId: tenantAId } }),
      allocations: await prisma.purchaseMatchAllocation.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      wallet: decimal((await prisma.tenant.findUnique({
        where: { id: tenantAId },
        select: { walletBalance: true },
      }))?.walletBalance, 2),
    };

    const result = await postLinkedInvoice({
      invoiceNumber,
      orderId: order.id,
      productId: cashProductId,
      orderItemId: order.items[0].id,
      unitCost: '10.26',
      paymentMethod: 'CASH',
    });
    expectStatus(result, 409);
    expect(result.body.code).toBe('CASH_PRICE_VARIANCE_REQUIRES_RESOLUTION');

    expect(await prisma.purchase.findFirst({
      where: { tenantId: tenantAId, supplierId, invoiceNumber },
    })).toBeNull();
    expect(await prisma.purchase.count({ where: { tenantId: tenantAId } }))
      .toBe(before.purchases);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(before.journals);
    expect(await prisma.expense.count({ where: { tenantId: tenantAId } }))
      .toBe(before.expenses);
    expect(await prisma.purchaseMatchAllocation.count({ where: { tenantId: tenantAId } }))
      .toBe(before.allocations);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } }))
      .toBe(before.audits);
    expect(decimal((await prisma.tenant.findUnique({
      where: { id: tenantAId },
      select: { walletBalance: true },
    }))?.walletBalance, 2)).toBe(before.wallet);
  }, 120_000);

  it('proyecta recepcion legacy como excepcion y falla cerrado sin identidad explicita', async () => {
    const order = await createApprovedOrder(legacyProductId, '2', '7.00');
    const orderItemId = order.items[0].id;
    await prisma.$transaction([
      prisma.purchaseOrderItem.update({
        where: { id: orderItemId },
        data: { quantityReceived: 2, quantityReceivedExact: '2.0000' },
      }),
      prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { status: 'RECEIVED' },
      }),
    ]);
    expect(await prisma.goodsReceipt.count({
      where: { tenantId: tenantAId, purchaseOrderId: order.id },
    })).toBe(0);

    const explicit = await postLinkedInvoice({
      invoiceNumber: `FAC-LEGACY-EXPLICIT-${crypto.randomUUID()}`,
      orderId: order.id,
      productId: legacyProductId,
      orderItemId,
      unitCost: '7.00',
      paymentMethod: 'CREDIT',
    });
    expectStatus(explicit, 200);
    legacyExceptionPurchaseId = explicit.body.purchase.id;
    expect(explicit.body.purchase.matchStatus).toBe('EXCEPTION');
    expect(explicit.body.purchase.paymentHold).toBe(true);

    const legacyAllocation = await prisma.purchaseMatchAllocation.findFirst({
      where: {
        tenantId: tenantAId,
        purchaseItem: { purchaseId: legacyExceptionPurchaseId },
      },
    });
    expect(legacyAllocation?.source).toBe('LEGACY_PROJECTION');
    expect(legacyAllocation?.goodsReceiptItemId).toBeNull();
    expect(await prisma.purchaseMatchException.count({
      where: {
        tenantId: tenantAId,
        purchaseId: legacyExceptionPurchaseId,
        type: 'LEGACY_RECEIPT_TRACE',
        status: 'OPEN',
      },
    })).toBe(1);

    const blocked = await post(`/api/purchases/${legacyExceptionPurchaseId}/pay`, {
      amount: '7.00',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    });
    expectStatus(blocked, 409);
    expect(blocked.body.code).toBe('PURCHASE_PAYMENT_ON_HOLD');

    const missingIdentityInvoice = `FAC-LEGACY-NO-ID-${crypto.randomUUID()}`;
    const missingIdentity = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: order.id,
      invoiceNumber: missingIdentityInvoice,
      date: '2026-08-27',
      dueDate: '2026-09-26',
      paymentMethod: 'CREDIT',
      items: [{ productId: legacyProductId, quantity: '1', unitCost: '7.00' }],
    });
    expectStatus(missingIdentity, 409);
    expect(missingIdentity.body.code).toBe('LEGACY_RECEIPT_REQUIRES_ORDER_LINE_ID');
    expect(await prisma.purchase.findFirst({
      where: { tenantId: tenantAId, supplierId, invoiceNumber: missingIdentityInvoice },
    })).toBeNull();

    const cashInvoiceNumber = `FAC-LEGACY-CASH-${crypto.randomUUID()}`;
    const countsBeforeCash = {
      purchases: await prisma.purchase.count({ where: { tenantId: tenantAId } }),
      journals: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
      expenses: await prisma.expense.count({ where: { tenantId: tenantAId } }),
      wallet: decimal((await prisma.tenant.findUnique({
        where: { id: tenantAId },
        select: { walletBalance: true },
      }))?.walletBalance, 2),
    };
    const cashLegacy = await postLinkedInvoice({
      invoiceNumber: cashInvoiceNumber,
      orderId: order.id,
      productId: legacyProductId,
      orderItemId,
      unitCost: '7.00',
      paymentMethod: 'CASH',
    });
    expectStatus(cashLegacy, 409);
    expect(cashLegacy.body.code).toBe('CASH_LEGACY_RECEIPT_TRACE_REQUIRES_RESOLUTION');
    expect(await prisma.purchase.findFirst({
      where: { tenantId: tenantAId, supplierId, invoiceNumber: cashInvoiceNumber },
    })).toBeNull();
    expect(await prisma.purchase.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeCash.purchases);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeCash.journals);
    expect(await prisma.expense.count({ where: { tenantId: tenantAId } }))
      .toBe(countsBeforeCash.expenses);
    expect(decimal((await prisma.tenant.findUnique({
      where: { id: tenantAId },
      select: { walletBalance: true },
    }))?.walletBalance, 2)).toBe(countsBeforeCash.wallet);
  }, 120_000);

  it('separa fecha de factura y posting, y postea 0.115 como 0.12', async () => {
    const result = await post('/api/purchases', {
      supplierId,
      invoiceNumber: `FAC-ROUND-${crypto.randomUUID()}`,
      date: '2026-08-10',
      postingDate: '2026-08-20',
      dueDate: '2026-09-20',
      paymentMethod: 'CREDIT',
      items: [{ productId: roundingProductId, quantity: '1', unitCost: '0.10' }],
    });
    expectStatus(result, 200);
    const purchaseId = result.body.purchase.id;
    expect(Number(result.body.purchase.subtotal)).toBe(0.1);
    expect(Number(result.body.purchase.tax)).toBe(0.02);
    expect(Number(result.body.purchase.total)).toBe(0.12);
    expect(Number(result.body.purchase.balanceDue)).toBe(0.12);

    const persisted = await prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId: tenantAId },
      include: { items: true },
    });
    expect(persisted?.date.toISOString()).toBe('2026-08-10T12:00:00.000Z');
    expect(persisted?.postingDate?.toISOString()).toBe('2026-08-20T12:00:00.000Z');
    expect(decimal(persisted?.subtotal, 2)).toBe('0.10');
    expect(decimal(persisted?.tax, 2)).toBe('0.02');
    expect(decimal(persisted?.total, 2)).toBe('0.12');
    expect(decimal(persisted?.balanceDue, 2)).toBe('0.12');
    expect(decimal(persisted?.items[0].totalCost, 2)).toBe('0.10');
    expect(decimal(persisted?.items[0].taxAmountExact, 2)).toBe('0.02');
    expect(decimal(persisted?.items[0].creditableTaxExact, 2)).toBe('0.02');

    const entry = await prisma.journalEntry.findFirst({
      where: {
        tenantId: tenantAId,
        referenceId: purchaseId,
        referenceType: 'PURCHASE',
      },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(entry?.date.toISOString()).toBe('2026-08-20T12:00:00.000Z');
    expect(journalLineSnapshot(entry)).toEqual({
      '1.1.4': { debit: '0.10', credit: '0.00' },
      '1.1.5': { debit: '0.02', credit: '0.00' },
      '2.1.1': { debit: '0.00', credit: '0.12' },
    });
  }, 120_000);

  it('excluye documentos no POSTED de Supplier 360, pendientes y pagos', async () => {
    const nonPosted = await prisma.purchase.create({
      data: {
        tenantId: tenantAId,
        supplierId,
        invoiceNumber: `VOID-QA-${crypto.randomUUID()}`,
        date: new Date('2026-08-27T12:00:00.000Z'),
        postingDate: new Date('2026-08-27T12:00:00.000Z'),
        dueDate: new Date('2026-09-26T12:00:00.000Z'),
        subtotal: '999.00',
        tax: '0.00',
        creditableTax: '0.0000',
        total: '999.00',
        status: 'PENDING_PAYMENT',
        paymentMethod: 'CREDIT',
        balanceDue: '999.0000',
        documentStatus: 'VOIDED',
        createdBy: tenantAUserId,
      },
    });

    const postedTotals = await prisma.purchase.aggregate({
      where: { tenantId: tenantAId, supplierId, documentStatus: 'POSTED' },
      _count: { id: true },
      _sum: { total: true },
    });
    const detail = await api(`/api/suppliers/${supplierId}`, tenantAToken);
    expectStatus(detail, 200);
    expect(detail.body.data.recentPurchases.map((purchase: any) => purchase.id))
      .not.toContain(nonPosted.id);
    expect(detail.body.data.aggregates.purchaseCount).toBe(postedTotals._count.id);
    expect(detail.body.data.aggregates.totalPurchased)
      .toBe(postedTotals._sum.total?.toFixed(4));

    const pending = await api('/api/purchases/pending', tenantAToken);
    expectStatus(pending, 200);
    expect(pending.body.purchases.map((purchase: any) => purchase.id))
      .not.toContain(nonPosted.id);

    const blockedPayment = await post(`/api/purchases/${nonPosted.id}/pay`, {
      amount: '999.00',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    });
    expectStatus(blockedPayment, 409);
    expect(blockedPayment.body.code).toBe('PURCHASE_DOCUMENT_NOT_POSTED');
    expect(await prisma.supplierPayment.count({
      where: { tenantId: tenantAId, purchaseId: nonPosted.id },
    })).toBe(0);
  }, 120_000);

  it('prebloquea cuentas en orden canónico bajo asientos inversos concurrentes', async () => {
    const accountBalancesBefore = await prisma.account.findMany({
      where: { tenantId: tenantAId, code: { in: ['1.1.1', '1.1.4'] } },
      select: { code: true, balance: true },
      orderBy: { code: 'asc' },
    });
    const rounds = 12;

    for (let round = 0; round < rounds; round += 1) {
      await Promise.all([
        prisma.$transaction((tx) => createJournalEntry(
          tx,
          tenantAId,
          'QA lock Caja antes de Inventario',
          `qa-lock-sale-${round}-${crypto.randomUUID()}`,
          'QA_ACCOUNT_LOCK',
          tenantAUserId,
          [
            { accountCode: '1.1.1', debit: 1, credit: 0 },
            { accountCode: '1.1.4', debit: 0, credit: 1 },
          ],
          { date: new Date('2026-08-27T12:00:00.000Z') },
        )),
        prisma.$transaction((tx) => createJournalEntry(
          tx,
          tenantAId,
          'QA lock Inventario antes de Caja',
          `qa-lock-purchase-${round}-${crypto.randomUUID()}`,
          'QA_ACCOUNT_LOCK',
          tenantAUserId,
          [
            { accountCode: '1.1.4', debit: 1, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 1 },
          ],
          { date: new Date('2026-08-27T12:00:00.000Z') },
        )),
      ]);
    }

    const accountBalancesAfter = await prisma.account.findMany({
      where: { tenantId: tenantAId, code: { in: ['1.1.1', '1.1.4'] } },
      select: { code: true, balance: true },
      orderBy: { code: 'asc' },
    });
    expect(accountBalancesAfter.map((account) => ({
      code: account.code,
      balance: account.balance.toFixed(2),
    }))).toEqual(accountBalancesBefore.map((account) => ({
      code: account.code,
      balance: account.balance.toFixed(2),
    })));
    expect(await prisma.journalEntry.count({
      where: { tenantId: tenantAId, referenceType: 'QA_ACCOUNT_LOCK' },
    })).toBe(rounds * 2);
  }, 120_000);
});
