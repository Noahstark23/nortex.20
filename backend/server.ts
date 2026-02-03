// ENTREGABLE 2: server.ts
import express from 'express';
import cors from 'cors';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';
// @ts-ignore
import jwt from 'jsonwebtoken';

// Import middleware (Assuming same directory structure or handled by bundler)
import { authenticate, AuthRequest } from './middleware/auth';

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';

// Configuración básica
app.use(cors()); 
app.use(express.json() as any);

// --- AUTH ENGINE ---

// REGISTRO
app.post('/api/auth/register', async (req: any, res: any) => {
  const { companyName, email, password, type } = req.body;

  if (!companyName || !email || !password) {
    res.status(400).json({ error: 'Todos los campos son obligatorios' });
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          type: type || 'FERRETERIA',
          slug: companyName.toLowerCase().replace(/\s+/g, '-'),
          walletBalance: 0,
          creditScore: 500, // Score base
          creditLimit: 2000 // Cupo inicial base para pruebas
        }
      });

      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'OWNER',
          tenantId: tenant.id
        }
      });

      return { tenant, user };
    });

    const token = jwt.sign(
      { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      user: { email: result.user.email, role: result.user.role },
      tenant: result.tenant 
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Error al registrar empresa.' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req: any, res: any) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true }
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      success: true,
      token,
      user: { email: user.email, role: user.role },
      tenant: user.tenant
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- LENDING ENGINE (FASE 5) ---

// OBTENER HISTORIAL DE PRÉSTAMOS
app.get('/api/loans', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  try {
    const loans = await prisma.loan.findMany({
      where: { tenantId: authReq.tenantId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener préstamos' });
  }
});

// SOLICITAR PRÉSTAMO (Lending Request)
app.post('/api/loans/request', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  const { amount } = req.body;
  const tenantId = authReq.tenantId;

  const requestedAmount = Number(amount);

  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    res.status(400).json({ error: 'Monto inválido' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Obtener Data Actualizada del Tenant
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      
      if (!tenant) throw new Error("Tenant no encontrado");

      // VALIDACIONES DE RIESGO
      if (tenant.creditScore < 500) {
        throw new Error("Score insuficiente. Mejore su historial de ventas.");
      }
      if (Number(tenant.creditLimit) < requestedAmount) {
        throw new Error(`Monto excede su línea disponible de $${Number(tenant.creditLimit).toFixed(2)}`);
      }

      // Check Default (Si tiene préstamos vencidos)
      const defaultedLoans = await tx.loan.count({
        where: { tenantId, status: 'DEFAULT' }
      });
      if (defaultedLoans > 0) {
        throw new Error("Tiene deudas vencidas. Regularice su situación.");
      }

      // 2. Calcular Condiciones Financieras
      const interestRate = 0.05; // 5% Flat
      const interest = requestedAmount * interestRate;
      const totalDue = requestedAmount + interest;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // 30 días plazo

      // 3. Crear Préstamo
      const loan = await tx.loan.create({
        data: {
          tenantId,
          amount: requestedAmount,
          interest,
          totalDue,
          status: 'ACTIVE',
          dueDate
        }
      });

      // 4. TRANSACCIÓN ATÓMICA: Inyectar Dinero y Reducir Cupo
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          walletBalance: { increment: requestedAmount },
          creditLimit: { decrement: requestedAmount }
        }
      });

      return loan;
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// --- API DE VENTAS Y COBRANZA (Legacy) ---
// ... (Rutas de /api/sales y /api/receivables se mantienen igual que la versión anterior) ...

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Nortex Backend Ready :${PORT}`));