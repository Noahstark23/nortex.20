import React from 'react';
import { Printer, X } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import { formatManaguaDateTime } from '../../utils/managuaDateTime';
import { isPlaceholderTaxId } from '../../utils/tenantTaxId';

export interface SaleReceiptSnapshot {
    id: string;
    invoiceNumber: number | null;
    invoiceSeries: string | null;
    createdAt: string;
    total: string;
    status: string;
    paymentMethod: string;
    customerName: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    vatAmountAtSale: string | null;
    tenant: { businessName: string; taxId: string | null; address: string | null; phone: string | null; dgiAuthCode: string | null };
    items: Array<{
        id: string;
        productNameAtSale: string | null;
        quantity: number;
        unitAtSale: string | null;
        priceAtSale: string;
        unitPriceExactAtSale: string | null;
    }>;
}

const methodLabel: Record<string, string> = {
    CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', QR: 'QR', CREDIT: 'Crédito', MIXED: 'Mixto',
};

export default function SaleReceiptPanel({ sale, onClose }: { sale: SaleReceiptSnapshot; onClose: () => void }) {
    const number = sale.invoiceNumber == null ? sale.id.slice(0, 12) : `${sale.invoiceSeries ?? 'A'}-${String(sale.invoiceNumber).padStart(6, '0')}`;
    const isVoided = sale.status === 'VOIDED';
    const taxId = sale.tenant.taxId && !isPlaceholderTaxId(sale.tenant.taxId) ? sale.tenant.taxId : null;
    const printCopy = () => {
        const pageStyle = document.createElement('style');
        pageStyle.textContent = '@media print { @page { size: A4; margin: 12mm; } }';
        document.head.appendChild(pageStyle);
        window.addEventListener('afterprint', () => pageStyle.remove(), { once: true });
        window.print();
    };

    return <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="sale-receipt-title">
        <div className="nx-sale-receipt-print max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
            <div className="nx-sale-receipt-actions mb-5 flex justify-end gap-2">
                <button type="button" onClick={printCopy} className="nx-fluid-press min-h-tap rounded-xl bg-brand px-4 py-2 font-bold text-brand-on"><Printer className="mr-2 inline" size={16} />Imprimí copia A4</button>
                <button type="button" onClick={onClose} aria-label="Cerrar comprobante" className="nx-fluid-press min-h-tap min-w-tap rounded-xl border border-slate-300 p-2"><X size={18} /></button>
            </div>
            <h2 id="sale-receipt-title" className="text-2xl font-black">{sale.tenant.businessName}</h2>
            {taxId && <p className="text-sm">RUC: {taxId}</p>}
            {sale.tenant.address && <p className="text-sm">{sale.tenant.address}</p>}
            {sale.tenant.phone && <p className="text-sm">Tel.: {sale.tenant.phone}</p>}
            {sale.tenant.dgiAuthCode && <p className="text-sm">Autorización DGI: {sale.tenant.dgiAuthCode}</p>}
            <div className="my-5 border-y border-slate-300 py-4">
                <p className="font-black">Copia de comprobante {number}</p>
                <p className="text-sm">{formatManaguaDateTime(sale.createdAt)} · ID {sale.id}</p>
                <p className="text-sm">Cliente: {sale.customerName || 'Cliente de mostrador'}</p>
                <p className="text-sm">Pago original: {methodLabel[sale.paymentMethod] ?? 'Método por revisar'}</p>
                {isVoided && <p className="mt-2 font-black text-red-700">ANULADA · {sale.cancelReason || 'Sin motivo visible'}</p>}
            </div>
            <table className="w-full text-sm"><thead><tr className="border-b border-slate-300 text-left"><th className="py-2">Producto</th><th className="py-2 text-right">Cantidad</th><th className="py-2 text-right">Precio unitario</th></tr></thead><tbody>
                {sale.items.map(item => <tr key={item.id} className="border-b border-slate-200"><td className="py-2">{item.productNameAtSale || 'Producto sin nombre guardado'}</td><td className="py-2 text-right">{item.quantity} {item.unitAtSale || 'unidad'}</td><td className="py-2 text-right">{formatMoney(item.unitPriceExactAtSale ?? item.priceAtSale)}</td></tr>)}
            </tbody></table>
            <div className="mt-5 space-y-1 text-right">
                {sale.vatAmountAtSale != null && <p>IVA incluido al vender: {formatMoney(sale.vatAmountAtSale)}</p>}
                <p className="text-xl font-black">Total original: {formatMoney(sale.total)}</p>
            </div>
            <p className="mt-5 text-xs text-slate-600">Copia de la venta registrada. Los abonos y devoluciones posteriores se consultan en sus historiales.</p>
        </div>
    </div>;
}
