import { ArrowRight, ShoppingBag } from 'lucide-react';
import { formatMoney } from '../../utils/money';

interface Props {
    count: number;
    total: number;
    directCash: boolean;
    processing: boolean;
    onReview: () => void;
    onCash: () => void;
}

/** Dos caminos: corregir el ticket o ir al cobro. Ambos usan el estado del POS. */
export function PosMobileCheckoutBar({ count, total, directCash, processing, onReview, onCash }: Props) {
    return <div className="nx-pos-mobile-bar lg:hidden" aria-label="Venta y cobro">
        <button type="button" onClick={onReview} disabled={processing}
            aria-label={count > 0 ? `Revisar venta, ${count} productos, total ${formatMoney(total)}` : 'Abrir la venta actual, todavía sin productos'}
            className="nx-pos-mobile-review nx-fluid-press">
            <ShoppingBag size={20} aria-hidden="true" />
            <span>{count > 0 ? `Ver venta · ${count}` : 'Tu venta está vacía'}</span>
        </button>
        {count > 0 && <button type="button" onClick={directCash ? onCash : onReview} disabled={processing}
            className="nx-pos-mobile-pay nx-fluid-press">
            <span>{directCash ? 'Cobrar' : 'Revisar'} {formatMoney(total)}</span><ArrowRight size={18} aria-hidden="true" />
        </button>}
    </div>;
}
