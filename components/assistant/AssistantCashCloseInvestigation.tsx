import React from 'react';
import { z } from 'zod';
import type { AssistantJsonObject } from '../../shared/assistantOperations';
import { formatMoney, type Currency } from '../../utils/money';

const text = z.string().trim().min(1);
const instant = z.iso.datetime({ offset: true });
const nio = z.string().regex(/^-?\d{1,24}(?:\.\d{1,2})?$/);
const usd = z.string().regex(/^-?\d{1,24}(?:\.\d{1,4})?$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const movement = z.object({ type: z.enum(['IN', 'OUT']), currency: z.enum(['NIO', 'USD']), category: text, amount: usd });
const preciseMovement = (value: { currency: string; amount: string }) => value.currency !== 'NIO' || nio.safeParse(value.amount).success;
const schema = z.object({
    kind: z.literal('CASH_CLOSE_INVESTIGATION'), status: z.enum(['ok', 'partial', 'unavailable']), checkedAt: instant,
    scope: z.enum(['business', 'own-shifts']),
    shift: z.object({ id: text, openedAt: instant, closedAt: instant.nullable(), folio: text.nullable(), businessDate: z.iso.date().nullable() }),
    snapshot: z.object({
        source: z.object({ id: text, version: count.min(1), contentHash: text, documentUrl: z.string() }),
        cash: z.object({ expectedNio: nio, countedNio: nio, differenceNio: nio, expectedUsd: usd, countedUsd: usd, differenceUsd: usd,
            openingNio: nio, grossCashSalesNio: nio, cashRefundsNio: nio, paidInNio: nio, paidOutNio: nio, openingUsd: usd, paidInUsd: usd, paidOutUsd: usd }),
        payments: z.array(z.object({ method: text, transactionCount: count, grossSalesNio: nio })),
        movements: z.array(movement.extend({ count }).refine(preciseMovement)),
    }).nullable(),
    currentMovements: z.object({ status: z.enum(['available', 'truncated', 'unavailable']), rows: z.array(movement.extend({
        id: text, createdAt: instant, isVoided: z.boolean(), voidedAt: instant.nullable(), expenseId: text.nullable(),
    }).refine(preciseMovement)) }),
    pendingChecks: z.array(z.object({ code: text, message: text, references: z.array(text) })), warnings: z.array(z.string()), evidence: z.array(z.string()),
}).refine(value => value.status !== 'ok' || value.snapshot !== null);
const categories: Record<string, string> = { GASTO_OPERATIVO: 'Gasto operativo', PAGO_PROVEEDOR: 'Pago a proveedor', RETIRO_PERSONAL: 'Retiro personal', CAMBIO: 'Cambio', INYECCION_CAPITAL: 'Inyección de capital', AJUSTE: 'Ajuste', AGENTE_BANCARIO: 'Agente bancario', DEVOLUCION: 'Devolución', COMPRA_CONTADO: 'Compra de contado', COBRO_CREDITO: 'Cobro de crédito', NOMINA: 'Nómina', VENTA_EFECTIVO: 'Venta en efectivo', SIN_CATEGORIA: 'Sin categoría' };
const methods: Record<string, string> = { CASH: 'CASH · efectivo declarado', CARD: 'Tarjeta', QR: 'QR', CREDIT: 'Crédito', TRANSFER: 'Transferencia' };
const date = (value: string | null) => value === null ? 'No disponible' : `${new Date(value).toLocaleString('es-NI', { timeZone: 'America/Managua', hourCycle: 'h23' })} · Managua`;
function Amount({ value, currency }: { value: string | null; currency: Currency }) {
    return <span className="nx-shell-text break-words font-medium tabular-nums">{value === null ? 'No disponible' : formatMoney(value, currency, { decimals: currency === 'USD' ? 4 : 2 })}</span>;
}
function Cash({ cash }: { cash: z.infer<typeof schema>['snapshot']['cash'] | null }) {
    return <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(['NIO', 'USD'] as const).map(currency => <section key={currency} aria-label={`Al cierre ${currency}`} className="min-w-0 space-y-2">
        <h6 className="nx-shell-text font-semibold">{currency === 'NIO' ? 'Córdobas · NIO' : 'Dólares · USD'}</h6>
        <dl className="space-y-2 text-sm">{(currency === 'NIO' ? [
            ['Esperado', 'expectedNio'], ['Contado', 'countedNio'], ['Diferencia', 'differenceNio'], ['Apertura', 'openingNio'],
            ['Ventas CASH brutas', 'grossCashSalesNio'], ['Reembolsos en efectivo', 'cashRefundsNio'], ['Entradas registradas', 'paidInNio'], ['Salidas sin devoluciones', 'paidOutNio'],
        ] as const : [['Esperado', 'expectedUsd'], ['Contado', 'countedUsd'], ['Diferencia', 'differenceUsd'], ['Apertura', 'openingUsd'], ['Entradas registradas', 'paidInUsd'], ['Salidas registradas', 'paidOutUsd']] as const).map(([label, key]) => <div key={key} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1"><dt className="nx-shell-muted">{label}</dt><dd className="min-w-0"><Amount value={cash?.[key] ?? null} currency={currency} /></dd></div>)}</dl>
    </section>)}</div>;
}

/** Presenta sólo el DTO autorizado; no reconstruye saldos ni ejecuta operaciones. */
export function AssistantCashCloseInvestigation({ data }: { data: AssistantJsonObject }) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return <p role="status" className="nx-tone-warning text-sm">La investigación del cierre no está disponible. Pedí una nueva consulta en el chat.</p>;
    const review = parsed.data, snapshot = review.snapshot;
    return <section aria-label="Investigación del cierre" className="nx-shell-control min-w-0 space-y-4 rounded-card border p-3">
        <header className="min-w-0 space-y-1"><h4 className="nx-shell-text break-all font-semibold">{review.shift.folio ? `Investigación del cierre ${review.shift.folio}` : 'Investigación del cierre'}</h4>
            <p className="nx-shell-muted text-sm">Alcance: {review.scope === 'business' ? 'turnos del negocio' : 'tus turnos'}.</p>
            <p className="nx-shell-muted break-all text-xs">Turno: {review.shift.id} · Día del cierre: {review.shift.businessDate ?? 'No disponible'}</p>
            <p className="nx-shell-muted text-xs">Consultado: {date(review.checkedAt)}</p>
            <p className="nx-shell-muted text-sm">Esta lectura no determina una causa ni acredita conciliación aceptada. No recalcula el efectivo esperado.</p>
        </header>
        {review.status !== 'ok' && <p role="status" className="nx-tone-warning text-sm">{review.status === 'partial' ? 'Investigación parcial: hay información pendiente.' : 'No se pudo verificar el reporte del cierre; la información ausente no equivale a cero.'}</p>}
        <section aria-label="Reporte guardado al cierre" className="min-w-0 space-y-3"><h5 className="nx-shell-text font-semibold">Reporte guardado al cierre</h5>
            <p className="nx-shell-muted text-xs">Cerrado: {date(review.shift.closedAt)}. Estos importes pertenecen al reporte guardado.</p>
            {!snapshot && <p className="nx-tone-warning text-sm">Reporte no disponible. No se reconstruye con movimientos actuales.</p>}
            <Cash cash={snapshot?.cash ?? null} />
            <p className="nx-tone-warning text-sm">Las ventas CASH brutas pueden incluir crédito de tienda aplicado: no acreditan el efectivo recibido. Los reembolsos se muestran por separado; no se suman otra vez a las salidas.</p>
            {snapshot && <>
                <details className="nx-shell-muted min-w-0 space-y-2 text-sm"><summary className="nx-shell-text min-h-tap cursor-pointer py-2">Ver ventas por forma de pago al cierre</summary>
                    {snapshot.payments.length === 0 ? <p>Sin formas de pago registradas en el reporte.</p> : <ul className="space-y-2">{snapshot.payments.map((payment, index) => <li key={index} className="min-w-0 break-words">{methods[payment.method] ?? 'Otra forma de pago'} · Transacciones: {payment.transactionCount} · Ventas brutas: <Amount value={payment.grossSalesNio} currency="NIO" /></li>)}</ul>}
                </details>
                <details className="nx-shell-muted min-w-0 space-y-2 text-sm"><summary className="nx-shell-text min-h-tap cursor-pointer py-2">Ver movimientos agrupados al cierre</summary>
                    {snapshot.movements.length === 0 ? <p>Sin movimientos agrupados en el reporte.</p> : <ul className="space-y-2">{snapshot.movements.map((item, index) => <li key={index} className="min-w-0 break-words">{item.type === 'IN' ? 'Entrada' : 'Salida'} · {categories[item.category] ?? 'Otra categoría'} · Movimientos: {item.count} · <Amount value={item.amount} currency={item.currency} /></li>)}</ul>}
                </details>
                <details className="nx-shell-muted min-w-0 space-y-1 text-xs"><summary className="nx-shell-text min-h-tap cursor-pointer py-2 text-sm">Ver referencia del cierre</summary><p>Versión {snapshot.source.version}</p><p className="break-all">Reporte: {snapshot.source.id}</p><p className="break-all">Hash: {snapshot.source.contentHash}</p><p>Consultá el original por este folio y turno en los reportes de cierre.</p></details>
            </>}
        </section>
        <section aria-label="Movimientos actuales del turno" className="min-w-0 space-y-3"><h5 className="nx-shell-text font-semibold">Movimientos actuales del turno</h5><p className="nx-shell-muted text-sm">Movimientos registrados de caja, sin listado de ventas. Estado observado al consultar; puede incluir anulaciones posteriores. No se suma al reporte ni reemplaza sus importes.</p>
            {review.currentMovements.status === 'truncated' && <p className="nx-tone-warning text-sm">Lista incompleta: se alcanzó el límite de movimientos. No representa todos los movimientos del turno.</p>}
            {review.currentMovements.status === 'unavailable' ? <p className="nx-tone-warning text-sm">Movimientos actuales no disponibles. No equivale a cero.</p> : review.currentMovements.rows.length === 0 ? <p className="nx-shell-muted text-sm">{review.currentMovements.status === 'available' ? 'No hay movimientos de caja en el alcance consultado. Esto no significa que no hubo ventas ni actividad.' : 'No hay filas disponibles para mostrar.'}</p> : <ul className="min-w-0 space-y-3">{review.currentMovements.rows.map((item, index) => <li key={index} className="nx-shell-border min-w-0 space-y-1 rounded-control border p-3 text-sm">
                <p className="nx-shell-text break-words">{item.type === 'IN' ? 'Entrada' : 'Salida'} · {categories[item.category] ?? 'Otra categoría'} · <Amount value={item.amount} currency={item.currency} /></p>
                <p className={item.isVoided ? 'nx-tone-warning' : 'nx-shell-muted'}>{item.isVoided ? `Anulado · ${date(item.voidedAt)}` : 'Sin anulación registrada'}</p><p className="nx-shell-muted text-xs">Registrado: {date(item.createdAt)}</p>
                <details className="nx-shell-muted min-w-0 text-xs"><summary className="nx-shell-text min-h-tap cursor-pointer py-2 text-sm">Ver referencia del movimiento</summary><p className="break-all">Movimiento: {item.id}</p><p className="break-all">Gasto vinculado: {item.expenseId ?? 'Sin referencia'}</p></details>
            </li>)}</ul>}
        </section>
        <section aria-label="Pendientes de revisión" className="min-w-0 space-y-2"><h5 className="nx-shell-text font-semibold">Pendientes de revisión</h5>{review.pendingChecks.length === 0 ? <p className="nx-shell-muted text-sm">No se informaron pendientes; esto no acredita una causa ni conciliación.</p> : <ul className="space-y-3">{review.pendingChecks.map((pending, index) => <li key={index} className="min-w-0"><p className="nx-shell-text break-words text-sm">{pending.message}</p>{pending.references.length > 0 && <details className="nx-shell-muted text-xs"><summary className="nx-shell-text min-h-tap cursor-pointer py-2 text-sm">Ver referencias del pendiente</summary><ul className="space-y-1 break-all">{pending.references.map((reference, i) => <li key={i}>{reference}</li>)}</ul></details>}</li>)}</ul>}</section>
        {review.warnings.length > 0 && <ul aria-label="Advertencias de la investigación" className="nx-tone-warning list-disc space-y-1 break-words pl-4 text-sm">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <details className="nx-shell-muted min-w-0 text-xs"><summary className="nx-shell-text min-h-tap cursor-pointer py-2 text-sm">Ver procedencia de la consulta</summary><ul className="space-y-1 break-words">{review.evidence.map((source, index) => <li key={index}>{source}</li>)}</ul></details>
    </section>;
}
