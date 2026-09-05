import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import prisma from '../backend/lib/prisma';
import { verifyTenantLedger } from '../backend/services/ledger';

/**
 * QA HTTP real del flujo de compras.
 *
 * Se omite en la suite normal porque requiere una instancia descartable con
 * MySQL. Ejecución:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3100 vitest run tests/purchaseFlow.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
  status: number;
  body: T;
};

let token = '';
let tenantId = '';
let supplierId = '';
let screenshotProductId = '';
let receivedProductId = '';
let concurrencyProductId = '';
let duplicateInvoiceProductId = '';
let packProductId = '';
let secondaryWarehouseId = '';

async function api<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');

  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
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

function expectStatus(result: ApiResult, expected: number) {
  expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function post<T = any>(path: string, body: unknown): Promise<ApiResult<T>> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

async function createProduct(
  name: string,
  sku: string,
  requiresBatchTracking: boolean,
): Promise<string> {
  const result = await post('/api/products', {
    name,
    sku,
    category: 'QA Compras',
    price: 25,
    cost: 0,
    stock: 0,
    minStock: 0,
    unit: 'unidad',
    isPublished: false,
    requiresBatchTracking,
    ivaExento: false,
  });
  expectStatus(result, 200);
  return result.body.id;
}

async function createPackProduct(name: string, sku: string): Promise<string> {
  const result = await post('/api/products', {
    name,
    sku,
    category: 'QA Compras',
    price: 25,
    cost: 0,
    stock: 0,
    minStock: 0,
    unit: 'lb',
    saleMode: 'MEASURED',
    quantityStep: '0.25',
    productFamily: 'ANIMAL_FEED',
    packUnit: 'saco',
    packSize: 100,
    isPublished: false,
    requiresBatchTracking: false,
    ivaExento: false,
  });
  expectStatus(result, 200);
  return result.body.id;
}

async function getProduct(productId: string): Promise<any> {
  const result = await api<any[]>('/api/products');
  expectStatus(result, 200);
  const product = result.body.find((candidate) => candidate.id === productId);
  expect(product, `Producto QA ${productId} no encontrado`).toBeTruthy();
  return product;
}

async function getBatches(productId: string): Promise<any[]> {
  const result = await api<any[]>(`/api/inventory/batches/${productId}`);
  expectStatus(result, 200);
  return result.body;
}

async function getKardex(productId: string): Promise<any[]> {
  const result = await api<any[]>(`/api/kardex/${productId}`);
  expectStatus(result, 200);
  return result.body;
}

async function createApprovedPurchaseOrder(productId: string, quantity: number, unitCost: number) {
  const created = await post('/api/purchase-orders', {
    supplierId,
    notes: 'QA integración compras',
    expectedDate: '2027-01-09',
    items: [{ productId, quantity, unitCost }],
  });
  expectStatus(created, 201);
  const approved = await post(`/api/purchase-orders/${created.body.data.id}/approve`, {});
  expectStatus(approved, 200);
  return created.body.data;
}

async function createWarehouse(name: string): Promise<string> {
  const result = await post('/api/warehouses', { name });
  expectStatus(result, 201);
  return result.body.data.id;
}

qaDescribe('QA integración: compras y órdenes de compra', () => {
  beforeAll(async () => {
    expect(['127.0.0.1', 'localhost']).toContain(new URL(QA_BASE_URL!).hostname);
    const database = new URL(process.env.DATABASE_URL!);
    expect(['127.0.0.1', 'localhost']).toContain(database.hostname);
    expect(database.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const registration = await post('/api/auth/register', {
      companyName: `QA Compras ${runId}`,
      email: `qa-compras-${runId}@example.invalid`,
      password: `Qa-${runId}-Seguro!`,
      type: 'FARMACIA',
    });
    expectStatus(registration, 200);
    token = registration.body.token;
    tenantId = registration.body.tenant.id;

    const supplier = await post('/api/suppliers', {
      name: 'Pollos Molina',
      category: 'QA',
    });
    expectStatus(supplier, 200);
    supplierId = supplier.body.id;

    // GET materializa la bodega Principal del tenant. Sin este paso, la bodega
    // creada abajo sería la primera/default y el escenario no sería realmente
    // multi-bodega, por lo que omitir warehouseId seguiría siendo compatible.
    const initialWarehouses = await api('/api/warehouses');
    expectStatus(initialWarehouses, 200);
    expect(initialWarehouses.body.data.some((warehouse: any) => warehouse.isDefault)).toBe(true);
    secondaryWarehouseId = await createWarehouse(`Bodega QA ${runId}`);

    screenshotProductId = await createProduct('Salsa kerns jumbo', `QA-SCREEN-${runId}`, true);
    receivedProductId = await createProduct('QA Producto OC con lote', `QA-PO-${runId}`, true);
    concurrencyProductId = await createProduct('QA Producto concurrencia', `QA-CONC-${runId}`, false);
    duplicateInvoiceProductId = await createProduct('QA Factura concurrente', `QA-INV-${runId}`, false);
    packProductId = await createPackProduct('QA Concentrado por saco', `QA-PACK-${runId}`);
  }, 120_000);
  afterAll(async () => { await prisma.$disconnect(); });

  it('persiste la fecha civil, rechaza fechas inválidas y bloquea el duplicado sin mover stock', async () => {
    const loopCount = 10;
    const invoicePrefix = `FAC-CAPTURA-${Date.now()}`;

    const invalidDate = await post('/api/purchases', {
      supplierId,
      invoiceNumber: `${invoicePrefix}-FECHA-INVALIDA`,
      date: '2026-02-30',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: screenshotProductId, quantity: 1, unitCost: 13.5 }],
    });
    expectStatus(invalidDate, 400);
    expect(invalidDate.body.details.date).toBeTruthy();

    const missingDate = await post('/api/purchases', {
      supplierId,
      invoiceNumber: `${invoicePrefix}-FECHA-OMITIDA`,
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: screenshotProductId, quantity: 1, unitCost: 13.5 }],
    });
    expectStatus(missingDate, 400);
    expect(missingDate.body.details.date).toBeTruthy();

    for (let index = 1; index <= loopCount; index += 1) {
      const result = await post('/api/purchases', {
        supplierId,
        warehouseId: secondaryWarehouseId,
        invoiceNumber: `${invoicePrefix}-${index}`,
        date: '2026-08-21',
        paymentMethod: 'CREDIT',
        dueDate: '2026-08-25',
        notes: 'pedido diario',
        items: [{
          productId: screenshotProductId,
          quantity: 12,
          unitCost: 13.5,
          batchNumber: '088313330182',
          expiryDate: '2027-01-09',
        }],
      });

      expectStatus(result, 200);
      expect(Number(result.body.purchase.subtotal)).toBe(162);
      expect(Number(result.body.purchase.tax)).toBe(24.3);
      expect(Number(result.body.purchase.total)).toBe(186.3);
      expect(result.body.purchase.date).toBe('2026-08-21T12:00:00.000Z');
      expect(result.body.purchase.dueDate).toBe('2026-08-25T12:00:00.000Z');
      expect(result.body.purchase.items[0].expiryDate).toBe('2027-01-09T12:00:00.000Z');
    }

    const productBeforeDuplicate = await getProduct(screenshotProductId);
    const batchesBeforeDuplicate = await getBatches(screenshotProductId);
    const kardexBeforeDuplicate = await getKardex(screenshotProductId);
    expect(Number(productBeforeDuplicate.stock)).toBe(loopCount * 12);
    expect(Number(batchesBeforeDuplicate[0].stock)).toBe(loopCount * 12);
    expect(kardexBeforeDuplicate).toHaveLength(loopCount);

    const duplicate = await post('/api/purchases', {
      supplierId,
      warehouseId: secondaryWarehouseId,
      invoiceNumber: `${invoicePrefix}-1`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      notes: 'pedido diario',
      items: [{
        productId: screenshotProductId,
        quantity: 12,
        unitCost: 13.5,
        batchNumber: '088313330182',
        expiryDate: '2027-01-09',
      }],
    });
    expectStatus(duplicate, 409);

    const productAfterDuplicate = await getProduct(screenshotProductId);
    const batchesAfterDuplicate = await getBatches(screenshotProductId);
    const kardexAfterDuplicate = await getKardex(screenshotProductId);
    expect(Number(productAfterDuplicate.stock)).toBe(Number(productBeforeDuplicate.stock));
    expect(Number(batchesAfterDuplicate[0].stock)).toBe(Number(batchesBeforeDuplicate[0].stock));
    expect(kardexAfterDuplicate).toHaveLength(kardexBeforeDuplicate.length);
  }, 120_000);

  it('convierte 2 sacos de 100 lb con factor del servidor y costo base', async () => {
    const result = await post('/api/purchases', {
      supplierId,
      warehouseId: secondaryWarehouseId,
      invoiceNumber: `FAC-PACK-${Date.now()}`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{
        productId: packProductId,
        quantity: 2,
        unitCost: 1250,
        purchaseUnit: 'PACK',
        // Ataque simulado: el contrato debe descartarlo y consultar Product.
        packSize: 1,
      }],
    });

    expectStatus(result, 200);
    expect(result.body.purchase.items[0].quantityExact).toBe('200');
    expect(Number(result.body.purchase.items[0].unitCost)).toBe(12.5);
    expect(Number(result.body.purchase.items[0].totalCost)).toBe(2500);
    expect(Number(result.body.purchase.subtotal)).toBe(2500);

    const product = await getProduct(packProductId);
    expect(Number(product.stock)).toBe(200);
    expect(Number(product.cost)).toBe(12.5);
    const kardex = await getKardex(packProductId);
    expect(Number(kardex.at(-1)?.quantity)).toBe(200);
  }, 120_000);

  it('cancela DRAFT o APPROVED sin recepción y no mueve inventario', async () => {
    const draft = await post('/api/purchase-orders', {
      supplierId,
      items: [{ productId: concurrencyProductId, quantity: 2, unitCost: 5 }],
    });
    expectStatus(draft, 201);

    const cancelledDraft = await post(`/api/purchase-orders/${draft.body.data.id}/cancel`, {});
    expectStatus(cancelledDraft, 200);
    expect(cancelledDraft.body.data.status).toBe('CANCELLED');

    const approved = await createApprovedPurchaseOrder(concurrencyProductId, 2, 5);
    const cancelledApproved = await post(`/api/purchase-orders/${approved.id}/cancel`, {});
    expectStatus(cancelledApproved, 200);
    expect(cancelledApproved.body.data.status).toBe('CANCELLED');

    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(0);
    expect(await getKardex(concurrencyProductId)).toHaveLength(0);
  }, 120_000);

  it('separa recepción física de factura y limita lo facturable al saldo recibido', async () => {
    const po = await createApprovedPurchaseOrder(receivedProductId, 12, 13.5);
    const poItemId = po.items[0].id;
    const invoicePrefix = `FAC-PO-${Date.now()}`;

    const invoiceBeforeReceipt = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-ANTES`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 1, unitCost: 13.5 }],
    });
    expectStatus(invoiceBeforeReceipt, 400);

    const partialReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      warehouseId: secondaryWarehouseId,
      items: [{
        itemId: poItemId,
        quantityReceived: 5,
        batchNumber: 'PO-BATCH-1',
        expiryDate: '2027-01-09',
      }],
    });
    expectStatus(partialReceipt, 200);
    expect(partialReceipt.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(partialReceipt.body.replay).toBe(false);
    expect(partialReceipt.body.receipt).toMatchObject({
      purchaseOrderId: po.id,
      warehouseId: secondaryWarehouseId,
      status: 'POSTED',
    });
    expect(partialReceipt.body.receipt.items[0]).toMatchObject({
      purchaseOrderItemId: poItemId,
      productId: receivedProductId,
      quantityExact: '5',
      batchNumber: 'PO-BATCH-1',
    });

    const stockAfterReceipt = await getProduct(receivedProductId);
    const batchesAfterReceipt = await getBatches(receivedProductId);
    const kardexAfterReceipt = await getKardex(receivedProductId);
    expect(Number(stockAfterReceipt.stock)).toBe(5);
    expect(Number(batchesAfterReceipt[0].stock)).toBe(5);
    expect(kardexAfterReceipt).toHaveLength(1);
    expect(kardexAfterReceipt[0].warehouseId).toBe(secondaryWarehouseId);

    const cancelAfterPartialReceipt = await post(`/api/purchase-orders/${po.id}/cancel`, {});
    expectStatus(cancelAfterPartialReceipt, 409);
    expect(cancelAfterPartialReceipt.body.code).toBe('PO_HAS_RECEIPTS');

    const orderAfterRejectedCancel = await api(`/api/purchase-orders/${po.id}`);
    expectStatus(orderAfterRejectedCancel, 200);
    expect(orderAfterRejectedCancel.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(Number((await getProduct(receivedProductId)).stock)).toBe(5);
    expect(await getKardex(receivedProductId)).toHaveLength(1);
    expect(orderAfterRejectedCancel.body.data.goodsReceipts).toHaveLength(1);
    expect(orderAfterRejectedCancel.body.data.goodsReceipts[0].receiptNumber)
      .toBe(partialReceipt.body.receipt.receiptNumber);

    const firstInvoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-1`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 3, unitCost: 13.5 }],
    });
    expectStatus(firstInvoice, 200);

    const exceedsRemaining = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-EXCESO`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 3, unitCost: 13.5 }],
    });
    expectStatus(exceedsRemaining, 400);

    const secondInvoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-2`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 2, unitCost: 13.5 }],
    });
    expectStatus(secondInvoice, 200);

    const productAfterInvoices = await getProduct(receivedProductId);
    const batchesAfterInvoices = await getBatches(receivedProductId);
    const kardexAfterInvoices = await getKardex(receivedProductId);
    expect(Number(productAfterInvoices.stock)).toBe(5);
    expect(Number(batchesAfterInvoices[0].stock)).toBe(5);
    expect(kardexAfterInvoices).toHaveLength(1);

    const finalReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      warehouseId: secondaryWarehouseId,
      items: [{
        itemId: poItemId,
        quantityReceived: 7,
        batchNumber: 'PO-BATCH-1',
        expiryDate: '2027-01-09',
      }],
    });
    expectStatus(finalReceipt, 200);
    expect(finalReceipt.body.data.status).toBe('RECEIVED');

    const finalInvoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-3`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 7, unitCost: 13.5 }],
    });
    expectStatus(finalInvoice, 200);

    const noBalanceLeft = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-4`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 1, unitCost: 13.5 }],
    });
    expectStatus(noBalanceLeft, 400);

    const finalProduct = await getProduct(receivedProductId);
    const finalBatches = await getBatches(receivedProductId);
    const finalKardex = await getKardex(receivedProductId);
    expect(Number(finalProduct.stock)).toBe(12);
    expect(Number(finalBatches[0].stock)).toBe(12);
    expect(finalKardex).toHaveLength(2);
  }, 120_000);

  it('rechaza sobrerrecepción y líneas repetidas sin efectos parciales', async () => {
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 10, 5);
    const itemId = po.items[0].id;

    const duplicateLines = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      warehouseId: secondaryWarehouseId,
      items: [
        { itemId, quantityReceived: 1 },
        { itemId, quantityReceived: 1 },
      ],
    });
    expectStatus(duplicateLines, 400);

    const overReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      warehouseId: secondaryWarehouseId,
      items: [{ itemId, quantityReceived: 11 }],
    });
    expectStatus(overReceipt, 400);

    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(0);
    expect(await getKardex(concurrencyProductId)).toHaveLength(0);
  }, 120_000);

  it('exige bodega destino explícita cuando el negocio ya opera con varias bodegas', async () => {
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 4, 5);
    const itemId = po.items[0].id;

    const missingWarehouse = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      items: [{ itemId, quantityReceived: 2 }],
    });
    expectStatus(missingWarehouse, 400);
    expect(String(missingWarehouse.body.error ?? '')).toContain('bodega');

    const invalidWarehouse = await post(`/api/purchase-orders/${po.id}/receive`, {
      clientEventId: crypto.randomUUID(),
      warehouseId: 'bodega-que-no-pertenece-al-tenant',
      items: [{ itemId, quantityReceived: 2 }],
    });
    expectStatus(invalidWarehouse, 404);
    expect(String(invalidWarehouse.body.error ?? '')).toContain('bodega');

    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(0);
    expect(await getKardex(concurrencyProductId)).toHaveLength(0);
  }, 120_000);

  it('serializa dos recepciones simultáneas y solo incrementa el stock una vez', async () => {
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 10, 5);
    const itemId = po.items[0].id;
    const body = {
      clientEventId: crypto.randomUUID(),
      warehouseId: secondaryWarehouseId,
      items: [{ itemId, quantityReceived: 10 }],
    };

    const results = await Promise.all([
      post(`/api/purchase-orders/${po.id}/receive`, body),
      post(`/api/purchase-orders/${po.id}/receive`, body),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 200]);
    expect(results.map((result) => result.body.replay).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.body.receipt.id)).size).toBe(1);
    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(10);
    expect(await getKardex(concurrencyProductId)).toHaveLength(1);

    const detail = await api(`/api/purchase-orders/${po.id}`);
    expectStatus(detail, 200);
    expect(detail.body.data.status).toBe('RECEIVED');
    expect(Number(detail.body.data.items[0].quantityReceived)).toBe(10);
    expect(detail.body.data.goodsReceipts).toHaveLength(1);

    const conflict = await post(`/api/purchase-orders/${po.id}/receive`, {
      ...body,
      items: [{ itemId, quantityReceived: 9 }],
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('RECEIPT_IDEMPOTENCY_CONFLICT');
    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(10);
    expect(await getKardex(concurrencyProductId)).toHaveLength(1);
  }, 120_000);

  it('serializa dos facturas idénticas concurrentes sin duplicar inventario', async () => {
    const invoiceNumber = `FAC-CONCURRENT-${Date.now()}`;
    const payload = {
      supplierId,
      warehouseId: secondaryWarehouseId,
      invoiceNumber,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: duplicateInvoiceProductId, quantity: 1, unitCost: 5 }],
    };

    const results = await Promise.all([
      post('/api/purchases', payload),
      post('/api/purchases', payload),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const createdPurchase = results.find((result) => result.status === 200)?.body.purchase;
    expect(createdPurchase.date).toBe('2026-08-21T12:00:00.000Z');
    expect(Number((await getProduct(duplicateInvoiceProductId)).stock)).toBe(1);
    expect(await getKardex(duplicateInvoiceProductId)).toHaveLength(1);
  }, 120_000);

  it('evita ciclos de locks con dos compras directas en orden inverso', async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const secondSupplier = await post('/api/suppliers', {
      name: `Proveedor lock B ${runId}`,
      category: 'QA concurrencia',
    });
    expectStatus(secondSupplier, 200);
    const productA = await createProduct('QA Lock producto A', `QA-LOCK-A-${runId}`, false);
    const productB = await createProduct('QA Lock producto B', `QA-LOCK-B-${runId}`, false);
    const rounds = 6;

    for (let round = 0; round < rounds; round += 1) {
      const common = {
        warehouseId: secondaryWarehouseId,
        date: '2026-08-21',
        dueDate: '2026-08-25',
        paymentMethod: 'CREDIT',
      };
      const results = await Promise.all([
        post('/api/purchases', {
          ...common,
          supplierId,
          invoiceNumber: `FAC-LOCK-A-${runId}-${round}`,
          items: [
            { productId: productA, quantity: 1, unitCost: 5 },
            { productId: productB, quantity: 1, unitCost: 5 },
          ],
        }),
        post('/api/purchases', {
          ...common,
          supplierId: secondSupplier.body.id,
          invoiceNumber: `FAC-LOCK-B-${runId}-${round}`,
          items: [
            { productId: productB, quantity: 1, unitCost: 7 },
            { productId: productA, quantity: 1, unitCost: 7 },
          ],
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual([200, 200]);
    }

    expect(Number((await getProduct(productA)).stock)).toBe(rounds * 2);
    expect(Number((await getProduct(productB)).stock)).toBe(rounds * 2);
    expect(Number((await getProduct(productA)).cost)).toBe(6);
    expect(Number((await getProduct(productB)).cost)).toBe(6);
    expect(await getKardex(productA)).toHaveLength(rounds * 2);
    expect(await getKardex(productB)).toHaveLength(rounds * 2);
  }, 120_000);

  it('oculta la OC y su recepción cuando otro tenant intenta usar el id', async () => {
    const primaryToken = token;
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 2, 5);
    const stockBefore = Number((await getProduct(concurrencyProductId)).stock);
    const kardexBefore = (await getKardex(concurrencyProductId)).length;
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    try {
      const foreignRegistration = await post('/api/auth/register', {
        companyName: `QA Compras ajeno ${runId}`,
        email: `qa-compras-ajeno-${runId}@example.invalid`,
        password: `Qa-${runId}-Seguro!`,
        type: 'RETAIL',
      });
      expectStatus(foreignRegistration, 200);
      token = foreignRegistration.body.token;

      const foreignReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
        clientEventId: crypto.randomUUID(),
        warehouseId: secondaryWarehouseId,
        items: [{ itemId: po.items[0].id, quantityReceived: 2 }],
      });
      expectStatus(foreignReceipt, 404);
      expect(foreignReceipt.body.code).toBe('PURCHASE_ORDER_NOT_FOUND');
    } finally {
      token = primaryToken;
    }

    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(stockBefore);
    expect(await getKardex(concurrencyProductId)).toHaveLength(kardexBefore);
  }, 120_000);

  it('recupera un abono CASH confirmado después de cerrar la última caja sin duplicar dinero ni reporte', async () => {
    const created = await post('/api/purchases', {
      supplierId,
      warehouseId: secondaryWarehouseId,
      invoiceNumber: `FAC-CASH-REPLAY-${crypto.randomUUID()}`,
      date: '2026-08-21',
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: duplicateInvoiceProductId, quantity: 1, unitCost: 100 }],
    });
    expectStatus(created, 200);
    const purchaseId = created.body.purchase.id;
    const opened = await post('/api/shifts/open', { initialCash: '500.00', initialCashUsd: '0' });
    expectStatus(opened, 200);
    const shiftId = opened.body.id;
    const accountBalances = async () => Object.fromEntries((await prisma.account.findMany({
      where: { tenantId, code: { in: ['1.1.1', '2.1.1'] } }, take: 2,
    })).map(account => [account.code, account.balance.toFixed(4)]));
    const beforeAccounts = await accountBalances();
    const walletBefore = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { walletBalance: true } });
    const request = {
      amount: '40.12', method: 'CASH', clientEventId: crypto.randomUUID(),
      reference: 'QA comprobante de efectivo', notes: 'Abono parcial antes del cierre',
    };
    const paid = await post(`/api/purchases/${purchaseId}/pay`, request);
    expectStatus(paid, 200);
    expect(paid.body.replay).toBe(false);
    expect(paid.body.purchase).toMatchObject({ status: 'PARTIALLY_PAID', balanceDue: '74.88' });
    const paymentId = paid.body.payment.id;
    const movements = await prisma.cashMovement.findMany({ where: { tenantId, shiftId }, take: 10 });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'OUT', category: 'PAGO_PROVEEDOR', currency: 'NIO', isVoided: false });
    expect(movements[0].amount.toFixed(4)).toBe('40.1200');
    const journals = await prisma.journalEntry.findMany({
      where: { tenantId, referenceId: paymentId, referenceType: 'SUPPLIER_PAYMENT' },
      include: { lines: { include: { account: { select: { code: true } } } } }, take: 2,
    });
    expect(journals).toHaveLength(1);
    expect(await prisma.supplierPayment.count({ where: { tenantId, purchaseId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'SUPPLIER_PAYMENT_CREATED' } })).toBe(1);
    expect(journals[0].lines.map(line => ({ code: line.account.code, debit: line.debit.toFixed(4), credit: line.credit.toFixed(4) }))
      .sort((a, b) => a.code.localeCompare(b.code))).toEqual([
        { code: '1.1.1', debit: '0.0000', credit: '40.1200' },
        { code: '2.1.1', debit: '40.1200', credit: '0.0000' },
      ]);
    const afterAccounts = await accountBalances();
    for (const code of ['1.1.1', '2.1.1']) {
      expect(new Decimal(afterAccounts[code]).minus(beforeAccounts[code]).toFixed(4)).toBe('-40.1200');
    }
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { walletBalance: true } })).toEqual(walletBefore);
    expect(await verifyTenantLedger(prisma, tenantId)).toMatchObject({ ok: true, checked: 1, unsigned: 0 });

    const closed = await post('/api/shifts/close', {
      shiftId, declaredCash: '459.88', declaredCashUsd: '0', clientEventId: crypto.randomUUID(),
      auditNotes: 'Cierre después de abono a proveedor',
    });
    expectStatus(closed, 200);
    expect(closed.body.closeReport.report.cash).toMatchObject({ expectedNio: '459.88', countedNio: '459.88', differenceNio: '0.00' });
    expect(await prisma.shift.count({ where: { tenantId, status: 'OPEN' } })).toBe(0);
    const snapshot = async () => JSON.stringify({
      purchase: await prisma.purchase.findFirstOrThrow({ where: { tenantId, id: purchaseId } }),
      payments: await prisma.supplierPayment.findMany({ where: { tenantId, purchaseId }, orderBy: { id: 'asc' }, take: 10 }),
      movements: await prisma.cashMovement.findMany({ where: { tenantId, shiftId }, orderBy: { id: 'asc' }, take: 10 }),
      journalCount: await prisma.journalEntry.count({ where: { tenantId } }),
      expenseCount: await prisma.expense.count({ where: { tenantId } }),
      auditCount: await prisma.auditLog.count({ where: { tenantId } }),
      report: await prisma.shiftCloseReport.findFirstOrThrow({ where: { tenantId, shiftId } }),
      accounts: await accountBalances(),
      ledger: await prisma.ledgerHead.findUnique({ where: { tenantId } }),
    });
    const confirmed = await snapshot();
    const replay = await post(`/api/purchases/${purchaseId}/pay`, request);
    expectStatus(replay, 200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.payment).toEqual(paid.body.payment);
    expect(await snapshot()).toBe(confirmed);

    const conflict = await post(`/api/purchases/${purchaseId}/pay`, { ...request, amount: '40.13' });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');
    const newPayment = await post(`/api/purchases/${purchaseId}/pay`, { ...request, clientEventId: crypto.randomUUID() });
    expectStatus(newPayment, 409);
    expect(newPayment.body.code).toBe('NO_OPEN_SHIFT');
    expect(await snapshot()).toBe(confirmed);
    expect((await verifyTenantLedger(prisma, tenantId)).ok).toBe(true);
  }, 120_000);

  it('un abono CASH reduce gaveta y CxP sin convertir el desembolso en gasto operativo o pérdida', async () => {
    const created = await post('/api/purchases', {
      supplierId, warehouseId: secondaryWarehouseId,
      invoiceNumber: `FAC-CASH-UTILIDAD-${crypto.randomUUID()}`,
      date: '2026-08-21', paymentMethod: 'CREDIT', dueDate: '2026-08-25',
      items: [{ productId: duplicateInvoiceProductId, quantity: 1, unitCost: 100 }],
    });
    expectStatus(created, 200);
    const opened = await post('/api/shifts/open', { initialCash: '100.00' });
    expectStatus(opened, 200);
    const reports = async () => {
      const [dashboard, expenses, income, sales] = await Promise.all([
        api('/api/dashboard/stats'), api('/api/reports/expenses'), api('/api/accounting/estado-resultados'), api('/api/reports/sales'),
      ]);
      for (const result of [dashboard, expenses, income, sales]) expectStatus(result, 200);
      const salesExpenses = sales.body.daily.map((day: { date: string; expenses: string }) => ({ date: day.date, expenses: day.expenses }));
      return { today: dashboard.body.todayStats, expenses: expenses.body, income: income.body, salesExpenses };
    };
    const baseline = await reports();
    const operational = await post('/api/cash-movements', {
      type: 'OUT', amount: '7.50', category: 'GASTO_OPERATIVO', currency: 'NIO', description: 'QA gasto operativo real',
    });
    expectStatus(operational, 200);
    const before = await reports();
    expect(new Decimal(before.today.totalExpenses).minus(baseline.today.totalExpenses).toFixed(2)).toBe('7.50');
    expect(new Decimal(before.expenses.totalExpenses).minus(baseline.expenses.totalExpenses).toFixed(2)).toBe('7.50');
    expect(new Decimal(before.income.operatingExpenses.total).minus(baseline.income.operatingExpenses.total).toFixed(2)).toBe('7.50');
    const accountsBefore = await prisma.account.findMany({
      where: { tenantId, code: { in: ['1.1.1', '2.1.1'] } }, orderBy: { code: 'asc' }, take: 2,
    });
    const paid = await post(`/api/purchases/${created.body.purchase.id}/pay`, {
      amount: '25.00', method: 'CASH', clientEventId: crypto.randomUUID(), reference: 'QA sin gasto adicional',
    });
    expectStatus(paid, 200);
    expect(paid.body.purchase).toMatchObject({ status: 'PARTIALLY_PAID', balanceDue: '90' });
    const movements = await prisma.cashMovement.findMany({ where: { tenantId, shiftId: opened.body.id, category: 'PAGO_PROVEEDOR' }, take: 10 });
    expect(movements).toHaveLength(1);
    expect(movements[0].amount.toFixed(2)).toBe('25.00');
    expect(movements[0].category).toBe('PAGO_PROVEEDOR');
    expect(movements[0].expenseId).toBeTruthy();
    const historicalExpense = await prisma.expense.findFirstOrThrow({ where: { tenantId, id: movements[0].expenseId! } });
    expect(historicalExpense.category).toBe('PAGO_PROVEEDOR');
    expect(historicalExpense.amount.toFixed(2)).toBe('25.00');
    const accountsAfter = await prisma.account.findMany({
      where: { tenantId, code: { in: ['1.1.1', '2.1.1'] } }, orderBy: { code: 'asc' }, take: 2,
    });
    expect(accountsAfter).toHaveLength(2);
    for (let i = 0; i < accountsAfter.length; i++) {
      expect(new Decimal(accountsAfter[i].balance.toString()).minus(accountsBefore[i].balance.toString()).toFixed(2)).toBe('-25.00');
    }
    const after = await reports();
    expect.soft(after.today.totalExpenses).toBe(before.today.totalExpenses);
    expect.soft(after.today.netProfit).toBe(before.today.netProfit);
    expect.soft(after.expenses.totalExpenses).toBe(before.expenses.totalExpenses);
    expect.soft(after.expenses.byCategory).toEqual(before.expenses.byCategory);
    expect.soft(after.salesExpenses).toEqual(before.salesExpenses);
    expect(after.income.operatingExpenses).toEqual(before.income.operatingExpenses);
    expect(after.income.netIncome).toBe(before.income.netIncome);

    const reversed = await post(`/api/cash-movements/${operational.body.id}/void`, { reason: 'Revertir gasto operativo de control QA' });
    expectStatus(reversed, 200);
    const afterReversal = await reports();
    expect(afterReversal.today.totalExpenses).toBe(baseline.today.totalExpenses);
    expect(afterReversal.today.netProfit).toBe(baseline.today.netProfit);
    expect(afterReversal.expenses.totalExpenses).toBe(baseline.expenses.totalExpenses);
    expect(afterReversal.expenses.byCategory.OPERATIONAL).toBe(0);
    expect(afterReversal.income.operatingExpenses.total).toBe(baseline.income.operatingExpenses.total);
    expect(afterReversal.income.netIncome).toBe(baseline.income.netIncome);
    const dailyExpenseTotal = (rows: Array<{ expenses: string }>) => rows.reduce((sum, row) => sum.plus(row.expenses), new Decimal(0)).toFixed(2);
    expect(dailyExpenseTotal(afterReversal.salesExpenses)).toBe(dailyExpenseTotal(baseline.salesExpenses));
    const preserved = await prisma.expense.findMany({ where: { tenantId, category: 'OPERATIONAL' }, take: 10 });
    expect(preserved.map(expense => expense.amount.toFixed(2)).sort()).toEqual(['-7.50', '7.50']);
    expect(await prisma.expense.findFirst({ where: { tenantId, id: historicalExpense.id } })).toEqual(historicalExpense);
    const closed = await post('/api/shifts/close', {
      shiftId: opened.body.id, declaredCash: '75.00', declaredCashUsd: '0',
      clientEventId: crypto.randomUUID(), auditNotes: 'Validación de desembolso sin gasto operativo',
    });
    expectStatus(closed, 200);
    expect(closed.body.closeReport.report.cash).toMatchObject({ expectedNio: '75.00', differenceNio: '0.00' });
  }, 120_000);
});
