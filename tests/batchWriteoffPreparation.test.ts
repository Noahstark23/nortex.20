import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareBatchWriteoff } from '../backend/services/batchWriteoffPreparation';
vi.mock('../backend/lib/prisma', () => ({default: {}}));
const principal = {tenantId: 't', userId: 'u', role: 'OWNER'};
const draft = {batchId: 'b', warehouseId: 'w', quantity: '1.25', reason: 'Retiro por vencimiento'};
function fixture() {
  const actor = {id: 'u', status: 'ACTIVE', role: 'OWNER'};
  const product = {id: 'p', tenantId: 't', name: 'Pintura', unit: 'litro', cost: 12.34, stock: 10, saleMode: 'MEASURED', quantityStep: '0.25'};
  const batch = {id: 'b', tenantId: 't', productId: 'p', batchNumber: 'L1', expiryDate: new Date('2025-01-01T00:00:00Z'), stock: 7, product};
  const local = {stock: 5}; const batchLocal = {stock: '4.0000'};
  const warehouse = {id: 'w', name: 'Principal', isDefault: true};
  const db: any = {
    user: {findFirst: vi.fn(async () => actor)},
    tenant: {findFirst: vi.fn(async () => ({batchWarehouseLedgerMode: 'ENFORCED'}))},
    productBatch: {findFirst: vi.fn(async ({where}: any) => where.tenantId === 't' && where.id === 'b' ? batch : null)},
    warehouse: {findFirst: vi.fn(async () => warehouse)},
    productStock: {findFirst: vi.fn(async () => local), aggregate: vi.fn(async () => ({_sum: {stock: 3}}))},
    productBatchWarehouseStock: {findFirst: vi.fn(async () => batchLocal)},
    fiscalPeriod: {findUnique: vi.fn(async () => null)},
  };
  return {db, product, batch, batchLocal, local, actor, warehouse};
}
beforeEach(() => {vi.clearAllMocks();});
describe('revisión de merma: autoridad y efectos sin escrituras', () => {
  it('calcula el importe esperado y conserva unidad, lote, bodega y saldos de origen', async () => {
    const f = fixture(); const preview = await prepareBatchWriteoff(principal, draft, f.db);
    expect(preview).toMatchObject({lossValue: '15.43', draft: {quantity: '1.2500'}, product: {unit: 'litro', cost: '12.34'}, batch: {stock: '7.0000'}, warehouse: {stock: '5.0000'}, batchWarehouseStock: '4.0000'});
    expect(preview.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.db.productBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({where: {id: 'b', tenantId: 't'}}));
    // Este doble de sólo lectura ni siquiera ofrece create/update/transaction.
    expect(f.local.stock).toBe(5); expect(f.product.stock).toBe(10); expect(f.batch.stock).toBe(7);
  });
  it.each(['cost', 'stock', 'batchExpiry', 'warehouseName', 'quantityStep'])('cambiar %s invalida la huella', async field => {
    const f = fixture(); const original = await prepareBatchWriteoff(principal, draft, f.db);
    if (field === 'cost') f.product.cost = 15; if (field === 'stock') f.local.stock = 4;
    if (field === 'batchExpiry') f.batch.expiryDate = new Date('2025-02-01');
    if (field === 'warehouseName') f.warehouse.name = 'Otra ubicación';
    if (field === 'quantityStep') f.product.quantityStep = '0.05';
    expect((await prepareBatchWriteoff(principal, draft, f.db)).hash).not.toBe(original.hash);
  });
  it('rechaza bodega sin saldo exacto del lote y cantidad incompatible con el paso', async () => {
    const f = fixture(); f.batchLocal.stock = '0.5';
    await expect(prepareBatchWriteoff(principal, draft, f.db)).rejects.toMatchObject({code: 'BATCH_WAREHOUSE_REVIEW_REQUIRED'});
    await expect(prepareBatchWriteoff(principal, {...draft, quantity: '1.1'}, f.db)).rejects.toThrow();
  });
  it('no interpreta costo corrupto, actor deshabilitado o lote ajeno como cero disponible', async () => {
    const f = fixture(); f.product.cost = -1;
    await expect(prepareBatchWriteoff(principal, draft, f.db)).rejects.toMatchObject({code: 'BATCH_COST_INVALID'});
    f.actor.status = 'DISABLED';
    await expect(prepareBatchWriteoff(principal, draft, f.db)).rejects.toMatchObject({code: 'BATCH_WRITEOFF_FORBIDDEN'});
    f.actor.status = 'ACTIVE';
    await expect(prepareBatchWriteoff(principal, {...draft, batchId: 'foreign'}, f.db)).rejects.toMatchObject({code: 'BATCH_NOT_FOUND'});
  });
  it('período cerrado se mantiene bloqueante', async () => {
    const f = fixture(); f.db.fiscalPeriod.findUnique.mockResolvedValue({status: 'CLOSED'});
    await expect(prepareBatchWriteoff(principal, draft, f.db)).rejects.toMatchObject({name: 'PeriodLockedError'});
  });
});
