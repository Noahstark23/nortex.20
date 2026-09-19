import React from 'react';
import type { ReactNode } from 'react';
import FluidSheet from '../ui/FluidSheet';

export interface PosPaymentSheetProps {
    open: boolean;
    onClose: () => void;
    labelledBy: string;
    busy: boolean;
    contentClassName?: string;
    children: ReactNode;
}

/**
 * Carcasa visual del selector de pagos del POS.
 *
 * El monto, el método elegido y la confirmación siguen perteneciendo a POS.
 * Esta capa solo aporta una superficie fluida, foco modal y cierre seguro.
 */
export const PosPaymentSheet: React.FC<PosPaymentSheetProps> = ({
    open,
    onClose,
    labelledBy,
    busy,
    contentClassName = '',
    children,
}) => {
    const closeWhenIdle = () => {
        if (!busy) onClose();
    };

    return (
        <FluidSheet
            open={open}
            onClose={closeWhenIdle}
            labelledBy={labelledBy}
            size="content"
            className="nx-pos-payment-sheet-root"
            panelClassName="nx-pos-payment-sheet nx-dark-context nx-ticket-surface"
            closeOnBackdrop={!busy}
            closeOnEscape={!busy}
            dragToDismiss={!busy}
        >
            <div
                className={`nx-pos-payment-sheet-content ${contentClassName}`}
                aria-busy={busy || undefined}
            >
                {children}
            </div>
        </FluidSheet>
    );
};

export default PosPaymentSheet;
