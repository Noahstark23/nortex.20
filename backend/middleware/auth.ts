import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';

export interface AuthRequest extends Request {
  userId?: string;
  tenantId?: string;
  role?: string;
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
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
    
    // Cast to AuthRequest to attach custom properties
    (req as AuthRequest).userId = decoded.userId;
    (req as AuthRequest).tenantId = decoded.tenantId;
    (req as AuthRequest).role = decoded.role;
    
    next();
  } catch (error) {
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
    return;
  }
};