import jwt from 'jsonwebtoken';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import NodeCache from 'node-cache';

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('🚨 CRITICAL: JWT_SECRET not set in production!');
    process.exit(1);
  }
  return 'nortex_dev_secret_key_2026';
})();
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

// Email autorizado como SUPER_ADMIN
const SUPER_ADMIN_EMAILS = ['noelpinedaa96@gmail.com'];

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
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; tenantId: string; role: string; email?: string };

    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.role = decoded.role;
    req.email = decoded.email;

    // SUPER_ADMIN bypass total
    if (decoded.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(decoded.email || '')) {
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
      // Fail-open: si DB falla, permitir acceso
      console.warn('⚠️ DB check failed, allowing access (fail-open)');
      next();
    }
  } catch (error) {
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
    return;
  }
};

export const requireSuperAdmin = async (req: any, res: any, next: any) => {
  const authReq = req as AuthRequest;

  if (authReq.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(authReq.email || '')) {
    next();
    return;
  }

  res.status(403).json({ error: 'Acceso Denegado: Se requiere privilegio SUPER_ADMIN.' });
};
