// @ts-ignore
import NodeCache from 'node-cache';
import { verifyAuthToken } from '../services/secrets';
import { isBillingExempt } from './billingExempt';
import { BODEGUERO_ROLE, isBodegueroRouteAllowed } from '../security/bodegueroPolicy';
import prisma from '../lib/prisma.js';

// ==========================================
// CACHÉ EN MEMORIA (Redis Lite)
// TTL: 5 minutos | Check cada 60s
// ==========================================
interface TenantCacheEntry {
  status: string;
  trialEndsAt: Date | null;
}
const tenantCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Emails reservados para SUPER_ADMIN. Se usan SOLO para bloquear su registro/invitación
// desde otros módulos (server.ts); NUNCA para conceder privilegios. La lista se define por
// variable de entorno (jamás hardcodeada ni expuesta en el bundle frontend).
export const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// El privilegio SUPER_ADMIN NUNCA se deriva del claim `email` del JWT (falsificable vía
// /api/auth/register, que firma el email elegido por el cliente). La única fuente confiable
// es el rol PERSISTIDO en la DB. Verificamos contra ella antes de conceder god-mode.
async function isVerifiedSuperAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    return user?.role === 'SUPER_ADMIN' && user?.status === 'ACTIVE';
  } catch (err) {
    // Fail-closed: ante un fallo de DB no concedemos el privilegio.
    console.error('🚨 Verificación de SUPER_ADMIN falló (fail-closed):', err);
    return false;
  }
}

// P1 retención — NUNCA bloquear el acto de vender por billing (política del CEO).
// La lógica pura de exención vive en ./billingExempt (testeada en CI).

export interface AuthRequest {
  userId?: string;
  tenantId?: string;
  role?: string;
  email?: string;
  [key: string]: any;
}

interface PersistedPrincipal {
  id: string;
  tenantId: string;
  role: string;
  status: string;
  email: string | null;
}

interface TokenPrincipal {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/**
 * Resuelve la identidad efectiva con autoridad de BD. El rol del JWT solo
 * identifica la sesion que se emitio: nunca conserva privilegios despues de
 * una degradacion, deshabilitacion o cambio de tenant.
 */
export function resolveCurrentPrincipal(
  decoded: TokenPrincipal,
  persisted: PersistedPrincipal | null,
): Pick<PersistedPrincipal, 'id' | 'tenantId' | 'role' | 'email'> | null {
  if (!persisted || persisted.status !== 'ACTIVE') return null;
  if (persisted.id !== decoded.userId || persisted.tenantId !== decoded.tenantId) return null;
  if (!persisted.role || !persisted.role.trim()) return null;
  return {
    id: persisted.id,
    tenantId: persisted.tenantId,
    role: persisted.role,
    email: persisted.email,
  };
}

export function invalidateTenantCache(tenantId: string) {
  tenantCache.del(`tenant:${tenantId}`);
}

export function flushAllCache() {
  tenantCache.flushAll();
}

function isSubscriptionBlocked(entry: TenantCacheEntry): boolean {
  if (entry.status === 'PAST_DUE' || entry.status === 'CANCELLED') return true;
  if (entry.status === 'TRIAL' && entry.trialEndsAt) {
    return new Date(entry.trialEndsAt) < new Date();
  }
  return false;
}

export const authenticate = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Acceso Denegado: No se proporcionó token.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Acceso Denegado: Formato de token inválido.' });
    return;
  }

  let decoded: ReturnType<typeof verifyAuthToken>;
  try {
    // Verifica contra el keyring completo (rotación sin downtime). Ver services/secrets.ts.
    decoded = verifyAuthToken(token);
  } catch (_error) {
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
    return;
  }

  // P1: revalidacion obligatoria en CADA request. No se cachea el usuario:
  // deshabilitarlo, degradar su rol o moverlo de tenant revoca el privilegio
  // inmediatamente aunque el JWT siga firmado y tenga 30 dias de vigencia.
  let persistedUser: PersistedPrincipal | null;
  try {
    persistedUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, tenantId: true, role: true, status: true, email: true },
    });
  } catch (dbError) {
    console.error('🚨 Revalidacion de usuario fallo (fail-closed):', dbError);
    res.status(500).json({
      error: 'No se pudo verificar el estado de la sesion. Intente de nuevo.',
      code: 'AUTH_STATE_UNAVAILABLE',
    });
    return;
  }

  const principal = resolveCurrentPrincipal(decoded, persistedUser);
  if (!principal) {
    res.status(403).json({
      error: 'Acceso Denegado: La sesion ya no esta activa.',
      code: 'SESSION_REVOKED',
    });
    return;
  }

  // Toda autorizacion posterior consume exclusivamente estos datos actuales.
  req.userId = principal.id;
  req.tenantId = principal.tenantId;
  req.role = principal.role;
  req.email = principal.email ?? undefined;

  // Privilegio mínimo DESPUÉS de revalidar la sesión contra BD y ANTES de
  // cualquier bypass de billing. Toda ruta nueva queda denegada hasta entrar
  // explícitamente a la allowlist operativa del rol.
  if (principal.role === BODEGUERO_ROLE && !isBodegueroRouteAllowed(req.method, req.originalUrl || req.url || '')) {
    res.status(403).json({
      error: 'Acceso Denegado: Este rol solo puede operar inventario, bodegas, conteos y recepciones.',
    });
    return;
  }

  // SUPER_ADMIN bypass total — solo el rol ACTIVE recien leido de la BD.
  if (principal.role === 'SUPER_ADMIN') {
    next();
    return;
  }

  try {
    // Exención de billing: billing/auth/admin + lecturas + camino de venta.
    // Nunca bloqueamos el POS ni el acceso de lectura a los datos propios.
    if (isBillingExempt(req.method, req.originalUrl || '')) {
      next();
      return;
    }

    // PAYWALL CHECK con CACHÉ
    const cacheKey = `tenant:${principal.tenantId}`;
    const cached = tenantCache.get<TenantCacheEntry>(cacheKey);

    if (cached !== undefined) {
      if (isSubscriptionBlocked(cached)) {
        res.status(402).json({
          error: '⚠️ SERVICIO SUSPENDIDO: Su suscripción está vencida. Realice el pago para reactivar.',
          subscriptionStatus: cached.status,
        });
        return;
      }
      next();
      return;
    }

    // CACHE MISS: consultar DB
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: principal.tenantId },
        select: { subscriptionStatus: true, trialEndsAt: true },
      });

      const entry: TenantCacheEntry = {
        status: tenant?.subscriptionStatus || 'TRIAL',
        trialEndsAt: tenant?.trialEndsAt || null,
      };
      tenantCache.set(cacheKey, entry);

      if (isSubscriptionBlocked(entry)) {
        res.status(402).json({
          error: '⚠️ SERVICIO SUSPENDIDO: Su suscripción está vencida. Realice el pago para reactivar.',
          subscriptionStatus: entry.status,
        });
        return;
      }

      next();
    } catch (dbError) {
      // Fail-closed: si la verificación contra la DB falla, denegamos y abortamos.
      console.error('🚨 Verificación de suscripción falló (fail-closed):', dbError);
      res.status(500).json({ error: 'No se pudo verificar el estado de la suscripción. Intente de nuevo.' });
      return;
    }
  } catch (error) {
    // Fallo inesperado despues de validar token/usuario: nunca confundirlo con
    // un JWT malo ni permitir la request sin verificar billing.
    console.error('🚨 Verificacion de autenticacion fallo (fail-closed):', error);
    res.status(500).json({ error: 'No se pudo verificar la sesion. Intente de nuevo.' });
    return;
  }
};

export const requireSuperAdmin = async (req: any, res: any, next: any) => {
  const authReq = req as AuthRequest;

  // Verificación contra el rol persistido en la DB; nunca por el email del JWT.
  if (authReq.role === 'SUPER_ADMIN' && (await isVerifiedSuperAdmin(authReq.userId))) {
    next();
    return;
  }

  res.status(403).json({ error: 'Acceso Denegado: Se requiere privilegio SUPER_ADMIN.' });
};
