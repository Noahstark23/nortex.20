/**
 * NORTEX — Aritmética PURA de los dos números que el dueño verifica A MANO:
 *   1. La GANANCIA del día (¿cuánto me quedó de lo que vendí?).
 *   2. El EFECTIVO que debería haber en la gaveta del turno.
 *
 * Los dos se mostraban mal el día 1 (ganancia = venta entera; gaveta en C$0.00
 * con plata adentro) y los dos son verificables con una calculadora: si el
 * número no cuadra, el dueño deja de creerle al sistema entero.
 *
 * Es LÓGICA PURA: sin Prisma, sin Express, sin IO. Recibe valores y devuelve
 * valores, para que entre a la red de mutación (Stryker) y no pueda pudrirse.
 */
import Decimal from 'decimal.js';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    normalizeFiscalRegime,
    type FiscalRegime,
} from './fiscalRegime';

/**
 * Factor para desglosar un precio que YA trae IVA incluido: neto = total / 1.15.
 *
 * Se construye DENTRO de la función (y no como constante de módulo) a propósito:
 * un `const` de nivel módulo se evalúa al importar, antes de que las pruebas de
 * mutación activen el mutante, así que una tasa de IVA adulterada SOBREVIVIRÍA la
 * red de Stryker. Acá el 15% es código que corre en cada llamada → está protegido.
 */
function ivaFactor(): Decimal {
    return new Decimal('0.15').plus(1); // 1.15
}

/**
 * Ingreso NETO (sin IVA) reconocido por una venta.
 *
 * Es la MISMA fórmula de `desglosarVentaConExoneracion` (backend/services/nicaTax.ts):
 * exento acotado a [0, total] → el IVA solo se separa de lo gravado (que trae el
 * IVA incluido, porque `Product.price` es precio de GÓNDOLA) → el exonerado suma
 * completo. Se REPLICA en vez de importarse porque `nicaTax.ts` instancia un
 * `PrismaClient` a nivel de módulo: importarlo desde `utils/` arrastraría Prisma
 * a un módulo puro (rompe la testeabilidad y suma una conexión más de las ~21 que
 * ya hay). El contrato queda amarrado por un test que compara ESTE resultado
 * contra el de `desglosarVentaConExoneracion` (tests/margen.test.ts): si alguien
 * cambia una de las dos fórmulas, el CI se pone rojo.
 *
 * Que sea la misma fórmula es lo que garantiza que el KPI del dashboard no
 * discrepe del Estado de Resultados ni de la declaración de la DGI.
 */
function ingresoNetoDeVenta(
    total: Decimal.Value,
    exento: Decimal.Value | null | undefined,
    fiscalRegime?: FiscalRegime | string | null,
): Decimal {
    const dTotal = new Decimal(total);
    if (normalizeFiscalRegime(fiscalRegime) === FISCAL_REGIME_CUOTA_FIJA) {
        return dTotal.toDecimalPlaces(4);
    }
    const dExentoCrudo = exento == null ? new Decimal(0) : new Decimal(exento);
    const dExento = Decimal.min(Decimal.max(dExentoCrudo, new Decimal(0)), dTotal);
    const gravado = dTotal.minus(dExento);
    const netoGravado = gravado.dividedBy(ivaFactor()).toDecimalPlaces(4);
    return netoGravado.plus(dExento).toDecimalPlaces(4);
}

export interface VentaParaMargen {
    /** Total de la venta, CON IVA incluido (precio de góndola). */
    total: Decimal.Value;
    /** Porción exonerada (canasta básica). `null`/ausente = venta 100% gravada. */
    exemptTotal?: Decimal.Value | null;
    /** Foto fiscal de la venta. Ausente = GENERAL para compatibilidad histórica. */
    fiscalRegimeAtSale?: FiscalRegime | string | null;
    /** Líneas de la venta. `costAtSale` es el costo unitario NETO de IVA. */
    items: Array<{ costAtSale: Decimal.Value | null; quantity: number }>;
}

export interface MargenBruto {
    /** Ingreso reconocido, SIN IVA (el mismo del asiento contable). */
    ingresoNeto: Decimal;
    /** Costo de lo vendido (COGS): Σ costAtSale × cantidad. */
    costoVendido: Decimal;
    /** ingresoNeto − costoVendido. La ganancia bruta REAL. */
    gananciaBruta: Decimal;
    /** Líneas con costo nulo o 0: aportan ingreso pero NO costo → la ganancia
     *  queda SOBREESTIMADA y la UI tiene que poder avisarlo. */
    lineasSinCosto: number;
}

/**
 * Margen bruto de un conjunto de ventas.
 *
 * OJO (el bug que esto arregla): la ganancia NO es `precio − costo`. El precio
 * trae el IVA adentro y el costo no, así que restarlos directo infla la ganancia
 * en un 15% del precio. La venta de C$645 con costo C$520 daba C$125 de ganancia
 * "aparente" cuando la real es C$40.87 (560.87 − 520).
 *
 * Los totales se redondean a 2 decimales al final, y la ganancia se calcula
 * sobre los totales YA redondeados: así el KPI CUADRA en pantalla
 * (ingreso − costo = ganancia, sin centavos fantasma).
 */
export function calcularMargenBruto(ventas: VentaParaMargen[]): MargenBruto {
    let ingresoNeto = new Decimal(0);
    let costoVendido = new Decimal(0);
    let lineasSinCosto = 0;

    for (const venta of ventas) {
        ingresoNeto = ingresoNeto.plus(ingresoNetoDeVenta(
            venta.total,
            venta.exemptTotal,
            venta.fiscalRegimeAtSale,
        ));

        for (const item of venta.items) {
            // Sin costo registrado (producto cargado sin costo, o importación
            // vieja): la línea NO aporta COGS y se cuenta para poder avisar.
            if (item.costAtSale == null) {
                lineasSinCosto += 1;
                continue;
            }
            const costoUnitario = new Decimal(item.costAtSale);
            if (costoUnitario.lessThanOrEqualTo(0)) {
                lineasSinCosto += 1;
                continue;
            }
            costoVendido = costoVendido.plus(costoUnitario.times(item.quantity));
        }
    }

    const ingresoNetoFinal = ingresoNeto.toDecimalPlaces(2);
    const costoVendidoFinal = costoVendido.toDecimalPlaces(2);

    return {
        ingresoNeto: ingresoNetoFinal,
        costoVendido: costoVendidoFinal,
        gananciaBruta: ingresoNetoFinal.minus(costoVendidoFinal),
        lineasSinCosto,
    };
}

/**
 * Retiro SEGURO: lo que el dueño puede sacar del negocio hoy sin descapitalizarlo.
 *
 *   retiroSeguro = max(0, efectivo − cuentasPorPagar − costoReposición)
 *
 * La liquidez libre (efectivo − CxP) NO alcanza: parte de esa plata es de la
 * mercadería que ya salió y hay que RECOMPRAR para dejar el inventario como
 * estaba. Sin ese descuento el sistema le está diciendo al dueño que se lleve el
 * capital de trabajo — consejo financiero peligroso, no un KPI optimista.
 */
export function calcularRetiroSeguro(
    efectivoTotal: Decimal.Value,
    cuentasPorPagar: Decimal.Value,
    costoReposicionPendiente: Decimal.Value
): Decimal {
    const libre = new Decimal(efectivoTotal)
        .minus(new Decimal(cuentasPorPagar))
        .minus(new Decimal(costoReposicionPendiente));
    return Decimal.max(libre, new Decimal(0)).toDecimalPlaces(2);
}

// ── Efectivo esperado del turno (una sola verdad) ────────────────────────────

/** Categoría de los movimientos de corresponsalía (agente bancario). */
export const CATEGORIA_AGENTE = 'AGENTE_BANCARIO';

export interface MovimientoDeCaja {
    type: string;                 // 'IN' | 'OUT'
    amount: Decimal.Value;
    currency?: string | null;     // 'NIO' | 'USD' (ausente = NIO, filas legacy)
    category?: string | null;
    isVoided?: boolean | null;    // anulado = no mueve la gaveta
}

export interface ComponentesTurno {
    initialCash: Decimal.Value;            // fondo inicial en C$
    initialCashUsd?: Decimal.Value | null;  // fondo inicial en US$
    cashSales: Decimal.Value;              // ventas EN EFECTIVO del turno (C$)
    movimientos: MovimientoDeCaja[];
}

export interface EfectivoTurno {
    /** EL NÚMERO SAGRADO: lo que debería haber en la gaveta, en córdobas. */
    efectivoNIO: Decimal;
    /** Gaveta de dólares. SEPARADA: sumar monedas distintas ya fue un bug real. */
    efectivoUSD: Decimal;
    desglose: {
        initialCash: Decimal;
        cashSales: Decimal;
        manualINs: Decimal;
        manualOUTs: Decimal;
        agentINs: Decimal;
        agentOUTs: Decimal;
        initialCashUsd: Decimal;
        usdINs: Decimal;
        usdOUTs: Decimal;
    };
}

/**
 * Efectivo esperado de un turno. FUENTE ÚNICA: la usan el monitor de cajas
 * ("Efectivo en Gaveta") y la píldora del POS (`/api/cash-movements/balance`).
 *
 *   C$  = fondo inicial + ventas en efectivo + (entradas manuales + agente)
 *                                            − (salidas manuales + agente)
 *   US$ = fondo inicial USD + entradas USD − salidas USD
 *
 * Antes cada endpoint tenía su fórmula y daban números distintos para la MISMA
 * gaveta. Los movimientos de agente bancario van adentro del total (son billetes
 * físicos que están en la gaveta) pero se devuelven DESGLOSADOS, porque esa plata
 * es del banco y el dueño la concilia aparte.
 */
export function calcularEfectivoTurno(comp: ComponentesTurno): EfectivoTurno {
    const esNio = (m: MovimientoDeCaja) => (m.currency == null ? 'NIO' : m.currency) === 'NIO';
    const esAgente = (m: MovimientoDeCaja) => m.category === CATEGORIA_AGENTE;

    let manualINs = new Decimal(0);
    let manualOUTs = new Decimal(0);
    let agentINs = new Decimal(0);
    let agentOUTs = new Decimal(0);
    let usdINs = new Decimal(0);
    let usdOUTs = new Decimal(0);

    for (const mov of comp.movimientos) {
        // Anulado (soft delete del libro de caja): no mueve la gaveta.
        if (mov.isVoided === true) continue;

        const monto = new Decimal(mov.amount);
        const entrada = mov.type === 'IN';

        if (esNio(mov)) {
            if (esAgente(mov)) {
                if (entrada) agentINs = agentINs.plus(monto);
                else agentOUTs = agentOUTs.plus(monto);
            } else {
                if (entrada) manualINs = manualINs.plus(monto);
                else manualOUTs = manualOUTs.plus(monto);
            }
        } else {
            if (entrada) usdINs = usdINs.plus(monto);
            else usdOUTs = usdOUTs.plus(monto);
        }
    }

    const initialCash = new Decimal(comp.initialCash);
    const cashSales = new Decimal(comp.cashSales);
    const initialCashUsd = comp.initialCashUsd == null ? new Decimal(0) : new Decimal(comp.initialCashUsd);

    const efectivoNIO = initialCash
        .plus(cashSales)
        .plus(manualINs)
        .plus(agentINs)
        .minus(manualOUTs)
        .minus(agentOUTs)
        .toDecimalPlaces(2);

    // La gaveta USD se persiste en Decimal(18,4); redondear a centavos
    // aquí inventaría diferencias contra el conteo y los movimientos exactos.
    const efectivoUSD = initialCashUsd.plus(usdINs).minus(usdOUTs).toDecimalPlaces(4);

    return {
        efectivoNIO,
        efectivoUSD,
        desglose: {
            initialCash,
            cashSales,
            manualINs,
            manualOUTs,
            agentINs,
            agentOUTs,
            initialCashUsd,
            usdINs,
            usdOUTs,
        },
    };
}
