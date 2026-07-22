import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import {
    validate, OriginateLoanSchema, RepaymentSchema, UpdateClientSchema,
    RefinanceLoanSchema, PenaltySchema, VaultDepositSchema, RouteExpenseSchema,
} from '../validation/schemas.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ── Política de roles (Fase 0 blindaje) ──────────────────────────────────────
// Solo el DUEÑO gestiona dinero y cartera: originar, refinanciar, multar,
// asignar cobrador, bloquear cliente/límite y recibir en bóveda.
// El COLLECTOR (motorizado) SOLO puede: registrar abonos y gastos de ruta.
// checkRole deja pasar siempre a OWNER/ADMIN/SUPER_ADMIN; a COLLECTOR lo bloquea.
const LENDER_MANAGER = checkRole(['OWNER', 'ADMIN']);

const router = express.Router();
const prisma = new PrismaClient();

// Alta de cobradores (crea credenciales de login): validación estricta del body.
// Definido inline para no colisionar con backend/schemas.ts (editado en paralelo).
const CreateCollectorSchema = z.object({
    name: z.string().trim().min(1, 'El nombre es obligatorio'),
    email: z.string().trim().email('Correo inválido'),
    password: z
        .string()
        .min(8, 'La contraseña debe tener al menos 8 caracteres')
        .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra')
        .regex(/[0-9]/, 'La contraseña debe incluir al menos un número'),
});

// 1. ORIGINAR UN CRÉDITO (Desembolso) — Motor Dual
router.post('/', authenticate, LENDER_MANAGER, validate(OriginateLoanSchema), async (req: any, res: any) => {
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

        const newLoan = await prisma.$transaction(async (tx) => {
            const loan = await tx.loan.create({
                data: {
                    lenderId,
                    customerId: customer!.id,
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

            // Plan de cuotas (Cobranza B2): n cuotas espaciadas por la frecuencia.
            // La última absorbe el redondeo para que Σ cuotas == totalToRepay.
            const stepDays = freqDays[frequency] || 1;
            const perInstallment = installmentAmount.toDecimalPlaces(2);
            const totalRounded = totalToRepay.toDecimalPlaces(2);
            const base = new Date();
            let acc = new Decimal(0);
            const rows = [];
            for (let i = 1; i <= n; i++) {
                const d = new Date(base);
                d.setDate(d.getDate() + stepDays * i);
                const due = i < n ? perInstallment : totalRounded.minus(acc);
                acc = acc.plus(due);
                rows.push({ loanId: loan.id, number: i, dueDate: d, amountDue: due.toNumber(), status: 'PENDING' });
            }
            await tx.loanInstallment.createMany({ data: rows });

            // Asiento inmutable del desembolso DENTRO de la misma transacción, para que
            // el préstamo nunca quede persistido sin su rastro de auditoría.
            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'LOAN_DISBURSED',
                    details: JSON.stringify({
                        loanId: loan.id,
                        customerId: customer!.id,
                        principal: amount.toString(),
                        totalToRepay: totalToRepay.toString(),
                        installments: n,
                        interestRate: String(interestRate),
                    }),
                },
            });

            return loan;
        });

        res.status(201).json({ success: true, data: newLoan });
    } catch (error: any) {
        console.error('Error originando crédito:', error.message, error.stack);
        res.status(500).json({ success: false, error: 'Error interno del motor financiero: ' + error.message });
    }
});

// 2. REGISTRAR COBRO DIARIO (Para el Motorizado)
router.post('/:id/repayments', authenticate, validate(RepaymentSchema), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { amountPaid, collectedBy, notes, timestamp } = req.body;
        const lenderId = req.tenantId;
        // Monto de pago con decimal.js (nunca parseFloat sobre dinero).
        const payment = new Decimal(amountPaid);
        if (!payment.isFinite() || payment.lessThanOrEqualTo(0)) {
            return res.status(400).json({ success: false, error: 'Monto de pago inválido' });
        }
        const paymentNum = payment.toDecimalPlaces(4).toNumber();

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

        // Aislamiento multi-tenant: el préstamo debe pertenecer a este prestamista.
        const owned = await prisma.loan.findFirst({ where: { id, lenderId } });
        if (!owned) return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

        // No permitir sobrepago: el abono no puede exceder el saldo pendiente (tolerancia de un centavo).
        const saldoActual = new Decimal(owned.balanceRemaining.toString());
        if (payment.greaterThan(saldoActual.plus('0.01'))) {
            return res.status(400).json({ success: false, error: 'El abono excede el saldo pendiente del préstamo' });
        }

        // Transacción Atómica: Registramos el pago y bajamos el saldo en la misma operación
        const transaction = await prisma.$transaction(async (tx) => {
            // 1. Crear el recibo de pago
            const repayment = await tx.repayment.create({
                data: {
                    loanId: id,
                    amountPaid: paymentNum,
                    collectedBy,
                    notes,
                    // Usamos el timestamp si vino y es válido, si no, el default (now)
                    paymentDate: timestamp ? new Date(timestamp) : undefined
                }
            });

            // 2. Bajar el saldo con guarda atómica anti-sobrepago (concurrencia):
            //    solo decrementa si el saldo aún alcanza; si otra transacción ya lo
            //    dejó corto, count === 0 y abortamos sin dejar el saldo negativo.
            const dec = await tx.loan.updateMany({
                where: { id, lenderId, balanceRemaining: { gte: paymentNum - 0.01 } },
                data: { balanceRemaining: { decrement: paymentNum } }
            });
            if (dec.count === 0) {
                throw new Error('El abono excede el saldo pendiente');
            }
            const afterDec = await tx.loan.findFirst({ where: { id, lenderId } });
            if (!afterDec) throw new Error('Préstamo no encontrado');

            // 3. Si el saldo queda en ~0, fijarlo en 0 exacto y marcar liquidado.
            const updatedLoan = new Decimal(afterDec.balanceRemaining.toString()).lessThanOrEqualTo('0.01')
                ? await tx.loan.update({
                    where: { id },
                    data: { balanceRemaining: 0, status: 'PAID_OFF' }
                })
                : afterDec;

            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'LOAN_PAYMENT',
                    details: JSON.stringify({
                        loanId: id,
                        amountPaid: payment.toString(),
                        balanceBefore: owned.balanceRemaining.toString(),
                        balanceAfter: updatedLoan.balanceRemaining.toString(),
                        collectedBy: collectedBy ?? null,
                    }),
                },
            });
            // 4. Imputar el abono a las cuotas, más antiguas primero (Cobranza B2).
            let remaining = new Decimal(paymentNum);
            const pendientes = await tx.loanInstallment.findMany({
                where: { loanId: id, status: { not: 'PAID' } },
                orderBy: { number: 'asc' }
            });
            for (const cuota of pendientes) {
                if (remaining.lessThanOrEqualTo(0)) break;
                const due  = new Decimal(cuota.amountDue.toString());
                const paid = new Decimal(cuota.amountPaid.toString());
                const falta = due.minus(paid);
                if (falta.lessThanOrEqualTo(0)) continue;
                const aplica = Decimal.min(remaining, falta);
                const nuevoPaid = paid.plus(aplica);
                await tx.loanInstallment.update({
                    where: { id: cuota.id },
                    data: {
                        amountPaid: nuevoPaid.toNumber(),
                        status: nuevoPaid.greaterThanOrEqualTo(due) ? 'PAID' : 'PARTIAL'
                    }
                });
                remaining = remaining.minus(aplica);
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
        if (req.role === 'COLLECTOR') {
            whereClause.assignedToId = req.userId;
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
                },
                schedule: { where: { status: { not: 'PAID' } }, orderBy: { number: 'asc' } }
            }
        });

        // Enriquecer con próxima cuota y mora (Cobranza B2).
        const now = new Date();
        const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const r2 = (x: number) => Math.round(x * 100) / 100;
        const data = loans.map((l: any) => {
            let overdueAmount = 0, overdueCount = 0;
            let nextDueDate: Date | null = null, nextDueAmount = 0;
            for (const c of l.schedule) {
                const falta = Number(c.amountDue) - Number(c.amountPaid);
                if (falta <= 0.001) continue;
                if (new Date(c.dueDate) < hoy) { overdueAmount += falta; overdueCount++; }
                if (!nextDueDate) { nextDueDate = c.dueDate; nextDueAmount = falta; }
            }
            const earliest = l.schedule.find((c: any) => Number(c.amountDue) - Number(c.amountPaid) > 0.001);
            const daysOverdue = earliest && new Date(earliest.dueDate) < hoy
                ? Math.floor((hoy.getTime() - new Date(earliest.dueDate).getTime()) / 86400000) : 0;
            const { schedule, ...rest } = l;
            return { ...rest, nextDueDate, nextDueAmount: r2(nextDueAmount), overdueAmount: r2(overdueAmount), overdueCount, daysOverdue };
        });

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo cartera:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo la cartera' });
    }
});

// 3.C PLAN DE CUOTAS + mora de un préstamo (Cobranza B2)
router.get('/:id/schedule', authenticate, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const lenderId = req.tenantId;
        const loan = await prisma.loan.findFirst({ where: { id, lenderId } });
        if (!loan) return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

        const cuotas = await prisma.loanInstallment.findMany({ where: { loanId: id }, orderBy: { number: 'asc' } });
        const now = new Date();
        const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const data = cuotas.map((c) => {
            const falta = Number(c.amountDue) - Number(c.amountPaid);
            const overdue = falta > 0.001 && new Date(c.dueDate) < hoy;
            const daysOverdue = overdue ? Math.floor((hoy.getTime() - new Date(c.dueDate).getTime()) / 86400000) : 0;
            return {
                id: c.id, number: c.number, dueDate: c.dueDate,
                amountDue: Number(c.amountDue), amountPaid: Number(c.amountPaid),
                balance: Math.round(falta * 100) / 100,
                status: c.status === 'PAID' ? 'PAID' : overdue ? 'OVERDUE' : c.status === 'PARTIAL' ? 'PARTIAL' : 'PENDING',
                daysOverdue
            };
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo plan de cuotas:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo el plan de cuotas' });
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
router.patch('/clients/:clientId', authenticate, LENDER_MANAGER, validate(UpdateClientSchema), async (req: any, res: any) => {
    try {
        const { clientId } = req.params;
        const { isBlocked, creditLimit } = req.body;
        const lenderId = req.tenantId;
        // Aislamiento multi-tenant: solo actualiza si el cliente es de este prestamista.
        const result = await prisma.customer.updateMany({
            where: { id: clientId, tenantId: lenderId },
            data: {
                ...(isBlocked !== undefined && { isBlocked }),
                ...(creditLimit !== undefined && { creditLimit: parseFloat(creditLimit) })
            }
        });
        if (result.count === 0) return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
        const updated = await prisma.customer.findFirst({ where: { id: clientId, tenantId: lenderId } });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error actualizando cliente' });
    }
});

// 4. REGISTRAR GASTO DE RUTA (Motorizado)
router.post('/route-expenses', authenticate, validate(RouteExpenseSchema), async (req: any, res: any) => {
    try {
        const { amount, description, collectedBy } = req.body;
        const lenderId = req.tenantId;

        // Salida de efectivo (baja el arqueo del motorizado): se persiste junto con su
        // asiento inmutable en la misma transacción para no perder la traza (Capa 3).
        const expense = await prisma.$transaction(async (tx) => {
            const created = await tx.routeExpense.create({
                data: {
                    lenderId,
                    collectedBy: collectedBy || 'MOTO-01',
                    amount: parseFloat(amount),
                    description
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'ROUTE_EXPENSE',
                    details: JSON.stringify({
                        expenseId: created.id,
                        collectedBy: created.collectedBy,
                        amount: String(amount),
                        description: description ?? null,
                    }),
                },
            });

            return created;
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
router.post('/:id/refinance', authenticate, LENDER_MANAGER, validate(RefinanceLoanSchema), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { newPrincipal, interestRate, installments, frequency, type } = req.body;
        const lenderId = req.tenantId;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Obtener el préstamo viejo
            // Aislamiento multi-tenant: el préstamo debe pertenecer a este prestamista.
            const oldLoan = await tx.loan.findFirst({ where: { id, lenderId } });
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

            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'LOAN_REFINANCED',
                    details: JSON.stringify({
                        oldLoanId: oldLoan.id,
                        newLoanId: newLoan.id,
                        carryOver: carryOver.toString(),
                        freshCapital: freshCapital.toString(),
                        newTotalToRepay: totalToRepay.toString(),
                    }),
                },
            });
            // Plan de cuotas del préstamo refinanciado (Cobranza B2).
            const stepDays = freqDays[frequency] || 1;
            const perInstallment = installmentAmount.toDecimalPlaces(2);
            const totalRounded = totalToRepay.toDecimalPlaces(2);
            const base = new Date();
            let acc = new Decimal(0);
            const rows = [];
            for (let i = 1; i <= n; i++) {
                const d = new Date(base);
                d.setDate(d.getDate() + stepDays * i);
                const due = i < n ? perInstallment : totalRounded.minus(acc);
                acc = acc.plus(due);
                rows.push({ loanId: newLoan.id, number: i, dueDate: d, amountDue: due.toNumber(), status: 'PENDING' });
            }
            await tx.loanInstallment.createMany({ data: rows });

            return { oldLoan, newLoan, carryOver: carryOver.toNumber(), freshCapital: freshCapital.toNumber() };
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Error refinanciando:', error);
        res.status(500).json({ success: false, error: 'Error en el refinanciamiento' });
    }
});

// APLICAR PENALIDAD A UN PRÉSTAMO
router.post('/:id/penalty', authenticate, LENDER_MANAGER, validate(PenaltySchema), async (req: any, res: any) => {
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
                    collectedBy: req.email || 'Sistema',
                    notes: `Penalidad / Multa: ${reason || 'Atraso'}`
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'LOAN_PENALTY',
                    details: JSON.stringify({
                        loanId: id,
                        penaltyAmount: String(amount),
                        balanceBefore: loan.balanceRemaining.toString(),
                        balanceAfter: updatedLoan.balanceRemaining.toString(),
                        reason: reason ?? null,
                    }),
                },
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
router.post('/collectors', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateCollectorSchema), async (req: any, res: any) => {
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

// 9.B LISTAR COBRADORES (Fase 2 H5 — el dropdown de asignación lo llamaba y no existía)
router.get('/collectors', authenticate, LENDER_MANAGER, async (req: any, res: any) => {
    try {
        const lenderId = req.tenantId;
        // Solo usuarios COLLECTOR de este prestamista (aislamiento por tenant).
        const collectors = await prisma.user.findMany({
            where: { tenantId: lenderId, role: 'COLLECTOR' },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        res.json({ success: true, data: collectors });
    } catch (error) {
        console.error('Error listando cobradores:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo los cobradores' });
    }
});

// 9. ASIGNAR COBRADOR A UN PRÉSTAMO (Cobranza A3 — botón del dashboard que hoy falla)
router.patch('/:id/assign', authenticate, LENDER_MANAGER, async (req: any, res: any) => {
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
router.post('/vault/deposit', authenticate, LENDER_MANAGER, validate(VaultDepositSchema), async (req: any, res: any) => {
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

        // Manejo de efectivo: el depósito y su asiento inmutable se escriben atómicamente
        // en la misma transacción (Capa 3), para que nunca quede uno sin el otro.
        const deposit = await prisma.$transaction(async (tx) => {
            const created = await tx.collectorDeposit.create({
                data: {
                    lenderId,
                    collectorId: collectorId || null,
                    collectorName,
                    amount: amt,
                    notes: notes || null,
                    receivedBy: req.userId
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: lenderId,
                    userId: req.userId,
                    action: 'VAULT_DEPOSIT',
                    details: JSON.stringify({
                        depositId: created.id,
                        collectorId: collectorId ?? null,
                        amount: String(amt),
                    }),
                },
            });

            return created;
        });

        res.status(201).json({ success: true, data: deposit });
    } catch (error) {
        console.error('Error registrando depósito a bóveda:', error);
        res.status(500).json({ success: false, error: 'Error registrando el depósito' });
    }
});

export default router;
