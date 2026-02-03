// ENTREGABLE 2: server.ts
import express, { Request, Response } from 'express';
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

// REGISTRO (Tenant + Owner User)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { companyName, email, password, type } = req.body;

  if (!companyName || !email || !password) {
    res.status(400).json({ error: 'Todos los campos son obligatorios' });
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Crear Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          type: type || 'FERRETERIA',
          slug: companyName.toLowerCase().replace(/\s+/g, '-'),
          walletBalance: 0,
          creditScore: 500 // Score inicial base
        }
      });

      // 2. Crear Usuario Admin (Owner)
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

    // 3. Generar Token
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
    console.error(error);
    res.status(500).json({ error: 'Error al registrar empresa. El email o empresa ya existe.' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    // 1. Buscar Usuario
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true }
    });

    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    // 2. Verificar Password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    // 3. Generar Token
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

// --- RUTAS PROTEGIDAS (API) ---

// OBTENER CLIENTES CON DEUDA
app.get('/api/receivables', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const sales = await prisma.sale.findMany({
      where: { 
        tenantId: authReq.tenantId,
        status: 'CREDIT_PENDING'
      },
      include: { customer: true, payments: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching receivables' });
  }
});

// PROCESAR VENTA
app.post('/api/sales', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { items, paymentMethod, customerName, dueDate } = req.body; 
  const tenantId = authReq.tenantId;

  if (!items || items.length === 0) {
    res.status(400).json({ error: 'Carrito vacío' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      let totalSale = 0;
      const saleItemsData = [];

      // Validar Stock
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.id } });
        if (!product || product.stock < item.quantity) throw new Error(`Stock insuficiente: ${item.name}`);

        await tx.product.update({
          where: { id: item.id },
          data: { stock: { decrement: item.quantity } }
        });

        totalSale += Number(product.price) * item.quantity;
        saleItemsData.push({
          productId: product.id,
          quantity: item.quantity,
          priceAtSale: product.price
        });
      }

      // Cliente
      let customerId = null;
      if (customerName) {
        const customer = await tx.customer.upsert({
            where: { tenantId_name: { tenantId, name: customerName }},
            update: {},
            create: { name: customerName, tenantId }
        });
        customerId = customer.id;
      }

      if (paymentMethod === 'CREDIT' && !customerId) {
        throw new Error('Venta a crédito requiere nombre de cliente');
      }

      // Crear Venta
      const isCredit = paymentMethod === 'CREDIT';
      const sale = await tx.sale.create({
        data: {
          tenantId,
          total: totalSale,
          status: isCredit ? 'CREDIT_PENDING' : 'COMPLETED',
          balance: isCredit ? totalSale : 0,
          paymentMethod: paymentMethod,
          customerId: customerId,
          dueDate: isCredit ? new Date(dueDate) : null,
          items: { create: saleItemsData }
        }
      });

      // Wallet & Score
      if (!isCredit) {
        await tx.tenant.update({
            where: { id: tenantId },
            data: { walletBalance: { increment: totalSale } }
        });
      }
      await tx.tenant.update({
        where: { id: tenantId },
        data: { creditScore: { increment: Math.floor(totalSale / 10) } }
      });

      return sale;
    });

    res.json({ success: true, saleId: result.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REGISTRAR ABONO
app.post('/api/sales/:id/pay', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { amount, method } = req.body;
  const saleId = req.params.id;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
        const sale = await tx.sale.findUnique({ where: { id: saleId } });
        
        if (!sale) throw new Error('Venta no existe');
        if (sale.tenantId !== authReq.tenantId) throw new Error('Acceso denegado'); // Security Check
        
        if (Number(sale.balance) < Number(amount)) throw new Error('Monto mayor a la deuda');

        await tx.payment.create({
            data: {
                saleId,
                amount,
                method,
                date: new Date()
            }
        });

        const newBalance = Number(sale.balance) - Number(amount);
        const newStatus = newBalance <= 0.01 ? 'PAID' : 'CREDIT_PENDING';

        await tx.sale.update({
            where: { id: saleId },
            data: { balance: newBalance, status: newStatus }
        });

        await tx.tenant.update({
            where: { id: authReq.tenantId },
            data: { walletBalance: { increment: amount } }
        });

        return { newBalance, newStatus };
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Nortex Backend Ready :${PORT}`));