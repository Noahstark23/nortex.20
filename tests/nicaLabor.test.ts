/**
 * NORTEX — Red de tests del MOTOR de nómina del ERP (backend/services/nicaLabor.ts).
 *
 * Por qué existe este archivo: hasta ahora la única red laboral era
 * tests/calc-laborales.test.ts, que cubre `utils/calc-laborales.ts` — el espejo
 * PÚBLICO que usan las calculadoras del blog. El motor que calcula el dinero que
 * de verdad se le paga a un trabajador (planilla, retenciones, finiquito) no tenía
 * una sola aserción, y tampoco figuraba en el `mutate` de Stryker.
 *
 * Los casos fijan VALORES ABSOLUTOS derivados de la ley, no de correr la función:
 * un test que compara la función contra sí misma pasa con cualquier constante.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
    calculatePayroll,
    calculateSettlement,
    irAnualDeTabla,
} from '../backend/services/nicaLabor';

// ── Tabla progresiva IR de rentas del trabajo (DGI) ──────────────────────────
describe('IR anual — irAnualDeTabla', () => {
    it('el primer tramo (hasta C$100.000 anuales) está exento', () => {
        expect(irAnualDeTabla(new Decimal(0)).toNumber()).toBe(0);
        expect(irAnualDeTabla(new Decimal(100000)).toNumber()).toBe(0);
    });

    it('aplica 15% sobre el excedente de C$100.000 en el segundo tramo', () => {
        // 150.000 → 0 + (150.000 − 100.000) × 15% = 7.500
        expect(irAnualDeTabla(new Decimal(150000)).toNumber()).toBe(7500);
    });

    it('aplica base + tasa marginal en los tramos superiores', () => {
        // 300.000 → 15.000 + (300.000 − 200.000) × 20% = 35.000
        expect(irAnualDeTabla(new Decimal(300000)).toNumber()).toBe(35000);
        // 400.000 → 45.000 + (400.000 − 350.000) × 25% = 57.500
        expect(irAnualDeTabla(new Decimal(400000)).toNumber()).toBe(57500);
        // 600.000 → 82.500 + (600.000 − 500.000) × 30% = 112.500
        expect(irAnualDeTabla(new Decimal(600000)).toNumber()).toBe(112500);
    });

    // ── EL HUECO DE UN CENTAVO ───────────────────────────────────────────────
    // Los `from` de la tabla arrancan en x.01 y el match exigía `>= from && <= to`,
    // así que las rentas caídas en el hueco (200000, 200000.01) no matcheaban
    // NINGÚN tramo y la función devolvía IR = 0. Es alcanzable en producción: el
    // método acumulado proyecta la renta anual conservando 4 decimales.
    it('no deja huecos entre tramos: una renta a mitad de centavo NO paga cero', () => {
        const enElHueco = irAnualDeTabla(new Decimal('200000.005'));
        expect(enElHueco.toNumber()).toBeGreaterThan(14000);
        expect(enElHueco.toNumber()).toBeCloseTo(15000.001, 3);
    });

    it('es continua en todos los bordes de tramo', () => {
        // La función no puede dar un salto hacia ABAJO al cruzar un borde.
        for (const borde of [100000, 200000, 350000, 500000]) {
            const antes   = irAnualDeTabla(new Decimal(borde));
            const enMedio = irAnualDeTabla(new Decimal(borde).plus('0.005'));
            const despues = irAnualDeTabla(new Decimal(borde).plus('0.01'));
            expect(enMedio.greaterThanOrEqualTo(antes)).toBe(true);
            expect(despues.greaterThanOrEqualTo(enMedio)).toBe(true);
        }
    });

    it('es monótona creciente en todo el recorrido', () => {
        let previo = new Decimal(-1);
        for (const renta of [0, 99999, 100000, 150000, 200000, 250000, 350000, 480000, 500000, 900000]) {
            const ir = irAnualDeTabla(new Decimal(renta));
            expect(ir.greaterThanOrEqualTo(previo)).toBe(true);
            previo = ir;
        }
    });
});

// ── Planilla mensual ─────────────────────────────────────────────────────────
describe('Planilla — calculatePayroll', () => {
    it('calcula una planilla base de C$30.000 completa', () => {
        const r = calculatePayroll(30000);
        expect(r.totalIncome).toBe(30000);
        expect(r.inssLaboral).toBe(2100);            // 30.000 × 7%
        // Renta neta de INSS 27.900 × 12 = 334.800 → tramo 20%:
        // 15.000 + (334.800 − 200.000) × 20% = 41.960 anual → /12 = 3.496,6667
        expect(r.salarioAnualProyectado).toBe(334800);
        expect(r.irAnualProyectado).toBe(41960);
        expect(r.irLaboral).toBe(3496.6667);
        expect(r.netSalary).toBe(24403.3333);
        expect(r.inssPatronal).toBe(6750);           // 22,5%
        expect(r.inatec).toBe(600);                  // 2%
        expect(r.totalCostoEmpresa).toBe(37350);
    });

    // ── SIN TECHO COTIZABLE (Decreto 06-2019) ────────────────────────────────
    it('el INSS no se congela en salarios altos: no hay techo cotizable', () => {
        // Con el techo derogado que aplicaba el repo (132.071,43) esto daba
        // 9.245,0001 laboral y 29.716,07 patronal. Fija los valores absolutos.
        const r = calculatePayroll(200000);
        expect(r.inssLaboral).toBe(14000);    // 200.000 × 7%
        expect(r.inssPatronal).toBe(45000);   // 200.000 × 22,5%
    });

    it('el INSS es estrictamente proporcional al ingreso, sin tope', () => {
        // Mata cualquier `Decimal.min(totalIncome, X)` reintroducido.
        expect(calculatePayroll(400000).inssLaboral)
            .toBe(calculatePayroll(200000).inssLaboral * 2);
        expect(calculatePayroll(1000000).inssLaboral).toBe(70000);
    });

    it('el patronal es parametrizable para PyME (21,5% con <50 empleados)', () => {
        expect(calculatePayroll(30000, 0, { inssPatronalRate: 0.215 }).inssPatronal).toBe(6450);
    });

    it('paga las horas extra al DOBLE de la hora ordinaria (Art. 62)', () => {
        // Hora ordinaria = 30.000 / 240 = 125 → 10 h extra = 10 × 125 × 2 = 2.500
        const r = calculatePayroll(30000, 0, { overtimeHours: 10 });
        expect(r.overtimePay).toBe(2500);
        expect(r.totalIncome).toBe(32500);
    });

    it('paga el feriado trabajado con recargo de un día (Art. 68)', () => {
        // 30.000 / 30 = 1.000 por día feriado laborado
        expect(calculatePayroll(30000, 0, { holidayDays: 2 }).holidayPay).toBe(2000);
    });

    it('las ausencias reducen el devengado y con él la base de INSS', () => {
        const r = calculatePayroll(30000, 0, { absenceDeduction: 3000 });
        expect(r.totalIncome).toBe(27000);
        expect(r.inssLaboral).toBe(1890);   // 27.000 × 7%, no 2.100
    });

    it('la ausencia se acota al salario base (nunca deja el devengado negativo)', () => {
        const r = calculatePayroll(30000, 0, { absenceDeduction: 99999 });
        expect(r.totalIncome).toBe(0);
        expect(r.inssLaboral).toBe(0);
        expect(r.netSalary).toBe(0);
    });

    it('las comisiones entran a la base gravable', () => {
        const r = calculatePayroll(30000, 5000);
        expect(r.totalIncome).toBe(35000);
        expect(r.inssLaboral).toBe(2450);   // 35.000 × 7%
    });

    // ── Deducciones judiciales (Art. 88) ─────────────────────────────────────
    it('aplica la deducción judicial de monto fijo sobre el disponible', () => {
        const r = calculatePayroll(30000, 0, { judicialDeductions: [{ amount: 5000 }] });
        expect(r.judicialDeduction).toBe(5000);
        expect(r.netSalary).toBe(19403.3333);   // 24.403,3333 − 5.000
    });

    it('acota las deducciones judiciales al disponible: el neto nunca es negativo', () => {
        const r = calculatePayroll(30000, 0, { judicialDeductions: [{ amount: 999999 }] });
        expect(r.netSalary).toBe(0);
        // Lo aplicado es exactamente el disponible tras INSS e IR, ni un peso más.
        expect(r.judicialDeduction).toBe(24403.3333);
    });

    it('reparte varias deducciones judiciales en orden de prioridad', () => {
        // Disponible 24.403,3333: la primera cobra 20.000, la segunda solo el resto.
        const r = calculatePayroll(30000, 0, {
            judicialDeductions: [{ amount: 20000 }, { amount: 20000 }],
        });
        expect(r.judicialDeduction).toBe(24403.3333);
    });

    it('la deducción judicial por porcentaje usa el disponible como base', () => {
        // 50% de (30.000 − 2.100 − 3.496,6667) = 50% de 24.403,3333 = 12.201,6667
        const r = calculatePayroll(30000, 0, { judicialDeductions: [{ percentage: 50 }] });
        expect(r.judicialDeduction).toBe(12201.6667);
    });

    it('los adelantos se descuentan después de todo lo demás', () => {
        const r = calculatePayroll(30000, 0, { advanceDeduction: 1000 });
        expect(r.netSalary).toBe(23403.3333);
    });

    // ── Método acumulado DGI ─────────────────────────────────────────────────
    it('el método acumulado salda contra lo ya retenido en el año', () => {
        // Mes 12: no quedan meses por venir, así que la retención del mes cuadra
        // el IR del año contra lo retenido en los 11 anteriores.
        const r = calculatePayroll(30000, 0, {
            irAcumulado: { mes: 12, netoGravablePrevio: 306900, irRetenidoPrevio: 38463.33 },
        });
        // Renta anual = 306.900 + 27.900 = 334.800 → IR anual 41.960
        expect(r.salarioAnualProyectado).toBe(334800);
        expect(r.irAnualProyectado).toBe(41960);
        expect(r.irLaboral).toBe(3496.67);   // 41.960 − 38.463,33
    });

    it('el método acumulado proyecta los meses que faltan del año', () => {
        // Mes 6: quedan 6 meses por venir, así que la renta anual esperada es
        // lo ya devengado (5 meses × 27.900 = 139.500) + 7 × el neto del mes
        // (el actual + los 6 que restan) = 139.500 + 195.300 = 334.800.
        // La retención del mes salda (41.960 − 17.483,33) repartido en 7 meses.
        const r = calculatePayroll(30000, 0, {
            irAcumulado: { mes: 6, netoGravablePrevio: 139500, irRetenidoPrevio: 17483.33 },
        });
        expect(r.salarioAnualProyectado).toBe(334800);
        expect(r.irAnualProyectado).toBe(41960);
        expect(r.irLaboral).toBe(3496.6671);
    });

    it('en el mes 1 proyecta los 12 meses completos', () => {
        // Sin nada devengado antes: 12 × 27.900 = 334.800.
        const r = calculatePayroll(30000, 0, {
            irAcumulado: { mes: 1, netoGravablePrevio: 0, irRetenidoPrevio: 0 },
        });
        expect(r.salarioAnualProyectado).toBe(334800);
        expect(r.irLaboral).toBe(3496.6667);   // 41.960 / 12
    });

    it('el método acumulado nunca retiene negativo (si ya se retuvo de más, retiene 0)', () => {
        const r = calculatePayroll(30000, 0, {
            irAcumulado: { mes: 12, netoGravablePrevio: 306900, irRetenidoPrevio: 99999 },
        });
        expect(r.irLaboral).toBe(0);
    });
});

// ── Liquidación / finiquito ──────────────────────────────────────────────────
describe('Finiquito — calculateSettlement', () => {
    const base = {
        salarioMensual: 30000,
        vacationDaysBalance: 0,
        reason: 'DISMISSAL' as const,
    };

    it('4 años de antigüedad = 110 días (30×3 + 20×1)', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.indemnizacionDias).toBe(110);
        expect(r.indemnizacion).toBe(110000);   // 110 × (30.000/30)
    });

    // ── LA CONTRADICCIÓN DEL DOCUMENTO ───────────────────────────────────────
    // El monto se acotaba a [1, 5] salarios pero los días se devolvían crudos, y
    // HRM.tsx imprime AMBOS en el finiquito. Desde ~6 años de antigüedad el
    // documento se contradecía a sí mismo ("230 días" junto a un monto de 150).
    it('con 10 años el techo recorta los días junto con el monto', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2014, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.indemnizacionDias).toBe(150);   // crudos serían ~230
        expect(r.indemnizacion).toBe(150000);    // 5 meses
    });

    it('con media antigüedad el piso sube los días junto con el monto', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2023, 6, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.indemnizacionDias).toBe(30);    // crudos serían ~15
        expect(r.indemnizacion).toBe(30000);     // 1 mes
    });

    it('INVARIANTE: el monto impreso siempre es días × salario diario', () => {
        for (const anioIngreso of [2005, 2014, 2018, 2020, 2022, 2023]) {
            const r = calculateSettlement({
                ...base,
                hireDate: new Date(anioIngreso, 3, 10),
                terminationDate: new Date(2024, 0, 15),
            });
            expect(r.indemnizacion).toBeCloseTo(r.indemnizacionDias * 1000, 2);
            expect(r.indemnizacionDias).toBeGreaterThanOrEqual(30);
            expect(r.indemnizacionDias).toBeLessThanOrEqual(150);
        }
    });

    it('la renuncia no paga indemnización', () => {
        const r = calculateSettlement({
            ...base,
            reason: 'RESIGNATION',
            hireDate: new Date(2018, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.aplicaIndemnizacion).toBe(false);
        expect(r.indemnizacionDias).toBe(0);
        expect(r.indemnizacion).toBe(0);
    });

    it('el mutuo acuerdo sí paga indemnización', () => {
        const r = calculateSettlement({
            ...base,
            reason: 'MUTUAL',
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.aplicaIndemnizacion).toBe(true);
        expect(r.indemnizacion).toBe(110000);
    });

    it('paga el saldo real de vacaciones al salario diario', () => {
        const r = calculateSettlement({
            ...base,
            vacationDaysBalance: 12,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.diasVacaciones).toBe(12);
        expect(r.vacaciones).toBe(12000);   // 12 × 1.000
    });

    it('INVARIANTE: el total es la suma de sus tres componentes', () => {
        const r = calculateSettlement({
            ...base,
            vacationDaysBalance: 7,
            hireDate: new Date(2019, 2, 20),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.total).toBeCloseTo(r.indemnizacion + r.vacaciones + r.aguinaldo, 2);
    });

    it('sin antigüedad (mismo día de ingreso y salida) no hay indemnización', () => {
        const mismoDia = new Date(2024, 0, 15);
        const r = calculateSettlement({ ...base, hireDate: mismoDia, terminationDate: mismoDia });
        expect(r.indemnizacionDias).toBe(0);
        expect(r.indemnizacion).toBe(0);
    });

    // ── Fracción proporcional del año en curso (Art. 45) ─────────────────────
    // Estos dos casos existen para fijar el CAMBIO DE TRAMO: la fracción del 3.er
    // año se paga a 30 días/año, la del 4.º ya a 20. Los casos de años enteros no
    // distinguen, y los de antigüedad corta quedan tapados por el piso de 30 días.
    it('la fracción del 3.er año se paga a 30 días/año', () => {
        // 2,5024 años → 30×2 completos + 0,5024 × 30 = 75,07 días
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2021, 6, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.indemnizacionDias).toBeCloseTo(75.07, 2);
        expect(r.indemnizacion).toBeCloseTo(75070, 2);
    });

    it('la fracción del 4.º año ya se paga a 20 días/año, no a 30', () => {
        // 3,5017 años → 30×3 completos + 0,5017 × 20 = 100,03 días
        // Con la tasa del tramo anterior (30) daría 105,05: la diferencia es el bug.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 6, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.indemnizacionDias).toBeCloseTo(100.03, 2);
        expect(r.indemnizacion).toBeCloseTo(100030, 2);
    });

    // ── Aguinaldo proporcional (Art. 93): el período corre 1-dic → 30-nov ─────
    it('cuenta el aguinaldo desde el 1-dic anterior cuando la salida es en enero', () => {
        // 1-dic-2023 → 15-ene-2024 = 46 días → 30.000 × 46/360 = 3.833,33
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.diasAguinaldo).toBe(46);
        expect(r.aguinaldo).toBe(3833.33);
    });

    it('cuenta desde el 1-dic del MISMO año cuando la salida es en diciembre', () => {
        // Salida 20-dic-2024 → el período en curso arrancó el 1-dic-2024: 20 días.
        // Si se tomara el 1-dic del año anterior daría casi un aguinaldo entero.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 11, 20),
        });
        expect(r.diasAguinaldo).toBe(20);
        expect(r.aguinaldo).toBe(1666.67);
    });

    it('arranca en la fecha de ingreso si es posterior al 1-dic', () => {
        // Contratado el 20-dic-2023, sale el 15-ene-2024 → 27 días, no 46.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2023, 11, 20),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.diasAguinaldo).toBe(27);
        expect(r.aguinaldo).toBe(2250);
    });

    it('el aguinaldo se topa en un salario mensual (período completo)', () => {
        // 1-dic-2023 → 30-nov-2024 son 366 días corridos: se topan en 360 = 1 mes.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2010, 0, 1),
            terminationDate: new Date(2024, 10, 30),
        });
        expect(r.diasAguinaldo).toBe(360);
        expect(r.aguinaldo).toBe(30000);
    });

    it('no acredita aguinaldo si la salida es anterior al inicio del período', () => {
        // Ingreso y salida el mismo día, antes del 1-dic siguiente.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2024, 5, 10),
            terminationDate: new Date(2024, 5, 10),
        });
        expect(r.diasAguinaldo).toBe(1);
        expect(r.aguinaldo).toBeCloseTo(83.33, 2);
    });

    it('con fechas invertidas no acredita aguinaldo negativo', () => {
        // Salida ANTES del ingreso (dato corrupto): el guard `term >= aguinaldoStart`
        // existe para que el finiquito no salga con un aguinaldo en negativo.
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2024, 5, 10),
            terminationDate: new Date(2024, 2, 10),
        });
        expect(r.diasAguinaldo).toBe(0);
        expect(r.aguinaldo).toBe(0);
        expect(r.total).toBeGreaterThanOrEqual(0);
    });

    // ── Antigüedad reportada ─────────────────────────────────────────────────
    it('reporta la antigüedad en años y meses', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2019, 2, 20),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.antiguedadAnios).toBeCloseTo(4.82, 2);
        expect(r.antiguedadTexto).toBe('4 año(s) 9 mes(es)');
    });

    it('reporta 0 meses cuando la antigüedad es de años exactos', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.antiguedadTexto).toBe('4 año(s) 0 mes(es)');
    });

    it('reporta el salario diario como el mensual entre 30', () => {
        const r = calculateSettlement({
            ...base,
            hireDate: new Date(2020, 0, 15),
            terminationDate: new Date(2024, 0, 15),
        });
        expect(r.salarioMensual).toBe(30000);
        expect(r.salarioDiario).toBe(1000);
    });
});
