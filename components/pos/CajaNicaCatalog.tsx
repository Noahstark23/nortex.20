import { memo, useId, type KeyboardEvent } from 'react';
import type { Product } from '../../types';
import { formatMoney } from '../../utils/money';

export interface CajaNicaCatalogProps {
    /** Lo que se muestra: ya viene recortado por el POS. */
    products: Product[];
    /** Cuántos hay EN TOTAL detrás del recorte (para poder declararlo). */
    total: number;
    categories: string[];
    selectedCategory: string;
    searchTerm: string;
    blockedProductIds: Set<string>;
    onCategoryChange: (category: string) => void;
    onAdd: (product: Product) => void;
}

const stockFormatter = new Intl.NumberFormat('es-NI', {
    maximumFractionDigits: 3,
});

/** Conteos de catálogo: "1,003" y no "1003", que a cuatro cifras ya se lee mal. */
const conteoFormatter = new Intl.NumberFormat('es-NI');

/**
 * Catálogo táctil de Caja Nica.
 *
 * Los productos forman un solo rack, sin fotografías ni tarjetas flotantes:
 * nombre, unidad y precio quedan siempre en el mismo lugar para que el cajero
 * pueda reconocerlos por posición mientras atiende.
 */
export const CajaNicaCatalog = memo<CajaNicaCatalogProps>(({
    products,
    total,
    categories,
    selectedCategory,
    searchTerm,
    blockedProductIds,
    onCategoryChange,
    onAdd,
}) => {
    const catalogId = useId();
    const panelId = `${catalogId}-products`;
    const activeCategoryIndex = categories.indexOf(selectedCategory);
    const isSearching = searchTerm.trim().length > 0;
    const ocultos = Math.max(0, total - products.length);

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
                    {conteoFormatter.format(total)} {total === 1 ? 'producto' : 'productos'}
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
                    <ul className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-4">
                        {products.map((product) => {
                            const unit = product.unit?.trim() || 'unidad';
                            const blocked = blockedProductIds.has(product.id);
                            const lowStock = !blocked && product.stock > 0 && product.stock <= 5;
                            const formattedPrice = formatMoney(product.price);

                            return (
                                <li key={product.id} className="min-w-0 bg-surface-950">
                                    {/* Alto FIJO de 96px (h-24), antes min-h-[190px].
                                        La tarjeta llevaba el nombre arriba y el precio abajo con
                                        ~90px de nada en medio: el hueco de una imagen que este
                                        componente no renderiza a propósito. Con eso entraban 12
                                        productos en pantalla. El otro catálogo del POS
                                        (`TarjetaProducto`) ya se había corregido así; esto porta
                                        la corrección al modo guiado, que es justo el que ve un
                                        negocio recién dado de alta.

                                        Fija y no `min-h`: mantiene el ritmo del rack, que es la
                                        razón de ser de esta grilla — el cajero reconoce los
                                        productos por posición, y una fila que cambia de alto
                                        según el largo del nombre rompe esa memoria. */}
                                    <button
                                        type="button"
                                        aria-disabled={blocked || undefined}
                                        aria-label={blocked
                                            ? `${product.name}, agotado`
                                            : `Agregar ${product.name}, ${formattedPrice} por ${unit}`}
                                        onClick={() => {
                                            if (!blocked) onAdd(product);
                                        }}
                                        className={`flex h-24 w-full flex-col items-stretch justify-between px-3 py-2.5 text-left transition-colors focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset ${blocked
                                            ? 'cursor-not-allowed bg-danger-soft hover:bg-danger-soft'
                                            : 'bg-surface-950 hover:bg-surface-900 active:bg-surface-800'}`}
                                    >
                                        <span className="min-w-0">
                                            <span className={`line-clamp-2 text-sm font-semibold leading-tight ${blocked ? 'text-slate-400' : 'text-slate-100'}`}>
                                                {product.name}
                                            </span>
                                        </span>

                                        <span className="flex min-w-0 items-end justify-between gap-2">
                                            <span className={`nx-num truncate text-[15px] font-bold sm:text-[17px] ${blocked ? 'text-slate-500' : 'text-brand'}`}>
                                                {formattedPrice}
                                            </span>
                                            {/* La existencia ocupa SIEMPRE este lugar, esté sana o
                                                no. Antes solo aparecía en agotado o stock bajo, así
                                                que el dato que decide si podés vender estaba
                                                justamente ausente cuando todo iba bien. */}
                                            {blocked ? (
                                                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-danger">
                                                    Agotado
                                                </span>
                                            ) : lowStock ? (
                                                <span className="shrink-0 text-[11px] font-bold text-warning">
                                                    Quedan {stockFormatter.format(product.stock)}
                                                </span>
                                            ) : (
                                                <span className="shrink-0 text-xs text-slate-400">
                                                    {stockFormatter.format(product.stock)}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                        {/* El recorte se DECLARA. Una lista cortada en silencio se lee
                            como "esto es todo lo que tengo", y en un negocio eso hace
                            que el dueño vuelva a comprar algo que ya tiene. Es la misma
                            regla —y la misma frase— que el otro catálogo del POS; acá
                            faltaba, y la pantalla afirmaba tener 12 productos. */}
                        {ocultos > 0 && (
                            <li className="col-span-full bg-surface-950">
                                <p className="px-4 py-3 text-center text-xs text-slate-400" aria-live="polite">
                                    {isSearching
                                        ? `Mostrando ${products.length} de ${conteoFormatter.format(total)} coincidencias — afiná la búsqueda.`
                                        : `Mostrando ${products.length} de ${conteoFormatter.format(total)} productos — escaneá o escribí para buscar el resto.`}
                                </p>
                            </li>
                        )}
                    </ul>
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
