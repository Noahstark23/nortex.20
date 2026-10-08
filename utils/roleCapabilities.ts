/**
 * Capacidades de interfaz por rol.
 *
 * Esta tabla NO reemplaza la autorización del backend: solo evita mostrar
 * acciones que el servidor rechazará. Mantenerla pura permite probar que un
 * rol operativo no herede por accidente controles administrativos.
 */
export interface RoleCapabilities {
    isBodeguero: boolean;
    canManageProducts: boolean;
    canAdjustStock: boolean;
    canViewKardex: boolean;
    canViewInventoryValuation: boolean;
    canManageWarehouseTopology: boolean;
    canTransferStock: boolean;
    canManagePurchaseOrders: boolean;
    canReceivePurchaseOrders: boolean;
}

const PRODUCT_ADMINS = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const OPERATIONS_MANAGERS = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER']);

export const TEAM_ASSIGNABLE_ROLES = [
    'MANAGER',
    'CASHIER',
    'VENDEDOR',
    'BODEGUERO',
    'VIEWER',
    'EMPLOYEE',
    'ACCOUNTANT',
] as const;

export function roleCapabilitiesFor(role: string): RoleCapabilities {
    const normalized = role.toUpperCase();
    const isBodeguero = normalized === 'BODEGUERO';
    const canManageProducts = PRODUCT_ADMINS.has(normalized);
    const canOperateInventory = canManageProducts || isBodeguero;
    const canManageOperations = OPERATIONS_MANAGERS.has(normalized);

    return {
        isBodeguero,
        canManageProducts,
        canAdjustStock: canOperateInventory,
        canViewKardex: canOperateInventory,
        // El costo y la valoración son información administrativa/financiera.
        canViewInventoryValuation: canManageProducts,
        canManageWarehouseTopology: canManageOperations,
        canTransferStock: canManageOperations || isBodeguero,
        canManagePurchaseOrders: canManageOperations,
        canReceivePurchaseOrders: canManageOperations || isBodeguero,
    };
}

/** Lee primero el rol firmado del JWT y usa nortex_user solo como fallback. */
export function currentSessionRole(): string {
    if (typeof localStorage === 'undefined') return '';

    const token = localStorage.getItem('nortex_token');
    if (token) {
        try {
            const payload = token.split('.')[1]
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
            return String(JSON.parse(atob(padded)).role || '').toUpperCase();
        } catch { /* token ilegible: intentar el usuario persistido */ }
    }

    try {
        return String(JSON.parse(localStorage.getItem('nortex_user') || '{}').role || '').toUpperCase();
    } catch {
        return '';
    }
}
