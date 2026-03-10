import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth'; // Usamos tu middleware actual

const router = express.Router();
const prisma = new PrismaClient();

// 1. ORIGINAR UN CRÉDITO (Desembolso)
router.post('/', authenticateToken, async (req: any, res: any) => {
    try {
        const { clientName, clientPhone, clientAddress, principalAmount, interestRate, installments, frequency, type } = req.body;
        const lenderId = req.user.tenantId; // El tenant que presta el dinero

        // Lógica matemática básica (Flat para gota a gota)
        const amount = parseFloat(principalAmount);
        const rate = parseFloat(interestRate);
        const totalToRepay = amount + (amount * (rate / 100));
        const installmentAmount = totalToRepay / installments;

        // Calculamos fecha de vencimiento básica (simplificado para el MVP)
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + installments); // Asumiendo cobro diario para el MVP

        const newLoan = await prisma.loan.create({
            data: {
                lenderId,
                clientName,
                clientPhone,
                clientAddress,
                principalAmount: amount,
                interestRate: rate,
                totalToRepay,
                balanceRemaining: totalToRepay,
                installments,
                installmentAmount,
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
router.post('/:id/repayments', authenticateToken, async (req: any, res: any) => {
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
router.get('/', authenticateToken, async (req: any, res: any) => {
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
