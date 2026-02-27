import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const router = express.Router();

/**
 * 🔒 MIDDLEWARE: Validación de Permisos HR
 * Solo Owners o Managers pueden ejecutar acciones críticas de RRHH.
 */
const requireHRAdmin = (req: any, res: any, next: any) => {
    const authReq = req as AuthRequest;
    if (!['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(authReq.role || '')) {
        return res.status(403).json({ error: 'Permisos insuficientes para RRHH.' });
    }
    next();
};

// ==========================================
// 🕒 TERMINAL DE ASISTENCIA (CLOCK IN/OUT)
// ==========================================

router.post('/clock-in', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { pin } = req.body; // El cajero/empleado digita su PIN en la tablet

    try {
        const employee = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, pin, status: 'ACTIVE' }
        });

        if (!employee) return res.status(400).json({ error: 'PIN inválido o empleado inactivo.' });

        // Ver si ya tiene turno abierto hoy
        const activeShift = await prisma.shift.findFirst({
            where: { tenantId: authReq.tenantId, employeeId: employee.id, status: 'ONGOING' }
        });

        if (activeShift) return res.status(400).json({ error: 'Ya tienes un turno activo.' });

        // En Nortex el Shift es dual (Caja y Asistencia). Creamos turno de asistencia por ahora.
        // Si es cajero, `POS` requiere initialCash, pero para HR, esto es solo "Clock In".
        // Usamos una convención status='ONGOING'
        const shift = await prisma.shift.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                employeeId: employee.id,
                initialCash: 0,
                status: 'ONGOING',
                startTime: new Date()
            }
        });

        res.json({ message: `Turno iniciado para ${employee.firstName}`, shift });
    } catch (error) {
        console.error('ClockIn Error:', error);
        res.status(500).json({ error: 'Error del sistema de asistencia' });
    }
});

router.post('/clock-out', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { pin } = req.body;

    try {
        const employee = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, pin }
        });

        if (!employee) return res.status(400).json({ error: 'PIN inválido.' });

        const activeShift = await prisma.shift.findFirst({
            where: { tenantId: authReq.tenantId, employeeId: employee.id, status: 'ONGOING' }
        });

        if (!activeShift) return res.status(400).json({ error: 'No hay turno abierto para cerrar.' });

        const endTime = new Date();
        const diffMs = endTime.getTime() - new Date(activeShift.startTime).getTime();
        const totalHours = diffMs / (1000 * 60 * 60);

        // NicaLabor: Más de 8h = Horas Extras
        const regularHours = Math.min(8, totalHours);
        const overtimeHours = Math.max(0, totalHours - 8);

        await prisma.shift.update({
            where: { id: activeShift.id },
            data: {
                status: 'COMPLETED',
                endTime,
                regularHours,
                overtimeHours
            }
        });

        res.json({ message: `Turno cerrado. Horas registradas: ${totalHours.toFixed(2)}h` });
    } catch (error) {
        console.error('ClockOut Error:', error);
        res.status(500).json({ error: 'Error al cerrar el turno' });
    }
});

// ==========================================
// 💸 MICRO-LENDING (SALARY ADVANCE)
// ==========================================

router.post('/advance/request', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { amount } = req.body;

    try {
        // Enlazar via userId->Employee
        const employee = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, userId: authReq.userId }
        });

        if (!employee) return res.status(404).json({ error: 'Perfil de empleado no encontrado.' });

        // Validar límite (ej: 30% del salario base)
        const maxAdvance = Number(employee.baseSalary) * 0.30;
        if (amount > maxAdvance) {
            return res.status(400).json({ error: \`El monto excede tu límite permitido de C$ \${maxAdvance}\` });
        }

        const advance = await prisma.salaryAdvance.create({
            data: {
                tenantId: authReq.tenantId!,
                employeeId: employee.id,
                amount,
                fee: amount * 0.05, // 5% flat fee para Nortex/Tenant
                status: 'PENDING'
            }
        });

        res.json({ message: 'Adelanto solicitado exitosamente', advance });
    } catch (error) {
        console.error('Advance Error:', error);
        res.status(500).json({ error: 'Error al solicitar el adelanto' });
    }
});

router.post('/advance/approve', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { advanceId, action } = req.body; // action = APPROVED o REJECTED

    try {
        const advance = await prisma.salaryAdvance.findFirst({
            where: { id: advanceId, tenantId: authReq.tenantId }
        });

        if (!advance || advance.status !== 'PENDING') return res.status(400).json({ error: 'Adelanto inválido o ya procesado.' });

        await prisma.salaryAdvance.update({
            where: { id: advanceId },
            data: { status: action === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
        });

        // NOTA: Si es APPROVED, el cajero procede a darle el dinero. El descuento en nómina se hace después.
        res.json({ message: \`Adelanto \${action === 'APPROVED' ? 'Aprobado' : 'Rechazado'}\` });
    } catch (error) {
        console.error('Advance Approve Error:', error);
        res.status(500).json({ error: 'Error al procesar el adelanto' });
    }
});

// ==========================================
// 🏥 NICALABOR LEAVE MANAGEMENT
// ==========================================

router.post('/leave/request', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { employeeId, type, startDate, endDate } = req.body;

    try {
        const leave = await prisma.leaveRequest.create({
            data: {
                tenantId: authReq.tenantId!,
                employeeId,
                type,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                status: 'APPROVED' // Asumimos que el admin lo creé y lo aprueba de una
            }
        });

        res.json({ message: 'Ausencia registrada correctamente.', leave });
    } catch (error) {
        console.error('Leave Error:', error);
        res.status(500).json({ error: 'Error al registrar la ausencia' });
    }
});

// ==========================================
// 💼 PAYROLL ENGINE (NICALABOR)
// ==========================================

router.post('/payroll/preview', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { periodStart, periodEnd } = req.body;

    try {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);

        const employees = await prisma.employee.findMany({
            where: { tenantId: authReq.tenantId, status: 'ACTIVE' },
            include: {
                salaryAdvances: { where: { status: 'APPROVED' } },
                sales: {
                    where: {
                        createdAt: { gte: start, lte: end },
                        status: 'COMPLETED'
                    }
                }
            }
        });

        const lines = employees.map(emp => {
            const baseSalary = Number(emp.baseSalary); // Simplificado: base completo
            
            // Comisiones dinámicas
            const totalSales = emp.sales.reduce((acc: number, sale: any) => acc + Number(sale.total), 0);
            const commissions = totalSales * (Number(emp.commissionRate) / 100);
            
            const grossPay = baseSalary + commissions;
            const inss = grossPay * 0.07; // 7% INSS Laboral sobre el bruto (salario + comisión)
            // IR Progressivo ignorado para simplificar la demo
            
            const advances = emp.salaryAdvances.reduce((acc: number, adv: any) => acc + Number(adv.amount) + Number(adv.fee), 0);
            
            const netPay = grossPay - inss - advances;

            return {
                employeeId: emp.id,
                name: \`\${emp.firstName} \${emp.lastName}\`,
                basePay: baseSalary,
                commissions,
                totalSales,
                grossPay,
                inssDeduction: inss,
                advancesDeduction: advances,
                netPay
            };
        });

        res.json({ lines });
    } catch (error) {
        console.error('Payroll Preview Error:', error);
        res.status(500).json({ error: 'Error pre-visualizando la nómina' });
    }
});

// ==========================================
// ⚖️ LIQUIDACIÓN LABORAL (TERMINATION)
// ==========================================

router.post('/termination/calculate', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { employeeId, reason, terminationDate } = req.body;

    try {
        const emp = await prisma.employee.findFirst({
            where: { id: employeeId, tenantId: authReq.tenantId }
        });

        if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

        const terminateDt = new Date(terminationDate);
        const hireDt = new Date(emp.hireDate);
        const monthsWorked = (terminateDt.getTime() - hireDt.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        
        const baseMonthly = Number(emp.baseSalary);
        
        let aguinaldo = (baseMonthly / 12) * (monthsWorked % 12);
        let vacaciones = (baseMonthly / 12) * (monthsWorked % 12);
        let antiguedad = reason === 'DISMISSAL' ? (baseMonthly * Math.floor(monthsWorked / 12)) : 0; // Solo en despido (Art. 45)

        const total = aguinaldo + vacaciones + antiguedad;

        res.json({
            detail: {
                monthsWorked: Math.floor(monthsWorked),
                aguinaldo: aguinaldo.toFixed(2),
                vacaciones: vacaciones.toFixed(2),
                antiguedad: antiguedad.toFixed(2),
                total: total.toFixed(2)
            }
        });
    } catch (error) {
        console.error('Termination Error:', error);
        res.status(500).json({ error: 'Error calculando finiquito' });
    }
});

export default router;
