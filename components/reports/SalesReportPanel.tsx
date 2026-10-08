import React, { useMemo, useState } from 'react';
import {
    ArrowDownToLine,
    AlertTriangle,
    Banknote,
    FileSpreadsheet,
    Loader2,
    PackageSearch,
    Printer,
    ReceiptText,
    RotateCcw,
    TrendingUp,
    WalletCards,
} from 'lucide-react';
import {
    authenticatedRequestErrorMessage,
    downloadAuthenticatedFile,
    openAuthenticatedPreview,
} from '../../utils/authenticatedDownload';
import { formatMoney } from '../../utils/money';
import { formatQuantityValue } from '../../utils/quantity';
import type { ToastTone } from '../ui/Toast';

type NumericValue = number | string;

export interface SalesReportSummary {
    grossSales: NumericValue;
    returnsTotal: NumericValue;
    netSales: NumericValue;
    vatCollected: NumericValue;
    netRevenue: NumericValue;
    cogs: NumericValue;
    grossProfit: NumericValue;
    transactionCount: number;
    returnCount: number;
    averageTicket: NumericValue;
    discountTotal: NumericValue;
    itemQuantityGross: NumericValue;
    itemQuantityReturned: NumericValue;
    itemQuantityNet: NumericValue;
    roundingAdjustment: NumericValue;
}

export interface SalesPaymentMethod {
    method: string;
    label: string;
    transactionCount: number;
    returnCount?: number;
    grossSales: NumericValue;
    returnsTotal?: NumericValue;
    netSales?: NumericValue;
}

export interface SalesProductRow {
    productId: string;
    productName: string;
    unit: string;
    baseUnit?: string;
    saleMode: 'COUNTED' | 'MEASURED' | string;
    presentation: 'BASE' | 'PACK' | string;
    displayUnit: string;
    quantitySold: NumericValue;
    quantityGross?: NumericValue;
    quantityReturned: NumericValue;
    quantityNet: NumericValue;
    grossSales: NumericValue;
    returnsTotal: NumericValue;
    netSales: NumericValue;
    cogs: NumericValue;
    grossProfit: NumericValue;
}

export interface SalesReportData {
    // Contrato legado conservado por el backend para el resto del dashboard.
    totalVentas: number;
    ventasNetas: number;
    ivaRecaudado: number;
    totalCOGS: number;
    utilidadBruta: number;
    totalTransacciones: number;
    chartData: { name: string; ventas: number; gastos: number }[];
    quantityBreakdown: {
        productId: string;
        productName: string;
        saleMode: 'COUNTED' | 'MEASURED';
        presentation: 'BASE' | 'PACK';
        baseUnit: string;
        displayUnit: string;
        usedFallbackUnit: boolean;
        quantity: string;
    }[];
    period?: {
        startDate: string;
        endDate: string;
        timezone?: string;
        timeZone?: string;
    };
    summary?: SalesReportSummary;
    paymentMethods?: SalesPaymentMethod[];
    products?: SalesProductRow[];
    daily?: unknown[];
    monthly?: unknown[];
    returns?: Array<{
        invalidItemCount: number;
        unallocatedTotal: NumericValue;
    }>;
}

interface ToastInput {
    tone?: ToastTone;
    title: string;
    message?: string;
}

interface SalesReportPanelProps {
    data: SalesReportData | null;
    startDate: string;
    endDate: string;
    token: string | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    showToast: (toast: ToastInput) => void;
}

const paymentMethodFallback: Record<string, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    QR: 'Código QR',
    CREDIT: 'Crédito',
    TRANSFER: 'Transferencia',
};

const asNumber = (value: NumericValue | null | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const formatC = (value: NumericValue | null | undefined) => formatMoney(asNumber(value));

const formatQuantity = (value: NumericValue | null | undefined) => {
    try {
        return formatQuantityValue(value ?? 0);
    } catch {
        return '0';
    }
};

const fallbackSummary = (data: SalesReportData | null): SalesReportSummary => ({
    grossSales: data?.totalVentas ?? 0,
    returnsTotal: 0,
    netSales: data?.totalVentas ?? 0,
    vatCollected: data?.ivaRecaudado ?? 0,
    netRevenue: data?.ventasNetas ?? 0,
    cogs: data?.totalCOGS ?? 0,
    grossProfit: data?.utilidadBruta ?? 0,
    transactionCount: data?.totalTransacciones ?? 0,
    returnCount: 0,
    averageTicket: data?.totalTransacciones
        ? (data.totalVentas / data.totalTransacciones)
        : 0,
    discountTotal: 0,
    itemQuantityGross: 0,
    itemQuantityReturned: 0,
    itemQuantityNet: 0,
    roundingAdjustment: 0,
});

const inclusiveCivilDays = (startDate: string, endDate: string) => {
    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    const end = Date.parse(`${endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.floor((end - start) / 86_400_000) + 1;
};

const SalesReportPanel: React.FC<SalesReportPanelProps> = ({
    data,
    startDate,
    endDate,
    token,
    loading,
    error,
    onRetry,
    showToast,
}) => {
    const [documentAction, setDocumentAction] = useState<'preview' | 'excel' | null>(null);
    const summary = data?.summary ?? fallbackSummary(data);
    const paymentMethods = data?.paymentMethods ?? [];
    const products = data?.products ?? [];
    const returnQuality = (data?.returns ?? []).reduce(
        (total, row) => ({
            invalidLines: total.invalidLines + Math.max(0, Number(row.invalidItemCount) || 0),
            unallocatedTotal: total.unallocatedTotal + asNumber(row.unallocatedTotal),
        }),
        { invalidLines: 0, unallocatedTotal: 0 },
    );
    const hasReturnQualityWarning = returnQuality.invalidLines > 0 || returnQuality.unallocatedTotal > 0;
    const isEmpty = Boolean(data)
        && asNumber(summary.transactionCount) === 0
        && asNumber(summary.returnCount) === 0
        && products.length === 0;

    const reportQuery = useMemo(() => {
        const query = new URLSearchParams({ startDate, endDate });
        return query.toString();
    }, [endDate, startDate]);
    const documentRangeDays = inclusiveCivilDays(startDate, endDate);
    const documentsAvailable = documentRangeDays >= 1 && documentRangeDays <= 31;

    const handlePreview = async () => {
        if (documentAction || !documentsAvailable) return;
        setDocumentAction('preview');
        try {
            await openAuthenticatedPreview(`/api/reports/sales/document?${reportQuery}`, { token });
            showToast({
                tone: 'success',
                title: 'Documento listo',
                message: 'Abrimos una vista segura para revisar o imprimir el reporte.',
            });
        } catch (previewError) {
            showToast({
                tone: 'error',
                title: 'No se pudo abrir el reporte',
                message: authenticatedRequestErrorMessage(previewError),
            });
        } finally {
            setDocumentAction(null);
        }
    };

    const handleExcelDownload = async () => {
        if (documentAction || !documentsAvailable) return;
        setDocumentAction('excel');
        try {
            await downloadAuthenticatedFile(
                `/api/reports/sales/export.xlsx?${reportQuery}`,
                `reporte-ventas-${startDate}-${endDate}.xlsx`,
                { token },
            );
            showToast({
                tone: 'success',
                title: 'Excel generado',
                message: 'La descarga incluye el resumen, métodos de pago y productos del período.',
            });
        } catch (downloadError) {
            showToast({
                tone: 'error',
                title: 'No se pudo descargar el Excel',
                message: authenticatedRequestErrorMessage(downloadError),
            });
        } finally {
            setDocumentAction(null);
        }
    };

    return (
        <section
            aria-labelledby="sales-report-heading"
            aria-busy={loading}
            className="mb-8 overflow-hidden rounded-2xl border border-cyan-500/20 bg-surface-900 shadow-sm"
        >
            <div className="flex flex-col gap-4 border-b border-white/[0.06] bg-gradient-to-r from-cyan-500/10 to-transparent p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 id="sales-report-heading" className="flex items-center gap-2 text-xl font-bold text-slate-100">
                        <ReceiptText size={21} className="text-cyan-400" aria-hidden="true" />
                        Reporte integral de ventas
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                        Del <time dateTime={startDate}>{startDate}</time> al <time dateTime={endDate}>{endDate}</time>
                        {' · '}hora de Nicaragua
                    </p>
                </div>
                <div className="print:hidden">
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handlePreview}
                            disabled={loading || Boolean(documentAction) || !documentsAvailable}
                            aria-describedby={!documentsAvailable ? 'sales-document-range-help' : undefined}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {documentAction === 'preview'
                                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                : <Printer size={16} aria-hidden="true" />}
                            {documentAction === 'preview' ? 'Abriendo…' : 'Ver / imprimir documento'}
                        </button>
                        <button
                            type="button"
                            onClick={handleExcelDownload}
                            disabled={loading || Boolean(documentAction) || !documentsAvailable}
                            aria-describedby={!documentsAvailable ? 'sales-document-range-help' : undefined}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-nortex-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-nortex-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {documentAction === 'excel'
                                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                : <FileSpreadsheet size={16} aria-hidden="true" />}
                            {documentAction === 'excel' ? 'Generando…' : 'Descargar Excel'}
                        </button>
                    </div>
                    {!documentsAvailable && (
                        <p id="sales-document-range-help" className="mt-2 max-w-md text-xs text-amber-300" role="status">
                            Para generar el documento o Excel, seleccioná un período de hasta 31 días.
                        </p>
                    )}
                </div>
            </div>

            {loading && !data ? (
                <div className="flex min-h-64 items-center justify-center gap-3 p-8 text-slate-300" role="status">
                    <Loader2 size={24} className="animate-spin text-cyan-400" aria-hidden="true" />
                    <span>Cargando ventas, devoluciones y productos…</span>
                </div>
            ) : error ? (
                <div className="m-5 rounded-xl border border-red-500/30 bg-red-500/10 p-5" role="alert">
                    <div className="flex items-start gap-3">
                        <RotateCcw className="mt-0.5 shrink-0 text-red-300" size={20} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-red-200">No pudimos cargar el reporte de ventas</h3>
                            <p className="mt-1 text-sm text-red-100/80">{error}</p>
                            <button
                                type="button"
                                onClick={onRetry}
                                className="mt-3 rounded-lg border border-red-400/30 px-3 py-2 text-sm font-bold text-red-100 hover:bg-red-500/10"
                            >
                                Intentar nuevamente
                            </button>
                        </div>
                    </div>
                </div>
            ) : isEmpty ? (
                <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center" role="status">
                    <PackageSearch size={44} className="text-slate-500" aria-hidden="true" />
                    <h3 className="mt-3 text-lg font-bold text-slate-200">No hubo ventas en este período</h3>
                    <p className="mt-1 max-w-md text-sm text-slate-400">
                        Cambiá las fechas o actualizá el reporte. El documento del período seguirá disponible como respaldo.
                    </p>
                </div>
            ) : data ? (
                <div className="space-y-6 p-5">
                    {loading && (
                        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300" role="status">
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            Actualizando cifras…
                        </div>
                    )}

                    {hasReturnQualityWarning && (
                        <div className="flex gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-100" role="status">
                            <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={19} aria-hidden="true" />
                            <div>
                                <p className="text-sm font-bold">Hay devoluciones históricas por conciliar</p>
                                <p className="mt-1 text-xs text-amber-100/80">
                                    {returnQuality.invalidLines} línea(s) no se pudieron leer y {formatC(returnQuality.unallocatedTotal)}
                                    {' '}no se asignaron a un producto. El total de devoluciones sí conserva el monto del documento.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Resumen de ventas">
                        {[
                            { label: 'Ventas brutas', value: formatC(summary.grossSales), Icon: Banknote, tone: 'text-cyan-300' },
                            { label: 'Devoluciones', value: `-${formatC(summary.returnsTotal)}`, Icon: ArrowDownToLine, tone: 'text-amber-300' },
                            { label: 'Ventas netas', value: formatC(summary.netSales), Icon: WalletCards, tone: 'text-emerald-300' },
                            { label: 'IVA recaudado', value: formatC(summary.vatCollected), Icon: ReceiptText, tone: 'text-amber-300' },
                            { label: 'Utilidad bruta', value: formatC(summary.grossProfit), Icon: TrendingUp, tone: asNumber(summary.grossProfit) >= 0 ? 'text-emerald-300' : 'text-red-300' },
                            { label: 'Ticket promedio', value: formatC(summary.averageTicket), Icon: ReceiptText, tone: 'text-violet-300' },
                        ].map(({ label, value, Icon, tone }) => (
                            <div key={label} className="rounded-xl border border-white/[0.06] bg-surface-800/40 p-4">
                                <Icon size={17} className={tone} aria-hidden="true" />
                                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                                <p className={`mt-1 font-mono text-lg font-bold ${tone}`}>{value}</p>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-9">
                        <CompactStat label="Transacciones" value={String(summary.transactionCount)} />
                        <CompactStat label="Devoluciones" value={String(summary.returnCount)} />
                        <CompactStat label="Ingreso sin IVA" value={formatC(summary.netRevenue)} />
                        <CompactStat label="Costo de venta" value={formatC(summary.cogs)} />
                        <CompactStat label="Cantidad vendida" value={formatQuantity(summary.itemQuantityGross)} />
                        <CompactStat label="Cantidad devuelta" value={formatQuantity(summary.itemQuantityReturned)} />
                        <CompactStat label="Cantidad neta" value={formatQuantity(summary.itemQuantityNet)} emphasized />
                        <CompactStat label="Descuentos" value={formatC(summary.discountTotal)} />
                        <CompactStat label="Diferencia por conciliar" value={formatC(summary.roundingAdjustment)} />
                    </div>

                    <div>
                        <h3 className="font-bold text-slate-100">Métodos de pago</h3>
                        <p className="mt-1 text-xs text-slate-500">Cómo se originaron las ventas del período.</p>
                        {paymentMethods.length > 0 ? (
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                {paymentMethods.map((method) => (
                                    <div key={method.method} className="rounded-xl border border-white/[0.06] bg-surface-800/40 p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-bold text-slate-200">
                                                {method.label || paymentMethodFallback[method.method] || method.method}
                                            </span>
                                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-bold text-slate-400">
                                                {method.transactionCount} ventas
                                            </span>
                                        </div>
                                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Venta bruta</p>
                                        <p className="font-mono text-lg font-bold text-cyan-300">{formatC(method.grossSales)}</p>
                                        {method.returnsTotal !== undefined && (
                                            <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-2 text-xs">
                                                <div className="flex justify-between gap-2 text-amber-300">
                                                    <span>Devoluciones{method.returnCount ? ` (${method.returnCount})` : ''}</span>
                                                    <span className="font-mono">-{formatC(method.returnsTotal)}</span>
                                                </div>
                                                <div className="flex justify-between gap-2 font-bold text-emerald-300">
                                                    <span>Neto</span>
                                                    <span className="font-mono">{formatC(method.netSales ?? method.grossSales)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 rounded-lg border border-dashed border-white/[0.08] p-4 text-sm text-slate-500">
                                No hay métodos de pago para mostrar.
                            </p>
                        )}
                    </div>

                    <div>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h3 className="font-bold text-slate-100">Productos vendidos</h3>
                                <p className="mt-1 text-xs text-slate-500">Cantidades y rentabilidad netas después de devoluciones.</p>
                            </div>
                            <span className="text-xs font-semibold text-slate-400">{products.length} productos</span>
                        </div>
                        {products.length > 0 ? (
                            <div className="mt-3 max-h-[34rem] overflow-auto rounded-xl border border-white/[0.06]">
                                <table className="w-full min-w-[1180px] text-sm">
                                    <caption className="sr-only">Desglose completo de ventas por producto</caption>
                                    <thead className="sticky top-0 z-10 bg-surface-800">
                                        <tr className="border-b border-white/[0.06] text-xs uppercase tracking-wide text-slate-400">
                                            <th scope="col" className="px-4 py-3 text-left">Producto</th>
                                            <th scope="col" className="px-4 py-3 text-left">Unidad</th>
                                            <th scope="col" className="px-4 py-3 text-right">Vendida</th>
                                            <th scope="col" className="px-4 py-3 text-right">Devuelta</th>
                                            <th scope="col" className="px-4 py-3 text-right">Neta</th>
                                            <th scope="col" className="px-4 py-3 text-right">Venta bruta</th>
                                            <th scope="col" className="px-4 py-3 text-right">Devoluciones</th>
                                            <th scope="col" className="px-4 py-3 text-right">Venta neta</th>
                                            <th scope="col" className="px-4 py-3 text-right">Costo</th>
                                            <th scope="col" className="px-4 py-3 text-right">Utilidad</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {products.map((product) => (
                                            <tr key={`${product.productId}-${product.productName}-${product.presentation}-${product.displayUnit}`} className="hover:bg-white/[0.025]">
                                                <th scope="row" className="px-4 py-3 text-left font-semibold text-slate-100">
                                                    {product.productName}
                                                </th>
                                                <td className="px-4 py-3 text-slate-300">
                                                    <span>{product.displayUnit || product.unit || product.baseUnit}</span>
                                                    <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                                                        {product.presentation === 'PACK' ? 'EMPAQUE' : 'BASE'}
                                                    </span>
                                                    <span className="ml-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                                                        {product.saleMode === 'MEASURED' ? 'MEDIDO' : 'UNIDADES'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-300">{formatQuantity(product.quantitySold ?? product.quantityGross)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-amber-300">{formatQuantity(product.quantityReturned)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-cyan-200">{formatQuantity(product.quantityNet)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-300">{formatC(product.grossSales)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-amber-300">-{formatC(product.returnsTotal)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-100">{formatC(product.netSales)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-400">{formatC(product.cogs)}</td>
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${asNumber(product.grossProfit) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                                    {formatC(product.grossProfit)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="mt-3 rounded-lg border border-dashed border-white/[0.08] p-4 text-sm text-slate-500">
                                No hay productos para desglosar en este período.
                            </p>
                        )}
                    </div>
                </div>
            ) : null}
        </section>
    );
};

const CompactStat = ({
    label,
    value,
    emphasized = false,
}: {
    label: string;
    value: string;
    emphasized?: boolean;
}) => (
    <div className={`rounded-lg border p-3 ${emphasized ? 'border-cyan-500/25 bg-cyan-500/10' : 'border-white/[0.06] bg-surface-800/30'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 font-mono font-bold ${emphasized ? 'text-cyan-200' : 'text-slate-200'}`}>{value}</p>
    </div>
);

export default SalesReportPanel;
