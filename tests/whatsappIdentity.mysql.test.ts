import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../backend/services/whatsapp/db';
import { encryptField } from '../backend/services/crypto';
import { resolveChannel, resolveIdentity, type ResolvedChannel } from '../backend/services/whatsapp/identity';

/** Ejecuta REGEXP_REPLACE de MySQL 8 real, sin invocar Meta ni herramientas de pago. */
const enabled = process.env.NORTEX_MYSQL_INTEGRATION === '1';
const qa = enabled ? describe.sequential : describe.skip;
const waId = '50588889999';
let outbound: ReturnType<typeof vi.spyOn>;

async function channel(mode: 'BOT' | 'HUMAN' = 'BOT'): Promise<ResolvedChannel> {
    const tenantId = `qa-wa-identity-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, businessName: 'QA Identidad WhatsApp', taxId: tenantId } });
    const phoneNumberId = `qa-number-${randomUUID()}`;
    const stored = await prisma.whatsAppChannel.create({ data: {
        tenantId, phoneNumberId, botScope: 'B2C', defaultMode: mode, active: true,
        accessTokenEnc: encryptField(`QA-NO-PROVIDER-${randomUUID()}`),
    } });
    const resolved = await resolveChannel(phoneNumberId, 'v99.0');
    expect(resolved).toMatchObject({ channelId: stored.id, tenantId, botScope: 'B2C', defaultMode: mode });
    return resolved!;
}

const customer = (target: ResolvedChannel, phone: string, name = 'Cliente de prueba') => prisma.customer.create({
    data: { tenantId: target.tenantId, phone, name },
});

const conversation = (target: ResolvedChannel, number = waId) => prisma.whatsAppConversation.findUniqueOrThrow({
    where: { tenantId_waId: { tenantId: target.tenantId, waId: number } },
});

qa('WhatsApp: identidad por teléfono en MySQL 8 real', () => {
    beforeAll(() => {
        const database = new URL(process.env.DATABASE_URL!);
        expect(database.protocol).toBe('mysql:');
        expect(['127.0.0.1', 'localhost', '[::1]']).toContain(database.hostname);
        expect(database.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
        // Una llamada saliente accidental falla la suite; la consulta SQL sigue real.
        outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: proveedor externo deshabilitado'));
    });
    afterAll(async () => {
        try { expect(outbound).not.toHaveBeenCalled(); }
        finally { outbound?.mockRestore(); await prisma.$disconnect(); }
    });

    it.each([
        '88889999', '8888-9999', '(8888) 9999', '8888.9999',
        '50588889999', '+505 8888 9999', '(505) 8888-9999', '00505 8888-9999',
    ])('vincula una coincidencia única con formato %s', async phone => {
        const target = await channel();
        const match = await customer(target, phone);
        const identity = await resolveIdentity(target, waId, 'Nombre público diferente');
        expect(identity).toMatchObject({ tenantId: target.tenantId, waId, customerId: match.id,
            customerName: match.name, status: 'BOT' });
        expect((await conversation(target)).customerId).toBe(match.id);
        expect(await prisma.whatsAppConversation.count({ where: { tenantId: target.tenantId } })).toBe(1);
    });

    it('dos o más formatos equivalentes dentro del tenant nunca eligen un cliente arbitrario', async () => {
        const target = await channel();
        await Promise.all(['8888-9999', '+505 88889999', '00505 8888 9999'].map(phone => customer(target, phone)));
        const identity = await resolveIdentity(target, waId, null);
        expect(identity.customerId).toBeNull();
        expect(identity.customerName).toBeNull();
        expect((await conversation(target)).customerId).toBeNull();
    });

    it('un número de otro país con igual sufijo local no acredita identidad', async () => {
        const target = await channel();
        await customer(target, '+502 8888 9999');
        expect((await resolveIdentity(target, waId, null)).customerId).toBeNull();
        const local = await customer(target, '8888-9999');
        const match = await resolveIdentity(target, waId, null);
        expect(match.customerId).toBe(local.id);
        // El emisor extranjero tampoco hereda el atajo de ocho dígitos de NIC.
        const foreignTarget = await channel();
        await customer(foreignTarget, '8888-9999');
        expect((await resolveIdentity(foreignTarget, '50288889999', null)).customerId).toBeNull();
    });

    it('otro tenant no aporta coincidencias ni ambigüedad y tiene su propia conversación', async () => {
        const target = await channel();
        const foreign = await channel('HUMAN');
        const foreignMatch = await customer(foreign, '+505 8888-9999', 'Cliente ajeno');
        const unmatched = await resolveIdentity(target, waId, null);
        expect(unmatched.customerId).toBeNull();
        const local = await customer(target, '88889999');
        const [ownIdentity, foreignIdentity] = await Promise.all([
            resolveIdentity(target, waId, null), resolveIdentity(foreign, waId, null),
        ]);
        expect(ownIdentity.customerId).toBe(local.id);
        expect(foreignIdentity.customerId).toBe(foreignMatch.id);
        expect(ownIdentity.conversationId).not.toBe(foreignIdentity.conversationId);
        expect(foreignIdentity.status).toBe('HUMAN');
    });

    it('borra un vínculo anterior al volverse ambiguo o cambiar el teléfono, preservando HUMAN', async () => {
        const target = await channel('HUMAN');
        const original = await customer(target, '+505 8888-9999');
        const first = await resolveIdentity(target, waId, null);
        expect(first.customerId).toBe(original.id);
        const duplicate = await customer(target, '00505 88889999');
        const ambiguous = await resolveIdentity(target, waId, null);
        expect(ambiguous).toMatchObject({ conversationId: first.conversationId, customerId: null, customerName: null, status: 'HUMAN' });
        expect((await conversation(target)).customerId).toBeNull();
        await prisma.customer.updateMany({ where: { id: duplicate.id, tenantId: target.tenantId }, data: { phone: '77776666' } });
        expect((await resolveIdentity(target, waId, null)).customerId).toBe(original.id);
        await prisma.customer.updateMany({ where: { id: original.id, tenantId: target.tenantId }, data: { phone: '77775555' } });
        expect((await resolveIdentity(target, waId, null)).customerId).toBeNull();
        expect(await conversation(target)).toMatchObject({ customerId: null, status: 'HUMAN' });
    });

    it('corrige una asociación histórica ajena sin tocar la conversación del otro tenant', async () => {
        const target = await channel();
        const foreign = await channel();
        const foreignMatch = await customer(foreign, '88889999');
        const foreignIdentity = await resolveIdentity(foreign, waId, null);
        const before = await conversation(foreign);
        await prisma.whatsAppConversation.create({ data: {
            tenantId: target.tenantId, waId, customerId: foreignMatch.id, status: 'CLOSED',
        } });
        const result = await resolveIdentity(target, waId, null);
        expect(result).toMatchObject({ tenantId: target.tenantId, customerId: null, customerName: null, status: 'CLOSED' });
        expect(result.conversationId).not.toBe(foreignIdentity.conversationId);
        expect((await conversation(target)).customerId).toBeNull();
        expect(await conversation(foreign)).toEqual(before);
    });

    it.each(['contacto 88889999', '88889999 ext. 2', '50588889999\n', '50588889999;DROP TABLE Customer'])('texto ajeno al formato telefónico no acredita cuenta: %j', async phone => {
        const target = await channel();
        await customer(target, phone);
        expect((await resolveIdentity(target, waId, null)).customerId).toBeNull();
        expect(await prisma.customer.count({ where: { tenantId: target.tenantId } })).toBe(1);
    });

    it.each(['', '123', '+50588889999', '5058888 9999', '50588889999 OR 1=1'])('rechaza waId inválido sin crear conversaciones: %j', async invalid => {
        const target = await channel();
        await expect(resolveIdentity(target, invalid, null)).rejects.toThrow('WA_ID_INVALID');
        expect(await prisma.whatsAppConversation.count({ where: { tenantId: target.tenantId } })).toBe(0);
    });
});
