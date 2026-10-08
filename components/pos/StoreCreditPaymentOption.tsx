import React from 'react';
import { formatMoney } from '../../utils/money';

type Props = {
    available: number;
    applied: number;
    amountDue: number;
    selected: boolean;
    disabled: boolean;
    onToggle: () => void;
};

export function StoreCreditPaymentOption({ available, applied, amountDue, selected, disabled, onToggle }: Props) {
    if (available <= 0) return null;
    return <>
        <button type="button" onClick={onToggle} disabled={disabled} aria-pressed={selected} className={`w-full rounded-control border px-4 py-3 text-left transition-colors ${selected ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/[0.08] text-slate-300 hover:bg-white/[0.04]'}`}>
            <span className="block text-sm font-black">Usar saldo a favor</span>
            <span className="mt-0.5 block text-xs">Disponible {formatMoney(available)} · aplica {formatMoney(applied)}</span>
        </button>
        {applied > 0 && <div className="flex justify-between rounded-control bg-surface-950 px-4 py-2 text-sm"><span className="text-slate-400">Resta cobrar</span><strong className="nx-num text-white">{formatMoney(amountDue)}</strong></div>}
    </>;
}
