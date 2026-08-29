import { describe, it, expect } from 'vitest';
import {
    normalizar,
    indexarProductos,
    buscarProductos,
    resolverEnterBusqueda,
    ProductoBuscable,
} from '../utils/posSearch';

/**
 * Búsqueda del catálogo del POS — números oro.
 *
 * Lo que se defiende: que la grilla deje de pintar mil tarjetas SIN mentir
 * sobre lo que dejó afuera, y que el camino del escáner (SKU exacto) siga
 * ganándole a cualquier coincidencia parcial. Una lista recortada en silencio
 * se lee como "esto es todo lo que tengo", y en un inventario eso hace que el
 * dueño vuelva a comprar algo que ya tiene.
 *
 * Los casos se arman DENTRO de cada `it`: Stryker activa el mutante en runtime,
 * así que lo calculado en el cuerpo del `describe` correría sin mutante.
 */

const p = (id: string, name: string, sku: string, category = 'General'): ProductoBuscable =>
    ({ id, name, sku, category });

const catalogo = (): ProductoBuscable[] => [
    p('1', 'Cemento Canal 42.5kg', 'CEM-001', 'Construcción'),
    p('2', 'Clavo de 2 pulgadas', 'CLA-002', 'Ferretería'),
    p('3', 'Bombón de fresa', 'BOM-003', 'Confitería'),
    p('4', 'Lámina de zinc', 'ZIN-004', 'Construcción'),
    p('5', 'Pala jardinera', 'PAL-005', 'Ferretería'),
];

describe('normalizar', () => {
    it('baja a minúsculas y saca las tildes', () => {
        expect(normalizar('BOMBÓN')).toBe('bombon');
        expect(normalizar('Construcción')).toBe('construccion');
        expect(normalizar('Lámina')).toBe('lamina');
    });

    it('recorta los espacios de los bordes', () => {
        expect(normalizar('  cemento  ')).toBe('cemento');
    });

    it('no se cae con vacío ni con nulo', () => {
        expect(normalizar('')).toBe('');
        expect(normalizar(null as never)).toBe('');
        expect(normalizar(undefined as never)).toBe('');
    });

    it('pliega la ñ a n A PROPÓSITO, para que "pina" encuentre "piña"', () => {
        // Se aplica al término Y al índice, así que el emparejamiento es
        // simétrico: quien escribe rápido sin ñ igual encuentra el producto.
        // El falso positivo (buscar "cana" y ver "caña") es inofensivo: el
        // nombre completo está a la vista en la tarjeta.
        expect(normalizar('piña')).toBe('pina');
        expect(normalizar('caña')).toBe('cana');
    });

    it('y por eso "pina" encuentra "piña" en el catálogo', () => {
        const i = indexarProductos([{ id: '1', name: 'Jugo de piña', sku: 'JUG-1' }]);
        expect(buscarProductos(i, 'pina', 60).visibles).toHaveLength(1);
        expect(buscarProductos(i, 'piña', 60).visibles).toHaveLength(1);
    });
});

describe('buscarProductos — sin término', () => {
    it('devuelve el catálogo recortado al tope y DECLARA lo que ocultó', () => {
        const r = buscarProductos(indexarProductos(catalogo()), '', 2);
        expect(r.visibles).toHaveLength(2);
        expect(r.total).toBe(5);
        expect(r.ocultos).toBe(3);
    });

    it('si entran todos, no oculta nada', () => {
        const r = buscarProductos(indexarProductos(catalogo()), '', 50);
        expect(r.visibles).toHaveLength(5);
        expect(r.ocultos).toBe(0);
    });

    it('tope 0 o negativo = sin recorte', () => {
        expect(buscarProductos(indexarProductos(catalogo()), '', 0).visibles).toHaveLength(5);
        expect(buscarProductos(indexarProductos(catalogo()), '', -1).visibles).toHaveLength(5);
    });

    it('un término de solo espacios es lo mismo que no buscar', () => {
        const r = buscarProductos(indexarProductos(catalogo()), '   ', 50);
        expect(r.total).toBe(5);
        expect(r.coincidenciaExacta).toBe(false);
    });
});

describe('buscarProductos — el SKU exacto manda', () => {
    it('un SKU exacto devuelve ESE producto y nada más', () => {
        const r = buscarProductos(indexarProductos(catalogo()), 'CEM-001', 60);
        expect(r.visibles.map(v => v.id)).toEqual(['1']);
        expect(r.coincidenciaExacta).toBe(true);
        expect(r.total).toBe(1);
        expect(r.ocultos).toBe(0);
    });

    it('el SKU no distingue mayúsculas (se teclea como salga)', () => {
        expect(buscarProductos(indexarProductos(catalogo()), 'cem-001', 60).visibles[0].id).toBe('1');
    });

    it('el SKU exacto gana aunque el término también aparezca en otros nombres', () => {
        const lista = [...catalogo(), p('9', 'Repuesto para CEM-001', 'REP-009')];
        const r = buscarProductos(indexarProductos(lista), 'CEM-001', 60);
        expect(r.visibles.map(v => v.id)).toEqual(['1']);
        expect(r.coincidenciaExacta).toBe(true);
    });

    it('un producto con SKU en blanco no secuestra la búsqueda vacía', () => {
        // Sin el guard de término vacío, `normalizar('') === normalizar('')`
        // haría que ese producto fuera "la coincidencia exacta" de no buscar
        // nada, y la grilla mostraría UN producto en vez del catálogo.
        const lista = [...catalogo(), p('9', 'Producto sin código', '')];
        const r = buscarProductos(indexarProductos(lista), '', 60);
        expect(r.total).toBe(6);
        expect(r.coincidenciaExacta).toBe(false);
    });

    it('un SKU parcial NO es exacto: cae a la búsqueda difusa', () => {
        const r = buscarProductos(indexarProductos(catalogo()), 'CEM', 60);
        expect(r.coincidenciaExacta).toBe(false);
        expect(r.visibles.map(v => v.id)).toEqual(['1']);
    });
});

describe('buscarProductos — búsqueda difusa', () => {
    it('encuentra por nombre', () => {
        expect(buscarProductos(indexarProductos(catalogo()), 'clavo', 60).visibles.map(v => v.id)).toEqual(['2']);
    });

    it('encuentra por categoría', () => {
        expect(buscarProductos(indexarProductos(catalogo()), 'construccion', 60).visibles.map(v => v.id)).toEqual(['1', '4']);
    });

    it('encuentra sin tildes lo que está cargado CON tildes', () => {
        // El mismo producto llega como "bombón" a mano y "bombon" desde Excel.
        expect(buscarProductos(indexarProductos(catalogo()), 'bombon', 60).visibles.map(v => v.id)).toEqual(['3']);
        expect(buscarProductos(indexarProductos(catalogo()), 'BOMBÓN', 60).visibles.map(v => v.id)).toEqual(['3']);
    });

    it('todas las palabras tienen que aparecer, en cualquier orden', () => {
        const i = indexarProductos(catalogo());
        expect(buscarProductos(i, 'clavo pulgadas', 60).visibles.map(v => v.id)).toEqual(['2']);
        expect(buscarProductos(i, 'pulgadas clavo', 60).visibles.map(v => v.id)).toEqual(['2']);
        expect(buscarProductos(i, 'clavo cemento', 60).visibles).toEqual([]);
    });

    it('las palabras se separan por espacio, NO por letra', () => {
        // Partir por letra haría que "zc" encontrara "Lámina de zinc" (tiene z y
        // c sueltas). Buscar dos letras que no forman una palabra no debe traer
        // nada.
        expect(buscarProductos(indexarProductos(catalogo()), 'zc', 60).visibles).toEqual([]);
        expect(buscarProductos(indexarProductos(catalogo()), 'zinc', 60).visibles.map(v => v.id)).toEqual(['4']);
    });

    it('sin coincidencias devuelve vacío, no el catálogo entero', () => {
        const r = buscarProductos(indexarProductos(catalogo()), 'motosierra', 60);
        expect(r.visibles).toEqual([]);
        expect(r.total).toBe(0);
        expect(r.ocultos).toBe(0);
    });

    it('también recorta los resultados de la búsqueda, y lo declara', () => {
        const muchos = Array.from({ length: 100 }, (_, n) => p(`${n}`, `Clavo modelo ${n}`, `CLA-${n}`));
        const r = buscarProductos(indexarProductos(muchos), 'clavo', 60);
        expect(r.visibles).toHaveLength(60);
        expect(r.total).toBe(100);
        expect(r.ocultos).toBe(40);
    });

    it('conserva el orden del catálogo (no reordena por relevancia inventada)', () => {
        const r = buscarProductos(indexarProductos(catalogo()), 'a', 60);
        const ids = r.visibles.map(v => v.id);
        expect(ids).toEqual([...ids].sort((x, y) => Number(x) - Number(y)));
    });
});

describe('indexarProductos', () => {
    it('normaliza nombre, SKU y categoría en un solo texto', () => {
        const i = indexarProductos([p('1', 'Lámina de Zinc', 'ZIN-004', 'Construcción')]);
        expect(i[0].texto).toBe('lamina de zinc zin-004 construccion');
    });

    it('un producto sin categoría no rompe el índice', () => {
        const i = indexarProductos([{ id: '1', name: 'Pala', sku: 'PAL-1' }]);
        expect(i[0].texto).toBe('pala pal-1');
        expect(buscarProductos(i, 'pala', 60).visibles).toHaveLength(1);
    });

    it('catálogo vacío: no lanza y no inventa resultados', () => {
        const r = buscarProductos(indexarProductos([]), 'lo que sea', 60);
        expect(r.visibles).toEqual([]);
        expect(r.total).toBe(0);
    });
});

describe('resolverEnterBusqueda', () => {
    it('selecciona un SKU exacto aunque otras líneas contengan el mismo texto', () => {
        const lista = [...catalogo(), p('9', 'Repuesto CEM-001', 'REP-009')];
        expect(resolverEnterBusqueda(indexarProductos(lista), 'cem-001')).toEqual({
            kind: 'select',
            product: lista[0],
        });
    });

    it('selecciona una coincidencia difusa solo cuando es única', () => {
        const lista = catalogo();
        expect(resolverEnterBusqueda(indexarProductos(lista), 'bombon')).toEqual({
            kind: 'select',
            product: lista[2],
        });
    });

    it('no adivina entre varias coincidencias', () => {
        expect(resolverEnterBusqueda(indexarProductos(catalogo()), 'construccion')).toEqual({
            kind: 'ambiguous',
            total: 2,
        });
    });

    it('declara cuando no hay coincidencias', () => {
        expect(resolverEnterBusqueda(indexarProductos(catalogo()), 'motosierra')).toEqual({ kind: 'none' });
    });
});

describe('invariantes', () => {
    it('nunca se muestran más productos que el tope', () => {
        const muchos = Array.from({ length: 500 }, (_, n) => p(`${n}`, `Producto ${n}`, `SKU-${n}`));
        const i = indexarProductos(muchos);
        for (const tope of [1, 5, 24, 60, 499, 500, 501]) {
            for (const termino of ['', 'producto', 'SKU-3']) {
                const r = buscarProductos(i, termino, tope);
                expect(r.visibles.length).toBeLessThanOrEqual(tope);
            }
        }
    });

    it('visibles + ocultos siempre da el total real', () => {
        const muchos = Array.from({ length: 500 }, (_, n) => p(`${n}`, `Producto ${n}`, `SKU-${n}`));
        const i = indexarProductos(muchos);
        for (const tope of [1, 24, 60, 1000]) {
            for (const termino of ['', 'producto', 'nada']) {
                const r = buscarProductos(i, termino, tope);
                expect(r.visibles.length + r.ocultos).toBe(r.total);
            }
        }
    });

    it('lo visible es siempre un prefijo de lo que coincide', () => {
        const muchos = Array.from({ length: 120 }, (_, n) => p(`${n}`, `Clavo ${n}`, `CLA-${n}`));
        const i = indexarProductos(muchos);
        const completo = buscarProductos(i, 'clavo', 0).visibles;
        const recortado = buscarProductos(i, 'clavo', 30).visibles;
        expect(recortado).toEqual(completo.slice(0, 30));
    });
});
