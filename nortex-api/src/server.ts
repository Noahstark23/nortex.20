import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = 3000;

// Enable CORS for frontend at port 5173
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// 1. GET /api/products?tenantId=...
// Returns the list of products for the POS Grid.
app.get('/api/products', async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId || typeof tenantId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid tenantId' });
      return;
    }

    const products = await prisma.product.findMany({
      where: { tenantId },
    });
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. POST /api/pos/sales
// Receives: { tenantId, cartItems: [{ id, quantity, price }] }
// Transactional logic: Restock, Create Sale, Update Wallet, Update Credit Score
app.post('/api/pos/sales', async (req, res) => {
  try {
    const { tenantId, cartItems } = req.body;

    if (!tenantId || !cartItems || !Array.isArray(cartItems)) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    // Calculate total and items count
    const total = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    const itemsCount = cartItems.reduce((sum: number, item: any) => sum + item.quantity, 0);

    // Credit Score Rule: +1 point per $100 sold
    const creditScoreIncrease = Math.floor(total / 100);

    const result = await prisma.$transaction(async (tx) => {
      // a) Decrement Stock for each product
      for (const item of cartItems) {
        await tx.product.update({
            where: { id: item.id },
            data: {
                stock: { decrement: item.quantity }
            }
        });
      }

      // b) Create Sale record
      const sale = await tx.sale.create({
        data: {
            tenantId,
            total,
            itemsCount,
            status: "COMPLETED"
        }
      });

      // c) & d) Update Tenant Wallet and Credit Score
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
            walletBalance: { increment: total },
            creditScore: { increment: creditScoreIncrease }
        }
      });

      return sale;
    });

    res.json(result);

  } catch (error) {
    console.error('Transaction failed:', error);
    res.status(500).json({ error: 'Transaction failed', details: error });
  }
});

// 3. GET /api/dashboard/stats?tenantId=...
// Returns the tenant object with updated balance and score.
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const { tenantId } = req.query;
        if (!tenantId || typeof tenantId !== 'string') {
            res.status(400).json({ error: 'Missing or invalid tenantId' });
            return;
        }

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        if (!tenant) {
            res.status(404).json({ error: 'Tenant not found' });
            return;
        }

        res.json(tenant);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
