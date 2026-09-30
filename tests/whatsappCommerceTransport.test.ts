// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptCommerceWebhook, verifyCommerceSignature } from '../backend/services/whatsapp/commerce/inbox.js';
import { dispatchCommerceOutboxOnce } from '../backend/services/whatsapp/commerce/outbox.js';

const secret = 'synthetic-commerce-hmac-secret';
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('WhatsApp comercial: límites del transporte', () => {
  it('rechaza firma ausente, mutación del cuerpo y secreto distinto antes de consultar BD', async () => {
    const db = { $transaction: vi.fn() } as never;
    expect(verifyCommerceSignature(body, signature, secret)).toBe(true);
    expect(verifyCommerceSignature(Buffer.from(body.toString().replace('entry', 'other')), signature, secret)).toBe(false);
    expect(verifyCommerceSignature(body, signature, 'otro')).toBe(false);
    await expect(acceptCommerceWebhook(body, undefined, { db, appSecret: secret })).rejects.toMatchObject({ code: 'COMMERCE_SIGNATURE', statusCode: 401 });
    expect((db as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it('valida tamaño y esquema antes de abrir transacción', async () => {
    const db = { $transaction: vi.fn() } as never;
    await expect(acceptCommerceWebhook(Buffer.alloc(256 * 1024 + 1), signature, { db, appSecret: secret })).rejects.toMatchObject({ code: 'COMMERCE_PAYLOAD', statusCode: 413 });
    const malformed = Buffer.from('{"object":"incorrecto","entry":[]}');
    const signed = `sha256=${createHmac('sha256', secret).update(malformed).digest('hex')}`;
    await expect(acceptCommerceWebhook(malformed, signed, { db, appSecret: secret })).rejects.toMatchObject({ code: 'COMMERCE_PAYLOAD', statusCode: 400 });
    expect((db as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it('sender apagado no reclama ni invoca red', async () => {
    const db = { $queryRaw: vi.fn() } as never;
    const sender = vi.fn();
    expect(await dispatchCommerceOutboxOnce({ db, sendingEnabled: false, sender })).toBe(false);
    expect(sender).not.toHaveBeenCalled();
    expect((db as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw).not.toHaveBeenCalled();
  });
});
