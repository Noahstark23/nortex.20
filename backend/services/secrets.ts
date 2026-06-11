/**
 * NORTEX — Auth Secrets (keyring JWT con rotación sin downtime)
 *
 * ENV:
 *   JWT_SECRETS = "secretoNuevo,secretoViejo1,secretoViejo2"   (preferida)
 *   JWT_SECRET  = "secretoÚnico"                               (legacy, sigue funcionando)
 *
 * El PRIMER secreto firma; TODOS verifican. Rotación:
 *   1. JWT_SECRETS="nuevo,actual"  → deploy (los tokens vivos siguen válidos)
 *   2. Esperar el TTL (7d)         → JWT_SECRETS="nuevo" → deploy
 *
 * Fail-closed: el proceso no arranca sin al menos un secreto.
 */

import jwt from 'jsonwebtoken';

const RAW = process.env.JWT_SECRETS ?? process.env.JWT_SECRET;
if (!RAW || !RAW.trim()) {
    throw new Error('🚨 CRITICAL: JWT_SECRETS/JWT_SECRET no está definido. El servicio no puede iniciar sin un secreto JWT.');
}
const KEYRING: string[] = RAW.split(',').map((s) => s.trim()).filter(Boolean);

export interface AuthTokenPayload {
    userId: string;
    tenantId: string;
    role: string;
    email?: string;
}

const TOKEN_TTL = '7d';

export function signAuthToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, KEYRING[0], { expiresIn: TOKEN_TTL });
}

/**
 * Verifica contra todo el keyring. Un TokenExpiredError corta de inmediato:
 * la firma fue válida con esa clave — probar las demás solo enmascararía
 * la causa real (expiración) como "firma inválida".
 */
export function verifyAuthToken(token: string): AuthTokenPayload {
    let lastError: unknown;
    for (const secret of KEYRING) {
        try {
            const decoded = jwt.verify(token, secret) as AuthTokenPayload & { kind?: string };
            // Un token de DRIVER jamás debe pasar por el authenticate de usuarios
            // (no trae tenantId/role): se rechaza explícito, no por accidente.
            if (decoded.kind === 'DRIVER') {
                throw new jwt.JsonWebTokenError('driver token no válido para sesión de usuario');
            }
            return decoded;
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) throw err;
            lastError = err;
        }
    }
    throw lastError;
}

// ── Tokens de MOTORIZADO (Red Nortex / flota propia) ────────────────────────
// Sesión separada de la de usuarios: el payload solo lleva driverId y un
// discriminador `kind`. TTL largo (30d): el repartidor está en la calle,
// re-login mensual con teléfono+PIN es razonable.

export interface DriverTokenPayload {
    driverId: string;
    kind: 'DRIVER';
}

const DRIVER_TOKEN_TTL = '30d';

export function signDriverToken(driverId: string): string {
    const payload: DriverTokenPayload = { driverId, kind: 'DRIVER' };
    return jwt.sign(payload, KEYRING[0], { expiresIn: DRIVER_TOKEN_TTL });
}

export function verifyDriverToken(token: string): DriverTokenPayload {
    let lastError: unknown;
    for (const secret of KEYRING) {
        try {
            const decoded = jwt.verify(token, secret) as Partial<DriverTokenPayload>;
            if (decoded.kind !== 'DRIVER' || !decoded.driverId) {
                throw new jwt.JsonWebTokenError('no es un token de motorizado');
            }
            return { driverId: decoded.driverId, kind: 'DRIVER' };
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) throw err;
            lastError = err;
        }
    }
    throw lastError;
}
