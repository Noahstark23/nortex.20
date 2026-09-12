import Decimal from 'decimal.js';
import React, { useEffect, useRef } from 'react';
import { ChevronDown, CreditCard, Package, Plus, Search, Trash2, Truck, X } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import { formatQuantityValue } from '../../utils/quantity';
import { BODEGA_DECIMAL_HINT, normalizeBodegaDecimalInput } from '../../utils/bodegaReceivingInput';
import { purchaseQuantityInputStep, type PurchaseUnit, type resolvePurchaseLine } from '../../utils/purchasePackaging';
import type {
    CartItem,
    PurchaseEntryProduct,
    PurchaseFormErrors,
    PurchaseOrderLite,
    Supplier,
    WarehouseOption,
} from '../Purchases';
import './receivingWorkspace.css';
import { PURCHASE_NO_TAX_REASONS, PURCHASE_TAX_SIN_TRASLADO, PURCHASE_TAX_TRASLADADO, type PurchaseTaxTreatment, type PurchaseNoTaxReason } from '../../utils/purchaseTaxTreatment';
import { PURCHASE_NO_TAX_REASON_LABELS } from '../../utils/purchaseTaxTreatmentLabels';

export interface ReceivingDocument {
    supplierId: string;
    warehouseId: string;
    purchaseOrderId: string;
    invoiceNumber: string;
    date: string;
    paymentMethod: 'CASH' | 'CREDIT';
    taxTreatment?: PurchaseTaxTreatment;
    noTaxReason?: PurchaseNoTaxReason | '';
    dueDate: string;
    notes: string;
}

interface ReceivingWorkspaceProps {
    embedded?: boolean;
    loading: boolean;
    submitting: boolean;
    canSubmit: boolean;
    canEditSalePrice?: boolean;
    cart: CartItem[];
    document: ReceivingDocument;
    errors: PurchaseFormErrors;
    suppliers: Supplier[];
    warehouses: WarehouseOption[];
    orders: PurchaseOrderLite[];
    search: string;
    products: PurchaseEntryProduct[];
    draftSaved: boolean;
    contextError: string;
    totals: { subtotal: number; taxableSubtotal: number; tax: number; total: number };
    resolveLine: (item: CartItem) => ReturnType<typeof resolvePurchaseLine>;
    hasPack: (item: CartItem) => boolean;
    onDocumentChange: (patch: Partial<ReceivingDocument>) => void;
    onSearch: (value: string) => void;
    onAdd: (product: PurchaseEntryProduct) => void;
    onUpdate: (key: string, field: 'quantity' | 'unitCost' | 'salePrice' | 'batchNumber' | 'expiryDate', value: string) => void;
    onPurchaseUnit: (key: string, unit: PurchaseUnit) => void;
    onRemove: (key: string) => void;
    onSubmit: () => void;
    onClose?: () => void;
}

/** Vista controlada. Compras conserva carrito, validación, borrador y comando de registro. */
export default function ReceivingWorkspace(p: ReceivingWorkspaceProps) {
    const workspaceRef = useRef<HTMLFieldSetElement>(null);
    const doc = p.document;
    const field = 'nx-form-field receiving-input';
    const messages = [...new Set(Object.values(p.errors).filter(Boolean))];
    useEffect(() => {
        if (Object.values(p.errors).some(Boolean)) {
            workspaceRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        }
    }, [p.errors]);
    return (
        <fieldset
            ref={workspaceRef}
            disabled={p.submitting}
            aria-busy={p.submitting}
            className={`nx-light-context receiving-workspace ${p.embedded ? 'receiving-workspace--embedded' : ''}`}
        >
            <div className="receiving-frame">
                <header className="receiving-heading">
                    <div>
                        <p className="receiving-eyebrow">ENTRADA DE MERCADERÍA</p>
                        <h2>{doc.purchaseOrderId ? 'Facturar lo recibido' : 'Recibir mercadería'}</h2>
                    </div>
                    {p.onClose && (
                        <button
                            type="button"
                            className="nx-fluid-press receiving-icon-button"
                            onClick={p.onClose}
                            aria-label="Cerrar recepción"
                        >
                            <X size={20} />
                        </button>
                    )}
                </header>

                <div className="receiving-scroll">
                    {p.contextError && (
                        <p role="alert" className="receiving-error">
                            {p.contextError}
                        </p>
                    )}
                    {messages.length > 0 && (
                        <div role="alert" className="receiving-error">
                            <strong>Revisá estos datos</strong>
                            <ul>
                                {messages.map((message) => (
                                    <li key={String(message)}>{String(message)}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="receiving-columns">
                        <section className="receiving-products" aria-labelledby="receiving-products-title">
                            <div className="receiving-section-heading">
                                <h3 id="receiving-products-title">
                                    {doc.purchaseOrderId ? 'Lo recibido pendiente de facturar' : '¿Qué llegó?'}
                                </h3>
                                <span>
                                    {p.cart.length} producto{p.cart.length === 1 ? '' : 's'}
                                </span>
                            </div>
                            {doc.purchaseOrderId ? (
                                <p className="receiving-muted">
                                    Esta factura registra la compra. La recepción de la OC ya actualizó las existencias.
                                </p>
                            ) : (
                                <div className="receiving-search">
                                    <Search size={18} aria-hidden="true" />
                                    <input
                                        aria-label="Agregar producto a la recepción"
                                        aria-invalid={p.cart.length === 0 && Boolean(p.errors.items)}
                                        className={field}
                                        value={p.search}
                                        onChange={(e) => p.onSearch(e.target.value)}
                                        placeholder="Buscar producto por nombre o SKU..."
                                    />
                                    {p.products.length > 0 && (
                                        <div className="receiving-search-results">
                                            {p.products.map((product) => (
                                                <button
                                                    type="button"
                                                    key={product.id}
                                                    className="nx-fluid-press"
                                                    onClick={() => p.onAdd(product)}
                                                >
                                                    <span>
                                                        {product.name}
                                                        <small>
                                                            {product.sku} · {product.unit}
                                                        </small>
                                                    </span>
                                                    <Plus size={18} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {p.cart.length === 0 && (
                                <div className="receiving-empty">
                                    <Package size={32} />
                                    <p>Agregá lo que llegó para registrar la entrada.</p>
                                </div>
                            )}
                            <div className="receiving-lines">
                                {p.cart.map((item) => {
                                    let preview: ReturnType<typeof resolvePurchaseLine> | null = null;
                                    try {
                                        preview = p.resolveLine(item);
                                    } catch {
                                        /* Un parcial se conserva hasta que la persona lo complete. */
                                    }
                                    const suffix = item.purchaseOrderItemId
                                        ? ` · línea ${item.purchaseOrderItemId}`
                                        : '';
                                    return (
                                        <article
                                            className="receiving-line"
                                            key={item.cartKey}
                                            aria-label={`Recepción de ${item.productName}`}
                                        >
                                            <div className="receiving-line-title">
                                                <div>
                                                    <h4>{item.productName}</h4>
                                                    <p>
                                                        {item.sku} · {item.unit}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="nx-fluid-press receiving-icon-button"
                                                    aria-label={`Quitar ${item.productName}`}
                                                    onClick={() => p.onRemove(item.cartKey)}
                                                >
                                                    <Trash2 size={17} />
                                                </button>
                                            </div>
                                            {item.purchaseOrderItemId && (
                                                <p className="receiving-muted">
                                                    Recibido {formatQuantityValue(item.receivedQuantity ?? '0')} ·
                                                    Facturado {formatQuantityValue(item.invoicedQuantity ?? '0')} ·
                                                    Disponible {formatQuantityValue(item.availableQuantity ?? '0')}
                                                </p>
                                            )}
                                            <div className="receiving-line-fields">
                                                <label>
                                                    {doc.purchaseOrderId ? 'Cantidad a facturar' : 'Cantidad recibida'}
                                                    <input
                                                        className={field}
                                                        inputMode="decimal"
                                                        value={item.quantity}
                                                        aria-label={`Cantidad a facturar de ${item.productName}${suffix}`}
                                                        aria-invalid={!preview || Boolean(p.errors.items)}
                                                        onChange={(e) =>
                                                            p.onUpdate(
                                                                item.cartKey,
                                                                'quantity',
                                                                normalizeBodegaDecimalInput(e.target.value),
                                                            )
                                                        }
                                                    />
                                                    <small>
                                                        {item.purchaseUnit === 'PACK' && preview
                                                            ? `${formatQuantityValue(preview.baseQuantity)} ${item.unit}`
                                                            : `${item.unit} · paso ${purchaseQuantityInputStep(item, item.purchaseUnit)}`}
                                                    </small>
                                                </label>
                                                <label>
                                                    Costo{' '}
                                                    {item.purchaseUnit === 'PACK'
                                                        ? `por ${item.packUnit}`
                                                        : `por ${item.unit}`}
                                                    <input
                                                        className={field}
                                                        inputMode="decimal"
                                                        value={item.unitCost}
                                                        aria-label={`Costo de ${item.productName}${suffix}`}
                                                        aria-invalid={!preview || Boolean(p.errors.items)}
                                                        onChange={(e) =>
                                                            p.onUpdate(
                                                                item.cartKey,
                                                                'unitCost',
                                                                normalizeBodegaDecimalInput(e.target.value),
                                                            )
                                                        }
                                                    />
                                                    <small>C$ · hasta 6 decimales</small>
                                                </label>
                                            </div>
                                            <p className="receiving-muted">Actual: <strong>{item.currentSalePrice == null ? 'No disponible' : formatMoney(item.currentSalePrice)}</strong></p>
                                            <small>por {item.unit} base</small>
                                            {!p.canEditSalePrice && <p className="receiving-muted">Solo un administrador puede cambiar el precio de venta.</p>}
                                            {p.canEditSalePrice && <label>
                                                Nuevo precio de venta (opcional)
                                                <input className={field} inputMode="decimal" value={item.salePrice || ''}
                                                    aria-label={`Nuevo precio de venta (opcional) de ${item.productName}${suffix}`}
                                                    onChange={e => p.onUpdate(item.cartKey, 'salePrice', normalizeBodegaDecimalInput(e.target.value))} />
                                                <small>Siempre por {item.unit} base, aunque comprés por empaque.</small>
                                                {p.cart.filter(row => row.productId === item.productId).length > 1 && <small>Se sincroniza en todas las líneas de este producto.</small>}
                                            </label>}
                                            {p.hasPack(item) && (
                                                <label className="receiving-pack-label">
                                                    Presentación de compra
                                                    <select
                                                        className={field}
                                                        value={item.purchaseUnit}
                                                        disabled={Boolean(doc.purchaseOrderId)}
                                                        aria-label={`Unidad de compra de ${item.productName}`}
                                                        onChange={(e) =>
                                                            p.onPurchaseUnit(
                                                                item.cartKey,
                                                                e.target.value as PurchaseUnit,
                                                            )
                                                        }
                                                    >
                                                        <option value="BASE">{item.unit}</option>
                                                        <option value="PACK">
                                                            {item.packUnit} de {formatQuantityValue(item.packSize!)}{' '}
                                                            {item.unit}
                                                        </option>
                                                    </select>
                                                </label>
                                            )}
                                            {item.requiresBatchTracking && (
                                                <div className="receiving-line-fields receiving-batch-fields">
                                                    <label>
                                                        Lote *
                                                        <input
                                                            className={field}
                                                            placeholder="Nº Lote"
                                                            aria-label={`Lote de ${item.productName}${suffix}`}
                                                            value={item.batchNumber || ''}
                                                            required
                                                            onChange={(e) =>
                                                                p.onUpdate(item.cartKey, 'batchNumber', e.target.value)
                                                            }
                                                            aria-invalid={Boolean(p.errors.items) && !item.batchNumber}
                                                        />
                                                    </label>
                                                    <label>
                                                        Vencimiento del lote *
                                                        <input
                                                            className={field}
                                                            type="date"
                                                            aria-label={`Vencimiento del lote de ${item.productName}${suffix}`}
                                                            value={item.expiryDate || ''}
                                                            required
                                                            onChange={(e) =>
                                                                p.onUpdate(item.cartKey, 'expiryDate', e.target.value)
                                                            }
                                                            aria-invalid={Boolean(p.errors.items) && !item.expiryDate}
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                            <p className="receiving-line-total">
                                                Importe{' '}
                                                <strong>
                                                    {preview ? formatMoney(item.totalCost) : 'Revisá cantidad y costo'}
                                                </strong>
                                            </p>
                                        </article>
                                    );
                                })}
                            </div>
                            {p.cart.length > 0 && (
                                <p className="receiving-muted receiving-decimal-hint">{BODEGA_DECIMAL_HINT}</p>
                            )}
                        </section>

                        <section className="receiving-document" aria-labelledby="receiving-document-title">
                            <h3 id="receiving-document-title">Documento y proveedor</h3>
                            <label htmlFor="purchase-supplier">Proveedor *</label>
                            <select
                                id="purchase-supplier"
                                className={field}
                                value={doc.supplierId}
                                onChange={(e) => p.onDocumentChange({ supplierId: e.target.value })}
                                aria-invalid={Boolean(p.errors.supplierId)}
                            >
                                <option value="">
                                    {p.loading ? 'Cargando proveedores…' : 'Seleccionar proveedor…'}
                                </option>
                                {p.suppliers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                            {!p.loading && p.suppliers.length === 0 && (
                                <p className="receiving-error">
                                    Necesitás un proveedor. <a href="/app/suppliers">Crear proveedor</a>
                                </p>
                            )}
                            {!doc.purchaseOrderId && (
                                <>
                                    <label htmlFor="purchase-warehouse">Bodega de destino *</label>
                                    <select
                                        id="purchase-warehouse"
                                        className={field}
                                        value={doc.warehouseId}
                                        required
                                        onChange={(e) => p.onDocumentChange({ warehouseId: e.target.value })}
                                        aria-invalid={Boolean(p.errors.warehouseId)}
                                    >
                                        <option value="">
                                            {p.loading ? 'Cargando bodegas…' : 'Seleccionar bodega destino…'}
                                        </option>
                                        {p.warehouses.map((w) => (
                                            <option key={w.id} value={w.id}>
                                                {w.name}
                                                {w.isDefault ? ' · Principal' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="receiving-muted">Lo recibido ingresará en esta ubicación.</p>
                                    {!p.loading && p.warehouses.length === 0 && (
                                        <p role="alert" className="receiving-error">
                                            No hay una bodega activa disponible.
                                        </p>
                                    )}
                                </>
                            )}
                            {p.orders.length > 0 && (
                                <>
                                    <label htmlFor="purchase-order-link">Orden de compra (opcional)</label>
                                    <select
                                        id="purchase-order-link"
                                        className={field}
                                        value={doc.purchaseOrderId}
                                        onChange={(e) => p.onDocumentChange({ purchaseOrderId: e.target.value })}
                                    >
                                        <option value="">Compra directa, sin OC</option>
                                        {p.orders.map((order) => (
                                            <option key={order.id} value={order.id}>
                                                {order.orderNumber} · Recibida pendiente de facturar
                                            </option>
                                        ))}
                                    </select>
                                </>
                            )}
                            <div className="receiving-document-fields">
                                <label htmlFor="purchase-invoice-number">
                                    # Factura Proveedor *
                                    <input
                                        id="purchase-invoice-number"
                                        className={field}
                                        value={doc.invoiceNumber}
                                        placeholder="FAC-001234"
                                        aria-invalid={Boolean(p.errors.invoiceNumber)}
                                        onChange={(e) => p.onDocumentChange({ invoiceNumber: e.target.value })}
                                    />
                                </label>
                                <label htmlFor="purchase-invoice-date">
                                    Fecha de la factura *
                                    <input
                                        id="purchase-invoice-date"
                                        type="date"
                                        className={field}
                                        required
                                        value={doc.date}
                                        aria-invalid={Boolean(p.errors.date)}
                                        aria-describedby={p.errors.date ? 'purchase-invoice-date-error' : undefined}
                                        onChange={(e) => p.onDocumentChange({ date: e.target.value })}
                                    />
                                    {p.errors.date && (
                                        <span id="purchase-invoice-date-error" className="receiving-field-error">
                                            {p.errors.date}
                                        </span>
                                    )}
                                </label>
                            </div>
                            <p className="receiving-payment-label">IVA de la factura *</p>
                            <div className="receiving-payment-options">
                                <button type="button" className="nx-fluid-press" aria-pressed={doc.taxTreatment !== PURCHASE_TAX_SIN_TRASLADO}
                                    onClick={() => p.onDocumentChange({ taxTreatment: PURCHASE_TAX_TRASLADADO })}>Trae IVA (15%)</button>
                                <button type="button" className="nx-fluid-press" aria-pressed={doc.taxTreatment === PURCHASE_TAX_SIN_TRASLADO}
                                    onClick={() => p.onDocumentChange({ taxTreatment: PURCHASE_TAX_SIN_TRASLADO })}>No trae IVA</button>
                            </div>
                            {doc.taxTreatment === PURCHASE_TAX_SIN_TRASLADO && <>
                                <label htmlFor="purchase-no-tax-reason">¿Por qué no trae IVA? *</label>
                                <select id="purchase-no-tax-reason" className={field} value={doc.noTaxReason || ''}
                                    aria-invalid={Boolean(p.errors.noTaxReason)}
                                    onChange={e => p.onDocumentChange({ noTaxReason: e.target.value as PurchaseNoTaxReason | '' })}>
                                    <option value="">Seleccionar motivo…</option>
                                    {PURCHASE_NO_TAX_REASONS.map(reason => <option key={reason} value={reason}>{PURCHASE_NO_TAX_REASON_LABELS[reason]}</option>)}
                                </select>
                            </>}
                            <p className="receiving-payment-label">¿Cómo queda el pago?</p>
                            <div className="receiving-payment-options">
                                <button
                                    type="button"
                                    className="nx-fluid-press"
                                    aria-pressed={doc.paymentMethod === 'CASH'}
                                    onClick={() => p.onDocumentChange({ paymentMethod: 'CASH' })}
                                >
                                    Contado
                                </button>
                                <button
                                    type="button"
                                    className="nx-fluid-press"
                                    aria-pressed={doc.paymentMethod === 'CREDIT'}
                                    onClick={() => p.onDocumentChange({ paymentMethod: 'CREDIT' })}
                                >
                                    <CreditCard size={16} /> Credito
                                </button>
                            </div>
                            {doc.paymentMethod === 'CREDIT' ? (
                                <>
                                    <label htmlFor="purchase-due-date">Fecha de vencimiento *</label>
                                    <input
                                        id="purchase-due-date"
                                        className={field}
                                        type="date"
                                        required
                                        value={doc.dueDate}
                                        aria-invalid={Boolean(p.errors.dueDate)}
                                        onChange={(e) => p.onDocumentChange({ dueDate: e.target.value })}
                                    />
                                    <p className="receiving-muted">Quedará pendiente de pago al proveedor.</p>
                                </>
                            ) : (
                                <p className="receiving-muted">Pago de contado · Se descuenta de tu caja abierta</p>
                            )}
                            <details className="receiving-options">
                                <summary>
                                    <span>Notas (opcional)</span>
                                    <ChevronDown size={16} />
                                </summary>
                                <label htmlFor="purchase-notes">Notas (opcional)</label>
                                <input
                                    id="purchase-notes"
                                    className={field}
                                    value={doc.notes}
                                    maxLength={500}
                                    placeholder="Ej: Pedido semanal, entrega parcial..."
                                    aria-invalid={Boolean(p.errors.notes)}
                                    onChange={(e) => p.onDocumentChange({ notes: e.target.value })}
                                />
                            </details>
                        </section>
                    </div>
                </div>

                <footer className="receiving-footer">
                    <div>
                        <p className="receiving-summary-meta">
                            <span>Subtotal</span> {formatMoney(p.totals.subtotal)}
                        </p>
                        <details><summary>Ver desglose</summary>
                            <p><span>Base gravada</span> {formatMoney(p.totals.taxableSubtotal)}</p>
                            <p><span>Productos exentos</span> {formatMoney(new Decimal(p.totals.subtotal).minus(p.totals.taxableSubtotal).toString())}</p>
                            <p><span>{doc.taxTreatment === PURCHASE_TAX_SIN_TRASLADO ? 'IVA (no trasladado)' : 'IVA (15%)'}</span> {formatMoney(p.totals.tax)}</p>
                        </details>
                        <p className="receiving-total">
                            <span>TOTAL</span>
                            <strong>{formatMoney(p.totals.total)}</strong>
                        </p>
                        <p className="receiving-muted">
                            {p.draftSaved && p.cart.length
                                ? 'Borrador conservado en esta pestaña.'
                                : 'Los datos se guardan al confirmar.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="nx-fluid-press receiving-submit"
                        disabled={!p.canSubmit || p.submitting}
                        aria-busy={p.submitting}
                        onClick={p.onSubmit}
                    >
                        <Truck size={20} />
                        {p.submitting
                            ? 'Procesando...'
                            : doc.purchaseOrderId
                              ? 'Registrar factura'
                              : 'Procesar ingreso'}
                    </button>
                </footer>
            </div>
        </fieldset>
    );
}
