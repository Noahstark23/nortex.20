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

// Domingo de Pascua (algoritmo gregoriano) — para Jueves/Viernes Santo.
function easterSunday(year: number): Date {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

// Siembra idempotente de los feriados nacionales de Nicaragua para un año.
async function ensureNationalHolidays(tenantId: string, year: number): Promise<void> {
    const easter = easterSunday(year);
    const jueves = new Date(easter); jueves.setUTCDate(jueves.getUTCDate() - 3);
    const viernes = new Date(easter); viernes.setUTCDate(viernes.getUTCDate() - 2);
    const fechas = [
        { date: new Date(Date.UTC(year, 0, 1)), name: 'Año Nuevo' },
        { date: jueves, name: 'Jueves Santo' },
        { date: viernes, name: 'Viernes Santo' },
        { date: new Date(Date.UTC(year, 4, 1)), name: 'Día del Trabajo' },
        { date: new Date(Date.UTC(year, 6, 19)), name: 'Día de la Revolución' },
        { date: new Date(Date.UTC(year, 8, 14)), name: 'Batalla de San Jacinto' },
        { date: new Date(Date.UTC(year, 8, 15)), name: 'Independencia' },
        { date: new Date(Date.UTC(year, 11, 8)), name: 'Purísima Concepción' },
        { date: new Date(Date.UTC(year, 11, 25)), name: 'Navidad' },
    ];
    await prisma.holiday.createMany({
        data: fechas.map(f => ({ tenantId, date: f.date, name: f.name, national: true })),
        skipDuplicates: true,
    });
}

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
            include: {
                contracts: { orderBy: { startDate: 'desc' } },
                judicialDeductions: { where: { status: 'ACTIVE' }, orderBy: { priority: 'asc' } },
            },
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
            judicialDeductions: emp.judicialDeductions.map((j: any) => ({
                id: j.id, type: j.type, amount: j.amount != null ? Number(j.amount) : null,
                percentage: j.percentage, beneficiary: j.beneficiary, priority: j.priority, startDate: j.startDate,
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

// ==========================================
// ⚖️ DEDUCCIONES JUDICIALES — pensión alimenticia / embargos (Art. 88 Ley 185)
// ==========================================

// POST /api/hr/employees/:id/judicial — registrar una deducción judicial recurrente
router.post('/employees/:id/judicial', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { type, amount, percentage, beneficiary, priority } = req.body;
    if (!['PENSION_ALIMENTICIA', 'EMBARGO', 'OTRO'].includes(type)) {
        return res.status(400).json({ error: 'Tipo de deducción inválido.' });
    }
    const montoNum = amount != null && amount !== '' ? Number(amount) : null;
    const pctNum = percentage != null && percentage !== '' ? Number(percentage) : null;
    if ((montoNum == null || montoNum <= 0) && (pctNum == null || pctNum <= 0)) {
        return res.status(400).json({ error: 'Indique un monto fijo o un porcentaje mayor a cero.' });
    }
    if (pctNum != null && pctNum > 100) {
        return res.status(400).json({ error: 'El porcentaje no puede superar 100%.' });
    }
    try {
        const emp = await prisma.employee.findFirst({
            where: { id: req.params.id, tenantId: authReq.tenantId! },
            select: { id: true },
        });
        if (!emp) return res.status(404).json({ error: 'Empleado no encontrado.' });

        const deduction = await prisma.judicialDeduction.create({
            data: {
                tenantId: authReq.tenantId!,
                employeeId: emp.id,
                type,
                amount: montoNum,
                percentage: pctNum,
                beneficiary: beneficiary || null,
                // La pensión alimenticia tiene prioridad legal sobre el embargo.
                priority: priority != null ? Number(priority) : (type === 'PENSION_ALIMENTICIA' ? 1 : 2),
                createdBy: authReq.userId!,
            },
        });
        res.json({ message: 'Deducción judicial registrada.', deduction });
    } catch (error) {
        console.error('Judicial create error:', error);
        res.status(500).json({ error: 'Error al registrar la deducción.' });
    }
});

// PATCH /api/hr/judicial/:id/end — finalizar una deducción judicial
router.patch('/judicial/:id/end', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // Anti-IDOR: solo deducciones del tenant del token.
        const result = await prisma.judicialDeduction.updateMany({
            where: { id: req.params.id, tenantId: authReq.tenantId!, status: 'ACTIVE' },
            data: { status: 'ENDED', endDate: new Date() },
        });
        if (result.count === 0) return res.status(404).json({ error: 'Deducción no encontrada o ya finalizada.' });
        res.json({ message: 'Deducción finalizada.' });
    } catch (error) {
        console.error('Judicial end error:', error);
        res.status(500).json({ error: 'Error al finalizar la deducción.' });
    }
});

// ==========================================
// 📅 FERIADOS — calendario editable (Art. 66 Ley 185)
// ==========================================

// GET /api/hr/holidays/:year — feriados del año (siembra los nacionales)
router.get('/holidays/:year', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = parseInt(req.params.year);
    if (isNaN(year)) return res.status(400).json({ error: 'Año inválido.' });
    try {
        await ensureNationalHolidays(authReq.tenantId!, year);
        const holidays = await prisma.holiday.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
            },
            orderBy: { date: 'asc' },
        });
        res.json(holidays.map((h: any) => ({ id: h.id, date: h.date, name: h.name, national: h.national })));
    } catch (error) {
        console.error('Holidays list error:', error);
        res.status(500).json({ error: 'Error al obtener los feriados.' });
    }
});

// POST /api/hr/holidays — agregar un feriado local
router.post('/holidays', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { date, name } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'Fecha y nombre son requeridos.' });
    try {
        const d = new Date(date);
        const dateOnly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const holiday = await prisma.holiday.upsert({
            where: { tenantId_date: { tenantId: authReq.tenantId!, date: dateOnly } },
            create: { tenantId: authReq.tenantId!, date: dateOnly, name, national: false },
            update: { name },
        });
        res.json({ message: 'Feriado agregado.', holiday });
    } catch (error) {
        console.error('Holiday create error:', error);
        res.status(500).json({ error: 'Error al agregar el feriado.' });
    }
});

// DELETE /api/hr/holidays/:id — eliminar un feriado local (los nacionales no)
router.delete('/holidays/:id', authenticate, requireHRAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const result = await prisma.holiday.deleteMany({
            where: { id: req.params.id, tenantId: authReq.tenantId!, national: false },
        });
        if (result.count === 0) return res.status(404).json({ error: 'Feriado no encontrado o es nacional (no se puede borrar).' });
        res.json({ message: 'Feriado eliminado.' });
    } catch (error) {
        console.error('Holiday delete error:', error);
        res.status(500).json({ error: 'Error al eliminar el feriado.' });
    }
});

export default router;
