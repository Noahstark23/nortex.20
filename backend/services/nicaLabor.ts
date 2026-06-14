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

/**
 * IR anual de la tabla progresiva DGI (rentas del trabajo) sobre una renta neta
 * anual (ya neta de INSS laboral).
 */
function irAnualDeTabla(rentaAnual: Decimal): Decimal {
    for (const tramo of IR_TABLE) {
        if (rentaAnual.greaterThanOrEqualTo(tramo.from) && rentaAnual.lessThanOrEqualTo(tramo.to)) {
            const fromAdj = tramo.from.greaterThan(0) ? tramo.from.minus('0.01') : new Decimal(0);
            return tramo.base.plus(rentaAnual.minus(fromAdj).mul(tramo.rate));
        }
    }
    return new Decimal(0);
}

// ==========================================
// INTERFACES
// ==========================================

export interface PayrollCalculation {
    // Ingresos
    grossSalary: number;
    commissions: number;
    overtimePay: number;   // Horas extra al doble (Art. 62 Ley 185)
    horasExtra: number;    // Cantidad de horas extra del período (informativo)
    totalIncome: number;

    // Deducciones de Ley
    inssLaboral: number;
    irLaboral: number;
    totalDeductions: number;

    // Otros descuentos (no de ley)
    advanceDeduction: number;  // Adelantos de salario a recuperar
    absenceDeduction: number;  // Días de ausencia sin goce de salario
    judicialDeduction: number; // Pensión alimenticia / embargos (Art. 88)

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
    opts?: {
        inssPatronalRate?: number;
        overtimeHours?: number;
        advanceDeduction?: number;
        absenceDeduction?: number;
        irAcumulado?: { mes: number; netoGravablePrevio: number; irRetenidoPrevio: number };
        judicialDeductions?: { amount?: number | null; percentage?: number | null }[];
    }
): PayrollCalculation {
    const dBase = new Decimal(baseSalary);
    const dComm = new Decimal(commissions);

    // Ausencias sin goce: reducen el salario realmente devengado (y con él la
    // base de INSS/IR). Acotado a [0, base].
    const absenceDeduction = Decimal.max(0, Decimal.min(dBase, new Decimal(opts?.absenceDeduction ?? 0)));
    const earnedBase = dBase.minus(absenceDeduction);

    // Horas extra: se pagan al DOBLE de la hora ordinaria (Art. 62 Ley 185).
    // Hora ordinaria = salario mensual / (30 días · 8 h) = base / 240.
    const horasExtra   = new Decimal(opts?.overtimeHours ?? 0);
    const horaOrdinaria = dBase.dividedBy(240);
    const overtimePay  = horasExtra.mul(horaOrdinaria).mul(2).toDecimalPlaces(4);

    const totalIncome = earnedBase.plus(dComm).plus(overtimePay);
    // B4: INSS patronal parametrizable (21.5% <50 emp · 22.5% ≥50). Default legal.
    const inssPatronalRate = opts?.inssPatronalRate != null ? new Decimal(opts.inssPatronalRate) : INSS_PATRONAL_RATE;

    // 1. INSS Laboral (7%) - con techo
    const baseINSS = Decimal.min(totalIncome, TECHO_INSS_MENSUAL);
    const inssLaboral = baseINSS.mul(INSS_LABORAL_RATE).toDecimalPlaces(4);

    // 2. IR Laboral (tabla progresiva DGI sobre la renta neta de INSS)
    const ingresoMensualNetoINSS = totalIncome.minus(inssLaboral);

    let salarioAnualProyectado: Decimal;
    let irAnual: Decimal;
    let irLaboral: Decimal;
    const acc = opts?.irAcumulado;
    if (acc) {
        // Método ACUMULADO DGI: la expectativa anual = renta neta real de los
        // meses ya transcurridos + proyección de los que faltan con el neto del
        // mes actual; la retención del mes salda la diferencia contra lo ya
        // retenido en el año, repartida en los meses que restan. En el último
        // mes cuadra el IR del año sobre la renta real, eliminando el desfase
        // que produce el método ×12 cuando hay comisiones variables.
        const mesesPorVenir = Math.max(0, 12 - acc.mes); // meses después del actual
        salarioAnualProyectado = new Decimal(acc.netoGravablePrevio)
            .plus(ingresoMensualNetoINSS.mul(1 + mesesPorVenir));
        irAnual = irAnualDeTabla(salarioAnualProyectado);
        irLaboral = Decimal.max(
            0,
            irAnual.minus(acc.irRetenidoPrevio).dividedBy(mesesPorVenir + 1)
        ).toDecimalPlaces(4);
    } else {
        // Proyección simple (×12): sin contexto anual (p. ej. previsualización
        // de liquidación). Conserva el comportamiento previo.
        salarioAnualProyectado = ingresoMensualNetoINSS.mul(12);
        irAnual = irAnualDeTabla(salarioAnualProyectado);
        irLaboral = irAnual.dividedBy(12).toDecimalPlaces(4);
    }

    // 3. Total Deducciones
    const totalDeductions = inssLaboral.plus(irLaboral).toDecimalPlaces(4);

    // 3b. Deducciones judiciales (Art. 88): pensión alimenticia / embargos, con
    // prioridad legal. Monto fijo o % del salario disponible (totalIncome − INSS
    // − IR). Acotadas al disponible para no dejar el neto negativo; se aplican en
    // el orden recibido (el caller las ordena por prioridad).
    const baseJudicial = totalIncome.minus(totalDeductions);
    let judicialDeduction = new Decimal(0);
    let remanente = baseJudicial;
    for (const d of (opts?.judicialDeductions ?? [])) {
        const monto = d.amount != null
            ? new Decimal(d.amount)
            : baseJudicial.mul(new Decimal(d.percentage ?? 0).div(100));
        const aplicado = Decimal.min(monto, Decimal.max(0, remanente));
        judicialDeduction = judicialDeduction.plus(aplicado);
        remanente = remanente.minus(aplicado);
    }
    judicialDeduction = judicialDeduction.toDecimalPlaces(4);

    // 4. Neto a Recibir — descontando deducciones judiciales y luego adelantos.
    const advanceDeduction = new Decimal(opts?.advanceDeduction ?? 0);
    const netSalary = totalIncome.minus(totalDeductions).minus(judicialDeduction).minus(advanceDeduction).toDecimalPlaces(4);

    // 5. Aportes Patronales (costo para el empleador)
    const inssPatronal = baseINSS.mul(inssPatronalRate).toDecimalPlaces(4);
    const inatec       = totalIncome.mul(INATEC_RATE).toDecimalPlaces(4);
    const totalCostoEmpresa = totalIncome.plus(inssPatronal).plus(inatec).toDecimalPlaces(4);

    return {
        grossSalary:            dBase.toNumber(),
        commissions:            dComm.toNumber(),
        overtimePay:            overtimePay.toNumber(),
        horasExtra:             horasExtra.toNumber(),
        totalIncome:            totalIncome.toNumber(),
        inssLaboral:            inssLaboral.toNumber(),
        irLaboral:              irLaboral.toNumber(),
        totalDeductions:        totalDeductions.toNumber(),
        advanceDeduction:       advanceDeduction.toNumber(),
        absenceDeduction:       absenceDeduction.toNumber(),
        judicialDeduction:      judicialDeduction.toNumber(),
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

export interface SettlementCalc {
    antiguedadAnios: number;
    antiguedadTexto: string;
    salarioMensual: number;
    salarioDiario: number;
    reason: string;
    aplicaIndemnizacion: boolean;
    indemnizacionDias: number;
    indemnizacion: number;
    diasVacaciones: number;
    vacaciones: number;
    diasAguinaldo: number;
    aguinaldo: number;
    total: number;
}

/**
 * Liquidación final (finiquito) — Art. 42-45 y 78 Ley 185.
 *  - Indemnización por antigüedad (Art. 45): 1 mes (30 días) por cada uno de los
 *    PRIMEROS 3 años; 20 días por cada año a partir del 4º. Mínimo 1 mes, máximo
 *    5 meses; las fracciones se liquidan proporcionalmente. Solo en despido o
 *    mutuo acuerdo (no en renuncia).
 *  - Vacaciones: el saldo REAL acumulado (Art. 76) × salario diario.
 *  - Aguinaldo: proporcional desde el inicio del período en curso (Art. 93).
 *  - Base: salario mensual (el caller pasa el promedio de los últimos 6 meses
 *    cuando el salario es variable, Art. 78).
 */
export function calculateSettlement(params: {
    hireDate: Date;
    terminationDate: Date;
    reason: 'DISMISSAL' | 'RESIGNATION' | 'MUTUAL';
    salarioMensual: number;
    vacationDaysBalance: number;
}): SettlementCalc {
    const hire = new Date(params.hireDate);
    const term = new Date(params.terminationDate);
    const salarioMensual = new Decimal(params.salarioMensual);
    const salarioDiario = salarioMensual.dividedBy(30);

    const anios = Math.max(0, (term.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24 * 365.25));

    // ── Indemnización por antigüedad (Art. 45) ──
    const aplicaIndemnizacion = params.reason === 'DISMISSAL' || params.reason === 'MUTUAL';
    let indemnizacionDias = 0;
    if (aplicaIndemnizacion && anios > 0) {
        const completos = Math.floor(anios);
        for (let i = 1; i <= completos; i++) indemnizacionDias += i <= 3 ? 30 : 20;
        const fraccion = anios - completos;
        indemnizacionDias += fraccion * ((completos + 1) <= 3 ? 30 : 20);
    }
    let indemnizacion = salarioDiario.mul(indemnizacionDias);
    if (aplicaIndemnizacion && anios > 0) {
        // Piso 1 mes, techo 5 meses.
        if (indemnizacion.lessThan(salarioMensual)) indemnizacion = salarioMensual;
        if (indemnizacion.greaterThan(salarioMensual.mul(5))) indemnizacion = salarioMensual.mul(5);
    }

    // ── Vacaciones pendientes (saldo real) ──
    const diasVacaciones = Math.max(0, params.vacationDaysBalance);
    const vacaciones = salarioDiario.mul(diasVacaciones);

    // ── Aguinaldo proporcional (desde el último 1-dic) ──
    const lastDec1 = term.getMonth() >= 11
        ? new Date(term.getFullYear(), 11, 1)
        : new Date(term.getFullYear() - 1, 11, 1);
    const aguinaldoStart = hire > lastDec1 ? hire : lastDec1;
    let diasAguinaldo = 0;
    if (term >= aguinaldoStart) {
        diasAguinaldo = Math.min(360, Math.floor((term.getTime() - aguinaldoStart.getTime()) / 86400000) + 1);
    }
    const aguinaldo = salarioMensual.mul(Math.min(1, diasAguinaldo / 360));

    const total = indemnizacion.plus(vacaciones).plus(aguinaldo).toDecimalPlaces(2);
    const aniosInt = Math.floor(anios);
    const mesesInt = Math.floor((anios - aniosInt) * 12);

    return {
        antiguedadAnios: Number(anios.toFixed(2)),
        antiguedadTexto: `${aniosInt} año(s) ${mesesInt} mes(es)`,
        salarioMensual: salarioMensual.toDecimalPlaces(2).toNumber(),
        salarioDiario: salarioDiario.toDecimalPlaces(2).toNumber(),
        reason: params.reason,
        aplicaIndemnizacion,
        indemnizacionDias: Number(indemnizacionDias.toFixed(1)),
        indemnizacion: indemnizacion.toDecimalPlaces(2).toNumber(),
        diasVacaciones: Number(diasVacaciones.toFixed(1)),
        vacaciones: vacaciones.toDecimalPlaces(2).toNumber(),
        diasAguinaldo,
        aguinaldo: aguinaldo.toDecimalPlaces(2).toNumber(),
        total: total.toNumber(),
    };
}
