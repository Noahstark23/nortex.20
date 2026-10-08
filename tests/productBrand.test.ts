import { describe, expect, it } from 'vitest';
import { CreateProductSchema, UpdateProductSchema } from '../backend/validation/schemas';
import { buscarProductos, indexarProductos } from '../utils/posSearch';

describe('marca de producto', () => {
  it('conserva la marca normalizada y permite limpiar sin obligar a catálogos anteriores', () => {
    expect(CreateProductSchema.parse({ name: 'Martillo', sku: 'M1', price: '100', brand: '  Truper  ' }).brand).toBe('Truper');
    expect(UpdateProductSchema.parse({ brand: null }).brand).toBeNull();
    expect(UpdateProductSchema.safeParse({ brand: 'x'.repeat(101) }).success).toBe(false);
    expect(CreateProductSchema.safeParse({ name: 'Martillo', sku: 'M1', price: '100' }).success).toBe(true);
  });
  it('busca por marca y renueva el índice al cambiar únicamente la marca', () => {
    const product = { id: '1', sku: 'M1', name: 'Martillo', brand: 'Truper' };
    const index = indexarProductos([product]);
    expect(buscarProductos(index, 'truper', 10).visibles).toEqual([product]);
    const updated = indexarProductos([{ ...product, brand: 'Stanley' }], index);
    expect(buscarProductos(updated, 'truper', 10).total).toBe(0);
    expect(buscarProductos(updated, 'stanley', 10).total).toBe(1);
  });
});
