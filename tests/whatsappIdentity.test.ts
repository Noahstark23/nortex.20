import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('../backend/services/whatsapp/db', () => ({ prisma: {
    $queryRaw: mocks.queryRaw, customer: { findFirst: mocks.findFirst },
    whatsAppConversation: { findUnique: mocks.findUnique, update: mocks.update, create: mocks.create },
} }));
vi.mock('../backend/services/crypto', () => ({ decryptField: vi.fn() }));
import { resolveIdentity, type ResolvedChannel } from '../backend/services/whatsapp/identity';

const channel = { channelId: 'channel-a', tenantId: 'tenant-a', botScope: 'B2C', defaultMode: 'BOT' } as ResolvedChannel;
let customers: { id: string; name: string; phone: string; tenantId: string }[];
beforeEach(() => {
    vi.clearAllMocks();
    customers = [{ id: 'customer-a', name: 'Ana', phone: '88889999', tenantId: 'tenant-a' }];
    mocks.findFirst.mockImplementation(async () => customers[0] ?? null);
    mocks.queryRaw.mockImplementation(async (query: { values: string[] }) => {
        const [tenantId, ...phones] = query.values;
        return customers.filter(customer => customer.tenantId === tenantId && !/[^+0-9() .-]/.test(customer.phone)
            && phones.includes(customer.phone.replace(/\D/g, ''))).slice(0, 2).map(({ id, name }) => ({ id, name }));
    });
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }) => ({ id: 'conversation-a', status: data.status, customerId: data.customerId }));
    mocks.update.mockImplementation(async ({ data }) => ({ id: 'conversation-a', status: 'BOT', customerId: data.customerId }));
});

describe('vinculación WhatsApp a una única cuenta del tenant', () => {
    it.each(['88889999', '8888-9999', '+505 8888 9999', '(505) 8888-9999', '00505 88889999'])('admite formato completo normalizado %s', async phone => {
        customers[0].phone = phone;
        expect((await resolveIdentity(channel, '50588889999', null)).customerId).toBe('customer-a');
        expect(mocks.queryRaw).toHaveBeenCalledOnce();
        const query = mocks.queryRaw.mock.calls[0][0];
        expect(query.sql).toContain('tenantId = ?');
        expect(query.sql).toContain('LIMIT 2');
        expect(query.values[0]).toBe('tenant-a');
    });
    it('dos clientes del mismo teléfono no eligen al primero', async () => {
        customers.push({ ...customers[0], id: 'customer-b' });
        const result = await resolveIdentity(channel, '50588889999', 'Nombre público');
        expect(result.customerId).toBeNull();
        expect(result.customerName).not.toBe('Ana');
    });
    it('revoca una vinculación antigua si ahora es ambigua', async () => {
        mocks.findUnique.mockResolvedValue({ id: 'conversation-a', status: 'BOT', customerId: 'customer-a' });
        customers.push({ ...customers[0], id: 'customer-b' });
        expect((await resolveIdentity(channel, '50588889999', null)).customerId).toBeNull();
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: null }) }));
    });
    it('no conserva la deuda vinculada si el teléfono del cliente cambió', async () => {
        mocks.findUnique.mockResolvedValue({ id: 'conversation-a', status: 'BOT', customerId: 'customer-a' });
        customers[0].phone = '77776666';
        expect((await resolveIdentity(channel, '50588889999', null)).customerId).toBeNull();
    });
    it('no enlaza otro tenant ni un país distinto que comparte los últimos ocho dígitos', async () => {
        customers.push({ ...customers[0], id: 'foreign', tenantId: 'tenant-b', phone: '188889999' });
        expect((await resolveIdentity(channel, '188889999', null)).customerId).toBeNull();
    });
    it('un teléfono incrustado en otro texto no acredita la cuenta', async () => {
        customers[0].phone = 'contacto 88889999';
        expect((await resolveIdentity(channel, '50588889999', null)).customerId).toBeNull();
    });
    it.each(['50588889999\n', '50588889999\r\n', '50588889999\0'])('rechaza controles aunque los dígitos coincidan: %j', async phone => {
        customers[0].phone = phone;
        expect((await resolveIdentity(channel, '50588889999', null)).customerId).toBeNull();
        // ICU puede emparejar $ antes del newline final. La whitelist debe
        // negar cualquier carácter ajeno, sin depender de ese ancla.
        expect(mocks.queryRaw.mock.calls[0][0].sql).toContain("phone NOT REGEXP '[^+0-9() .-]'");
    });
    it.each(['', '123', 'not-a-phone', '+50588889999'])('rechaza waId inválido %j antes de cualquier lectura', async waId => {
        await expect(resolveIdentity(channel, waId, null)).rejects.toThrow('WA_ID_INVALID');
        expect(mocks.queryRaw).not.toHaveBeenCalled();
        expect(mocks.findUnique).not.toHaveBeenCalled();
    });
});
