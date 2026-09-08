import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Info, Plus } from 'lucide-react';
import type { Product } from '../../types';
import { formatMoney } from '../../utils/money';
import { cloudinaryProductSrcSet, normalizeProductImageSource } from '../ui/ProductImage';
import './compactCatalog.css';

export interface CajaNicaCatalogProps {
    /** La lista visible está acotada; totalProducts conserva el total real. */
    products: Product[];
    totalProducts: number;
    categories: string[];
    selectedCategory: string;
    searchTerm: string;
    blockedProductIds: Set<string>;
    quantitiesByProduct?: ReadonlyMap<string, number>;
    onCategoryChange: (category: string) => void;
    onAdd: (product: Product) => void;
    onBlocked: (product: Product) => void;
    onShowMore: () => void;
}

const stockFormatter = new Intl.NumberFormat('es-NI', { maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat('es-NI', { maximumFractionDigits: 4 });

/** Una foto ayuda a reconocer; si falta o falla, el nombre recupera su espacio. */
const CompactProductPhoto = ({ product, index }: { product: Product; index: number }) => {
    const source = normalizeProductImageSource(product.imageUrl);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    if (!source || source === failedSource) return null;
    return (
        <img
            className="nx-compact-catalog-photo"
            src={source}
            srcSet={cloudinaryProductSrcSet(source)}
            sizes="44px"
            alt=""
            loading={index < 8 ? 'eager' : 'lazy'}
            fetchPriority={index < 4 ? 'high' : 'auto'}
            decoding="async"
            onError={() => setFailedSource(source)}
        />
    );
};

/** Presentación compacta. El POS sigue siendo dueño de cantidad, stock y venta. */
export const CajaNicaCatalog = memo<CajaNicaCatalogProps>(({
    products, totalProducts, categories, selectedCategory, searchTerm,
    blockedProductIds, quantitiesByProduct, onCategoryChange, onAdd, onBlocked, onShowMore,
}) => {
    const catalogId = useId();
    const panelId = `${catalogId}-products`;
    const activeCategoryIndex = categories.indexOf(selectedCategory);
    const isSearching = searchTerm.trim().length > 0;
    const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
    const previousQuantities = useRef(quantitiesByProduct);

    useEffect(() => {
        // Un clic puede abrir la captura de peso o ser rechazado. Confirmar
        // únicamente un aumento observado en el carrito que administra el POS.
        const previous = previousQuantities.current;
        previousQuantities.current = quantitiesByProduct;
        if (!quantitiesByProduct) return;
        for (const [productId, quantity] of quantitiesByProduct) {
            if (Number.isFinite(quantity) && quantity > (previous?.get(productId) ?? 0)) {
                setRecentlyAddedId(productId);
                break;
            }
        }
    }, [quantitiesByProduct]);

    useEffect(() => {
        if (!recentlyAddedId) return undefined;
        const confirmationTimer = window.setTimeout(() => setRecentlyAddedId(null), 700);
        return () => window.clearTimeout(confirmationTimer);
    }, [recentlyAddedId]);

    const handleCategoryKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % categories.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + categories.length) % categories.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = categories.length - 1;
        if (nextIndex === null || categories.length === 0) return;
        event.preventDefault();
        event.currentTarget.parentElement
            ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
        onCategoryChange(categories[nextIndex]);
    };

    return (
        <section aria-labelledby={`${catalogId}-title`} className="nx-compact-catalog">
            <div className="nx-compact-catalog-header">
                <h2 id={`${catalogId}-title`} className="nx-compact-catalog-title">
                    {isSearching ? 'Resultados de búsqueda' : 'Productos'}
                </h2>
                <span className="nx-compact-catalog-count" aria-live="polite">
                    {products.length === totalProducts
                        ? `${totalProducts} ${totalProducts === 1 ? 'producto' : 'productos'}`
                        : `${products.length} de ${totalProducts}`}
                </span>
            </div>

            {categories.length > 0 && (
                <div role="tablist" aria-label="Categorías de productos" className="nx-compact-catalog-tabs">
                    {categories.map((category, index) => (
                        <button
                            key={category}
                            id={`${catalogId}-category-${index}`}
                            type="button"
                            role="tab"
                            aria-selected={category === selectedCategory}
                            aria-controls={panelId}
                            tabIndex={category === selectedCategory || activeCategoryIndex === -1 && index === 0 ? 0 : -1}
                            onClick={() => onCategoryChange(category)}
                            onKeyDown={(event) => handleCategoryKeyDown(event, index)}
                            className="nx-compact-catalog-tab min-h-tap min-w-tap"
                        >
                            {category}
                        </button>
                    ))}
                </div>
            )}

            <div
                id={panelId}
                role={categories.length > 0 ? 'tabpanel' : undefined}
                aria-labelledby={activeCategoryIndex >= 0 ? `${catalogId}-category-${activeCategoryIndex}` : undefined}
            >
                {products.length > 0 ? (
                    <>
                        <ul className="nx-compact-catalog-grid">
                            {products.map((product, index) => {
                                const unit = product.unit?.trim() || 'unidad';
                                const blocked = blockedProductIds.has(product.id);
                                const minimum = product.minStock === undefined ? 5 : product.minStock;
                                const lowStock = !blocked && typeof minimum === 'number' && Number.isFinite(minimum)
                                    && product.stock > 0 && product.stock <= minimum;
                                const formattedPrice = formatMoney(product.price);
                                const recentlyAdded = recentlyAddedId === product.id;
                                const quantity = quantitiesByProduct?.get(product.id);
                                const inCart = typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0;
                                const descriptor = product.productFamily?.trim() || (product.sku ? `SKU ${product.sku}` : '');
                                const stockLabel = blocked ? 'Agotado' : `${stockFormatter.format(product.stock)} en existencia · ${unit}`;

                                return (
                                    <li key={product.id}>
                                        <button
                                            type="button"
                                            aria-disabled={blocked || undefined}
                                            aria-label={blocked
                                                ? `${product.name}, agotado`
                                                : `Agregar ${product.name}, ${formattedPrice} por ${unit}, ${stockLabel}`}
                                            data-selected={recentlyAdded ? 'true' : undefined}
                                            data-in-cart={inCart ? 'true' : undefined}
                                            onClick={() => {
                                                if (blocked) onBlocked(product);
                                                else onAdd(product);
                                            }}
                                            className="nx-compact-catalog-product nx-fluid-press"
                                        >
                                            <span className="nx-compact-catalog-info">
                                                <span className="nx-compact-catalog-identity">
                                                    <CompactProductPhoto product={product} index={index} />
                                                    <span className="nx-compact-catalog-copy">
                                                        <span className="nx-compact-catalog-name" title={product.name}>{product.name}</span>
                                                        {descriptor && <span className="nx-compact-catalog-descriptor">{descriptor}</span>}
                                                    </span>
                                                </span>
                                                <span className="nx-compact-catalog-stock" data-low-stock={lowStock ? 'true' : undefined}>
                                    {blocked ? 'Agotado' : lowStock ? `${product.stock === 1 ? 'Queda' : 'Quedan'} ${stockFormatter.format(product.stock)} ${unit === 'unidad' && product.stock !== 1 ? 'unidades' : unit}` : stockLabel}
                                                </span>
                                                {inCart && (
                                                    <span className="nx-compact-catalog-quantity" aria-live="polite">
                                                        En la venta: {quantityFormatter.format(quantity)} {unit === 'unidad' && quantity !== 1 ? 'unidades' : unit}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="nx-compact-catalog-action">
                                                <span className="nx-compact-catalog-price">{formattedPrice}</span>
                                                <span className="nx-compact-catalog-unit">Por {unit}</span>
                                                <span aria-hidden="true" className="nx-compact-catalog-add">
                                                    {blocked ? <Info size={18} /> : recentlyAdded ? <Check size={18} strokeWidth={2.5} /> : <Plus size={18} strokeWidth={2.5} />}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {products.length < totalProducts && (
                            <div className="nx-compact-catalog-more">
                                <p>Quedan {totalProducts - products.length} por mostrar</p>
                                <button type="button" onClick={onShowMore} className="nx-compact-catalog-more-button min-h-tap">
                                    Mostrar más productos
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="nx-compact-catalog-empty">
                        <p>{isSearching ? `No encontramos productos para “${searchTerm.trim()}”.` : 'No hay productos en esta categoría.'}</p>
                    </div>
                )}
            </div>
        </section>
    );
});

CajaNicaCatalog.displayName = 'CajaNicaCatalog';
export default CajaNicaCatalog;
