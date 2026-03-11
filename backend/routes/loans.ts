import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// 1. ORIGINAR UN CRÉDITO (Desembolso) — Motor Dual
router.post('/', authenticate, async (req: any, res: any) => {
    try {
        const { clientName, clientPhone, clientAddress, principalAmount, interestRate, installments, frequency, type } = req.body;
        const lenderId = req.user.tenantId;

        const amount = parseFloat(principalAmount);
        const rate = parseFloat(interestRate) / 100; // Convertir 5% a 0.05
        const n = parseInt(installments);

        let totalToRepay = 0;
        let installmentAmount = 0;

        if (type === 'FORMAL_AMORTIZED') {
            // Matemática de Financiera (Sistema Francés - Cuota Fija)
            // Fórmula: Cuota = Capital * ( i * (1+i)^n ) / ( (1+i)^n - 1 )
            if (rate === 0) {
                installmentAmount = amount / n;
            } else {
                installmentAmount = amount * (rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1);
            }
            totalToRepay = installmentAmount * n;
        } else {
            // Matemática de Calle (Gota a Gota - Flat)
            // El interés se cobra sobre el principal total desde el día 1
            totalToRepay = amount + (amount * rate);
            installmentAmount = totalToRepay / n;
        }

        // Calcular fecha de vencimiento según frecuencia
        const dueDate = new Date();
        const freqDays: Record<string, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 15, MONTHLY: 30 };
        dueDate.setDate(dueDate.getDate() + (n * (freqDays[frequency] || 1)));

        const newLoan = await prisma.loan.create({
            data: {
                lenderId,
                clientName,
                clientPhone,
                clientAddress,
                principalAmount: amount,
                interestRate: parseFloat(interestRate),
                totalToRepay: Math.round(totalToRepay * 100) / 100,
                balanceRemaining: Math.round(totalToRepay * 100) / 100,
                installments: n,
                installmentAmount: Math.round(installmentAmount * 100) / 100,
                frequency: frequency || 'DAILY',
                type: type || 'INFORMAL_FLAT',
                dueDate,
                status: 'ACTIVE'
            }
        });

        res.status(201).json({ success: true, data: newLoan });
    } catch (error) {
        console.error('Error originando crédito:', error);
        res.status(500).json({ success: false, error: 'Error interno del motor financiero' });
    }
});

// 2. REGISTRAR COBRO DIARIO (Para el Motorizado)
router.post('/:id/repayments', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { amountPaid, collectedBy, notes } = req.body;
        const payment = parseFloat(amountPaid);

        // Transacción Atómica: Registramos el pago y bajamos el saldo en la misma operación
        const transaction = await prisma.$transaction(async (tx) => {
            // 1. Crear el recibo de pago
            const repayment = await tx.repayment.create({
                data: {
                    loanId: id,
                    amountPaid: payment,
                    collectedBy,
                    notes
                }
            });

            // 2. Actualizar el saldo del préstamo
            const updatedLoan = await tx.loan.update({
                where: { id },
                data: {
                    balanceRemaining: {
                        decrement: payment
                    }
                }
            });

            // 3. Si el saldo llega a 0, marcamos como pagado
            if (Number(updatedLoan.balanceRemaining) <= 0) {
                await tx.loan.update({
                    where: { id },
                    data: { status: 'PAID_OFF' }
                });
            }

            return { repayment, updatedLoan };
        });

        res.json({ success: true, data: transaction });
    } catch (error) {
        console.error('Error registrando cobro:', error);
        res.status(500).json({ success: false, error: 'Error procesando el pago' });
    }
});

// 3. LISTAR CARTERA (Dashboard del Inversor)
router.get('/', authenticate, async (req: any, res: any) => {
    try {
        const lenderId = req.user.tenantId;
        const loans = await prisma.loan.findMany({
            where: { lenderId },
            orderBy: { createdAt: 'desc' },
            include: { payments: true } // Traemos el historial de pagos
        });
        res.json({ success: true, data: loans });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo la cartera' });
    }
});

export default router;
