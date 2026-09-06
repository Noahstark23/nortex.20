import { useId } from 'react';
import type { ReactNode } from 'react';
import { Check, CloudUpload, RotateCcw } from 'lucide-react';
import FluidSheet from '../ui/FluidSheet';

export interface PosSaleResultSheetProps {
    pending: boolean;
    firstSale: boolean;
    date: string;
    onNewSale: () => void;
    children: ReactNode;
}

/** Presenta el resultado recibido del POS; no confirma ni vuelve a enviar ventas. */
export const PosSaleResultSheet = ({ pending, firstSale, date, onNewSale, children }: PosSaleResultSheetProps) => {
    const titleId = useId();
    const title = pending
        ? 'Venta guardada para confirmar'
        : firstSale ? 'Tu primera venta quedó registrada' : 'Venta lista';

    return (
        <FluidSheet
            open
            onClose={onNewSale}
            labelledBy={titleId}
            size="content"
            className="nx-pos-payment-sheet-root"
            panelClassName="nx-pos-payment-sheet nx-dark-context nx-ticket-surface"
            dragToDismiss={false}
        >
            <div className="shrink-0 border-b border-white/[0.06] px-4 pb-4 pt-2 text-center sm:px-6 sm:pt-5">
                <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-pill border ${pending ? 'border-warning/20 bg-warning-soft text-warning' : 'border-brand/20 bg-brand-soft text-brand'}`}>
                    {pending ? <CloudUpload size={26} aria-hidden="true" /> : <Check size={26} aria-hidden="true" />}
                </div>
                <h2 id={titleId} tabIndex={-1} data-fluid-sheet-initial-focus className="text-lg font-bold text-slate-100 outline-none">
                    {title}
                </h2>
                <p className="mt-1.5 text-sm text-slate-300">
                    {pending
                        ? 'Se guardó en este dispositivo. Consultá su confirmación en Avisos. No la registres de nuevo.'
                        : 'Revisá el comprobante antes de atender al próximo cliente.'}
                </p>
                <p className="mt-1 text-xs text-slate-400">{date}</p>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain">
                {children}
            </div>
            <div className="shrink-0 border-t border-white/[0.06] p-4 sm:px-6">
                <button type="button" onClick={onNewSale} className="nx-fluid-press flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand font-bold text-brand-on transition-colors hover:bg-brand-hover">
                    <RotateCcw size={18} aria-hidden="true" /> Hacer otra venta
                </button>
            </div>
        </FluidSheet>
    );
};

export default PosSaleResultSheet;
