import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    aggregate: vi.fn(),
    customerFindFirst: vi.fn(),
    search: vi.fn(),
}));
vi.mock('../backend/services/whatsapp/db', () => ({ prisma: {
    sale: { aggregate: mocks.aggregate },
    customer: { findFirst: mocks.customerFindFirst },
} }));
vi.mock('../backend/services/whatsapp/rag', () => ({ catalogRetriever: { search: mocks.search } }));

import { getTool, toolsForScope } from '../backend/services/whatsapp/tools';
import { MenuBotBrain } from '../backend/services/whatsapp/agent';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregate.mockResolvedValue({ _sum: { total: '918.00' }, _count: { _all: 2 } });
    mocks.customerFindFirst.mockResolvedValue(null);
    mocks.search.mockResolvedValue([]);
});

describe('el canal WhatsApp no confiere identidad de personal', () => {
    it.each(['B2C', 'B2B', 'BOTH', 'OWNER', 'UNKNOWN'])('%s no expone herramientas de ventas internas', scope => {
        expect(toolsForScope(scope).map(tool => tool.name)).not.toContain('ventas_hoy');
    });
    it('no deja un acceso alternativo por nombre a ventas internas', () => {
        expect(getTool('ventas_hoy')).toBeUndefined();
    });
    it.each(['B2B', 'BOTH'])('un remitente de canal %s no obtiene ventas, ni usando metadatos de propietario', async botScope => {
        const ctx = { tenantId: 'tenant-a', customerId: null, botScope, role: 'OWNER', userId: 'forged', waId: 'forged' };
        const reply = await new MenuBotBrain().reply({ text: 'ventas hoy', ctx, customerName: null, businessName: 'Tienda' });
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(reply.text).toContain('Nortex');
        expect(reply.text).not.toContain('918');
    });
    it.each(['B2C', 'B2B', 'BOTH'])('la búsqueda de %s solo consulta el catálogo publicado', async botScope => {
        await getTool('buscar_producto')!.run({ tenantId: 'tenant-a', customerId: null, botScope }, { query: 'tornillo', publicOnly: false, tenantId: 'tenant-b' });
        expect(mocks.search).toHaveBeenCalledWith('tenant-a', 'tornillo', { publicOnly: true, limit: 5 });
    });
});
