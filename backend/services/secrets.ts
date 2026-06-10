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
            return jwt.verify(token, secret) as AuthTokenPayload;
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) throw err;
            lastError = err;
        }
    }
    throw lastError;
}
