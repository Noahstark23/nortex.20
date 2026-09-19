import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { WriteoffBatchSchema } from '../backend/validation/schemas';
import { validateQuantity } from '../utils/quantity';
import * as commands from '../backend/lib/manualBatchMovements';
const dependencies = vi.hoisted(() => ({db: null as any, context: null as any}));
vi.mock('../backend/lib/prisma', () => ({default: new Proxy({}, {get: (_target, property) => dependencies.db[property]})}));
vi.mock('../backend/services/accounting', () => ({assertPeriodOpen: (...args: any[]) => dependencies.context.assertPeriodOpen(...args), createJournalEntry: (...args: any[]) => dependencies.context.createJournalEntry(...args)}));
vi.mock('../backend/services/stockService', () => ({
  applyStockDelta: (...args: any[]) => dependencies.context.applyStockDelta(...args),
  materializeWarehouseRow: (...args: any[]) => dependencies.context.materializeWarehouseRow(...args),
  resolveOperationalWarehouse: (...args: any[]) => dependencies.context.resolveOperationalWarehouse(...args),
  StockError: class extends Error {constructor(public code: string, message: string) {super(message);}},
}));
vi.mock('../backend/services/productBatchWarehouseLedgerService', () => ({
  resolveBatchWarehouseLedgerMode: (...args: any[]) => dependencies.context.resolveBatchWarehouseLedgerMode(...args),
  applyBatchWarehouseDelta: (...args: any[]) => dependencies.context.applyBatchWarehouseDelta(...args),
  BatchWarehouseLedgerError: class extends Error {},
}));
import { executeBatchWriteoff } from '../backend/services/batchWriteoffService';

/** Antes de extraer estos tres escenarios ejecutaron el handler original; ahora el mismo dominio importado. */
async function fixture(options: {auditFails?: boolean; localStock?: number; batchStock?: number} = {}) {
  const state = {stock: 10, local: options.localStock ?? 5, batch: options.batchStock ?? 7, audits: [] as any[], kardex: [] as any[], journals: [] as any[]};
  const product = {id: 'p', name: 'Pintura', cost: 12.34, saleMode: 'MEASURED', quantityStep: '0.25'};
  const batch = {id: 'b', productId: 'p', batchNumber: 'L1', expiryDate: new Date('2025-01-01'), get stock() { return state.batch; }};
  const tx: any = {
    user: {findFirst: vi.fn(async () => ({id: 'u', status: 'ACTIVE', role: 'OWNER'}))},
    productBatch: {findFirst: vi.fn(async () => batch), updateMany: vi.fn(async ({data}: any) => {state.batch -= data.stock.decrement; return {count: 1};})},
    auditLog: {findFirst: vi.fn(async () => null), create: vi.fn(async ({data}: any) => {if (options.auditFails && data.action === 'BATCH_WRITEOFF') throw new Error('audit failed'); state.audits.push(data); return data;})},
    kardexMovement: {create: vi.fn(async ({data}: any) => {state.kardex.push(data); return data;})},
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      const sql = query.join('?');
      if (sql.includes('FROM `User`')) return [{id: 'u', role: 'OWNER', status: 'ACTIVE'}];
      if (sql.includes('FROM `ProductStock`')) return [{stock: state.local}];
      if (sql.includes('FROM `ProductBatch`')) return [batch];
      return [product];
    }),
  };
  const db: any = {...tx, $transaction: vi.fn(async (run: any) => {
    const original = structuredClone(state);
    try { return await run(tx); } catch (error) {Object.assign(state, original); throw error;}
  })};
  const context: any = {
    Decimal, ...commands, prisma: db, console: {error: vi.fn()},
    authenticate: () => {}, checkRole: () => () => {}, validate: () => () => {}, WriteoffBatchSchema,
    loadManualBatchReplay: async () => null, seedChartOfAccounts: vi.fn(),
    resolveBatchWarehouseLedgerMode: async () => 'OFF',
    resolveOperationalWarehouse: async () => ({id: 'w', name: 'Principal', isDefault: true}),
    contextualProductQuantityDecimal: (raw: any) => validateQuantity(raw, {saleMode: 'MEASURED', quantityStep: '0.25'}),
    assertPeriodOpen: vi.fn(), materializeWarehouseRow: vi.fn(),
    applyBatchWarehouseDelta: async () => ({status: 'OFF', replay: false}),
    applyStockDelta: async (_tx: any, input: any) => {state.stock += input.delta; state.local += input.delta; return {stockAfter: state.stock};},
    createJournalEntry: async (...args: any[]) => {state.journals.push(args[6]);},
    StockError: class extends Error {constructor(public code: string, message: string) {super(message);}},
    BatchWarehouseLedgerError: class extends Error {}, PeriodLockedError: class extends Error {},
    isUniqueConstraintFailure: () => false,
    productQuantityErrorResponse: () => false,
    manualBatchErrorResponse: (res: any, error: any) => {if (!error.code) return false; res.status(409).json({code: error.code}); return true;},
  };
  dependencies.db = db; dependencies.context = context;
  const invoke = async (quantity = '1.2500') => {
    const res = {statusCode: 200, body: null as any, status(code: number) {this.statusCode = code; return this;}, json(body: any) {this.body = body; return this;}};
    try {res.json((await executeBatchWriteoff({principal: {tenantId: 't', userId: 'u', role: 'OWNER'}, batchId: 'b', input: {clientEventId: '123e4567-e89b-42d3-a456-426614174000', warehouseId: 'w', quantity, reason: 'Lote vencido'}}, db)).result);} catch (error: any) {res.status(error.httpStatus ?? (error.code ? 409 : 500)).json({code: error.code});}
    return res;
  };
  return {state, tx, invoke};
}

describe('merma caracterizada antes de extracción', () => {
  it('retira fracciones exactas, contabiliza costo y deja evidencia en la misma operación', async () => {
    const f = await fixture(); const response = await f.invoke();
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({quantity: '1.2500', lossValue: '15.43', warehouseStock: '3.7500', batchStock: '5.7500', newStock: 8.75});
    expect(f.state.kardex).toHaveLength(1);
    expect(f.state.kardex[0]).toMatchObject({quantity: -1.25, stockBefore: 5, stockAfter: 3.75, warehouseId: 'w', batchId: 'b'});
    expect(f.state.journals[0]).toEqual([{accountCode: '5.1.2', debit: 15.43, credit: 0}, {accountCode: '1.1.4', debit: 0, credit: 15.43}]);
    expect(f.state.audits.map(row => row.action)).toEqual(['MANUAL_BATCH_COMMAND', 'BATCH_WRITEOFF']);
  });
  it('rechaza saldo insuficiente de la bodega sin disminuir el agregado', async () => {
    const f = await fixture({localStock: 1}); expect((await f.invoke()).statusCode).toBe(409);
    expect(f.state).toMatchObject({stock: 10, local: 1, batch: 7, audits: [], journals: [], kardex: []});
  });
  it('propaga fallo de auditoría final y revierte todos los efectos transaccionales', async () => {
    const f = await fixture({auditFails: true}); expect((await f.invoke()).statusCode).toBe(500);
    expect(f.state).toEqual({stock: 10, local: 5, batch: 7, audits: [], journals: [], kardex: []});
  });
});
