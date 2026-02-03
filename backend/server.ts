// ENTREGABLE 2: server.ts
import express from 'express';
import cors from 'cors';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';
// @ts-ignore
import jwt from 'jsonwebtoken';

import { authenticate, AuthRequest } from './middleware/auth';
import { MOCK_CATALOG, MOCK_WHOLESALERS } from '../constants'; // Importing mocks for B2B simulation

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';

app.use(cors()); 
app.use(express.json() as any);

// --- AUTH ENGINE ---
app.post('/api/auth/register', async (req: any, res: any) => {
  const { companyName, email, password, type } = req.body;
  if (!companyName || !email || !password) {
    res.status(400).json({ error: 'Todos los campos son obligatorios' });
    return;
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const result = await prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          type: type || 'FERRETERIA',
          slug: companyName.toLowerCase().replace(/\s+/g, '-'),
          walletBalance: 0,
          creditScore: 500,
          creditLimit: 2000,
          subscriptionStatus: 'TRIALING',
          trialEndsAt: trialEndsAt
        }
      });
      const user = await tx.user.create({
        data: { email, password: hashedPassword, role: 'OWNER', tenantId: tenant.id }
      });
      return { tenant, user };
    });
    const token = jwt.sign(
      { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.json({ success: true, token, user: { email: result.user.email, role: result.user.role }, tenant: result.tenant });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al registrar empresa.' });
  }
});

app.post('/api/auth/login', async (req: any, res: any) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.json({ success: true, token, user: { email: user.email, role: user.role }, tenant: user.tenant });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- BILLING ENGINE ---
app.get('/api/billing/status', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: authReq.tenantId },
      select: { subscriptionStatus: true, trialEndsAt: true, plan: true }
    });
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching billing status' });
  }
});

app.post('/api/billing/subscribe', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  try {
    await prisma.tenant.update({
      where: { id: authReq.tenantId },
      data: { subscriptionStatus: 'ACTIVE', trialEndsAt: null }
    });
    res.json({ success: true, message: '✅ Suscripción activada exitosamente.' });
  } catch (error) {
    res.status(500).json({ error: 'Error procesando el pago simulado' });
  }
});

// --- LENDING ENGINE ---
app.get('/api/loans', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  try {
    const loans = await prisma.loan.findMany({ where: { tenantId: authReq.tenantId }, orderBy: { createdAt: 'desc' } });
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener préstamos' });
  }
});

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
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new Error("Tenant no encontrado");
      if (tenant.creditScore < 500) throw new Error("Score insuficiente.");
      if (Number(tenant.creditLimit) < requestedAmount) throw new Error(`Monto excede línea disponible.`);
      
      const interest = requestedAmount * 0.05;
      const totalDue = requestedAmount + interest;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const loan = await tx.loan.create({
        data: { tenantId, amount: requestedAmount, interest, totalDue, status: 'ACTIVE', dueDate }
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: { walletBalance: { increment: requestedAmount }, creditLimit: { decrement: requestedAmount } }
      });
      return loan;
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// --- MARKETPLACE ENGINE (FASE 7) ---

// GET CATALOG (Context Aware)
app.get('/api/marketplace/catalog', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  const sectorFilter = req.query.sector as string;
  
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
    if (!tenant) throw new Error("Tenant no encontrado");

    // Lógica de Negocio: Si no envían filtro, priorizamos el sector del tenant
    let targetSector = sectorFilter;
    if (!targetSector || targetSector === 'ALL') {
       // Mapping Tenant Type to Sector
       if (tenant.type === 'FERRETERIA') targetSector = 'FERRETERIA';
       else if (tenant.type === 'FARMACIA') targetSector = 'FARMACIA';
       else if (tenant.type === 'PULPERIA') targetSector = 'ABARROTES';
       else if (tenant.type === 'BOUTIQUE') targetSector = 'MODA';
       else targetSector = 'ALL';
    }

    // SIMULACIÓN DB QUERY
    let items = MOCK_CATALOG;
    if (targetSector !== 'ALL') {
        items = MOCK_CATALOG.filter(i => i.sector === targetSector);
    }

    res.json({
        items,
        userSector: targetSector // Return to frontend to set default tab
    });
  } catch (error) {
    res.status(500).json({ error: 'Error cargando catálogo' });
  }
});

// BUY B2B
app.post('/api/marketplace/orders', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { items, total } = req.body; // Items: { catalogItemId, quantity }[]
    
    try {
        const result = await prisma.$transaction(async (tx: any) => {
            const tenant = await tx.tenant.findUnique({ where: { id: authReq.tenantId } });
            
            // 1. Check Funds
            if (Number(tenant.walletBalance) < total) {
                throw new Error("Saldo insuficiente en Wallet. Solicite un préstamo.");
            }

            // 2. Deduct Funds
            await tx.tenant.update({
                where: { id: authReq.tenantId },
                data: { walletBalance: { decrement: total } }
            });

            // 3. Create Order (Simulated)
            // In real prisma this would be tx.marketplaceOrder.create(...)
            return { orderId: `ord_${Date.now()}`, status: 'PENDING', total };
        });
        
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});


const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Nortex Backend Ready :${PORT}`));