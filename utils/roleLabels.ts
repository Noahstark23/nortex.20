const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Propietario', ADMIN: 'Administrador', SUPER_ADMIN: 'Superadministrador',
    MANAGER: 'Gerente', CASHIER: 'Cajero', EMPLOYEE: 'Empleado', VENDEDOR: 'Vendedor',
    BODEGUERO: 'Bodeguero', ACCOUNTANT: 'Contador', VIEWER: 'Visor',
};

export const roleLabelEs = (role: string): string => ROLE_LABELS[role] ?? 'Rol por revisar';
