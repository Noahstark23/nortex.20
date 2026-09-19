import { useMemo, useRef } from 'react';
import { indexarProductos, type EntradaIndice, type ProductoBuscable } from '../utils/posSearch';

/** La venta refresca productos completos; solo normaliza de nuevo el texto que cambió. */
export function usePosSearchIndex<T extends ProductoBuscable>(products: T[]) {
    const previous = useRef<EntradaIndice<T>[]>([]);
    return useMemo(() => {
        const index = indexarProductos(products, previous.current);
        previous.current = index;
        return index;
    }, [products]);
}
