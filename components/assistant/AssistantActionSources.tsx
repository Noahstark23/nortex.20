import React, { useEffect, useState } from 'react';
import type { AssistantJsonObject } from '../../shared/assistantOperations';
import type { AssistantCatalogItem, AssistantRequest } from '../../hooks/useNortexAssistant';
import { AssistantCatalogSelect, assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';
const string = (value: unknown) => typeof value === 'string' ? value : '';
const sourceKey = (type: string) => ({ DIRECT_PURCHASE_ITEM: 'purchaseItemId', GOODS_RECEIPT_UNMATCHED: 'goodsReceiptItemId', PURCHASE_MATCH_ALLOCATION: 'purchaseMatchAllocationId' }[type]);
export function AssistantActionSources({ kind, draft, request, disabled, onChange, resetKey, productId: initialProductId }: { kind: 'BATCH_WRITEOFF' | 'SUPPLIER_RETURN'; resetKey: string; draft: AssistantJsonObject; request: AssistantRequest; disabled: boolean; onChange: (draft: AssistantJsonObject) => void; productId?: string }) {
    const [productId, setProductId] = useState(initialProductId ?? '');
    useEffect(() => setProductId(initialProductId ?? ''), [resetKey]);
    const lines = Array.isArray(draft.lines) ? draft.lines.filter((line): line is AssistantJsonObject => !!line && typeof line === 'object' && !Array.isArray(line)) : [];
    const chooseSource = (index: number, id: string | undefined, item?: AssistantCatalogItem) => {
        const key = sourceKey(item?.sourceType ?? ''); if (!id || !key) return;
        onChange({ ...draft, physicalShipmentConfirmed: false, lines: lines.map((line, row) => row === index ? { sourceType: item!.sourceType!, [key]: id, quantity: line.quantity ?? '' } : line) });
    };
    return <div className="space-y-3">
        <AssistantCatalogSelect label="Producto para buscar procedencia" kind="products" request={request} value={productId} disabled={disabled} onChange={id => setProductId(id ?? '')} />
        {kind === 'BATCH_WRITEOFF' ? <AssistantCatalogSelect label="Lote que se retira" kind="batches" parameters={{ productId }} request={request} value={string(draft.batchId)} disabled={disabled || !productId} onChange={(id, item) => onChange({ ...draft, batchId: id ?? '', warehouseId: item?.warehouseId ?? '', physicalRemovalConfirmed: false })} /> : <>
            <AssistantCatalogSelect label="Proveedor de la mercadería" kind="returnSuppliers" parameters={{ productId }} request={request} value={string(draft.supplierId)} disabled={disabled || !productId} onChange={id => onChange({ ...draft, supplierId: id ?? '', lines: [], physicalShipmentConfirmed: false })} />
            {lines.map((line, index) => <div key={index} className="nx-shell-border space-y-2 border-t pt-2"><AssistantCatalogSelect label={`Procedencia de la línea ${index + 1}`} kind="supplierReturnSources" parameters={{ supplierId: string(draft.supplierId), productId }} request={request} value={string(line[sourceKey(string(line.sourceType)) ?? ''])} disabled={disabled || !draft.supplierId} onChange={(id, item) => chooseSource(index, id, item)} /><label className="nx-shell-text block text-sm">Cantidad de la línea {index + 1}<input inputMode="decimal" className={assistantInputClass} disabled={disabled} value={string(line.quantity)} onChange={event => onChange({ ...draft, physicalShipmentConfirmed: false, lines: lines.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item) })} /></label><button type="button" className={assistantButtonClass} disabled={disabled} onClick={() => onChange({ ...draft, physicalShipmentConfirmed: false, lines: lines.filter((_, row) => row !== index) })}>Quitar línea {index + 1}</button></div>)}
            <button type="button" className={assistantButtonClass} disabled={disabled || !draft.supplierId} onClick={() => onChange({ ...draft, physicalShipmentConfirmed: false, lines: [...lines, { quantity: '' }] })}>Agregar mercadería a devolver</button>
        </>}
    </div>;
}
