import { describe, expect, it } from 'vitest';
import { mapApiProductImage } from '../utils/posProductMapper';

describe('mapeo de fotos de productos para el POS', () => {
    it('conserva la URL de la foto recibida desde la API', () => {
        expect(mapApiProductImage({
            imageUrl: 'https://res.cloudinary.com/nortex/image/upload/producto.webp',
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
});
