/**
 * NORTEX — Normalización del formulario de productos (frontend puro).
 *
 * PROBLEMA QUE RESUELVE: el alta de Inventario mandaba el estado del formulario
 * tal cual (`{ ...formData }`). Los campos opcionales que el dueño deja en
 * blanco viajaban como `''` y el backend los rechazaba con el genérico
 * "Datos de entrada inválidos", sin decir cuál campo. Un campo vacío significa
 * "sin valor": acá se OMITE del payload para que el servidor aplique su default.
 *
 * Precio y costo viajan como TEXTO decimal: `parseFloat` convertía un input
 * vacío o parcial ('.') en NaN, que `JSON.stringify` serializa como `null` y el
 * schema reporta como "Invalid input". El texto además no pierde precisión.
 */
import type { ProductFamily } from './productFamilyPresets';

export interface ProductFormState {
    name: string;
    sku: string;
    description: string;
    category: string;
    price: string;
    cost: string;
    stock: string;
    minStock: string;
    unit: string;
    isPublished: boolean;
    imageUrl: string;
    requiresBatchTracking: boolean;
    ivaExento: boolean;
    reorderPoint: string;
    maxStock: string;
    wholesalePrice: string;
    wholesaleMinQty: string;
    packUnit: string;
    packSize: string;
    packPrice: string;
    saleMode: 'COUNTED' | 'MEASURED';
    quantityStep: string;
    productFamily: ProductFamily;
}

/** Texto opcional: en blanco → `undefined` (JSON.stringify omite la clave). */
const opcional = (value: string): string | undefined => {
    const limpio = value.trim();
    return limpio === '' ? undefined : limpio;
};

/**
 * Arma el body de POST /api/products a partir del estado del formulario.
 * `stock` y `minStock` conservan el default explícito del formulario porque el
 * alta los registra siempre (stock inicial vía Kardex).
 */
export const buildCreateProductPayload = (form: ProductFormState) => ({
    name: form.name.trim(),
    sku: form.sku.trim().toUpperCase(),
    description: opcional(form.description),
    category: opcional(form.category),
    unit: opcional(form.unit) ?? 'unidad',
    price: form.price.trim(),
    cost: form.cost.trim(),
    stock: opcional(form.stock) ?? '0',
    minStock: opcional(form.minStock) ?? '5',
    reorderPoint: opcional(form.reorderPoint),
    maxStock: opcional(form.maxStock),
    wholesalePrice: opcional(form.wholesalePrice),
    wholesaleMinQty: opcional(form.wholesaleMinQty),
    packUnit: opcional(form.packUnit),
    packSize: opcional(form.packSize),
    packPrice: opcional(form.packPrice),
    saleMode: form.saleMode,
    quantityStep: opcional(form.quantityStep),
    productFamily: form.productFamily,
    imageUrl: opcional(form.imageUrl),
    isPublished: form.isPublished,
    ivaExento: form.ivaExento,
    requiresBatchTracking: form.requiresBatchTracking,
});

/** Etiquetas visibles del formulario, para nombrar el campo que falló. */
export const PRODUCT_FIELD_LABELS: Record<string, string> = {
    name: 'Nombre del producto',
    sku: 'SKU / Código',
    description: 'Descripción',
    category: 'Categoría',
    unit: 'Unidad',
    price: 'Precio de venta',
    cost: 'Costo de compra',
    stock: 'Stock inicial',
    minStock: 'Stock mínimo',
    reorderPoint: 'Punto de reorden',
    maxStock: 'Stock objetivo (máx)',
    wholesalePrice: 'Precio mayoreo',
    wholesaleMinQty: 'Cant. mínima mayoreo',
    packUnit: 'Empaque',
    packSize: 'Unid./emp.',
    packPrice: 'Precio empaque',
    saleMode: 'Forma de venta',
    quantityStep: 'Paso de cantidad',
    productFamily: 'Familia',
    imageUrl: 'Foto del producto',
    defaultSupplierId: 'Proveedor por defecto',
};

/**
 * Mensaje accionable desde la respuesta de error del backend. El middleware
 * `validate()` responde `{ error, details: { campo: [mensajes] } }`: mostrar
 * solo el genérico deja al dueño adivinando qué campo corregir.
 */
export const productValidationMessage = (data: unknown, fallback: string): string => {
    const payload = data as { error?: unknown; details?: unknown } | null | undefined;
    const details = payload?.details;
    if (details && typeof details === 'object') {
        for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
            if (Array.isArray(messages) && messages.length > 0) {
                return `${PRODUCT_FIELD_LABELS[field] ?? field}: ${String(messages[0])}`;
            }
        }
    }
    return typeof payload?.error === 'string' && payload.error.trim() !== ''
        ? payload.error
        : fallback;
};
