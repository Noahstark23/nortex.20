import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, Check, Package, X } from 'lucide-react';
import Purchases, { type PurchaseEntryProduct } from '../Purchases';
import { formatQuantityValue } from '../../utils/quantity';
import { formatMoney } from '../../utils/money';
import { resolveProductQuantityRules } from '../../utils/productQuantityRules';
import { useProductStock } from './useProductStock';

export interface StockPaneProduct {
    id: string; name: string; brand?: string | null; sku: string; stock: number; unit: string;
    saleMode?: string | null; quantityStep?: number | string | null; price?: number; cost?: number; requiresBatchTracking?: boolean;
}
interface Props {
    product: StockPaneProduct; revision: number; canReceive: boolean; canReceiveOrders: boolean;
    canTransfer: boolean; canCount: boolean; canViewPrice: boolean;
    onClose: () => void; onReceivingChange: (open: boolean) => void; onBusyChange: (busy: boolean) => void; onCompleted: () => void;
    onNavigate: (route: string, warehouseId?: string) => void; actions: React.ReactNode;
}
export const StockProductPane: React.FC<Props> = ({ product, revision, canReceive, canReceiveOrders, canTransfer, canCount,
    canViewPrice, onClose, onReceivingChange, onBusyChange, onCompleted, onNavigate, actions }) => {
    const rules = resolveProductQuantityRules(product);
    const snapshot = useProductStock(product.id, revision);
    const [warehouseId, setWarehouseId] = useState('');
    const [receiving, setReceiving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [received, setReceived] = useState(false);
    useEffect(() => {
        if (!snapshot.data) return;
        setWarehouseId(current => snapshot.data!.warehouses.some(w => w.id === current) ? current
            : snapshot.data!.warehouses.length === 1 ? snapshot.data!.warehouses[0].id : '');
    }, [snapshot.data]);
    const warehouse = snapshot.data?.warehouses.find(item => item.id === warehouseId);
    const updateBusy = (value: boolean) => { setBusy(value); onBusyChange(value); };

    if (receiving) return <div className="nx-stock-pane nx-stock-pane--receiving">
        <Purchases embedded entryContext={{ product: product as PurchaseEntryProduct, warehouseId }}
            onBusyChange={updateBusy} onClose={() => { if (!busy) { setReceiving(false); onReceivingChange(false); } }}
            onCompleted={() => { updateBusy(false); setReceiving(false); onReceivingChange(false); setReceived(true); onCompleted(); }} />
    </div>;
    return <section className="nx-stock-pane" aria-label={`Ficha de ${product.name}`}>
        <header className="nx-stock-pane__header">
            <span className="nx-stock-pane__eyebrow">Producto</span>
            <button type="button" className="nx-fluid-press nx-stock-icon" onClick={onClose} aria-label="Cerrar ficha"><X size={20}/></button>
        </header>
        <div className="nx-stock-pane__body">
            <h2>{product.name}</h2>{product.brand && <p>Marca: <strong>{product.brand}</strong></p>}<p className="nx-stock-pane__sku">{product.sku}</p>
            <div className="nx-stock-pane__balance"><strong>{snapshot.data ? formatQuantityValue(snapshot.data.totalStock) : '—'}</strong>
                <span>{product.unit} en total</span></div>
            {canViewPrice && product.price !== undefined && <p className="nx-stock-pane__price">Precio de venta <strong>{formatMoney(product.price)}</strong></p>}
            {received && <p role="status" className="nx-stock-pane__success"><Check size={18}/> Mercadería recibida</p>}
            <p className="nx-stock-pane__notice">{rules.saleMode === 'COUNTED' ? 'Se vende en cantidades enteras' : `Admite fracciones · paso ${rules.quantityStep}`}</p>
            <div className="nx-stock-pane__locations">
                <h3>{canReceive || canTransfer || canCount ? 'Elegí la bodega' : 'Existencias por bodega'}</h3>
                {snapshot.loading && <p role="status">Cargando existencias…</p>}
                {snapshot.error && <div role="alert"><p>{snapshot.error}</p><button type="button" className="nx-fluid-press nx-stock-link" onClick={snapshot.retry}>Reintentar existencias</button></div>}
                {snapshot.data?.warehouses.map(item => <button key={item.id} type="button" className="nx-fluid-press nx-stock-location"
                    aria-pressed={warehouseId === item.id} onClick={() => setWarehouseId(item.id)}>
                    <span>{item.name}</span><strong>{formatQuantityValue(item.stock)} <small>{product.unit}</small></strong>
                    {warehouseId === item.id && <Check size={17} aria-hidden="true"/>}
                </button>)}
                {snapshot.data?.warehouses.length === 0 && <p>No hay bodegas activas. Creá una en Bodegas para recibir mercadería.</p>}
                {snapshot.data?.unlistedStock !== undefined && <p className="nx-stock-pane__notice">Existencias fuera de este desglose: {formatQuantityValue(snapshot.data.unlistedStock)} {product.unit}.</p>}
                {snapshot.data?.hasMore && <button type="button" className="nx-fluid-press nx-stock-link" onClick={() => onNavigate('/app/warehouses')}>Ver todas las bodegas</button>}
                {product.requiresBatchTracking && <p className="nx-stock-pane__notice">Existencias físicas. Revisá los lotes para conocer lo disponible para vender.</p>}
            </div>
            {canReceive && <button type="button" className="nx-fluid-press nx-stock-primary" disabled={!warehouse || snapshot.loading}
                onClick={() => { setReceived(false); onReceivingChange(true); setReceiving(true); }}><ArrowDownToLine size={19}/> Recibir mercadería</button>}
            {canReceive && !warehouse && !snapshot.loading && !snapshot.error && Boolean(snapshot.data?.warehouses.length) && <p className="nx-stock-pane__hint">Tocá la bodega donde vas a guardar la mercadería.</p>}
            {!canReceive && canReceiveOrders && <button type="button" className="nx-fluid-press nx-stock-primary" onClick={() => onNavigate('/app/purchase-orders')}>Recibir una orden</button>}
            {(canTransfer || canCount) && <div className="nx-stock-pane__secondary">
                {canTransfer && <button type="button" className="nx-fluid-press" disabled={!warehouse} onClick={() => onNavigate('/app/warehouses', warehouseId)}><ArrowRightLeft size={16}/> Mover a otra bodega</button>}
                {canCount && <button type="button" className="nx-fluid-press" disabled={!warehouse} onClick={() => onNavigate('/app/inventory-count', warehouseId)}>Contar aquí</button>}
            </div>}
            <div className="nx-stock-pane__tools">{actions}</div>
        </div>
    </section>;
};
export function StockPaneEmpty() {
    return <div className="nx-stock-pane nx-stock-pane--empty"><Package size={34} strokeWidth={1.3}/><h2>Todo sobre tu producto,<br/>en un mismo lugar.</h2><p>Elegí uno para ver dónde está<br/>o recibir más mercadería.</p></div>;
}
