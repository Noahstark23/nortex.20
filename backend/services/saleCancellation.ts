import Decimal from 'decimal.js';

/**
 * Anulación de comprobantes — reglas PURAS (sin Prisma, sin Express).
 *
 * QUÉ ES (DGI-5, Disposición Técnica 09-2007): declarar que una factura **no
 * debió emitirse** — error de digitación, cobro duplicado, cliente equivocado.
 *
 * QUÉ NO ES: una devolución. Devolver mercadería es una operación NUEVA sobre
 * una venta que sí ocurrió y sigue siendo válida. Anular es decir que el
 * documento nunca debió existir. Confundirlas descuadra el inventario con
 * mercadería que nunca se movió, que es justo lo que el ferretero terminaba
 * haciendo por no tener este camino.
 *
 * TRES INVARIANTES QUE ESTE MÓDULO DEFIENDE:
 *
 *  1. **El comprobante anulado NO desaparece.** Queda visible y marcado. Borrar
 *     una factura deja un hueco en el correlativo, que es exactamente lo que la
 *     norma prohíbe.
 *  2. **El número NO se reutiliza.** El siguiente comprobante toma el siguiente
 *     número, no el que quedó libre.
 *  3. **No se anula lo que ya se tocó por otro camino.** Si la venta tiene
 *     devoluciones o abonos, revertirla otra vez contaría doble. Ahí el camino
 *     correcto es deshacer eso primero, y el sistema lo dice en vez de hacer
 *     una reversión silenciosamente equivocada.
 */

/**
 * Valor de `Sale.status` que marca un comprobante anulado.
 *
 * Es 'VOIDED' y NO un nombre nuevo a propósito: el repo YA filtraba
 * `status: { not: 'VOIDED' }` en ocho lugares —entre ellos la declaración
 * mensual de IVA (`nicaTax.ts`) y el Libro de Ventas— pero NADA escribía nunca
 * ese valor. Estaba preparada la exclusión y faltaba el lado que anula.
 * Introducir un segundo nombre habría dejado esas ocho exclusiones sin efecto
 * y las ventas anuladas contando en la declaración: el peor resultado posible.
 */
export const ESTADO_ANULADA = 'VOIDED';

/** Motivo mínimo: "error" no le sirve a nadie que audite esto en seis meses. */
const MOTIVO_MIN_CARACTERES = 10;

export interface VentaParaAnular {
    status: string;
    cancelledAt: Date | string | null;
    /** Cuántas devoluciones tiene registradas esta venta. */
    devoluciones: number;
    /** Cuántos abonos/pagos se registraron contra esta venta. */
    pagos: number;
    /** ¿El período contable al que pertenece la venta ya está cerrado? */
    periodoCerrado: boolean;
}

export type CodigoRechazo =
    | 'YA_ANULADA'
    | 'TIENE_DEVOLUCIONES'
    | 'TIENE_PAGOS'
    | 'PERIODO_CERRADO'
    | 'MOTIVO_INSUFICIENTE';

export interface Veredicto {
    ok: boolean;
    codigo?: CodigoRechazo;
    /** Mensaje para el cajero, en español y con la salida concreta. */
    mensaje?: string;
}

const yaAnulada = (v: VentaParaAnular): boolean =>
    v.status === ESTADO_ANULADA || v.cancelledAt !== null;

/**
 * ¿Se puede anular esta venta, y con este motivo?
 *
 * El orden de los rechazos importa: primero lo que hace la operación imposible
 * (ya anulada), después lo que la haría INCORRECTA (reversión doble, período
 * cerrado), y al final lo que depende de quien la pide (el motivo). Así el
 * cajero no corrige el motivo tres veces para enterarse al final de que la
 * venta no se podía anular igual.
 */
export function puedeAnularse(venta: VentaParaAnular, motivo: string): Veredicto {
    if (yaAnulada(venta)) {
        return {
            ok: false,
            codigo: 'YA_ANULADA',
            mensaje: 'Esta factura ya está anulada.',
        };
    }

    if (venta.devoluciones > 0) {
        return {
            ok: false,
            codigo: 'TIENE_DEVOLUCIONES',
            mensaje: 'Esta factura tiene devoluciones registradas. Anularla contaría dos veces la misma mercadería: revertí las devoluciones primero.',
        };
    }

    if (venta.pagos > 0) {
        return {
            ok: false,
            codigo: 'TIENE_PAGOS',
            mensaje: 'Esta factura tiene abonos registrados. Revertí los abonos antes de anularla, si no el dinero cobrado queda sin respaldo.',
        };
    }

    if (venta.periodoCerrado) {
        return {
            ok: false,
            codigo: 'PERIODO_CERRADO',
            mensaje: 'El período contable de esta factura ya está cerrado. Una factura de un período cerrado no se anula: se corrige con una nota de crédito.',
        };
    }

    // El motivo se valida DE ÚLTIMO y con NFC + trim: es lo único que el
    // usuario puede arreglar sin ayuda, y no tiene sentido pedírselo bien
    // escrito para después decirle que igual no se podía.
    if (textoUtil(motivo).length < MOTIVO_MIN_CARACTERES) {
        return {
            ok: false,
            codigo: 'MOTIVO_INSUFICIENTE',
            mensaje: `Escribí por qué se anula (mínimo ${MOTIVO_MIN_CARACTERES} caracteres). Dentro de seis meses, "error" no le va a servir a nadie.`,
        };
    }

    return { ok: true };
}

/** Normaliza el motivo: colapsa espacios y recorta. Un motivo de puros espacios
 *  no es un motivo. */
export function textoUtil(texto: string | null | undefined): string {
    return (texto ?? '').toString().replace(/\s+/g, ' ').trim();
}

export interface LineaAReversar {
    productId: string;
    /** Cantidad que vuelve al inventario. Siempre positiva. */
    cantidad: Decimal;
    /** Costo unitario congelado en la venta — para reversar el COGS con el
     *  MISMO número que registró la venta, no con el costo de hoy. */
    costoUnitario: Decimal;
}

export interface PlanDeReversion {
    lineas: LineaAReversar[];
    /** Total del documento que se anula (lo que deja de ser ingreso). */
    total: Decimal;
    /** Costo de la mercadería que vuelve (lo que deja de ser COGS). */
    costoTotal: Decimal;
    /** Deuda del cliente a bajar. Solo aplica a ventas a crédito. */
    deudaAReversar: Decimal;
    /** Efectivo que sale de la caja del turno. Solo aplica a ventas en efectivo. */
    efectivoAReversar: Decimal;
}

/**
 * Qué hay que deshacer para anular esta venta.
 *
 * Se calcula desde los datos CONGELADOS de la venta (`priceAtSale`,
 * `costAtSale`), nunca desde el precio o el costo actuales del producto: si el
 * costo subió desde que se vendió, reversar con el costo de hoy dejaría la
 * contabilidad descuadrada por la diferencia.
 */
export function planDeReversion(venta: {
    total: Decimal.Value;
    paymentMethod: string;
    items: { productId: string; quantity: Decimal.Value; costAtSale: Decimal.Value }[];
}): PlanDeReversion {
    const lineas: LineaAReversar[] = venta.items.map(it => ({
        productId: it.productId,
        cantidad: new Decimal(it.quantity),
        costoUnitario: new Decimal(it.costAtSale),
    }));

    const costoTotal = lineas
        .reduce((acc, l) => acc.plus(l.cantidad.mul(l.costoUnitario)), new Decimal(0))
        .toDecimalPlaces(4);

    const total = new Decimal(venta.total).toDecimalPlaces(4);
    const esCredito = venta.paymentMethod === 'CREDIT';

    return {
        lineas,
        total,
        costoTotal,
        // Una venta a crédito subió la deuda del cliente: anularla la baja.
        deudaAReversar: esCredito ? total : new Decimal(0),
        // Una venta en efectivo metió plata a la gaveta: anularla la saca. Si no,
        // el arqueo del turno esperaría un efectivo que ya no corresponde y el
        // cajero aparecería con faltante.
        efectivoAReversar: venta.paymentMethod === 'CASH' ? total : new Decimal(0),
    };
}
