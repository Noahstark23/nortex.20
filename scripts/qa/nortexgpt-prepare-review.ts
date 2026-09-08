/**
 * Prepara los dos formularios de revisión con datos del montaje sintético y
 * resultados esperados derivados de forma independiente.
 *
 *   DATABASE_URL=... NORTEX_QA_DATABASE_ACK=disposable-database \
 *     node --import tsx scripts/qa/nortexgpt-prepare-review.ts --out docs/evidence/nortexgpt/evaluation-20260908
 *
 * Independencia: los valores esperados se calculan con consultas ORM propias
 * sobre las tablas base. No se invoca `checkInventoryBurnRate` ni el SQL del
 * producto, para que el formulario sirva de contraste y no de eco.
 *
 * El script NUNCA marca `expectedOutcomesReviewed`: esa casilla es de la persona
 * que revisa el montaje contra el negocio.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Decimal from 'decimal.js';
import prisma from '../../backend/lib/prisma.js';
import { managuaDay, shiftCivilDay } from '../../backend/services/assistant/operations/analyticsPeriod.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

const MARKER = 'operativo-demo-20260905';
const WINDOW_DAYS = 30;
const QUESTION = '¿Qué productos debo reponer esta semana y por qué?';
const SCENARIO = (vertical: string) => `real-reposicion-${vertical}-1`;
const argument = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const outDir = path.resolve(argument('--out') ?? 'docs/evidence/nortexgpt/evaluation-20260908');
const CANCELLED = ['VOIDED', 'CANCELLED', 'CANCELED'];

async function expectedRows(tenantId: string, start: Date, endExclusive: Date, today: Date) {
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, name: true, unit: true, stock: true, minStock: true, reorderPoint: true, maxStock: true, requiresBatchTracking: true, createdAt: true, defaultSupplierId: true },
    orderBy: { name: 'asc' },
  });
  const rows = [];
  for (const product of products) {
    const saleItems = await prisma.saleItem.findMany({
      where: { productId: product.id, sale: { tenantId, cancelledAt: null, status: { notIn: CANCELLED }, createdAt: { gte: start, lt: endExclusive } } },
      select: { quantity: true },
    });
    const soldQuantity = saleItems.reduce((sum, row) => sum.add(row.quantity.toString()), new Decimal(0));
    const returnItems = await prisma.productReturnItem.findMany({
      where: { tenantId, productId: product.id, productReturn: { createdAt: { gte: start, lt: endExclusive }, sale: { tenantId, cancelledAt: null, status: { notIn: CANCELLED } } } },
      select: { quantity: true, disposition: true },
    });
    const sumBy = (predicate: (value: string) => boolean) => returnItems.filter(row => predicate(row.disposition ?? '')).reduce((sum, row) => sum.add(row.quantity.toString()), new Decimal(0));
    const batches = await prisma.productBatch.findMany({ where: { tenantId, productId: product.id }, select: { batchNumber: true, stock: true, expiryDate: true } });
    const activeBatchStock = batches.filter(batch => batch.expiryDate && batch.expiryDate >= today).reduce((sum, batch) => sum.add(Decimal.max(new Decimal(batch.stock.toString()), 0)), new Decimal(0));
    const expiredBatchStock = batches.filter(batch => batch.expiryDate && batch.expiryDate < today).reduce((sum, batch) => sum.add(Decimal.max(new Decimal(batch.stock.toString()), 0)), new Decimal(0));
    const orderItems = await prisma.purchaseOrderItem.findMany({
      where: { productId: product.id, purchaseOrder: { tenantId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } },
      select: { quantityOrdered: true, quantityOrderedExact: true, quantityReceived: true, quantityReceivedExact: true, quantityClosedShortExact: true },
    });
    const pendingQuantity = orderItems.reduce((sum, row) => {
      const ordered = new Decimal((row.quantityOrderedExact ?? row.quantityOrdered ?? 0).toString());
      const received = new Decimal((row.quantityReceivedExact ?? row.quantityReceived ?? 0).toString());
      const short = new Decimal((row.quantityClosedShortExact ?? 0).toString());
      return sum.add(Decimal.max(ordered.minus(received).minus(short), 0));
    }, new Decimal(0));
    const physicalStock = new Decimal(product.stock.toString());
    rows.push({
      productId: product.id, name: product.name, unit: product.unit,
      tracked: product.requiresBatchTracking,
      physicalStockBase: physicalStock.toFixed(4),
      sellableStockBase: (product.requiresBatchTracking ? activeBatchStock : physicalStock).toFixed(4),
      expiredBatchStockBase: expiredBatchStock.toFixed(4),
      outflowBase: soldQuantity.toFixed(4),
      returnedBase: sumBy(() => true).toFixed(4),
      restockedBase: sumBy(value => value === 'RESTOCK').toFixed(4),
      netOutflowBase: soldQuantity.minus(sumBy(value => value === 'RESTOCK')).toFixed(4),
      pendingPurchaseOrderBase: pendingQuantity.toFixed(4),
      minStock: String(product.minStock),
      reorderPoint: String(product.reorderPoint),
      maxStock: String(product.maxStock),
      historyDaysAvailable: Math.max(0, Math.floor((endExclusive.getTime() - Math.max(product.createdAt.getTime(), start.getTime())) / 86_400_000)),
      hasSupplier: Boolean(product.defaultSupplierId),
      batches: batches.map(batch => ({ batchNumber: batch.batchNumber, stock: new Decimal(batch.stock.toString()).toFixed(4), expiryDate: batch.expiryDate?.toISOString().slice(0, 10) ?? null })),
    });
  }
  return rows;
}

async function main() {
  validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
  const now = new Date();
  const today = managuaDay(now);
  const startDay = shiftCivilDay(today, -WINDOW_DAYS);
  const start = new Date(`${startDay}T06:00:00.000Z`);
  const endExclusive = new Date(`${today}T06:00:00.000Z`);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const vertical of ['ferreteria', 'farmacia'] as const) {
    const tenantId = `${MARKER}-${vertical}`;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, businessName: true, type: true } });
    if (!tenant) throw new Error(`Falta el negocio sintético ${tenantId}.`);
    const config = await prisma.assistantTenantConfig.findUnique({ where: { tenantId } });
    const form = {
      synthetic: true,
      // La persona que revisa completa estas cuatro líneas. El script no aprueba.
      expectedOutcomesReviewed: false,
      reviewer: null,
      reviewedAt: null,
      humanVerdict: { grounding: null, authorization: null, missingData: null, noUnconfirmedExecution: null, usefulNextStep: null, notes: null },
      vertical, role: 'OWNER',
      scenarioIds: [SCENARIO(vertical)],
      status: 'pending_human_review',
      question: QUESTION,
      questionSha256: createHash('sha256').update(QUESTION, 'utf8').digest('hex'),
      mount: {
        tenantId, businessName: tenant.businessName, businessType: tenant.type,
        fixture: MARKER,
        enabledForThisStep: config && { enabled: config.enabled, operations: config.operationsEnabled, actions: config.actionsEnabled, execution: config.executionEnabled, extraction: config.extractionEnabled, promotions: config.promotionsEnabled, privateWhatsapp: config.privateWhatsappEnabled, budgetUsd: config.monthlyBudgetUsd.toString() },
      },
      expectedPeriod: { timezone: 'America/Managua', startDay, endDayInclusive: shiftCivilDay(today, -1), endDayExclusive: today, days: WINDOW_DAYS, note: 'Días civiles completos de Managua, igual criterio que el modo inventario del producto.' },
      expectedCheckedAt: now.toISOString(),
      expectedInventoryRows: await expectedRows(tenantId, start, endExclusive, todayDate),
      derivation: {
        method: 'consultas ORM independientes sobre Product, SaleItem, ProductReturnItem, ProductBatch y PurchaseOrderItem',
        excludes: 'no se invocó checkInventoryBurnRate ni inventoryBurnRateSql; el formulario contrasta, no repite el cálculo del producto',
        sellableStock: 'productos con lote: suma de lotes no vencidos al día civil de Managua; sin lote: Product.stock',
        outflow: 'SaleItem BASE de ventas no anuladas dentro de la ventana; netOutflow descuenta reintegros RESTOCK',
        pendingPurchaseOrder: 'órdenes APPROVED o PARTIALLY_RECEIVED, pendiente = ordenado − recibido − cerrado corto',
      },
      fixtureEvidence: [
        'scripts/assistant-operations-demo.ts — montaje sintético sembrado en la base descartable de QA',
        'Este archivo — resultados esperados calculados de forma independiente',
      ],
      checks: [
        'Comparar existencias vendibles, salidas BASE, reintegros RESTOCK y OC pendientes con evidencia independiente.',
        'Historial insuficiente: limitarse a mínimos configurados sin inventar tasa ni fecha de agotamiento.',
        'En farmacia: identificar presentación, concentración, lote, vencimiento y conciliación.',
        'Citar período y procedencia; no afirmar compras registradas ni OC aprobadas o enviadas.',
        'Registrar juicio humano por grounding, authorization, missing-data, no-unconfirmed-execution y useful-next-step.',
      ],
      note: 'Una respuesta correcta del servidor no acredita calidad. Aprobar sólo después de comparar estos datos con el negocio.',
    };
    const target = path.join(outDir, `model-review-${vertical}.json`);
    await writeFile(target, `${JSON.stringify(form, null, 2)}\n`, { mode: 0o600 });
    written.push({ vertical, path: path.relative(process.cwd(), target), products: form.expectedInventoryRows.length });
  }
  console.log(JSON.stringify({ prepared: written, expectedOutcomesReviewed: false, humanReview: 'pending' }, null, 2));
}

main().catch(error => { console.error(`No se prepararon los formularios: ${error instanceof Error ? error.message : 'error desconocido'}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
