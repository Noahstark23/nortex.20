import {
    Archive,
    ArrowDownToLine,
    ArrowLeft,
    ArrowRight,
    ArrowUpFromLine,
    Banknote,
    BriefcaseBusiness,
    Check,
    CheckCircle2,
    CircleDollarSign,
    CreditCard,
    FileText,
    Landmark,
    Loader2,
    LockKeyhole,
    MessageCircle,
    Minus,
    PackageSearch,
    PauseCircle,
    PieChart,
    Plus,
    Printer,
    ReceiptText,
    ScanLine,
    Search,
    ShoppingCart,
    Trash2,
    UserRound,
    WalletCards,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import type Decimal from 'decimal.js';
import { formatMoney } from '../../utils/money';
import { suggestNioCashAmounts, validateCashReceived } from '../../utils/posCash';

export type POSGuidedPaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'CREDIT';
export type POSGuidedReceiptFormat = 'TICKET_80MM' | 'A4';

export interface POSGuidedHeader {
    businessName: string;
    registerName: string;
    cashierName: string;
    shiftLabel: string;
    connection: 'ONLINE' | 'OFFLINE' | 'SYNCING';
    connectionLabel?: string;
    dateTimeLabel?: string;
}

/**
 * Una línea ya preparada por el controlador del POS.
 *
 * Este shell no decide presentaciones, pasos de cantidad ni reglas de precio:
 * únicamente muestra las etiquetas autoritativas que recibe.
 */
export interface POSGuidedCartLineView {
    key: string;
    name: string;
    sku?: string;
    quantityLabel: string;
    unitPriceLabel: string;
    subtotalLabel: string;
    editable: boolean;
    warning?: string;
    tierLabel?: string;
}

export interface POSGuidedCustomerView {
    id: string;
    name: string;
    documentLabel?: string;
    fiscalLabel?: string;
    badgeLabel?: string;
    note?: string;
}

export interface POSGuidedCustomerOption {
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

/** Snapshot inmutable de la venta terminada; nunca se reconstruye desde el carrito actual. */
export interface POSGuidedSaleSnapshot {
    saleKey: string;
    receiptNumber: string;
    receiptFormat: POSGuidedReceiptFormat;
    completedAtLabel: string;
    customerName?: string;
    paymentMethodLabel: string;
    lineCountLabel: string;
    subtotal: Decimal.Value;
    discount: Decimal.Value;
    total: Decimal.Value;
    cashReceived?: Decimal.Value;
    change?: Decimal.Value;
}

export interface POSGuidedShellProps {
    header: POSGuidedHeader;

    /** La etapa es controlada: comprobante > cobro > productos. */
    checkoutOpen: boolean;
    completedSale: POSGuidedSaleSnapshot | null;

    searchTerm: string;
    onSearchTermChange: (value: string) => void;
    onSearchSubmit: (value: string) => void;
    onOpenScanner?: () => void;
    catalog: ReactNode;

    selectedCustomer: POSGuidedCustomerView | null;
    customerOptions: readonly POSGuidedCustomerOption[];
    onCustomerSelect: (customerId: string | null) => void;

    cartLines: readonly POSGuidedCartLineView[];
    cartCountLabel: string;
    subtotal: Decimal.Value;
    discount: Decimal.Value;
    total: Decimal.Value;
    onIncrementLine: (lineKey: string) => void;
    onDecrementLine: (lineKey: string) => void;
    onRemoveLine: (lineKey: string) => void;
    onEditLine?: (lineKey: string) => void;
    onOpenCheckout: () => void;
    onBackToProducts: () => void;
    onParkSale: () => void;

    paymentMethod: POSGuidedPaymentMethod;
    onPaymentMethodChange: (method: POSGuidedPaymentMethod) => void;
    /** Una razón presente deshabilita ese método; la regla la decide el padre. */
    paymentUnavailableReasons?: Partial<Record<POSGuidedPaymentMethod, string>>;
    cashReceived: string;
    onCashReceivedChange: (value: string) => void;
    receiptFormat: POSGuidedReceiptFormat;
    onReceiptFormatChange: (format: POSGuidedReceiptFormat) => void;
    onCheckout: (method: POSGuidedPaymentMethod) => void;
    checkoutDisabled?: boolean;
    checkoutDisabledReason?: string;
    checkoutError?: string;
    processing?: boolean;

    onCashIn: () => void;
    onCashOut: () => void;
    onBankingAgent: () => void;
    onOpenParkedSales: () => void;
    onCloseRegister: () => void;
    onCancelSale: () => void;

    onPrintTicket: (snapshot: POSGuidedSaleSnapshot) => void;
    onPrintThermal: (snapshot: POSGuidedSaleSnapshot) => void;
    onPrintA4: (snapshot: POSGuidedSaleSnapshot) => void;
    onShareWhatsApp: (snapshot: POSGuidedSaleSnapshot) => void;
    onNewSale: () => void;
}

type GuidedStage = 'PRODUCTS' | 'CHECKOUT' | 'RECEIPT';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950';
const secondaryButton = `min-h-tap rounded-control border border-white/[0.10] px-4 font-semibold text-slate-200 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;
const primaryButton = `min-h-tap rounded-control bg-brand px-5 font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;
const iconButton = `inline-flex h-touch w-touch shrink-0 items-center justify-center rounded-control border border-white/[0.10] text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;

const PAYMENT_METHODS: ReadonlyArray<{
    method: POSGuidedPaymentMethod;
    label: string;
    detail: string;
    icon: typeof Banknote;
}> = [
    { method: 'CASH', label: 'Efectivo', detail: 'Calculá el cambio', icon: Banknote },
    { method: 'CARD', label: 'Tarjeta', detail: 'Pago en datáfono', icon: CreditCard },
    { method: 'TRANSFER', label: 'Transferencia', detail: 'Confirmación bancaria', icon: Landmark },
    { method: 'CREDIT', label: 'Crédito / Fiado', detail: 'Cuenta del cliente', icon: CircleDollarSign },
];

const DEFAULT_CONNECTION_LABEL: Record<POSGuidedHeader['connection'], string> = {
    ONLINE: 'En línea',
    OFFLINE: 'Sin conexión',
    SYNCING: 'Sincronizando',
};

const stageNumber: Record<GuidedStage, number> = {
    PRODUCTS: 1,
    CHECKOUT: 2,
    RECEIPT: 3,
};

const StageProgress = ({ stage }: { stage: GuidedStage }) => {
    const current = stageNumber[stage];
    const steps = ['Productos', 'Cobro', 'Comprobante'] as const;

    return (
        <nav aria-label="Progreso de la venta" className="border-b border-white/[0.08] bg-surface-950 px-4 sm:px-6">
            <ol className="mx-auto grid max-w-screen-2xl grid-cols-3">
                {steps.map((label, index) => {
                    const number = index + 1;
                    const complete = number < current;
                    const active = number === current;
                    return (
                        <li
                            key={label}
                            aria-current={active ? 'step' : undefined}
                            className={`relative flex min-h-[68px] items-center gap-3 border-b-2 px-1 sm:px-3 ${active
                                ? 'border-brand text-slate-50'
                                : 'border-transparent text-slate-400'}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${complete
                                    ? 'border-brand bg-brand-soft text-brand'
                                    : active
                                        ? 'border-brand bg-brand text-brand-on'
                                        : 'border-white/[0.10] bg-surface-800 text-slate-400'}`}
                            >
                                {complete ? <Check size={18} /> : number}
                            </span>
                            <span className="hidden text-sm font-semibold sm:inline">{label}</span>
                            {index < steps.length - 1 && (
                                <span aria-hidden="true" className="absolute right-3 hidden h-px w-10 bg-white/[0.08] lg:block" />
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

const POSHeader = ({ header }: { header: POSGuidedHeader }) => {
    const online = header.connection === 'ONLINE';
    const ConnectionIcon = online ? Wifi : WifiOff;
    const connectionLabel = header.connectionLabel ?? DEFAULT_CONNECTION_LABEL[header.connection];

    return (
        <header className="border-b border-white/[0.08] bg-surface-950 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-3">
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-4">
                        <span className="text-2xl font-black tracking-tight text-slate-50">nortex<span className="text-brand">.</span></span>
                        <span aria-hidden="true" className="hidden h-8 w-px bg-white/[0.10] sm:block" />
                        <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-400">{header.businessName}</p>
                            <h1 className="truncate text-base font-bold text-slate-50">Punto de venta · {header.registerName}</h1>
                        </div>
                    </div>
                </div>

                <dl className="hidden items-center gap-6 text-sm sm:flex">
                    <div className="flex items-center gap-2">
                        <UserRound size={18} className="text-slate-400" aria-hidden="true" />
                        <div>
                            <dt className="text-xs text-slate-500">Cajero</dt>
                            <dd className="font-semibold text-slate-200">{header.cashierName}</dd>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <BriefcaseBusiness size={18} className="text-slate-400" aria-hidden="true" />
                        <div>
                            <dt className="text-xs text-slate-500">Turno</dt>
                            <dd className="font-semibold text-slate-200">{header.shiftLabel}</dd>
                        </div>
                    </div>
                </dl>

                <div className="flex items-center gap-3 text-sm">
                    <span className={`inline-flex min-h-compact items-center gap-2 rounded-pill border px-3 font-semibold ${online
                        ? 'border-brand/20 bg-brand-soft text-brand'
                        : header.connection === 'SYNCING'
                            ? 'border-warning/20 bg-warning-soft text-warning'
                            : 'border-danger/20 bg-danger-soft text-danger'}`}
                    >
                        <ConnectionIcon size={16} aria-hidden="true" />
                        {connectionLabel}
                    </span>
                    {header.dateTimeLabel && (
                        <span className="hidden whitespace-pre-line border-l border-white/[0.10] pl-3 text-xs font-semibold leading-5 text-slate-300 sm:block">
                            {header.dateTimeLabel}
                        </span>
                    )}
                </div>
            </div>
        </header>
    );
};

const CustomerSelector = ({
    selectedCustomer,
    customerOptions,
    onCustomerSelect,
    disabled,
}: Pick<POSGuidedShellProps, 'selectedCustomer' | 'customerOptions' | 'onCustomerSelect'> & { disabled: boolean }) => {
    const selectId = useId();

    return (
        <section aria-labelledby={`${selectId}-title`} className="border-b border-white/[0.08] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h3 id={`${selectId}-title`} className="text-xs font-bold uppercase tracking-wider text-slate-400">Cliente</h3>
                {selectedCustomer?.badgeLabel && (
                    <span className="rounded-pill border border-brand/20 bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand">
                        {selectedCustomer.badgeLabel}
                    </span>
                )}
            </div>
            <label htmlFor={selectId} className="sr-only">Cliente de la venta</label>
            <select
                id={selectId}
                value={selectedCustomer?.id ?? ''}
                disabled={disabled}
                onChange={(event) => onCustomerSelect(event.target.value || null)}
                className={`h-touch w-full rounded-control border border-white/[0.10] bg-surface-950 px-3 text-sm font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
                <option value="">Cliente general</option>
                {customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id} disabled={customer.disabled}>
                        {customer.label}{customer.description ? ` · ${customer.description}` : ''}
                    </option>
                ))}
            </select>
            {selectedCustomer && (
                <div className="mt-3 flex items-start gap-3">
                    <span className="flex h-touch w-touch shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-surface-800 text-slate-300">
                        <UserRound size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-100">{selectedCustomer.name}</p>
                        {selectedCustomer.documentLabel && <p className="mt-0.5 text-xs text-slate-400">{selectedCustomer.documentLabel}</p>}
                        {selectedCustomer.fiscalLabel && <p className="mt-0.5 text-xs text-slate-400">{selectedCustomer.fiscalLabel}</p>}
                        {selectedCustomer.note && <p className="mt-2 text-xs text-warning">{selectedCustomer.note}</p>}
                    </div>
                </div>
            )}
        </section>
    );
};

const CartLines = ({
    cartLines,
    disabled,
    onIncrementLine,
    onDecrementLine,
    onRemoveLine,
    onEditLine,
}: Pick<POSGuidedShellProps, 'cartLines' | 'onIncrementLine' | 'onDecrementLine' | 'onRemoveLine' | 'onEditLine'> & { disabled: boolean }) => (
    <div className="min-h-0 flex-1 overflow-y-auto">
        {cartLines.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-slate-500">
                    <ShoppingCart size={24} aria-hidden="true" />
                </span>
                <p className="mt-4 font-semibold text-slate-200">La venta está vacía</p>
                <p className="mt-1 max-w-xs text-sm text-slate-500">Buscá o escaneá un producto para comenzar.</p>
            </div>
        ) : (
            <ul aria-label="Productos en la venta" className="divide-y divide-white/[0.08]">
                {cartLines.map((line) => (
                    <li key={line.key} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-slate-100">{line.name}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                    {line.sku && <span className="nx-sku">{line.sku}</span>}
                                    {line.tierLabel && (
                                        <span className="rounded-pill border border-brand/20 bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                                            {line.tierLabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <strong className="nx-num shrink-0 text-sm text-slate-100">{line.subtotalLabel}</strong>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div role="group" className="flex items-center gap-2" aria-label={`Cantidad de ${line.name}: ${line.quantityLabel}`}>
                                <button
                                    type="button"
                                    onClick={() => onDecrementLine(line.key)}
                                    disabled={disabled || !line.editable}
                                    className={iconButton}
                                    aria-label={`Reducir ${line.name}`}
                                >
                                    <Minus size={16} aria-hidden="true" />
                                </button>
                                <span className="nx-num min-w-12 text-center text-sm font-bold text-slate-100">{line.quantityLabel}</span>
                                <button
                                    type="button"
                                    onClick={() => onIncrementLine(line.key)}
                                    disabled={disabled || !line.editable}
                                    className={iconButton}
                                    aria-label={`Aumentar ${line.name}`}
                                >
                                    <Plus size={16} aria-hidden="true" />
                                </button>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="mr-2 text-xs text-slate-400">{line.unitPriceLabel} c/u</span>
                                {line.editable && onEditLine && (
                                    <button
                                        type="button"
                                        onClick={() => onEditLine(line.key)}
                                        disabled={disabled}
                                        className={iconButton}
                                        aria-label={`Editar ${line.name}`}
                                    >
                                        <FileText size={16} aria-hidden="true" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onRemoveLine(line.key)}
                                    disabled={disabled || !line.editable}
                                    className={`${iconButton} hover:border-danger/30 hover:bg-danger-soft hover:text-danger`}
                                    aria-label={`Quitar ${line.name}`}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        {line.warning && (
                            <p className="mt-2 rounded-control border border-warning/20 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                                {line.warning}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        )}
    </div>
);

const Totals = ({
    subtotal,
    discount,
    total,
}: Pick<POSGuidedShellProps, 'subtotal' | 'discount' | 'total'>) => (
    <dl className="space-y-2 border-t border-white/[0.08] p-4">
        <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
            <dt>Subtotal</dt>
            <dd className="nx-num font-semibold text-slate-200">{formatMoney(subtotal)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
            <dt>Descuento</dt>
            <dd className="nx-num font-semibold text-slate-200">{formatMoney(discount)}</dd>
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-white/[0.08] pt-3">
            <dt className="font-semibold text-slate-200">Total a cobrar</dt>
            <dd className="nx-num text-2xl font-bold text-slate-50">{formatMoney(total)}</dd>
        </div>
    </dl>
);

const CartPanel = ({
    checkoutMode,
    props,
}: {
    checkoutMode: boolean;
    props: POSGuidedShellProps;
}) => {
    const disabled = Boolean(props.processing);
    return (
        <section aria-labelledby="guided-current-sale" className="flex min-h-0 flex-col overflow-hidden rounded-card border border-white/[0.10] bg-surface-900">
            <div className="flex min-h-touch items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                <div className="min-w-0">
                    <h2 id="guided-current-sale" className="truncate font-bold text-slate-100">Venta actual</h2>
                    <p className="text-xs text-slate-500">{props.cartCountLabel}</p>
                </div>
                {checkoutMode && (
                    <button type="button" onClick={props.onBackToProducts} disabled={disabled} className={secondaryButton}>
                        <span className="inline-flex items-center gap-2">
                            <ArrowLeft size={17} aria-hidden="true" /> Editar venta
                        </span>
                    </button>
                )}
            </div>
            <CustomerSelector
                selectedCustomer={props.selectedCustomer}
                customerOptions={props.customerOptions}
                onCustomerSelect={props.onCustomerSelect}
                disabled={disabled}
            />
            <CartLines
                cartLines={props.cartLines}
                onIncrementLine={props.onIncrementLine}
                onDecrementLine={props.onDecrementLine}
                onRemoveLine={props.onRemoveLine}
                onEditLine={props.onEditLine}
                disabled={disabled}
            />
            <Totals subtotal={props.subtotal} discount={props.discount} total={props.total} />
            {!checkoutMode && (
                <div className="space-y-2 border-t border-white/[0.08] p-4">
                    <button
                        type="button"
                        onClick={props.onOpenCheckout}
                        disabled={disabled || props.checkoutDisabled || props.cartLines.length === 0}
                        aria-describedby={props.checkoutDisabledReason ? 'guided-checkout-disabled' : undefined}
                        className={`${primaryButton} flex w-full items-center justify-center gap-2`}
                    >
                        Ir a cobro <ArrowRight size={18} aria-hidden="true" />
                    </button>
                    {props.checkoutDisabledReason && (
                        <p id="guided-checkout-disabled" className="text-center text-xs text-warning">{props.checkoutDisabledReason}</p>
                    )}
                    <button
                        type="button"
                        onClick={props.onParkSale}
                        disabled={disabled || props.cartLines.length === 0}
                        className={`${secondaryButton} flex w-full items-center justify-center gap-2`}
                    >
                        <PauseCircle size={17} aria-hidden="true" /> Aparcar venta
                    </button>
                </div>
            )}
        </section>
    );
};

const CashPanel = ({ props }: { props: POSGuidedShellProps }) => {
    const inputId = useId();
    const statusId = `${inputId}-status`;
    const inputRef = useRef<HTMLInputElement>(null);
    const validation = useMemo(
        () => validateCashReceived(props.cashReceived, props.total),
        [props.cashReceived, props.total],
    );
    const suggestions = useMemo(
        () => suggestNioCashAmounts(props.total, 6),
        [props.total],
    );

    useEffect(() => {
        if (props.checkoutOpen && props.paymentMethod === 'CASH' && !props.completedSale) {
            inputRef.current?.focus();
        }
    }, [props.checkoutOpen, props.completedSale, props.paymentMethod]);

    const successfulPayment = validation.ok === true ? validation : null;
    const paymentError = validation.ok === false ? validation : null;
    const exactSelected = successfulPayment?.received.equals(successfulPayment.total) ?? false;
    const cashReady = validation.ok;

    return (
        <section aria-labelledby={`${inputId}-title`} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
            <div>
                <label id={`${inputId}-title`} htmlFor={inputId} className="text-sm font-bold text-slate-200">
                    Recibido en efectivo
                </label>
                <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={props.cashReceived}
                    onChange={(event) => props.onCashReceivedChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (
                            event.key === 'Enter'
                            && props.cartLines.length > 0
                            && cashReady
                            && !props.processing
                            && !props.checkoutDisabled
                        ) {
                            props.onCheckout('CASH');
                        }
                    }}
                    disabled={props.processing}
                    aria-invalid={props.cashReceived !== '' && !cashReady}
                    aria-describedby={statusId}
                    className={`mt-2 h-16 w-full rounded-control border border-white/[0.14] bg-surface-950 px-4 text-3xl font-bold tabular-nums text-slate-50 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
                    placeholder="0.00"
                />
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Montos comunes">
                    <button
                        type="button"
                        onClick={() => props.onCashReceivedChange(String(props.total))}
                        disabled={props.processing}
                        aria-pressed={exactSelected}
                        className={`${secondaryButton} ${exactSelected ? 'border-brand bg-brand-soft text-brand' : ''}`}
                    >
                        Monto exacto
                    </button>
                    {suggestions.map((amount) => {
                        const selected = successfulPayment?.received.equals(amount) ?? false;
                        return (
                            <button
                                key={amount.toString()}
                                type="button"
                                onClick={() => props.onCashReceivedChange(amount.toFixed(2))}
                                disabled={props.processing}
                                aria-pressed={selected}
                                className={`${secondaryButton} ${selected ? 'border-brand bg-brand-soft text-brand' : ''}`}
                            >
                                {formatMoney(amount, 'NIO', { decimals: 0 })}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div
                id={statusId}
                aria-live="polite"
                aria-atomic="true"
                className={`flex min-h-[148px] flex-col justify-center rounded-card border px-5 py-4 ${cashReady
                    ? 'border-brand/25 bg-brand-soft'
                    : props.cashReceived
                        ? 'border-warning/25 bg-warning-soft'
                        : 'border-white/[0.08] bg-surface-950'}`}
            >
                {cashReady ? (
                    successfulPayment.change.isZero() ? (
                        <>
                            <p className="text-xs font-bold uppercase tracking-wider text-brand">Monto exacto</p>
                            <strong className="mt-2 text-xl text-slate-50">No hay vuelto</strong>
                        </>
                    ) : (
                        <>
                            <p className="text-xs font-bold uppercase tracking-wider text-brand">Cambio</p>
                            <strong className="nx-num mt-2 text-3xl font-bold text-slate-50">{formatMoney(successfulPayment.change)}</strong>
                            <p className="mt-2 text-xs text-slate-400">Entregale este monto al cliente.</p>
                        </>
                    )
                ) : (
                    <>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cambio</p>
                        <strong className="mt-2 text-base text-slate-200">
                            {props.cashReceived === '' ? 'Ingresá el monto recibido' : paymentError.message}
                        </strong>
                        {paymentError.shortfall && (
                            <span className="nx-num mt-2 text-lg font-bold text-warning">Falta {formatMoney(paymentError.shortfall)}</span>
                        )}
                    </>
                )}
            </div>
        </section>
    );
};

const CheckoutPanel = ({ props }: { props: POSGuidedShellProps }) => {
    const selectedUnavailableReason = props.paymentUnavailableReasons?.[props.paymentMethod];
    const cashValidation = validateCashReceived(props.cashReceived, props.total);
    const emptyCart = props.cartLines.length === 0;
    const confirmDisabledReason = props.checkoutDisabledReason
        ?? (emptyCart ? 'Agregá al menos un producto antes de cobrar.' : undefined);
    const confirmDisabled = Boolean(
        props.processing
        || props.checkoutDisabled
        || emptyCart
        || selectedUnavailableReason
        || props.paymentMethod === 'CASH' && !cashValidation.ok,
    );

    return (
        <section aria-labelledby="guided-checkout-title" className="overflow-hidden rounded-card border border-white/[0.10] bg-surface-900">
            <div className="border-b border-white/[0.08] p-5 sm:p-6">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Paso 2 de 3</p>
                <h2 id="guided-checkout-title" className="mt-1 text-xl font-bold text-slate-50">Método de cobro</h2>
                <p className="mt-1 text-sm text-slate-400">Elegí cómo paga el cliente y revisá todo antes de confirmar.</p>
            </div>

            <div className="p-5 sm:p-6">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Método de pago">
                    {PAYMENT_METHODS.map(({ method, label, detail, icon: Icon }) => {
                        const selected = props.paymentMethod === method;
                        const unavailableReason = props.paymentUnavailableReasons?.[method];
                        const descriptionId = `guided-method-${method.toLowerCase()}-description`;
                        return (
                            <button
                                key={method}
                                type="button"
                                onClick={() => props.onPaymentMethodChange(method)}
                                disabled={Boolean(props.processing || unavailableReason)}
                                aria-pressed={selected}
                                aria-describedby={descriptionId}
                                className={`min-h-[112px] rounded-control border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${focusRing} ${selected
                                    ? 'border-brand bg-brand-soft text-slate-50'
                                    : 'border-white/[0.10] bg-surface-950 text-slate-300 hover:bg-surface-800'}`}
                            >
                                <Icon size={22} className={selected ? 'text-brand' : 'text-slate-400'} aria-hidden="true" />
                                <span className="mt-3 block font-bold">{label}</span>
                                <span id={descriptionId} className={`mt-1 block text-xs ${unavailableReason ? 'text-warning' : 'text-slate-500'}`}>
                                    {unavailableReason ?? detail}
                                </span>
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        disabled
                        aria-describedby="guided-mixed-description"
                        className={`min-h-[112px] rounded-control border border-white/[0.08] bg-surface-950 p-3 text-left text-slate-500 opacity-60 ${focusRing}`}
                    >
                        <PieChart size={22} aria-hidden="true" />
                        <span className="mt-3 block font-bold">Mixto</span>
                        <span id="guided-mixed-description" className="mt-1 block text-xs">Próximamente; todavía no registra pagos divididos.</span>
                    </button>
                </div>

                <div className="mt-6 grid gap-5 border-t border-white/[0.08] pt-6 lg:grid-cols-[minmax(180px,0.38fr)_minmax(0,1fr)]">
                    <div className="border-b border-white/[0.08] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
                        <p className="text-sm font-semibold text-slate-400">Total a cobrar</p>
                        <p className="nx-total mt-3">{formatMoney(props.total)}</p>
                    </div>
                    <div>
                        {props.paymentMethod === 'CASH' ? (
                            <CashPanel props={props} />
                        ) : (
                            <div className="flex min-h-[148px] items-center rounded-card border border-white/[0.08] bg-surface-950 px-5 py-4">
                                <div>
                                    <p className="font-semibold text-slate-100">{PAYMENT_METHODS.find((item) => item.method === props.paymentMethod)?.label}</p>
                                    <p className="mt-1 text-sm text-slate-400">
                                        {selectedUnavailableReason ?? 'La venta se registrará con este método cuando confirmés el cobro.'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/[0.08] pt-5 sm:flex-row">
                    <button
                        type="button"
                        onClick={props.onParkSale}
                        disabled={props.processing}
                        className={`${secondaryButton} flex items-center justify-center gap-2 sm:min-w-48`}
                    >
                        <PauseCircle size={18} aria-hidden="true" /> Aparcar venta
                    </button>
                    <button
                        type="button"
                        onClick={() => props.onCheckout(props.paymentMethod)}
                        disabled={confirmDisabled}
                        aria-describedby={confirmDisabledReason ? 'guided-confirm-disabled' : undefined}
                        className={`${primaryButton} flex flex-1 items-center justify-center gap-2 text-base`}
                    >
                        {props.processing ? <Loader2 size={19} className="motion-safe:animate-spin" aria-hidden="true" /> : <CheckCircle2 size={19} aria-hidden="true" />}
                        {props.processing ? 'Registrando cobro…' : 'Confirmar cobro'}
                    </button>
                </div>
                {confirmDisabledReason && (
                    <p id="guided-confirm-disabled" className="mt-2 text-right text-xs text-warning">{confirmDisabledReason}</p>
                )}
                {props.checkoutError && (
                    <p role="alert" className="mt-3 rounded-control border border-danger/25 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
                        {props.checkoutError}
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-3 border-t border-white/[0.08] bg-surface-950/60 p-4 sm:flex-row sm:items-center sm:justify-end">
                <span className="text-xs font-semibold text-slate-400">Comprobante preparado</span>
                <div className="flex gap-2" role="group" aria-label="Formato de comprobante">
                    <button
                        type="button"
                        onClick={() => props.onReceiptFormatChange('TICKET_80MM')}
                        disabled={props.processing}
                        aria-pressed={props.receiptFormat === 'TICKET_80MM'}
                        className={`${secondaryButton} flex flex-1 items-center justify-center gap-2 ${props.receiptFormat === 'TICKET_80MM' ? 'border-brand bg-brand-soft text-brand' : ''}`}
                    >
                        <ReceiptText size={17} aria-hidden="true" /> Ticket 80 mm
                    </button>
                    <button
                        type="button"
                        onClick={() => props.onReceiptFormatChange('A4')}
                        disabled={props.processing}
                        aria-pressed={props.receiptFormat === 'A4'}
                        className={`${secondaryButton} flex flex-1 items-center justify-center gap-2 ${props.receiptFormat === 'A4' ? 'border-brand bg-brand-soft text-brand' : ''}`}
                    >
                        <FileText size={17} aria-hidden="true" /> Factura A4
                    </button>
                </div>
                <span className="text-xs text-slate-500">Podrás imprimir después de completar la venta.</span>
            </div>
        </section>
    );
};

const CashOperations = ({ props }: { props: POSGuidedShellProps }) => {
    const operations = [
        { label: 'Entrada de efectivo', icon: ArrowDownToLine, action: props.onCashIn },
        { label: 'Salida de efectivo', icon: ArrowUpFromLine, action: props.onCashOut },
        { label: 'Agente bancario', icon: Landmark, action: props.onBankingAgent },
        { label: 'Ventas aparcadas', icon: Archive, action: props.onOpenParkedSales },
        { label: 'Cerrar caja', icon: LockKeyhole, action: props.onCloseRegister },
    ] as const;

    return (
        <section aria-labelledby="guided-cash-operations" className="rounded-card border border-white/[0.10] bg-surface-900 p-3">
            <h2 id="guided-cash-operations" className="mb-3 flex items-center gap-2 px-1 text-sm font-bold text-slate-200">
                <WalletCards size={18} aria-hidden="true" /> Operaciones de caja
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {operations.map(({ label, icon: Icon, action }) => (
                    <button
                        key={label}
                        type="button"
                        onClick={action}
                        disabled={props.processing}
                        className={`flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-control border border-white/[0.08] bg-surface-950 px-2 text-center text-xs font-semibold text-slate-300 transition-colors hover:bg-surface-800 hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
                    >
                        <Icon size={19} className={label === 'Salida de efectivo' || label === 'Cerrar caja' ? 'text-danger' : 'text-brand'} aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>
        </section>
    );
};

const CancelSale = ({ props }: { props: POSGuidedShellProps }) => {
    const [confirming, setConfirming] = useState(false);

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={props.processing || props.cartLines.length === 0}
                className={`flex min-h-tap w-full items-center justify-center gap-2 rounded-control border border-danger/70 px-4 font-semibold text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            >
                <Trash2 size={18} aria-hidden="true" /> Cancelar venta
            </button>
        );
    }

    return (
        <div role="group" aria-label="Confirmar cancelación de venta" className="rounded-card border border-danger/50 bg-danger-soft p-3">
            <p className="text-sm font-semibold text-slate-100">¿Descartar toda la venta actual?</p>
            <p className="mt-1 text-xs text-slate-400">Esta acción quitará las líneas que todavía no se han cobrado.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className={`${secondaryButton} flex flex-1 items-center justify-center gap-2`}
                >
                    <X size={17} aria-hidden="true" /> Conservar venta
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setConfirming(false);
                        props.onCancelSale();
                    }}
                    className={`min-h-tap flex-1 rounded-control border border-danger bg-danger-soft px-4 font-bold text-danger transition-colors hover:bg-danger/10 ${focusRing}`}
                >
                    Sí, cancelar venta
                </button>
            </div>
        </div>
    );
};

const ProductsStage = ({ props }: { props: POSGuidedShellProps }) => (
    <div className="mx-auto grid max-w-screen-2xl gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
            <section aria-labelledby="guided-catalog-title" className="rounded-card border border-white/[0.10] bg-surface-900 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Paso 1 de 3</p>
                        <h2 id="guided-catalog-title" className="mt-1 text-xl font-bold text-slate-50">Agregá productos</h2>
                    </div>
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400">
                        <PackageSearch size={17} aria-hidden="true" /> Buscá por nombre, SKU o código
                    </span>
                </div>
                <form
                    role="search"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onSearchSubmit(props.searchTerm);
                    }}
                    className="mb-5 flex gap-2"
                >
                    <label htmlFor="guided-product-search" className="sr-only">Buscar un producto</label>
                    <div className="relative min-w-0 flex-1">
                        <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                        <input
                            id="guided-product-search"
                            type="search"
                            autoComplete="off"
                            value={props.searchTerm}
                            onChange={(event) => props.onSearchTermChange(event.target.value)}
                            disabled={props.processing}
                            className={`h-pay w-full rounded-control border border-white/[0.12] bg-surface-950 pl-12 pr-4 text-base font-semibold text-slate-100 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
                            placeholder="Nombre, SKU o código de barras"
                        />
                    </div>
                    {props.onOpenScanner && (
                        <button type="button" onClick={props.onOpenScanner} disabled={props.processing} className={iconButton} aria-label="Abrir lector de código">
                            <ScanLine size={20} aria-hidden="true" />
                        </button>
                    )}
                </form>
                {props.catalog}
            </section>
        </div>
        <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
            <CartPanel checkoutMode={false} props={props} />
            <CashOperations props={props} />
            <CancelSale props={props} />
        </div>
    </div>
);

const CheckoutStage = ({ props }: { props: POSGuidedShellProps }) => (
    <div className="mx-auto grid max-w-screen-2xl gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(360px,35fr)_minmax(0,65fr)]">
        <div className="min-w-0 space-y-4">
            <CartPanel checkoutMode props={props} />
            <CashOperations props={props} />
        </div>
        <div className="min-w-0 space-y-4">
            <CheckoutPanel props={props} />
            <CancelSale props={props} />
        </div>
    </div>
);

const ReceiptStage = ({ props, snapshot }: { props: POSGuidedShellProps; snapshot: POSGuidedSaleSnapshot }) => (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-10">
        <section aria-labelledby="guided-receipt-title" className="overflow-hidden rounded-card border border-white/[0.10] bg-surface-900">
            <div className="border-b border-white/[0.08] p-6 text-center sm:p-8">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-brand/25 bg-brand-soft text-brand">
                    <CheckCircle2 size={32} aria-hidden="true" />
                </span>
                <p className="mt-5 text-xs font-bold uppercase tracking-wider text-brand">Venta completada</p>
                <h2 id="guided-receipt-title" className="mt-2 text-2xl font-bold text-slate-50">Comprobante listo</h2>
                <p className="mt-2 text-sm text-slate-400">El cobro ya fue registrado. Ahora elegí cómo entregar el comprobante.</p>
            </div>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="border-b border-white/[0.08] p-5 sm:p-6 lg:border-b-0 lg:border-r">
                    <dl className="space-y-4 text-sm">
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-slate-500">Comprobante</dt>
                            <dd className="nx-sku text-right font-semibold text-slate-200">{snapshot.receiptNumber}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-slate-500">Fecha</dt>
                            <dd className="text-right font-semibold text-slate-200">{snapshot.completedAtLabel}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-slate-500">Cliente</dt>
                            <dd className="text-right font-semibold text-slate-200">{snapshot.customerName ?? 'Cliente general'}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-slate-500">Productos</dt>
                            <dd className="text-right font-semibold text-slate-200">{snapshot.lineCountLabel}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-slate-500">Pago</dt>
                            <dd className="text-right font-semibold text-slate-200">{snapshot.paymentMethodLabel}</dd>
                        </div>
                    </dl>
                    <dl className="mt-5 space-y-2 border-t border-white/[0.08] pt-5">
                        <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                            <dt>Subtotal</dt>
                            <dd className="nx-num text-slate-200">{formatMoney(snapshot.subtotal)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                            <dt>Descuento</dt>
                            <dd className="nx-num text-slate-200">{formatMoney(snapshot.discount)}</dd>
                        </div>
                        {snapshot.cashReceived !== undefined && (
                            <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                                <dt>Recibido</dt>
                                <dd className="nx-num text-slate-200">{formatMoney(snapshot.cashReceived)}</dd>
                            </div>
                        )}
                        {snapshot.change !== undefined && (
                            <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                                <dt>Cambio</dt>
                                <dd className="nx-num text-slate-200">{formatMoney(snapshot.change)}</dd>
                            </div>
                        )}
                        <div className="flex items-end justify-between gap-3 border-t border-white/[0.08] pt-3">
                            <dt className="font-semibold text-slate-200">Total cobrado</dt>
                            <dd className="nx-num text-2xl font-bold text-slate-50">{formatMoney(snapshot.total)}</dd>
                        </div>
                    </dl>
                </div>

                <div className="p-5 sm:p-6">
                    <h3 className="font-bold text-slate-100">Entregar comprobante</h3>
                    <p className="mt-1 text-sm text-slate-400">La impresión se ejecuta solo desde estas acciones postventa.</p>
                    <p className="mt-3 rounded-control border border-brand/20 bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
                        Formato elegido: {snapshot.receiptFormat === 'TICKET_80MM' ? 'Ticket 80 mm' : 'Factura A4'}
                    </p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => props.onPrintTicket(snapshot)}
                            aria-pressed={snapshot.receiptFormat === 'TICKET_80MM'}
                            className={`${snapshot.receiptFormat === 'TICKET_80MM' ? primaryButton : secondaryButton} flex items-center justify-center gap-2`}
                        >
                            <ReceiptText size={18} aria-hidden="true" /> Imprimir ticket 80 mm
                        </button>
                        <button type="button" onClick={() => props.onPrintThermal(snapshot)} className={`${secondaryButton} flex items-center justify-center gap-2`}>
                            <Printer size={18} aria-hidden="true" /> Enviar a impresora térmica
                        </button>
                        <button
                            type="button"
                            onClick={() => props.onPrintA4(snapshot)}
                            aria-pressed={snapshot.receiptFormat === 'A4'}
                            className={`${snapshot.receiptFormat === 'A4' ? primaryButton : secondaryButton} flex items-center justify-center gap-2`}
                        >
                            <FileText size={18} aria-hidden="true" /> Imprimir factura A4
                        </button>
                        <button type="button" onClick={() => props.onShareWhatsApp(snapshot)} className={`${secondaryButton} flex items-center justify-center gap-2`}>
                            <MessageCircle size={18} aria-hidden="true" /> Enviar por WhatsApp
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSale}
                        className={`${secondaryButton} mt-6 flex w-full items-center justify-center gap-2`}
                    >
                        <ShoppingCart size={18} aria-hidden="true" /> Iniciar nueva venta
                    </button>
                </div>
            </div>
        </section>
    </div>
);

/**
 * Shell guiado del POS: solo organiza y presenta estado controlado.
 *
 * No consulta APIs, no persiste carrito, no calcula precios/stock/totales, no
 * registra ventas y no imprime automáticamente. Esos efectos pertenecen al
 * controlador autoritativo que provee los callbacks.
 */
export const POSGuidedShell = (props: POSGuidedShellProps) => {
    const stage: GuidedStage = props.completedSale
        ? 'RECEIPT'
        : props.checkoutOpen
            ? 'CHECKOUT'
            : 'PRODUCTS';

    return (
        <main className="min-h-screen bg-surface-950 text-slate-100">
            <POSHeader header={props.header} />
            <StageProgress stage={stage} />
            {stage === 'PRODUCTS' && <ProductsStage props={props} />}
            {stage === 'CHECKOUT' && <CheckoutStage props={props} />}
            {stage === 'RECEIPT' && props.completedSale && (
                <ReceiptStage props={props} snapshot={props.completedSale} />
            )}
        </main>
    );
};

export default POSGuidedShell;
