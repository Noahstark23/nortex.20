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
 */

// ==========================================
// CONSTANTES LEGALES NICARAGUA
// ==========================================

const INSS_LABORAL_RATE = 0.07;      // 7% (Ley 539, Art. 85)
const INSS_PATRONAL_RATE = 0.225;    // 22.5% (Ley 539)
const INATEC_RATE = 0.02;            // 2% (Ley 40)
const TECHO_INSS_MENSUAL = 132071.43; // Techo INSS mensual 2024 (C$)

// Tabla progresiva IR anual vigente DGI Nicaragua
// Reformas tributarias 2025
const IR_TABLE = [
    { from: 0,         to: 100000,    rate: 0,    base: 0 },
    { from: 100000.01, to: 200000,    rate: 0.15, base: 0 },
    { from: 200000.01, to: 350000,    rate: 0.20, base: 15000 },
    { from: 350000.01, to: 500000,    rate: 0.25, base: 45000 },
    { from: 500000.01, to: Infinity,  rate: 0.30, base: 82500 },
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
export function calculatePayroll(baseSalary: number, commissions: number = 0): PayrollCalculation {
    const totalIncome = baseSalary + commissions;

    // 1. INSS Laboral (7%) - con techo
    const baseINSS = Math.min(totalIncome, TECHO_INSS_MENSUAL);
    const inssLaboral = Math.round(baseINSS * INSS_LABORAL_RATE * 100) / 100;

    // 2. IR Laboral (tabla progresiva)
    // Proyectar ingreso anual neto de INSS
    const ingresoMensualNetoINSS = totalIncome - inssLaboral;
    const salarioAnualProyectado = ingresoMensualNetoINSS * 12;
    
    let irAnual = 0;
    for (const tramo of IR_TABLE) {
        if (salarioAnualProyectado >= tramo.from) {
            if (salarioAnualProyectado <= tramo.to) {
                irAnual = tramo.base + (salarioAnualProyectado - (tramo.from > 0 ? tramo.from - 0.01 : 0)) * tramo.rate;
                break;
            }
        }
    }
    
    const irLaboral = Math.round((irAnual / 12) * 100) / 100;

    // 3. Total Deducciones
    const totalDeductions = Math.round((inssLaboral + irLaboral) * 100) / 100;

    // 4. Neto a Recibir
    const netSalary = Math.round((totalIncome - totalDeductions) * 100) / 100;

    // 5. Aportes Patronales (costo para el empleador)
    const inssPatronal = Math.round(baseINSS * INSS_PATRONAL_RATE * 100) / 100;
    const inatec = Math.round(totalIncome * INATEC_RATE * 100) / 100;
    const totalCostoEmpresa = Math.round((totalIncome + inssPatronal + inatec) * 100) / 100;

    return {
        grossSalary: baseSalary,
        commissions,
        totalIncome,
        inssLaboral,
        irLaboral,
        totalDeductions,
        netSalary,
        inssPatronal,
        inatec,
        totalCostoEmpresa,
        salarioAnualProyectado,
        irAnualProyectado: irAnual,
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
    const yearsWorked = monthsWorked / 12;
    
    const salarioDiario = baseSalary / 30;

    // Vacaciones: 15 días por cada 6 meses trabajados (2.5 días/mes)
    const diasVacaciones = Math.min(monthsWorked * 2.5, 30); // max 30 días acumulados
    const vacacionesPendientes = Math.round(diasVacaciones * salarioDiario * 100) / 100;

    // Aguinaldo (Treceavo Mes): Proporcional al tiempo trabajado en el año
    const mesEnAnio = now.getMonth(); // 0-11
    const aguinaldoProporcional = (baseSalary / 12) * (mesEnAnio + 1);
    const aguinaldoAcumulado = Math.round(aguinaldoProporcional * 100) / 100;

    // Indemnización por antigüedad: 1 mes por año trabajado (máximo 5 meses)
    const aniosIndemnizacion = Math.min(Math.floor(yearsWorked), 5);
    const fraccion = yearsWorked - Math.floor(yearsWorked);
    const indemnizacion = Math.round((aniosIndemnizacion + fraccion) * baseSalary * 100) / 100;

    const totalPasivo = Math.round((vacacionesPendientes + aguinaldoAcumulado + indemnizacion) * 100) / 100;

    return {
        employeeId,
        employeeName,
        hireDate,
        monthsWorked,
        vacacionesPendientes,
        aguinaldoAcumulado,
        indemnizacion,
        totalPasivo,
    };
}
