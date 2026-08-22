import { describe, expect, it } from 'vitest';
import { buildNavigation } from '../utils/navigation';

const paths = (navigation: ReturnType<typeof buildNavigation>) => ({
    primary: navigation.primary.map(item => item.path),
    all: [...navigation.primary, ...navigation.more].map(item => item.path),
});

describe('navegación de bodega', () => {
    it.each(['PULPERIA', 'FERRETERIA', 'FARMACIA', 'DISTRIBUIDORA', 'RETAIL'])(
        'muestra Bodegas directamente en el menú simple de %s',
        (tenantType) => {
            const navigation = paths(buildNavigation({ tenantType, role: 'OWNER', simple: true }));

            expect(navigation.primary).toContain('/app/warehouses');
        },
    );

    it('muestra Bodegas y Órdenes de compra en STOCK del menú completo', () => {
        const navigation = buildNavigation({ tenantType: 'RETAIL', role: 'OWNER', simple: false });
        const warehouses = navigation.primary.find(item => item.path === '/app/warehouses');
        const purchaseOrders = navigation.primary.find(item => item.path === '/app/purchase-orders');

        expect(warehouses).toMatchObject({ label: 'Bodegas', group: 'STOCK' });
        expect(purchaseOrders).toMatchObject({ label: 'Órdenes de compra', group: 'STOCK' });
    });

    it('mantiene las herramientas administrativas fuera del menú operativo', () => {
        for (const role of ['CASHIER', 'VENDEDOR']) {
            const navigation = paths(buildNavigation({ tenantType: 'RETAIL', role, simple: false }));

            expect(navigation.all).not.toContain('/app/warehouses');
            expect(navigation.all).not.toContain('/app/purchase-orders');
        }
    });
});
