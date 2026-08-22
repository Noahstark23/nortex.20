import Decimal from 'decimal.js';

/**
 * Persistencia del carrito del POS — lógica PURA (sin React, sin localStorage).
 *
 * EL PROBLEMA (auditoría UX del POS, P0-1): el carrito vivía en `useState` y
 * nada más. Un clic en "Mis Productos" del sidebar —que está montado ALREDEDOR
 * del POS— desmontaba el componente y borraba la venta. Sin confirmación, sin
 * aviso, sin recuperación. El escenario es de todos los días: el cliente
 * pregunta cuánto vale la bota, el cajero va a consultar, vuelve, y los 15
 * artículos ya no están.
 *
 * LA DECISIÓN DE FONDO: durabilidad primero, interceptación después. Si el
 * carrito sobrevive a la navegación y al F5, el bug deja de existir sin tocar
 * el router — el diálogo de guarda pasa a ser cortesía, no el mecanismo.
 * (Además `useBlocker` de react-router 6.22 exige un data router y la app monta
 * `<BrowserRouter>`: interceptar "como se hace normalmente" obligaría a migrar
 * todo el ruteo por un problema que se resuelve guardando.)
 *
 * REGLAS QUE ESTE MÓDULO DEFIENDE:
 *
 *  1. **Un carrito jamás se restaura en el turno equivocado.** La mercadería de
 *     un turno cerrado NO entra sola a la caja de hoy: se ofrece y el cajero
 *     decide. Restaurar en silencio descuadraría el arqueo de otro.
 *  2. **Dato ilegible se descarta sin ruido.** JSON roto, versión distinta,
 *     forma inesperada → se tira. Hidratar basura es peor que perder el carrito.
 *  3. **El módulo no toca `localStorage`.** Recibe y devuelve strings; quién
 *     lee y escribe es el componente. Así todo esto se puede probar de verdad.
 *
 * OJO con la clave: `nortex_pending_cart` YA EXISTE y es OTRA COSA — un canal de
 * traspaso de un solo uso que escriben el registro (carrito de la demo) y las
 * cotizaciones, y que el POS consume y borra al montar. Reusarla haría que
 * convertir una cotización pisara el carrito restaurado.
 */

/**
 * v2 incorpora identidad de línea, presentación y evidencia de medición.
 * v1 todavía se LEE y se migra en memoria: descartar una venta a medias por
 * desplegar soporte de peso sería una pérdida real para el cajero.
 */
export const VERSION_CARRITO = 2;
export const VERSION_CARRITO_LEGACY = 1;

/** Ventana dentro de la cual un carrito se considera "de ahora mismo".
 *  Se construye dentro de una función (no como constante de módulo) para que
 *  las pruebas de mutación puedan matar un valor alterado: una constante se
 *  evalúa al importar, antes de que el mutante exista, y sobreviviría siempre. */
const ventanaFrescaMs = (): number => 12 * 60 * 60 * 1000;

export interface LineaGuardada {
    id: string;
    name: string;
    price: number;
    quantity: number;
    /** Precio de DETALLE original: sin esto la línea no puede volver del
     *  mayoreo al bajar la cantidad (ver la regla de precios del POS). */
    basePrice?: number;
    discount?: number;
    unit?: string;
    [extra: string]: unknown;
}

/** Identidad visual/operativa de la línea. Dos paquetes del mismo producto no
 * colisionan; una línea contada v1 conserva el fallback histórico al productId. */
export const claveLineaCarrito = (linea: Pick<LineaGuardada, 'id'> & { cartLineId?: unknown }): string =>
    esTextoUtil(linea.cartLineId) ? linea.cartLineId : linea.id;

/** Solo pide confirmación dentro de una ventana corta. No es anti-replay
 * permanente: dos paquetes físicos pueden tener exactamente el mismo EAN. */
export const esReescaneoRapido = (params: {
    rawCode: string;
    ultimo: { rawCode: string; scannedAt: number } | null;
    ahoraMs: number;
    ventanaMs: number;
}): boolean => {
    if (!params.ultimo || params.rawCode !== params.ultimo.rawCode) return false;
    if (!esNumero(params.ahoraMs) || !esNumero(params.ultimo.scannedAt) || !esNumero(params.ventanaMs)) return false;
    const elapsed = params.ahoraMs - params.ultimo.scannedAt;
    return params.ventanaMs > 0 && elapsed >= 0 && elapsed <= params.ventanaMs;
};

export interface CarritoGuardado {
    v: number;
    /** A qué turno de caja pertenece esta venta a medias. */
    shiftId: string;
    guardadoEn: number;
    lineas: LineaGuardada[];
    /** Solo el id: el cliente se re-resuelve contra la lista viva. Si lo
     *  borraron, la venta sigue sin cliente en vez de arrastrar un fantasma. */
    clienteId: string | null;
    descuentoGlobal: string;
}

export type DecisionRestauracion =
    | 'RESTAURAR'  // misma venta, mismo turno: entra sola
    | 'OFRECER'    // de otro turno o vieja: se pregunta, no se asume
    | 'DESCARTAR'; // ilegible, vacía o de otro esquema

/** Clave namespaceada por tenant Y usuario: una pulpería tiene UNA máquina y
 *  dos cajeros por turno. Sin el userId, el segundo hereda el carrito del
 *  primero — que es el mismo bug que venimos a arreglar, disfrazado. */
export const claveCarrito = (tenantId: string, userId: string): string =>
    `nortex_cart_v${VERSION_CARRITO}:${tenantId}:${userId}`;

export const claveAparcados = (tenantId: string, userId: string): string =>
    `nortex_held_v${VERSION_CARRITO}:${tenantId}:${userId}`;

export const claveCarritoLegacy = (tenantId: string, userId: string): string =>
    `nortex_cart_v${VERSION_CARRITO_LEGACY}:${tenantId}:${userId}`;

export const claveAparcadosLegacy = (tenantId: string, userId: string): string =>
    `nortex_held_v${VERSION_CARRITO_LEGACY}:${tenantId}:${userId}`;

const esTextoUtil = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
// `Number.isFinite` no coacciona: false para strings, null, undefined y NaN.
// Un `typeof` extra delante solo agregaría una rama que nada puede distinguir.
const esNumero = (v: unknown): v is number => Number.isFinite(v);

/** Una línea sirve si tiene identidad, precio y cantidad legibles. Todo lo
 *  demás (mayoreo, empaque, descuento) es opcional y se preserva tal cual. */
const lineaValida = (l: unknown): l is LineaGuardada => {
    // Solo se ataja null: leer una propiedad de un primitivo devuelve undefined
    // (no lanza), así que un string o un número caen igual en los chequeos de
    // abajo. Un `typeof !== 'object'` delante sería una rama sin efecto.
    if (l === null) return false;
    const o = l as Record<string, unknown>;
    return esTextoUtil(o.id) && esNumero(o.price) && esNumero(o.quantity) && o.quantity > 0;
};

/**
 * Interpreta lo que había en el storage. NUNCA lanza: cualquier basura devuelve
 * `null` y el POS arranca con el carrito vacío, que es el comportamiento de hoy.
 */
export function leerCarritoGuardado(crudo: string | null): CarritoGuardado | null {
    // Sin guard previo a propósito: `JSON.parse(null)` devuelve null y
    // `JSON.parse('')` lanza — el try/catch y el chequeo de forma ya cubren
    // los dos casos. Un `if` extra sería una rama que ningún dato distingue.
    let dato: unknown;
    try {
        dato = JSON.parse(crudo as string);
    } catch {
        return null;
    }
    if (dato === null) return null;

    const o = dato as Record<string, unknown>;
    if (o.v !== VERSION_CARRITO && o.v !== VERSION_CARRITO_LEGACY) return null;
    if (!esTextoUtil(o.shiftId)) return null;
    if (!esNumero(o.guardadoEn)) return null;
    if (!Array.isArray(o.lineas)) return null;

    // Se filtran las líneas ilegibles en vez de tirar el carrito entero: si de
    // 8 productos uno vino corrupto, perder 7 sería el peor de los dos males.
    const lineas = o.lineas.filter(lineaValida);
    if (lineas.length === 0) return null;

    return {
        v: VERSION_CARRITO,
        shiftId: o.shiftId,
        guardadoEn: o.guardadoEn,
        lineas,
        clienteId: esTextoUtil(o.clienteId) ? o.clienteId : null,
        descuentoGlobal: esTextoUtil(o.descuentoGlobal) ? o.descuentoGlobal : '',
    };
}

/** Lo que se escribe al storage. Devuelve `null` cuando no hay nada que
 *  guardar, para que el llamador BORRE la clave en vez de dejar un `[]`. */
export function serializarCarrito(entrada: {
    shiftId: string | null;
    lineas: LineaGuardada[];
    clienteId: string | null;
    descuentoGlobal: string;
    ahoraMs: number;
}): string | null {
    if (!esTextoUtil(entrada.shiftId)) return null;
    const lineas = entrada.lineas.filter(lineaValida);
    if (lineas.length === 0) return null;

    const payload: CarritoGuardado = {
        v: VERSION_CARRITO,
        shiftId: entrada.shiftId as string,
        guardadoEn: entrada.ahoraMs,
        lineas,
        clienteId: esTextoUtil(entrada.clienteId) ? entrada.clienteId : null,
        descuentoGlobal: entrada.descuentoGlobal ?? '',
    };
    return JSON.stringify(payload);
}

/**
 * Qué hacer con lo que había guardado.
 *
 * `shiftIdActual` en `null` significa que no hay caja abierta: nada se restaura
 * solo, porque no hay turno al cual atribuir la venta.
 */
export function decidirRestauracion(params: {
    guardado: CarritoGuardado | null;
    shiftIdActual: string | null;
    ahoraMs: number;
}): DecisionRestauracion {
    const { guardado, shiftIdActual, ahoraMs } = params;
    if (!guardado) return 'DESCARTAR';

    // Valor absoluto a propósito: un `guardadoEn` en el FUTURO significa que el
    // reloj de la máquina cambió (pasa, y más en equipos de mostrador). Ahí no
    // se restaura en silencio — se pregunta.
    const edad = Math.abs(ahoraMs - guardado.guardadoEn);
    const mismoTurno = esTextoUtil(shiftIdActual) && guardado.shiftId === shiftIdActual;

    if (mismoTurno && edad <= ventanaFrescaMs()) return 'RESTAURAR';
    return 'OFRECER';
}

/* ── Carritos aparcados (F4) ───────────────────────────────────────────────
 *
 * `heldCarts` era `useState` puro, o sea que "Aparcar" perdía todo con F5
 * igual que el carrito. Arreglar uno y dejar el otro sería medio arreglo: el
 * diálogo de guarda ofrece "Aparcar y salir", y esa promesa tiene que ser
 * cierta. Se guardan con el turno adentro por el mismo motivo que el carrito.
 */

export interface AparcadoGuardado {
    id: string;
    label: string;
    shiftId: string;
    /** epoch ms — `Date` no sobrevive a JSON, así que se guarda el número. */
    heldAt: number;
    lineas: LineaGuardada[];
    clienteId: string | null;
    descuentoGlobal: string;
}

const aparcadoValido = (a: unknown): a is AparcadoGuardado => {
    if (a === null) return false;
    const o = a as Record<string, unknown>;
    if (!esTextoUtil(o.id) || !esTextoUtil(o.shiftId) || !esNumero(o.heldAt)) return false;
    return Array.isArray(o.lineas) && o.lineas.filter(lineaValida).length > 0;
};

export function leerAparcados(crudo: string | null): AparcadoGuardado[] {
    let dato: unknown;
    try {
        dato = JSON.parse(crudo as string);
    } catch {
        return [];
    }
    if (dato === null) return [];
    const o = dato as Record<string, unknown>;
    if (
        o.v !== VERSION_CARRITO
        && o.v !== VERSION_CARRITO_LEGACY
    ) return [];
    if (!Array.isArray(o.aparcados)) return [];

    return o.aparcados.filter(aparcadoValido).map(a => ({
        id: a.id,
        label: esTextoUtil(a.label) ? a.label : 'Carrito',
        shiftId: a.shiftId,
        heldAt: a.heldAt,
        lineas: a.lineas.filter(lineaValida),
        clienteId: esTextoUtil(a.clienteId) ? a.clienteId : null,
        descuentoGlobal: esTextoUtil(a.descuentoGlobal) ? a.descuentoGlobal : '',
    }));
}

export function serializarAparcados(aparcados: AparcadoGuardado[]): string | null {
    const utiles = aparcados.filter(aparcadoValido);
    if (utiles.length === 0) return null;
    return JSON.stringify({ v: VERSION_CARRITO, aparcados: utiles });
}

/**
 * Resumen para el aviso de recuperación ("2 productos · C$ 245.00").
 * Usa LA MISMA fórmula del total del carrito —descuento por línea y luego
 * descuento global— para que el número del aviso sea el número que el cajero
 * va a ver al recuperar. Un resumen que no cuadra destruye la confianza en el
 * aviso entero.
 */
export function resumenGuardado(guardado: CarritoGuardado): { lineas: number; total: Decimal } {
    const bruto = guardado.lineas.reduce((acc, l) => {
        const desc = esNumero(l.discount) ? new Decimal(l.discount) : new Decimal(0);
        const factor = new Decimal(1).minus(desc.div(100));
        return acc.plus(new Decimal(l.price).mul(l.quantity).mul(factor));
    }, new Decimal(0));

    const global = new Decimal(
        esTextoUtil(guardado.descuentoGlobal) && Number.isFinite(Number(guardado.descuentoGlobal))
            ? Number(guardado.descuentoGlobal)
            : 0
    );
    const total = bruto.mul(new Decimal(1).minus(global.div(100)));

    return { lineas: guardado.lineas.length, total: total.toDecimalPlaces(2) };
}
