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
import { MOCK_CATALOG, MOCK_WHOLESALERS } from '../constants';

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nortex_super_secret_key_2026';

app.use(cors()); 
app.use(express.json() as any);

// --- AUTH, BILLING, LENDING, MARKETPLACE ROUTES (KEEP PREVIOUS CODE) ---
// (Omitted for brevity, assuming they exist as per previous prompts)
// ...

// --- OPERATIONAL HARDENING (FASE 8) ---

// 1. OPEN SHIFT
app.post('/api/shifts/open', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  const { initialCash } = req.body;

  try {
    // Check if user already has open shift
    const openShift = await prisma.shift.findFirst({
      where: { userId: authReq.userId, status: 'OPEN' }
    });

    if (openShift) {
      return res.status(400).json({ error: 'Ya tienes una caja abierta.' });
    }

    const shift = await prisma.shift.create({
      data: {
        tenantId: authReq.tenantId,
        userId: authReq.userId,
        initialCash: initialCash || 0,
        status: 'OPEN',
        startTime: new Date()
      }
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        tenantId: authReq.tenantId,
        userId: authReq.userId,
        action: 'OPEN_SHIFT',
        details: `Caja abierta con $${initialCash}`
      }
    });

    res.json(shift);
  } catch (error) {
    res.status(500).json({ error: 'Error abriendo caja' });
  }
});

// 2. CLOSE SHIFT (BLIND CLOSE)
app.post('/api/shifts/close', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  const { declaredCash, shiftId } = req.body; // declaredCash es lo que cuenta el cajero

  try {
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { sales: true } // Need sales to calc expected cash
    });

    if (!shift || shift.status !== 'OPEN') {
      return res.status(400).json({ error: 'Turno inválido o ya cerrado.' });
    }

    // Calcular efectivo esperado: Fondo Inicial + Ventas en Efectivo
    const cashSales = shift.sales
        .filter((s: any) => s.paymentMethod === 'CASH')
        .reduce((sum: number, s: any) => sum + Number(s.total), 0);
    
    // Si hubieran salidas de caja (Expenses), se restarían aquí.
    const expectedCash = Number(shift.initialCash) + cashSales;
    const difference = Number(declaredCash) - expectedCash;

    const closedShift = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        endTime: new Date(),
        status: 'CLOSED',
        finalCashDeclared: declaredCash,
        systemExpectedCash: expectedCash,
        difference: difference
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: authReq.tenantId,
        userId: authReq.userId,
        action: 'CLOSE_SHIFT',
        details: `Cierre Z. Declarado: ${declaredCash}, Esperado: ${expectedCash}, Dif: ${difference}`
      }
    });

    res.json(closedShift);

  } catch (error) {
    res.status(500).json({ error: 'Error cerrando caja' });
  }
});

// 3. PROFIT REPORT (REAL UTILITY)
app.get('/api/reports/profit', authenticate, async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  const { startDate, endDate } = req.query;

  try {
    // Fetch sales with items within date range
    const sales = await prisma.sale.findMany({
      where: {
        tenantId: authReq.tenantId,
        status: 'COMPLETED',
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      },
      include: {
        items: true // We need items to get costAtSale
      }
    });

    let totalRevenue = 0;
    let totalCOGS = 0;

    sales.forEach((sale: any) => {
      totalRevenue += Number(sale.total);
      sale.items.forEach((item: any) => {
        // Costo * Cantidad
        totalCOGS += (Number(item.costAtSale) * item.quantity);
      });
    });

    const grossProfit = totalRevenue - totalCOGS;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    res.json({
      revenue: totalRevenue,
      cogs: totalCOGS,
      grossProfit: grossProfit,
      marginPercent: margin.toFixed(2),
      transactionCount: sales.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Error generando reporte' });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Nortex Backend Ready :${PORT}`));