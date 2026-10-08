/**
 * Vista previa de una importación de productos — reglas puras de presentación.
 *
 * Con 500 filas la lista completa deja de ser útil: en un teléfono son miles de
 * nodos que no se pueden recorrer, y lo único accionable son las filas que
 * fallaron. Este módulo decide QUÉ se muestra (filtro + tope) y AGRUPA los
 * motivos de error, para que el usuario lea "12 filas sin precio" en vez de
 * cazar íconos rojos uno por uno.
 *
 * Vive fuera del componente porque no depende de React ni de `xlsx`: así se
 * prueba con datos reales sin montar un modal ni leer un archivo.
 */

/** Fila mínima que necesita la vista previa. Evita atar este módulo al parser. */
export interface PreviewRow {
    excelRow: number;
    valid: boolean;
    errors: string[];
}

export type PreviewFilter = 'ALL' | 'VALID' | 'ERRORS';

export const PREVIEW_FILTERS: readonly PreviewFilter[] = ['ALL', 'VALID', 'ERRORS'];

/** Tope por defecto de filas renderizadas antes de pedir "ver más". */
export const PREVIEW_PAGE_SIZE = 25;

export interface PreviewSelection<T extends PreviewRow> {
    /** Filas efectivamente renderizables, ya filtradas y acotadas. */
    visible: T[];
    /** Cuántas filas coinciden con el filtro, más allá del tope. */
    matching: number;
    /** Cuántas quedaron fuera por el tope. Cero significa que no falta nada. */
    hidden: number;
}

export function isPreviewFilter(value: unknown): value is PreviewFilter {
    return value === 'ALL' || value === 'VALID' || value === 'ERRORS';
}

export function matchesPreviewFilter(row: PreviewRow, filter: PreviewFilter): boolean {
    if (filter === 'VALID') return row.valid;
    if (filter === 'ERRORS') return !row.valid;
    return true;
}

/**
 * Filas a renderizar. `limit` acota el DOM, no los datos: `matching` y `hidden`
 * conservan el tamaño real para que la UI nunca insinúe que el archivo es más
 * chico de lo que es. Un `limit` no positivo no oculta nada — un tope inválido
 * no puede convertirse en "no hay filas".
 */
export function selectPreviewRows<T extends PreviewRow>(
    rows: readonly T[],
    filter: PreviewFilter,
    limit: number = PREVIEW_PAGE_SIZE,
): PreviewSelection<T> {
    const matched = rows.filter((row) => matchesPreviewFilter(row, filter));
    if (!Number.isFinite(limit) || limit <= 0) {
        return { visible: [...matched], matching: matched.length, hidden: 0 };
    }
    const cap = Math.floor(limit);
    return {
        visible: matched.slice(0, cap),
        matching: matched.length,
        hidden: Math.max(0, matched.length - cap),
    };
}

export interface PreviewCounts {
    total: number;
    valid: number;
    errors: number;
}

export function countPreviewRows(rows: readonly PreviewRow[]): PreviewCounts {
    let valid = 0;
    for (const row of rows) if (row.valid) valid += 1;
    return { total: rows.length, valid, errors: rows.length - valid };
}

export interface PreviewIssue {
    /** Texto del motivo, tal como lo produjo la validación. */
    motivo: string;
    /** Cuántas FILAS distintas tienen este motivo. */
    filas: number;
    /** Primeras filas de Excel afectadas, para poder ir al archivo y corregir. */
    ejemplos: number[];
}

/** Cuántas filas de ejemplo se nombran por motivo. */
export const PREVIEW_ISSUE_EXAMPLES = 3;

/**
 * Motivos de error agrupados, del más frecuente al menos.
 *
 * Una fila puede fallar por varias razones y cada una cuenta por separado, pero
 * un mismo motivo repetido en la misma fila se cuenta UNA vez: si no, un motivo
 * duplicado inflaría el conteo y haría creer que hay más filas rotas que las que
 * el archivo tiene. El desempate es por texto para que el orden sea estable.
 */
export function summarizePreviewIssues(rows: readonly PreviewRow[]): PreviewIssue[] {
    const issues = new Map<string, { filas: number; ejemplos: number[] }>();
    for (const row of rows) {
        if (row.valid) continue;
        for (const motivo of new Set(row.errors)) {
            const entry = issues.get(motivo) ?? { filas: 0, ejemplos: [] };
            entry.filas += 1;
            if (entry.ejemplos.length < PREVIEW_ISSUE_EXAMPLES) entry.ejemplos.push(row.excelRow);
            issues.set(motivo, entry);
        }
    }
    return [...issues.entries()]
        .map(([motivo, entry]) => ({ motivo, filas: entry.filas, ejemplos: entry.ejemplos }))
        .sort((a, b) => (b.filas - a.filas) || a.motivo.localeCompare(b.motivo));
}
