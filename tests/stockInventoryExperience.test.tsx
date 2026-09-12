// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import Inventory from '../components/Inventory';

// This child double tests the parent/receipt lifecycle contract, not purchase arithmetic.
// The real Purchases transport and financial behavior have their own integration suites.
const receipt = vi.hoisted(() => ({ post: vi.fn<(body: { productId: string; warehouseId: string; quantity: string }) => Promise<void>>(), mounts: 0, unmounts: 0 }));
vi.mock('../components/Purchases', async () => {
 const React = await import('react');
 return { default: function ReceiptBoundary({ entryContext, onBusyChange, onCompleted, onClose }: any) {
  const [quantity, setQuantity] = React.useState('1');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { receipt.mounts++; return () => { receipt.unmounts++; }; }, []);
  return <form aria-label={`Recepción de ${entryContext.product.name}`} onSubmit={async event => {
   event.preventDefault(); if (busy) return;
   setBusy(true); onBusyChange(true);
   await receipt.post({ productId: entryContext.product.id, warehouseId: entryContext.warehouseId, quantity });
   setBusy(false); onBusyChange(false); onCompleted();
  }}>
   <p>Producto elegido: {entryContext.product.name}</p><p>Destino elegido: {entryContext.warehouseId}</p>
   <label>Cantidad recibida<input autoFocus disabled={busy} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
   <button type="submit" disabled={busy}>Confirmar recepción</button><button type="button" disabled={busy} onClick={onClose}>Volver a ficha</button>
  </form>;
 } };
});
vi.mock('../components/ImageUploader', () => ({ default: () => null }));
const products = [{ id: 'cable', name: 'Cable eléctrico', sku: 'CAB-01', stock: 10, price: 30, cost: 15, minStock: 2, unit: 'metro', saleMode: 'MEASURED', quantityStep: '0.01' },
 { id: 'brocha', name: 'Brocha', sku: 'BRO-01', stock: 5, price: 20, cost: 10, minStock: 1, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' }];
const warehouses = [{ id: 'store', name: 'Tienda', isActive: true, isDefault: true, stock: '4.0000', implicit: false }, { id: 'reserve', name: 'Reserva', isActive: true, isDefault: false, stock: '6.0000', implicit: false }];
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
let fetcher: ReturnType<typeof vi.fn>;
let compact: boolean;
let mediaListeners: Set<(event: { matches: boolean }) => void>;
function resize(value: boolean) { compact = value; act(() => { mediaListeners.forEach(listener => listener({ matches: value })); }); }
function login(name = 'one') {
 localStorage.setItem('nortex_token', `header.${btoa(JSON.stringify({ tenantId: name, userId: `user-${name}`, role: 'OWNER' }))}.signature`);
 localStorage.setItem('nortex_user', JSON.stringify({ id: `user-${name}`, role: 'OWNER' }));
}
function mount() { return render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory /></MemoryRouter>); }
async function openReceipt() {
 fireEvent.click(await screen.findByRole('button', { name: 'Ver Cable eléctrico' }));
 fireEvent.click(await screen.findByRole('button', { name: /Reserva/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Recibir mercadería' }));
 return screen.findByRole('textbox', { name: 'Cantidad recibida' });
}
beforeEach(() => {
 localStorage.clear(); sessionStorage.clear(); login(); receipt.mounts = 0; receipt.unmounts = 0; receipt.post.mockReset().mockResolvedValue(undefined);
 compact = false; mediaListeners = new Set();
 vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ media: query, get matches() { return query.includes('1100px') ? compact : true; },
  addEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => { if (query.includes('1100px')) mediaListeners.add(listener); },
  removeEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => mediaListeners.delete(listener), addListener() {}, removeListener() {}, dispatchEvent() { return true; }, onchange: null })));
 fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = new URL(String(input), 'http://localhost');
  const secondAccount = String((init?.headers as Record<string, string>)?.Authorization || '').includes(btoa(JSON.stringify({ tenantId: 'two', userId: 'user-two', role: 'OWNER' })));
  if (url.pathname === '/api/products') return ok({ products: secondAccount ? [] : products, total: secondAccount ? 0 : products.length });
  if (/^\/api\/warehouses\/product\/[^/]+\/stock$/.test(url.pathname)) return ok({ success: true, data: { productId: url.pathname.split('/')[4], totalStock: '10.0000', unit: 'metro', warehouses, hasMore: false } });
  if (url.pathname === '/api/products/categories' || url.pathname === '/api/suppliers') return ok([]);
  if (url.pathname === '/api/reports/inventory') return ok({ totalProducts: 2, inventoryValue: 200, totalUnits: 15, outOfStock: 0, lowStock: [] });
  if (url.pathname === '/api/warehouses') return ok({ data: warehouses });
  return ok({});
 });
 vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Inventario conserva la recepción al trabajar como en el POS', () => {
 it('abre con producto y bodega elegidos, sin escritura automática', async () => {
  mount(); const input = await openReceipt();
  expect(screen.getByText('Producto elegido: Cable eléctrico')).toBeInTheDocument();
  expect(screen.getByText('Destino elegido: reserve')).toBeInTheDocument();
  expect(input).toHaveFocus(); expect(receipt.post).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
 });
 it('bloquea catálogo y lector desde que se abre, antes del primer POST', async () => {
  mount(); const input = await openReceipt(); fireEvent.change(input, { target: { value: '0,25' } });
  expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ver Brocha' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Brocha' }));
  await act(async () => { for (const key of 'BRO-01') fireEvent.keyDown(document.body, { key }); fireEvent.keyDown(document.body, { key: 'Enter' }); });
  expect(input).toHaveValue('0,25'); expect(input).toHaveFocus();
  expect(fetcher.mock.calls.some(([url]) => new URL(String(url), 'http://localhost').searchParams.get('search') === 'BRO-01')).toBe(false);
  expect(screen.getByText('Producto elegido: Cable eléctrico')).toBeInTheDocument(); expect(receipt.post).not.toHaveBeenCalled();
 });
 it.each([false, true])('conserva la misma recepción al cambiar tamaño antes y durante envío (compacto=%s)', async initialCompact => {
  compact = initialCompact; let finish!: () => void;
  receipt.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  mount(); const input = await openReceipt(); fireEvent.change(input, { target: { value: '0,25' } });
  resize(!initialCompact);
  expect(screen.getByRole('textbox', { name: 'Cantidad recibida' })).toBe(input);
  expect(input).toHaveValue('0,25'); expect(receipt.mounts).toBe(1); expect(receipt.unmounts).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
  await waitFor(() => expect(receipt.post).toHaveBeenCalledOnce());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('form', { name: 'Recepción de Cable eléctrico' })).toBeInTheDocument();
  resize(initialCompact); resize(!initialCompact);
  expect(screen.getByRole('textbox', { name: 'Cantidad recibida' })).toBe(input);
  expect(input).toHaveValue('0,25'); expect(input).toBeDisabled();
  expect(receipt.post).toHaveBeenCalledWith({ productId: 'cable', warehouseId: 'reserve', quantity: '0,25' });
  expect(receipt.mounts).toBe(1); expect(receipt.unmounts).toBe(0);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Recepción de Cable eléctrico' })).not.toBeInTheDocument());
  expect(receipt.post).toHaveBeenCalledOnce();
 });
 it('volver desde el formulario libera el catálogo y conserva la ficha', async () => {
  mount(); await openReceipt(); fireEvent.click(screen.getByRole('button', { name: 'Volver a ficha' }));
  expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Ficha de Cable eléctrico' })).toBeInTheDocument();
  expect(receipt.post).not.toHaveBeenCalled();
 });
 it('cerrar la hoja con Escape antes de enviar libera el catálogo', async () => {
  compact = true; mount(); await openReceipt(); fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Recepción de Cable eléctrico' })).not.toBeInTheDocument());
  expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeEnabled();
  expect(receipt.post).not.toHaveBeenCalled();
 });
 it('recuperar foco con la misma sesión no borra la recepción', async () => {
  mount(); const input = await openReceipt(); fireEvent.change(input, { target: { value: '4' } });
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('textbox', { name: 'Cantidad recibida' })).toBe(input); expect(input).toHaveValue('4'); expect(receipt.mounts).toBe(1);
 });
 it.each([false, true])('cambiar token limpia la ficha y no revive la recepción anterior (enviando=%s)', async sending => {
  let finish!: () => void; receipt.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  mount(); const input = await openReceipt(); fireEvent.change(input, { target: { value: '7' } });
  if (sending) { fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' })); await waitFor(() => expect(receipt.post).toHaveBeenCalledOnce()); }
  login('two'); fireEvent(window, new StorageEvent('storage', { key: 'nortex_token' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Recepción de Cable eléctrico' })).not.toBeInTheDocument());
  expect(screen.queryByRole('region', { name: 'Ficha de Cable eléctrico' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver Cable eléctrico' })).not.toBeInTheDocument());
  if (sending) { await act(async () => finish()); expect(screen.queryByText('Mercadería recibida')).not.toBeInTheDocument(); }
  expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeEnabled();
  expect(receipt.post).toHaveBeenCalledTimes(sending ? 1 : 0);
 });
});
