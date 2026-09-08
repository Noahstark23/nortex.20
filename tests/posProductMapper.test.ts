import { describe, expect, it } from 'vitest';
import { mapApiProductForPos, mapApiProductImage } from '../utils/posProductMapper';

describe('mapeo de fotos de productos para el POS', () => {
    it('conserva la URL de la foto recibida desde la API y recorta espacios', () => {
        expect(mapApiProductImage({
            imageUrl: ' https://res.cloudinary.com/nortex/image/upload/producto.webp ',
        })).toEqual({
            imageUrl: 'https://res.cloudinary.com/nortex/image/upload/producto.webp',
        });
    });

    it('normaliza respuestas legacy sin foto para activar el fallback visual', () => {
        expect(mapApiProductImage({})).toEqual({ imageUrl: null });
        expect(mapApiProductImage({ imageUrl: null })).toEqual({ imageUrl: null });
        expect(mapApiProductImage({ imageUrl: '   ' })).toEqual({ imageUrl: null });
    });

    it('no propaga valores no textuales como fuente de una imagen', () => {
        expect(mapApiProductImage({ imageUrl: 42 })).toEqual({ imageUrl: null });
    });

    it('mapea el contrato completo del POS con stock vendible autoritativo', () => {
        expect(mapApiProductForPos({
            id: 'product-a',
            name: 'Amoxicilina',
            sku: 'AMX-500',
            price: 25,
            cost: 10,
            stock: 40,
            sellableStock: 0,
            category: 'Antibióticos',
            unit: 'cápsula',
            wholesalePrice: '21.50',
            wholesaleMinQty: '6',
            packUnit: 'caja',
            packSize: '12',
            packPrice: '240',
            saleMode: 'UNIT_ONLY',
            quantityStep: '0.25',
            ivaExento: true,
            productFamily: 'PHARMACY',
            imageUrl: ' https://img.test/amx.webp ',
        })).toEqual(expect.objectContaining({
            id: 'product-a',
            name: 'Amoxicilina',
            sku: 'AMX-500',
            price: 25,
            costPrice: 10,
            stock: 0,
            category: 'Antibióticos',
            unit: 'cápsula',
            wholesalePrice: 21.5,
            wholesaleMinQty: 6,
            packUnit: 'caja',
            packSize: 12,
            packPrice: 240,
            saleMode: 'UNIT_ONLY',
            quantityStep: 0.25,
            ivaExento: true,
            productFamily: 'PHARMACY',
            imageUrl: 'https://img.test/amx.webp',
        }));
    });

    it('cae al stock legacy y normaliza defaults cuando el backend no manda campos opcionales', () => {
        expect(mapApiProductForPos({
            id: 'product-b',
            name: 'Vitamina C',
            sku: 'VIT-C',
            price: 15,
            cost: 5,
            stock: 7,
            category: '   ',
            unit: '   ',
            wholesalePrice: null,
            wholesaleMinQty: undefined,
            packUnit: 99,
            packSize: null,
            packPrice: undefined,
            quantityStep: null,
            ivaExento: false,
            productFamily: 7,
        })).toEqual(expect.objectContaining({
            stock: 7,
            category: 'General',
            unit: 'unidad',
            wholesalePrice: null,
            wholesaleMinQty: null,
            packUnit: null,
            packSize: null,
            packPrice: null,
            quantityStep: null,
            ivaExento: false,
            productFamily: null,
            imageUrl: null,
        }));
    });

    it('convierte numéricos opcionales cuando sí vienen y conserva strings válidos sin inventar trim semántico', () => {
        expect(mapApiProductForPos({
            id: 'product-c',
            name: 'Jarabe',
            sku: 'JRB-1',
            price: '30.5',
            cost: '12.25',
            sellableStock: '3.5',
            wholesalePrice: 28,
            wholesaleMinQty: '2',
            packUnit: 'frasco',
            packSize: '1',
            packPrice: '30.5',
            quantityStep: '0.5',
            ivaExento: 'true',
            productFamily: 'PHARMACY',
        })).toEqual(expect.objectContaining({
            price: 30.5,
            costPrice: 12.25,
            stock: 3.5,
            wholesalePrice: 28,
            wholesaleMinQty: 2,
            packUnit: 'frasco',
            packSize: 1,
            packPrice: 30.5,
            quantityStep: 0.5,
            ivaExento: false,
            productFamily: 'PHARMACY',
        }));
    });
});
