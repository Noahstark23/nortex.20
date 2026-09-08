import type { Product } from '../types';

interface ApiProductWithImage {
    imageUrl?: unknown;
}

interface ApiProductForPos extends ApiProductWithImage {
    id: unknown;
    name: unknown;
    sku: unknown;
    price: unknown;
    cost?: unknown;
    stock?: unknown;
    sellableStock?: unknown;
    category?: unknown;
    unit?: unknown;
    wholesalePrice?: unknown;
    wholesaleMinQty?: unknown;
    packUnit?: unknown;
    packSize?: unknown;
    packPrice?: unknown;
    saleMode?: unknown;
    quantityStep?: unknown;
    ivaExento?: unknown;
    productFamily?: unknown;
}

/**
 * Conserva la foto enviada por la API al adaptar un producto para el POS.
 * Las respuestas legacy o inválidas se normalizan a null para activar el
 * fallback visual de la tarjeta sin propagar valores ajenos a una URL string.
 */
export function mapApiProductImage(
    product: ApiProductWithImage,
): Pick<Product, 'imageUrl'> {
    return {
        imageUrl: typeof product.imageUrl === 'string' && product.imageUrl.trim()
            ? product.imageUrl.trim()
            : null,
    };
}

function optionalNumber(value: unknown): number | null {
    return value == null ? null : Number(value);
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/**
 * Mantiene en un solo dueño la traducción `/api/products` -> `Product` usada
 * por el POS. `sellableStock` solo reemplaza `stock` cuando viene del backend;
 * si no existe, conserva la compatibilidad con respuestas legacy.
 */
export function mapApiProductForPos(product: ApiProductForPos): Product {
    return {
        id: String(product.id),
        name: String(product.name),
        sku: String(product.sku),
        price: Number(product.price),
        costPrice: Number(product.cost),
        stock: Number(product.sellableStock ?? product.stock ?? 0),
        category: typeof product.category === 'string' && product.category.trim()
            ? product.category
            : 'General',
        unit: typeof product.unit === 'string' && product.unit.trim()
            ? product.unit
            : 'unidad',
        wholesalePrice: optionalNumber(product.wholesalePrice),
        wholesaleMinQty: optionalNumber(product.wholesaleMinQty),
        packUnit: optionalString(product.packUnit),
        packSize: optionalNumber(product.packSize),
        packPrice: optionalNumber(product.packPrice),
        saleMode: product.saleMode as Product['saleMode'],
        quantityStep: product.quantityStep == null ? null : Number(product.quantityStep),
        ivaExento: product.ivaExento === true,
        productFamily: optionalString(product.productFamily),
        ...mapApiProductImage(product),
    };
}
