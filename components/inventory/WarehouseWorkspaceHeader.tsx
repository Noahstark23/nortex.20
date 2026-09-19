import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search, SlidersHorizontal, X } from 'lucide-react';
import { CameraScanButton } from '../ui/CameraScanButton';
import { FluidSheet } from '../ui/FluidSheet';
import './WarehouseWorkspace.css';

/** Solo contexto de lectura; nunca acepta una URL de retorno proporcionada por el cliente. */
export const readStockWorkspaceContext = (query: string) => {
    const params = new URLSearchParams(query);
    const id = (name: string) => (params.get(name) || '').slice(0, 191);
    return { warehouseId: id('warehouseId'), productId: id('productId'), search: (params.get('search') || '').slice(0, 200) };
};
export const stockWorkspaceHref = (path: '/app/inventory' | '/app/inventory-count', context: { warehouseId?: string; productId?: string; search?: string }) => {
    const params = new URLSearchParams();
    for (const key of ['warehouseId', 'productId', 'search'] as const) if (context[key]) params.set(key, context[key]!);
    return `${path}${params.size ? `?${params}` : ''}`;
};

type Location = { id: string; name: string; isActive: boolean };
export function WarehouseWorkspaceHeader(props: {
    warehouses: Location[]; selectedId: string; locked: boolean; search: string; onSearch: (value: string) => void;
    onCameraCode?: (code: string) => void;
    onSelect: (value: string) => void; returnHref: string; countHref?: string; onManage?: () => void;
}) {
    return <header className="stock-workspace-header">
        <div className="stock-workspace-heading">
            <Link to={props.returnHref} className="stock-workspace-back nx-fluid-press"><ChevronLeft size={17} /> Productos</Link>
            <div className="stock-workspace-title"><h1>Existencias por bodega</h1>{props.onManage && <button className="stock-workspace-quiet nx-fluid-press" onClick={props.onManage}><SlidersHorizontal size={16} /><span>Administrar bodegas</span></button>}</div>
        </div>
        <div className="stock-workspace-tools">
            <label className="stock-workspace-location"><span>Ubicación</span><select aria-label="Ubicación de existencias" value={props.selectedId} disabled={props.locked} onChange={event => props.onSelect(event.target.value)}><option value="" disabled>Elegí una bodega</option>{props.warehouses.map(location => <option key={location.id} value={location.id}>{location.name}{location.isActive ? '' : ' · Inactiva'}</option>)}</select></label>
            <div className="stock-workspace-search"><Search size={20} aria-hidden="true" /><input aria-label="Buscar existencias por nombre o SKU" placeholder="Buscar o escanear producto" value={props.search} onChange={event => props.onSearch(event.target.value)} />{props.search && <button onClick={() => props.onSearch('')} aria-label="Limpiar búsqueda" className="nx-fluid-press"><X size={17}/></button>}</div>
            {props.onCameraCode && <CameraScanButton disabled={props.locked} onCode={props.onCameraCode}/>}
            {props.countHref && <Link className="stock-workspace-quiet nx-fluid-press" to={props.countHref}>Contar aquí</Link>}
        </div>
    </header>;
}
export function WarehouseWorkspaceManagement({ open, busy, onClose, children }: { open: boolean; busy: boolean; onClose: () => void; children: React.ReactNode }) {
    return <FluidSheet open={open} onClose={onClose} labelledBy="warehouse-management-title" closeOnBackdrop={!busy} closeOnEscape={!busy} dragToDismiss={!busy} panelClassName="warehouse-management-sheet">
        <header className="stock-workspace-title"><h2 id="warehouse-management-title">Administrar bodegas</h2><button onClick={onClose} disabled={busy} aria-label="Cerrar administración de bodegas" className="stock-workspace-quiet nx-fluid-press"><X size={20}/></button></header>
        <div className="warehouse-management-body">{children}</div>
    </FluidSheet>;
}
