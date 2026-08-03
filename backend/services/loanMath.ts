/**
 * NORTEX — Matemática pura de préstamos (amortización).
 *
 * Extraído de `routes/loans.ts`, donde la originación y el refinanciamiento
 * tenían copias IDÉNTICAS de la fórmula. Objetivos:
 *  (a) deduplicar (un solo lugar donde vive la cuota),
 *  (b) poder fijarlo con tests de regresión "números-oro" en CI — un cambio que
 *      altere la cuota rompe el CI, no el plan de pagos que recibe el cliente.
 *
 * Función PURA (sin DB, sin efectos) → testeable en vitest sin levantar nada.
 */
import Decimal from 'decimal.js';

export type TipoPrestamo = 'FORMAL_AMORTIZED' | 'GOTA_A_GOTA' | string;

export interface Amortizacion {
    installmentAmount: Decimal;
    totalToRepay: Decimal;
}

/**
 * Cuota y total a pagar de un préstamo.
 *  - `FORMAL_AMORTIZED` (sistema francés): cuota = P·i·(1+i)^n / ((1+i)^n − 1);
 *    con i = 0 → P/n (guarda contra división por cero). totalToRepay = cuota·n.
 *  - resto (flat / gota a gota): interés plano sobre el capital total;
 *    totalToRepay = P·(1+i), cuota = total/n.
 *
 * `interestRatePct` es la tasa en PORCENTAJE por período (5 = 5%), tal como la
 * manda el body de la API. `n` es la cantidad de cuotas.
 */
export function calcularAmortizacion(
    principal: Decimal.Value,
    interestRatePct: Decimal.Value,
    n: number,
    type: TipoPrestamo,
): Amortizacion {
    const amount = new Decimal(principal);
    const rate = new Decimal(interestRatePct).dividedBy(100); // 5% → 0.05
    let totalToRepay: Decimal;
    let installmentAmount: Decimal;

    if (type === 'FORMAL_AMORTIZED') {
        if (rate.isZero()) {
            installmentAmount = amount.dividedBy(n);
        } else {
            const onePlusR = rate.plus(1);
            const pow = onePlusR.pow(n);
            installmentAmount = amount.mul(rate.mul(pow)).dividedBy(pow.minus(1));
        }
        totalToRepay = installmentAmount.mul(n);
    } else {
        totalToRepay = amount.plus(amount.mul(rate));
        installmentAmount = totalToRepay.dividedBy(n);
    }

    return { installmentAmount, totalToRepay };
}
