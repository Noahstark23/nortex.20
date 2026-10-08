import { useState } from 'react';
import Decimal from 'decimal.js';
import { AlertTriangle, Check, FileText, Loader2, Printer } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import {
    authenticatedRequestErrorMessage,
    openAuthenticatedPreview,
} from '../../utils/authenticatedDownload';

type UnknownRecord = Record<string, unknown>;

export interface ShiftCloseReportSummary {
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    transactionCount: number;
    returnCount: number;
    itemQuantityGross: string;
    itemQuantityReturned: string;
    itemQuantityNet: string;
    discountTotal: string;
    vatCollected: string;
    cogs: string;
    grossProfit: string;
    averageTicket: string;
}

export interface ShiftClosePaymentMethod {
    method: string;
    label: string;
    transactionCount: number;
    grossSales: string;
}

export interface ShiftCloseProductLine {
    productId: string | null;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    displayUnit: string;
    quantitySold: string;
    quantityReturned: string;
    quantityNet: string;
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    cogs: string;
    grossProfit: string;
}

export interface ShiftCloseCashSummary {
    openingNio: string;
    cashSalesNio: string;
    cashRefundsNio: string;
    paidInNio: string;
    paidOutNio: string;
    expectedNio: string;
    countedNio: string;
    differenceNio: string;
    openingUsd: string;
    paidInUsd: string;
    paidOutUsd: string;
    expectedUsd: string;
    countedUsd: string;
    differenceUsd: string;
}

export interface ShiftCloseReportSnapshot {
    id: string;
    shiftId: string;
    folio: string;
    businessDate: string;
    version: number;
    contentHash: string;
    createdAt: string;
    documentUrl: string;
    report: {
        version: number;
        folio: string;
        businessDate: string;
        timeZone: string;
        generatedAt: string;
        summary: ShiftCloseReportSummary;
        paymentMethods: ShiftClosePaymentMethod[];
        products: ShiftCloseProductLine[];
        cash: ShiftCloseCashSummary;
    };
}

export interface ShiftCloseResult {
    expected: string;
    declared: string;
    difference: string;
    closeReport: ShiftCloseReportSnapshot | null;
}

interface ShiftCloseReportProps {
    result: ShiftCloseResult;
    token: string | null;
    onFinish: () => void;
    onPreviewError: (message: string) => void;
}

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const textValue = (value: unknown, fallback = ''): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

const decimalValue = (value: unknown, fallback = '0'): string => {
    try {
        const decimal = new Decimal(value as Decimal.Value);
        return decimal.isFinite() ? decimal.toString() : fallback;
    } catch {
        return fallback;
    }
};

const countValue = (value: unknown): number => {
    const decimal = decimalValue(value);
    const count = new Decimal(decimal).floor();
    return count.isNegative() ? 0 : count.toNumber();
};

const versionValue = (value: unknown): number => {
    const version = countValue(value);
    return version > 0 ? version : 1;
};

// El token Bearer nunca puede viajar a una URL absoluta recibida en el payload.
// Los documentos de caja válidos viven bajo el API autenticado del mismo origen.
const reportDocumentUrl = (value: unknown): string => {
    const url = textValue(value);
    return url.startsWith('/api/reports/') ? url : '';
};

const normalizeSummary = (value: unknown): ShiftCloseReportSummary | null => {
    if (!isRecord(value)) return null;
    return {
        grossSales: decimalValue(value.grossSales),
        returnsTotal: decimalValue(value.returnsTotal),
        netSales: decimalValue(value.netSales),
        transactionCount: countValue(value.transactionCount),
        returnCount: countValue(value.returnCount),
        itemQuantityGross: decimalValue(value.itemQuantityGross),
        itemQuantityReturned: decimalValue(value.itemQuantityReturned),
        itemQuantityNet: decimalValue(value.itemQuantityNet),
        discountTotal: decimalValue(value.discountTotal),
        vatCollected: decimalValue(value.vatCollected),
        cogs: decimalValue(value.cogs),
        grossProfit: decimalValue(value.grossProfit),
        averageTicket: decimalValue(value.averageTicket),
    };
};

const normalizePaymentMethods = (value: unknown): ShiftClosePaymentMethod[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const method = textValue(entry.method);
        if (!method) return [];
        return [{
            method,
            label: textValue(entry.label, method),
            transactionCount: countValue(entry.transactionCount),
            grossSales: decimalValue(entry.grossSales),
        }];
    });
};

const normalizeProducts = (value: unknown): ShiftCloseProductLine[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const productName = textValue(entry.productName);
        if (!productName) return [];
        return [{
            productId: textValue(entry.productId) || null,
            productName,
            unit: textValue(entry.unit),
            saleMode: textValue(entry.saleMode),
            presentation: textValue(entry.presentation),
            displayUnit: textValue(entry.displayUnit),
            quantitySold: decimalValue(entry.quantitySold),
            quantityReturned: decimalValue(entry.quantityReturned),
            quantityNet: decimalValue(entry.quantityNet),
            grossSales: decimalValue(entry.grossSales),
            returnsTotal: decimalValue(entry.returnsTotal),
            netSales: decimalValue(entry.netSales),
            cogs: decimalValue(entry.cogs),
            grossProfit: decimalValue(entry.grossProfit),
        }];
    });
};

const normalizeCash = (value: unknown): ShiftCloseCashSummary | null => {
    if (!isRecord(value)) return null;
    return {
        openingNio: decimalValue(value.openingNio),
        cashSalesNio: decimalValue(value.cashSalesNio),
        cashRefundsNio: decimalValue(value.cashRefundsNio),
        paidInNio: decimalValue(value.paidInNio),
        paidOutNio: decimalValue(value.paidOutNio),
        expectedNio: decimalValue(value.expectedNio),
        countedNio: decimalValue(value.countedNio),
        differenceNio: decimalValue(value.differenceNio),
        openingUsd: decimalValue(value.openingUsd),
        paidInUsd: decimalValue(value.paidInUsd),
        paidOutUsd: decimalValue(value.paidOutUsd),
        expectedUsd: decimalValue(value.expectedUsd),
        countedUsd: decimalValue(value.countedUsd),
        differenceUsd: decimalValue(value.differenceUsd),
    };
};

/**
 * Valida el snapshot antes de renderizarlo. También acepta temporalmente el
 * formato plano de las primeras implementaciones para que un despliegue
 * escalonado de frontend/backend no deje al cajero sin resumen.
 */
export const normalizeShiftCloseReport = (value: unknown): ShiftCloseReportSnapshot | null => {
    if (!isRecord(value)) return null;

    const reportSource = isRecord(value.report) ? value.report : value;
    const summary = normalizeSummary(reportSource.summary);
    const cash = normalizeCash(reportSource.cash);
    if (!summary || !cash) return null;

    const folio = textValue(value.folio, textValue(reportSource.folio));
    const businessDate = textValue(value.businessDate, textValue(reportSource.businessDate));

    return {
        id: textValue(value.id),
        shiftId: textValue(value.shiftId),
        folio,
        businessDate,
        version: versionValue(value.version),
        contentHash: textValue(value.contentHash),
        createdAt: textValue(value.createdAt),
        documentUrl: reportDocumentUrl(value.documentUrl),
        report: {
            version: versionValue(reportSource.version),
            folio: textValue(reportSource.folio, folio),
            businessDate: textValue(reportSource.businessDate, businessDate),
            timeZone: textValue(reportSource.timeZone, 'America/Managua'),
            generatedAt: textValue(reportSource.generatedAt, textValue(value.createdAt)),
            summary,
            paymentMethods: normalizePaymentMethods(reportSource.paymentMethods),
            products: normalizeProducts(reportSource.products),
            cash,
        },
    };
};

/** Construye el view-model nuevo o legacy sin hacer aritmética con Number. */
export const resolveShiftCloseResult = (
    response: unknown,
    declaredCash: string,
): ShiftCloseResult => {
    const body = isRecord(response) ? response : {};
    const closeReport = normalizeShiftCloseReport(body.closeReport);
    const expected = closeReport?.report.cash.expectedNio
        ?? decimalValue(body.systemExpectedCash);
    const declared = closeReport?.report.cash.countedNio
        ?? decimalValue(declaredCash);

    let difference = closeReport?.report.cash.differenceNio;
    if (difference === undefined) {
        const legacyDifference = decimalValue(body.difference, '');
        difference = legacyDifference || new Decimal(declared).minus(expected).toString();
    }

    return { expected, declared, difference, closeReport };
};

const formatBusinessDate = (value: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    return `${match[3]}/${match[2]}/${match[1]}`;
};

const differenceAmountClass = (difference: Decimal) => {
    if (difference.isZero()) return 'text-emerald-300';
    return difference.lessThan(0) ? 'text-red-300' : 'text-amber-300';
};

const differenceCopy = (nioDifference: Decimal, usdDifference: Decimal) => {
    if (nioDifference.isZero() && usdDifference.isZero()) {
        return {
            title: 'Cuadre exacto',
            iconClass: 'bg-emerald-500/15 text-emerald-300',
            titleClass: 'text-emerald-300',
            Icon: Check,
        };
    }
    const hasShortage = nioDifference.lessThan(0) || usdDifference.lessThan(0);
    const hasSurplus = nioDifference.greaterThan(0) || usdDifference.greaterThan(0);
    return {
        title: hasShortage && hasSurplus
            ? 'Diferencia de efectivo'
            : hasShortage
                ? 'Faltante de efectivo'
                : 'Sobrante de efectivo',
        iconClass: 'bg-amber-500/15 text-amber-300',
        titleClass: 'text-amber-300',
        Icon: AlertTriangle,
    };
};

export function ShiftCloseReport({
    result,
    token,
    onFinish,
    onPreviewError,
}: ShiftCloseReportProps) {
    const [openingPreview, setOpeningPreview] = useState(false);
    const difference = new Decimal(result.difference);
    const snapshot = result.closeReport;
    const report = snapshot?.report;
    const usdDifference = new Decimal(report?.cash.differenceUsd ?? 0);
    const hasUsd = Boolean(report && [
        report.cash.openingUsd,
        report.cash.paidInUsd,
        report.cash.paidOutUsd,
        report.cash.expectedUsd,
        report.cash.countedUsd,
        report.cash.differenceUsd,
    ].some((value) => !new Decimal(value).isZero()));
    const status = differenceCopy(difference, usdDifference);
    const { Icon } = status;

    const handlePreview = async () => {
        if (!snapshot?.documentUrl || openingPreview) return;
        setOpeningPreview(true);
        try {
            await openAuthenticatedPreview(snapshot.documentUrl, { token });
        } catch (error) {
            onPreviewError(authenticatedRequestErrorMessage(
                error,
                'El cierre quedó guardado, pero no pudimos abrir el reporte. Podés reimprimirlo desde Reportes.',
            ));
        } finally {
            setOpeningPreview(false);
        }
    };

    return (
        <section
            aria-labelledby="shift-close-report-title"
            aria-live="polite"
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-800/40 text-slate-100"
        >
            <header className="border-b border-white/[0.07] bg-surface-900 px-5 py-6 text-center sm:px-8">
                <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full ${status.iconClass}`}>
                    <Icon size={28} aria-hidden="true" />
                </div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    Corte Z completado
                </p>
                <h2 id="shift-close-report-title" className="mt-1 text-2xl font-extrabold">
                    Resumen de cierre
                </h2>
                <p className={`mt-2 font-bold ${status.titleClass}`}>
                    {status.title}
                </p>
                {snapshot?.folio && (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-slate-200">
                            Folio {snapshot.folio}
                        </span>
                        {snapshot.businessDate && <span>{formatBusinessDate(snapshot.businessDate)}</span>}
                    </div>
                )}
            </header>

            <div className="space-y-5 p-5 sm:p-8">
                {report && (
                    <>
                        <div className="grid grid-cols-2 gap-3" aria-label="Totales de ventas del turno">
                            <div className="rounded-xl border border-white/[0.07] bg-surface-900/70 p-4">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Ventas brutas</p>
                                <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-100">
                                    {formatMoney(report.summary.grossSales)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {report.summary.transactionCount} transacci{report.summary.transactionCount === 1 ? 'ón' : 'ones'}
                                </p>
                            </div>
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                                <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Ventas netas</p>
                                <p className="mt-1 text-lg font-extrabold tabular-nums text-emerald-300">
                                    {formatMoney(report.summary.netSales)}
                                </p>
                                {new Decimal(report.summary.returnsTotal).greaterThan(0) && (
                                    <p className="mt-1 text-xs text-slate-400">
                                        Devoluciones: {formatMoney(report.summary.returnsTotal)}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="rounded-xl border border-white/[0.07] bg-surface-900/60 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <FileText size={17} className="text-brand" aria-hidden="true" />
                                <h3 className="text-sm font-bold text-slate-200">Ventas por método de pago</h3>
                            </div>
                            {report.paymentMethods.length > 0 ? (
                                <dl className="space-y-2.5">
                                    {report.paymentMethods.map((method) => (
                                        <div key={method.method} className="flex items-center justify-between gap-4 text-sm">
                                            <dt className="min-w-0 text-slate-400">
                                                <span className="font-semibold text-slate-200">{method.label}</span>
                                                <span className="ml-1.5 text-xs">({method.transactionCount})</span>
                                            </dt>
                                            <dd className="shrink-0 font-bold tabular-nums text-slate-100">
                                                {formatMoney(method.grossSales)}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            ) : (
                                <p className="text-sm text-slate-500">No hubo ventas registradas en este turno.</p>
                            )}
                        </div>
                    </>
                )}

                <div className="rounded-xl border border-white/[0.07] bg-surface-900/60 p-4">
                    <h3 className="mb-3 text-sm font-bold text-slate-200">Cuadre de efectivo</h3>
                    <dl className="space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-500">Esperado por el sistema</dt>
                            <dd className="font-bold tabular-nums">{formatMoney(result.expected)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-500">Declarado por el cajero</dt>
                            <dd className="font-bold tabular-nums">{formatMoney(result.declared)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-t border-white/[0.07] pt-3 text-base">
                            <dt className="font-bold text-slate-200">Diferencia</dt>
                            <dd className={`font-extrabold tabular-nums ${differenceAmountClass(difference)}`}>
                                {formatMoney(result.difference, 'NIO', { signed: difference.greaterThan(0) })}
                            </dd>
                        </div>
                        {hasUsd && report && (
                            <>
                                <div className="border-t border-white/[0.07] pt-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                                    Arqueo en dólares
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-slate-500">Esperado en dólares</dt>
                                    <dd className="font-bold tabular-nums">{formatMoney(report.cash.expectedUsd, 'USD')}</dd>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-slate-500">Declarado en dólares</dt>
                                    <dd className="font-bold tabular-nums">{formatMoney(report.cash.countedUsd, 'USD')}</dd>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="font-bold text-slate-200">Diferencia en dólares</dt>
                                    <dd className={`font-extrabold tabular-nums ${differenceAmountClass(usdDifference)}`}>
                                        {formatMoney(report.cash.differenceUsd, 'USD', { signed: usdDifference.greaterThan(0) })}
                                    </dd>
                                </div>
                            </>
                        )}
                    </dl>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                    {snapshot?.documentUrl && (
                        <button
                            type="button"
                            onClick={handlePreview}
                            disabled={openingPreview}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-brand/50 bg-brand/10 px-4 py-3 font-bold text-brand hover:bg-brand/20 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
                        >
                            {openingPreview ? (
                                <Loader2 size={19} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            ) : (
                                <Printer size={19} aria-hidden="true" />
                            )}
                            {openingPreview ? 'Abriendo reporte…' : 'Ver / imprimir reporte completo'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onFinish}
                        className={`min-h-12 rounded-control bg-slate-100 px-4 py-3 font-extrabold text-slate-950 hover:bg-white motion-reduce:transition-none ${snapshot?.documentUrl ? '' : 'sm:col-span-2'}`}
                    >
                        Finalizar turno
                    </button>
                </div>

                {!snapshot && (
                    <p className="text-center text-xs leading-5 text-slate-500">
                        El cierre quedó guardado. La reimpresión completa estará disponible al actualizar el servidor.
                    </p>
                )}
            </div>
        </section>
    );
}
