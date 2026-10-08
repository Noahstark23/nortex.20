import { describe, expect, it, vi } from 'vitest';
import { executeProductBulkEdit } from '../backend/services/productBulkEditService';

const principal = {tenantId: 'tenant-own', userId: 'user-own', role: 'OWNER'};
function fixture(price = 100, user: unknown = {id: principal.userId, role: 'OWNER', status: 'ACTIVE'}) {
  const product = {id: 'product-own', name: 'Producto', price, category: 'Inicial', promotionPriceVersion: 1};
  const queries: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (query: any) => {
      const sql = Array.isArray(query) ? query.join('?') : query.sql;
      queries.push(sql);
      if (sql.includes('FROM `User`')) return user ? [user] : [];
      if (sql.includes('SELECT id, price')) return [{id: product.id, price: product.price}];
      return [{...product}];
    }),
    product: {update: vi.fn(async ({data}: any) => {
      const {promotionPriceVersion, ...patch} = data;
      Object.assign(product, patch);
      if (promotionPriceVersion) product.promotionPriceVersion += promotionPriceVersion.increment;
      return product;
    })},
    auditLog: {create: vi.fn(async (input: any) => input.data)},
  };
  const db = {$transaction: vi.fn(async (callback: any) => callback(tx))};
  const run = (input: unknown, actor = principal) => executeProductBulkEdit({principal: actor, input}, db as any);
  return {product, tx, db, queries, run};
}

describe('edición masiva: contrato de servicio y cálculo independiente', () => {
  it.each([
    ['set', 100, 2.345, 2.35], ['set', 100, 2.3449, 2.34], ['set', 100, 0, 0],
    ['set', 100, 10.005, 10.01], ['pct', 100, 10, 110], ['pct', 10.05, 10, 11.06],
    ['pct', 100, -99.99, 0.01], ['pct', 1, -50, 0.5], ['pct', 9.99, 0, 9.99],
    ['pct', -1, 10, 0],
  ])('%s desde %s con valor %s da %s', async (priceMode, before, priceValue, after) => {
    const f = fixture(before as number);
    expect(await f.run({ids: ['product-own'], priceMode, priceValue})).toEqual({count: 1});
    expect(f.product.price).toBe(after);
    expect(f.product.promotionPriceVersion).toBe(before === after ? 1 : 2);
    const audit = f.tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({tenantId: principal.tenantId, userId: principal.userId, action: 'PRODUCT_BULK_EDIT'});
    expect(JSON.parse(audit.details)).toMatchObject({count: 1, requestedIds: 1, category: null, priceMode, priceValue,
      priceChanges: [{id: 'product-own', priceBefore: Number(before).toFixed(2), priceAfter: Number(after).toFixed(2)}]});
  });

  it('categoría sola no cambia el precio o versión y audita dentro de la transacción', async () => {
    const f = fixture();
    expect(await f.run({ids: ['product-own'], category: '  Herramientas  '})).toEqual({count: 1});
    expect(f.product).toMatchObject({category: 'Herramientas', price: 100, promotionPriceVersion: 1});
    expect(JSON.parse(f.tx.auditLog.create.mock.calls[0][0].data.details)).toMatchObject({category: 'Herramientas', priceChanges: [], priceMode: null, priceValue: null});
    expect(f.queries).toHaveLength(2);
    expect(f.queries[0]).toContain('FROM `User`');
    expect(f.queries[1]).toContain('ORDER BY id FOR UPDATE');
    expect(f.tx.product.update).toHaveBeenCalledWith({where: {id: 'product-own', tenantId: principal.tenantId}, data: {category: 'Herramientas'}});
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {isolationLevel: 'ReadCommitted', timeout: 15000});
  });

  it('el servicio vuelve a validar la entrada e ignora campos de autoridad enviados por cliente', async () => {
    const f = fixture();
    await f.run({ids: ['product-own', 'product-own'], category: 'Nueva', priceMode: 'set', priceValue: 75, tenantId: 'foreign', promotionPriceVersion: 99, stock: 200, cost: 1});
    expect(f.product).toEqual({id: 'product-own', name: 'Producto', price: 75, category: 'Nueva', promotionPriceVersion: 2});
    expect(JSON.parse(f.tx.auditLog.create.mock.calls[0][0].data.details)).toMatchObject({requestedIds: 2, count: 1});
  });

  it.each([
    {ids: []}, {ids: ['product-own']}, {ids: ['product-own'], priceMode: 'set'},
    {ids: ['product-own'], priceMode: 'set', priceValue: -1},
    {ids: ['product-own'], priceMode: 'pct', priceValue: -100},
    {ids: ['product-own'], priceMode: 'set', priceValue: Number.POSITIVE_INFINITY},
  ])('rechaza entrada inválida antes de cualquier lectura o escritura: %o', async input => {
    const f = fixture(); await expect(f.run(input)).rejects.toMatchObject({name: 'ZodError'});
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['BODEGUERO', 'MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT'])('rechaza rol %s antes de tocar productos', async role => {
    const f = fixture();
    await expect(f.run({ids: ['product-own'], category: 'No autorizada'}, {...principal, role})).rejects.toMatchObject({httpStatus: 403, code: 'PRODUCT_BULK_FORBIDDEN'});
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each([null, {id: principal.userId, role: 'OWNER', status: 'DISABLED'}, {id: principal.userId, role: 'MANAGER', status: 'ACTIVE'}])('revalida sesión bajo bloqueo: %o', async user => {
    const f = fixture(100, user);
    await expect(f.run({ids: ['product-own'], category: 'No autorizada'})).rejects.toMatchObject({httpStatus: 403, code: 'PRODUCT_BULK_SESSION_REVOKED'});
    expect(f.tx.product.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.queries[0]).toContain('FOR UPDATE');
  });

  it('propaga fallo de auditoría a la transacción para impedir su confirmación', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValueOnce(new Error('AUDIT_UNAVAILABLE'));
    await expect(f.run({ids: ['product-own'], priceMode: 'set', priceValue: 75})).rejects.toThrow('AUDIT_UNAVAILABLE');
  });
});
