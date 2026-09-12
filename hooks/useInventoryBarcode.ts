import { useCallback, useEffect, useRef } from 'react';
interface ProductIdentity { id: string; name: string; sku: string; }
export function useInventoryBarcode<T extends ProductIdentity>(onProduct: (product: T) => void) {
    const active = useRef(true);
    const sequence = useRef(0);
    const controller = useRef<AbortController>();
    const callback = useRef(onProduct); callback.current = onProduct;
    useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
    return useCallback(async (code: string) => {
        const token = localStorage.getItem('nortex_token');
        const request = ++sequence.current;
        controller.current?.abort(); controller.current = new AbortController();
        const response = await fetch(`/api/products/by-barcode/${encodeURIComponent(code)}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.current.signal,
        });
        const payload = await response.json();
        if (!active.current || request !== sequence.current || token !== localStorage.getItem('nortex_token')) return;
        if (response.status === 404 && payload.code === 'PRODUCT_NOT_FOUND') throw Object.assign(new Error('Este código no está registrado. Revisalo o creá el producto.'), { code: 'PRODUCT_NOT_FOUND' });
        if (!response.ok) throw new Error('No pudimos comprobar el código. Reintentá la búsqueda.');
        if (!payload || typeof payload.id !== 'string' || typeof payload.name !== 'string' || typeof payload.sku !== 'string'
            || payload.sku.toUpperCase() !== code.toUpperCase()) throw new Error('La respuesta del catálogo no coincide con el código. Reintentá.');
        callback.current(payload);
    }, []);
}
