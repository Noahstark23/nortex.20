import Decimal from 'decimal.js';

/**
 * Aviso de existencias del carrito — lógica PURA (sin React, sin Prisma).
 *
 * El problema que resuelve (auditoría de usuario, ferretero cobrando de verdad):
 * el POS dejaba armar el carrito con más unidades de las que hay —incluso con el
 * stock YA en negativo— y no decía nada. El cajero se enteraba de dos maneras, las
 * dos malas: o el backend rechazaba la venta con el cliente enfrente, o la venta
 * pasaba y el inventario quedaba mintiendo.
 *
 * Reglas que se respetan acá, y que son la razón de que esto sea un módulo aparte:
 *
 *  1. NUNCA se inventa un aviso. Si no sabemos el stock (producto viejo en un
 *     carrito aparcado, payload sin el campo), el estado es DESCONOCIDO y la UI
 *     no pinta nada. Un aviso falso en el mostrador se aprende a ignorar, y
 *     entonces el aviso verdadero tampoco se ve.
 *  2. El stock negativo NO se maquilla a cero. Si el sistema dice −3, eso es lo
 *     que se muestra: es la señal de que el inventario ya se descuadró.
 *  3. Esto AVISA, no bloquea. Quién puede cobrar sin existencias lo decide la
 *     política del tenant (`Tenant.allowNegativeStock`) y la valida el backend
 *     dentro de la transacción (`applyStockDelta`); acá solo se calcula qué
 *     mostrar. El conteo del sistema puede estar desactualizado y el producto
 *     estar físicamente en la góndola — quien tiene el producto en la mano es
 *     el cajero, no nosotros.
 */

/** Tolerancia para comparar cantidades fraccionables (kg, litros, metros).
 *  El carrito redondea a 2 decimales, así que 1e-6 solo absorbe el ruido de
 *  punto flotante (0.1 + 0.2 = 0.30000000000000004) y jamás una diferencia
 *  real: la más chica que puede existir es 0.01.
 *
 *  Se construye DENTRO de una función a propósito, no como constante de módulo:
 *  una constante se evalúa al importar, antes de que las pruebas de mutación
 *  activen el mutante, así que un valor alterado sobreviviría siempre y la red
 *  daría cobertura falsa sobre el número que define cuándo se avisa. Mismo
 *  motivo por el que `utils/margen.ts` arma el factor de IVA adentro. */
const tolerancia = (): Decimal => new Decimal('0.000001');

export type EstadoStock =
    | 'OK'             // alcanza (o sobra)
    | 'DESCONOCIDO'    // no sabemos el stock — no se avisa nada
    | 'INSUFICIENTE'   // hay existencia, pero menos de la que se está vendiendo
    | 'SIN_EXISTENCIA'; // el sistema marca 0 o negativo

export interface LineaCarrito {
    id: string;
    name: string;
    /** Cantidad que se está vendiendo en esta línea. */
    quantity: number;
    /** Existencia según el sistema. `null`/`undefined`/no finito = desconocida. */
    stock?: number | null;
    /** Unidad de venta (und, kg, qq...). Solo para el texto del aviso. */
    unit?: string | null;
}

export interface AvisoStock {
    id: string;
    name: string;
    estado: EstadoStock;
    /** Lo que dice el sistema (puede ser negativo). `null` si es desconocido. */
    disponible: number | null;
    /** Lo que se está vendiendo. */
    pedido: number;
    /** pedido − disponible, con piso en 0. Cuántas unidades no están respaldadas. */
    faltante: number;
    unidad: string;
    /** Cantidad a la que se puede bajar la línea para que quede respaldada.
     *  `null` cuando no hay nada que vender (disponible ≤ 0): ahí lo que
     *  corresponde es quitar la línea, no ajustarla. */
    ajustarA: number | null;
}

export interface ResumenStock {
    avisos: AvisoStock[];
    /** Solo las líneas que hay que mirar (INSUFICIENTE o SIN_EXISTENCIA). */
    conProblema: AvisoStock[];
    hayProblema: boolean;
    /** Cuántos productos distintos están sin respaldo. */
    productosConProblema: number;
    /** Suma de unidades no respaldadas en todo el carrito. */
    unidadesFaltantes: number;
}

// `Number.isFinite` NO coacciona: devuelve false para strings, null, undefined y
// NaN sin ayuda de un `typeof` extra. Ese guard redundante solo agregaba una rama
// que ninguna entrada podía distinguir.
const esFinito = (n: unknown): n is number => Number.isFinite(n);

/** Redondeo hacia abajo a 2 decimales: ajustar nunca puede proponer MÁS de lo
 *  que hay (un `ajustarA` redondeado hacia arriba volvería a exceder el stock). */
const pisoDosDecimales = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_DOWN);

export function evaluarLinea(linea: LineaCarrito): AvisoStock {
    // Un solo fallback: `(unit ?? '').trim() || 'und'` cubre null, undefined,
    // '' y '   ' con una sola rama. La versión con doble `|| 'und'` tenía una
    // rama que ninguna entrada podía alcanzar.
    const unidad = (linea.unit ?? '').trim() || 'und';
    const pedido = esFinito(linea.quantity) ? linea.quantity : 0;

    const base: Omit<AvisoStock, 'estado' | 'disponible' | 'faltante' | 'ajustarA'> = {
        id: linea.id,
        name: linea.name,
        pedido,
        unidad,
    };

    // Sin dato de existencia no se opina (regla 1).
    if (!esFinito(linea.stock)) {
        return { ...base, estado: 'DESCONOCIDO', disponible: null, faltante: 0, ajustarA: null };
    }

    const disponibleD = new Decimal(linea.stock);
    const pedidoD = new Decimal(pedido);
    const disponible = disponibleD.toNumber();

    // Línea sin cantidad real: no hay nada que reclamar.
    if (pedidoD.lessThanOrEqualTo(0)) {
        return { ...base, estado: 'OK', disponible, faltante: 0, ajustarA: null };
    }

    // Alcanza (dentro de la tolerancia de punto flotante).
    if (disponibleD.plus(tolerancia()).greaterThanOrEqualTo(pedidoD)) {
        return { ...base, estado: 'OK', disponible, faltante: 0, ajustarA: null };
    }

    const faltante = pedidoD.minus(disponibleD).toDecimalPlaces(2).toNumber();

    // Existencia en cero o negativa: no hay nada a lo que bajar la línea.
    if (disponibleD.lessThanOrEqualTo(0)) {
        return { ...base, estado: 'SIN_EXISTENCIA', disponible, faltante, ajustarA: null };
    }

    const ajuste = pisoDosDecimales(disponibleD);
    return {
        ...base,
        estado: 'INSUFICIENTE',
        disponible,
        faltante,
        // Si el piso a 2 decimales deja la línea en 0 (stock 0.004), tampoco hay
        // cantidad vendible: se trata como quitar, no como ajustar.
        ajustarA: ajuste.greaterThan(0) ? ajuste.toNumber() : null,
    };
}

export function evaluarCarrito(lineas: LineaCarrito[]): ResumenStock {
    const avisos = lineas.map(evaluarLinea);
    const conProblema = avisos.filter(a => a.estado === 'INSUFICIENTE' || a.estado === 'SIN_EXISTENCIA');
    const unidadesFaltantes = conProblema
        .reduce((acc, a) => acc.plus(a.faltante), new Decimal(0))
        .toDecimalPlaces(2)
        .toNumber();

    return {
        avisos,
        conProblema,
        hayProblema: conProblema.length > 0,
        productosConProblema: conProblema.length,
        unidadesFaltantes,
    };
}

/**
 * Texto del aviso de una línea, en nicaragüense y sin eufemismos.
 * Va acá (y no en el JSX) para que las rondas de QA puedan probarlo.
 */
export function textoAviso(aviso: AvisoStock): string | null {
    if (aviso.estado === 'OK' || aviso.estado === 'DESCONOCIDO') return null;

    const n = (v: number): string => {
        const d = new Decimal(v);
        return d.isInteger() ? d.toFixed(0) : d.toDecimalPlaces(2).toString();
    };

    if (aviso.estado === 'SIN_EXISTENCIA') {
        // Negativo: el inventario YA está descuadrado, y hay que decirlo así.
        if (aviso.disponible !== null && aviso.disponible < 0) {
            return `El sistema lo tiene en ${n(aviso.disponible)} ${aviso.unidad}: ya se vendió más de lo que había.`;
        }
        return `Sin existencia en el sistema. Estás vendiendo ${n(aviso.pedido)} ${aviso.unidad}.`;
    }

    return `Estás vendiendo ${n(aviso.pedido)} ${aviso.unidad} y en el sistema solo hay ${n(aviso.disponible ?? 0)}.`;
}

/**
 * Texto del resumen del bloque de cobro. Cambia según la política del tenant
 * porque la CONSECUENCIA es distinta y mentirla es peor que no avisar:
 *   - con `allowNegativeStock` apagado el backend RECHAZA la venta;
 *   - con la política encendida la venta pasa y el stock queda en negativo.
 * `permiteNegativo === null` = todavía no sabemos (la consulta no respondió):
 * se avisa el hecho sin prometer la consecuencia.
 */
export function textoResumen(resumen: ResumenStock, permiteNegativo: boolean | null): string | null {
    if (!resumen.hayProblema) return null;

    const cuantos = resumen.productosConProblema;
    const sujeto = cuantos === 1 ? '1 producto' : `${cuantos} productos`;
    const verbo = cuantos === 1 ? 'tiene' : 'tienen';
    const cabeza = `${sujeto} ${verbo} menos existencia de la que estás vendiendo.`;

    if (permiteNegativo === true) {
        return `${cabeza} Podés cobrar, pero el inventario va a quedar en negativo.`;
    }
    if (permiteNegativo === false) {
        return `${cabeza} La venta se va a rechazar hasta que ajustés las cantidades o cargués la mercadería.`;
    }
    return cabeza;
}
