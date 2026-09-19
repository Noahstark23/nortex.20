import { describe, expect, it, vi } from 'vitest';
import { normalizeBodegaDecimalInput, parseBodegaDecimalInput } from '../utils/bodegaReceivingInput';

describe('captura decimal de bodega: pegar, continuar y validar', () => {
    it.each([
        [' 12 ', '12'], [' 0,125 ', '0.125'], ['1,234567', '1.234567'],
        [',125', '.125'], ['.125', '.125'], ['', ''], [',', '.'], ['0,', '0.'], ['12.', '12.'],
        ['1.234,56', '1.234,56'], ['1,234.56', '1,234.56'], ['1,2,3', '1,2,3'],
        ['-1', '-1'], ['1e3', '1e3'], ['1 234', '1 234'],
    ])('conserva el significado y el estado de escritura de %s', (raw, expected) => {
        expect(normalizeBodegaDecimalInput(raw)).toBe(expected);
    });

    it.each([[' 12 ', '12'], ['0', '0'], ['.125', '0.125'], ['12.', '12'], ['1.234567', '1.234567']])(
        'valida un decimal completo %s sin redondearlo', (text, expected) => {
            expect(parseBodegaDecimalInput(text).toString()).toBe(expected);
        },
    );

    it.each(['', '.', '1.234,56', '1e3', '-1', '0x10', 'Infinity', 'NaN', '1 234'])('rechaza %s y explica cómo corregirlo', async (text) => {
        // Carga fresca para comprobar también la instrucción inicializada al importar.
        vi.resetModules();
        const { parseBodegaDecimalInput: parseFresh } = await import('../utils/bodegaReceivingInput');
        expect(() => parseFresh(text)).toThrow('Usá coma o punto decimal, sin separadores de miles.');
    });
});
