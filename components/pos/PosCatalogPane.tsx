import React, { useEffect, useMemo, useState } from 'react';
import { Check, Keyboard, Package, PackagePlus, PlayCircle, Plus, Search, X, Zap } from 'lucide-react';
import type { Product } from '../../types';
import { formatMoney } from '../../utils/money';
import { buscarProductos, type EntradaIndice, type ResultadoBusqueda } from '../../utils/posSearch';
import { EmptyState } from '../ui/EmptyState';
import { ProductImage } from '../ui/ProductImage';
import { CajaNicaCatalog } from './CajaNicaCatalog';

export interface PosCatalogPaneProps {
    products: Product[];
    quantitiesByProduct?: ReadonlyMap<string, number>;
    indiceProductos: EntradaIndice<Product>[];
    resultadoBusqueda: ResultadoBusqueda<Product>;
    productsError: boolean;
    guidedSimpleMode: boolean;
    firstSaleMode: boolean;
    firstSaleStage: 1 | 2 | 3;
    quickProductsLabel: string;
    pageSize: number;
    permiteStockNegativo: boolean | null;
    searchTerm: string;
    searchRef: React.Ref<HTMLInputElement>;
    setSearchTerm: (value: string) => void;
    handleSearchKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
    agregarDesdeGrilla: (product: Product) => void;
    avisarProductoAgotado: (product: Product) => void;
    fetchProducts: () => void;
    openQuickCreate: () => void;
    adminTools?: React.ReactNode;
    onPractice: (source: 'first_sale' | 'empty_catalog') => void;
}

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
 * Tarjeta de producto de la grilla — MEMOIZADA (P0-2).
 *
 * Sin esto, cada tecla en la búsqueda vuelve a renderizar todas las tarjetas
 * visibles aunque ninguna cambió. Con la grilla ya acotada el costo baja solo,
 * pero el re-render sigue siendo gratis de evitar: las props son primitivas y
 * `onAgregar` es estable.
 */
const TarjetaProducto = React.memo<{
    product: Product;
    bloqueada: boolean;
    onAgregar: (p: Product) => void;
}>(({ product, bloqueada, onAgregar }) => (
    <button
        type="button"
        onClick={() => onAgregar(product)}
        aria-disabled={bloqueada || undefined}
        title={bloqueada ? 'Sin existencia. Tocá para cargar stock.' : undefined}
        className={`nx-fluid-press h-32 bg-surface-900 border rounded-card px-3 py-2 transition-colors text-left flex flex-col justify-between text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/40 ${bloqueada
            ? 'border-danger/25 opacity-70 hover:border-danger/50 hover:bg-danger-soft cursor-pointer'
            : 'border-white/[0.06] hover:bg-surface-800 hover:border-brand/50'}`}
    >
        <div className="min-w-0 flex items-center gap-2">
            <ProductImage
                src={product.imageUrl}
                alt={product.name}
                loading="lazy"
                sizes="56px"
                className={`h-14 w-14 shrink-0 rounded-control border border-white/[0.12] bg-gradient-to-br ${productoPaleta(product.name)}`}
                fallbackClassName="text-white"
            />
            <div className="min-w-0">
                <h3 className="font-semibold text-sm text-slate-100 leading-tight line-clamp-2 min-w-0">{product.name}</h3>
                {product.sku ? (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 truncate">
                        SKU: {product.sku}
                    </p>
                ) : null}
            </div>
        </div>
        <div className="flex justify-between items-end gap-1">
            <span className="text-[15px] sm:text-[17px] font-bold text-brand nx-num whitespace-nowrap">{formatMoney(product.price)}</span>
            {/* El stock negativo se muestra tal cual (−3), no disfrazado de
                AGOTADO: es la señal de que el inventario ya se descuadró.
                A 12px y no 11px — a 11px fallaba el contraste AA (P2-1). */}
            <span className={`text-xs px-1.5 py-0.5 rounded-control shrink-0 ${product.stock <= 0 ? 'bg-danger-soft text-danger font-bold' : product.stock <= 5 ? 'bg-warning-soft text-amber-400' : 'text-slate-400'}`}>
                {product.stock === 0 ? 'AGOTADO' : product.stock}
            </span>
        </div>
    </button>
));
TarjetaProducto.displayName = 'TarjetaProducto';

/** Presentación del catálogo; las mutaciones y el escáner pertenecen al POS. */
export function PosCatalogPane({
    products, quantitiesByProduct, indiceProductos, resultadoBusqueda, productsError, guidedSimpleMode,
    firstSaleMode, firstSaleStage, quickProductsLabel, pageSize,
    permiteStockNegativo, searchTerm, searchRef, setSearchTerm, handleSearchKeyDown,
    agregarDesdeGrilla, avisarProductoAgotado, fetchProducts, openQuickCreate,
    adminTools, onPractice,
}: PosCatalogPaneProps) {
    const [cajaCategory, setCajaCategory] = useState('Todos');
    const [cajaVisibleLimit, setCajaVisibleLimit] = useState(pageSize);
    const TOPE_SIN_BUSQUEDA = pageSize;
    const filteredProducts = resultadoBusqueda.visibles;

    // La caja simple no inventa un ranking de "más vendidos" mientras no haya
    // datos reales. Presenta un estante corto de productos del negocio y permite
    // cambiar de categoría sin convertir la pantalla en el módulo Inventario.
    const cajaCategories = useMemo(() => {
        const categories = Array.from(new Set(
            products
                .map(product => product.category?.trim())
                .filter((category): category is string => Boolean(category)),
        ));
        return ['Todos', ...categories];
    }, [products]);

    useEffect(() => {
        setCajaVisibleLimit(TOPE_SIN_BUSQUEDA);
    }, [cajaCategory, searchTerm]);

    const cajaCatalogResult = useMemo(() => {
        const term = searchTerm.trim();
        if (term !== '') return buscarProductos(indiceProductos, term, cajaVisibleLimit);

        const activeCategory = cajaCategories.includes(cajaCategory) ? cajaCategory : 'Todos';
        const byCategory = activeCategory === 'Todos'
            ? products
            : products.filter(product => product.category?.trim() === activeCategory);
        const visibles = byCategory.slice(0, cajaVisibleLimit);
        return {
            visibles,
            total: byCategory.length,
            ocultos: byCategory.length - visibles.length,
            coincidenciaExacta: false,
        };
    }, [cajaCategories, cajaCategory, cajaVisibleLimit, indiceProductos, products, searchTerm]);

    const cajaProducts = cajaCatalogResult.visibles;

    const cajaBlockedProductIds = useMemo(() => new Set(
        permiteStockNegativo === true
            ? []
            : cajaProducts.filter(product => product.stock <= 0).map(product => product.id),
    ), [cajaProducts, permiteStockNegativo]);

    return (
            <div className={`w-full flex-1 flex flex-col overflow-hidden ${guidedSimpleMode
                ? 'nx-pos-catalog nx-canvas-text mt-16 p-4 lg:px-6 lg:py-5 mb-0'
                : 'mt-14 p-4 lg:p-6 mb-16 lg:mb-0'}`}>
                {productsError && products.length > 0 && (
                    <div role="alert" className="mb-3 flex items-center gap-3 rounded-control border border-warning/25 bg-warning-soft px-3 py-2 text-sm nx-canvas-text">
                        <span className="flex-1">No pudimos actualizar las existencias. Los datos mostrados pueden estar desactualizados.</span>
                        <button type="button" onClick={() => fetchProducts()} className="nx-fluid-press min-h-11 shrink-0 rounded-control px-2 font-semibold underline">Reintentar</button>
                    </div>
                )}
                {firstSaleMode && (
                    <div className="mb-4 rounded-card border border-brand/25 bg-brand-soft px-4 py-3.5 sm:px-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="nx-canvas-text text-sm font-bold">Primera venta real</p>
                                <p className="nx-canvas-muted text-xs mt-0.5">Al terminar se actualizan caja e inventario.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onPractice('first_sale')}
                                className="nx-fluid-press nx-canvas-text hidden sm:inline-flex min-h-tap px-3 rounded-control text-xs font-semibold items-center gap-2 shrink-0 hover:bg-white/[0.06]"
                            >
                                <PlayCircle size={16} /> Practicar
                            </button>
                        </div>
                        <ol className="mt-4 grid grid-cols-3" aria-label="Progreso de tu primera venta">
                            {[
                                { step: 1, label: 'Producto' },
                                { step: 2, label: 'Cobro' },
                                { step: 3, label: 'Venta lista' },
                            ].map((item, index, steps) => {
                                const done = firstSaleStage > item.step || (firstSaleStage === 3 && item.step === 3);
                                const current = firstSaleStage === item.step && !done;
                                return (
                                    <li key={item.step} aria-current={firstSaleStage === item.step ? 'step' : undefined} className="relative flex flex-col items-center text-center">
                                        {index < steps.length - 1 && (
                                            <span className={`absolute left-1/2 top-3 h-px w-full ${firstSaleStage > item.step ? 'bg-brand' : 'bg-white/[0.10]'}`} aria-hidden="true" />
                                        )}
                                        <span className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${done
                                            ? 'border-brand bg-brand text-brand-on'
                                            : current
                                                ? `border-brand ${guidedSimpleMode ? 'bg-white' : 'bg-surface-900'} text-brand ring-4 ring-brand/10`
                                                : `${guidedSimpleMode ? 'border-slate-300 bg-white text-slate-700' : 'border-white/[0.12] bg-surface-900 text-slate-400'}`}`}
                                        >
                                            {done ? <Check size={13} strokeWidth={3} /> : item.step}
                                        </span>
                                        <span className={`mt-2 text-[11px] font-semibold ${done || current ? 'nx-canvas-text' : 'nx-canvas-muted'}`}>{item.label}</span>
                                    </li>
                                );
                            })}
                        </ol>
                        <button
                            type="button"
                            onClick={() => onPractice('first_sale')}
                            className="nx-fluid-press nx-canvas-text sm:hidden mt-3 min-h-tap w-full rounded-control text-xs font-semibold inline-flex items-center justify-center gap-2 hover:bg-white/[0.06]"
                        >
                            <PlayCircle size={16} /> Practicar sin guardar
                        </button>
                    </div>
                )}
                <div className={guidedSimpleMode ? "nx-pos-search flex gap-2" : "mb-4 flex gap-2"}>
                    <div className="flex-1">
                        <>{guidedSimpleMode && <label className="nx-pos-search-label" htmlFor="pos-catalog-search">Buscá por nombre o escaneá un código</label>}<div className="nx-pos-search-field relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                            {/* 56px + foco automático al montar: es el primer control de la
                                pantalla donde el cajero pasa el 80% del turno. Antes había
                                que hacer clic (o saber F2) antes de poder escanear. */}
                            <input
                                id="pos-catalog-search"
                                ref={searchRef}
                                aria-label="Buscar productos para vender"
                                type="text"
                                autoFocus
                                placeholder={guidedSimpleMode ? 'Escaneá o buscá un producto' : 'Buscar o escanear'}
                                className={`w-full h-pay pl-11 pr-4 rounded-control border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 font-medium transition-colors ${guidedSimpleMode
                                    ? 'bg-white border-slate-200 text-slate-950 placeholder:text-slate-500 shadow-sm !pr-14'
                                    : 'bg-surface-900 border-white/[0.06] text-slate-100'}`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                            />
                            {guidedSimpleMode && searchTerm && <button type="button" aria-label="Borrar texto de búsqueda" className="nx-pos-clear-search" onClick={() => { setSearchTerm(''); if (searchRef && 'current' in searchRef) searchRef.current?.focus(); }}><X size={18} /></button>}
                        </div></>
                    </div>
                    {guidedSimpleMode && <button type="button" onClick={openQuickCreate} className="nx-pos-create nx-fluid-press"><Plus size={17} /> Nuevo producto</button>}
                    {/* Quick Create */}
                    {!guidedSimpleMode && <button type="button"
                        onClick={openQuickCreate}
                        className="nx-fluid-press min-h-tap bg-amber-400 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-amber-600 hover:to-orange-600 shadow-md transition-colors"
                        title="Producto Rápido"
                    >
                        <Zap size={18} />
                        <span>Rápido</span>
                    </button>}
                    {adminTools}
                </div>

                {/* ACCESO RÁPIDO A PRODUCTOS
                    Esta lista es `filteredProducts.slice(0, 5)`: el catálogo en su
                    orden natural, NO un ranking de ventas — no existe endpoint de
                    más-vendidos y no se inventa uno. Por eso el rótulo se calcula
                    con `rotuloProductosRapidos`, que solo dice "Más vendidos"
                    cuando hay un ranking real con suficientes ventas detrás. */}
                {!guidedSimpleMode && searchTerm === '' && (
                    <div className="mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Zap size={14} className="text-amber-500" /> {firstSaleMode ? 'Empezá por uno de estos' : quickProductsLabel}
                        </h3>
                        <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
                            {filteredProducts.slice(0, 5).map(product => (
                                <button
                                    key={`top-${product.id}`}
                                    type="button"
                                    onClick={() => agregarDesdeGrilla(product)}
                                    className="nx-fluid-press bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-nortex-500 p-3 rounded-xl text-center transition-colors flex flex-col items-center justify-center gap-1 h-24 shadow-[0_0_15px_rgba(0,0,0,0.1)] group"
                                >
                                    <Package size={24} className="text-blue-400 group-hover:text-blue-300 transition-colors mb-1" />
                                    <span className="text-[10px] font-bold text-slate-300 leading-tight line-clamp-2">{product.name}</span>
                                    <span className="text-xs font-black text-emerald-400 mt-auto">{formatMoney(product.price)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {guidedSimpleMode ? (
                    cajaProducts.length === 0 ? (
                        <div className="flex-1 min-h-0 flex items-center justify-center pb-4">
                            {searchTerm ? (
                                <EmptyState
                                    mode="no-results"
                                    title="No encontramos ese producto"
                                    description={`Probá con otro nombre, código o SKU para “${searchTerm}”.`}
                                    action={{ label: 'Limpiar búsqueda', onClick: () => setSearchTerm('') }}
                                />
                            ) : productsError ? (
                                <EmptyState
                                    mode="error"
                                    title="No pudimos cargar tus productos"
                                    description="Puede ser tu conexión. Tus productos siguen ahí — reintentá."
                                    action={{ label: 'Reintentar', onClick: () => fetchProducts() }}
                                />
                            ) : (
                                <EmptyState
                                    icon={<Package size={32} />}
                                    title="Agregá el primer producto"
                                    description="Ingresá nombre, precio y existencia real. Después podés completar el resto."
                                    action={{ label: 'Agregar producto', icon: <PackagePlus size={18} />, onClick: openQuickCreate }}
                                    linkAction={{ label: 'Prefiero practicar sin guardar datos', onClick: () => onPractice('empty_catalog') }}
                                />
                            )}
                        </div>
                    ) : (
                        /* pb-24 debajo de `lg`: la barra de la venta es fija y ahora
                           está siempre, así que sin colchón taparía la última fila
                           de productos y la línea que declara el recorte. */
                        <div className="nx-catalog-plane flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-4 custom-scrollbar">
                            <CajaNicaCatalog
                                products={cajaProducts}
                                quantitiesByProduct={quantitiesByProduct}
                                totalProducts={cajaCatalogResult.total}
                                categories={searchTerm.trim() ? [] : cajaCategories}
                                selectedCategory={cajaCategories.includes(cajaCategory) ? cajaCategory : 'Todos'}
                                searchTerm={searchTerm}
                                blockedProductIds={cajaBlockedProductIds}
                                onCategoryChange={setCajaCategory}
                                onAdd={agregarDesdeGrilla}
                                onBlocked={avisarProductoAgotado}
                                onShowMore={() => setCajaVisibleLimit(limit => limit + TOPE_SIN_BUSQUEDA)}
                            />
                        </div>
                    )
                ) : filteredProducts.length === 0 ? (
                    <div className="flex-1 min-h-0 flex items-center justify-center pb-4">
                        {searchTerm ? (
                            <EmptyState
                                mode="no-results"
                                title="Sin resultados"
                                description={`Ningún producto coincide con "${searchTerm}".`}
                                action={{ label: 'Limpiar búsqueda', onClick: () => setSearchTerm('') }}
                            />
                        ) : productsError ? (
                            <EmptyState
                                mode="error"
                                title="No pudimos cargar tus productos"
                                description="Puede ser tu conexión. Tus productos siguen ahí — reintentá."
                                action={{ label: 'Reintentar', onClick: () => fetchProducts() }}
                            />
                        ) : (
                            <EmptyState
                                icon={<Package size={32} />}
                                title="Agregá el primer producto"
                                description="Ingresá nombre, precio y existencia real. Después podés completar el resto."
                                action={{ label: 'Agregar producto', icon: <PackagePlus size={18} />, onClick: openQuickCreate }}
                                linkAction={{ label: 'Prefiero practicar sin guardar datos', onClick: () => onPractice('empty_catalog') }}
                            />
                        )}
                    </div>
                ) : (
                /* Grilla compacta: la tarjeta era `aspect-square` (≈230px en desktop)
                   y esperaba una imagen que este componente nunca renderiza — 60%
                   de vacío y solo ~6 productos visibles. A 96px de alto y hasta 5
                   columnas entran ~20 sin scrollear, que es lo que hace rápido al
                   mostrador. */
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 overflow-y-auto pb-24 lg:pb-4 custom-scrollbar flex-1 min-h-0 content-start">
                    {filteredProducts.map(product => (
                        <TarjetaProducto
                            key={product.id}
                            product={product}
                            bloqueada={permiteStockNegativo !== true && product.stock <= 0}
                            onAgregar={agregarDesdeGrilla}
                        />
                    ))}
                    {/* El recorte se DECLARA. Una lista cortada en silencio se lee
                        como "esto es todo lo que tengo", y en un inventario eso
                        hace que el dueño vuelva a comprar algo que ya tiene. */}
                    {resultadoBusqueda.ocultos > 0 && (
                        <p className="col-span-full text-center text-xs text-slate-400 py-3">
                            {searchTerm.trim() === ''
                                ? `Mostrando ${resultadoBusqueda.visibles.length} de ${resultadoBusqueda.total} productos — escaneá o escribí para buscar el resto.`
                                : `Mostrando ${resultadoBusqueda.visibles.length} de ${resultadoBusqueda.total} coincidencias — afiná la búsqueda.`}
                        </p>
                    )}
                </div>
                )}

                {/* ⌨️ HOTKEY CHEAT SHEET */}
                {!guidedSimpleMode && !firstSaleMode && (
                    <div className="hidden md:flex items-center gap-3 mt-2 px-2 py-1.5 text-[11px] text-slate-500 select-none flex-shrink-0">
                        <Keyboard size={13} className="text-slate-500" />
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F2</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Ctrl+K</span> Buscar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F4</span> Aparcar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F7</span> Salida
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F8</span> Entrada
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F9</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Ctrl+Enter</span> Cobrar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Esc</span> Cerrar
                    </div>
                )}
            </div>

    );
}
