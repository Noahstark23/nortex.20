import jwt from 'jsonwebtoken';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import NodeCache from 'node-cache';

const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';
const prisma = new PrismaClient();

// ==========================================
// CACHÉ EN MEMORIA (Redis Lite)
// TTL: 5 minutos | Check cada 60s
// ==========================================
const tenantCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Email autorizado como SUPER_ADMIN
const SUPER_ADMIN_EMAILS = ['noelpinedaa96@gmail.com'];

export interface AuthRequest {
  userId?: string;
  tenantId?: string;
  role?: string;
  email?: string;
  [key: string]: any;
}

/**
 * Invalida la caché de un tenant específico.
 * Llamar cuando: suspensión, reactivación, cambio de rol.
 */
export function invalidateTenantCache(tenantId: string) {
  tenantCache.del(`tenant:${tenantId}`);
}

/** Invalida TODA la caché (emergencia). */
export function flushAllCache() {
  tenantCache.flushAll();
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

    // --- SUPER_ADMIN BYPASS: No aplica paywall ni caché ---
    if (decoded.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(decoded.email || '')) {
      next();
      return;
    }

    // --- GET requests y rutas especiales: pasan sin check de paywall ---
    if (req.method === 'GET' || req.originalUrl.startsWith('/api/billing') || req.originalUrl.startsWith('/api/admin')) {
      next();
      return;
    }

    // --- PAYWALL CHECK con CACHÉ ---
    const cacheKey = `tenant:${decoded.tenantId}`;
    const cached = tenantCache.get<string>(cacheKey);

    if (cached !== undefined) {
      // CACHE HIT: verificar estado sin tocar la DB
      if (cached === 'PAST_DUE' || cached === 'CANCELLED') {
        res.status(402).json({
          error: '⚠️ SERVICIO SUSPENDIDO: Su suscripción está vencida. Realice el pago para reactivar las operaciones.'
        });
        return;
      }
      next();
      return;
    }

    // CACHE MISS: consultar DB y cachear
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: decoded.tenantId },
        select: { subscriptionStatus: true }
      });

      const status = tenant?.subscriptionStatus || 'ACTIVE';
      tenantCache.set(cacheKey, status);

      if (status === 'PAST_DUE' || status === 'CANCELLED') {
        res.status(402).json({
          error: '⚠️ SERVICIO SUSPENDIDO: Su suscripción está vencida. Realice el pago para reactivar las operaciones.'
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

/**
 * Middleware: Solo permite acceso a SUPER_ADMIN.
 */
export const requireSuperAdmin = async (req: any, res: any, next: any) => {
  const authReq = req as AuthRequest;
  
  if (authReq.role === 'SUPER_ADMIN' || SUPER_ADMIN_EMAILS.includes(authReq.email || '')) {
    next();
    return;
  }

  res.status(403).json({ error: 'Acceso Denegado: Se requiere privilegio SUPER_ADMIN.' });
};
