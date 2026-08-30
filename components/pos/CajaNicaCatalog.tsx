import { memo, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import type { Product } from '../../types';
import { formatMoney } from '../../utils/money';
import { ProductImage } from '../ui/ProductImage';

export interface CajaNicaCatalogProps {
    /** Lo que se muestra: ya viene recortado por el POS. */
    products: Product[];
    totalProducts: number;
    categories: string[];
    selectedCategory: string;
    searchTerm: string;
    blockedProductIds: Set<string>;
    onCategoryChange: (category: string) => void;
    onAdd: (product: Product) => void;
    onBlocked: (product: Product) => void;
    onShowMore: () => void;
}

const stockFormatter = new Intl.NumberFormat('es-NI', {
    maximumFractionDigits: 3,
});

const PRODUCT_TILE_GRADIENTS = [
    'from-indigo-500/25 to-cyan-500/15',
    'from-emerald-500/25 to-teal-500/15',
    'from-rose-500/25 to-fuchsia-500/15',
    'from-amber-500/25 to-orange-500/15',
    'from-sky-500/25 to-blue-500/15',
];

const productoPaleta = (seed: string): string =>
    PRODUCT_TILE_GRADIENTS[
        Math.abs(
            seed.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
        ) % PRODUCT_TILE_GRADIENTS.length
    ];

/**
 * Catálogo táctil de Caja Nica.
 *
 * Los productos forman un solo rack: foto, nombre, unidad y precio quedan
 * siempre en el mismo lugar para que el cajero pueda reconocerlos por posición
 * mientras atiende.
 */
export const CajaNicaCatalog = memo<CajaNicaCatalogProps>(({
    products,
    totalProducts,
    categories,
    selectedCategory,
    searchTerm,
    blockedProductIds,
    onCategoryChange,
    onAdd,
    onBlocked,
    onShowMore,
}) => {
    const catalogId = useId();
    const panelId = `${catalogId}-products`;
    const activeCategoryIndex = categories.indexOf(selectedCategory);
    const isSearching = searchTerm.trim().length > 0;
    const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);

    useEffect(() => {
        if (!recentlyAddedId) return undefined;

        const confirmationTimer = window.setTimeout(() => {
            setRecentlyAddedId(null);
        }, 700);

        return () => window.clearTimeout(confirmationTimer);
    }, [recentlyAddedId]);

    const handleCategoryKeyDown = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentIndex: number,
    ) => {
        let nextIndex: number | null = null;

        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % categories.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + categories.length) % categories.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = categories.length - 1;

        if (nextIndex === null || categories.length === 0) return;

        event.preventDefault();
        const tabs = event.currentTarget.parentElement
            ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[nextIndex]?.focus();
        onCategoryChange(categories[nextIndex]);
    };

    return (
        <section
            aria-labelledby={`${catalogId}-title`}
            className="nx-catalog-plane min-w-0 text-slate-950"
        >
            <div className="nx-catalog-header mb-4 flex items-end justify-between gap-3 px-0.5">
                <div className="min-w-0">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Catálogo
                    </p>
                    <h2
                        id={`${catalogId}-title`}
                        className="truncate text-xl font-bold tracking-[-0.025em] text-slate-950"
                    >
                        {isSearching ? 'Resultados de búsqueda' : 'Productos'}
                    </h2>
                </div>
                {/* El número es el TOTAL, no el de la lista recortada. Antes decía
                    `products.length`, que ya venía cortado a 12: a un negocio con
                    1,003 productos la pantalla le afirmaba que tenía doce. */}
                <span
                    className="nx-catalog-count shrink-0 rounded-pill border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-600 shadow-sm"
                    aria-live="polite"
                >
                    {products.length === totalProducts
                        ? `${totalProducts} ${totalProducts === 1 ? 'producto' : 'productos'}`
                        : `${products.length} de ${totalProducts}`}
                </span>
            </div>

            {categories.length > 0 && (
                <div
                    role="tablist"
                    aria-label="Categorías de productos"
                    className="nx-catalog-tabs mb-4 flex max-w-full gap-2 overflow-x-auto pb-1"
                >
                    {categories.map((category, index) => {
                        const selected = category === selectedCategory;

                        return (
                            <button
                                key={category}
                                id={`${catalogId}-category-${index}`}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={panelId}
                                tabIndex={selected || activeCategoryIndex === -1 && index === 0 ? 0 : -1}
                                onClick={() => onCategoryChange(category)}
                                onKeyDown={(event) => handleCategoryKeyDown(event, index)}
                                className={`nx-catalog-tab nx-fluid-press relative min-h-11 shrink-0 rounded-control border px-4 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${selected
                                    ? 'border-brand/30 bg-brand text-brand-on shadow-sm'
                                    : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'}`}
                            >
                                {category}
                            </button>
                        );
                    })}
                </div>
            )}

            <div
                id={panelId}
                role={categories.length > 0 ? 'tabpanel' : undefined}
                aria-labelledby={activeCategoryIndex >= 0
                    ? `${catalogId}-category-${activeCategoryIndex}`
                    : undefined}
                className="nx-catalog-results overflow-hidden rounded-card"
            >
                {products.length > 0 ? (
                    <>
                        <ul className="nx-catalog-grid grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4">
                            {products.map((product, index) => {
                                const unit = product.unit?.trim() || 'unidad';
                                const blocked = blockedProductIds.has(product.id);
                                const lowStock = !blocked && product.stock > 0 && product.stock <= 5;
                                const formattedPrice = formatMoney(product.price);
                                const recentlyAdded = recentlyAddedId === product.id;
                                const descriptor = product.productFamily?.trim()
                                    || (product.sku ? `SKU ${product.sku}` : `Venta por ${unit}`);
                                const stockLabel = blocked
                                    ? 'Agotado'
                                    : `${stockFormatter.format(product.stock)} en existencia · ${unit}`;

                                return (
                                    <li key={product.id} className="min-w-0">
                                        <button
                                            type="button"
                                            aria-disabled={blocked || undefined}
                                            aria-label={blocked
                                                ? `${product.name}, agotado`
                                                : `Agregar ${product.name}, ${formattedPrice} por ${unit}, ${stockLabel}`}
                                            data-selected={recentlyAdded ? 'true' : undefined}
                                            onClick={() => {
                                                if (blocked) onBlocked(product);
                                                else onAdd(product);
                                                if (!blocked) setRecentlyAddedId(product.id);
                                            }}
                                            className={`nx-catalog-card nx-fluid-press group relative flex min-h-[216px] w-full flex-col overflow-hidden rounded-card border bg-white p-3 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 sm:min-h-[248px] sm:p-3.5 ${blocked
                                                ? 'cursor-not-allowed border-red-200 bg-red-50/80 opacity-70'
                                                : recentlyAdded
                                                    ? 'border-brand ring-2 ring-brand/20 shadow-md'
                                                    : 'border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:translate-y-0 active:shadow-sm'}`}
                                        >
                                            <div className="nx-catalog-card-media relative">
                                                <ProductImage
                                                    src={product.imageUrl}
                                                    alt={product.name}
                                                    loading={index < 8 ? 'eager' : 'lazy'}
                                                    fetchPriority={index < 4 ? 'high' : 'auto'}
                                                    sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                                                    className={`aspect-[5/4] w-full rounded-control border border-slate-200/80 bg-gradient-to-br ${productoPaleta(product.name)}`}
                                                    imageClassName="!object-contain p-3 transition-[opacity,transform] duration-200 group-hover:scale-[1.02]"
                                                    fallbackClassName="text-slate-600"
                                                />
                                                {recentlyAdded && (
                                                    <span
                                                        aria-hidden="true"
                                                        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-brand text-brand-on shadow-md"
                                                    >
                                                        <Check size={16} strokeWidth={3} />
                                                    </span>
                                                )}
                                            </div>

                                            <span className="nx-catalog-card-content mt-3 flex min-w-0 flex-1 flex-col">
                                                <span className={`line-clamp-2 text-[15px] font-bold leading-snug tracking-[-0.01em] sm:text-base ${blocked ? 'text-slate-500' : 'text-slate-950'}`}>
                                                    {product.name}
                                                </span>
                                                <span className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">
                                                    {descriptor}
                                                </span>
                                                <span className="text-[11px] font-medium text-slate-400">
                                                    Por {unit}
                                                </span>
                                            </span>

                                            <span className="mt-3 block border-t border-slate-100 pt-3">
                                                <span className={`nx-catalog-card-price nx-num block truncate text-lg font-black tracking-[-0.02em] sm:text-xl ${blocked ? 'text-slate-500' : 'text-slate-950'}`}>
                                                    {formattedPrice}
                                                </span>
                                                <span className={`nx-catalog-card-stock mt-1 block truncate text-[11px] font-semibold ${blocked
                                                    ? 'uppercase tracking-wide text-danger'
                                                    : lowStock
                                                        ? 'text-amber-700'
                                                        : 'text-slate-500'}`}
                                                >
                                                    {blocked
                                                        ? 'Agotado'
                                                        : lowStock
                                                            ? `Quedan ${stockFormatter.format(product.stock)} ${unit}`
                                                            : stockLabel}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {products.length < totalProducts && (
                            <div className="nx-catalog-more mt-4 rounded-card border border-slate-200 bg-white p-3 text-center shadow-sm">
                                <p className="mb-2 text-xs font-medium text-slate-500">
                                    Quedan {totalProducts - products.length} por mostrar
                                </p>
                                <button
                                    type="button"
                                    onClick={onShowMore}
                                    className="nx-fluid-press min-h-11 w-full rounded-control border border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-800 transition-[background-color,border-color,transform] hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                                >
                                    Mostrar más productos
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex min-h-[176px] items-center justify-center rounded-card border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                        <p className="max-w-sm text-sm font-medium text-slate-500">
                            {isSearching
                                ? `No encontramos productos para “${searchTerm.trim()}”.`
                                : 'No hay productos en esta categoría.'}
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
});

CajaNicaCatalog.displayName = 'CajaNicaCatalog';

export default CajaNicaCatalog;
