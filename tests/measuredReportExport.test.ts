import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildMeasuredReportExportRows } from '../utils/measuredReportExport';

describe('buildMeasuredReportExportRows', () => {
    it('serializa cantidades BASE como texto decimal exacto', () => {
        const rows = buildMeasuredReportExportRows([{
            productName: 'Carne molida',
            displayUnit: 'kg',
            saleMode: 'MEASURED',
            presentation: 'BASE',
            quantity: '0.7500',
        }]);

        expect(rows).toEqual([{
            Producto: 'Carne molida',
            'Unidad histórica': 'kg',
            Modo: 'MEASURED',
            Presentación: 'BASE',
            'Cantidad exacta': '0.7500',
        }]);
        expect(typeof rows[0]['Cantidad exacta']).toBe('string');

        const worksheet = XLSX.utils.json_to_sheet(rows, {
            header: ['Producto', 'Unidad histórica', 'Modo', 'Presentación', 'Cantidad exacta'],
        });
        expect(worksheet.E2).toMatchObject({ t: 's', v: '0.7500' });
    });

    it('preserva la cantidad de presentacion PACK sin convertirla a unidades base', () => {
        const rows = buildMeasuredReportExportRows([{
            productName: 'Concentrado bovino',
            displayUnit: 'empaque(s) · base lb',
            saleMode: 'MEASURED',
            presentation: 'PACK',
            quantity: '1.25',
        }]);

        expect(rows[0]).toMatchObject({
            'Unidad histórica': 'empaque(s) · base lb',
            Presentación: 'PACK',
            'Cantidad exacta': '1.25',
        });
    });

    it('no combina el mismo producto cuando cambian unidad o presentacion', () => {
        const rows = buildMeasuredReportExportRows([
            {
                productName: 'Carne molida',
                displayUnit: 'kg',
                saleMode: 'MEASURED',
                presentation: 'BASE',
                quantity: '1.5',
            },
            {
                productName: 'Carne molida',
                displayUnit: 'lb',
                saleMode: 'MEASURED',
                presentation: 'BASE',
                quantity: '2.75',
            },
            {
                productName: 'Carne molida',
                displayUnit: 'empaque(s) · base lb',
                saleMode: 'MEASURED',
                presentation: 'PACK',
                quantity: '1',
            },
        ]);

        expect(rows).toHaveLength(3);
        expect(rows.map((row) => [
            row['Unidad histórica'],
            row.Presentación,
            row['Cantidad exacta'],
        ])).toEqual([
            ['kg', 'BASE', '1.5'],
            ['lb', 'BASE', '2.75'],
            ['empaque(s) · base lb', 'PACK', '1'],
        ]);
    });

    it('conserva explicitamente el fallback historico de filas legacy', () => {
        const rows = buildMeasuredReportExportRows([{
            productName: 'Producto legado',
            displayUnit: 'unidad (fallback)',
            saleMode: 'MEASURED',
            presentation: 'BASE',
            quantity: '3',
        }]);

        expect(rows[0]).toEqual({
            Producto: 'Producto legado',
            'Unidad histórica': 'unidad (fallback)',
            Modo: 'MEASURED',
            Presentación: 'BASE',
            'Cantidad exacta': '3',
        });
    });
});
