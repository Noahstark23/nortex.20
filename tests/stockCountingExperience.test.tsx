// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockCount from '../components/StockCount';
const response = (data: unknown) => new Response(JSON.stringify(data));
const openCount = { id: 'open1', warehouseId: 'w2', warehouse: { id: 'w2', name: 'Reserva' }, status: 'OPEN', scope: 'ALL', createdAt: '2026-09-12T10:00:00Z', _count: { items: 2 } };
const oldCount = { ...openCount, id: 'closed1', status: 'CLOSED', createdAt: '2026-09-01T10:00:00Z', creator: { name: 'Ana' } };
const locations = [{ id: 'w1', name: 'Tienda', isActive: true, isDefault: true }, { id: 'w2', name: 'Reserva', isActive: true, isDefault: false }];
const items = [{ id: 'i1', productId: 'p1', expected: 3, counted: null, product: { name: 'Cable', sku: 'CA-1', unit: 'metro' } }, { id: 'i2', productId: 'p2', expected: 5, counted: null, product: { name: 'Brocha', sku: 'BR-1', unit: 'unidad' } }];
const setup = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
 const url = String(input);
 if (url === '/api/warehouses') return response({ data: locations });
 if (url === '/api/products/categories') return response(['Herramientas']);
 if (url === '/api/stock-counts') return response([oldCount, openCount]);
 if (url === '/api/stock-counts/open1') return response({ count: openCount, items });
 if (url.endsWith('/count')) return response({ counted: JSON.parse(String(init?.body)).counted });
 return response({});
});
const mount = (query = '') => render(<MemoryRouter initialEntries={[`/app/inventory-count${query}`]}><StockCount /></MemoryRouter>);
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('conteo sin recorrer el historial', () => {
 it('ofrece continuar el abierto antes del historial y no abre ni escribe automáticamente', async () => {
  const fetch = setup(); mount('?warehouseId=w2&productId=p1&search=cable');
  expect(await screen.findByRole('button', { name: /Continuar.*Reserva/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Ver detalle/ })).toBeNull();
  expect(screen.getByText(/Historial de conteos/)).toBeTruthy();
  expect(fetch.mock.calls.every(([url, init]) => String(url) !== '/api/stock-counts/open1' && (!init?.method || init.method === 'GET'))).toBe(true);
  fireEvent.click(screen.getByText(/Historial de conteos/));
  expect(await screen.findByRole('button', { name: /Ver detalle/ })).toBeTruthy();
  expect(screen.getByText(/Ana/)).toBeTruthy();
 });
 it('continúa con el producto del enlace sin ocultar el alcance completo del conteo', async () => {
  setup(); mount('?warehouseId=w2&productId=p1&search=cable');
  fireEvent.click(await screen.findByRole('button', { name: /Continuar.*Reserva/ }));
  await screen.findAllByLabelText('Conteo físico de Cable');
  expect(screen.queryByLabelText('Conteo físico de Brocha')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ver todos los productos de este conteo' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ver todos los productos de este conteo' }));
  expect(screen.getAllByLabelText('Conteo físico de Brocha').length).toBeGreaterThan(0);
 });
 it('preselecciona solo una bodega activa verificada y deja notas como opcionales', async () => {
  setup(); mount('?warehouseId=w1');
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo conteo' }));
  await waitFor(() => expect((screen.getByLabelText(/Bodega a contar/) as HTMLSelectElement).value).toBe('w1'));
  expect(screen.queryByRole('textbox', { name: 'Notas (opcional)' })).toBeNull();
  expect(screen.getByText('Agregar nota')).toBeTruthy();
 });
 it('un enlace nuevo no hereda la bodega del enlace anterior', async () => {
  setup(); render(<MemoryRouter initialEntries={['/app/inventory-count?warehouseId=w1']}><Link to="/app/inventory-count?warehouseId=externa">Otro enlace</Link><StockCount /></MemoryRouter>);
  await screen.findByRole('button', { name: /Continuar.*Reserva/ });
  fireEvent.click(screen.getByRole('link', { name: 'Otro enlace' }));
  await screen.findByText(/La bodega del enlace no está disponible/);
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo conteo' }));
  expect((screen.getByLabelText(/Bodega a contar/) as HTMLSelectElement).value).toBe('');
 });
 it('una bodega desconocida no se convierte en otro destino', async () => {
  setup(); mount('?warehouseId=externa');
  expect(await screen.findByText(/La bodega del enlace no está disponible/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo conteo' }));
  expect((screen.getByLabelText(/Bodega a contar/) as HTMLSelectElement).value).toBe('');
 });
});
