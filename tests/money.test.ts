/**
 * NORTEX — tests del formateador único de moneda.
 *
 * Son los casos de la ronda de QA del rediseño (Fase 0), convertidos en suite
 * permanente. Números-oro ABSOLUTOS, no tautológicos: si alguien cambia el
 * separador, el símbolo o el modo de redondeo, CI lo atrapa.
 *
 * El origen del helper es un problema de credibilidad real: el mismo monto
 * salía "C$ 2,042,190.31" en Inventario y "$2,042,190.31" en Reportes, y en
 * Finanzas convivían "C$0.00", "$10000" y "$200" en una sola pantalla.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { formatMoney, formatUSD, formatMoneyShort, toDecimal, sanitizeDecimalInput } from '../utils/money';

// ── Captura de montos ───────────────────────────────────────────────────────
// Estas dos existían sin ningún test: son la puerta de entrada de TODO monto que
// el usuario teclea (los inputs de dinero son de texto, no type="number", para
// esquivar los quirks de float y de separador local).

describe('sanitizeDecimalInput: deja solo dígitos y UN punto', () => {
    it.each([
        ['1234', '1234'],
        ['12.34', '12.34'],
        ['12.34.56', '12.3456'],   // el segundo punto se descarta, no parte el número
        ['1.2.3', '1.23'],         // punto en la posición 1: distingue el borde de la condición
        ['C$ 1.234', '1.234'],     // pegar un monto con símbolo no rompe el input
        ['abc', ''],
        ['-50', '50'],             // el signo no se admite acá (hay helper aparte)
        ['1,234.50', '1234.50'],
        ['.', '.'],                // estado intermedio válido: el usuario sigue tecleando
        ['', ''],
    ])('%p → %p', (input, expected) => {
        expect(sanitizeDecimalInput(input)).toBe(expected);
    });

    it('preserva el punto decimal inicial mientras se teclea', () => {
        expect(sanitizeDecimalInput('.5')).toBe('.5');
    });

    it('sin punto no pierde el primer dígito al normalizar', () => {
        expect(sanitizeDecimalInput('987654321')).toBe('987654321');
        expect(sanitizeDecimalInput('C$ 007')).toBe('007');
    });
});

describe('toDecimal: nunca lanza, siempre devuelve un Decimal usable', () => {
    it.each([
        ['', '0'],
        ['.', '0'],
        ['abc', '0'],
        [NaN, '0'],
        ['12.5', '12.5'],
        [42, '42'],
        ['-3.25', '-3.25'],
    ])('%p → %s', (input, expected) => {
        expect(toDecimal(input as string | number).toString()).toBe(expected);
    });

    it('devuelve 0 ante Infinity (no un Decimal infinito que envenene un total)', () => {
        expect(toDecimal(Infinity).toString()).toBe('0');
        expect(toDecimal(-Infinity).toString()).toBe('0');
    });

    it('devuelve 0 ante null/undefined sin lanzar', () => {
        expect(toDecimal(null as unknown as number).toString()).toBe('0');
        expect(toDecimal(undefined as unknown as number).toString()).toBe('0');
    });
});

describe('símbolo por moneda', () => {
    it('córdobas llevan C$ y espacio', () => {
        expect(formatMoney(2042190.31)).toBe('C$ 2,042,190.31');
    });

    it('dólares llevan US$, nunca $ solo', () => {
        expect(formatMoney(2042190.31, 'USD')).toBe('US$ 2,042,190.31');
        expect(formatUSD(1234.5)).toBe('US$ 1,234.50');
    });

    it('ningún formato emite el glifo $ suelto (es ambiguo en Nicaragua)', () => {
        // "US$ 1.00" contiene "$" pero precedido de US; lo que no puede pasar es
        // que el string ARRANQUE con $.
        expect(formatMoney(1).startsWith('$')).toBe(false);
        expect(formatMoney(1, 'USD').startsWith('$')).toBe(false);
    });
});

describe('valores ausentes: un monto vacío se muestra como cero explícito', () => {
    // El usuario tiene que poder distinguir "no hay plata" de "no cargó".
    it.each([
        [null, 'C$ 0.00'],
        [undefined, 'C$ 0.00'],
        ['', 'C$ 0.00'],
        [NaN, 'C$ 0.00'],
        [0, 'C$ 0.00'],
        [-0, 'C$ 0.00'],
    ])('%p → %s', (input, expected) => {
        expect(formatMoney(input as Decimal.Value)).toBe(expected);
    });
});

describe('separador de miles', () => {
    it.each([
        [999, 'C$ 999.00'],
        [1000, 'C$ 1,000.00'],
        [999999.99, 'C$ 999,999.99'],
        [1000000, 'C$ 1,000,000.00'],
        [1234567890.12, 'C$ 1,234,567,890.12'],
    ])('%p → %s', (input, expected) => {
        expect(formatMoney(input)).toBe(expected);
    });
});

describe('signo', () => {
    it('negativo: el menos va antes del símbolo', () => {
        expect(formatMoney(-80)).toBe('-C$ 80.00');
    });

    it('signed antepone + solo en positivos', () => {
        expect(formatMoney(150, 'NIO', { signed: true })).toBe('+C$ 150.00');
        expect(formatMoney(-150, 'NIO', { signed: true })).toBe('-C$ 150.00');
        expect(formatMoney(0, 'NIO', { signed: true })).toBe('+C$ 0.00');
    });
});

describe('redondeo HALF_UP (norma DGI), no el del float nativo', () => {
    // (1.005).toFixed(2) nativo da "1.00" por la representación binaria.
    it('1.005 → 1.01', () => {
        expect(formatMoney(1.005)).toBe('C$ 1.01');
    });

    it('0.015 → 0.02', () => {
        expect(formatMoney(0.015)).toBe('C$ 0.02');
    });

    it('99.999 → 100.00', () => {
        expect(formatMoney(new Decimal('99.999'))).toBe('C$ 100.00');
    });

    it('acepta Decimal y string sin perder precisión', () => {
        expect(formatMoney(new Decimal('0.1').plus('0.2'))).toBe('C$ 0.30');
        expect(formatMoney('1234.5')).toBe('C$ 1,234.50');
    });
});

describe('opciones', () => {
    it('symbol:false devuelve solo el número', () => {
        expect(formatMoney(1234.5, 'NIO', { symbol: false })).toBe('1,234.50');
    });

    it('decimals:0 redondea a entero', () => {
        expect(formatMoney(1234.56, 'NIO', { decimals: 0 })).toBe('C$ 1,235');
    });
});

describe('formato corto (ejes de gráficos)', () => {
    it.each([
        [600, 'C$ 600'],
        [1200, 'C$ 1.2k'],
        [3_400_000, 'C$ 3.4M'],
        [-1500, '-C$ 1.5k'],
        [0, 'C$ 0'],
    ])('%p → %s', (input, expected) => {
        expect(formatMoneyShort(input)).toBe(expected);
    });
});
