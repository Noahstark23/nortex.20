import { describe, it, expect } from 'vitest';
import { evaluarLinea, evaluarCarrito, textoAviso, textoResumen, LineaCarrito } from '../utils/stockAlert';

/**
 * Aviso de existencias del carrito — números oro.
 *
 * Lo que estas pruebas defienden no es "que la función corra": es que el aviso
 * del mostrador sea CIERTO. Un aviso falso se aprende a ignorar en dos días, y
 * a partir de ahí el aviso verdadero tampoco se ve. Por eso hay tantos casos de
 * "acá NO se avisa" como de "acá SÍ".
 */

const linea = (p: Partial<LineaCarrito>): LineaCarrito =>
    ({ id: 'p1', name: 'Cemento Canal 42.5kg', quantity: 1, ...p });

describe('evaluarLinea — cuándo alcanza', () => {
    it('con stock de sobra no avisa nada', () => {
        const a = evaluarLinea(linea({ quantity: 2, stock: 10 }));
        expect(a.estado).toBe('OK');
        expect(a.faltante).toBe(0);
        expect(textoAviso(a)).toBeNull();
    });

    it('la cantidad EXACTA no dispara aviso (el borde justo alcanza)', () => {
        expect(evaluarLinea(linea({ quantity: 2, stock: 2 })).estado).toBe('OK');
    });

    it('absorbe el ruido de punto flotante sin avisar en falso', () => {
        // 0.1 + 0.2 === 0.30000000000000004 en JS.
        expect(evaluarLinea(linea({ quantity: 0.1 + 0.2, stock: 0.3 })).estado).toBe('OK');
    });

    it('pero una diferencia REAL de 0.01 sí se detecta', () => {
        const a = evaluarLinea(linea({ quantity: 2.01, stock: 2 }));
        expect(a.estado).toBe('INSUFICIENTE');
        expect(a.faltante).toBe(0.01);
    });
});

describe('evaluarLinea — cuando falta mercadería', () => {
    it('8 pedidas con 5 en sistema: faltan 3 y ofrece ajustar a 5', () => {
        const a = evaluarLinea(linea({ quantity: 8, stock: 5 }));
        expect(a.estado).toBe('INSUFICIENTE');
        expect(a.faltante).toBe(3);
        expect(a.ajustarA).toBe(5);
        expect(textoAviso(a)).toBe('Estás vendiendo 8 und y en el sistema solo hay 5.');
    });

    it('respeta las cantidades fraccionables y su unidad', () => {
        const a = evaluarLinea(linea({ quantity: 0.75, stock: 0.5, unit: 'kg' }));
        expect(a.faltante).toBe(0.25);
        expect(a.ajustarA).toBe(0.5);
        expect(textoAviso(a)).toContain('kg');
    });

    it('el ajuste redondea HACIA ABAJO: 2.999 propone 2.99, nunca 3', () => {
        const a = evaluarLinea(linea({ quantity: 5, stock: 2.999 }));
        expect(a.ajustarA).toBe(2.99);
        expect(a.ajustarA as number).toBeLessThanOrEqual(a.disponible as number);
    });

    it('si el piso a 2 decimales deja 0, no hay ajuste posible', () => {
        const a = evaluarLinea(linea({ quantity: 1, stock: 0.004 }));
        expect(a.estado).toBe('INSUFICIENTE');
        expect(a.ajustarA).toBeNull();
    });

    it('el texto nombra la cantidad pedida y la disponible, no una sola', () => {
        const t = textoAviso(evaluarLinea(linea({ quantity: 8, stock: 5 }))) as string;
        expect(t).toContain('8');
        expect(t).toContain('5');
    });
});

describe('evaluarLinea — sin existencia y en negativo', () => {
    it('stock 0: sin existencia, sin ajuste posible', () => {
        const a = evaluarLinea(linea({ quantity: 1, stock: 0 }));
        expect(a.estado).toBe('SIN_EXISTENCIA');
        expect(a.faltante).toBe(1);
        expect(a.ajustarA).toBeNull();
        expect(textoAviso(a)).toBe('Sin existencia en el sistema. Estás vendiendo 1 und.');
    });

    it('stock negativo NO se maquilla a cero: se muestra el −3 tal cual', () => {
        const a = evaluarLinea(linea({ quantity: 1, stock: -3 }));
        expect(a.estado).toBe('SIN_EXISTENCIA');
        expect(a.disponible).toBe(-3);
        expect(a.faltante).toBe(4); // pedido − disponible
        const t = textoAviso(a) as string;
        expect(t).toContain('-3');
        expect(t).toContain('ya se vendió más de lo que había');
    });
});

describe('evaluarLinea — jamás inventa un aviso', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['NaN', NaN],
        ['Infinity', Infinity],
    ])('stock %s queda DESCONOCIDO y no pinta nada', (_etiqueta, valor) => {
        const a = evaluarLinea(linea({ quantity: 5, stock: valor as number | null | undefined }));
        expect(a.estado).toBe('DESCONOCIDO');
        expect(a.disponible).toBeNull();
        expect(textoAviso(a)).toBeNull();
    });

    it('cantidad 0 no reclama nada aunque el stock esté en negativo', () => {
        expect(evaluarLinea(linea({ quantity: 0, stock: -5 })).estado).toBe('OK');
    });

    it('sin unidad declarada usa "und"', () => {
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: '' })).unidad).toBe('und');
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: null })).unidad).toBe('und');
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: undefined })).unidad).toBe('und');
        // Solo espacios también cae al default (por eso hay `.trim()`).
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: '   ' })).unidad).toBe('und');
    });

    it('conserva la unidad declarada y le saca los espacios de los lados', () => {
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: 'qq' })).unidad).toBe('qq');
        expect(evaluarLinea(linea({ quantity: 1, stock: 5, unit: '  kg ' })).unidad).toBe('kg');
    });
});

describe('evaluarCarrito', () => {
    it('carrito vacío: nada que avisar', () => {
        const r = evaluarCarrito([]);
        expect(r.hayProblema).toBe(false);
        expect(r.productosConProblema).toBe(0);
        expect(textoResumen(r, false)).toBeNull();
    });

    it('cuenta solo las líneas con problema real y suma las unidades faltantes', () => {
        const r = evaluarCarrito([
            linea({ id: 'a', name: 'Cemento', quantity: 8, stock: 5 }),   // faltan 3
            linea({ id: 'b', name: 'Clavo 2"', quantity: 2, stock: 50 }), // alcanza
            linea({ id: 'c', name: 'Zinc', quantity: 1, stock: -3 }),     // faltan 4
            linea({ id: 'd', name: 'Pala', quantity: 1, stock: null }),   // desconocido
        ]);
        expect(r.avisos).toHaveLength(4);
        expect(r.productosConProblema).toBe(2);
        expect(r.unidadesFaltantes).toBe(7);
        expect(r.conProblema.map(a => a.id)).toEqual(['a', 'c']);
    });
});

/**
 * OJO con el alcance de las pruebas de mutación: Stryker activa el mutante en
 * RUNTIME, durante la ejecución de cada `it`. Todo lo que se calcule en el
 * cuerpo de un `describe` corre en la fase de colección, ANTES de que el
 * mutante exista, y queda congelado con el código sano — el test asserta sobre
 * un valor limpio y el mutante sobrevive. Por eso acá cada caso se construye
 * DENTRO de su `it`, aunque se repita: es la diferencia entre una red que mata
 * bugs y una que solo se ve verde.
 */
const carritoDeUnaLinea = () => evaluarCarrito([linea({ quantity: 8, stock: 5 })]);

describe('textoResumen — dice la consecuencia REAL, no una genérica', () => {
    it('con la política estricta avisa que la venta se RECHAZA', () => {
        const t = textoResumen(carritoDeUnaLinea(), false) as string;
        expect(t).toContain('se va a rechazar');
        expect(t).not.toContain('Podés cobrar');
    });

    it('con backorder activo avisa que el inventario queda en NEGATIVO', () => {
        const t = textoResumen(carritoDeUnaLinea(), true) as string;
        expect(t).toContain('Podés cobrar');
        expect(t).toContain('negativo');
        expect(t).not.toContain('rechazar');
    });

    it('sin saber la política, avisa el hecho y no promete consecuencia', () => {
        const t = textoResumen(carritoDeUnaLinea(), null) as string;
        expect(t).not.toContain('rechazar');
        expect(t).not.toContain('negativo');
        expect(t).toContain('menos existencia de la que estás vendiendo');
    });

    it('concuerda en singular y plural', () => {
        // Anclado con el espacio siguiente a propósito: `/^1 producto tiene/` a
        // secas también matchea "1 producto tienen", y dejaba pasar el bug de
        // concordancia (lo confirmó un mutante que sobrevivía con esa versión).
        expect(textoResumen(carritoDeUnaLinea(), false)).toMatch(/^1 producto tiene /);
        expect(textoResumen(carritoDeUnaLinea(), false)).not.toMatch(/tienen/);
        const dos = evaluarCarrito([linea({ id: 'a', quantity: 8, stock: 5 }), linea({ id: 'b', quantity: 2, stock: 0 })]);
        expect(textoResumen(dos, false)).toMatch(/^2 productos tienen /);
    });
});

describe('invariantes sobre una malla de casos', () => {
    // Función, no constante: ver la nota de arriba sobre la fase de colección.
    const malla = () => {
        const stocks = [-10, -3, -0.5, 0, 0.004, 0.5, 2, 2.999, 5, 100];
        const cantidades = [0.01, 0.5, 1, 2, 2.01, 8, 50];
        return stocks.flatMap(s => cantidades.map(q => evaluarLinea(linea({ quantity: q, stock: s, unit: 'und' }))));
    };

    it('OK y DESCONOCIDO nunca generan texto de aviso', () => {
        const casos = malla();
        const violan = casos.filter(a => (a.estado === 'OK' || a.estado === 'DESCONOCIDO') && textoAviso(a) !== null);
        expect(violan).toEqual([]);
    });

    it('todo aviso tiene faltante estrictamente positivo', () => {
        const casos = malla();
        const violan = casos.filter(a => a.estado !== 'OK' && a.estado !== 'DESCONOCIDO' && !(a.faltante > 0));
        expect(violan).toEqual([]);
    });

    it('todo ajuste propuesto es vendible y nunca excede lo disponible', () => {
        const casos = malla();
        const violan = casos.filter(a => a.ajustarA !== null && !(a.ajustarA > 0 && a.ajustarA <= (a.disponible as number)));
        expect(violan).toEqual([]);
    });

    it('nunca declara OK cuando de verdad no alcanza', () => {
        const casos = malla();
        const violan = casos.filter(a => a.estado === 'OK' && a.pedido > 0 && (a.disponible as number) < a.pedido - 1e-6);
        expect(violan).toEqual([]);
    });

    it('nunca declara falta cuando sí alcanza', () => {
        const casos = malla();
        const violan = casos.filter(a => a.estado !== 'OK' && a.estado !== 'DESCONOCIDO' && (a.disponible as number) >= a.pedido);
        expect(violan).toEqual([]);
    });
});
