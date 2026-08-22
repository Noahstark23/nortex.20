import { describe, expect, it } from 'vitest';
import { inventoryTabsForRole } from '../components/ui/InventoryTabs';
import { roleCapabilitiesFor, TEAM_ASSIGNABLE_ROLES } from '../utils/roleCapabilities';

describe('capacidades visuales de BODEGUERO', () => {
    it('permite trabajo físico sin heredar administración ni datos financieros', () => {
        expect(roleCapabilitiesFor('BODEGUERO')).toEqual({
            isBodeguero: true,
            canManageProducts: false,
            canAdjustStock: true,
            canViewKardex: true,
            canViewInventoryValuation: false,
            canManageWarehouseTopology: false,
            canTransferStock: true,
            canManagePurchaseOrders: false,
            canReceivePurchaseOrders: true,
        });
    });

    it('se puede asignar desde Mi Equipo', () => {
        expect(TEAM_ASSIGNABLE_ROLES).toContain('BODEGUERO');
    });

    it('quita Series de las pestañas operativas sin afectar al dueño', () => {
        expect(inventoryTabsForRole('BODEGUERO').map(tab => tab.to)).toEqual([
            '/app/inventory',
            '/app/warehouses',
        ]);
        expect(inventoryTabsForRole('OWNER').map(tab => tab.to)).toContain('/app/serials');
    });
});
