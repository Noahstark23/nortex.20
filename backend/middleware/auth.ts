import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';

export interface AuthRequest {
  userId?: string;
  tenantId?: string;
  role?: string;
  [key: string]: any;
}

export const authenticate = (req: any, res: any, next: any) => {
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
    
    // Attach custom properties directly since we are using 'any'
    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.role = decoded.role;
    
    next();
  } catch (error) {
    res.status(403).json({ error: 'Acceso Denegado: Token inválido o expirado.' });
    return;
  }
};