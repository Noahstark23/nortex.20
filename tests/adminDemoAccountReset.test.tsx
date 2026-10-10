// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminDemoReset from '../components/admin/AdminDemoReset';
vi.mock('../components/ProductImporter', () => ({ default: ({ assisted }: any) => <div data-testid="assisted-import">{assisted.productsUrl} {assisted.businessName}</div> }));
const tenant = { id: 'carnes-qa', businessName: 'Carnes QA', owner: { id: 'owner-qa', email: 'owner@example.invalid' } };
let uncertain = false, applied = false, reject = false, key = '';
const fetcher = vi.fn(async (url: string, options: any = {}) => {
  const input = options.body ? JSON.parse(options.body) : null;
  if (url.endsWith('/preview')) {
    if (reject) return { ok: false, json: async () => ({ error: 'Esta cuenta tiene un pago pendiente.' }) };
    key = input.requestKey;
    return { ok: true, json: async () => ({ requestKey: key, previewId: 'preview-qa', ownerEmail: tenant.owner.email,
      businessName: tenant.businessName, counts: { products: 176, sales: 10, purchases: 0 } }) };
  }
  if (url.endsWith('/confirm')) { if (uncertain) throw Error('Se interrumpió la conexión'); applied = true; return { ok: true, json: async () => ({ status: 'APPLIED' }) }; }
  if (url.includes('/receipts/')) return { ok: true, json: async () => ({ requestKey: key, status: applied ? 'APPLIED' : 'PREVIEWED', loginRequired: false, imported: 0, warehouses: [{ id: 'wh-qa', name: 'Principal', isActive: true }] }) };
  throw Error('Ruta inesperada');
});
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('nortex_token', 'synthetic-admin-session');
  localStorage.setItem('nortex_user', JSON.stringify({ id: 'admin', role: 'SUPER_ADMIN', tenant: { id: 'platform' } }));
  uncertain = false; applied = false; reject = false; key = ''; fetcher.mockClear(); vi.stubGlobal('fetch', fetcher);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function review() {
  render(<AdminDemoReset tenants={[tenant]} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reiniciar cuenta de prueba' }));
  fireEvent.change(screen.getByLabelText('Empresa para reiniciar'), { target: { value: tenant.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Revisar datos de prueba' }));
  await screen.findByRole('button', { name: 'Confirmar reinicio' });
}
function fill() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Escribí REINICIAR'), { target: { value: 'REINICIAR' } });
  fireEvent.change(screen.getByLabelText('Tu contraseña de administrador'), { target: { value: 'Synthetic only' } });
}
const confirms = () => fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'));
describe('reinicio de administrador', () => {
  it('revisa el dueño y exige frase, contraseña y declaración sin cobro', async () => {
    await review(); expect(screen.getByText(tenant.owner.email)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar reinicio' }).getAttribute('disabled')).not.toBeNull();
    fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar reinicio' }));
    await screen.findByRole('button', { name: 'Cargar productos en Carnes QA' });
    const data = JSON.parse(confirms()[0][1].body);
    expect(data).toMatchObject({ ownerId: tenant.owner.id, confirmedUnpaid: true, confirmedTestData: true, confirmation: 'REINICIAR' });
    expect(localStorage.getItem('nortex_token')).toBe('synthetic-admin-session');
  });
  it('cancelar no confirma ni cambia la sesión', async () => {
    await review(); fireEvent.click(screen.getByRole('button', { name: 'Cancelar revisión' }));
    expect(confirms()).toHaveLength(0); expect(localStorage.getItem('nortex_admin_demo_reset:platform:admin')).toBeNull();
  });
  it('una respuesta incierta conserva la clave y recupera el resultado antes de cargar', async () => {
    uncertain = true; await review(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar reinicio' }));
    await screen.findByRole('alert'); const first = key;
    cleanup(); applied = true;
    render(<AdminDemoReset tenants={[]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar reinicio asistido' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar intento' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar productos en Carnes QA' }));
    expect((await screen.findByTestId('assisted-import')).textContent).toContain('/api/admin/demo-reset/carnes-qa/receipts/' + first + '/products');
    expect(confirms()).toHaveLength(1);
  });
  it('no revisa cuando no puede persistir el intento', async () => {
    render(<AdminDemoReset tenants={[tenant]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar cuenta de prueba' }));
    fireEvent.change(screen.getByLabelText('Empresa para reiniciar'), { target: { value: tenant.id } });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('Almacenamiento lleno'); });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos de prueba' }));
    await screen.findByRole('alert'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('muestra el bloqueo por pago sin habilitar la confirmación', async () => {
    reject = true; render(<AdminDemoReset tenants={[tenant]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar cuenta de prueba' }));
    fireEvent.change(screen.getByLabelText('Empresa para reiniciar'), { target: { value: tenant.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos de prueba' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pago pendiente'));
    expect(screen.queryByRole('button', { name: 'Confirmar reinicio' })).toBeNull();
  });
});
