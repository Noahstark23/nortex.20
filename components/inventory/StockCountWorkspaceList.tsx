import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import './WarehouseWorkspace.css';
import './StockCountWorkspace.css';
type Count = { id: string; warehouseId: string | null; warehouse?: { name: string } | null; status: string; scope: string; category: string | null; createdAt: string; creator?: { name: string }; _count?: { items: number } };
const date = (value: string) => new Date(value).toLocaleDateString('es-NI', { day: 'numeric', month: 'short' });
export function StockCountWorkspaceList({ counts, loading, error, selectedWarehouseId, onOpen, onCreate, returnHref }: {
    counts: Count[]; loading: boolean; error: boolean; selectedWarehouseId: string; onOpen: (id: string) => void; onCreate: () => void; returnHref: string;
}) {
    const [showHistory, setShowHistory] = useState(false);
    const active = counts.filter(count => ['OPEN', 'CLOSING'].includes(count.status)).sort((a, b) => Number(b.warehouseId === selectedWarehouseId) - Number(a.warehouseId === selectedWarehouseId));
    const history = counts.filter(count => !['OPEN', 'CLOSING'].includes(count.status));
    const row = (count: Count) => <li key={count.id} className="stock-count-list-row">
        <div><h3>{count.warehouse?.name || 'Bodega no especificada'}</h3><p>{count.scope === 'CATEGORY' ? count.category : 'Todos los productos'} · {count._count?.items ?? '—'} productos · <time dateTime={count.createdAt}>{date(count.createdAt)}</time>{count.creator && ` · ${count.creator.name}`}</p></div>
        <button type="button" onClick={() => onOpen(count.id)} className="stock-workspace-quiet nx-fluid-press" aria-label={`${count.status === 'OPEN' && count.warehouseId ? 'Continuar' : 'Ver detalle'}: conteo de ${count.warehouse?.name || 'bodega no especificada'}, ${date(count.createdAt)}`}>
            {count.status === 'OPEN' && count.warehouseId ? 'Continuar' : count.status === 'CLOSING' ? 'Ver cierre' : count.status === 'CLOSED' ? 'Cerrado' : 'Cancelado'}<ChevronRight size={16}/>
        </button>
    </li>;
    return <>
        <header className="stock-workspace-header">
            <Link to={returnHref} className="stock-workspace-back nx-fluid-press"><ChevronLeft size={17}/> Productos</Link>
            <div className="stock-workspace-title"><h1>Contar existencias</h1><button onClick={onCreate} className="stock-count-primary nx-fluid-press"><Plus size={17}/> Nuevo conteo</button></div>
        </header>
        {loading ? <p role="status" className="stock-count-empty"><Loader2 className="animate-spin" size={20}/> Cargando conteos…</p> : <>
            {active.length > 0 ? <section aria-label="Conteos por terminar" className="stock-workspace-list"><h2 className="stock-count-list-label">Seguí donde quedaste</h2><ul>{active.map(row)}</ul></section> : !error && <div className="stock-count-empty"><p>No hay conteos por terminar.</p><span>Elegí una bodega y anotá lo que tenés físicamente.</span></div>}
            {history.length > 0 && <details className="stock-count-history" onToggle={event => setShowHistory(event.currentTarget.open)}><summary>Historial de conteos <span>{history.length}</span></summary>{showHistory && <><p className="mb-3 text-xs text-slate-400">Hasta 100 conteos finalizados. Los abiertos se muestran arriba.</p><ul className="stock-workspace-list">{history.map(row)}</ul></>}</details>}
        </>}
    </>;
}
