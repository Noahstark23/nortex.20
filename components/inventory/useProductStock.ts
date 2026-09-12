import { useEffect, useState } from 'react';

export interface ProductStockSnapshot {
    productId: string; totalStock: string; unit: string;
    warehouses: Array<{ id: string; name: string; isDefault: boolean; isActive: boolean; stock: string; implicit: boolean }>;
    hasMore: boolean; unlistedStock?: string;
}

const decimal = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,4})?$/.test(value) && Number.isFinite(Number(value));
function isSnapshot(value: any, productId: string): value is ProductStockSnapshot {
    return value?.productId === productId && decimal(value.totalStock) && typeof value.unit === 'string'
        && typeof value.hasMore === 'boolean' && (value.unlistedStock === undefined || decimal(value.unlistedStock))
        && Array.isArray(value.warehouses) && value.warehouses.every((row: any) => typeof row?.id === 'string' && row.id
            && typeof row.name === 'string' && typeof row.isActive === 'boolean' && row.isActive
            && typeof row.isDefault === 'boolean' && typeof row.implicit === 'boolean' && decimal(row.stock));
}

/** A response belongs to a product AND authenticated session; an old response never fills a new fiche. */
export function useProductStock(productId: string, revision: number) {
    const token = localStorage.getItem('nortex_token');
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<{ key: string; data?: ProductStockSnapshot; error?: string }>({ key: '' });
    const key = `${token}:${productId}:${revision}:${retry}`;
    useEffect(() => {
        let active = true;
        const abort = new AbortController();
        void (async () => {
            try {
                const response = await fetch(`/api/warehouses/product/${encodeURIComponent(productId)}/stock`, {
                    headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
                });
                const body = await response.json();
                if (!response.ok || body.success !== true || !isSnapshot(body.data, productId)) throw new Error('No pudimos cargar las existencias por bodega.');
                if (active) setResult({ key, data: body.data });
            } catch {
                if (active) setResult({ key, error: 'No pudimos cargar las existencias por bodega.' });
            }
        })();
        return () => { active = false; abort.abort(); };
    }, [key, productId, token]);
    const current = result.key === key ? result : null;
    return { data: current?.data, error: current?.error, loading: !current, retry: () => setRetry(value => value + 1) };
}
