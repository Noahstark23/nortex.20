import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowUpDown, Check, ChevronRight, MoreHorizontal, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { CameraScanButton } from '../ui/CameraScanButton';
import { formatMoney } from '../../utils/money';
import { normalizeProductImageSource } from '../ui/ProductImage';
import './inventoryCatalog.css';

export interface InventoryCatalogProduct {
    id: string;
    brand?: string | null;
    name: string;
    sku: string;
    stock: number;
    minStock: number;
    unit: string;
    price?: number;
    imageUrl?: string | null;
    category?: string;
}

export interface InventoryCatalogFilters {
    search: string;
    category: string;
    family: string;
    mode: string;
    status: string;
    sortField: string;
    sortDir: 'asc' | 'desc';
}

export interface InventoryCatalogActions {
    create?: () => void;
    import?: () => void;
    fullCreate?: () => void;
    export?: () => void;
    showSummary?: () => void;
    warehouses?: () => void;
    count?: () => void;
    receiving?: () => void;
    serials?: () => void;
    bulk?: () => void;
}

export interface InventoryCatalogProps {
    title?: string;
    onCreateScannedProduct?: (code: string) => void;
    onCameraCode?: (code: string) => Promise<void>;
    products: InventoryCatalogProduct[];
    total: number;
    loading: boolean;
    error?: boolean;
    filters: InventoryCatalogFilters;
    onFiltersChange: (patch: Partial<InventoryCatalogFilters>) => void;
    categories: string[];
    selectedProductId: string | null;
    onSelectProduct: (product: InventoryCatalogProduct) => void;
    canViewPrice: boolean;
    actions: InventoryCatalogActions;
    exporting?: boolean;
    selection?: { enabled: boolean; ids: string[]; onToggle: (id: string) => void; onToggleAll: () => void };
    bulkActions?: ReactNode;
    emptyState: ReactNode;
    pagination: ReactNode;
}

const quantity = new Intl.NumberFormat('es-NI', { maximumFractionDigits: 4 });
const stockFilters = [{ value: '', label: 'Todos' }, { value: 'reorder', label: 'Por reponer' }, { value: 'out', label: 'Agotados' }];

function ProductPhoto({ product }: { product: InventoryCatalogProduct }) {
    const source = normalizeProductImageSource(product.imageUrl);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    if (!source || failedSource === source) return null;
    return <img src={source} alt="" loading="lazy" decoding="async" className="nx-inventory-catalog-photo" onError={() => setFailedSource(source)} />;
}

/** Catálogo controlado: seleccionar nunca altera stock ni abre una mutación. */
export function InventoryCatalog({ onCreateScannedProduct, onCameraCode, title, products, total, loading, error = false, filters, onFiltersChange, categories, selectedProductId, onSelectProduct, canViewPrice, actions, exporting = false, selection, bulkActions, emptyState, pagination }: InventoryCatalogProps) {
    const id = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const toolsRef = useRef<HTMLDivElement>(null);
    const toolsButtonRef = useRef<HTMLButtonElement>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const activeFilters = [filters.category, filters.family, filters.mode, filters.status, filters.sortField !== 'name' || filters.sortDir !== 'asc' ? 'sort' : ''].filter(Boolean).length;
    const tools: { label: string; action: (() => void) | undefined; disabled?: boolean }[] = [
        { label: 'Importar desde Excel', action: actions.import },
        { label: exporting ? 'Exportando…' : 'Exportar productos', action: actions.export, disabled: exporting },
        { label: 'Crear con todos los datos', action: actions.fullCreate },
        { label: 'Ver resumen del inventario', action: actions.showSummary },
        { label: selection?.enabled ? 'Terminar selección' : 'Seleccionar varios productos', action: actions.bulk },
        { label: 'Ver bodegas', action: actions.warehouses },
        { label: 'Recibir mercadería', action: actions.receiving },
        { label: 'Contar existencias', action: actions.count },
        { label: 'Consultar series', action: actions.serials },
    ].filter(tool => tool.action);

    useEffect(() => {
        if (!toolsOpen) return;
        toolsRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
        const closeOutside = (event: PointerEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false); };
        const closeEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setToolsOpen(false);
            toolsButtonRef.current?.focus();
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeEscape);
        return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
    }, [toolsOpen]);

    const clearFilters = () => onFiltersChange({ category: '', family: '', mode: '', status: '', sortField: 'name', sortDir: 'asc' });

    return <section className="nx-inventory-catalog" aria-labelledby={title ? `${id}-title` : undefined} aria-label={title ? undefined : 'Catálogo de productos'}>
        <header className="nx-inventory-catalog-heading">
            {title ? <h1 id={`${id}-title`}>{title}</h1> : <span />}
            {tools.length > 0 && <div ref={toolsRef} className="nx-inventory-catalog-tools">
                <button ref={toolsButtonRef} type="button" className="nx-inventory-catalog-tool nx-fluid-press" aria-label="Más herramientas de productos" aria-haspopup="menu" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setToolsOpen(true); } }}><MoreHorizontal size={20} /><span>Más</span></button>
                {toolsOpen && <div className="nx-inventory-catalog-menu" role="menu" aria-label="Herramientas de productos" onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')) as HTMLButtonElement[];
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
                    if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
                }}>
                    {tools.map(tool => <button className="nx-fluid-press" key={tool.label} role="menuitem" type="button" disabled={tool.disabled} onClick={() => { setToolsOpen(false); toolsButtonRef.current?.focus(); tool.action?.(); }}>{tool.label}</button>)}
                </div>}
            </div>}
        </header>

        <div className="nx-inventory-catalog-search-row">
            <div className="nx-inventory-catalog-search">
                <label htmlFor={`${id}-search`}>Buscá por nombre o escaneá un código</label>
                <div className="nx-inventory-catalog-search-field">
                    <Search size={20} aria-hidden="true" />
                    <input id={`${id}-search`} ref={searchRef} type="search" autoComplete="off" aria-label="Buscar productos" placeholder="Escaneá o buscá un producto" value={filters.search} onChange={event => onFiltersChange({ search: event.target.value })} />
                    {filters.search && <button className="nx-fluid-press" type="button" aria-label="Borrar texto de búsqueda" onClick={() => { onFiltersChange({ search: '' }); searchRef.current?.focus(); }}><X size={18} /></button>}
                </div>
            </div>
            {onCameraCode && <CameraScanButton onCode={onCameraCode} onCreateProduct={onCreateScannedProduct}/>}
            {actions.create && <button type="button" className="nx-inventory-catalog-create nx-fluid-press" onClick={actions.create}><Plus size={18} /> Nuevo producto</button>}
        </div>

        <div className="nx-inventory-catalog-controls">
            <div role="group" aria-label="Existencias a mostrar" className="nx-inventory-catalog-status">
                {stockFilters.map(filter => <button type="button" key={filter.value} aria-pressed={filters.status === filter.value} onClick={() => onFiltersChange({ status: filter.value })} className="nx-fluid-press">{filter.label}</button>)}
            </div>
            <button type="button" className="nx-inventory-catalog-filter-toggle nx-fluid-press" aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={16} /> Filtrar{activeFilters > 0 && <span className="nx-inventory-catalog-filter-count">{activeFilters}</span>}</button>
        </div>

        {filtersOpen && <div id={`${id}-filters`} className="nx-inventory-catalog-filters">
            <label>Categoría<select aria-label="Filtrar por categoría" value={filters.category} onChange={event => onFiltersChange({ category: event.target.value })}><option value="">Todas las categorías</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
            <label>Familia operativa<select aria-label="Filtrar por familia operativa" value={filters.family} onChange={event => onFiltersChange({ family: event.target.value })}><option value="">Todas las familias</option><option value="GENERAL">General</option><option value="MEAT">Carnes</option><option value="POULTRY">Aves</option><option value="ANIMAL_FEED">Alimento animal</option><option value="AGRO_INPUT">Agroinsumos</option><option value="VETERINARY">Veterinaria</option></select></label>
            <label>Forma de venta<select aria-label="Filtrar por forma de venta" value={filters.mode} onChange={event => onFiltersChange({ mode: event.target.value })}><option value="">Todas las formas</option><option value="COUNTED">Contados</option><option value="MEASURED">Medidos</option><option value="LEGACY">Configuración anterior</option></select></label>
            <label>Existencias<select aria-label="Filtrar por estado de existencias" value={filters.status} onChange={event => onFiltersChange({ status: event.target.value })}><option value="">Todos</option><option value="low">Bajo mínimo</option><option value="reorder">Por reponer</option><option value="out">Agotados</option>{canViewPrice && <><option value="published">Publicados</option><option value="unpublished">Ocultos</option></>}</select></label>
            <label><span><ArrowUpDown size={14} aria-hidden="true" /> Orden</span><select aria-label="Ordenar productos" value={`${filters.sortField}:${filters.sortDir}`} onChange={event => { const [sortField, sortDir] = event.target.value.split(':'); onFiltersChange({ sortField, sortDir: sortDir as 'asc' | 'desc' }); }}><option value="name:asc">Nombre A–Z</option><option value="name:desc">Nombre Z–A</option><option value="stock:asc">Menor existencia primero</option><option value="stock:desc">Mayor existencia primero</option>{canViewPrice && <><option value="price:asc">Menor precio primero</option><option value="price:desc">Mayor precio primero</option></>}</select></label>
            {activeFilters > 0 && <button type="button" className="nx-inventory-catalog-reset nx-fluid-press" onClick={clearFilters}>Quitar filtros</button>}
        </div>}

        <div className="nx-inventory-catalog-result" role="status" aria-live="polite">
            {error ? 'Catálogo no disponible' : loading ? 'Actualizando productos…' : `${total} ${total === 1 ? 'producto' : 'productos'}${filters.search ? ` para “${filters.search}”` : ''}`}
            {!loading && products.length > 0 && products.length < total && <span>Mostrando {products.length} de {total}</span>}
        </div>
        {selection?.enabled && products.length > 0 && <div className="nx-inventory-catalog-selection">
            <label><input type="checkbox" aria-label="Seleccionar todos los productos de esta página" checked={products.every(product => selection.ids.includes(product.id))} onChange={selection.onToggleAll} /><span>Seleccionar esta página</span></label>
            <span>{selection.ids.length} seleccionados</span>
            {bulkActions}
        </div>}

        {products.length > 0 ? <ul className="nx-inventory-catalog-products" aria-label="Catálogo de productos" aria-busy={loading}>
            {products.map(product => {
                const unit = product.unit?.trim() || 'unidad';
                const unitLabel = unit === 'unidad' && product.stock !== 1 ? 'unidades' : unit;
                const stockText = Number.isFinite(product.stock) ? `${quantity.format(product.stock)} ${unitLabel}` : 'Existencia no disponible';
                const needsAttention = product.stock <= 0 || product.stock <= product.minStock;
                const selected = selectedProductId === product.id;
                return <li key={product.id} className="nx-inventory-catalog-item">
                    {selection?.enabled && <label className="nx-inventory-catalog-select-product"><input type="checkbox" aria-label={`Seleccionar ${product.name}`} checked={selection.ids.includes(product.id)} onChange={() => selection.onToggle(product.id)} /></label>}
                    <button type="button" aria-label={`Ver ${product.name}`} aria-pressed={selected} className="nx-inventory-catalog-product nx-fluid-press" onClick={() => onSelectProduct(product)}>
                        <span className="nx-inventory-catalog-identity"><ProductPhoto product={product} /><span><strong>{product.name}</strong>{(product.brand || product.sku) && <small>{[product.brand, product.sku].filter(Boolean).join(' · ')}</small>}</span></span>
                        <span className="nx-inventory-catalog-stock" data-attention={needsAttention || undefined}>{stockText}{product.stock === 0 ? ' · Agotado' : product.stock < 0 ? ' · Revisar existencia' : product.stock <= product.minStock ? ' · Bajo mínimo' : ''}</span>
                        <span className="nx-inventory-catalog-product-end">{canViewPrice && <span className="nx-inventory-catalog-price">{typeof product.price === 'number' && Number.isFinite(product.price) ? <>{formatMoney(product.price)}<small>Por {unit}</small></> : <small>Precio no disponible</small>}</span>}<span className="nx-inventory-catalog-open" aria-hidden="true">{selected ? <Check size={18} /> : <ChevronRight size={18} />}</span></span>
                    </button>
                </li>;
            })}
        </ul> : loading ? <div className="nx-inventory-catalog-loading" aria-hidden="true">{[0, 1, 2, 3].map(index => <span key={index} />)}</div> : emptyState}
        {pagination}
    </section>;
}

export default InventoryCatalog;
