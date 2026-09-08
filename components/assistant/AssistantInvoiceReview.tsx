import React, { useEffect, useRef, useState } from 'react';
import type { AssistantCapabilities, AssistantOperationDTO, AssistantProposalDTO, InvoiceDraft, InvoiceDraftLine } from '../../shared/assistant';
import type { AssistantCatalogItem, AssistantRequest } from '../../hooks/useNortexAssistant';
import { formatMoney, toDecimal } from '../../utils/money';
import { AssistantCatalogSelect, assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';

type Props = { proposal: AssistantProposalDTO; capabilities: AssistantCapabilities; request: AssistantRequest; busy: boolean;
    confirmationRejected?: boolean; editor?: ReturnType<typeof useAssistantInvoiceReviewState>; operation: AssistantOperationDTO | null; onSave: (draft: InvoiceDraft) => Promise<void>; onConfirm: (key: string) => Promise<void>; onOpenPurchases: () => void };
const cloneDraft = (draft: InvoiceDraft): InvoiceDraft => ({ ...draft, warnings: [...draft.warnings], items: draft.items.map(item => ({ ...item })) });
const fieldLabels: Array<[keyof InvoiceDraft, string, string]> = [
    ['supplierName', 'Proveedor escrito en la factura', 'text'], ['invoiceNumber', 'Número de factura', 'text'], ['currency', 'Moneda', 'text'],
    ['date', 'Fecha de factura', 'date'], ['postingDate', 'Fecha contable', 'date'], ['dueDate', 'Vencimiento del crédito', 'date'],
    ['documentSubtotal', 'Subtotal del documento', 'text'], ['documentTax', 'IVA del documento', 'text'], ['documentTotal', 'Total del documento', 'text'],
    ['discount', 'Descuento del documento', 'text'], ['freight', 'Flete del documento', 'text'], ['otherCharges', 'Otros cargos', 'text'],
];

/** Vive sobre FluidSheet: cambiar pestaña o cerrar no descarta correcciones ni la referencia de ejecución. */
export function useAssistantInvoiceReviewState(proposal: AssistantProposalDTO | null) {
    const [draft, setDraft] = useState<InvoiceDraft | null>(() => proposal ? cloneDraft(proposal.draft) : null);
    const [dirty, setDirty] = useState(false); const [warningsReviewed, setWarningsReviewed] = useState(false);
    const [reviewed, setReviewed] = useState(false); const [confirmStarted, setConfirmStarted] = useState(false);
    const [orderItems, setOrderItems] = useState<NonNullable<AssistantCatalogItem['items']>>([]);
    const confirmation = useRef({ proposalId: proposal?.id, version: proposal?.version, key: crypto.randomUUID() });
    useEffect(() => {
        setDraft(proposal ? cloneDraft(proposal.draft) : null); setDirty(false); setReviewed(false); setWarningsReviewed(false); setConfirmStarted(false); setOrderItems([]);
        if (confirmation.current.proposalId !== proposal?.id || confirmation.current.version !== proposal?.version) {
            confirmation.current = { proposalId: proposal?.id, version: proposal?.version, key: crypto.randomUUID() };
        }
    }, [proposal?.id, proposal?.version]);
    return { draft, setDraft, dirty, setDirty, warningsReviewed, setWarningsReviewed, reviewed, setReviewed, confirmStarted, setConfirmStarted, orderItems, setOrderItems, confirmation };
}

/** El navegador edita un borrador; el impacto y el registro siempre provienen de Nortex. */
export const AssistantInvoiceReview: React.FC<Props> = ({ proposal, capabilities, request, busy, operation, onSave, onConfirm, onOpenPurchases, editor, confirmationRejected = false }) => {
    const fallbackEditor = useAssistantInvoiceReviewState(proposal);
    const { draft: editedDraft, setDraft, dirty, setDirty, warningsReviewed, setWarningsReviewed, reviewed, setReviewed, confirmStarted, setConfirmStarted, orderItems, setOrderItems, confirmation } = editor ?? fallbackEditor;
    useEffect(() => { if (confirmationRejected) { setConfirmStarted(false); setReviewed(false); } }, [confirmationRejected]);
    const draft = editedDraft ?? proposal.draft;
    if (confirmation.current.proposalId !== proposal.id || confirmation.current.version !== proposal.version) return <p role="status" className="nx-shell-muted text-sm">Preparando la revisión actual…</p>;
    const manual = proposal.source === 'MANUAL';
    const canPrepare = manual ? capabilities.purchasePrepare === true : capabilities.invoicePrepare;
    const locked = busy || !!operation || confirmStarted || !canPrepare || ['COMMITTED', 'EXPIRED', 'CANCELLED'].includes(proposal.status);
    const change = (patch: Partial<InvoiceDraft>) => { setDraft(current => ({ ...current, ...patch })); setDirty(true); setReviewed(false); };
    const changeLine = (index: number, patch: Partial<InvoiceDraftLine>) => change({ items: draft.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
    const cashIdentified = !proposal.preview || !toDecimal(proposal.preview.cashOut).gt(0) || Boolean(proposal.preview.cashShiftId && proposal.preview.cashShiftLabel);
    const ready = !dirty && proposal.status === 'READY' && !!proposal.preview && proposal.issues.length === 0 && cashIdentified;
    const confirm = async () => { setConfirmStarted(true); await onConfirm(confirmation.current.key); };
    if (operation) return <section aria-label="Comprobante de compra" className="nx-shell-control space-y-3 rounded-card border p-4">
        <h3 className="nx-tone-positive text-lg font-bold">Compra registrada</h3><p className="nx-shell-text text-sm">{operation.message}</p>
        <dl className="nx-shell-muted break-all text-sm"><dt>Compra</dt><dd>{operation.purchaseId}</dd><dt>Referencia de operación</dt><dd>{operation.id}</dd></dl>
        <button type="button" className={assistantButtonClass} onClick={onOpenPurchases}>Consultar en Compras</button>
    </section>;
    return <section aria-label={manual ? 'Revisar compra' : 'Revisar factura'} className="space-y-4">
        <div><h3 className="nx-shell-text text-lg font-bold">{manual ? 'Revisá la compra' : 'Revisá la factura'}</h3><p className="nx-shell-muted mt-1 text-sm">{manual ? 'Preparada con los datos que aportaste por conversación, sin un documento adjunto. Verificá el número de factura, los costos y el total reales. Recibir y pagar la mercadería son decisiones separadas.' : 'Todavía no está registrada. Compará cada dato con el documento. Una factura no demuestra que recibiste o pagaste la mercadería.'}</p>{manual && <p className="nx-tone-warning mt-2 text-sm">Todavía no está registrada. Tu mensaje no confirma esta compra.</p>}</div>
        <p className="nx-shell-muted text-xs">Referencia: {proposal.id}<br />Revisión {proposal.version} · Vence {new Date(proposal.expiresAt).toLocaleString('es-NI', { timeZone: 'America/Managua' })}</p>
        {draft.warnings.length > 0 && <div className="nx-shell-control rounded-card border p-3"><h4 className="nx-tone-warning font-semibold">Datos por comprobar</h4><ul className="nx-shell-text list-disc space-y-1 pl-5 text-sm">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <fieldset disabled={locked} className="min-w-0 space-y-4 disabled:opacity-70">
            <legend className="sr-only">{manual ? 'Datos declarados de la compra' : 'Datos del documento'}</legend>
            <AssistantCatalogSelect label="Proveedor" kind="suppliers" value={draft.supplierId} selectedLabel={draft.supplierName} request={request} disabled={locked} onChange={supplierId => change({ supplierId })} />
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{fieldLabels.map(([key, label, type]) => <label key={key} className="nx-shell-text min-w-0 text-sm font-semibold">{manual ? label.replace('Proveedor escrito en la factura', 'Proveedor declarado').replace('del documento', 'declarado') : label}<input type={type} value={String(draft[key] ?? '')} className={`${assistantInputClass} mt-1`} onChange={event => change({ [key]: event.target.value })} /></label>)}</div>
            <AssistantCatalogSelect label="Bodega" kind="warehouses" value={draft.warehouseId} request={request} disabled={locked} onChange={warehouseId => change({ warehouseId })} />
            <label className="nx-shell-text block text-sm font-semibold">Origen de la mercadería<select className={`${assistantInputClass} mt-1`} value={draft.purchaseOrderId ? 'ORDER' : 'DIRECT'} onChange={event => change({ purchaseOrderId: event.target.value === 'ORDER' ? '__SELECT_ORDER__' : undefined, items: draft.items.map(item => ({ ...item, purchaseOrderItemId: undefined })) })}>
                <option value="DIRECT">Compra directa: ingresará existencias</option><option value="ORDER">Factura de una OC ya recibida</option>
            </select></label>
            {draft.purchaseOrderId && <AssistantCatalogSelect label="Orden de compra recibida" kind="purchaseOrders" value={draft.purchaseOrderId === '__SELECT_ORDER__' ? undefined : draft.purchaseOrderId} request={request} disabled={locked} onChange={(purchaseOrderId, item) => { change({ purchaseOrderId: purchaseOrderId || '__SELECT_ORDER__', items: draft.items.map(line => ({ ...line, purchaseOrderItemId: undefined })) }); setOrderItems(item?.items ?? []); }} />}
            <label className="nx-shell-text block text-sm font-semibold">Pago<select className={`${assistantInputClass} mt-1`} value={draft.paymentMethod ?? ''} onChange={event => change({ paymentMethod: event.target.value as InvoiceDraft['paymentMethod'] || undefined, paymentConfirmed: false })}>
                <option value="">Confirmá cómo se paga</option><option value="CASH">Efectivo: salida de la caja abierta</option><option value="CREDIT">Crédito: cuenta pendiente al proveedor</option>
            </select></label>
            <label className="nx-shell-text flex min-h-tap items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={draft.receivedConfirmed} onChange={event => change({ receivedConfirmed: event.target.checked })} />Confirmo que la mercadería fue recibida y comprobé si ya existe una recepción de OC.</label>
            {draft.paymentMethod === 'CREDIT' ? <div className="space-y-2"><p className="nx-shell-text text-sm">Esta compra quedará pendiente de pago al proveedor. No se registrará una salida de caja.</p>{draft.paymentConfirmed && <button type="button" className={assistantButtonClass} onClick={() => change({ paymentConfirmed: false })}>Marcar como pendiente de pago</button>}</div> : <label className="nx-shell-text flex min-h-tap items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={draft.paymentConfirmed} onChange={event => change({ paymentConfirmed: event.target.checked })} />Confirmo que el pago en efectivo corresponde a esta caja.</label>}
            <div className="space-y-4">{draft.items.map((item, index) => <fieldset key={index} className="nx-shell-control min-w-0 space-y-3 rounded-card border p-3">
                <legend className="nx-shell-text px-1 font-semibold">Producto {index + 1}</legend>
                <label className="nx-shell-text block text-sm">Descripción en la factura<input className={`${assistantInputClass} mt-1`} value={item.description} onChange={event => changeLine(index, { description: event.target.value })} /></label>
                <AssistantCatalogSelect label={`Producto del catálogo ${index + 1}`} kind="products" value={item.productId} selectedLabel={item.description} request={request} disabled={locked} onChange={productId => changeLine(index, { productId, purchaseOrderItemId: undefined })} />
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="nx-shell-text text-sm">Cantidad<input aria-label={`Cantidad ${index + 1}`} inputMode="decimal" className={`${assistantInputClass} mt-1`} value={item.quantity} onChange={event => changeLine(index, { quantity: event.target.value })} /></label>
                    <label className="nx-shell-text text-sm">Costo por unidad elegida<input aria-label={`Costo ${index + 1}`} inputMode="decimal" className={`${assistantInputClass} mt-1`} value={item.unitCost} onChange={event => changeLine(index, { unitCost: event.target.value })} /></label>
                    <label className="nx-shell-text text-sm">Unidad<select aria-label={`Unidad ${index + 1}`} className={`${assistantInputClass} mt-1`} value={item.purchaseUnit} onChange={event => changeLine(index, { purchaseUnit: event.target.value as InvoiceDraftLine['purchaseUnit'] })}><option value="BASE">Unidad base</option><option value="PACK">Empaque del catálogo</option></select></label>
                    <label className="nx-shell-text text-sm">Lote<input aria-label={`Lote ${index + 1}`} className={`${assistantInputClass} mt-1`} value={item.batchNumber ?? ''} onChange={event => changeLine(index, { batchNumber: event.target.value })} /></label>
                    <label className="nx-shell-text text-sm">Vencimiento del lote<input aria-label={`Vencimiento del lote ${index + 1}`} type="date" className={`${assistantInputClass} mt-1`} value={item.expiryDate ?? ''} onChange={event => changeLine(index, { expiryDate: event.target.value })} /></label>
                </div>
                {draft.purchaseOrderId && <label className="nx-shell-text block text-sm">Renglón de la OC<select className={`${assistantInputClass} mt-1`} aria-label={`Renglón de la OC ${index + 1}`} value={item.purchaseOrderItemId ?? ''} onChange={event => changeLine(index, { purchaseOrderItemId: event.target.value || undefined })}>
                    <option value="">Elegí el renglón recibido</option>{item.purchaseOrderItemId && !orderItems.some(orderItem => orderItem.id === item.purchaseOrderItemId) && <option value={item.purchaseOrderItemId}>Renglón guardado · revisá la OC</option>}
                    {orderItems.filter(orderItem => orderItem.productId === item.productId).map(orderItem => <option key={orderItem.id} value={orderItem.id}>{orderItem.label}</option>)}
                </select></label>}
                <button type="button" className={`${assistantButtonClass} nx-tone-danger`} onClick={() => change({ items: draft.items.filter((_, i) => i !== index) })}>Quitar producto {index + 1}</button>
            </fieldset>)}</div>
            <button type="button" className={assistantButtonClass} disabled={draft.items.length >= 200} onClick={() => change({ items: [...draft.items, { description: '', quantity: '', unitCost: '', purchaseUnit: 'BASE' }] })}>Agregar renglón faltante</button>
            <label className="nx-shell-text block text-sm font-semibold">Notas<textarea className={`${assistantInputClass} mt-1`} value={draft.notes ?? ''} onChange={event => change({ notes: event.target.value })} /></label>
        </fieldset>
        {draft.warnings.length > 0 && <label className="nx-shell-text flex min-h-tap items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={warningsReviewed} disabled={locked} onChange={event => { setWarningsReviewed(event.target.checked); setDirty(true); setReviewed(false); }} />Revisé y corregí los datos señalados</label>}
        {proposal.issues.length > 0 && <div role="alert" className="nx-tone-warning space-y-2 text-sm"><p className="font-semibold">Antes de registrar, resolvé:</p><ul className="list-disc space-y-1 pl-5">{proposal.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
        {dirty && <p role="status" className="nx-tone-warning text-sm">Cambiaste {manual ? 'la compra' : 'la factura'}. Guardá la revisión para recalcular sus efectos.</p>}
        {!confirmStarted && canPrepare && <button type="button" className={`${assistantButtonClass} w-full`} disabled={locked || (!dirty && proposal.status !== 'DRAFT')} onClick={() => void onSave({ ...draft, warnings: warningsReviewed ? [] : draft.warnings })}>{busy ? 'Comprobando…' : 'Guardar revisión y calcular efectos'}</button>}
        {proposal.preview && !dirty && <section aria-label="Efectos de la compra" className="nx-shell-control space-y-3 rounded-card border p-4">
            <h4 className="nx-shell-text font-bold">Esto cambiará al confirmar</h4>
            <p className="nx-shell-text text-sm">Proveedor: {proposal.preview.supplierName}{proposal.preview.warehouseName ? ` · Bodega: ${proposal.preview.warehouseName}` : ''}</p>
            {toDecimal(proposal.preview.cashOut).gt(0) && <p className="nx-shell-text break-words text-sm"><strong>Caja que registra el egreso:</strong> {proposal.preview.cashShiftLabel || 'No se pudo identificar la caja'}<br /><span className="nx-shell-muted text-xs">{proposal.preview.cashShiftId}</span></p>}
            <dl className="nx-shell-text grid grid-cols-2 gap-2 text-sm"><dt>Subtotal</dt><dd className="text-right">{formatMoney(proposal.preview.subtotal)}</dd><dt>IVA</dt><dd className="text-right">{formatMoney(proposal.preview.tax)}</dd><dt>Total</dt><dd className="text-right font-bold">{formatMoney(proposal.preview.total)}</dd><dt>Salida de caja</dt><dd className="text-right">{formatMoney(proposal.preview.cashOut)}</dd><dt>Cuenta por pagar</dt><dd className="text-right">{formatMoney(proposal.preview.payable)}</dd></dl>
            <p className="nx-shell-muted text-sm">{proposal.preview.stockEffect === 'ALREADY_RECEIVED' ? 'Existencias: ya ingresaron con la recepción de OC; no se ingresan otra vez.' : 'Se ingresarán las siguientes unidades base al inventario:'}</p>
            <ul className="nx-shell-text space-y-2 text-sm">{proposal.preview.lines.map((line, index) => <li key={index} className="break-words">{line.name}: {line.quantity} {line.purchaseUnit === 'PACK' ? 'empaques' : 'unidades'} = {line.baseQuantity} unidades base · {formatMoney(line.lineTotal)}{line.batchNumber ? ` · Lote ${line.batchNumber}` : ''}{line.expiryDate ? ` · Vence ${line.expiryDate}` : ''}</li>)}</ul>
        </section>}
        {!cashIdentified && <p role="alert" className="nx-tone-warning text-sm">La caja que registra el egreso no está identificada. Revisá la compra antes de confirmar.</p>}
        {ready && (!manual || canPrepare) && capabilities.invoiceConfirm && capabilities.executionEnabled ? <div className="space-y-3">
            <label className="nx-shell-text flex min-h-tap items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} disabled={busy || confirmStarted} onChange={event => setReviewed(event.target.checked)} />{manual ? 'Revisé los datos y los efectos de esta compra exacta.' : 'Revisé el documento, los productos y estos efectos exactos.'}</label>
            {confirmStarted && <p role="status" className="nx-tone-warning text-sm">Si la respuesta se interrumpió, reintentá con esta misma referencia. No ingresés la factura de nuevo: {confirmation.current.key}</p>}
            <button type="button" className={`${assistantButtonClass} nx-tone-positive w-full`} disabled={!reviewed || busy || !navigator.onLine} onClick={() => void confirm()}>{busy ? 'Comprobando registro…' : confirmStarted ? 'Reintentar confirmación con la misma referencia' : `Confirmar y registrar compra por ${formatMoney(proposal.preview!.total)}`}</button>
        </div> : <p className="nx-shell-muted text-sm">{!capabilities.executionEnabled ? 'El registro desde NortexGPT está desactivado.' : !capabilities.invoiceConfirm || (manual && !canPrepare) ? 'Tu rol permite revisar, pero no registrar compras.' : 'La propuesta requiere revisión antes de registrar.'}</p>}
        <button type="button" className={assistantButtonClass} onClick={onOpenPurchases}>Revisar en Compras</button>
    </section>;
}
