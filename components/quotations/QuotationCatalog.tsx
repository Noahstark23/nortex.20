import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Product, CartItem } from '../../types';
import { CajaNicaCatalog } from '../pos/CajaNicaCatalog';
import { buscarProductos, indexarProductos } from '../../utils/posSearch';

interface Props {
    products: Product[]; cart: CartItem[]; loading: boolean; error: boolean;
    onRetry: () => void; onAdd: (product: Product) => void;
}

/** Comparte reconocimiento y búsqueda con el mostrador; cotizar no reserva stock. */
export function QuotationCatalog({ products, cart, loading, error, onRetry, onAdd }: Props) {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('Todos');
    const [limit, setLimit] = useState(24);
    const [hint, setHint] = useState('');
    const index = useMemo(() => indexarProductos(products), [products]);
    const categories = useMemo(() => ['Todos', ...new Set(products.map(p => p.category?.trim()).filter(Boolean))], [products]);
    const result = useMemo(() => search.trim() ? buscarProductos(index, search, limit) : (() => {
        const matches = category === 'Todos' ? products : products.filter(p => p.category?.trim() === category);
        return { visibles: matches.slice(0, limit), total: matches.length };
    })(), [search, index, limit, category, products]);
    const quantities = useMemo(() => new Map(cart.map(item => [item.id, item.quantity])), [cart]);
    return <section className="nx-quote-catalog" aria-label="Productos para cotizar">
        <label htmlFor="quotation-search">Buscá o escaneá un producto</label>
        <div className="nx-quote-search">
            <Search size={20} aria-hidden="true" />
            <input id="quotation-search" autoFocus placeholder="Nombre, código o marca" value={search}
                onChange={e => { setSearch(e.target.value); setLimit(24); setHint(''); }}
                onKeyDown={e => {
                    if (e.key !== 'Enter' || !search.trim() || loading || error) return;
                    e.preventDefault();
                    if (result.total === 1) { onAdd(result.visibles[0]); setSearch(''); setLimit(24); setHint('Producto agregado a la proforma.'); }
                    else setHint(result.total ? 'Hay varias coincidencias. Elegí el producto que necesitás.' : 'No encontramos ese producto. Probá otro nombre o código.');
                }} />
            {search && <button type="button" aria-label="Limpiar búsqueda" onClick={() => { setSearch(''); setLimit(24); setHint(''); }}><X size={18}/></button>}
        </div>
        {hint && <p role="status" className="nx-quote-hint">{hint}</p>}
        {loading ? <p role="status" className="nx-quote-empty">Cargando productos…</p>
            : error ? <div role="alert" className="nx-quote-empty"><h2>No pudimos cargar los productos</h2><p>Reintentá para seguir armando la proforma.</p><button onClick={onRetry}>Reintentar</button></div>
            : !products.length ? <div className="nx-quote-empty"><h2>Tu catálogo está vacío</h2><p>Agregá productos en Bodega y volvé para cotizarlos.</p><button onClick={onRetry}>Actualizar catálogo</button></div>
            : !result.total ? <div className="nx-quote-empty"><h2>No encontramos ese producto</h2><p>Probá otro nombre, código o marca.</p><button onClick={() => { setSearch(''); setCategory('Todos'); }}>Ver todos los productos</button></div>
            : <CajaNicaCatalog products={result.visibles} totalProducts={result.total} categories={search.trim() ? [] : categories}
                selectedCategory={category} searchTerm={search} blockedProductIds={new Set()} quantitiesByProduct={quantities} selectionLabel="En la proforma"
                onCategoryChange={value => { setCategory(value); setLimit(24); }} onAdd={onAdd} onBlocked={onAdd} onShowMore={() => setLimit(value => value + 24)} />}
    </section>;
}
