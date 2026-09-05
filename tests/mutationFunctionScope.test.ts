import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { checkFunctionScopes, FUNCTION_FLOORS } = createRequire(import.meta.url)('../scripts/check-mutation-scope.cjs');
const file = 'backend/services/fixture.ts';
const source = [
    'export function original(amount = 1) {',
    '    return amount + 1;',
    '}',
    'export const added = (amount: number) => amount * 2;',
].join('\n');
const mutant = (line: number, column = 5, endColumn = column + 6) => ({
    status: 'Killed', location: { start: { line, column }, end: { line, column: endColumn } },
});

function fixture() {
    const files: Record<string, { source: string; mutants: ReturnType<typeof mutant>[] }> = {
        [file]: { source, mutants: [mutant(2), mutant(4, 40)] },
    };
    return {
        config: { mutate: [`${file}:1-3`, `${file}:4-4`] },
        report: { files },
        readSource: () => source,
        floors: { [file]: { original: 1, added: 1 } },
    };
}

describe('alcance AST de mutación por función', () => {
    it('acepta firma, cuerpo y expresión completos con pisos independientes', () => {
        expect(checkFunctionScopes(fixture())).toEqual({ failures: [], counts: {
            [`${file}#original`]: 1, [`${file}#added`]: 1,
        } });
    });

    it('acepta alcance de archivo completo y claves absolutas del reporte', () => {
        const input = fixture();
        input.config.mutate = [file];
        input.report.files = { [`/workspace/${file}`]: input.report.files[file] };
        expect(checkFunctionScopes(input).failures).toEqual([]);
    });

    it('acepta rangos contiguos que cubren la declaración completa', () => {
        const input = fixture();
        input.config.mutate = [`${file}:1-1`, `${file}:2-3`, `${file}:4-4`];
        expect(checkFunctionScopes(input).failures).toEqual([]);
    });

    it.each([
        ['firma/default omitido', ['2-3', '4-4']],
        ['cierre sin mutantes omitido', ['1-2', '4-4']],
        ['hueco en cuerpo', ['1-1', '3-4']],
        ['declaración omitida', ['4-4']],
        ['flecha truncada', ['1-3', '4:0-4:40']],
        ['columna inicial recortada', ['1:1-3', '4-4']],
    ])('rechaza %s aunque el reporte conserva todos los mutantes', (_name, ranges) => {
        const input = fixture();
        input.config.mutate = ranges.map((range) => `${file}:${range}`);
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('declaración completa');
    });

    it('una función nueva no compensa el piso perdido por otra', () => {
        const input = fixture();
        input.report.files[file].mutants = [mutant(4, 40), mutant(4, 41), mutant(4, 42)];
        expect(checkFunctionScopes(input).failures).toContain(`${file}: original: 0 mutantes < piso 1.`);
    });

    it('dos flechas en la misma declaración no comparten su conteo de mutantes', () => {
        const input = fixture();
        const combined = 'const original = () => 1, added = () => 2;';
        input.config.mutate = [file];
        input.report.files[file].source = combined;
        input.readSource = () => combined;
        input.report.files[file].mutants = [mutant(1, 34, 39)];
        expect(checkFunctionScopes(input).failures).toContain(`${file}: original: 0 mutantes < piso 1.`);
    });

    it('interpreta columnas inclusivas del config sin recortar el último carácter', () => {
        const input = fixture();
        const lastColumn = source.split('\n')[3].length - 1;
        input.config.mutate = [`${file}:1-3`, `${file}:4:0-4:${lastColumn}`];
        expect(checkFunctionScopes(input).failures).toEqual([]);
        input.config.mutate[1] = `${file}:4:0-4:${lastColumn - 1}`;
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('declaración completa');
    });

    it('detecta un reporte viejo aunque los conteos y rangos coincidan', () => {
        const input = fixture();
        input.readSource = () => source.replace('amount + 1', 'amount + 2');
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('código actual');
    });

    it('detecta una función desplazada sin realinear rangos', () => {
        const input = fixture();
        input.report.files[file].source = `\n${source}`;
        input.readSource = () => input.report.files[file].source;
        input.report.files[file].mutants = [mutant(3), mutant(5, 40)];
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('added: mutate no cubre');
    });

    it.each(['renamed', 'duplicate'])('rechaza función %s', (change) => {
        const input = fixture();
        const changed = change === 'renamed' ? source.replace('original', 'renamed') : `${source}\nfunction original() { return 9; }`;
        input.report.files[file].source = changed;
        input.readSource = () => changed;
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('original: declaración ausente o duplicada');
    });

    it.each(['Ignored', 'CompileError'])('no acredita mutantes %s', (status) => {
        const input = fixture();
        input.report.files[file].mutants[0].status = status;
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('original: 0 mutantes < piso 1');
    });

    it.each(['0-3', '3-2', '1-99', '1:999-3', '1-3:999', 'no-range'])('rechaza rango inválido %s', (range) => {
        const input = fixture();
        input.config.mutate = [`${file}:${range}`, `${file}:4-4`];
        expect(checkFunctionScopes(input).failures.length).toBeGreaterThan(0);
    });

    it('no permite una exclusión que anule los rangos positivos', () => {
        const input = fixture();
        input.config.mutate.push(`!${file}`);
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('sin exclusiones');
    });

    it('rechaza un reporte ausente o ambiguo', () => {
        const input = fixture();
        input.report.files[`/another/${file}`] = input.report.files[file];
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('ausente o ambiguo');
        input.report.files = {};
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('ausente o ambiguo');
    });

    it('rechaza TypeScript o ubicaciones de mutantes inválidos', () => {
        const input = fixture();
        input.report.files[file].mutants[0].location.start.line = 999;
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('ubicación de mutante inválida');
        input.report.files[file].source = 'export function original( {';
        input.readSource = () => input.report.files[file].source;
        expect(checkFunctionScopes(input).failures.join('\n')).toContain('TypeScript inválido');
    });

    it('conserva los pisos contables auditados independientemente del total', () => {
        expect(FUNCTION_FLOORS['backend/services/accounting.ts']).toEqual({
            canonicalJournalAccountLockOrder: 7,
            buildSaleJournalLines: 40,
            buildPaymentJournalLines: 25,
            buildSupplierPaymentJournalLines: 12,
            buildPurchaseJournalLines: 64,
            returnMoney: 10,
            buildReturnJournalLines: 41,
            cashMovementJournalLines: 33,
        });
        expect(FUNCTION_FLOORS['backend/lib/paymentAccounts.ts']).toEqual({ settledPaymentAccount: 11 });
        expect(FUNCTION_FLOORS['backend/validation/schemas.ts']).toEqual({ canonicalizeCloseShiftPayload: 8 });
        expect(FUNCTION_FLOORS['backend/lib/shiftCloseReport.ts']).toEqual({ moneyUsd: 1 });
    });
});
