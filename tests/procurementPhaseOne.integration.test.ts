import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/**
 * QA HTTP real de Proveedor 360 y cuentas por pagar.
 *
 * Se omite en la suite normal porque requiere un MySQL 8 descartable y un
 * backend aislado apuntando a esa misma base. Ejecucion:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3100 vitest run tests/procurementPhaseOne.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
  status: number;
  body: T;
};

let tenantAToken = '';
let tenantBToken = '';
let tenantAId = '';
let tenantAUserId = '';
let supplierAId = '';
let supplierBId = '';
let supplierContactId = '';
let supplierDocumentId = '';
let productId = '';
let purchaseId = '';
let partialPaymentId = '';
let finalPaymentId = '';
let initialCashMovementCount = 0;
let initialExpenseCount = 0;

const partialClientEventId = crypto.randomUUID();
const finalClientEventId = crypto.randomUUID();

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

function journalLineSnapshot(entry: any) {
  return Object.fromEntries(entry.lines.map((line: any) => [
    line.account.code,
    {
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
    },
  ]));
}

async function expectNoCashSideEffects() {
  expect(await prisma.cashMovement.count({ where: { tenantId: tenantAId } }))
    .toBe(initialCashMovementCount);
  expect(await prisma.expense.count({ where: { tenantId: tenantAId } }))
    .toBe(initialExpenseCount);
}

qaDescribe('QA integracion: Proveedor 360 y cuentas por pagar', () => {
  beforeAll(async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const tenantARegistration = await post('/api/auth/register', {
      companyName: `QA Compras Fase 1 A ${runId}`,
      email: `qa-procurement-a-${runId}@example.invalid`,
      password: `Qa-${runId}-A-Seguro!`,
      type: 'RETAIL',
    }, '');
    expectStatus(tenantARegistration, 200);
    tenantAToken = tenantARegistration.body.token;
    tenantAId = tenantARegistration.body.tenant.id;
    tenantAUserId = tenantARegistration.body.user.id;

    const tenantBRegistration = await post('/api/auth/register', {
      companyName: `QA Compras Fase 1 B ${runId}`,
      email: `qa-procurement-b-${runId}@example.invalid`,
      password: `Qa-${runId}-B-Seguro!`,
      type: 'RETAIL',
    }, '');
    expectStatus(tenantBRegistration, 200);
    tenantBToken = tenantBRegistration.body.token;

    const supplierA = await post('/api/suppliers', {
      name: 'Proveedor QA Fase 1',
      ruc: `RUC-A-${runId}`,
      category: 'Alimentos',
      legalType: 'JURIDICAL',
      fiscalCategory: 'GENERAL',
      currency: 'NIO',
      paymentTermsDays: 30,
      creditLimit: '5000.0000',
      leadTimeDays: 3,
      minimumOrderAmount: '100.0000',
      notes: 'Fixture HTTP aislado',
    });
    expectStatus(supplierA, 200);
    supplierAId = supplierA.body.id;

    const supplierB = await post('/api/suppliers', {
      name: 'Proveedor QA Fase 1',
      category: 'Tenant B',
    }, tenantBToken);
    expectStatus(supplierB, 200);
    supplierBId = supplierB.body.id;

    const contact = await post(`/api/suppliers/${supplierAId}/contacts`, {
      name: 'Compras QA',
      title: 'Ejecutiva de cuenta',
      phone: '88888888',
      email: `contacto-${runId}@example.invalid`,
      isPrimary: true,
    });
    expectStatus(contact, 201);
    supplierContactId = contact.body.data.id;

    const document = await post(`/api/suppliers/${supplierAId}/documents`, {
      kind: 'RUC',
      fileName: 'ruc-proveedor.pdf',
      storageKey: `qa/${runId}/ruc-proveedor.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    });
    expectStatus(document, 201);
    supplierDocumentId = document.body.data.id;

    const product = await post('/api/products', {
      name: 'Producto QA CxP',
      sku: `QA-CXP-${runId}`,
      category: 'QA Compras',
      price: 150,
      cost: 0,
      stock: 0,
      minStock: 0,
      unit: 'unidad',
      isPublished: false,
      requiresBatchTracking: false,
      ivaExento: true,
    });
    expectStatus(product, 200);
    productId = product.body.id;

    const purchase = await post('/api/purchases', {
      supplierId: supplierAId,
      invoiceNumber: `FAC-CXP-${runId}`,
      date: '2026-08-27',
      dueDate: '2026-09-26',
      paymentMethod: 'CREDIT',
      notes: 'Compra a credito para QA HTTP',
      items: [{ productId, quantity: 1, unitCost: '100.00' }],
    });
    expectStatus(purchase, 200);
    purchaseId = purchase.body.purchase.id;
    expect(purchase.body.purchase.status).toBe('PENDING_PAYMENT');

    const persistedPurchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId: tenantAId },
    });
    expect(persistedPurchase?.total.toFixed(2)).toBe('100.00');
    expect(persistedPurchase?.balanceDue?.toFixed(4)).toBe('100.0000');

    initialCashMovementCount = await prisma.cashMovement.count({
      where: { tenantId: tenantAId },
    });
    initialExpenseCount = await prisma.expense.count({ where: { tenantId: tenantAId } });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('expone Proveedor 360 y aisla lectura y escritura entre dos tenants', async () => {
    const ownDetail = await api(`/api/suppliers/${supplierAId}`, tenantAToken);
    expectStatus(ownDetail, 200);
    expect(ownDetail.body.data.supplier.id).toBe(supplierAId);
    expect(ownDetail.body.data.supplier.creditLimit).toBe('5000.0000');
    expect(ownDetail.body.data.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: supplierContactId, isPrimary: true }),
    ]));
    expect(ownDetail.body.data.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: supplierDocumentId,
        storageKey: expect.stringContaining(`tenants/${tenantAId}/suppliers/${supplierAId}/`),
      }),
    ]));
    expect(ownDetail.body.data.recentPurchases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: purchaseId,
        total: '100.0000',
        balanceDue: '100.0000',
        status: 'PENDING_PAYMENT',
      }),
    ]));
    expect(ownDetail.body.data.aggregates).toEqual(expect.objectContaining({
      purchaseCount: 1,
      paymentCount: 0,
      totalPurchased: '100.0000',
      outstandingBalance: '100.0000',
    }));

    const listA = await api<any[]>('/api/suppliers?status=ALL', tenantAToken);
    const listB = await api<any[]>('/api/suppliers?status=ALL', tenantBToken);
    expectStatus(listA, 200);
    expectStatus(listB, 200);
    expect(listA.body.map((supplier) => supplier.id)).toContain(supplierAId);
    expect(listA.body.map((supplier) => supplier.id)).not.toContain(supplierBId);
    expect(listB.body.map((supplier) => supplier.id)).toContain(supplierBId);
    expect(listB.body.map((supplier) => supplier.id)).not.toContain(supplierAId);

    const foreignDetail = await api(`/api/suppliers/${supplierAId}`, tenantBToken);
    expectStatus(foreignDetail, 404);
    expect(foreignDetail.body.code).toBe('SUPPLIER_NOT_FOUND');

    const foreignContact = await post(`/api/suppliers/${supplierAId}/contacts`, {
      name: 'Cruce prohibido',
      isPrimary: true,
    }, tenantBToken);
    expectStatus(foreignContact, 404);
    expect(await prisma.supplierContact.count({
      where: { tenantId: tenantAId, supplierId: supplierAId },
    })).toBe(1);
  });

  it('rechaza el atajo heredado de pago por caja sin producir efectos', async () => {
    const before = {
      cashMovements: await prisma.cashMovement.count({ where: { tenantId: tenantAId } }),
      expenses: await prisma.expense.count({ where: { tenantId: tenantAId } }),
      supplierPayments: await prisma.supplierPayment.count({ where: { tenantId: tenantAId } }),
      journalEntries: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
    };

    const legacyBypass = await post('/api/cash-movements', {
      type: 'OUT',
      amount: '10.00',
      category: 'PAGO_PROVEEDOR',
      description: 'Intento de pago sin factura',
    });

    expectStatus(legacyBypass, 409);
    expect(legacyBypass.body.code).toBe('SUPPLIER_PAYMENT_REQUIRES_PURCHASE');
    expect({
      cashMovements: await prisma.cashMovement.count({ where: { tenantId: tenantAId } }),
      expenses: await prisma.expense.count({ where: { tenantId: tenantAId } }),
      supplierPayments: await prisma.supplierPayment.count({ where: { tenantId: tenantAId } }),
      journalEntries: await prisma.journalEntry.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
    }).toEqual(before);
  });

  it('registra un abono TRANSFER decimal exacto sin tocar caja ni crear gasto', async () => {
    const excessivePrecision = await post(`/api/purchases/${purchaseId}/pay`, {
      amount: '0.001',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    });
    expectStatus(excessivePrecision, 400);
    expect(excessivePrecision.body.details.amount).toContain(
      'El abono admite como máximo 2 decimales',
    );

    const foreignPayment = await post(`/api/purchases/${purchaseId}/pay`, {
      amount: '30.12',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    }, tenantBToken);
    expectStatus(foreignPayment, 404);
    expect(foreignPayment.body.code).toBe('PURCHASE_NOT_FOUND');

    const partial = await post(`/api/purchases/${purchaseId}/pay`, {
      amount: '30.12',
      method: 'TRANSFER',
      clientEventId: partialClientEventId,
      reference: 'TRX-QA-001',
      notes: 'Primer abono HTTP',
    });
    expectStatus(partial, 200);
    expect(partial.body.replay).toBe(false);
    expect(partial.body.purchase).toEqual(expect.objectContaining({
      id: purchaseId,
      status: 'PARTIALLY_PAID',
      balanceDue: '69.88',
    }));
    expect(partial.body.payment).toEqual(expect.objectContaining({
      amount: '30.12',
      method: 'TRANSFER',
      clientEventId: partialClientEventId,
    }));
    partialPaymentId = partial.body.payment.id;

    const persistedPurchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId: tenantAId },
    });
    expect(persistedPurchase?.status).toBe('PARTIALLY_PAID');
    expect(persistedPurchase?.balanceDue?.toFixed(4)).toBe('69.8800');
    expect(persistedPurchase?.paidAt).toBeNull();

    const payments = await prisma.supplierPayment.findMany({
      where: { tenantId: tenantAId, purchaseId },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(partialPaymentId);
    expect(payments[0].amount.toFixed(4)).toBe('30.1200');
    expect(payments[0].method).toBe('TRANSFER');

    const entry = await prisma.journalEntry.findFirst({
      where: {
        tenantId: tenantAId,
        referenceId: partialPaymentId,
        referenceType: 'SUPPLIER_PAYMENT',
      },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(entry).not.toBeNull();
    expect(journalLineSnapshot(entry)).toEqual({
      '2.1.1': { debit: '30.12', credit: '0.00' },
      '1.1.2': { debit: '0.00', credit: '30.12' },
    });
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'SUPPLIER_PAYMENT_CREATED' },
    })).toBe(1);
    await expectNoCashSideEffects();

    const supplierDetail = await api(`/api/suppliers/${supplierAId}`, tenantAToken);
    expectStatus(supplierDetail, 200);
    expect(supplierDetail.body.data.aggregates).toEqual(expect.objectContaining({
      paymentCount: 1,
      recordedPaymentAmount: '30.1200',
      totalPaid: '30.1200',
      outstandingBalance: '69.8800',
    }));
  });

  it('hace replay exacto y rechaza reutilizar el UUID con otra intencion', async () => {
    const payload = {
      amount: '30.12',
      method: 'TRANSFER',
      clientEventId: partialClientEventId,
      reference: 'TRX-QA-001',
      notes: 'Primer abono HTTP',
    };
    const retry = await post(`/api/purchases/${purchaseId}/pay`, payload);
    expectStatus(retry, 200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.payment.id).toBe(partialPaymentId);
    expect(retry.body.purchase.status).toBe('PARTIALLY_PAID');
    expect(retry.body.purchase.balanceDue).toBe('69.88');

    const conflict = await post(`/api/purchases/${purchaseId}/pay`, {
      ...payload,
      amount: '30.13',
    });
    expectStatus(conflict, 409);
    expect(conflict.body.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');

    expect(await prisma.supplierPayment.count({
      where: { tenantId: tenantAId, purchaseId },
    })).toBe(1);
    expect(await prisma.journalEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: partialPaymentId,
        referenceType: 'SUPPLIER_PAYMENT',
      },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'SUPPLIER_PAYMENT_CREATED' },
    })).toBe(1);
    await expectNoCashSideEffects();
  });

  it('liquida el saldo final, cuadra CxP/Bancos y actualiza Proveedor 360', async () => {
    const finalPayment = await post(`/api/purchases/${purchaseId}/pay`, {
      amount: '69.88',
      method: 'TRANSFER',
      clientEventId: finalClientEventId,
      reference: 'TRX-QA-002',
    });
    expectStatus(finalPayment, 200);
    expect(finalPayment.body.replay).toBe(false);
    expect(finalPayment.body.purchase.status).toBe('COMPLETED');
    expect(finalPayment.body.purchase.balanceDue).toBe('0');
    expect(finalPayment.body.purchase.paidAt).toEqual(expect.any(String));
    finalPaymentId = finalPayment.body.payment.id;

    const persistedPurchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId: tenantAId },
    });
    expect(persistedPurchase?.status).toBe('COMPLETED');
    expect(persistedPurchase?.balanceDue?.toFixed(4)).toBe('0.0000');
    expect(persistedPurchase?.paidAt).toBeInstanceOf(Date);

    const payments = await prisma.supplierPayment.findMany({
      where: { tenantId: tenantAId, purchaseId },
      orderBy: { paidAt: 'asc' },
    });
    expect(payments).toHaveLength(2);
    expect(payments.map((payment) => payment.amount.toFixed(4)).sort())
      .toEqual(['30.1200', '69.8800']);

    const finalEntry = await prisma.journalEntry.findFirst({
      where: {
        tenantId: tenantAId,
        referenceId: finalPaymentId,
        referenceType: 'SUPPLIER_PAYMENT',
      },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(journalLineSnapshot(finalEntry)).toEqual({
      '2.1.1': { debit: '69.88', credit: '0.00' },
      '1.1.2': { debit: '0.00', credit: '69.88' },
    });

    const accounts = await prisma.account.findMany({
      where: { tenantId: tenantAId, code: { in: ['1.1.2', '2.1.1'] } },
      orderBy: { code: 'asc' },
    });
    expect(Object.fromEntries(accounts.map((account) => [account.code, account.balance.toFixed(2)])))
      .toEqual({ '1.1.2': '-100.00', '2.1.1': '0.00' });
    expect(await prisma.auditLog.count({
      where: { tenantId: tenantAId, action: 'SUPPLIER_PAYMENT_CREATED' },
    })).toBe(2);
    await expectNoCashSideEffects();

    const supplierDetail = await api(`/api/suppliers/${supplierAId}`, tenantAToken);
    expectStatus(supplierDetail, 200);
    expect(supplierDetail.body.data.recentPayments.map((payment: any) => payment.id))
      .toEqual(expect.arrayContaining([partialPaymentId, finalPaymentId]));
    expect(supplierDetail.body.data.aggregates).toEqual(expect.objectContaining({
      paymentCount: 2,
      recordedPaymentAmount: '100.0000',
      totalPaid: '100.0000',
      outstandingBalance: '0.0000',
    }));

    const pending = await api('/api/purchases/pending', tenantAToken);
    expectStatus(pending, 200);
    expect(pending.body.purchases.map((purchase: any) => purchase.id)).not.toContain(purchaseId);
  });

  it('mantiene Nortex Capital fail-closed sin inventario, pago ni asiento', async () => {
    const stockBefore = await prisma.product.findFirst({
      where: { id: productId, tenantId: tenantAId },
      select: { stock: true },
    });
    const purchasesBefore = await prisma.purchase.count({ where: { tenantId: tenantAId } });

    const financeAttempt = await post('/api/capital/finance-purchase', {
      supplierId: supplierAId,
      items: [{ productId, productName: 'Producto QA CxP', quantity: 1, unitCost: '50.00' }],
    });
    expectStatus(financeAttempt, 409);
    expect(financeAttempt.body.code).toBe('CAPITAL_PURCHASE_REQUIRES_RECEIPT_WORKFLOW');
    expect(await prisma.purchase.count({ where: { tenantId: tenantAId } })).toBe(purchasesBefore);
    expect((await prisma.product.findFirst({
      where: { id: productId, tenantId: tenantAId },
      select: { stock: true },
    }))?.stock).toBe(stockBefore?.stock);

    const capitalPurchase = await prisma.purchase.create({
      data: {
        tenantId: tenantAId,
        supplierId: supplierAId,
        invoiceNumber: `CAP-QA-${crypto.randomUUID()}`,
        date: new Date('2026-08-27T12:00:00.000Z'),
        dueDate: new Date('2026-09-26T12:00:00.000Z'),
        subtotal: '50.00',
        tax: '0.00',
        creditableTax: '0.0000',
        total: '50.00',
        status: 'PENDING_PAYMENT',
        paymentMethod: 'NORTEX_CAPITAL',
        balanceDue: '50.0000',
        createdBy: tenantAUserId,
      },
    });

    const paymentAttempt = await post(`/api/purchases/${capitalPurchase.id}/pay`, {
      amount: '50.00',
      method: 'TRANSFER',
      clientEventId: crypto.randomUUID(),
    });
    expectStatus(paymentAttempt, 409);
    expect(paymentAttempt.body.code).toBe('CAPITAL_PURCHASE_NOT_PAYABLE');
    expect(await prisma.supplierPayment.count({
      where: { tenantId: tenantAId, purchaseId: capitalPurchase.id },
    })).toBe(0);
    expect(await prisma.journalEntry.count({
      where: {
        tenantId: tenantAId,
        referenceId: capitalPurchase.id,
        referenceType: 'SUPPLIER_PAYMENT',
      },
    })).toBe(0);
    await expectNoCashSideEffects();
  });
});
