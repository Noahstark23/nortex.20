import { describe, expect, it } from 'vitest';
import {
    PREVIEW_FILTERS,
    PREVIEW_ISSUE_EXAMPLES,
    PREVIEW_PAGE_SIZE,
    countPreviewRows,
    isPreviewFilter,
    matchesPreviewFilter,
    selectPreviewRows,
    summarizePreviewIssues,
    type PreviewRow,
} from '../utils/importPreview';

const row = (excelRow: number, errors: string[] = []): PreviewRow => ({
    excelRow,
    valid: errors.length === 0,
    errors,
});

/** Archivo grande realista: 500 filas, 1 de cada 10 sin precio. */
const bigFile = (): PreviewRow[] => Array.from({ length: 500 }, (_, index) =>
    row(index + 2, index % 10 === 0 ? ['Precio inválido'] : []));

describe('vocabulario del filtro de la vista previa', () => {
    it('expone exactamente tres filtros', () => {
        expect(PREVIEW_FILTERS).toEqual(['ALL', 'VALID', 'ERRORS']);
    });

    it('reconoce solo los filtros del vocabulario', () => {
        expect(isPreviewFilter('ALL')).toBe(true);
        expect(isPreviewFilter('ERRORS')).toBe(true);
        expect(isPreviewFilter('TODOS')).toBe(false);
        expect(isPreviewFilter(null)).toBe(false);
        expect(isPreviewFilter(undefined)).toBe(false);
    });

    it('clasifica cada fila según su validez', () => {
        expect(matchesPreviewFilter(row(2), 'ALL')).toBe(true);
        expect(matchesPreviewFilter(row(2), 'VALID')).toBe(true);
        expect(matchesPreviewFilter(row(2), 'ERRORS')).toBe(false);
        expect(matchesPreviewFilter(row(3, ['x']), 'ALL')).toBe(true);
        expect(matchesPreviewFilter(row(3, ['x']), 'VALID')).toBe(false);
        expect(matchesPreviewFilter(row(3, ['x']), 'ERRORS')).toBe(true);
    });
});

describe('selección de filas renderizables', () => {
    it('acota el DOM sin mentir sobre el tamaño del archivo', () => {
        const seleccion = selectPreviewRows(bigFile(), 'ALL', PREVIEW_PAGE_SIZE);

        expect(seleccion.visible).toHaveLength(PREVIEW_PAGE_SIZE);
        // Lo que importa: el usuario sigue viendo que hay 500, no 25.
        expect(seleccion.matching).toBe(500);
        expect(seleccion.hidden).toBe(475);
    });

    it('aísla las filas rotas de un archivo grande', () => {
        const seleccion = selectPreviewRows(bigFile(), 'ERRORS', PREVIEW_PAGE_SIZE);

        expect(seleccion.matching).toBe(50);
        expect(seleccion.visible).toHaveLength(PREVIEW_PAGE_SIZE);
        expect(seleccion.hidden).toBe(25);
        expect(seleccion.visible.every(r => !r.valid)).toBe(true);
        // La primera fila rota del archivo es la 2, no la 1: el encabezado cuenta.
        expect(seleccion.visible[0].excelRow).toBe(2);
    });

    it('conserva el orden original del archivo', () => {
        const seleccion = selectPreviewRows(bigFile(), 'ERRORS', 4);
        expect(seleccion.visible.map(r => r.excelRow)).toEqual([2, 12, 22, 32]);
    });

    it('no reporta ocultas cuando todo entra en el tope', () => {
        const seleccion = selectPreviewRows([row(2), row(3)], 'ALL', 25);
        expect(seleccion.visible).toHaveLength(2);
        expect(seleccion.matching).toBe(2);
        expect(seleccion.hidden).toBe(0);
    });

    it('devuelve vacío sin romperse cuando el filtro no encuentra nada', () => {
        const seleccion = selectPreviewRows([row(2), row(3)], 'ERRORS', 25);
        expect(seleccion).toEqual({ visible: [], matching: 0, hidden: 0 });
    });

    it('usa el tope por defecto cuando no se pide uno', () => {
        expect(selectPreviewRows(bigFile(), 'ALL').visible).toHaveLength(PREVIEW_PAGE_SIZE);
    });

    it('trunca un tope fraccionario en vez de romper el slice', () => {
        expect(selectPreviewRows(bigFile(), 'ALL', 3.7).visible).toHaveLength(3);
    });

    it.each([
        [0],
        [-5],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
    ])('un tope inválido (%s) muestra todo en vez de ocultar el archivo', (limit) => {
        // Fail-open deliberado: un tope roto no puede hacer creer que el Excel
        // llegó vacío, que es el peor resultado posible de esta pantalla.
        const seleccion = selectPreviewRows([row(2), row(3, ['x'])], 'ALL', limit);
        expect(seleccion.visible).toHaveLength(2);
        expect(seleccion.hidden).toBe(0);
    });

    it('no muta el arreglo recibido', () => {
        const rows = [row(3, ['x']), row(2)];
        const copia = [...rows];
        selectPreviewRows(rows, 'VALID', 1);
        expect(rows).toEqual(copia);
    });
});

describe('conteo de filas', () => {
    it('separa válidas de rotas', () => {
        expect(countPreviewRows(bigFile())).toEqual({ total: 500, valid: 450, errors: 50 });
    });

    it('cuenta un archivo vacío sin dividir por cero', () => {
        expect(countPreviewRows([])).toEqual({ total: 0, valid: 0, errors: 0 });
    });
});

describe('motivos agrupados', () => {
    it('agrupa por motivo y ordena del más frecuente al menos', () => {
        const issues = summarizePreviewIssues([
            row(2, ['Precio inválido']),
            row(3, ['Precio inválido']),
            row(4, ['Nombre requerido']),
            row(5, ['Precio inválido']),
        ]);

        expect(issues).toEqual([
            { motivo: 'Precio inválido', filas: 3, ejemplos: [2, 3, 5] },
            { motivo: 'Nombre requerido', filas: 1, ejemplos: [4] },
        ]);
    });

    it('cuenta cada motivo de una fila con varios errores', () => {
        const issues = summarizePreviewIssues([row(2, ['Precio inválido', 'Nombre requerido'])]);
        expect(issues.map(i => i.motivo).sort()).toEqual(['Nombre requerido', 'Precio inválido']);
        expect(issues.every(i => i.filas === 1)).toBe(true);
    });

    it('no infla el conteo si una fila repite el mismo motivo', () => {
        // Un motivo duplicado en la misma fila haría creer que hay dos filas rotas.
        const issues = summarizePreviewIssues([row(2, ['Precio inválido', 'Precio inválido'])]);
        expect(issues).toEqual([{ motivo: 'Precio inválido', filas: 1, ejemplos: [2] }]);
    });

    it('acota los ejemplos pero conserva el conteo real', () => {
        const issues = summarizePreviewIssues(bigFile());
        expect(issues).toHaveLength(1);
        expect(issues[0].filas).toBe(50);
        expect(issues[0].ejemplos).toHaveLength(PREVIEW_ISSUE_EXAMPLES);
        expect(issues[0].ejemplos).toEqual([2, 12, 22]);
    });

    it('ordena alfabéticamente los motivos empatados, para que la lista no baile', () => {
        const issues = summarizePreviewIssues([row(2, ['Zeta']), row(3, ['Alfa'])]);
        expect(issues.map(i => i.motivo)).toEqual(['Alfa', 'Zeta']);
    });

    it('ignora las filas válidas', () => {
        expect(summarizePreviewIssues([row(2), row(3)])).toEqual([]);
    });
});
