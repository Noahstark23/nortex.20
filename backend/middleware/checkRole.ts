import { AuthRequest } from './auth';

/**
 * Middleware para verificar roles de usuario.
 * ADMIN siempre tiene acceso total (es el dueño del negocio que se registró).
 * OWNER también tiene acceso total (alias de admin).
 * Los demás roles solo acceden si están en la lista permitida.
 */
const SUPERUSER_ROLES = ['ADMIN', 'OWNER'];

export const checkRole = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: any, next: any) => {
        const userRole = req.role;

        if (!userRole) {
            return res.status(401).json({
                error: 'Acceso Denegado: Usuario no autenticado.'
            });
        }

        // ADMIN y OWNER siempre pasan - son los dueños del negocio
        if (SUPERUSER_ROLES.includes(userRole)) {
            return next();
        }

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: 'Acceso Denegado: Permisos insuficientes.'
            });
        }

        next();
    };
};
