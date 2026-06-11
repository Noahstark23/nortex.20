/**
 * NORTEX - Motor de Nómina Nicaragüense
 * Ley 185 - Código del Trabajo de Nicaragua
 * Ley 539 - Ley de Seguridad Social
 *
 * Tasas vigentes 2024-2025:
 * - INSS Laboral: 7%
 * - INSS Patronal: 22.5%
 * - INATEC: 2%
 * - IR: Tabla progresiva DGI
 *
 * Precisión: Decimal.js con ROUND_HALF_UP (norma DGI)
 */

import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ==========================================
// CONSTANTES LEGALES NICARAGUA
// ==========================================

const INSS_LABORAL_RATE   = new Decimal('0.07');    // 7%  (Ley 539, Art. 85)
const INSS_PATRONAL_RATE  = new Decimal('0.225');   // 22.5% (Ley 539)
const INATEC_RATE         = new Decimal('0.02');    // 2% (Ley 40)
const TECHO_INSS_MENSUAL  = new Decimal('132071.43'); // Techo INSS mensual 2024 (C$)

// Tabla progresiva IR anual vigente DGI Nicaragua — Reformas tributarias 2025
const IR_TABLE = [
    { from: new Decimal('0'),         to: new Decimal('100000'),   rate: new Decimal('0'),    base: new Decimal('0') },
    { from: new Decimal('100000.01'), to: new Decimal('200000'),   rate: new Decimal('0.15'), base: new Decimal('0') },
    { from: new Decimal('200000.01'), to: new Decimal('350000'),   rate: new Decimal('0.20'), base: new Decimal('15000') },
    { from: new Decimal('350000.01'), to: new Decimal('500000'),   rate: new Decimal('0.25'), base: new Decimal('45000') },
    { from: new Decimal('500000.01'), to: new Decimal('Infinity'), rate: new Decimal('0.30'), base: new Decimal('82500') },
];

// ==========================================
// INTERFACES
// ==========================================

export interface PayrollCalculation {
    // Ingresos
    grossSalary: number;
    commissions: number;
    totalIncome: number;

    // Deducciones de Ley
    inssLaboral: number;
    irLaboral: number;
    totalDeductions: number;

    // Neto
    netSalary: number;

    // Aportes Patronales (costo empresa)
    inssPatronal: number;
    inatec: number;
    totalCostoEmpresa: number;

    // Informativo
    salarioAnualProyectado: number;
    irAnualProyectado: number;
}

export interface LaborLiability {
    employeeId: string;
    employeeName: string;
    hireDate: Date;
    monthsWorked: number;

    // Pasivos
    vacacionesPendientes: number;    // Días * salario diario
    aguinaldoAcumulado: number;      // Proporcional del treceavo mes
    indemnizacion: number;           // Antigüedad (1 mes por año, max 5)
    totalPasivo: number;
}

// ==========================================
// MOTOR DE CÁLCULO
// ==========================================

/**
 * Calcula la nómina completa de un empleado según leyes nicaragüenses.
 * @param baseSalary Salario base mensual
 * @param commissions Comisiones del periodo
 * @returns Desglose completo de nómina
 */
export function calculatePayroll(
    baseSalary: number,
    commissions: number = 0,
    opts?: { inssPatronalRate?: number }
): PayrollCalculation {
    const dBase = new Decimal(baseSalary);
    const dComm = new Decimal(commissions);
    const totalIncome = dBase.plus(dComm);
    // B4: INSS patronal parametrizable (21.5% <50 emp · 22.5% ≥50). Default legal.
    const inssPatronalRate = opts?.inssPatronalRate != null ? new Decimal(opts.inssPatronalRate) : INSS_PATRONAL_RATE;

    // 1. INSS Laboral (7%) - con techo
    const baseINSS = Decimal.min(totalIncome, TECHO_INSS_MENSUAL);
    const inssLaboral = baseINSS.mul(INSS_LABORAL_RATE).toDecimalPlaces(4);

    // 2. IR Laboral (tabla progresiva)
    // Proyectar ingreso anual neto de INSS
    const ingresoMensualNetoINSS = totalIncome.minus(inssLaboral);
    const salarioAnualProyectado = ingresoMensualNetoINSS.mul(12);

    let irAnual = new Decimal(0);
    for (const tramo of IR_TABLE) {
        if (salarioAnualProyectado.greaterThanOrEqualTo(tramo.from)) {
            if (salarioAnualProyectado.lessThanOrEqualTo(tramo.to)) {
                const fromAdj = tramo.from.greaterThan(0) ? tramo.from.minus('0.01') : new Decimal(0);
                irAnual = tramo.base.plus(salarioAnualProyectado.minus(fromAdj).mul(tramo.rate));
                break;
            }
        }
    }

    const irLaboral = irAnual.dividedBy(12).toDecimalPlaces(4);

    // 3. Total Deducciones
    const totalDeductions = inssLaboral.plus(irLaboral).toDecimalPlaces(4);

    // 4. Neto a Recibir
    const netSalary = totalIncome.minus(totalDeductions).toDecimalPlaces(4);

    // 5. Aportes Patronales (costo para el empleador)
    const inssPatronal = baseINSS.mul(inssPatronalRate).toDecimalPlaces(4);
    const inatec       = totalIncome.mul(INATEC_RATE).toDecimalPlaces(4);
    const totalCostoEmpresa = totalIncome.plus(inssPatronal).plus(inatec).toDecimalPlaces(4);

    return {
        grossSalary:            dBase.toNumber(),
        commissions:            dComm.toNumber(),
        totalIncome:            totalIncome.toNumber(),
        inssLaboral:            inssLaboral.toNumber(),
        irLaboral:              irLaboral.toNumber(),
        totalDeductions:        totalDeductions.toNumber(),
        netSalary:              netSalary.toNumber(),
        inssPatronal:           inssPatronal.toNumber(),
        inatec:                 inatec.toNumber(),
        totalCostoEmpresa:      totalCostoEmpresa.toNumber(),
        salarioAnualProyectado: salarioAnualProyectado.toNumber(),
        irAnualProyectado:      irAnual.toNumber(),
    };
}

/**
 * Calcula el pasivo laboral de un empleado (Aguinaldo, Vacaciones, Indemnización).
 * Según Ley 185 del Código del Trabajo de Nicaragua.
 */
export function calculateLaborLiability(
    employeeId: string,
    employeeName: string,
    hireDate: Date,
    baseSalary: number
): LaborLiability {
    const now = new Date();
    const diffMs = now.getTime() - new Date(hireDate).getTime();
    const monthsWorked = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44)));
    const yearsWorked  = new Decimal(monthsWorked).dividedBy(12);

    const dBase = new Decimal(baseSalary);
    const salarioDiario = dBase.dividedBy(30);

    // Vacaciones: 15 días por cada 6 meses trabajados (2.5 días/mes)
    const diasVacaciones = Decimal.min(new Decimal(monthsWorked).mul('2.5'), 30);
    const vacacionesPendientes = diasVacaciones.mul(salarioDiario).toDecimalPlaces(4);

    // Aguinaldo (Treceavo Mes): Proporcional al tiempo trabajado en el año
    const mesEnAnio = now.getMonth(); // 0-11
    const aguinaldoProporcional = dBase.dividedBy(12).mul(mesEnAnio + 1);
    const aguinaldoAcumulado    = aguinaldoProporcional.toDecimalPlaces(4);

    // Indemnización por antigüedad: 1 mes por año trabajado (máximo 5 meses)
    const aniosIndemnizacion = Decimal.min(yearsWorked.floor(), 5);
    const fraccion           = yearsWorked.minus(yearsWorked.floor());
    const indemnizacion      = aniosIndemnizacion.plus(fraccion).mul(dBase).toDecimalPlaces(4);

    const totalPasivo = vacacionesPendientes.plus(aguinaldoAcumulado).plus(indemnizacion).toDecimalPlaces(4);

    return {
        employeeId,
        employeeName,
        hireDate,
        monthsWorked,
        vacacionesPendientes: vacacionesPendientes.toNumber(),
        aguinaldoAcumulado:   aguinaldoAcumulado.toNumber(),
        indemnizacion:        indemnizacion.toNumber(),
        totalPasivo:          totalPasivo.toNumber(),
    };
}
