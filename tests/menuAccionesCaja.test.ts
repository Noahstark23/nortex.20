import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guarda del menú "Acciones de caja" del POS.
 *
 * EL BUG QUE CUBRE (reportado desde el mostrador como "el botón no funciona"):
 * el menú era `absolute top-full` y su contenedor es el header, que lleva
 * `overflow-x-auto` para poder scrollear los botones en pantallas angostas.
 *
 * Por especificación CSS (Overflow Module 3), si UN eje del overflow deja de
 * ser `visible`, el OTRO se computa a `auto`. O sea que `overflow-x-auto`
 * recorta también en VERTICAL. Como el header mide 56px y el menú cae debajo
 * del botón, quedaba recortado entero: el estado cambiaba, el chevron giraba,
 * y no aparecía nada.
 *
 * POR QUÉ ESTA GUARDA ES DE TEXTO Y NO DE RENDER: jsdom no implementa layout
 * —no calcula overflow, ni recorte, ni `getBoundingClientRect` real—, así que
 * un test de render montaría el menú y lo daría por visible aunque en un
 * navegador esté recortado. El bug es de CSS y solo se puede afirmar sobre el
 * CSS. Un test que "pasa" sin poder ver la falla es peor que no tenerlo.
 */

const pos = readFileSync(join(__dirname, '..', 'components', 'POS.tsx'), 'utf-8');

/** El bloque del menú, desde el botón que lo abre hasta que cierra su contenedor. */
const bloqueMenu = (): string => {
    const desde = pos.indexOf('const botonAccionesCaja');
    expect(desde).toBeGreaterThan(-1);
    const hasta = pos.indexOf('Cerrar caja: lo único irreversible', desde);
    expect(hasta).toBeGreaterThan(desde);
    return pos.slice(desde, hasta);
};

describe('el menú de acciones de caja no queda recortado', () => {
    it('el menú se posiciona con `fixed`, no con `absolute`', () => {
        // `absolute` lo recorta cualquier ancestro con overflow; `fixed` no.
        const menu = bloqueMenu();
        const apertura = menu.indexOf('role="menu"');
        expect(apertura).toBeGreaterThan(-1);
        // La clase del contenedor del menú, en las líneas siguientes al role.
        const clases = menu.slice(apertura, apertura + 1200);
        expect(clases).toMatch(/className="fixed /);
        expect(clases).not.toMatch(/className="absolute /);
    });

    it('el header sigue teniendo overflow — el arreglo NO fue sacarlo', () => {
        // Si alguien "arregla" esto borrando el overflow-x-auto, en un teléfono
        // los botones del header dejan de ser alcanzables. El scroll horizontal
        // tiene que seguir ahí; lo que cambia es cómo se posiciona el menú.
        expect(pos).toContain('overflow-x-auto');
    });

    it('la posición se mide del botón real y se re-mide al scrollear o redimensionar', () => {
        // Sin re-medir, el menú queda flotando lejos del botón cuando el header
        // scrollea en horizontal o cuando se gira el teléfono.
        const menu = bloqueMenu();
        expect(menu).toContain('getBoundingClientRect');
        expect(menu).toMatch(/addEventListener\('resize'/);
        // Fase de captura: el scroll de un contenedor interno NO burbujea.
        expect(menu).toMatch(/addEventListener\('scroll',\s*\w+,\s*true\)/);
    });

    it('no se pinta hasta tener la medida, si no aparecería en una esquina', () => {
        expect(bloqueMenu()).toContain('showCashActions && posicionMenuCaja');
    });

    it('el menú tiene alto máximo: en un teléfono acostado no se sale por abajo', () => {
        const menu = bloqueMenu();
        expect(menu).toMatch(/max-h-\[calc\(100dvh/);
        expect(menu).toContain('overflow-y-auto');
    });
});

describe('el menú se puede cerrar', () => {
    it('Escape lo cierra, y ANTES que cualquier modal de abajo', () => {
        // Es lo más superficial de la pila y lo único que se abre sin tapar la
        // pantalla: si Escape cerrara primero algo de abajo, el menú quedaría
        // colgado sobre una pantalla que ya cambió.
        const cadena = pos.slice(pos.indexOf('// Close any open modal'));
        const menu = cadena.indexOf('if (showCashActions)');
        const primerModal = cadena.indexOf('if (completedSale)');
        expect(menu).toBeGreaterThan(-1);
        expect(primerModal).toBeGreaterThan(-1);
        expect(menu).toBeLessThan(primerModal);
    });

    it('hay una capa de clic-afuera por debajo del menú', () => {
        // z-sticky (10) < z-checkout (20): la capa cierra al tocar afuera pero
        // NO se come los clics de los ítems. Invertido, el menú se vería y
        // ningún ítem respondería — otra vez "el botón no funciona".
        const menu = bloqueMenu();
        expect(menu).toContain('fixed inset-0 z-sticky');
        expect(menu).toContain('z-checkout');
    });
});
