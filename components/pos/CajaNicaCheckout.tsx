import { ArrowLeft, ArrowRight, Banknote, Check, Loader2 } from 'lucide-react';
import type Decimal from 'decimal.js';
import { useFluidPress } from '../../hooks/useFluidPress';
import { formatMoney, sanitizeDecimalInput } from '../../utils/money';
import { suggestNioCashAmounts, validateCashReceived } from '../../utils/posCash';

interface CajaNicaCheckoutProps {
    total: Decimal;
    cashReceived: string;
    cashOpen: boolean;
    processing: boolean;
    disabled?: boolean;
    onCashReceivedChange: (value: string) => void;
    onOpenCash: () => void;
    onCancelCash: () => void;
    onConfirmCash: () => void;
    onOtherPayment: () => void;
}

/**
 * Dock de cobro para la caja simple.
 *
 * El estado expandido vive en el ticket, no en un modal: el cajero conserva a
 * la vista los productos, el total, lo recibido y el vuelto antes de registrar.
 */
export const CajaNicaCheckout = ({
    total,
    cashReceived,
    cashOpen,
    processing,
    disabled = false,
    onCashReceivedChange,
    onOpenCash,
    onCancelCash,
    onConfirmCash,
    onOtherPayment,
}: CajaNicaCheckoutProps) => {
    const validation = validateCashReceived(cashReceived, total);
    const successfulPayment = validation.ok === true ? validation : null;
    const paymentError = validation.ok === false ? validation : null;
    const ready = successfulPayment !== null;
    const exactSelected = successfulPayment?.received.equals(total) ?? false;
    const primaryPress = useFluidPress<HTMLButtonElement>({
        disabled: cashOpen ? !ready || disabled || processing : disabled || processing,
    });
    const secondaryPress = useFluidPress<HTMLButtonElement>({ disabled: disabled || processing });
    const backPress = useFluidPress<HTMLButtonElement>({ disabled: processing });
    const exactPress = useFluidPress<HTMLButtonElement>({ disabled: disabled || processing });

    if (!cashOpen) {
        return (
            <div
                role="group"
                className="nx-ticket-dock nx-ticket-checkout space-y-2.5"
                aria-label={`Cobro de ${formatMoney(total)}`}
            >
                <button
                    type="button"
                    {...primaryPress.bind}
                    onClick={onOpenCash}
                    disabled={disabled || processing}
                    className="nx-ticket-primary nx-fluid-press nx-fluid-engine flex h-pay w-full items-center gap-3 rounded-control bg-brand px-5 text-left text-[16px] font-bold text-brand-on shadow-lg shadow-brand/15 transition-[background-color,box-shadow] hover:bg-brand-hover hover:shadow-xl hover:shadow-brand/20 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
                >
                    <Banknote size={21} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Cobrar {formatMoney(total)} en efectivo</span>
                    <kbd className="hidden rounded border border-black/15 bg-black/10 px-1.5 py-0.5 font-mono text-[10px] font-bold lg:inline">F9</kbd>
                </button>
                <button
                    type="button"
                    {...secondaryPress.bind}
                    onClick={onOtherPayment}
                    disabled={disabled || processing}
                    className="nx-ticket-secondary nx-fluid-press nx-fluid-engine flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-white/[0.10] bg-white/[0.035] text-sm font-semibold text-slate-300 transition-[background-color,border-color,color] hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                    Otro pago <ArrowRight size={16} aria-hidden="true" />
                </button>
                <p className="text-center text-[11px] text-slate-500">Transferencia, tarjeta o fiado</p>
            </div>
        );
    }

    return (
        <section
            aria-labelledby="caja-nica-cash-title"
            className="nx-ticket-dock nx-ticket-cash space-y-3 rounded-card border border-white/[0.08] bg-black/15 p-3"
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 id="caja-nica-cash-title" className="text-sm font-bold text-slate-100">Efectivo recibido</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Confirmá el vuelto antes de registrar.</p>
                </div>
                <button
                    type="button"
                    {...backPress.bind}
                    onClick={onCancelCash}
                    disabled={processing}
                    className="nx-fluid-press nx-fluid-engine inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-xs font-semibold text-slate-400 transition-[background-color,color] hover:bg-white/[0.05] hover:text-white disabled:opacity-45"
                >
                    <ArrowLeft size={15} aria-hidden="true" /> Volver
                </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-0.5">
                <button
                    type="button"
                    {...exactPress.bind}
                    onClick={() => onCashReceivedChange(total.toFixed(2))}
                    disabled={disabled || processing}
                    aria-pressed={exactSelected}
                    className={`nx-ticket-cash-option nx-fluid-press nx-fluid-engine min-h-11 shrink-0 rounded-control border px-3 text-xs font-bold transition-[background-color,border-color,color] disabled:cursor-not-allowed disabled:opacity-45 ${exactSelected
                        ? 'border-brand bg-brand-soft text-brand'
                        : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]'}`}
                >
                    Monto exacto
                </button>
                {suggestNioCashAmounts(total).map(amount => {
                    const selected = successfulPayment?.received.equals(amount) ?? false;
                    return (
                        <button
                            key={amount.toString()}
                            type="button"
                            onClick={() => onCashReceivedChange(amount.toFixed(2))}
                            disabled={disabled || processing}
                            aria-pressed={selected}
                            className={`nx-ticket-cash-option nx-fluid-press min-h-11 shrink-0 rounded-control border px-3 text-xs font-bold transition-[background-color,border-color,color,transform] disabled:cursor-not-allowed disabled:opacity-45 ${selected
                                ? 'border-brand bg-brand-soft text-brand'
                                : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]'}`}
                        >
                            {formatMoney(amount, 'NIO', { decimals: 0 })}
                        </button>
                    );
                })}
            </div>

            <label className="block">
                <span className="sr-only">Efectivo recibido en córdobas</span>
                <span className="relative block">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">C$</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        value={cashReceived}
                        disabled={disabled || processing}
                        onChange={event => onCashReceivedChange(sanitizeDecimalInput(event.target.value))}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && ready && !disabled && !processing) onConfirmCash();
                        }}
                        aria-invalid={!ready && cashReceived !== ''}
                        aria-describedby="caja-nica-cash-status"
                        className="nx-ticket-cash-input h-14 w-full rounded-control border border-white/[0.12] bg-black/20 pl-11 pr-4 text-2xl font-black tabular-nums text-slate-100 outline-none transition-[background-color,border-color,box-shadow] placeholder:text-slate-600 focus:border-brand focus:bg-black/30 focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-45"
                        placeholder="0.00"
                    />
                </span>
            </label>

            <div
                id="caja-nica-cash-status"
                aria-live="polite"
                className={`nx-ticket-cash-status flex min-h-[72px] items-center justify-between rounded-control border px-4 py-3 ${ready
                    ? 'border-brand/20 bg-brand-soft'
                    : cashReceived !== ''
                        ? 'border-amber-500/20 bg-warning-soft'
                        : 'border-white/[0.06] bg-white/[0.03]'}`}
            >
                {ready ? (
                    <>
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-brand">Vuelto</span>
                        <strong className="text-3xl font-black tabular-nums text-brand">{formatMoney(successfulPayment?.change)}</strong>
                    </>
                ) : (
                    <>
                        <span className="text-sm font-semibold text-slate-300">
                            {cashReceived === '' ? 'Ingresá el monto recibido' : paymentError?.message}
                        </span>
                        {paymentError?.shortfall && (
                            <strong className="text-lg font-black tabular-nums text-amber-300">Falta {formatMoney(paymentError.shortfall)}</strong>
                        )}
                    </>
                )}
            </div>

            <button
                type="button"
                {...primaryPress.bind}
                onClick={onConfirmCash}
                disabled={!ready || disabled || processing}
                className="nx-ticket-primary nx-fluid-press nx-fluid-engine flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-[16px] font-bold text-brand-on shadow-lg shadow-brand/15 transition-[background-color,box-shadow] hover:bg-brand-hover hover:shadow-xl hover:shadow-brand/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {processing ? <Loader2 size={19} className="animate-spin" aria-hidden="true" /> : <Check size={19} aria-hidden="true" />}
                {processing ? 'Registrando…' : 'Registrar efectivo y seguir'}
            </button>
            <button
                type="button"
                {...secondaryPress.bind}
                onClick={onOtherPayment}
                disabled={disabled || processing}
                className="nx-ticket-secondary nx-fluid-press nx-fluid-engine min-h-11 w-full rounded-control text-sm font-semibold text-slate-400 transition-[background-color,color] hover:bg-white/[0.04] hover:text-white disabled:opacity-45"
            >
                Otro pago
            </button>
        </section>
    );
};

export default CajaNicaCheckout;
