// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Billing from '../components/Billing';
import DemoAccountReset from '../components/billing/DemoAccountReset';
vi.mock('../components/ImageUploader', () => ({ default: () => null }));

const counts = { sales: 9, products: 176, purchases: 0, customers: 0, suppliers: 0, employees: 2, users: 2, expenses: 0, journals: 0, warehouses: 1 };
let eligible: boolean, uncertain: boolean, receiptApplied: boolean, receiptExpired: boolean, requestKey: string;
const fetcher = vi.fn(async (url: any, options: any = {}) => {
  const path = String(url), input = options.body ? JSON.parse(options.body) : null;
  let body: any;
  if (path.endsWith('/billing/status')) body = { status: 'TRIAL', businessName: 'Demo QA', stripeConfigured: false };
  else if (path.endsWith('/manual-status')) body = [];
  else if (path.endsWith('/demo-reset')) body = { eligible };
  else if (path.endsWith('/preview')) {
    requestKey = input.requestKey;
    body = { previewId: 'f3b4b8b8-47f9-4363-b894-6c3f6a491887', requestKey, counts, businessName: 'Demo QA', expiresAt: new Date(Date.now() + 300000).toISOString() };
  } else if (path.includes('/receipts/')) body = { status: receiptApplied ? 'APPLIED' : receiptExpired ? 'EXPIRED' : 'PREVIEWED', requestKey, loginRequired: receiptApplied };
  else if (path.endsWith('/confirm')) {
    if (uncertain) throw new Error('Conexión interrumpida');
    body = { status: 'APPLIED', requestKey: input.requestKey, loginRequired: true };
  } else throw new Error('Unexpected request ' + path);
  return { ok: true, status: 200, json: async () => body } as Response;
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nortex_token', 'session-demo');
  localStorage.setItem('nortex_user', JSON.stringify({ id: 'owner', role: 'ADMIN', tenant: { id: 'demo', businessName: 'Demo QA' } }));
  eligible = true; uncertain = false; receiptApplied = false; receiptExpired = false; requestKey = '';
  fetcher.mockClear(); vi.stubGlobal('fetch', fetcher);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  const button = await screen.findByRole('button', { name: 'Reiniciar cuenta demo' });
  fireEvent.click(button);
  await screen.findByRole('dialog');
}
function fill() {
  fireEvent.click(screen.getByLabelText('Confirmo que son datos de prueba que quiero retirar.'));
  fireEvent.change(screen.getByLabelText('Escribí REINICIAR'), { target: { value: 'REINICIAR' } });
  fireEvent.change(screen.getByLabelText('Tu contraseña'), { target: { value: 'Contraseña sintética' } });
}
const confirmCalls = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/confirm'));
describe('reinicio demo visible y recuperable', () => {
  it('la cuenta de prueba muestra el botón dentro de Mi Plan', async () => {
    render(<Billing />);
    expect(await screen.findByRole('button', { name: 'Reiniciar cuenta demo' })).toBeTruthy();
  });
  it('oculta el botón si el servidor niega la elegibilidad', async () => {
    eligible = false; render(<DemoAccountReset />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Reiniciar cuenta demo' })).toBeNull();
  });
  it('muestra las cifras y exige todas las confirmaciones', async () => {
    render(<DemoAccountReset />); await open();
    expect(screen.getByText('9 ventas')).toBeTruthy(); expect(screen.getByText('176 productos')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Confirmar reinicio' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button); expect(confirmCalls()).toHaveLength(0);
    fill(); expect(button.disabled).toBe(false);
  });
  it('cancelar la revisión conserva el acceso y no envía un reinicio', async () => {
    render(<DemoAccountReset />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirmCalls()).toHaveLength(0);
    expect(localStorage.getItem('nortex_token')).toBe('session-demo');
    expect(localStorage.getItem('nortex_demo_reset:demo:owner')).toBeNull();
  });
  it('un doble envío aplica una sola confirmación y pide volver a entrar', async () => {
    render(<DemoAccountReset />); await open(); fill();
    const form = screen.getByRole('button', { name: 'Confirmar reinicio' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await screen.findByText('Cuenta demo reiniciada');
    expect(confirmCalls()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Volver a entrar' })).toBeTruthy();
    expect(localStorage.getItem('nortex_demo_reset:demo:owner')).not.toContain('Contraseña');
  });
  it('respuesta perdida mantiene el intento y recupera el comprobante sin otro envío', async () => {
    uncertain = true; render(<DemoAccountReset />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reinicio' }));
    await screen.findByRole('button', { name: 'Verificar resultado' });
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    const saved = JSON.parse(localStorage.getItem('nortex_demo_reset:demo:owner')!);
    expect(saved.requestKey).toBe(requestKey);
    receiptApplied = true; fireEvent.click(screen.getByRole('button', { name: 'Verificar resultado' }));
    await screen.findByText('Cuenta demo reiniciada'); expect(confirmCalls()).toHaveLength(1);
  });
  it('recupera la misma revisión cuando el servidor todavía no aplicó el reinicio', async () => {
    uncertain = true; render(<DemoAccountReset />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reinicio' }));
    await screen.findByRole('button', { name: 'Verificar resultado' });
    const firstKey = requestKey;
    fireEvent.click(screen.getByRole('button', { name: 'Verificar resultado' }));
    await screen.findByRole('button', { name: 'Confirmar reinicio' });
    expect(requestKey).toBe(firstKey); expect(confirmCalls()).toHaveLength(1);
  });
  it('no envía una operación cuando no puede guardar su identidad', async () => {
    render(<DemoAccountReset />);
    const button = await screen.findByRole('button', { name: 'Reiniciar cuenta demo' });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Almacenamiento lleno', 'QuotaExceededError'); });
    fireEvent.click(button); await screen.findByRole('alert');
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/preview'))).toHaveLength(0);
    expect(confirmCalls()).toHaveLength(0);
  });
  it('permite cancelar una revisión vencida solo después del comprobante del servidor', async () => {
    uncertain = true; render(<DemoAccountReset />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reinicio' }));
    await screen.findByRole('button', { name: 'Verificar resultado' });
    receiptExpired = true; fireEvent.click(screen.getByRole('button', { name: 'Verificar resultado' }));
    await screen.findByText('La revisión venció sin aplicar el reinicio. Cancelá y volvé a revisar los datos.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(localStorage.getItem('nortex_demo_reset:demo:owner')).toBeNull(); expect(confirmCalls()).toHaveLength(1);
  });
});
