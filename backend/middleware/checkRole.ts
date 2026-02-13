import { AuthRequest } from './auth';

/**
 * Middleware para verificar roles de usuario.
 * Jerarquía de roles:
 *   SUPER_ADMIN > OWNER/ADMIN > MANAGER > CASHIER > VIEWER > EMPLOYEE
 * 
 * ADMIN/OWNER siempre tienen acceso total (son los dueños del negocio).
 * Los demás roles solo acceden si están en la lista permitida.
 */
const SUPERUSER_ROLES = ['ADMIN', 'OWNER', 'SUPER_ADMIN'];

// Definición de permisos por rol
export const ROLE_PERMISSIONS: Record<string, string[]> = {
    OWNER: ['*'], // Todo
    ADMIN: ['*'], // Todo (alias de OWNER)
    MANAGER: [
        'dashboard:read',
        'pos:write',
        'inventory:read', 'inventory:write',
        'customers:read', 'customers:write',
        'suppliers:read', 'suppliers:write',
        'reports:read',
        'quotations:read', 'quotations:write',
        'purchases:read', 'purchases:write',
    ],
    CASHIER: [
        'pos:write',
        'inventory:read',
        'customers:read',
    ],
    VIEWER: [
        'dashboard:read',
        'inventory:read',
        'customers:read',
        'suppliers:read',
        'reports:read',
        'quotations:read',
        'purchases:read',
    ],
    EMPLOYEE: [
        'pos:write',
        'inventory:read',
    ],
};

export const checkRole = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: any, next: any) => {
        const userRole = req.role;

        if (!userRole) {
            return res.status(401).json({
                error: 'Acceso Denegado: Usuario no autenticado.'
            });
        }

        // ADMIN, OWNER y SUPER_ADMIN siempre pasan
        if (SUPERUSER_ROLES.includes(userRole)) {
            return next();
        }

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: 'Acceso Denegado: Permisos insuficientes para tu rol.'
            });
        }

        next();
    };
};

/**
 * Middleware para verificar permisos granulares.
 * Uso: checkPermission('inventory:write')
 */
export const checkPermission = (permission: string) => {
    return (req: AuthRequest, res: any, next: any) => {
        const userRole = req.role;

        if (!userRole) {
            return res.status(401).json({ error: 'No autenticado.' });
        }

        const perms = ROLE_PERMISSIONS[userRole] || [];

        if (perms.includes('*') || perms.includes(permission)) {
            return next();
        }

        return res.status(403).json({
            error: `Acceso Denegado: Tu rol (${userRole}) no tiene permiso para esta acción.`
        });
    };
};
