import { describe, expect, it } from 'vitest';
import {
    parseQuantityNi,
    parseBooleanNi,
    parseWorkbookRows,
    resolveColumns,
} from '../utils/importProducts';

describe('importador de productos medidos', () => {
    it('mantiene compatible una plantilla histórica y aplica defaults explícitos', () => {
        const result = parseWorkbookRows([{
            Código: 'POLLO-1',
            Producto: 'Pollo entero',
            Precio: 85,
            Costo: 67,
            Existencia: 12,
            Unidad: 'unidad',
        }]);

        expect(result.rows[0]).toMatchObject({
            valid: true,
            data: {
                modoVenta: 'COUNTED',
                pasoCantidad: 1,
                familiaProducto: 'GENERAL',
                unidadEmpaque: null,
                tamanoEmpaque: null,
                precioEmpaque: null,
                requiereLote: false,
                ivaExento: false,
            },
        });
    });

    it('importa 37.50 kg sin truncar y conserva la clasificación operativa', () => {
        const result = parseWorkbookRows([{
            sku: 'RES-KG',
            nombre: 'Posta de res',
            precio: 145,
            costo: 112,
            stock: 37.5,
            unidad: 'kg',
            'Modo de venta': 'por peso',
            'Paso de cantidad': '0.001',
            'Familia producto': 'carnes',
        }]);

        expect(result.rows[0].valid).toBe(true);
        expect(result.rows[0].data).toMatchObject({
            stock: 37.5,
            unidad: 'kg',
            modoVenta: 'MEASURED',
            pasoCantidad: 0.001,
            familiaProducto: 'MEAT',
        });
    });

    it('rechaza una fracción cuando la fila declara COUNTED', () => {
        const result = parseWorkbookRows([{
            sku: 'HUEVO', nombre: 'Huevo', precio: 7, stock: 1.5,
            'Modo venta': 'COUNTED', 'Paso cantidad': 1,
        }]);

        expect(result.rows[0].valid).toBe(false);
        expect(result.rows[0].errors.join(' ')).toContain('contables');
    });

    it('rechaza pasos con más de cuatro decimales y cantidades fuera del paso', () => {
        const badPrecision = parseWorkbookRows([{
            sku: 'A', nombre: 'A', precio: 1,
            'Modo venta': 'MEASURED', 'Paso cantidad': '0.00001',
        }]);
        const badMultiple = parseWorkbookRows([{
            sku: 'B', nombre: 'B', precio: 1, stock: 1.25,
            'Modo venta': 'MEASURED', 'Paso cantidad': '0.1',
        }]);

        expect(badPrecision.rows[0].valid).toBe(false);
        expect(badMultiple.rows[0].valid).toBe(false);
        expect(badMultiple.rows[0].errors.join(' ')).toContain('múltiplo');
    });

    it('resuelve las columnas nuevas sin robar "familia" a categoría', () => {
        const resolution = resolveColumns(['SKU', 'Producto', 'Precio', 'Familia', 'Familia producto']);
        expect(resolution.mapping.categoria).toBe('Familia');
        expect(resolution.mapping.familiaProducto).toBe('Familia producto');
    });

    it('acepta coma decimal hasta cuatro posiciones', () => {
        expect(parseQuantityNi('0,001')).toBe(0.001);
        expect(parseQuantityNi('1,2345')).toBe(1.2345);
        expect(parseQuantityNi('0,00001')).toBeNull();
    });

    it('importa empaque, lote e IVA con valores habituales de Excel', () => {
        const result = parseWorkbookRows([{
            SKU: 'CERDO-SACO',
            Producto: 'Concentrado para cerdo',
            Precio: 16,
            Costo: 12.5,
            Existencia: 200,
            Unidad: 'lb',
            'Modo venta': 'MEASURED',
            'Paso cantidad': 0.25,
            'Familia producto': 'alimento animal',
            'Unidad empaque': 'saco',
            'Tamaño empaque': 100,
            'Precio empaque': 'C$ 1,500.00',
            Lote: 'SÍ',
            'IVA exento': 'NO',
        }]);

        expect(result.rows[0].valid).toBe(true);
        expect(result.rows[0].data).toMatchObject({
            unidadEmpaque: 'saco',
            tamanoEmpaque: 100,
            precioEmpaque: 1500,
            requiereLote: true,
            ivaExento: false,
        });
    });

    it('rechaza empaques incompletos y factores incompatibles con el step', () => {
        const missingSize = parseWorkbookRows([{
            SKU: 'A', Producto: 'A', Precio: 10,
            'Unidad empaque': 'saco',
        }]);
        const countedFraction = parseWorkbookRows([{
            SKU: 'B', Producto: 'B', Precio: 10,
            'Modo venta': 'COUNTED', 'Paso cantidad': 1,
            'Unidad empaque': 'caja', 'Tamaño empaque': 12.5,
        }]);
        const measuredMismatch = parseWorkbookRows([{
            SKU: 'C', Producto: 'C', Precio: 10,
            'Modo venta': 'MEASURED', 'Paso cantidad': 0.25,
            'Unidad empaque': 'bolsa', 'Tamaño empaque': 0.3,
        }]);

        expect(missingSize.rows[0].valid).toBe(false);
        expect(missingSize.rows[0].errors.join(' ')).toContain('requiere tamaño');
        expect(countedFraction.rows[0].valid).toBe(false);
        expect(countedFraction.rows[0].errors.join(' ')).toContain('contables');
        expect(measuredMismatch.rows[0].valid).toBe(false);
        expect(measuredMismatch.rows[0].errors.join(' ')).toContain('múltiplo');
    });

    it('rechaza booleanos ambiguos y conserva los formatos sí/no conocidos', () => {
        expect(parseBooleanNi('Sí')).toBe(true);
        expect(parseBooleanNi('gravado')).toBe(false);
        expect(parseBooleanNi('tal vez')).toBeNull();

        const result = parseWorkbookRows([{
            SKU: 'LOTE-X', Producto: 'Lote X', Precio: 10, Lote: 'tal vez',
        }]);
        expect(result.rows[0].valid).toBe(false);
        expect(result.rows[0].errors.join(' ')).toContain('sí/no');
    });

    it('resuelve columnas B7 sin cambiar el alias histórico Empaque de unidad base', () => {
        const resolution = resolveColumns([
            'SKU', 'Producto', 'Precio', 'Empaque',
            'Unidad empaque', 'PackSize', 'PackPrice', 'Lote', 'IVA exento',
        ]);

        expect(resolution.mapping.unidad).toBe('Empaque');
        expect(resolution.mapping.unidadEmpaque).toBe('Unidad empaque');
        expect(resolution.mapping.tamanoEmpaque).toBe('PackSize');
        expect(resolution.mapping.precioEmpaque).toBe('PackPrice');
        expect(resolution.mapping.requiereLote).toBe('Lote');
        expect(resolution.mapping.ivaExento).toBe('IVA exento');
    });
});
