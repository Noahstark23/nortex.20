import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { checkInventoryBurnRate, inspectBatchExpiry } from '../../backend/services/assistant/operations/inventory.ts';
import { auditBusinessHealth } from '../../backend/services/assistant/operations/analytics.ts';
import { prepareAssistantAction, previewAssistantAction, reviseAssistantAction, getAssistantAction, confirmAssistantAction } from '../../backend/services/assistant/actions/service.ts';
import { preparePromotion } from '../../backend/services/promotions/management.ts';
import { applyPromotionsToItems } from '../../backend/services/promotions/pricing.ts';
import { promotionConfig, promotionHash } from '../../backend/services/promotions/authority.ts';
import { assertCheckoutMatches, checkoutPriceHash } from '../../backend/services/promotions/checkout.ts';
import { calculateSaleTotals } from '../../backend/services/promotions/totals.ts';

const clone = value => {
  if (value instanceof Decimal) return new Decimal(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
};
const flags = ['NORTEX_ASSISTANT_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED', 'NORTEX_PROMOTIONS_ENABLED'];
export async function withOperationalEvaluationFlags(run) {
  const previous = flags.map(key => [key, process.env[key]]);
  flags.forEach(key => { process.env[key] = 'true'; });
  try { return await run(); } finally { previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }); }
}
function readFixture(scenario) {
  const input = scenario.input, tenantId = `evaluation-${scenario.vertical}`, role = input.role ?? 'OWNER';
  const actor = { id: 'operator-a', tenantId, status: 'ACTIVE', role };
  const principal = { tenantId: input.tenantId ?? tenantId, userId: actor.id, role };
  const queries = [], repositoryErrors = [], db = {
    user: { findFirst: async ({ where }) => where.id === actor.id && where.tenantId === tenantId ? clone(actor) : null },
    assistantTenantConfig: { findUnique: async ({ where }) => { assert.equal(where.tenantId, tenantId); return { enabled: true, actionsEnabled: true, executionEnabled: true, promotionsEnabled: true }; } },
    warehouse: { findFirst: async ({ where }) => { assert.equal(where.tenantId, tenantId); return where.id === 'warehouse-a' ? { id: where.id } : null; } },
    $queryRaw: async (query, ...bindings) => {
      const sql = query.sql ?? query.join('?'), values = query.values ?? bindings;
      queries.push({ sql, values });
      if (!values.includes(tenantId)) repositoryErrors.push('Actual query must bind authenticated tenant');
      if (/\b(?:INSERT|DELETE|UPDATE)\b/.test(sql.replace(/FOR (?:UPDATE|SHARE)/g, ''))) repositoryErrors.push('Read adapter must not mutate');
      if (input.failQuery) throw new Error('synthetic read outage');
      if (sql.includes('FROM `User`')) return [clone(actor)];
      return clone(db.rows ?? []);
    },
  };
  return { db, principal, actor, queries, repositoryErrors, now: new Date(input.now ?? '2026-09-05T18:25:00Z') };
}
function inventoryRow(vertical) {
  return { productId: 'product-a', name: vertical === 'farmacia' ? 'Amoxicilina 500 mg' : 'Cemento 42.5 kg', unit: 'unidad', quantityStep: '1', saleMode: 'COUNTED', supplierId: 'supplier-a', physicalStock: '10', reorderPoint: '5', maxStock: '100', requiresBatchTracking: vertical === 'farmacia', cost: '17.25', historyAvailableDays: 30, soldQuantity: '60', returnedQuantity: '10', restockedQuantity: '10', quarantinedQuantity: '0', lostQuantity: '0', pendingQuantity: '20', unknownRows: '0', batchCount: '2', batchStock: '10', activeStock: '7', negativeBatches: '0', warehouseStock: '10', targetStock: '4', targetRows: '1', negativeWarehouses: '0' };
}
function expiryRow(vertical) {
  return { batchId: 'batch-a', batchNumber: 'LOT-A', productId: 'product-a', name: vertical === 'farmacia' ? 'Amoxicilina 500 mg' : 'Adhesivo de construcción', unit: 'unidad', quantityStep: '1', saleMode: 'COUNTED', supplierId: 'supplier-a', expiryDate: '2026-09-05', physicalStock: '10', productStock: '15', allBatchStock: '15', negativeBatches: '0', batchWarehouseLedgerMode: 'ENFORCED', warehouseBatchStock: '10', targetBatchStock: '4', productWarehouseBatchStock: '6', productWarehouseStock: '6' };
}
const healthRow = { salesCount: '4', salesTotal: '460', salesVat: '60', unknownVat: '0', soldCost: '240', unknownCost: '0', returnsTotal: '57.5', returnedCost: '30', returnedVat: '7.5', ambiguousReturns: '0', unknownReturnVat: '0', unknownReturnCost: '0', expensesTotal: '15' };

function actionFixture(scenario) {
  const fixture = readFixture(scenario), { db, actor } = fixture, proposals = [];
  let domainWrites = 0;
  const forbiddenWrite = async () => { domainWrites++; throw new Error('Unexpected domain execution'); };
  for (const model of ['purchaseOrder', 'purchase', 'productStock', 'productBatch', 'supplierReturn', 'auditLog', 'kardexMovement', 'journalEntry']) db[model] = { create: forbiddenWrite, createMany: forbiddenWrite, update: forbiddenWrite, updateMany: forbiddenWrite, delete: forbiddenWrite, deleteMany: forbiddenWrite, upsert: forbiddenWrite };
  db.$executeRaw = forbiddenWrite; db.$executeRawUnsafe = forbiddenWrite;
  const match = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
    }
    return row[key] === value;
  });
  db.assistantActionProposal = {
    findFirst: async ({ where }) => clone(proposals.find(row => match(row, where)) ?? null),
    create: async ({ data }) => { const row = { status: 'DRAFT', version: 1, previewJson: null, previewHash: null, ...clone(data) }; proposals.push(row); return clone(row); },
    updateMany: async ({ where, data }) => {
      const rows = proposals.filter(row => match(row, where));
      rows.forEach(row => Object.entries(data).forEach(([key, value]) => { row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : clone(value); }));
      return { count: rows.length };
    },
  };
  db.assistantActionCommand = { findFirst: async () => null, create: async () => { throw new Error('Unexpected domain execution'); } };
  db.$queryRaw = async (query, ...values) => {
    assert.ok(values.includes(actor.tenantId), 'Proposal lock must bind authenticated tenant');
    return query.join('?').includes('FROM `User`') ? [clone(actor)] : [];
  };
  db.$transaction = async run => {
    const snapshot = clone(proposals);
    try { return await run(db); } catch (error) { proposals.splice(0, proposals.length, ...snapshot); throw error; }
  };
  return { ...fixture, proposals, get domainWrites() { return domainWrites; } };
}
async function actionScenario(scenario) {
  const f = actionFixture(scenario), { input } = scenario;
  const kind = input.kind ?? (scenario.area === 'reposicion' ? 'PURCHASE_ORDER_DRAFT' : 'BATCH_WRITEOFF');
  const draft = kind === 'PURCHASE_ORDER_DRAFT' ? { supplierId: 'supplier-a', items: [{ productId: 'product-a', quantity: '2', unitCost: '17.25' }] }
    : kind === 'BATCH_WRITEOFF' ? { batchId: 'batch-a', warehouseId: 'warehouse-a', quantity: '2', reason: 'Vencimiento revisado', physicalRemovalConfirmed: input.physicalRemovalConfirmed ?? false }
      : { supplierId: 'supplier-a', physicalShipmentConfirmed: input.physicalShipmentConfirmed ?? false, lines: [] };
  const first = await prepareAssistantAction(f.principal, kind, input.mode === 'missing-preview' ? {} : draft, 'evaluation-prepare-001', f.db);
  const result = value => ({ ...value, proposalCount: f.proposals.length, domainWrites: f.domainWrites });
  if (input.mode === 'replay') return result({ sameId: first.id === (await prepareAssistantAction(f.principal, kind, draft, 'evaluation-prepare-001', f.db)).id });
  if (input.mode === 'conflict') return prepareAssistantAction(f.principal, kind, { ...draft, notes: 'Contenido cambiado' }, 'evaluation-prepare-001', f.db);
  if (input.mode === 'foreign' || input.mode === 'foreign-user') return getAssistantAction({ ...f.principal, ...(input.mode === 'foreign' ? { tenantId: 'foreign' } : { userId: 'foreign' }) }, first.id, f.db);
  if (input.mode === 'expired') f.proposals[0].expiresAt = new Date(0);
  if (['expired', 'wrong-version'].includes(input.mode)) return confirmAssistantAction(f.principal, first.id, first.version + (input.mode === 'wrong-version' ? 1 : 0), 'evaluation-confirm-001', f.db);
  if (input.mode === 'missing-preview') { const reviewed = await previewAssistantAction(f.principal, first.id, first.version, f.db); return result({ ...reviewed, hasIssues: reviewed.issues.length > 0 }); }
  if (input.mode === 'revise') {
    // Stored READY is a starting fixture, never a fake domain validation result.
    f.proposals[0].status = 'READY'; f.proposals[0].previewHash = 'old-reviewed-hash'; f.proposals[0].previewJson = { issues: [], preview: { summary: 'Revisión previa' } };
    return result(await reviseAssistantAction(f.principal, first.id, first.version, { ...draft, quantity: '3' }, f.db));
  }
  return result(first);
}
function promotionFixture(scenario) {
  const f = readFixture(scenario), exempt = scenario.vertical === 'farmacia';
  const fiscal = { fiscalRegime: 'GENERAL', fiscalRegimeVersion: 1 };
  const product = { id: 'product-a', name: exempt ? 'Medicamento exento' : 'Herramienta gravada', unit: 'unidad', price: '115', cost: '65', ivaExento: exempt, saleMode: 'COUNTED', quantityStep: '1', wholesalePrice: null, wholesaleMinQty: null, packUnit: null, packSize: null, packPrice: null, requiresBatchTracking: exempt };
  const item = { productId: product.id, quantity: new Decimal(2), unitPrice: new Decimal(115), discountPct: new Decimal(scenario.input.lineDiscount ?? 0), ivaExento: exempt, unitAtSale: 'unidad', saleModeAtSale: 'COUNTED', quantityStepAtSale: '1', presentationAtSale: 'BASE', presentationQuantityAtSale: new Decimal(2), quotationId: scenario.input.quotationId };
  const configHash = promotionHash(promotionConfig(product, fiscal));
  const promotion = { productId: product.id, configHash: scenario.input.changedConfig ? 'old-config' : configHash, id: 'promotion-a', version: 1, name: 'Promoción revisada', percent: new Decimal(10), startsAt: new Date('2026-09-05T14:00:00Z'), endsAt: new Date('2026-09-06T00:00:00Z') };
  f.db.tenant = { findUnique: async ({ where }) => { assert.equal(where.id, f.actor.tenantId); return fiscal; } };
  f.db.product = { findMany: async ({ where }) => { assert.equal(where.tenantId, f.actor.tenantId); return scenario.input.foreignProduct ? [] : [product]; } };
  return { ...f, fiscal, product, item, promotion };
}
async function promotionScenario(scenario) {
  const f = promotionFixture(scenario), { input } = scenario;
  if (scenario.target === 'promotion-prepare') {
    f.db.rows = [];
    return preparePromotion(f.principal, { name: 'Promoción de temporada', percent: '10', productIds: ['product-a'], startsAt: '2026-09-05T08:00', endsAt: '2026-09-05T18:00', ...input.draft }, f.db, false, f.now);
  }
  f.db.rows = [f.promotion];
  const promoted = await applyPromotionsToItems(f.db, f.actor.tenantId, [f.item], [f.product], { ...f.fiscal, at: f.now, globalDiscount: input.globalDiscount ?? '0' });
  if (scenario.target === 'promotion-price') return { ...promoted[0], unitPrice: promoted[0].unitPrice.toString() };
  const totals = calculateSaleTotals(promoted, '0', f.fiscal.fiscalRegime);
  const checkout = input.noQuote ? null : { expiresAt: new Date(input.expiredQuote ? '2026-09-05T18:24:00Z' : '2026-09-05T18:27:00Z'), priceHash: checkoutPriceHash(promoted, f.fiscal, totals) };
  if (input.expiredPromotion) {
    promoted[0].promotionSnapshot.endsAt = f.now.toISOString();
    checkout.priceHash = checkoutPriceHash(promoted, f.fiscal, totals); // The review matched but validity ends exactly at charge.
  }
  if (input.changedCart) promoted[0].quantity = new Decimal(3);
  assertCheckoutMatches(checkout, promoted, f.fiscal, totals, f.now);
  return { accepted: true, total: totals.finalTotal.toFixed(2), vat: new Decimal(totals.fiscalAmounts.vatAmount).toFixed(4), exempt: totals.exemptTotal.toFixed(2) };
}
export async function evaluateOperationalScenario(scenario) {
  try {
    let output;
    if (scenario.target === 'action') output = await actionScenario(scenario);
    else if (scenario.target.startsWith('promotion-')) output = await promotionScenario(scenario);
    else {
      const f = readFixture(scenario), { input } = scenario;
      f.db.rows = [{ ...(scenario.target === 'inventory' ? inventoryRow(scenario.vertical) : scenario.target === 'expiry' ? expiryRow(scenario.vertical) : healthRow), ...input.row }];
      const operation = { inventory: checkInventoryBurnRate, expiry: inspectBatchExpiry, health: auditBusinessHealth }[scenario.target];
      output = await operation(f.principal, input.query ?? {}, { db: f.db, now: () => f.now });
      assert.deepEqual(f.repositoryErrors, [], 'Query-boundary failures must not masquerade as expected unavailable data');
      if (scenario.target === 'health') {
        output.metric = Object.fromEntries(output.metrics.map(metric => [metric.key, metric.value]));
        if (f.principal.role === 'CASHIER') f.queries.forEach(query => assert.ok(query.values.includes(f.principal.userId), 'Cashier SQL must bind the operator'));
      }
      if (input.role === 'BODEGUERO') f.queries.forEach(query => assert.ok(!/p\.cost\b/i.test(query.sql), 'Costs must not be queried for warehouse role'));
    }
    return { output };
  } catch (error) { return { error: error.code ?? error.name, message: error.message }; }
}
function atPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
export function assertOperationalExpected(actual, expected) {
  if (expected.error) { assert.equal(actual.error, expected.error, actual.message); return; }
  assert.equal(actual.error, undefined, actual.message);
  for (const [path, value] of Object.entries(expected)) {
    if (path === 'absent') value.forEach(absent => assert.equal(atPath(actual.output, absent), undefined, `${absent} must be omitted`));
    else assert.deepEqual(atPath(actual.output, path), value, path);
  }
}
