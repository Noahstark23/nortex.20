import jwt from 'jsonwebtoken';
// @ts-ignore
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';
const prisma = new PrismaClient();

export interface AuthRequest {
  userId?: string;
  tenantId?: string;
  role?: string;
  [key: string]: any;
}

export const authenticate = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Acceso Denegado: No se proporcionó token.' });
    return;
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    res.status(401).json({ error: 'Acceso Denegado: Formato de token inválido.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; tenantId: string; role: string };
    
    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.role = decoded.role;

    // --- FASE 6: PAYWALL LOGIC ---
    // Si es GET o es una ruta de facturación, permitimos el paso siempre.
    if (req.method === 'GET' || req.originalUrl.startsWith('/api/billing')) {
      next();
      return;
    }

    // Para operaciones de escritura (POST, PUT, DELETE), verificamos el estado del Tenant en DB
    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.tenantId },
      select: { subscriptionStatus: true }
    });

    if (tenant && (tenant.subscriptionStatus === 'PAST_DUE' || tenant.subscriptionStatus === 'CANCELLED')) {
      res.status(402).json({ 
        error: '⚠️ SERVICIO SUSPENDIDO: Su suscripción está vencida. Realice el pago para reactivar las operaciones.' 
      });
      return;
    }

    next();
  } catch (error) {
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
    return;
  }
};