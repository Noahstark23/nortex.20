// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CommerceSupport from '../components/whatsapp/CommerceSupport';

const initial = { id: 'request-1', tenantId: 'merchant-1', phone: '+50588889999', status: 'REQUESTED', version: 1, assignedTo: null, createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' };
let row = { ...initial }, listFailure = false, postFailure = false, recoveryFailure = false, stale = false, mismatch = false;
let posts: { version: number; status: string }[] = [], gets = 0;
beforeEach(() => {
  row = { ...initial }; listFailure = false; postFailure = false; recoveryFailure = false; stale = false; mismatch = false; posts = []; gets = 0;
  localStorage.clear(); localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('nortex_user', JSON.stringify({ id: 'support-1', role: 'SUPER_ADMIN' }));
  vi.stubGlobal('fetch', vi.fn(async(input, init) => {
    const url = String(input);
    if (url.endsWith('/transition')) {
      const change = JSON.parse(String(init?.body)); posts.push(change);
      if (stale) { row = { ...row, version: 2, status: 'IN_PROGRESS', assignedTo: 'other-support' }; return Response.json({ error: 'La solicitud cambió' }, { status: 409 }); }
      row = { ...row, version: change.version + 1, status: change.status, assignedTo: 'support-1' };
      if (postFailure) throw new Error('QA respuesta perdida');
      return Response.json({ request: mismatch ? { ...row, id: 'other-request' } : row });
    }
    if (url.endsWith('/request-1')) { gets++; if (recoveryFailure) throw new Error('QA consulta no disponible'); return Response.json({ request: row }); }
    if (listFailure) return Response.json({ error: 'No se pudo consultar soporte' }, { status: 503 });
    return Response.json({ items: [row], nextCursor: null });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open() {
  render(<CommerceSupport/>);
  const details = screen.getByText('Conexiones asistidas de WhatsApp').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
}
describe('Bandeja de conexiones asistidas de soporte', () => {
  it('es collapsible, distingue error de vacío y no pide claves al comercio', async () => {
    render(<CommerceSupport/>); expect(fetch).not.toHaveBeenCalled(); cleanup(); listFailure = true; open();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar soporte');
    expect(screen.queryByText('No hay solicitudes en esta página.')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('tramita sin declarar conectado y no repite POST por doble clic', async () => {
    open(); const claim = await screen.findByRole('button', { name: 'Tomar solicitud' }); fireEvent.click(claim); fireEvent.click(claim);
    expect(await screen.findByRole('button', { name: 'Marcar preparada' })).toBeEnabled();
    expect(posts).toEqual([{ version: 1, status: 'IN_PROGRESS' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar preparada' }));
    expect(await screen.findByText(/Preparada; activación pendiente/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Marcar preparada' })).not.toBeInTheDocument();
    expect(posts).toEqual([{ version: 1, status: 'IN_PROGRESS' }, { version: 2, status: 'PREPARED' }]);
  });
  it('POST incierto consulta el ID exacto y confirma sin otro envío', async () => {
    postFailure = true; open(); fireEvent.click(await screen.findByRole('button', { name: 'Tomar solicitud' }));
    expect(await screen.findByText('Cambio comprobado. No se repitió la acción.')).toBeVisible();
    expect(gets).toBe(1); expect(posts).toEqual([{ version: 1, status: 'IN_PROGRESS' }]);
    expect(screen.getByText(/versión 2/)).toBeVisible();
  });
  it('mantiene versión incierta y bloquea acciones hasta consultar; recuperación no duplica POST', async () => {
    postFailure = true; recoveryFailure = true; open(); fireEvent.click(await screen.findByRole('button', { name: 'Tomar solicitud' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El resultado es incierto');
    expect(screen.getByRole('button', { name: 'Tomar solicitud' })).toBeDisabled();
    expect(screen.getByText(/versión 1/)).toBeVisible();
    recoveryFailure = false; fireEvent.click(screen.getByRole('button', { name: 'Consultar solicitud pendiente' }));
    expect(await screen.findByText('Cambio comprobado. No se repitió la acción.')).toBeVisible();
    expect(posts).toHaveLength(1); expect(gets).toBe(2); expect(screen.getByRole('button', { name: 'Marcar preparada' })).toBeEnabled();
  });
  it('una versión stale recupera responsable actual y no sobrescribe otra asignación', async () => {
    stale = true; open(); fireEvent.click(await screen.findByRole('button', { name: 'Tomar solicitud' }));
    expect(await screen.findByText(/Otro operador/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Marcar preparada' })).not.toBeInTheDocument();
    await waitFor(() => expect(posts).toHaveLength(1)); expect(gets).toBe(1);
  });
  it('no usa comprobante de otra solicitud y verifica el expediente original', async () => {
    mismatch = true; open(); fireEvent.click(await screen.findByRole('button', { name: 'Tomar solicitud' }));
    expect(await screen.findByText('Cambio comprobado. No se repitió la acción.')).toBeVisible();
    expect(posts).toHaveLength(1); expect(gets).toBe(1);
    expect(screen.getByRole('article', { name: 'Solicitud +50588889999' })).toBeVisible();
  });
});
