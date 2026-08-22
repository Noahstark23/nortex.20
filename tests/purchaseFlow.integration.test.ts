import { beforeAll, describe, expect, it } from 'vitest';

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
let supplierId = '';
let screenshotProductId = '';
let receivedProductId = '';
let concurrencyProductId = '';
let duplicateInvoiceProductId = '';

async function api<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no esta definido');

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
    notes: 'QA integracion compras',
    expectedDate: '2027-01-09',
    items: [{ productId, quantity, unitCost }],
  });
  expectStatus(created, 201);
  const approved = await post(`/api/purchase-orders/${created.body.data.id}/approve`, {});
  expectStatus(approved, 200);
  return created.body.data;
}

qaDescribe('QA integracion: compras y ordenes de compra', () => {
  beforeAll(async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const registration = await post('/api/auth/register', {
      companyName: `QA Compras ${runId}`,
      email: `qa-compras-${runId}@example.invalid`,
      password: `Qa-${runId}-Seguro!`,
      type: 'FARMACIA',
    });
    expectStatus(registration, 200);
    token = registration.body.token;

    const supplier = await post('/api/suppliers', {
      name: 'Pollos Molina',
      category: 'QA',
    });
    expectStatus(supplier, 200);
    supplierId = supplier.body.id;

    screenshotProductId = await createProduct('Salsa kerns jumbo', `QA-SCREEN-${runId}`, true);
    receivedProductId = await createProduct('QA Producto OC con lote', `QA-PO-${runId}`, true);
    concurrencyProductId = await createProduct('QA Producto concurrencia', `QA-CONC-${runId}`, false);
    duplicateInvoiceProductId = await createProduct('QA Factura concurrente', `QA-INV-${runId}`, false);
  }, 120_000);

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

    for (let index = 1; index <= loopCount; index += 1) {
      const result = await post('/api/purchases', {
        supplierId,
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
      invoiceNumber: `${invoicePrefix}-1`,
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

  it('separa recepcion fisica de factura y limita lo facturable al saldo recibido', async () => {
    const po = await createApprovedPurchaseOrder(receivedProductId, 12, 13.5);
    const poItemId = po.items[0].id;
    const invoicePrefix = `FAC-PO-${Date.now()}`;

    const invoiceBeforeReceipt = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-ANTES`,
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 1, unitCost: 13.5 }],
    });
    expectStatus(invoiceBeforeReceipt, 400);

    const partialReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
      items: [{
        itemId: poItemId,
        quantityReceived: 5,
        batchNumber: 'PO-BATCH-1',
        expiryDate: '2027-01-09',
      }],
    });
    expectStatus(partialReceipt, 200);
    expect(partialReceipt.body.data.status).toBe('PARTIALLY_RECEIVED');

    const stockAfterReceipt = await getProduct(receivedProductId);
    const batchesAfterReceipt = await getBatches(receivedProductId);
    const kardexAfterReceipt = await getKardex(receivedProductId);
    expect(Number(stockAfterReceipt.stock)).toBe(5);
    expect(Number(batchesAfterReceipt[0].stock)).toBe(5);
    expect(kardexAfterReceipt).toHaveLength(1);

    const firstInvoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-1`,
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 3, unitCost: 13.5 }],
    });
    expectStatus(firstInvoice, 200);

    const exceedsRemaining = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-EXCESO`,
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 3, unitCost: 13.5 }],
    });
    expectStatus(exceedsRemaining, 400);

    const secondInvoice = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-2`,
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
      paymentMethod: 'CREDIT',
      dueDate: '2026-08-25',
      items: [{ productId: receivedProductId, quantity: 7, unitCost: 13.5 }],
    });
    expectStatus(finalInvoice, 200);

    const noBalanceLeft = await post('/api/purchases', {
      supplierId,
      purchaseOrderId: po.id,
      invoiceNumber: `${invoicePrefix}-4`,
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

  it('rechaza sobrerrecepcion y lineas repetidas sin efectos parciales', async () => {
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 10, 5);
    const itemId = po.items[0].id;

    const duplicateLines = await post(`/api/purchase-orders/${po.id}/receive`, {
      items: [
        { itemId, quantityReceived: 1 },
        { itemId, quantityReceived: 1 },
      ],
    });
    expectStatus(duplicateLines, 400);

    const overReceipt = await post(`/api/purchase-orders/${po.id}/receive`, {
      items: [{ itemId, quantityReceived: 11 }],
    });
    expectStatus(overReceipt, 400);

    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(0);
    expect(await getKardex(concurrencyProductId)).toHaveLength(0);
  }, 120_000);

  it('serializa dos recepciones simultaneas y solo incrementa el stock una vez', async () => {
    const po = await createApprovedPurchaseOrder(concurrencyProductId, 10, 5);
    const itemId = po.items[0].id;
    const body = { items: [{ itemId, quantityReceived: 10 }] };

    const results = await Promise.all([
      post(`/api/purchase-orders/${po.id}/receive`, body),
      post(`/api/purchase-orders/${po.id}/receive`, body),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(Number((await getProduct(concurrencyProductId)).stock)).toBe(10);
    expect(await getKardex(concurrencyProductId)).toHaveLength(1);

    const detail = await api(`/api/purchase-orders/${po.id}`);
    expectStatus(detail, 200);
    expect(detail.body.data.status).toBe('RECEIVED');
    expect(Number(detail.body.data.items[0].quantityReceived)).toBe(10);
  }, 120_000);

  it('serializa dos facturas identicas concurrentes sin duplicar inventario', async () => {
    const invoiceNumber = `FAC-CONCURRENT-${Date.now()}`;
    const requestStartedAt = Date.now();
    const payload = {
      supplierId,
      invoiceNumber,
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
    expect(new Date(createdPurchase.date).getTime()).toBeGreaterThanOrEqual(requestStartedAt - 2_000);
    expect(new Date(createdPurchase.date).getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
    expect(Number((await getProduct(duplicateInvoiceProductId)).stock)).toBe(1);
    expect(await getKardex(duplicateInvoiceProductId)).toHaveLength(1);
  }, 120_000);
});
