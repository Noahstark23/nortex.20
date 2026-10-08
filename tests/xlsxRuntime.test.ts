import { describe, expect, it } from 'vitest';

describe('SheetJS runtime seguro', () => {
  it('conserva el flujo de importar y exportar hojas usado por Nortex', async () => {
    const XLSX = await import('xlsx');
    const originalRows = [
      ['SKU', 'Producto', 'Costo'],
      ['QA-001', 'Salsa kerns jumbo', 13.5],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(originalRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Inventario');

    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const parsed = XLSX.read(bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(parsed.Sheets.Inventario, {
      header: 1,
      raw: true,
    });

    expect(rows).toEqual(originalRows);
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
