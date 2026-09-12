import { describe, expect, it } from 'vitest';
import { buildImportedProductPayload, importInChunks, parseWorkbookRows } from '../utils/importProducts';

describe('importación de bodega: archivo real y cantidades', () => {
    it('lee las columnas canónicas de su propia plantilla', () => {
        const parsed = parseWorkbookRows([{ sku: 'CARNE', nombre: 'Carne', precio: 100,
            stock: 1.25, unidad: 'lb', modoVenta: 'MEASURED', pasoCantidad: 0.01,
            familiaProducto: 'MEAT', unidadEmpaque: 'bolsa', tamanoEmpaque: 2,
            precioEmpaque: 190, requiereLote: 'SÍ' }]);
        expect(parsed.resolution.unknown).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ valid: true, data: {
            modoVenta: 'MEASURED', pasoCantidad: 0.01, familiaProducto: 'MEAT',
            unidadEmpaque: 'bolsa', tamanoEmpaque: 2, requiereLote: true,
        } });
    });
    it('encuentra columnas con la primera celda vacía', () => {
        const parsed = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 1 },
            { SKU: 'B', Producto: 'B', Precio: 2, Costo: 15, Stock: 30 }]);
        expect(parsed.rows[1].data).toMatchObject({ costo: 15, stock: 30 });
    });
    it('0,125 kg son 0.125 kg, nunca 125 kg', () => {
        const parsed = parseWorkbookRows([{ SKU: 'A', Producto: 'Carne', Precio: 10,
            Existencia: '0,125', Unidad: 'kg', 'Modo venta': 'MEASURED', 'Paso cantidad': '0,001' }]);
        expect(parsed.rows[0]).toMatchObject({ valid: true, data: { stock: 0.125 } });
    });
    it('reconoce encabezados exportados y conserva clasificación LEGACY', () => {
        const parsed = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 10,
            'Modo de venta': 'LEGACY', 'Familia operativa': 'MEAT', 'Control por lote': 'SÍ' }]);
        expect(parsed.resolution.unknown).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ valid: true, data: { familiaProducto: 'MEAT', requiereLote: true } });
    });
    it('no pierde la posición original si hay renglones vacíos', () => {
        const row = { SKU: 'A', Producto: 'A', Precio: 10 };
        Object.defineProperty(row, '__rowNum__', { value: 7 });
        expect(parseWorkbookRows([row]).rows[0].excelRow).toBe(8);
    });
    it('rechaza códigos numéricos que Excel ya no puede representar exactamente', () => {
        expect(parseWorkbookRows([{ SKU: 123456789012345678, Producto: 'A', Precio: 10 }]).rows[0].valid).toBe(false);
    });
    it('un Excel de precios no inventa existencias ni configuración ausente', () => {
        const row = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 'C$ 1,250.50' }]).rows[0];
        expect(buildImportedProductPayload(row)).toEqual({ sku: 'A', name: 'A', price: '1250.5', excelRow: 2 });
    });
    it('celdas vacías preservan, mientras cero y false explícitos sí viajan', () => {
        const row = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 5, Costo: 0,
            Stock: 20, 'IVA exento': false, Categoria: '', 'Modo de venta': 'LEGACY' }]).rows[0];
        expect(buildImportedProductPayload(row)).toEqual({ sku: 'A', name: 'A', price: '5', excelRow: 2, cost: '0', ivaExento: false });
        expect(buildImportedProductPayload(row, { includeInitialStock: true })).toHaveProperty('stock', '20');
    });
    it('conserva texto monetario exacto y rechaza precisión física antes de Number', () => {
        const row = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: '123456789012345.67' }]).rows[0];
        expect(buildImportedProductPayload(row).price).toBe('123456789012345.67');
        const bad = parseWorkbookRows([{ SKU: 'B', Producto: 'B', Precio: 1, Stock: '99999999999.00001', 'Modo venta': 'MEASURED' }]);
        expect(bad.rows[0].valid).toBe(false);
    });
    it('no impone mínimo cinco a una configuración con paso dos', () => {
        const row = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 5, Stock: 4, modoVenta: 'COUNTED', pasoCantidad: 2 }]).rows[0];
        expect(row.valid).toBe(true);
        expect(buildImportedProductPayload(row)).not.toHaveProperty('minStock');
    });
    it('una respuesta ausente conserva las identidades sin afirmar rechazo', async () => {
        const row = parseWorkbookRows([{ SKU: 'A', Producto: 'A', Precio: 5 }]).rows[0];
        const result = await importInChunks([row], async () => { throw new Error('Sin conexión'); });
        expect(result).toMatchObject({ created: 0, updated: 0, failedChunks: 1, uncertainRows: [{ excelRow: 2, sku: 'A', reason: 'Sin conexión' }] });
    });
});
