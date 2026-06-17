import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { authenticate } from '../middleware/auth';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const router = express.Router();
const prisma = new PrismaClient();

// 1. ORIGINAR UN CRÉDITO (Desembolso) — Motor Dual
router.post('/', authenticate, async (req: any, res: any) => {
    try {
        const { clientName, clientPhone, clientAddress, principalAmount, interestRate, installments, frequency, type } = req.body;
        const lenderId = req.tenantId;

        const amount = new Decimal(principalAmount);
        const rate   = new Decimal(interestRate).dividedBy(100); // 5% → 0.05
        const n      = parseInt(installments);

        let totalToRepay:     Decimal;
        let installmentAmount: Decimal;

        if (type === 'FORMAL_AMORTIZED') {
            // Sistema Francés: Cuota = Capital * ( i*(1+i)^n ) / ( (1+i)^n - 1 )
            if (rate.isZero()) {
                installmentAmount = amount.dividedBy(n);
            } else {
                const onePlusR = rate.plus(1);
                const pow      = onePlusR.pow(n);
                installmentAmount = amount.mul(rate.mul(pow)).dividedBy(pow.minus(1));
            }
            totalToRepay = installmentAmount.mul(n);
        } else {
            // Gota a Gota (Flat): interés sobre capital total
            totalToRepay     = amount.plus(amount.mul(rate));
            installmentAmount = totalToRepay.dividedBy(n);
        }

        // Calcular fecha de vencimiento según frecuencia
        const dueDate = new Date();
        const freqDays: Record<string, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 15, MONTHLY: 30 };
        dueDate.setDate(dueDate.getDate() + (n * (freqDays[frequency] || 1)));

        // Auto-crear o vincular al cliente CRM
        let customer = await prisma.customer.findFirst({
            where: { tenantId: lenderId, name: clientName }
        });
        if (!customer) {
            customer = await prisma.customer.create({
                data: {
                    tenantId: lenderId,
                    name: clientName,
                    phone: clientPhone || null,
                    address: clientAddress || null
                }
            });
        }
        if (customer.isBlocked) {
            return res.status(403).json({ success: false, error: 'Cliente bloqueado. No se puede originar crédito.' });
        }

        const newLoan = await prisma.loan.create({
            data: {
                lenderId,
                customerId: customer.id,
                clientName,
                clientPhone: clientPhone || null,
                clientAddress: clientAddress || null,
                principalAmount: amount.toDecimalPlaces(4).toNumber(),
                interestRate: new Decimal(interestRate).toNumber(),
                totalToRepay: totalToRepay.toDecimalPlaces(4).toNumber(),
                balanceRemaining: totalToRepay.toDecimalPlaces(4).toNumber(),
                installments: n,
                installmentAmount: installmentAmount.toDecimalPlaces(4).toNumber(),
                frequency: frequency || 'DAILY',
                type: type || 'INFORMAL_FLAT',
                dueDate,
                status: 'ACTIVE'
            }
        });

        res.status(201).json({ success: true, data: newLoan });
    } catch (error: any) {
        console.error('Error originando crédito:', error.message, error.stack);
        res.status(500).json({ success: false, error: 'Error interno del motor financiero: ' + error.message });
    }
});

// 2. REGISTRAR COBRO DIARIO (Para el Motorizado)
router.post('/:id/repayments', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { amountPaid, collectedBy, notes, timestamp } = req.body;
        const payment = parseFloat(amountPaid);

        // Hacking prevention: Offline Clock Validation
        // Si mandan timestamp (modo offline), validar que no tenga más de 48h de desfase
        // con la hora del servidor, previniendo viajes en el tiempo para evitar multas.
        if (timestamp) {
            const clientTime = new Date(timestamp).getTime();
            const serverTime = new Date().getTime();
            const diffHours = Math.abs(serverTime - clientTime) / (1000 * 60 * 60);

            if (diffHours > 48) {
                console.warn(`[FRAUD ALERT] Moto ${collectedBy} intentó un viaje en el tiempo de ${diffHours.toFixed(2)}h`);
                return res.status(400).json({ success: false, error: 'Fecha del dispositivo inválida o excesivamente desfasada. Sincronice el reloj de su celular.' });
            }
        }

        // Transacción Atómica: Registramos el pago y bajamos el saldo en la misma operación
        const transaction = await prisma.$transaction(async (tx) => {
            // 1. Crear el recibo de pago
            const repayment = await tx.repayment.create({
                data: {
                    loanId: id,
                    amountPaid: payment,
                    collectedBy,
                    notes,
                    // Usamos el timestamp si vino y es válido, si no, el default (now)
                    paymentDate: timestamp ? new Date(timestamp) : undefined
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
        const lenderId = req.tenantId;

        // Si es MOTORIZADO, solo ve los asignados a su ID
        const whereClause: any = { lenderId };
        if (req.user?.role === 'COLLECTOR') {
            whereClause.assignedToId = req.user.id;
        }

        // Solo traemos los pagos de "hoy" para el cálculo del Arqueo Diario
        const todayStr = new Date().toISOString().split('T')[0];
        const startOfDay = new Date(todayStr + 'T00:00:00.000Z');
        const endOfDay = new Date(todayStr + 'T23:59:59.999Z');

        const loans = await prisma.loan.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            include: {
                payments: {
                    where: { paymentDate: { gte: startOfDay, lte: endOfDay } },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
        res.json({ success: true, data: loans });
    } catch (error) {
        console.error('Error obteniendo cartera:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo la cartera' });
    }
});

// 3.B OBTENER HISTORIAL DE PAGOS DE UN PRÉSTAMO (Lazy Loading)
router.get('/:id/payments', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const lenderId = req.tenantId;

        // Verificar pertenencia (abierto a moto o lender)
        const loan = await prisma.loan.findFirst({ where: { id, lenderId } });
        if (!loan) return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

        const payments = await prisma.repayment.findMany({
            where: { loanId: id },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('Error obteniendo pagos:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo historial de pagos' });
    }
});

// 7. DIRECTORIO CRM DE CLIENTES
router.get('/clients', authenticate, async (req: any, res: any) => {
    try {
        const lenderId = req.tenantId;
        const clients = await prisma.customer.findMany({
            where: { tenantId: lenderId },
            include: { loans: { select: { id: true, principalAmount: true, balanceRemaining: true, status: true, type: true, createdAt: true, dueDate: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: clients });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo clientes' });
    }
});

// 8. ACTUALIZAR CLIENTE (Bloquear / Cambiar Límite)
router.patch('/clients/:clientId', authenticate, async (req: any, res: any) => {
    try {
        const { clientId } = req.params;
        const { isBlocked, creditLimit } = req.body;
        const updated = await prisma.customer.update({
            where: { id: clientId },
            data: {
                ...(isBlocked !== undefined && { isBlocked }),
                ...(creditLimit !== undefined && { creditLimit: parseFloat(creditLimit) })
            }
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error actualizando cliente' });
    }
});

// 4. REGISTRAR GASTO DE RUTA (Motorizado)
router.post('/route-expenses', authenticate, async (req: any, res: any) => {
    try {
        const { amount, description, collectedBy } = req.body;
        const lenderId = req.tenantId;

        const expense = await prisma.routeExpense.create({
            data: {
                lenderId,
                collectedBy: collectedBy || 'MOTO-01',
                amount: parseFloat(amount),
                description
            }
        });

        res.status(201).json({ success: true, data: expense });
    } catch (error) {
        console.error('Error registrando gasto de ruta:', error);
        res.status(500).json({ success: false, error: 'Error registrando el gasto' });
    }
});

// 5. LISTAR GASTOS DE RUTA (Dashboard del Jefe)
router.get('/route-expenses', authenticate, async (req: any, res: any) => {
    try {
        const lenderId = req.tenantId;
        const expenses = await prisma.routeExpense.findMany({
            where: { lenderId },
            orderBy: { date: 'desc' }
        });
        res.json({ success: true, data: expenses });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo gastos' });
    }
});

// 6. REFINANCIAR PRÉSTAMO (El botón de oro del Jefe)
router.post('/:id/refinance', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { newPrincipal, interestRate, installments, frequency, type } = req.body;
        const lenderId = req.tenantId;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Obtener el préstamo viejo
            const oldLoan = await tx.loan.findUnique({ where: { id } });
            if (!oldLoan) throw new Error('Préstamo no encontrado');

            // 2. Cerrar el préstamo viejo como PAID_OFF (liquidado por refinanciamiento)
            await tx.loan.update({
                where: { id },
                data: { status: 'PAID_OFF' }
            });

            // 3. Calcular nuevo capital = saldo pendiente viejo + capital nuevo
            const carryOver       = new Decimal(oldLoan.balanceRemaining.toString());
            const freshCapital    = new Decimal(newPrincipal);
            const totalNewPrincipal = carryOver.plus(freshCapital);
            const rate = new Decimal(interestRate).dividedBy(100);
            const n    = parseInt(installments);

            let totalToRepay:     Decimal;
            let installmentAmount: Decimal;

            if (type === 'FORMAL_AMORTIZED') {
                if (rate.isZero()) {
                    installmentAmount = totalNewPrincipal.dividedBy(n);
                } else {
                    const onePlusR = rate.plus(1);
                    const pow      = onePlusR.pow(n);
                    installmentAmount = totalNewPrincipal.mul(rate.mul(pow)).dividedBy(pow.minus(1));
                }
                totalToRepay = installmentAmount.mul(n);
            } else {
                totalToRepay      = totalNewPrincipal.plus(totalNewPrincipal.mul(rate));
                installmentAmount = totalToRepay.dividedBy(n);
            }

            const dueDate = new Date();
            const freqDays: Record<string, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 15, MONTHLY: 30 };
            dueDate.setDate(dueDate.getDate() + (n * (freqDays[frequency] || 1)));

            // 4. Crear el préstamo nuevo con el capital combinado
            const newLoan = await tx.loan.create({
                data: {
                    lenderId,
                    clientName: oldLoan.clientName,
                    clientPhone: oldLoan.clientPhone,
                    clientAddress: oldLoan.clientAddress,
                    principalAmount: totalNewPrincipal.toDecimalPlaces(4).toNumber(),
                    interestRate: new Decimal(interestRate).toNumber(),
                    totalToRepay: totalToRepay.toDecimalPlaces(4).toNumber(),
                    balanceRemaining: totalToRepay.toDecimalPlaces(4).toNumber(),
                    installments: n,
                    installmentAmount: installmentAmount.toDecimalPlaces(4).toNumber(),
                    frequency: frequency || oldLoan.frequency,
                    type: type || oldLoan.type,
                    dueDate,
                    status: 'ACTIVE'
                }
            });

            return { oldLoan, newLoan, carryOver: carryOver.toNumber(), freshCapital: freshCapital.toNumber() };
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Error refinanciando:', error);
        res.status(500).json({ success: false, error: 'Error en el refinanciamiento' });
    }
});

// APLICAR PENALIDAD A UN PRÉSTAMO
router.post('/:id/penalty', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { penaltyAmount, reason } = req.body;
        const lenderId = req.tenantId;

        const amount = parseFloat(penaltyAmount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Monto de penalidad inválido' });
        }

        const loan = await prisma.loan.findFirst({ where: { id, lenderId } });
        if (!loan) return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

        const result = await prisma.$transaction(async (tx) => {
            const updatedLoan = await tx.loan.update({
                where: { id },
                data: {
                    balanceRemaining: { increment: amount },
                    totalToRepay: { increment: amount }
                }
            });

            await tx.repayment.create({
                data: {
                    loanId: id,
                    amountPaid: -amount,
                    collectedBy: req.user?.name || 'Sistema',
                    notes: `Penalidad / Multa: ${reason || 'Atraso'}`
                }
            });

            return updatedLoan;
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Error applying penalty:', error);
        res.status(500).json({ success: false, error: 'Error aplicando penalidad' });
    }
});

// 9. CREAR NUEVO MOTORIZADO (Auto-gestión del Prestamista)
router.post('/collectors', authenticate, async (req: any, res: any) => {
    try {
        const { name, email, password } = req.body;
        const lenderId = req.tenantId;

        // Validar que el correo no exista en todo Nortex
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Ese correo ya está registrado.' });
        }

        // Encriptar la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Crear al empleado forzando el rol COLLECTOR y amarrándolo a la bóveda del prestamista
        const newCollector = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: 'COLLECTOR',
                tenantId: lenderId
            }
        });

        res.status(201).json({ success: true, data: { id: newCollector.id, name: newCollector.name } });
    } catch (error: any) {
        console.error('Error creando motorizado:', error.message, error.stack);
        res.status(500).json({ success: false, error: 'Error interno al reclutar cobrador: ' + error.message });
    }
});

// 9. ASIGNAR COBRADOR A UN PRÉSTAMO (Cobranza A3 — botón del dashboard que hoy falla)
router.patch('/:id/assign', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { assignedToId } = req.body;
        const lenderId = req.tenantId;

        // El préstamo debe ser de este prestamista (aislamiento por tenant).
        const loan = await prisma.loan.findFirst({ where: { id, lenderId } });
        if (!loan) return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

        // Si se asigna un cobrador, debe pertenecer al mismo tenant.
        if (assignedToId) {
            const collector = await prisma.user.findFirst({ where: { id: assignedToId, tenantId: lenderId } });
            if (!collector) return res.status(400).json({ success: false, error: 'Cobrador no válido' });
        }

        const updated = await prisma.loan.update({
            where: { id },
            data: { assignedToId: assignedToId || null },
            include: { assignedTo: { select: { id: true, name: true } } }
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('Error asignando cobrador:', error);
        res.status(500).json({ success: false, error: 'Error asignando el cobrador' });
    }
});

// 10. DEPÓSITO A BÓVEDA (Cobranza A3 — entrega de efectivo del cobrador; botón que hoy falla)
router.post('/vault/deposit', authenticate, async (req: any, res: any) => {
    try {
        const { collectorId, amount, notes } = req.body;
        const lenderId = req.tenantId;

        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) {
            return res.status(400).json({ success: false, error: 'El monto debe ser mayor que cero.' });
        }

        let collectorName: string | null = null;
        if (collectorId) {
            const collector = await prisma.user.findFirst({
                where: { id: collectorId, tenantId: lenderId },
                select: { name: true }
            });
            if (!collector) return res.status(400).json({ success: false, error: 'Cobrador no válido' });
            collectorName = collector.name;
        }

        const deposit = await prisma.collectorDeposit.create({
            data: {
                lenderId,
                collectorId: collectorId || null,
                collectorName,
                amount: amt,
                notes: notes || null,
                receivedBy: req.user.id
            }
        });

        res.status(201).json({ success: true, data: deposit });
    } catch (error) {
        console.error('Error registrando depósito a bóveda:', error);
        res.status(500).json({ success: false, error: 'Error registrando el depósito' });
    }
});

export default router;
