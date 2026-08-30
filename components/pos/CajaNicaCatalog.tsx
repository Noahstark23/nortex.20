import { memo, useId, useState, type KeyboardEvent } from 'react';
import type { Product } from '../../types';
import { formatMoney } from '../../utils/money';

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

const productoIniciales = (name: string): string => {
    const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '??';
    if (words.length === 1) return words[0].slice(0, 2);
    return `${words[0][0]}${words[1][0]}`;
};

const productoPaleta = (seed: string): string =>
    PRODUCT_TILE_GRADIENTS[
        Math.abs(
            seed.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
        ) % PRODUCT_TILE_GRADIENTS.length
    ];

const ProductoMiniatura = ({
    name,
    imageUrl,
    className,
}: {
    name: string;
    imageUrl?: string | null;
    className: string;
}) => {
    const [imgError, setImgError] = useState(false);

    if (!imageUrl || imgError) {
        return (
            <div className={`${className} grid place-items-center rounded-control border border-white/[0.12] bg-gradient-to-br ${productoPaleta(name)}`}>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-white">
                    {productoIniciales(name)}
                </span>
            </div>
        );
    }

    return (
        <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            onError={() => setImgError(true)}
            className={`${className} object-cover`}
        />
    );
};

/**
 * Catálogo táctil de Caja Nica.
 *
 * Los productos forman un solo rack, sin fotografías ni tarjetas flotantes:
 * nombre, unidad y precio quedan siempre en el mismo lugar para que el cajero
 * pueda reconocerlos por posición mientras atiende.
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
    const ocultos = Math.max(0, totalProducts - products.length);

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
        <section aria-labelledby={`${catalogId}-title`} className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2
                    id={`${catalogId}-title`}
                    className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400"
                >
                    {isSearching ? 'Resultados' : 'Tus productos'}
                </h2>
                {/* El número es el TOTAL, no el de la lista recortada. Antes decía
                    `products.length`, que ya venía cortado a 12: a un negocio con
                    1,003 productos la pantalla le afirmaba que tenía doce. */}
                <span className="text-xs tabular-nums text-slate-500" aria-live="polite">
                    {products.length === totalProducts
                        ? `${totalProducts} ${totalProducts === 1 ? 'producto' : 'productos'}`
                        : `${products.length} de ${totalProducts}`}
                </span>
            </div>

            {categories.length > 0 && (
                <div
                    role="tablist"
                    aria-label="Categorías de productos"
                    className="mb-3 flex max-w-full gap-1 overflow-x-auto border-b border-white/[0.06] pb-px"
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
                                className={`relative min-h-tap shrink-0 px-4 text-sm font-semibold transition-colors focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-inset ${selected
                                    ? 'text-slate-50 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand'
                                    : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-100'}`}
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
                className="overflow-hidden rounded-card border border-white/[0.06] bg-white/[0.06]"
            >
                {products.length > 0 ? (
                    <>
                        <ul className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-4">
                            {products.map((product) => {
                                const unit = product.unit?.trim() || 'unidad';
                                const blocked = blockedProductIds.has(product.id);
                                const lowStock = !blocked && product.stock > 0 && product.stock <= 5;
                                const formattedPrice = formatMoney(product.price);

                                return (
                                    <li key={product.id} className="min-w-0 bg-surface-950">
                                        <button
                                            type="button"
                                            aria-disabled={blocked || undefined}
                                            aria-label={blocked
                                                ? `${product.name}, agotado`
                                                : `Agregar ${product.name}, ${formattedPrice} por ${unit}`}
                                            onClick={() => {
                                                if (blocked) onBlocked(product);
                                                else onAdd(product);
                                            }}
                                            className={`flex min-h-[132px] w-full flex-col items-stretch justify-between px-4 py-4 text-left transition-colors focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset sm:min-h-[160px] lg:min-h-[190px] ${blocked
                                                ? 'cursor-not-allowed bg-danger-soft hover:bg-danger-soft'
                                                : 'bg-surface-950 hover:bg-surface-900 active:bg-surface-800'}`}
                                        >
                                            <div className="min-w-0">
                                                <div className="mb-3 overflow-hidden rounded-control border border-white/[0.08] bg-white/[0.04]">
                                                    <ProductoMiniatura
                                                        name={product.name}
                                                        imageUrl={product.imageUrl}
                                                        className="aspect-[4/3] w-full"
                                                    />
                                                </div>
                                                <span className={`line-clamp-2 text-[15px] font-semibold leading-snug sm:text-base ${blocked ? 'text-slate-400' : 'text-slate-100'}`}>
                                                    {product.name}
                                                </span>
                                                <span className="mt-1 block">
                                                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                                        {product.sku ? `SKU ${product.sku}` : `Por ${unit}`}
                                                    </span>
                                                    {product.sku ? (
                                                        <span className="mt-0.5 block text-xs text-slate-500">
                                                            Por {unit}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </div>

                                            <span className="mt-5 flex min-w-0 items-end justify-between gap-2">
                                                <span className={`nx-num truncate text-base font-bold sm:text-lg ${blocked ? 'text-slate-500' : 'text-slate-100'}`}>
                                                    {formattedPrice}
                                                </span>
                                                {blocked ? (
                                                    <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-danger">
                                                        Agotado
                                                    </span>
                                                ) : lowStock ? (
                                                    <span className="shrink-0 text-[11px] font-bold text-warning">
                                                        Quedan {stockFormatter.format(product.stock)}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {products.length < totalProducts && (
                            <div className="border-t border-white/[0.06] bg-surface-950 p-3 text-center">
                                <p className="mb-2 text-xs text-slate-500">
                                    Quedan {totalProducts - products.length} por mostrar
                                </p>
                                <button
                                    type="button"
                                    onClick={onShowMore}
                                    className="min-h-tap w-full rounded-control border border-white/[0.10] px-4 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                                >
                                    Mostrar más productos
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex min-h-[176px] items-center justify-center bg-surface-950 px-6 py-10 text-center">
                        <p className="max-w-sm text-sm text-slate-400">
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
