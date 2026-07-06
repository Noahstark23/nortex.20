import { PrismaClient } from '@prisma/client';
// @ts-ignore
import NodeCache from 'node-cache';
import { verifyAuthToken } from '../services/secrets';

const prisma = new PrismaClient();

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

// Rutas que pasan siempre sin importar el estado de suscripción
const ALWAYS_ALLOWED_PREFIXES = ['/api/billing', '/api/auth', '/api/admin'];

export interface AuthRequest {
  userId?: string;
  tenantId?: string;
  role?: string;
  email?: string;
  [key: string]: any;
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

  try {
    // Verifica contra el keyring completo (rotación sin downtime). Ver services/secrets.ts.
    const decoded = verifyAuthToken(token);

    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.role = decoded.role;
    req.email = decoded.email;

    // SUPER_ADMIN bypass total — solo si el rol persistido en la DB lo confirma.
    // Nunca se concede por el claim `email` del JWT (falsificable vía register).
    if (decoded.role === 'SUPER_ADMIN' && (await isVerifiedSuperAdmin(decoded.userId))) {
      next();
      return;
    }

    // Rutas de billing, auth y admin siempre permitidas
    const isExempt = ALWAYS_ALLOWED_PREFIXES.some(prefix => req.originalUrl.startsWith(prefix));
    if (isExempt) {
      next();
      return;
    }

    // PAYWALL CHECK con CACHÉ
    const cacheKey = `tenant:${decoded.tenantId}`;
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
        where: { id: decoded.tenantId },
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
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
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
