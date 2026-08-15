import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
    VERSION_CARRITO,
    claveCarrito,
    claveAparcados,
    leerCarritoGuardado,
    serializarCarrito,
    decidirRestauracion,
    resumenGuardado,
    leerAparcados,
    serializarAparcados,
    CarritoGuardado,
} from '../utils/cartPersistence';

/**
 * Persistencia del carrito — números oro.
 *
 * Lo que se defiende acá no es "que guarde": es que una venta a medias NUNCA
 * aparezca en el turno equivocado, y que un dato ilegible no se convierta en un
 * carrito fantasma. Perder un carrito es malo; cobrar el carrito de otro turno
 * descuadra un arqueo y eso ya es plata.
 *
 * NOTA sobre pruebas de mutación: Stryker activa el mutante en RUNTIME, dentro
 * de cada `it`. Todo lo que se calcule en el cuerpo de un `describe` corre en la
 * fase de colección, ANTES del mutante, y las aserciones pasarían sobre datos
 * sanos sin matar nada. Por eso cada caso se arma dentro de su `it`.
 */

const AHORA = 1_760_000_000_000; // epoch fijo: Date.now() haría el test no determinista
const HORA = 60 * 60 * 1000;

const guardado = (p: Partial<CarritoGuardado> = {}): CarritoGuardado => ({
    v: VERSION_CARRITO,
    shiftId: 'turno-1',
    guardadoEn: AHORA,
    lineas: [{ id: 'p1', name: 'Cemento', price: 420, quantity: 2 }],
    clienteId: null,
    descuentoGlobal: '',
    ...p,
});

describe('claves de storage', () => {
    it('namespacea por tenant Y usuario (dos cajeros, una sola máquina)', () => {
        expect(claveCarrito('t1', 'u1')).not.toBe(claveCarrito('t1', 'u2'));
        expect(claveCarrito('t1', 'u1')).not.toBe(claveCarrito('t2', 'u1'));
    });

    it('el carrito y los aparcados no comparten clave', () => {
        expect(claveCarrito('t1', 'u1')).not.toBe(claveAparcados('t1', 'u1'));
    });

    it('la clave es exactamente la esperada (un prefijo mutado se detecta)', () => {
        expect(claveCarrito('t1', 'u1')).toBe(`nortex_cart_v${VERSION_CARRITO}:t1:u1`);
        expect(claveAparcados('t1', 'u1')).toBe(`nortex_held_v${VERSION_CARRITO}:t1:u1`);
    });

    it('jamás colisiona con nortex_pending_cart, que es otro mecanismo', () => {
        // Esa clave es un traspaso de un solo uso (demo y cotizaciones) que el
        // POS consume y borra al montar. Pisarla rompería convertir cotizaciones.
        expect(claveCarrito('t1', 'u1')).not.toContain('nortex_pending_cart');
        expect(claveAparcados('t1', 'u1')).not.toContain('nortex_pending_cart');
    });
});

describe('leerCarritoGuardado — basura adentro, null afuera', () => {
    it.each([
        ['null', null],
        ['vacío', ''],
        ['solo espacios', '   '],
        ['no es JSON', '{roto'],
        ['JSON que no es objeto', '"hola"'],
        ['array suelto', '[]'],
        ['literal null', 'null'],
        ['objeto vacío', '{}'],
    ])('descarta %s sin lanzar', (_etiqueta, crudo) => {
        expect(leerCarritoGuardado(crudo as string | null)).toBeNull();
    });

    it('descarta otra versión de esquema en vez de hidratar campos que ya no son', () => {
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), v: VERSION_CARRITO + 1 }))).toBeNull();
    });

    it('exige turno: una venta sin turno no se puede atribuir a nadie', () => {
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), shiftId: '' }))).toBeNull();
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), shiftId: 42 }))).toBeNull();
    });

    it('exige marca de tiempo numérica', () => {
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), guardadoEn: 'ayer' }))).toBeNull();
    });

    it('descarta un carrito sin líneas útiles', () => {
        expect(leerCarritoGuardado(JSON.stringify(guardado({ lineas: [] })))).toBeNull();
        expect(leerCarritoGuardado(JSON.stringify(guardado({ lineas: [{ basura: true }] as never })))).toBeNull();
    });

    it('una línea que ni siquiera es objeto se descarta (null, string, número)', () => {
        const crudo = JSON.stringify(guardado({ lineas: [null, 'p1', 7, []] as never }));
        expect(leerCarritoGuardado(crudo)).toBeNull();
    });

    it('un shiftId de solo espacios no es un turno', () => {
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), shiftId: '   ' }))).toBeNull();
    });

    it('lineas que no es arreglo se descarta', () => {
        expect(leerCarritoGuardado(JSON.stringify({ ...guardado(), lineas: 'muchas' }))).toBeNull();
    });
});

describe('leerCarritoGuardado — rescata lo que se puede', () => {
    it('filtra la línea corrupta y conserva las sanas (perder 7 por 1 sería peor)', () => {
        const crudo = JSON.stringify(guardado({
            lineas: [
                { id: 'p1', name: 'Cemento', price: 420, quantity: 2 },
                { id: '', name: 'Sin id', price: 10, quantity: 1 },
                { id: 'p3', name: 'Sin precio', price: NaN as never, quantity: 1 },
                { id: 'p4', name: 'Cantidad cero', price: 10, quantity: 0 },
                { id: 'p5', name: 'Clavo', price: 3.5, quantity: 10 },
            ] as never,
        }));
        const leido = leerCarritoGuardado(crudo);
        expect(leido?.lineas.map(l => l.id)).toEqual(['p1', 'p5']);
    });

    it('preserva los campos extra de la línea (mayoreo, empaque, basePrice)', () => {
        const crudo = JSON.stringify(guardado({
            lineas: [{
                id: 'p1', name: 'Gaseosa', price: 18, quantity: 12,
                basePrice: 22, discount: 5, unit: 'und',
                wholesalePrice: 18, wholesaleMinQty: 12, packSize: 12, packUnit: 'caja',
            }] as never,
        }));
        const l = leerCarritoGuardado(crudo)?.lineas[0] as Record<string, unknown>;
        // basePrice es el que permite volver del mayoreo al bajar la cantidad.
        expect(l.basePrice).toBe(22);
        expect(l.wholesaleMinQty).toBe(12);
        expect(l.packUnit).toBe('caja');
    });

    it('normaliza clienteId y descuentoGlobal cuando vienen mal', () => {
        const crudo = JSON.stringify(guardado({ clienteId: 99 as never, descuentoGlobal: null as never }));
        const leido = leerCarritoGuardado(crudo);
        expect(leido?.clienteId).toBeNull();
        expect(leido?.descuentoGlobal).toBe('');
    });

    it('un clienteId de solo espacios se normaliza a null, no a "   "', () => {
        const leido = leerCarritoGuardado(JSON.stringify(guardado({ clienteId: '   ' })));
        expect(leido?.clienteId).toBeNull();
    });

    it('un descuentoGlobal de solo espacios se normaliza a vacío', () => {
        const leido = leerCarritoGuardado(JSON.stringify(guardado({ descuentoGlobal: '  ' })));
        expect(leido?.descuentoGlobal).toBe('');
    });
});

describe('serializarCarrito', () => {
    it('sin turno no guarda nada (el llamador debe BORRAR la clave)', () => {
        expect(serializarCarrito({ shiftId: null, lineas: [{ id: 'p1', name: 'x', price: 1, quantity: 1 }], clienteId: null, descuentoGlobal: '', ahoraMs: AHORA })).toBeNull();
    });

    it('carrito vacío no guarda nada', () => {
        expect(serializarCarrito({ shiftId: 't1', lineas: [], clienteId: null, descuentoGlobal: '', ahoraMs: AHORA })).toBeNull();
    });

    it('un turno de solo espacios tampoco alcanza', () => {
        expect(serializarCarrito({ shiftId: '   ', lineas: [{ id: 'p1', name: 'x', price: 1, quantity: 1 }], clienteId: null, descuentoGlobal: '', ahoraMs: AHORA })).toBeNull();
    });

    it('descarta las líneas inválidas al guardar, no solo al leer', () => {
        const crudo = serializarCarrito({
            shiftId: 't1',
            lineas: [{ id: 'p1', name: 'ok', price: 5, quantity: 1 }, { id: '', name: 'mala', price: 5, quantity: 1 }] as never,
            clienteId: null, descuentoGlobal: '', ahoraMs: AHORA,
        });
        // Se mira el JSON crudo, NO lo que devuelve el lector: el lector vuelve
        // a filtrar y taparía que el filtro de escritura no hizo nada.
        expect(JSON.parse(crudo as string).lineas).toHaveLength(1);
    });

    it('sin descuentoGlobal guarda vacío en vez de undefined', () => {
        const crudo = serializarCarrito({
            shiftId: 't1', lineas: [{ id: 'p1', name: 'x', price: 1, quantity: 1 }],
            clienteId: null, descuentoGlobal: undefined as never, ahoraMs: AHORA,
        });
        expect(leerCarritoGuardado(crudo)?.descuentoGlobal).toBe('');
    });

    it('un clienteId de solo espacios no se guarda como cliente', () => {
        const crudo = serializarCarrito({
            shiftId: 't1', lineas: [{ id: 'p1', name: 'x', price: 1, quantity: 1 }],
            clienteId: '   ', descuentoGlobal: '', ahoraMs: AHORA,
        });
        expect(leerCarritoGuardado(crudo)?.clienteId).toBeNull();
    });

    it('ida y vuelta: lo que se guarda es lo que se lee', () => {
        const crudo = serializarCarrito({
            shiftId: 'turno-9',
            lineas: [{ id: 'p1', name: 'Cemento', price: 420, quantity: 2, basePrice: 430, discount: 10 }],
            clienteId: 'cli-1',
            descuentoGlobal: '5',
            ahoraMs: AHORA,
        });
        const leido = leerCarritoGuardado(crudo);
        expect(leido?.shiftId).toBe('turno-9');
        expect(leido?.guardadoEn).toBe(AHORA);
        expect(leido?.clienteId).toBe('cli-1');
        expect(leido?.descuentoGlobal).toBe('5');
        expect(leido?.lineas[0].basePrice).toBe(430);
    });
});

describe('decidirRestauracion — nunca en el turno equivocado', () => {
    it('mismo turno y reciente: entra sola, es la misma venta', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA + 5000 })).toBe('RESTAURAR');
    });

    it('OTRO turno: se ofrece, jamás se asume', () => {
        expect(decidirRestauracion({ guardado: guardado({ shiftId: 'turno-viejo' }), shiftIdActual: 'turno-1', ahoraMs: AHORA })).toBe('OFRECER');
    });

    it('sin caja abierta no se restaura solo: no hay turno al cual atribuirla', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: null, ahoraMs: AHORA })).toBe('OFRECER');
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: '', ahoraMs: AHORA })).toBe('OFRECER');
    });

    it('nada guardado: descartar', () => {
        expect(decidirRestauracion({ guardado: null, shiftIdActual: 'turno-1', ahoraMs: AHORA })).toBe('DESCARTAR');
    });

    it('mismo turno pero viejo (13 h): se ofrece', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA + 13 * HORA })).toBe('OFRECER');
    });

    it('el borde de 12 h todavía restaura; un milisegundo más, no', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA + 12 * HORA })).toBe('RESTAURAR');
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA + 12 * HORA + 1 })).toBe('OFRECER');
    });

    it('marca de tiempo en el FUTURO (reloj cambiado): se pregunta, no se asume', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA - 20 * HORA })).toBe('OFRECER');
    });

    it('un adelanto de reloj chico no molesta al cajero', () => {
        expect(decidirRestauracion({ guardado: guardado(), shiftIdActual: 'turno-1', ahoraMs: AHORA - 2000 })).toBe('RESTAURAR');
    });
});

describe('resumenGuardado — el número del aviso es el número que va a ver', () => {
    it('suma precio × cantidad', () => {
        const r = resumenGuardado(guardado({
            lineas: [
                { id: 'a', name: 'Cemento', price: 420, quantity: 2 },
                { id: 'b', name: 'Clavo', price: 3.5, quantity: 10 },
            ],
        }));
        expect(r.lineas).toBe(2);
        expect(r.total.toFixed(2)).toBe('875.00');
    });

    it('aplica el descuento por línea igual que el carrito', () => {
        const r = resumenGuardado(guardado({ lineas: [{ id: 'a', name: 'x', price: 100, quantity: 2, discount: 10 }] }));
        expect(r.total.toFixed(2)).toBe('180.00');
    });

    it('aplica el descuento global DESPUÉS del de línea, como el POS', () => {
        const r = resumenGuardado(guardado({
            lineas: [{ id: 'a', name: 'x', price: 100, quantity: 2, discount: 10 }],
            descuentoGlobal: '50',
        }));
        expect(r.total.toFixed(2)).toBe('90.00');
    });

    it('un descuento global ilegible se trata como 0, no como NaN', () => {
        const r = resumenGuardado(guardado({ lineas: [{ id: 'a', name: 'x', price: 100, quantity: 1 }], descuentoGlobal: 'abc' }));
        expect(r.total.toFixed(2)).toBe('100.00');
        expect(r.total.isNaN()).toBe(false);
    });

    it('devuelve Decimal, no float (centavos que no se pierden)', () => {
        const r = resumenGuardado(guardado({ lineas: [{ id: 'a', name: 'x', price: 0.1, quantity: 3 }] }));
        expect(r.total).toBeInstanceOf(Decimal);
        expect(r.total.toFixed(2)).toBe('0.30');
    });
});

describe('aparcados (F4) — la promesa de "Aparcar y salir" tiene que ser cierta', () => {
    const aparcado = (p: Record<string, unknown> = {}) => ({
        id: 'h1',
        label: 'Doña María',
        shiftId: 'turno-1',
        heldAt: AHORA,
        lineas: [{ id: 'p1', name: 'Cemento', price: 420, quantity: 1 }],
        clienteId: null,
        ...p,
    });

    it('ida y vuelta', () => {
        const leidos = leerAparcados(serializarAparcados([aparcado()] as never));
        expect(leidos).toHaveLength(1);
        expect(leidos[0].label).toBe('Doña María');
        expect(leidos[0].shiftId).toBe('turno-1');
    });

    it('lista vacía no guarda nada', () => {
        expect(serializarAparcados([])).toBeNull();
    });

    it('al GUARDAR descarta los aparcados inválidos (se mira el JSON crudo)', () => {
        const crudo = serializarAparcados([aparcado(), aparcado({ id: '', label: 'mala' })] as never);
        expect(JSON.parse(crudo as string).aparcados).toHaveLength(1);
    });

    it('al GUARDAR no cuela un aparcado cuyas líneas son todas inválidas', () => {
        const crudo = serializarAparcados([aparcado(), aparcado({ id: 'h9', lineas: [{ id: '', price: 1, quantity: 1 }] })] as never);
        expect(JSON.parse(crudo as string).aparcados.map((a: { id: string }) => a.id)).toEqual(['h1']);
    });

    it('al LEER descarta las líneas corruptas de un aparcado y conserva las sanas', () => {
        const crudo = JSON.stringify({
            v: VERSION_CARRITO,
            aparcados: [aparcado({
                lineas: [
                    { id: 'p1', name: 'Cemento', price: 420, quantity: 1 },
                    { id: '', name: 'mala', price: 1, quantity: 1 },
                    { id: 'p2', name: 'Clavo', price: 3, quantity: 2 },
                ],
            })],
        });
        expect(leerAparcados(crudo)[0].lineas.map(l => l.id)).toEqual(['p1', 'p2']);
    });

    it('descarta los aparcados corruptos y conserva los sanos', () => {
        const crudo = JSON.stringify({
            v: VERSION_CARRITO,
            aparcados: [aparcado(), aparcado({ id: '', label: 'sin id' }), aparcado({ id: 'h3', lineas: [] })],
        });
        expect(leerAparcados(crudo).map(a => a.id)).toEqual(['h1']);
    });

    it('basura devuelve lista vacía, nunca lanza', () => {
        expect(leerAparcados(null)).toEqual([]);
        expect(leerAparcados('{roto')).toEqual([]);
        expect(leerAparcados('[]')).toEqual([]);
        expect(leerAparcados(JSON.stringify({ v: 999, aparcados: [aparcado()] }))).toEqual([]);
        expect(leerAparcados('null')).toEqual([]);
        expect(leerAparcados('7')).toEqual([]);
        expect(leerAparcados(JSON.stringify({ v: VERSION_CARRITO, aparcados: 'no es lista' }))).toEqual([]);
        expect(leerAparcados(JSON.stringify({ v: VERSION_CARRITO, aparcados: [null, 'x', 3] }))).toEqual([]);
    });

    it('un aparcado sin turno no se recupera: no se sabe de qué caja es', () => {
        const crudo = JSON.stringify({ v: VERSION_CARRITO, aparcados: [aparcado({ shiftId: '' })] });
        expect(leerAparcados(crudo)).toEqual([]);
    });

    it('un aparcado con heldAt ilegible se descarta', () => {
        const crudo = JSON.stringify({ v: VERSION_CARRITO, aparcados: [aparcado({ heldAt: 'ayer' })] });
        expect(leerAparcados(crudo)).toEqual([]);
    });

    it('conserva el clienteId del aparcado y normaliza el que viene mal', () => {
        const crudo = JSON.stringify({
            v: VERSION_CARRITO,
            aparcados: [aparcado({ id: 'h1', clienteId: 'cli-7' }), aparcado({ id: 'h2', clienteId: '  ' })],
        });
        const leidos = leerAparcados(crudo);
        expect(leidos[0].clienteId).toBe('cli-7');
        expect(leidos[1].clienteId).toBeNull();
    });

    it('preserva heldAt tal cual para poder ordenarlos por antigüedad', () => {
        const crudo = JSON.stringify({ v: VERSION_CARRITO, aparcados: [aparcado({ heldAt: AHORA - 5000 })] });
        expect(leerAparcados(crudo)[0].heldAt).toBe(AHORA - 5000);
    });

    it('un aparcado sin etiqueta igual se recupera con un nombre por defecto', () => {
        const crudo = JSON.stringify({ v: VERSION_CARRITO, aparcados: [aparcado({ label: '' })] });
        expect(leerAparcados(crudo)[0].label).toBe('Carrito');
    });
});
