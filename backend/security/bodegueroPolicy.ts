/**
 * BODEGUERO es un rol operativo de bodega: puede mover, contar, recibir y
 * ajustar inventario, pero no navegar por compras financieras, billing,
 * dashboard ni módulos administrativos aunque el endpoint solo tenga
 * `authenticate`.
 */

export const BODEGUERO_ROLE = 'BODEGUERO';

const ALLOWED_PATTERNS: Array<{ method: string; pattern: RegExp }> = [
    // Contexto mínimo no financiero del negocio para el shell autenticado.
    { method: 'GET', pattern: /^\/api\/tenant\/info$/ },
    { method: 'GET', pattern: /^\/api\/products$/ },
    { method: 'GET', pattern: /^\/api\/products\/categories$/ },
    { method: 'GET', pattern: /^\/api\/kardex\/[^/]+$/ },
    { method: 'GET', pattern: /^\/api\/warehouses$/ },
    { method: 'GET', pattern: /^\/api\/warehouses\/[^/]+\/stock$/ },
    { method: 'GET', pattern: /^\/api\/stock-transfers$/ },
    { method: 'POST', pattern: /^\/api\/stock-transfers$/ },
    { method: 'POST', pattern: /^\/api\/inventory\/adjust$/ },
    { method: 'GET', pattern: /^\/api\/inventory\/batches\/[^/]+$/ },
    { method: 'GET', pattern: /^\/api\/stock-counts$/ },
    { method: 'POST', pattern: /^\/api\/stock-counts$/ },
    { method: 'GET', pattern: /^\/api\/stock-counts\/[^/]+$/ },
    { method: 'PATCH', pattern: /^\/api\/stock-counts\/[^/]+\/count$/ },
    { method: 'POST', pattern: /^\/api\/stock-counts\/[^/]+\/close$/ },
    { method: 'POST', pattern: /^\/api\/stock-counts\/[^/]+\/cancel$/ },
    { method: 'GET', pattern: /^\/api\/purchase-orders$/ },
    { method: 'GET', pattern: /^\/api\/purchase-orders\/[^/]+$/ },
    { method: 'POST', pattern: /^\/api\/purchase-orders\/[^/]+\/receive$/ },
    // Salida fisica puntual. No habilita listar/consultar el expediente del
    // proveedor ni ninguna nota de credito/CxP bajo el mismo prefijo.
    { method: 'GET', pattern: /^\/api\/suppliers\/[^/]+\/returns$/ },
    { method: 'POST', pattern: /^\/api\/suppliers\/[^/]+\/returns$/ },
];

function normalizePath(url: string): string {
    const noQuery = url.split(/[?#]/, 1)[0] || '/';
    if (noQuery.length > 1 && noQuery.endsWith('/')) return noQuery.slice(0, -1);
    return noQuery;
}

export function isBodegueroRouteAllowed(method: string, url: string): boolean {
    const normalizedMethod = method.toUpperCase();
    const path = normalizePath(url);
    return ALLOWED_PATTERNS.some(({ method: allowedMethod, pattern }) =>
        allowedMethod === normalizedMethod && pattern.test(path));
}

const PRODUCT_PRIVATE_FIELDS = [
    'tenantId',
    'price',
    'cost',
    'wholesalePrice',
    'wholesaleMinQty',
    'packPrice',
    'defaultSupplierId',
    'createdBy',
    'creator',
] as const;

/** Quita precios, costos e identificadores internos del catálogo operativo. */
export function redactBodegueroProduct<T extends Record<string, any>>(product: T): Record<string, any> {
    const safe: Record<string, any> = { ...product };
    for (const field of PRODUCT_PRIVATE_FIELDS) delete safe[field];
    return safe;
}

/**
 * Una recepción solo necesita identidad, estado, proveedor y cantidades.
 * No entrega costos unitarios, facturas/totales ni el expediente del proveedor.
 */
export function redactBodegueroPurchaseOrder<T extends Record<string, any>>(order: T): Record<string, any> {
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        notes: order.notes ?? null,
        expectedDate: order.expectedDate ?? null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        supplier: order.supplier ? { id: order.supplier.id, name: order.supplier.name } : null,
        items: Array.isArray(order.items)
            ? order.items.map((item: Record<string, any>) => ({
                id: item.id,
                productId: item.productId,
                productName: item.productName,
                quantityOrdered: item.quantityOrdered,
                quantityReceived: item.quantityReceived,
                ...(item.product ? {
                    product: { requiresBatchTracking: Boolean(item.product.requiresBatchTracking) },
                } : {}),
            }))
            : [],
    };
}
