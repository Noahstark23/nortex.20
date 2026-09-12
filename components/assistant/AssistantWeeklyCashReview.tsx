import React from 'react';
import { z } from 'zod';
import { assistantButtonClass } from './AssistantCatalogSelect';

type InvestigationProps = { onInvestigate?: (shiftId: string, reportHash?: string) => void; investigationDisabled?: boolean };
import type { AssistantJsonObject } from '../../shared/assistantOperations';
import { formatMoney, type Currency } from '../../utils/money';

const money = z.string().regex(/^-?\d{1,18}(?:\.\d{1,4})?$/);
const text = z.string().trim().min(1);
const instant = z.iso.datetime({ offset: true });
const cashSchema = z.object({
    expectedNio: money, countedNio: money, differenceNio: money,
    expectedUsd: money, countedUsd: money, differenceUsd: money,
});
const rowSchema = z.object({
    shiftId: text, status: z.enum(['BALANCED', 'DIFFERENCE', 'MISSING_REPORT', 'INVALID_REPORT', 'OPEN']),
    closedAt: instant.nullable(), businessDate: z.iso.date().nullable(), folio: text.nullable(),
    source: z.object({ id: text, version: z.number().int().positive(), contentHash: text, documentUrl: z.string() }).nullable(),
    cash: cashSchema.nullable(), message: z.string(),
}).refine(row => !['BALANCED', 'DIFFERENCE'].includes(row.status) || (row.cash !== null && row.source !== null));
const reviewSchema = z.object({
    kind: z.literal('WEEKLY_CASH_REVIEW'), status: z.enum(['ok', 'partial', 'unavailable']),
    period: z.object({ startDate: z.iso.date(), endDate: z.iso.date(), cutoff: instant, timeZone: z.literal('America/Managua'), completeDays: z.boolean() }),
    checkedAt: instant, scope: z.enum(['business', 'own-shifts']), truncated: z.boolean(),
    rows: z.array(rowSchema),
    counts: z.object({ closed: z.number().int().nonnegative(), verified: z.number().int().nonnegative(), differences: z.number().int().nonnegative(), missingReports: z.number().int().nonnegative(), invalidReports: z.number().int().nonnegative(), open: z.number().int().nonnegative() }),
    totals: z.object({ shortageNio: money.nullable(), surplusNio: money.nullable(), shortageUsd: money.nullable(), surplusUsd: money.nullable() }),
    warnings: z.array(z.string()), evidence: z.array(z.string()),
});
const statusLabels = {
    BALANCED: 'Sin diferencia de efectivo', DIFFERENCE: 'Diferencia de efectivo',
    MISSING_REPORT: 'Falta el reporte de cierre', INVALID_REPORT: 'Reporte no verificable', OPEN: 'Turno abierto',
};
const countLabels = { closed: 'Turnos cerrados', verified: 'Reportes verificados', differences: 'Cierres con diferencia', missingReports: 'Reportes faltantes', invalidReports: 'Reportes no verificables', open: 'Turnos abiertos' };
const countKeys = ['closed', 'verified', 'differences', 'missingReports', 'invalidReports', 'open'] as const;

function Amount({ value, currency }: { value: string | null; currency: Currency }) {
    return <span className="nx-shell-text break-words font-medium tabular-nums">{value === null ? 'No disponible' : formatMoney(value, currency, { decimals: currency === 'USD' ? 4 : 2 })}</span>;
}
function CashAmounts({ cash }: { cash: z.infer<typeof cashSchema> | null }) {
    return <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(['NIO', 'USD'] as const).map(currency => <section key={currency} aria-label={`Efectivo ${currency}`} className="min-w-0 space-y-2">
        <h6 className="nx-shell-muted text-xs font-semibold">{currency === 'NIO' ? 'Córdobas · NIO' : 'Dólares · USD'}</h6>
        <dl className="space-y-2 text-sm">{(['Esperado', 'Contado', 'Diferencia'] as const).map((label, index) => {
            const keys = currency === 'NIO' ? ['expectedNio', 'countedNio', 'differenceNio'] as const : ['expectedUsd', 'countedUsd', 'differenceUsd'] as const;
            return <div key={label} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1"><dt className="nx-shell-muted">{label}</dt><dd className="min-w-0"><Amount value={cash?.[keys[index]] ?? null} currency={currency} /></dd></div>;
        })}</dl>
    </section>)}</div>;
}
function CashReviewRow({ row, onInvestigate, investigationDisabled }: { row: z.infer<typeof rowSchema> } & InvestigationProps) {
    const verified = row.status === 'BALANCED' || row.status === 'DIFFERENCE';
    const title = row.folio ? `Cierre ${row.folio}` : `Turno ${row.shiftId}`;
    return <article aria-label={title} className="nx-shell-border min-w-0 space-y-3 rounded-card border p-3">
        <div className="min-w-0 space-y-1"><h5 className="nx-shell-text break-all font-semibold">{title}</h5>
            <p className={`${row.status === 'BALANCED' ? 'nx-shell-muted' : 'nx-tone-warning'} break-words text-sm`}>{statusLabels[row.status]}</p>
            <p className="nx-shell-muted break-all text-xs">Turno: {row.shiftId} · Día del cierre: {row.businessDate ?? 'No disponible'}</p>
        </div>
        <CashAmounts cash={verified ? row.cash : null} />
        {row.message && <p className="nx-shell-muted whitespace-pre-line break-words text-sm">{row.message}</p>}
        {row.source ? <details className="nx-shell-muted min-w-0 space-y-1 text-xs">
            <summary className="nx-shell-text min-h-tap cursor-pointer py-2 text-sm">Ver referencia del cierre</summary>
            <p className="break-words">Referencia del reporte de cierre · Versión {row.source.version}</p>
            <p className="break-all">Reporte: {row.source.id}</p><p className="break-all">Hash: {row.source.contentHash}</p>
            <p>Para consultar el original, buscá este folio y turno en los reportes de cierre.</p>
        </details> : <p className="nx-tone-warning text-xs">Sin referencia de un reporte verificable.</p>}
        {row.status !== 'OPEN' && onInvestigate && <button type="button" className={assistantButtonClass} disabled={investigationDisabled} onClick={() => { if (!investigationDisabled) onInvestigate(row.shiftId, row.source?.contentHash); }}>Investigar este cierre</button>}
    </article>;
}

/** Lectura del DTO autorizado: no consulta URLs del reporte ni confirma operaciones. */
export function AssistantWeeklyCashReview({ data, onInvestigate, investigationDisabled }: { data: AssistantJsonObject } & InvestigationProps) {
    const parsed = reviewSchema.safeParse(data);
    if (!parsed.success) return <p className="nx-tone-warning text-sm" role="status">La revisión semanal de caja no está disponible. Pedí una nueva consulta en el chat.</p>;
    const review = parsed.data;
    const complete = !review.truncated && review.status !== 'unavailable';
    return <section aria-label="Revisión semanal de caja" className="min-w-0 space-y-4">
        <div className="space-y-1"><h4 className="nx-shell-text font-semibold">Revisión semanal de caja</h4>
            <p className="nx-shell-muted text-sm">Alcance: {review.scope === 'business' ? 'turnos del negocio' : 'tus turnos'}. Período: {review.period.startDate} al {review.period.endDate} · Managua.</p>
            <p className="nx-shell-muted text-xs">Corte: {new Date(review.period.cutoff).toLocaleString('es-NI', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })} · Managua{!review.period.completeDays && ' · Período en curso'}</p>
            <p className="nx-shell-muted text-xs">Esta lectura compara efectivo registrado en reportes de cierre. No acredita conciliación contable ni saldo bancario.</p>
        </div>
        {review.status !== 'ok' && <p className="nx-tone-warning text-sm" role="status">{review.status === 'unavailable' ? 'No se pudo completar la revisión. Los datos no disponibles no equivalen a cero.' : 'Revisión parcial: revisá los turnos y advertencias pendientes.'}</p>}
        {review.truncated && <p className="nx-tone-warning text-sm">La lista está incompleta. Los conteos y acumulados del período no están disponibles; pedí un período más corto en el chat.</p>}
        {complete && <dl aria-label="Conteos del período" className="grid min-w-0 grid-cols-2 gap-3 text-sm">{countKeys.map(key => <div key={key} className="min-w-0"><dt className="nx-shell-muted break-words">{countLabels[key]}</dt><dd className="nx-shell-text font-semibold tabular-nums">{review.counts[key]}</dd></div>)}</dl>}
        <section aria-label="Faltantes y sobrantes separados" className="space-y-2"><h5 className="nx-shell-text text-sm font-semibold">Faltantes y sobrantes de efectivo</h5>
            <p className="nx-shell-muted text-xs">Se muestran por separado, sin compensarlos entre turnos ni convertir monedas.</p>
            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">{([
                ['Faltantes NIO', 'shortageNio', 'NIO'], ['Sobrantes NIO', 'surplusNio', 'NIO'],
                ['Faltantes USD', 'shortageUsd', 'USD'], ['Sobrantes USD', 'surplusUsd', 'USD'],
            ] as const).map(([label, key, currency]) => <div key={key} className="min-w-0"><dt className="nx-shell-muted">{label}</dt><dd><Amount value={complete ? review.totals[key] : null} currency={currency} /></dd></div>)}</dl>
        </section>
        {review.warnings.length > 0 && <ul aria-label="Advertencias de la revisión" className="nx-tone-warning list-disc space-y-1 break-words pl-4 text-sm">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {review.rows.length > 0 ? <div aria-label="Turnos revisados" className="min-w-0 space-y-3">{review.rows.map((row, index) => <React.Fragment key={`${row.shiftId}:${index}`}><CashReviewRow row={row} onInvestigate={onInvestigate} investigationDisabled={investigationDisabled} /></React.Fragment>)}</div> : <p className="nx-shell-muted text-sm">{complete ? 'No hay turnos en el alcance consultado.' : 'No hay turnos disponibles para mostrar.'}</p>}
    </section>;
}
