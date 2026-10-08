import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import type { Product } from '../types';
import { resolverIdentidadPersistencia } from '../utils/cartPersistence';
import { mapApiProductForPos } from '../utils/posProductMapper';

function sessionStamp(): string {
    const identity = resolverIdentidadPersistencia(localStorage.getItem('nortex_tenant_data'), localStorage.getItem('nortex_user'));
    return JSON.stringify([localStorage.getItem('nortex_token'), identity?.tenantId, identity?.userId]);
}

function mapProducts(payload: unknown): Product[] {
    const numeric = (value: unknown) => typeof value === 'number' ? Number.isFinite(value)
        : typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/u.test(value) && Number.isFinite(Number(value));
    if (!Array.isArray(payload) || payload.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string'
        || typeof p.sku !== 'string' || !numeric(p.stock) || !numeric(p.price)
        || (p.sellableStock != null && !numeric(p.sellableStock)))) {
        throw new Error('Catálogo incompleto');
    }
    if (new Set(payload.map(p => p.id)).size !== payload.length) throw new Error('Productos duplicados');
    return payload.map(p => ({ ...mapApiProductForPos(p), minStock: p.minStock }));
}

/** Catálogo en memoria. Refrescos serializados por sesión; nunca resta stock local. */
export function usePosCatalog(headers: Record<string, string>) {
    const key = sessionStamp();
    const lane = useMemo(() => ({ key, active: true, queue: Promise.resolve(), controller: null as AbortController | null }), [key]);
    const [state, setState] = useState<{ key: string; products: Product[]; error: boolean }>({ key, products: [], error: false });
    const isCurrent = useCallback(() => lane.active && sessionStamp() === lane.key, [lane]);

    useEffect(() => {
        lane.active = true;
        return () => { lane.active = false; lane.controller?.abort(); };
    }, [lane]);

    const setProducts = useCallback((value: SetStateAction<Product[]>) => {
        if (!isCurrent()) return;
        setState(previous => ({ key, error: previous.key === key && previous.error,
            products: typeof value === 'function' ? value(previous.key === key ? previous.products : []) : value }));
    }, [isCurrent, key]);

    const refresh = useCallback((ids?: readonly string[]) => {
        // Orden de llegada: una lectura completa anterior nunca pisa una parcial más nueva.
        const task = lane.queue.then(async () => {
            if (!isCurrent()) return;
            const controller = new AbortController();
            lane.controller = controller;
            const read = async (requested?: readonly string[]) => {
                const query = `?includeSellableStock=true${requested ? `&ids=${requested.map(encodeURIComponent).join(',')}` : ''}`;
                const response = await fetch(`/api/products${query}`, { headers, signal: controller.signal });
                if (!response.ok) throw new Error('No se pudo actualizar el catálogo');
                const products = mapProducts(await response.json());
                // Un backend anterior que ignore ids debe usar el fallback completo.
                if (requested && products.some(product => !requested.includes(product.id))) throw new Error('Respuesta fuera del filtro');
                return products;
            };
            try {
                if (ids?.length) {
                    const requested = [...new Set(ids)];
                    const changed: Product[] = [];
                    for (let start = 0; start < requested.length; start += 100) {
                        if (!isCurrent()) return;
                        changed.push(...await read(requested.slice(start, start + 100)));
                    }
                    if (!isCurrent()) return;
                    const updates = new Map(changed.map(product => [product.id, product]));
                    const scope = new Set(requested);
                    setState(previous => {
                        const current = previous.key === key ? previous.products : [];
                        const existingIds = new Set(current.map(product => product.id));
                        return { key, error: false, products: [
                            ...current.flatMap(product => scope.has(product.id) ? updates.has(product.id) ? [updates.get(product.id)!] : [] : [product]),
                            ...changed.filter(product => !existingIds.has(product.id)),
                        ] };
                    });
                } else {
                    const products = await read();
                    if (isCurrent()) setState({ key, products, error: false });
                }
            } catch {
                if (!isCurrent()) return;
                if (ids?.length) {
                    try {
                        const products = await read();
                        if (isCurrent()) setState({ key, products, error: false });
                        return;
                    } catch { /* Conserva catálogo y muestra error si también falla el completo. */ }
                }
                if (isCurrent()) setState(previous => ({ key, products: previous.key === key ? previous.products : [], error: true }));
            } finally {
                if (lane.controller === controller) lane.controller = null;
            }
        });
        lane.queue = task.catch(() => undefined);
        return task;
    }, [headers, isCurrent, key, lane]);

    const fetchProducts = useCallback(() => refresh(), [refresh]);
    const refreshSoldProducts = useCallback((ids: readonly string[]) => ids.length ? refresh(ids) : Promise.resolve(), [refresh]);
    useEffect(() => {
        const onOnline = () => { void fetchProducts(); };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [fetchProducts]);

    return { products: state.key === key ? state.products : [], productsError: state.key === key && state.error,
        setProducts, fetchProducts, refreshSoldProducts };
}
