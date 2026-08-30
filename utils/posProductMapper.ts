import type { Product } from '../types';

interface ApiProductWithImage {
    imageUrl?: unknown;
}

/**
 * Conserva la foto enviada por la API al adaptar un producto para el POS.
 * Las respuestas legacy o inválidas se normalizan a null para activar el
 * fallback visual de la tarjeta sin propagar valores ajenos a una URL string.
 */
export const mapApiProductImage = (
    product: ApiProductWithImage,
): Pick<Product, 'imageUrl'> => ({
    imageUrl: typeof product.imageUrl === 'string' && product.imageUrl.trim()
        ? product.imageUrl.trim()
        : null,
});
