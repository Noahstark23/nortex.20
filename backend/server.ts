// ENTREGABLE 2: server.ts
import express from 'express';
import cors from 'cors';
// @ts-ignore: Suppress error if Prisma Client is not generated in the environment
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// Configuración básica
app.use(cors()); 
app.use(express.json() as any);

// --- UTILS ---
const requireTenant = async (req: any, res: any, next: any) => {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized: Missing Tenant ID' });
  req.tenantId = tenantId;
  next();
};

// --- AUTH (Simplificado) ---
app.post('/api/auth/register', async (req, res) => {
  // ... lógica existente de registro ...
  res.status(501).json({ message: "See previous implementation" });
});

// --- RUTAS DE APP ---

// OBTENER CLIENTES CON DEUDA
app.get('/api/receivables', requireTenant, async (req: any, res) => {
  try {
    const sales = await prisma.sale.findMany({
      where: { 
        tenantId: req.tenantId,
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

// PROCESAR VENTA (Con lógica de Crédito)
app.post('/api/sales', requireTenant, async (req: any, res) => {
  const { items, paymentMethod, customerName, dueDate } = req.body; 
  const tenantId = req.tenantId;

  if (!items || items.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      let totalSale = 0;
      const saleItemsData = [];

      // 1. Stock y Precios
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

      // 2. Gestionar Cliente (Si es Crédito, es obligatorio)
      let customerId = null;
      if (customerName) {
        // En producción esto debería buscar primero
        const customer = await tx.customer.upsert({
            where: { tenantId_name: { tenantId, name: customerName }}, // Asumiendo índice compuesto
            update: {},
            create: { name: customerName, tenantId }
        });
        customerId = customer.id;
      }

      if (paymentMethod === 'CREDIT' && !customerId) {
        throw new Error('Venta a crédito requiere nombre de cliente');
      }

      // 3. Crear Venta
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

      // 4. Scoring y Caja
      if (!isCredit) {
        await tx.tenant.update({
            where: { id: tenantId },
            data: { walletBalance: { increment: totalSale } }
        });
      }

      // El scoring sube igual, vender a crédito es riesgo pero es venta
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

// REGISTRAR ABONO (PAGO DE DEUDA)
app.post('/api/sales/:id/pay', requireTenant, async (req: any, res) => {
  const { amount, method } = req.body;
  const saleId = req.params.id;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
        const sale = await tx.sale.findUnique({ where: { id: saleId } });
        
        if (!sale) throw new Error('Venta no existe');
        if (sale.tenantId !== req.tenantId) throw new Error('Acceso denegado');
        if (Number(sale.balance) < Number(amount)) throw new Error('Monto mayor a la deuda');

        // Crear Pago
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

        // Ingresar dinero a caja real
        await tx.tenant.update({
            where: { id: req.tenantId },
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