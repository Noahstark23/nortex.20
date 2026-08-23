import { describe, expect, it } from 'vitest';
import { CreateProductSchema, UpdateProductSchema } from '../backend/validation/schemas';
import {
    buildCreateProductPayload,
    productValidationMessage,
    type ProductFormState,
} from '../utils/productForm';
import { productFamilyPreset } from '../utils/productFamilyPresets';

/** Estado del formulario de Inventario tras elegir la familia "Pollos y aves". */
const formularioPollo = (overrides: Partial<ProductFormState> = {}): ProductFormState => {
    const preset = productFamilyPreset('POULTRY');
    return {
        name: 'Pollo entero',
        sku: 'POLLO-01',
        description: '',
        category: '',
        price: '95',
        cost: '80',
        stock: '100',
        minStock: '5',
        unit: preset.unit,
        isPublished: false,
        imageUrl: '',
        requiresBatchTracking: preset.requiresBatchTracking,
        ivaExento: false,
        reorderPoint: '',
        maxStock: '',
        wholesalePrice: '',
        wholesaleMinQty: '',
        packUnit: preset.packUnit,
        packSize: preset.packSize,
        packPrice: '',
        saleMode: preset.saleMode,
        quantityStep: preset.quantityStep,
        productFamily: 'POULTRY',
        ...overrides,
    };
};

/** Lo que realmente viaja por HTTP: JSON.stringify borra las claves undefined. */
const cuerpoHttp = (form: ProductFormState) =>
    JSON.parse(JSON.stringify(buildCreateProductPayload(form)));

describe('alta de producto — formulario de Inventario contra el schema', () => {
    it('registra 100 lb de pollo dejando en blanco reorden y stock objetivo', () => {
        const result = CreateProductSchema.safeParse(cuerpoHttp(formularioPollo()));

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.stock).toBe('100');
        expect(result.data.unit).toBe('lb');
        expect(result.data.saleMode).toBe('MEASURED');
        // En blanco = sin valor: el handler aplica su default (`reorderPoint ?? '0'`).
        expect(result.data.reorderPoint).toBeUndefined();
        expect(result.data.maxStock).toBeUndefined();
    });

    it('no manda cadenas vacías y conserva el dinero como texto decimal', () => {
        const body = cuerpoHttp(formularioPollo({ price: '95.75', cost: '80.5' }));

        expect(Object.values(body)).not.toContain('');
        expect(body).not.toHaveProperty('reorderPoint');
        expect(body).not.toHaveProperty('maxStock');
        expect(body).not.toHaveProperty('wholesalePrice');
        expect(body.price).toBe('95.75');
        expect(body.cost).toBe('80.5');
    });

    it('aplica los defaults del alta cuando stock y mínimo quedan vacíos', () => {
        const result = CreateProductSchema.safeParse(cuerpoHttp(formularioPollo({ stock: '', minStock: '' })));

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.stock).toBe('0');
        expect(result.data.minStock).toBe('5');

        // Y también cuando las claves ni siquiera viajan (importador masivo).
        const sinClaves = CreateProductSchema.safeParse({ name: 'Pollo entero', sku: 'POLLO-02', price: 95, cost: 80 });
        expect(sinClaves.success).toBe(true);
        if (sinClaves.success) {
            expect(sinClaves.data.stock).toBe('0');
            expect(sinClaves.data.minStock).toBe('5');
            expect(sinClaves.data.unit).toBe('unidad');
        }
    });

    it('tolera el null que deja un parseFloat fallido en un cliente viejo', () => {
        const result = CreateProductSchema.safeParse({
            ...cuerpoHttp(formularioPollo()),
            reorderPoint: null,
            maxStock: null,
            stock: null,
        });

        expect(result.success).toBe(true);
        if (result.success) expect(result.data.stock).toBe('0');
    });

    it('sigue rechazando cantidades presentes pero inválidas', () => {
        const negativo = CreateProductSchema.safeParse(cuerpoHttp(formularioPollo({ reorderPoint: '-1' })));
        expect(negativo.success).toBe(false);
        if (!negativo.success) {
            expect(negativo.error.flatten().fieldErrors.reorderPoint?.[0]).toContain('negativa');
        }

        // 5 decimales exceden Decimal(18,4) y el paso 0.01 de la familia.
        expect(CreateProductSchema.safeParse(cuerpoHttp(formularioPollo({ maxStock: '1.00001' }))).success).toBe(false);
        // El paso de la familia manda: 0.005 lb no es múltiplo de 0.01.
        expect(CreateProductSchema.safeParse(cuerpoHttp(formularioPollo({ stock: '0.005' }))).success).toBe(false);
    });

    it('en la edición, un campo vacío significa "no cambiar"', () => {
        const result = UpdateProductSchema.safeParse({ price: '120', reorderPoint: '', maxStock: '' });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.reorderPoint).toBeUndefined();
        expect(result.data.maxStock).toBeUndefined();
    });
});

describe('mensaje de error del formulario de productos', () => {
    it('nombra el campo en vez de mostrar solo el genérico', () => {
        const mensaje = productValidationMessage({
            error: 'Datos de entrada inválidos',
            details: { reorderPoint: ['La cantidad no puede ser negativa'] },
        }, 'No pudimos crear el producto.');

        expect(mensaje).toBe('Punto de reorden: La cantidad no puede ser negativa');
    });

    it('cae al error del backend y luego al fallback', () => {
        expect(productValidationMessage({ error: 'SKU ya existe en tu inventario' }, 'fallback'))
            .toBe('SKU ya existe en tu inventario');
        expect(productValidationMessage({}, 'No pudimos crear el producto.'))
            .toBe('No pudimos crear el producto.');
        expect(productValidationMessage(undefined, 'No pudimos crear el producto.'))
            .toBe('No pudimos crear el producto.');
    });
});

describe('frontera de dinero del alta de productos', () => {
    const conPrecio = (price: unknown, cost: unknown = '80') =>
        CreateProductSchema.safeParse({ ...cuerpoHttp(formularioPollo()), price, cost });

    it('rechaza montos que parseFloat aceptaba a medias', () => {
        // parseFloat('1,500.00') === 1: el producto quedaba a C$1 en vez de C$1,500.
        expect(conPrecio('1,500.00').success).toBe(false);
        expect(conPrecio('12abc').success).toBe(false);
        expect(conPrecio('Infinity').success).toBe(false);
        expect(conPrecio('1e400').success).toBe(false);
        expect(conPrecio('-5').success).toBe(false);
        expect(conPrecio('0').success).toBe(false);
        expect(conPrecio('').success).toBe(false);
    });

    it('acepta texto y número y los normaliza a texto Decimal-safe', () => {
        const texto = conPrecio('95.75', '80.5');
        expect(texto.success).toBe(true);
        if (texto.success) {
            expect(texto.data.price).toBe('95.75');
            expect(texto.data.cost).toBe('80.5');
        }

        const numero = conPrecio(95.75, 0);
        expect(numero.success).toBe(true);
        if (numero.success) {
            expect(numero.data.price).toBe('95.75');
            expect(numero.data.cost).toBe('0');
        }
    });
});
