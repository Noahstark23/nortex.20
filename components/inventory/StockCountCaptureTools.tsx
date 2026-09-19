import React from 'react';
import { Search, X } from 'lucide-react';
export type CountView = 'ALL' | 'PENDING' | 'SAVED' | 'DIFFERENCES';
export function StockCountCaptureTools({ search, onSearch, view, onView, totals, compare, onCompare, camera }: {
    search: string; onSearch: (value: string) => void; view: CountView; onView: (value: CountView) => void;
    totals: Record<CountView, number>; compare: boolean; onCompare: (value: boolean) => void; camera: React.ReactNode;
}) {
    const tabs: { value: CountView; label: string }[] = [
        { value: 'ALL', label: 'Todos' }, { value: 'PENDING', label: 'Por contar' },
        { value: 'SAVED', label: 'Guardados' }, { value: 'DIFFERENCES', label: 'Con diferencias' },
    ];
    return <section className="nx-count-tools" aria-label="Buscar y revisar conteo">
        <div className="nx-count-search-row">
            <div className="nx-count-search-group">
                <label htmlFor="count-product-search">¿Qué producto estás contando?</label>
                <div className="nx-count-search-field"><Search size={20} aria-hidden="true"/>
                    <input id="count-product-search" aria-label="Buscar producto o SKU" placeholder="Nombre, código o marca" value={search} onChange={e => onSearch(e.target.value)}/>
                    {search && <button type="button" aria-label="Limpiar búsqueda" onClick={() => onSearch('')}><X size={18}/></button>}
                </div>
            </div>
            {camera}
        </div>
        <div className="nx-count-tools-bottom">
            <div className="nx-count-filters" aria-label="Filtrar productos">
                {tabs.map(tab => <button key={tab.value} type="button" aria-pressed={view === tab.value} onClick={() => onView(tab.value)}>{tab.label} <span>{totals[tab.value]}</span></button>)}
            </div>
            <label className="nx-count-compare"><input type="checkbox" checked={compare} onChange={e => onCompare(e.target.checked)}/> Comparar con el sistema</label>
        </div>
        {search && <p className="nx-count-help">La búsqueda incluye todos los productos del conteo.</p>}
    </section>;
}
