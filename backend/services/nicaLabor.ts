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

// ⛔ NO REINTRODUCIR UN TECHO COTIZABLE. El Decreto Presidencial 06-2019 eliminó
// el tope máximo de la remuneración cotizable del INSS: cada córdoba cotiza. Este
// motor aplicaba base = min(totalIncome, 132071.43) —cifra sin fuente— y por eso
// sub-retenía INSS y sobre-retenía IR en salarios altos. Ver utils/tasas.ts.

// Art. 45: un "mes" de indemnización son 30 días; piso 1 mes, techo 5 meses.
const INDEMNIZACION_DIAS_MIN = 30;
const INDEMNIZACION_DIAS_MAX = 150;
const MS_PER_DAY = 86_400_000;

/**
 * Diferencia de días para valores que representan una fecha calendario.
 *
 * Las fechas laborales (ingreso, salida, inicio de aguinaldo) no representan
 * horas trabajadas. Restar sus timestamps directamente introduce horas de más
 * o de menos al cruzar horario de verano y puede mover el redondeo monetario.
 */
function calendarDaysBetween(start: Date, end: Date): number {
    const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    return (endDay - startDay) / MS_PER_DAY;
}

// Tabla progresiva IR anual vigente DGI Nicaragua — Reformas tributarias 2025
// Stryker disable StringLiteral: estas cinco filas se construyen al importar; reemplazar sus strings se activa después y resulta equivalente. El ArrayDeclaration sigue mutándose.
const IR_TABLE = [
    { from: new Decimal('0'),         to: new Decimal('100000'),   rate: new Decimal('0'),    base: new Decimal('0') },
    { from: new Decimal('100000.01'), to: new Decimal('200000'),   rate: new Decimal('0.15'), base: new Decimal('0') },
    { from: new Decimal('200000.01'), to: new Decimal('350000'),   rate: new Decimal('0.20'), base: new Decimal('15000') },
    { from: new Decimal('350000.01'), to: new Decimal('500000'),   rate: new Decimal('0.25'), base: new Decimal('45000') },
    { from: new Decimal('500000.01'), to: new Decimal('Infinity'), rate: new Decimal('0.30'), base: new Decimal('82500') },
];
// Stryker restore StringLiteral

/**
 * IR anual de la tabla progresiva DGI (rentas del trabajo) sobre una renta neta
 * anual (ya neta de INSS laboral).
 */
export function irAnualDeTabla(rentaAnual: Decimal): Decimal {
    for (const tramo of IR_TABLE) {
        // Los tramos están ordenados y el último llega a Infinity, así que basta
        // el TECHO para cubrir la recta completa sin huecos. Antes se exigía
        // además `>= from`, y como los `from` arrancan en x.01 quedaba un hueco de
        // un centavo entre tramos: una renta de 200000.005 —alcanzable, porque el
        // método acumulado conserva 4 decimales— no matcheaba ningún tramo y la
        // función caía al `return 0` final, devolviendo IR CERO donde correspondían
        // ~15.000 córdobas.
        if (rentaAnual.lessThanOrEqualTo(tramo.to)) {
            const fromAdj = tramo.from.greaterThan(0) ? tramo.from.minus('0.01') : new Decimal(0);
            return tramo.base.plus(rentaAnual.minus(fromAdj).mul(tramo.rate));
        }
    }
    return new Decimal(0); // inalcanzable salvo NaN (toda comparación con NaN es falsa)
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
    holidayPay: number;    // Recargo por feriado trabajado (Art. 68)
    diasFeriados: number;  // Días feriados laborados (informativo)
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
        holidayDays?: number;
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

    // Feriado trabajado: recargo del 100% (un día extra por feriado laborado),
    // pues el salario mensual ya cubre el día (Art. 68 Ley 185).
    const diasFeriados = new Decimal(opts?.holidayDays ?? 0);
    const holidayPay = diasFeriados.mul(dBase.dividedBy(30)).toDecimalPlaces(4);

    const totalIncome = earnedBase.plus(dComm).plus(overtimePay).plus(holidayPay);
    // B4: INSS patronal parametrizable (21.5% <50 emp · 22.5% ≥50). Default legal.
    const inssPatronalRate = opts?.inssPatronalRate != null ? new Decimal(opts.inssPatronalRate) : INSS_PATRONAL_RATE;

    // 1. INSS Laboral (7%) — sin techo cotizable (Decreto 06-2019)
    const baseINSS = totalIncome;
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
        holidayPay:             holidayPay.toNumber(),
        diasFeriados:           diasFeriados.toNumber(),
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
 * Calcula el pasivo laboral DEVENGADO de un empleado (Aguinaldo, Vacaciones,
 * Indemnización) — Ley 185. Es el estimador del reporte de pasivos; usa las
 * MISMAS reglas que la liquidación real (`calculateSettlement`) para que el
 * pasivo reportado no sobrestime lo que de verdad se pagaría (N1):
 *  - Vacaciones: saldo REAL acumulado si se conoce (Employee.vacationDays, que
 *    la nómina incrementa y las licencias descuentan); el estimado 2.5
 *    días/mes topado a 30 queda solo de fallback.
 *  - Aguinaldo (Art. 93): proporcional desde el último 1-dic (o la fecha de
 *    contratación si es posterior) — NO desde enero: el período del treceavo
 *    mes corre dic→nov, y el cálculo viejo ignoraba además la fecha de
 *    contratación (a un empleado contratado en octubre le acreditaba 10 meses).
 *  - Indemnización (Art. 45): 30 días/año los primeros 3 años, 20 días/año a
 *    partir del 4º, fracción proporcional al tramo, techo 5 meses (150 días).
 *    El cálculo viejo pagaba 1 mes por TODOS los años y sumaba la fracción
 *    DESPUÉS del techo (7.5 años → 5.5 meses > máximo legal).
 *    Sin piso de 1 mes: el piso (N4) solo cristaliza al liquidar, y su
 *    aplicación exacta está pendiente de decisión del contador.
 */
export function calculateLaborLiability(
    employeeId: string,
    employeeName: string,
    hireDate: Date,
    baseSalary: number,
    vacationDaysBalance?: number | null
): LaborLiability {
    const now = new Date();
    const hire = new Date(hireDate);
    const daysWorked = calendarDaysBetween(hire, now);
    const monthsWorked = Math.max(0, Math.floor(daysWorked / 30.44));

    const dBase = new Decimal(baseSalary);
    const salarioDiario = dBase.dividedBy(30);

    // Vacaciones: saldo real si está disponible; estimado como fallback.
    const diasVacaciones = (vacationDaysBalance !== undefined && vacationDaysBalance !== null)
        ? new Decimal(Math.max(0, vacationDaysBalance))
        : Decimal.min(new Decimal(monthsWorked).mul('2.5'), 30);
    const vacacionesPendientes = diasVacaciones.mul(salarioDiario).toDecimalPlaces(4);

    // Aguinaldo (Art. 93): días desde max(último 1-dic, contratación), /360.
    const lastDec1 = now.getUTCMonth() >= 11
        ? new Date(Date.UTC(now.getUTCFullYear(), 11, 1))
        : new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 1));
    const aguinaldoStart = hire > lastDec1 ? hire : lastDec1;
    const diasDesdeInicioAguinaldo = calendarDaysBetween(aguinaldoStart, now);
    const diasAguinaldo = diasDesdeInicioAguinaldo >= 0
        ? Math.min(360, diasDesdeInicioAguinaldo + 1)
        : 0;
    const aguinaldoAcumulado = dBase.mul(Math.min(1, diasAguinaldo / 360)).toDecimalPlaces(4);

    // Indemnización (Art. 45): tramos 30/20 días con fracción, techo 150 días.
    const anios = Math.max(0, daysWorked / 365.25);
    let indemnizacionDias = 0;
    if (anios > 0) {
        const completos = Math.floor(anios);
        for (let i = 1; i <= completos; i++) indemnizacionDias += i <= 3 ? 30 : 20;
        const fraccion = anios - completos;
        indemnizacionDias += fraccion * ((completos + 1) <= 3 ? 30 : 20);
        indemnizacionDias = Math.min(indemnizacionDias, INDEMNIZACION_DIAS_MAX); // techo 5 meses
    }
    const indemnizacion = salarioDiario.mul(indemnizacionDias).toDecimalPlaces(4);

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

    const anios = Math.max(0, calendarDaysBetween(hire, term) / 365.25);

    // ── Indemnización por antigüedad (Art. 45) ──
    const aplicaIndemnizacion = params.reason === 'DISMISSAL' || params.reason === 'MUTUAL';
    // `anios` ya viene acotado a ≥ 0, y con antigüedad cero el bloque acumula 0
    // días por sí solo, así que no hace falta guardarlo también por `anios > 0`.
    let indemnizacionDias = 0;
    if (aplicaIndemnizacion) {
        const completos = Math.floor(anios);
        for (let i = 1; i <= completos; i++) indemnizacionDias += i <= 3 ? 30 : 20;
        const fraccion = anios - completos;
        indemnizacionDias += fraccion * ((completos + 1) <= 3 ? 30 : 20);
    }
    // Piso 1 mes / techo 5 meses (Art. 45). Se acotan los DÍAS, no el monto: como
    // el monto es días × (salario/30), acotar a [30, 150] días es aritméticamente
    // idéntico a acotarlo a [1, 5] salarios, pero deja el finiquito consistente.
    // Antes se acotaba solo el monto y se devolvían los días crudos, así que el
    // documento imprimía "170 días" junto al monto de 150 (HRM.tsx muestra ambos).
    // El piso solo aplica si hubo antigüedad: a quien entra y sale el mismo día no
    // se le debe un mes. Por eso el guard mira los DÍAS acumulados, no la razón.
    if (indemnizacionDias > 0) {
        indemnizacionDias = Math.min(
            Math.max(indemnizacionDias, INDEMNIZACION_DIAS_MIN),
            INDEMNIZACION_DIAS_MAX,
        );
    }
    // Los días se redondean ANTES de valorizarlos, y el monto se deriva de ese
    // mismo número: es el que se imprime en el finiquito, así que tiene que ser el
    // que cuadre. Antes se reportaba `dias.toFixed(1)` pero se cobraba el valor
    // crudo — un finiquito de "145,3 días" venía con un monto de 145.318,28, que
    // no es 145,3 × el salario diario.
    indemnizacionDias = Number(indemnizacionDias.toFixed(2));
    const indemnizacion = salarioDiario.mul(indemnizacionDias).toDecimalPlaces(2);

    // ── Vacaciones pendientes (saldo real) ──
    const diasVacaciones = Math.max(0, params.vacationDaysBalance);
    const vacaciones = salarioDiario.mul(diasVacaciones).toDecimalPlaces(2);

    // ── Aguinaldo proporcional (desde el último 1-dic) ──
    const lastDec1 = term.getUTCMonth() >= 11
        ? new Date(Date.UTC(term.getUTCFullYear(), 11, 1))
        : new Date(Date.UTC(term.getUTCFullYear() - 1, 11, 1));
    const aguinaldoStart = hire > lastDec1 ? hire : lastDec1;
    const diasDesdeInicioAguinaldo = calendarDaysBetween(aguinaldoStart, term);
    const diasAguinaldo = diasDesdeInicioAguinaldo >= 0
        ? Math.min(360, diasDesdeInicioAguinaldo + 1)
        : 0;
    const aguinaldo = salarioMensual.mul(Math.min(1, diasAguinaldo / 360)).toDecimalPlaces(2);

    // El total se suma sobre los componentes YA redondeados, que son los que se
    // imprimen: si se suma en crudo y se redondea al final, el documento puede
    // cerrar con un centavo que no aparece en ninguna de sus líneas.
    const total = indemnizacion.plus(vacaciones).plus(aguinaldo);
    const aniosInt = Math.floor(anios);
    const mesesInt = Math.floor((anios - aniosInt) * 12);

    return {
        antiguedadAnios: Number(anios.toFixed(2)),
        antiguedadTexto: `${aniosInt} año(s) ${mesesInt} mes(es)`,
        salarioMensual: salarioMensual.toDecimalPlaces(2).toNumber(),
        salarioDiario: salarioDiario.toDecimalPlaces(2).toNumber(),
        reason: params.reason,
        aplicaIndemnizacion,
        indemnizacionDias, // ya redondeado a 2 decimales, y es la base del monto
        indemnizacion: indemnizacion.toNumber(),
        diasVacaciones: Number(diasVacaciones.toFixed(1)),
        vacaciones: vacaciones.toDecimalPlaces(2).toNumber(),
        diasAguinaldo,
        aguinaldo: aguinaldo.toDecimalPlaces(2).toNumber(),
        total: total.toNumber(),
    };
}
