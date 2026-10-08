export interface MeasuredQuantityBreakdownRow {
    productName: string;
    displayUnit: string;
    saleMode: 'COUNTED' | 'MEASURED';
    presentation: 'BASE' | 'PACK';
    quantity: string;
}

export interface MeasuredReportExportRow {
    Producto: string;
    'Unidad histórica': string;
    Modo: 'COUNTED' | 'MEASURED';
    Presentación: 'BASE' | 'PACK';
    'Cantidad exacta': string;
}

/**
 * Construye las filas del XLSX sin reagrupar ni convertir cantidades a Number.
 * `quantityBreakdown` ya fue agrupado por producto, unidad historica y
 * presentacion en el servidor; conservar cada fila evita mezclar magnitudes
 * incompatibles y mantener el decimal como texto evita perdida de precision.
 */
export const buildMeasuredReportExportRows = (
    breakdown: readonly MeasuredQuantityBreakdownRow[],
): MeasuredReportExportRow[] => breakdown.map((row) => ({
    Producto: row.productName,
    'Unidad histórica': row.displayUnit,
    Modo: row.saleMode,
    Presentación: row.presentation,
    'Cantidad exacta': row.quantity,
}));
