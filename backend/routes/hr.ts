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
            return res.status(400).json({ error: `El monto excede tu límite permitido de C$ ${maxAdvance}` });
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
        res.json({ message: `Adelanto ${action === 'APPROVED' ? 'Aprobado' : 'Rechazado'}` });
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
    const { employeeId, type, startDate, endDate, reason } = req.body;

    if (!employeeId || !type || !startDate || !endDate) {
        return res.status(400).json({ error: 'Empleado, tipo y fechas son requeridos.' });
    }
    if (new Date(endDate) < new Date(startDate)) {
        return res.status(400).json({ error: 'La fecha final no puede ser anterior a la inicial.' });
    }

    try {
        // Anti-IDOR: el empleado debe pertenecer al tenant del token.
        const emp = await prisma.employee.findFirst({
            where: { id: employeeId, tenantId: authReq.tenantId! },
            select: { id: true },
        });
        if (!emp) return res.status(404).json({ error: 'Empleado no encontrado.' });

        // Días calendario de la ausencia (inclusivo).
        const dias = Math.max(1, Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);

        const leave = await prisma.$transaction(async (tx) => {
            const created = await tx.leaveRequest.create({
                data: {
                    tenantId: authReq.tenantId!,
                    employeeId,
                    type,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    reason: reason || null,
                    status: 'APPROVED' // El admin lo registra y aprueba de una
                }
            });
            // Goce de vacaciones: descuenta del saldo acumulado (Art. 76).
            if (type === 'VACATION') {
                await tx.employee.update({
                    where: { id: employeeId },
                    data: { vacationDays: { decrement: dias } },
                });
            }
            return created;
        });

        res.json({ message: 'Ausencia registrada correctamente.', leave });
    } catch (error) {
        console.error('Leave Error:', error);
        res.status(500).json({ error: 'Error al registrar la ausencia' });
    }
});

// GET /api/hr/leaves — Lista de ausencias del tenant (para la pestaña RRHH).
router.get('/leaves', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const leaves = await prisma.leaveRequest.findMany({
            where: { tenantId: authReq.tenantId! },
            include: { employee: { select: { firstName: true, lastName: true } } },
            orderBy: { startDate: 'desc' },
        });
        res.json(leaves);
    } catch (error) {
        console.error('Leaves list error:', error);
        res.status(500).json({ error: 'Error al obtener las ausencias' });
    }
});

// ==========================================
// 💼 NÓMINA Y LIQUIDACIÓN — motor único (nicaLabor.ts)
// ==========================================
// Los endpoints demo `/payroll/preview` (ignoraba el IR) y `/termination/calculate`
// (indemnización sin tope, ilegal) se eliminaron (Fase A): producían cifras que
// contradecían al motor real. Fuentes únicas de verdad:
//   · Nómina:      POST /api/payroll/calculate           (server.ts → calculatePayroll)
//   · Liquidación: GET  /api/hrm/settlement-preview/:id   (server.ts → calculateLaborLiability)

// ==========================================
// 📁 EXPEDIENTE DIGITAL — Contratos (Art. 19-28 Ley 185)
// ==========================================

// GET /api/hr/employees/:id/file — expediente del colaborador (datos + contratos + alertas)
router.get('/employees/:id/file', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const emp = await prisma.employee.findFirst({
            where: { id: req.params.id, tenantId: authReq.tenantId! },
            include: { contracts: { orderBy: { startDate: 'desc' } } },
        });
        if (!emp) return res.status(404).json({ error: 'Empleado no encontrado.' });

        const now = new Date();
        const DAY = 86400000;
        const alertas: string[] = [];
        const activo = emp.contracts.find((c: any) => c.status === 'ACTIVE') || emp.contracts[0];
        if (!activo) {
            alertas.push('Sin contrato registrado — el MITRAB exige contrato escrito.');
        } else {
            if (activo.endDate) {
                const dias = Math.ceil((new Date(activo.endDate).getTime() - now.getTime()) / DAY);
                if (dias < 0) alertas.push(`El contrato venció hace ${Math.abs(dias)} día(s).`);
                else if (dias <= 30) alertas.push(`El contrato vence en ${dias} día(s).`);
            }
            if (activo.probationEnd) {
                const dias = Math.ceil((new Date(activo.probationEnd).getTime() - now.getTime()) / DAY);
                if (dias >= 0 && dias <= 7) alertas.push(`El período de prueba termina en ${dias} día(s).`);
            }
        }
        const meses = Math.max(0, Math.floor((now.getTime() - new Date(emp.hireDate).getTime()) / (DAY * 30.44)));

        res.json({
            employee: {
                id: emp.id,
                name: `${emp.firstName} ${emp.lastName}`,
                cedula: emp.cedula,
                inss: emp.inss,
                phone: emp.phone,
                role: emp.role,
                baseSalary: Number(emp.baseSalary),
                hireDate: emp.hireDate,
                status: emp.status,
                vacationDays: emp.vacationDays,
                bankAccount: emp.bankAccount,
                antiguedadTexto: `${Math.floor(meses / 12)} año(s) ${meses % 12} mes(es)`,
            },
            contracts: emp.contracts.map((c: any) => ({
                id: c.id, type: c.type, startDate: c.startDate, endDate: c.endDate,
                probationEnd: c.probationEnd, salary: Number(c.salary), position: c.position,
                status: c.status, createdAt: c.createdAt,
            })),
            alertas,
        });
    } catch (error) {
        console.error('Expediente error:', error);
        res.status(500).json({ error: 'Error al obtener el expediente.' });
    }
});

// POST /api/hr/employees/:id/contract — registrar un contrato (cierra el anterior)
router.post('/employees/:id/contract', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { type, startDate, endDate, probationEnd, salary, position, notes } = req.body;
    if (!type || !startDate || salary == null) {
        return res.status(400).json({ error: 'Tipo, fecha de inicio y salario son requeridos.' });
    }
    if (!['INDETERMINADO', 'DETERMINADO', 'POR_OBRA'].includes(type)) {
        return res.status(400).json({ error: 'Tipo de contrato inválido.' });
    }
    try {
        const emp = await prisma.employee.findFirst({
            where: { id: req.params.id, tenantId: authReq.tenantId! },
            select: { id: true },
        });
        if (!emp) return res.status(404).json({ error: 'Empleado no encontrado.' });

        const contract = await prisma.$transaction(async (tx) => {
            // El contrato nuevo pasa a ser el vigente; los anteriores se cierran.
            await tx.employmentContract.updateMany({
                where: { employeeId: emp.id, tenantId: authReq.tenantId!, status: 'ACTIVE' },
                data: { status: 'ENDED' },
            });
            return tx.employmentContract.create({
                data: {
                    tenantId: authReq.tenantId!,
                    employeeId: emp.id,
                    type,
                    startDate: new Date(startDate),
                    endDate: endDate ? new Date(endDate) : null,
                    probationEnd: probationEnd ? new Date(probationEnd) : null,
                    salary: Number(salary),
                    position: position || null,
                    notes: notes || null,
                    status: 'ACTIVE',
                    createdBy: authReq.userId!,
                },
            });
        });
        res.json({ message: 'Contrato registrado.', contract });
    } catch (error) {
        console.error('Contract create error:', error);
        res.status(500).json({ error: 'Error al registrar el contrato.' });
    }
});

export default router;
