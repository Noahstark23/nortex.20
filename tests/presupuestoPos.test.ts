import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRINQUETE DEL POS — el presupuesto que SOLO BAJA.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * `components/POS.tsx` pasó de 3.288 líneas el 1 de agosto de 2026 a 7.452 el
 * 27 — más del doble en 26 días. No llegó ahí por una mala decisión: llegó por
 * veintitantas decisiones razonables, cada una agregando "un poquito más" a un
 * componente que ya era gigante, sin que nada las frenara. Todo el archivo es
 * UN solo componente (línea 524 a 7452) con 122 `useState`, así que cualquier
 * cambio de estado vuelve a ejecutar las ~6.900 líneas.
 *
 * Este test es el freno. Misma regla que el umbral de mutación de
 * `stryker.config.json`, y por el mismo motivo: **el número solo baja**.
 * Si un cambio lo sube, se arregla el cambio — NUNCA se sube el presupuesto.
 * Subirlo para que pase un PR es exactamente el gaming que este archivo viene
 * a prevenir.
 *
 * CÓMO SE BAJA (lo esperado a medida que avanza el desguace)
 *   1. Sacás una pieza del monolito a `components/pos/<pieza>.tsx`.
 *   2. Corrés `npm test`. Este test falla diciendo que sobra presupuesto.
 *   3. Pegás el número a la nueva realidad, en el MISMO commit.
 *
 * La red que hace seguro ese movimiento es `tests/posVentaCritica.test.tsx`:
 * caracteriza la venta (escanear → carrito → cobrar → vuelto → registrar) sin
 * aseverar estructura, así que mover código no la rompe pero cambiar la
 * conducta sí.
 */

const RAIZ = resolve(__dirname, '..');
const POS = readFileSync(join(RAIZ, 'components/POS.tsx'), 'utf8');

/**
 * Presupuesto vigente. Cada número es el máximo tolerado, no una meta: la meta
 * está en el plan (POS.tsx < 1.500 líneas, < 30 `useState`).
 *
 * La marca se puso en 7.452 al medir sobre 212dd9f el 2026-08-27 y hubo que
 * subirla a 7.497 al día siguiente, al traer `main`: el hub de clientes (#184)
 * le sumó 45 líneas más al monolito mientras se escribía esta red. Es la ÚNICA
 * vez que este número sube, y sube porque es la marca INICIAL fijándose sobre
 * la realidad de `main` — no porque un PR necesitara pasar. De acá en adelante
 * solo baja. Que hayan entrado 45 líneas en un día, justo mientras medíamos,
 * es la mejor evidencia de por qué este archivo tiene que existir.
 */
const PRESUPUESTO = {
    lineas: 7364,
    useState: 120,
};

describe('presupuesto de POS.tsx', () => {
    it(`no supera las ${PRESUPUESTO.lineas} líneas`, () => {
        const lineas = POS.split('\n').length - 1;

        expect(
            lineas,
            `POS.tsx tiene ${lineas} líneas y el presupuesto es ${PRESUPUESTO.lineas}. ` +
            'Si estás AGREGANDO: la feature va en components/pos/<feature>.tsx, no acá dentro. ' +
            'Si estás SACANDO código: bajá PRESUPUESTO.lineas en este mismo commit.',
        ).toBeLessThanOrEqual(PRESUPUESTO.lineas);
    });

    it(`no supera los ${PRESUPUESTO.useState} useState`, () => {
        const cuantos = (POS.match(/useState/g) ?? []).length;

        expect(
            cuantos,
            `POS.tsx tiene ${cuantos} useState y el presupuesto es ${PRESUPUESTO.useState}. ` +
            'Cada estado nuevo en este componente es una razón más para re-renderizar ' +
            'las ~6.900 líneas enteras. El estado nuevo va en su propio contexto o reducer.',
        ).toBeLessThanOrEqual(PRESUPUESTO.useState);
    });

    it('el presupuesto refleja la realidad y no quedó holgado tras un refactor', () => {
        const lineas = POS.split('\n').length - 1;
        const cuantos = (POS.match(/useState/g) ?? []).length;

        // Un presupuesto muy por encima de lo real deja de frenar nada: el
        // monolito puede volver a crecer hasta el techo viejo sin que el CI
        // diga una palabra. Cuando se saca una pieza, el número se re-pega.
        expect(
            PRESUPUESTO.lineas - lineas,
            `Sobran ${PRESUPUESTO.lineas - lineas} líneas de presupuesto. ` +
            `Bajá PRESUPUESTO.lineas a ${lineas} para que el trinquete siga apretando.`,
        ).toBeLessThanOrEqual(250);

        expect(
            PRESUPUESTO.useState - cuantos,
            `Sobran ${PRESUPUESTO.useState - cuantos} useState de presupuesto. ` +
            `Bajá PRESUPUESTO.useState a ${cuantos}.`,
        ).toBeLessThanOrEqual(10);
    });
});

/**
 * La otra mitad del trinquete: que no crezca la deuda de tests acoplados al
 * TEXTO de POS.tsx.
 *
 * Hoy siete archivos leen `components/POS.tsx` como string y afirman que ciertos
 * fragmentos están adentro de ese archivo. Eso clava el monolito: mover una
 * pieza a otro archivo los rompe aunque la conducta sea idéntica, y a cambio no
 * cubren ni una venta. Se van a ir reubicando a medida que avance el desguace
 * (los que describen CONDUCTA pasan a tests de render; los de ARQUITECTURA se
 * quedan pero apuntando al módulo dueño). Mientras tanto, la lista NO crece.
 */
/**
 * El propio trinquete lee POS.tsx, pero solo para CONTAR líneas y `useState`:
 * no asevera ningún fragmento de su contenido, así que mover código no lo
 * rompe. Es la excepción, y es la única.
 */
const ES_EL_TRINQUETE = 'presupuestoPos.test.ts';

const ACOPLADOS_HISTORICOS = [
    'activationUx.test.ts',
    'cajaNicaPos.test.ts',
    'noHardcodedCurrency.test.ts',
    'pinCajeroSinFriccion.test.ts',
    // Llegó con el hub de clientes (#184) mientras se escribía esta red: la
    // deuda pasó de seis a siete en un día. Entra a la lista porque ya está en
    // `main`, no porque se acepte el patrón — es justamente el séptimo caso que
    // este guard existe para que no haya un octavo.
    'posCustomerCreateAuthorization.test.ts',
    'quotationPosBridge.test.ts',
    'returnEndpointGuards.test.ts',
];

/**
 * Leer el archivo se ve como la RUTA ENTRE COMILLAS (`'components/POS.tsx'`,
 * `'../components/POS.tsx'`), sin importar con qué función se lea — los seis
 * históricos usan cinco formas distintas: `source(...)`, `leer(...)`,
 * `readFileSync(resolve(...))`, `readFileSync(new URL(...))` y una lista de
 * rutas. Un test de render, en cambio, importa el COMPONENTE
 * (`from '../components/POS'`, sin extensión) y no matchea.
 */
const LEE_EL_ARCHIVO = /['"][^'"]*components\/POS\.tsx['"]/;

describe('deuda de tests acoplados al texto de POS.tsx', () => {
    it('ningún test nuevo lee POS.tsx como string', () => {
        const dir = join(RAIZ, 'tests');
        const acoplados = readdirSync(dir)
            .filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'))
            .filter((f) => f !== ES_EL_TRINQUETE)
            .filter((f) => LEE_EL_ARCHIVO.test(readFileSync(join(dir, f), 'utf8')));

        const nuevos = acoplados.filter((f) => !ACOPLADOS_HISTORICOS.includes(f));

        expect(
            nuevos,
            'Estos tests leen POS.tsx como texto: eso clava el monolito y no prueba conducta. ' +
            'Probá la conducta renderizando (ver tests/posVentaCritica.test.tsx).',
        ).toEqual([]);
    });

    it('la lista histórica no tiene entradas muertas', () => {
        const dir = join(RAIZ, 'tests');

        const quedan = ACOPLADOS_HISTORICOS.filter((f) => {
            try {
                return LEE_EL_ARCHIVO.test(readFileSync(join(dir, f), 'utf8'));
            } catch {
                return false;
            }
        });

        // Cuando un archivo se desacopla, sale de la lista. Así el número de
        // pendientes es visible y solo puede bajar.
        expect(
            quedan,
            'Hay archivos en ACOPLADOS_HISTORICOS que ya no leen POS.tsx. ' +
            'Sacalos de la lista para que refleje la deuda que queda de verdad.',
        ).toEqual(ACOPLADOS_HISTORICOS);
    });
});
