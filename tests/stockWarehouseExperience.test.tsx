// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Warehouses from '../components/Warehouses';
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const locations = [{ id: 'w1', name: 'Tienda', isActive: true, isDefault: true }, { id: 'w2', name: 'Reserva', isActive: true, isDefault: false }];
const products = [{ productId: 'p1', name: 'Cable', sku: 'CABLE-1', unit: 'metro', stock: 18.75, saleMode: 'MEASURED', quantityStep: '0.01' }, { productId: 'p2', name: 'Brocha', sku: 'BROCHA-1', unit: 'unidad', stock: 7 }];
const mount = (query = '') => render(<MemoryRouter initialEntries={[`/app/warehouses${query}`]}><Warehouses /></MemoryRouter>);
const setup = (post?: (body: any) => Promise<Response>) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
 const url = String(input);
 if (url === '/api/warehouses') return response({ data: locations });
 if (url.endsWith('/stock')) return response({ data: { items: products } });
 if (url === '/api/team') return response([]);
 if (url === '/api/stock-transfers' && init?.method === 'POST') return post!(JSON.parse(String(init.body)));
 return response({ data: [] });
});
beforeEach(() => { localStorage.clear(); localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('trabajar desde el producto y su bodega', () => {
 it('lleva la ubicación y producto al frente sin mostrar administración ni escribir', async () => {
  const fetch = setup(); mount('?warehouseId=w2&productId=p1&search=cable');
  await screen.findByRole('combobox', { name: 'Ubicación de existencias' });
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Ubicación de existencias' }) as HTMLSelectElement).value).toBe('w2'));
  await screen.findAllByText('Cable'); expect(screen.queryByText('Brocha')).toBeNull();
  expect(screen.queryByLabelText('Nombre de la nueva bodega')).toBeNull();
  expect(screen.getByRole('link', { name: 'Productos' }).getAttribute('href')).toContain('productId=p1');
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
 });
 it('permite administrar bajo demanda y no ofrece ese acceso al bodeguero', async () => {
  setup(); mount(); fireEvent.click(screen.getByRole('button', { name: 'Administrar bodegas' }));
  expect(await screen.findByRole('dialog', { name: 'Administrar bodegas' })).toBeTruthy();
  expect(screen.getByLabelText('Nombre de la nueva bodega')).toBeTruthy(); cleanup();
  localStorage.setItem('nortex_user', JSON.stringify({ role: 'BODEGUERO' })); mount();
  expect(screen.queryByRole('button', { name: 'Administrar bodegas' })).toBeNull();
 });
 it('rechaza contexto de ubicación desconocida y jamás convierte returnTo en enlace', async () => {
  setup(); mount('?warehouseId=otra-cuenta&productId=p1&returnTo=https://ejemplo.invalid');
  expect(await screen.findByText(/La bodega del enlace no está disponible/)).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Ubicación de existencias' }) as HTMLSelectElement).value).toBe('');
  expect(screen.getByRole('link', { name: 'Productos' }).getAttribute('href')).not.toContain('ejemplo');
 });
 it('un nuevo enlace de ubicación sustituye el contexto anterior sin escribir', async () => {
  const fetch = setup(); render(<MemoryRouter initialEntries={['/app/warehouses?warehouseId=w1&productId=p1']}><Link to="/app/warehouses?warehouseId=w2&productId=p2">Otra ubicación</Link><Warehouses /></MemoryRouter>);
  await screen.findAllByText('Cable'); fireEvent.click(screen.getByRole('link', { name: 'Otra ubicación' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Ubicación de existencias' }) as HTMLSelectElement).value).toBe('w2'));
  await screen.findAllByText('Brocha'); expect(screen.queryByText('Cable')).toBeNull();
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
 });
 it('abre el traslado solicitado una sola vez, con origen y producto verificados, sin POST', async () => {
  const fetch = setup(); mount('?warehouseId=w2&productId=p1&search=CABLE-1&transfer=1');
  const dialog = await screen.findByRole('dialog', { name: 'Transferir producto' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(dialog).getByText('Cable')).toBeTruthy();
  expect(within(dialog).getByText(/Disponible en Reserva/)).toBeTruthy();
  expect((within(dialog).getByLabelText('Bodega destino') as HTMLSelectElement).value).toBe('w1');
  expect((within(dialog).getByLabelText('Cantidad') as HTMLInputElement).value).toBe('');
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar transferencia' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar existencias de Reserva' }));
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/warehouses/w2/stock')).toHaveLength(2));
  await act(async () => {}); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Brocha')).toBeNull();
  expect(screen.getByRole('link', { name: 'Productos' }).getAttribute('href')).toBe('/app/inventory?productId=p1&search=CABLE-1');
 });
 it.each([
  '?warehouseId=externa&productId=p1&transfer=1',
  '?warehouseId=w1&productId=externo&transfer=1',
  '?productId=p1&transfer=1',
  '?warehouseId=w1&transfer=1',
  '?warehouseId=w1&productId=p1&transfer=true',
 ])('no abre traslado con un contexto incompleto o no válido: %s', async query => {
  const fetch = setup(); mount(query);
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Ubicación de existencias' }) as HTMLSelectElement).disabled).toBe(false));
  await act(async () => {}); expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
 });
 it('conserva producto, origen y búsqueda después de trasladar una fracción', async () => {
  let finish!: (value: Response) => void; const post = vi.fn((_body: any) => new Promise<Response>(resolve => { finish = resolve; }));
  setup(post); mount('?warehouseId=w1&productId=p1');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Transferir Cable a otra bodega' }))[0]);
  const dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByLabelText('Cantidad'), { target: { value: '0,25' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Transferir|Trasladar/ }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy();
  expect(post.mock.calls[0][0]).toMatchObject({ fromWarehouseId: 'w1', toWarehouseId: 'w2', items: [{ productId: 'p1', quantity: '0.2500' }] });
  await act(async () => finish(response({ id: 't1' }))); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((screen.getByRole('combobox', { name: 'Ubicación de existencias' }) as HTMLSelectElement).value).toBe('w1');
  expect(screen.queryByText('Brocha')).toBeNull();
 });
});
