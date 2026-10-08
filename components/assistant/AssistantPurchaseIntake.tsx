import type { AssistantAction, AssistantPurchaseIntakeDTO } from '../../shared/assistant';
import { assistantButtonClass } from './AssistantCatalogSelect';

const missingLabels: Record<string, string> = {
    supplierId: 'Proveedor', invoiceNumber: 'Número de factura', date: 'Fecha de factura', postingDate: 'Fecha contable', dueDate: 'Vencimiento del crédito',
    currency: 'Moneda', documentSubtotal: 'Subtotal declarado', documentTax: 'IVA declarado', documentTotal: 'Total declarado',
    paymentMethod: 'Forma de pago', paymentConfirmed: 'Si pagaste la mercadería', receivedConfirmed: 'Si recibiste la mercadería',
    warehouseId: 'Bodega', purchaseOrderId: 'Recepción de la orden de compra', discount: 'Descuento', freight: 'Flete', otherCharges: 'Otros cargos',
    productId: 'Producto del catálogo', purchaseUnit: 'Unidad base o empaque', quantity: 'Cantidad', unitCost: 'Costo por unidad', batchNumber: 'Lote', expiryDate: 'Vencimiento del lote',
};
function missingLabel(field: string) {
    const item = /^items\.(\d+)\.([a-zA-Z]+)$/.exec(field);
    if (item) return `Producto ${Number(item[1]) + 1}: ${missingLabels[item[2]] ?? 'dato por revisar'}`;
    return missingLabels[field] ?? 'Dato pendiente de revisar en la conversación';
}

/** Las acciones vienen del contrato de Nortex; el texto del modelo nunca es una ruta o una orden ejecutable. */
export function AssistantPurchaseIntake({ intake, actions, disabled, onAction }: {
    intake: AssistantPurchaseIntakeDTO; actions: AssistantAction[];
    disabled: (action: AssistantAction) => boolean; onAction: (action: AssistantAction) => void;
}) {
    return <section aria-label="Compra en preparación" className="nx-shell-control space-y-3 rounded-card border p-4">
        <h3 className="nx-shell-text font-semibold">{intake.phase === 'REVIEW' ? 'Compra lista para revisar' : 'Estamos preparando tu compra'}</h3>
        <p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{intake.summary}</p>
        {intake.phase === 'COLLECTING' && intake.missing.length > 0 && <details className="space-y-1"><summary className="nx-shell-muted min-h-tap cursor-pointer text-sm">Datos por completar</summary><ul className="nx-shell-text list-disc space-y-1 break-words pl-5 text-sm">{intake.missing.map((missing, index) => <li key={index}>{missingLabel(missing)}</li>)}</ul></details>}
        <p className="nx-shell-muted text-xs">La captura se conserva en esta conversación. Nada se registra hasta revisar y confirmar los efectos.</p>
        <div className="flex flex-wrap gap-2">{actions.filter(action => ['UPLOAD_INVOICE', 'CONTINUE_PURCHASE', 'REVIEW_PURCHASE'].includes(action.type)).map((action, index) => <button key={`${action.type}-${index}`} type="button" disabled={disabled(action)} className={assistantButtonClass} onClick={() => onAction(action)}>{action.label}</button>)}</div>
    </section>;
}
