import React from 'react';
import Decimal from 'decimal.js';
import { ArrowRight, Banknote, Check, Loader2, X } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { formatMoney, formatUSD, sanitizeDecimalInput, toDecimal } from '../../utils/money';
import { suggestNioCashAmounts, type CashReceivedValidation } from '../../utils/posCash';
import { PosPaymentSheet } from './PosPaymentSheet';

interface PosCashSheetProps {
    open: boolean;
    processing: boolean;
    amountDue: Decimal;
    storeCreditApplied: Decimal;
    exchangeRate: Decimal;
    payingInUSD: boolean;
    usdAmount: string;
    cashReceived: string;
    validation: CashReceivedValidation;
    onClose: () => void;
    onTogglePayingInUSD: () => void;
    onUsdAmountChange: (value: string) => void;
    onCashReceivedChange: (value: string) => void;
    onConfirm: () => void;
}

const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'] as const;
const FEEDBACK_ID = 'cash-payment-feedback';

/**
 * Presentación del cobro clásico en efectivo.
 *
 * La validación autoritativa y el POST permanecen en POS. Esta pieza solo
 * presenta montos Decimal, captura texto sanitizado y delega la confirmación.
 */
export const PosCashSheet: React.FC<PosCashSheetProps> = ({
    open,
    processing,
    amountDue,
    storeCreditApplied,
    exchangeRate,
    payingInUSD,
    usdAmount,
    cashReceived,
    validation,
    onClose,
    onTogglePayingInUSD,
    onUsdAmountChange,
    onCashReceivedChange,
    onConfirm,
}) => {
    const exactAmountRef = React.useRef<HTMLButtonElement | null>(null);
    const nioInputRef = React.useRef<HTMLInputElement | null>(null);
    const usdInputRef = React.useRef<HTMLInputElement | null>(null);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const feedbackRef = React.useRef<HTMLDivElement | null>(null);
    const currencyFocusReadyRef = React.useRef(false);
    const usesOnScreenKeypad = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;

    const nioSuggestions = suggestNioCashAmounts(amountDue);
    const hasUsdAmount = usdAmount.trim() !== '' && usdAmount !== '.';
    const usdReceived = hasUsdAmount ? toDecimal(usdAmount) : null;
    const usdEquivalent = usdReceived && exchangeRate.greaterThan(0)
        ? usdReceived.mul(exchangeRate)
        : null;
    const change = validation.ok ? validation.change : null;
    const showsChange = cashReceived !== '' && change !== null;
    const shortfall = validation.ok ? null : validation.shortfall ?? null;
    const showsShortfall = cashReceived !== '' && shortfall !== null;
    const hasFeedback = payingInUSD
        ? Boolean(usdEquivalent?.greaterThan(0))
        : showsChange || showsShortfall;

    const isChipActive = (amount: Decimal): boolean =>
        cashReceived !== '' && validation.ok && validation.received.equals(amount);

    const setKeypadValue = (key: string) => {
        if (processing) return;
        if (key === 'LIMPIAR') {
            onCashReceivedChange('');
            return;
        }
        if (key === 'BORRAR') {
            onCashReceivedChange(cashReceived.slice(0, -1));
            return;
        }
        onCashReceivedChange(sanitizeDecimalInput(cashReceived + key));
    };

    const confirmIfValid = () => {
        if (!processing && validation.ok) onConfirm();
    };

    const confirmFromInput = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (
            event.key !== 'Enter'
            || event.repeat
            || event.nativeEvent.isComposing
            || processing
            || !validation.ok
        ) return;
        event.preventDefault();
        onConfirm();
    };

    React.useEffect(() => {
        if (!open) {
            currencyFocusReadyRef.current = false;
            return;
        }
        if (!currencyFocusReadyRef.current) {
            currencyFocusReadyRef.current = true;
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            const target = payingInUSD
                ? usdInputRef.current
                : usesOnScreenKeypad
                    ? exactAmountRef.current
                    : nioInputRef.current;
            target?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [open, payingInUSD, usesOnScreenKeypad]);

    React.useEffect(() => {
        if (!open || payingInUSD || (!showsChange && !showsShortfall)) return;
        const frame = window.requestAnimationFrame(() => {
            const scroller = scrollRef.current;
            const feedback = feedbackRef.current;
            if (!scroller || !feedback) return;
            const delta = feedback.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 8;
            if (delta > 0) scroller.scrollTop += delta;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [cashReceived, open, payingInUSD, showsChange, showsShortfall]);

    return (
        <PosPaymentSheet
            open={open}
            onClose={onClose}
            labelledBy="cash-payment-title"
            busy={processing}
            contentClassName="nx-pos-cash-sheet-content"
        >
            <header className="flex flex-none items-center gap-3 border-b border-white/[0.06] bg-surface-900/95 p-5 backdrop-blur-xl">
                <div className="flex h-10 w-10 items-center justify-center rounded-pill bg-brand-soft text-brand">
                    <Banknote size={20} />
                </div>
                <div>
                    <h2 id="cash-payment-title" className="text-base font-bold text-slate-100">Efectivo</h2>
                    <p className="mt-0.5 text-2xl font-extrabold text-slate-100 nx-num">
                        {formatMoney(amountDue)}
                    </p>
                    {storeCreditApplied.greaterThan(0) && (
                        <p className="mt-1 text-xs text-emerald-300">
                            Saldo aplicado: {formatMoney(storeCreditApplied)}
                        </p>
                    )}
                </div>
                <IconButton
                    icon={<X size={16} />}
                    label="Cerrar"
                    onClick={onClose}
                    disabled={processing}
                    className="ml-auto"
                />
            </header>

            <div ref={scrollRef} className="nx-pos-cash-sheet-scroll space-y-4 p-5">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-400">Efectivo recibido</p>
                    <button
                        type="button"
                        onClick={onTogglePayingInUSD}
                        disabled={processing}
                        aria-pressed={payingInUSD}
                        aria-label={payingInUSD ? 'Cobrar en córdobas' : 'Cobrar en dólares'}
                        className={`nx-fluid-press min-h-tap rounded-full border px-3 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${payingInUSD ? 'border-brand bg-brand text-brand-on' : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-brand/50'}`}
                    >
                        {payingInUSD ? 'USD activo' : 'Usar USD'}
                    </button>
                </div>

                {payingInUSD ? (
                    <div className="space-y-2">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-blue-400">US$</span>
                            <input
                                ref={usdInputRef}
                                type="text"
                                inputMode="decimal"
                                aria-label="Monto recibido en dólares"
                                aria-describedby={hasFeedback ? FEEDBACK_ID : undefined}
                                aria-invalid={cashReceived !== '' && !validation.ok ? 'true' : undefined}
                                aria-keyshortcuts="Enter"
                                data-fluid-sheet-initial-focus
                                disabled={processing}
                                className="w-full rounded-lg border border-blue-300/60 bg-blue-500/10 py-3 pl-12 pr-4 text-xl font-bold tabular-nums text-slate-100 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-55"
                                placeholder="0.00"
                                value={usdAmount}
                                onKeyDown={confirmFromInput}
                                onChange={event => onUsdAmountChange(sanitizeDecimalInput(event.target.value))}
                            />
                        </div>
                        <p className="text-center text-xs font-medium text-blue-300">
                            Tasa: 1 USD = {formatMoney(exchangeRate)} NIO
                        </p>
                        {usdEquivalent?.greaterThan(0) && (
                            <div
                                id={FEEDBACK_ID}
                                role="status"
                                aria-live="polite"
                                className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm"
                            >
                                <div className="flex justify-between gap-3">
                                    <span className="text-blue-300">Equivalente NIO:</span>
                                    <span className="font-bold tabular-nums text-blue-200">{formatMoney(usdEquivalent)}</span>
                                </div>
                                {usdEquivalent.greaterThanOrEqualTo(amountDue) && exchangeRate.greaterThan(0) && (
                                    <>
                                        <div className="mt-1 flex justify-between gap-3 border-t border-blue-500/20 pt-1">
                                            <span className="font-bold text-emerald-300">Cambio NIO:</span>
                                            <span className="font-bold tabular-nums text-emerald-300">
                                                {formatMoney(usdEquivalent.minus(amountDue))}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 flex justify-between gap-3">
                                            <span className="text-xs text-emerald-300">Cambio USD:</span>
                                            <span className="text-xs font-bold tabular-nums text-emerald-300">
                                                {formatUSD(usdReceived!.minus(amountDue.div(exchangeRate)))}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap gap-2">
                            <button
                                ref={exactAmountRef}
                                type="button"
                                onClick={() => onCashReceivedChange(amountDue.toFixed(2))}
                                disabled={processing}
                                aria-pressed={isChipActive(amountDue)}
                                data-fluid-sheet-initial-focus={usesOnScreenKeypad ? true : undefined}
                                className={`nx-fluid-press min-h-tap flex-shrink-0 rounded-control border px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isChipActive(amountDue) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]'}`}
                            >
                                Monto exacto
                            </button>
                            {nioSuggestions.map(amount => (
                                <button
                                    key={amount.toFixed(2)}
                                    type="button"
                                    onClick={() => onCashReceivedChange(amount.toFixed(2))}
                                    disabled={processing}
                                    aria-pressed={isChipActive(amount)}
                                    className={`nx-fluid-press min-h-tap flex-shrink-0 rounded-control border px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isChipActive(amount) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]'}`}
                                >
                                    {formatMoney(amount, 'NIO', { decimals: 0 })}
                                </button>
                            ))}
                        </div>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">C$</span>
                            <input
                                ref={nioInputRef}
                                type="text"
                                inputMode="decimal"
                                aria-label="Efectivo recibido en córdobas"
                                aria-describedby={hasFeedback ? FEEDBACK_ID : undefined}
                                aria-invalid={cashReceived !== '' && !validation.ok ? 'true' : undefined}
                                aria-keyshortcuts="Enter"
                                data-fluid-sheet-initial-focus={!usesOnScreenKeypad ? true : undefined}
                                disabled={processing}
                                className="w-full rounded-lg border border-white/10 bg-white/[0.025] py-3 pl-10 pr-4 text-xl font-bold tabular-nums text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-55"
                                placeholder={amountDue.toFixed(2)}
                                value={cashReceived}
                                onKeyDown={confirmFromInput}
                                onChange={event => onCashReceivedChange(sanitizeDecimalInput(event.target.value))}
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5" aria-label="Teclado de efectivo">
                            {KEYPAD_KEYS.map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setKeypadValue(key)}
                                    disabled={processing}
                                    className="nx-fluid-press h-14 rounded-control bg-white/[0.04] text-xl font-bold tabular-nums text-slate-100 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    {key}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setKeypadValue('BORRAR')}
                                disabled={processing}
                                aria-label="Borrar el último dígito"
                                className="nx-fluid-press flex h-14 items-center justify-center rounded-control bg-white/[0.04] font-bold text-slate-300 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                <ArrowRight size={20} className="rotate-180" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setKeypadValue('LIMPIAR')}
                                disabled={processing}
                                className="nx-fluid-press col-span-2 h-14 rounded-control bg-white/[0.04] font-bold text-slate-300 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                Limpiar
                            </button>
                        </div>
                        <div ref={feedbackRef} id={FEEDBACK_ID} role="status" aria-live="polite">
                            {showsChange && (
                                <div className="rounded-control border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center">
                                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Vuelto</p>
                                    <p className="mt-1 text-5xl font-black tabular-nums leading-none text-slate-50">
                                        {formatMoney(change)}
                                    </p>
                                </div>
                            )}
                            {showsShortfall && (
                                <div className="rounded-control border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-center">
                                    <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Falta</p>
                                    <p className="mt-1 text-3xl font-black tabular-nums leading-none text-amber-200">
                                        {formatMoney(shortfall)}
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            <footer className="flex-none border-t border-white/[0.06] bg-surface-900/95 p-5 pt-4 backdrop-blur-xl">
                <p className="mb-3 text-xs text-slate-400">
                    {amountDue.isZero()
                        ? 'El saldo aplicado cubre el total. Confirmá para registrar.'
                        : 'Confirmá el vuelto antes de registrar.'}
                </p>
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={processing}
                        className="flex-1 rounded-xl border border-white/[0.08] py-3 font-bold text-slate-200 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={confirmIfValid}
                        disabled={processing || !validation.ok}
                        className="flex h-touch flex-1 items-center justify-center gap-2 rounded-control bg-brand font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {processing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                        {processing
                            ? 'Registrando…'
                            : amountDue.isZero()
                                ? 'Confirmar con saldo'
                                : `Cobrar ${formatMoney(amountDue)}`}
                    </button>
                </div>
            </footer>
        </PosPaymentSheet>
    );
};

export default PosCashSheet;
