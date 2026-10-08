import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';
import prisma from '../../../backend/lib/prisma';
import type { InvoiceDraft } from '../../../shared/assistant';

export const baseUrl = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
export type TestActor = { tenantId: string; userId: string; role: string; token: string };
export type PurchaseFixture = TestActor & { supplierId: string; warehouseId: string; productId: string };

export function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error('Las fixtures requieren exclusivamente MySQL local descartable.');
  }
}

export async function api(path: string, actor?: TestActor, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
  if (!baseUrl) throw new Error('Falta backend HTTP de QA.');
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: response.status, body: payload, cacheControl: response.headers.get('cache-control') };
}

export function status(result: { status: number; body: any }, code: number) {
  expect(result.status, JSON.stringify(result.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value)).toBe(code);
}

export async function fixture(vertical: 'FERRETERIA' | 'FARMACIA' = 'FERRETERIA'): Promise<PurchaseFixture> {
  assertDisposableDatabase();
  const nonce = randomUUID();
  const registration = await api('/api/auth/register', undefined, 'POST', {
    companyName: `QA NortexGPT ${vertical} ${nonce}`, email: `assistant-${nonce}@example.invalid`,
    password: `Qa-${randomUUID()}!`, type: vertical,
  });
  status(registration, 200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: `assistant-${nonce}@example.invalid` } });
  const actor = { tenantId: user.tenantId, userId: user.id, role: user.role, token: registration.body.token };
  await prisma.tenant.update({ where: { id: actor.tenantId }, data: { fiscalRegime: 'GENERAL' } });
  await prisma.assistantTenantConfig.create({ data: { tenantId: actor.tenantId, enabled: true,
    extractionEnabled: true, executionEnabled: true, monthlyBudgetUsd: '10' } });
  const supplier = await api('/api/suppliers', actor, 'POST', { name: `Proveedor sintético ${nonce}`, category: 'QA' });
  status(supplier, 200);
  const warehouses = await api('/api/warehouses', actor); status(warehouses, 200);
  const product = await api('/api/products', actor, 'POST', {
    name: `Producto QA ${nonce}`, sku: `GPT-${nonce}`, category: 'QA', price: 20, cost: 0,
    stock: 0, minStock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1',
    isPublished: false, requiresBatchTracking: false, ivaExento: false,
  });
  status(product, 200);
  return { ...actor, supplierId: supplier.body.id,
    warehouseId: warehouses.body.data.find((row: any) => row.isDefault).id, productId: product.body.id };
}

export async function roleActor(owner: TestActor, role: string): Promise<TestActor> {
  const { signAuthToken } = await import('../../../backend/services/secrets');
  const user = await prisma.user.create({ data: { tenantId: owner.tenantId, name: `QA ${role}`,
    email: `gpt-role-${randomUUID()}@example.invalid`, password: 'no-login-synthetic-fixture', role } });
  return { tenantId: user.tenantId, userId: user.id, role,
    token: signAuthToken({ userId: user.id, tenantId: user.tenantId, role, email: user.email! }) };
}

export function purchaseInput(f: PurchaseFixture, overrides: Record<string, unknown> = {}) {
  return { supplierId: f.supplierId, warehouseId: f.warehouseId, invoiceNumber: `QA-${randomUUID()}`,
    date: '2026-09-05', postingDate: '2026-09-05', dueDate: '2026-10-05', paymentMethod: 'CREDIT',
    items: [{ productId: f.productId, quantity: '2', unitCost: '10', purchaseUnit: 'BASE' }], ...overrides };
}

export function invoiceDraft(f: PurchaseFixture, overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return { currency: 'NIO', supplierId: f.supplierId, invoiceNumber: `QA-${randomUUID()}`,
    date: '2026-09-05', postingDate: '2026-09-05', dueDate: '2026-10-05', warehouseId: f.warehouseId,
    paymentMethod: 'CREDIT', receivedConfirmed: true, paymentConfirmed: false,
    documentSubtotal: '20.00', documentTax: '3.00', documentTotal: '23.00',
    items: [{ productId: f.productId, description: 'Producto QA', quantity: '2', unitCost: '10', purchaseUnit: 'BASE' }],
    warnings: [], ...overrides };
}

/** Setup controlado: simula el resultado no confiable de extracción, nunca una compra. */
export async function draftProposal(f: PurchaseFixture, draft = invoiceDraft(f)) {
  const bytes = await readFile('tests/fixtures/assistant/corpus/ferreteria-001.pdf');
  const uploaded = await fetch(`${baseUrl}/api/assistant/attachments`, { method: 'POST',
    headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/pdf', 'x-file-name': 'factura-sintetica-qa.pdf' }, body: bytes });
  expect(uploaded.status, await uploaded.clone().text()).toBe(201);
  const attachment = await uploaded.json();
  return prisma.assistantProposal.create({ data: { tenantId: f.tenantId, userId: f.userId,
    roleAtCreation: f.role, attachmentIds: [attachment.id], draft: JSON.parse(JSON.stringify(draft)), issues: [],
    expiresAt: new Date(Date.now() + 86_400_000) } });
}

export async function prepareProposal(f: PurchaseFixture, draft = invoiceDraft(f)) {
  const proposal = await draftProposal(f, draft);
  const updated = await api(`/api/assistant/proposals/${proposal.id}`, f, 'PATCH', { version: proposal.version, draft });
  status(updated, 200);
  expect(updated.body.status, JSON.stringify(updated.body)).toBe('READY');
  expect(updated.body.preview.total).toBe(draft.documentTotal);
  return updated.body;
}

export async function invoiceEffects(f: PurchaseFixture, invoiceNumber: string) {
  const purchases = await prisma.purchase.findMany({ where: { tenantId: f.tenantId, supplierId: f.supplierId, invoiceNumber }, take: 10 });
  const product = await prisma.product.findFirstOrThrow({ where: { id: f.productId, tenantId: f.tenantId } });
  return { purchases, stock: product.stock,
    kardex: await prisma.kardexMovement.count({ where: { tenantId: f.tenantId, productId: f.productId } }),
    commands: await prisma.purchaseCommand.count({ where: { tenantId: f.tenantId, purchaseId: { in: purchases.map(row => row.id) } } }) };
}
