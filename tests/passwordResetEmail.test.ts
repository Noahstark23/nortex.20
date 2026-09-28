import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

async function resetEmail(from = 'Nortex <correo@example.com>') {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('EMAIL_FROM', from);
  const { sendPasswordResetEmail } = await import('../backend/services/email');
  return sendPasswordResetEmail('cliente@example.com', 'https://example.com/reset-password/test', 'Cliente');
}

describe('correo de recuperación', () => {
  beforeEach(() => send.mockReset());

  it('no declara enviado cuando Resend devuelve un error sin lanzar excepción', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'sender not verified' } });
    expect(await resetEmail()).toBe(false);
  });

  it('declara enviado solo cuando Resend acepta el correo', async () => {
    send.mockResolvedValue({ data: { id: 'email-id' }, error: null });
    expect(await resetEmail()).toBe(true);
  });

  it('bloquea el remitente de prueba que no puede entregar a clientes', async () => {
    expect(await resetEmail('Nortex <onboarding@resend.dev>')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('no declara enviado el correo de bienvenida si el proveedor lo rechaza', async () => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM', 'Nortex <correo@example.com>');
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'sender not verified' } });
    const { sendWelcomeEmail } = await import('../backend/services/email');
    expect(await sendWelcomeEmail('cliente@example.com', 'Mi tienda', '9876')).toBe(false);
  });
});
