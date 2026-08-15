/**
 * NORTEX — márgenes y liquidez (R2.9, auditoría de retención NX-01/NX-02).
 *
 * PROBLEMA: el dashboard llamaba "Ganancia de hoy" al INGRESO BRUTO
 * (`ventas − gastos`, sin costo de mercadería). Con una venta de C$645 cuya
 * mercadería costó C$520, decía que se ganaron C$645 — +416% sobre la
 * ganancia real de C$125. Y "Retiro Seguro Permitido" repetía ese número
 * diciendo "esto podés sacarlo sin quebrar el negocio": si el dueño hacía
 * caso, se llevaba el capital de reposición del inventario.
 *
 * Un ferretero sabe de memoria que no gana el 100% en cemento. Ver
 * "ganancia = venta" es el momento exacto en que deja de creerle al sistema.
 *
 * DISEÑO: módulo PURO (sin Prisma, sin React) — decide sobre datos ya leídos,
 * testeable sin BD. Todo en decimal.js: son cifras de dinero.
 */

import Decimal from 'decimal.js';

/** Línea de venta ya persistida (snapshot del costo AL MOMENTO de vender). */
export interface LineaVendida {
    quantity: number;
    /** `SaleItem.priceAtSale` — lo que efectivamente se cobró por unidad. */
    priceAtSale: Decimal.Value;
    /** `SaleItem.costAtSale` — costo congelado en la venta, no el actual. */
    costAtSale: Decimal.Value;
    /** Descuento de línea en % (0–100). */
    discount?: number;
}

export interface ResultadoGanancia {
    /** Σ (precio − costo) × cantidad, con descuento de línea aplicado. */
    gananciaBruta: Decimal;
    /** Σ costo × cantidad — lo que cuesta reponer lo vendido. */
    costoMercaderia: Decimal;
    /** Ingreso de las líneas (con descuento de línea), sin restar costo. */
    ingreso: Decimal;
    /**
     * Líneas cuyo costo es 0 o negativo: no se pueden marginar. Se EXCLUYEN
     * del cálculo y se cuentan para avisar — nunca se hace fallback a ingreso,
     * que es justamente el bug que se está corrigiendo.
     */
    lineasSinCosto: number;
}

/**
 * Ganancia bruta de un conjunto de líneas vendidas.
 * Las líneas sin costo cargado se excluyen (y se cuentan): preferimos decir
 * "faltan costos en N productos" antes que inflar la ganancia.
 */
export function calcularGanancia(lineas: LineaVendida[]): ResultadoGanancia {
    let gananciaBruta = new Decimal(0);
    let costoMercaderia = new Decimal(0);
    let ingreso = new Decimal(0);
    let lineasSinCosto = 0;

    for (const l of lineas) {
        const qty = new Decimal(l.quantity || 0);
        if (qty.lessThanOrEqualTo(0)) continue;

        const factor = new Decimal(1).minus(new Decimal(l.discount ?? 0).div(100));
        const precioNeto = new Decimal(l.priceAtSale).mul(factor);
        const costo = new Decimal(l.costAtSale);

        ingreso = ingreso.plus(precioNeto.mul(qty));

        if (costo.lessThanOrEqualTo(0)) {
            // Sin costo confiable: no aporta margen ni COGS, pero sí se avisa.
            lineasSinCosto++;
            continue;
        }

        costoMercaderia = costoMercaderia.plus(costo.mul(qty));
        gananciaBruta = gananciaBruta.plus(precioNeto.minus(costo).mul(qty));
    }

    return {
        gananciaBruta: gananciaBruta.toDecimalPlaces(4),
        costoMercaderia: costoMercaderia.toDecimalPlaces(4),
        ingreso: ingreso.toDecimalPlaces(4),
        lineasSinCosto,
    };
}

/**
 * Retiro seguro: cuánto efectivo puede sacar el dueño sin descapitalizarse.
 *
 * Antes era `efectivo − CxP`, lo que ignoraba que buena parte del efectivo en
 * la gaveta ES el costo de reponer lo que se vendió. Ahora también se descuenta
 * ese costo de reposición. Piso en 0: nunca sugerir un retiro negativo.
 */
export function calcularRetiroSeguro(
    efectivoTotal: Decimal.Value,
    cuentasPorPagar: Decimal.Value,
    costoReposicion: Decimal.Value
): Decimal {
    const libre = new Decimal(efectivoTotal)
        .minus(new Decimal(cuentasPorPagar))
        .minus(new Decimal(costoReposicion));
    return Decimal.max(libre, new Decimal(0)).toDecimalPlaces(4);
}
