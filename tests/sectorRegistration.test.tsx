// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { trackEvent } from '../utils/analytics';
import RegisterTenant from '../components/RegisterTenant';

vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(trackEvent).mockClear(); localStorage.clear(); });

describe('alta pública sectorial', () => {
  it.each([
    ['FARMACIA', 'landing_farmacia'],
    ['FERRETERIA', 'landing_ferreteria'],
  ])('emite sign_up con %s solo tras respuesta exitosa', async (type, source) => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Intentá de nuevo' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'synthetic-token', user: { role: 'ADMIN' }, tenant: { id: 'synthetic-tenant' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/register?type=' + type + '&source=' + source]}><RegisterTenant /></MemoryRouter>);
    expect((screen.getByLabelText('Tipo de negocio') as HTMLSelectElement).value).toBe(type);
    fireEvent.change(screen.getByLabelText('Nombre del negocio'), { target: { value: 'Negocio de prueba' } });
    fireEvent.change(screen.getByLabelText('Correo del administrador'), { target: { value: 'prueba@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave-de-prueba-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi negocio' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Intentá de nuevo'));
    expect(vi.mocked(trackEvent).mock.calls.some(([event]) => event === 'sign_up')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi negocio' }));
    await waitFor(() => expect(vi.mocked(trackEvent).mock.calls.some(([event]) => event === 'sign_up')).toBe(true));
    expect(trackEvent).toHaveBeenCalledWith('sign_up', expect.objectContaining({ business_type: type, source }));
    expect(trackEvent).toHaveBeenCalledWith('begin_trial', { business_type: type, source });
  });
});
