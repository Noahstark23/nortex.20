type SearchEntry = { path: string; label: string; shortLabel: string; group: string };

const ALIASES: Record<string, string> = {
    '/app/pos': 'cobrar ticket factura venta caja',
    '/app/sales': 'comprobante reimprimir devolver anular',
    '/app/receivables': 'fiado deuda abono cobrar credito',
    '/app/dashboard': 'ganancia utilidad plata dinero',
    '/app/reports': 'ganancia utilidad mes reporte fiscal',
    '/app/inventory': 'producto stock existencias catalogo',
    '/app/warehouses': 'bodega almacen stock existencias',
    '/app/purchases': 'compra proveedor factura',
    '/app/purchase-orders': 'orden recibir mercaderia',
};

const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-NI').trim();

/** Busca solamente en entradas que buildNavigation ya autorizó para el rol. */
export function searchAllowedActions<T extends SearchEntry>(entries: readonly T[], query: string): T[] {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries.filter((entry) => {
        const haystack = normalize(`${entry.label} ${entry.shortLabel} ${entry.group} ${ALIASES[entry.path] ?? ''}`);
        return words.every((word) => haystack.includes(word));
    }).slice(0, 8);
}
