/**
 * Búsqueda del catálogo del POS — lógica PURA (sin React, sin fetch).
 *
 * EL PROBLEMA (auditoría UX del POS, P0-2): la grilla renderizaba el catálogo
 * COMPLETO. Medido en vivo con 1,003 productos: 6,502 nodos DOM, 1,009 botones,
 * y un long task de 105 ms al limpiar el filtro — en un escritorio rápido. En la
 * tablet Android barata de una pulpería ese mismo re-render cuesta bastante más,
 * y ocurre DESPUÉS DE CADA VENTA, porque al cerrar la venta se limpia el filtro
 * y se vuelven a pintar los 1,003.
 *
 * Un cajero no navega mil tarjetas: escanea, o escribe. Así que la grilla deja
 * de ser un catálogo y pasa a ser un resultado de búsqueda.
 *
 * REGLA QUE ESTE MÓDULO DEFIENDE: **el recorte SIEMPRE se declara**. Cada
 * respuesta trae cuántos productos hay de verdad y cuántos se están mostrando.
 * Una lista cortada en silencio se lee como "esto es todo lo que tengo", y en un
 * inventario eso es una mentira cara: el dueño concluye que un producto no
 * existe y lo vuelve a comprar.
 */

export interface ProductoBuscable {
    id: string;
    name: string;
    sku: string;
    category?: string;
}

export interface EntradaIndice<T> {
    producto: T;
    /** name + sku + category, normalizado UNA vez al construir el índice.
     *  Antes esto se rearmaba para cada producto en CADA tecla. */
    texto: string;
}

export interface ResultadoBusqueda<T> {
    /** Lo que se va a pintar. Nunca más largo que el tope. */
    visibles: T[];
    /** Cuántos coinciden de verdad. */
    total: number;
    /** Cuántos quedaron afuera por el tope (0 si entran todos). */
    ocultos: number;
    /** true cuando el término es un SKU exacto: la respuesta es UN producto. */
    coincidenciaExacta: boolean;
}

export type ResolucionEnterBusqueda<T> =
    | { kind: 'select'; product: T }
    | { kind: 'ambiguous'; total: number }
    | { kind: 'none' };

/**
 * Minúsculas y sin tildes. Un catálogo nica se carga a mano y desde Excel: el
 * mismo producto aparece como "bombón", "bombon" y "BOMBON". Buscar "bombon"
 * tiene que encontrarlos a los tres.
 *
 * OJO — esto también pliega la Ñ a N ("piña" → "pina"), y es DELIBERADO: se
 * aplica al término y al índice por igual, así que "pina" encuentra "piña" y
 * viceversa. En un buscador de mostrador eso es lo que se quiere; el falso
 * positivo (buscar "cana" y ver "caña") es inofensivo porque el nombre completo
 * está a la vista en la tarjeta.
 * Esta función es SOLO para emparejar. Nunca usarla para mostrar ni para
 * comparar identidades: ahí "caña" y "cana" son cosas distintas.
 */
export function normalizar(texto: string): string {
    return (texto ?? '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/** Índice construido UNA vez por catálogo, no por tecla. */
export function indexarProductos<T extends ProductoBuscable>(productos: T[]): EntradaIndice<T>[] {
    return productos.map(p => ({
        producto: p,
        texto: normalizar(`${p.name} ${p.sku} ${p.category ?? ''}`),
    }));
}

/**
 * Busca y RECORTA, declarando siempre lo que dejó afuera.
 *
 * `tope <= 0` significa sin recorte (se usa para el caso de un solo resultado).
 */
export function buscarProductos<T extends ProductoBuscable>(
    indice: EntradaIndice<T>[],
    termino: string,
    tope: number,
): ResultadoBusqueda<T> {
    const limpio = normalizar(termino);

    // SKU exacto primero: es el camino del escáner y del código tecleado a mano,
    // y tiene que ganarle a cualquier coincidencia parcial.
    // El guard de término vacío NO es decorativo: un catálogo cargado a mano
    // puede tener un producto con el SKU en blanco, y sin él la búsqueda vacía
    // devolvería ESE producto en vez del catálogo.
    if (limpio !== '') {
        const exacto = indice.find(e => normalizar(e.producto.sku) === limpio);
        if (exacto) {
            return { visibles: [exacto.producto], total: 1, ocultos: 0, coincidenciaExacta: true };
        }
    }

    // Difusa: TODAS las palabras tienen que aparecer, en cualquier orden —
    // "clavo 2" y "2 clavo" encuentran lo mismo. Sin término, `palabras` queda
    // vacío y `every` da true para todos: eso ES "mostrame el catálogo", así que
    // no hace falta una rama aparte para el caso sin búsqueda.
    const palabras = limpio.split(' ');
    const encontrados: T[] = [];
    for (const e of indice) {
        if (palabras.every(t => e.texto.includes(t))) encontrados.push(e.producto);
    }
    return recortar(encontrados, tope, false);
}

/**
 * Decide qué puede hacer Enter sin vender el producto equivocado.
 *
 * Un SKU exacto y una búsqueda con un único resultado son intenciones
 * inequívocas. Cuando hay varias coincidencias, el cajero debe tocar la fila
 * correcta: elegir silenciosamente la primera puede descontar otro inventario.
 */
export function resolverEnterBusqueda<T extends ProductoBuscable>(
    indice: EntradaIndice<T>[],
    termino: string,
): ResolucionEnterBusqueda<T> {
    const resultado = buscarProductos(indice, termino, 2);
    if (resultado.coincidenciaExacta || resultado.total === 1) {
        return { kind: 'select', product: resultado.visibles[0] };
    }
    if (resultado.total === 0) return { kind: 'none' };
    return { kind: 'ambiguous', total: resultado.total };
}

function recortar<T>(lista: T[], tope: number, exacta: boolean): ResultadoBusqueda<T> {
    const total = lista.length;
    const visibles = tope > 0 ? lista.slice(0, tope) : lista;
    // `ocultos` se deriva de lo que quedó, no se calcula aparte: así no puede
    // desincronizarse de `visibles` y prometer un recorte que no ocurrió.
    return { visibles, total, ocultos: total - visibles.length, coincidenciaExacta: exacta };
}
