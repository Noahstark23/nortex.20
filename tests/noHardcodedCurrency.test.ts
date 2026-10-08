/**
 * NORTEX — guard contra moneda hardcodeada en JSX.
 *
 * El rediseño unificó ~1.000 interpolaciones de "C$"/"$" en formatMoney
 * (utils/money.ts). Este test existe para que no vuelvan: sin él, el próximo
 * componente escribe `C$ {x.toFixed(2)}` y en seis meses el sistema vuelve a
 * mostrar dos monedas distintas para el mismo dato.
 *
 * ALCANCE: solo las pantallas ya migradas (ALLOWLIST_MIGRADAS). El resto del
 * repo sigue teniendo interpolaciones viejas — se van sumando acá a medida que
 * se migran, y el día que estén todas, la lista pasa a ser "todos los .tsx".
 * Un guard que falla desde el día uno se termina desactivando; este arranca
 * verde y solo se pone rojo ante una regresión real.
 *
 * EXCEPCIÓN LEGÍTIMA: los documentos que se IMPRIMEN (facturas, colillas,
 * etiquetas) arman HTML en un template string con estilos propios de tinta
 * sobre papel. Ahí el "$" no es JSX y queda fuera del guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/** Pantallas ya migradas al formateador único. Solo se agrega, nunca se quita. */
const ALLOWLIST_MIGRADAS = [
    'components/POS.tsx',
    'components/Dashboard.tsx',
    'components/Reports.tsx',
    'components/Clients.tsx',
    'components/Inventory.tsx',
];

/**
 * Detecta el símbolo de moneda pegado a una expresión:
 *   C$ {total}   C${total}   US$ {y}   $ {x}
 *
 * Deliberadamente NO se busca `${` a secas: en TypeScript eso es siempre
 * interpolación de template literal (`Bearer ${token}`, `bg-red ${cond}`),
 * nunca un símbolo de moneda. Buscarlo daba falsos positivos en cada
 * className condicional del repo, y un guard que grita en falso se termina
 * desactivando.
 */
const CURRENCY_PATTERNS = [
    /C\$\s*\{/,      // C$ {x} y C${x}
    /US\$\s*\{/,     // US$ {x}
    /\$\s+\{/,       // "$ {x}" — dólar suelto como texto JSX
];

describe('ningún símbolo de moneda hardcodeado en las pantallas migradas', () => {
    it.each(ALLOWLIST_MIGRADAS)('%s usa formatMoney, no el símbolo a mano', (relPath) => {
        const source = readFileSync(join(ROOT, relPath), 'utf8');

        // Se ignoran las líneas de HTML de impresión (facturas, colillas,
        // etiquetas): arman markup en un template string, no son JSX.
        const offending = source
            .split('\n')
            .map((line, n) => ({ line, n: n + 1 }))
            .filter(({ line }) => !/<div class=|<td style=|<span style=|font-family:/.test(line))
            .filter(({ line }) => CURRENCY_PATTERNS.some(re => re.test(line)))
            .map(({ line, n }) => `${relPath}:${n} → ${line.trim().slice(0, 120)}`);

        expect(offending).toEqual([]);
    });

    it('el guard detecta de verdad una regresión (no es un test tautológico)', () => {
        const regresion = '<span>C$ {total.toFixed(2)}</span>';
        expect(CURRENCY_PATTERNS.some(re => re.test(regresion))).toBe(true);
        // …y no marca una interpolación normal como si fuera moneda.
        const normal = 'headers: { Authorization: `Bearer ${token}` }';
        expect(CURRENCY_PATTERNS.some(re => re.test(normal))).toBe(false);
    });

    it('el formateador es la única fuente del símbolo', () => {
        const money = readFileSync(join(ROOT, 'utils/money.ts'), 'utf8');
        expect(money).toContain("NIO: 'C$'");
        expect(money).toContain("USD: 'US$'");
    });
});
